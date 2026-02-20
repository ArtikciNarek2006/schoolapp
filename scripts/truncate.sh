#!/usr/bin/env bash
# truncate.sh — wipe all app data (data/*.json + uploads + messages)
# The server will re-seed the project_admin on next start.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA="$ROOT/data"
UPLOADS="$ROOT/uploads"
PID_FILE="/tmp/mymobileapp.pid"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'

echo -e "${YELLOW}⚠  This will permanently erase all app data:${NC}"
echo "   • data/users.json, realms.json, attendance.json, groups.json,"
echo "     notices.json, timetables.json"
echo "   • data/messages/* (all message history)"
echo "   • uploads/* (all uploaded files)"
echo ""
read -rp "Type 'yes' to confirm: " CONFIRM
[[ "$CONFIRM" != "yes" ]] && { echo "Aborted."; exit 0; }

# ── Stop server if running ────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  PID=$(<"$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo -e "${YELLOW}→ Stopping server (PID $PID)…${NC}"
    kill "$PID" && rm -f "$PID_FILE"
    sleep 1
  else
    rm -f "$PID_FILE"
  fi
fi

# ── Reset JSON stores to empty arrays ────────────────────────────────────────
for FILE in users.json realms.json attendance.json groups.json notices.json timetables.json; do
  printf '[]' > "$DATA/$FILE"
  echo "   cleared  data/$FILE"
done

# ── Wipe message files ────────────────────────────────────────────────────────
MSG_DIR="$DATA/messages"
if [[ -d "$MSG_DIR" ]]; then
  find "$MSG_DIR" -maxdepth 1 -name '*.json' -delete
  echo "   cleared  data/messages/*.json"
fi

# ── Wipe uploads (keep the directory) ───────────────────────────────────────
if [[ -d "$UPLOADS" ]]; then
  find "$UPLOADS" -mindepth 1 -not -name '.gitkeep' -delete 2>/dev/null || true
  echo "   cleared  uploads/"
fi

echo -e "${GREEN}✓ All data wiped. Run ./scripts/start.sh to restart fresh.${NC}"
