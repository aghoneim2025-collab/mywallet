import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';

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

    // revert old balance (حوّل المبلغ القديم لعملة الحساب القديم)
    const oldAccount = await db.account.findUnique({ where: { id: existing.accountId } });
    if (oldAccount) {
      const oldAmountInAcc =
        existing.currency === oldAccount.currency
          ? existing.amount
          : convert(existing.amount, existing.currency as Currency, oldAccount.currency as Currency);
      const oldDelta = existing.type === 'INCOME' ? -oldAmountInAcc : oldAmountInAcc;
      await db.account.update({
        where: { id: existing.accountId },
        data: { balance: oldAccount.balance + oldDelta },
      });
    }

    // القيم الجديدة
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body;
    const newType = type || existing.type;
    const newAmount = Number(amount ?? existing.amount);
    const newAccount = await db.account.findUnique({ where: { id: accountId || existing.accountId } });
    if (!newAccount) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const newTxCurrency = (currency || existing.currency) as Currency;
    const newAmountInAcc =
      newTxCurrency === newAccount.currency
        ? newAmount
        : convert(newAmount, newTxCurrency, newAccount.currency as Currency);

    const newDelta = newType === 'INCOME' ? newAmountInAcc : -newAmountInAcc;
    await db.account.update({
      where: { id: newAccount.id },
      data: { balance: newAccount.balance + newDelta },
    });

    const updated = await db.transaction.update({
      where: { id },
      data: {
        type: newType,
        amount: newAmount,                       // ← المبلغ الأصلي بعملته الجديدة
        currency: newTxCurrency,                // ← العملة الأصلية
        accountId: newAccount.id,
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

    // revert balance (حوّل المبلغ لعملة الحساب)
    const account = await db.account.findUnique({ where: { id: existing.accountId } });
    if (account) {
      const amountInAcc =
        existing.currency === account.currency
          ? existing.amount
          : convert(existing.amount, existing.currency as Currency, account.currency as Currency);
      const delta = existing.type === 'INCOME' ? -amountInAcc : amountInAcc;
      await db.account.update({
        where: { id: existing.accountId },
        data: { balance: account.balance + delta },
      });
    }

    await db.transaction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
