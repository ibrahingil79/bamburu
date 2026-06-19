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
