import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/backup?action=export - user-scoped
export async function GET(req: NextRequest) {
  try {
    const userId = requireAuth(req);
    const [accounts, categories, transactions, budgets] = await Promise.all([
      db.account.findMany({ where: { userId } }),
      db.category.findMany({ where: { userId } }),
      db.transaction.findMany({ where: { userId }, include: { account: true, category: true } }),
      db.budget.findMany({ where: { userId } }),
    ]);

    const backup = {
      version: 2,
      app: 'mywallet',
      exportedAt: new Date().toISOString(),
      data: {
        accounts: accounts.map(({ ...r }) => r),
        categories: categories.map(({ ...r }) => r),
        transactions: transactions.map(({ account: _a, category: _c, ...r }) => ({
          ...r,
          accountName: _a?.name,
          categoryName: _c?.nameAr,
        })),
        budgets: budgets.map(({ ...r }) => r),
      },
    };

    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mywallet-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/backup?action=import - user-scoped, ATOMIC
export async function POST(req: NextRequest) {
  try {
    const userId = requireAuth(req);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup?.data) return NextResponse.json({ error: 'Invalid backup format' }, { status: 400 });

    const { accounts, categories, transactions, budgets } = backup.data;

    // ATOMIC: delete old + restore new
    const result = await db.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.budget.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });

      let catCount = 0, accCount = 0, txCount = 0, budCount = 0;

      for (const c of categories || []) {
        await tx.category.create({ data: { ...c, userId } });
        catCount++;
      }
      for (const a of accounts || []) {
        await tx.account.create({ data: { ...a, userId } });
        accCount++;
      }
      for (const t of transactions || []) {
        await tx.transaction.create({ data: { ...t, userId } });
        txCount++;
      }
      for (const b of budgets || []) {
        await tx.budget.create({ data: { ...b, userId } });
        budCount++;
      }

      return { accounts: accCount, categories: catCount, transactions: txCount, budgets: budCount };
    });

    return NextResponse.json({ success: true, imported: result });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
