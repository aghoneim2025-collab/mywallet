import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/accounts
export async function GET() {
  try {
    const accounts = await db.account.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ data: accounts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/accounts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, type, currency, balance, color, icon } = body;
    if (!name || !type || !currency) {
      return NextResponse.json(
        { error: 'name, type, currency are required' },
        { status: 400 }
      );
    }

    // إذا كان isDefault = true، انقل الافتراضي القديم
    if (body.isDefault) {
      const oldDefault = await db.account.findFirst({ where: { isDefault: true } });
      if (oldDefault) {
        await db.account.update({ where: { id: oldDefault.id }, data: { isDefault: false } });
      }
    }

    const account = await db.account.create({
      data: {
        name,
        type,
        currency,
        balance: Number(balance) || 0,
        color: color || '#2563EB',
        icon: icon || 'wallet',
        isDefault: body.isDefault || false,
      },
    });
    return NextResponse.json({ data: account });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
