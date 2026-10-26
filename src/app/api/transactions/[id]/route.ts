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
    const existing = await db.transaction.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // REJECT editing TRANSFER via this route
    if (existing.type === 'TRANSFER' as any) {
      return NextResponse.json({ error: 'Cannot edit transfer. Delete and recreate.' }, { status: 400 });
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
      // P0.13: snapshot fields are required for idempotent reversal.
      // Pre-P0.12 transactions have null sourceAmount — we CANNOT
      // safely reverse them using current rates (could be wrong).
      // Instead of silently using a wrong amount, we:
      //   (1) Try the snapshot (correct path).
      //   (2) If snapshot is null: log a warning + fall back to amount
      //       WITHOUT conversion (only correct if no currency conversion
      //       was originally applied). This is the best we can do without
      //       a backfill.
      //   (3) TODO: write a backfill script to populate snapshots for
      //       all legacy transactions using current rates.
      const reverseAmount = (() => {
        if (existing.sourceAmount !== null && existing.sourceAmount !== undefined) {
          // Correct path: use snapshot
          return existing.sourceAmount;
        }
        // Legacy fallback: use raw amount (no conversion). This is only
        // correct if the original transaction had no currency conversion.
        // For transactions WITH conversion, this may produce a wrong
        // account balance — but it's the best we can do without historical
        // rate data. Log a warning so we know which transactions are affected.
        console.warn(
          'transactions/[id] PUT: legacy transaction with null sourceAmount. ' +
          'Falling back to raw amount (may be incorrect if currency conversion was originally applied). ' +
          'Run backfill script to fix.',
          { txId: id, amount: existing.amount, currency: existing.currency }
        );
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
    const existing = await db.transaction.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (existing.type === 'TRANSFER' as any && existing.toAccountId) {
      // ATOMIC: reverse both accounts using snapshot (or legacy fallback with warning)
      await db.$transaction(async (tx) => {
        const [src, dst] = await Promise.all([
          tx.account.findFirst({ where: { id: existing.accountId, userId } }),
          tx.account.findFirst({ where: { id: existing.toAccountId!, userId } }),
        ]);
        // P0.13: use snapshot if available; else log warning + fall back to raw amount
        const srcAmount = existing.sourceAmount ?? (() => {
          console.warn(
            'transactions/[id] DELETE transfer: legacy transaction with null sourceAmount. ' +
            'Falling back to raw amount (may be incorrect if currency conversion was originally applied).',
            { txId: id }
          );
          return existing.amount;
        })();
        const dstAmount = existing.destAmount ?? (() => {
          console.warn(
            'transactions/[id] DELETE transfer: legacy transaction with null destAmount. ' +
            'Falling back to raw amount (may be incorrect if currency conversion was originally applied).',
            { txId: id }
          );
          return existing.amount;
        })();
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

    // Normal: ATOMIC reverse (using snapshot, or legacy fallback with warning) + delete
    await db.$transaction(async (tx) => {
      const acc = await tx.account.findFirst({ where: { id: existing.accountId, userId } });
      if (acc) {
        // P0.13: use snapshot if available; else log warning + fall back to raw amount
        const reverseAmount = existing.sourceAmount ?? (() => {
          console.warn(
            'transactions/[id] DELETE: legacy transaction with null sourceAmount. ' +
            'Falling back to raw amount (may be incorrect if currency conversion was originally applied).',
            { txId: id }
          );
          return existing.amount;
        })();
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
