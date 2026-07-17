#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/Public"

FILES=(
  "index.html"
  "about.html"
  "contact-us.html"
  "services.html"
  "fleet.html"
  "dashboard.html"
)

for file in "${FILES[@]}"; do
  if [[ ! -f "$PUBLIC_DIR/$file" ]]; then
    echo "Missing source file: $PUBLIC_DIR/$file" >&2
    exit 1
  fi
  cp "$PUBLIC_DIR/$file" "$ROOT_DIR/$file"
done

echo "Synced Public HTML pages to root."
