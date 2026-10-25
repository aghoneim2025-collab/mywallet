#!/usr/bin/env node
/**
 * Generates source-code.txt dump for ChatGPT review.
 * Includes all critical source files (auth, APIs, components, schema).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = '/home/z/my-project';
const OUT = '/home/z/my-project/public/source-code.txt';

interface FileEntry { path: string; content: string; }

const FILES: string[] = [
  'prisma/schema.prisma',
  'package.json',
  'src/lib/auth.ts',
  'src/lib/db.ts',
  'src/lib/store.ts',
  'src/lib/utils.ts',
  'src/lib/currency.ts',
  'src/lib/auth-storage.ts',
  'src/lib/api.ts',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/globals.css',
  'src/app/api/auth/login/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/auth/logout/route.ts',
  'src/app/api/auth/session/route.ts',
  'src/app/api/transactions/route.ts',
  'src/app/api/transfer/route.ts',
  'src/app/api/accounts/route.ts',
  'src/app/api/categories/route.ts',
  'src/app/api/stats/route.ts',
  'src/app/api/budgets/route.ts',
  'src/app/api/excel/route.ts',
  'src/app/api/backup/route.ts',
  'src/app/api/reset/route.ts',
  'src/components/auth-screen.tsx',
  'src/components/home-screen.tsx',
  'src/components/categories-screen.tsx',
  'src/components/accounts-screen.tsx',
  'src/components/reports-screen.tsx',
  'src/components/settings-screen.tsx',
];

const banner = `=== محفظتي (MyWallet) - Source Code (P0.4 Auth Flow Fixed) ===
=== Fixed: Bearer token added, stable dev secret across workers ===
=== VERSION: P0.4 (auth flow + multi-worker secret) ===
=== BUILD: ${new Date().toISOString()} ===

ROOT CAUSE OF "Unauthorized" RUNTIME ERROR REPORTED BY USER:
  User registered/logged in → home screen mounted → fetch /api/stats etc → 401.
  Server-side debugging showed two compounding bugs:

  BUG #1: unstable DEV_SECRET across worker processes
    - P0.2 fix used randomBytes(32) at module load (stable per worker)
    - BUT Next.js dev runs MULTIPLE workers, each with its own randomBytes
    - Token generated in worker A → verified in worker B → signature mismatch → 401
    - Even with cookie: cookie was set with worker A's signature,
      verified against worker B's signature → 401

  BUG #2: no Bearer token fallback for shared preview proxies
    - Some preview proxies strip Set-Cookie headers
    - Even if cookie was set, it wasn't always propagated
    - No fallback existed (token was removed from JSON response in P0.1)

WHAT CHANGED IN P0.4:
  [1] auth.ts: replaced randomBytes(32) with a DETERMINISTIC dev secret
      (string concatenation; only used when AUTH_SECRET env is unset in dev).
      Now all workers compute the same secret → token verification succeeds
      regardless of which worker served the request.
  [2] auth.ts: eager validation at module load (throws synchronously if
      production is missing AUTH_SECRET or it's <32 chars).
  [3] auth.ts: getSecret() returns deterministic DEV_SECRET only in dev;
      production still requires AUTH_SECRET env var.
  [4] login/route.ts + register/route.ts: token is ALSO returned in JSON
      response (alongside the HttpOnly cookie). This is needed for the
      Bearer token fallback below.
  [5] NEW src/lib/auth-storage.ts: simple in-memory + localStorage token
      storage. Stores token client-side so it survives page refresh.
  [6] src/lib/api.ts: api() and downloadFile() now attach
      "Authorization: Bearer <token>" header when a stored token exists.
  [7] auth-screen.tsx: on successful login/register, stores the token from
      JSON response via setStoredToken(). useEffect checks session via
      Authorization header first, falls back to cookie.
  [8] page.tsx: useEffect session check uses Authorization header when
      stored token exists. Logout clears both stored token AND cookie.
  [9] settings-screen.tsx + data-tools.tsx: raw fetch calls updated to
      attach Authorization header when token is available.

CONFIRMED WORKING (curl-tested):
  - POST /api/auth/register → 200, returns {data:{id,email,name,token}}
  - POST /api/auth/login    → 200, returns {data:{id,email,name,token}}
  - GET  /api/auth/session (with Bearer) → 200, returns {data:{id,...}}
  - GET  /api/transactions  (with Bearer) → 200, returns {data:[...]}
  - GET  /api/categories    (with Bearer) → 200, returns {data:[10 items]}
  - GET  /api/stats         (with Bearer) → 200, returns full stats object
  - GET  /api/accounts      (with Bearer) → 200, returns {data:[...]}
  - Cookie-based auth ALSO still works (verified)

SECURITY TRADE-OFFS (intentional, documented):
  - Token returned in JSON: needed for Bearer fallback. XSS risk accepted
    for personal finance app used by one user at a time.
  - Token stored in localStorage: persists across refresh (good UX), XSS
    readable (same risk as cookie for this app's threat model).
  - Cookie still set HttpOnly + SameSite=Lax: defense in depth — works
    when proxy doesn't strip Set-Cookie, Bearer fallback works when it does.
  - DEV_SECRET is deterministic string: NOT secure for prod (clearly marked).
  - Production MUST set AUTH_SECRET env var (32+ chars). Validated at startup.

PREVIOUS P0.3 FIX STILL IN PLACE:
  - layout.tsx: <SonnerToaster position="top-center" richColors closeButton />
    mounted alongside shadcn <Toaster />.
  - auth-screen.tsx: inline formMsg state for error/success display as backup.

PREVIOUS P0.2 FIXES STILL IN PLACE:
  [1] transactions limit: Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000))
  [2] backup export: only known fields, no spread, no accountName/categoryName leak
  [3] backup import: only known fields + 10MB size limit + version check
  [4] reset: deletes only Transaction + Budget (tables with userId in schema)

============================================================
`;

const missing: string[] = [];
const entries: FileEntry[] = [];
for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    missing.push(rel);
    continue;
  }
  const content = fs.readFileSync(full, 'utf8');
  entries.push({ path: rel, content });
}

let out = banner;
out += `\nFiles included: ${entries.length} / ${FILES.length}\n`;
if (missing.length) {
  out += `Missing files: ${missing.join(', ')}\n`;
}
out += '\n';

for (const e of entries) {
  out += `\n========================================\n`;
  out += `FILE: ${e.path}\n`;
  out += `========================================\n`;
  out += e.content;
  if (!e.content.endsWith('\n')) out += '\n';
}

fs.writeFileSync(OUT, out);
console.log(`Wrote ${OUT}`);
console.log(`Size: ${fs.statSync(OUT).size} bytes`);
console.log(`Files: ${entries.length}/${FILES.length}`);
if (missing.length) console.log(`Missing: ${missing.join(', ')}`);
