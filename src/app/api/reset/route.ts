import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/reset - Delete ALL data (transactions, budgets, accounts, categories)
export async function POST() {
  try {
    // Delete in order (respecting foreign keys)
    const txCount = await db.transaction.count();
    const budgetCount = await db.budget.count();
    const recurringCount = await db.recurringTransaction?.count?.() || 0;
    const savingsCount = await db.savingsGoal?.count?.() || 0;
    const billCount = await db.billReminder?.count?.() || 0;

    await db.transaction.deleteMany({});
    await db.budget.deleteMany({});
    
    // Delete optional tables if they exist
    try { await (db as any).recurringTransaction.deleteMany({}); } catch {}
    try { await (db as any).savingsGoal.deleteMany({}); } catch {}
    try { await (db as any).billReminder.deleteMany({}); } catch {}

    // Don't delete accounts and categories - keep them for reuse
    // But reset account balances to 0
    const accounts = await db.account.findMany();
    for (const acc of accounts) {
      await db.account.update({
        where: { id: acc.id },
        data: { balance: 0 },
      });
    }

    return NextResponse.json({
      success: true,
      deleted: {
        transactions: txCount,
        budgets: budgetCount,
        recurring: recurringCount,
        savingsGoals: savingsCount,
        billReminders: billCount,
      },
      message: `Deleted ${txCount} transactions, ${budgetCount} budgets`,
    });
  } catch (err: any) {
    console.error('Reset error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
