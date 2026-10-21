import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// PUT /api/accounts/:id
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, type, currency, balance, color, icon, isDefault } = body;

    if (isDefault) {
      const oldDefault = await db.account.findFirst({ where: { isDefault: true, NOT: { id } } });
      if (oldDefault) {
        await db.account.update({ where: { id: oldDefault.id }, data: { isDefault: false } });
      }
    }

    const updated = await db.account.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(balance !== undefined ? { balance: Number(balance) } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
    });
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/accounts/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const txCount = await db.transaction.count({ where: { accountId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete account with transactions. Move or delete them first.' },
        { status: 400 }
      );
    }
    await db.account.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
