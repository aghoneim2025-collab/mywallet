import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import * as XLSX from 'xlsx';

// GET /api/excel?action=export&month=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    const type = url.searchParams.get('type');

    const where: any = { userId };
    if (type) where.type = type;
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.date = { gte: start, lt: end };
    }

    const transactions = await db.transaction.findMany({
      where,
      include: { account: true, category: true },
      orderBy: { date: 'desc' },
    });

    const rows = transactions.map(t => ({
      'Date': t.date.toISOString().slice(0, 10),
      'Account': t.account.name,
      'Category': t.category.nameAr,
      'Subcategory': '*',
      'Note': t.note || '',
      'SAR': t.amount,
      'Income/Expense': t.type === 'INCOME' ? 'Income' : t.type === 'TRANSFER' ? 'Transfer-Out' : 'Expense',
      'Description': '',
      'Amount': t.amount,
      'Currency': t.currency,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 30 },
      { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 8 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Money Manager');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="mywallet-${month || 'all'}.xlsx"`,
      },
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('Excel export error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/excel?action=import
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(Buffer.from(buf), { type: 'buffer', cellDates: true });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });

    if (rows.length === 0) return NextResponse.json({ error: 'No data found' }, { status: 400 });

    const existingAccounts = await db.account.findMany({ where: { userId } });
    const existingCategories = await db.category.findMany({ where: { userId } });
    const accByArName = new Map(existingAccounts.map(a => [a.name, a]));
    const catByArName = new Map(existingCategories.map(c => [c.nameAr, c]));
    const catByEnName = new Map(existingCategories.map(c => [c.nameEn, c]));

    const ensureAccount = async (name: string, currency: string = 'SAR') => {
      if (!name) return null;
      const existing = accByArName.get(name);
      if (existing) return existing;
      const created = await db.account.create({
        data: { name, type: 'BANK', currency: currency as any, balance: 0, userId },
      });
      accByArName.set(name, created);
      return created;
    };

    const ensureCategory = async (nameAr: string, rowType: string, amount: number) => {
      if (!nameAr || nameAr === 'None' || nameAr === '*') return null;
      const isIncome = rowType === 'income' || amount < 0;
      const type = isIncome ? 'INCOME' : 'EXPENSE';
      const existing = catByArName.get(nameAr);
      if (existing) return existing;
      const created = await db.category.create({
        data: { nameAr, nameEn: nameAr, type: type as any, icon: 'tag', color: '#64748B', userId },
      });
      catByArName.set(created.nameAr, created);
      return created;
    };

    let imported = 0, skipped = 0;
    for (const row of rows) {
      try {
        const keys = Object.keys(row);
        const findKey = (patterns: string[]) => {
          for (const p of patterns) {
            const k = keys.find(k => k.toLowerCase().trim().includes(p.toLowerCase()));
            if (k) return k;
          }
          return undefined;
        };

        const dateKey = findKey(['date', 'تاريخ']);
        const accountKey = findKey(['account', 'حساب']);
        const catKey = findKey(['category', 'فئة', 'تصنيف']);
        const typeKey = findKey(['income/expense', 'نوع', 'type']);
        const amountKey = findKey(['sar', 'amount', 'مبلغ', 'value']);
        const currencyKey = findKey(['currency', 'عملة']);
        const noteKey = findKey(['note', 'ملاحظة', 'description']);

        let date: Date = new Date();
        if (dateKey) {
          const dv = row[dateKey];
          if (dv instanceof Date) date = dv;
          else if (typeof dv === 'number') date = new Date((Math.floor(dv) - 25569) * 86400 * 1000);
          else if (typeof dv === 'string') {
            const str = dv.trim();
            if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
              const [dd, mm, yyyy] = str.split('/');
              date = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
            } else date = new Date(str);
          }
        }

        const amount = amountKey ? parseFloat(String(row[amountKey])) || 0 : 0;
        if (!amount) { skipped++; continue; }

        const accName = accountKey ? String(row[accountKey] || '').trim() : '';
        if (!accName) { skipped++; continue; }
        const account = await ensureAccount(accName);
        if (!account) { skipped++; continue; }

        const catName = catKey ? String(row[catKey] || '').trim() : '';
        const rowType = (typeKey ? String(row[typeKey] || 'Expense') : 'Expense').toLowerCase();
        const category = await ensureCategory(catName, rowType, amount);
        if (!category) { skipped++; continue; }

        const currency = (currencyKey ? String(row[currencyKey] || 'SAR') : 'SAR').toUpperCase();
        const note = noteKey ? String(row[noteKey] || '') : '';

        const txType = rowType === 'income' || amount < 0 ? 'INCOME' : 'EXPENSE';
        const absAmount = Math.abs(amount);

        // ATOMIC: update balance + create transaction
        await db.$transaction(async (tx) => {
          const delta = txType === 'INCOME' ? absAmount : -absAmount;
          await tx.account.update({ where: { id: account.id }, data: { balance: { increment: delta } } });
          await tx.transaction.create({
            data: { type: txType, amount: absAmount, currency, accountId: account.id, categoryId: category.id, date, note: note || null, userId },
          });
        });

        imported++;
      } catch (e) { skipped++; }
    }

    return NextResponse.json({ success: true, imported, skipped, message: `Imported ${imported}, skipped ${skipped}` });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('Excel import error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
