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

const banner = `=== محفظتي (MyWallet) - Source Code (P0.5 Server-side Token Revocation) ===
=== Fixed: stolen tokens invalidated server-side on logout ===
=== VERSION: P0.5 (DB-backed token blacklist + async auth) ===
=== BUILD: ${new Date().toISOString()} ===

ROOT CAUSE ADDRESSED (raised in P0.4 review):
  ChatGPT noted: "التوكن صالح 30 يومًا، ولا يظهر في المصدر مسار
  لإبطاله من الخادم عند تسجيل الخروج؛ حذف التوكن من المتصفح لا يبطل
  نسخة مسروقة منه." Translation: localStorage token is XSS-readable
  (unlike the HttpOnly cookie), valid for 30 days, with no server-side
  revocation on logout. A stolen copy would work for 30 days even after
  the legitimate user logs out.

WHAT CHANGED IN P0.5:
  [1] prisma/schema.prisma: Added RevokedToken model
         model RevokedToken {
           id        String   @id @default(cuid())
           token     String   @unique  // full JWT
           userId    String
           expiresAt DateTime           // when the original token would have expired
           createdAt DateTime @default(now())
           user      User     @relation(...)
           @@index([expiresAt])
           @@index([userId])
         }
  [2] src/lib/auth.ts: Added revokeToken() + isTokenRevoked() + cleanupExpiredRevokedTokens()
      - revokeToken(token, userId): inserts the token into RevokedToken table + caches locally
      - isTokenRevoked(token): checks in-memory positive cache first (revokedTokenSet),
        then 1s negative cache (notRevokedCache), else falls back to DB lookup
      - getUserIdFromRequestAsync(req): does HMAC verify + blacklist check
      - requireAuthAsync(req): the new secure requireAuth that checks blacklist
      - extractToken(req): pulls token from Authorization header OR cookie
      - verifyTokenSignature(token): pure HMAC check (no DB), returns {userId, exp}
      - cleanupExpiredRevokedTokens(): deletes rows where expiresAt < now()
  [3] src/app/api/auth/logout/route.ts: now calls revokeToken() before clearing cookie
      so even a stolen token (copied from localStorage or a network capture) is
      invalidated server-side immediately
  [4] ALL mutating API routes (transactions POST/PUT/DELETE, transfer, reset,
      backup import, excel import, accounts POST/DELETE, categories POST/DELETE,
      budgets POST/DELETE) now use 'await requireAuthAsync(req)' instead of
      'requireAuth(req)' — every mutation checks the blacklist
  [5] ALL GET endpoints also use requireAuthAsync (was a TODO from earlier —
      a stolen token used on a GET endpoint shouldn't work either)
  [6] .env: AUTH_SECRET generated and set to a 64-char random hex string
      (so production build passes the eager validation at module load)

CACHE STRATEGY (in-memory, per-worker):
  - revokedTokenSet (Set<string>): tokens known to be revoked. Stay forever in
    the worker (until cleanup). Hits here return revoked=true with no DB lookup.
  - notRevokedCache (Map<string, timestamp>): tokens checked in the last 1
    second and found NOT revoked. TTL = 1 second. After expiry, re-check DB.
  - Rationale: we cache positive results forever (a revoked token won't
    un-revoke). We cache negative results briefly (1s) to coalesce concurrent
    parallel requests (e.g., home screen fires 3 fetches at once). The 1s
    window means revocation propagates within max 1 second, not 30 seconds
    like a typical cache.

CONFIRMED WORKING (curl-tested earlier in this session):
  - POST /api/auth/register        → 200 + token in JSON
  - GET /api/transactions (Bearer, BEFORE logout) → 200 ✅
  - GET /api/categories (Bearer, BEFORE logout)    → 200 ✅
  - POST /api/auth/logout (Bearer)                → 200 (revokes the token)
  - GET /api/transactions (Bearer, AFTER logout)  → 401 ✅ (revoked!)
  - GET /api/categories (Bearer, AFTER logout)    → 401 ✅ (revoked!)
  - GET /api/accounts (Bearer, AFTER logout)      → 401 ✅ (revoked!)
  - GET /api/stats (Bearer, AFTER logout)         → 401 ✅ (revoked!)
  - POST /api/auth/login (same credentials)        → 200 + new token (different sig)
  - GET /api/transactions (new token)             → 200 ✅

SECURITY MODEL NOW:
  - Cookie (HttpOnly + SameSite=Lax): primary auth path. Works in normal browsers.
  - Bearer token (localStorage + Authorization header): fallback for preview
    proxies that strip Set-Cookie. XSS-readable, BUT...
  - ...now ALSO backed by server-side revocation. If user logs out, ALL copies
    of their token (localStorage, stolen via XSS, captured from network) are
    immediately invalid because the next API call checks the DB blacklist.
  - Stale "not revoked" cache for up to 1 second (acceptable window).
  - Cleanup of expired revoked tokens happens opportunistically on each logout.

WHAT STILL REMAINS FROM PRIOR REVIEWS (P0.2 leftovers):
  - backup version === 3 (currently only checks truthy)
  - HTTP body size limit at server/proxy level
  - Excel import Transfer-Out handling + multi-currency conversion
  - Budget multi-currency aggregation
  - Historical exchange rates for transaction/transfer reversal
  - userId nullable in some models + models without userId (Setting, RecurringTransaction, SavingsGoal, BillReminder)
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
