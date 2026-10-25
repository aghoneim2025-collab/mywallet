import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequestAsync } from '@/lib/auth';

// GET /api/auth/session - check if logged in
// P0.8: uses getUserIdFromRequestAsync (which checks the blacklist),
// not the synchronous getUserIdFromRequest (which doesn't).
// Without this, a logged-out token (whose hash is in the blacklist)
// would still return user data here, even though other API routes
// correctly reject it.
export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequestAsync(req);
  if (!userId) {
    return NextResponse.json({ data: null }, { status: 200 });
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json({ data: user });
}
