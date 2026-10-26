import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import { parseString, isCategoryType, badRequest } from '@/lib/validate';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    // Verify ownership FIRST
    const existing = await db.category.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const { nameAr, nameEn, type, icon, color } = body;
    const updated = await db.category.update({ where: { id }, data: {
      ...(nameAr !== undefined ? { nameAr } : {}),
      ...(nameEn !== undefined ? { nameEn } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(color !== undefined ? { color } : {}),
    }});
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    // Verify ownership FIRST
    const category = await db.category.findFirst({ where: { id, userId } });
    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const txCount = await db.transaction.count({ where: { categoryId: id, userId } });
    if (txCount > 0) {
      return NextResponse.json({ error: `Cannot delete: ${txCount} transactions` }, { status: 400 });
    }
    await db.budget.deleteMany({ where: { categoryId: id } });
    await db.category.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
