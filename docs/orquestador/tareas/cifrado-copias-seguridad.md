# Cifrar las copias de seguridad

- **id:** `cifrado-copias-seguridad`
- **cerrada:** 2026-09-01
- **resultado:** ✅ APROBADA
- **intentos:** 2
- **replanteamientos:** 0

## Criterios de aceptación

- [x] **Hoy sigue habiendo copia.** Sin fichero de destinos y con `BACKUP_REMOTE` apuntando a un
- [x] **La pasada cifrada completa funciona.** Con el fichero de destinos apuntando a un `crypt` de
- [x] **Las dos verificaciones fallan duro, y se demuestra rompiéndolas.** En el mundo cifrado:
- [x] **El guion hace los cinco pasos en orden.** `bash scripts/cifrar-copias-de-seguridad.sh` con
- [x] **Si no descifra, no cambia el destino.** Rompiendo el ensayo del paso 6 (por ejemplo, dejando
- [x] **El cerrojo no puede adelantarse a la llave.** Con el fichero de destinos apuntando a un remote
- [x] **La copia se abre partiendo solo de la llave.** `scripts/ensayo-restauracion-cifrada.sh`, con
- [x] **Papeles y llave.** Buscando en `deploy/systemd/README.md`, `docs/seguridad/vectores-de-ataque.md`,

## Historial de intentos

| Intento | Veredicto | Motivos |
|---------|-----------|---------|
| 1 | rechazado | [FUERA-DE-ALCANCE] Quedan dos afirmaciones falsas en `deploy/systemd/README.md`, y el plano mandaba cazarlas — **Dónde:** `deploy/systemd/README.md:402` y `deploy/systemd/README.md:466-467` **Qué pasa |
| 2 | aprobado | — |

## Artefactos

- Análisis: `docs/architecture/task-cifrado-copias-seguridad-analysis.md`
- Revisión: `docs/architecture/task-cifrado-copias-seguridad-review.md`

## Commits

- `2b392d9` El README ya no invita a repetir la avería: BACKUP_REMOTE dice la verdad

## Consumo de cuota

- Al empezar: 1% de sesión usado
- Al cerrar: 88% de sesión usado
- Diferencia: 87 puntos
