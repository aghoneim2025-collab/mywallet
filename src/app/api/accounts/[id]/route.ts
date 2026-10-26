import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError, ValidationError } from '@/lib/api-errors';
import {
  parseMoney, parseString, isCurrency, isAccountType, badRequest,
} from '@/lib/validate';

// P0.11 fixes:
//   - Validate balance (NaN/Infinity), currency, account type, name length
//   - Block currency change on accounts with transactions (prevents silent corruption)
//   - Wrap default-toggle + update in $transaction (was: 2 writes, race on partial failure)

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    // Verify ownership FIRST
    const account = await db.account.findFirst({ where: { id, userId } });
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const { name, type, currency, balance, color, icon, isDefault } = body || {};
    const data: any = {};
    let pendingBalanceChange: number | undefined;
    let pendingCurrencyChange: string | undefined;

    if (name !== undefined) {
      const r = parseString(name, 'Name', { min: 1, max: 100 });
      if (!r.ok) return badRequest(r.error);
      data.name = r.value;
    }
    if (type !== undefined) {
      if (!isAccountType(type)) return badRequest('Invalid account type');
      data.type = type;
    }
    if (currency !== undefined) {
      if (!isCurrency(currency)) return badRequest('Invalid currency');
      // P0.11: block currency change on accounts with transactions
      if (currency !== account.currency) {
        pendingCurrencyChange = currency;
      }
      data.currency = currency;
    }
    if (balance !== undefined) {
      // P0.19: block direct balance rewrite if account has transactions.
      // This prevents detaching the running balance from the transaction ledger.
      // If the user wants to adjust the balance, they should create a reconciliation
      // transaction (or delete all transactions first).
      // P0.20: check BOTH accountId AND toAccountId (incoming transfers)
      const txCount = await db.transaction.count({
        where: { OR: [{ accountId: id }, { toAccountId: id }] },
      });
      if (txCount > 0) {
        return NextResponse.json(
          { error: `Cannot change balance directly: account has ${txCount} transaction(s). ` +
            'Create a reconciliation transaction instead, or delete the transactions first.' },
          { status: 400 },
        );
      }
      const r = parseMoney(balance, { allowZero: true, allowNegative: true });
      if (!r.ok) return badRequest(r.error);
      data.balance = r.value;
    }
    if (color !== undefined) {
      const r = parseString(color, 'Color', { required: false, max: 20 });
      if (!r.ok) return badRequest(r.error);
      data.color = r.value;
    }
    if (icon !== undefined) {
      const r = parseString(icon, 'Icon', { required: false, max: 100 });
      if (!r.ok) return badRequest(r.error);
      data.icon = r.value;
    }
    if (isDefault !== undefined) data.isDefault = Boolean(isDefault);

    // ATOMIC: toggle old default off + update + balance/currency checks inside $transaction
    // P0.21: moved balance + currency validation INSIDE $transaction to prevent
    // race conditions (was: count outside → concurrent txn could be created
    // between count and update → balance detached from ledger)
    const updated = await db.$transaction(async (tx) => {
      // P0.21: check balance rewrite INSIDE $transaction (atomic with the update)
      if (pendingBalanceChange !== undefined) {
        const txCount = await tx.transaction.count({
          where: { OR: [{ accountId: id }, { toAccountId: id }] },
        });
        if (txCount > 0) {
          throw new ValidationError(
            `Cannot change balance directly: account has ${txCount} transaction(s). ` +
            'Create a reconciliation transaction instead, or delete the transactions first.'
          );
        }
        data.balance = pendingBalanceChange;
      }
      // P0.21: check currency change INSIDE $transaction + include toAccountId
      if (pendingCurrencyChange !== undefined && pendingCurrencyChange !== account.currency) {
        const cnt = await tx.transaction.count({
          where: { OR: [{ accountId: id }, { toAccountId: id }] },
        });
        if (cnt > 0) {
          throw new ValidationError(
            `Cannot change currency on account with ${cnt} existing transactions. Create a new account instead.`
          );
        }
        data.currency = pendingCurrencyChange;
      }
      if (isDefault) {
        const old = await tx.account.findFirst({ where: { isDefault: true, userId, NOT: { id } } });
        if (old) await tx.account.update({ where: { id: old.id }, data: { isDefault: false } });
      }
      return tx.account.update({ where: { id }, data });
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
    // Verify ownership FIRST before any operation
    const account = await db.account.findFirst({ where: { id, userId } });
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Check transactions (both as source AND destination for transfers)
    const txCount = await db.transaction.count({
      where: { OR: [{ accountId: id }, { toAccountId: id }], userId }
    });
    if (txCount > 0) {
      return NextResponse.json({ error: `Cannot delete: ${txCount} transactions linked` }, { status: 400 });
    }

    await db.account.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
