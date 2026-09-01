#!/usr/bin/env bash
#
# bamburu-backup.sh — Copia diaria de las BD SQLite + uploads a Google Drive (rclone),
# BLINDADA contra fallo silencioso (la lección de la crisis: nada se asume).
#
# El destino SIEMPRE va CIFRADO (remote 'crypt' de rclone): contenido y NOMBRES de fichero.
# Si el destino no es crypt, la copia se ABORTA — cifrar es condición, no opción.
#
# Por cada artefacto:
#   1. Snapshot CONSISTENTE de cada .db con la SQLite Online Backup API (db-snapshot.mjs).
#      Las uploads se empaquetan en tar.gz. NUNCA se copia un .db en crudo (evita roturas por WAL).
#   2. Subida a Drive CIFRADA (rclone copy a través del remote crypt).
#   3. VERIFICACIÓN REAL de la subida: tamaño + `rclone cryptcheck`, que compara el MD5 real
#      del objeto de Drive contra el del fichero local ya cifrado con el nonce de ese objeto.
#      (Un remote crypt NO expone huellas: pedírselas responde "hash unsupported" y stdout vacío,
#      así que preguntarle por la huella y creerse el silencio es apagar la verificación.)
#   4. PRUEBA DE RESTORE REAL: se descarga de vuelta desde Drive, se comprueba que el MD5 del
#      fichero descifrado coincide con el original, y que abre (sqlite3 PRAGMA integrity_check
#      == ok; el tar con tar -tzf).
#   5. Retención: borra en Drive lo más viejo que RETENTION_DAYS.
#   6. Email (Resend) en OK y en FALLO. Ping a healthchecks.io (dead-man's-switch externo).
#   7. Graba marca de "último éxito" para el heartbeat.
#
# Corre desde un systemd timer como User=ubuntu. Lee RESEND_API_KEY y HEALTHCHECKS_URL
# de /etc/bamburu.env (vía EnvironmentFile del .service). rclone usa ~ubuntu/.config/rclone,
# que es donde vive la CONTRASEÑA DE CIFRADO — nunca en /etc/bamburu.env, porque ese fichero
# entra entero en el process.env del proceso web expuesto a Internet.
#
# A propósito NO usa `set -e`: cada paso se comprueba y se NOTIFICA el fallo, no se muere mudo.
set -uo pipefail

# --- Config -----------------------------------------------------------------
APP_DIR="/home/ubuntu/bamburu"
DATA_DIR="$APP_DIR/data"

# --- Una sola pieza sirve a las DOS copias (S6, 31 ago 2026) -----------------
# Sin argumentos se comporta EXACTAMENTE como antes: copia principal a la cuenta
# personal. La unit de la copia secundaria sobreescribe estas variables por entorno.
# Se parametriza en vez de duplicar el script: dos copias de las mismas reglas se
# separan en cuanto alguien arregla una sola.
REMOTE="${BACKUP_REMOTE:-gdrive_cif:daily}"
LABEL="${BACKUP_LABEL:-principal}"          # solo etiqueta emails y resumen
SUFFIX="${BACKUP_SUFFIX:-}"                 # separa la marca de exito por copia
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

RCLONE="/usr/bin/rclone"
NODE="/usr/bin/node"
SNAPSHOT="$APP_DIR/scripts/db-snapshot.mjs"
STATE_DIR="$HOME/.local/state/bamburu-backup"
LAST_OK="$STATE_DIR/last-success$SUFFIX"
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
Destino: $REMOTE

--- log ---
$LOGBUF"
  hc_ping "/fail"
  exit 1
}

[ -x "$RCLONE" ] || RCLONE="$(command -v rclone || true)"
[ -n "$RCLONE" ] && [ -x "$RCLONE" ] || fail_exit "rclone no encontrado"

# El destino DEBE ser un remote 'crypt'. Sin esto, un BACKUP_REMOTE mal puesto
# devolvería las copias a texto claro sin que nada fallara y con los emails en verde.
REMOTE_NAME="${REMOTE%%:*}"
"$RCLONE" config show "$REMOTE_NAME" 2>/dev/null | grep -q '^type = crypt' \
  || fail_exit "el destino '$REMOTE' no es un remote cifrado (crypt). Copia ABORTADA. Cómo crear el remote crypt: deploy/systemd/README.md §«Cifrado de las copias»."

hc_ping "/start"

TMPDIR="$(mktemp -d /tmp/bamburu-backup.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT
RDIR="$TMPDIR/restore"; mkdir -p "$RDIR"

# Verifica lo que hay en Drive SIN descargarlo. Con un remote 'crypt' no hay MD5 que
# pedir (rclone: "hash unsupported"), así que la comparación de huellas la hace
# cryptcheck: cifra el fichero local con el nonce del propio objeto remoto y compara
# su MD5 real contra el de Drive. La segunda mitad —que la copia VUELVA descifrada
# idéntica— la hace verify_restored(), aprovechando la descarga del restore-test.
# NO hay rama blanda: si la huella no se puede comparar, es un FALLO, no un aviso.
verify_uploaded(){  # $1 = ruta local, $2 = nombre remoto
  local local_path="$1" name="$2" lsize rsize
  lsize="$(stat -c%s "$local_path")"
  rsize="$("$RCLONE" size "$REMOTE/$name" --json 2>/dev/null | "$NODE" -e 'try{const a=JSON.parse(require("fs").readFileSync(0));process.stdout.write(String(a.bytes??""))}catch{process.stdout.write("")}')"
  [ -n "$rsize" ] || { log "  verify: el archivo NO aparece en Drive"; return 1; }
  [ "$lsize" = "$rsize" ] || { log "  verify: tamaño difiere (local $lsize / drive $rsize)"; return 1; }
  "$RCLONE" cryptcheck "$(dirname "$local_path")" "$REMOTE" --include "$name" >/dev/null 2>&1 \
    || { log "  verify: cryptcheck FALLA para $name (lo que hay en Drive no es el cifrado de este fichero)"; return 1; }
  return 0
}

# La copia tiene que VOLVER descifrada byte a byte. integrity_check solo dice que la
# base es válida — también lo diría de una base válida pero DISTINTA.
verify_restored(){  # $1 = ruta local original, $2 = ruta del fichero descargado
  local a b
  a="$(md5sum "$1" | awk '{print $1}')"; b="$(md5sum "$2" | awk '{print $1}')"
  [ "$a" = "$b" ] || { log "  restore: el MD5 del fichero descargado NO coincide ($a / $b)"; return 1; }
  return 0
}

uploaded=0
SUMMARY=""

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
  verify_uploaded "$snap" "$name" || fail_exit "verificación de subida de $name (tamaño/MD5)"

  log "restore-test: descarga + integrity_check de $name"
  "$RCLONE" copy "$REMOTE/$name" "$RDIR/" 2>/dev/null || fail_exit "descarga de restore de $name"
  verify_restored "$snap" "$RDIR/$name" || fail_exit "el restore de $name no coincide con el original (MD5)"
  ic="$(sqlite3 "$RDIR/$name" 'PRAGMA integrity_check;' 2>&1)"
  [ "$ic" = "ok" ] || fail_exit "integrity_check de $name => $ic"
  rm -f "$RDIR/$name"

  SUMMARY+="  • $name ($(du -h "$snap" | awk '{print $1}')) — subido, verificado y restore OK"$'\n'
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
  log "restore-test: descarga + tar -tzf de $uname"
  "$RCLONE" copy "$REMOTE/$uname" "$RDIR/" 2>/dev/null || fail_exit "descarga de restore de $uname"
  verify_restored "$utar" "$RDIR/$uname" || fail_exit "el restore de $uname no coincide con el original (MD5)"
  tar -tzf "$RDIR/$uname" >/dev/null 2>&1 || fail_exit "el tar de uploads no es válido tras restore"
  rm -f "$RDIR/$uname"
  SUMMARY+="  • $uname ($(du -h "$utar" | awk '{print $1}')) — subido, verificado y restore OK"$'\n'
  uploaded=$((uploaded+1))
fi

[ "$uploaded" -gt 0 ] || fail_exit "no se subió ningún archivo"

# --- Retención --------------------------------------------------------------
log "retención: borrando en Drive lo más viejo que ${RETENTION_DAYS} días"
"$RCLONE" delete --min-age "${RETENTION_DAYS}d" "$REMOTE/" 2>&1 | sed 's/^/    /' || log "WARN: la retención devolvió error (no crítico)"

# --- Éxito ------------------------------------------------------------------
date +%s > "$LAST_OK"
send_email "✅ Backup Bamburu [$LABEL] OK ($DATE)" "Backup completado y VERIFICADO en $HOST ($DATE).

$SUMMARY
Retención: ${RETENTION_DAYS} días. Destino: $REMOTE
Cada archivo se descargó de vuelta y se comprobó que abre (restore real)."
hc_ping ""
log "backup completado correctamente ($uploaded archivos)."
