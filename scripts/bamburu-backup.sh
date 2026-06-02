#!/usr/bin/env bash
#
# bamburu-backup.sh — Copia diaria de las BD SQLite del servidor Bamburu a
# Backblaze B2.
#
#   1. Para cada BD (control.db, bamburu.db y data/tenants/*.db) genera un
#      snapshot CONSISTENTE con la SQLite Online Backup API (helper
#      db-snapshot.mjs). NUNCA se copia el .db en crudo: eso evita copias
#      rotas por el WAL.
#   2. Sube cada snapshot a B2 con nombre fechado: <bd>-AAAA-MM-DD.db
#   3. Retención: conserva los últimos RETENTION_DAYS días y borra los más
#      viejos. Una BD corrupta nunca pisa la única copia buena.
#
# Pensado para correr desde un systemd timer como User=ibrahin. Escribe a
# stdout/stderr, que systemd envía al journal (visible en Cockpit / journalctl).
#
# La config de rclone con credenciales B2 vive FUERA del repo, en
# ~/.config/rclone/rclone.conf.
set -euo pipefail

# --- Config -----------------------------------------------------------------
APP_DIR="/home/ibrahin/bamburu"
DATA_DIR="$APP_DIR/data"
REMOTE="backblaze:Bamburu-backup/daily"
RETENTION_DAYS=14
RCLONE="/home/ibrahin/.local/bin/rclone"
NODE="/usr/bin/node"
SNAPSHOT="$APP_DIR/scripts/db-snapshot.mjs"
export RCLONE_CONFIG="/home/ibrahin/.config/rclone/rclone.conf"

DATE="$(date +%F)"   # AAAA-MM-DD
log() { echo "[bamburu-backup] $*"; }

# --- Temporal con limpieza garantizada --------------------------------------
TMPDIR="$(mktemp -d /tmp/bamburu-backup.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

# --- Reunir todas las BD ----------------------------------------------------
shopt -s nullglob
DBS=("$DATA_DIR/control.db" "$DATA_DIR/bamburu.db" "$DATA_DIR"/tenants/*.db)

uploaded=0
failed=0
for db in "${DBS[@]}"; do
  [ -f "$db" ] || continue
  base="$(basename "$db" .db)"
  snap="$TMPDIR/${base}-${DATE}.db"

  log "Snapshot consistente: $db -> $(basename "$snap")"
  if ! "$NODE" "$SNAPSHOT" "$db" "$snap"; then
    log "AVISO: fallo al hacer snapshot de $db; se omite y se continúa."
    failed=$((failed + 1))
    continue
  fi

  log "Subiendo $(basename "$snap") -> $REMOTE/"
  if ! "$RCLONE" copy "$snap" "$REMOTE/" --b2-hard-delete; then
    log "AVISO: fallo al subir $(basename "$snap"); se omite y se continúa."
    failed=$((failed + 1))
    continue
  fi
  uploaded=$((uploaded + 1))
done

log "Snapshots subidos con fecha $DATE: $uploaded (fallos: $failed)"

# --- Retención --------------------------------------------------------------
log "Retención: conservar últimos $RETENTION_DAYS días en $REMOTE/"
"$RCLONE" delete --min-age "${RETENTION_DAYS}d" "$REMOTE/" --b2-hard-delete

if [ "$failed" -gt 0 ]; then
  log "Backup terminado CON AVISOS (fallos: $failed)."
  exit 1
fi
log "Backup completado correctamente."
