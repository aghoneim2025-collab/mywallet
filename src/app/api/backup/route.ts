import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/backup/export - ينزّل ملف JSON بكل البيانات
export async function GET() {
  try {
    const [accounts, categories, transactions, budgets, settings] = await Promise.all([
      db.account.findMany({ include: { transactions: true } }),
      db.category.findMany({ include: { transactions: true, budgets: true } }),
      db.transaction.findMany({ include: { account: true, category: true } }),
      db.budget.findMany({ include: { category: true } }),
      db.setting.findMany(),
    ]);

    const backup = {
      version: 1,
      app: 'mywallet',
      exportedAt: new Date().toISOString(),
      data: {
        accounts: accounts.map(({ transactions: _txs, ...rest }) => rest),
        categories: categories.map(({ transactions: _txs, budgets: _bs, ...rest }) => rest),
        transactions: transactions.map(({ account: _a, category: _c, ...rest }) => ({
          ...rest,
          accountName: _a?.name,
          categoryName: _c?.nameAr,
        })),
        budgets: budgets.map(({ category: _c, ...rest }) => ({
          ...rest,
          categoryName: _c?.nameAr,
        })),
        settings,
      },
    };

    const json = JSON.stringify(backup, null, 2);

    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mywallet-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err: any) {
    console.error('Backup export error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/backup/import - يستورد ملف JSON
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup?.data || !backup.data.accounts || !backup.data.categories) {
      return NextResponse.json({ error: 'Invalid backup file format' }, { status: 400 });
    }

    const { accounts, categories, transactions, budgets, settings } = backup.data;

    // Clean current data ( Cascading deletes for transactions)
    await db.transaction.deleteMany({});
    await db.budget.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.setting.deleteMany({});

    // restore categories first
    let importedCategories = 0;
    for (const c of categories || []) {
      await db.category.create({
        data: {
          id: c.id,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          type: c.type,
          icon: c.icon || 'tag',
          color: c.color || '#10B981',
          isDefault: c.isDefault || false,
        },
      });
      importedCategories++;
    }

    // restore accounts
    let importedAccounts = 0;
    for (const a of accounts || []) {
      await db.account.create({
        data: {
          id: a.id,
          name: a.name,
          type: a.type,
          currency: a.currency,
          balance: a.balance,
          color: a.color || '#2563EB',
          icon: a.icon || 'wallet',
          isDefault: a.isDefault || false,
        },
      });
      importedAccounts++;
    }

    // restore transactions
    let importedTransactions = 0;
    for (const t of transactions || []) {
      await db.transaction.create({
        data: {
          id: t.id,
          type: t.type,
          amount: t.amount,
          currency: t.currency,
          accountId: t.accountId,
          categoryId: t.categoryId,
          date: new Date(t.date),
          note: t.note,
          tags: t.tags,
        },
      });
      importedTransactions++;
    }

    // restore budgets
    let importedBudgets = 0;
    for (const b of budgets || []) {
      await db.budget.create({
        data: {
          id: b.id,
          categoryId: b.categoryId,
          month: b.month,
          limit: b.limit,
          currency: b.currency || 'EGP',
        },
      });
      importedBudgets++;
    }

    // restore settings
    let importedSettings = 0;
    for (const s of settings || []) {
      await db.setting.create({
        data: {
          key: s.key,
          value: s.value,
        },
      });
      importedSettings++;
    }

    return NextResponse.json({
      success: true,
      imported: {
        accounts: importedAccounts,
        categories: importedCategories,
        transactions: importedTransactions,
        budgets: importedBudgets,
        settings: importedSettings,
      },
    });
  } catch (err: any) {
    console.error('Backup import error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
