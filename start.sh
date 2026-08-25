#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

find_node() {
  if [ -n "${NODE_BINARY:-}" ] && [ -x "$NODE_BINARY" ]; then
    printf '%s\n' "$NODE_BINARY"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  if [ -n "${HOME:-}" ]; then
    runtime_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
    if [ -x "$runtime_node" ]; then
      printf '%s\n' "$runtime_node"
      return
    fi
  fi

  return 1
}

NODE_BIN=$(find_node) || {
  printf '%s\n' 'Error: Node.js was not found. Install Node.js 18.17 or newer, or set NODE_BINARY.' >&2
  exit 1
}

if ! "$NODE_BIN" -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 18 || (major === 18 && minor >= 17) ? 0 : 1)"; then
  printf 'Error: Node.js 18.17 or newer is required; found %s.\n' "$($NODE_BIN --version)" >&2
  exit 1
fi

NEXT_ENTRY="$SCRIPT_DIR/node_modules/next/dist/bin/next"
if [ ! -f "$NEXT_ENTRY" ]; then
  printf '%s\n' 'Error: node_modules is incomplete. Install dependencies before starting the server.' >&2
  exit 1
fi

export PATH="$(dirname -- "$NODE_BIN"):${PATH:-/usr/bin:/bin}"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-dev}"
export NEXT_DIST_DIR

case "$PORT" in
  ''|*[!0-9]*)
    printf 'Error: PORT must be an integer between 1 and 65535; received %s.\n' "$PORT" >&2
    exit 1
    ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  printf 'Error: PORT must be between 1 and 65535; received %s.\n' "$PORT" >&2
  exit 1
fi

if [ ! -f .env.local ]; then
  printf '%s\n' 'Warning: .env.local is missing. The server will start, but store and payment configuration is required for checkout.' >&2
fi

if [ "${START_DRY_RUN:-0}" = '1' ]; then
  printf 'Node: %s (%s)\n' "$NODE_BIN" "$($NODE_BIN --version)"
  printf 'Next.js: %s\n' "$NEXT_ENTRY"
  printf 'Development output: %s\n' "$NEXT_DIST_DIR"
  printf 'URL: http://%s:%s\n' "$HOST" "$PORT"
  exit 0
fi

exec "$NODE_BIN" "$NEXT_ENTRY" dev -H "$HOST" -p "$PORT"
