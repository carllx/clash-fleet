#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_BIN="${SCRIPT_DIR}/boa"

if [ -f "${TARGET_BIN}" ]; then
  VERSION=$("${TARGET_BIN}" --version 2>&1 || true)
  if [[ "${VERSION}" == *"0.22.0"* ]]; then
    echo "[setup-boa] Found Boa at ${TARGET_BIN}: ${VERSION}"
    exit 0
  fi
fi

# Check if PATH has boa 0.22.0
if command -v boa >/dev/null 2>&1; then
  SYS_VERSION=$(boa --version 2>&1 || true)
  if [[ "${SYS_VERSION}" == *"0.22.0"* ]]; then
    echo "[setup-boa] Using system boa: ${SYS_VERSION}"
    ln -sf "$(command -v boa)" "${TARGET_BIN}"
    exit 0
  fi
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

ASSET_NAME=""
if [[ "$OS" == "darwin" ]]; then
  if [[ "$ARCH" == "arm64" ]]; then
    ASSET_NAME="boa-aarch64-apple-darwin"
  else
    echo "[setup-boa] Unsupported macOS architecture: $ARCH (Boa official releases only provide aarch64 for darwin v0.22)" >&2
    exit 1
  fi
elif [[ "$OS" == "linux" ]]; then
  if [[ "$ARCH" == "x86_64" ]]; then
    ASSET_NAME="boa-x86_64-unknown-linux-gnu"
  else
    echo "[setup-boa] Unsupported Linux architecture: $ARCH" >&2
    exit 1
  fi
else
  echo "[setup-boa] Unsupported OS: $OS" >&2
  exit 1
fi

URL="https://github.com/boa-dev/boa/releases/download/v0.22/${ASSET_NAME}"
echo "[setup-boa] Downloading Boa 0.22.0 from ${URL}..."
curl -fsSL -o "${TARGET_BIN}" "${URL}"
chmod +x "${TARGET_BIN}"

echo "[setup-boa] Verified Boa binary: $("${TARGET_BIN}" --version)"
