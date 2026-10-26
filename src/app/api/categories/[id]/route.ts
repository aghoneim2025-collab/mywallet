import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError, ValidationError } from '@/lib/api-errors';
import { parseString, isCategoryType, badRequest } from '@/lib/validate';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    const existing = await db.category.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const { nameAr, nameEn, type, icon, color } = body || {};

    // P0.21: actually USE the validators (was: imported but never called)
    if (nameAr !== undefined) {
      const r = parseString(nameAr, 'nameAr', { min: 1, max: 200 });
      if (!r.ok) return badRequest(r.error);
    }
    if (nameEn !== undefined) {
      const r = parseString(nameEn, 'nameEn', { min: 1, max: 200 });
      if (!r.ok) return badRequest(r.error);
    }
    if (type !== undefined) {
      if (!isCategoryType(type)) {
        return badRequest('Type must be EXPENSE or INCOME (TRANSFER is reserved)');
      }
      // P0.21: block type change if transactions exist
      if (type !== existing.type) {
        const txCount = await db.transaction.count({ where: { categoryId: id, userId } });
        if (txCount > 0) {
          return NextResponse.json(
            { error: `Cannot change type: ${txCount} transaction(s) reference this category. ` +
              'Changing the type would alter historical meaning. Delete those transactions first.' },
            { status: 400 },
          );
        }
      }
    }
    if (color !== undefined) {
      const r = parseString(color, 'color', { required: false, max: 20 });
      if (!r.ok) return badRequest(r.error);
    }
    if (icon !== undefined) {
      const r = parseString(icon, 'icon', { required: false, max: 100 });
      if (!r.ok) return badRequest(r.error);
    }

    const updated = await db.category.update({
      where: { id },
      data: {
        ...(nameAr !== undefined ? { nameAr } : {}),
        ...(nameEn !== undefined ? { nameEn } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    });
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthAsync(req);
    const { id } = await params;
    const category = await db.category.findFirst({ where: { id, userId } });
    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // P0.21: count + budget cleanup + delete ALL inside one $transaction
    // (was: count outside, budget delete separate, category delete separate)
    await db.$transaction(async (tx) => {
      const txCount = await tx.transaction.count({ where: { categoryId: id, userId } });
      if (txCount > 0) {
        throw new ValidationError(`Cannot delete: ${txCount} transaction(s) reference this category.`);
      }
      await tx.budget.deleteMany({ where: { categoryId: id } });
      await tx.category.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
