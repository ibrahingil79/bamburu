#!/usr/bin/env bash
#
# configurar-stripe.sh — El guion de UN SOLO USO que enciende los cobros de Bamburu.
#
# POR QUÉ EXISTE ESTE GUION Y NO SE HIZO SIN ÉL. Escribir en /etc/bamburu.env e instalar unidades de
# systemd son pasos de servidor, y quien tiene la cuenta de Stripe es Ibrahin. Todo lo demás —el
# plan, la prueba, el prorrateo, la pantalla, el webhook— está construido y probado sin necesitar a
# nadie. Esto es el ÚNICO paso que pide una persona, y se hace de una sentada.
#
# LA REGLA QUE MANDA AQUÍ ES LA MISMA QUE EN EL CIFRADO DE LAS COPIAS (1 sep 2026), y viene de una
# avería real: **nunca puede existir un momento en que el código exija algo que todavía no existe.**
# Por eso el orden es: pedir → COMPROBAR CONTRA STRIPE DE VERDAD → y solo entonces escribir. Si la
# comprobación falla, no se toca ni un fichero y el producto se queda exactamente como estaba.
#
# 🚨 EL SECRETO NO PASA NUNCA POR LA LÍNEA DE COMANDOS. Se lee por `read -s`, desde el teclado. Es la
# lección que costó rotar una clave el 16 jul 2026: `sudo` registra la línea de comandos ENTERA en
# /var/log/auth.log y en el journal, y el journal es persistente y no admite borrado selectivo. Aquí,
# además, la escritura en /etc/bamburu.env NO necesita sudo —el fichero es de `ubuntu` (0600)—, así
# que ni se pide.
#
# MODO DE PRUEBA POR DEFECTO, y con cerrojo. El guion acepta claves `sk_test_` sin más. Una clave
# `sk_live_` exige `--modo-real` escrito a mano Y confirmación por teclado, y además escribe el
# ajuste `stripe_modo_real` en control.db — sin ese ajuste, `core/stripe.js` se niega a usarla.
#
#   Uso:  bash scripts/configurar-stripe.sh              (modo de prueba)
#         bash scripts/configurar-stripe.sh --modo-real  (producción — pide confirmación)

set -uo pipefail

APP_DIR="/home/ubuntu/bamburu"
ENV_FILE="/etc/bamburu.env"
MODO_REAL=0
[[ "${1:-}" == "--modo-real" ]] && MODO_REAL=1

cd "$APP_DIR" || { echo "No existe $APP_DIR"; exit 1; }

echo
echo "══════════════════════════════════════════════════════════════════"
echo "  BAMBURU · conectar los cobros con Stripe"
echo "══════════════════════════════════════════════════════════════════"
echo
if [[ $MODO_REAL -eq 1 ]]; then
  echo "  ⚠️  MODO REAL: lo que configures aquí COBRA DINERO DE VERDAD."
else
  echo "  Modo de PRUEBA. Ningún cobro moverá dinero real."
  echo "  Las claves de prueba están en:  https://dashboard.stripe.com/test/apikeys"
fi
echo

# ── 1 · Pedir las claves, sin que pasen por argv ──────────────────────────────────────────────────
read -rsp "  Clave secreta de Stripe (sk_test_… / sk_live_…): " SK; echo
if [[ -z "${SK:-}" ]]; then echo "  ✗ No has escrito ninguna clave. No se ha tocado nada."; exit 1; fi

if [[ "$SK" == sk_live_* ]]; then
  if [[ $MODO_REAL -eq 0 ]]; then
    echo "  ✗ Esa es una clave de PRODUCCIÓN y no has pedido --modo-real."
    echo "    No se ha tocado nada. Si de verdad quieres cobrar en real:"
    echo "      bash scripts/configurar-stripe.sh --modo-real"
    exit 1
  fi
  echo
  read -rp "  Escribe COBRAR DE VERDAD para confirmar el modo real: " CONF
  if [[ "$CONF" != "COBRAR DE VERDAD" ]]; then
    echo "  ✗ No confirmado. No se ha tocado nada."; exit 1
  fi
elif [[ "$SK" != sk_test_* ]]; then
  echo "  ✗ Eso no parece una clave secreta de Stripe (ni sk_test_ ni sk_live_). No se ha tocado nada."
  exit 1
fi

read -rsp "  Clave publicable (pk_test_… / pk_live_…, opcional, Intro para saltar): " PK; echo

# ── 2 · COMPROBAR CONTRA STRIPE ANTES DE ESCRIBIR NADA ────────────────────────────────────────────
# La clave viaja por cabecera, nunca por la línea de comandos: `curl -H @-` la lee de la entrada
# estándar, así que no aparece en `ps` ni en ningún registro.
echo
echo "  Comprobando la clave contra Stripe…"
RESP="$(printf 'Authorization: Bearer %s\n' "$SK" \
        | curl -sS --max-time 20 -H @- -w '\n%{http_code}' https://api.stripe.com/v1/balance 2>&1)"
CODIGO="$(printf '%s' "$RESP" | tail -n1)"
if [[ "$CODIGO" != "200" ]]; then
  echo "  ✗ Stripe no aceptó la clave (HTTP $CODIGO). NO se ha escrito nada."
  printf '%s\n' "$RESP" | head -n -1 | head -5 | sed 's/^/    /'
  exit 1
fi
echo "  ✓ La clave funciona."

# ── 3 · El webhook. Se da de alta por API para no depender de que nadie copie un secreto a mano ────
DOMINIO="$(grep -m1 '^PUBLIC_BASE_DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | xargs)"
WHSEC=""
if [[ -n "$DOMINIO" ]]; then
  URL_WH="https://${DOMINIO}/stripe/webhook"
  echo "  Dando de alta el webhook en ${URL_WH} …"
  WH="$(printf 'Authorization: Bearer %s\n' "$SK" | curl -sS --max-time 20 -H @- \
        -d "url=${URL_WH}" \
        -d 'enabled_events[]=payment_intent.succeeded' \
        -d 'enabled_events[]=payment_intent.payment_failed' \
        -d 'description=Bamburu — estado de los cobros de suscripción' \
        https://api.stripe.com/v1/webhook_endpoints 2>/dev/null)"
  WHSEC="$(printf '%s' "$WH" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).secret||"")}catch{}})')"
  if [[ -n "$WHSEC" ]]; then echo "  ✓ Webhook dado de alta."
  else echo "  ⚠️  No se pudo dar de alta el webhook (quizá ya existe). Los cobros funcionan igual;"
       echo "      lo que se pierde es enterarse de un fallo de pago que Stripe descubra después."
  fi
else
  echo "  ⚠️  No hay PUBLIC_BASE_DOMAIN en $ENV_FILE: el webhook se salta."
fi

# ── 4 · Escribir. En el sitio y sin `sed -i` ──────────────────────────────────────────────────────
# `sed -i` renombra el fichero: cambia el inode, y eso en /etc necesita permiso sobre el directorio,
# que `ubuntu` NO tiene. Se reescribe EN EL SITIO con `cat >`.
poner() {                       # poner CLAVE VALOR — sustituye la línea o la añade
  local k="$1" v="$2" tmp
  tmp="$(mktemp)"; chmod 600 "$tmp"
  grep -v "^${k}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"      # en el sitio: mismo inode, mismos permisos, mismo dueño
  rm -f "$tmp"
}
cp -p "$ENV_FILE" "${ENV_FILE}.antes-de-stripe" 2>/dev/null || true
poner STRIPE_SECRET_KEY "$SK"
[[ -n "${PK:-}" ]]    && poner STRIPE_PUBLISHABLE_KEY "$PK"
[[ -n "${WHSEC:-}" ]] && poner STRIPE_WEBHOOK_SECRET "$WHSEC"
echo "  ✓ Claves guardadas en $ENV_FILE (copia previa en ${ENV_FILE}.antes-de-stripe)."

# El cerrojo del modo real vive en control.db, no en el entorno: así el código puede negarse a usar
# una clave de producción aunque alguien la ponga en el fichero por su cuenta.
if [[ $MODO_REAL -eq 1 ]]; then
  node -e "import('./core/control-db.js').then(m=>{m.controlDb.prepare(\"INSERT INTO settings (key,value) VALUES ('stripe_modo_real','si') ON CONFLICT(key) DO UPDATE SET value='si'\").run();console.log('  ✓ Modo real AUTORIZADO en control.db.')})"
else
  node -e "import('./core/control-db.js').then(m=>{m.controlDb.prepare(\"DELETE FROM settings WHERE key='stripe_modo_real'\").run();console.log('  ✓ Modo real NO autorizado (queda el cerrojo de prueba).')})"
fi

# ── 5 · La pasada diaria del prorrateo ────────────────────────────────────────────────────────────
echo
echo "  Instalando la pasada diaria del prorrateo…"
sudo cp "$APP_DIR/deploy/systemd/bamburu-suscripcion-cobros.service" /etc/systemd/system/
sudo cp "$APP_DIR/deploy/systemd/bamburu-suscripcion-cobros.timer"   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bamburu-suscripcion-cobros.timer
echo "  ✓ Temporizador activo (todos los días a las 06:10, hora de España)."

# ── 6 · Que la aplicación se entere ───────────────────────────────────────────────────────────────
# Node lee el entorno AL ARRANCAR: sin este reinicio, las claves están en el fichero y no existen
# para nadie. Es la mitad del "desplegar es parte de la entrega" que se olvida.
sudo systemctl restart bamburu
sleep 2

echo
echo "  ── Comprobación final ─────────────────────────────────────────"
node -e "import('./core/stripe.js').then(s=>{const d=s.diagnostico();console.log('  Stripe:', d.modo, '· usable:', d.usable, '· webhook:', d.hay_webhook)})"
echo
echo "  Listo. Abre /admin/suscripcion como dueño de un negocio."
if [[ $MODO_REAL -eq 0 ]]; then
  echo "  Tarjeta de prueba: 4242 4242 4242 4242 · cualquier fecha futura · cualquier CVC."
fi
echo
