#!/usr/bin/env bash
# stop.sh — gracefully stop the server started by start.sh
set -euo pipefail

PID_FILE="/tmp/mymobileapp.pid"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

kill_pid() {
  local PID=$1
  echo -e "${YELLOW}→ Sending SIGTERM to PID $PID…${NC}"
  kill "$PID" 2>/dev/null || true

  # Wait up to 5 s for graceful exit
  for i in {1..10}; do
    sleep 0.5
    kill -0 "$PID" 2>/dev/null || { echo -e "${GREEN}✓ Server stopped.${NC}"; return 0; }
  done

  # Force kill
  echo -e "${YELLOW}→ Process still alive, sending SIGKILL…${NC}"
  kill -9 "$PID" 2>/dev/null || true
  echo -e "${GREEN}✓ Server killed.${NC}"
}

# ── Try PID file first ────────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  PID=$(<"$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill_pid "$PID"
  else
    echo -e "${YELLOW}PID $PID not running (stale PID file).${NC}"
  fi
  rm -f "$PID_FILE"
  exit 0
fi

# ── Fallback: find by node server.js ─────────────────────────────────────────
PIDS=$(pgrep -f "node server.js" 2>/dev/null || true)
if [[ -z "$PIDS" ]]; then
  echo -e "${YELLOW}No running server found.${NC}"
  exit 0
fi

echo "Found process(es): $PIDS"
for PID in $PIDS; do
  kill_pid "$PID"
done
