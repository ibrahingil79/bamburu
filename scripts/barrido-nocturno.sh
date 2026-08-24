#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────
# EL BARRIDO COMPLETO DE MADRUGADA — corre solo y manda el parte.
#
# POR QUÉ EXISTE (24 ago 2026). El barrido completo pasa de 111 a 114 comprobaciones y va camino de
# más. Un barrido largo que hay que lanzar a mano acaba no lanzándose, y una comprobación que nadie
# ejecuta acaba mintiendo — que es exactamente cómo se llegó a 99 invisibles.
#
# LAS TRES REGLAS QUE CUMPLE:
#   1. El resultado LLEGA a Ibrahin sin que él lo busque: correo a ibrahingil@gmail.com.
#      (NO a hola@bamburu.com: esa dirección REBOTA — el dominio está verificado solo para enviar.)
#   2. El correo lo dice en cristiano: cuántas han corrido, cuántas han fallado y QUÉ se ha roto.
#      Si no falla nada, lo dice en una línea.
#   3. Si el barrido NO LLEGA A TERMINAR, eso también se avisa. Un barrido que no corre y no lo dice
#      es peor que no tenerlo — por eso el correo se manda SIEMPRE, pase lo que pase.
# ─────────────────────────────────────────────────────────────────────────────────────────────────
set -uo pipefail

APP="/home/ubuntu/bamburu"
NODE="/usr/bin/node"
MAILTO="${BAMBURU_BARRIDO_EMAIL:-ibrahingil@gmail.com}"
MAILFROM="Bamburu <noreply@bamburu.com>"
TOPE_SEG="${BAMBURU_BARRIDO_TOPE:-3600}"        # 1 h: el completo tarda ~17 min; si pasa de una hora, algo va mal
LOG="$(mktemp /tmp/barrido-nocturno-XXXXXX.log)"
cd "$APP" || exit 1

enviar() {
  local asunto="$1" cuerpo="$2"
  if [ -z "${RESEND_API_KEY:-}" ]; then echo "[barrido] WARN: sin RESEND_API_KEY, no se manda el parte"; return 0; fi
  local payload
  payload="$("$NODE" -e 'const[f,t,s,b]=process.argv.slice(1);process.stdout.write(JSON.stringify({from:f,to:[t],subject:s,text:b}))' \
    "$MAILFROM" "$MAILTO" "$asunto" "$cuerpo")"
  curl -s -m 60 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
    --data "$payload" >/dev/null 2>&1
}

FECHA="$(date '+%d/%m/%Y')"
INICIO="$(date '+%H:%M')"

# QUÉ SE EJECUTA. Configurable a propósito, por una razón concreta: para probar que el CORREO llega
# y que el parte se escribe bien hace falta ejercitar esta tubería entera —tope de tiempo, lectura del
# registro y envío— SIN lanzar un barrido. Se le da un registro ya hecho y se comprueba el parte.
# En producción no se toca: por defecto es el barrido completo.
BARRIDO_CMD="${BAMBURU_BARRIDO_CMD:-$NODE scripts/run-gates.mjs --all}"
timeout --signal=TERM --kill-after=60 "$TOPE_SEG" $BARRIDO_CMD >"$LOG" 2>&1
CODIGO=$?

# ── EL BARRIDO NO LLEGÓ A TERMINAR ──────────────────────────────────────────────────────────────
if [ "$CODIGO" -eq 124 ] || [ "$CODIGO" -eq 137 ]; then
  ULTIMA="$(grep -E '^\[' "$LOG" | tail -1)"
  enviar "⚠️ Bamburu · el barrido de esta noche NO llegó a terminar ($FECHA)" \
"El barrido completo empezó a las $INICIO y se ha cortado por pasar del tope de $((TOPE_SEG/60)) minutos.

ESTO NO ES UN APROBADO: significa que no sabemos si el producto está bien.

Por dónde iba cuando se cortó:
$(grep -cE '^\[' "$LOG") comprobaciones terminadas
Última: ${ULTIMA:-(ninguna)}

Lo que había fallado hasta ese momento:
$(grep -E '^\[.*(❌|🛑)' "$LOG" | sed 's/^/  /' || echo '  (ninguna)')

El registro entero está en el servidor: $LOG"
  exit 1
fi

RESUMEN="$(grep -E 'pasan  ·' "$LOG" | tail -1)"
FALLOS="$(grep -E '^\[.*(❌|🛑|⚠️)' "$LOG" || true)"
CUANTAS="$(grep -cE '^\[' "$LOG")"
CUANTAS_MAL="$(printf '%s' "$FALLOS" | grep -c . || true)"

if [ -z "$FALLOS" ]; then
  enviar "✅ Bamburu · barrido de la noche: todo en verde ($FECHA)" \
"Han corrido $CUANTAS comprobaciones y no ha fallado ninguna.

$RESUMEN"
else
  # El detalle de cada fallo, tal y como lo escribió su propia comprobación.
  DETALLE="$("$NODE" -e '
    const fs = require("fs");
    const txt = fs.readFileSync(process.argv[1], "utf8");
    const bloques = txt.split(/\n(?=──── )/).slice(1);
    const out = [];
    for (const b of bloques) {
      const m = /^──── (\S+) \(([^)]*)\)/.exec(b);
      if (!m) continue;
      const lineas = b.split("\n").filter(l => l.includes("✗")).slice(0, 4).map(l => "      " + l.trim());
      out.push("  · " + m[1] + "  [" + m[2] + "]");
      out.push(...(lineas.length ? lineas : ["      (sin detalle: mira el registro entero)"]));
    }
    process.stdout.write(out.join("\n"));
  ' "$LOG")"
  enviar "❌ Bamburu · barrido de la noche: $CUANTAS_MAL comprobación(es) en rojo ($FECHA)" \
"Han corrido $CUANTAS comprobaciones y $CUANTAS_MAL no han pasado.

$RESUMEN

QUÉ SE HA ROTO, exactamente:

$DETALLE

El registro entero está en el servidor: $LOG"
fi

# El parte también queda escrito en el TABLERO: eso lo hace el propio corredor con --all.
echo "[barrido] terminado con código $CODIGO · $RESUMEN"
exit 0
