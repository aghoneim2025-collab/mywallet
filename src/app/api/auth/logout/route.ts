import { NextRequest, NextResponse } from 'next/server';
import {
  revokeToken,
  verifyTokenSignature,
  hashToken,
  maybeCleanupExpiredRevokedTokens,
  isProduction,
} from '@/lib/auth';

// POST /api/auth/logout
// Server-side token revocation: stores a SHA-256 HASH of the token in the
// RevokedToken table until its natural expiry, so even a stolen copy cannot
// be used after the legitimate user logs out.
//
// P0.13 fix: also delete the `__Host-auth-token` cookie (in production)
// AND the `auth-token` cookie (in dev). P0.12 changed the cookie name
// but logout was still trying to delete the old name → the cookie
// wasn't being cleared properly.
//
// P0.8 fixes:
//   - Returns 500 if revocation FAILS.
//   - Revokes BOTH Bearer token AND cookie token (if both present and different).
//   - revokeToken() throws on DB error (does not swallow).
//
// P0.9 fix:
//   - Logs the token HASH (not the token substring).
//
// Cleanup runs every 10 logouts OR if 1+ hour since last cleanup.
export async function POST(req: NextRequest) {
  const bearerToken = extractBearerToken(req);
  const cookieToken = extractCookieToken(req);

  // Revoke all distinct tokens present in the request.
  const tokensToRevoke = new Set<string>();
  if (bearerToken) tokensToRevoke.add(bearerToken);
  if (cookieToken) tokensToRevoke.add(cookieToken);

  let revocationFailed = false;
  const revokedHashes: string[] = [];

  for (const token of tokensToRevoke) {
    const verified = verifyTokenSignature(token);
    if (!verified) continue;
    const tokenHash = hashToken(token);
    try {
      await revokeToken(token, verified.userId);
      revokedHashes.push(tokenHash.substring(0, 12));
    } catch (e: any) {
      console.error('revokeToken failed for hash', tokenHash.substring(0, 12) + '...:', e?.message);
      revocationFailed = true;
    }
  }

  maybeCleanupExpiredRevokedTokens().catch(() => {});
  if (revokedHashes.length > 0) {
    console.log('logout: revoked', revokedHashes.length, 'token(s) with hashes:', revokedHashes);
  }

  // P0.13: Always clear BOTH cookie names — the prod cookie (`__Host-auth-token`)
  // and the dev cookie (`auth-token`). Without this, the cookie wasn't being
  // cleared in production after P0.12 changed the name.
  const response = NextResponse.json(
    revocationFailed
      ? { success: false, error: 'Logout failed: token revocation failed. Stolen tokens may still be valid. Please try again.' }
      : { success: true },
    { status: revocationFailed ? 500 : 200 },
  );
  // Dev cookie (no __Host- prefix)
  response.cookies.delete('auth-token');
  // Prod cookie (with __Host- prefix — only used when isProduction)
  if (isProduction) {
    response.cookies.delete('__Host-auth-token');
  }
  return response;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

function extractCookieToken(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  // P0.13: match either `auth-token` (dev) or `__Host-auth-token` (prod)
  const tokenMatch = cookie.match(/(?:__Host-)?auth-token=([^;]+)/);
  return tokenMatch ? tokenMatch[1] : null;
}
