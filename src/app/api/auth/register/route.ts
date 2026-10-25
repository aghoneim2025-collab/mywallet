import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, generateToken, setAuthCookie } from '@/lib/auth';

// POST /api/auth/register
// Body: { email, password, name }
export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    // Create user + default categories + account IN ONE TRANSACTION (atomic)
    const passwordHash = await hashPassword(password);

    const result = await db.$transaction(async (tx) => {
      // 1. Create user
      const user = await tx.user.create({
        data: { email: normalizedEmail, name: name || null, passwordHash },
      });

      // 2. Create default categories for this user
      const defaultCategories = [
        { nameAr: 'مصاريف أساسية', nameEn: 'Essentials', type: 'EXPENSE', icon: 'home', color: '#EF4444', userId: user.id },
        { nameAr: 'تسوق وطعام', nameEn: 'Shopping & Food', type: 'EXPENSE', icon: 'shopping-cart', color: '#F59E0B', userId: user.id },
        { nameAr: 'مواصلات', nameEn: 'Transportation', type: 'EXPENSE', icon: 'car', color: '#3B82F6', userId: user.id },
        { nameAr: 'صحة ورعاية', nameEn: 'Health & Care', type: 'EXPENSE', icon: 'heart-pulse', color: '#EC4899', userId: user.id },
        { nameAr: 'تعليم وتطوير', nameEn: 'Education', type: 'EXPENSE', icon: 'graduation-cap', color: '#8B5CF6', userId: user.id },
        { nameAr: 'سفر وترفيه', nameEn: 'Travel & Fun', type: 'EXPENSE', icon: 'plane', color: '#06B6D4', userId: user.id },
        { nameAr: 'اشتراكات وهدايا', nameEn: 'Subscriptions & Gifts', type: 'EXPENSE', icon: 'gift', color: '#14B8A6', userId: user.id },
        { nameAr: 'راتب أساسي', nameEn: 'Salary', type: 'INCOME', icon: 'banknote', color: '#10B981', userId: user.id },
        { nameAr: 'دخل فريلانس', nameEn: 'Freelance', type: 'INCOME', icon: 'laptop', color: '#22C55E', userId: user.id },
        { nameAr: 'دخل استثماري', nameEn: 'Investment', type: 'INCOME', icon: 'trending-up', color: '#16A34A', userId: user.id },
      ];

      for (const cat of defaultCategories) {
        await tx.category.create({ data: cat });
      }

      // 3. Create default cash account
      await tx.account.create({
        data: {
          name: 'محفظتي',
          type: 'CASH',
          currency: 'EGP',
          balance: 0,
          color: '#2563EB',
          icon: 'wallet',
          isDefault: true,
          userId: user.id,
        },
      });

      return user;
    });

    const token = generateToken(result.id);
    const response = NextResponse.json({
      data: { id: result.id, email: result.email, name: result.name, token },
    });
    return setAuthCookie(response, token);
  } catch (err: any) {
    console.error('Register error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
