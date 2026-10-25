import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    // Verify ownership FIRST
    const account = await db.account.findFirst({ where: { id, userId } });
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const { name, type, currency, balance, color, icon, isDefault } = body;
    if (isDefault) {
      const old = await db.account.findFirst({ where: { isDefault: true, userId, NOT: { id } } });
      if (old) await db.account.update({ where: { id: old.id }, data: { isDefault: false } });
    }
    const updated = await db.account.update({ where: { id }, data: {
      ...(name !== undefined ? { name } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(currency !== undefined ? { currency } : {}),
      ...(balance !== undefined ? { balance: Number(balance) } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(isDefault !== undefined ? { isDefault } : {}),
    }});
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = requireAuth(req);
    const { id } = await params;
    // Verify ownership FIRST before any operation
    const account = await db.account.findFirst({ where: { id, userId } });
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Check transactions (both as source AND destination for transfers)
    const txCount = await db.transaction.count({
      where: { OR: [{ accountId: id }, { toAccountId: id }], userId }
    });
    if (txCount > 0) {
      return NextResponse.json({ error: `Cannot delete: ${txCount} transactions linked` }, { status: 400 });
    }

    // Delete budgets linked to categories of this account (fixed: was using categoryId: id incorrectly)
    await db.account.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
