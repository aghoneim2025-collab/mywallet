import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/categories?type=EXPENSE|INCOME
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type');
    const categories = await db.category.findMany({
      where: type ? { type: type as any } : {},
      orderBy: [{ isDefault: 'desc' }, { type: 'asc' }],
    });
    return NextResponse.json({ data: categories });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/categories
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nameAr, nameEn, type, icon, color, id } = body;

    if (!nameAr || !nameEn || !type) {
      return NextResponse.json(
        { error: 'nameAr, nameEn, type are required' },
        { status: 400 }
      );
    }

    // update existing?
    if (id) {
      const updated = await db.category.update({
        where: { id },
        data: {
          nameAr,
          nameEn,
          type,
          icon: icon || 'tag',
          color: color || '#10B981',
        },
      });
      return NextResponse.json({ data: updated });
    }

    const category = await db.category.create({
      data: {
        nameAr,
        nameEn,
        type,
        icon: icon || 'tag',
        color: color || '#10B981',
      },
    });
    return NextResponse.json({ data: category });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
