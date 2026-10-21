import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/transactions/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const t = await db.transaction.findUnique({
      where: { id },
      include: { account: true, category: true },
    });
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: t });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/transactions/:id - تعديل
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const existing = await db.transaction.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const oldDelta = existing.type === 'INCOME' ? -existing.amount : existing.amount;
    await db.account.update({
      where: { id: existing.accountId },
      data: { balance: { increment: oldDelta } },
    });

    const { type, amount, currency, accountId, categoryId, date, note, tags } = body;
    const newType = type || existing.type;
    const newAmount = Number(amount ?? existing.amount);
    const newAccount = accountId || existing.accountId;

    const newDelta = newType === 'INCOME' ? newAmount : -newAmount;
    await db.account.update({
      where: { id: newAccount },
      data: { balance: { increment: newDelta } },
    });

    const updated = await db.transaction.update({
      where: { id },
      data: {
        type: newType,
        amount: newAmount,
        currency: currency || existing.currency,
        accountId: newAccount,
        categoryId: categoryId || existing.categoryId,
        date: date ? new Date(date) : existing.date,
        note: note !== undefined ? note : existing.note,
        tags: tags !== undefined ? tags : existing.tags,
      },
      include: { account: true, category: true },
    });

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/transactions/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.transaction.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const delta = existing.type === 'INCOME' ? -existing.amount : existing.amount;
    await db.account.update({
      where: { id: existing.accountId },
      data: { balance: { increment: delta } },
    });

    await db.transaction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
