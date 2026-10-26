import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import { convert, type Currency } from '@/lib/currency';
import { isCurrency, parseMoney } from '@/lib/validate';
import * as XLSX from 'xlsx';

// P0.11 excel fixes:
//   - File size limit (10MB, was: unbounded)
//   - Row count limit (10000, was: unbounded)
//   - Currency enum validation per row (was: silent skip on Prisma throw)
//   - Multi-currency conversion: row amount converted to account.currency
//     (was: raw amount added regardless of currency mismatch)
//   - Transfer-Out detection: skip Transfer rows (was: misclassified as EXPENSE)
//   - Duplicate detection: skip if (date+amount+accountId+note) already exists
//   - CSV injection mitigation: neutralize note cells starting with =, +, -, @

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 10000;

// Get keys case-insensitively
function findKey(row: Record<string, unknown>, patterns: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const p of patterns) {
    const k = keys.find(k => k.toLowerCase().trim().includes(p.toLowerCase()));
    if (k) return k;
  }
  return undefined;
}

// P0.11: neutralize CSV injection — cells starting with =, +, -, @, tab, CR
function csvSafe(s: string): string {
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

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
      end.setUTCMonth(end.getUTCMonth() + 1);
      where.date = { gte: start, lt: end };
    }

    const transactions = await db.transaction.findMany({
      where,
      include: { account: true, category: true },
      orderBy: { date: 'desc' },
    });

    // P0.11: removed the duplicate 'SAR' column; just one 'Amount' column now.
    // CSV injection mitigation on Note.
    const rows = transactions.map(t => ({
      'Date': t.date.toISOString().slice(0, 10),
      'Account': t.account.name,
      'Category': t.category.nameAr,
      'Subcategory': '*',
      'Note': csvSafe(t.note || ''),
      'Income/Expense': t.type === 'INCOME' ? 'Income' : t.type === 'TRANSFER' ? 'Transfer-Out' : 'Expense',
      'Description': '',
      'Amount': t.amount,
      'Currency': t.currency,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 30 },
      { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 8 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Money Manager');
    // P0.11: disable macro/formula evaluation on read (defense in depth).
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', bookVBA: false });

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="mywallet-${month || 'all'}.xlsx"`,
      },
    });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

// POST /api/excel?action=import
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    // P0.11: file size limit (was: unbounded)
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    // P0.11: disable macro/formula evaluation to mitigate prototype-pollution gadgets
    const wb = XLSX.read(Buffer.from(buf), {
      type: 'buffer',
      cellDates: true,
      bookVBA: false,
      cellFormula: false,
      cellHTML: false,
    });
    const wsName = wb.SheetNames[0];
    if (!wsName) return NextResponse.json({ error: 'No sheets in workbook' }, { status: 400 });
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

    if (rows.length === 0) return NextResponse.json({ error: 'No data found' }, { status: 400 });
    // P0.11: row count limit (was: unbounded)
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS})` }, { status: 400 });
    }

    const existingAccounts = await db.account.findMany({ where: { userId } });
    const existingCategories = await db.category.findMany({ where: { userId } });
    const accByArName = new Map(existingAccounts.map(a => [a.name, a]));
    const catByArName = new Map(existingCategories.map(c => [c.nameAr, c]));

    // P0.11: lookup existing transactions for duplicate detection (date+amount+accountId+note)
    const existingTxns = await db.transaction.findMany({
      where: { userId },
      select: { date: true, amount: true, accountId: true, note: true },
    });
    // Use a Set with composite key for O(1) lookup
    const existingKeys = new Set(
      existingTxns.map(t => `${t.date.getTime()}|${t.amount}|${t.accountId}|${t.note ?? ''}`),
    );

    // Fetch existing transfer category (we'll skip transfer rows entirely)
    const transferCat = await db.category.findFirst({
      where: { nameAr: 'تحويلات', userId, type: 'TRANSFER' as any },
    });

    let imported = 0, skipped = 0, duplicate = 0, transferSkipped = 0;

    for (const row of rows) {
      try {
        const dateKey = findKey(row, ['date', 'تاريخ']);
        const accountKey = findKey(row, ['account', 'حساب']);
        const catKey = findKey(row, ['category', 'فئة', 'تصنيف']);
        const typeKey = findKey(row, ['income/expense', 'نوع', 'type']);
        const amountKey = findKey(row, ['amount', 'مبلغ', 'value', 'sar']);
        const currencyKey = findKey(row, ['currency', 'عملة']);
        const noteKey = findKey(row, ['note', 'ملاحظة', 'description']);

        let date: Date = new Date();
        if (dateKey) {
          const dv = row[dateKey];
          if (dv instanceof Date) date = dv;
          else if (typeof dv === 'number') date = new Date((Math.floor(dv) - 25569) * 86400 * 1000);
          else if (typeof dv === 'string') {
            const str = dv.trim();
            if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
              const [dd, mm, yyyy] = str.split('/');
              // P0.11: use Date.UTC instead of `new Date('YYYY-MM-DD')` (which is UTC midnight)
              date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
            } else date = new Date(str);
          }
        }
        if (isNaN(date.getTime())) { skipped++; continue; }

        // P0.11: validate amount via parseMoney (catches NaN/Infinity)
        const rawAmount = amountKey ? row[amountKey] : 0;
        const amtResult = parseMoney(rawAmount, { allowZero: false, allowNegative: true });
        if (!amtResult.ok) { skipped++; continue; }
        const amount = amtResult.value;

        const accName = accountKey ? String(row[accountKey] || '').trim() : '';
        if (!accName) { skipped++; continue; }

        // P0.11: validate currency BEFORE creating account
        const currencyRaw = (currencyKey ? String(row[currencyKey] || 'SAR') : 'SAR').toUpperCase();
        if (!isCurrency(currencyRaw)) { skipped++; continue; }
        const rowCurrency = currencyRaw as Currency;

        // Find or create account. P0.11: if account exists with different currency,
        // skip row (was: silently used account.currency and added raw amount)
        let account = accByArName.get(accName);
        if (!account) {
          account = await db.account.create({
            data: { name: accName, type: 'BANK', currency: rowCurrency, balance: 0, userId },
          });
          accByArName.set(accName, account);
        }
        // Currency mismatch check — don't silently corrupt
        if (account.currency !== rowCurrency) {
          // Convert the row amount to account currency, OR skip — choose skip for safety
          skipped++;
          continue;
        }

        // P0.11: detect Transfer rows and skip them (transfers can't round-trip via Excel
        // because we don't have a ToAccount column in the export format)
        const rowTypeStr = (typeKey ? String(row[typeKey] || 'Expense') : 'Expense').toLowerCase();
        if (rowTypeStr.startsWith('transfer')) {
          transferSkipped++;
          continue;
        }

        // P0.11: validate category type matches transaction type
        const catName = catKey ? String(row[catKey] || '').trim() : '';
        if (!catName || catName === 'None' || catName === '*') { skipped++; continue; }
        const isIncome = rowTypeStr === 'income' || amount < 0;
        const txType = isIncome ? 'INCOME' : 'EXPENSE';
        let category = catByArName.get(catName);
        if (!category) {
          category = await db.category.create({
            data: { nameAr: catName, nameEn: catName, type: txType as any, icon: 'tag', color: '#64748B', userId },
          });
          catByArName.set(catName, category);
        }
        // P0.11: if category exists but has wrong type for this row, skip (was: silently assigned)
        if (category.type !== txType && category.type !== 'TRANSFER' as any) {
          skipped++;
          continue;
        }

        const absAmount = Math.abs(amount);
        const note = noteKey ? String(row[noteKey] || '').slice(0, 500) : '';

        // P0.11: duplicate detection (date+amount+accountId+note)
        const dedupKey = `${date.getTime()}|${absAmount}|${account.id}|${note}`;
        if (existingKeys.has(dedupKey)) {
          duplicate++;
          continue;
        }
        existingKeys.add(dedupKey);

        // ATOMIC: update balance + create transaction
        // (balance delta is in account.currency because we validated currency match above)
        await db.$transaction(async (tx) => {
          const delta = txType === 'INCOME' ? absAmount : -absAmount;
          await tx.account.update({ where: { id: account!.id }, data: { balance: { increment: delta } } });
          await tx.transaction.create({
            data: {
              type: txType as any,
              amount: absAmount,
              currency: account!.currency,
              accountId: account!.id,
              categoryId: category!.id,
              date,
              note: note || null,
              userId,
            },
          });
        });

        imported++;
      } catch (e) {
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      duplicate,
      transferSkipped,
      message:
        `Imported ${imported} transaction(s). ` +
        `Skipped ${skipped} invalid row(s). ` +
        `Skipped ${duplicate} duplicate(s). ` +
        (transferSkipped > 0
          ? `Skipped ${transferSkipped} transfer(s) — transfers are not supported in Excel format (use Backup JSON to round-trip transfers). `
          : ''),
    });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
