import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerExchangeRates, type Currency } from '@/lib/currency';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import { isCurrency, parseDate, badRequest } from '@/lib/validate';

// GET /api/stats?month=YYYY-MM&baseCurrency=EGP
export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    if (month && !/^\d{4}-\d{2}$/.test(month)) return badRequest('Invalid month format (expected YYYY-MM)');
    const baseCurrencyRaw = url.searchParams.get('baseCurrency') || 'EGP';
    if (!isCurrency(baseCurrencyRaw)) return badRequest('Invalid baseCurrency');
    const baseCurrency = baseCurrencyRaw as Currency;

    let start: Date, end: Date;
    if (month) {
      start = new Date(`${month}-01T00:00:00.000Z`);
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    } else {
      start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    }

    const transactions = await db.transaction.findMany({
      where: { date: { gte: start, lt: end }, userId },
      include: { category: true, account: true },
    });

    const accounts = await db.account.findMany({ where: { userId } });

    // P0.15: use server-side rates (was: EXCHANGE_RATES module-level which
    // could be polluted by client-side code).
    const rates = getServerExchangeRates();
    const toBase = (amount: number, from: string) => {
      const fromCur = (from as Currency) || 'EGP';
      if (fromCur === baseCurrency) return amount;
      const inEgp = amount * rates[fromCur];
      return inEgp / rates[baseCurrency as Currency];
    };

    // Exclude transfers from BOTH expense and income
    const isTransfer = (t: any) =>
      t.type === 'TRANSFER' ||
      t.category?.nameAr === 'تحويلات' ||
      t.category?.nameEn === 'Transfers';

    const expenses = transactions.filter(t => t.type === 'EXPENSE' && !isTransfer(t));
    const incomes = transactions.filter(t => t.type === 'INCOME' && !isTransfer(t));

    const totalExpense = expenses.reduce((s, t) => s + toBase(t.amount, t.currency), 0);
    const totalIncome = incomes.reduce((s, t) => s + toBase(t.amount, t.currency), 0);

    // Total assets: exclude LOAN type
    const totalAssets = accounts
      .filter(a => a.type !== 'LOAN')
      .reduce((s, a) => s + toBase(a.balance, a.currency), 0);
    const totalLiabilities = accounts
      .filter(a => a.type === 'LOAN' && a.balance < 0)
      .reduce((s, a) => s + Math.abs(toBase(a.balance, a.currency)), 0);

    const byCategoryMap: Record<string, { total: number; count: number; category: any }> = {};
    expenses.forEach(t => {
      const cid = t.categoryId;
      if (!byCategoryMap[cid]) byCategoryMap[cid] = { total: 0, count: 0, category: t.category };
      byCategoryMap[cid].total += toBase(t.amount, t.currency);
      byCategoryMap[cid].count += 1;
    });

    // Daily chart: exclude transfers
    const daysInMonth = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    const byDay: { date: string; expense: number; income: number }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${month || start.toISOString().slice(0, 7)}-${String(day).padStart(2, '0')}`;
      byDay.push({ date: dateStr, expense: 0, income: 0 });
    }
    transactions.forEach(t => {
      if (isTransfer(t)) return; // Exclude transfers from daily chart too
      const day = t.date.getDate();
      const idx = day - 1;
      if (idx >= 0 && idx < byDay.length) {
        if (t.type === 'EXPENSE') byDay[idx].expense += toBase(t.amount, t.currency);
        else if (t.type === 'INCOME') byDay[idx].income += toBase(t.amount, t.currency);
      }
    });

    return NextResponse.json({
      data: {
        totalExpense,
        totalIncome,
        balance: totalIncome - totalExpense,
        totalAssets,
        totalLiabilities,
        net: totalAssets - totalLiabilities,
        baseCurrency,
        expenseCount: expenses.length,
        incomeCount: incomes.length,
        byCategory: Object.values(byCategoryMap).sort((a: any, b: any) => b.total - a.total),
        byDay,
        month: month || start.toISOString().slice(0, 7),
      },
    });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
