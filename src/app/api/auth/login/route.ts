import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, generateToken, setAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    const normalizedEmail = email.toLowerCase().trim();
    const user = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

    const token = generateToken(user.id);
    // Return user data + token in JSON. Token is also set as HttpOnly cookie.
    // Token in JSON is needed for environments where cookies don't propagate
    // (e.g., shared preview proxies). Client stores it in localStorage and
    // sends it via Authorization: Bearer header on API calls.
    const response = NextResponse.json({ data: { id: user.id, email: user.email, name: user.name, token } });
    return setAuthCookie(response, token);
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
