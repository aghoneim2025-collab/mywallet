import { NextRequest, NextResponse } from 'next/server';
import { revokeToken, extractToken, verifyTokenSignature, cleanupExpiredRevokedTokens } from '@/lib/auth';

// POST /api/auth/logout
// Server-side token revocation: stores the token in the RevokedToken table
// until its natural expiry, so even a stolen copy cannot be used after the
// legitimate user logs out. Also clears the auth cookie.
export async function POST(req: NextRequest) {
  const token = extractToken(req);
  if (token) {
    const verified = verifyTokenSignature(token);
    if (verified) {
      await revokeToken(token, verified.userId);
    }
  }
  // Opportunistic cleanup of expired revoked tokens (no await — fire-and-forget)
  cleanupExpiredRevokedTokens().catch(() => {});

  const response = NextResponse.json({ success: true });
  response.cookies.delete('auth-token');
  return response;
}
