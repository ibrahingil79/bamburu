# CLAUDE.md — Instrucciones para Claude Code en Bamburu

> Este archivo lo lees automáticamente al empezar cada sesión. Son las reglas del proyecto.
> Si algo aquí contradice a otro documento, manda CANON.md (estrategia) y este archivo (cómo trabajar).

---

## Fase actual: LA ESCALERA (CANON §4)

- El orden vigente es **una escalera numerada** (CANON §4) donde cada peldaño se apoya en el anterior:
  sincerar → margen → informes → **constructor de analíticas (la puerta visual)** → DISA predictiva →
  dashboards → oficios → el resto. **No hay lista de "espera" ni capa aparte**; el detalle y la
  colocación de cada módulo están en `TABLERO.md` (§LA ESCALERA). **No se inicia un paso sin encargo.**
- La **fase de optimización** (tres ejes: UX, DISA, Seguridad) quedó **✅ CERRADA** — los tres completos.
  Sus reglas rectoras siguen vigentes (CANON §4-bis) y se aplican a lo que se construya; lo que caducó
  es su prioridad ("las funciones nuevas ceden al pulido"), porque el pulido terminó.
- **Las dos puertas** (CANON §3-bis): toda información de negocio se alcanza por DISA **y** por la vía
  visual; ninguna sustituye a la otra, y **las dos respetan los mismos permisos**.
- **Cuándo salir al mercado lo decide el dueño.** El asistente y Code no lo recomiendan ni lo usan como
  argumento; solo ejecutan lo que el dueño prioriza.
- **Fuente única de tareas: `TABLERO.md`.** Notion es solo panel; no dupliques tareas ni toques sus tablas.

## Lo PRIMERO en cada sesión

1. Lee `CANON.md` — qué es Bamburu, qué entra y qué NO (la estrategia).
2. Lee `TABLERO.md` — qué tarea toca ahora (la de más arriba en "POR HACER").
3. Lee `RITUAL.md` — el flujo de trabajo de la sesión, y síguelo.
4. Lee `session.json` — dónde se quedó la sesión anterior.

No empieces a tocar código sin haber leído CANON y TABLERO.

## Biblia de contexto (docs/contexto/)

Existe una biblia de contexto en `docs/contexto/` (7 documentos). Antes de empezar cualquier
tarea, lee al menos `piezas-cerradas.md` y `errores-conocidos.md`. Respeta las **Reglas de oro**
de `flujo-de-trabajo.md`.

---

## Qué es Bamburu (resumen — el detalle está en CANON.md)

Software de gestión para autónomos de servicios, con una IA proactiva (DISA) como
forma principal de uso. MVP (Capa 1) = facturar + cobrar + gastos + panel + catálogo
de servicios, con cumplimiento legal de España (Verifactu). Diferencial: IA proactiva
(no reactiva) + ejecución impecable.

**La regla de oro del producto:** los motores (facturación, cobros, gastos) deben ser
fiables ANTES de que DISA los accione. Una factura mal hecha por DISA es una multa,
no un bug.

---

## Stack técnico

- **Runtime:** Node.js v22 (`/usr/bin/node`, usuario del sistema `ubuntu`)
- **Framework:** Hono 4 (ESM). Usa `c.req`, `c.get('session')`, `c.html()`, `c.redirect()`
- **Base de datos:** SQLite con better-sqlite3 (SÍNCRONO — no uses await en queries)
- **Arquitectura:** multi-tenant por subdominio. BD central de routing (`data/control.db`)
  + una BD por negocio (`data/tenants/<slug>.db`). Aislamiento a nivel de archivo.
- **Auth:** `admin_users` está en cada BD de tenant, NO en control.db. bcrypt + 2FA TOTP.
- **Emails:** Resend SDK → devuelve `{ data, error }`, NO lanza excepciones (hay que checkear `error`).
- **Secretos:** en `/etc/bamburu.env` (fuera del repo). NUNCA hardcodear claves ni subirlas.
- **Frontend:** HTML/JS inline servido desde rutas (sin SPA, sin framework de front).

## Estructura del proyecto

- `modules/erp/` — panel de administración
- `modules/store/` — tienda pública (CAPA 2, congelada — no trabajar aquí ahora)
- `modules/disa/` — la IA (DISA)
- `modules/registro/` — onboarding/alta de tenants
- `core/` — auth, CSRF, validación, TOTP, Resend
- `data/` — bases de datos SQLite (NO se versionan, están en .gitignore)

## Cómo levantar/reiniciar el servidor

El servicio corre bajo **systemd** como `bamburu.service` (unit en
`/etc/systemd/system/bamburu.service`), ejecutando
`/usr/bin/node /home/ubuntu/bamburu/index.js` (WorkingDirectory `/home/ubuntu/bamburu`, `User=ubuntu`).

- Reiniciar tras un cambio: `sudo systemctl restart bamburu`
- Estado: `systemctl status bamburu --no-pager`
- Logs en vivo: `sudo journalctl -u bamburu -f`
- Últimas 50 líneas: `sudo journalctl -u bamburu -n 50 --no-pager`

NO usar PM2: hay una entrada "bamburu" antigua en `pm2 list` que está en
estado `errored` y no es la instancia productiva — ignorarla.

---

## Convenciones (de CONTEXT_ENGINEERING.md)

- Migraciones: lazy, vía `runMigrations(db)` en tenant-middleware.
- **REGLA PERMANENTE — nunca destruir datos de un tenant.** Cualquier migración que toque
  datos de un tenant **archiva, no borra**: renombra la tabla (p. ej. `tabla` → `tabla_archived`),
  **NUNCA** hace `DROP TABLE` (ni `DROP COLUMN` con datos). Aunque el TABLERO (u otra tarea) diga
  "eliminar", **eliminar = sacarlo del sistema vivo** (desmontar rutas/UI, dejar de leerlo), **no
  destruir los datos**. Si una tarea pide explícitamente borrar datos de verdad, se para y se pregunta.
- Estados de pedido en ESPAÑOL (NO en inglés — fue causa de bugs de analítica). El pedido VIVO es el
  documento del Pilar 4, tabla `customer_orders`: **borrador, confirmado, anulado, entregado** (enum real
  del esquema). Los estados viejos `en_preparacion/enviado/completado/cancelado/reembolsado` eran de la
  tabla `orders`/POS, **archivada en D1**; ya no se usan.
- better-sqlite3 version mismatch se arregla con:
  `sudo bash -c "PYTHON=/usr/bin/python3.11 npm rebuild better-sqlite3"` (ejecutar desde `/home/ubuntu/bamburu`)

---

## Reglas de trabajo (de RITUAL.md)

- 📍 **LOS BARRIDOS Y LOS GATES SON A DEMANDA — la norma está escrita ENTERA en `RITUAL.md`,
  sección «LA REGRESIÓN», y aquí NO se reescribe.** Lo justo para saber que existe:
  **ningún barrido y ningún gate se ejecuta solo. Ni el de la tarea. Se ejecutan cuando Ibrahin lo
  pide.** Si un encargo los necesita, lo dice arriba del todo y **con eso queda pedido**.
  Al cerrar una entrega **se propone** (`node scripts/barrido-estado.mjs` prepara el parte) y se
  espera un sí; si dice que no, `--registrar-pendiente` y se vuelve a proponer al abrir.
- 🚩 **SI UNA NORMA DE IBRAHIN ADMITE DOS LECTURAS, NO ELIJAS UNA: PREGUNTA.** Van dos veces que
  parto una norma suya en dos y me quedo con la mitad conveniente — su «barridos a demanda» acabó
  siendo «corto automático + completo a demanda», y al corregirlo, «gate propio automático +
  regresión a demanda». Las dos veces la mitad inventada era la que me daba permiso para algo.
  **Cuando el texto que escribo crece más que lo que él dijo, lo que sobra es mío**: va marcado como
  propuesta, o se pregunta. Preguntar cuesta diez segundos; una norma inventada se ejecuta sola
  durante semanas.
- UNA tarea del TABLERO en curso a la vez. Terminar antes de empezar otra.
- MOTORES antes que la cara de DISA.
- NADA de Capa 2 (e-commerce: productos, inventario, POS, tienda) ni Capa 3 hasta
  cerrar Capa 1. Si una petición toca eso, avísame y recuérdame que está congelado.
- Si aparece una idea nueva, pásala por "la línea" (CANON sección 4) antes de construir.
- Prohibido justificar omitir, aplazar o simplificar una función por ser el cliente un autónomo o negocio pequeño. El alcance se decide por momento/orden de construcción, nunca por tamaño de cliente. Si la palabra "autónomo" hace algún trabajo en el argumento, el argumento está mal: rehacerlo.
- La métrica de progreso es TAREAS COMPLETADAS, no líneas de código.
- Al terminar la sesión, sigue el paso de cierre del RITUAL (resumen + actualizar Notion).

## Gates de pantalla — cómo se da una pantalla por sana

> **Una pantalla solo se da por sana mirando el HTML tal y como sale del SERVIDOR. No vale escuchar
> errores de consola (un error de sintaxis no avisa) ni compilar lo que ve el navegador (el navegador
> recorta el trozo roto y lo que queda funciona). Todo gate de pantalla que se apoye en una de esas
> dos vías está mal escrito.**

De dónde sale (22 ago 2026): dos pantallas —facturas y «Registrar recepción»— estuvieron **muertas**
sin que nadie se enterara, y las tres primeras versiones del gate que debía cazarlas **daban verde
con la pantalla rota**. Lo destapó la prueba de reversión, no el razonamiento. El caso de referencia
está en `scripts/gate-pantallas-documento.mjs`.

Dos avisos que van con la norma:
- **Que la respuesta sea 200 no significa que sea la pantalla pedida:** media docena de pantallas que
  cuelgan de un documento **redirigen** cuando el documento no está en el estado que necesitan, y una
  redirección también responde 200. Hay que exigir que la **URL final** sea la que se pidió.
- **Antes de meter una pantalla en un gate, comprobar que su ruta existe** (montaje + handler). Una
  ruta inventada da verde sobre nada.

## Seguridad (importante)

- NUNCA subir secretos, claves o bases de datos a Git/GitHub.
- NUNCA hardcodear claves en el código; leerlas de `/etc/bamburu.env`.
- En cualquier acción con dinero o valor legal (facturas), DISA propone y el usuario
  confirma. Nunca ejecución silenciosa.
