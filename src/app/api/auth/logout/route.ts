import { NextRequest, NextResponse } from 'next/server';
import { revokeToken, extractToken, verifyTokenSignature, maybeCleanupExpiredRevokedTokens } from '@/lib/auth';

// POST /api/auth/logout
// Server-side token revocation: stores a SHA-256 HASH of the token in the
// RevokedToken table until its natural expiry, so even a stolen copy cannot
// be used after the legitimate user logs out. (Storing a hash instead of
// the raw token means a DB leak doesn't expose usable tokens.)
// Also clears the auth cookie.
// Every 10th logout also runs cleanup of expired revoked-token rows.
export async function POST(req: NextRequest) {
  const token = extractToken(req);
  if (token) {
    const verified = verifyTokenSignature(token);
    if (verified) {
      await revokeToken(token, verified.userId);
    }
  }
  // Opportunistic cleanup of expired revoked tokens (fire-and-forget).
  // Runs every 10 logouts to keep the table small without per-request overhead.
  maybeCleanupExpiredRevokedTokens().catch(() => {});

  const response = NextResponse.json({ success: true });
  response.cookies.delete('auth-token');
  return response;
}
