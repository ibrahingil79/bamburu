# Diagnóstico de carga — Bamburu (servidor Oracle, 4 vCPU / 23 GiB RAM)

## Resumen

El techo no lo pone SQLite. Lo pone que todo el servidor es un solo hilo. El proceso satura un core y los otros 3 se quedan parados. A partir de ~4 peticiones simultáneas el rendimiento ya no sube: solo crece la cola. Y lo más importante: da casi igual que las escrituras vengan de 50 negocios distintos o de uno solo — 365 facturas/s repartidas frente a 257/s en un único negocio. No se bloquean entre sí; hacen cola una detrás de otra.

El punto de fallo real y cercano no es facturar, es entrar: el login aguanta 15 por segundo, y ahí sí se comen los 4 cores.

## Lo confirmado en el código

- Motor: SQLite (better-sqlite3), un archivo por negocio en `data/tenants/<slug>.db`, más una `control.db` central compartida. Se abre una conexión por negocio y se cachea (`core/tenant-middleware.js:11-21`).
- WAL activo (`journal_mode = WAL`, `foreign_keys = ON`) en cada BD de negocio y en la central.
- `busy_timeout` está a 5000 ms por defecto en better-sqlite3 (`node_modules/better-sqlite3/lib/database.js:34`), verificado cronometrando un bloqueo real: el servidor esperó 5.015 ms antes de fallar.
- Un solo proceso. `bamburu.service` ejecuta `node index.js`, `Type=simple`, sin cluster, sin PM2 (`serve({port: 3000})` en `index.js:1449`).
- Máquina: 4 vCPU, 23 GiB RAM, sin swap, disco ext4 con 35 GB libres. RAM no es limitante: cada negocio abierto cuesta ~0,7 MB (medido: 164 → 199 MB al abrir 50).

Clave técnica: better-sqlite3 es síncrono. Cada consulta y cada transacción (crear factura = insert + líneas + registro Verifactu, `modules/erp/routes/invoices.js:166-194`) se ejecuta en el hilo principal de Node y lo bloquea de punta a punta. WAL permitiría un escritor por archivo en paralelo entre negocios, pero la aplicación nunca ejerce esa concurrencia.

## Los números

Entorno aislado: copia de la app en el puerto 3999, `data/` propia, 50 negocios sembrados, estado restaurado desde snapshot limpio y servidor reiniciado antes de cada escenario. El generador de carga nunca pasó del 30% de un core, así que el cuello medido es del servidor, no del medidor.

| Escenario | Concurrencia | Peticiones/s | p50 | p99 | CPU servidor |
|---|---|---|---|---|---|
| Lectura, 50 negocios | 1 → 64 | 1.210 → 1.590 (plano) | 0,8 → 38 ms | 1,2 → 77 ms | 101% (1 core) |
| Factura, 50 negocios | 1 → 64 | 310 → 365 (plano) | 2,3 → 149 ms | 25 → 1.395 ms | 88% |
| Factura, 1 negocio | 1 → 64 | 249 → 257 (plano) | 3,6 → 245 ms | 22 → 306 ms | 97% |
| Cobros, misma factura | 1 → 64 | 453 → 490 (plano) | 1,9 → 130 ms | 19 → 241 ms | 94% |
| Login (bcrypt) | 1 → 16 | 3,9 → 15,6 (plano) | 261 → 1.025 ms | — | 380% (4 cores) |

Cero errores en todos los escenarios de escritura. Nada se rompe: se degrada por cola. El throughput se aplana en concurrencia 4 y a partir de ahí la latencia crece lineal — la firma exacta de un servicio serializado.

## Dos hallazgos que no esperaba

**1. Un negocio bloqueado congela a los demás.** Bloqueando la BD de t001 desde otro proceso y pidiendo una lectura trivial a t002 (BD libre):

```
t002 sin interferencia:          200 en   34 ms
t001 facturando (BD bloqueada):  400 en 5.020 ms  ← "database is locked"
t002 leyendo, BD propia LIBRE:   200 en 4.718 ms  ← congelado por t001
```

Los 5s de `busy_timeout` transcurren dentro de una llamada C síncrona que no cede el hilo. El aislamiento por archivo protege los datos de cada negocio, pero no su disponibilidad. Hoy nadie dispara esto (backups abren en solo lectura, y en WAL los lectores no bloquean), pero es una mina para escalar a varios procesos.

**2. El limitador de peticiones está mal colocado y amplifica la carga.** `app.use('*', rateLimit(...))` corre en `index.js:26`, antes del `tenantMiddleware` (línea 1421). Como `c.get('tenant')` aún no existe, la clave del bucket es solo la IP: 100 req/min por IP, compartidas entre todos los negocios. La página `/admin` dispara ~9 llamadas a `/api/`, así que son ~10 cargas de página por minuto y por IP. Una oficina con varios empleados tras un mismo NAT comparte ese cupo. Además, cada 429 hace un INSERT en `control.db` (`recordSecurityEvent`, `core/control-db.js:380`): una petición bloqueada cuesta más que una servida. Medido: 50.738 respuestas 429 en 20s, todas escribiendo en la BD compartida.

Extra menor: la primera petición de cada negocio tras un reinicio cuesta 16,7 ms (los 125 DDL de `runMigrations` corren dentro de la petición) frente a 1,3 ms en caliente.

## Tres opciones para subir el techo

**A. Bajar el coste de bcrypt de 12 a 10.** Coste: horas. Complejidad: trivial. Es el único cuello que hoy hace daño de verdad. Cada hash tarda 261 ms y el pool de libuv (4 hilos) satura los 4 cores mientras tanto. Bajar a coste 10 lo divide por ~4 → del orden de 50-60 logins/s. Sigue por encima de lo que recomienda OWASP.

**B. Varios procesos, cada negocio fijado a un proceso.** Coste: días. Complejidad: media-alta.

| 2 procesos | Peticiones/s | vs. 1 proceso |
|---|---|---|
| Negocios distintos | 336 + 327 = 663 | 1,8× (escala casi lineal) |
| Mismo negocio | 120 + 115 = 235 | peor que 257 |

Reparte bien entre negocios y empeora dentro de uno. Solo funciona con afinidad estricta: Caddy enrutando por subdominio a un worker fijo, cada proceso abriendo solo las BD de sus negocios. Si dos procesos tocan el mismo archivo, aparecen las esperas de 5s y los 400 "database is locked" del hallazgo 1. Con 4 procesos afines cabría esperar ~1.300 facturas/s y ~6.000 lecturas/s.

**C. Sacar la base de datos del hilo principal.** Coste: semanas. Complejidad: alta. Mover better-sqlite3 a un pool de worker_threads, o migrar a Postgres (un esquema por negocio) con driver asíncrono. Elimina el techo estructural en vez de esquivarlo, y mata el hallazgo 1. No hacer hasta que A y B se queden cortas.

**Recomendación original:** A ahora, B cuando el número de negocios lo justifique, C solo si el producto crece hasta necesitarlo. Con 6 negocios reales, sobra capacidad por dos órdenes de magnitud en facturación; lo cerca del borde es el login y el limitador de 100 req/min.

Fecha del diagnóstico: previa a esta sesión. Entorno de prueba: puerto 3999, aislado, nunca contra producción.
