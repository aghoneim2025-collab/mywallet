import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/budget-alerts?month=YYYY-MM
// Returns alerts for categories approaching or exceeding budget
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);

    const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);

    const budgets = await db.budget.findMany({
      where: { month },
      include: { category: true },
    });

    const spent = await db.transaction.groupBy({
      by: ['categoryId'],
      where: {
        type: 'EXPENSE',
        date: { gte: startOfMonth, lt: endOfMonth },
      },
      _sum: { amount: true },
    });

    const spentMap = new Map(spent.map(s => [s.categoryId, s._sum.amount || 0]));

    const alerts = budgets.map(b => {
      const spentAmount = spentMap.get(b.categoryId) || 0;
      const pct = b.limit > 0 ? (spentAmount / b.limit) * 100 : 0;
      let level: 'ok' | 'warning' | 'danger' | 'over' = 'ok';
      if (pct >= 100) level = 'over';
      else if (pct >= 90) level = 'danger';
      else if (pct >= 75) level = 'warning';

      return {
        categoryId: b.categoryId,
        categoryName: b.category.nameAr,
        categoryNameEn: b.category.nameEn,
        color: b.category.color,
        icon: b.category.icon,
        limit: b.limit,
        spent: spentAmount,
        remaining: b.limit - spentAmount,
        percentage: pct,
        level,
      };
    }).filter(a => a.level !== 'ok'); // Only return alerts (not OK)

    return NextResponse.json({ data: alerts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
