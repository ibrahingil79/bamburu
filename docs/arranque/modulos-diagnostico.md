# Arranque de Bamburu con un módulo caído — diagnóstico (Paso 0)

> **Tarea `arranque-no-tolera-modulo-ausente`** (BLOQUE 2 · AUD-007). Escrito el 3 sep 2026 **antes
> de tocar una línea de código**. Todo lo de aquí está MEDIDO —journal de la máquina, ejecución del
> cargador real, `systemctl show`, `curl`— y donde no se ha podido medir se dice.

---

## 1. Qué carga Bamburu al arrancar, y por qué vía

`modules/` tiene **seis** módulos, y **no se cargan todos igual**. Esa diferencia es el centro de
todo lo que sigue.

| Módulo | Cómo entra | Qué pasa HOY si falla al cargar |
|---|---|---|
| `erp` | `core/loader.js`, `import()` dinámico dentro de un `try` | **Se traga el error.** Aviso en consola y **Bamburu sigue arrancando sin panel de administración** |
| `store` | ídem | ídem |
| `disa` | ídem | ídem |
| `portal` | ídem | ídem |
| `registro` | `import` estático en `index.js:14` | **El proceso muere.** Node no llega ni a ejecutar `index.js` |
| `superadmin` | `import` estático en `index.js:15` | ídem |

**Los dos últimos ya se comportan como pide la ficha**, no por diseño sino porque un `import`
estático que falla mata el proceso antes de empezar. Los cuatro primeros son el problema.

### El cargador entero, que son doce líneas

```js
for (const mod of MODULE_ORDER) {
  try {
    const { register } = await import(join(modulesDir, mod, 'index.js'));
    if (typeof register === 'function') { register(app, db); console.log('✅ Módulo cargado: ' + mod); }
  } catch (e) { console.warn('⚠️ Módulo ' + mod + ' error: ' + e.message); }
}
```

---

## 2. Qué pasa exactamente hoy, medido con el cargador real

Se ejecutó **el `core/loader.js` de verdad** contra cuatro módulos de mentira (uno que revienta al
importar, uno sin `register`, uno que revienta dentro de `register`, y uno bueno). Resultado:

| Forma de fallar | Qué se imprime | ¿Sigue vivo el proceso? | Código de salida |
|---|---|---|---|
| Revienta **al importar** (sintaxis, dependencia que falta) | `⚠️ Módulo X error: <mensaje>` | **Sí** | 0 |
| Revienta **dentro de `register`** | `⚠️ Módulo X error: <mensaje>` | **Sí** | 0 |
| **No exporta `register`** | **NADA. Ni una línea.** | **Sí** | 0 |

**El tercer caso no está en la ficha y es el peor de los tres:** el `if (typeof register === 'function')`
no tiene `else`, así que un módulo sin su exportación **no se monta y no se dice**. No hay aviso que
buscar en el journal: no existe.

**Y en los tres casos el código de salida es 0**, así que `Restart=on-failure` de systemd **no ve
nada que reintentar**. Para systemd el arranque fue un éxito.

**Qué queda escrito, y dónde:** una línea de `console.warn` en el journal (`SyslogIdentifier=bamburu`),
con `e.message` **y sin la traza**. No se anota en `error_log` de `control.db` —el registro que
alimenta la zona «Errores» del superadmin—, porque ese solo lo escribe el manejador de 5xx en
tiempo de petición, no el arranque. **Nadie recibe nada.**

---

## 3. Esto no es teórico: ha pasado CINCO veces en 30 días

Del journal de esta máquina, sin filtrar nada:

| Cuándo | Módulo | Motivo | Cuánto duró |
|---|---|---|---|
| 19 ago 09:59 | **`erp` y `disa` a la vez** | `Unexpected identifier 'popstate'` | 89 s |
| 23 ago 23:19 | **`erp`** | `Cannot find module '.../modules/erp/activity.js'` | 43 s |
| 24 ago 07:52 | **`erp`** | `Unexpected reserved word` | 17 s |
| 26 ago 16:24 | `disa` | `db.prepare usado fuera de contexto de tenant` | 70 s |

**Tres de las cuatro se llevaron el panel de administración entero** — `/admin/*` devolviendo 404
mientras el proceso decía `🚀 Bamburu listo` y respondía a todo lo demás.

⚠️ **Y lo que de verdad importa de esa columna «cuánto duró»: fueron cortas porque había una persona
delante desplegando**, no porque nada lo detectara. Ninguna de las cuatro la descubrió una alarma.

### La única red que existe hoy, y hasta dónde llega

`scripts/desplegar.mjs` pide `https://<referencia>/admin/citas` y exige **HTTP 200**, así que **sí
caza una caída del ERP** — pero solo en el camino manual del despliegue. **No cubre** un reinicio de
systemd, un reinicio de la máquina, ni una caída de `disa`, `store` o `portal`, cuyas rutas no mira.

---

## 4. Clasificación: cuál es esencial y cuál no

**El criterio que aplico:** un módulo es esencial si, sin él, Bamburu **promete algo que no cumple** a
quien entra. No lo es si su ausencia degrada el producto pero deja algo honesto en pie.

| Módulo | Qué se pierde sin él | Propuesta | Por qué |
|---|---|---|---|
| `erp` | El panel de administración y `/api/erp`: **todo el producto de dentro** | **ESENCIAL** | Sin él Bamburu no es Bamburu: el dueño no puede facturar, cobrar ni mirar nada. Es la avería que ya ocurrió tres veces |
| `registro` | El alta pública | **ESENCIAL (ya lo es)** | `import` estático: hoy ya mata el proceso |
| `superadmin` | El panel de Ibrahin | **ESENCIAL (ya lo es)** | ídem |
| `disa` | La IA: una de **las dos puertas** de CANON §3-bis | **⚠️ ADMITE DOS LECTURAS — se pregunta** | CANON dice que DISA es «la forma principal de uso» y que las dos puertas no se sustituyen. Pero sin DISA la puerta visual sigue entera y el negocio funciona |
| `portal` | `/portal/:token`: lo que abre **el cliente del cliente** (ver factura, escribir, descargar PDF) | **⚠️ ADMITE DOS LECTURAS — se pregunta** | Es cara al público y un enlace roto lo ve un tercero; pero es una superficie pequeña y su caída no impide operar |
| `store` | **Nada.** Ver abajo | **OPCIONAL** | Medido: no monta ni una ruta |

### El caso `store`, que se resuelve solo al mirarlo

`modules/store/routes.js` termina así, y no es un descuido:

```js
// D1 — TIENDA PÚBLICA APAGADA (reversible)... /store/* y /api/store/* → 404.
// app.route('/api/store', api);
// app.route('/store', views);
```

**Comprobado con `curl`: `/store` devuelve 404 hoy.** El módulo se importa, se ejecuta su `register`,
**no monta nada**, y aun así el arranque imprime `✅ Store: Tienda pública en /store` **y**
`✅ Módulo cargado: store`. Dos líneas verdes por una tienda que no existe. Es la avería de siempre
de este proyecto —un mensaje que dice que algo está en pie cuando no lo está—, aquí en el arranque.
**No se arregla de paso** (no es lo que pide la ficha): queda apuntado.

---

## 5. El aviso a Telegram: qué hay y qué falta

**Lo que hay, y es reutilizable:** `orchestrator/vigia/telegram.js` → `enviar({ texto, config, entorno })`.
Es tubería pura, **nunca lanza** (devuelve `{ ok, motivo, reintentable }`) y el `config` se le inyecta.

**Lo que falta, y es el obstáculo real:** las credenciales viven en **`/etc/orquestador.env`**
(`ORQUESTADOR_TELEGRAM_TOKEN`, `ORQUESTADOR_TELEGRAM_CHAT_ID`), y `bamburu.service` carga
**`/etc/bamburu.env`**, que no las tiene. **Hoy el proceso de Bamburu no puede mandar un Telegram
aunque quiera.** Los dos ficheros son `0600 ubuntu:ubuntu` y el servicio corre como `ubuntu`:
comprobado que el usuario **sí puede leer** el del orquestador, así que el código puede tomarlas de
ahí sin tocar `/etc` ni duplicar un secreto — el mismo patrón que `core/llm.js` ya usa de respaldo.

⚠️ **El orquestador está PARADO por decisión de Ibrahin (2 sep).** Reutilizar su *transporte* y su
*canal* no lo enciende ni lo necesita: es una librería y un chat.

---

## 6. El bucle de reintentos: qué acota ya el sistema y qué no

`systemctl show bamburu`, medido hoy:

```
Restart=on-failure · RestartUSec=3s · StartLimitIntervalUSec=10s · StartLimitBurst=5
```

**El bucle infinito ya está acotado por systemd:** pasados 5 intentos en 10 s el servicio queda en
`failed` y deja de reintentar. **Lo que NO está acotado es el aviso:** si cada intento manda un
Telegram, son hasta 5 mensajes en 10 segundos. Ese es el bucle que hay que frenar aquí, y es de
avisos, no de arranques.

---

## 7. Lo que cambia de alcance respecto a la ficha, dicho antes de construir

1. **Hay un tercer modo de fallo silencioso** que la ficha no menciona: módulo sin `register`, que
   hoy no imprime **nada**. Entra en la tarea: es exactamente «arrancar a medias sin decirlo».
2. **Dos de los seis módulos ya cumplen el criterio** (`registro`, `superadmin`) por ser `import`
   estático. Se documentan como esenciales; **no se tocan**.
3. **`store` no monta nada** y su línea de éxito es falsa. Se clasifica como opcional y **la línea
   falsa se apunta como deuda, no se arregla de paso**.
4. **El aviso a Telegram exige resolver de dónde salen las credenciales** (§5). Es una decisión de
   construcción, y se toma y se explica: se leen de `/etc/orquestador.env`, sin duplicar el secreto.
5. **La clasificación de `disa` y `portal` admite dos lecturas de producto** y por eso **se pregunta
   antes de construir**, como manda el encargo.

---

# ✅ LO CONSTRUIDO Y LO MEDIDO (mismo día, tras el Paso 0)

## 8. La decisión de clasificación, de Ibrahin (3 sep 2026)

**Esencial es SOLO el `erp`.** Sus palabras, en lo que decidió: hoy el problema no es que falte una
parte, es que nadie se entera; y una caída total de los 8 negocios porque DISA no importa es peor que
una degradación que se oye. **CANON §3-bis pide que las dos puertas existan, no que la casa se caiga
si falta una.** `disa`, `portal` y `store` son **opcionales, pero nunca silenciosos**.

La clasificación vive **en un solo sitio y con el motivo de cada uno**: `MODULOS` en `core/loader.js`.
El gate exige que **ningún módulo del disco se quede sin clasificar**, así que añadir uno nuevo y
olvidarse sale en rojo.

## 9. Qué hace ahora el arranque

| Situación | Antes | Ahora |
|---|---|---|
| `erp` no carga (de las tres formas) | aviso en consola, **sigue arrancando**, salida 0 | **el proceso muere** con salida 1, diciendo el módulo y el **error de origen con su traza**, y avisa por Telegram |
| `disa`/`portal`/`store` no cargan | ídem | **arranca sin él**, pero lo grita en el journal y por Telegram |
| Módulo sin `register` | **NADA. Silencio absoluto** | se trata como cualquier otro fallo, con su motivo explicado |
| Todo presente | 4 líneas `✅ Módulo cargado` | **exactamente igual**, mismas líneas y mismo orden |

**El freno del bucle de avisos:** 10 minutos por (módulo + motivo), en `data/estado-arranque.json`.
El bucle de *arranques* ya lo acotaba systemd (5 en 10 s → `failed`); lo que faltaba era que no
salieran cinco Telegram idénticos seguidos.

## 10. La comprobación EN VIVO, en el servidor (11:52 del 3 sep 2026)

Se rompió el `erp` de verdad en el árbol vivo —un `throw` con el texto `ZZ PRUEBA CONTROLADA
AUD-007`— y se reinició el servicio:

- **El servicio NO levantó:** `systemctl is-active` → `activating`, y el sitio dejó de responder
  (`HTTP 000`). Antes de este cambio habría dicho `active` y `🚀 Bamburu listo`.
- **En el journal quedó**, en cada intento: `🛑 MÓDULO ESENCIAL CAÍDO: erp — Bamburu NO va a arrancar`,
  el `Motivo:` con el texto de origen, la traza, y `Aviso a Telegram: enviado`.
- **El freno funcionó a la primera:** **8 intentos de arranque · 1 Telegram enviado · 7 frenados**
  por «el mismo fallo ya se avisó hace menos de 10 min».
- **Restaurado byte a byte** (`git diff` vacío) y reiniciado: los cuatro módulos cargan,
  `🚀 Bamburu listo`, y `desplegar.mjs` verifica la dirección pública. **Duración del corte: ~40 s.**

## 11. La comprobación automática: `scripts/gate-arranque-modulos.mjs` — 39 ✓ · 0 ✗

Está en el barrido (`infra` + `lint` + RAPIDO; **0,3 s**). **Mide el estado real de un proceso**:
lanza `node` de verdad con el cargador de verdad y mira el **código de salida**, no un registro.

**Probado en rojo, defensa por defensa** —lo único que demuestra que un gate sirve—:

| Defensa desactivada a propósito | Resultado |
|---|---|
| El `erp` deja de ser esencial | 🔴 13 fallos |
| Vuelve el `if` sin `else` (módulo sin `register` calla otra vez) | 🔴 6 fallos |
| El cargador avisa del esencial caído pero **no se muere** | 🔴 12 fallos |
| Un módulo se queda sin su motivo escrito | 🔴 1 fallo |
| Se cae un módulo de la lista y nadie lo clasifica | 🔴 2 fallos |
| — restauradas — | ✅ 39 ✓ · 0 ✗ |

**Lo que el gate NO puede probar, y se dice:** que el *servicio real* no levante. Para eso habría que
estropear el árbol vivo dentro de una prueba automática, y si esa prueba muere a mitad el repositorio
se queda roto. Esa mitad se probó **a mano y una vez**, y está en §10.

## 12. Apuntado y NO arreglado (el encargo pedía cambios quirúrgicos)

- **La tienda apagada canta dos líneas verdes por algo que no existe:** `✅ Store: Tienda pública en
  /store` y `✅ Módulo cargado: store`, con `/store` devolviendo 404 desde D1. Ahora al menos su
  ficha en `MODULOS` lo dice por escrito. Ficha en `TABLERO.md` §Deuda técnica.
