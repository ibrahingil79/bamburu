# Análisis — Manifiesto de huellas del histórico de copias

- **id:** `manifiesto-huellas-backups`
- **fecha:** 2026-09-02
- **papel:** arquitecto
- **cierra:** la mitad del **vector 7** de `docs/seguridad/vectores-de-ataque.md` que el cifrado no cierra

> **La tarea NO lleva `firma:`.** No inventa ninguna promesa nueva al cliente: la copia diaria ya
> promete «verificada», y esto hace que esa palabra siga siendo cierta pasado el primer día. Por eso
> no hay apartado `## LA PROMESA` y no sube nada al móvil de Ibrahin.

---

## 1 · Qué está mal hoy

### 1.1 · La verificación existe, es buena, y **dura un día**

`scripts/bamburu-backup.sh` verifica **solo lo que sube en esa pasada**, y lo verifica bien:

| Qué hace | Dónde |
|---|---|
| Compara tamaño local vs. destino | `scripts/bamburu-backup.sh:167-169` |
| Compara la huella (MD5 en claro / `cryptcheck` si `crypt`), **sin rama blanda** | `:171-189` |
| Descarga de vuelta y compara **byte a byte** (`cmp`) | `:196-198`, llamada en `:221` y `:241` |
| `PRAGMA integrity_check` sobre el descargado | `:222-223` |

**Todo eso ocurre dentro del bucle de subida** (`:206-228` para las bases, `:231-246` para las
uploads). En el momento en que el bucle termina, el fichero recién subido **no se vuelve a mirar
nunca**. La siguiente línea que toca el destino es la retención (`:250-252`), que **borra** y no
comprueba nada.

**No hay ningún estado persistido de lo subido.** Lo único que sobrevive a la pasada es una marca
de tiempo: `date +%s > "$LAST_OK"` (`:255`), donde `LAST_OK="$STATE_DIR/last-success$SUFFIX"`
(`:74`). Eso responde *«¿corrió?»*, no *«¿lo que subí sigue siendo lo que subí?»*.

**Verificado hoy, 2 sep 2026, contra el árbol de verdad:**

```
$ grep -rn "sha256\|SHA-256\|manifiesto" scripts/bamburu-backup.sh \
      scripts/bamburu-backup-heartbeat.sh scripts/cifrar-copias-de-seguridad.sh \
      modules/superadmin/backups.js
(sin resultados)
```

Ni una sola mención de SHA-256 ni de manifiesto en ninguna de las cuatro piezas de la copia. La
entrada del tablero es cierta.

### 1.2 · La cifra del tablero se queda corta, y en la dirección peligrosa

La tarea dice **«el histórico es de 14 copias, y 13 de ellas están sin vigilar»**. Medido hoy contra
Drive (`rclone lsjson`, lectura pura):

| | Cuenta principal `gdrive:Bamburu-backup/daily` | Cuenta secundaria `gdrive_gili:Bamburu-backup-gili/daily` |
|---|---|---|
| Días distintos | **14** (2026-08-20 → 2026-09-02) | 3 (la secundaria nació con S6, el 31 ago) |
| **Objetos** | **283** | **87** |
| Bytes | 464.618.079 (≈ 465 MB) | — |

**Son 14 *días*, no 14 *copias*: son 283 objetos sin vigilar, y 370 sumando las dos cuentas.**
El reparto por día va de 11 a 60 ficheros, porque el número de bases de negocio cambia:

```
2026-08-20  16 · 2026-08-26  11 · 2026-09-01  16 · 2026-09-02  60
```

Corrijo la cifra aquí y no la doy por buena en el titular, por la regla de `CLAUDE.md` §«un titular
de recuento se corrige con el cuerpo que lo desarrolla». **El diseño no puede asumir un número fijo
de ficheros por día.**

> **Dato incómodo que sale de mirar, y que NO es esta tarea:** de los 60 objetos de hoy, **50 llevan
> marca de gate o de prueba** (`__gate_*`, `gate-*`, `zz-*`, `*-arranque-*`, `negocio-vecino-*`,
> sufijos de pasada de 13 dígitos). **Reales son 10**: `control`, `desarrollo`,
> `desarrollo-bamburu`, `duniya`, `helados-ibrahin`, `ibrahin-repuestos`, `inversiones-disan`,
> `peluqueria-gil`, `rachibra` y `uploads-…tar.gz`. Es la basura de `scripts/limpiar-restos-de-gates.mjs`
> vista desde el otro lado: **se está pagando copia, verificación y retención por ella**. Lo apunto
> porque el manifiesto la va a listar cada noche y quiero que quede dicho de dónde sale; **no la
> arreglo aquí** y no la uso como excusa para filtrar nada (un filtro que decide qué se vigila es
> exactamente por donde se cuela lo que no se vigila).

### 1.3 · Lo que un atacante puede hacer hoy sin que salte nada

Con acceso a la cuenta de Google (vector 7, `docs/seguridad/vectores-de-ataque.md` §7 — *«esas
comprobaciones solo miran la copia de HOY»*):

1. **Sustituir** `duniya-2026-08-28.db` por otra base sana → `integrity_check` diría `ok` el día que
   se restaure. Nadie lo mira antes.
2. **Vaciar** `uploads-2026-08-25.tar.gz` → se descubre el día que haga falta.
3. **Borrar** 10 de los 14 días → nada lo cuenta. El heartbeat mira `last-success`, que sigue fresco.
4. Y el cifrado, **cuando se encienda**, no tapa 2 ni 3: cifrar impide *editar de forma coherente*,
   no impide *borrar* ni *sustituir por basura*. Lo dice el propio documento de vectores.

### 1.4 · Y hay un agujero de verificación **el día 0**, no solo en el histórico

`verify_uploaded()` (`:184-189`), en el mundo en claro, exige el **MD5** de Drive. Medido hoy:
**Google Drive expone también `sha1` y `sha256`** para los 283 objetos —cero sin `sha256`—, y rclone
1.74.3 los sirve:

```
$ rclone backend features gdrive:   →   "Hashes": ["md5","sha1","sha256"]
$ rclone lsjson gdrive:Bamburu-backup/daily --hash --hash-type sha256
  … "Hashes":{"sha256":"b7df3f06c90b5d01a42666a719a1fadfdb5151595c653aac7afbb4af82ce3cbc"}
```

Se está verificando con MD5 pudiendo verificar con SHA-256, **gratis y en la misma llamada**. Y MD5
no es una elección neutra aquí: el contenido de esas bases lo escribe en parte el propio usuario
(nombres de cliente, conceptos de factura), así que un atacante con una cuenta puede **elegir
bytes** dentro del fichero, que es justo el requisito de un ataque de colisión con prefijo elegido.
No es el riesgo dominante, pero **el tablero pide SHA-256 y el destino ya lo da**.

---

## 2 · Cómo lo resuelven los que ya lo resolvieron

### SAP HANA — **es el mismo problema, y la respuesta es la que hay que copiar**

HANA no guarda las huellas dentro de la copia: mantiene un **catálogo de copias** (`M_BACKUP_CATALOG`
/ `M_BACKUP_CATALOG_FILES`, más el `backup.log`) que vive **fuera de los ficheros de copia**, se
respalda **por separado** del backup de datos, y es la fuente de verdad de *qué copias deberían
existir*. Y tiene una herramienta dedicada, **`hdbbackupcheck`**, que valida un fichero de copia
**sin restaurarlo**, pensada explícitamente para pasarla **periódicamente sobre la ventana de
retención**, no solo sobre la última. La doctrina SAP es literalmente la que falta aquí: *una copia
que nadie ha vuelto a comprobar no cuenta como copia*.

**Qué se trae:** las dos ideas enteras. (a) **Catálogo aparte** de los ficheros. (b) **Repaso
periódico de toda la ventana**, no del último. Es el modelo de este plano.

**Qué no se trae:** `hdbbackupcheck` lee la estructura interna del formato de copia de HANA. Aquí el
equivalente sería descargar y abrir las 283 copias cada noche (465 MB), y eso ni hace falta ni sale
a cuenta — ver §3, porque Drive nos da la huella sin descargar.

### Salesforce — **aplica a medias, y la mitad que aplica es valiosa**

Salesforce es SaaS: el cliente **nunca tiene el fichero**, así que su «manifiesto» es interno e
invisible; en ese sentido no aplica y decirlo es información. Lo que sí aplica es el
comportamiento de **Salesforce Backup** (ex-OwnBackup): cada pasada **compara la copia nueva contra
el estado registrado de la anterior** y levanta una **alerta de anomalía** cuando el delta es raro
(borrados masivos, cambios masivos). La verificación es un **trabajo recurrente sobre el conjunto**,
no un post-check de la subida. Y su Field Audit Trail no protege el dato *cambiándolo de sitio*, sino
**dejando constancia encadenada de lo que había**.

**Qué se trae:** que la comparación es **contra lo registrado**, no contra el fichero local (que en
el día 5 ya no existe); y que **la desaparición de objetos es una señal de primera clase**, no un
efecto secundario. En Bamburu eso es «faltan objetos dentro de la ventana de retención» → alarma.

**Qué no se trae:** la detección de anomalías por volumen/delta. Aquí la retención es determinista
(`--min-age 14d`), así que la ausencia se puede juzgar con una regla exacta en vez de con una
heurística. Una heurística de anomalías sobre 283 objetos que van de 11 a 60 al día sería un
generador de falsas alarmas, y una alarma que grita todos los días es una alarma apagada.

### Odoo — **aplica como CONTRAEJEMPLO, y ese es su valor**

Odoo mete un `manifest.json` **dentro del propio zip del volcado** (`odoo/service/db.py`,
`dump_db`): nombre de base, versión, módulos instalados. Sirve para saber *qué* estás restaurando —
procedencia— y **no sirve para nada contra manipulación**, porque *quien edita el fichero edita el
manifiesto*: van en el mismo objeto. Fuera de eso, el on-premise de Odoo no tiene ni fichero de
huellas ni re-verificación periódica; el histórico se confía al proveedor de almacenamiento.

**Qué se trae:** la parte buena, que es real — un manifiesto **también** documenta *qué contiene una
copia*, y eso hace falta el día de la restauración. Nuestras entradas llevarán tamaño, fecha y
origen, no solo el hash.

**Qué se trae en negativo, y manda sobre el diseño:** **el manifiesto NO viaja con los ficheros.**
El tablero ya lo dice con otras palabras (*«guardado aparte es la parte que importa»*) y Odoo es la
demostración de por qué. Descartado subir el manifiesto a la misma carpeta de Drive.

---

## 3 · La decisión

### Qué se hace

Un **manifiesto encadenado de huellas**, escrito en el servidor, que:

1. **registra** cada artefacto en el momento de subirlo, con su **SHA-256 calculado en local** y la
   **huella que el destino declara** de ese objeto;
2. **verifica, en cada pasada, TODOS los objetos de la ventana de retención** contra lo registrado —
   **sin descargar ninguno**, preguntándole a Drive por la huella que él mismo calculó;
3. **encadena sus propias líneas** (`prev` → `hash`, SHA-256) para que no se le pueda editar el
   pasado en silencio;
4. **ancla su cabeza fuera del servidor**: la cabeza de la cadena y el SHA-256 de cada artefacto del
   día van **en el correo diario**, que ya se envía y ya llega a un buzón que el servidor no puede
   reescribir.

### En qué capa vive

**En la capa de operación, `scripts/` — dentro de `scripts/bamburu-backup.sh`, la pieza que ya
sirve a las DOS copias.** No es una unidad nueva, no es un timer nuevo, no toca `/etc/systemd`.

**Y esa es una decisión de fondo, no de comodidad.** El orquestador **no tiene `sudo` ni escribe
fuera del repo**: `~/.config/rclone/rclone.conf` está en solo lectura para él (comprobado hoy, sale
el error `read-only file system` al intentar rclone una operación que refresca el token). Una tarea
que necesite instalar una unit **no se puede cerrar sin Ibrahin**, y eso es exactamente lo que dejó
`cifrado-copias-seguridad` esperando una orden humana. **Metiéndolo en el script, esta tarea se
construye, se prueba y se despliega sola** — editar el árbol ya despliega, porque la unit ejecuta el
fichero del repo (`ExecStart=/home/ubuntu/bamburu/scripts/bamburu-backup.sh`).

Se apoya en un ayudante Node, `scripts/lib/manifiesto-copias.mjs`, siguiendo el patrón que ya usa
ese mismo script con `scripts/db-snapshot.mjs` (`:213`): bash orquesta y llama a Node para lo que en
bash saldría frágil (JSON, cadena de hashes, junta de listados).

### Qué patrón del propio código sigue

**`modules/superadmin/integridad.js:16` — `verifyTenantInvoices()`.** Bamburu ya tiene exactamente
esta idea funcionando sobre las facturas: recorre una cadena en la que cada eslabón (1) tiene un
hash que cuadra con sus propios datos y (2) enlaza con el hash del anterior, y devuelve
`{ total, ok, alarm }` con un motivo en castellano —*«el enlace con la factura anterior está roto
(¿borrada/insertada?)»*—. **SOLO LEE: nunca toca lo que verifica.** El manifiesto de copias es esa
misma pieza aplicada a ficheros en vez de a filas, y su verificador se escribe con la misma forma:
sale con un motivo que nombra el objeto, y no repara nada.

Los otros dos patrones que se copian tal cual del script actual:

- **Una sola pieza, dos copias, parametrizada por entorno** (`LABEL`/`SUFFIX`, `:45-47`). El
  manifiesto será `manifiesto$SUFFIX.jsonl`, exactamente como `last-success$SUFFIX` (`:74`).
- **Los dos mundos sin rama blanda** (`:135-136`, `:171-189`). El manifiesto tiene que funcionar en
  claro **y** cifrado desde el primer día, porque el día que Ibrahin ejecute
  `scripts/cifrar-copias-de-seguridad.sh` el destino cambia sin avisar a nadie. Un manifiesto que se
  quedara ciego al encender el cifrado sería el «censo que dice CERO y no es cierto» de `CLAUDE.md`,
  otra vez y en el mismo sitio.

### Cómo se consigue verificar 283 objetos sin descargar 465 MB

**Medido hoy, no supuesto:**

- **Mundo EN CLARO.** `rclone lsjson "$REMOTE" --hash --hash-type sha256` devuelve el **SHA-256 que
  Google calculó** para cada objeto. **Una sola llamada** para los 283. Comparar contra lo registrado
  es aritmética local.
- **Mundo CIFRADO.** A través de un `crypt` no hay huellas (`rclone hashsum` responde
  `hash unsupported: hash type not supported` — probado en laboratorio hoy). Pero el objeto que está
  en Drive es el **texto cifrado**, y **de ese sí hay SHA-256**, pidiéndoselo al remote **base**. La
  correspondencia nombre-en-claro → nombre-cifrado la da `rclone backend encode`, que **acepta varios
  nombres en una llamada y responde en orden** (probado hoy en un `crypt` local sobre `/tmp`):

  ```
  $ rclone backend encode lcif: daily/prueba-2026-09-02.db daily/otra-2026-09-01.db
  36lkugo2vd3urv4u077odgo5r4/uofkcrq8h2ufg3dbkupmjeler3caoj952cgs7nngubo8b80bv4f0
  36lkugo2vd3urv4u077odgo5r4/vkgtutt8psk5d1ul8ak7ongs3t7k4um9npaji8rm5c1cs3galik0
  ```

  Total: **tres llamadas** (`lsf` a través del crypt, `backend encode` en lote, `lsjson --hash` del
  base). La ruta cifrada se **registra en el manifiesto en el momento de subir**, así que la
  verificación de noches siguientes ni siquiera necesita volver a codificar.

Que el texto cifrado sea estable es lo que hace válida esta comprobación: no se re-sube, se mira si
el objeto guardado cambió. Y el `sha256` **en claro** también se guarda, porque es lo que necesita
quien restaure.

### Qué pasa cuando algo no cuadra

Tres desenlaces distintos, y ninguno de ellos es «avisar en el log y devolver 0»:

| Hallazgo | Qué es | Qué hace la copia |
|---|---|---|
| La huella de un objeto **cambió** | manipulación | **ALARMA**: correo 🚨 nombrando el objeto, **no se ejecuta la retención**, `exit 1` |
| Falta un objeto y su **edad < RETENCIÓN − 1 día** | borrado | **ALARMA**, igual |
| Falta un objeto y su edad ≥ RETENCIÓN − 1 día | caducó | normal, ni se nombra |
| Aparece un objeto que el manifiesto no conoce | intruso o preexistente | se **registra como `observado`** y **se dice en el correo con su número**; no es alarma |

**Por qué la retención no se ejecuta cuando hay alarma, y esto no es cautela sino la mitad del
valor:** si alguien manipuló el histórico, lo último que puede hacer el sistema es **borrar la
evidencia** por antigüedad esa misma noche. La retención se salta y el correo lo dice.

**Por qué un objeto desconocido NO es alarma:** la primera noche **todo** es desconocido —hay 283
objetos y cero manifiesto—, así que hace falta una regla de *confianza en el primer avistamiento*
(TOFU). Un objeto nuevo no destruye nada y caduca solo en 14 días; en cambio, alarmar por él haría
que la alarma sonara **todas las noches para siempre** tras cualquier subida manual, y una alarma
crónica es una alarma apagada. Se registra, **se cuenta en el correo con palabras** —«N objetos que
esta copia no subió»— y **desde esa noche se verifica como todos los demás**: si el intruso cambia
después, salta. Lo que no se hace nunca es callarlo.

**Y se dice qué NO cubre esto, porque un manifiesto que se vende como más de lo que es vale menos
que ninguno:** el manifiesto vive en el servidor, así que **quien controle el servidor puede
reescribirlo entero**, cadena incluida. Contra eso está el ancla del correo: la cabeza de la cadena
de cada noche está en el buzón de Ibrahin, y una cadena reescrita **no puede cuadrar con las cabezas
ya enviadas**. Es defensa **contra la cuenta de Drive comprometida** (que es el vector 7) y **prueba
forense** contra el servidor comprometido. No es más que eso, y así se escribe en el README.

### Alternativas descartadas

| Descartada | Por qué |
|---|---|
| **Descargar y re-hashear las 283 copias cada noche** | 465 MB de bajada diaria por copia (930 MB entre las dos) para saber lo que Drive contesta en una llamada. La copia ya tarda 476 s; esto la multiplicaría. Y no aporta: la huella la calcula Google al escribir, no el cliente. |
| **Subir el manifiesto a la misma carpeta de Drive** | Es el `manifest.json` de Odoo: quien edita el fichero edita el manifiesto. Lo prohíbe el enunciado de la tarea, y con razón. |
| **Guardar el manifiesto de cada cuenta en la OTRA cuenta (cruzado)** | Es buena idea y **no se puede hacer sin `sudo`**: cada pasada solo conoce su propio `BACKUP_REMOTE` (viene de la unit, `deploy/systemd/bamburu-backup-secondary.service`), y saber el destino de la otra exigiría o tocar `/etc/systemd` o **cablear en el código el nombre del otro remote**. Cablear un destino es exactamente lo que reventó el 1 de septiembre. El correo hace de ancla externa con cero infraestructura nueva. |
| **Comparar las dos cuentas entre sí** | Tentador: hoy `control-2026-09-02.db` tiene el **mismo** SHA-256 en las dos cuentas (`b7df3f06…`), porque a las 03:33 y a las 03:35 la base no cambió. Pero **no está garantizado**: los dos snapshots son independientes y una base con actividad nocturna daría bytes distintos **legítimamente**. Una comprobación que falla por lo correcto es una fábrica de falsas alarmas. Descartada como alarma. |
| **Un script y un timer propios para la verificación** | Necesita `sudo` para instalar la unit → la tarea no se podría cerrar sin Ibrahin, que es la trampa en la que ya cayó `cifrado-copias-seguridad`. Y separado se le puede morir el timer sin que nadie se entere. Dentro del script, si la copia corre, la verificación corre. |
| **Una tabla SQLite en `control.db` en vez de un JSONL** | Metería datos de operación en la base del producto, obligaría a que el proceso web y un script de sistema compartan escritura, y el fichero **tiene que sobrevivir a que la base se restaure desde una copia** — que es justo el momento en que hace falta. Un fichero plano de `~/.local/state/` es más simple y no tiene ese ciclo. |
| **Una ficha nueva en `/sa/backups`** | Cabe y sería útil (`modules/superadmin/backups.js:10` ya lee ese mismo directorio de estado), pero **no lo pide la tarea** y añade superficie de pantalla —con sus gates— a un trabajo que es de operación. Queda apuntado como continuación evidente; **no entra aquí.** |

---

## 4 · El plan, paso a paso

### 4.1 · `scripts/lib/manifiesto-copias.mjs` — NUEVO

Ayudante Node, sin dependencias fuera de `node:` (nada de `better-sqlite3` aquí). Se le llama con
subcomandos y **sale con 0 o 1**; imprime en castellano.

1. **Formato del manifiesto.** JSON Lines, una línea por artefacto, **solo se añade, nunca se
   reescribe**. Campos:

   ```jsonc
   {
     "n": 1234,                       // ordinal, empieza en 1
     "ts": 1788400000,                // epoch de la anotación
     "fecha": "2026-09-02",           // la del nombre del artefacto
     "etiqueta": "principal",         // LABEL
     "remote": "gdrive:Bamburu-backup/daily",
     "nombre": "control-2026-09-02.db",
     "origen": "subido",              // "subido" | "observado"
     "bytes": 274432,                 // tamaño EN CLARO (null si "observado" y cifrado)
     "sha256": "b7df…",               // del CONTENIDO en claro (null si "observado" y cifrado)
     "destino": {                     // lo que hay que volver a preguntarle al destino
       "modo": "claro",               // "claro" | "cifrado"
       "ruta": "control-2026-09-02.db",   // en cifrado: la ruta CIFRADA en el remote base
       "base": "gdrive:Bamburu-backup",   // en cifrado: el remote base; en claro, = remote
       "bytes": 274432,
       "sha256": "b7df…"              // en cifrado: SHA-256 del TEXTO CIFRADO
     },
     "prev": "…64 hex…",              // hash de la línea anterior ("" en la primera)
     "hash": "…64 hex…"               // sha256 del JSON canónico de esta línea SIN "hash"
   }
   ```

   El JSON canónico es el `JSON.stringify` de la línea con las claves **en el orden de arriba** y sin
   `hash`. Se escribe una función `canonizar(entrada)` y **se usa la misma** para escribir y para
   verificar (la lección de `verifyTenantInvoices`, que reutiliza `calcHash` de la emisión).

2. **`pasada`** — el subcomando que llama el backup. Argumentos:
   `--manifiesto <ruta> --estado <ruta> --remote <REMOTE> --modo claro|cifrado --retencion <días>
   --fecha <AAAA-MM-DD> --artefactos <fichero>`, donde `--artefactos` es un fichero de texto con una
   línea `<nombre> <sha256-local> <bytes>` por artefacto subido esa noche (lo escribe el bash).
   Hace, **en este orden**:

   1. **Verifica la cadena** del manifiesto existente de principio a fin. Si un `hash` no cuadra con
      su línea, o un `prev` no enlaza, o el fichero está truncado respecto a la cabeza guardada en el
      estado → **alarma inmediata**, y no se añade nada.
   2. **Lee el destino** (§4.1.3) y construye el mapa `ruta → { bytes, sha256 }`.
   3. **Registra los artefactos de esta noche** (`origen:"subido"`). Para cada uno exige que el
      destino tenga esa ruta y que su `sha256` **coincida con el esperado**: en claro, contra el
      SHA-256 local; en cifrado, se guarda el del texto cifrado tal cual (el contenido ya lo
      verificó `verify_uploaded` + `verify_restored` en el bash). **Si el destino no devuelve
      `sha256` para un objeto que acabamos de subir, es FALLO** — no aviso.
   4. **Registra como `observado`** todo objeto del destino que ningún registro reclame.
   5. **Verifica el histórico**: para cada `nombre` con al menos un registro, se toma **el registro
      más reciente** (así una re-subida del mismo día es la buena, no la vieja) y se compara contra
      el mapa del destino. Aplica la tabla de §3.
   6. **Escribe el estado** `manifiesto$SUFFIX.estado.json`:
      `{ ts, etiqueta, modo, cabeza, registros, comprobados, observados_nuevos, alarmas: [...] }`.
   7. Imprime un resumen de una línea, más una línea por alarma, y **sale 1 si hay alguna**.

   Regla de ausencia: se exige presencia mientras `edad_días < RETENCION - 1`. El margen de un día
   es porque `rclone delete --min-age 14d` corta por `ModTime` y una pasada puede caer a un lado o a
   otro del corte; sin margen, la noche del día 14 daría alarma sola.

   **Escritura atómica y permisos:** se escribe a `<fichero>.tmp` en el mismo directorio con
   `umask 077` y se hace `rename`. `chmod 600` explícito, como hace
   `scripts/cifrar-copias-de-seguridad.sh:273-277` con el fichero de destinos.

3. **Cómo lee el destino, en cada mundo.** Se invoca `rclone` con `execFileSync` (nunca por shell),
   y **la ausencia de salida es un fallo, nunca un cero**:

   - **`--modo claro`:** una llamada
     `rclone lsjson <REMOTE> --hash --hash-type sha256 --files-only`.
     Si un objeto viene sin `Hashes.sha256` → alarma «el destino no devuelve huella para X»
     (**sin rama blanda**, mismo criterio que `bamburu-backup.sh:187`).
   - **`--modo cifrado`:** tres llamadas.
     (a) `rclone lsf <REMOTE> --files-only` → nombres en claro.
     (b) `rclone config show <nombre-del-crypt>` → la línea `remote = <base>:<raíz>`; de ahí sale
     `destino.base`. El tipo se decide **por el grep de `^type = crypt`, nunca por `$?`** (el
     comentario de `bamburu-backup.sh:124-127` lo tiene medido).
     (c) `rclone backend encode <nombre-del-crypt>: <ruta1> <ruta2> …` en lote (con la parte de ruta
     de `REMOTE` por delante: `daily/<nombre>`), y
     `rclone lsjson <base>:<raíz> -R --hash --hash-type sha256 --files-only` para las huellas.
     Se juntan por ruta cifrada.
     Si `backend encode` no devuelve exactamente tantas líneas como nombres se le dieron → fallo.

4. **`verificar-cadena --manifiesto <ruta>`** — recorre y valida la cadena entera, imprime
   `líneas: N · cabeza: <hash>` y sale 0/1. Es el equivalente de `/sa/integridad` para este fichero,
   y existe para poder comprobarlo a mano y desde el test.

5. **`estado --estado <ruta>`** — vuelca el estado en una línea legible. Lo usa el heartbeat.

### 4.2 · `scripts/bamburu-backup.sh` — MODIFICAR

6. **Cabecera (`:1-34`).** Añadir el bloque que explica el manifiesto, con el mismo tono que el resto
   del fichero: qué es, por qué va aparte, y qué NO cubre.

7. **Config (`:37-38`).** `DATA_DIR="${BACKUP_DATA_DIR:-$APP_DIR/data}"`. **Es la única razón de este
   cambio: sin él no hay forma de probar el script de punta a punta** (hoy `DATA_DIR` es fijo y una
   prueba tendría que copiar las bases reales, 86 MB). Mismo espíritu que
   `BACKUP_DESTINOS_CONF` (`:57`), que existe solo para poder probar fuera de `$HOME`.

8. **Config (tras `:74`).** Rutas nuevas, con el **mismo sufijo** que `LAST_OK`:
   ```bash
   MANIFIESTO="$STATE_DIR/manifiesto$SUFFIX.jsonl"
   MANIF_ESTADO="$STATE_DIR/manifiesto$SUFFIX.estado.json"
   MANIFHELPER="$APP_DIR/scripts/lib/manifiesto-copias.mjs"
   ```

9. **Bucle de bases (`:206-228`).** Tras `verify_restored` y el `integrity_check`, calcular
   `sha="$(sha256sum "$snap" | awk '{print $1}')"` y añadir
   `printf '%s %s %s\n' "$name" "$sha" "$(stat -c%s "$snap")" >> "$TMPDIR/artefactos.txt"`.
   Añadir el `sha` a la línea de `SUMMARY` (`:226`) — **el correo pasa a llevar la huella de cada
   artefacto, que es la mitad del anclaje externo.**

10. **Bloque de uploads (`:231-246`).** Lo mismo para `uploads-<fecha>.tar.gz`.

11. **Bloque nuevo, ENTRE `:248` (`uploaded > 0`) y `:250` (retención).** Este orden es el producto:

    ```bash
    log "manifiesto: registrando $uploaded artefactos y verificando el histórico"
    MODO_MANIF=$([ "$DESTINO_ES_CRYPT" = 1 ] && echo cifrado || echo claro)
    if "$NODE" "$MANIFHELPER" pasada \
         --manifiesto "$MANIFIESTO" --estado "$MANIF_ESTADO" \
         --remote "$REMOTE" --modo "$MODO_MANIF" --retencion "$RETENTION_DAYS" \
         --fecha "$DATE" --artefactos "$TMPDIR/artefactos.txt" 2>&1 | tee -a …  ; then
      MANIF_OK=1
    else
      MANIF_OK=0
    fi
    ```
    (En bash real hay que capturar la salida en una variable y volcarla con `log`, para que entre en
    `LOGBUF` y viaje en el correo; `tee` está aquí solo para que se lea el orden.)

    - Si `MANIF_OK=1`: se sigue a la retención con normalidad.
    - Si `MANIF_OK=0`: **NO se ejecuta la retención**, se escribe `last-success` igual (la copia de
      hoy sí está hecha y verificada), se hace `hc_ping ""` igual (hay copia de hoy, y mentirle al
      dead-man's-switch sería peor), y se envía un correo **🚨 en vez del ✅**, con el resumen del día
      **y** las alarmas. Termina con `exit 1`, para que systemd marque el servicio fallido y se vea
      en `systemctl show … -p Result` (que es lo que ya lee `modules/superadmin/backups.js:19`).

12. **Correo de éxito (`:256-263`).** Añadir dos cosas: la línea
    `Manifiesto: N objetos comprobados · 0 alarmas · 0 descargas · cabeza <hash>` y, si hubo
    `observado`s nuevos, `N objetos que esta copia no subió (registrados por primera vez)`.
    La cabeza en el correo **es el ancla fuera del servidor**: va en el asunto no, en el cuerpo sí.

### 4.3 · `scripts/bamburu-backup-heartbeat.sh` — MODIFICAR

13. Tras el bucle de marcas (`:46-58`), un segundo bucle sobre
    `$STATE_DIR/manifiesto$SUFFIX.estado.json` para las mismas etiquetas que ya calcula (`:38-41`),
    con `node "$MANIFHELPER" estado`. Se avisa si:
    - el estado **no existe** o su `ts` tiene **más de 48 h** (mismo `MAX_AGE` que ya usa, `:23`) →
      *«la verificación del histórico lleva N h sin correr»*; o
    - el último estado trae **alarmas** → se repiten en el correo.

    **Por qué esto no sobra:** si el manifiesto se dejara de verificar —porque el bloque falla antes,
    o porque alguien lo comenta— el sistema volvería al silencio de hoy **y todo seguiría en verde**.
    El heartbeat es lo que vigila al vigilante, y ya existe. Es literalmente la lección de
    `CLAUDE.md`: *un censo que dice CERO y no es cierto es peor que no tenerlo*.

### 4.4 · `scripts/test-manifiesto-copias.mjs` — NUEVO

14. Test de punta a punta, **sin Drive, sin `sudo` y sin red**, con el estilo de `scripts/test-*.mjs`
    (contador `ok`/`fail`, `✓`/`✗ FALLO`, salida 1 si algo falla). Monta un laboratorio en
    `/tmp` y **ejecuta el `bamburu-backup.sh` de verdad**:

    - `HOME=<tmp>` (para `STATE_DIR` y el fichero de destinos), `RCLONE_CONFIG=<tmp>/rc.conf`,
      `BACKUP_DATA_DIR=<tmp>/data` con dos `.db` creados con `better-sqlite3` y un `uploads/`,
      `RESEND_API_KEY` sin definir (no se manda correo) y `BACKUP_HC_URL=` (no se pinga).
    - **Mundo EN CLARO:** `rclone config create lbase local` y `BACKUP_REMOTE=lbase:<tmp>/destino`.
    - **Mundo CIFRADO:** un `crypt` local sobre `<tmp>/base` + el fichero
      `<tmp>/.config/bamburu/backup-destinos.conf` con su línea `DESTINO_principal=…`
      (así se ejercita también el cerrojo de `:142-144`).

    Casos, **los mismos en los dos mundos**:

    | # | Qué monta | Qué exige |
    |---|---|---|
    | a | Destino con objetos de días anteriores y sin manifiesto | pasada **verde**, y esos objetos quedan `origen:"observado"` |
    | b | Segunda pasada limpia | verde, cadena válida, cero alarmas |
    | c | **Altera** un objeto de hace 5 días en el destino | **exit 1**, la salida **nombra ese fichero**, y **la retención no corrió** (un objeto de +14 días sigue ahí) |
    | d | **Borra** un objeto de hace 5 días | **exit 1** y lo nombra |
    | e | Borra un objeto de hace 15 días | **verde** (caducó, no es alarma) |
    | f | **Edita una línea antigua del manifiesto** | **exit 1** por cadena rota, y **no se añade nada** |
    | g | Re-subida el mismo día (dos pasadas seguidas con la base cambiada en medio) | **verde**: manda el registro más reciente |

15. **Nota para quien lo construya, medida hoy:** en el entorno del orquestador
    `~/.config/rclone/rclone.conf` **está en solo lectura** y cualquier `rclone` contra `gdrive:`
    escupe `Failed to save config … read-only file system`. **El test no debe tocar los remotes de
    producción**: `RCLONE_CONFIG` a `/tmp` y remotes `local`/`crypt`, como en el laboratorio de este
    análisis. La comprobación contra Drive de verdad la hace sola la copia de esa madrugada.

### 4.5 · Documentación

16. **`deploy/systemd/README.md` §«Qué hace, cada día»** (líneas 103-146): una viñeta nueva
    describiendo el manifiesto, qué detecta y **qué no**. Añadir a la tabla §«Piezas» (`:147-162`)
    las tres filas: el ayudante, el `manifiesto$SUFFIX.jsonl` y el `.estado.json`, marcados
    **«NO (estado de la máquina)»** como ya está el fichero de destinos.
17. **`docs/seguridad/vectores-de-ataque.md` §7:** dejar escrito qué mitad cierra esto y **qué
    queda**: el manifiesto detecta, no impide; y contra un servidor comprometido lo que queda es el
    ancla del correo. El §Resumen (línea 15) pasa de «**Parcial**» a lo que sea cierto ese día, y
    **por la regla del titular, se revisa a la vez el cuerpo del §7** — que hoy dice «Desde el 1 sep
    2026 sí están cifradas», **cosa que es falsa**: no hay remotes `crypt` (comprobado hoy:
    `rclone listremotes` devuelve exactamente `gdrive:` y `gdrive_gili:`). **Esa frase se tacha con
    su motivo y su fecha, no se borra.**
18. **`TABLERO.md`:** marcar la ficha (línea 9309 del backlog y la §TAREA de la línea 8662) con lo
    hecho, y **corregir ahí la cifra**: no son «14 copias», son **14 días / 283 objetos** en la
    principal y 87 en la secundaria.

---

## 5 · Riesgos

| # | Riesgo | Cómo se mitiga |
|---|---|---|
| 1 | **Que esto tumbe la copia diaria.** Es el riesgo grande: el 1 sep un guardián nuevo habría dejado dos noches sin copia. | El bloque nuevo va **después** de que todo esté subido y verificado (`:248`), nunca antes. **La copia del día se sube, se verifica y se marca `last-success` pase lo que pase con el manifiesto.** No hay ninguna ruta en la que un fallo del manifiesto impida copiar. Y `set -e` sigue **sin** estar puesto, como advierte `:33`. |
| 2 | **Falsa alarma la primera noche** (283 objetos desconocidos). | TOFU explícito: la primera pasada los registra `observado` y **no alarma**; lo dice en el correo con su número. Caso (a) del test. |
| 3 | **Falsa alarma por re-subida el mismo día.** Ibrahin lanzó copias a mano el 1 sep y el botón de `/sa/backups` (`modules/superadmin/backups.js`) lanza el mismo script. Re-subir cambia el contenido del objeto. | Se compara contra el **registro más reciente** de ese nombre, no contra el primero. Caso (g) del test. |
| 4 | **Falsa alarma en el borde de la retención** (`rclone delete --min-age 14d` corta por `ModTime`). | La ausencia solo alarma si `edad < RETENCION − 1`. Caso (e) del test. |
| 5 | **Que al encender el cifrado la verificación se quede ciega y EN VERDE** — el fallo exacto que ya ocurrió con el MD5. | El modo se decide con `DESTINO_ES_CRYPT`, que **ya lo resuelve el script** (`:135-136`) y ya es el cerrojo. Los dos mundos van en el test (§4.4), y **el helper falla si el destino no devuelve huella**: no existe la rama que devuelve 0 con un aviso. |
| 6 | **Coste y tiempo.** La copia ya tarda 476 s (principal) y 523 s (secundaria), y hay dos. | El histórico se verifica **sin descargar nada**: 1 llamada `rclone` en claro, 3 en cifrado. Lo único nuevo con coste real es `sha256sum` de lo que ya está en disco local (~86 MB hoy, décimas de segundo). El criterio 7 lo fija: **0 descargas**. |
| 7 | **Crecimiento del fichero.** ~40 líneas/día → ~15.000 al año, ~4 MB. | Se asume a propósito: es append-only y la historia es el producto. Nada de rotar ni podar — podar un registro de integridad es abrirle la puerta a lo que viene a detectar. Se dice en el README. |
| 8 | **Confusión de señales:** `exit 1` con la copia del día hecha. | Se separan a propósito los dos hechos, y así se documenta: `last-success` + ping + `/sa/backups` responden *«¿tengo copia de hoy?»* (y siguen en verde, porque es verdad); el correo 🚨 y `systemctl … -p Result` responden *«¿el histórico sigue intacto?»*. El heartbeat, que solo mira `last-success` (`:46-58`), **no gritaría por esto** — por eso el paso 13 le añade la segunda mirada. |
| 9 | **La cadena de VERI\*FACTU.** | **No se toca nada suyo.** Ni un fichero de `modules/erp/`, ni `invoices.js:156`, ni `calcHash`, ni ninguna tabla. Esto solo lee ficheros ya escritos en `/tmp` y habla con rclone. |
| 10 | **Datos de tenant.** | **No se toca ninguna BD.** Los snapshots se leen en `readonly` desde `db-snapshot.mjs`, que ya existe y no cambia. Cero migraciones. |
| 11 | **Pantallas.** | Ninguna. No se toca `modules/`, no hay ruta nueva, ni botón, ni ventanita, así que el censo de `scripts/censo-ventanitas.mjs` no cambia. La ficha de `/sa/backups` queda **descartada** (§3) precisamente para no abrir esa superficie. |
| 12 | **El manifiesto se pierde si el servidor muere**, que es justo el día que hace falta. | Es una limitación real y se escribe como tal. La mitiga el ancla: el correo diario lleva **el SHA-256 de cada artefacto** y la cabeza, así que desde el buzón se puede verificar una copia descargada sin el servidor. Es también la razón por la que el sha256 **en claro** se guarda además del cifrado. |
| 13 | **Concurrencia**: principal (03:33) y secundaria (03:35) pueden solaparse si la primera se alarga. | Escriben **ficheros distintos** (`manifiesto.jsonl` vs `manifiesto-secondary.jsonl`), igual que ya hacen con `last-success$SUFFIX`. Además, escritura por `tmp` + `rename` en el mismo directorio, que es atómica. No hay recurso compartido. |
| 14 | **`rclone backend encode` cambia o desaparece** en una versión futura. | Probado hoy en la versión instalada (1.74.3) y es un comando documentado del backend `crypt`. Si un día no devuelve tantas líneas como nombres se le pasan, el helper **falla**; no adivina. |

---

## 6 · Criterios de aceptación

- [ ] `node scripts/test-manifiesto-copias.mjs` sale con código 0, y ejecuta el `scripts/bamburu-backup.sh` real contra un remote **local en claro** y contra un **`crypt` local**, cubriendo los siete casos (a)–(g) de §4.4 en los dos mundos.
- [ ] Tras una pasada, `~/.local/state/bamburu-backup/manifiesto.jsonl` tiene **una línea por artefacto subido**, cada una con `sha256` de 64 hex y `prev`/`hash` enlazados, el fichero está en permisos `600`, y `node scripts/lib/manifiesto-copias.mjs verificar-cadena --manifiesto <ruta>` sale con 0.
- [ ] Alterar el contenido de un objeto del histórico en el destino, **o** borrar uno cuya edad sea menor que `RETENTION_DAYS − 1`, hace que la pasada siguiente **salga con código 1** y que su salida **nombre el fichero exacto**; borrar uno de más de `RETENTION_DAYS` días **no** produce alarma.
- [ ] En una pasada con alarma del histórico, `rclone delete --min-age` **no se ejecuta** (un objeto de más de `RETENTION_DAYS` días sigue en el destino al terminar) y sí se escribe `last-success`.
- [ ] En la primera pasada sobre un destino con objetos previos y sin manifiesto, **no hay alarma**, esos objetos quedan registrados con `"origen":"observado"` y el resumen de la pasada dice cuántos son.
- [ ] La pasada imprime una línea con el recuento de objetos comprobados del histórico y **`0 descargas`**, y en el mundo en claro la verificación del histórico hace **una sola** invocación de `rclone` (`lsjson … --hash --hash-type sha256`).
- [ ] El cuerpo del correo diario de éxito incluye el **SHA-256 de cada artefacto** del día y la **cabeza de la cadena** del manifiesto.
- [ ] `bash scripts/bamburu-backup-heartbeat.sh` envía aviso si el `manifiesto*.estado.json` de una copia esperada no existe, tiene más de 48 h, o su último resultado trae alarmas.
