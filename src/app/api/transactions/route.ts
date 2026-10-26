import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convertServer as convert, type Currency } from '@/lib/currency';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import { parseMoney, isCurrency, parseString, badRequest } from '@/lib/validate';

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const url = new URL(req.url);
    const where: any = { userId };
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('accountId');
    const categoryId = url.searchParams.get('categoryId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = url.searchParams.get('limit');
    if (type) where.type = type;
    if (accountId) where.accountId = accountId;
    if (categoryId) where.categoryId = categoryId;
    if (from || to) {
      where.date = {};
      // P0.11: explicit UTC parsing to avoid tz-shift on date-only strings
      if (from) where.date.gte = new Date(`${from}T00:00:00.000Z`);
      if (to) where.date.lte = new Date(`${to}T23:59:59.999Z`);
    }
    const transactions = await db.transaction.findMany({
      where,
      include: { account: true, category: true, toAccount: true },
      orderBy: { date: 'desc' },
      ...(limit ? { take: Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000)) } : {}),
    });
    return NextResponse.json({ data: transactions });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

// P0.11 fixes:
//   - Validate type, amount (NaN/Infinity), currency, account/category ownership
//   - Validate note/tags length limits
//   - Verify category.type matches transaction type (was: only checked in POST)
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body || {};

    // Validate type
    if (type !== 'EXPENSE' && type !== 'INCOME') {
      return badRequest('Type must be EXPENSE or INCOME');
    }

    // P0.11: use parseMoney (catches NaN, Infinity, negative)
    const amtResult = parseMoney(amount, { allowZero: false, allowNegative: false });
    if (!amtResult.ok) return badRequest(amtResult.error);
    const amt = amtResult.value;

    if (typeof accountId !== 'string' || accountId.length < 10) return badRequest('Invalid accountId');
    if (typeof categoryId !== 'string' || categoryId.length < 10) return badRequest('Invalid categoryId');

    if (currency !== undefined && !isCurrency(currency)) {
      return badRequest('Invalid currency (must be EGP, SAR, USD, EUR, or AED)');
    }

    // P0.11: validate note/tags length
    if (note !== undefined && note !== null) {
      const r = parseString(note, 'Note', { required: false, max: 500 });
      if (!r.ok) return badRequest(r.error);
    }
    if (tags !== undefined && tags !== null) {
      const r = parseString(tags, 'Tags', { required: false, max: 200 });
      if (!r.ok) return badRequest(r.error);
    }

    // Verify BOTH account AND category ownership (IDOR defense)
    const [account, category] = await Promise.all([
      db.account.findFirst({ where: { id: accountId, userId } }),
      db.category.findFirst({ where: { id: categoryId, userId } }),
    ]);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

    // P0.11: verify category type matches transaction type (catches mismatched imports)
    if (category.type !== type) {
      return badRequest(`Category type mismatch: category is ${category.type}, transaction is ${type}`);
    }

    const txCurrency: Currency = currency || account.currency;
    const amountInAccountCurrency = txCurrency === account.currency
      ? amt : convert(amt, txCurrency, account.currency);
    const delta = type === 'INCOME' ? amountInAccountCurrency : -amountInAccountCurrency;

    // Sanity check on converted amount
    if (!Number.isFinite(delta)) return badRequest('Currency conversion failed (invalid rate?)');

    // P0.12: snapshot the conversion for idempotent reversal later.
    // When this transaction is edited or deleted, we'll use sourceAmount
    // (the EXACT amount applied) instead of re-running convert() with
    // CURRENT rates (which could have changed).
    const exchangeRateUsed = txCurrency === account.currency ? null : (amountInAccountCurrency / amt);

    // ATOMIC: update balance + create transaction (with snapshot)
    const transaction = await db.$transaction(async (tx) => {
      await tx.account.update({ where: { id: accountId }, data: { balance: { increment: delta } } });
      return tx.transaction.create({
        data: {
          type, amount: amt, currency: txCurrency,
          accountId, categoryId, userId,
          date: date ? new Date(date) : new Date(),
          note: note ? String(note).slice(0, 500) : null,
          tags: tags ? String(tags).slice(0, 200) : null,
          // P0.12: snapshot fields
          sourceAmount: amountInAccountCurrency,
          destAmount: null,  // not a transfer
          exchangeRateUsed,
        },
        include: { account: true, category: true },
      });
    });
    return NextResponse.json({ data: transaction });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
