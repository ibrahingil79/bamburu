#!/usr/bin/env bash
#
# bamburu-backup.sh — Copia diaria de las BD SQLite + uploads a Google Drive (rclone),
# BLINDADA contra fallo silencioso (la lección de la crisis: nada se asume).
#
# Por cada artefacto:
#   1. Snapshot CONSISTENTE de cada .db con la SQLite Online Backup API (db-snapshot.mjs).
#      Las uploads se empaquetan en tar.gz. NUNCA se copia un .db en crudo (evita roturas por WAL).
#   2. Subida a Drive (rclone copy).
#   3. VERIFICACIÓN REAL de la subida: tamaño + huella del archivo YA en Drive vs. el local.
#      SIN RAMA BLANDA: si la huella no se puede comparar, es un FALLO, nunca un aviso.
#   4. PRUEBA DE RESTORE REAL: se descarga de vuelta desde Drive, se compara BYTE A BYTE con
#      el original y se comprueba que abre (PRAGMA integrity_check == ok; el tar con tar -tzf).
#   5. Retención: borra en Drive lo más viejo que RETENTION_DAYS.
#   6. Email (Resend) en OK y en FALLO. Ping a healthchecks.io (dead-man's-switch externo).
#   7. Graba marca de "último éxito" para el heartbeat.
#
# LA COPIA FUNCIONA EN DOS MUNDOS, y no elige ella: se lo dice un fichero de estado.
#   - Sin fichero de destinos -> destino EN CLARO (el de siempre, BACKUP_REMOTE o el de por
#     defecto). La verificación exige el MD5 del destino y falla si no lo hay.
#   - Con fichero de destinos  -> destino CIFRADO (remote `crypt`). La verificación usa
#     `rclone cryptcheck`, porque a un crypt no se le puede pedir un MD5.
#   El fichero es ~/.config/bamburu/backup-destinos.conf (600) y lo escribe UNA pieza:
#   `scripts/cifrar-copias-de-seguridad.sh`, y solo DESPUÉS de haber subido, bajado y comparado
#   byte a byte un fichero de prueba. Ese mismo fichero es el CERROJO: si existe, el destino
#   tiene que ser crypt o la copia aborta antes de tocar nada. Por eso el cerrojo no puede
#   adelantarse a la llave — nace en la misma escritura que nombra el destino cifrado.
#   Si el fichero desaparece, se vuelve a claro: no en silencio, el log y el email lo dicen.
#
# Corre desde un systemd timer como User=ubuntu. Lee RESEND_API_KEY y HEALTHCHECKS_URL
# de /etc/bamburu.env (vía EnvironmentFile del .service). rclone usa ~ubuntu/.config/rclone.
#
# MANIFIESTO DE HUELLAS DEL HISTÓRICO (manifiesto-huellas-backups). Todo lo de arriba
# verifica MUY bien lo que se sube ESTA noche, pero en cuanto el bucle termina, el archivo
# ya no se vuelve a mirar: una copia de hace cinco días se puede editar o borrar en Drive y
# nada lo nota hasta el día en que haga falta restaurar. Por eso, tras subir y verificar
# todo lo de hoy (nunca antes: ver el bloque tras la retención más abajo), se llama a
# `scripts/lib/manifiesto-copias.mjs pasada`, que:
#   - anota cada artefacto de hoy en un fichero JSON Lines encadenado por hash (append-only,
#     igual patrón que `verifyTenantInvoices` en modules/superadmin/integridad.js pero
#     aplicado a ficheros en vez de a filas);
#   - recorre TODA la ventana de retención contra lo registrado, SIN DESCARGAR NADA
#     (pregunta al destino la huella que él mismo calculó: 1 llamada a rclone en claro,
#     unas pocas más en cifrado, porque un remote crypt no expone huellas del contenido y
#     hay que pedírselas al remote base a través de la ruta cifrada).
# QUÉ NO CUBRE: el manifiesto vive en este servidor, así que quien lo controle puede
# reescribirlo entero. Por eso su cabeza y el SHA-256 de cada artefacto de hoy van también
# en el correo diario — un ancla fuera del servidor que la propia copia ya envía.
#
# A propósito NO usa `set -e`: cada paso se comprueba y se NOTIFICA el fallo, no se muere mudo.
set -uo pipefail

# --- Config -----------------------------------------------------------------
APP_DIR="/home/ubuntu/bamburu"
DATA_DIR="${BACKUP_DATA_DIR:-$APP_DIR/data}"

# --- Una sola pieza sirve a las DOS copias (S6, 31 ago 2026) -----------------
# Sin argumentos se comporta EXACTAMENTE como antes: copia principal a la cuenta
# personal. La unit de la copia secundaria sobreescribe estas variables por entorno.
# Se parametriza en vez de duplicar el script: dos copias de las mismas reglas se
# separan en cuanto alguien arregla una sola.
LABEL="${BACKUP_LABEL:-principal}"          # etiqueta emails/resumen Y resuelve el destino cifrado
SUFFIX="${BACKUP_SUFFIX:-}"                 # separa la marca de exito por copia
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

# --- El destino: dos mundos, y el fichero de estado manda --------------------
# PRECEDENCIA, y es a proposito al reves de lo habitual:
#   fichero de destinos  >  BACKUP_REMOTE de la unit  >  el de siempre.
# El fichero no es "otra config": es el estado "estas copias YA van cifradas", y ese
# estado manda sobre el valor heredado de la unit. Es lo que permite que las DOS copias
# cambien de destino con UNA sola escritura, sin sudo y sin tocar /etc/systemd.
# Se parsea con un patron estricto y NUNCA se hace `source`: un fichero de estado no
# ejecuta codigo. BACKUP_DESTINOS_CONF existe solo para poder probar esto fuera de $HOME.
DESTINOS="${BACKUP_DESTINOS_CONF:-$HOME/.config/bamburu/backup-destinos.conf}"
REMOTE_CIF=""
if [ -r "$DESTINOS" ]; then
  REMOTE_CIF="$(grep -E "^DESTINO_${LABEL}=[A-Za-z0-9_]+:[A-Za-z0-9_./-]*$" "$DESTINOS" \
                | tail -1 | cut -d= -f2-)"
fi
if [ -n "$REMOTE_CIF" ]; then REMOTE="$REMOTE_CIF";                                   EXIGE_CRYPT=1
else                          REMOTE="${BACKUP_REMOTE:-gdrive:Bamburu-backup/daily}"; EXIGE_CRYPT=0; fi

# Se fija de verdad mas abajo, en cuanto se sepa el tipo del remote. Se inicializa aqui
# porque fail_exit puede dispararse antes (p. ej. "rclone no encontrado") y lo nombra.
MODO="(sin determinar)"

RCLONE="/usr/bin/rclone"
NODE="/usr/bin/node"
SNAPSHOT="$APP_DIR/scripts/db-snapshot.mjs"
STATE_DIR="$HOME/.local/state/bamburu-backup"
LAST_OK="$STATE_DIR/last-success$SUFFIX"
MANIFIESTO="$STATE_DIR/manifiesto$SUFFIX.jsonl"
MANIF_ESTADO="$STATE_DIR/manifiesto$SUFFIX.estado.json"
MANIFHELPER="$APP_DIR/scripts/lib/manifiesto-copias.mjs"
MAILTO="ibrahingil@gmail.com"
MAILFROM="Bamburu <noreply@bamburu.com>"

# Dead-man's-switch: la copia SECUNDARIA no debe pingear el mismo check que la
# principal — si lo hiciera, una principal caida seguiria viendose verde y el
# monitor externo mentiria. Se usa `-` y NO `:-` a proposito: un
# BACKUP_HC_URL="" explicito significa "sin ping", no "hereda el de la principal".
HC_URL="${BACKUP_HC_URL-${HEALTHCHECKS_URL:-}}"

DATE="$(date +%F)"
HOST="$(hostname)"
mkdir -p "$STATE_DIR"

LOGBUF=""
log(){ echo "[bamburu-backup] $*"; LOGBUF+="$*"$'\n'; }

# --- Email vía Resend (no aborta el script si el email falla) ---------------
send_email(){
  local subject="$1" body="$2"
  if [ -z "${RESEND_API_KEY:-}" ]; then log "WARN: sin RESEND_API_KEY, no se envía '$subject'"; return 0; fi
  local payload
  payload="$("$NODE" -e 'const[f,t,s,b]=process.argv.slice(1);process.stdout.write(JSON.stringify({from:f,to:[t],subject:s,text:b}))' "$MAILFROM" "$MAILTO" "$subject" "$body")"
  local resp
  resp="$(curl -s -m 30 -X POST https://api.resend.com/emails \
      -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
      --data "$payload" 2>&1)"
  if echo "$resp" | grep -q '"id"'; then log "email enviado: $subject"; else log "WARN: email no confirmado: $resp"; fi
}

# --- Ping a healthchecks.io (dead-man's-switch externo; no aborta) ----------
hc_ping(){  # $1 = "" éxito | "/fail" fallo | "/start" inicio
  [ -n "${HC_URL:-}" ] || return 0
  curl -fsS -m 20 --retry 3 "${HC_URL}${1:-}" -o /dev/null 2>/dev/null || log "WARN: ping healthchecks falló (${1:-ok})"
}

fail_exit(){
  local msg="$1"
  log "FALLO: $msg"
  send_email "❌ Backup Bamburu [$LABEL] FALLÓ ($DATE)" "El backup ha FALLADO en: $msg

Host: $HOST
Destino: $REMOTE — $MODO

--- log ---
$LOGBUF"
  hc_ping "/fail"
  exit 1
}

# ¿El destino es un remote cifrado? Se decide por el grep y NUNCA por el codigo de salida:
# `rclone config show` de un remote inexistente imprime "# couldn't find type of fs" y sale
# con 0 (medido con rclone 1.74.3). Preguntar por $? daria "si existe" a lo que no existe.
es_crypt(){ "$RCLONE" config show "${1%%:*}" 2>/dev/null | grep -q '^type = crypt'; }

[ -x "$RCLONE" ] || RCLONE="$(command -v rclone || true)"
[ -n "$RCLONE" ] && [ -x "$RCLONE" ] || fail_exit "rclone no encontrado"

# El tipo del destino se resuelve UNA vez: decide la rama de verify_uploaded y el modo que
# se dice en el log y en el email. Va aqui, antes del ping y antes de crear el temporal,
# para que una copia abortada no llegue a tocar un solo fichero.
if es_crypt "$REMOTE"; then DESTINO_ES_CRYPT=1; MODO="CIFRADO"
else                        DESTINO_ES_CRYPT=0; MODO="EN CLARO ⚠️"; fi

# EL CERROJO. Solo se evalua si hay fichero de destinos: sin el, esta condicion no existe
# y la copia se comporta EXACTAMENTE como antes. Nunca puede haber un momento en que el
# codigo exija cifrado y el destino cifrado no exista, porque el fichero que enciende esta
# condicion lo escribe el mismo guion que crea los remotes, y despues de descifrar de verdad.
if [ "$EXIGE_CRYPT" = 1 ] && [ "$DESTINO_ES_CRYPT" = 0 ]; then
  fail_exit "el destino '$REMOTE' viene de $DESTINOS pero NO es un remote crypt. Copia ABORTADA."
fi

log "destino: $REMOTE — $MODO"

hc_ping "/start"

TMPDIR="$(mktemp -d /tmp/bamburu-backup.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT
RDIR="$TMPDIR/restore"; mkdir -p "$RDIR"

# Verifica que el archivo subido coincide con el local. Sin asumir y SIN RAMA BLANDA.
# El tamaño se compara igual en los dos mundos: `rclone size` sobre un crypt devuelve el
# tamaño EN CLARO (medido), asi que sigue valiendo. La huella, segun el destino:
#   - crypt  -> `rclone cryptcheck`, que cifra el local con el nonce del propio objeto
#               remoto y compara la huella real. A un crypt no se le puede pedir un MD5:
#               `rclone hashsum MD5` responde "hash type not supported" y stdout vacio.
#   - normal -> el MD5 remoto TIENE que venir y coincidir. Si no viene, es un FALLO.
# La version vieja, al faltar el MD5, escribia un aviso de que solo validaba el tamaño y
# devolvia 0. Cifrar sin tocar esto habria apagado la verificacion dejandola EN VERDE: un
# censo que dice CERO y no es cierto es peor que no tenerlo, porque cierra la pregunta.
verify_uploaded(){  # $1 = ruta local, $2 = nombre remoto
  local local_path="$1" name="$2" lsize lmd5 rsize rmd5 cc_out cc_rc
  lsize="$(stat -c%s "$local_path")"
  rsize="$("$RCLONE" size "$REMOTE/$name" --json 2>/dev/null | "$NODE" -e 'try{const a=JSON.parse(require("fs").readFileSync(0));process.stdout.write(String(a.bytes??""))}catch{process.stdout.write("")}')"
  [ -n "$rsize" ] || { log "  verify: el archivo NO aparece en el destino"; return 1; }
  [ "$lsize" = "$rsize" ] || { log "  verify: tamaño difiere (local $lsize / destino $rsize)"; return 1; }

  if [ "$DESTINO_ES_CRYPT" = 1 ]; then
    # El `/` inicial ANCLA el filtro a la raiz de cada lado: compara exactamente
    # <dir local>/$name contra $REMOTE/$name. Sin el, `--include` casa a CUALQUIER
    # profundidad y cryptcheck se llevaria tambien el $RDIR/$name de la prueba de
    # restore — medido: dos ficheros locales contra uno remoto, y da diferencia.
    cc_out="$("$RCLONE" cryptcheck "$(dirname "$local_path")" "$REMOTE" --include "/$name" 2>&1)"
    cc_rc=$?
    # La ultima linea de cryptcheck va al log SIEMPRE: es lo que distingue en el email de
    # fallo "las huellas difieren" de "el remote no respondio".
    log "  verify: cryptcheck (rc=$cc_rc) $(printf '%s' "$cc_out" | tail -1)"
    [ "$cc_rc" = 0 ] || { log "  verify: cryptcheck NO dio 0"; return 1; }
    printf '%s' "$cc_out" | grep -q '0 differences found' \
      || { log "  verify: cryptcheck no confirmó '0 differences found'"; return 1; }
  else
    lmd5="$(md5sum "$local_path" | awk '{print $1}')"
    rmd5="$("$RCLONE" hashsum MD5 "$REMOTE/$name" 2>/dev/null | awk '{print $1}')"
    [ -n "$rmd5" ] || { log "  verify: el destino no devuelve huellas y no es crypt: no se puede verificar"; return 1; }
    [ "$lmd5" = "$rmd5" ] || { log "  verify: MD5 difiere"; return 1; }
  fi
  return 0
}

# El fichero que baja tiene que ser EL MISMO que subio, byte a byte. No basta con que abra:
# `PRAGMA integrity_check` responde `ok` a cualquier base sana, aunque sea OTRA — medido
# sustituyendo el descargado por data/tenants/duniya.db, y pasaba en verde.
verify_restored(){  # $1 = original local, $2 = descargado
  cmp -s "$1" "$2" || { log "  restore: el fichero descargado NO es idéntico al original ($2)"; return 1; }
}

uploaded=0
SUMMARY=""
ARTEFACTOS="$TMPDIR/artefactos.txt"
: > "$ARTEFACTOS"

# --- Snapshots de las BD ----------------------------------------------------
shopt -s nullglob
DBS=("$DATA_DIR/control.db" "$DATA_DIR"/tenants/*.db)
for db in "${DBS[@]}"; do
  [ -f "$db" ] || continue
  base="$(basename "$db" .db)"
  name="${base}-${DATE}.db"
  snap="$TMPDIR/$name"

  log "snapshot consistente: $db"
  "$NODE" "$SNAPSHOT" "$db" "$snap" >/dev/null 2>&1 || fail_exit "snapshot de $db"

  log "subiendo $name"
  "$RCLONE" copy "$snap" "$REMOTE/" 2>&1 | sed 's/^/    /' || true
  verify_uploaded "$snap" "$name" || fail_exit "verificación de subida de $name (tamaño/huella)"

  log "restore-test: descarga + comparación byte a byte + integrity_check de $name"
  "$RCLONE" copy "$REMOTE/$name" "$RDIR/" 2>/dev/null || fail_exit "descarga de restore de $name"
  verify_restored "$snap" "$RDIR/$name" || fail_exit "el restore de $name no es idéntico al original"
  ic="$(sqlite3 "$RDIR/$name" 'PRAGMA integrity_check;' 2>&1)"
  [ "$ic" = "ok" ] || fail_exit "integrity_check de $name => $ic"
  rm -f "$RDIR/$name"

  sha="$(sha256sum "$snap" | awk '{print $1}')"
  printf '%s %s %s\n' "$name" "$sha" "$(stat -c%s "$snap")" >> "$ARTEFACTOS"
  SUMMARY+="  • $name ($(du -h "$snap" | awk '{print $1}')) — subido, verificado y restore OK — sha256 $sha"$'\n'
  uploaded=$((uploaded+1))
done

# --- uploads -> tar.gz ------------------------------------------------------
if [ -d "$DATA_DIR/uploads" ]; then
  uname="uploads-${DATE}.tar.gz"
  utar="$TMPDIR/$uname"
  log "empaquetando uploads"
  tar -czf "$utar" -C "$DATA_DIR" uploads 2>/dev/null || fail_exit "tar de uploads"
  log "subiendo $uname"
  "$RCLONE" copy "$utar" "$REMOTE/" 2>&1 | sed 's/^/    /' || true
  verify_uploaded "$utar" "$uname" || fail_exit "verificación de subida de $uname"
  log "restore-test: descarga + comparación byte a byte + tar -tzf de $uname"
  "$RCLONE" copy "$REMOTE/$uname" "$RDIR/" 2>/dev/null || fail_exit "descarga de restore de $uname"
  verify_restored "$utar" "$RDIR/$uname" || fail_exit "el restore de $uname no es idéntico al original"
  tar -tzf "$RDIR/$uname" >/dev/null 2>&1 || fail_exit "el tar de uploads no es válido tras restore"
  rm -f "$RDIR/$uname"
  sha="$(sha256sum "$utar" | awk '{print $1}')"
  printf '%s %s %s\n' "$uname" "$sha" "$(stat -c%s "$utar")" >> "$ARTEFACTOS"
  SUMMARY+="  • $uname ($(du -h "$utar" | awk '{print $1}')) — subido, verificado y restore OK — sha256 $sha"$'\n'
  uploaded=$((uploaded+1))
fi

[ "$uploaded" -gt 0 ] || fail_exit "no se subió ningún archivo"

# --- Manifiesto de huellas del histórico (manifiesto-huellas-backups) -------
# Va DESPUÉS de que todo esté subido y verificado, y ANTES de la retención — ese orden es
# el producto: si el histórico tiene una alarma, la retención NO debe borrar nada esta
# noche (borraría la evidencia por antigüedad), pero un fallo aquí NUNCA debe impedir que
# la copia de hoy se marque como hecha (ver riesgo 1 del análisis: el 1 sep un guardián
# nuevo habría dejado dos noches sin copia). Por eso no hay ningún `fail_exit` en este
# bloque: se decide en variables y se actúa después.
log "manifiesto: registrando $uploaded artefactos y verificando el histórico"
MODO_MANIF="claro"; [ "$DESTINO_ES_CRYPT" = 1 ] && MODO_MANIF="cifrado"
MANIF_SALIDA="$("$NODE" "$MANIFHELPER" pasada \
  --manifiesto "$MANIFIESTO" --estado "$MANIF_ESTADO" \
  --remote "$REMOTE" --modo "$MODO_MANIF" --retencion "$RETENTION_DAYS" \
  --fecha "$DATE" --artefactos "$ARTEFACTOS" 2>&1)"
MANIF_OK=$?
log "$MANIF_SALIDA"
MANIF_LINEA="$(printf '%s\n' "$MANIF_SALIDA" | grep '^Manifiesto: ' | head -1)"
MANIF_BLOQUE="$MANIF_LINEA"
MANIF_OBS_LINEA="$(printf '%s\n' "$MANIF_SALIDA" | grep 'objetos que esta copia no subió' | head -1)"
[ -n "$MANIF_OBS_LINEA" ] && MANIF_BLOQUE+=$'\n'"$MANIF_OBS_LINEA"

if [ "$MANIF_OK" != 0 ]; then
  # NO se ejecuta la retención: si el histórico está en duda, lo peor que se puede hacer
  # es borrar por antigüedad esa misma noche. La copia de HOY sí está hecha y verificada,
  # así que last-success y el ping siguen reflejando la verdad ("¿tengo copia de hoy?" es
  # una pregunta distinta de "¿el histórico sigue intacto?" — ver riesgo 8 del análisis).
  date +%s > "$LAST_OK"
  hc_ping ""
  send_email "🚨 Backup Bamburu [$LABEL] — ALARMA en el histórico ($DATE)" "La copia de HOY se subió y se verificó bien, pero el manifiesto de huellas del
histórico detectó algo raro y la retención de esta noche NO se ha ejecutado.

Destino: $REMOTE — $MODO

$SUMMARY
$MANIF_SALIDA

Revisa el destino antes de que la retención vuelva a intentarlo mañana."
  log "ALARMA del manifiesto: retención saltada, copia de hoy marcada como hecha."
  exit 1
fi

# --- Retención --------------------------------------------------------------
log "retención: borrando en Drive lo más viejo que ${RETENTION_DAYS} días"
"$RCLONE" delete --min-age "${RETENTION_DAYS}d" "$REMOTE/" 2>&1 | sed 's/^/    /' || log "WARN: la retención devolvió error (no crítico)"

# --- Éxito ------------------------------------------------------------------
date +%s > "$LAST_OK"
send_email "✅ Backup Bamburu [$LABEL] OK ($DATE) — $MODO" "Backup completado y VERIFICADO en $HOST ($DATE).

Destino: $REMOTE — $MODO

$SUMMARY
Retención: ${RETENTION_DAYS} días.
Cada archivo se descargó de vuelta, se comparó BYTE A BYTE con el original y se comprobó
que abre (restore real).

$MANIF_BLOQUE
El manifiesto detecta manipulación o borrado en el histórico; no lo impide. Detalle en
deploy/systemd/README.md §«Manifiesto de huellas del histórico»."
hc_ping ""
log "backup completado correctamente ($uploaded archivos) — destino $MODO."
