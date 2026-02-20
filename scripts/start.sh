#!/usr/bin/env bash
# start.sh — start the Node server in the background, writing a PID file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="/tmp/mymobileapp.pid"
LOG_FILE="$ROOT/server.log"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

# ── Already running? ──────────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  PID=$(<"$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo -e "${YELLOW}Server is already running (PID $PID).${NC}"
    echo "  Log: $LOG_FILE"
    echo "  Stop: ./scripts/stop.sh"
    exit 0
  else
    rm -f "$PID_FILE"   # stale pid file
  fi
fi

# ── Load env for PORT display ─────────────────────────────────────────────────
PORT=3000
[[ -f "$ROOT/.env" ]] && PORT=$(grep -E '^PORT=' "$ROOT/.env" | cut -d= -f2 | tr -d '[:space:]' || true)
PORT=${PORT:-3000}

# ── Start server ──────────────────────────────────────────────────────────────
cd "$ROOT"
nohup node server.js >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
PID=$(<"$PID_FILE")

# ── Wait a moment and confirm it stayed up ────────────────────────────────────
sleep 1
if kill -0 "$PID" 2>/dev/null; then
  echo -e "${GREEN}✓ Server started (PID $PID) on http://localhost:${PORT}${NC}"
  echo "  Log:  tail -f $LOG_FILE"
  echo "  Stop: ./scripts/stop.sh"
else
  echo -e "${RED}✗ Server exited immediately. Check the log:${NC}"
  tail -20 "$LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
