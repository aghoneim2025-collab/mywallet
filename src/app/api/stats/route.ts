import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EXCHANGE_RATES, type Currency } from '@/lib/currency';

// GET /api/stats?month=YYYY-MM&baseCurrency=EGP
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    const baseCurrency = (url.searchParams.get('baseCurrency') || 'EGP') as Currency;

    let start: Date;
    let end: Date;
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
      where: { date: { gte: start, lt: end } },
      include: { category: true, account: true },
    });

    const accounts = await db.account.findMany();

    // Helper: convert from tx currency to base currency
    const toBase = (amount: number, from: string) => {
      const fromCur = (from as Currency) || 'EGP';
      if (fromCur === baseCurrency) return amount;
      const inEgp = amount * EXCHANGE_RATES[fromCur];
      return inEgp / EXCHANGE_RATES[baseCurrency];
    };

    // Exclude transfers (both TRANSFER type AND "تحويلات" category from old Money Manager import)
    const isTransfer = (t: any) =>
      t.type === 'TRANSFER' ||
      t.category?.nameAr === 'تحويلات' ||
      t.category?.nameEn === 'Transfers';

    const expenses = transactions.filter(t => t.type === 'EXPENSE' && !isTransfer(t));
    const incomes = transactions.filter(t => t.type === 'INCOME' && !isTransfer(t));
    const transfers = transactions.filter(t => isTransfer(t));

    const totalExpense = expenses.reduce((s, t) => s + toBase(t.amount, t.currency), 0);
    const totalIncome = incomes.reduce((s, t) => s + toBase(t.amount, t.currency), 0);
    const totalTransfers = transfers.reduce((s, t) => s + toBase(t.amount, t.currency), 0);
    const balance = totalIncome - totalExpense;

    // total assets = sum of account balances converted to base
    const totalAssets = accounts.reduce(
      (s, a) => s + toBase(a.balance, a.currency),
      0
    );

    // تجميع حسب الفئة (مع تحويل)
    const byCategoryMap: Record<string, { total: number; count: number; category: any }> = {};
    expenses.forEach(t => {
      const cid = t.categoryId;
      if (!byCategoryMap[cid]) byCategoryMap[cid] = { total: 0, count: 0, category: t.category };
      byCategoryMap[cid].total += toBase(t.amount, t.currency);
      byCategoryMap[cid].count += 1;
    });

    // تجميع يومي للـ chart (مع تحويل)
    const daysInMonth = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    const byDay: { date: string; expense: number; income: number }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${month || start.toISOString().slice(0, 7)}-${String(day).padStart(2, '0')}`;
      byDay.push({ date: dateStr, expense: 0, income: 0 });
    }
    transactions.forEach(t => {
      const day = t.date.getDate();
      const idx = day - 1;
      if (idx >= 0 && idx < byDay.length) {
        if (t.type === 'EXPENSE') byDay[idx].expense += toBase(t.amount, t.currency);
        else byDay[idx].income += toBase(t.amount, t.currency);
      }
    });

    return NextResponse.json({
      data: {
        totalExpense,
        totalIncome,
        totalTransfers,
        balance,
        totalAssets,
        baseCurrency,
        expenseCount: expenses.length,
        incomeCount: incomes.length,
        transferCount: transfers.length,
        byCategory: Object.values(byCategoryMap).sort((a: any, b: any) => b.total - a.total),
        byDay,
        month: month || start.toISOString().slice(0, 7),
      },
    });
  } catch (err: any) {
    console.error('GET /api/stats error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
