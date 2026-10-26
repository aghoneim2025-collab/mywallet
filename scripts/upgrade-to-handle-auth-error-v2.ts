#!/usr/bin/env node
/**
 * P0.10 v2: handle the remaining files where the legacy catch pattern
 * has a console.error() line between the Unauthorized check and the 500
 * fallback. Pattern is now:
 *   if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   console.error(...);
 *   return NextResponse.json({ error: err.message }, { status: 500 });
 * →
 *   return handleAuthError(err);
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = '/home/z/my-project/src/app/api';
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

  // Pattern: catch (err: any) {
  //   if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  //   [optional console.error line]
  //   return NextResponse.json({ error: err.message }, { status: 500 });
  // }
  // Replace whole block with: catch (err: any) { return handleAuthError(err); }
  const pattern = /catch \(err: any\) \{\s*\n\s*if \(err\.message === 'Unauthorized'\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);\s*\n(?:\s*console\.error\([^)]*\);\s*\n)?\s*return NextResponse\.json\(\{ error: err\.message \}, \{ status: 500 \}\);\s*\n\s*\}/g;

  src = src.replace(pattern, 'catch (err: any) {\n    return handleAuthError(err);\n  }');

  if (src !== before) {
    fs.writeFileSync(full, src);
    totalUpdated++;
    console.log(`✓ Updated: ${rel}`);
  }
}

console.log(`\nDone. ${totalUpdated} files updated in v2.`);
