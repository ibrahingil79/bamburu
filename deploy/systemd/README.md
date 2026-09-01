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
| `bamburu-anclaje-verifactu` | **NO INSTALADA.** Sella la cadena VERI\*FACTU con una TSA externa (RFC-3161), fuera del servidor (cada 15 min) | `docs/verifactu/anclaje-externo.md` |
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
- Sube cada artefacto a Drive con nombre fechado: `<nombre>-AAAA-MM-DD.db` y
  `uploads-AAAA-MM-DD.tar.gz`.
- **La copia funciona en DOS MODOS, y no elige ella: se lo dice un fichero de estado.**
  `~/.config/bamburu/backup-destinos.conf` (permisos `600`). **Si no existe**, el destino es el de
  siempre y las copias van **EN CLARO** — que es como van hoy. **Si existe**, el destino es un
  remote `crypt` y van **CIFRADAS**: contenido, nombre de fichero y nombre de carpeta. Ese fichero
  lo escribe una sola pieza, `scripts/cifrar-copias-de-seguridad.sh`, y solo **después** de haber
  subido, bajado y comparado byte a byte un fichero de prueba. Ver §«Cifrado de las copias».
- **Ese mismo fichero es el cerrojo.** Si existe y el destino **no** es `crypt`, la copia aborta
  antes de tocar nada (email de fallo + `exit 1`). Como el cerrojo nace en la **misma escritura**
  que nombra el destino cifrado, **nunca puede haber un momento en que el código exija cifrado y el
  cifrado no exista** — que es exactamente lo que pasó el 1 sep 2026.
  **El cerrojo es POR COPIA, no por fichero:** cada copia busca su propia línea
  `DESTINO_<etiqueta>` (`principal` / `secundaria`). Si esa línea falta o está malformada, esa copia
  —y solo esa— se va **en claro** sin abortar; es a propósito (más vale copia en claro que ninguna
  copia) y no queda en silencio, porque el correo de esa mañana dice `EN CLARO ⚠️`. El guion escribe
  las **dos** líneas: quien las edite a mano puede degradar una copia sin darse cuenta.
- **Verifica la subida de verdad, y sin rama blanda en ninguno de los dos modos**: compara el
  tamaño (`rclone size` sobre un `crypt` devuelve el tamaño **en claro**, así que sigue valiendo) y
  después la huella. Con destino `crypt`, `rclone cryptcheck`, que cifra el fichero local con el
  nonce del propio objeto de Drive y compara su MD5 real. Con destino normal, el MD5 de Drive
  **tiene que venir y coincidir**: si no viene, es un **fallo**, no un aviso.
- **Prueba de restore real**: descarga cada artefacto de vuelta, lo compara **BYTE A BYTE** con el
  original (`cmp`) y comprueba que abre (`sqlite3 PRAGMA integrity_check == ok`; el tar con
  `tar -tzf`). La comparación no sobra: `integrity_check` responde `ok` también a una base válida
  pero **distinta** — medido sustituyendo el fichero descargado por otra base real del mismo tamaño.
- **Dice en palabras en qué modo va**, cada día, en el log y en el asunto y el cuerpo del email:
  `Destino: <remote> — CIFRADO` o `Destino: <remote> — EN CLARO ⚠️`. Si un día el fichero de
  destinos desapareciera, el correo de esa misma mañana lo diría: el cifrado no se puede apagar
  en silencio.
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
| Guion de un solo uso que enciende el cifrado | `scripts/cifrar-copias-de-seguridad.sh` | sí |
| Ensayo de restauración partiendo solo de la llave | `scripts/ensayo-restauracion-cifrada.sh` | sí |
| **Config rclone (token Google Drive + CONTRASEÑA DE CIFRADO, cuando exista)** | `~/.config/rclone/rclone.conf` | **NO (secreto, fuera del repo)** |
| **Fichero de destinos** (el que decide claro/cifrado, y el cerrojo) | `~/.config/bamburu/backup-destinos.conf` (`600`) | **NO (estado de la máquina)** |
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

# ¿en qué modo van las copias hoy? (esto lo responde sin adivinar)
bash scripts/cifrar-copias-de-seguridad.sh     # si ya está puesto, solo informa: no genera nada
cat ~/.config/bamburu/backup-destinos.conf     # si NO existe -> las copias van EN CLARO

# EN CLARO (lo que corre hoy):
rclone ls gdrive:Bamburu-backup/daily/
rclone ls gdrive_gili:Bamburu-backup-gili/daily/

# CIFRADAS (solo después de ejecutar el guion de cifrado):
rclone ls  gdrive_cif:daily/                   # ver copias (A TRAVÉS de la clave)
rclone lsf gdrive:Bamburu-backup-cif/ -R       # lo mismo SIN la clave: nombres ilegibles
```

## Restauración

> **PRIMERO: ¿van cifradas o en claro?** No lo adivines, míralo — cambia todo lo demás:
> ```bash
> cat ~/.config/bamburu/backup-destinos.conf   # no existe -> EN CLARO · existe -> CIFRADAS
> ```
>
> ~~**HACE FALTA LA CONTRASEÑA DE CIFRADO.** … el campo `password` del remote `gdrive_cif`~~
> **⚙️ CORREGIDO EL 1 SEP 2026.** Se tacha en vez de borrarse, que es el método de este repo.
> Era falso: el remote `gdrive_cif` **nunca llegó a existir** y la contraseña **nunca se generó**,
> así que este párrafo mandaba buscar una llave inexistente **justo el día peor**. Hoy las copias
> van **EN CLARO** y para restaurarlas no hace falta ninguna contraseña.
>
> **Cuando estén cifradas** (es decir, cuando exista el fichero de destinos), entonces sí hace falta
> la llave y sin ella lo que hay en Drive es ruido. **Dónde está:** en
> `~ubuntu/.config/rclone/rclone.conf` de este servidor (campo `password` del remote `gdrive_cif`;
> se recupera con la receta de §«Custodiar la contraseña») **y**, para el día en que este servidor
> no exista, en la custodia de Ibrahin fuera del servidor. Si estás leyendo esto un día malo y el
> servidor no arranca, **la copia de Ibrahin es la que vale**.

```bash
# --- SI VAN EN CLARO (lo que corre hoy): no hace falta ninguna llave ---
rclone copy gdrive:Bamburu-backup/daily/desarrollo-bamburu-AAAA-MM-DD.db /tmp/restore/

# --- SI VAN CIFRADAS ---
# Desde ESTE servidor (usa el rclone.conf de producción, que ya tiene la clave)
rclone copy gdrive_cif:daily/desarrollo-bamburu-AAAA-MM-DD.db /tmp/restore/

# Desde CUALQUIER OTRA máquina, tecleando la contraseña custodiada:
export RCLONE_CONFIG=/tmp/restore.conf
rclone config create r_drive drive                       # autorizar la cuenta de Drive
rclone config create r_cif crypt remote=r_drive:Bamburu-backup-cif \
    password=<contraseña custodiada> password2=<sal custodiada> \
    filename_encryption=standard directory_name_encryption=true
rclone copy r_cif:daily/desarrollo-bamburu-AAAA-MM-DD.db /tmp/restore/

# Y para COMPROBAR, sin esperar al día malo, que la llave custodiada abre la copia:
# construye su propia config temporal y NO lee el rclone.conf de este servidor.
printf '%s\n%s\n' "<contraseña>" "<sal>" | \
  bash scripts/ensayo-restauracion-cifrada.sh --backend gdrive:Bamburu-backup-cif

# El .db descargado ya es autocontenido: con el servicio parado, colócalo en
# data/tenants/ con el nombre que espera la app (p. ej. desarrollo-bamburu.db).
# Las uploads:  tar -xzf uploads-AAAA-MM-DD.tar.gz -C data/   (recrea data/uploads)
```

## Cifrado de las copias

> ⚠️ **TODAVÍA NO ESTÁ ENCENDIDO — las copias van EN CLARO.** El mecanismo está **construido y
> probado** (1 sep 2026); lo que falta es **una orden**, y la tiene que dar Ibrahin porque hay que
> escribir en `~/.config/rclone`:
>
> ```bash
> bash scripts/cifrar-copias-de-seguridad.sh
> ```
>
> **Y mientras no la ejecute, no pasa nada malo:** las copias siguen saliendo cada noche, en claro,
> verificadas, y el correo diario dice **EN CLARO ⚠️** para que no se olvide. El vector 4 de
> `docs/seguridad/vectores-de-ataque.md` sigue **ABIERTO** hasta que se ejecute.
>
> ~~**REVERTIDO EL 1 SEP 2026:** el guardián duro se quitó porque los remotes `crypt` nunca se
> crearon y las dos copias habrían abortado.~~ Sigue siendo verdad lo que pasó, pero ya no describe
> el diseño: **ahora el cerrojo no puede adelantarse a la llave**, porque nace en la misma escritura
> que crea el destino cifrado. No hay ninguna ventana en la que el código exija algo que no existe.

> **Es la sección que cita el mensaje de fallo del script.** Si has llegado aquí desde un email
> «❌ Backup Bamburu FALLÓ … NO es un remote crypt», lo que pasa es que existe el fichero de
> destinos pero el remote que nombra no es cifrado. Se arregla ejecutando el guion de abajo, o
> —si hace falta volver a claro ya mismo— borrando `~/.config/bamburu/backup-destinos.conf`.

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

### Encenderlo: UNA orden (lo hace Ibrahin, requiere escribir en `~/.config/rclone`)

```bash
cd /home/ubuntu/bamburu
bash scripts/cifrar-copias-de-seguridad.sh
#   → GUARDA LA LLAVE QUE TE ENSEÑE, en el gestor de contraseñas, ANTES DE CERRAR LA TERMINAL
```

Sin `sudo`, sin instalar units, sin recargar systemd y sin tocar el script de la copia. En una
pasada, y **en este orden, que es el producto y no una recomendación**:

1. **Se niega a pisar.** Si los remotes ya son `crypt`, **no genera ninguna clave** (hacerlo dejaría
   ilegible todo lo ya subido): imprime el estado y sale. Es también la respuesta a *«¿esto está
   hecho?»*.
2. **Comprueba los prerrequisitos** antes de generar nada: que existen `gdrive` y `gdrive_gili`, y
   que el `rclone.conf` se puede escribir.
3. **Genera** la contraseña y la sal (`openssl rand`), **una sola para los dos destinos**.
4. **Crea los dos remotes `crypt`** sobre **raíces nuevas** (`Bamburu-backup-cif`,
   `Bamburu-backup-gili-cif`: lo cifrado y lo antiguo no comparten carpeta) y **los relee**.
   Esto último no es un detalle: `rclone config create` puede **imprimir la sección, devolver 0 y no
   haber escrito nada** (pasa si el `.conf` está en solo lectura — el error va a stderr y el código
   de salida sigue siendo 0; medido el 1 sep 2026). Además compara los dos `reveal` **en memoria**,
   porque `rclone obscure` **no es determinista**: dos ofuscados de la misma clave son distintos.
5. **Ensaya de verdad, por cuenta:** sube 300 KB aleatorios, **los baja**, los compara **byte a
   byte**, comprueba que en el destino crudo **no se lee el nombre**, y pasa `cryptcheck`. Borra el
   ensayo pase lo que pase.
6. **Si el ensayo falla en cualquier punto, deshace**: borra los remotes que había creado y sale con
   1. **No llega al paso 7**, así que el destino no cambia y esa noche la copia sale en claro y en
   verde. *Quedarse sin copia es peor que una noche más en claro* — decisión de Ibrahin, 1 sep 2026.
7. **Solo entonces** escribe `~/.config/bamburu/backup-destinos.conf` (atómico, `600`), que es lo
   que hace que las dos copias cambien de destino **con una sola escritura** y lo que enciende el
   cerrojo.
8. **Enseña la llave una vez por pantalla** y dice qué queda.

### Custodiar la contraseña — PARADA, y no es un trámite

Las copias existen para el día en que el servidor no esté. Si la única copia de la clave vive en el
servidor, ese día las copias son ruido. Antes de nada más, guardarla **fuera** (gestor de contraseñas
o papel en un cajón — cualquier sitio que sobreviva a que este servidor desaparezca):

El guion ya la enseña una vez al encender el cifrado, y ése es el momento de guardarla. Si hiciera
falta recuperarla después del `rclone.conf`:

~~```bash
rclone reveal "$(rclone config show gdrive_cif | awk -F'= ' '/^password =/{print $2}')"
```~~
**⚙️ CORREGIDO EL 1 SEP 2026 — esa receta NO FUNCIONA.** Se tacha en vez de borrarse.
`rclone config show` **enmascara** el campo (`password = *** ENCRYPTED ***`), así que ese `reveal`
falla con `base64 decode failed … is it obscured?`. Medido. La receta que existía para el día en
que hubiera que recuperar la llave estaba rota. **La que sí funciona** usa `rclone config dump`, que
no enmascara (verificado):

```bash
rclone config dump | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s).gdrive_cif; console.log(r.password); console.log(r.password2)})' \
  | while read -r o; do rclone reveal "$o"; done
```

### Ensayo antes de tocar nada vivo

El patrón de S6: comprobar la credencial **antes** de instalar, y la prueba borra lo que crea.
**Ya no hay que teclearlo**: es el paso 5 del guion, va solo, por cuenta, y si falla deshace.

Lo que hace por dentro, para poder leerlo sin ejecutarlo: siembra 300 KB aleatorios, `rclone copy`
al `crypt`, **lo baja y lo compara byte a byte**, comprueba que `rclone lsf` sobre la raíz **cruda**
no deja leer el nombre, y `rclone cryptcheck` con `0 differences found` y salida 0. Después,
`rclone purge` del ensayo en un `trap`, pase lo que pase.

Y para el otro ensayo —el que de verdad importa el día malo, abrir la copia **partiendo solo de la
llave custodiada**, sin el `rclone.conf` de este servidor—:

```bash
printf '%s\n%s\n' "<contraseña>" "<sal>" | \
  bash scripts/ensayo-restauracion-cifrada.sh --backend gdrive:Bamburu-backup-cif
```

### Migrar el histórico en claro — copiar → comprobar → y SOLO entonces retirar

**El orden no es negociable.** Y hay un motivo medido para no dejar que el histórico caduque solo:
cuando un fichero con nombre sin cifrar convive en el directorio de un remote `crypt`, rclone lo
**salta** (`Skipping undecryptable file name`) con código de salida 0 — tanto al listar como al
borrar. La retención de 14 días **no volvería a tocarlo nunca**: se quedaría ahí para siempre,
legible, mientras los correos dicen que todo va cifrado.

**Va en el guion, con el orden metido en código y no en prosa** — y **simulacro por defecto**, igual
que `scripts/limpiar-restos-de-gates.mjs`:

```bash
bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico            # simulacro: no borra nada
bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico --hazlo    # solo si el simulacro salió limpio
```

Por cuenta, y **si la primera falla no se toca la segunda**: cuenta `N` objetos en claro →
`rclone copy` → `cryptcheck --one-way` exigiendo salida 0 **y** `0 differences found` →
**recuento independiente** al otro lado (`>= N` legibles a través de la llave) → `delete --dry-run`
y lo imprime → y **solo con `--hazlo`, y solo si todo lo anterior pasó**, borra y exige que queden
**0**. Si algo falla: **no borra**, sale con 1 y lo dice.

> El `--one-way` no es cosmético: cuando esto se ejecuta, el destino cifrado **ya tiene** las copias
> de las noches anteriores, y sin él esas sobrantes cuentan como diferencia y la migración no
> pasaría nunca. Medido: 23 `errors while checking` por ese motivo exacto.

**Esto no choca con «nunca destruir datos»:** no es una destrucción, es un traslado. Los mismos
objetos siguen existiendo, en la misma cuenta, verificados uno a uno por `cryptcheck` como idénticos,
dentro del contenedor cifrado. **Si `cryptcheck` no da 0 en las dos cuentas, el paso 3 no se ejecuta:
se para y se pregunta.**


---

# Segunda copia (S6) — cuenta `gilibrahin@gmail.com`

> ~~**ESTADO: PREPARADA, NO INSTALADA.** Falta un único paso, y es manual: autorizar rclone
> con la segunda cuenta. Hasta que exista el remote `gdrive_gili`, nada de esto está activo
> y el sistema se comporta exactamente como antes.~~
>
> **⚙️ CORREGIDO EL 1 SEP 2026 — S6 ESTÁ INSTALADA Y ACTIVA.** Se tacha en vez de borrarse, que es
> el método de este repo. Medido hoy: `rclone listremotes` devuelve `gdrive:` y `gdrive_gili:`;
> `/etc/systemd/system/bamburu-backup-secondary.{service,timer}` están instalados; y
> `systemctl list-timers` dice que la secundaria corrió **hoy a las 03:35** y vuelve mañana.
> **Lo que sigue en esta sección es historia útil: el «paso que falta» ya se dio.**

## Por qué una sola pieza y no dos scripts

`scripts/bamburu-backup.sh` sirve a **las dos copias**. Sin variables de entorno se comporta
igual que siempre (copia principal); la unit de la secundaria sobreescribe cuatro variables:

| Variable | Principal (por defecto) | Secundaria |
|---|---|---|
| `BACKUP_REMOTE` | *(no se pone)* → `gdrive:Bamburu-backup/daily` | `gdrive_gili:Bamburu-backup-gili/daily` |
| `BACKUP_LABEL` | `principal` | `secundaria` |
| `BACKUP_SUFFIX` | *(vacío)* → `last-success` | `-secondary` → `last-success-secondary` |
| `BACKUP_HC_URL` | hereda `HEALTHCHECKS_URL` | **vacío a propósito** |

**Y `BACKUP_REMOTE` no es quien manda.** Si existe `~/.config/bamburu/backup-destinos.conf`, manda
**ese fichero** y `BACKUP_REMOTE` se ignora (`scripts/bamburu-backup.sh:57-64`) — que es justo lo
que permite cambiar **las dos** copias al destino cifrado con una sola escritura, sin `sudo` y sin
tocar ninguna unit. Ver §«Qué hace, cada día», el punto de los **DOS MODOS**.

> ~~Esta tabla decía `gdrive_cif:daily` / `gdrive_gili_cif:daily`.~~ **⚙️ CORREGIDO EL 1 SEP 2026:
> las dos celdas eran falsas** —restos del intento de cifrado que Ibrahin revirtió (`6bd067f`)— y
> **peligrosas**: esos dos remotes no existen, y quien las copiara a una unit dejaría las copias
> yendo cada noche contra un destino inexistente. Se tacha en vez de borrarse, que es el método de
> este repo. Los valores de arriba son los medidos hoy en `scripts/bamburu-backup.sh:64` y en
> `deploy/systemd/bamburu-backup-secondary.service:15`.

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

# EN CLARO (lo que corre hoy):
rclone ls gdrive_gili:Bamburu-backup-gili/daily/

# CIFRADAS (solo después de ejecutar el guion de cifrado):
rclone ls  gdrive_gili_cif:daily/                    # a través de la clave
rclone lsf gdrive_gili:Bamburu-backup-gili-cif/ -R   # sin la clave: nombres ilegibles
```

> ~~Aquí solo estaban las dos órdenes cifradas, sin condición.~~ **⚙️ CORREGIDO EL 1 SEP 2026:** ese
> remote y esa carpeta **no existen** todavía, así que quien siguiera el bloque se llevaba un error
> el día de la instalación. Se separa en los dos estados, igual que §«Comprobaciones».

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
