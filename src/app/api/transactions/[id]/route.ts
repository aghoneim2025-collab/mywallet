import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import { parseMoney, isCurrency, badRequest } from '@/lib/validate';

// P0.12 fixes:
//   - Use the snapshot fields (sourceAmount, destAmount, exchangeRateUsed)
//     for reversal — re-running convert() with CURRENT rates was wrong.
//   - Validate input (NaN/Infinity, currency enum).
//   - Add userId filter when reading the old account (was: IDOR risk).

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    const t = await db.transaction.findFirst({ where: { id, userId }, include: { account: true, category: true, toAccount: true } });
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: t });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    // Include account + toAccount so we can check currency mismatch for P0.14
    const existing = await db.transaction.findFirst({
      where: { id, userId },
      include: { account: true, toAccount: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // REJECT editing TRANSFER via this route
    if (existing.type === 'TRANSFER' as any) {
      return NextResponse.json({ error: 'Cannot edit transfer. Delete and recreate.' }, { status: 400 });
    }

    // P0.14: Validate that the legacy transaction CAN be safely reversed.
    // If snapshot is null AND the transaction's currency differs from the
    // account's currency, we cannot reverse safely (we don't know the
    // historical exchange rate). REJECT the operation — do NOT silently
    // use raw amount (would corrupt account balance).
    if (
      (existing.sourceAmount === null || existing.sourceAmount === undefined) &&
      existing.currency !== existing.account?.currency
    ) {
      return NextResponse.json(
        {
          error: `Cannot edit this legacy multi-currency transaction (id=${id}): ` +
            `the original exchange rate snapshot is missing, so reversal would ` +
            `be unsafe. Please delete this transaction and recreate it, or ` +
            `manually adjust the account balance instead.`,
        },
        { status: 400 },
      );
    }
    // Also check for legacy TRANSFER with null destAmount where destination
    // currency differs from source.
    if (
      existing.toAccountId &&
      (existing.destAmount === null || existing.destAmount === undefined) &&
      existing.toAccount &&
      existing.currency !== existing.toAccount.currency
    ) {
      return NextResponse.json(
        {
          error: `Cannot edit this legacy multi-currency transfer (id=${id}): ` +
            `the destination exchange rate snapshot is missing. ` +
            `Please delete and recreate.`,
        },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body || {};
    const newType = type || existing.type;
    if (newType !== 'EXPENSE' && newType !== 'INCOME') {
      return badRequest('Type must be EXPENSE or INCOME');
    }
    // P0.11: validate amount via parseMoney
    const amtResult = parseMoney(amount ?? existing.amount, { allowZero: false, allowNegative: false });
    if (!amtResult.ok) return badRequest(amtResult.error);
    const newAmount = amtResult.value;
    if (currency !== undefined && !isCurrency(currency)) {
      return badRequest('Invalid currency');
    }

    // Verify BOTH account AND category ownership (IDOR defense)
    const newAccountId = accountId || existing.accountId;
    const newCategoryId = categoryId || existing.categoryId;
    const [newAccount, newCategory] = await Promise.all([
      db.account.findFirst({ where: { id: newAccountId, userId } }),
      db.category.findFirst({ where: { id: newCategoryId, userId } }),
    ]);
    if (!newAccount) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (!newCategory) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    if (newCategory.type !== newType) {
      return badRequest('Category type mismatch');
    }

    const newTxCurrency: Currency = currency || existing.currency;
    const newAmountInAcc = newTxCurrency === newAccount.currency
      ? newAmount : convert(newAmount, newTxCurrency, newAccount.currency);
    const newDelta = newType === 'INCOME' ? newAmountInAcc : -newAmountInAcc;
    if (!Number.isFinite(newDelta)) return badRequest('Currency conversion failed');
    const newExchangeRateUsed = newTxCurrency === newAccount.currency ? null : (newAmountInAcc / newAmount);

    // ATOMIC: reverse old (using snapshot, NOT re-convert) + apply new
    const updated = await db.$transaction(async (tx) => {
      // P0.13/P0.14: snapshot fields are required for idempotent reversal.
      // For same-currency transactions, snapshot = amount (always recoverable).
      // For multi-currency transactions, snapshot is the EXACT amount applied
      // at create time — without it, we'd have to re-convert with CURRENT
      // rates, which would be wrong if rates changed between create and edit.
      //
      // P0.14 fix: the legacy fallback was previously logging a warning
      // and using raw `amount` — which is wrong for multi-currency txns.
      // Now the PUT handler REJECTS multi-currency legacy txns above (before
      // reaching this $transaction). So here, we only handle:
      //   (1) txns WITH snapshot → use snapshot (correct path)
      //   (2) txns WITHOUT snapshot but where currency === account.currency
      //       (snapshot = amount, no conversion needed)
      const reverseAmount = (() => {
        if (existing.sourceAmount !== null && existing.sourceAmount !== undefined) {
          return existing.sourceAmount;  // correct path
        }
        // Reaching here means snapshot is null BUT currency === account.currency
        // (the multi-currency case was rejected above). For same-currency,
        // snapshot = amount, so this is safe.
        return existing.amount;
      })();
      const oldDelta = existing.type === 'INCOME' ? -reverseAmount : reverseAmount;
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: oldDelta } },
      });
      // Apply new (with fresh snapshot)
      await tx.account.update({ where: { id: newAccount.id }, data: { balance: { increment: newDelta } } });
      return tx.transaction.update({
        where: { id },
        data: {
          type: newType, amount: newAmount, currency: newTxCurrency,
          accountId: newAccount.id, categoryId: newCategory.id,
          date: date ? new Date(date) : existing.date,
          note: note !== undefined ? (note ? String(note).slice(0, 500) : null) : existing.note,
          tags: tags !== undefined ? (tags ? String(tags).slice(0, 200) : null) : existing.tags,
          // P0.12: refresh snapshot fields
          sourceAmount: newAmountInAcc,
          destAmount: null,
          exchangeRateUsed: newExchangeRateUsed,
        },
        include: { account: true, category: true, toAccount: true },
      });
    });
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    // Include account + toAccount so we can check currency mismatch
    const existing = await db.transaction.findFirst({
      where: { id, userId },
      include: { account: true, toAccount: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // P0.14: REJECT deletion of legacy multi-currency transactions without snapshot.
    // Using raw `amount` would silently corrupt the account balance.
    // See the matching check in PUT above.
    if (
      (existing.sourceAmount === null || existing.sourceAmount === undefined) &&
      existing.account &&
      existing.currency !== existing.account.currency
    ) {
      return NextResponse.json(
        {
          error: `Cannot delete this legacy multi-currency transaction (id=${id}): ` +
            `the original exchange rate snapshot is missing, so reversal would ` +
            `be unsafe. Please manually adjust the account balance, or contact support.`,
        },
        { status: 400 },
      );
    }
    // Also check transfer destination
    if (
      existing.toAccountId &&
      (existing.destAmount === null || existing.destAmount === undefined) &&
      existing.toAccount &&
      existing.currency !== existing.toAccount.currency
    ) {
      return NextResponse.json(
        {
          error: `Cannot delete this legacy multi-currency transfer (id=${id}): ` +
            `the destination exchange rate snapshot is missing. ` +
            `Please manually adjust the destination account balance.`,
        },
        { status: 400 },
      );
    }

    if (existing.type === 'TRANSFER' as any && existing.toAccountId) {
      // ATOMIC: reverse both accounts using snapshot (or same-currency fallback)
      await db.$transaction(async (tx) => {
        const [src, dst] = await Promise.all([
          tx.account.findFirst({ where: { id: existing.accountId, userId } }),
          tx.account.findFirst({ where: { id: existing.toAccountId!, userId } }),
        ]);
        // P0.14: multi-currency null-snapshot case was rejected above.
        // Here we either have a snapshot, OR it's a same-currency txn
        // (snapshot = amount).
        const srcAmount = existing.sourceAmount ?? existing.amount;
        const dstAmount = existing.destAmount ?? existing.amount;
        if (src) {
          await tx.account.update({ where: { id: src.id }, data: { balance: { increment: srcAmount } } });
        }
        if (dst) {
          await tx.account.update({ where: { id: dst.id }, data: { balance: { increment: -dstAmount } } });
        }
        await tx.transaction.delete({ where: { id } });
      });
      return NextResponse.json({ success: true });
    }

    // Normal: ATOMIC reverse (using snapshot, or same-currency fallback) + delete
    await db.$transaction(async (tx) => {
      const acc = await tx.account.findFirst({ where: { id: existing.accountId, userId } });
      if (acc) {
        // P0.14: snapshot OR same-currency fallback (multi-currency null
        // was rejected above).
        const reverseAmount = existing.sourceAmount ?? existing.amount;
        const delta = existing.type === 'INCOME' ? -reverseAmount : reverseAmount;
        await tx.account.update({ where: { id: acc.id }, data: { balance: { increment: delta } } });
      }
      await tx.transaction.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
