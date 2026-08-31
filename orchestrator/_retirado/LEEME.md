# Piezas retiradas del orquestador anterior

Retiradas el 31 ago 2026 al construir el orquestador nuevo. **No se borran**: se guardan aquí
para poder reconstruir qué había y por qué se cambió. El motivo de cada una está en
`docs/orquestador/paso-0-diagnostico.md` §1.

| Fichero | Por qué se retiró | Qué lo sustituye |
|---|---|---|
| `daemon.js` | Su estado vivía en memoria (`Map` de intentos y atascadas): un reinicio lo perdía entero, y systemd reinicia | `bucle.js` + `nucleo/almacen.js` |
| `index.js` | Recorrido lineal sin estado: si moría en el paso 6, al volver empezaba por el 1 y repetía el análisis | `orq.js` + `ciclo.js` + `nucleo/maquina.js` |
| `dispatcher.js` | Hacía tres cosas a la vez (registro, invocación y prompts), y su invocación usaba salida de TEXTO, así que no podía leer `permission_denials` | `nucleo/registro.js` + `ejecucion/cli.js` + `ejecucion/papeles.js` + `roles/*.md` |
| `token-monitor.js` | Su sonda gastaba cuota para preguntar por la cuota, y solo respondía sí/no: no podía decir «me queda un 12 %, no me da para un ciclo» | `cuota/vigilante.js` + `cuota/usage.js` |
| `updater.js` | Su prudencia con el tablero en prosa era correcta y se ha conservado; le faltaba todo el cierre nuevo (registro de tarea, commit y subida) | `cierre/cierre.js` |

**Lo que NO se retiró y se sigue usando tal cual:** `reader.js` (parser del tablero y helpers de
git) y `validator.js` (la validación de commits, que `validacion/validador.js` importa y amplía).

## `bamburu-orchestrator.service`

Retirada el 31 ago 2026 junto con `index.js`. Su `ExecStart` apuntaba a
`orchestrator/index.js --daemon`, que ya no existe: **arrancarla habría fallado**. Nunca llegó a
instalarse. La sustituye `deploy/systemd/orquestador.service`.
