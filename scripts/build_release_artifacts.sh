#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(cat "$ROOT_DIR/VERSION")}" 
DIST_DIR="$ROOT_DIR/dist"
TMP_DIR="$ROOT_DIR/.tmp/release-$VERSION"
PKG_DIR="$TMP_DIR/Wind4Strava"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: $VERSION" >&2
  exit 1
fi

rm -rf "$TMP_DIR"
mkdir -p "$PKG_DIR" "$DIST_DIR"

cp "$ROOT_DIR/manifest.json" "$PKG_DIR/manifest.json"
cp -R "$ROOT_DIR/src" "$PKG_DIR/src"

(
  cd "$PKG_DIR"
  zip -qr "$DIST_DIR/Wind4Strava-$VERSION-webextension.zip" .
)

cp "$DIST_DIR/Wind4Strava-$VERSION-webextension.zip" "$DIST_DIR/Wind4Strava-$VERSION-firefox.xpi"

echo "Built artifacts:"
echo "- $DIST_DIR/Wind4Strava-$VERSION-webextension.zip"
echo "- $DIST_DIR/Wind4Strava-$VERSION-firefox.xpi"
