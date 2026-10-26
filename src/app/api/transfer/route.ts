import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import { parseMoney, isCurrency, parseString, badRequest } from '@/lib/validate';

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { fromAccountId, toAccountId, amount, currency, date, note } = body || {};

    // P0.11: validate inputs first. Catches NaN/Infinity/missing/null.
    if (typeof fromAccountId !== 'string' || fromAccountId.length < 10) {
      return badRequest('Invalid fromAccountId');
    }
    if (typeof toAccountId !== 'string' || toAccountId.length < 10) {
      return badRequest('Invalid toAccountId');
    }
    if (fromAccountId === toAccountId) {
      return badRequest('Cannot transfer to the same account');
    }
    const amtResult = parseMoney(amount, { allowZero: false, allowNegative: false });
    if (!amtResult.ok) return badRequest(amtResult.error);
    const amt = amtResult.value;

    // P0.11: validate currency enum (was: `(currency || ...) as Currency`)
    if (currency !== undefined && !isCurrency(currency)) {
      return badRequest('Invalid currency (must be EGP, SAR, USD, EUR, or AED)');
    }

    // P0.11: validate note length (was: no limit)
    if (note !== undefined && note !== null) {
      const noteResult = parseString(note, 'Note', { required: false, max: 500 });
      if (!noteResult.ok) return badRequest(noteResult.error);
    }

    // Verify both accounts belong to user (findFirst with userId — IDOR defense)
    const [sourceAccount, destAccount] = await Promise.all([
      db.account.findFirst({ where: { id: fromAccountId, userId } }),
      db.account.findFirst({ where: { id: toAccountId, userId } }),
    ]);
    if (!sourceAccount) return NextResponse.json({ error: 'Source account not found' }, { status: 404 });
    if (!destAccount) return NextResponse.json({ error: 'Destination account not found' }, { status: 404 });

    const txCurrency: Currency = currency || sourceAccount.currency;
    const sourceAmount = txCurrency === sourceAccount.currency
      ? amt : convert(amt, txCurrency, sourceAccount.currency);
    const destAmount = txCurrency === destAccount.currency
      ? amt : convert(amt, txCurrency, destAccount.currency);

    // P0.11: sanity check on converted amounts (NaN/Infinity can come from convert())
    if (!Number.isFinite(sourceAmount) || !Number.isFinite(destAmount)) {
      return badRequest('Currency conversion failed (invalid rate?)');
    }

    // P0.11: optional overdraft check (skip for LOAN accounts — they're meant to go negative)
    if (sourceAccount.type !== 'LOAN' && sourceAccount.balance < sourceAmount) {
      return NextResponse.json(
        { error: `Insufficient balance in source account (have ${sourceAccount.balance}, need ${sourceAmount})` },
        { status: 400 },
      );
    }

    // ATOMIC: find-or-create transfer category + update balances + create transaction
    // P0.11: moved category lookup inside $transaction to close the race
    // (two concurrent transfers could both pass findFirst → both create → duplicate cats)
    const transfer = await db.$transaction(async (tx) => {
      let transferCat = await tx.category.findFirst({
        where: { nameAr: 'تحويلات', userId, type: 'TRANSFER' as any },
      });
      if (!transferCat) {
        transferCat = await tx.category.create({
          data: {
            nameAr: 'تحويلات', nameEn: 'Transfers', type: 'TRANSFER' as any,
            icon: 'arrow-right-left', color: '#64748B', userId,
          },
        });
      }

      await tx.account.update({
        where: { id: fromAccountId },
        data: { balance: { increment: -sourceAmount } },
      });
      await tx.account.update({
        where: { id: toAccountId },
        data: { balance: { increment: destAmount } },
      });

      return tx.transaction.create({
        data: {
          type: 'TRANSFER' as any,
          amount: amt,
          currency: txCurrency,
          accountId: fromAccountId,
          categoryId: transferCat.id,
          toAccountId,
          userId,
          date: date ? new Date(date) : new Date(),
          note: note || `تحويل من ${sourceAccount.name} إلى ${destAccount.name}`,
        },
        include: { account: true, category: true, toAccount: true },
      });
    });

    return NextResponse.json({ data: transfer });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
