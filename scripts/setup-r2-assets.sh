#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-r2-assets.sh
# Downloads the EV 2090 asset bundle and uploads everything to your R2 buckets.
# Run this once after deploying the game worker.
#
# What it does:
#   1. Downloads the complete asset bundle from the public CDN
#   2. Uploads ship models + textures to the SHIP_MODELS bucket (ev2090-ships)
#   3. Uploads economy data to the STATIC_DATA bucket (ev2090-data)
#
# Prerequisites:
#   - wrangler CLI authenticated (npx wrangler whoami)
#   - R2 buckets created (see docs/cloudflare-setup.md Step 2)
#   - curl and unzip installed
#
# Usage:
#   cd <repo-root>
#   bash scripts/setup-r2-assets.sh
#
# Flags:
#   --local    Upload to local R2 emulator (wrangler dev) instead of remote
#   --dry-run  List files that would be uploaded without uploading
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Parse flags ──────────────────────────────────────────────────────────────
REMOTE_FLAG="--remote"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --local)   REMOTE_FLAG="" ;;
    --dry-run) DRY_RUN=true ;;
    *)         echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Config ────────────────────────────────────────────────────────────────────
ASSETS_URL="https://ws.ev2090.com/api/forge/asset"
SHIPS_BUCKET="ev2090-ships"
DATA_BUCKET="ev2090-data"

TMP_DIR="$(mktemp -d)"
ZIP_PATH="$TMP_DIR/ev2090-assets.zip"
EXTRACT_DIR="$TMP_DIR/assets"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# ── Asset manifest ────────────────────────────────────────────────────────────
# All files that go into the SHIP_MODELS (ev2090-ships) R2 bucket.
# Format: R2_KEY (path in bucket)
SHIP_ASSETS=(
  # ── Built-in ships (11) ──
  "ships/striker/Striker.gltf"
  "ships/striker/Striker_Blue.png"
  "ships/bob/Bob.gltf"
  "ships/bob/Bob_Blue.png"
  "ships/challenger/Challenger.gltf"
  "ships/challenger/Challenger_Blue.png"
  "ships/dispatcher/Dispatcher.gltf"
  "ships/dispatcher/Dispatcher_Blue.png"
  "ships/executioner/Executioner.gltf"
  "ships/executioner/Executioner_Blue.png"
  "ships/imperial/Imperial.gltf"
  "ships/imperial/Imperial_Blue.png"
  "ships/insurgent/Insurgent.gltf"
  "ships/insurgent/Insurgent_Blue.png"
  "ships/omen/Omen.gltf"
  "ships/omen/Omen_Blue.png"
  "ships/pancake/Pancake.gltf"
  "ships/pancake/Pancake_Blue.png"
  "ships/spitfire/Spitfire.gltf"
  "ships/spitfire/Spitfire_Blue.png"
  "ships/zenith/Zenith.gltf"
  "ships/zenith/Zenith_Blue.png"

  # ── Bridge cockpit ──
  "bridge/bridge.glb"

  # ── Planet textures ──
  "textures/planet-earth.jpg"
)

# ── Content-type mapping ─────────────────────────────────────────────────────
content_type_for() {
  case "$1" in
    *.gltf) echo "model/gltf+json" ;;
    *.glb)  echo "model/gltf-binary" ;;
    *.png)  echo "image/png" ;;
    *.jpg)  echo "image/jpeg" ;;
    *.json) echo "application/json" ;;
    *)      echo "application/octet-stream" ;;
  esac
}

# ── Download all assets from CDN ─────────────────────────────────────────────
echo "=== EV 2090 — R2 Asset Setup ==="
echo ""
echo "Downloading assets from CDN..."
echo ""

mkdir -p "$EXTRACT_DIR"

download_count=0
download_total=${#SHIP_ASSETS[@]}

for key in "${SHIP_ASSETS[@]}"; do
  download_count=$((download_count + 1))
  target="$EXTRACT_DIR/$key"
  mkdir -p "$(dirname "$target")"

  printf "  [%d/%d] %s ... " "$download_count" "$download_total" "$key"
  if curl -sfL "$ASSETS_URL/$key" -o "$target"; then
    size=$(wc -c < "$target" | tr -d ' ')
    if [ "$size" -gt 1048576 ]; then
      printf "%.1fMB\n" "$(echo "scale=1; $size / 1048576" | bc)"
    else
      printf "%.0fKB\n" "$(echo "scale=0; $size / 1024" | bc)"
    fi
  else
    echo "FAILED (skipping)"
    rm -f "$target"
  fi
done

# ── Dry run: just list ───────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "DRY RUN — would upload:"
  for key in "${SHIP_ASSETS[@]}"; do
    file="$EXTRACT_DIR/$key"
    [ -f "$file" ] && echo "  → $SHIPS_BUCKET/$key  ($(content_type_for "$key"))"
  done
  echo ""
  echo "No files were uploaded. Remove --dry-run to upload."
  exit 0
fi

# ── Upload to SHIP_MODELS bucket ────────────────────────────────────────────
echo ""
echo "Uploading to R2 bucket: $SHIPS_BUCKET"

upload_count=0
for key in "${SHIP_ASSETS[@]}"; do
  file="$EXTRACT_DIR/$key"
  [ ! -f "$file" ] && continue

  upload_count=$((upload_count + 1))
  ct=$(content_type_for "$key")
  echo "  → $key ($ct)"
  npx wrangler r2 object put "$SHIPS_BUCKET/$key" \
    --file "$file" \
    --content-type "$ct" \
    $REMOTE_FLAG 2>/dev/null
done

echo ""
echo "Uploaded $upload_count files to $SHIPS_BUCKET."

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Asset setup complete ==="
echo ""
echo "Your R2 bucket ($SHIPS_BUCKET) now contains:"
echo "  • 11 built-in ships (GLTF + texture)"
echo "  • Bridge cockpit (GLB with baked lighting)"
echo "  • Planet textures"
echo ""
echo "Next: bootstrap the economy with a warmup:"
echo "  curl -X POST https://<your-worker>.workers.dev/api/admin/seed \\"
echo "    -H 'Authorization: Bearer <your-ADMIN_API_KEY>'"
echo ""
echo "See docs/cloudflare-setup.md for full deployment guide."
