#!/usr/bin/env bash
#
# cifrar-copias-de-seguridad.sh — Enciende el cifrado de las DOS copias de seguridad.
# De un solo uso: lo ejecuta Ibrahin, en una terminal normal, sin sudo y sin preguntas
# encadenadas. Una pasada hace los cinco pasos, EN ESTE ORDEN Y SIN SALTARSE NINGUNO:
#
#   generar la llave  ->  crear los dos remotes `crypt`  ->  COMPROBAR QUE DESCIFRA
#   ->  cambiar el destino de las copias  ->  ensenar la llave una vez por pantalla
#
# POR QUE EL ORDEN ES EL PRODUCTO Y NO UNA RECOMENDACION. El 1 de septiembre de 2026 las
# dos copias de la madrugada habrian abortado: el codigo exigia un destino `crypt` que
# nadie habia creado todavia. Aqui eso no puede pasar, y no por cuidado sino por
# construccion: el fichero de destinos —que es el que hace que la copia EXIJA cifrado— se
# escribe en el paso 4, y al paso 4 solo se llega despues de haber subido un fichero,
# haberlo bajado y haberlo comparado byte a byte en el paso 3. Si el paso 3 falla, el
# guion borra los remotes que habia creado y se va: esa noche la copia sale EN CLARO y en
# verde, que es exactamente lo que Ibrahin decidio que prefiere a quedarse sin copia.
#
# LA LLAVE. Vive en `rclone.conf` (600), NO en /etc/bamburu.env: ese fichero entra entero
# en el process.env del proceso web expuesto a Internet, y la llave de las copias es un
# secreto que la aplicacion no necesita para nada. Se ensena UNA vez por pantalla para que
# se custodie fuera del servidor. El riesgo dominante aqui no es que la roben: es PERDERLA
# —sin ella las copias son ruido—, y por eso el paso 5 no es un adorno.
#
# Se puede ejecutar entero contra un mundo de mentira, sin tocar Drive: respeta
# RCLONE_CONFIG, HOME y BACKUP_DESTINOS_CONF, y los remotes son parametros.
#
#   bash scripts/cifrar-copias-de-seguridad.sh                          # encender
#   bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico       # simulacro
#   bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico --hazlo
#
set -euo pipefail

BASE_1="${BASE_1:-gdrive}";      CIF_1="${CIF_1:-gdrive_cif}"
RAIZ_1="${RAIZ_1:-Bamburu-backup-cif}"
VIEJO_1="${VIEJO_1:-gdrive:Bamburu-backup/daily}"

BASE_2="${BASE_2:-gdrive_gili}"; CIF_2="${CIF_2:-gdrive_gili_cif}"
RAIZ_2="${RAIZ_2:-Bamburu-backup-gili-cif}"
VIEJO_2="${VIEJO_2:-gdrive_gili:Bamburu-backup-gili/daily}"

DESTINOS="${BACKUP_DESTINOS_CONF:-$HOME/.config/bamburu/backup-destinos.conf}"

RCLONE="${RCLONE:-/usr/bin/rclone}"
[ -x "$RCLONE" ] || RCLONE="$(command -v rclone || true)"
[ -n "$RCLONE" ] && [ -x "$RCLONE" ] || { echo "rclone no encontrado"; exit 1; }

# `rclone config show` de un remote inexistente imprime "# couldn't find type of fs" y sale
# con 0. La existencia y el tipo se deciden SIEMPRE por el grep, nunca por $?.
es_crypt(){       "$RCLONE" config show "$1" 2>/dev/null | grep -q '^type = crypt'; }
existe_remote(){  "$RCLONE" config show "$1" 2>/dev/null | grep -q '^type = ';      }

MIGRAR=0; HAZLO=0
for a in "$@"; do
  case "$a" in
    --migrar-historico) MIGRAR=1 ;;
    --hazlo)            HAZLO=1  ;;
    *) echo "uso: $0 [--migrar-historico [--hazlo]]"; exit 2 ;;
  esac
done

# --- Estado, que es tambien la respuesta a "¿esto esta hecho?" ---------------
estado(){
  echo "Estado actual:"
  for r in "$CIF_1" "$CIF_2"; do
    if es_crypt "$r"; then echo "  remote $r ......... crypt (creado)"
    elif existe_remote "$r"; then echo "  remote $r ......... EXISTE pero NO es crypt (!)"
    else echo "  remote $r ......... no existe"; fi
  done
  if [ -r "$DESTINOS" ]; then
    echo "  destinos .......... $DESTINOS (permisos $(stat -c%a "$DESTINOS"))"
    sed 's/^/      /' "$DESTINOS"
    echo "  -> las copias van CIFRADAS"
  else
    echo "  destinos .......... no existe ($DESTINOS)"
    echo "  -> las copias van EN CLARO"
  fi
}

# ============================================================================
# --migrar-historico — copiar -> comprobar -> y SOLO entonces retirar
# ============================================================================
# Esto NO choca con la regla "nunca destruir datos": no es una destruccion, es un
# TRASLADO dentro de la misma cuenta de Drive. Los mismos objetos siguen existiendo,
# verificados uno a uno por cryptcheck como identicos, dentro del contenedor cifrado.
# Y hace falta por un motivo medido: un fichero con nombre sin cifrar dentro de la raiz
# de un remote crypt se SALTA con codigo de salida 0, tanto al listar como al borrar
# ("Skipping undecryptable file name"). En cuanto el destino pase a crypt, la retencion
# de 14 dias no volvera a tocar nunca el historico en claro: no caduca solo.
migrar_una(){  # $1 = etiqueta, $2 = origen en claro, $3 = remote crypt
  local etiqueta="$1" viejo="$2" cif="$3" n n2 cc rc
  echo "── $etiqueta: $viejo -> $cif:daily"
  if ! es_crypt "$cif"; then
    echo "   '$cif' no es un remote crypt. Ejecuta antes el guion sin argumentos."; return 1
  fi
  n="$("$RCLONE" lsf "$viejo/" --files-only 2>/dev/null | wc -l)"
  echo "   objetos en claro: $n"
  [ "$n" -gt 0 ] || { echo "   nada que migrar"; return 0; }

  echo "   1) copiando…"
  "$RCLONE" copy "$viejo/" "$cif:daily/" 2>&1 | sed 's/^/      /' \
    || { echo "   la copia FALLÓ: no se ha borrado nada"; return 1; }

  # --one-way: se exige que TODO lo viejo este en el destino y coincida, pero no lo
  # contrario. Cuando esto se ejecuta, el destino cifrado YA tiene las copias de las
  # noches anteriores; sin --one-way esas sobrantes cuentan como diferencia y la
  # migracion no pasaria nunca. Medido: 23 "errors while checking" por ese motivo.
  echo "   2) cryptcheck --one-way (tiene que decir 0 differences y salir con 0)"
  rc=0; cc="$("$RCLONE" cryptcheck "$viejo" "$cif:daily" --one-way 2>&1)" || rc=$?
  printf '%s\n' "$cc" | tail -3 | sed 's/^/      /'
  [ "$rc" = 0 ] || { echo "   cryptcheck salió con $rc: NO se ha borrado nada"; return 1; }
  printf '%s' "$cc" | grep -q '0 differences found' \
    || { echo "   cryptcheck no confirmó '0 differences found': NO se ha borrado nada"; return 1; }

  echo "   3) recuento independiente al otro lado"
  n2="$("$RCLONE" lsf "$cif:daily/" --files-only 2>/dev/null | wc -l)"
  echo "      $n2 objetos legibles a través de la llave (hacen falta >= $n)"
  [ "$n2" -ge "$n" ] || { echo "   faltan objetos: NO se ha borrado nada"; return 1; }

  echo "   4) simulacro de retirada"
  "$RCLONE" delete "$viejo/" --dry-run 2>&1 | tail -5 | sed 's/^/      /'
  if [ "$HAZLO" != 1 ]; then
    echo "   SIMULACRO: no se ha borrado nada. Repite con --hazlo si esto está limpio."
    return 0
  fi

  echo "   5) retirando el original en claro"
  "$RCLONE" delete "$viejo/" 2>&1 | sed 's/^/      /' || { echo "   el borrado falló"; return 1; }
  n2="$("$RCLONE" lsf "$viejo/" --files-only 2>/dev/null | wc -l)"
  echo "      quedan $n2 objetos en claro (tiene que ser 0)"
  [ "$n2" -eq 0 ] || { echo "   quedan objetos en claro"; return 1; }
  echo "   hecho."
}

if [ "$MIGRAR" = 1 ]; then
  echo "=== Migración del histórico en claro ==="
  [ "$HAZLO" = 1 ] && echo "MODO REAL (--hazlo): se borrará el original tras verificarlo." \
                   || echo "SIMULACRO (por defecto): no se borra nada."
  echo
  # Si la primera cuenta falla, NO se toca la segunda: se para y se pregunta.
  migrar_una "cuenta principal" "$VIEJO_1" "$CIF_1" || { echo; echo "Se para aquí. No se ha borrado nada."; exit 1; }
  echo
  migrar_una "cuenta secundaria" "$VIEJO_2" "$CIF_2" || { echo; echo "Se para aquí. No se ha borrado nada."; exit 1; }
  exit 0
fi

# ============================================================================
# Encender el cifrado
# ============================================================================

# --- Paso 1. Negarse a pisar -------------------------------------------------
# Volver a crear los remotes generaria OTRA contrasena y dejaria ILEGIBLE lo ya subido.
if es_crypt "$CIF_1" || es_crypt "$CIF_2"; then
  echo "El cifrado ya está creado: este guion NO vuelve a generar ninguna clave."
  echo "(hacerlo dejaría ilegible todo lo que ya está subido)"
  echo
  estado
  if es_crypt "$CIF_1" && es_crypt "$CIF_2" && [ -r "$DESTINOS" ]; then
    echo; echo "Todo puesto. Nada que hacer."; exit 0
  fi
  echo; echo "Está A MEDIAS. Revísalo antes de seguir."; exit 1
fi

# --- Paso 2. Prerrequisitos, ANTES de generar ninguna clave -------------------
for b in "$BASE_1" "$BASE_2"; do
  existe_remote "$b" || { echo "falta el remote de Drive '$b'. Créalo antes (rclone config)."; exit 1; }
done
CONF="$("$RCLONE" config file 2>/dev/null | tail -1)"
[ -f "$CONF" ] || { echo "no encuentro el fichero de configuración de rclone ($CONF)"; exit 1; }
[ -w "$CONF" ] || { echo "no puedo escribir en $CONF. Ejecuta esto como el usuario dueño del fichero."; exit 1; }
echo "Prerrequisitos OK: $BASE_1, $BASE_2, y $CONF es escribible."

LISTO=0
CREADOS=()
ENSAYO_DIR="$(mktemp -d /tmp/cif-ensayo.XXXXXX)"; chmod 700 "$ENSAYO_DIR"

# La prueba borra SIEMPRE lo que crea, pase, falle o reviente. Y si no llegamos al final,
# deshace los remotes que haya creado este guion: no se deja el mundo a medias.
limpiar(){
  local r
  if [ "${#CREADOS[@]}" -gt 0 ]; then
    for r in "${CREADOS[@]}"; do "$RCLONE" purge "$r:ensayo" >/dev/null 2>&1 || true; done
    if [ "$LISTO" != 1 ]; then
      for r in "${CREADOS[@]}"; do "$RCLONE" config delete "$r" >/dev/null 2>&1 || true; done
      echo
      echo "DESHECHO: se han borrado los remotes que este guion había creado."
      echo "El destino de las copias NO se ha cambiado: esta noche saldrán EN CLARO, y en verde."
    fi
  fi
  rm -rf "$ENSAYO_DIR"
}
trap limpiar EXIT

# --- Paso 3. Generar la llave. UNA sola, para los dos destinos ----------------
# Dos claves duplicarian la custodia sin ganar nada: viven en el mismo fichero del mismo
# servidor, asi que no hay escenario en que un atacante tenga una y no la otra.
CLAVE="$(openssl rand -base64 32)"
SAL="$(openssl rand -base64 24)"

# --- Paso 4. Crear los dos remotes crypt -------------------------------------
# `rclone obscure` por STDIN y nunca por argv: los argumentos se ven en `ps`.
# Y todo con >/dev/null, porque `config create` imprime la seccion que acaba de crear.
crear_crypt(){  # $1 = nombre, $2 = base, $3 = raiz
  "$RCLONE" config create "$1" crypt \
    remote="$2:$3" \
    password="$(printf '%s' "$CLAVE" | "$RCLONE" obscure -)" \
    password2="$(printf '%s' "$SAL"   | "$RCLONE" obscure -)" \
    filename_encryption=standard directory_name_encryption=true >/dev/null
  CREADOS+=("$1")
}
echo "Creando los remotes cifrados sobre raíces NUEVAS (lo cifrado y lo antiguo no comparten carpeta)…"
crear_crypt "$CIF_1" "$BASE_1" "$RAIZ_1"
crear_crypt "$CIF_2" "$BASE_2" "$RAIZ_2"

# --- Paso 5. Releerlos. `config create` devuelve 0 aunque no haya escrito nada -
# Medido: con el .conf en solo lectura, el error va a stderr y el codigo de salida sigue
# siendo 0, y el fichero queda vacio. Un remote fantasma y una clave que se cree creada.
for r in "$CIF_1" "$CIF_2"; do
  es_crypt "$r" || { echo "el remote '$r' NO quedó escrito como crypt."; exit 1; }
done
# Las dos contrasenas tienen que ser la misma. `rclone obscure` NO es determinista (dos
# obscures de la misma clave dan cadenas distintas), asi que se comparan los `reveal`,
# en memoria y sin imprimir nada.
leer_clave(){  # $1 = remote, $2 = campo
  "$RCLONE" config dump 2>/dev/null \
    | node -e 'const[r,c]=process.argv.slice(1);let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)[r]?.[c]??""))}catch{}})' "$1" "$2"
}
P1="$("$RCLONE" reveal "$(leer_clave "$CIF_1" password)")"
P2="$("$RCLONE" reveal "$(leer_clave "$CIF_2" password)")"
[ -n "$P1" ] && [ "$P1" = "$P2" ] && [ "$P1" = "$CLAVE" ] \
  || { echo "las contraseñas escritas no coinciden con la generada."; exit 1; }
unset P1 P2
echo "Los dos remotes están escritos como crypt, con la MISMA contraseña."

# --- Paso 6. EL ENSAYO. Subir, bajar y comparar de verdad, por cuenta ---------
# Este es el paso que impide repetir el 1 de septiembre. Si no descifra, no se enciende.
ensayo(){  # $1 = remote crypt, $2 = base, $3 = raiz
  local cif="$1" base="$2" raiz="$3" f="$ENSAYO_DIR/ensayo-cif.bin" crudo cc rc
  mkdir -p "$ENSAYO_DIR/vuelta"; rm -f "$ENSAYO_DIR/vuelta/ensayo-cif.bin"
  head -c 300000 /dev/urandom > "$f"

  if ! "$RCLONE" copy "$f" "$cif:ensayo/" >/dev/null 2>&1; then
    echo "   no se pudo SUBIR el fichero de ensayo"; return 1; fi
  if ! "$RCLONE" copy "$cif:ensayo/ensayo-cif.bin" "$ENSAYO_DIR/vuelta/" >/dev/null 2>&1; then
    echo "   no se pudo BAJAR el fichero de ensayo"; return 1; fi
  if ! cmp -s "$f" "$ENSAYO_DIR/vuelta/ensayo-cif.bin"; then
    echo "   lo que baja NO es idéntico a lo que subió: NO descifra bien"; return 1; fi

  # Sin la llave no se puede leer el nombre. Si se lee, el cifrado de nombres no esta puesto.
  crudo="$("$RCLONE" lsf "$base:$raiz/" -R 2>/dev/null || true)"
  if printf '%s' "$crudo" | grep -q -e 'ensayo-cif' -e '\.bin'; then
    echo "   el nombre del fichero se LEE en el destino crudo: los nombres no van cifrados"; return 1; fi

  rc=0; cc="$("$RCLONE" cryptcheck "$ENSAYO_DIR" "$cif:ensayo" --include "/ensayo-cif.bin" 2>&1)" || rc=$?
  if [ "$rc" != 0 ]; then printf '%s\n' "$cc" | tail -2 | sed 's/^/   /'; echo "   cryptcheck salió con $rc"; return 1; fi
  if ! printf '%s' "$cc" | grep -q '0 differences found'; then
    echo "   cryptcheck no confirmó '0 differences found'"; return 1; fi

  "$RCLONE" purge "$cif:ensayo" >/dev/null 2>&1 || true
  return 0
}
echo "Ensayo real (subir, bajar, comparar byte a byte, y mirar el destino en crudo)…"
for par in "$CIF_1|$BASE_1|$RAIZ_1" "$CIF_2|$BASE_2|$RAIZ_2"; do
  IFS='|' read -r c b r <<<"$par"
  echo " · $c"
  ensayo "$c" "$b" "$r" || { echo; echo "EL ENSAYO HA FALLADO en '$c'. No se toca el destino de las copias."; exit 1; }
  echo "   sube, baja, coincide byte a byte, y en crudo no se lee el nombre."
done

# --- Paso 7. SOLO AHORA se cambia el destino ---------------------------------
# Escritura atomica: temporal en el mismo directorio + mv. Y 600 desde que nace (umask).
mkdir -p "$(dirname "$DESTINOS")"
( umask 077
  TMPD="$(mktemp "$(dirname "$DESTINOS")/.destinos.XXXXXX")"
  printf 'DESTINO_principal=%s:daily\nDESTINO_secundaria=%s:daily\n' "$CIF_1" "$CIF_2" >"$TMPD"
  chmod 600 "$TMPD"
  mv -f "$TMPD" "$DESTINOS" )
[ -r "$DESTINOS" ] || { echo "el fichero de destinos no quedó legible"; exit 1; }
PERM="$(stat -c%a "$DESTINOS")"
[ "$PERM" = 600 ] || { echo "el fichero de destinos quedó en $PERM y tiene que ser 600"; exit 1; }
LISTO=1
echo
echo "Destino cambiado. Las dos copias de esta noche saldrán CIFRADAS:"
sed 's/^/   /' "$DESTINOS"

PERM_CONF="$(stat -c%a "$CONF")"
if [ "$PERM_CONF" != 600 ]; then
  echo
  echo "⚠️  ATENCIÓN: $CONF está en $PERM_CONF y ahí vive la llave. Debería estar en 600:"
  echo "      chmod 600 $CONF"
fi

# --- Paso 8. La llave, UNA vez y por pantalla --------------------------------
# El unico sitio de todo el guion donde se imprime. No va a ningun fichero ni a ningun log,
# y ninguna otra ejecucion la vuelve a ensenar.
cat <<AVISO

════════════════════════════════════════════════════════════════════════════
  GUARDA ESTO AHORA, ANTES DE CERRAR LA TERMINAL

  Contraseña : $CLAVE
  Sal        : $SAL

  Va en tu gestor de contraseñas (o en papel en un cajón): cualquier sitio que
  sobreviva a que este servidor desaparezca. Las copias existen justo para ese
  día, y SIN ESTA LLAVE LAS COPIAS SON RUIDO — no hay forma de recuperarlas.
  No se volverá a enseñar: este guion no la imprime nunca más.
════════════════════════════════════════════════════════════════════════════
AVISO
unset CLAVE SAL

cat <<'SIGUIENTE'

Lo que queda, cuando quieras:

  1) Ver la primera copia cifrada sin esperar al reloj:
       sudo systemctl start bamburu-backup.service
       sudo systemctl start bamburu-backup-secondary.service

  2) El histórico que ya está en claro en Drive NO caduca solo (rclone salta los
     nombres que no puede descifrar, también al borrar). Para retirarlo:
       bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico
       bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico --hazlo

  Y para comprobar que la copia se abre partiendo SOLO de la llave custodiada:
       bash scripts/ensayo-restauracion-cifrada.sh --backend gdrive:Bamburu-backup-cif
SIGUIENTE
