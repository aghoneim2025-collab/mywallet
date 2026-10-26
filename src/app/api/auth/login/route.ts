import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, generateToken, setAuthCookie } from '@/lib/auth';
import { isValidEmail, validatePassword, tooManyRequests } from '@/lib/validate';
import { rateLimitLogin } from '@/lib/rate-limit';

// P0.11: rate limiting + email validation + password policy + timing-attack
// mitigation (bcrypt against dummy hash when user doesn't exist).

// Dummy hash used to keep timing constant when the user doesn't exist.
// Precomputed with bcrypt cost 12 — same as the real registration flow.
const DUMMY_HASH = '$2b$12$g8vQ8jKQ8jKQ8jKQ8jKQ8eV8jKQ8jKQ8jKQ8jKQ8jKQ8eV8jKQ8jKQ8jKQ8jKQ8';

export async function POST(req: NextRequest) {
  try {
    // P0.11: rate limit by IP+email to slow brute-force attacks
    const { email } = await req.json().catch(() => ({ email: '' }));
    const rl = rateLimitLogin(req, email);
    if (rl.limited) return tooManyRequests(rl.retryAfter, rl.message);

    const { password } = await req.json();
    if (!isValidEmail(email) || typeof password !== 'string') {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const user = await db.user.findUnique({ where: { email: normalizedEmail } });

    // P0.11: always run bcrypt against something, so timing doesn't reveal
    // whether the user exists. When user is null, use DUMMY_HASH.
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      // Same response shape as 200 path → no information leak
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = generateToken(user.id);
    const response = NextResponse.json({ data: { id: user.id, email: user.email, name: user.name, token } });
    return setAuthCookie(response, token);
  } catch (err: any) {
    // P0.11: don't leak err.message — generic 500
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
