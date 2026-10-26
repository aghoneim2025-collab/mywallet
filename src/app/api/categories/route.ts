import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError, ValidationError } from '@/lib/api-errors';
import { parseString, isCategoryType, badRequest } from '@/lib/validate';

// GET /api/categories - user-scoped
export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const url = new URL(req.url);
    const type = url.searchParams.get('type');
    const categories = await db.category.findMany({
      where: { userId, ...(type ? { type: type as any } : {}) },
      orderBy: [{ isDefault: 'desc' }, { type: 'asc' }],
    });
    return NextResponse.json({ data: categories });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

// POST /api/categories - user-scoped
// P0.21: actually USE validators (was: imported but never called)
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { nameAr, nameEn, type, icon, color, id } = body || {};

    // P0.21: validate inputs using the centralized validators
    const nameArResult = parseString(nameAr, 'nameAr', { min: 1, max: 200 });
    if (!nameArResult.ok) return badRequest(nameArResult.error);
    const nameEnResult = parseString(nameEn, 'nameEn', { min: 1, max: 200 });
    if (!nameEnResult.ok) return badRequest(nameEnResult.error);
    if (!isCategoryType(type)) {
      return badRequest('Type must be EXPENSE or INCOME (TRANSFER is reserved for the transfer route)');
    }
    const colorResult = parseString(color, 'color', { required: false, max: 20 });
    if (!colorResult.ok) return badRequest(colorResult.error);
    const iconResult = parseString(icon, 'icon', { required: false, max: 100 });
    if (!iconResult.ok) return badRequest(iconResult.error);

    // If id is provided, this is an update (legacy pattern — should use PUT instead)
    if (id) {
      // P0.21: block type change if transactions exist
      if (type) {
        const existing = await db.category.findFirst({ where: { id, userId } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if (type !== existing.type) {
          const txCount = await db.transaction.count({ where: { categoryId: id, userId } });
          if (txCount > 0) {
            return NextResponse.json(
              { error: `Cannot change type: ${txCount} transaction(s) reference this category.` },
              { status: 400 },
            );
          }
        }
      }
      const updated = await db.category.update({
        where: { id },
        data: {
          nameAr: nameArResult.value,
          nameEn: nameEnResult.value,
          type,
          icon: iconResult.value || 'tag',
          color: colorResult.value || '#10B981',
        },
      });
      return NextResponse.json({ data: updated });
    }

    const category = await db.category.create({
      data: {
        nameAr: nameArResult.value,
        nameEn: nameEnResult.value,
        type,
        icon: iconResult.value || 'tag',
        color: colorResult.value || '#10B981',
        userId,
      },
    });
    return NextResponse.json({ data: category });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
