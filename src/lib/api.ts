// Simple fetch wrapper
import { getStoredToken } from './auth-storage';

const baseUrl = '';

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

  // Attach Bearer token if available (fallback for when cookies don't propagate)
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest?.headers as Record<string, string> || {}),
  };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl}${url}`, {
    ...rest,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}

// Helper: download a file (for CSV export)
export async function downloadFile(url: string, filename: string) {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
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
