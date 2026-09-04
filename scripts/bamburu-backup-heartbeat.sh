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
#
# ⚙️ 4 SEP 2026 — DOS CAMBIOS, Y LOS DOS SALEN DE UNA AVERIA REAL DE ESTE MISMO DIA.
# La copia secundaria fallo a las 03:35 (credencial de Drive caducada). El aviso de
# "corrio y fallo" SI salio por Telegram desde bamburu-backup.sh, correctamente. Pero a
# las 09:04 este vigilante dijo "OK: 2/2 copias al dia" con la secundaria rota. No mintio:
# cumplia su propia regla. La regla era el problema, por dos motivos:
#
#   1. EL UMBRAL ERA DE 48 HORAS. Las copias son DIARIAS, asi que 48h deja pasar DOS
#      noches enteras sin copia antes de abrir la boca. Se baja a 26h para las copias:
#      una noche fallada se ve a la mañana siguiente. El manifiesto del historico se queda
#      en 48h porque responde a otra pregunta y no tiene cadencia diaria.
#   2. AVISABA SOLO POR CORREO. El correo esta bien pero no se mira a tiempo, y si Resend
#      lo tira, `send_email` lo deja en un WARN del log y devuelve 0 — un aviso que muere
#      en un registro que no lee nadie. Ahora avisa TAMBIEN por Telegram, con la misma
#      tuberia comun de core/ que usan el arranque y las copias. El correo no se quita:
#      lleva el detalle largo, y dos canales fallan a la vez menos que uno.
#
# Se puede probar sin tocar nada de produccion: BAMBURU_BACKUP_STATE_DIR apunta el estado
# a otra carpeta, y AVISO_TELEGRAM_SECO=1 imprime lo que mandaria sin mandarlo.
set -uo pipefail

# El estado se puede desviar para PROBAR esto de verdad sin tocar el de produccion. Sin la
# variable, exactamente el mismo sitio de siempre.
STATE_DIR="${BAMBURU_BACKUP_STATE_DIR:-$HOME/.local/state/bamburu-backup}"
MAILTO="ibrahingil@gmail.com"
MAILFROM="Bamburu <noreply@bamburu.com>"
NODE="/usr/bin/node"
MAX_AGE=$((48*3600))          # historico/manifiesto: otra pregunta, otra cadencia
MAX_AGE_COPIA=$((26*3600))    # copias: son DIARIAS, asi que una noche fallada ya es noticia
UNIT_SECUNDARIA="/etc/systemd/system/bamburu-backup-secondary.timer"
APP_DIR="/home/ubuntu/bamburu"
MANIFHELPER="$APP_DIR/scripts/lib/manifiesto-copias.mjs"

send_email(){
  local subject="$1" body="$2"
  if [ -z "${RESEND_API_KEY:-}" ]; then echo "[heartbeat] WARN: sin RESEND_API_KEY"; return 0; fi
  local payload
  payload="$("$NODE" -e 'const[f,t,s,b]=process.argv.slice(1);process.stdout.write(JSON.stringify({from:f,to:[t],subject:s,text:b}))' "$MAILFROM" "$MAILTO" "$subject" "$body")"
  curl -s -m 30 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
    --data "$payload" >/dev/null 2>&1
}

# --- Aviso al movil, por la tuberia comun de core/ (no hay un segundo lector de credenciales) ---
# Nunca aborta: quien avisa de una averia no puede convertirse en la averia. El texto va por
# STDIN, nunca por argumentos, que es la costumbre de esta casa desde la rotacion de julio.
# El freno evita cien mensajes iguales si alguien lanza esto en bucle; con el timer diario,
# 12h significa "uno al dia mientras dure", que es justo lo que se quiere.
TELEGRAM_CLI="${TELEGRAM_CLI:-$APP_DIR/scripts/avisar-telegram.mjs}"
avisar_telegram(){  # $1 = clave del freno · $2 = texto
  local clave="$1" texto="$2" salida
  if [ "${AVISO_TELEGRAM_SECO:-0}" = "1" ]; then
    echo "[heartbeat] telegram (EN SECO, no se manda) clave=$clave"
    printf '%s\n' "$texto" | sed 's/^/[heartbeat]   /'
    return 0
  fi
  if [ ! -r "$TELEGRAM_CLI" ]; then echo "[heartbeat] WARN: no encuentro $TELEGRAM_CLI"; return 0; fi
  salida="$(printf '%s' "$texto" | "$NODE" "$TELEGRAM_CLI" copias --clave "$clave" --ventana-min 720 2>&1 || true)"
  echo "[heartbeat] telegram: $salida"
}

# Que copias se ESPERAN. La secundaria solo cuenta si su timer esta instalado:
# antes de terminar S6 no existe, y avisar por ella seria una falsa alarma diaria.
NOMBRES=("principal"); MARCAS=("$STATE_DIR/last-success")
if [ -f "$UNIT_SECUNDARIA" ]; then
  NOMBRES+=("secundaria"); MARCAS+=("$STATE_DIR/last-success-secondary")
fi

now="$(date +%s)"
caidas=0; total=${#NOMBRES[@]}; DETALLE=""; CAIDAS_NOMBRES=""

for i in "${!NOMBRES[@]}"; do
  nombre="${NOMBRES[$i]}"; marca="${MARCAS[$i]}"
  if [ -f "$marca" ]; then last="$(cat "$marca" 2>/dev/null || echo 0)"; else last=0; fi
  case "$last" in ''|*[!0-9]*) last=0;; esac
  age=$(( now - last ))
  if [ "$last" -eq 0 ]; then
    DETALLE+="  · $nombre: NUNCA se ha registrado una copia con exito"$'\n'; caidas=$((caidas+1))
  elif [ "$age" -gt "$MAX_AGE_COPIA" ]; then
    DETALLE+="  · $nombre: ultima copia con exito $(date -d "@$last") (hace ~$(( age/3600 ))h) -- CAIDA"$'\n'; caidas=$((caidas+1)); CAIDAS_NOMBRES+="$nombre "
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
  send_email "🚨 CRITICO Bamburu: SIN NINGUNA copia con exito en +$((MAX_AGE_COPIA/3600))h" \
"$( [ "$total" -eq 1 ] && echo "La copia" || echo "NINGUNA de las $total copias" ) sin exito reciente. Ahora mismo no hay respaldo.

$DETALLE
$REVISAR"
  avisar_telegram "copias-todas-caidas" "🚨 <b>NO HAY NINGUNA COPIA RECIENTE</b>
$( [ "$total" -eq 1 ] && echo "La copia" || echo "Las $total copias" ) llevan mas de $((MAX_AGE_COPIA/3600))h sin terminar bien.
<b>Ahora mismo no hay respaldo de Bamburu.</b>

<code>$(printf '%s' "$DETALLE" | tr '<>&' '   ')</code>" 
else
  echo "[heartbeat] AVISO: $caidas de $total copias caidas"
  send_email "⚠️ Bamburu: te has quedado con $((total-caidas)) de $total copias" \
"Una copia lleva mas de $((MAX_AGE_COPIA/3600))h sin exito. La otra sigue funcionando, asi que hay
respaldo, pero has perdido la redundancia y conviene arreglarlo antes de que
la que queda tambien falle.

$DETALLE
$REVISAR"
  # La clave lleva el nombre de la copia caida: si mañana cae la OTRA, es un aviso distinto
  # y tiene que sonar, no quedarse frenado por el de hoy.
  avisar_telegram "copia-parada-$(printf '%s' "$CAIDAS_NOMBRES" | tr -d ' ')" "⚠️ <b>Una copia lleva mas de $((MAX_AGE_COPIA/3600))h sin terminar bien</b>
Te quedan $((total-caidas)) de $total. Hay respaldo, pero ya no hay red de seguridad.

<code>$(printf '%s' "$DETALLE" | tr '<>&' '   ')</code>" 
fi

# --- Manifiesto de huellas del histórico (manifiesto-huellas-backups) -------
# Pregunta DISTINTA de la de arriba: arriba es "¿hubo copia con éxito HOY?"; esto es "¿se
# sigue vigilando que el HISTÓRICO no se haya manipulado o borrado?". Si el bloque del
# manifiesto se dejara de correr en bamburu-backup.sh —o alguien lo comentara— el heartbeat
# de arriba seguiría en verde (last-success no sabe nada del histórico) y el sistema
# volvería al silencio de antes de esta tarea. Este es quien vigila al vigilante: es
# literalmente la lección de CLAUDE.md, "un censo que dice CERO y no es cierto es peor que
# no tenerlo, porque cierra la pregunta".
SUFIJOS=(""); [ -f "$UNIT_SECUNDARIA" ] && SUFIJOS+=("-secondary")
MANIF_PROBLEMAS=0
MANIF_DETALLE=""
for i in "${!NOMBRES[@]}"; do
  nombre="${NOMBRES[$i]}"; sufijo="${SUFIJOS[$i]}"
  archivo_estado="$STATE_DIR/manifiesto${sufijo}.estado.json"
  if [ ! -f "$archivo_estado" ]; then
    MANIF_DETALLE+="  · $nombre: el manifiesto de huellas nunca ha registrado un estado"$'\n'
    MANIF_PROBLEMAS=$((MANIF_PROBLEMAS+1))
    continue
  fi
  salida_estado="$("$NODE" "$MANIFHELPER" estado --estado "$archivo_estado" 2>&1)"
  estado_rc=$?
  # La edad se lee del `ts` DE DENTRO del estado, no del mtime del fichero: un `touch` (o
  # cualquier cosa que lo toque sin que la pasada haya corrido) rejuvenecía la vigilancia sin
  # que hubiera corrido nada.
  ts_estado="$(printf '%s\n' "$salida_estado" | sed -n 's/.*ts=\([0-9]\+\).*/\1/p' | head -1)"
  if [ -z "$ts_estado" ]; then
    MANIF_DETALLE+="  · $nombre: no se ha podido leer la fecha del estado"$'\n'
    MANIF_PROBLEMAS=$((MANIF_PROBLEMAS+1))
  else
    edad_estado=$(( now - ts_estado ))
    if [ "$edad_estado" -gt "$MAX_AGE" ]; then
      MANIF_DETALLE+="  · $nombre: la verificación del histórico lleva más de $((MAX_AGE/3600))h sin correr"$'\n'
      MANIF_PROBLEMAS=$((MANIF_PROBLEMAS+1))
    fi
  fi
  if [ "$estado_rc" -ne 0 ]; then
    MANIF_DETALLE+="  · $nombre: $salida_estado"$'\n'
    MANIF_PROBLEMAS=$((MANIF_PROBLEMAS+1))
  fi
done

if [ "$MANIF_PROBLEMAS" -gt 0 ]; then
  echo "[heartbeat] MANIFIESTO: $MANIF_PROBLEMAS aviso(s) en el histórico de copias"
  send_email "⚠️ Bamburu: el manifiesto de huellas del histórico tiene algo que revisar" \
"El manifiesto de huellas detecta manipulación o borrado en el HISTÓRICO de copias. Esta
comprobación es distinta de la de arriba: aquella dice si hubo copia con éxito hoy: esta
dice si el histórico sigue intacto y se sigue vigilando.

$MANIF_DETALLE
Revisa en el servidor:
  cat ~/.local/state/bamburu-backup/manifiesto.estado.json
  cat ~/.local/state/bamburu-backup/manifiesto-secondary.estado.json
  journalctl -u bamburu-backup.service -n 80"
  avisar_telegram "manifiesto-historico" "⚠️ <b>El historico de copias tiene algo que revisar</b>
No es la copia de hoy: es que el HISTORICO pueda estar tocado, o que haya dejado de vigilarse.

<code>$(printf '%s' "$MANIF_DETALLE" | tr '<>&' '   ')</code>" 
else
  echo "[heartbeat] MANIFIESTO: histórico vigilado, sin alarmas, en ${#NOMBRES[@]} copia(s)"
fi
