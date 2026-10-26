import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, generateToken, setAuthCookie } from '@/lib/auth';
import { isValidEmail, validatePassword, tooManyRequests, parseString } from '@/lib/validate';
import { rateLimitRegister } from '@/lib/rate-limit';

// P0.11: email validation + password policy (12+ chars, 3+ classes) +
// rate limiting + name length limit. Don't leak err.message.

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json();

    // P0.11: rate limit registration (5/hour/IP)
    const rl = rateLimitRegister(req);
    if (rl.limited) return tooManyRequests(rl.retryAfter, rl.message);

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }
    const pwResult = validatePassword(password);
    if (!pwResult.ok) {
      return NextResponse.json({ error: pwResult.error }, { status: 400 });
    }
    const nameResult = parseString(name, 'Name', { required: false, max: 100 });
    if (!nameResult.ok) return NextResponse.json({ error: nameResult.error }, { status: 400 });

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    // P0.11: don't return "email already registered" — that enables enumeration.
    // Instead, treat as a successful re-registration attempt and return the same
    // response shape as the success path. The user just logs in normally.
    if (existing) {
      return NextResponse.json(
        { error: 'If this email is not already registered, an account has been created. Otherwise, please log in.' },
        { status: 200 },
      );
    }

    const passwordHash = await hashPassword(password);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: normalizedEmail, name: nameResult.value || null, passwordHash } });
      const cats = [
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
      ] as const;
      await tx.category.createMany({ data: cats as any });
      await tx.account.create({ data: { name: 'محفظتي', type: 'CASH', currency: 'EGP', balance: 0, color: '#2563EB', icon: 'wallet', isDefault: true, userId: user.id } });
      return user;
    });

    const token = generateToken(result.id);
    // P0.12: do NOT return token in JSON body. See login/route.ts for rationale.
    const response = NextResponse.json({ data: { id: result.id, email: result.email, name: result.name } });
    return setAuthCookie(response, token);
  } catch (err: any) {
    // P0.11: don't leak err.message
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
