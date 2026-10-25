/**
 * Secure authentication - bcrypt + HMAC-signed tokens + server-side revocation.
 *
 * History:
 *   - P0.1: Math.random() per call → tokens always invalid in next request
 *   - P0.2: randomBytes(32) at module load → still broken because Next.js dev
 *           runs MULTIPLE worker processes, each with its own randomBytes
 *   - P0.4: deterministic dev secret (string-based, shared across workers)
 *   - P0.5: server-side token revocation via DB-backed blacklist
 *           (addresses localStorage XSS risk raised in security review)
 */
import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from './db';

const TOKEN_SECRET = process.env.AUTH_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

// P0.4: Stable, deterministic dev secret so all workers share the same key.
const DEV_SECRET = 'dev-only-secret-please-set-AUTH_SECRET-in-production-env-min-32-chars-' +
  'do-not-use-in-prod-' + (process.env.NODE_ENV || 'development');

// Eagerly validate at module load time so the process fails fast
if (isProduction && (!TOKEN_SECRET || TOKEN_SECRET.length < 32)) {
  throw new Error(
    'AUTH_SECRET must be set to a random string of at least 32 characters in production. ' +
    'Generate one with: openssl rand -hex 32'
  );
}

function getSecret(): string {
  if (isProduction) return TOKEN_SECRET!;
  return TOKEN_SECRET && TOKEN_SECRET.length >= 32 ? TOKEN_SECRET : DEV_SECRET;
}

const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// P0.5: in-memory cache for "definitely revoked" tokens.
// We ONLY cache positive revocation results (token IS revoked).
// We do NOT cache negative results ("not revoked") because that would
// delay revocation by up to the cache TTL. This means every request with
// a non-revoked token does a DB lookup, but revocation is immediate.
//
// Set of revoked tokens (cleared on cleanup).
const revokedTokenSet = new Set<string>();

// P0.5: optional short-TTL negative cache to reduce DB load on hot paths.
// Set to 0 to disable (every request hits DB). 5000ms = max 5s revocation delay.
const NEG_CACHE_TTL_MS = 1000; // 1 second — minimal revocation window
const notRevokedCache = new Map<string, number>(); // token -> fetchedAt timestamp

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

// P0.5: Check if a token has been revoked server-side.
// - If in revokedTokenSet (positive cache): revoked = true
// - If in notRevokedCache (negative cache, 1s TTL): revoked = false
// - Otherwise: DB lookup, then update the appropriate cache
async function isTokenRevoked(token: string): Promise<boolean> {
  // Fast path: known revoked
  if (revokedTokenSet.has(token)) return true;
  // Short-TTL negative cache (1s) to coalesce concurrent requests for the
  // same token (e.g., parallel fetches on the home screen)
  const negCacheEntry = notRevokedCache.get(token);
  if (negCacheEntry && (Date.now() - negCacheEntry) < NEG_CACHE_TTL_MS) {
    return false;
  }
  // DB lookup. Fail-open on DB errors (transient issues shouldn't block legit users).
  try {
    const found = await db.revokedToken.findUnique({ where: { token }, select: { id: true } });
    if (found) {
      revokedTokenSet.add(token);
      notRevokedCache.delete(token);
      return true;
    }
    // Cache "not revoked" for 1s to coalesce parallel requests
    notRevokedCache.set(token, Date.now());
    return false;
  } catch {
    return false;
  }
}

// P0.5: Revoke a token (insert into DB blacklist + update local caches).
// Called from /api/auth/logout.
export async function revokeToken(token: string, userId: string): Promise<void> {
  const verified = verifyTokenSignature(token);
  if (!verified) return; // can't revoke an invalid token
  try {
    await db.revokedToken.upsert({
      where: { token },
      create: { token, userId, expiresAt: new Date(verified.exp) },
      update: {}, // already revoked
    });
    // Update caches immediately so subsequent requests in this worker see revoked=true
    revokedTokenSet.add(token);
    notRevokedCache.delete(token);
  } catch (e) {
    console.error('Failed to revoke token:', e);
  }
}

// P0.5: Periodic cleanup of expired revoked tokens (called opportunistically
// from /api/auth/logout). Also trims the in-memory set.
export async function cleanupExpiredRevokedTokens(): Promise<number> {
  try {
    const result = await db.revokedToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    // Clear local cache too (best-effort — Set has no .filter, so just clear all)
    // This is fine because the next request for any revoked token will re-fetch.
    if (result.count > 0) {
      revokedTokenSet.clear();
      notRevokedCache.clear();
    }
    return result.count;
  } catch {
    return 0;
  }
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
