/**
 * Secure authentication - bcrypt + HMAC-signed tokens
 */
import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_SECRET = process.env.AUTH_SECRET;
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  if (!TOKEN_SECRET || TOKEN_SECRET === 'mywallet-secret-key-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET must be set in production');
    }
    // Dev only - auto-generate random secret
    return 'dev-only-secret-' + Math.random().toString(36).slice(2);
  }
  return TOKEN_SECRET;
}

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
  const isHttps = process.env.NODE_ENV === 'production';
  response.headers.set(
    'Set-Cookie',
    `auth-token=${token}; HttpOnly; SameSite=Lax${isHttps ? '; Secure' : ''}; Max-Age=2592000; Path=/`
  );
  return response;
}
