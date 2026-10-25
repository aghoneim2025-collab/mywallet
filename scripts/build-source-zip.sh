#!/usr/bin/env bash
# Build source-code ZIP using a staging directory approach (allowlist).
# P0.8: instead of excluding bad files with patterns, we BUILD the ZIP from
# an explicit allowlist. This means even if a new .env file gets added with
# a non-standard name, it WILL NOT be included because we only stage what
# we explicitly list.
set -e

ROOT=/home/z/my-project
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
OUT="$ROOT/public/source-code-P0.8-${TIMESTAMP}.zip"
STAGE=$(mktemp -d /tmp/source-stage.XXXXXX)

# Always clean up the staging directory on exit (success or failure).
trap "rm -rf '$STAGE'" EXIT

# 1. Create the staging directory structure.
mkdir -p "$STAGE/src" "$STAGE/prisma" "$STAGE/scripts"

# 2. Copy ONLY allowed files (allowlist approach).
cp -r "$ROOT/src/." "$STAGE/src/"
cp -r "$ROOT/prisma/." "$STAGE/prisma/"
cp -r "$ROOT/scripts/." "$STAGE/scripts/"

# Top-level config files (explicit allowlist, not globs).
for f in package.json next.config.ts tsconfig.json tailwind.config.ts \
         postcss.config.mjs components.json .env.example; do
  if [ -f "$ROOT/$f" ]; then
    cp "$ROOT/$f" "$STAGE/"
  fi
done

# 3. Remove any compiled artifacts that may have been copied along.
rm -rf "$STAGE/src/node_modules" 2>/dev/null || true
find "$STAGE" -name 'node_modules' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$STAGE" -name '*.log' -delete 2>/dev/null || true
find "$STAGE" -name '.DS_Store' -delete 2>/dev/null || true

# 4. SECURITY SCAN: scan the staging directory for any .env file (real or
# hidden). .env.example is allowed; everything else is forbidden.
echo ""
echo "=== Security scan: scan staging directory for forbidden files ==="
FORBIDDEN=$(find "$STAGE" -type f \( -name '.env' -o -name '.env.local' -o -name '.env.production' -o -name '.env.development' -o -name '.env.*.local' -o -name '*.pem' -o -name '*.key' \) 2>/dev/null)
if [ -n "$FORBIDDEN" ]; then
  echo "ERROR: forbidden files found in staging directory:"
  echo "$FORBIDDEN"
  echo ""
  echo "Aborting ZIP creation."
  exit 1
fi
echo "✅ No forbidden files in staging directory"

# 5. List what's about to be zipped.
echo ""
echo "=== Staging directory contents (top level) ==="
ls -la "$STAGE" | head -20

# 6. Build the ZIP from the staging directory.
cd "$STAGE"
zip -r "$OUT" . > /dev/null

# 7. Final verification: confirm .env.example is in, .env is NOT.
echo ""
echo "=== Final verification ==="
if unzip -l "$OUT" | grep -qE '(^|/)\.env$'; then
  echo "ERROR: .env found in final ZIP!"
  exit 1
else
  echo "✅ .env NOT in ZIP"
fi
if unzip -l "$OUT" | grep -q '\.env\.example'; then
  echo "✅ .env.example IS in ZIP (placeholder only)"
else
  echo "ℹ️ .env.example not in ZIP (optional)"
fi

# Refresh the canonical source-code.zip.
cp "$OUT" "$ROOT/public/source-code.zip"

echo ""
echo "✅ Created: $OUT"
echo "✅ Refreshed: $ROOT/public/source-code.zip"
ls -la "$OUT" "$ROOT/public/source-code.zip"
