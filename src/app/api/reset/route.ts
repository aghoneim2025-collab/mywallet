import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// POST /api/reset - Delete ALL data FOR AUTHENTICATED USER ONLY
export async function POST(req: NextRequest) {
  try {
    const userId = requireAuth(req);

    // Delete ONLY this user's data
    const txCount = await db.transaction.count({ where: { userId } });
    const budgetCount = await db.budget.count({ where: { userId } });

    await db.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.budget.deleteMany({ where: { userId } });
      try { await (tx as any).recurringTransaction.deleteMany({ where: { userId } }); } catch {}
      try { await (tx as any).savingsGoal.deleteMany({ where: { userId } }); } catch {}
      try { await (tx as any).billReminder.deleteMany({ where: { userId } }); } catch {}

      // Reset account balances to 0 for this user
      const accounts = await tx.account.findMany({ where: { userId } });
      for (const acc of accounts) {
        await tx.account.update({ where: { id: acc.id }, data: { balance: 0 } });
      }
    });

    return NextResponse.json({
      success: true,
      deleted: { transactions: txCount, budgets: budgetCount },
      message: `Deleted ${txCount} transactions, ${budgetCount} budgets`,
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
