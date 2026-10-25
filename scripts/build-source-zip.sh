#!/usr/bin/env bash
# Build source-code ZIP WITHOUT .env (security: never expose secrets)
# Usage: bash scripts/build-source-zip.sh
set -e

ROOT=/home/z/my-project
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
OUT="$ROOT/public/source-code-P0.6-${TIMESTAMP}.zip"

# Explicit file list — DO NOT include .env, .env.local, or any other env file
cd "$ROOT"
zip -r "$OUT" \
  src/ \
  prisma/ \
  scripts/ \
  package.json \
  next.config.ts \
  tsconfig.json \
  tailwind.config.ts \
  postcss.config.mjs \
  components.json \
  -x 'node_modules/*' '.next/*' '.git/*' '**/*.log' '**/.DS_Store'

# Sanity check: ensure .env is NOT in the ZIP
echo ""
echo "=== Security check: ensure .env is NOT in ZIP ==="
if unzip -l "$OUT" | grep -E '\.env$|\.env\.'; then
  echo "ERROR: .env found in ZIP! Aborting."
  rm -f "$OUT"
  exit 1
else
  echo "✅ .env is NOT in the ZIP"
fi

# Also refresh the canonical source-code.zip
cp "$OUT" "$ROOT/public/source-code.zip"

echo ""
echo "✅ Created: $OUT"
echo "✅ Refreshed: $ROOT/public/source-code.zip"
ls -la "$OUT" "$ROOT/public/source-code.zip"
