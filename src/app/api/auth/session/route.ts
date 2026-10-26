import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequestAsync, DbUnavailableError } from '@/lib/auth';

// GET /api/auth/session - check if logged in
// P0.8: uses getUserIdFromRequestAsync (which checks the blacklist),
// not the synchronous getUserIdFromRequest (which doesn't).
// P0.9: returns 503 (Service Unavailable) when the DB lookup fails,
// so the frontend can distinguish "session ended" (200 + data:null) from
// "service is down, retry later" (503 + error). The frontend should NOT
// clear the local token on 503 — only on 200 with null data.
//
// P0.10 fix: unexpected errors now return 500 (NOT 200 + null data).
// Previously, ANY catch → 200 + null data → frontend treated as
// "session ended" → cleared the token. This is wrong: an unexpected
// server error doesn't mean the token is invalid. Return 500 so the
// frontend keeps the token and shows "service error, retry" UI.
// Only return 200 + null data when we KNOW the token is invalid
// (signature check failed, token is in blacklist, expired, etc.).
export async function GET(req: NextRequest) {
  let userId: string | null;
  try {
    userId = await getUserIdFromRequestAsync(req);
  } catch (e) {
    if (e instanceof DbUnavailableError) {
      // DB is down. Token may be valid; don't claim session is invalid.
      return NextResponse.json(
        { data: null, error: 'Service unavailable: database unreachable. Please retry.' },
        { status: 503 },
      );
    }
    // P0.10: unexpected error → 500, NOT 200. Frontend keeps token.
    console.error('Unexpected error in /api/auth/session (returning 500):', e);
    return NextResponse.json(
      { data: null, error: 'Internal server error. Please retry.' },
      { status: 500 },
    );
  }

  if (!userId) {
    // Token missing, invalid, expired, or revoked → real "session ended".
    // Frontend WILL clear the token on this response (200 + null data).
    return NextResponse.json({ data: null }, { status: 200 });
  }

  // Token is valid + not revoked. Look up the user record.
  let user;
  try {
    user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
  } catch (e) {
    // DB error fetching the user. Return 503 so frontend doesn't clear token.
    console.error('DB error fetching user in /api/auth/session (returning 503):', e);
    return NextResponse.json(
      { data: null, error: 'Service unavailable: database unreachable. Please retry.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ data: user });
}

