#!/usr/bin/env bash
# Build source-code ZIP with strict file-level allowlist.
# P0.10 improvements over P0.9:
#   - Only ROOT-level .env.example is allowed. Any .env.example inside
#     src/, prisma/, or scripts/ is forbidden (catches sneaky nested files).
#   - Post-zip scan walks the ZIP's full file listing and applies forbidden
#     patterns to EVERY entry (not just top-level).
#   - Secret value scan uses MULTIPLE patterns: AUTH_SECRET, password,
#     private key markers, etc. (P0.9 only matched one regex.)
set -e

ROOT=/home/z/my-project
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
OUT="$ROOT/public/source-code-P0.10-${TIMESTAMP}.zip"
STAGE=$(mktemp -d /tmp/source-stage.XXXXXX)

trap "rm -rf '$STAGE'" EXIT

# Walk each file individually, reject forbidden basenames via case statement.
# P0.10: .env.example is NOT allowed here — it's only allowed at the root,
# and we add it explicitly in step 3 below.
copy_dir_filtered() {
  local src_dir="$1" dest_dir="$2"
  mkdir -p "$dest_dir"
  while IFS= read -r file; do
    local name
    name=$(basename "$file")

    case "$name" in
      .env|.env.local|.env.*.local)
        echo "ERROR: forbidden file in source tree: $file"
        exit 1
        ;;
      .env.*)
        # P0.10: ANY .env.<something> inside source dirs is forbidden,
        # INCLUDING .env.example. We only allow .env.example at the ROOT
        # (added explicitly in step 3 below).
        echo "ERROR: forbidden file in source tree: $file (nested .env.* not allowed; root .env.example is added separately)"
        exit 1
        ;;
      *.pem|*.key|*.p12|*.pfx|id_rsa|id_dsa|id_ed25519|*.crt|*.cer)
        echo "ERROR: forbidden file in source tree: $file"
        exit 1
        ;;
      .DS_Store|*.log|*.log.*)
        continue  # silently skip noise
        ;;
    esac

    local rel="${file#$src_dir/}"
    mkdir -p "$(dirname "$dest_dir/$rel")"
    cp "$file" "$dest_dir/$rel"
  done < <(find "$src_dir" -type f \
    -not -path '*/node_modules/*' \
    -not -path '*/.next/*' \
    -not -path '*/.git/*')
}

# 1. Copy allowed directories with strict filtering.
copy_dir_filtered "$ROOT/src"      "$STAGE/src"
copy_dir_filtered "$ROOT/prisma"   "$STAGE/prisma"
copy_dir_filtered "$ROOT/scripts"  "$STAGE/scripts"

# 2. Copy top-level config files (explicit allowlist, not globs).
for f in package.json next.config.ts tsconfig.json tailwind.config.ts \
         postcss.config.mjs components.json; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$STAGE/"
done

# 3. P0.10: explicitly copy .env.example ONLY from the project root.
# This is the only allowed .env* file anywhere in the ZIP.
if [ -f "$ROOT/.env.example" ]; then
  cp "$ROOT/.env.example" "$STAGE/.env.example"
fi

# 4. Pre-zip scan #1: walk the staging directory and reject ANY .env* file
#    EXCEPT the single root-level .env.example that we explicitly copied.
echo ""
echo "=== Pre-zip scan #1: any .env* file in staging (except root .env.example) ==="
# Match all .env* files, then exclude the root .env.example specifically.
FORBIDDEN=$(find "$STAGE" -type f \( -name '.env' -o -name '.env.local' -o -name '.env.*' \) 2>/dev/null \
  | grep -v "^$STAGE/\.env\.example$" || true)
if [ -n "$FORBIDDEN" ]; then
  echo "ERROR: forbidden .env* files found (only root .env.example is allowed):"
  echo "$FORBIDDEN"
  exit 1
fi
echo "✅ No forbidden .env* files (root .env.example is allowed)"

# Count how many .env.example files exist (should be exactly 1, at root).
EXAMPLE_COUNT=$(find "$STAGE" -type f -name '.env.example' 2>/dev/null | wc -l)
if [ "$EXAMPLE_COUNT" -ne 1 ]; then
  echo "ERROR: expected exactly 1 .env.example (at root), found $EXAMPLE_COUNT:"
  find "$STAGE" -type f -name '.env.example' 2>/dev/null
  exit 1
fi
echo "✅ Exactly 1 .env.example (at root)"

# 5. Pre-zip scan #2: scan for private key markers and common secret patterns.
#    P0.10: scans multiple patterns, not just one regex.
echo ""
echo "=== Pre-zip scan #2: scan for secret/private-key patterns ==="
SECRETS=$(grep -rE \
  '-----BEGIN [A-Z ]*PRIVATE KEY-----|\
AUTH_SECRET=[a-f0-9]{64}|\
password_hash\s*=\s*[\"'\'']\S+|\
api[_-]?key\s*=\s*[\"'\'']\S+|\
stripe[_-]?key\s*=\s*[\"'\'']\S+|\
aws[_-]?secret\s*=\s*[\"'\'']\S+' \
  "$STAGE" 2>/dev/null || true)
if [ -n "$SECRETS" ]; then
  echo "ERROR: secret/private-key patterns found in staging:"
  echo "$SECRETS"
  exit 1
fi
echo "✅ No secret/private-key patterns in staging"

# 6. Build the ZIP from the staging directory.
cd "$STAGE"
zip -r "$OUT" . > /dev/null

# 7. Post-zip verification: walk the ZIP's full file listing and apply
#    forbidden patterns to EVERY entry (not just top-level).
echo ""
echo "=== Post-zip verification: walk ZIP listing ==="
# Extract file list from ZIP (last column of unzip -l).
# Skip the first 3 header lines and last 3 footer lines.
ZIP_LISTING=$(unzip -l "$OUT" | awk 'NR>3 && NF>=4 {print $4}')

# Iterate each file path in the ZIP and apply forbidden patterns.
while IFS= read -r path; do
  [ -z "$path" ] && continue
  # Skip directory entries.
  [[ "$path" == */ ]] && continue
  name=$(basename "$path")
  case "$name" in
    .env|.env.local|.env.*.local)
      echo "ERROR: forbidden entry in ZIP: $path"
      exit 1
      ;;
    .env.example)
      # Allowed ONLY at the root (no / in path before .env.example).
      if [[ "$path" != ".env.example" ]]; then
        echo "ERROR: nested .env.example in ZIP (only root allowed): $path"
        exit 1
      fi
      ;;
    .env.*)
      echo "ERROR: forbidden .env.* entry in ZIP: $path"
      exit 1
      ;;
    *.pem|*.key|*.p12|*.pfx|id_rsa|id_dsa|id_ed25519|*.crt|*.cer)
      echo "ERROR: forbidden entry in ZIP: $path"
      exit 1
      ;;
  esac
done <<< "$ZIP_LISTING"
echo "✅ All ZIP entries pass forbidden-pattern check"

# Refresh canonical source-code.zip.
cp "$OUT" "$ROOT/public/source-code.zip"

echo ""
echo "✅ Created: $OUT"
echo "✅ Refreshed: $ROOT/public/source-code.zip"
ls -la "$OUT" "$ROOT/public/source-code.zip"
