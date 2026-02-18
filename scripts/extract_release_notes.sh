#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(cat "$ROOT_DIR/VERSION")}" 
CHANGELOG="$ROOT_DIR/CHANGELOG.md"

if [[ ! -f "$CHANGELOG" ]]; then
  echo "Missing CHANGELOG.md" >&2
  exit 1
fi

HEADER_PREFIX="## [$VERSION]"

if ! grep -Eq "^## \\[$VERSION\\]" "$CHANGELOG"; then
  echo "Version $VERSION not found in CHANGELOG.md" >&2
  exit 1
fi

{
  echo "## Wind4Strava v$VERSION"
  echo
  awk -v header_prefix="$HEADER_PREFIX" '
    index($0, header_prefix) == 1 { in_section=1; next }
    in_section && /^## \[/ { exit }
    in_section { print }
  ' "$CHANGELOG" | sed '/^[[:space:]]*$/N;/^\n$/D'
} | sed '1{/^[[:space:]]*$/d;}'
