#!/usr/bin/env node
/**
 * Converts all API routes from `requireAuth(req)` to `await requireAuthAsync(req)`.
 * Also updates the import statement.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = '/home/z/my-project/src/app/api';

const files = [
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

let totalReplaced = 0;
let filesUpdated = 0;

for (const rel of files) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.warn(`SKIP (not found): ${rel}`);
    continue;
  }
  let src = fs.readFileSync(full, 'utf8');
  const before = src;

  // Update import: replace `requireAuth` with `requireAuthAsync` in the import
  src = src.replace(
    /import\s*\{\s*requireAuth\s*\}\s*from\s*'@\/lib\/auth';/,
    "import { requireAuthAsync } from '@/lib/auth';"
  );
  // Replace `requireAuth(req)` calls with `await requireAuthAsync(req)`
  src = src.replace(/\brequireAuth\(req\)/g, 'await requireAuthAsync(req)');

  if (src !== before) {
    fs.writeFileSync(full, src);
    filesUpdated++;
    const occurrences = (before.match(/requireAuth\(req\)/g) || []).length;
    totalReplaced += occurrences;
    console.log(`Updated ${rel} (${occurrences} call sites)`);
  } else {
    console.log(`No changes: ${rel}`);
  }
}

console.log(`\nDone. ${totalReplaced} call sites updated across ${filesUpdated} files.`);
