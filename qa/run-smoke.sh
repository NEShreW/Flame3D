#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${FLAME3D_BASE_URL:-http://127.0.0.1:8000}"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run smoke QA"
  exit 1
fi

echo "=== smoke-runtime-export ==="
FLAME3D_BASE_URL="$BASE_URL" npx --yes -p playwright node qa/smoke-runtime-export.js

echo "=== test-playtest-movement ==="
FLAME3D_BASE_URL="$BASE_URL" npx -p playwright node qa/test-playtest-movement.js

echo "=== test-skin-fix ==="
FLAME3D_BASE_URL="$BASE_URL" npx -p playwright node qa/test-skin-fix.js

echo "All smoke tests passed."
