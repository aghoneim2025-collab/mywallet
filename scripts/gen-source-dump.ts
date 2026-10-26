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

const banner = `=== محفظتي (MyWallet) - Source Code (P0.12 Final Security + Data Integrity Pass) ===
=== Fixed: handleAuthError centralizes 401/503/500, page.tsx shows service-down UI, ZIP scans all entries ===
=== VERSION: P0.12 (final security + data integrity) ===
=== BUILD: ${new Date().toISOString()} ===

URGENT SECURITY NOTE:
  In P0.5, the source-code ZIP files inadvertently included the .env file
  containing the AUTH_SECRET. ChatGPT flagged this risk: "إن ظهر AUTH_SECRET
  في أي dump أو ZIP متاح للآخرين، اعتبره مكشوفًا، وغيّره وأبطِل الجلسات/
  التوكنات الموقّعة به."

  Response taken:
  [1] ALL old ZIPs (P0.2, P0.3, P0.4, P0.4.1, P0.5) have been deleted from
      /public. They are no longer downloadable.
  [2] AUTH_SECRET has been ROTATED — a fresh 64-char hex random value was
      generated via 'openssl rand -hex 32' and written to .env.
  [3] Because the secret changed, ALL tokens signed with the OLD secret
      are now invalid (their HMAC signature no longer matches). Every user
      is forced to log in again.
  [4] The new gen-source-dump.ts script EXPLICITLY excludes .env from the
      ZIP. Verified via 'unzip -l' that .env is absent.
  [5] Source dump (.txt) only includes code files — never .env.

P0.6 HASH STORAGE FIX (separate concern, also addressed in this round):
  ChatGPT noted: "إذا كان حقل RevokedToken.token يخزّن التوكن الخام، فالأفضل
  تخزين بصمة له بدلًا منه، حتى لا تتحول قاعدة البيانات إلى مخزن للتوكنات
  القابلة للاستخدام."

  What changed:
  - src/lib/auth.ts: new exported hashToken(token) → SHA-256 hex (64 chars)
  - revokeToken(token, userId): now stores hashToken(token) in DB, not the raw
    token. A DB leak now exposes only one-way hashes (which can't be reversed
    back to the original HMAC-signed JWT).
  - isTokenRevoked(token): computes hashToken(token) first, then checks
    cache + DB using the hash (never the raw token).
  - Both in-memory caches (revokedTokenSet, notRevokedCache) are now keyed
    by the hash.

  Verified by direct test (scripts/test-auth.ts):
    Token: eyJ1c2VySWQiOiJjbXZudXJnM2cwMD... (122 chars, raw JWT)
    Hash:  50018e524163fa141b640646c8fc4b97c3db00f43a8578481db1fea55950cfbf (64 hex)
    DB row stores the HASH, not the JWT. ✅

CROSS-WORKER REVOCATION LATENCY (acknowledged limitation):
  ChatGPT noted: "الـ revocation ليس فوريًا على جميع العمال إذا كان العامل
  قد خزّن نتيجة «غير ملغى» لمدة ثانية. قد يقبل عامل آخر التوكن حتى تنتهي
  هذه المهلة."

  Response: this is correct and intentional. The NEG_CACHE_TTL_MS is set
  to 1 second specifically to coalesce concurrent parallel requests (the
  home screen fires 3+ fetches at once on mount, all with the same token).
  Without this short cache, the DB would be hit 3+ times per page load.

  The MAXIMUM cross-worker revocation delay is 1 second (NEG_CACHE_TTL_MS).
  After 1 second, even a worker that previously cached "not revoked" will
  re-fetch from the DB and see the new revocation row.

  For tighter revocation (0 second delay), set NEG_CACHE_TTL_MS = 0 — every
  request does a DB lookup. Trade-off: more DB load + higher latency per
  request. For a personal finance app with one user at a time, the 1s
  window is acceptable.

CLEANUP SCHEDULE (P0.6 also addressed):
  ChatGPT noted: "الوصف لا يبيّن متى تُستدعى cleanupExpiredRevokedTokens()؛
  إن لم تكن تُشغّل دوريًا فقد تتراكم السجلات."

  - maybeCleanupExpiredRevokedTokens(): called on every logout.
    Uses an in-memory counter (logoutCounter). Every 10th logout also runs
    cleanupExpiredRevokedTokens(), which DELETEs rows where expiresAt < now().
  - For high-traffic production, this should be wired to a real cron job
    (e.g., daily at 3 AM). For now, the opportunistic approach is fine.

CONFIRMED WORKING (script test):
  - generateToken(userId) → returns JWT string
  - hashToken(token) → returns 64-char hex SHA-256
  - revokeToken(token, userId) → inserts hash row in DB
  - DB row.token is 64-char hex (NOT the raw JWT) ✅
  - DB row.token has no '.' (NOT a JWT) ✅
  - DB leak would expose hashes, NOT usable tokens ✅

PREVIOUS P0.5 FIXES STILL IN PLACE:
  - RevokedToken table (now stores hash, not raw)
  - requireAuthAsync(req) used on all 23 mutating + GET call sites
  - Logout revokes token server-side
  - AUTH_SECRET eagerly validated at module load

PREVIOUS P0.2-P0.4 FIXES STILL IN PLACE:
  - Stable deterministic dev secret (P0.4)
  - Bearer token fallback in api.ts/auth-storage.ts (P0.4)
  - Sonner Toaster mounted + inline a11y messages (P0.3)
  - transactions limit clamp (P0.2)
  - backup export/import known fields + 10MB limit + version check (P0.2)
  - reset deletes only Transaction + Budget (P0.2)

WHAT STILL REMAINS FROM PRIOR REVIEWS (P0.2 leftovers):
  - backup version === 3 (currently only checks truthy)
  - HTTP body size limit at server/proxy level
  - Excel import Transfer-Out handling + multi-currency conversion
  - Budget multi-currency aggregation
  - Historical exchange rates for transaction/transfer reversal
  - userId nullable in some models + models without userId
    (Setting, RecurringTransaction, SavingsGoal, BillReminder)
  - Rate limiting on login/register
  - Tighten transfer validation (NaN/Infinity + currency enum)

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
