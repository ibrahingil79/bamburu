# Units de systemd de Bamburu

> **Comprobaciones automáticas: ninguna.** El 26 ago 2026 se detuvo, deshabilitó y eliminó de
> `/etc/systemd/system/` el timer y el servicio `bamburu-barrido-nocturno`. No deben reinstalarse:
> gates, barridos, tests y regresiones solo se ejecutan cuando Ibrahin los solicita o autoriza
> expresamente, conforme a `RITUAL.md`. El script `scripts/barrido-nocturno.sh` se conserva únicamente
> como herramienta manual. El resto de unidades de esta página son procesos normales del producto o
> de respaldo, no comprobaciones funcionales.

| Unit | Qué hace | Detalle |
|------|----------|---------|
| `bamburu-backup` + `bamburu-backup-heartbeat` | Copia diaria a Google Drive, blindada | abajo |
| `bamburu-backup-secondary` | **SEGUNDA copia** diaria a la otra cuenta de Drive (S6) | abajo |
| `bamburu-avisos` | Resumen diario de avisos por email (08:00 Europe/Madrid) | `scripts/bamburu-avisos.mjs` |
| `bamburu-recordatorios-cita` | Recordatorio de citas por email, el día antes (09:00 Europe/Madrid) | `scripts/bamburu-recordatorios-cita.mjs` |
| `bamburu-caducar-reservas` | Caduca las solicitudes de cita por Internet sin responder y **libera el hueco** (cada hora) | abajo |
| `bamburu-propuestas` | Genera las **Propuestas de DISA** del día (07:45 Europe/Madrid) | abajo |
| `bamburu-verifactu-cola` | **Red de seguridad** de la cola de envío a la AEAT (cada 2 min) | `docs/verifactu/tarea2-cola-envio-automatico.md` |
| `orquestador` | **INSTALADA (31 ago 2026).** Construye solo las tareas PENDIENTES del TABLERO, una tras otra, sin que nadie mueva ningún rótulo (arquitecto → programador → revisor) | `orquestador.service` y `orchestrator/LEEME.md` |
| `orquestador-vigia` | **INSTALADA (31 ago 2026).** Atiende las órdenes que Ibrahin manda por Telegram. Va aparte del ciclo para poder contestar mientras el orquestador está ocupado o caído | `orquestador-vigia.service` y `docs/orquestador/mandarle-por-telegram.md` |

## Caducar reservas por Internet (peldaño 7 · pieza 6) — INSTALADO

Solo actúa en los negocios con la **puerta pública ENCENDIDA** y en modo **«yo apruebo»**.

En ese modo una solicitud **retiene el hueco**: la cita ya existe y ocupa sitio en la agenda, porque si
no lo retuviera, aprobar podría fallar por un solape aparecido entre medias y el cliente se enteraría el
día de la cita. El precio de retener es que hay que **soltar**: una solicitud sin respuesta se cae sola
pasadas las horas que fije el dueño (`cita_pub_retencion_horas`, 24 por defecto) y devuelve el hueco.

**Por qué cada hora y no una vez al día:** la retención la fija el dueño y puede bajarla a 2 h. Con un
barrido diario, un hueco podría quedar retenido hasta 24 h más de lo configurado — y el cliente que
quería ese hueco lo vería ocupado por una solicitud ya muerta. Es un `UPDATE` sobre una tabla diminuta.

**Idempotente:** solo mira las `pendiente` con su `retiene_hasta` cumplido y las marca `caducada`.
Pasar dos veces no cambia nada, así que `Persistent=true` (arranque tardío) es inofensivo.

    sudo systemctl start bamburu-caducar-reservas.service    # ejecutar ahora
    RESERVAS_DRY=1 node scripts/bamburu-caducar-reservas.mjs  # simular sin escribir

## Propuestas de DISA (D5 + D5b) — INSTALADO

Prepara, cada mañana antes del resumen de avisos, el trabajo que DISA deja listo para que el dueño
decida. Genera los **dos** tipos en un solo barrido (no hay un segundo timer):

- **Recordatorio de impago (D5)** — factura de VENTA vencida con retraso ≥ `dias_recordatorio_impago`
  (Ajustes, 7 por defecto) → borrador de email de cobro.
- **Pago por vencer (D5b)** — factura de COMPRA con importe pendiente que vence dentro de los próximos
  `dias_aviso_pago` (Ajustes, 7 por defecto) → atajo para registrar el pago.

**No envía nada ni mueve dinero: solo PREPARA.** Todo lo que tiene consecuencias lo aprueba el dueño en
`/admin/propuestas`. Por eso no necesita `RESEND_API_KEY`.

**Idempotente:** los índices únicos `(invoice_id, type)` y `(supplier_invoice_id, type)` impiden
duplicar. El panel TAMBIÉN genera al abrirse; que coincidan el mismo día no crea nada de más, y una
propuesta descartada no se vuelve a proponer.

```bash
cd /home/ubuntu/bamburu
sudo cp deploy/systemd/bamburu-propuestas.service /etc/systemd/system/
sudo cp deploy/systemd/bamburu-propuestas.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bamburu-propuestas.timer

# Comprobar sin escribir nada:
node scripts/bamburu-propuestas.mjs --dry-run
systemctl list-timers bamburu-propuestas --no-pager
journalctl -u bamburu-propuestas -n 40 --no-pager
```

---

## Cola de envío Verifactu — instalación

El camino normal es la cola **en proceso**: al emitir una factura, su registro sale hacia la AEAT en
segundos (ventana de 240 s de la huella). Este timer solo recoge lo que quedó colgado tras un reinicio
o una caída larga de la AEAT — nunca perseguiría los 240 s por sí solo.

**Sin certificado configurado la cola está inactiva y este barrido no hace nada: instalarlo es inocuo.**

```bash
cd /home/ubuntu/bamburu
sudo cp deploy/systemd/bamburu-verifactu-cola.service /etc/systemd/system/
sudo cp deploy/systemd/bamburu-verifactu-cola.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bamburu-verifactu-cola.timer

# Comprobar sin enviar nada:
node scripts/bamburu-verifactu-cola.mjs --dry-run
journalctl -u bamburu-verifactu-cola -n 40 --no-pager
```

Para desactivarla del todo (reversible, sin desinstalar): `VERIFACTU_COLA=off` en `/etc/bamburu.env`.

---

# Copia automática de los datos a Google Drive (rclone)

Copia diaria de los datos del servidor Bamburu a **Google Drive** (cuenta personal
`ibrahingil@gmail.com`) vía **rclone**, **blindada contra fallo silencioso** (la lección
de la crisis: nada se asume, todo se verifica y se notifica).

## Qué hace, cada día

- **Snapshot consistente** de cada BD SQLite (`data/control.db` y `data/tenants/*.db`)
  con la *SQLite Online Backup API* (`scripts/db-snapshot.mjs`). Nunca se copia el `.db`
  en crudo (evita roturas por el WAL). Las `data/uploads` se empaquetan en `tar.gz`.
- Sube cada artefacto a Drive **CIFRADO** (remote `crypt`), con nombre fechado a este lado de la
  clave: `<nombre>-AAAA-MM-DD.db` y `uploads-AAAA-MM-DD.tar.gz`. En el Drive crudo **no se lee
  ninguno de esos nombres**: van cifrados el contenido, el nombre del fichero y el de la carpeta.
- **El destino tiene que ser `crypt` o no hay copia.** Si `BACKUP_REMOTE` apunta a un remote que no
  es cifrado, el script **aborta antes de subir nada** (email de fallo + `exit 1`). Cifrar es
  condición, no opción. Ver §«Cifrado de las copias» más abajo.
- **Verifica la subida de verdad**: compara el tamaño y luego `rclone cryptcheck`, que cifra el
  fichero local con el nonce del propio objeto de Drive y compara su MD5 real contra el de Drive.
  **No hay rama blanda**: si la huella no se puede comparar, es un fallo, no un aviso.
- **Prueba de restore real**: descarga cada artefacto de vuelta, comprueba que **el MD5 del fichero
  descifrado es idéntico al original** y que abre (`sqlite3 PRAGMA integrity_check == ok`; el tar
  con `tar -tzf`). El MD5 no sobra: `integrity_check` responde `ok` también a una base válida pero
  **distinta** — medido.
- **Retención 14 días**: borra en Drive lo más viejo. Una copia corrupta nunca pisa la buena.
- **Email (Resend, `noreply@bamburu.com` → `ibrahingil@gmail.com`)** en OK y en FALLO.
- **Ping a healthchecks.io** (`HEALTHCHECKS_URL`): dead-man's-switch externo que avisa
  aunque el servidor esté muerto del todo.
- Graba marca de último éxito (`~/.local/state/bamburu-backup/last-success`).

Un **heartbeat** independiente (`bamburu-backup-heartbeat`) revisa esa marca y avisa por
email si no hay copia con éxito en +48h (capta "el backup falló siempre" y "el timer ni disparó").

## Piezas

| Pieza | Ubicación | En el repo |
|-------|-----------|------------|
| Script de backup | `scripts/bamburu-backup.sh` | sí |
| Script de heartbeat | `scripts/bamburu-backup-heartbeat.sh` | sí |
| Helper de snapshot | `scripts/db-snapshot.mjs` | sí |
| Units (backup + heartbeat, service + timer) | `deploy/systemd/bamburu-backup*.{service,timer}` | sí |
| Binario rclone | `/usr/bin/rclone` | no (instalado) |
| **Config rclone (token Google Drive + CONTRASEÑA DE CIFRADO)** | `~/.config/rclone/rclone.conf` | **NO (secreto, fuera del repo)** |
| **Copia de la contraseña de cifrado** | **fuera del servidor**, en custodia de Ibrahin | **NO — y sin ella las copias son ruido** |
| `RESEND_API_KEY`, `HEALTHCHECKS_URL` | `/etc/bamburu.env` | **NO (secretos)** |

## Instalación (requiere sudo)

```bash
cd /home/ubuntu/bamburu
sudo cp deploy/systemd/bamburu-backup*.service /etc/systemd/system/
sudo cp deploy/systemd/bamburu-backup*.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bamburu-backup.timer bamburu-backup-heartbeat.timer
```

## Comprobaciones

```bash
systemctl list-timers 'bamburu-backup*'       # próximas ejecuciones
sudo systemctl start bamburu-backup.service   # ejecutar la copia a mano
journalctl -u bamburu-backup.service -n 80     # logs
rclone ls gdrive_cif:daily/                    # ver copias (A TRAVÉS de la clave)
rclone lsf gdrive:Bamburu-backup-cif/ -R       # lo mismo SIN la clave: nombres ilegibles
```

## Restauración

> **HACE FALTA LA CONTRASEÑA DE CIFRADO.** Las copias van dentro de un contenedor `rclone crypt`.
> Sin la contraseña no hay restauración posible: lo que hay en Drive es ruido.
> **Dónde está:** en `~ubuntu/.config/rclone/rclone.conf` de este servidor (campo `password` del
> remote `gdrive_cif`, recuperable con `rclone reveal`) **y**, para el día en que este servidor no
> exista, en la custodia de Ibrahin fuera del servidor. Si estás leyendo esto un día malo y el
> servidor no arranca, la copia de Ibrahin es la que vale.

```bash
# Desde ESTE servidor (usa el rclone.conf de producción, que ya tiene la clave)
rclone copy gdrive_cif:daily/desarrollo-bamburu-AAAA-MM-DD.db /tmp/restore/

# Desde CUALQUIER OTRA máquina, tecleando la contraseña custodiada:
export RCLONE_CONFIG=/tmp/restore.conf
rclone config create r_drive drive                       # autorizar la cuenta de Drive
rclone config create r_cif crypt remote=r_drive:Bamburu-backup-cif \
    password=<contraseña custodiada> password2=<sal custodiada> \
    filename_encryption=standard directory_name_encryption=true
rclone copy r_cif:daily/desarrollo-bamburu-AAAA-MM-DD.db /tmp/restore/

# El .db descargado ya es autocontenido: con el servicio parado, colócalo en
# data/tenants/ con el nombre que espera la app (p. ej. desarrollo-bamburu.db).
# Las uploads:  tar -xzf uploads-AAAA-MM-DD.tar.gz -C data/   (recrea data/uploads)
```

## Cifrado de las copias

> ⚠️ **NO ESTÁ PUESTO. REVERTIDO EL 1 SEP 2026 POR DECISIÓN DE IBRAHIN.** Las copias van
> **EN CLARO**. Esta sección describe cómo se pensó, no lo que corre: los remotes `crypt` nunca
> llegaron a crearse, la contraseña nunca se generó, y con el guardián puesto las dos copias
> habrían abortado. Se devolvió el script al estado anterior y las dos copias se comprobaron a
> mano ese día (16 archivos cada una, exit 0). La tarea se reescribe y vuelve a la cola.


> **Es la sección que cita el mensaje de fallo del script.** Si has llegado aquí desde un email
> «❌ Backup Bamburu FALLÓ … el destino no es un remote cifrado (crypt)», lo que falta es crear los
> dos remotes `crypt`: el bloque de abajo.

**Por qué.** Hasta el 1 sep 2026 las copias iban **en claro** en dos Drive personales: 203 clientes
y 922 facturas de nueve negocios, y los propios nombres de fichero publicaban cuántos negocios hay y
cómo se llaman. Es el vector 4 de `docs/seguridad/vectores-de-ataque.md`.

**Dónde vive la contraseña, y por qué NO en `/etc/bamburu.env`.** `bamburu.service` carga ese fichero
entero con `EnvironmentFile=`, así que todo lo que se meta ahí acaba en el `process.env` del proceso
web expuesto a Internet —y de ahí en el hijo que lanza el botón «Lanzar copia ahora» del superadmin—.
La clave de las copias es un secreto que la aplicación web **no necesita para nada**. Viviendo dentro
de `rclone.conf`, el proceso web nunca la ve, el botón del superadmin sigue funcionando sin tocar
`modules/superadmin/backups.js` (el hijo corre como `ubuntu` y rclone lee su propio fichero), y no se
añade **ninguna** variable de entorno nueva a ninguna unit.

Dicho sin adornarlo: el campo `password` de `rclone.conf` está **ofuscado, no cifrado** — `rclone
reveal` devuelve el original. Y eso no debilita nada: quien pueda leer ese fichero ya tiene `data/`
entera en claro en el mismo disco **y** los tokens de OAuth de las dos cuentas. El vector que esto
cierra es **«alguien entra en la cuenta de Google»**, y contra ése la ofuscación local es irrelevante.

**Una sola contraseña para los dos destinos.** Dos claves duplicarían la custodia sin ganar nada: no
hay ningún escenario en que un atacante tenga una y no la otra, porque viven en el mismo fichero del
mismo servidor. Y el riesgo dominante aquí **no es que se filtre la clave: es perderla.**

### Crear los dos remotes `crypt` (lo hace Ibrahin, requiere escribir en `~/.config/rclone`)

Todo en **un solo `bash -c`**, para que la contraseña no salga nunca del proceso. Nada de `echo`,
nada de `sudo` con la clave, `rclone obscure` por **stdin**, y todos los `rclone config` con
`>/dev/null` porque imprimen la sección creada:

```bash
set -euo pipefail
CLAVE="$(openssl rand -base64 32)"
SAL="$(openssl rand -base64 24)"
OBS_CLAVE="$(printf '%s' "$CLAVE" | rclone obscure -)"
OBS_SAL="$(printf '%s' "$SAL" | rclone obscure -)"

rclone config create gdrive_cif crypt \
  remote=gdrive:Bamburu-backup-cif \
  password="$OBS_CLAVE" password2="$OBS_SAL" \
  filename_encryption=standard directory_name_encryption=true >/dev/null

rclone config create gdrive_gili_cif crypt \
  remote=gdrive_gili:Bamburu-backup-gili-cif \
  password="$OBS_CLAVE" password2="$OBS_SAL" \
  filename_encryption=standard directory_name_encryption=true >/dev/null

unset CLAVE SAL OBS_CLAVE OBS_SAL
```

**Condición de paso, no un detalle:** `rclone config create` puede **imprimir la sección, devolver 0
y no haber escrito nada** (pasa si el `.conf` está en solo lectura: el error va a stderr y el código
de salida sigue siendo 0). Medido el 1 sep 2026. Así que no se sigue sin ver esto:

```bash
rclone config show gdrive_cif      | grep '^type'   # -> type = crypt
rclone config show gdrive_gili_cif | grep '^type'   # -> type = crypt
```

**Raíz nueva a propósito** (`Bamburu-backup-cif`, `Bamburu-backup-gili-cif`): lo cifrado y lo antiguo
no comparten carpeta, así no se puede confundir un listado con otro.

### Custodiar la contraseña — PARADA, y no es un trámite

Las copias existen para el día en que el servidor no esté. Si la única copia de la clave vive en el
servidor, ese día las copias son ruido. Antes de nada más, guardarla **fuera** (gestor de contraseñas
o papel en un cajón — cualquier sitio que sobreviva a que este servidor desaparezca):

```bash
rclone reveal "$(rclone config show gdrive_cif | awk -F'= ' '/^password =/{print $2}')"
rclone reveal "$(rclone config show gdrive_cif | awk -F'= ' '/^password2 =/{print $2}')"
```

### Ensayo antes de tocar nada vivo

El patrón de S6: comprobar la credencial **antes** de instalar. La prueba borra lo que crea.

```bash
head -c 300000 /dev/urandom > /tmp/ensayo-cif.bin
rclone copy /tmp/ensayo-cif.bin gdrive_cif:ensayo/
rclone size gdrive_cif:ensayo/ensayo-cif.bin --json                  # tamaño EN CLARO: 300000
rclone cryptcheck /tmp gdrive_cif:ensayo --include ensayo-cif.bin    # 0 diferencias, exit 0
rclone lsf gdrive:Bamburu-backup-cif/                                # nombres ILEGIBLES
rclone purge gdrive_cif:ensayo
```

Lo mismo con `gdrive_gili_cif`.

### Migrar el histórico en claro — copiar → comprobar → y SOLO entonces retirar

**El orden no es negociable.** Y hay un motivo medido para no dejar que el histórico caduque solo:
cuando un fichero con nombre sin cifrar convive en el directorio de un remote `crypt`, rclone lo
**salta** (`Skipping undecryptable file name`) con código de salida 0 — tanto al listar como al
borrar. La retención de 14 días **no volvería a tocarlo nunca**: se quedaría ahí para siempre,
legible, mientras los correos dicen que todo va cifrado.

```bash
# 1) copiar (conserva las fechas de modificación: la retención sigue contando igual)
rclone copy gdrive:Bamburu-backup/daily/ gdrive_cif:daily/ --progress
rclone copy gdrive_gili:Bamburu-backup-gili/daily/ gdrive_gili_cif:daily/ --progress

# 2) comprobar: tiene que decir 0 diferencias y salir con 0
rclone cryptcheck gdrive:Bamburu-backup/daily gdrive_cif:daily; echo "rc=$?"
rclone cryptcheck gdrive_gili:Bamburu-backup-gili/daily gdrive_gili_cif:daily; echo "rc=$?"

# 3) SOLO si el paso 2 salió 0 en las DOS — primero en simulacro
rclone delete gdrive:Bamburu-backup/daily/ --dry-run
rclone delete gdrive:Bamburu-backup/daily/
rclone delete gdrive_gili:Bamburu-backup-gili/daily/ --dry-run
rclone delete gdrive_gili:Bamburu-backup-gili/daily/
```

**Esto no choca con «nunca destruir datos»:** no es una destrucción, es un traslado. Los mismos
objetos siguen existiendo, en la misma cuenta, verificados uno a uno por `cryptcheck` como idénticos,
dentro del contenedor cifrado. **Si `cryptcheck` no da 0 en las dos cuentas, el paso 3 no se ejecuta:
se para y se pregunta.**


---

# Segunda copia (S6) — cuenta `gilibrahin@gmail.com`

> **ESTADO: PREPARADA, NO INSTALADA.** Falta un único paso, y es manual: autorizar rclone
> con la segunda cuenta. Hasta que exista el remote `gdrive_gili`, nada de esto está activo
> y el sistema se comporta exactamente como antes.

## Por qué una sola pieza y no dos scripts

`scripts/bamburu-backup.sh` sirve a **las dos copias**. Sin variables de entorno se comporta
igual que siempre (copia principal); la unit de la secundaria sobreescribe cuatro variables:

| Variable | Principal (por defecto) | Secundaria |
|---|---|---|
| `BACKUP_REMOTE` | `gdrive_cif:daily` | `gdrive_gili_cif:daily` |
| `BACKUP_LABEL` | `principal` | `secundaria` |
| `BACKUP_SUFFIX` | *(vacío)* → `last-success` | `-secondary` → `last-success-secondary` |
| `BACKUP_HC_URL` | hereda `HEALTHCHECKS_URL` | **vacío a propósito** |

Se parametriza en vez de duplicar porque dos copias de las mismas reglas se separan en cuanto
alguien arregla una sola.

**`BACKUP_HC_URL` vacío no es un olvido:** si la secundaria pingease el mismo check de
healthchecks.io que la principal, una principal caída seguiría viéndose verde en el monitor
externo. El dead-man's-switch se queda en la principal; la secundaria la vigila el heartbeat.

## Avisos: una caída avisa, dos son críticas

`bamburu-backup-heartbeat` mira **cada copia por separado**:

- **una caída (+48 h)** → email de AVISO: sigue habiendo respaldo, pero se perdió la redundancia.
- **las dos** → email CRÍTICO: ahora mismo no hay respaldo.

Vigilar solo «que fallen las dos» reintroduciría el fallo silencioso que costó el cambio desde
Backblaze: una secundaria rota un mes, con la principal en verde, no avisaría a nadie.

La secundaria **solo se vigila si su timer está instalado** (`/etc/systemd/system/bamburu-backup-secondary.timer`).
Antes de terminar S6 no existe, así que no genera falsas alarmas.

## Paso que falta (lo tiene que hacer Ibrahin)

rclone habla con Google Drive por **OAuth2**. Las contraseñas de aplicación de Google **no
sirven** aquí: son para IMAP/SMTP. Y el servidor no tiene navegador, así que va el flujo *headless*:

```bash
# 1) EN EL SERVIDOR
rclone config
#    n) New remote  →  name: gdrive_gili  →  storage: drive
#    client_id / client_secret: EN BLANCO   →  scope: 1 (drive)
#    "Use web browser to automatically authenticate?"  →  N
#    imprime un comando:  rclone authorize "drive" "…"

# 2) EN EL MAC/PC, con sesión abierta en gilibrahin@gmail.com
rclone authorize "drive" "…"      # el comando que imprimió el servidor
#    autorizar en el navegador y copiar el token

# 3) VOLVER AL SERVIDOR y pegar el token
```

El token queda en `~/.config/rclone/rclone.conf` (modo 600). Comprobar después:

```bash
rclone about gdrive_gili:                  # debe responder con la cuota de esa cuenta
rclone mkdir gdrive_gili:Bamburu-backup-gili/daily
```

## Instalación (después de tener el remote)

```bash
cd /home/ubuntu/bamburu
sudo cp deploy/systemd/bamburu-backup-secondary.service /etc/systemd/system/
sudo cp deploy/systemd/bamburu-backup-secondary.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bamburu-backup-secondary.timer

# Primera ejecución a mano, para no esperar a las 03:35:
sudo systemctl start bamburu-backup-secondary.service
journalctl -u bamburu-backup-secondary -n 60 --no-pager
rclone ls gdrive_gili_cif:daily/                    # a través de la clave
rclone lsf gdrive_gili:Bamburu-backup-gili-cif/ -R  # sin la clave: nombres ilegibles
```

## Horario

Principal 03:31 · secundaria 03:35 · heartbeat 09:03. La principal lleva
`RandomizedDelaySec=300`, así que puede arrancar hasta las 03:36 y solaparse con la secundaria.
No rompe nada —cada copia usa su propio temporal, su propia marca y su propia cuenta— pero si se
quiere orden garantizado, subir la secundaria a las **03:45** (la principal tarda ~3,5 min medidos).

## Orquestador de tareas (`bamburu-orchestrator`) — ESCRITA, NO INSTALADA

No es un proceso del producto: es un proceso del **desarrollo**. Da vueltas cada minuto,
mira si hay saldo, y si lo hay coge la `## SIGUIENTE TAREA` del TABLERO y la construye
entera —arquitecto, programador, revisión— lanzando `claude -p` en cada paso. Si aprueba,
marca la tarea HECHA y lo confirma. Sin saldo se pausa y mira cada 5 min hasta que vuelve.

**Autorización.** El aviso del principio de esta página dice que nada automático se instala
sin permiso expreso de Ibrahin. Esta unit existe porque él la encargó el 31 ago 2026. Queda
escrita y **sin instalar** hasta que él lo diga.

**Lo que hay que entender antes de instalarla.** Comentada dentro del fichero hay una línea
con `--dangerously-skip-permissions`. Sin ella el daemon arranca pero cada despacho se cuelga
pidiendo permisos que nadie contesta. Con ella, un agente escribe y **confirma en `master`**
sin que nadie lo mire. Nunca hace push, TABLERO.md se copia antes de tocarlo y una tarea que
falla 3 veces se aparca sola, pero el resto queda a criterio del agente.

    sudo cp deploy/systemd/bamburu-orchestrator.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now bamburu-orchestrator.service
    journalctl -u bamburu-orchestrator -f          # verlo trabajar
    sudo systemctl stop bamburu-orchestrator       # parada limpia (SIGTERM)

    npm run orchestrate:daemon                     # lo mismo, a mano
    npm run orchestrate:once                       # una sola tarea, con pausas manuales
