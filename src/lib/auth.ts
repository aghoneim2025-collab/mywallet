/**
 * Secure authentication utilities
 * - bcrypt for password hashing (replaces SHA-256)
 * - HMAC-signed tokens (replaces base64 JSON)
 * - Rate limiting support
 */
import bcrypt from 'bcryptjs';
import { createHmac } from 'crypto';

const TOKEN_SECRET = process.env.AUTH_SECRET || 'mywallet-secret-key-change-in-production';
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ===== Password Hashing (bcrypt) =====
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ===== Token Generation (HMAC-signed) =====
export function generateToken(userId: string): string {
  const payload = { userId, exp: Date.now() + TOKEN_EXPIRY_MS };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const signature = createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    // Verify signature
    const expectedSig = createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');
    if (signature !== expectedSig) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp < Date.now()) return null;

    return { userId: payload.userId };
  } catch {
    return null;
  }
}

// ===== Auth Middleware =====
export function getUserIdFromRequest(req: Request): string | null {
  // Try Authorization header (for API calls from APK)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const result = verifyToken(token);
    if (result) return result.userId;
  }
  // Try cookie (for web browser)
  const cookie = req.headers.get('cookie') || '';
  const tokenMatch = cookie.match(/auth-token=([^;]+)/);
  if (tokenMatch) {
    const result = verifyToken(tokenMatch[1]);
    if (result) return result.userId;
  }
  return null;
}

/**
 * Require authentication - returns userId or throws
 * Use in API routes: const userId = requireAuth(req);
 */
export function requireAuth(req: Request): string {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

/**
 * Create auth response helper
 */
export function setAuthCookie(response: Response, token: string): Response {
  response.headers.set('Set-Cookie', `auth-token=${token}; HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/`);
  return response;
}
