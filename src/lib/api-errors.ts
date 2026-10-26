// P0.10: centralized error handler for API routes that use requireAuthAsync.
// Distinguishes between:
//   - DbUnavailableError → 503 (Service Unavailable) — token may be valid, DB is down
//   - AuthInvalidError → 401 (Unauthorized) — token is invalid/expired/revoked
//   - ValidationError → 400 (Bad Request) — input was bad
//   - Other errors → 500 (Internal Server Error) — unexpected, log for debugging
//
// P0.11: NEVER return err.message to the client — it can leak Prisma error
// details (table names, column names, constraint names). Log server-side only.
// Client gets a generic "Internal server error" message.
//
// P0.16: added explicit ValidationError class so business-logic errors
// (like "Insufficient balance") can be properly surfaced as 400 instead
// of leaking as 500. Routes that throw inside $transaction should use
// `throw new ValidationError('message')`.
//
// Usage in API routes:
//   try {
//     const userId = await requireAuthAsync(req);
//     // ... route logic ...
//   } catch (err) {
//     return handleAuthError(err);
//   }
//
// The frontend should:
//   - On 401: clear token, show auth screen
//   - On 503: keep token, show "service unavailable" UI with retry
//   - On 500: keep token, show generic error UI
import { NextResponse } from 'next/server';
import { DbUnavailableError, AuthInvalidError } from './auth';
import { badRequest } from './validate';

// P0.16: ValidationError class for business-logic errors that should be
// surfaced to the client as 400 with the error message.
// (The error message is safe to surface because we wrote it — it's not
// a Prisma/internal error.)
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function handleAuthError(err: unknown) {
  if (err instanceof DbUnavailableError) {
    return NextResponse.json(
      { error: 'Service unavailable: database unreachable. Please retry.' },
      { status: 503 },
    );
  }
  if (err instanceof AuthInvalidError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Legacy: routes that throw `new Error('Unauthorized')` directly (not via
  // AuthInvalidError). Catch them as 401 too.
  if (err instanceof Error && err.message === 'Unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // P0.16: ValidationError → 400 with the message (we wrote it, safe to surface)
  if (err instanceof ValidationError) {
    return badRequest(err.message);
  }
  // P0.11: validation errors thrown with `throw new Error('Some validation message')`
  // are surfaced to the client as 400 (Bad Request). This is intentional —
  // the validation message is safe (we wrote it).
  // (Legacy pattern — replaced by ValidationError class above for new code.)
  if (err instanceof Error) {
    const msg = err.message;
    if (/^(Invalid|Must|Exceeds|.* is required|.* cannot be|.* must be|Insufficient|Cannot )/i.test(msg)) {
      return badRequest(msg);
    }
  }
  // P0.11: unexpected error → log full details server-side, return generic to client.
  console.error('Unexpected API error (returning 500, full err logged server-side):', err);
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 },
  );
}
