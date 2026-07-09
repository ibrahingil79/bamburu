# TABLERO — Fase de optimización

## Eje A: UX (activo)
Objetivo: acercar cada pantalla y flujo a "el dueño no opera, decide". Método: auditoría primero, luego ejecución en piezas pequeñas. Cada tarea define cómo se verifica y cierra con regresión 0.

### U0 — Auditoría UX global  ⬅️ EMPEZAR AQUÍ
Recorre TODAS las pantallas del admin y del portal y produce un inventario real, sin cambiar nada: pantallas y su estado; incoherencias visuales (tipografía, espaciado, colores, componentes repetidos distintos); flujos clave y nº de clics de cada uno; pantallas sin estado vacío / sin estado de carga; mensajes de error genéricos; qué se rompe en móvil.
Hecho cuando: existe docs/ux/auditoria-ux.md con la lista concreta priorizada, y de ahí salen U1–U6 con datos reales.

### U1 — Sistema visual coherente (design tokens)
Unificar tipografía, escala de espaciado, colores y componentes base desde un único sitio (tokens), a partir de layout.js. Sin rediseñar: dar consistencia.
Hecho cuando: los valores visuales salen de un único origen y las pantallas de mayor uso los usan; captura antes/después.
- Avance (2026-07-06): componente de pestañas unificado en estilo FICHA (`.tabs`/`.tab`) — aplicado a Contabilidad, Seguridad, Productos/Descuentos y a los filtros de estado de los listados. Contabilidad reagrupada de 7→3 pestañas de primer nivel (Libros oficiales · Impuestos · Resultados), con 2º nivel de fichas para las 5 vistas legales. Solo navegación/presentación: regresión 0, exports/permisos/datos/rutas intactos.

### U2 — Estados vacíos y de carga  ✅ HECHO (2026-07-06)
Toda pantalla con datos tiene estado vacío útil (qué es, qué hacer) y estado de carga.
Hecho cuando: las pantallas marcadas en U0 quedan cubiertas; revisión en navegador.
- Hecho (2026-07-06): dos piezas compartidas en `layout.js` (un solo sitio) — **`emptyState`/`emptyRow`**
  con voz de DISA (icono ✦ sobre `--accent-soft` + una frase + acción opcional; reutiliza la banda azul
  de U1 y los tokens; variante `tone:'ok'` para los vacíos "buenos" con check verde y `icon:'ti-search'`
  para búsqueda sin resultados) y **`skeletonRows`** (shimmer atenuado; respeta `prefers-reduced-motion`),
  con sus espejos `window.*` para las listas fetch. Montadas sobre ~27 pantallas: vacíos con voz de DISA
  (con acción donde toca, sin botón en los "buenos" como Cobros/Pagos, contextual sin botón forzado en los
  derivados como Inventario/Verifactu/Contabilidad-por-periodo), y **skeleton** en todas las listas fetch,
  incluidas las 4 que daban pantallazo en blanco (Inventario, Grupos, Descuentos, TPV). El **portal público**
  del cliente lleva un vacío NEUTRO (sin DISA, su propio shell), decisión del dueño. Solo presentación,
  aditivo y reversible: **regresión 0** (28 archivos `node --check`, smoke headless 0 errores JS y ninguna
  pantalla en blanco; sin tocar lógica, datos, endpoints ni permisos).

### U3 — Mensajes de error claros y accionables  ✅ HECHO (2026-07-07)
Sustituir errores genéricos por mensajes que dicen qué pasó y qué hacer, en la voz de Bamburu.
Hecho cuando: los casos de U0 muestran mensaje claro; test que dispara los errores y comprueba el texto.
- Propuesta (2026-07-07): barrido completo de admin + portal (más allá de los 16 de U0: la superficie
  real usa **5 mecanismos** — `c.text` planos, `alert`, `toast`, `c.json`→toast y banners DOM). Lista
  aprobada en bloque por el dueño en `docs/ux/u3-textos-errores.md` (11 plantillas T1–T11 + casos A–I).
- Hecho (2026-07-07): pieza compartida en `layout.js` (un solo sitio, como U2) — **`ERR`** (textos
  T1–T11), **`cleanErrMsg()`** (traduce lo crudo a llano: UNIQUE SQLite→duplicado contextual, errores
  internos→genérico, `Datos inválidos`→accionable, y **quita** tokens `confirm_*`/códigos de permiso
  `cobros.manage`/`(R1–R5)`/`(D1)` conservando las palabras que el front necesita) y **`errorShell()`**
  (página de error maquetada con el visual de U2), con espejos `window.*`. El chokepoint **`api()`** limpia
  todos los toast/alert de golpe (403→T4, red→T2). `onError`(T10)+`notFound`(T11) propios con rama JSON para
  `/api/`. Aplicado a ~20 ficheros: `alert`→`toast`, páginas `c.text` planas→maqueta (fichas 404, PDF,
  conciliación, recurrentes, bienes), vertidos de Resend e IDs internos crudos→texto llano. El **portal
  público** mantiene su shell NEUTRO (sin DISA). **Fuera:** los 2 avisos de 2FA/contraseña (lógica) y el
  caso F de Verifactu. Solo presentación, aditivo y reversible: **regresión 0** (20 archivos `node --check`,
  smoke headless `scripts/verify-u3-errores.mjs` **13/13 OK · 0 errores JS**, forzando un caso de cada
  mecanismo en vivo; sin tocar lógica, validaciones, permisos ni la causa de los errores).

### U4 — Reducir clics en flujos clave  ✅ HECHO (2026-07-07)
Tomar los flujos medidos en U0 (emitir factura, registrar cobro, conciliar, crear recurrente…) y recortar pasos/formularios en blanco.
Hecho cuando: cada flujo baja de nº de clics medido; antes/después documentado.
- Hecho (2026-07-07): mismo principio que los flujos "propuesta lista" (conciliar/emitir recurrente/enviar
  enlace) llevado a los de más fricción del U0. **Registrar cobro**: la acción frecuente estaba detrás de
  "Gestionar" (centro de reclamación) → 3 clics; ahora la fila de **Cobros** y la **ficha de cliente**
  llevan **"Registrar cobro" directo** (abre el formulario ya precargado: importe pendiente + fecha hoy) +
  "Gestionar" a un clic → **3→2 clics**, como el espejo de Pagos ("Pagar" directo). **Modal de cobro**:
  precarga la **"Forma"** con el último valor usado (forma del último cobro de la factura y, si no, la
  registrada del cliente) — el API expone `payment_method_default` (aditivo), espejo del modal de pago a
  proveedores. **Crear plantilla recurrente**: **fecha de inicio precargada a hoy** (único obligatorio en
  blanco) y avanzados (fin, nº de ocurrencias, IRPF) plegados en **"Más opciones"** → menos campos a la
  vista sin quitar nada (siguen en el form con sus defaults). Solo presentación/precarga, aditivo y
  reversible: **regresión 0** (motores recurrentes 15/0 · cobros-paso2 47/0 · cobros-paso2-1 46/0; smoke
  navegador real 10/0, 0 errores JS; sin tocar endpoints de escritura, validaciones, permisos ni cálculo).
  5 ficheros: `cobros.js`, `clients.js`, `cobro-modal.js`, `invoices.js`, `recurrentes-routes.js`.

### U5 — Móvil / responsive  ✅ HECHO (2026-07-07)
Que las pantallas de uso frecuente funcionen bien en móvil (lo que U0 marque como roto).
Hecho cuando: esas pantallas se usan sin romperse en ancho móvil; revisión a ese ancho.
- Diagnóstico (móvil 390px táctil): **nav inaccesible** (el rail se iba fuera de pantalla sin hamburguesa; solo
  se abría con hover, que en táctil no existe), **tablas anchas desbordaban** arrastrando el scroll horizontal de
  toda la página (cobros 898px, contabilidad 1101px, facturas 1102px), **rejillas de formulario** inline seguían
  en 3–4 columnas, **modales** medio fuera de pantalla, y **DISA** en móvil (widget flotante de 400px + chat).
- Hecho (2026-07-07): arreglado **una sola vez en piezas compartidas**, todo `@media(max-width:768/900px)` o tras
  `matchMedia` → **regresión 0 en escritorio**. `layout.js`: rail→**drawer** con hamburguesa en el topbar (submenús
  en acordeón), **tablas** con scroll propio en móvil (la página ya no se desplaza), **rejillas de formulario a 1
  columna**, **modales** como hoja inferior alcanzable con el pulgar, alturas en **`dvh`** (no `vh`, que en móvil
  incluye la zona bajo la barra del navegador) y buscador del topbar a 1 línea. **DISA**: el botón flotante (móvil)
  lleva a la **conversación a pantalla completa** (`/admin/disa`) en vez de la ventanita de escritorio; esa pantalla
  pasó a una sola columna con la lista de conversaciones como **drawer estilo IA** (Claude/ChatGPT: ancho + fondo
  oscurecido + cierre al tocar fuera), y el contenedor del chat **rellena con flexbox** el hueco bajo el topbar (sin
  altura fija) → el compositor queda a la vista sin scroll en cualquier móvil. `disaHome.html.js`: cuadrado el
  margen para no desbordar. **Verificado** en navegador a varios anchos (360–414 + escritorio): 0 scroll horizontal,
  chat cabe entero, 0 errores JS; sin tocar lógica, datos, endpoints ni permisos. 4 ficheros: `layout.js`,
  `disa/index.js`, `disa/widget.js`, `disaHome.html.js`.

### U6 — Onboarding / primeros pasos  ✅ HECHO (2026-07-07)  ← CIERRA EL EJE A (UX)
Recorrido que lleve al dueño nuevo al primer valor sin fricción (idealmente de la mano de DISA, enlaza con Eje B).
Hecho cuando: un dueño nuevo llega a su primera acción útil sin bloquearse; recorrido probado.
- Diagnóstico (solo lectura): el dueño aterriza en `/admin` (dashboard → `disaHomeHtml`) tras el alta. `provisionTenant`
  NO fija los datos fiscales → estado "vacío" = `company_name='Mi Empresa'`, `fiscal_id=''`, 0 clientes, 0 facturas.
  Cada paso se deriva del estado real (sin flags): empresa = `fiscal_id` no vacío · cliente = `≥1 en clientes` ·
  factura = `≥1 en invoices`. Destinos existentes: `/admin/settings` · `/admin/clients?nuevo=1` · `/admin/invoices/new`.
- Hecho (2026-07-07): panel **"Configura tu negocio"** en el Inicio (nivel Stripe/Shopify/Holded), SOLO para dueño/admin
  y solo mientras falte algún paso. Lleva **anillo de progreso** (SVG), **timeline** de 3 pasos con iconos y estado
  (verde=hecho · azul=actual · gris=luego), **tiempo estimado** por paso, y el **paso actual desplegado** con la guía de
  DISA (qué·por qué·cómo, en su voz) + CTA directo a la pantalla preparada; los hechos con "Hecho", los futuros plegados
  y alcanzables. Bienvenida de DISA con momentum según avance; motion sutil (`prefers-reduced-motion` respetado). Cada
  paso se marca **solo** (derivado del estado); con los 3 hechos el dashboard NO pasa `onboarding` → el panel **se retira
  solo** y el Inicio vuelve al home normal. Reutiliza pantallas/acciones existentes (empresa, clientes, facturas); `?nuevo=1`
  abre directo el alta de cliente. Solo presentación + lectura de estado: sin tocar lógica/datos/permisos de
  empresa/clientes/facturas. **Verificado** en navegador con un tenant nuevo provisionado y **eliminado** al terminar:
  0/3→1/3→2/3→panel retirado (completando cada paso real, factura vía `createInvoice`); negocio configurado (desarrollo)
  **sin panel** → regresión 0; 0 errores JS. 3 ficheros: `dashboard.js`, `disaHome.html.js`, `clients.js`.
### U7 — Enlaces rotos e inconsistencias de navegación  ✅ HECHO (2026-07-08)
Encargo del dueño: revisar enlaces que no llevan a ningún sitio e incoherencias del menú.
- Auditoría: se enumeraron las **98 rutas GET reales** del admin (montando `mountRoutes` e inspeccionando
  `app.routes`) y los **288 destinos de navegación** del código (`href=`, `href:`, `location.href`, `redirect()`);
  cruzados entre sí y **verificados en vivo** los 33 destinos del menú con sesión de owner.
- Arreglado (3 ficheros: `layout.js`, `change-password.js`, `security.js`):
  1. **404 real**: el menú de la cuenta tenía "Datos del negocio" → `/admin/settings/company`, que solo existe
     como API (`/api/erp/settings/company`). Además "Ajustes" → `/admin/settings` era **la misma pantalla**
     ("Configuración Empresa"), y ambas compartían `key: 'settings'` → marcaba dos items activos. Fusionadas
     en una sola entrada: **Datos del negocio → `/admin/settings`**.
  2. **"Mi cuenta" era la pantalla-cerrojo**: `/admin/change-password` es donde `core/auth.js` encierra al
     usuario con `must_change_password=1`, y mostraba "debes cambiar tu contraseña antes de continuar" también
     al entrar por el menú. Ahora ese aviso **solo sale cuando hay cerrojo**; la pantalla es "Mi cuenta"
     (identidad: nombre · email · rol + cambiar contraseña) y el cambio voluntario vuelve a ella con confirmación.
  3. **La contraseña se cambiaba en dos sitios** con dos implementaciones: `POST /admin/change-password` y
     `POST /admin/security/change-password`; la de Seguridad **no registraba en Actividad**. Retirada esa
     segunda. Reparto (decisión del dueño: separadas): **Mi cuenta = contraseña** (todos los roles) ·
     **Seguridad = 2FA** (owner/admin en el menú). Necesario porque Seguridad está gateada a owner/admin y un
     empleado se quedaba sin forma de cambiar su contraseña.
  4. `logActivity` en el cambio de contraseña usaba mal la firma (frase en `entity`, `action='password_change'`);
     alineado con la convención del resto (`action` = frase humana, `entity` = tipo, `entityId` = id).
- **Verificado** end-to-end con un usuario `employee` de prueba creado y **eliminado** al terminar: cerrojo
  redirige y muestra el aviso · cambio forzado → 2FA · cambio voluntario → vuelta a Mi cuenta · ambos registrados
  en Actividad · Seguridad sin formulario de contraseña · `POST /admin/security/change-password` → 404 y sin
  efecto · menú del owner con las 5 entradas correctas. Barrido final: **0 enlaces rotos**.
- Encontrado y NO tocado (sin encargo): **`/admin/security` no tiene `requirePerm` en el GET** — solo se oculta
  del menú vía `roleFilters` (owner/admin), así que un empleado llega escribiendo la URL. → **Eje C (Seguridad)**.
- Encontrado y NO tocado (decisión del dueño: "se abordarán luego"): tres pantallas vivas (200) sin enlace en
  ningún menú → `/admin/analytics` ("Analítica"), `/admin/discounts` ("Descuentos"), `/admin/tags` ("Etiquetas").
  `navPerms.analytics` (`layout.js`) existe sin item que lo use.
- Nota: el reparto del punto 3 (Mi cuenta = contraseña · Seguridad = 2FA) quedó **superado por U8**, que
  consolida datos + contraseña + 2FA en la pantalla nueva `/admin/perfil`.

### U8 — Pantalla "Perfil de usuario"  ✅ HECHO (2026-07-08)
Encargo del dueño: datos personales del usuario logueado, separados de "Datos del negocio" (empresa).
- **Nuevo**: `modules/erp/routes/perfil.js` (`/admin/perfil` + `/api/erp/perfil`) y `modules/erp/paises-telefono.js`
  (74 prefijos E.164 + 9 idiomas). Estructura de 3 tarjetas: Datos personales · Contraseña · Verificación en
  dos pasos, con el patrón `card`/`form-row`/`form-group` de `/admin/settings` y los tokens de U1.
- **Migración aditiva** (`addCol`, sin `DROP`): `apellidos` (`''`), `telefono` (`''`), `pais_telefono` (`'+34'`),
  `idioma` (`'es'`), `foto_url`. **`apellidos` NUNCA se deriva de `name`**: partir un campo libre por el primer
  espacio inventa apellidos falsos ("María del Carmen Pérez" → "del"). Arranca vacío, lo rellena el usuario.
- **Contraseña**: extraída a `core/auth.js` → **`changeOwnPassword()`, fuente única** (bcrypt 12, cierre de las
  demás sesiones, registro en Actividad). La consumen `/admin/perfil` y la pantalla-cerrojo. No se reimplementa.
- **Foto**: sube por `attachments.js` con `kind='user_photo'`; la sirve `GET /api/erp/perfil/foto/:id`, que
  **filtra por ese `kind`** — si no, sería una puerta trasera para leer adjuntos de facturas de proveedor pasando
  otro id. La foto anterior no se destruye, solo deja de referenciarse. El avatar del sidebar la usa.
- **`idioma` GUARDA la preferencia pero HOY NO TRADUCE NADA**; la pantalla se lo dice al usuario. El motor de
  i18n real es tarea aparte (ver cola abajo).
- **2FA consolidado**: único sitio, Perfil. Hallazgo que corrigió el supuesto del encargo: **no había dos estados
  que migrar**. Los dos `pendingTOTPStore` son `Map()` en memoria (secreto pendiente durante el alta); ambas
  implementaciones escribían las MISMAS columnas (`totp_secret`/`totp_enabled`), que es lo que lee el login.
  Consolidar fue mover UI. `/admin/security` → **302 a `/admin/perfil`** (no 404: `disa/index.js` le dice al
  usuario "ve a /admin/security"). Retirada la tarjeta 2FA de "Datos del negocio" (`settings.js`).
- **Menú de cuenta**: Perfil · Datos del negocio · Usuarios · Actividad. `/admin/change-password` sigue viva
  como **pantalla-cerrojo** de `core/auth.js:156` (fuera del menú); sin cerrojo redirige a Perfil.
- **Verificado 70/70** con usuario `employee` de prueba creado y eliminado: migración y defaults · `apellidos`
  vacío al alta · guardado campo a campo · rechazo de nombre vacío, prefijo inventado, idioma inválido, teléfono
  con letras y PUT sin CSRF (403) · foto (sube, sirve con sesión, no sin ella, rechaza PDF, no sirve adjuntos de
  otro `kind`, no destruye el adjunto al quitarla) · contraseña (bcrypt, cierra otras sesiones, conserva la
  actual, queda en Actividad) · 2FA (código malo rechazado, bueno activa y persiste, desactivar limpia secreto) ·
  **el 2FA ya activo del owner sobrevive** (secreto intacto y sigue validando códigos; Perfil lo muestra como
  Activada sin ofrecer QR nuevo) · **cerrojo intacto**. Headless: 4 pantallas 200, sin scroll horizontal a 390px,
  **0 errores JS**. `node --check` en los 9 ficheros.
- Incluye el fix del 404 de `/admin/settings/company` (U7).
- Encontrado y NO tocado: **`/admin/setup-2fa`** (`routes/auth.js`) queda huérfana y se monta **fuera del
  middleware CSRF**; sus formularios no llevan `_csrf`. Riesgo práctico mitigado por la cookie `SameSite=Lax`,
  pero es un hueco de defensa en profundidad. → **Eje C (Seguridad)**.

> **EJE A (UX) COMPLETO**: U0 (auditoría) · U1 (tokens) · U2 (vacíos/carga) · U3 (errores) · U4 (clics) · U5 (móvil) ·
> U6 (onboarding) · U7 (enlaces rotos e inconsistencias de navegación) · U8 (perfil de usuario).
> Siguiente: planificar **Eje B — DISA** (empieza por aquí en la próxima sesión).

### Cola del Eje A (fuera de encargo, NO descartadas — decisión del dueño)
- **Motor de traducción (i18n) real.** Hoy `admin_users.idioma` guarda la preferencia y la interfaz sigue en
  español (`lang="es"` hardcodeado; no hay i18n de ningún tipo en el proyecto). U8 avisa al usuario de ello en
  la propia pantalla. Cuando exista el motor, `idioma` es el campo que lo alimenta.
- **Códigos de recuperación de 2FA.** Ninguna de las implementaciones los tuvo nunca: si el usuario pierde el
  móvil, no hay salida por producto (hoy solo por intervención en BD). Necesario antes de empujar el 2FA a los
  clientes.
- **Tres pantallas vivas sin enlace** (U7): `/admin/analytics`, `/admin/discounts`, `/admin/tags`.

## Eje B: DISA (pendiente de planificar)
- **Diagnóstico de avisos/notificaciones (solo lectura, 9 jul 2026):** `docs/disa/diagnostico-avisos.md`.
  Es la **foto ANTES** del encargo de avisos; se conserva tal cual (documento fechado), pero ya no describe
  el estado actual. De sus seis hallazgos, el encargo cerró cinco (pantalla central · fuente de cobros
  vencidos · visto por usuario y por aviso · email diario programado y verificado · etiqueta del bloque
  recurrente). **Sigue abierto:** el contador no se refresca en vivo fuera de `/admin/avisos` (§3), y faltan
  las fuentes de **CRM** en riesgo y de **cumplimiento** (Verifactu, calendario fiscal). No construir sin encargo.

## Eje C: Seguridad (pendiente de planificar)

---

## Función por encargo del dueño (fuera de los ejes A/B/C)

### Verifactu · Tarea 2 (Fase A) — ENVÍO REAL a la AEAT conseguido  ✅ HECHO (2026-07-09)
Encargo expreso del dueño. El motor (`verifactu-envio.js`) y el script ya estaban probados contra el
simulador (17/17); faltaba conectar el certificado FNMT real y remitir a **preproducción**
(`prewww1.aeat.es`). Nunca contra producción. Detalle completo en `docs/verifactu/tarea2-fase-a-envio.md`.

- **Dos registros aceptados por la AEAT**, negocio `ibrahin-repuestos`, obligado `13334347M` (FNMT de
  persona física del dueño), tickets F2 de 0,48 €:

  | # | Registro | Cadena | Respuesta | CSV |
  |---|---|---|---|---|
  | 1 | `S2026-0001` | `PrimerRegistro=S` | `AceptadoConErrores` · error 2004 | `A-FA5DXLJ5HSC2ZU` |
  | 2 | `S2026-0002` | `PrimerRegistro=N` + `RegistroAnterior`→#1 | **`Correcto`**, sin errores | `A-5LE89B7EUFZ7ER` |

  La AEAT devuelve el obligado en su Cabecera: el certificado **autentica y está autorizado**. El
  segundo envío valida el **encadenamiento real** contra un registro que la Agencia ya tenía guardado.

- **Arreglo del namespace de la Cabecera** (`buildEnvelope`). `SuministroLR.xsd` declara `Cabecera`
  como elemento LOCAL con `elementFormDefault="qualified"` → vive en el namespace **`sfLR`**, aunque su
  TIPO (`sf:CabeceraType`) venga del otro esquema; de hecho `Cabecera` **no existe** en
  `SuministroInformacion.xsd`. Enviarla como `<sf:Cabecera>` provocaba
  `Codigo[4102].El XML no cumple el esquema. Falta informar campo obligatorio.: Cabecera`.
  **Validado con `xmllint` contra los XSD oficiales descargados**: reproduce el 4102 con el namespace
  malo y pasa con el bueno. (Cierra el "sin confirmar" de `tarea2-remision-aeat-investigacion.md`.)

- **Seguridad del certificado.** `.gitignore` cubre ahora `*.p12 *.pfx *.pem *.key *.jks *.crt`: antes
  un `git add -A` habría commiteado la identidad digital del dueño. La **contraseña no se escribe en
  ningún fichero**: el script la pide por teclado **sin eco** (ni historial, ni `ps`, ni
  `/etc/bamburu.env`). Y si falta `VERIFACTU_PRODUCTOR_*` el script **para en seco** en vez de avisar:
  el motor marcaba cada registro `bloqueado_datos` y no salía ni una petición — el aviso engañaba.

- **El `.p12` del Llavero de macOS no lo abre Node**: cifra los certificados con RC2-40, que OpenSSL 3
  dejó en el proveedor *legacy* → `Unsupported PKCS12 PFX data`, antes de tocar la red. Se reconvierte a
  PKCS#12 moderno (AES-256 + MAC SHA-256). Se descarta `node --openssl-legacy-provider`: habría que
  ponerlo también en `bamburu.service` y reactivaría RC2/RC4/DES en todo el proceso de producción.

- **⚠️ Hallazgo estructural — la ventana de 240 s.** `FechaHoraHusoGenRegistro` va DENTRO de la huella,
  así que queda congelada al emitir; la AEAT exige que esté a ±240 s de SU reloj cuando recibe (error
  2004). Medido: 376 s de hueco → `AceptadoConErrores`; 0 s → `Correcto`. Reloj del servidor verificado
  contra la AEAT (**+1 s**, NTP sincronizado): no era un desvío. **Consecuencia: la cola + timer por
  negocio deja de ser una mejora y pasa a ser un requisito** para remitir en verde.

- **Fuera de alcance, para encargos propios:**
  - **Fase B legal** — colaboración social (Convenio tipo 17), declaración responsable (art. 13 RD
    1007/2023), elección de certificado (propio-por-todos vs. Anexo II por cliente).
  - **Cola + timer de envío automático por negocio** — confirmado NECESARIO por el hallazgo de los 240 s.
  - **Bug de selección de cadena por id** (`verifactu-envio.js:347`): elige el registro anterior por id
    sin filtrar por emisor. **Latente**: `company_config` es singleton (un obligado por BD) y se verificó
    sobre los 61 registros reales (0 desajustes, 0 cruces). Solo mordería si un negocio cambiase de NIF
    teniendo ya registros.
  - **Subsanación del 2004** con un alta `Subsanacion=S` sobre `S2026-0001`.
  - Envío de **anulaciones** (hoy Fase A solo remite altas).

- **Evidencia que se conserva:** `helados-ibrahin` guarda su registro 1 en `incorrecto` con el error
  1239 (NIF de destinatario ficticio, no identificado en el censo real de preproducción). No se toca.

### Rendimiento · Opción A — coste de bcrypt y frenos de peticiones  ✅ HECHO (2026-07-09)
Encargo expreso del dueño a partir de `docs/rendimiento/diagnostico-carga.md` (que se guarda aquí con
este commit: no estaba en el repo). **Solo la opción A.** Las opciones B (varios procesos con afinidad)
y C (sacar la BD del hilo principal) quedan sin tocar, tal como pidió el dueño.

- **bcrypt de coste 12 → 10** (`core/auth.js`, constante `BCRYPT_COST`, fuente única). Medido en el banco
  aislado: el login pasa de **3,9 a 15,8 req/s** (p50 259 → 63 ms) a concurrencia 1, y de **15,3 a 59,8
  req/s** (p50 1010 → 263 ms) a concurrencia 16. **~4×**, justo lo que predecía el informe ("50-60
  logins/s"). Sigue por encima del mínimo de OWASP.
- **Migración al vuelo, sin resetear nada.** `verifyPassword` solo marcaba `needsRehash` para los hashes
  del sistema viejo (sha256): un hash bcrypt devolvía SIEMPRE `false`, así que bajar la constante no
  habría migrado a nadie. Ahora lee el coste del propio hash (`bcrypt.getRounds`) y renueva si difiere del
  vigente — vale para subir y para bajar. Verificado: 50 dueños a `$2b$12$` acabaron en `$2b$10$` tras un
  login; una contraseña **incorrecta** no renueva nada; el sha256 legado sigue migrando.
  - El coste estaba además escrito a mano en `models.js` (admin de arranque) y `scripts/reset-admin.js`,
    ambos creando contraseñas nuevas. Los dos leen ya `BCRYPT_COST`. Un negocio nuevo nace a `$2b$10$`.
- **Freno general: NO se mueve, sube el tope de 100 → 600/min por IP.** Ponerlo detrás de
  `tenantMiddleware` (para tener clave negocio+IP) dejaría `/`, `/acceso`, `/docs`, `POST /find-tenant` y
  `GET /admin/autologin` **sin freno ninguno** — y `/find-tenant` es justo la que hay que blindar. El 600
  sale de medir: una carga de página del admin cuenta **2,8 peticiones** (5 la más pesada,
  `/admin/analytics`), y una oficina de 5 empleados tras un NAT genera 133 req/min — con el tope de 100
  disparaba **21 respuestas 429 con tráfico normal**. Con 600: 0 con 5 empleados, 0 con 10, y una
  avalancha de 4.467 req/min sigue cortada (599 servidas, 1.633 bloqueadas).
  - *(Nota: el informe decía "~9 llamadas a `/api/` por página". Hoy son 2,8 de media.)*
- **`POST /find-tenant` estrena freno propio** (10/min + 60/hora por IP). Es una ruta sin autenticar que
  resuelve email → negocio y distingue acierto de fallo (404): oráculo de enumeración. Y es cara:
  `getTenantsByEmail` **abre la BD de cada negocio activo** (57-67 ms con 50). De 99 sondas/min a 10.
- **El freno respondía HTML a un endpoint JSON.** `/find-tenant` se llama por `fetch` + `await r.json()`;
  el 429 salía como página y el usuario leía *"Error de conexión"*. `core/rate-limit.js` responde ahora
  JSON a quien manda JSON (o pide `Accept: application/json`); una navegación normal sigue recibiendo la
  página. No se ha tocado ningún límite de los frenos que ya iban bien (login, DISA, tienda, alta).
- **Banco de pruebas** (`:3999`, `data/` propia, 50 negocios, snapshot restaurado y reinicio entre
  escenarios, **nunca contra producción**). Reprodujo la línea base del informe antes de tocar nada (3,9
  req/s · p50 259 ms frente a los 3,9 · 261 publicados), así que la mejora es del cambio, no del medidor.
- **Fuera** (registrado): separar el cupo **por persona** dentro de un mismo negocio (hoy la clave del
  freno general es solo la IP; los compañeros de una oficina comparten cubo) · `superadmin/index.js:94`
  usa `verifyPassword` pero **ignora `needsRehash`**, así que esa contraseña no migrará nunca · cada 429
  hace un INSERT en `control.db` (`recordSecurityEvent`): una petición bloqueada cuesta más que una
  servida · hallazgo 1 del informe (un negocio con la BD bloqueada congela a los demás 5 s) · opciones B y C.

### Avisos — pantalla central, cobros vencidos, visto por usuario y correo diario  ✅ HECHO (2026-07-09)
Encargo expreso del dueño a partir de `docs/disa/diagnostico-avisos.md`. **Aditivo y reversible**: no se
toca el hash de facturas, ni el stock, ni la lógica de los motores que ya calculan cada aviso
(`pagos.js` / `cobros.js` / `recurrentes.js`). Este encargo los concentra y los muestra bien.

- **Pantalla central `/admin/avisos`** (`routes/avisos.js`). Se sirve vacía y pide `/api/erp/avisos` al
  abrirse → **recalcula en vivo**, nunca hay un número guardado que se quede viejo. **Se RESUELVE aquí**:
  cada fila abre el MISMO modal compartido que su pantalla de origen (`cobro-modal` / `pago-modal` /
  `stock-modal`), que pega al único endpoint validado. Cero lógica de negocio duplicada. Al guardar, el
  aviso desaparece y el contador baja sin recargar. Botones **gateados por permiso**
  (`cobros.manage` · `purchases.create` · `inventory.edit`); sin permiso, enlace de solo lectura.
  - **Excepción deliberada:** el borrador recurrente NO se emite desde una fila (crea una factura con
    valor legal + cadena de hash) → enlaza a `/admin/recurrentes` a revisarlo. Confirm-first.
- **Fuente nueva `cobrosVencidos`** (`avisos.js`), una función más en `SOURCES`. Se apoya en `openDebts()`
  de `cobros.js` — ese motor ya decide qué factura cuenta como deuda y cuál está vencida; aquí solo se
  filtra y se normaliza. Aparece en pantalla, campana, Inicio y correo. Etiqueta del bloque
  `factura_recurrente` en el email, que faltaba (§6 del diagnóstico).
- **"Visto" por USUARIO, no por negocio** (`alert_seen` era singleton `CHECK (id=1)`: si uno los abría,
  quedaban vistos para todos). Tabla nueva `alert_seen_user (user_id PK, fingerprint, seen_at)`, sembrada
  una vez desde la huella vieja para que nadie vea el badge en rojo de golpe. **`alert_seen` NO se toca ni
  se borra**: revertir el código restaura el comportamiento anterior con su estado.
  - **Visto POR AVISO**: cada fila (y cada item del panel) se marca/desmarca por separado; también
    "marcar todos". Abrir la pantalla NO marca nada: el visto lo decide el usuario.
- **Señales consolidadas: de 7 sitios a 2.** Se retiran el contador del pin de DISA y el badge flotante
  "N alertas". Queda **la campana del topbar** — que ahora **abre un panel** de notificaciones con su
  "Visto" por aviso y su "marcar todos" (antes era un `<div>` decorativo, sin destino y con el punto rojo
  encendido siempre) — y **la tarjeta "Avisos" del Inicio**, ahora clicable (era un `<div>` muerto).
  El punto de la campana cuelga del **estado**, no del conteo: rojo = algo sin ver · gris = pendientes ya
  vistos · ausente = nada.
- **Correo diario, de verdad.** Existía `scripts/bamburu-avisos.mjs` pero **nunca se programó** y apuntaba a
  `User=ibrahin`. Timer systemd instalado y activo (`User=ubuntu`, `OnCalendar=*-*-* 08:00:00 Europe/Madrid`
  — la zona va explícita porque el servidor corre en UTC). **Causa raíz que el diagnóstico no vio:**
  `company_config.email` estaba **vacío en los cinco tenants** → el script salía con código 0, `fallos=0` y
  **0 correos**. Verificado con envío real: fila en `daily_alert_log` + correo recibido; segunda ejecución
  no reenvía (idempotencia por día).
- **Gates** (94 aserciones, navegador real): `test-pago-voz-avisos.mjs` (47) · `gate-avisos-badge.mjs` (24,
  señal única + estado + aislamiento por usuario) · `gate-avisos-pantalla.mjs` (23, **pulsa los botones**:
  registra un cobro y lo deshace, marca visto por aviso, abre el panel de la campana).
- **Fuera** (registrado): la campana **no baja sola** al resolver algo en Cobros/Pagos sin navegar (§3 del
  diagnóstico; ahora que existe `window.bellSync` es un `fetch` por pantalla) · fuente de **CRM** en riesgo ·
  coste de `estadoAvisos()` en cada render (4,05 ms con 72 facturas, de los que 3,06 ms son `openDebts()`;
  es lineal en nº de facturas y `layout.js` lo llama en TODA página admin).

### CRM comercial — embudo de oportunidades + actividad de cliente  ✅ HECHO (2026-07-09)
Encargo expreso del dueño (estaba en el roadmap futuro). **Motor primero, DISA después** (RITUAL): esta
tanda cierra el motor y las pantallas; la voz de DISA queda para el Eje B.

- **Investigación en fuente oficial** (`docs/crm/embudo-referencia.md`, verificada, no de memoria; lo no
  comprobable va marcado NO VERIFICADO): Salesforce, HubSpot, Pipedrive, Holded (competidor directo ES).
  Decisiones que salen de ahí:
  - **Estado separado de la etapa** (`status ∈ activa|ganada|perdida`, ortogonal a `stage`), como Pipedrive
    y Holded. Ganada/Perdida NO son etapas → al cerrar se **conserva la etapa** en la que se cayó (métrica
    real para un autónomo), sin columna extra. Reabrir existe (un drop por error no es callejón sin salida).
  - **4 etapas abiertas** 10/30/60/85 % (Nuevo contacto · Cualificado · Presupuesto enviado · Negociación).
    Interpolación razonada entre SF y HS; se descartan las etapas "evento de calendario" de PD/HS (venta SaaS).
  - **Motivo de pérdida híbrido** (picklist + texto libre; «Otro» exige nota). Hallazgo: ningún CRM trae
    lista por defecto → la nuestra es propuesta razonada, y así consta en el código.
  - **Origen** anclado en `LeadSource` de Salesforce (única lista verificable en doc oficial), podado.
- **Migración aditiva, sin DROP** (`models.js`): dos tablas nuevas `opportunities` + `client_activities`
  (hermana de `collection_actions`, sin `invoice_id`). `stage` sin CHECK a propósito (cambiarlo obligaría a
  recrear=DROP); la lista cerrada la validan zod + servicio (fuente única en `crm.js`). Permisos propios
  **`crm.read` / `crm.manage`** (no se reutiliza `clients.*`): a Admin y Seller; owner/admin hacen bypass.
- **Motor** (`modules/erp/crm.js`, espejo de `cobros.js`): próxima acción por **silencio vs cadencia de la
  etapa**; **compromiso** pospone (espejo de la promesa de pago); **en_riesgo** si venció el cierre previsto;
  priorización explicable (cada fila con su `motivo`); worklist + embudo con **previsión ponderada** (Σ
  valor×prob); **timeline unificado** (oportunidades + actividad + cadena documental + cobros); email de
  seguimiento por Resend (mismo mailer, `replyTo` al dueño, confirm-first). Todo por **servicio validado**
  (la única vía de escritura, la que usará DISA).
- **Pantallas** (`routes/crm.js`, `/admin/crm`, menú "Oportunidades"): **Embudo** (Kanban con drag&drop
  nativo; soltar en Ganar/Perder abre el cierre, que exige motivo) y **Cola de trabajo** (lo más urgente
  arriba, con su porqué). Reutiliza tokens/U2/U3; cero azules nuevos.
- **Ficha de cliente**: nueva sección **"Actividad y oportunidades"** (summary + timeline) que da superficie
  a dos endpoints que quedaban colgantes. El timeline llega **troceado por permisos** desde el servidor
  (`crm.read` NO revela facturas/cobros sin su llave — se cerró esa puerta trasera en la ruta).
- **Fuera** (registrado): la **voz de DISA** sobre el embudo (Eje B) · registrar actividad desde la propia
  ficha (hoy se gestiona en `/admin/crm`) · agenda/calendario del roadmap.
- **Verificado**: motor `scripts/verify-crm.mjs` **44/0** (crear/mover/cerrar ganada+perdida+motivo/reabrir,
  cadencia, compromiso, en_riesgo, worklist/ponderado, actividad, timeline+troceo por permisos, archivar,
  migración idempotente) + **smoke navegador real** (embudo, cola, ficha) con la oportunidad creada por el
  API real: 4 columnas, KPIs, tarjeta, cola priorizada y la sección de la ficha con su línea de tiempo,
  **0 errores JS** (solo el 404 de `/favicon.ico`, ajeno y de toda la app). Aditivo y reversible.
- **Arreglo (2026-07-09, tras prueba del dueño)**: el selector de cliente del modal de oportunidad no dejaba
  ni **elegir clientes ya registrados** ni **avanzar si el cliente no existía**. Dos causas y sus arreglos:
  - Era **buscar-y-solo-al-teclear-≥2**: si no tecleabas, no veías a nadie que elegir. Ahora es un
    **combobox**: al **enfocar** el campo muestra tus clientes para elegir; teclear filtra. La selección va
    en **`mousedown` + preventDefault** (se elige antes de perder el foco: inmune al cierre-por-blur que no
    aparece en pruebas headless) y **cierra al salir** del campo (no tapa el resto del formulario).
  - Era **buscar-o-nada**: si el cliente no existía, callejón sin salida. Ahora **crea el cliente en línea**
    (nombre + email/teléfono + tipo → `POST /api/erp/clients`, permiso `clients.create`); el desplegable
    ofrece "Crear «X»" siempre y en el vacío.
  - El modal se **unificó** en un solo sitio (`oppModalHtml`, antes duplicado en las dos vistas). Nombres de
    cliente **escapados** (`escHtml`) en el desplegable (hay filas de prueba con payloads XSS en el tenant
    dev: se pintan como texto, no ejecutan).
  - **Verificado** en navegador real: selector 17/0 (elegir registrado + crear nuevo, **escritorio y móvil
    390px**) + combobox 7/0 (enfocar muestra lista · mousedown elige · teclear filtra · blur cierra). 0
    errores JS.

---

> **Fase actual: OPTIMIZACIÓN** (CANON v2 §4) sobre tres ejes — UX, DISA, Seguridad. Las funciones
> nuevas ceden prioridad al pulido salvo decisión del dueño. **Cuándo salir al mercado lo decide el
> dueño**; el asistente y Code no lo recomiendan.
> **Fuente única de tareas: este archivo.** Notion es solo panel (KPIs, tiempo, "dónde sigo").
> **Histórico de lo ya construido** (piezas cerradas, decisiones D1–D6, estructura NÚCLEO/SUELO/FOSO):
> `docs/contexto/piezas-cerradas.md` y el resto de `docs/contexto/`, más el TABLERO anterior en `git log`.

## Backlog / otras capas
Todas las tareas pendientes anteriores, **conservadas**. No se inician sin encargo del dueño; en la
fase actual ceden prioridad a la optimización (Ejes A/B/C).

### Contabilidad y cumplimiento fiscal
- **Verifactu — envío real a la AEAT:** la Fase A (motor SOAP+mTLS, probado contra simulador) está hecha; falta disparar el envío real a preproducción/producción cuando el dueño aporte su **certificado FNMT** (`VERIFACTU_CERT_PATH`/`VERIFACTU_CERT_PASS` + NIF/NombreRazón del productor). Comando: `scripts/verifactu-enviar-preproduccion.mjs`.
- **Verifactu — Fase B (legal):** colaboración social (Convenio tipo 17), declaración responsable, y elección de certificado (propio-por-todos vs por-cliente, modelo del Anexo II). Ampliaciones técnicas: envío de **anulaciones** (hoy solo altas), **cola + timer por tenant** (control de flujo `TiempoEsperaEnvio`), validación XSD formal.
- **Facturae — motor de generación del XML ✅ HECHO (2026-07-08).** Ver `docs/facturae/investigacion.md`.
  - **Investigación** verificada en fuente oficial (XSD 3.2.2 descargado y parseado, política de firma v3.1
    extraída del PDF, WSDL de FACe descargado en vivo, BOE consolidado). Vigente: **Facturae 3.2.2**.
  - **Motor** (nuevo, `modules/erp/facturae/`): `modelo.js` (modelo NEUTRO de factura, sin XML) →
    `facturae322.js` (serializador) + `iso-paises.js`. La separación existe porque el **RD 238/2026**
    (BOE 31-03-2026) obliga a remitir una copia en **UBL** a la solución pública: UBL será otro
    serializador sobre el mismo modelo, no un proyecto nuevo.
  - **Migración aditiva**: `clients.postal_code/province` · `company_config.postal_code/city/province`
    (faltaban: sin dirección del EMISOR ninguna factura podía ser válida) · snapshot en `invoices` de
    CP/municipio/provincia/país de ambas partes · `invoices.tipo_factura`.
  - **Mapeo decidido** (no hay tabla oficial): F1→`FC`+`OO` · F2→`FA`+`OO` (bloqueada igual: sin
    destinatario identificado) · **F3→`FC`+`OO`, NO `OC`** (una recapitulativa agrupa varias operaciones
    de un periodo; la F3 sustituye un único ticket) · R1–R5→`FC`+`OR`+`Corrective`. `ReasonCode`:
    R1/R4/R5→`16`, R2/R3→`85`. `CorrectionMethod`: `S`→`01`, `I`→`02`. El código AEAT se conserva en
    `AdditionalReasonDescription`. `PersonTypeCode` se DERIVA del NIF (sin columna nueva, sin snapshot
    que se desincronice); `ResidenceTypeCode` del país; el NIF solo se prefija con el país en
    intracomunitarias. `UnitOfMeasure` se omite (es `[0..1]`).
  - **UI**: bloque plegado "Añadir dirección fiscal completa" en la ficha de cliente (opcional, no toca
    el alta normal) · CP/municipio/provincia en Datos del negocio · botón **"Generar Facturae"** en la
    ficha de factura con tres estados: congelado → normal; sin snapshot pero cliente completo hoy →
    genera **con aviso visible**; datos incompletos → sin botón, dice qué falta y enlaza a arreglarlo.
    XML sin firmar, descargable, archivado vía `attachments.js` (`kind='facturae_xml'`).
  - **Tres supuestos del encargo resultaron falsos** y se corrigieron: (a) `tipo_factura` NO era
    transitorio — ya se persistía en `verifactu_registros`; se hizo **backfill** en vez de perderlo.
    (b) `InvoiceTotal` **SÍ descuenta la retención** (el XSD lo dice literal); `TotalTaxesWithheld`
    (IRPF) ≠ `AmountsWithheld` (retención de garantía) → los tres totales coinciden y valen
    `invoices.total`. (c) `company_config` no tenía dirección estructurada.
  - **El XSD cazó un bug del serializador**: `ReasonDescription` y `CorrectionMethodDescription` son
    **enumeraciones**, no texto libre.
  - **Verificado**: 55/55 (lógica + validación contra el XSD oficial con `xmllint`, sobre una COPIA de la
    BD) y 26/26 (HTTP + navegador). Tres facturas reales validadas: F1 con snapshot (2 tipos de IVA +
    IRPF; cambiar la dirección del cliente después NO contamina el XML), factura vieja sin snapshot con
    cliente completado hoy (genera + aviso), cliente incompleto (bloqueo + 409). Aritmética:
    1.100 + 220 − 165 = **1.155,00** en los tres totales. Rectificativa con `Corrective`. Ticket F2
    bloqueado. Total manipulado → se niega a generar. **0 errores JS**. BD real intacta.
  - **Hallazgo**: 8 facturas (las anteriores a Verifactu) tienen `invoice_items.tax_rate=0` mientras la
    cabecera declara 21%. Se **bloquean con mensaje propio**: reconstruir el desglose desde la cabecera
    sería inventarse el reparto por tipos en un documento con valor legal.
- **Facturae — firma y envío (BLOQUEADO por certificado).** Firma **XAdES-EPES** enveloped, política v3.1
  (`SigPolicyId` con la URL literal `.es`, no `.gob.es`). **Buena noticia verificada: NO exige certificado
  de persona jurídica ni sello de empresa** — el FNMT de persona física del dueño sirve para firmar sus
  propias facturas. Ojo: son DOS certificados distintos — el que firma la factura (del emisor) y el que
  autentica el webservice de FACe (hay que darlo de alta en el portal de proveedores). Extensión `.xsig`.
  FACe exige además **tres códigos DIR3** en `BuyerParty` (oficina contable · órgano gestor · unidad
  tramitadora) que aporta el cliente de la Administración. Endpoints (WSDL descargado en vivo):
  prod `https://webservice.face.gob.es/facturasspp?wsdl` · pruebas `https://se-face-webservice.redsara.es/facturasspp?wsdl`.
  **Sin confirmar**: que FACe valide contra XAdES 1.3.2 (la página está tras WAF; no la leí en fuente).
- **Facturae — serializador UBL (pendiente).** RD 238/2026: quien no use la solución pública debe remitir
  «una copia electrónica fiel de cada factura en la sintaxis UBL». La arquitectura ya lo deja preparado.
- **Contexto legal verificado (BOE):** el umbral de **5.000 €** de la Ley 25/2013 art. 4 sigue vigente, pero
  es una **facultad** de cada Administración para excluir por reglamento, no una exención automática. Y un
  **autónomo (persona física) NO está en la lista de obligados** a)–f): para el público de Bamburu la
  e-factura a la Administración es un derecho, no un deber (salvo que la Administración concreta la exija).
- **Balance de Situación:** requiere pieza previa de **saldos de apertura + capital + capitalización de inmovilizado** (escritura de apuntes); decisiones de datos del dueño.
- **Cuentas anuales y legalización de libros.**
- **Plan de cuentas con subcuentas.**
- **Asientos de amortización al diario:** la Pieza 3 (bienes de inversión) calcula la amortización en lectura; volcarla al diario como asiento es pieza aparte.
- **Modelos AEAT siguientes:** 111/115/123 (retenciones), 349 (intracomunitario), 347 (operaciones con terceros), 390 (resumen anual IVA), 200/202 (Sociedades). *(303/130 ✅, Pieza 4.)*
- **IRPF en compras:** hoy solo se modela el IRPF soportado en ventas.
- **Acceso de la gestoría:** compartir la contabilidad por permisos de rol.
- **Mejoras de la pantalla de libros:** drill-down al documento/asiento de origen al pinchar una fila; buscar (nº factura/NIF) y filtrar por tipo de IVA, cliente/proveedor y estado de cobro/pago; cuadro-resumen por tipo de IVA; bloqueo de periodo presentado (estado borrador/presentado); asiento resumen para tickets del mismo día y tipo.
- **Conciliación bancaria:** **CSV genérico** de extracto (añadido barato); **PSD2 / Enable Banking** como fuente automática futura (la costura ingesta↔cruce ya lo prevé).

### Ventas, portal y recurrentes
- **Portal de cliente — pago online (tarjeta):** pasarela (Stripe u otro); necesita decisión de proveedor y coste del dueño. **Único paso que falta del portal.**
- **Portal de cliente — acceso admin al enlace:** mostrar/copiar el enlace del portal desde el admin (hoy solo se envía por email).
- **Portal de cliente completo (roadmap):** que el cliente vea y **acepte presupuestos** y haga **pedidos B2B con carrito**.
- **Facturas recurrentes — auto-emisión sin revisar:** interruptor opcional por-plantilla (hoy siempre genera **borrador** para revisar y emitir con un clic).
- **PDF + email de cada documento:** hoy solo el presupuesto envía PDF por email.
- **Plantillas de documento personalizables.**

### Inventario (Pilar 3 — pulido)
- **Stock mínimo / punto de pedido.**
- **Trazabilidad por lote / nº de serie.**
- **Sync e-commerce** (Shopify / Woo / Prestashop) — Capa 2.

### Multiusuario / permisos
- **Administración de permisos por DISA (registrada, 2 pasos EN ORDEN).** *Paso 1 — Fundamento:* repasar TODAS las rutas/servicios de los pilares y confirmar que cada acción exige el permiso correcto (`requirePerm`), no solo sesión, con un modelo de permisos limpio agrupado por áreas. *Paso 2 — DISA administra hablando:* el dueño gestiona usuarios/accesos por conversación y DISA lo traduce vía servicio validado (DISA nunca escribe permisos directo; patrón T5/cobros). El Paso 2 no arranca sin el Paso 1 cerrado.

### Riesgos / decisiones abiertas
- **D3 · [riesgo legal a resolver] Documento de pedido titulado "FACTURA" que no es la factura Verifactu** (`routes/orders.js:442`). Quedó neutralizado al desmontar `orders.js` en PIEZA C; verificar que ya no es alcanzable y decidir renombrar/retirar/aclarar. *Estado: revisar.*
- **D6 · [a verificar] XSS en páginas públicas de la tienda** (HTML guardado por admin sin escapar). La tienda está apagada de forma reversible (D1); revisar antes de reabrir en Capa 2. *(El bug de fuga de stock de `cancel_order` ya quedó resuelto al archivar `sales_orders`, D4.)*

### Deuda técnica
- **Arreglar `scripts/gate-avisos-badge.mjs`:** falla por una ruta de BD fija inexistente en el checkout actual (ambiental, ajeno a la lógica); reescribirlo para usar BD temporal como el resto de gates.
- **DISA `create_order` multi-línea:** limitación heredada de la base e-commerce; los pedidos multi-línea entran con el flujo pedido→albarán→factura.

### Roadmap futuro — módulos (decisión del dueño, NO iniciar sin encargo)
DISA como producto proactivo · **Citas / Agenda** (🔺 prioritaria) · CRM comercial (**embudo/oportunidades ✅ HECHO 2026-07-09**; agenda/calendario pendiente) · Control horario (registro de jornada) · TPV / POS módulo completo · Parte de obra · Cobro recurrente + domiciliación SEPA · Telegram como canal · Mapas (OpenStreetMap) · Documentos / suite ofimática ligera · App móvil nativa · API pública / webhooks · Integraciones / marketplace · Dashboards personalizables · Multiempresa · Fabricación · Multi-moneda · Firma digital de documentos · Previsión de caja 3/6/12 meses · Proyectos / rentabilidad · Partes de horas · Servicio de campo / órdenes de trabajo · Helpdesk.

### Auditoría Bamburu vs Holded (9 jul 2026) — módulos y mejoras nuevas
> Origen: **auditoría Bamburu vs Holded del 9 jul 2026**, repaso con el **manual funcional completo de
> Holded** (más detallado que la auditoría del 4 jul 2026). Solo documentación, sin fecha comprometida.

- **RRHH:** ficha de empleado (datos fiscales/contrato) + nóminas + organigrama. Se suma al **control
  horario** que ya estaba anotado en El Foso.
- **Proyectos:** gestión de tareas internas tipo kanban — distinto del **CRM** ya registrado.
- **Analítica:** módulo de informes predefinidos por área (ventas, compras, clientes…) + **plan financiero**
  (objetivos vs. real). Va más allá de los KPIs sueltos del panel actual.
- **Mejoras menores de UX/plataforma** (sin pilar propio, encajar donde toque): importar contactos en bloque
  desde archivo · buzón de email propio para reenviar tickets de gasto · calendario fiscal de vencimientos ·
  búsqueda global + botón de creación rápida universal + sidebar personalizable.

---

> El detalle completo de cada módulo del roadmap, de las decisiones registradas (D1–D6) y de todas las
> piezas ya cerradas se conserva en `docs/contexto/` y en el historial de `git` (TABLERO anterior).
