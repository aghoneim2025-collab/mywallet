import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';
import { requireAuth } from '@/lib/auth';

// GET /api/transactions/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    const t = await db.transaction.findFirst({
      where: { id, userId },
      include: { account: true, category: true, toAccount: true },
    });
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: t });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/transactions/:id - edit (ATOMIC with $transaction)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    const body = await req.json();

    // Find existing (verify ownership)
    const existing = await db.transaction.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { type, amount, currency, accountId, categoryId, date, note, tags } = body;
    const newType = type || existing.type;
    const newAmount = Number(amount ?? existing.amount);
    const newAccount = await db.account.findFirst({ where: { id: accountId || existing.accountId, userId } });
    if (!newAccount) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const newTxCurrency = (currency || existing.currency) as Currency;
    const newAmountInAcc =
      newTxCurrency === newAccount.currency
        ? newAmount
        : convert(newAmount, newTxCurrency, newAccount.currency as Currency);
    const newDelta = newType === 'INCOME' ? newAmountInAcc : -newAmountInAcc;

    // ATOMIC: reverse old + apply new
    const updated = await db.$transaction(async (tx) => {
      // Reverse old balance
      const oldAccount = await tx.account.findUnique({ where: { id: existing.accountId } });
      if (oldAccount) {
        const oldAmountInAcc =
          existing.currency === oldAccount.currency
            ? existing.amount
            : convert(existing.amount, existing.currency as Currency, oldAccount.currency as Currency);
        const oldDelta = existing.type === 'INCOME' ? -oldAmountInAcc : oldAmountInAcc;
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { increment: oldDelta } },
        });
      }

      // Apply new balance
      await tx.account.update({
        where: { id: newAccount.id },
        data: { balance: { increment: newDelta } },
      });

      // Update transaction
      return tx.transaction.update({
        where: { id },
        data: {
          type: newType,
          amount: newAmount,
          currency: newTxCurrency,
          accountId: newAccount.id,
          categoryId: categoryId || existing.categoryId,
          date: date ? new Date(date) : existing.date,
          note: note !== undefined ? note : existing.note,
          tags: tags !== undefined ? tags : existing.tags,
        },
        include: { account: true, category: true, toAccount: true },
      });
    });

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/transactions/:id - ATOMIC
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    const existing = await db.transaction.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Handle TRANSFER: reverse both accounts
    if (existing.type === 'TRANSFER' as any && existing.toAccountId) {
      await db.$transaction(async (tx) => {
        const [sourceAcc, destAcc] = await Promise.all([
          tx.account.findFirst({ where: { id: existing.accountId, userId } }),
          tx.account.findFirst({ where: { id: existing.toAccountId!, userId } }),
        ]);

        if (sourceAcc) {
          const amt = existing.currency === sourceAcc.currency
            ? existing.amount
            : convert(existing.amount, existing.currency as Currency, sourceAcc.currency as Currency);
          await tx.account.update({ where: { id: sourceAcc.id }, data: { balance: { increment: amt } } });
        }
        if (destAcc) {
          const amt = existing.currency === destAcc.currency
            ? existing.amount
            : convert(existing.amount, existing.currency as Currency, destAcc.currency as Currency);
          await tx.account.update({ where: { id: destAcc.id }, data: { balance: { increment: -amt } } });
        }
        await tx.transaction.delete({ where: { id } });
      });
      return NextResponse.json({ success: true });
    }

    // Normal expense/income: ATOMIC reverse + delete
    await db.$transaction(async (tx) => {
      const account = await tx.account.findFirst({ where: { id: existing.accountId, userId } });
      if (account) {
        const amt = existing.currency === account.currency
          ? existing.amount
          : convert(existing.amount, existing.currency as Currency, account.currency as Currency);
        const delta = existing.type === 'INCOME' ? -amt : amt;
        await tx.account.update({ where: { id: account.id }, data: { balance: { increment: delta } } });
      }
      await tx.transaction.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
