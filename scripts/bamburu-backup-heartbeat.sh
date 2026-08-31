#!/usr/bin/env bash
#
# bamburu-backup-heartbeat.sh — Vigilante INDEPENDIENTE de las copias de seguridad.
#
# Vigila CADA copia por separado y avisa segun cuantas esten caidas (S6, 31 ago 2026):
#   · una caida  -> AVISO    (te has quedado con una sola copia)
#   · las dos    -> CRITICO  (no hay ninguna copia con exito reciente)
#
# Vigilar solo "que fallen las dos" seria reintroducir el fallo silencioso que
# costo el cambio desde Backblaze: una secundaria rota durante un mes, con la
# principal en verde, no avisaria a nadie y creerias tener dos copias.
#
# Corre desde su propio timer, separado de los backups, para captar tanto
# "corrio y fallo siempre" como "el timer ni disparo".
# (El caso "servidor muerto del todo" no lo cubre nada local: para eso esta el
#  ping a healthchecks.io que hace la copia principal.)
set -uo pipefail

STATE_DIR="$HOME/.local/state/bamburu-backup"
MAILTO="ibrahingil@gmail.com"
MAILFROM="Bamburu <noreply@bamburu.com>"
NODE="/usr/bin/node"
MAX_AGE=$((48*3600))
UNIT_SECUNDARIA="/etc/systemd/system/bamburu-backup-secondary.timer"

send_email(){
  local subject="$1" body="$2"
  if [ -z "${RESEND_API_KEY:-}" ]; then echo "[heartbeat] WARN: sin RESEND_API_KEY"; return 0; fi
  local payload
  payload="$("$NODE" -e 'const[f,t,s,b]=process.argv.slice(1);process.stdout.write(JSON.stringify({from:f,to:[t],subject:s,text:b}))' "$MAILFROM" "$MAILTO" "$subject" "$body")"
  curl -s -m 30 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
    --data "$payload" >/dev/null 2>&1
}

# Que copias se ESPERAN. La secundaria solo cuenta si su timer esta instalado:
# antes de terminar S6 no existe, y avisar por ella seria una falsa alarma diaria.
NOMBRES=("principal"); MARCAS=("$STATE_DIR/last-success")
if [ -f "$UNIT_SECUNDARIA" ]; then
  NOMBRES+=("secundaria"); MARCAS+=("$STATE_DIR/last-success-secondary")
fi

now="$(date +%s)"
caidas=0; total=${#NOMBRES[@]}; DETALLE=""

for i in "${!NOMBRES[@]}"; do
  nombre="${NOMBRES[$i]}"; marca="${MARCAS[$i]}"
  if [ -f "$marca" ]; then last="$(cat "$marca" 2>/dev/null || echo 0)"; else last=0; fi
  case "$last" in ''|*[!0-9]*) last=0;; esac
  age=$(( now - last ))
  if [ "$last" -eq 0 ]; then
    DETALLE+="  · $nombre: NUNCA se ha registrado una copia con exito"$'\n'; caidas=$((caidas+1))
  elif [ "$age" -gt "$MAX_AGE" ]; then
    DETALLE+="  · $nombre: ultima copia con exito $(date -d "@$last") (hace ~$(( age/3600 ))h) -- CAIDA"$'\n'; caidas=$((caidas+1))
  else
    DETALLE+="  · $nombre: OK, hace ~$(( age/3600 ))h"$'\n'
  fi
done

REVISAR="Revisa en el servidor:
  journalctl -u bamburu-backup.service -n 50
  journalctl -u bamburu-backup-secondary.service -n 50
  systemctl list-timers 'bamburu-backup*'"

if [ "$caidas" -eq 0 ]; then
  echo "[heartbeat] OK: $total/$total copias al dia"
  printf '%s' "$DETALLE"
elif [ "$caidas" -ge "$total" ]; then
  if [ "$total" -eq 1 ]; then echo "[heartbeat] CRITICO: la unica copia esta caida"; else echo "[heartbeat] CRITICO: las $total copias estan caidas"; fi
  send_email "🚨 CRITICO Bamburu: SIN NINGUNA copia con exito en +48h" \
"$( [ "$total" -eq 1 ] && echo "La copia" || echo "NINGUNA de las $total copias" ) sin exito reciente. Ahora mismo no hay respaldo.

$DETALLE
$REVISAR"
else
  echo "[heartbeat] AVISO: $caidas de $total copias caidas"
  send_email "⚠️ Bamburu: te has quedado con $((total-caidas)) de $total copias" \
"Una copia lleva mas de 48h sin exito. La otra sigue funcionando, asi que hay
respaldo, pero has perdido la redundancia y conviene arreglarlo antes de que
la que queda tambien falle.

$DETALLE
$REVISAR"
fi
