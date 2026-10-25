#!/usr/bin/env bash
# Build source-code ZIP WITHOUT .env (security: never expose secrets)
# Usage: bash scripts/build-source-zip.sh
set -e

ROOT=/home/z/my-project
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
OUT="$ROOT/public/source-code-P0.6-${TIMESTAMP}.zip"

# Explicit file list — DO NOT include .env, .env.local, .env.production, etc.
# Only .env.example (which contains placeholders, not real secrets) is allowed.
cd "$ROOT"
zip -r "$OUT" \
  src/ \
  prisma/ \
  scripts/ \
  .env.example \
  package.json \
  next.config.ts \
  tsconfig.json \
  tailwind.config.ts \
  postcss.config.mjs \
  components.json \
  -x 'node_modules/*' '.next/*' '.git/*' '**/*.log' '**/.DS_Store' \
     '.env' '.env.local' '.env.production' '.env.development' '.env.*.local'

# Sanity check: ensure .env (real secret file) is NOT in the ZIP
echo ""
echo "=== Security check: ensure .env is NOT in ZIP ==="
if unzip -l "$OUT" | grep -E '(^|/)\.env$|\.env\.local|\.env\.production|\.env\.development|\.env\.[^e]'; then
  echo "ERROR: real .env file found in ZIP! Aborting."
  rm -f "$OUT"
  exit 1
fi

# Confirm .env.example IS in the ZIP (placeholder file)
if ! unzip -l "$OUT" | grep -q '\.env\.example'; then
  echo "WARNING: .env.example not in ZIP (this is OK if you don't want it)"
else
  echo "✅ .env.example (placeholder only) IS in the ZIP"
fi

echo "✅ No real .env files in ZIP"

# Also refresh the canonical source-code.zip
cp "$OUT" "$ROOT/public/source-code.zip"

echo ""
echo "✅ Created: $OUT"
echo "✅ Refreshed: $ROOT/public/source-code.zip"
ls -la "$OUT" "$ROOT/public/source-code.zip"
