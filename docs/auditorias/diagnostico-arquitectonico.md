# Diagnóstico arquitectónico — Bamburu

**Fecha:** 2026-08-31 · **Autor:** el architect · **Tipo:** solo lectura sobre código, esquema y documentos.
**Para qué existe:** ordenar el backlog de las cinco auditorías **por impacto arquitectónico**, no por
urgencia ni por riesgo. Es interno: no está escrito para explicar el proyecto a nadie, está escrito
para decidir en qué orden se toca.

**Qué NO es.** No es una cola de trabajo y no reordena `TABLERO.md`. El orden lo decide Ibrahin
(CANON §6) y nada de aquí se inicia sin encargo. Lo que aporta este documento es el **criterio** de
orden y el argumento de cada posición.

## Método

Leído entero: `CANON.md`, `CLAUDE.md`, `RITUAL.md`, `AGENTS.md`, `session.json`, el backlog del 31 ago
de `TABLERO.md` y las cinco auditorías de esa sesión. Medido directamente sobre el árbol: tamaños,
acceso a la base, autorización, migraciones, capa LLM.

**No se ha ejecutado nada:** ni un gate, ni un barrido, ni un test, ni el censo, ni una consulta a la
base. Manda `RITUAL.md`. Los tres hallazgos vivos de la §4 están **verificados leyendo el código**, con
`file:line`, y así se declaran: no están reproducidos. Reproducirlos requiere encargo.

## El veredicto, en una frase

Bamburu tiene **propiedades que no se compran** —aislamiento por fichero, cadena legal íntegra, registro
inmutable, trazabilidad de decisiones— sostenidas sobre **una arquitectura sin capas**: la regla de
negocio vive dentro del handler HTTP, la autorización es una convención repetida en tres sitios, y el
esquema no está declarado sino ejecutado. Los acabados que faltan (roles, cifrado, RGPD, CI, contrato de
API) **no son el problema: son el síntoma**. Los cinco se resuelven mal y por triplicado mientras no
exista la capa que debería contenerlos.

---

## 1 · Dónde es NOVATO

Cinco ejes. Están en orden de impacto, y ese orden es el del roadmap de la §6.

### N1 · No hay capa de dominio. La regla de negocio vive en el handler HTTP.

Medido:

| Dónde vive el SQL | `.prepare(` |
|---|---|
| `modules/erp/routes/*.js` (handlers HTTP) | **715** |
| `modules/erp/models.js` (esquema + algo de lectura) | 112 |
| `modules/disa/index.js` (el asistente, SQL propio) | **102** |

Existe una capa de servicio **de facto**: 72 funciones exportadas con sufijo `Svc`. Pero se extrajeron
*a posteriori*, una a una, cuando DISA necesitó cada operación, y **viven dentro de los ficheros de
rutas**. La consecuencia está escrita en los imports de DISA:

```
modules/disa/index.js:10   import { anularInvoice, createRectificativa } from '../erp/routes/invoices.js';
modules/disa/index.js:11   import { createClientSvc, … } from '../erp/routes/clients.js';
modules/disa/index.js:16   import { createStockTransferSvc, … } from '../erp/routes/stock-transfers.js';
```

**Un módulo depende de las RUTAS de otro módulo.** La dirección de dependencia está invertida: el
dominio debería ser lo que no sabe nada de HTTP, y aquí es lo que se importa desde dentro de HTTP.

Por qué esto es el eje número uno y no una cuestión de gusto: **CANON §2 regla (2) dice que «las
funciones existen para que DISA las use»**. Hoy DISA solo puede usar las 72 que alguien se acordó de
extraer. Para el resto no hay nada de lo que tirar, y por eso `modules/disa/index.js` tiene 102
`.prepare(` propios: **regla de negocio duplicada en el asistente**. Cada operación que no se extraiga
es una operación que DISA reimplementa o no puede hacer, y CANON no admite ninguna de las dos.

Así lo resuelven los referentes, y no es un detalle de estilo: en Odoo la regla vive en el modelo del
ORM y la vista web, el XML-RPC y los módulos de terceros son **tres clientes del mismo modelo**; en
Salesforce vive en el objeto y Apex, y la UI, la API REST y el bot son tres clientes del mismo objeto.
Bamburu ya tiene tres clientes —pantalla, DISA, y mañana la API pública— y **ninguna regla común**.

**Veredicto: novato, y es el multiplicador.** No aparece en ninguno de los 54 puntos del backlog, y
entre 12 y 15 de ellos cuestan el triple si se hacen antes que él.

### N2 · La autorización es una convención, no un mecanismo.

Tres implementaciones paralelas del mismo concepto:

| Implementación | Dónde | Bypass owner/admin |
|---|---|---|
| `requirePerm(perm)` | `core/auth.js:13` | **sí**, por rol (línea 17) |
| `checkPermission(db, session, m, a)` | `core/permission-check.js:1` | **no** |
| `filtroDeUsuario({role, perms})` | `modules/erp/menu.js:475` | sí, y con **dos reglas distintas dentro** |

El bypass de owner/admin **no vive en la primitiva: se replica en cada punto de llamada**. Donde alguien
se olvide, el comportamiento cambia en silencio. Ya pasó (§4.1).

El resto de la fotografía: **56 permisos distintos** para las 1.025 definiciones de ruta que midió la
auditoría de arquitectura, de las que **600 no llevan `requirePerm` en la línea**. Sin roles: las tablas
`roles`/`role_permissions`/`user_roles` estaban muertas y se archivaron en B12
(`modules/erp/models.js:2494`). Y el menú tiene su propia tabla de permisos, `NAV_PERMS`, con esta
consecuencia anotada en el propio código:

> `modules/erp/menu.js:466` — «*Consecuencia CONOCIDA Y ANOTADA: un empleado con CERO permisos ve el
> menú entero.*»

Elite no es «tener roles». Elite es **un solo punto de decisión, evaluado en el dominio y no en la
ruta**: un `puede(session, permiso)` del que se derivan la pantalla, el menú, DISA y la API. Con eso,
«Permisos Paso 1» deja de ser recorrer 600 rutas y pasa a ser «cada servicio declara su permiso, y una
comprobación afirma que no hay servicio sin él».

**Veredicto: novato, y bloquea seis puntos del backlog** (Paso 1, roles heredados, Paso 2 de DISA,
acceso de gestoría, actividad de empleados, entrada de soporte).

### N3 · El esquema no está declarado: se ejecuta.

`runMigrations(db)` (`modules/erp/models.js:14`) son **3.495 líneas imperativas**: 127
`CREATE TABLE IF NOT EXISTS`, ALTERs sueltos, y el «esto ya se hizo» guardado en filas de la tabla
`settings` (`migration_d1_archive_store_2026_v1`, `migration_stock_unify_2026_v1`, …). **No hay número
de versión de esquema.** Para saber en qué estado está la base de un negocio hay que leer el código y
consultar ocho banderas.

Y hay un segundo mecanismo de migración, fuera de ese:

```
modules/disa/index.js:147   try { db.prepare('ALTER TABLE disa_conversation_threads ADD COLUMN pinned …').run(); } catch {}
```

Un DDL en el registro del módulo, con el error tragado.

Lo que esto cuesta hoy, y que no está apuntado en ningún sitio: **`runMigrations` corre entero cada vez
que se abre la base de un negocio** (`core/tenant-middleware.js:29`), y **el DDL de SQLite es bloqueo
exclusivo**. Es exactamente la pieza que los cuatro temporizadores ejecutan cada hora sobre las nueve
bases, según el diagnóstico de bloqueos. Es decir: **la deuda de migraciones y el riesgo de bloqueo son
el mismo problema, y en el backlog están en dos secciones distintas.**

Con 9 negocios es un arranque lento. Con 500 es media hora de DDL y **una ventana de bloqueo por cada
negocio que despierta**.

Elite: migraciones numeradas, aplicadas una vez, con la versión escrita en la propia base, y un arranque
que no ejecuta DDL si la versión coincide.

**Veredicto: novato.** Y es la única de las cinco que se paga sola: quitar el DDL de la ruta caliente
elimina la mitad del riesgo de bloqueo **sin tocar SQLite ni el modelo de procesos**.

### N4 · Un hilo, un proceso, y la base dentro del hilo.

Esto ya está bien medido en `docs/rendimiento/diagnostico-bloqueos-sqlite.md` y no lo repito. Añado dos
cosas que ese diagnóstico no contempla:

**(a) El caché de conexiones no tiene techo.** `core/tenant-connections` es un `Map` slug → `Database`
(`core/tenant-middleware.js:9`) del que **nunca se expulsa nada**. Con 9 negocios son 9 descriptores y
9 WAL abiertos para siempre. Con 500, son 500 — más sus `-wal` y `-shm`, cada uno retenido en su marca
máxima. No es urgente; es que el modelo de conexión **no tiene prevista una segunda escala**.

**(b) DISA es un generador de consultas arbitrarias sobre el hilo que bloquea.** El diagnóstico de julio
cerraba con «hoy nadie dispara esto»; el del 31 ago añadió los cuatro temporizadores. Falta el tercer
disparador, y es el que un usuario acciona a mano: `runQueryTool` ejecuta **SQL escrito por el modelo**
de forma síncrona (`modules/disa/index.js:2555`), y el `LIMIT 20` **solo está pedido en el prompt**, no
impuesto (`evaluateQueryAccess`, `modules/disa/index.js:109`, valida SELECT, tabla protegida y permiso —
nada más). Un `SELECT` con dos `JOIN` sin `LIMIT` sobre un negocio grande **congela a los otros ocho**
mientras dure. No hay tope de filas, ni tiempo máximo de sentencia, ni interrupción.

**Veredicto: aficionado en forma, sobrado en capacidad** —el veredicto de la comparativa es correcto—,
con la corrección de que hay un disparador más y lo acciona el cliente hablando.

### N5 · Ceguera operativa, y unos instrumentos que dicen cero sin poder verlo.

Lo conocido: 0 CI, 0 logging estructurado, 0 métricas, 0 trazas, 22 `console.log` y 27 `console.error`,
255 scripts y 88 gates que solo corren si alguien los teclea.

El ángulo que no está escrito: **no falta observabilidad — falta que el estado del producto se pueda
leer sin que una persona ejecute un ritual.** Ese es el techo real de escalado, y no es del servidor: es
del equipo. Un producto cuya salud solo se conoce cuando su único ingeniero lanza un barrido de seis
minutos no puede crecer en negocios, porque no puede crecer en personas.

Y el segundo filo, que es peor porque cierra la pregunta: **el censo de ventanitas dice cero y no puede
saberlo.** Dos ceguera independientes, apiladas:

1. **Alcance.** `scripts/censo-ventanitas.mjs:136` barre **solo `modules/`**. `core/` no se mira.
2. **Patrón.** Su expresión es `/(?<![\w.$])(prompt|confirm)\s*\(/` (línea 29): **`alert(` no está**.
   La norma de `CLAUDE.md` dice «ni `prompt()`, ni `confirm()`, ni `alert()`»; el instrumento mide dos
   de las tres.

Y hay `alert()` vivos: unos catorce por grep crudo, entre ellos **cinco en `modules/erp/routes/citas.js`**
(la agenda: pantalla de uso diario y cara del 2º oficio) y el de `core/auth.js:28`, del que hablo en §4.3
porque es el más grave de todos.

Es el mismo patrón del 24 ago —el censo decía CERO y había una— con causa distinta: entonces fue el
parser, ahora es el alcance y el patrón. La lección que quedó escrita se cumple otra vez, y de ella sale
la regla que aplicaré: **el alcance de una comprobación se DERIVA, no se escribe a mano.** Es la misma
que ya se aprendió con `lint-js-servido.mjs` («una lista a mano de rutas siempre se queda corta»), y
todavía no se ha generalizado.

**Veredicto: novato, y es el eje que hace que los otros cuatro se puedan arreglar sin miedo.**

---

## 2 · Dónde ya es ELITE (y qué del roadmap lo destruiría)

No lo repito de la comparativa; lo que añado es **qué tarea del backlog se lo lleva por delante**.

| Propiedad | Estado | Qué la amenaza |
|---|---|---|
| **Aislamiento entre negocios** (un fichero por base) | Mejor que Salesforce. Vendible. | **Postgres.** Con esquema por negocio el aislamiento pasa de ser una propiedad del sistema de ficheros a **una línea de código que se puede olvidar**. Hoy un fallo de aislamiento es imposible; después es un bug. |
| **Cadena VERI\*FACTU y registro inmutable** | 0 `UPDATE`/`DELETE` sobre `activity_logs`; ningún `UPDATE invoices` toca importes. | **RGPD mal diseñado.** «Borrar los datos de un cliente» choca de frente con la inmutabilidad fiscal y con la regla de no destruir datos. Si se implementa como un `DELETE` recorriendo tablas, se rompe lo único que no se puede rehacer. |
| **Verificación real de las copias** (MD5 + restore-test, dos cuentas) | Por encima de la media del sector. | Nada del backlog. Se protege sola. |
| **Trazabilidad de decisiones** (CANON/TABLERO/RITUAL + auditorías con `file:line`) | Élite. Los equipos grandes no la tienen. | **El propio tamaño.** `TABLERO.md` va por 681 KB y 8.107 líneas. Sigue siendo legible por búsqueda, pero ya no por lectura. |

La conclusión operativa de esta tabla: **dos de las cuatro propiedades élite las pone en riesgo el
propio backlog**, y las dos amenazas están en los puntos que más «modernos» suenan. Eso es lo que un
architect tiene que parar, y por eso van al final del roadmap con condiciones escritas, no simplemente
«más tarde».

---

## 3 · Dos contradicciones que hay que resolver antes de ordenar nada

Por la norma de «un titular de recuento se corrige con el cuerpo que lo desarrolla», y por la de «si dos
cifras del mismo documento no cuadran, se dice; no se elige la que conviene»:

1. **`CANON.md` §4 está tres saneamientos por detrás.** Dice: «*Saneamientos 1, 2 y 3 están cerrados;
   Saneamiento 4 … está delimitado como siguiente tarea oficial, todavía no iniciado*». `CLAUDE.md` dice
   S1–S6 cerrados, con commits, y `session.json` confirma S4 cerrado el 27 ago. **La autoridad superior
   es la que está desactualizada**, que es el peor sitio donde puede estar el desfase. Se corrige en
   CANON, con la fecha.

2. **El backlog del 31 ago tiene 54 casillas, no 45.** Contadas: seguridad y datos 13 · arquitectura 6 ·
   observabilidad 3 · API 4 · producto-comparativa 11 · producto-operativo 13 · limpieza 4. El número
   con el que se está trabajando de cabeza es 45. No cambia ninguna prioridad, pero un recuento que no
   cuadra es exactamente lo que la norma manda declarar en vez de redondear.

---

## 4 · Tres hallazgos vivos, encontrados al diagnosticar

Los pongo aquí y no en el backlog porque **ninguno es un bug suelto: cada uno es el síntoma de uno de
los cinco ejes**, y esa es la razón por la que el orden del roadmap es el que es. Los tres están
verificados leyendo el código y **ninguno está reproducido** (RITUAL).

### 4.1 · El dueño no puede ver sus propios informes por DISA — síntoma de N2

> ⚙️ RESUELTO el 31 ago 2026 por la tarea `disa-informes-permiso-dueno`: el bypass owner/admin pasó a
> `core/permission-check.js`. El hallazgo se conserva entero para poder reconstruir qué se creía y cuándo.

`modules/disa/index.js:2528` construye el comprobador de permisos de las herramientas de informes y de
descuentos así:

```js
const permClave = clave => { const [m, a] = String(clave).split('.'); return checkPermission(db, session, m, a); };
```

`checkPermission` **no tiene el bypass de owner/admin** (`core/permission-check.js:1`), y el resto de
`modules/disa/index.js` sí lo añade a mano donde hace falta (`:319`, `:1409`). Aquí no.

A un `owner` **nadie le siembra filas en `user_permissions`**: solo se escriben cuando alguien edita
permisos a mano (`modules/erp/routes/users.js:201`). Su acceso vive entero en el bypass por rol. Luego
`permClave('invoices.read')` es **false para el dueño**, y `modules/disa/informes.js:81` filtra la lista
y le devuelve `ocultos_por_permiso: N`.

Resultado: **el dueño pide sus informes por chat y DISA le dice que no los tiene; la pantalla se los
enseña.** Rompe «las dos puertas respetan los mismos permisos» (CANON §3-bis) justo al revés de como se
temía: la puerta conversacional es **más estricta** que la visual, y con la única persona que lo tiene
todo. El comentario de la línea 2527 afirma que es «el MISMO `checkPermission` de `requirePerm`» — y es
cierto: la primitiva es la misma; lo que falta es la mitad que `requirePerm` tiene en la línea de al lado.

**Es N2 en una línea:** la regla de autorización no está en la primitiva, así que se olvida en un punto
de llamada.

### 4.2 · DISA se rompe cuando el modelo llama a dos herramientas a la vez — síntoma de la capa LLM

`modules/disa/index.js:2570`:

```js
const toolUse = data.content.find(b => b.type === 'tool_use');   // ← la PRIMERA, solo
…
apiMessages.push({ role: 'assistant', content: data.content });  // ← empuja TODAS
apiMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, … }] });
```

El uso de herramientas en paralelo está **activo por defecto** en la API: una respuesta puede traer
varios bloques `tool_use`. El bucle devuelve **un solo** `tool_result` y reenvía **todos** los
`tool_use`. La petición siguiente es inválida —cada `tool_use` exige su `tool_result`—, la API responde
400, `callClaude` lo convierte en `llm_provider_error` y el usuario lee:

> «No se pudo contactar con DISA. No se ha ejecutado ninguna acción; inténtalo de nuevo.»

**Un fallo de contrato disfrazado de fallo de red**, no determinista, imposible de perseguir desde el
mensaje. Y con las 20 acciones y las herramientas de informes/descuentos declaradas juntas, dos llamadas
en un turno no son un caso raro.

Del mismo repaso de `core/llm.js`, y en la misma familia:

- **Sin reintentos.** Un 429 o un 5xx transitorio de la API llega al usuario como error definitivo. El
  SDK oficial reintenta 2 veces por defecto; el transporte a mano no reintenta ninguna.
- **Sin streaming**, con `max_tokens: 1024` y **sin mirar `stop_reason === 'max_tokens'`**: una respuesta
  cortada a la mitad se presenta como completa.
- **Sin caché de prompt.** El system prompt de DISA son del orden de 20 KB, y se reenvía **entero en cada
  vuelta del bucle de herramientas** (hasta cinco por mensaje). `cache_control` sobre el prefijo estable
  cobra las lecturas a ~0,1×. Contra un tope de **5 €/mes por negocio**, esto no es ahorro: es **cuánta
  DISA le cabe a un autónomo por su cuota**, y el factor es del orden de 4-5×. Se mide con
  `usage.cache_read_input_tokens`, no se estima.
- **El contador de gasto falla abierto.** `PRICING` (`core/llm.js:31`) cobra `claude-sonnet-5` a $3/$15;
  la tarifa vigente que tengo es **$2/$10** — sobreestima un 50 %, así que el tope de 5 € corta antes de
  lo que debería (conviene reverificar contra la página oficial antes de tocarlo). Y lo estructural, que
  el propio comentario ya avisa: **un modelo que no esté en la tabla cuenta 0 €** y deja de contar para
  el tope. La entrada de haiku está escrita con sufijo de fecha (`claude-haiku-4-5-20251001`): el día que
  alguien la normalice a `claude-haiku-4-5`, el freno de gasto **se apaga en silencio**. Un tope de gasto
  tiene que fallar CERRADO: modelo desconocido → error, no gratis.

### 4.3 · La pantalla de «no tienes permiso» abre una ventanita sobre una página en blanco — síntoma de N5

`core/auth.js:28` — la respuesta 403 de **todas** las rutas con `requirePerm`:

```js
return c.html(`… <script>window.addEventListener('DOMContentLoaded',function(){
  if(typeof showAccessDenied==='function')showAccessDenied(); else alert('Acceso no permitido');});</script> …`, 403);
```

`showAccessDenied` se define en `modules/erp/layout.js:793`. Ese documento **no carga `layout.js`**: es
un HTML suelto con ese único script. Luego la condición **siempre** cae al `else`: cada denegación de
permiso del producto es un `alert()` del navegador sobre una página en blanco. Y si el usuario ya marcó
«impedir que esta página cree cuadros de diálogo» —el segundo diálogo seguido, que es el motivo por el
que existe la norma— **se queda una página en blanco y nada más**. Hay una copia igual en
`modules/erp/routes/settings.js:489`.

El censo no lo ve por las dos razones de N5: `core/` está fuera de su alcance, y `alert` no está en su
patrón. **Un censo que dice cero y no es cierto es peor que no tenerlo, porque cierra la pregunta** — la
frase ya está escrita en `CLAUDE.md`, y se ha vuelto a cumplir.

---

## 5 · Fuera del orden, por diseño: el peaje de una tarde

Tres puntos del backlog **no compiten en un ranking arquitectónico**, porque su impacto arquitectónico es
cero y su relación coste/riesgo es la mejor de todo el documento. Ordenarlos por arquitectura sería un
error de categoría: se hacen y se olvidan.

1. **Cifrar las dos copias de seguridad** (`rclone crypt`). Configuración, no programación. Cierra los
   vectores 4 y 7. Es la mayor exposición real del producto: 203 clientes y 922 facturas en claro en dos
   Drive personales, y `hc_consentimientos` ya creada para datos de salud (RGPD art. 9).
2. **La retención del backup borra aunque la subida haya fallado** (`scripts/bamburu-backup.sh:164`).
   Condicionar el borrado al éxito. Es un `if`.
3. **Las 2 vulnerabilidades moderadas de dependencias.** `npm audit fix` y mirar el diff.

El manifiesto de huellas SHA-256 del histórico va con el cifrado, pero es programación y sí entra en el
roadmap (C4).

---

## 6 · El roadmap arquitectónico

**Criterio de orden, explícito:** *impacto arquitectónico = a cuántas tareas futuras esta tarea les baja
el coste, el riesgo o la necesidad de existir.* No urgencia. No riesgo. No esfuerzo.

Los 54 puntos del backlog **no son 54 tareas: son 12 capacidades**. Ese reagrupamiento es el trabajo de
este documento, y donde varios puntos se convierten en uno, se dice cuáles.

### C1 · La capa de dominio — el servicio como unidad, no la ruta

*Cierra: 0 puntos del backlog directamente. Abarata: entre 12 y 15.*

Cada operación de negocio es una función `(db, session, entrada) → resultado` que vive en
`modules/erp/dominio/<área>.js` y que hace **las cuatro cosas en un solo sitio**: valida su entrada,
comprueba su permiso, abre su transacción y escribe su traza. La ruta queda como adaptador: leer la
petición, llamar, pintar. DISA es otro adaptador. La API pública será el tercero.

**Por qué va primera.** Convierte «validación en todas las entradas» de 611 rutas en ~150 servicios;
convierte «Permisos Paso 1» de recorrer 600 rutas en «cada servicio declara el suyo»; convierte la API
pública de una reescritura en una proyección; y convierte «las dos puertas» de una disciplina en una
propiedad del código. Y es la única forma de que Postgres, si algún día toca, sea **una frontera async**
en vez de 125 ficheros.

**Cómo, sin big-bang.** El patrón ya está inventado —72 funciones `Svc`— y solo está en el fichero
equivocado. Dos movimientos: (a) mover las 72 a `dominio/` sin cambiar su cuerpo, dejando las rutas
llamándolas; (b) una regla permanente: *toda tarea que toque una ruta extrae antes su servicio*. No es
un proyecto: es una carpeta y una norma, y se paga con las tareas que ya iban a pasar por ahí.

**Cómo se sabe que está hecho:** `.prepare(` en `modules/erp/routes/` bajando de 715 hacia cero, y
`modules/disa/index.js` con 0 SQL de negocio propio.

### C2 · Un solo motor de autorización, evaluado en el dominio

*Cierra: Permisos Paso 1 · roles heredados · Paso 2 (DISA administra) · acceso de gestoría · actividad de
empleados · entrada de soporte con motivo y registro. **Seis puntos.***

Una primitiva `puede(session, permiso)` **con el bypass dentro**, y todo lo demás derivado de ella: el
servicio la llama, la ruta no decide, el menú se calcula con ella y no con `NAV_PERMS`, DISA la usa tal
cual. Roles = conjuntos de permisos con nombre y herencia (patrón Odoo), encima de la misma primitiva,
nunca al lado.

**Aviso sobre la forma de «Permisos Paso 1».** Tal como está escrito en el backlog —«recorrerlas y dejar
escrito qué exige cada una»— produce **un documento que caduca con el commit siguiente**. Es literalmente
la lección de C4a-bis que está en `session.json`: *«un inventario con ~ y … no es una lista cerrada … las
líneas derivan en cuanto otro commit toca esos ficheros»*. Se hace **como código** —un registro de
servicios con su permiso, y una comprobación que falla si hay servicio sin permiso—, no como inventario.
Eso además lo vuelve verificable para siempre en vez de una vez.

Y arregla §4.1 por construcción, no por parche.

### C3 · El esquema, declarado y versionado

*Cierra: 0 puntos del backlog. Desbloquea: los seis de arquitectura y, más adelante, Postgres.*

Migraciones numeradas, aplicadas una vez, con `schema_version` en la propia base; arranque que no ejecuta
DDL si la versión coincide; el `ALTER` suelto de `modules/disa/index.js:147` dentro del mismo mecanismo.
Sin destruir nada: la regla de archivar-no-borrar se conserva entera.

**Se paga sola:** saca el DDL de la ruta caliente, que es la mitad del riesgo de bloqueo del diagnóstico
de SQLite, sin tocar SQLite ni el modelo de procesos.

### C4 · Que el estado del producto se lea sin un humano

*Cierra: integración continua · registro estructurado · métricas · las 99 comprobaciones que nadie
ejecuta · manifiesto de huellas del histórico de backups · ensayo de recuperación cronometrado con
RTO/RPO. **Seis puntos.***

Orden dentro: **primero arreglar los instrumentos ciegos, después añadir instrumentos.** Un gate que
dice cero sin poder verlo hace más daño que su ausencia, y ya van tres veces. Regla que sale de las
tres: **el alcance de una comprobación se DERIVA del árbol, nunca se escribe a mano** — ni la lista de
directorios (§N5), ni la de rutas (`lint-js-servido`), ni la de patrones.

**Una decisión que NO es mía y la señalo en vez de tomarla.** La integración continua ejecuta las
comprobaciones sola, y `RITUAL.md` dice que **ningún gate se ejecuta solo**. Esa norma nació de una
avería real —ocho barridos encadenados llenaron el disco y dejaron el motor de citas en 0 bytes— y el
actor que prohíbe es *el agente decidiendo por su cuenta*. Un CI en cada subida es otro actor: fijo,
presupuestado y visible. **Puede que la norma no lo cubra, y puede que sí: son dos lecturas, y la norma
del proyecto dice que ante dos lecturas se pregunta, no se elige la que da permiso.** Queda preguntado:
sin respuesta de Ibrahin, C4 se queda en «arreglar los instrumentos y el logging», y el CI no se monta.

### C5 · Un solo escritor, y la base fuera del hilo

*Cierra: los cuatro temporizadores en solo lectura · bajar el `busy_timeout` · un solo escritor ·
`worker_threads` medido · varios procesos con reparto. **Cinco puntos** (el sexto, Postgres, es C12).*

Orden interno, de menos a más obra, y cada paso mide antes de autorizar el siguiente:

1. Los cuatro temporizadores abren en solo lectura donde solo leen **(gratis: llega con C3)**.
2. `busy_timeout` de 5 s a ~250 ms: convierte «producto congelado 5 segundos» en «una operación falla
   rápido y se reintenta».
3. **Tope de filas y tiempo máximo para el SQL que escribe el modelo** (§N4.b). Va aquí y no en DISA:
   es disponibilidad de todos los negocios, no una función del asistente.
4. Los temporizadores piden el trabajo al servidor en vez de abrir la base.
5. Medir `worker_threads` — mantiene SQLite y el aislamiento por fichero. Sin medir todavía.
6. Varios procesos con reparto de negocios. **No antes de 1-4**: varios procesos es justo lo que
   convierte una colisión rara en rutina.

Y una pieza que no está en el backlog: **techo y expulsión en el caché de conexiones** (§N4.a).

### C6 · Reversibilidad — un modelo, cuatro funciones

*Cierra: papelera con recuperación por el dueño · deshacer una importación entera · corregir errores de
semanas atrás en documentos no fiscales · historial de cambios visible para el cliente. **Cuatro
puntos.***

Los cuatro son **una sola capacidad**: borrado lógico + registro de eventos + acciones compensatorias,
con la frontera fiscal escrita en un solo sitio (qué es reversible, qué es rectificable-no-borrable, qué
es inmutable). Construida una vez en el dominio, son cuatro funciones. Construida cuatro veces, son
cuatro formas distintas de romper la cadena legal.

Requiere C1: sin capa de dominio no hay dónde poner «lo que se deshace».

### C7 · Identidad de entidad — borrar, fusionar, anonimizar, exportar

*Cierra: RGPD como función (exportar, borrar, anonimizar) · fusionar clientes duplicados · datos de
ejemplo borrables al crear un negocio · exportación completa de todos sus datos · exportar cualquier
lista a Excel. **Cinco puntos.***

Todos necesitan la misma primitiva: **operar sobre «un cliente» a través de 134 tablas** sabiendo qué se
va, qué se anonimiza y qué se queda porque la ley lo exige. Eso solo se puede declarar una vez, y solo
si existe el dominio (C1). Escrito a mano como una lista de tablas, caduca con la migración siguiente y
—en RGPD— **caducar significa borrar de menos o borrar de más sobre datos con valor legal**.

La decisión de producto (cómo convive el derecho al olvido con «nunca destruir datos» y con la
inmutabilidad fiscal) es del dueño y **se toma antes de escribir código**, no durante.

### C8 · El contrato: API versionada, validada y documentada

*Cierra: versionado `/api/v1` · contrato OpenAPI · validación en todas las entradas · autenticación por
token con ámbitos y cuotas. **Cuatro puntos.** Y es el peldaño 16 de la escalera.*

Después de C1 y C2 es casi gratis: el OpenAPI se genera del registro de servicios, la validación **es**
el esquema del servicio, y los ámbitos del token **son** los permisos de C2. Hecho antes, es una tercera
copia de la regla de negocio, y la peor de las tres porque es la que se publica.

### C9 · Ciclo de vida del negocio — un estado, tres funciones

*Cierra: modo de pruebas por negocio · entrada como cliente para soporte con motivo y registro · modo
mantenimiento. **Tres puntos.***

El mecanismo ya existe y funciona: `suspended_security` / `suspended_admin` + `readOnlyGuard`
(`core/tenant-middleware.js:82-120`). Los tres puntos son **estados nuevos de la misma máquina**, no
funciones nuevas. Barato y de impacto alto precisamente porque hay precedente que copiar.

### C10 · Límites visibles y estado público

*Cierra: límites visibles antes de chocar contra ellos · página de estado pública · (y las cuotas de
C8). **Dos puntos.***

Es el patrón de los *governor limits* de Salesforce, y el proyecto ya tiene el primer límite construido
—el tope de gasto de DISA— **enseñándose solo cuando ya se chocó**. Un límite que solo aparece al
agotarse incumple «el software trabaja, no el humano»: el dueño se enteraría de que su DISA se apaga el
día que se apaga. Y arreglar el fallo-abierto del contador (§4.2) es requisito, porque un límite que no
cuenta bien no se puede enseñar.

### C11 · Cifrado en reposo, y el ancla de la cadena

*Cierra: cifrado en reposo de las bases · anclar la cadena VERI\*FACTU fuera del servidor · 2FA
obligatoria para owner/admin · sesión de 24 h sin renovación · CSP con `unsafe-inline`. **Cinco
puntos.***

Aquí abajo no por poco importantes, sino porque **el anclaje de la cadena lo resuelve solo el envío real
a la AEAT**, que es del Suelo y no de este roadmap, y porque la CSP está medida como esfuerzo alto con
la lección de C4b ya escrita (se endurece por superficie, y un nonce sin migrar los `onclick` deja
botones muertos en silencio). 2FA obligatoria y la sesión son dos tardes y se pueden adelantar sin coste
arquitectónico ninguno.

### C12 · PostgreSQL — el último, y con condiciones escritas

*Cierra: 1 punto. Coste medido: 571-987 h.*

**No resuelve nada de C1 a C11**, y hecho antes que C1 significa convertir 5.066 funciones síncronas a
asíncronas **y** reescribir las rutas a la vez, porque hoy la regla vive dentro de ellas. Con la capa de
dominio, el contagio de `await` tiene una frontera en vez de 125 ficheros: buena parte de esas 571-987 h
son horas que C1 ya se habrá cobrado.

Y la condición que no es de coste: **hoy un fallo de aislamiento entre negocios es imposible; después es
un bug.** Se cambia la propiedad más vendible del producto por capacidad que todavía no hace falta. Si
algún día se hace, se hace con el número de negocios que lo justifique **medido**, no estimado, y con el
aislamiento defendido por una comprobación que lo intente violar en cada subida.

### Los que se quedan como producto puro

Doce puntos del backlog **no son arquitectura y no deben ganar posiciones por parecerlo**: búsqueda global
(+ buscar dentro de adjuntos: un índice, dos funciones), adjuntar documentos, acciones en bloque, aviso
cuando dos personas editan lo mismo (que sí es una columna `version` en el servicio — trivial con C1,
imposible de aplicar uniformemente sin él), importación asistida con mapeo de columnas, ciclo de
suscripción completo, que el oficio traiga serie/IVA/recordatorios, canal de aviso desde dentro,
factura proforma, y la limpieza (6 pantallas muertas, 14 secciones sin enlazar, 65 elementos de menú).

De la limpieza, solo una tiene peso arquitectónico y ya está en C4: **las 99 comprobaciones que nadie
ejecuta**. Las 6 pantallas muertas suben un puesto por un motivo indirecto: mientras estén en el árbol,
todo recuento de rutas y de pantallas mide sobre cosas que no existen, y ese es el número con el que se
decide C2.

---

## 7 · Lo que pararía hoy

Como architect, y con el motivo por delante:

1. **Postgres en cualquier posición que no sea la última.** Motivo: cambia la propiedad élite del
   producto por capacidad que no hace falta, y multiplica su propio coste si va antes de C1.
2. **«Permisos Paso 1» con la forma que tiene escrita** (inventario de 600 rutas). Motivo: produce un
   documento que caduca con el commit siguiente; es la lección de C4a-bis aplicada a otro sitio. Se
   rehace como código.
3. **Roles como tabla sin unificar antes el motor de evaluación.** Motivo: sería la cuarta
   implementación paralela de autorización, y el §4.1 demuestra qué pasa con la tercera.
4. **Añadir gates antes de arreglar los que son ciegos por construcción.** Motivo: el tercer censo que
   dice cero sin poder verlo.
5. **RGPD antes de decidir cómo convive con la inmutabilidad fiscal.** Motivo: es la única tarea del
   backlog que puede destruir datos con valor legal, y la decisión es del dueño, no de la
   implementación.
6. **Cualquier tarea nueva que meta SQL de negocio en un handler o en DISA.** Motivo: es la deuda de
   C1 creciendo mientras se paga.

## 8 · Cómo reviso cada tarea

Puerta de entrada (antes de construir), cuatro preguntas:

1. **¿Dónde vive la regla?** Si la respuesta es «en la ruta» o «en DISA», la tarea está mal planteada.
2. **¿Quién más va a necesitar esto?** Si la pantalla, DISA y la API lo necesitan, hay un servicio, no
   tres implementaciones.
3. **¿Quién comprueba el permiso, y con qué primitiva?** Una sola, con el bypass dentro.
4. **¿Cómo se sabe que sigue funcionando el mes que viene, sin que nadie lo teclee?** Si la respuesta es
   «hay un gate», la siguiente pregunta es **cuál es su alcance y de dónde se deriva**.

Puerta de salida (antes de dar por hecha), tres:

5. **¿La comprobación pasa por donde pasa el dueño?** (La norma ya está escrita; la aplico igual.)
6. **¿Qué recuento de este repo acaba de quedar desactualizado?** Titular y cuerpo, en la misma entrega.
7. **¿Esta entrega ha añadido una segunda forma de hacer algo que ya se hacía?** Si sí, no está
   terminada: está duplicada.

