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

const banner = `=== محفظتي (MyWallet) - Source Code (P0.3 Auth UX Fix) ===
=== Fixed: Sonner Toaster was never mounted - toasts never appeared ===
=== Fixed: Added inline error/success messages in auth screen as backup ===
=== VERSION: P0.3 (auth UX bug fix) ===
=== BUILD: ${new Date().toISOString()} ===

WHAT CHANGED IN P0.3:
  [1] layout.tsx: Added <SonnerToaster position="top-center" richColors closeButton />
      (Before: only shadcn <Toaster /> was mounted; Sonner toasts went nowhere)
  [2] auth-screen.tsx: Added inline formMsg state for error/success display
      as a backup so the user sees feedback even if Sonner fails
  [3] auth-screen.tsx: Better error messages in both ar/en, success messages
      distinguish login vs register, setTimeout 400ms before onAuth() so
      the user can see the success message

ROOT CAUSE OF "no message" BUG REPORTED BY USER:
  - 11 components import { toast } from 'sonner' (auth-screen, settings-screen,
    transaction-modal, transfer-modal, reports-screen, categories-manager,
    accounts-screen, budget-screen, data-tools, categories-screen, sw-registrar)
  - layout.tsx mounted only shadcn/ui <Toaster /> (NOT sonner)
  - Therefore every toast.success/error call went into the void
  - User registered (server returned 200, cookie set) but saw NOTHING
  - User logged in (server returned 200, cookie set) but saw NOTHING
  - Auth actually WORKED - just no visible feedback

CONFIRMED API BEHAVIOR (curl-tested):
  - POST /api/auth/register with new email   → HTTP 200, {data: {id, email, name}}, Set-Cookie
  - POST /api/auth/login with valid creds    → HTTP 200, {data: {id, email, name}}, Set-Cookie
  - POST /api/auth/register with dup email   → HTTP 409, {error: "Email already registered"}
  - POST /api/auth/login with bad password   → HTTP 401, {error: "Invalid email or password"}
  - GET  /api/auth/session (no cookie)       → HTTP 200, {data: null}
  - GET  /api/auth/session (with cookie)      → HTTP 200, {data: {id, email, name}}

PREVIOUS P0.2 FIXES STILL IN PLACE:
  [1] Stable dev secret: DEV_SECRET = randomBytes(32).toString('hex') at module load
  [2] AUTH_SECRET validation: in production, throws if missing or <32 chars
  [3] transactions limit: Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000))
  [4] backup export: only known fields, no spread, no accountName/categoryName leak
  [5] backup import: only known fields + 10MB size limit + version check
  [6] reset: deletes only Transaction + Budget (tables with userId in schema)

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
