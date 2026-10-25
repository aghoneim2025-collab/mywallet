/**
 * Secure authentication - bcrypt + HMAC-signed tokens
 * P0.2 fixes: stable dev secret, startup validation, timingSafeEqual
 */
import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

// Validate AUTH_SECRET at module load time
const TOKEN_SECRET = process.env.AUTH_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

// In production: AUTH_SECRET is REQUIRED (fail fast at startup)
// In development: generate a STABLE random secret (once per process, not per call)
const DEV_SECRET = randomBytes(32).toString('hex');

function getSecret(): string {
  if (isProduction) {
    if (!TOKEN_SECRET || TOKEN_SECRET.length < 32) {
      throw new Error('AUTH_SECRET must be set to a random string of at least 32 characters in production');
    }
    return TOKEN_SECRET;
  }
  // Dev: use stable secret (generated once at module load, not per call)
  return TOKEN_SECRET || DEV_SECRET;
}

const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

export function verifyToken(token: string): { userId: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;
    if (!payloadB64 || !signature) return null;

    // Constant-time comparison
    const expectedSig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;

    // Validate payload structure
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (typeof payload.userId !== 'string' || !payload.userId) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;

    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export function getUserIdFromRequest(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const result = verifyToken(authHeader.slice(7));
    if (result) return result.userId;
  }
  const cookie = req.headers.get('cookie') || '';
  const tokenMatch = cookie.match(/auth-token=([^;]+)/);
  if (tokenMatch) {
    const result = verifyToken(tokenMatch[1]);
    if (result) return result.userId;
  }
  return null;
}

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
