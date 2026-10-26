// P0.4/P0.12: simple fetch wrapper.
//
// P0.12 changes: no longer attaches `Authorization: Bearer <token>` header.
// The JWT now lives in the HttpOnly cookie (set by /api/auth/login +
// /api/auth/register). The browser automatically sends cookies for
// same-origin requests, so no client-side intervention is needed.
//
// `credentials: 'same-origin'` is the default for fetch in modern browsers,
// which is what we want — cookies are sent on same-origin requests only.
//
// Future: if we ever add cross-origin API access (e.g., a mobile app),
// add `credentials: 'include'` AND ensure the server sets
// `Access-Control-Allow-Credentials: true` + an explicit origin (NOT *).

export async function api<T>(
  path: string,
  opts?: RequestInit & { params?: Record<string, string | undefined> }
): Promise<T> {
  const { params, ...rest } = opts || {};
  let url = path;
  if (params) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) sp.set(k, v);
    });
    const qs = sp.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(rest?.headers || {}) },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}

// Helper: download a file (for CSV/Excel export).
// Cookies are sent automatically (same-origin).
export async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || res.statusText);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
