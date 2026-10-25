import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';
import { requireAuth } from '@/lib/auth';

// GET /api/transactions - returns transactions for authenticated user only
export async function GET(req: NextRequest) {
  try {
    const userId = requireAuth(req);

    const url = new URL(req.url);
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('accountId');
    const categoryId = url.searchParams.get('categoryId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = url.searchParams.get('limit');

    const where: any = { userId };
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
      ...(limit ? { take: parseInt(limit, 10) } : {}),
    });

    return NextResponse.json({ data: transactions });
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('GET /api/transactions error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/transactions - create transaction for authenticated user (ATOMIC)
export async function POST(req: NextRequest) {
  try {
    const userId = requireAuth(req);
    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body;

    if (!type || !amount || !accountId || !categoryId) {
      return NextResponse.json(
        { error: 'type, amount, accountId, categoryId are required' },
        { status: 400 }
      );
    }

    // Verify account belongs to user
    const account = await db.account.findFirst({ where: { id: accountId, userId } });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const txCurrency = (currency || account.currency) as Currency;
    const accountCurrency = account.currency as Currency;
    const amountInAccountCurrency =
      txCurrency === accountCurrency
        ? Number(amount)
        : convert(Number(amount), txCurrency, accountCurrency);

    const delta = type === 'INCOME' ? amountInAccountCurrency : -amountInAccountCurrency;

    // ATOMIC: update balance + create transaction in one transaction
    const transaction = await db.$transaction(async (tx) => {
      // Update balance
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: delta } },
      });

      // Create transaction
      return tx.transaction.create({
        data: {
          type,
          amount: Number(amount),
          currency: txCurrency,
          accountId,
          categoryId,
          userId,
          date: date ? new Date(date) : new Date(),
          note: note || null,
          tags: tags || null,
        },
        include: { account: true, category: true },
      });
    });

    return NextResponse.json({ data: transaction });
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('POST /api/transactions error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
