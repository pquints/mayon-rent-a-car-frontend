#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/Public"

FILES=(
  "index.html"
  "about.html"
  "contact-us.html"
  "services.html"
  "self-drive-rental.html"
  "with-driver-rental.html"
  "airport-transfers.html"
  "inbound-outbound-transfers.html"
  "fleet.html"
  "dashboard.html"
)

for file in "${FILES[@]}"; do
  root_file="$ROOT_DIR/$file"
  public_file="$PUBLIC_DIR/$file"

  if [[ ! -f "$root_file" || ! -f "$public_file" ]]; then
    echo "Missing sync pair: $file" >&2
    exit 1
  fi

  if ! cmp -s "$root_file" "$public_file"; then
    echo "Out of sync: $file" >&2
    exit 1
  fi
done

echo "Frontend HTML copies are in sync."