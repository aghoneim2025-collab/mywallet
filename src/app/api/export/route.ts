import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/export?format=csv|json&month=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'csv';
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

    if (format === 'json') {
      return NextResponse.json({ data: transactions });
    }

    // CSV
    const headers = ['Date', 'Type', 'Amount', 'Currency', 'Account', 'Category', 'Note'];
    const rows = transactions.map(t => [
      t.date.toISOString().slice(0, 10),
      t.type,
      t.amount.toString(),
      t.currency,
      t.account.name,
      t.category.nameAr,
      (t.note || '').replace(/,/g, ' '),
    ]);

    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${c}"`).join(','))
      .join('\n');

    return new NextResponse('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="transactions-${month || 'all'}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
