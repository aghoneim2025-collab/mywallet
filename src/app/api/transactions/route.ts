import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';

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
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
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

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body;

    // Validate input
    if (!type || !['EXPENSE', 'INCOME'].includes(type)) {
      return NextResponse.json({ error: 'Type must be EXPENSE or INCOME' }, { status: 400 });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0 || !isFinite(amt)) {
      return NextResponse.json({ error: 'Amount must be positive number' }, { status: 400 });
    }
    if (!accountId || !categoryId) {
      return NextResponse.json({ error: 'accountId and categoryId required' }, { status: 400 });
    }

    // Verify BOTH account AND category ownership
    const [account, category] = await Promise.all([
      db.account.findFirst({ where: { id: accountId, userId } }),
      db.category.findFirst({ where: { id: categoryId, userId } }),
    ]);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

    // Verify category type matches transaction type
    if (category.type !== type) {
      return NextResponse.json({ error: `Category type mismatch: category is ${category.type}, transaction is ${type}` }, { status: 400 });
    }

    const txCurrency = (currency || account.currency) as Currency;
    const amountInAccountCurrency = txCurrency === account.currency
      ? amt : convert(amt, txCurrency, account.currency as Currency);
    const delta = type === 'INCOME' ? amountInAccountCurrency : -amountInAccountCurrency;

    // ATOMIC
    const transaction = await db.$transaction(async (tx) => {
      await tx.account.update({ where: { id: accountId }, data: { balance: { increment: delta } } });
      return tx.transaction.create({
        data: { type, amount: amt, currency: txCurrency, accountId, categoryId, userId,
          date: date ? new Date(date) : new Date(), note: note || null, tags: tags || null },
        include: { account: true, category: true },
      });
    });
    return NextResponse.json({ data: transaction });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
