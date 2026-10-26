// P0.4/P0.12: client-side auth state storage.
//
// P0.12 changes: This file previously stored the JWT in localStorage as a
// fallback for preview proxies that strip Set-Cookie. That fallback is
// REMOVED because:
//   1. localStorage is readable by any XSS payload (which is now a
//      realistic threat given the app loads third-party scripts).
//   2. With the cookie hardened to HttpOnly + SameSite=Strict + __Host-
//      prefix, the cookie path is now safe. Preview proxies MUST forward
//      Set-Cookie; if they don't, that's a proxy bug to fix, not an app
//      bug to work around with a less-secure fallback.
//
// This file is kept as a no-op stub for backwards compatibility with
// existing frontend imports (page.tsx, auth-screen.tsx, settings-screen.tsx,
// data-tools.tsx). All operations are no-ops; the cookie is the only auth
// source of truth now.
//
// Frontend code that wants to "log out" should call /api/auth/logout (which
// server-side revokes the token + clears the cookie). Client-side state
// clearing here has no security effect — only UX effect.

export function getStoredToken(): string | null {
  // P0.12: always returns null. Token lives in the HttpOnly cookie.
  return null;
}

export function setStoredToken(_token: string | null): void {
  // P0.12: no-op. Token is set/cleared server-side via Set-Cookie.
  // Calling this with null has no effect; calling with a non-null value
  // is a no-op (the value is discarded).
}
