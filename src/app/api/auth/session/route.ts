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
export async function GET(req: NextRequest) {
  let userId: string | null;
  try {
    userId = await getUserIdFromRequestAsync(req);
  } catch (e) {
    if (e instanceof DbUnavailableError) {
      // DB is down. Don't claim the session is invalid — the token may be fine.
      return NextResponse.json(
        { data: null, error: 'Service unavailable: database unreachable. Please retry.' },
        { status: 503 },
      );
    }
    // Unexpected error — log and treat as not logged in (safer default).
    console.error('Unexpected error in /api/auth/session:', e);
    return NextResponse.json({ data: null }, { status: 200 });
  }

  if (!userId) {
    // Token missing, invalid, expired, or revoked.
    return NextResponse.json({ data: null }, { status: 200 });
  }

  // Token is valid + not revoked. Look up the user record.
  // This is a SEPARATE DB call from the blacklist check, so we also
  // need to handle DB errors here.
  let user;
  try {
    user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
  } catch (e) {
    // DB error fetching the user. Return 503 so frontend doesn't clear token.
    console.error('DB error fetching user in /api/auth/session:', e);
    return NextResponse.json(
      { data: null, error: 'Service unavailable: database unreachable. Please retry.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ data: user });
}
