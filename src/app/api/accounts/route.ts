import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';

// GET /api/accounts - user-scoped
export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const accounts = await db.account.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ data: accounts });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

// POST /api/accounts - user-scoped
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { name, type, currency, balance, color, icon, isDefault } = body;
    if (!name || !type || !currency) {
      return NextResponse.json({ error: 'name, type, currency required' }, { status: 400 });
    }

    if (isDefault) {
      const oldDefault = await db.account.findFirst({ where: { isDefault: true, userId } });
      if (oldDefault) {
        await db.account.update({ where: { id: oldDefault.id }, data: { isDefault: false } });
      }
    }

    const account = await db.account.create({
      data: {
        name, type, currency,
        balance: Number(balance) || 0,
        color: color || '#2563EB',
        icon: icon || 'wallet',
        isDefault: isDefault || false,
        userId,
      },
    });
    return NextResponse.json({ data: account });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
