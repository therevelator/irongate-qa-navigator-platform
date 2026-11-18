#!/usr/bin/env bash
# Start the API (and optionally the Vite dev server) in the background and wait until they answer.
#
# Usage: scripts/ci/start-services.sh [api] [web]      (default: api)
#   api  -> npx tsx server/index.ts on $PORT (default 3000), log in $LOG_DIR/api.log
#   web  -> npx vite on 5173 (the app calls http://localhost:3000/api on localhost), log in $LOG_DIR/web.log
# Needs DATABASE_URL and JWT_SECRET in the environment (or .env). Exits non-zero, printing the
# log tail, when a service does not become healthy in time.
set -euo pipefail

cd "$(dirname "$0")/../.."

LOG_DIR=${LOG_DIR:-${TMPDIR:-/tmp}/irongate-ci-logs}
PORT=${PORT:-3000}
mkdir -p "$LOG_DIR"

services=("$@")
[ ${#services[@]} -eq 0 ] && services=(api)

wait_for() {
  local name=$1 url=$2 log=$3 pid=$4 tries=${5:-90}
  echo "==> Waiting for $name at $url"
  for i in $(seq 1 "$tries"); do
    if curl -fs -o /dev/null --max-time 5 "$url"; then
      echo "==> $name is up (after ${i} attempt(s))"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name exited before it became healthy. Log:" >&2
      tail -n 100 "$log" >&2 || true
      return 1
    fi
    sleep 2
  done
  echo "$name did not become healthy in time. Log:" >&2
  tail -n 100 "$log" >&2 || true
  return 1
}

for svc in "${services[@]}"; do
  case "$svc" in
    api)
      API_RATE_LIMIT_MAX=${API_RATE_LIMIT_MAX:-10000} PORT=$PORT \
        nohup npx tsx server/index.ts > "$LOG_DIR/api.log" 2>&1 &
      pid=$!
      echo "$pid" > "$LOG_DIR/api.pid"
      wait_for API "http://localhost:$PORT/health" "$LOG_DIR/api.log" "$pid"
      ;;
    web)
      nohup npx vite --port 5173 --strictPort --host > "$LOG_DIR/web.log" 2>&1 &
      pid=$!
      echo "$pid" > "$LOG_DIR/web.pid"
      wait_for Web "http://localhost:5173/" "$LOG_DIR/web.log" "$pid"
      ;;
    *)
      echo "Unknown service '$svc' (expected api or web)" >&2
      exit 2
      ;;
  esac
done
