#!/usr/bin/env bash
#
# bamburu-backup-heartbeat.sh — Vigilante INDEPENDIENTE del backup.
# Si no consta una copia con éxito en las últimas 48h (o nunca), avisa por email.
# Corre desde su propio timer systemd, separado del backup, para captar tanto
# "el backup corrió y falló siempre" como "el timer del backup ni disparó".
#
# (El caso "servidor muerto del todo" no lo puede cubrir nada local: para eso está
#  el ping a healthchecks.io que hace el backup — su monitor externo avisa solo.)
set -uo pipefail

STATE_DIR="$HOME/.local/state/bamburu-backup"
LAST_OK="$STATE_DIR/last-success"
MAILTO="ibrahingil@gmail.com"
MAILFROM="Bamburu <noreply@bamburu.com>"
NODE="/usr/bin/node"
MAX_AGE=$((48*3600))

send_email(){
  local subject="$1" body="$2"
  if [ -z "${RESEND_API_KEY:-}" ]; then echo "[heartbeat] WARN: sin RESEND_API_KEY"; return 0; fi
  local payload
  payload="$("$NODE" -e 'const[f,t,s,b]=process.argv.slice(1);process.stdout.write(JSON.stringify({from:f,to:[t],subject:s,text:b}))' "$MAILFROM" "$MAILTO" "$subject" "$body")"
  curl -s -m 30 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
    --data "$payload" >/dev/null 2>&1
}

now="$(date +%s)"
if [ -f "$LAST_OK" ]; then last="$(cat "$LAST_OK" 2>/dev/null || echo 0)"; else last=0; fi
case "$last" in ''|*[!0-9]*) last=0;; esac

age=$(( now - last ))
if [ "$last" -eq 0 ] || [ "$age" -gt "$MAX_AGE" ]; then
  if [ "$last" -eq 0 ]; then when="NUNCA se ha registrado un backup con éxito"; else when="Último backup con éxito: $(date -d "@$last") (hace ~$(( age/3600 ))h)"; fi
  echo "[heartbeat] ALERTA: $when"
  send_email "⚠️ Bamburu: SIN backup con éxito en +48h" "$when

Revisa en el servidor:
  journalctl -u bamburu-backup.service -n 50
  systemctl list-timers bamburu-backup.timer"
else
  echo "[heartbeat] OK: backup con éxito hace ~$(( age/3600 ))h"
fi
