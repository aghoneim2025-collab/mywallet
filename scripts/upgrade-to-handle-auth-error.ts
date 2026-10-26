#!/usr/bin/env node
/**
 * P0.10: update all API routes to use centralized handleAuthError().
 * Replaces the legacy `if (err.message === 'Unauthorized') ...` pattern
 * with `return handleAuthError(err);` so DbUnavailableError → 503, etc.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = '/home/z/my-project/src/app/api';

// Files that contain the legacy pattern.
const FILES = [
  'transactions/route.ts',
  'transactions/[id]/route.ts',
  'categories/route.ts',
  'categories/[id]/route.ts',
  'transfer/route.ts',
  'excel/route.ts',
  'stats/route.ts',
  'backup/route.ts',
  'budgets/route.ts',
  'accounts/route.ts',
  'accounts/[id]/route.ts',
  'reset/route.ts',
];

let totalUpdated = 0;

for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;

  let src = fs.readFileSync(full, 'utf8');
  const before = src;

  // 1. Add import for handleAuthError (after the existing auth import).
  // The auth import line ends with `from '@/lib/auth';`. Add the new import
  // immediately after that line. (Only add if not already imported.)
  if (!src.includes('handleAuthError')) {
    src = src.replace(
      /(import\s+\{[^}]*\}\s+from\s+'@\/lib\/auth';)/,
      `$1\nimport { handleAuthError } from '@/lib/api-errors';`,
    );
  }

  // 2. Replace the legacy catch pattern with handleAuthError.
  // Legacy:
  //   if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  //   return NextResponse.json({ error: err.message }, { status: 500 });
  // New:
  //   return handleAuthError(err);
  //
  // Use a non-greedy regex to match the two-line pattern.
  const legacyPattern = /\s*if \(err\.message === 'Unauthorized'\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);\s*\n\s*return NextResponse\.json\(\{ error: err\.message \}, \{ status: 500 \}\);/g;
  src = src.replace(legacyPattern, '\n    return handleAuthError(err);');

  if (src !== before) {
    fs.writeFileSync(full, src);
    totalUpdated++;
    console.log(`✓ Updated: ${rel}`);
  }
}

console.log(`\nDone. ${totalUpdated} files updated.`);
