import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';

/**
 * POST /api/transfer
 * Body: { fromAccountId, toAccountId, amount, currency, date, note }
 *
 * Creates a transfer between two accounts:
 *  1. Records one TRANSFER transaction with accountId=source, toAccountId=destination
 *  2. Updates both account balances (source -= amount, destination += amount)
 *  3. Currency conversion happens automatically if accounts have different currencies
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fromAccountId, toAccountId, amount, currency, date, note } = body;

    if (!fromAccountId || !toAccountId || !amount || fromAccountId === toAccountId) {
      return NextResponse.json(
        { error: 'fromAccountId, toAccountId, amount are required and must be different' },
        { status: 400 }
      );
    }

    const amt = Number(amount);
    if (amt <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    // Get both accounts
    const [sourceAccount, destAccount] = await Promise.all([
      db.account.findUnique({ where: { id: fromAccountId } }),
      db.account.findUnique({ where: { id: toAccountId } }),
    ]);

    if (!sourceAccount) return NextResponse.json({ error: 'Source account not found' }, { status: 404 });
    if (!destAccount) return NextResponse.json({ error: 'Destination account not found' }, { status: 404 });

    // Currency conversion
    const txCurrency = (currency || sourceAccount.currency) as Currency;
    const sourceAmountInSourceCur =
      txCurrency === sourceAccount.currency
        ? amt
        : convert(amt, txCurrency, sourceAccount.currency as Currency);
    const destAmountInDestCur =
      txCurrency === destAccount.currency
        ? amt
        : convert(amt, txCurrency, destAccount.currency as Currency);

    // Update account balances
    await db.account.update({
      where: { id: fromAccountId },
      data: { balance: sourceAccount.balance - sourceAmountInSourceCur },
    });
    await db.account.update({
      where: { id: toAccountId },
      data: { balance: destAccount.balance + destAmountInDestCur },
    });

    // Get or create the "تحويلات" category for transfers
    let transferCat = await db.category.findFirst({
      where: { nameAr: 'تحويلات', type: 'TRANSFER' as any },
    });
    if (!transferCat) {
      // Fall back to existing "تحويلات" or create new
      transferCat = await db.category.findFirst({ where: { nameAr: 'تحويلات' } });
      if (!transferCat) {
        transferCat = await db.category.create({
          data: {
            nameAr: 'تحويلات',
            nameEn: 'Transfers',
            type: 'EXPENSE' as any, // Will be unused since tx type is TRANSFER
            icon: 'arrow-right-left',
            color: '#64748B',
          },
        });
      }
    }

    // Create ONE transfer transaction
    const transfer = await db.transaction.create({
      data: {
        type: 'TRANSFER' as any,
        amount: amt,
        currency: txCurrency,
        accountId: fromAccountId,
        categoryId: transferCat.id,
        toAccountId: toAccountId,
        date: date ? new Date(date) : new Date(),
        note: note || `تحويل من ${sourceAccount.name} إلى ${destAccount.name}`,
      },
      include: {
        account: true,
        category: true,
        toAccount: true,
      },
    });

    return NextResponse.json({ data: transfer });
  } catch (err: any) {
    console.error('Transfer error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
