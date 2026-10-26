import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';

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
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { nameAr, nameEn, type, icon, color, id } = body;
    if (!nameAr || !nameEn || !type) {
      return NextResponse.json({ error: 'nameAr, nameEn, type required' }, { status: 400 });
    }

    if (id) {
      const existing = await db.category.findFirst({ where: { id, userId } });
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const updated = await db.category.update({
        where: { id },
        data: { nameAr, nameEn, type, icon: icon || 'tag', color: color || '#10B981' },
      });
      return NextResponse.json({ data: updated });
    }

    const category = await db.category.create({
      data: { nameAr, nameEn, type, icon: icon || 'tag', color: color || '#10B981', userId },
    });
    return NextResponse.json({ data: category });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
