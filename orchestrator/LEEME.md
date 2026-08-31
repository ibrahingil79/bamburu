# Orquestador de Bamburu

Ejecuta tareas del tablero de punta a punta: **arquitecto → programador → revisor → cierre**,
sin intervención humana, cuidando la cuota que comparte con el chat de Ibrahin.

## Arrancar y parar

```bash
node orchestrator/orq.js arrancar      # arranca (retoma donde quedó)
node orchestrator/orq.js estado        # en qué anda ahora mismo
node orchestrator/orq.js parar         # parada BUENA: termina el paso y no coge otra tarea
node orchestrator/orq.js parar-ya      # EMERGENCIA: corta lo que esté haciendo
node orchestrator/orq.js historial     # qué se hizo, con su consumo de cuota
node orchestrator/orq.js parte         # fuerza el parte ahora
node orchestrator/orq.js una-vuelta    # una vuelta y fuera (para probar)
```

Como servicio: `deploy/systemd/orquestador.service` (instrucciones dentro del fichero).

## Pruebas

```bash
node --test orchestrator/pruebas/*.test.js
```

50 pruebas. No gastan cuota: usan un repo de usar y tirar y un modelo falso.

## Las piezas

```
roles/                 los tres papeles, en markdown versionado ← el corazón
  arquitecto.md          diagnostica, compara, planifica y ESCRIBE LOS CRITERIOS
  programador.md         construye solo lo del análisis, prueba y commitea
  revisor.md             juzga contra los criterios y contra el nivel

nucleo/
  maquina.js           decide QUÉ TOCA. Función PURA: sin disco, sin red, sin reloj
  almacen.js           journal append-only + instantánea atómica
  errores.js           la taxonomía: sin cuota ≠ sin respuesta ≠ permisos ≠ disco
  config.js            carga y VALIDA la configuración
  registro.js          los logs

cuota/
  usage.js             interpreta /usage. Pura
  vigilante.js         cuánta queda, con caché

ejecucion/
  cli.js               la ÚNICA puerta a `claude -p`
  papeles.js           compone los prompts desde roles/*.md

validacion/validador.js  criterios obligatorios, veredicto con motivos cerrados
cierre/                  registro de tarea, tablero, commit y subida
vigia/                   el parte de Telegram, con guarda-y-reenvía
ciclo.js                 el ejecutor: traduce decisiones en acciones
bucle.js                 el daemon
orq.js                   la línea de comandos
```

## Configuración

Todo en `orquestador.config.json`. Nada de umbrales en el código. Se puede sobreescribir por
entorno (`ORQUESTADOR_MIN_CICLO_PCT`, `ORQUESTADOR_MARGEN_PCT`, `ORQUESTADOR_RAIZ`…) o con un
fichero propio en `ORQUESTADOR_CONFIG`.

Los dos umbrales que importan:

| Umbral | Por defecto | Qué hace |
|---|---|---|
| `minimoParaCicloPct` | 25 | No empieza una tarea si no queda esto para el ciclo entero |
| `margenReservadoPct` | 20 | **Nunca toca este trozo de la ventana**: es el de Ibrahin |

## Encender el vigía de Telegram

**La clave la saca Ibrahin.** El código está entero y funcionando; solo faltan dos variables.

1. Habla con `@BotFather` en Telegram → `/newbot` → te da un token.
2. Escríbele al bot y saca tu chat id:
   `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | grep -o '"id":[0-9-]*' | head -1`
3. Crea `/etc/orquestador.env` con permisos `600`:
   ```
   ORQUESTADOR_TELEGRAM_TOKEN=123456:AA...
   ORQUESTADOR_TELEGRAM_CHAT_ID=987654321
   ```
4. `sudo systemctl restart orquestador`

**Mientras tanto el ciclo funciona igual.** Los partes se guardan en
`.orquestador/partes-pendientes.ndjson` y se mandan en cuanto se configure.

El bot **solo escribe**: no escucha, no tiene comandos y no puede recibir órdenes. Es deliberado.

## Qué hace cuando algo va mal

| Situación | Qué hace |
|---|---|
| Fallo técnico (vacío, permisos, timeout) | Reintenta el mismo paso hasta 3 veces |
| El revisor rechaza | Vuelve al programador con el motivo. Hasta 3 veces |
| 3 rechazos | **Replanteo**: el arquitecto rehace el plan con el historial |
| Replanteo y sigue fallando | **Aparta** la tarea, avisa a Ibrahin y sigue con la siguiente |
| Sin cuota | Espera. El paso NO se pierde: se retoma donde estaba |
| Error que no reconoce | Lo trata como falta de cuota: espera. Nunca lo da por definitivo |
| Subida fallida | Registra, avisa, sigue. Reintenta en la tarea siguiente |
| Conflicto en GitHub | **Para de subir y avisa.** No lo resuelve solo, nunca fuerza |
| Telegram caído | El ciclo sigue. El parte se guarda y se manda luego |
| Corte de luz | Al arrancar retoma desde el último paso guardado |

## Lo que NO hace

- No elige tareas: eso lo decide el tablero.
- No sube nada que el revisor no haya aprobado.
- No fuerza nada sobre GitHub.
- No recibe órdenes por Telegram.
- No reescribe `TABLERO.md` si la tarea está en prosa (ver `docs/orquestador/paso-0-diagnostico.md` §2).
