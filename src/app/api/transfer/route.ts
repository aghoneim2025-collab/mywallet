import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convertServer as convert, type Currency } from '@/lib/currency';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError, ValidationError } from '@/lib/api-errors';
import { parseMoney, isCurrency, parseString, parseDate, badRequest } from '@/lib/validate';

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

    // P0.16: validate date (was: silently producing Invalid Date → 500)
    let parsedDate: Date | undefined;
    if (date !== undefined && date !== null && date !== '') {
      const r = parseDate(date);
      if (!r.ok) return badRequest(`Invalid date: ${r.error}`);
      parsedDate = r.value;
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

    // P0.16: REMOVED the outside-transaction balance check.
    // It was a race condition — concurrent transfers could both pass the
    // check before either deducts → both succeed → balance goes negative.
    // Now the balance check is INSIDE the $transaction below, using a
    // conditional UPDATE (WHERE balance >= sourceAmount) and verifying
    // exactly 1 row affected.

    // ATOMIC: find-or-create transfer category + balance-checked deduction
    // + credit destination + create transaction
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

      // P0.16: atomic balance check + deduction.
      // Skip overdraft check for LOAN accounts (they're allowed to go negative).
      if (sourceAccount.type !== 'LOAN') {
        // Conditional UPDATE: only deduct if balance is sufficient.
        // If exactly 1 row affected → success. If 0 → insufficient (either
        // originally OR because a concurrent transfer drained it between
        // our read and this conditional update).
        const result = await tx.account.updateMany({
          where: { id: fromAccountId, userId, balance: { gte: sourceAmount } },
          data: { balance: { decrement: sourceAmount } },
        });
        if (result.count !== 1) {
          throw new ValidationError(
            `Insufficient balance in source account. Needed ${sourceAmount}, ` +
            `but the balance is now lower (possibly due to a concurrent transfer).`
          );
        }
      } else {
        // LOAN account — just decrement without the balance check
        await tx.account.update({
          where: { id: fromAccountId },
          data: { balance: { decrement: sourceAmount } },
        });
      }

      // Credit the destination (no balance check needed for crediting)
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
          date: parsedDate ?? new Date(),
          note: note || `تحويل من ${sourceAccount.name} إلى ${destAccount.name}`,
          // P0.12: snapshot fields for idempotent reversal
          sourceAmount,
          destAmount,
          exchangeRateUsed: sourceAmount === amt ? null : (sourceAmount / amt),
        },
        include: { account: true, category: true, toAccount: true },
      });
    });

    return NextResponse.json({ data: transfer });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
