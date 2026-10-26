// Client-side auth token storage.
// Stored in localStorage so it survives page refreshes.
// Server also sets HttpOnly cookie; this is the fallback when cookies
// don't propagate (e.g., shared preview proxies).

const TOKEN_KEY = 'mw-auth-token';

let inMemoryToken: string | null = null;

if (typeof window !== 'undefined') {
  try {
    inMemoryToken = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // localStorage might be unavailable (private mode)
    inMemoryToken = null;
  }
}

export function getStoredToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window !== 'undefined') {
    try {
      inMemoryToken = window.localStorage.getItem(TOKEN_KEY);
      return inMemoryToken;
    } catch {
      return null;
    }
  }
  return null;
}

export function setStoredToken(token: string | null): void {
  inMemoryToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) {
        window.localStorage.setItem(TOKEN_KEY, token);
      } else {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // ignore
    }
  }
}
