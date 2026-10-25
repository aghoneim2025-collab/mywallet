import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// POST /api/reset - Delete user's transactions + budgets, reset account balances
export async function POST(req: NextRequest) {
  try {
    const userId = requireAuth(req);

    const txCount = await db.transaction.count({ where: { userId } });
    const budgetCount = await db.budget.count({ where: { userId } });

    await db.$transaction(async (tx) => {
      // Delete only models that HAVE userId in schema
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.budget.deleteMany({ where: { userId } });

      // Reset account balances to 0 (keep accounts + categories for reuse)
      const accounts = await tx.account.findMany({ where: { userId } });
      for (const acc of accounts) {
        await tx.account.update({ where: { id: acc.id }, data: { balance: 0 } });
      }
    });

    return NextResponse.json({
      success: true,
      deleted: { transactions: txCount, budgets: budgetCount },
      message: `Deleted ${txCount} transactions, ${budgetCount} budgets. Accounts reset to 0. Categories kept.`,
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
