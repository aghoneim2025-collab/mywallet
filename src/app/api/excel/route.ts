import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as XLSX from 'xlsx';

// GET /api/excel/export?month=YYYY-MM&type=EXPENSE|INCOME
// يصدّر المعاملات بصيغة Excel متوافقة مع Money Manager
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    const type = url.searchParams.get('type');

    const where: any = {};
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

    // تنسيق متوافق مع Money Manager
    const rows = transactions.map(t => ({
      'Date': t.date.toISOString().slice(0, 10),
      'Type': t.type,
      'Category': t.category.nameAr,
      'Category (EN)': t.category.nameEn,
      'Account': t.account.name,
      'Account Type': t.account.type,
      'Amount': t.amount,
      'Currency': t.currency,
      'Note': t.note || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    // أعرض الكولومز بالعرض الصحيح
    ws['!cols'] = [
      { wch: 12 }, // Date
      { wch: 10 }, // Type
      { wch: 20 }, // Category
      { wch: 20 }, // Category EN
      { wch: 18 }, // Account
      { wch: 12 }, // Account Type
      { wch: 12 }, // Amount
      { wch: 8 },  // Currency
      { wch: 30 }, // Note
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

    // صفحة بالحسابات
    const accounts = await db.account.findMany();
    const accRows = accounts.map(a => ({
      'Account Name': a.name,
      'Type': a.type,
      'Currency': a.currency,
      'Balance': a.balance,
      'Color': a.color,
      'Icon': a.icon,
      'Default': a.isDefault ? 'Yes' : 'No',
    }));
    const wsAcc = XLSX.utils.json_to_sheet(accRows);
    wsAcc['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsAcc, 'Accounts');

    // صفحة بالفئات
    const categories = await db.category.findMany();
    const catRows = categories.map(c => ({
      'Name (AR)': c.nameAr,
      'Name (EN)': c.nameEn,
      'Type': c.type,
      'Color': c.color,
      'Icon': c.icon,
    }));
    const wsCat = XLSX.utils.json_to_sheet(catRows);
    wsCat['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 10 }, { wch: 8 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsCat, 'Categories');

    // اكتب الـ Excel كـ buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="mywallet-${month || 'all'}.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error('Excel export error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/excel/import - يستورد ملف Excel (FormData)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(Buffer.from(buf), { type: 'buffer' });

    // حاول نلاقي ورقة المعاملات
    const wsName = wb.SheetNames.find(n =>
      /transaction|معامل|movement/i.test(n)
    ) || wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json<any>(ws);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data found in the file' }, { status: 400 });
    }

    // خد الحسابات والفئات الموجودة
    const existingAccounts = await db.account.findMany();
    const existingCategories = await db.category.findMany();

    // Map بالاسم (عربي + إنجليزي)
    const accByArName = new Map(existingAccounts.map(a => [a.name, a]));
    const catByArName = new Map(existingCategories.map(c => [c.nameAr, c]));
    const catByEnName = new Map(existingCategories.map(c => [c.nameEn, c]));

    // إنشاء حسابات وفئات مش موجودة تلقائياً
    const ensureAccount = async (name: string, type?: string, currency?: string) => {
      if (!name) return null;
      const existing = accByArName.get(name);
      if (existing) return existing;
      const created = await db.account.create({
        data: {
          name,
          type: (type as any) || 'CASH',
          currency: (currency as any) || 'EGP',
          balance: 0,
          color: '#2563EB',
          icon: 'wallet',
        },
      });
      accByArName.set(name, created);
      return created;
    };

    const ensureCategory = async (
      nameAr: string,
      nameEn: string,
      type: string,
      color = '#10B981'
    ) => {
      const existing = catByArName.get(nameAr) || catByEnName.get(nameEn);
      if (existing) return existing;
      const created = await db.category.create({
        data: {
          nameAr: nameAr || nameEn,
          nameEn: nameEn || nameAr,
          type: type as any,
          color,
          icon: type === 'INCOME' ? 'banknote' : 'tag',
        },
      });
      catByArName.set(created.nameAr, created);
      catByEnName.set(created.nameEn, created);
      return created;
    };

    // أنواع المفاتيح المتوقعة من Money Manager
    // Money Manager columns عادة: Date / Type / Amount / Category / Account / Note
    // أو Arabic: التاريخ / النوع / المبلغ / الفئة / الحساب / ملاحظة
    const keys = rows[0] ? Object.keys(rows[0]) : [];

    // mapping أسماء الأعمدة الممكنة
    const findKey = (patterns: string[]): string | undefined => {
      for (const p of patterns) {
        const k = keys.find(k => k.toLowerCase().includes(p.toLowerCase()));
        if (k) return k;
      }
      return undefined;
    };

    const dateKey = findKey(['date', 'تاريخ', 'التاريخ']);
    const typeKey = findKey(['type', 'نوع', 'النوع']);
    const amountKey = findKey(['amount', 'مبلغ', 'المبلغ', 'value']);
    const catKey = findKey(['category', 'فئة', 'الفئة', 'تصنيف']);
    const catEnKey = findKey(['category (en)', 'category en', 'فئة (en)']);
    const accKey = findKey(['account', 'حساب', 'الحساب']);
    const accTypeKey = findKey(['account type', 'نوع الحساب']);
    const currencyKey = findKey(['currency', 'عملة', 'العملة']);
    const noteKey = findKey(['note', 'ملاحظة', 'وصف', 'description', 'تفاصيل']);

    let imported = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const dateStr = dateKey ? String(row[dateKey] || '') : '';
        const typeStr = (typeKey ? String(row[typeKey] || '').toUpperCase() : 'EXPENSE') as 'EXPENSE' | 'INCOME';
        const amount = amountKey ? parseFloat(String(row[amountKey] || '0')) : 0;
        const catName = catKey ? String(row[catKey] || '') : '';
        const catEnName = catEnKey ? String(row[catEnKey] || catName) : catName;
        const accName = accKey ? String(row[accKey] || '') : '';
        const accType = accTypeKey ? String(row[accTypeKey] || 'CASH').toUpperCase() : 'CASH';
        const currency = (currencyKey ? String(row[currencyKey] || 'EGP') : 'EGP').toUpperCase();
        const note = noteKey ? String(row[noteKey] || '') : '';

        if (!dateStr || !amount || !accName) {
          errors.push(`Row skipped: missing required field(s)`);
          continue;
        }

        // parse date
        let date: Date;
        if (typeof row[dateKey!] === 'number') {
          // Excel serial date
          const serial = row[dateKey!];
          const utcDays = Math.floor(serial - 25569);
          const utcValue = utcDays * 86400;
          date = new Date(utcValue * 1000);
        } else {
          date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            date = new Date();
          }
        }

        // determine type (default EXPENSE if not specified or invalid)
        const txType: 'EXPENSE' | 'INCOME' = typeStr === 'INCOME' ? 'INCOME' : 'EXPENSE';

        const account = await ensureAccount(accName, accType, currency);
        if (!account) continue;

        // category
        const category = await ensureCategory(
          catName || (txType === 'INCOME' ? 'دخل إضافي' : 'مصروف آخر'),
          catEnName || (txType === 'INCOME' ? 'Other Income' : 'Other Expense'),
          txType
        );

        if (!category) continue;

        // update account balance
        const delta = txType === 'INCOME' ? amount : -amount;
        await db.account.update({
          where: { id: account.id },
          data: { balance: { increment: delta } },
        });

        await db.transaction.create({
          data: {
            type: txType,
            amount,
            currency: currency as any,
            accountId: account.id,
            categoryId: category.id,
            date,
            note: note || null,
          },
        });

        imported++;
      } catch (e: any) {
        errors.push(`Row error: ${e.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      errors: errors.slice(0, 10),
      message: `Imported ${imported} transactions${errors.length ? `, ${errors.length} errors` : ''}`,
    });
  } catch (err: any) {
    console.error('Excel import error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
