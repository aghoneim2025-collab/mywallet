import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/transactions - يسترجع كل المعاملات مع فلترة اختيارية
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type');           // EXPENSE | INCOME
    const accountId = url.searchParams.get('accountId');
    const categoryId = url.searchParams.get('categoryId');
    const from = url.searchParams.get('from');            // ISO date
    const to = url.searchParams.get('to');
    const limit = url.searchParams.get('limit');

    const where: any = {};
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
      include: { account: true, category: true },
      orderBy: { date: 'desc' },
      ...(limit ? { take: parseInt(limit, 10) } : {}),
    });

    return NextResponse.json({ data: transactions });
  } catch (err: any) {
    console.error('GET /api/transactions error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/transactions - ينشئ معاملة جديدة
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, amount, currency, accountId, categoryId, date, note, tags } = body;

    if (!type || !amount || !accountId || !categoryId) {
      return NextResponse.json(
        { error: 'type, amount, accountId, categoryId are required' },
        { status: 400 }
      );
    }

    // تحديث رصيد الحساب
    const account = await db.account.findUnique({ where: { id: accountId } });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const delta = type === 'INCOME' ? Number(amount) : -Number(amount);
    await db.account.update({
      where: { id: accountId },
      data: { balance: account.balance + delta },
    });

    const transaction = await db.transaction.create({
      data: {
        type,
        amount: Number(amount),
        currency: currency || account.currency,
        accountId,
        categoryId,
        date: date ? new Date(date) : new Date(),
        note: note || null,
        tags: tags || null,
      },
      include: { account: true, category: true },
    });

    return NextResponse.json({ data: transaction });
  } catch (err: any) {
    console.error('POST /api/transactions error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
