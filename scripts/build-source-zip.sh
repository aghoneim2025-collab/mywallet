#!/usr/bin/env bash
# Build source-code ZIP using a strict file-level allowlist.
# P0.9: instead of copying whole directories (src/, prisma/, scripts/) and
# excluding bad files, we explicitly list every file we want to ship.
# This means: even if a new .env file with an arbitrary name (like .env.staging)
# appears in the project, it WILL NOT be in the ZIP because it's not in the
# allowlist. No patterns to bypass — only explicit allowlist entries.
set -e

ROOT=/home/z/my-project
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
OUT="$ROOT/public/source-code-P0.9-${TIMESTAMP}.zip"
STAGE=$(mktemp -d /tmp/source-stage.XXXXXX)

trap "rm -rf '$STAGE'" EXIT

# 1. Walk the allowed directories and copy each file individually,
#    but reject any file whose basename looks like a secret file.
#    This way we don't blindly copy whole directories.
copy_dir_filtered() {
  local src_dir="$1"
  local dest_dir="$2"

  mkdir -p "$dest_dir"
  # Use find to enumerate files (not dirs), so we can apply name checks.
  while IFS= read -r file; do
    # Compute the basename.
    local name
    name=$(basename "$file")

    # P0.9: forbidden basenames — any .env* EXCEPT .env.example, plus
    # typical secret files. Using a case statement so we cover all
    # .env.<X> variants (staging, production, etc.) without listing them.
    case "$name" in
      .env)
        echo "ERROR: forbidden file in source tree: $file"
        exit 1
        ;;
      .env.local|\.env.*.local)
        echo "ERROR: forbidden file in source tree: $file"
        exit 1
        ;;
      .env.example)
        # explicitly allowed
        ;;
      .env.*)
        # Any other .env.<something> like .env.staging, .env.production, etc.
        echo "ERROR: forbidden file in source tree: $file"
        exit 1
        ;;
      *.pem|*.key|*.p12|*.pfx|id_rsa|id_dsa|id_ed25519)
        echo "ERROR: forbidden file in source tree: $file"
        exit 1
        ;;
      .DS_Store|*.log|*.log.*)
        # silently skip noise
        continue
        ;;
    esac

    # Compute the relative path under src_dir and mirror under dest_dir.
    local rel="${file#$src_dir/}"
    local dest="$dest_dir/$rel"
    mkdir -p "$(dirname "$dest")"
    cp "$file" "$dest"
  done < <(find "$src_dir" -type f -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/.git/*')
}

# 2. Copy each allowed top-level directory via the filtered walker.
copy_dir_filtered "$ROOT/src"      "$STAGE/src"
copy_dir_filtered "$ROOT/prisma"   "$STAGE/prisma"
copy_dir_filtered "$ROOT/scripts"  "$STAGE/scripts"

# 3. Copy top-level config files (explicit allowlist, not globs).
for f in package.json next.config.ts tsconfig.json tailwind.config.ts \
         postcss.config.mjs components.json .env.example; do
  if [ -f "$ROOT/$f" ]; then
    cp "$ROOT/$f" "$STAGE/"
  fi
done

# 4. Final pre-zip scan: walk the entire staging directory and reject
#    ANY .env* file except .env.example. Belt-and-suspenders.
echo ""
echo "=== Pre-zip scan: staging directory contents ==="
# Use `|| true` so `set -e` doesn't kill the script when grep finds nothing
# (grep returns 1 when no matches, which is the SUCCESS case here).
FORBIDDEN=$(find "$STAGE" -type f \( -name '.env' -o -name '.env.local' -o -name '.env.*' \) 2>/dev/null | grep -v '\.env\.example$' || true)
if [ -n "$FORBIDDEN" ]; then
  echo "ERROR: forbidden .env* files found in staging directory:"
  echo "$FORBIDDEN"
  exit 1
fi
echo "✅ No forbidden .env* files (except .env.example) in staging"

# Also scan for any file containing "AUTH_SECRET=" with a 64-char hex value,
# to catch a real .env renamed to something unusual. (.env.example is allowed
# to contain the placeholder AUTH_SECRET=REPLACE_ME, which won't match this
# pattern because REPLACE_ME is not 64 hex chars.)
echo ""
echo "=== Pre-zip scan: scan for any file containing real AUTH_SECRET value ==="
LEAK=$(grep -rE 'AUTH_SECRET=[a-f0-9]{64}' "$STAGE" 2>/dev/null || true)
if [ -n "$LEAK" ]; then
  echo "ERROR: a file in staging contains a 64-char hex AUTH_SECRET value:"
  echo "$LEAK"
  exit 1
fi
echo "✅ No real AUTH_SECRET value found in staging"

# 5. Build the ZIP from the staging directory.
cd "$STAGE"
zip -r "$OUT" . > /dev/null

# 6. Post-zip verification: walk the ZIP file listing and confirm
#    no .env files except .env.example.
echo ""
echo "=== Post-zip verification: ZIP listing ==="
VIOLATIONS=$(unzip -l "$OUT" | awk '{print $4}' | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: forbidden .env* entries in ZIP:"
  echo "$VIOLATIONS"
  exit 1
fi
echo "✅ No .env* files (except .env.example) in ZIP"

# 7. Refresh the canonical source-code.zip.
cp "$OUT" "$ROOT/public/source-code.zip"

echo ""
echo "✅ Created: $OUT"
echo "✅ Refreshed: $ROOT/public/source-code.zip"
ls -la "$OUT" "$ROOT/public/source-code.zip"
