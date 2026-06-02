# Copia automática de las BD a Backblaze B2

Restaura la copia automática de los datos a Backblaze (B2) que se perdió al
migrar desde Oracle.

## Qué hace

- Cada día genera un **snapshot consistente** de cada BD SQLite
  (`data/control.db`, `data/bamburu.db` y `data/tenants/*.db`) usando la
  *SQLite Online Backup API* (helper `scripts/db-snapshot.mjs`, vía
  `better-sqlite3`, equivalente a `sqlite3 <db> ".backup '<dst>'"`). Nunca se
  copia el `.db` en crudo, así no hay copias rotas por el WAL.
- Sube cada snapshot a B2 con nombre fechado:
  `Bamburu-backup/daily/<bd>-AAAA-MM-DD.db`.
- **Retención de 14 días**: borra los snapshots más viejos. Una BD corrupta
  nunca pisa la única copia buena.
- Corre desde un **systemd timer** diario (no cron), como `User=ibrahin`, y
  escribe al journal (visible en Cockpit / `journalctl`).

## Piezas

| Pieza | Ubicación | En el repo |
|-------|-----------|------------|
| Script de backup | `scripts/bamburu-backup.sh` | sí |
| Helper de snapshot | `scripts/db-snapshot.mjs` | sí |
| Unidad de servicio | `deploy/systemd/bamburu-backup.service` | sí |
| Unidad de timer | `deploy/systemd/bamburu-backup.timer` | sí |
| Binario rclone | `~/.local/bin/rclone` | no (instalado) |
| **Config rclone + credenciales B2** | `~/.config/rclone/rclone.conf` | **NO (secretos, fuera del repo)** |

## Instalación (requiere sudo)

```bash
cd /home/ibrahin/bamburu
sudo cp deploy/systemd/bamburu-backup.service /etc/systemd/system/
sudo cp deploy/systemd/bamburu-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bamburu-backup.timer
```

## Comprobaciones

```bash
# Próxima ejecución del timer
systemctl list-timers bamburu-backup.timer

# Ejecutar la copia a mano
sudo systemctl start bamburu-backup.service

# Logs en el journal (también visibles en Cockpit)
journalctl -u bamburu-backup.service -n 50

# Ver snapshots en B2
~/.local/bin/rclone ls backblaze:Bamburu-backup/daily/
```

## Restauración

```bash
# Descargar el snapshot más reciente de un tenant
~/.local/bin/rclone copy \
  backblaze:Bamburu-backup/daily/desarrollo-bamburu-AAAA-MM-DD.db /tmp/restore/

# El .db descargado ya es autocontenido: colócalo en data/tenants/ con el
# nombre que espera la app (p. ej. desarrollo-bamburu.db) con el servicio
# parado.
```
