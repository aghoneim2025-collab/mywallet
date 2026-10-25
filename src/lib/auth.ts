/**
 * Simple auth utilities - email + password
 * Uses bcrypt for password hashing
 */

// Simple hash function (no bcrypt needed for SQLite/standalone)
// Uses Node.js crypto for SHA-256 + salt
import { createHash, randomBytes } from 'crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const testHash = createHash('sha256').update(salt + password).digest('hex');
  return hash === testHash;
}

export function generateToken(userId: string): string {
  const payload = JSON.stringify({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  return Buffer.from(payload).toString('base64url');
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

/**
 * Get user ID from request (via Authorization header or cookie)
 * Returns null if not authenticated
 */
export function getUserIdFromRequest(req: Request): string | null {
  // Try Authorization header
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const result = verifyToken(token);
    if (result) return result.userId;
  }
  // Try cookie
  const cookie = req.headers.get('cookie') || '';
  const tokenMatch = cookie.match(/auth-token=([^;]+)/);
  if (tokenMatch) {
    const result = verifyToken(tokenMatch[1]);
    if (result) return result.userId;
  }
  return null;
}
