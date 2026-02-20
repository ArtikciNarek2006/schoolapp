#!/usr/bin/env sh
# docker-entrypoint.sh — wipe all data then start the server (non-interactive)
# This runs every time the container starts, giving a clean slate.
set -e

DATA=/app/data
UPLOADS=/app/uploads

echo "[entrypoint] Truncating all data stores…"

# Reset JSON collections to empty arrays
for FILE in users.json realms.json attendance.json groups.json notices.json timetables.json; do
  printf '[]' > "$DATA/$FILE"
  echo "[entrypoint]   cleared $FILE"
done

# Wipe message files
find "$DATA/messages" -maxdepth 1 -name '*.json' -delete 2>/dev/null || true
echo "[entrypoint]   cleared data/messages/*.json"

# Wipe uploads
find "$UPLOADS" -mindepth 1 -not -name '.gitkeep' -delete 2>/dev/null || true
echo "[entrypoint]   cleared uploads/"

echo "[entrypoint] Starting server…"
exec node server.js
