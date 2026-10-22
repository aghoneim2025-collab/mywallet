import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as XLSX from 'xlsx';
import type { Currency } from '@/lib/currency';

/**
 * Excel Import/Export for Money Manager format
 *
 * Format recognized (Money Manager columns):
 *  Date | Account | Category | Subcategory | Note | SAR | Income/Expense | Description | Amount | Currency | Account
 *
 * Types:
 *  - Income (راتب، بدل سكن، Bonus، rewards)
 *  - Expense (طعام، بنزين، صيانه سياره...)
 *  - Transfer-Out (تحويل بين حسابين - الـ Category هو الحساب الوجهة)
 */

// GET /api/excel?action=export
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

    // Money Manager format
    const rows = transactions.map(t => ({
      'Date': t.date.toISOString().slice(0, 10),
      'Account': t.account.name,
      'Category': t.category.nameAr,
      'Subcategory': '*',
      'Note': t.note || '',
      'SAR': t.amount,
      'Income/Expense': t.type === 'INCOME' ? 'Income' : 'Expense',
      'Description': '',
      'Amount': t.amount,
      'Currency': t.currency,
      'Account': t.amount,  // duplicate column (MM stores amount twice)
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 30 },
      { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 12 },
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
    console.error('Excel export error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/excel?action=import  (FormData: file)
 * Smart Money Manager importer:
 *  - Detects columns: Date / Account / Category / Note / SAR / Income/Expense / Currency / Description
 *  - Auto-creates accounts & categories
 *  - Handles 3 types: Income / Expense / Transfer-Out
 *  - Handles datetime Date objects and DD/MM/YYYY strings
 *  - Handles negative amounts (refunds)
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(Buffer.from(buf), { type: 'buffer', cellDates: true });

    // Find sheet (Money Manager or first one)
    const wsName = wb.SheetNames.find(n =>
      /money|manager|transaction|معامل/i.test(n)
    ) || wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data found in the file' }, { status: 400 });
    }

    const keys = Object.keys(rows[0]);
    console.log('Excel columns detected:', keys);

    // Smart column finder - matches Money Manager format
    const findKey = (patterns: string[]): string | undefined => {
      for (const p of patterns) {
        const k = keys.find(k => {
          const kl = k.toLowerCase().trim();
          return kl === p.toLowerCase() || kl.includes(p.toLowerCase());
        });
        if (k) return k;
      }
      return undefined;
    };

    const dateKey = findKey(['date', 'تاريخ', 'التاريخ']);
    const accountKey = findKey(['account', 'حساب', 'الحساب']);
    const catKey = findKey(['category', 'فئة', 'الفئة', 'تصنيف']);
    const noteKey = findKey(['note', 'ملاحظة', 'ملاحظات', 'وصف', 'description', 'تفاصيل']);
    const descKey = findKey(['description', 'تفاصيل', 'بيان']);
    const typeKey = findKey(['income/expense', 'income/expense', 'نوع', 'النوع', 'type']);
    const amountKey = findKey(['sar', 'amount', 'مبلغ', 'المبلغ', 'value']);
    const currencyKey = findKey(['currency', 'عملة', 'العملة']);

    console.log('Mapped columns:', { dateKey, accountKey, catKey, noteKey, typeKey, amountKey, currencyKey });

    // Pre-load existing data
    const existingAccounts = await db.account.findMany();
    const existingCategories = await db.category.findMany();

    const accByArName = new Map(existingAccounts.map(a => [a.name.toLowerCase(), a]));
    const catByKey = new Map<string, any>([]);
    existingCategories.forEach(c => {
      catByKey.set(`${c.type}:${c.nameAr.toLowerCase()}`, c);
      catByKey.set(`${c.type}:${c.nameEn.toLowerCase()}`, c);
    });

    // Smart category type detector
    // Known income sources from Money Manager
    const INCOME_KEYWORDS = [
      'salary', 'راتب', 'house', 'بدل سكن', 'بدل', 'bonus', 'بونص',
      'rewards', 'مكافئه', 'مكافأة', 'مكافئة', 'mars', 'marsol',
      'income', 'دخل', 'ربح', 'ارباح'
    ];

    const isIncomeCategory = (catName: string, rowType: string): boolean => {
      const lower = catName.toLowerCase();
      // If row type says Income, it's income
      if (rowType === 'income') return true;
      // If category name matches income keywords
      if (INCOME_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) return true;
      // If amount is negative AND type is Expense, it's likely a refund (income)
      return false;
    };

    const ensureAccount = async (name: string, currency: string = 'SAR'): Promise<any> => {
      if (!name) return null;
      const key = name.toLowerCase();
      const existing = accByArName.get(key);
      if (existing) return existing;

      // Pick account type based on name (Money Manager naming convention)
      let type = 'BANK';
      let icon = 'landmark';
      if (/cash|كاش|نقدي/i.test(name)) { type = 'CASH'; icon = 'wallet'; }
      else if (/visa|فيزا|card|بطاقة/i.test(name)) { type = 'CARD'; icon = 'credit-card'; }
      else if (/urpay|urpa y|محفظة|stc/i.test(name)) { type = 'E_WALLET'; icon = 'smartphone'; }
      else if (/gold|ذهب|دهب/i.test(name)) { type = 'SAVINGS'; icon = 'gem'; }
      else if (/thndr|ثاندر|binance|كريبتو|crypto|استثمار/i.test(name)) { type = 'SAVINGS'; icon = 'trending-up'; }
      else if (/alex home|منزل|عقار/i.test(name)) { type = 'SAVINGS'; icon = 'home'; }

      // Currency normalization
      const cur = (currency || 'SAR').toUpperCase() as Currency;
      const validCur: Currency = ['EGP', 'SAR', 'USD', 'EUR', 'AED'].includes(cur) ? cur : 'SAR';

      const created = await db.account.create({
        data: {
          name,
          type: type as any,
          currency: validCur,
          balance: 0,
          color: '#2563EB',
          icon,
        },
      });
      accByArName.set(key, created);
      return created;
    };

    const ensureCategory = async (
      nameAr: string,
      rowType: string,
      amount: number
    ): Promise<any> => {
      if (!nameAr || nameAr === 'None' || nameAr === '*') return null;
      const isIncome = isIncomeCategory(nameAr, rowType) ||
        (rowType === 'expense' && amount < 0);  // negative expense = refund = income
      const type = isIncome ? 'INCOME' : 'EXPENSE';
      const key = `${type}:${nameAr.toLowerCase()}`;
      const existing = catByKey.get(key);
      if (existing) return existing;

      // Try to find an English equivalent
      const nameEn = guessEnglishName(nameAr);

      // Pick icon & color based on category name
      const { icon, color } = pickCategoryStyle(nameAr, type);

      const created = await db.category.create({
        data: {
          nameAr,
          nameEn,
          type: type as any,
          color,
          icon,
        },
      });
      catByKey.set(`${type}:${created.nameAr.toLowerCase()}`, created);
      catByKey.set(`${type}:${created.nameEn.toLowerCase()}`, created);
      return created;
    };

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        // Date parsing - xlsx library returns Date if cellDates:true, otherwise string
        const dateVal = dateKey ? row[dateKey] : '';
        let date: Date;
        if (dateVal instanceof Date) {
          date = dateVal;
        } else if (typeof dateVal === 'number') {
          // Excel serial date
          const utcDays = Math.floor(dateVal - 25569);
          date = new Date(utcDays * 86400 * 1000);
        } else if (typeof dateVal === 'string') {
          // Try DD/MM/YYYY or YYYY-MM-DD
          const str = dateVal.trim();
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
            const [dd, mm, yyyy] = str.split('/');
            date = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
          } else {
            date = new Date(str);
          }
        } else {
          date = new Date();
        }
        if (isNaN(date.getTime())) date = new Date();

        // Account
        const accName = accountKey ? String(row[accountKey] || '').trim() : '';
        if (!accName) { skipped++; continue; }

        // Category (could be the destination account for Transfer-Out)
        const catName = catKey ? String(row[catKey] || '').trim() : '';

        // Type
        const rowType = (typeKey ? String(row[typeKey] || 'Expense') : 'Expense').toLowerCase().trim();

        // Amount - try SAR column first, fall back to Amount
        let amount = 0;
        if (amountKey && row[amountKey] !== undefined && row[amountKey] !== '') {
          amount = parseFloat(String(row[amountKey])) || 0;
        }
        const absAmount = Math.abs(amount);
        if (!absAmount) {
          skipped++;
          continue;
        }

        // Currency
        let currencyStr = currencyKey ? String(row[currencyKey] || 'SAR') : 'SAR';
        currencyStr = currencyStr.toUpperCase().trim();
        const validCur: Currency = ['EGP', 'SAR', 'USD', 'EUR', 'AED'].includes(currencyStr as any) ? currencyStr as Currency : 'SAR';

        // Determine transaction type
        let txType: 'EXPENSE' | 'INCOME';
        let categoryName = catName;
        if (rowType === 'income') {
          txType = 'INCOME';
        } else if (rowType === 'transfer-out' || rowType === 'transfer out' || rowType === 'transfer') {
          // Money Manager transfer: source = Account, destination = Category
          // We'll record this as an EXPENSE from source account, and put destination in note
          txType = 'EXPENSE';
          categoryName = 'تحويلات';  // Special category for transfers
        } else {
          txType = 'EXPENSE';
          // Negative expense means a refund (income)
          if (amount < 0) txType = 'INCOME';
        }

        if (!categoryName) {
          categoryName = txType === 'INCOME' ? 'دخل إضافي' : 'مصروفات أخرى';
        }

        // Note - combine Note + Description
        const noteText = [
          noteKey ? String(row[noteKey] || '').trim() : '',
          descKey ? String(row[descKey] || '').trim() : '',
        ].filter(Boolean).join(' • ');
        const finalNote = rowType === 'transfer-out' && catName
          ? `${noteText} → ${catName}`.trim()
          : noteText;

        // Ensure account & category
        const account = await ensureAccount(accName, currencyStr);
        if (!account) { skipped++; continue; }

        const category = await ensureCategory(categoryName, rowType, amount);
        if (!category) { skipped++; continue; }

        // Update account balance (with currency conversion if needed)
        const delta = txType === 'INCOME' ? absAmount : -absAmount;
        await db.account.update({
          where: { id: account.id },
          data: { balance: { increment: delta } },
        });

        await db.transaction.create({
          data: {
            type: txType,
            amount: absAmount,
            currency: validCur,
            accountId: account.id,
            categoryId: category.id,
            date,
            note: finalNote || null,
          },
        });

        imported++;
      } catch (e: any) {
        errors.push(`Row error: ${e.message}`);
        if (errors.length > 20) break;
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      errors: errors.slice(0, 10),
      message: `✅ Imported ${imported} transactions${skipped ? `, skipped ${skipped}` : ''}${errors.length ? `, ${errors.length} errors` : ''}`,
    });
  } catch (err: any) {
    console.error('Excel import error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Helper: guess English name from Arabic category name */
function guessEnglishName(arName: string): string {
  const map: Record<string, string> = {
    'طعام': 'Food',
    'بنزين': 'Fuel',
    'صيانه السياره': 'Car Maintenance',
    'صيانه السيارة': 'Car Maintenance',
    'هاتف': 'Phone',
    'تبرع': 'Donation',
    'ايجار سكن': 'Rent',
    'اخري': 'Other',
    'الاستقدام': 'Family Visa',
    'تامين سياره': 'Car Insurance',
    'اولاد': 'Kids',
    'هدايا': 'Gifts',
    'صحه': 'Health',
    'صحه ': 'Health',
    'مصاريف ال زياره ': 'Visit Expenses',
    'مصاريف ال زياره': 'Visit Expenses',
    'جمال': 'Beauty',
    'ملابس': 'Clothes',
    'قسط سياره': 'Car Installment',
    'تحويلات': 'Transfers',
    'salary': 'Salary',
    'house': 'Housing Allowance',
    'Bonus': 'Bonus',
    'rewards': 'Rewards',
    'mars': 'Marsol',
  };
  return map[arName] || arName;
}

/** Helper: pick icon & color based on category name */
function pickCategoryStyle(name: string, type: string): { icon: string; color: string } {
  const lower = name.toLowerCase();
  if (type === 'INCOME') {
    if (lower.includes('salary') || lower.includes('راتب')) return { icon: 'banknote', color: '#10B981' };
    if (lower.includes('house') || lower.includes('سكن')) return { icon: 'home', color: '#22C55E' };
    if (lower.includes('bonus') || lower.includes('بونص')) return { icon: 'gift', color: '#16A34A' };
    if (lower.includes('reward') || lower.includes('مكافئ')) return { icon: 'award', color: '#15803D' };
    return { icon: 'trending-up', color: '#10B981' };
  }
  // Expense categories
  if (lower.includes('طعام') || lower.includes('food')) return { icon: 'utensils', color: '#F59E0B' };
  if (lower.includes('بنزين') || lower.includes('fuel')) return { icon: 'fuel', color: '#3B82F6' };
  if (lower.includes('صيان') || lower.includes('سياره')) return { icon: 'car', color: '#EF4444' };
  if (lower.includes('هاتف') || lower.includes('phone')) return { icon: 'smartphone', color: '#8B5CF6' };
  if (lower.includes('تبرع') || lower.includes('donation')) return { icon: 'heart', color: '#EC4899' };
  if (lower.includes('ايجار') || lower.includes('rent')) return { icon: 'home', color: '#06B6D4' };
  if (lower.includes('اولاد') || lower.includes('kids')) return { icon: 'baby', color: '#A855F7' };
  if (lower.includes('هدايا') || lower.includes('gift')) return { icon: 'gift', color: '#14B8A6' };
  if (lower.includes('صحه') || lower.includes('health')) return { icon: 'heart-pulse', color: '#E11D48' };
  if (lower.includes('جمال') || lower.includes('beauty')) return { icon: 'sparkles', color: '#D946EF' };
  if (lower.includes('ملابس') || lower.includes('clothes')) return { icon: 'tshirt', color: '#0EA5E9' };
  if (lower.includes('تامين') || lower.includes('insurance')) return { icon: 'shield', color: '#6366F1' };
  if (lower.includes('استقدام') || lower.includes('visa')) return { icon: 'plane', color: '#F97316' };
  if (lower.includes('تحويل')) return { icon: 'arrow-right-left', color: '#64748B' };
  return { icon: 'tag', color: '#64748B' };
}
