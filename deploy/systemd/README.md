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
| `bamburu-avisos` | Resumen diario de avisos por email (08:00 Europe/Madrid) | `scripts/bamburu-avisos.mjs` |
| `bamburu-recordatorios-cita` | Recordatorio de citas por email, el día antes (09:00 Europe/Madrid) | `scripts/bamburu-recordatorios-cita.mjs` |
| `bamburu-caducar-reservas` | Caduca las solicitudes de cita por Internet sin responder y **libera el hueco** (cada hora) | abajo |
| `bamburu-propuestas` | Genera las **Propuestas de DISA** del día (07:45 Europe/Madrid) | abajo |
| `bamburu-verifactu-cola` | **Red de seguridad** de la cola de envío a la AEAT (cada 2 min) | `docs/verifactu/tarea2-cola-envio-automatico.md` |

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
