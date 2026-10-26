import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, generateToken, setAuthCookie } from '@/lib/auth';
import { isValidEmail, validatePassword, tooManyRequests } from '@/lib/validate';
import { rateLimitLogin } from '@/lib/rate-limit';

// P0.11/P0.12: rate limiting + email validation + password policy + timing-attack
// mitigation (bcrypt against dummy hash when user doesn't exist).
//
// P0.12 fix: parse req.json() ONCE — was calling it twice (once for rate-limit
// key, once for credentials), which threw on the second call → 500. Now we
// parse once and reuse.

// P0.13: DUMMY_HASH is a REAL bcrypt hash (cost 12, 60 chars).
// P0.12 used a 64-char string that wasn't a valid bcrypt hash →
// bcryptjs's early length check returned false in <1ms instead of
// doing the expensive bcrypt computation (~250ms). This made login
// with non-existent email MUCH faster than login with existing email
// + wrong password → timing-attack email enumeration was still possible.
//
// The fix: use a hash that bcryptjs will actually try to verify against,
// so the comparison takes ~250ms regardless of whether the user exists.
//
// The hash below was generated with `bcrypt.hashSync('dummy-password-for-timing-attack-mitigation-only', 12)`.
// It doesn't matter what password it hashes (no one can ever "match" it
// for a real login) — what matters is that bcrypt.compare takes the
// same time as a real hash.
const DUMMY_HASH = '$2b$12$xULoKaEdpcsZZTCcMRZgrOOnGj6UwIOGro1JRK9AD6WNabxLev7Yq';

export async function POST(req: NextRequest) {
  try {
    // P0.12: parse body ONCE, reuse everywhere.
    const body = await req.json().catch(() => ({}));
    const { email, password } = body;

    // P0.11: rate limit by IP+email to slow brute-force attacks
    // Use the (possibly empty) email from the request for the rate-limit key
    const rl = rateLimitLogin(req, typeof email === 'string' ? email : '');
    if (rl.limited) return tooManyRequests(rl.retryAfter, rl.message);

    // P0.11: validate input. Returns 401 (NOT 500) for missing/invalid creds.
    // Always return the SAME 401 message so attackers can't distinguish
    // "bad email" from "bad password".
    if (!isValidEmail(email) || typeof password !== 'string' || password.length === 0) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await db.user.findUnique({ where: { email: normalizedEmail } });

    // P0.11: always run bcrypt against something, so timing doesn't reveal
    // whether the user exists. When user is null, use DUMMY_HASH.
    // bcrypt.compare against DUMMY_HASH will take ~250ms (same cost factor),
    // matching the timing of a real bcrypt comparison.
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

    // P0.12: return 401 (NOT 500) for invalid credentials.
    // The earlier 500 was due to the double-req.json() bug.
    if (!user || !valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = generateToken(user.id);
    // P0.12: do NOT return token in JSON body. Token is set ONLY in the
    // HttpOnly cookie. This closes the localStorage-XSS vector: an XSS
    // attack can't read the token because JS can't access HttpOnly cookies.
    // (Previous versions returned the token in JSON as a "Bearer fallback"
    // for preview proxies that strip Set-Cookie. That fallback is removed
    // — the preview proxy must be fixed to forward Set-Cookie instead.)
    const response = NextResponse.json({ data: { id: user.id, email: user.email, name: user.name } });
    return setAuthCookie(response, token);
  } catch (err: any) {
    // P0.11: don't leak err.message — generic 500
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
