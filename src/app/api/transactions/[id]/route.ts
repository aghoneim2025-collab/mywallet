import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    const t = await db.transaction.findFirst({ where: { id, userId }, include: { account: true, category: true, toAccount: true } });
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: t });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    const existing = await db.transaction.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // REJECT editing TRANSFER via this route
    if (existing.type === 'TRANSFER' as any) {
      return NextResponse.json({ error: 'Cannot edit transfer. Delete and recreate.' }, { status: 400 });
    }

    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body;
    const newType = type || existing.type;
    if (!['EXPENSE', 'INCOME'].includes(newType)) {
      return NextResponse.json({ error: 'Type must be EXPENSE or INCOME' }, { status: 400 });
    }
    const newAmount = Number(amount ?? existing.amount);
    if (!newAmount || newAmount <= 0 || !isFinite(newAmount)) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    // Verify BOTH account AND category ownership
    const newAccountId = accountId || existing.accountId;
    const newCategoryId = categoryId || existing.categoryId;
    const [newAccount, newCategory] = await Promise.all([
      db.account.findFirst({ where: { id: newAccountId, userId } }),
      db.category.findFirst({ where: { id: newCategoryId, userId } }),
    ]);
    if (!newAccount) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (!newCategory) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    if (newCategory.type !== newType) {
      return NextResponse.json({ error: 'Category type mismatch' }, { status: 400 });
    }

    const newTxCurrency = (currency || existing.currency) as Currency;
    const newAmountInAcc = newTxCurrency === newAccount.currency
      ? newAmount : convert(newAmount, newTxCurrency, newAccount.currency as Currency);
    const newDelta = newType === 'INCOME' ? newAmountInAcc : -newAmountInAcc;

    // ATOMIC: reverse old + apply new
    const updated = await db.$transaction(async (tx) => {
      // Reverse old
      const oldAcc = await tx.account.findUnique({ where: { id: existing.accountId } });
      if (oldAcc) {
        const oldAmt = existing.currency === oldAcc.currency
          ? existing.amount : convert(existing.amount, existing.currency as Currency, oldAcc.currency as Currency);
        const oldDelta = existing.type === 'INCOME' ? -oldAmt : oldAmt;
        await tx.account.update({ where: { id: existing.accountId }, data: { balance: { increment: oldDelta } } });
      }
      // Apply new
      await tx.account.update({ where: { id: newAccount.id }, data: { balance: { increment: newDelta } } });
      return tx.transaction.update({ where: { id }, data: {
        type: newType, amount: newAmount, currency: newTxCurrency,
        accountId: newAccount.id, categoryId: newCategory.id,
        date: date ? new Date(date) : existing.date,
        note: note !== undefined ? note : existing.note,
        tags: tags !== undefined ? tags : existing.tags,
      }, include: { account: true, category: true, toAccount: true } });
    });
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    const existing = await db.transaction.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (existing.type === 'TRANSFER' as any && existing.toAccountId) {
      // ATOMIC: reverse both accounts
      await db.$transaction(async (tx) => {
        const [src, dst] = await Promise.all([
          tx.account.findFirst({ where: { id: existing.accountId, userId } }),
          tx.account.findFirst({ where: { id: existing.toAccountId!, userId } }),
        ]);
        if (src) {
          const amt = existing.currency === src.currency ? existing.amount
            : convert(existing.amount, existing.currency as Currency, src.currency as Currency);
          await tx.account.update({ where: { id: src.id }, data: { balance: { increment: amt } } });
        }
        if (dst) {
          const amt = existing.currency === dst.currency ? existing.amount
            : convert(existing.amount, existing.currency as Currency, dst.currency as Currency);
          await tx.account.update({ where: { id: dst.id }, data: { balance: { increment: -amt } } });
        }
        await tx.transaction.delete({ where: { id } });
      });
      return NextResponse.json({ success: true });
    }

    // Normal: ATOMIC reverse + delete
    await db.$transaction(async (tx) => {
      const acc = await tx.account.findFirst({ where: { id: existing.accountId, userId } });
      if (acc) {
        const amt = existing.currency === acc.currency ? existing.amount
          : convert(existing.amount, existing.currency as Currency, acc.currency as Currency);
        const delta = existing.type === 'INCOME' ? -amt : amt;
        await tx.account.update({ where: { id: acc.id }, data: { balance: { increment: delta } } });
      }
      await tx.transaction.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
