import { NextRequest, NextResponse } from 'next/server';
import {
  revokeToken,
  verifyTokenSignature,
  hashToken,
  maybeCleanupExpiredRevokedTokens,
} from '@/lib/auth';

// POST /api/auth/logout
// Server-side token revocation: stores a SHA-256 HASH of the token in the
// RevokedToken table until its natural expiry, so even a stolen copy cannot
// be used after the legitimate user logs out.
//
// P0.8 fixes:
//   - Returns 500 if revocation FAILS. Caller (UI) must know if logout
//     didn't actually invalidate the token, so the user can retry.
//   - Revokes BOTH Bearer token AND cookie token (if both present and
//     different). Previously only the Bearer was revoked.
//   - revokeToken() throws on DB error (does not swallow).
//
// P0.9 fix:
//   - Logs the token HASH (not the token substring) — the substring could
//     expose the userId payload. The hash is one-way and contains no
//     recoverable user data.
//
// Cleanup runs every 10 logouts OR if 1+ hour since last cleanup
// (opportunistic — not a true cron; see notes in auth.ts).
export async function POST(req: NextRequest) {
  const bearerToken = extractBearerToken(req);
  const cookieToken = extractCookieToken(req);

  // Revoke all distinct tokens present in the request.
  const tokensToRevoke = new Set<string>();
  if (bearerToken) tokensToRevoke.add(bearerToken);
  if (cookieToken) tokensToRevoke.add(cookieToken);

  let revocationFailed = false;
  let revocationError: string | undefined;
  // P0.9: log the token HASH (no recoverable user data), not the token
  // substring (which contains the userId payload).
  const revokedHashes: string[] = [];

  for (const token of tokensToRevoke) {
    const verified = verifyTokenSignature(token);
    if (!verified) continue; // invalid token, nothing to revoke
    const tokenHash = hashToken(token);
    try {
      await revokeToken(token, verified.userId);
      revokedHashes.push(tokenHash.substring(0, 12));  // truncated hash for logging
    } catch (e: any) {
      // P0.8: don't swallow — record the failure so we can return error
      // P0.9: log the hash, not the token substring
      console.error('revokeToken failed for hash', tokenHash.substring(0, 12) + '...:', e?.message);
      revocationFailed = true;
      revocationError = e?.message || 'Unknown revocation error';
    }
  }

  // Opportunistic cleanup (fire-and-forget; failure doesn't affect logout).
  maybeCleanupExpiredRevokedTokens().catch(() => {});

  // Log how many tokens were successfully revoked (by hash, not by token).
  if (revokedHashes.length > 0) {
    console.log('logout: revoked', revokedHashes.length, 'token(s) with hashes:', revokedHashes);
  }

  // Always clear the auth cookie — even if revocation failed, the user
  // can still log out from this browser session.
  const response = NextResponse.json(
    revocationFailed
      ? { success: false, error: 'Logout failed: token revocation failed. Stolen tokens may still be valid. Please try again.' }
      : { success: true },
    { status: revocationFailed ? 500 : 200 },
  );
  response.cookies.delete('auth-token');
  return response;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

function extractCookieToken(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const tokenMatch = cookie.match(/auth-token=([^;]+)/);
  return tokenMatch ? tokenMatch[1] : null;
}
