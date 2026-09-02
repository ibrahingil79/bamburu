# Manifiesto de huellas del histórico de copias

- **id:** `manifiesto-huellas-backups`
- **cerrada:** 2026-09-02
- **resultado:** ✅ APROBADA
- **intentos:** 4 (3 rechazados)
- **replanteamientos:** 1

> ⚠️ **CERRADA A MANO, NO POR EL ORQUESTADOR — y conviene no releerlo mal dentro de seis meses.**
> El orquestador se quedó `PARADO esperando cuota` con la tarea en `paso: REVISION`, `intento 1`
> (`.orquestador/estado.json`). Ibrahin pidió cerrarla sin esperar al reinicio de cuota, así que la
> revisión del intento 4 (`920ec83`) la hizo Claude Code en sesión interactiva, contra los tres
> motivos del rechazo anterior y los ocho criterios congelados del arquitecto.
> **La ficha del tablero NO tenía criterios propios**: es una de las 35 conservadas literales del
> 2 sep, así que manda la pregunta obligatoria del revisor —*¿arregla lo que la tarea decía que
> estaba roto?*— más la lista del arquitecto.

## La pregunta obligatoria

**¿Arregla lo que la tarea decía que estaba roto?** Sí. La entrada decía: *«hoy solo se verifica la
copia del día: una copia de hace cinco días se puede editar y nadie vuelve a mirarla nunca»*, y pedía
**SHA-256 por copia, guardado aparte, comprobado en cada pasada**. Eso existe:
`scripts/lib/manifiesto-copias.mjs` mantiene un manifiesto encadenado (`prev`/`hash`) en
`~/.local/state/bamburu-backup/manifiesto$SUFFIX.jsonl`, en `600`, fuera del destino que vigila —que
es la parte que importa: una huella que viva junto al fichero no prueba nada—, y el ancla viaja en el
correo diario, a un buzón que el servidor no puede tocar.

## Los tres motivos del rechazo del intento 3, uno por uno

| # | Motivo | ¿Cerrado? | Prueba |
|---|--------|-----------|--------|
| 1 | «El destino cambió y el histórico se quedó atrás» salía por la misma boca que «alguien borró tus copias»: `¿borrado?`, `exit 1`, retención saltada, ~13 noches seguidas | **SÍ** | Casilla 3 (`manifiesto-copias.mjs:620-638`): se compara **donde está**, línea propia con nombres, sin `¿borrado?`, sin alarma salvo manipulación real allí, y se apaga sola fuera de la ventana. Gate: `(i-2) la salida NO contiene "¿borrado?"`, `(i-3) la retención SÍ se ejecuta en el destino nuevo` |
| 2 | «El mismo mundo» se decidía por la configuración, así que un `BACKUP_REMOTE` distinto en claro y la clave rotada caían en el mismo agujero | **SÍ** | `mismoMundoQueRegistro()` ya no existe. La casilla se decide por **dos sitios reales**: `normBase(registro.destino.base) === baseHoy && registro.destino.ruta === hoy.ruta` (`:569-571`). Gate: escenario 6 completo, `(j-2) clave rotada · 0 alarmas · NO dice "¿borrado?"` |
| 3 | El README prometía por escrito lo contrario de lo medido, y no había caso de prueba que lo cazara | **SÍ** | `deploy/systemd/README.md:156-186`: la frase falsa **tachada con motivo y fecha** (no borrada, regla del repo) y los tres caminos descritos, con su «lo que NO cubre». Casos nuevos `(i)` = escenario 5 y `(j)` = escenario 6 |

**Las cinco observaciones del intento 3 quedan cerradas también**, incluida la 4 —que la excepción de
continuidad tuviera su ✓—: sale en verde y en rojo (`(continuidad) alterar esa BD tras la vuelta sale
1`). La 1 (`comprobados` contaba lo no comprobado) se cierra porque la casilla 2 ya no suma
`comprobados`; la 2, porque `cmdEstado` imprime `reanclados/rezagados/sin_vigilar` con `?? 0`; la 3,
porque el re-anclaje hacia cifrado conserva `registro.sha256`; la 5 (carryover), porque el heartbeat
lee el `ts` de dentro del estado (`bamburu-backup-heartbeat.sh:109-112`), el gate entra en el barrido
(`gates-mapa.mjs:291`) y `codificarRutas` maneja el remote sin subruta.

## Un defecto que traía el propio intento 4, arreglado antes de cerrar

`920ec83` introdujo **dos bytes NUL literales** en `manifiesto-copias.mjs:635` y `:645`, en las claves
compuestas de dos `Map`. Medido: **0** NUL en `6dff180`, **2** en `920ec83`; **único fichero fuente
del repo** con NUL. Efecto: `file` lo declaraba «binary data» y **`grep` sin `-a` devolvía CERO sobre
el fichero entero** (`grep -c "console.log"` → 0 · `grep -ac` → 1).

No rompía nada funcional —el `\0` como separador de clave es técnica válida— y **no cegaba al portero
del orquestador**, que lee el diff en JS (`orchestrator/validator.js:14` sobre `lineasAnadidas`), no
por shell. Pero cegaba a cualquier persona o agente que hiciera `grep` sobre un fichero de **producto
que corre cada noche**. Es *«un censo que dice CERO y no es cierto es peor que no tenerlo, porque
cierra la pregunta»* de `CLAUDE.md`, y se pisó de verdad: el primer `grep` de esta revisión devolvió
silencio y estuvo a un paso de leerse como «limpio».

Arreglado escribiendo el escape `\0` en vez del byte crudo. Equivalencia comprobada:
`` `a\0b` ``.charCodeAt(1) === 0 y `=== "a"+String.fromCharCode(0)+"b"` → true; `node --check` OK; el
diff son exactamente esos dos sitios y nada más.

## Gate

Ejecutado **una vez**, con autorización expresa de Ibrahin (`RITUAL.md:13` prohíbe correr el gate de
la propia tarea por iniciativa propia), **después** del arreglo del NUL:

```
node scripts/test-manifiesto-copias.mjs   →   114 OK · 0 fallos · exit 0
```

Ejecuta `scripts/bamburu-backup.sh` real contra remotes locales (nunca `gdrive:`), en claro y en
cifrado.

## Historial de intentos

| Intento | Veredicto | Motivo |
|---------|-----------|--------|
| 1 | rechazado | 21 líneas añadidas con restos (`console.log` en `manifiesto-copias.mjs`) |
| 2 | rechazado | [NIVEL-INSUFICIENTE] confundía «cambió el mundo del destino» con «manipularon el histórico», y dejaba de vigilar mientras gritaba |
| 3 | rechazado | [NIVEL-INSUFICIENTE] «el destino cambió y el histórico se quedó atrás» salía como «¿borrado?», y el README prometía lo contrario |
| 4 | **aprobado** | los tres motivos cerrados; un defecto propio (2 bytes NUL) arreglado antes del cierre |

## Artefactos

- Análisis: `docs/architecture/task-manifiesto-huellas-backups-analysis.md`
- Replanteamiento: `docs/architecture/task-manifiesto-huellas-backups-analysis-replanteo-0.md`
- Revisión (intento 2): `docs/architecture/task-manifiesto-huellas-backups-review-intento-2.md`
- Revisión (intento 3): `docs/architecture/task-manifiesto-huellas-backups-review-replanteo-0.md`
- Feedback: `docs/architecture/task-manifiesto-huellas-backups-feedback.md`

## Commits

- `66c9ab7` Manifiesto encadenado de huellas para el histórico de copias de seguridad
- `21356b8` Quita `console.log(` de `manifiesto-copias.mjs` y su test
- `6dff180` El manifiesto re-ancla, no compara, cuando el destino cambia de mundo
- `920ec83` El manifiesto mira dos sitios (hoy y el registro), no clasifica un mundo
- *(el commit de este cierre)* el arreglo de los 2 bytes NUL + tablero + registro

## Consumo de cuota

Del ledger del orquestador (`.orquestador/estado.json`), los cuatro intentos:

| Papel | Llamadas | Coste |
|-------|----------|-------|
| arquitecto | 4 | 7,54 $ |
| programador | 4 | 13,37 $ |
| revisor | 3 | 8,87 $ |
| **total** | **11** | **29,78 $** |

Cuota de sesión al coger la tarea: 8 % gastado.

## Lo que NO cubre, y no es descuido

El manifiesto vive en este servidor, así que quien lo controle puede reescribirlo entero: el ancla del
correo defiende contra **la cuenta de Drive comprometida** —el vector que cerraba esta tarea—, no
contra el servidor comprometido. Y una ventana real: un borrado hecho la MISMA noche en que el
destino cambia, si además desaparece el remote anterior, sale como «sin vigilar», no como «borrado».
