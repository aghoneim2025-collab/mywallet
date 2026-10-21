import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// PUT /api/categories/:id
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { nameAr, nameEn, type, icon, color } = body;

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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/categories/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // لو الفئة عليها معاملات، ارفض الحذف
    const txCount = await db.transaction.count({ where: { categoryId: id } });
    if (txCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category with ${txCount} transactions. Move or delete them first.` },
        { status: 400 }
      );
    }
    // لو عليها ميزانية، امسح الميزانية كمان
    await db.budget.deleteMany({ where: { categoryId: id } });
    await db.category.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
