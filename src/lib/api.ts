// Simple fetch wrapper
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

  const res = await fetch(`${baseUrl}${url}`, {
    headers: { 'Content-Type': 'application/json', ...(rest?.headers || {}) },
    ...rest,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}

// Helper: download a file (for CSV export)
export async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
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
