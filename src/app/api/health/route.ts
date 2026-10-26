import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/health — lightweight health check for monitoring/load balancers.
// Returns 200 if both: (a) the server is up, (b) the DB responds to a simple query.
// Returns 503 if the DB is unreachable (caller can retry).
// P0.11: useful for UptimeRobot, k8s readiness probe, alerting.
export async function GET() {
  try {
    // Cheap query: count users (returns 0 instantly on empty DB)
    await db.user.count();
    return NextResponse.json({ status: 'ok', db: 'up', timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { status: 'degraded', db: 'down', error: 'Database unreachable' },
      { status: 503 },
    );
  }
}
