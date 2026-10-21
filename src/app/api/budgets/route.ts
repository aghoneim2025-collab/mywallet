import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/budgets?month=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    const where: any = {};
    if (month) where.month = month;

    const budgets = await db.budget.findMany({
      where,
      include: { category: true },
    });

    // اجمع المنصرف الفعلي لكل فئة في الشهر
    const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);

    const spent = await db.transaction.groupBy({
      by: ['categoryId'],
      where: {
        type: 'EXPENSE',
        date: { gte: startOfMonth, lt: endOfMonth },
      },
      _sum: { amount: true },
    });

    const spentMap = new Map(spent.map(s => [s.categoryId, s._sum.amount || 0]));

    return NextResponse.json({
      data: budgets.map(b => ({
        ...b,
        spent: spentMap.get(b.categoryId) || 0,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/budgets
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { categoryId, month, limit, currency } = body;
    if (!categoryId || !month || !limit) {
      return NextResponse.json(
        { error: 'categoryId, month, limit are required' },
        { status: 400 }
      );
    }

    // upsert: لو موجود، حدّث الحد
    const existing = await db.budget.findUnique({
      where: { categoryId_month: { categoryId, month } },
    });

    if (existing) {
      const updated = await db.budget.update({
        where: { id: existing.id },
        data: { limit: Number(limit), currency: currency || existing.currency },
        include: { category: true },
      });
      return NextResponse.json({ data: updated });
    }

    const created = await db.budget.create({
      data: { categoryId, month, limit: Number(limit), currency: currency || 'EGP' },
      include: { category: true },
    });
    return NextResponse.json({ data: created });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/budgets?categoryId=...&month=YYYY-MM
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await db.budget.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
