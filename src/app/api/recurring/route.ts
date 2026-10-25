import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/recurring
export async function GET() {
  const items = await db.recurringTransaction.findMany({
    orderBy: { nextRun: 'asc' },
  });
  return NextResponse.json({ data: items });
}

// POST /api/recurring - create recurring transaction
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, toAccountId, frequency, dayOfMonth, startDate, endDate, note } = body;
    if (!type || !amount || !accountId || !categoryId || !frequency || !startDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Calculate nextRun based on frequency and dayOfMonth
    const start = new Date(startDate);
    const nextRun = new Date(start);
    if (frequency === 'monthly' && dayOfMonth) {
      nextRun.setDate(dayOfMonth);
      if (nextRun < new Date()) nextRun.setMonth(nextRun.getMonth() + 1);
    } else if (frequency === 'weekly') {
      nextRun.setDate(nextRun.getDate() + 7);
    } else if (frequency === 'daily') {
      // keep as today
    } else if (frequency === 'yearly') {
      nextRun.setFullYear(nextRun.getFullYear() + 1);
    }

    const item = await db.recurringTransaction.create({
      data: {
        type, amount: Number(amount), currency, accountId, categoryId,
        toAccountId: toAccountId || null,
        frequency, dayOfMonth: dayOfMonth || null,
        startDate: start, endDate: endDate ? new Date(endDate) : null,
        nextRun, note: note || null,
      },
    });
    return NextResponse.json({ data: item });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/recurring?id=...
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.recurringTransaction.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
