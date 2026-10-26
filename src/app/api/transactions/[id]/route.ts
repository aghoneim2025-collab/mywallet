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
      // P0.12: use snapshot (sourceAmount) for reversal, not re-convert.
      // This is the whole point of the snapshot fields — reversal is
      // idempotent even if rates changed between create and update.
      if (existing.sourceAmount !== null && existing.sourceAmount !== undefined) {
        const oldDelta = existing.type === 'INCOME' ? -existing.sourceAmount : existing.sourceAmount;
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { increment: oldDelta } },
        });
      } else {
        // Fallback for transactions created before P0.12 snapshot fields existed.
        // Re-convert using CURRENT rates (legacy behavior — may drift if rates changed).
        const oldAcc = await tx.account.findFirst({ where: { id: existing.accountId, userId } });
        if (oldAcc) {
          const oldAmt = existing.currency === oldAcc.currency
            ? existing.amount : convert(existing.amount, existing.currency, oldAcc.currency);
          const oldDelta = existing.type === 'INCOME' ? -oldAmt : oldAmt;
          await tx.account.update({ where: { id: existing.accountId }, data: { balance: { increment: oldDelta } } });
        }
      }
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
      // ATOMIC: reverse both accounts using snapshot
      await db.$transaction(async (tx) => {
        const [src, dst] = await Promise.all([
          tx.account.findFirst({ where: { id: existing.accountId, userId } }),
          tx.account.findFirst({ where: { id: existing.toAccountId!, userId } }),
        ]);
        if (src) {
          // P0.12: use snapshot
          const amt = existing.sourceAmount ?? existing.amount;
          await tx.account.update({ where: { id: src.id }, data: { balance: { increment: amt } } });
        }
        if (dst) {
          // P0.12: use snapshot
          const amt = existing.destAmount ?? existing.amount;
          await tx.account.update({ where: { id: dst.id }, data: { balance: { increment: -amt } } });
        }
        await tx.transaction.delete({ where: { id } });
      });
      return NextResponse.json({ success: true });
    }

    // Normal: ATOMIC reverse (using snapshot) + delete
    await db.$transaction(async (tx) => {
      const acc = await tx.account.findFirst({ where: { id: existing.accountId, userId } });
      if (acc) {
        // P0.12: use snapshot
        const amt = existing.sourceAmount ?? existing.amount;
        const delta = existing.type === 'INCOME' ? -amt : amt;
        await tx.account.update({ where: { id: acc.id }, data: { balance: { increment: delta } } });
      }
      await tx.transaction.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
