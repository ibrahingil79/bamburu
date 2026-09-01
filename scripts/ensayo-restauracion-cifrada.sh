#!/usr/bin/env bash
#
# ensayo-restauracion-cifrada.sh — Abrir una copia partiendo SOLO de la llave custodiada.
#
# QUE DEMUESTRA, Y POR QUE ES OTRA COSA QUE LA PRUEBA DIARIA. La copia diaria comprueba que
# lo que sube vuelve y abre, pero lo hace con el rclone.conf de ESTE servidor, que ya tiene
# la llave dentro. Este guion NO LEE ~/.config/rclone/rclone.conf en ningun momento: se
# construye una configuracion temporal desde cero con la contrasena que le den por stdin.
# Por eso vale: demuestra que el dia en que este servidor no exista, la llave que Ibrahin
# tiene guardada fuera basta para abrir las copias. En SAP HANA esto es un procedimiento con
# nombre propio y obligatorio; el foro de Odoo, en cambio, esta lleno de copias cifradas que
# nadie abrio nunca. Se hace, no se supone.
#
# LA LLAVE SUSTITUYE AL `crypt`, NO A LA CREDENCIAL DE LA CUENTA. Contra Drive de verdad
# hace falta ademas un remote autorizado con la cuenta (el token de OAuth): la contrasena
# descifra el contenido, no da acceso a Google. Por eso --backend se pasa aparte.
#
#   # contra el Drive de produccion (usa el remote gdrive: ya autorizado como backend crudo)
#   bash scripts/ensayo-restauracion-cifrada.sh --backend gdrive:Bamburu-backup-cif
#
#   # sin teclear nada, desde un gestor de contrasenas:
#   printf '%s\n%s\n' "$CLAVE" "$SAL" | bash scripts/ensayo-restauracion-cifrada.sh --backend …
#
set -euo pipefail

BACKEND=""
SUBDIR="${SUBDIR:-daily}"
while [ $# -gt 0 ]; do
  case "$1" in
    --backend) BACKEND="${2:-}"; shift 2 ;;
    --subdir)  SUBDIR="${2:-}";  shift 2 ;;
    *) echo "uso: $0 --backend <remote:raiz> [--subdir daily]"; exit 2 ;;
  esac
done
[ -n "$BACKEND" ] || { echo "falta --backend <remote:raiz> (el destino CRUDO, sin descifrar)"; exit 2; }

RCLONE="${RCLONE:-/usr/bin/rclone}"
[ -x "$RCLONE" ] || RCLONE="$(command -v rclone || true)"
[ -n "$RCLONE" ] && [ -x "$RCLONE" ] || { echo "rclone no encontrado"; exit 1; }

# La contrasena entra por STDIN y nunca por argv: los argumentos se ven en `ps`.
IFS= read -r CLAVE || true
IFS= read -r SAL    || true
[ -n "${CLAVE:-}" ] || { echo "no he leído la contraseña por stdin (línea 1: contraseña, línea 2: sal)"; exit 2; }

# Configuracion TEMPORAL y propia. Aqui esta la gracia del ensayo: no se hereda nada.
TRABAJO="$(mktemp -d /tmp/ensayo-restauracion.XXXXXX)"; chmod 700 "$TRABAJO"
trap 'rm -rf "$TRABAJO"' EXIT
export RCLONE_CONFIG="$TRABAJO/rclone.conf"

# El backend crudo se re-declara con el MISMO nombre dentro de la config temporal cuando es
# un remote con nombre; si el ensayo corre contra produccion hace falta que ese remote
# exista aqui, asi que se admite tambien heredar solo esa seccion (nunca la del crypt).
BASE_NOMBRE="${BACKEND%%:*}"
if [ -n "${RCLONE_CONFIG_ORIGEN:-}" ] && [ -r "$RCLONE_CONFIG_ORIGEN" ]; then
  # Se copia UNICAMENTE la seccion del backend crudo. La del crypt no se toca: si se
  # copiara, el ensayo estaria usando la llave del servidor y no demostraria nada.
  node -e '
    const fs=require("fs");const[f,s]=process.argv.slice(1);
    const t=fs.readFileSync(f,"utf8").split(/\r?\n/);let dentro=false,out=[];
    for(const l of t){const m=l.match(/^\[(.+)\]\s*$/);if(m)dentro=(m[1]===s);if(dentro)out.push(l)}
    process.stdout.write(out.join("\n")+"\n")' "$RCLONE_CONFIG_ORIGEN" "$BASE_NOMBRE" >"$RCLONE_CONFIG"
  echo "backend '$BASE_NOMBRE' heredado (solo esa sección; la del crypt NO)."
fi

"$RCLONE" config create ensayo_cif crypt \
  remote="$BACKEND" \
  password="$(printf '%s' "$CLAVE"  | "$RCLONE" obscure -)" \
  password2="$(printf '%s' "${SAL:-}" | "$RCLONE" obscure -)" \
  filename_encryption=standard directory_name_encryption=true >/dev/null
unset CLAVE SAL
"$RCLONE" config show ensayo_cif 2>/dev/null | grep -q '^type = crypt' \
  || { echo "no se pudo construir la configuración temporal"; exit 1; }

echo "Listando $BACKEND a través de la llave custodiada…"
LISTA="$("$RCLONE" lsf "ensayo_cif:$SUBDIR/" 2>/dev/null | grep '\.db$' | sort || true)"
[ -n "$LISTA" ] || { echo "no se lee ningún .db: o la llave no es la buena, o ahí no hay copias."; exit 1; }
echo "$LISTA" | sed 's/^/   /'

NOMBRE="$(printf '%s\n' "$LISTA" | tail -1)"
echo
echo "Descargando y abriendo: $NOMBRE"
"$RCLONE" copy "ensayo_cif:$SUBDIR/$NOMBRE" "$TRABAJO/" >/dev/null 2>&1 \
  || { echo "no se pudo descargar $NOMBRE"; exit 1; }

IC="$(sqlite3 "$TRABAJO/$NOMBRE" 'PRAGMA integrity_check;' 2>&1 | head -1)"
[ "$IC" = "ok" ] || { echo "integrity_check => $IC"; exit 1; }

# integrity_check responde `ok` tambien a una base VACIA. Que abra no es que sirva.
OBJ="$(sqlite3 "$TRABAJO/$NOMBRE" 'SELECT count(*) FROM sqlite_master;' 2>&1 | head -1)"
case "$OBJ" in (''|*[!0-9]*) echo "no pude contar los objetos: $OBJ"; exit 1 ;; esac
[ "$OBJ" -gt 0 ] || { echo "la base abre pero está VACÍA (0 objetos): eso no es una copia útil"; exit 1; }

echo
echo "✅ ENSAYO SUPERADO"
echo "   fichero ............ $NOMBRE ($(stat -c%s "$TRABAJO/$NOMBRE") bytes)"
echo "   integrity_check .... ok"
echo "   objetos del esquema. $OBJ"
echo "   Partiendo SOLO de la llave, la copia se descifra y se abre."
