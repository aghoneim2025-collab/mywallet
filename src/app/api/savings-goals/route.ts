import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/savings-goals
export async function GET() {
  const goals = await db.savingsGoal.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ data: goals });
}

// POST /api/savings-goals
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, targetAmount, currentAmount, currency, targetDate, color, icon } = body;
    if (!name || !targetAmount) {
      return NextResponse.json({ error: 'name and targetAmount required' }, { status: 400 });
    }
    const goal = await db.savingsGoal.create({
      data: {
        name, targetAmount: Number(targetAmount),
        currentAmount: Number(currentAmount) || 0,
        currency: currency || 'EGP',
        targetDate: targetDate ? new Date(targetDate) : null,
        color: color || '#10B981', icon: icon || 'piggy-bank',
      },
    });
    return NextResponse.json({ data: goal });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/savings-goals?id=... (update progress)
export async function PUT(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const body = await req.json();
    const { currentAmount, name, targetAmount } = body;
    const updated = await db.savingsGoal.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(targetAmount !== undefined ? { targetAmount: Number(targetAmount) } : {}),
        ...(currentAmount !== undefined ? {
          currentAmount: Number(currentAmount),
          achieved: Number(currentAmount) >= (await db.savingsGoal.findUnique({ where: { id } }))?.targetAmount,
        } : {}),
      },
    });
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/savings-goals?id=...
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.savingsGoal.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
