# Anclar la cadena de VERI*FACTU fuera del servidor

- **id:** `anclar-verifactu-fuera`
- **cerrada:** 2026-09-01
- **resultado:** ✍️ TERMINADA, ESPERANDO LA FIRMA DE IBRAHIN
- **rama:** `tarea/anclar-verifactu-fuera` — **NO está en master, o sea que NO está en producción**
- **la promesa que se le presentó:** 

> Cada factura que emitas queda **sellada por un tercero de fuera** a los pocos minutos: un servicio
> independiente de sellado de tiempo, que no somos nosotros y que no controlamos. Si mañana alguien con
> acceso al servidor cambiara un importe, **se podría demostrar desde fuera que se tocó**. Hoy no se
> podría: la cadena se recalcula sola y vuelve a cuadrar.
> 
> Fuera del servidor solo sale una huella ilegible. **Ni un nombre, ni un NIF, ni un importe, ni un
> dato de tus clientes** sale de aquí.
> 
> Y una cosa más, que es lo que he cambiado en esta versión: **cuando el programa no pueda comprobarlo,
> te lo dirá en lugar de decirte que todo está bien.** Ni «he mirado unos cuantos», ni «no he podido
> mirar» disfrazado de «correcto». Solo dice que tus facturas están intactas cuando ha comprobado
> **todos** los sellos, uno a uno, y te dice cuántos ha mirado y cuándo.
> 
> Si el sellado falla, la factura se emite igual y el sello se reintenta: **nunca te impide facturar.**
> Esto no sustituye a mandarle las facturas a Hacienda: es lo que las protege mientras ese envío está
> apagado, y también protege a las antiguas, que no van a ir nunca.
- **intentos:** 4
- **replanteamientos:** 1

## Criterios de aceptación

- [x] **El verde se gana:** el literal `'cuadra'` aparece **una sola vez** en `modules/erp/verifactu-anclaje.js`, en la asignación final del veredicto, precedida en el mismo bloque por las comprobaciones de `cuadranLosCubos`, `alarmadas === 0`, `fueraDeVentana === 0`, `sinComprobar === 0` y `verificados === sellados`; la variable del veredicto se inicializa a `'alarma'`; y `verificarAnclajes` **no devuelve ningún campo `ok`**.
- [x] **Las ocho mutaciones que hoy salen verdes salen rojas:** con la CA puesta y tokens válidos, ninguna de estas devuelve `veredicto === 'cuadra'` — `token` a NULL · `estado='fallo'` sobre un anclaje con secuencia y sello · `n_facturas` cambiado · `sellado_at` cambiado · `tsa_url` cambiada · `cadena_ok` volteado · borrar el anclaje **más viejo** · comprobar con `limite` menor que el total. Y la base **intacta** sí devuelve `'cuadra'`.
- [x] **El barrido por columnas es exhaustivo:** `scripts/verify-verifactu-anclaje.mjs` recorre `PRAGMA table_info(verifactu_anclajes)`, aplica una mutación declarada por columna sobre una copia, **sale con código 1 si alguna columna de la tabla no está declarada** (comprobado añadiendo una columna de mentira en una copia), y el `motivo` de cada columna declarada como no-cazable aparece **literal** en `docs/verifactu/anclaje-externo.md`.
- [x] **El botón no puede decir «cuadra»:** con más anclajes que `ANCLAJE_COMPROBAR_LIMITE`, `POST /admin/verifactu/anclajes/comprobar` redirige con `v=parcial` y la pantalla dice cuántos de cuántos ha comprobado; la palabra «cuadra» no aparece en esa respuesta.
- [x] **Alguien recorre la cadena entera, y su verde caduca:** una pasada de `scripts/bamburu-anclaje-verifactu.mjs` escribe una fila en `verifactu_anclajes_auditorias` con veredicto y cobertura; `/admin/verifactu/anclajes` la muestra con su antigüedad; y con esa fila fechada hace más de `2 × ANCLAJE_LATIDO_H` horas, la pantalla **no** la pinta en verde aunque diga `cuadra`.
- [x] **El último anclaje cubre todo lo sellado:** sobre una copia con tres anclajes, cambiar una factura que solo cubre el **más viejo** y recalcular toda la cadena con `calcHash` deja `verifyTenantInvoices` en `ok: true` y `verificarAnclajes` en `veredicto === 'alarma'`, nombrando el anclaje y la fecha del sello.
- [x] **No toca la cadena:** el SHA-256 de todas las columnas de `invoices`, `invoice_anulaciones` y `verifactu_registros` es **idéntico** antes y después de una pasada completa del barrido **que sí haya anclado**; y `git diff --name-only master..HEAD` no incluye `modules/erp/routes/invoices.js`, `modules/erp/verifactu.js`, `modules/erp/verifactu-envio.js` ni `modules/erp/verifactu-cola.js`.
- [x] **Se ve sin abrir el código:** `/admin/verifactu/anclajes` y `/superadmin/integridad` responden **200 con su URL final**, la primera muestra el veredicto de la última auditoría completa en palabras, y el correo diario lleva ese veredicto con su cobertura, el `.tsr` adjunto y **`⚠️ ALARMA` en el asunto** si algún negocio sale en alarma.

## Historial de intentos

| Intento | Veredicto | Motivos |
|---------|-----------|---------|
| 1 | rechazado | Hay 19 línea(s) añadidas con restos que no deben quedar:;   scripts/bamburu-anclaje-verifactu.mjs:36  [console.log]  const log = (...a) => console.log('[anclaje-verifactu]', ...a);;   scripts/verify-v |
| 2 | rechazado | [NIVEL-INSUFICIENTE] La pantalla reverifica TODA la cadena de sellos en cada carga, y congela el servidor entero — **Dónde:** `modules/erp/routes/verifactu-anclaje-routes.js:26` (y `:22`) **Qué pasa:* |
| 3 | rechazado | [NIVEL-INSUFICIENTE] Un anclaje `sellado` **sin token** pasa por verificado: el juez dice «cuadra» sobre una cadena de sellos que no existe — **Dónde:** `modules/erp/verifactu-anclaje.js:257` (`if (f. |
| 1 | rechazado | [CRITERIO-INCUMPLIDO] Borrar el anclaje más viejo sale VERDE por el botón: el arreglo se aplicó a la mitad del `if` — **Dónde:** `modules/erp/verifactu-anclaje.js:430-431` ```js let raizAnteriorEspera |

## Artefactos

- Análisis: `docs/architecture/task-anclar-verifactu-fuera-analysis.md`
- Revisión: `docs/architecture/task-anclar-verifactu-fuera-review.md`

## Commits

- `76517c8` Anclaje Verifactu: la ventana del botón ya no relaja el arranque cuando cubre todo

## Consumo de cuota

- Al empezar: 10% de sesión usado
- Al cerrar: 8% de sesión usado
- Diferencia: -2 puntos
