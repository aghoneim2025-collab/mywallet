// P0.10: centralized error handler for API routes that use requireAuthAsync.
// Distinguishes between:
//   - DbUnavailableError → 503 (Service Unavailable) — token may be valid, DB is down
//   - AuthInvalidError → 401 (Unauthorized) — token is invalid/expired/revoked
//   - Other errors → 500 (Internal Server Error) — unexpected, log for debugging
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
  // Unexpected error → 500 (NOT 401, NOT 200). The user's token may be
  // perfectly valid; an internal bug shouldn't log them out.
  console.error('Unexpected API error (returning 500):', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
