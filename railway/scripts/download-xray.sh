#!/usr/bin/env bash
# Downloads the Xray-core binary into the given directory (default: ./data/xray).
# Used by local development and by the node agent.
set -euo pipefail

TARGET_DIR="${1:-./data/xray}"
VERSION="${XRAY_VERSION:-}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) SUFFIX="64" ;;
  aarch64|arm64) SUFFIX="arm64-v8a" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

mkdir -p "$TARGET_DIR"
if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL https://api.github.com/repos/XTLS/Xray-core/releases/latest | sed -n 's/.*"tag_name": *"v\?\([^"]*\)".*/\1/p' | head -n1)"
fi
[ -n "$VERSION" ] || { echo "could not resolve Xray version" >&2; exit 1; }

URL="https://github.com/XTLS/Xray-core/releases/download/v${VERSION}/Xray-linux-${SUFFIX}.zip"
echo "downloading ${URL}"
curl -fsSL "$URL" -o "$TARGET_DIR/xray.zip"
if command -v unzip >/dev/null 2>&1; then
  unzip -o "$TARGET_DIR/xray.zip" xray -d "$TARGET_DIR" >/dev/null
else
  python3 - "$TARGET_DIR" <<'PY'
import sys, zipfile, os
target = sys.argv[1]
with zipfile.ZipFile(os.path.join(target, "xray.zip")) as archive:
    archive.extract("xray", target)
PY
fi
rm -f "$TARGET_DIR/xray.zip"
chmod +x "$TARGET_DIR/xray"
echo "xray ${VERSION} installed → ${TARGET_DIR}/xray"
