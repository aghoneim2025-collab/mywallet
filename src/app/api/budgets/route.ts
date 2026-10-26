import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import { convertServer as convert, type Currency } from '@/lib/currency';
import { parseMoney, isCurrency, parseString, badRequest } from '@/lib/validate';

// P0.11 fixes:
//   - GET spent: convert per-transaction amount to budget.currency before summing
//     (was: silently summed raw amounts across currencies → meaningless total)
//   - Validate month format (YYYY-MM)
//   - Validate currency enum
//   - Validate limit (NaN/Infinity, positive)

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    // P0.11: validate month format if provided
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return badRequest('Invalid month format (expected YYYY-MM)');
    }
    const where: any = { userId };
    if (month) where.month = month;
    const budgets = await db.budget.findMany({ where, include: { category: true } });
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);

      // P0.11: fetch transactions individually so we can convert each to budget.currency.
      // Was: db.transaction.groupBy which sums raw amounts across currencies.
      // This is slower than groupBy but correct for multi-currency.
      const txns = await db.transaction.findMany({
        where: { type: 'EXPENSE', date: { gte: start, lt: end }, userId },
        select: { categoryId: true, amount: true, currency: true },
      });

      // Group by category, converting each transaction's amount to budget.currency
      const spentByCategory = new Map<string, number>();
      for (const t of txns) {
        const budget = budgets.find(b => b.categoryId === t.categoryId);
        const targetCurrency: Currency = budget?.currency || 'EGP';
        const converted = t.currency === targetCurrency
          ? t.amount
          : convert(t.amount, t.currency, targetCurrency);
        if (!Number.isFinite(converted)) continue;  // skip bad rows
        spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) || 0) + converted);
      }

      return NextResponse.json({
        data: budgets.map(b => ({
          ...b,
          spent: spentByCategory.get(b.categoryId) || 0,
        })),
      });
    }
    return NextResponse.json({ data: budgets });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { categoryId, month, limit, currency } = body || {};

    if (typeof categoryId !== 'string' || categoryId.length < 10) {
      return badRequest('Invalid categoryId');
    }
    // P0.11: validate month format (was: any string)
    if (typeof month !== 'string') return badRequest('Invalid month format');
    {
      const m = month.match(/^\d{4}-\d{2}$/);
      if (!m) return badRequest('Invalid month format (expected YYYY-MM)');
      const mon = parseInt(m[2], 10);
      if (mon < 1 || mon > 12) return badRequest(`Invalid month: ${m[2]} (must be 01-12)`);
    }
    // P0.11: use parseMoney for limit
    const limitResult = parseMoney(limit, { allowZero: false, allowNegative: false });
    if (!limitResult.ok) return badRequest(limitResult.error);
    const limitNum = limitResult.value;

    // P0.11: validate currency enum
    const budgetCurrency = currency || 'EGP';
    if (!isCurrency(budgetCurrency)) {
      return badRequest('Invalid currency (must be EGP, SAR, USD, EUR, or AED)');
    }

    // Verify category ownership
    const category = await db.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

    const existing = await db.budget.findFirst({ where: { categoryId, month, userId } });
    if (existing) {
      const updated = await db.budget.update({
        where: { id: existing.id },
        data: { limit: limitNum, currency: budgetCurrency },
        include: { category: true },
      });
      return NextResponse.json({ data: updated });
    }
    const created = await db.budget.create({
      data: { categoryId, month, limit: limitNum, currency: budgetCurrency, userId },
      include: { category: true },
    });
    return NextResponse.json({ data: created });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id || typeof id !== 'string') return badRequest('id required');
    const budget = await db.budget.findFirst({ where: { id, userId } });
    if (!budget) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await db.budget.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
