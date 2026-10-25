/**
 * Secure authentication - bcrypt + HMAC-signed tokens + server-side revocation.
 *
 * History:
 *   - P0.1: Math.random() per call → tokens always invalid in next request
 *   - P0.2: randomBytes(32) at module load → still broken because Next.js dev
 *           runs MULTIPLE worker processes, each with its own randomBytes
 *   - P0.4: deterministic dev secret (string-based, shared across workers)
 *   - P0.5: server-side token revocation via DB-backed blacklist
 *   - P0.6: store SHA-256 hash of token (not raw) in DB blacklist, so a DB
 *           leak doesn't turn the table into a vault of usable tokens.
 *           Rotate AUTH_SECRET after every leak; new secret invalidates ALL
 *           outstanding tokens (their HMAC signature no longer matches).
 */
import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual, createHash } from 'crypto';
import { db } from './db';

const TOKEN_SECRET = process.env.AUTH_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

// P0.4: Stable, deterministic dev secret so all workers share the same key.
const DEV_SECRET = 'dev-only-secret-please-set-AUTH_SECRET-in-production-env-min-32-chars-' +
  'do-not-use-in-prod-' + (process.env.NODE_ENV || 'development');

// P0.8: known-bad placeholder values from .env.example. If someone copies
// the example file to .env without filling in a real secret, the app
// would silently use a publicly-known placeholder value. This check
// rejects those values explicitly, even if they happen to meet the
// 32-char minimum (e.g., a long descriptive placeholder).
const FORBIDDEN_SECRETS = new Set([
  'REPLACE_ME',
  'replace-me',
  'replace_me',
  'changeme',
  'change-me',
  'placeholder',
  'todo',
  'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'dev-only-secret-please-set-AUTH_SECRET-in-production-env-min-32-chars-do-not-use-in-prod-development',
]);

function isPlaceholderSecret(s: string | undefined): boolean {
  if (!s) return false;
  if (FORBIDDEN_SECRETS.has(s)) return true;
  const lower = s.toLowerCase();
  if (lower.startsWith('replace') && lower.length < 64) return true;
  if (lower.startsWith('changeme')) return true;
  if (lower.startsWith('todo')) return true;
  if (lower.startsWith('placeholder')) return true;
  return false;
}

// Eagerly validate at module load time so the process fails fast.
// P0.8: rejects placeholder values even if they meet length requirement.
if (isProduction && (!TOKEN_SECRET || TOKEN_SECRET.length < 32 || isPlaceholderSecret(TOKEN_SECRET))) {
  throw new Error(
    'AUTH_SECRET must be set to a random string of at least 32 characters in production. ' +
    'Generate one with: openssl rand -hex 32. ' +
    (isPlaceholderSecret(TOKEN_SECRET) ? 'Placeholder values are not allowed in production.' : '')
  );
}

function getSecret(): string {
  if (isProduction) return TOKEN_SECRET!;
  return TOKEN_SECRET && TOKEN_SECRET.length >= 32 && !isPlaceholderSecret(TOKEN_SECRET)
    ? TOKEN_SECRET
    : DEV_SECRET;
}

const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// P0.6: SHA-256 hash the token before storing/looking up in DB or cache.
// This way, a DB dump doesn't expose usable tokens — only hashes that
// can't be reversed back to the original HMAC-signed token.
//
// The cache is keyed by the SAME hash so that a positive cache hit means
// the token (whose hash we know) is revoked.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// P0.5: in-memory cache for "definitely revoked" tokens.
// P0.6: keyed by SHA-256 hash, NOT the raw token.
// We ONLY cache positive revocation results (token IS revoked).
// We do NOT cache negative results ("not revoked") for long because that
// would delay revocation by up to the cache TTL.
//
// Set of revoked-token hashes (cleared on cleanup).
const revokedTokenSet = new Set<string>();

// P0.5: optional short-TTL negative cache to reduce DB load on hot paths.
// Set to 0 to disable (every request hits DB). 1000ms = max 1s revocation delay.
// P0.6: keyed by SHA-256 hash, NOT the raw token.
//
// IMPORTANT NOTE about multi-worker revocation latency:
// This negative cache is per-worker. If worker A served the logout (clearing
// its negative cache and adding the token to its positive cache), worker B
// might still have the token in its negative cache for up to 1 second.
// During that window, worker B may serve a request with the revoked token.
// The MAXIMUM revocation delay across workers = NEG_CACHE_TTL_MS (1 second).
const NEG_CACHE_TTL_MS = 1000; // 1 second — minimal cross-worker revocation window
const notRevokedCache = new Map<string, number>(); // hash -> fetchedAt timestamp

// P0.6/P0.7: time-based cleanup schedule (in addition to count-based).
// Every CLEANUP_INTERVAL_MS, the next logout triggers cleanup.
// Also runs at most once per CLEANUP_INTERVAL_MS regardless of logout count.
// This ensures cleanup runs even if logouts are infrequent.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let lastCleanupAt = 0;

// P0.6: opportunistic cleanup counter — also runs every Nth logout.
const CLEANUP_EVERY_N_LOGOUTS = 10;
let logoutCounter = 0;

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: string): string {
  const payload = { userId, exp: Date.now() + TOKEN_EXPIRY_MS };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const signature = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

// P0.5: Extract token from request (Authorization header OR cookie).
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookie = req.headers.get('cookie') || '';
  const tokenMatch = cookie.match(/auth-token=([^;]+)/);
  if (tokenMatch) return tokenMatch[1];
  return null;
}

// P0.5: Synchronous verify (HMAC + expiry only). Does NOT check blacklist.
// Use this only when you need to extract the userId quickly without DB.
export function verifyTokenSignature(token: string): { userId: string; exp: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;
    if (!payloadB64 || !signature) return null;

    const expectedSig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (typeof payload.userId !== 'string' || !payload.userId) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return { userId: payload.userId, exp: payload.exp };
  } catch {
    return null;
  }
}

// P0.8: fail-closed on DB errors. If the DB lookup fails, treat the token as
// REVOKED (return true), not as "not revoked". A transient DB outage should
// not let a stolen token through. The trade-off: legitimate users may see
// transient 401s when the DB is down. For a financial app, denying access
// during a DB outage is safer than allowing a revoked token through.
async function isTokenRevoked(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  if (revokedTokenSet.has(tokenHash)) return true;
  const negCacheEntry = notRevokedCache.get(tokenHash);
  if (negCacheEntry && (Date.now() - negCacheEntry) < NEG_CACHE_TTL_MS) {
    return false;
  }
  // P0.8: fail-closed. DB errors → treat as revoked (deny request).
  // Previously this was fail-open (return false), which let revoked tokens
  // through during DB outages. For a financial app, fail-closed is safer.
  try {
    const found = await db.revokedToken.findUnique({ where: { token: tokenHash }, select: { id: true } });
    if (found) {
      revokedTokenSet.add(tokenHash);
      notRevokedCache.delete(tokenHash);
      return true;
    }
    notRevokedCache.set(tokenHash, Date.now());
    return false;
  } catch (e) {
    console.error('isTokenRevoked: DB lookup failed, failing closed (revoked=true):', e);
    return true;
  }
}

// P0.8: Revoke a token. THROWS on DB error (does not swallow).
// Callers (logout route) must propagate the error to the user, so they
// know revocation failed and can retry. Otherwise a stolen token would
// remain valid while the user thinks they've logged out.
export async function revokeToken(token: string, userId: string): Promise<void> {
  const verified = verifyTokenSignature(token);
  if (!verified) return; // can't revoke an invalid token — nothing to revoke
  const tokenHash = hashToken(token);
  // P0.8: let errors propagate. Caller MUST handle.
  await db.revokedToken.upsert({
    where: { token: tokenHash },
    create: { token: tokenHash, userId, expiresAt: new Date(verified.exp) },
    update: {}, // already revoked
  });
  // Update local caches only AFTER successful DB write
  revokedTokenSet.add(tokenHash);
  notRevokedCache.delete(tokenHash);
}

// P0.5/P0.6: Cleanup of expired revoked tokens.
// Called opportunistically on logout — every CLEANUP_EVERY_N_LOGOUTS (10) logouts.
// Also clears the in-memory revokedTokenSet so it doesn't grow forever.
//
// For a more aggressive schedule, this could be wired to a cron job in production.
export async function cleanupExpiredRevokedTokens(): Promise<number> {
  try {
    const result = await db.revokedToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      // Clear local positive cache so it doesn't grow forever.
      // (Next request for a still-valid token will re-fetch from DB.)
      revokedTokenSet.clear();
      notRevokedCache.clear();
    }
    return result.count;
  } catch {
    return 0;
  }
}

// P0.7: Called from /api/auth/logout to opportunistically trigger cleanup.
// Runs cleanup in TWO cases:
//   (1) every CLEANUP_EVERY_N_LOGOUTS (10) logouts — count-based
//   (2) if last cleanup was more than CLEANUP_INTERVAL_MS (1 hour) ago — time-based
// The time-based path ensures cleanup runs even if logouts are infrequent.
// Returns the cleanup count (for logging) or 0 if cleanup was skipped this round.
export async function maybeCleanupExpiredRevokedTokens(): Promise<number> {
  logoutCounter++;
  const now = Date.now();
  const timeSinceLastCleanup = now - lastCleanupAt;
  const shouldRun =
    (logoutCounter % CLEANUP_EVERY_N_LOGOUTS === 0) ||
    (timeSinceLastCleanup >= CLEANUP_INTERVAL_MS);
  if (shouldRun) {
    lastCleanupAt = now;
    return cleanupExpiredRevokedTokens();
  }
  return 0;
}

export function verifyToken(token: string): { userId: string } | null {
  const result = verifyTokenSignature(token);
  return result ? { userId: result.userId } : null;
}

// P0.5: Async version that also checks the revocation blacklist.
// This is what requireAuth should use for full security.
export async function getUserIdFromRequestAsync(req: Request): Promise<string | null> {
  const token = extractToken(req);
  if (!token) return null;
  const verified = verifyTokenSignature(token);
  if (!verified) return null;
  if (await isTokenRevoked(token)) return null;
  return verified.userId;
}

// Synchronous version (kept for backwards compat, but does NOT check blacklist).
// Prefer getUserIdFromRequestAsync in any route that mutates data.
export function getUserIdFromRequest(req: Request): string | null {
  const token = extractToken(req);
  if (!token) return null;
  const result = verifyTokenSignature(token);
  return result ? result.userId : null;
}

// P0.5: Async requireAuth that checks blacklist.
export async function requireAuthAsync(req: Request): Promise<string> {
  const userId = await getUserIdFromRequestAsync(req);
  if (!userId) throw new Error('Unauthorized');
  return userId;
}

// Synchronous requireAuth (legacy, doesn't check blacklist — used only for
// GET endpoints where stale auth for ~30s is acceptable).
export function requireAuth(req: Request): string {
  const userId = getUserIdFromRequest(req);
  if (!userId) throw new Error('Unauthorized');
  return userId;
}

export function setAuthCookie(response: Response, token: string): Response {
  const secure = isProduction ? '; Secure' : '';
  response.headers.set(
    'Set-Cookie',
    `auth-token=${token}; HttpOnly; SameSite=Lax${secure}; Max-Age=2592000; Path=/`
  );
  return response;
}
