# Diagnóstico — Bloqueos de SQLite y el hilo único

**Fecha:** 2026-08-31 · **Tipo:** solo lectura (no se tocó código, datos ni configuración).
**Origen:** delimitación del siguiente saneamiento tras cerrar S1–S6.
**Fuente previa:** `docs/rendimiento/diagnostico-carga.md` (9 jul 2026), cuyos números se conservan.

## Veredicto

Hoy **no ocurre**. Cero coincidencias de `database is locked` o `SQLITE_BUSY` en todo el journal
desde el 19 jun 2026 (fecha de la primera entrada persistente).

Lo que existe es un fallo **estructural**, medido en banco aislado en julio:

```
t002 sin interferencia:            200 peticiones en     34 ms
t001 facturando (BD bloqueada):    400 errores    en  5.020 ms   ← "database is locked"
t002 leyendo, su BD propia LIBRE:  200 peticiones en  4.718 ms   ← congelado por t001
```

Un negocio **cuya base estaba libre** tardó 4,7 s en una lectura trivial porque **otro negocio
distinto** tenía la suya bloqueada. Son los 5 s de `busy_timeout` (por defecto en better-sqlite3).

## Por qué pasa

No es culpa de SQLite. Son dos decisiones de cómo se usa:

1. **`better-sqlite3` es síncrono.** Cada consulta bloquea el hilo de Node de principio a fin. Los
   5 s de espera transcurren **dentro de una llamada en C que no cede el hilo**. No espera la
   petición: se para el servidor entero.
2. **Un solo proceso, un solo hilo.** Verificado: un único `node index.js`, `Type=simple`, sin
   cluster. Un negocio esperando = todos esperando. Por eso satura 1 core de 4.

WAL permitiría un escritor por fichero en paralelo entre negocios; la aplicación nunca ejerce esa
concurrencia.

**El aislamiento por fichero protege los datos de cada negocio, pero no su disponibilidad.**

## Alcance

- **Afecta a TODOS los negocios a la vez**, incluidos los que tienen su fichero libre.
- **No pierde datos.** Es disponibilidad, no integridad. El informe de julio: «cero errores en todos
  los escenarios de escritura; nada se rompe: se degrada por cola».

## Lo que ha cambiado desde julio (y no estaba apuntado)

El informe de julio cerraba el hallazgo con: *«Hoy nadie dispara esto (los backups abren en solo
lectura, y en WAL los lectores no bloquean)»*. **Esa premisa ya no se sostiene.**

Los backups siguen siendo seguros: `scripts/db-snapshot.mjs` abre con `readonly: true`, y eso
incluye la segunda copia de S6.

Pero desde julio se añadieron **cuatro temporizadores que abren TODAS las bases de negocio en
lectura y escritura**, cada uno en su propio proceso, y además ejecutan migraciones (DDL = bloqueo
exclusivo). Todos usan `new Database(path)` sin `readonly`:

| Proceso | Frecuencia observada | `runMigrations` |
|---|---|---|
| `bamburu-caducar-reservas` | **cada hora** | sí |
| `bamburu-avisos` | **cada hora** | sí |
| `bamburu-propuestas` | diario 05:46 | sí |
| `bamburu-recordatorios-cita` | diario 07:02 | sí |

La condición que el informe describía como «nadie la dispara» **se dispara dos veces cada hora**.

Que no haya colisionado nunca no es casualidad: 9 negocios con tráfico casi nulo y escrituras de
milisegundos. La ventana es minúscula — pero es una ventana, y crece con cada negocio.

## Estado de las opciones del informe de julio

- **A · bcrypt 12 → 10.** ✅ HECHA. `core/auth.js`, `BCRYPT_COST = 10`. Login de ~15/s a ~60/s.
- **B · varios procesos con afinidad.** ⛔ BLOQUEADA por este hallazgo, literalmente: *«es una mina
  para escalar a varios procesos»*. Medido: 1,8× entre negocios distintos, pero dos procesos sobre
  el mismo fichero reproducen las esperas de 5 s.
- **C · la base fuera del hilo principal.** Pendiente. Ver `docs/rendimiento/analisis-migracion-postgres.md`.

## Opciones, de menos a más obra

1. **Que los cuatro temporizadores abran en solo lectura donde solo leen**, y que su ventana de
   escritura sea mínima. Lo más barato y quita la mayor parte del riesgo actual.
2. **Bajar el `busy_timeout`** de 5 s a ~250 ms: convierte «producto congelado 5 segundos» en «una
   operación falla rápido y se reintenta».
3. **Un solo escritor:** que los temporizadores pidan el trabajo al servidor (HTTP interno o cola)
   en vez de abrir la base por su cuenta.
4. **Estructural:** la base fuera del hilo principal (`worker_threads` o cambio de motor).

## El problema de verdad

No es SQLite y no son los bloqueos. **Es que una sola operación lenta sobre el fichero de un negocio
puede congelar el producto entero para todos**, porque todo vive en un hilo y la espera ocurre dentro
de una llamada que no se puede interrumpir. El bloqueo es solo la forma más fácil de provocarlo; ese
mismo hilo único es la razón de que 3 de 4 cores estén parados.

Hoy, con 9 negocios, es inofensivo. Pero **es lo que bloquea la opción B**: no se puede pasar a
varios procesos hasta arreglarlo, porque varios procesos es justamente lo que convierte una colisión
rara en rutinaria.
