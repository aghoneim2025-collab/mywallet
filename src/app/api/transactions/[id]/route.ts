import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convertServer as convert, type Currency } from '@/lib/currency';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError, ValidationError } from '@/lib/api-errors';
import { parseMoney, isCurrency, parseString, parseDate, badRequest } from '@/lib/validate';

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
    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body || {};

    // P0.17: validate body FIRST, outside $transaction.
    // (Validation doesn't touch DB, safe to do before reading existing.)
    if (currency !== undefined && !isCurrency(currency)) {
      return badRequest('Invalid currency');
    }
    // P0.16/P0.17: validate date BEFORE entering $transaction (catch invalid early)
    let parsedDate: Date | undefined;
    if (date !== undefined && date !== null && date !== '') {
      const r = parseDate(date);
      if (!r.ok) return badRequest(`Invalid date: ${r.error}`);
      parsedDate = r.value;
    }
    if (note !== undefined && note !== null) {
      const r = parseString(note, 'Note', { required: false, max: 500 });
      if (!r.ok) return badRequest(r.error);
    }
    if (tags !== undefined && tags !== null) {
      const r = parseString(tags, 'Tags', { required: false, max: 200 });
      if (!r.ok) return badRequest(r.error);
    }

    // P0.17: ENTIRE PUT is now inside a single $transaction.
    // Previously, the existing record was read OUTSIDE the $transaction,
    // then the snapshot was reversed inside. Two concurrent PUTs could
    // both read the same `existing` → both reverse the old balance →
    // double-reversal (silent corruption).
    //
    // Now: read inside $transaction → reverse old → apply new → update txn.
    // All atomic. The $transaction holds the write lock for the duration.
    //
    // For extra safety on Postgres, we'd use SELECT FOR UPDATE; SQLite
    // uses serializable transactions which achieves the same.
    //
    // P0.17: optimistic locking — capture updatedAt before writes,
    // verify it hasn't changed before the update. If 0 rows updated →
    // concurrent modification → throw → $transaction rolls back.
    const updated = await db.$transaction(async (tx) => {
      // Read INSIDE the transaction
      const existing = await tx.transaction.findFirst({
        where: { id, userId },
        include: { account: true, toAccount: true },
      });
      if (!existing) throw new ValidationError('Not found');

      // REJECT editing TRANSFER via this route
      // P0.17: updated message — was "delete and recreate" but DELETE for
      // legacy multi-currency transfer may need ?force=true path.
      if (existing.type === 'TRANSFER' as any) {
        const isLegacyMultiCurrency = (
          existing.sourceAmount === null &&
          existing.account && existing.currency !== existing.account.currency
        );
        throw new ValidationError(
          'Cannot edit transfer via this route. To delete: ' +
          (isLegacyMultiCurrency
            ? `this is a legacy multi-currency transfer — manually adjust both account balances via PUT /api/accounts/[id], then DELETE /api/transactions/${id}?force=true`
            : `DELETE /api/transactions/${id} (will reverse both balances automatically)`)
        );
      }

      // P0.14: REJECT legacy multi-currency transactions without snapshot.
      if (
        (existing.sourceAmount === null || existing.sourceAmount === undefined) &&
        existing.currency !== existing.account?.currency
      ) {
        throw new ValidationError(
          `Cannot edit this legacy multi-currency transaction (id=${id}): ` +
            `the original exchange rate snapshot is missing, so reversal would ` +
            `be unsafe. To resolve: (a) manually adjust the account balance via ` +
            `PUT /api/accounts/${existing.accountId} to undo the transaction's effect, ` +
            `then DELETE /api/transactions/${id}?force=true to remove the record ` +
            `without balance reversal. Or (b) contact support.`
        );
      }
      if (
        existing.toAccountId &&
        (existing.destAmount === null || existing.destAmount === undefined) &&
        existing.toAccount &&
        existing.currency !== existing.toAccount.currency
      ) {
        throw new ValidationError(
          `Cannot edit this legacy multi-currency transfer (id=${id}): ` +
            `the destination exchange rate snapshot is missing. ` +
            `Same recovery path: manually adjust the destination account balance, ` +
            `then DELETE ?force=true.`
        );
      }

      const realNewType = type || existing.type;
      if (realNewType !== 'EXPENSE' && realNewType !== 'INCOME') {
        throw new ValidationError('Type must be EXPENSE or INCOME');
      }
      const amtResult = parseMoney(amount ?? existing.amount, { allowZero: false, allowNegative: false });
      if (!amtResult.ok) throw new ValidationError(amtResult.error);
      const newAmount = amtResult.value;

      const newAccountId = accountId || existing.accountId;
      const newCategoryId = categoryId || existing.categoryId;
      const [newAccount, newCategory] = await Promise.all([
        tx.account.findFirst({ where: { id: newAccountId, userId } }),
        tx.category.findFirst({ where: { id: newCategoryId, userId } }),
      ]);
      if (!newAccount) throw new ValidationError('Account not found');
      if (!newCategory) throw new ValidationError('Category not found');
      if (newCategory.type !== realNewType) {
        throw new ValidationError('Category type mismatch');
      }

      const realNewTxCurrency: Currency = currency || existing.currency;
      const newAmountInAcc = realNewTxCurrency === newAccount.currency
        ? newAmount : convert(newAmount, realNewTxCurrency, newAccount.currency);
      const newDelta = realNewType === 'INCOME' ? newAmountInAcc : -newAmountInAcc;
      if (!Number.isFinite(newDelta)) throw new ValidationError('Currency conversion failed');
      const newExchangeRateUsed = realNewTxCurrency === newAccount.currency ? null : (newAmountInAcc / newAmount);

      // P0.17: optimistic locking — capture updatedAt before writes.
      const existingUpdatedAt = existing.updatedAt;

      // Reverse old (using snapshot, OR same-currency fallback)
      const reverseAmount = existing.sourceAmount ?? existing.amount;
      const oldDelta = existing.type === 'INCOME' ? -reverseAmount : reverseAmount;
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: oldDelta } },
      });
      // Apply new (with fresh snapshot)
      await tx.account.update({
        where: { id: newAccount.id },
        data: { balance: { increment: newDelta } },
      });
      // P0.17: optimistic lock — only update if record wasn't modified
      // since we read it. If 0 rows updated → concurrent PUT → roll back.
      const result = await tx.transaction.updateMany({
        where: { id, updatedAt: existingUpdatedAt },
        data: {
          type: realNewType, amount: newAmount, currency: realNewTxCurrency,
          accountId: newAccount.id, categoryId: newCategory.id,
          date: parsedDate ?? existing.date,
          note: note !== undefined ? (note ? String(note).slice(0, 500) : null) : existing.note,
          tags: tags !== undefined ? (tags ? String(tags).slice(0, 200) : null) : existing.tags,
          sourceAmount: newAmountInAcc,
          destAmount: null,
          exchangeRateUsed: newExchangeRateUsed,
        },
      });
      if (result.count === 0) {
        // 0 rows updated → another request modified the transaction
        // between our read and write. $transaction will roll back.
        throw new ValidationError(
          'This transaction was modified by another request. Please reload and retry.'
        );
      }
      // Return the updated record
      return tx.transaction.findFirst({
        where: { id },
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
    // P0.15/P0.16: ?force=true skips the snapshot check + balance reversal.
    // P0.16 fix: force is now SCOPED — only allowed when the transaction
    // has a missing snapshot that would prevent safe reversal (the legacy
    // multi-currency case). For normal transactions WITH snapshots, force
    // is REJECTED — those must go through the proper reversal path.
    const url = new URL(req.url);
    const forceRequested = url.searchParams.get('force') === 'true';

    // Include account + toAccount so we can check currency mismatch
    const existing = await db.transaction.findFirst({
      where: { id, userId },
      include: { account: true, toAccount: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Determine if this transaction needs the force path (legacy multi-currency without snapshot)
    const needsForceForLegacy = (
      (existing.sourceAmount === null || existing.sourceAmount === undefined) &&
      existing.account &&
      existing.currency !== existing.account.currency
    ) || (
      existing.toAccountId &&
      (existing.destAmount === null || existing.destAmount === undefined) &&
      existing.toAccount &&
      existing.currency !== existing.toAccount.currency
    );

    // P0.16: if user requests force but the transaction doesn't need it,
    // REJECT — force is only for the legacy multi-currency recovery path.
    if (forceRequested && !needsForceForLegacy) {
      return NextResponse.json(
        {
          error: `?force=true is only allowed for legacy multi-currency transactions ` +
            `with missing snapshot fields. This transaction (id=${id}) has valid ` +
            `snapshots and must be deleted through the normal reversal path ` +
            `(without ?force=true).`,
        },
        { status: 400 },
      );
    }

    // P0.14/P0.15: REJECT deletion of legacy multi-currency transactions
    // without snapshot — UNLESS ?force=true is set (user has manually
    // reconciled the balance).
    if (
      !forceRequested &&
      (existing.sourceAmount === null || existing.sourceAmount === undefined) &&
      existing.account &&
      existing.currency !== existing.account.currency
    ) {
      return NextResponse.json(
        {
          error: `Cannot delete this legacy multi-currency transaction (id=${id}): ` +
            `the original exchange rate snapshot is missing, so reversal would ` +
            `be unsafe. To resolve: (a) manually adjust the account balance via ` +
            `PUT /api/accounts/${existing.accountId} to undo the transaction's effect, ` +
            `then DELETE /api/transactions/${id}?force=true to remove the record ` +
            `without balance reversal. Or (b) contact support.`,
        },
        { status: 400 },
      );
    }
    // Also check transfer destination
    if (
      !forceRequested &&
      existing.toAccountId &&
      (existing.destAmount === null || existing.destAmount === undefined) &&
      existing.toAccount &&
      existing.currency !== existing.toAccount.currency
    ) {
      return NextResponse.json(
        {
          error: `Cannot delete this legacy multi-currency transfer (id=${id}): ` +
            `the destination exchange rate snapshot is missing. ` +
            `Same recovery path: manually adjust the destination account balance, ` +
            `then DELETE ?force=true.`,
        },
        { status: 400 },
      );
    }

    // If force=true (and we've verified above that the transaction needs it),
    // skip ALL balance reversal — just delete the record.
    if (forceRequested) {
      await db.transaction.delete({ where: { id } });
      return NextResponse.json({
        success: true,
        warning: 'Transaction deleted WITHOUT balance reversal. ' +
          'You are responsible for ensuring the account balance was manually adjusted.',
      });
    }

    if (existing.type === 'TRANSFER' as any && existing.toAccountId) {
      // ATOMIC: reverse both accounts using snapshot (or same-currency fallback)
      // P0.16: if source or dest account is missing, THROW inside the
      // transaction — don't silently delete the transaction record.
      await db.$transaction(async (tx) => {
        const [src, dst] = await Promise.all([
          tx.account.findFirst({ where: { id: existing.accountId, userId } }),
          tx.account.findFirst({ where: { id: existing.toAccountId!, userId } }),
        ]);
        // P0.16: missing account → throw, don't silently delete
        if (!src) {
          throw new ValidationError(`Cannot delete: source account ${existing.accountId} not found. ` +
            `The transaction record will NOT be deleted — please reconcile manually.`);
        }
        if (!dst) {
          throw new ValidationError(`Cannot delete: destination account ${existing.toAccountId} not found. ` +
            `The transaction record will NOT be deleted — please reconcile manually.`);
        }
        // P0.14: multi-currency null-snapshot case was rejected above (unless ?force=true).
        const srcAmount = existing.sourceAmount ?? existing.amount;
        const dstAmount = existing.destAmount ?? existing.amount;
        await tx.account.update({ where: { id: src.id }, data: { balance: { increment: srcAmount } } });
        await tx.account.update({ where: { id: dst.id }, data: { balance: { increment: -dstAmount } } });
        await tx.transaction.delete({ where: { id } });
      });
      return NextResponse.json({ success: true });
    }

    // Normal: ATOMIC reverse (using snapshot, or same-currency fallback) + delete
    // P0.16: missing account → throw inside $transaction
    await db.$transaction(async (tx) => {
      const acc = await tx.account.findFirst({ where: { id: existing.accountId, userId } });
      if (!acc) {
        throw new ValidationError(`Cannot delete: account ${existing.accountId} not found. ` +
          `The transaction record will NOT be deleted — please reconcile manually.`);
      }
      const reverseAmount = existing.sourceAmount ?? existing.amount;
      const delta = existing.type === 'INCOME' ? -reverseAmount : reverseAmount;
      await tx.account.update({ where: { id: acc.id }, data: { balance: { increment: delta } } });
      await tx.transaction.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
