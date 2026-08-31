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
| `orquestador` | **NO INSTALADA.** Construye sola la SIGUIENTE TAREA del TABLERO (arquitecto → programador → revisor) | `orquestador.service` y `orchestrator/LEEME.md` |

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
- Sube cada artefacto a Drive con nombre fechado:
  `Bamburu-backup/daily/<nombre>-AAAA-MM-DD.db` y `uploads-AAAA-MM-DD.tar.gz`.
- **Verifica la subida de verdad**: compara tamaño + MD5 del archivo YA en Drive con el local.
- **Prueba de restore real**: descarga cada artefacto de vuelta y comprueba que abre
  (`sqlite3 PRAGMA integrity_check == ok`; el tar con `tar -tzf`).
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
| **Config rclone (token Google Drive)** | `~/.config/rclone/rclone.conf` | **NO (secreto, fuera del repo)** |
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
rclone ls gdrive:Bamburu-backup/daily/         # ver copias en Drive
```

## Restauración

```bash
# Descargar el snapshot más reciente de un tenant
rclone copy gdrive:Bamburu-backup/daily/desarrollo-bamburu-AAAA-MM-DD.db /tmp/restore/

# El .db descargado ya es autocontenido: con el servicio parado, colócalo en
# data/tenants/ con el nombre que espera la app (p. ej. desarrollo-bamburu.db).
# Las uploads:  tar -xzf uploads-AAAA-MM-DD.tar.gz -C data/   (recrea data/uploads)
```


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
| `BACKUP_REMOTE` | `gdrive:Bamburu-backup/daily` | `gdrive_gili:Bamburu-backup-gili/daily` |
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
rclone ls gdrive_gili:Bamburu-backup-gili/daily/
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
