import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';
import { requireAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const userId = requireAuth(req);
    const body = await req.json();
    const { fromAccountId, toAccountId, amount, currency, date, note } = body;

    if (!fromAccountId || !toAccountId || !amount || fromAccountId === toAccountId) {
      return NextResponse.json({ error: 'Invalid transfer parameters' }, { status: 400 });
    }

    const amt = Number(amount);
    if (amt <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });

    // Verify both accounts belong to user
    const [sourceAccount, destAccount] = await Promise.all([
      db.account.findFirst({ where: { id: fromAccountId, userId } }),
      db.account.findFirst({ where: { id: toAccountId, userId } }),
    ]);
    if (!sourceAccount) return NextResponse.json({ error: 'Source account not found' }, { status: 404 });
    if (!destAccount) return NextResponse.json({ error: 'Destination account not found' }, { status: 404 });

    const txCurrency = (currency || sourceAccount.currency) as Currency;
    const sourceAmount = txCurrency === sourceAccount.currency
      ? amt : convert(amt, txCurrency, sourceAccount.currency as Currency);
    const destAmount = txCurrency === destAccount.currency
      ? amt : convert(amt, txCurrency, destAccount.currency as Currency);

    // ATOMIC: update both balances + create transaction
    let transferCat = await db.category.findFirst({ where: { nameAr: 'تحويلات', userId } });
    if (!transferCat) {
      transferCat = await db.category.create({
        data: { nameAr: 'تحويلات', nameEn: 'Transfers', type: 'EXPENSE', icon: 'arrow-right-left', color: '#64748B', userId },
      });
    }

    const transfer = await db.$transaction(async (tx) => {
      await tx.account.update({ where: { id: fromAccountId }, data: { balance: { increment: -sourceAmount } } });
      await tx.account.update({ where: { id: toAccountId }, data: { balance: { increment: destAmount } } });

      return tx.transaction.create({
        data: {
          type: 'TRANSFER' as any,
          amount: amt,
          currency: txCurrency,
          accountId: fromAccountId,
          categoryId: transferCat!.id,
          toAccountId: toAccountId,
          userId,
          date: date ? new Date(date) : new Date(),
          note: note || `تحويل من ${sourceAccount.name} إلى ${destAccount.name}`,
        },
        include: { account: true, category: true, toAccount: true },
      });
    });

    return NextResponse.json({ data: transfer });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('Transfer error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
