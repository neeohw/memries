#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="$(basename "$0" .sh)"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run ${BASE}" >&2
  exit 1
fi

exec node "$DIR/$BASE.mjs" "$@"
