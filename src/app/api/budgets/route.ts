import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/budgets?month=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    const userId = requireAuth(req);
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    const where: any = { userId };
    if (month) where.month = month;

    const budgets = await db.budget.findMany({
      where,
      include: { category: true },
    });

    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      const spent = await db.transaction.groupBy({
        by: ['categoryId'],
        where: { type: 'EXPENSE', date: { gte: start, lt: end }, userId },
        _sum: { amount: true },
      });

      const spentMap = new Map(spent.map(s => [s.categoryId, s._sum.amount || 0]));

      return NextResponse.json({
        data: budgets.map(b => ({ ...b, spent: spentMap.get(b.categoryId) || 0 })),
      });
    }

    return NextResponse.json({ data: budgets });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/budgets
export async function POST(req: NextRequest) {
  try {
    const userId = requireAuth(req);
    const body = await req.json();
    const { categoryId, month, limit, currency } = body;
    if (!categoryId || !month || !limit) {
      return NextResponse.json({ error: 'categoryId, month, limit required' }, { status: 400 });
    }

    const existing = await db.budget.findFirst({ where: { categoryId, month, userId } });
    if (existing) {
      const updated = await db.budget.update({
        where: { id: existing.id },
        data: { limit: Number(limit), currency: currency || existing.currency },
        include: { category: true },
      });
      return NextResponse.json({ data: updated });
    }

    const created = await db.budget.create({
      data: { categoryId, month, limit: Number(limit), currency: currency || 'EGP', userId },
      include: { category: true },
    });
    return NextResponse.json({ data: created });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/budgets?id=...
export async function DELETE(req: NextRequest) {
  try {
    const userId = requireAuth(req);
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const budget = await db.budget.findFirst({ where: { id, userId } });
    if (!budget) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await db.budget.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
