import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';

// GET /api/backup?action=export - user-scoped
export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const [accounts, categories, transactions, budgets] = await Promise.all([
      db.account.findMany({ where: { userId } }),
      db.category.findMany({ where: { userId } }),
      db.transaction.findMany({ where: { userId }, include: { account: true, category: true } }),
      db.budget.findMany({ where: { userId } }),
    ]);

    const backup = {
      version: 3,
      app: 'mywallet',
      exportedAt: new Date().toISOString(),
      data: {
        accounts: accounts.map(({ id, name, type, currency, balance, color, icon, isDefault, createdAt, updatedAt }) => 
          ({ id, name, type, currency, balance, color, icon, isDefault, createdAt, updatedAt })),
        categories: categories.map(({ id, nameAr, nameEn, type, icon, color, isDefault, createdAt, updatedAt }) => 
          ({ id, nameAr, nameEn, type, icon, color, isDefault, createdAt, updatedAt })),
        // Only export known Transaction fields (NO accountName/categoryName)
        transactions: transactions.map(({ id, type, amount, currency, accountId, categoryId, toAccountId, date, note, tags, transferPairId, userId: _uid, createdAt, updatedAt }) => 
          ({ id, type, amount, currency, accountId, categoryId, toAccountId, date, note, tags, transferPairId, createdAt, updatedAt })),
        budgets: budgets.map(({ id, categoryId, month, limit, currency, createdAt, updatedAt }) => 
          ({ id, categoryId, month, limit, currency, createdAt, updatedAt })),
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

// POST /api/backup?action=import - user-scoped, ATOMIC, only known fields
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    
    // Limit file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    const text = await file.text();
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON file' }, { status: 400 });
    }
    
    if (!backup?.data || !backup?.version) {
      return NextResponse.json({ error: 'Invalid backup format - missing version or data' }, { status: 400 });
    }

    const { accounts, categories, transactions, budgets } = backup.data;

    // ATOMIC: delete old + restore new (only with known fields)
    const result = await db.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.budget.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });

      let catCount = 0, accCount = 0, txCount = 0, budCount = 0;

      for (const c of categories || []) {
        await tx.category.create({
          data: {
            id: c.id, nameAr: c.nameAr, nameEn: c.nameEn, type: c.type,
            icon: c.icon || 'tag', color: c.color || '#10B981',
            isDefault: c.isDefault || false, userId,
          },
        });
        catCount++;
      }
      for (const a of accounts || []) {
        await tx.account.create({
          data: {
            id: a.id, name: a.name, type: a.type, currency: a.currency,
            balance: a.balance || 0, color: a.color || '#2563EB',
            icon: a.icon || 'wallet', isDefault: a.isDefault || false, userId,
          },
        });
        accCount++;
      }
      for (const t of transactions || []) {
        await tx.transaction.create({
          data: {
            id: t.id, type: t.type, amount: t.amount, currency: t.currency,
            accountId: t.accountId, categoryId: t.categoryId,
            toAccountId: t.toAccountId || null,
            date: new Date(t.date),
            note: t.note || null, tags: t.tags || null,
            transferPairId: t.transferPairId || null,
            userId,
          },
        });
        txCount++;
      }
      for (const b of budgets || []) {
        await tx.budget.create({
          data: {
            id: b.id, categoryId: b.categoryId, month: b.month,
            limit: b.limit, currency: b.currency || 'EGP', userId,
          },
        });
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
