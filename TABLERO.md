# TABLERO — Fase de optimización

> **DÓNDE ESTAMOS HOY (2026-07-10).** Eje A (UX) **completo**. Multi-almacén **cerrado** (las tres capas;
> los traslados se verificaron el 10-jul: el valor del inventario no cambia al mover stock). Módulo de
> **Avisos al 100 %** (contador en vivo + fuente "cliente en riesgo"; el bucle de la campana, arreglado).
> **Verifactu para clientes NO es "activar la cola"**: el plan es **colaborador social** (un único
> certificado de Bamburu + autorización de representación del cliente), y está **aparcado** hasta tener la
> plataforma al 100 % — ver `docs/contexto/decisiones.md` (2026-07-10).
>
> **SIGUIENTE BLOQUE GRANDE: planificar el Eje B — DISA.** Empieza por ahí.
>
> **Inventario (Pilar 3) NO está cerrado, y no es un cabo suelto:** es alcance pendiente del pilar —
> **stock mínimo / punto de pedido** y **lote / nº de serie**. Ver el Backlog.

## Eje A: UX  ✅ COMPLETO (U0–U9)
Objetivo: acercar cada pantalla y flujo a "el dueño no opera, decide". Método: auditoría primero, luego ejecución en piezas pequeñas. Cada tarea define cómo se verifica y cierra con regresión 0.

### U0 — Auditoría UX global  ✅ HECHO (2026-07-05) — `006cf6a`
Recorre TODAS las pantallas del admin y del portal y produce un inventario real, sin cambiar nada: pantallas y su estado; incoherencias visuales (tipografía, espaciado, colores, componentes repetidos distintos); flujos clave y nº de clics de cada uno; pantallas sin estado vacío / sin estado de carga; mensajes de error genéricos; qué se rompe en móvil.
Hecho cuando: existe docs/ux/auditoria-ux.md con la lista concreta priorizada, y de ahí salen U1–U6 con datos reales.

### U1 — Sistema visual coherente (design tokens)  ✅ HECHO (2026-07-05) — `4332be4`
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
> *(U7 dejó "Datos del negocio" del menú de cuenta apuntando a `/admin/settings`; U8 lo consolidó en
> `9cf2e46`. Reverificado en navegador el 10-jul: HTTP 200 en los tres negocios, y ninguno de los 34
> enlaces del chrome del panel da 4xx.)*

### U9 — Plantillas de email editables (TODAS)  ✅ HECHO (2026-07-14) — `cdda13c`
Nueva sección en Ajustes (`/admin/settings/plantillas`): el dueño reescribe **con su voz** todos los correos
que su negocio envía, sin tocar código. **NO se creó un segundo sistema de plantillas:** los textos ya existían
—repartidos entre 4 constructores (`collectionEmail`, `accountEmail`, `opportunityEmail`, `avisosEmail`) y
**4 HTML escritos a mano dentro de las rutas** (presupuesto, orden de compra, recuperar contraseña, portal)—
y se recogen en un catálogo único (`email-templates.js`). La ruta de envío no cambia: mismo Resend, mismo historial.
- **La decisión que lo sostiene:** una plantilla de fábrica deja de ser código que concatena cadenas y pasa a ser
  **DATO** (texto con huecos `{{asi}}`). Los constructores de siempre quedan como envoltorios que lo renderizan
  (misma firma, misma salida). Y como la de fábrica ya es un texto con huecos, **la editable ES la misma cosa**:
  no hay dos versiones del texto que puedan desincronizarse — que era el riesgo real de la tarea.
- **El catálogo se recorrió DESDE EL CÓDIGO, no de memoria** — y corrigió tres suposiciones del encargo:
  el recordatorio de pago tiene **CUATRO** tonos (no 3); **NO existe email de "envío de factura"** (las facturas
  llegan al cliente **por el portal**, y ese es el correo que sí existe y se expone); y **no existen** invitación
  de empleado, verificación de cuenta ni avisos de seguridad por email — **no se inventan**.
  **8 tipos · 18 variantes editables.**
- **Red de seguridad, distinta por familia:** *cliente* → quitar un hueco necesario **avisa** pero deja guardar
  (es su voz); *sistema* → quitar el **elemento crítico** (el enlace de acción) **BLOQUEA** el guardado. Un
  "recupera tu contraseña" sin enlace deja a una persona fuera de su cuenta y nadie se entera hasta que pasa.
  El crítico sale **de la plantilla de fábrica**, no de una lista inventada.
- 🔒 **AGUJERO DE SEGURIDAD REAL, CERRADO de paso:** `auth.js` imprimía el **enlace de recuperación de contraseña
  en el log del servidor** (`console.log('[Resend] Reset link:', resetLink)`). Ese enlace lleva el **token**:
  cualquiera con acceso a los logs podía **secuestrar una cuenta**. Mismo pecado que la clave de Anthropic en el
  log de `sudo` (11-jul). Ya no se registra.
- Editor **visual** (negrita, cursiva, enlaces, listas): el usuario no ve una etiqueta. HTML crudo disponible pero
  **plegado**. Los huecos se **insertan con un clic**, nunca se teclean (un `{{factrua}}` mal escrito saldría vacío).
  Vista previa con datos de **ejemplo** (nunca de un cliente real). **"Volver al original" = borrar la fila**: la de
  fábrica vive en el código y **no se puede perder**.
- **Permisos: los mismos de Ajustes.** Comprobado en la BD, no supuesto: el módulo `company` **no existe** en la
  tabla `permissions`, así que Ajustes es **de facto del dueño/admin** — el candado más estricto que hay. **No se
  afloja para los de sistema.** `email_templates` **FUERA de WRITABLE_TABLES**.
- Verificado: `verify-plantillas-email` **49/0** (lo guardado es lo que se **envía**, no el código; los huecos se
  rellenan con datos reales; los valores se **escapan** —un cliente llamado `<script>` no inyecta nada—; cliente
  avisa y guarda; sistema **bloquea** en password **y** portal; volver al original devuelve la de fábrica carácter
  a carácter) + `gate-plantillas-email` **41/0** (navegador; **envío REAL por Resend al buzón sumidero**,
  comprobando que sale **mi** texto y **ninguno** de los cuatro de fábrica — **cero correos a personas**).
  Barrido **39/39**.

### Cola del Eje A (fuera de encargo, NO descartadas — decisión del dueño)
- **Motor de traducción (i18n) real.** Hoy `admin_users.idioma` guarda la preferencia y la interfaz sigue en
  español (`lang="es"` hardcodeado; no hay i18n de ningún tipo en el proyecto). U8 avisa al usuario de ello en
  la propia pantalla. Cuando exista el motor, `idioma` es el campo que lo alimenta.
- **Códigos de recuperación de 2FA.** Ninguna de las implementaciones los tuvo nunca: si el usuario pierde el
  móvil, no hay salida por producto (hoy solo por intervención en BD). Necesario antes de empujar el 2FA a los
  clientes.
- **Tres pantallas vivas sin enlace** (U7): `/admin/analytics`, `/admin/discounts`, `/admin/tags`.

## Eje B: DISA (pendiente de planificar)  ⬅️ EMPEZAR AQUÍ
- **Diagnóstico de avisos/notificaciones (solo lectura, 9 jul 2026):** `docs/disa/diagnostico-avisos.md`.
  Es la **foto ANTES** del encargo de avisos; se conserva tal cual (documento fechado), pero ya no describe
  el estado actual.
- **Módulo de Avisos: CERRADO al 100 % (2026-07-10).** Los seis hallazgos del diagnóstico están cerrados.
  Los dos que seguían abiertos se cerraron en `b441cf0`: el **contador en vivo** en todas las pantallas del
  panel (sondeo de 60 s + refresco al volver a la pestaña + tras cualquier mutación, enganchado en `api()`)
  y la fuente **"cliente en riesgo"** del CRM (permiso `crm.read`, criterio prestado de `salesWorklist`).
  La fuente de **cumplimiento** ya existía (`envio_verifactu`). El bucle infinito de la campana (abrirla
  disparaba ~120 peticiones hasta el 429) se arregló en `fc7b323`; venía de `14b6c1e`, no del contador.
  *Queda fuera, sin encargo:* el **calendario fiscal** como fuente de avisos.
- **Auditoría D0 (10 jul 2026):** `docs/disa/auditoria-disa-d0.md` — radiografía completa de DISA
  (acciones, permisos, proactividad, nombres, mapa del código). De ella salieron D1…D5:
  - ✅ **D1 — fuga de lectura de `query_database` cerrada** (`d1d0c84`): de denylist a allowlist; lo no
    mapeado se deniega. Cada tabla al `*.read` de su pantalla. 43/0.
  - ✅ **D2 — KPIs del Inicio filtrados por permiso** (`d1d0c84`): sin permiso, "—" en vez de la cifra.
  - ✅ **D3 — saneamiento del catálogo** (`4a4beb1`): `delete_product` escribe `archived` (antes el
    `inactive` off-enum); `reset_stock` muerto retirado; tarjeta "Construir tienda" (404) oculta.
    `/summary` investigado y CONSERVADO (lo usan dos gates, no era huérfano). Las 16 acciones sin
    anunciar **no se tocaron** (es decisión de D5).
  - ✅ **D4 — docs y modelo** (`4a4beb1`): estados de pedido de `CLAUDE.md` al enum vivo; chat de DISA
    y onboarding a **`claude-sonnet-5`** (extracción por visión se queda en 4-6). Tarifa nueva en `llm.js`.
  - 🟡 **D5 — PROACTIVIDAD REAL DE DISA. Dos piezas HECHAS** (`742920a`, + esta sesión): **recordatorio
    de impago** y **pago a proveedor por vencer**.
    Cuando una factura de venta lleva vencida más días que el umbral del negocio (`company_config.
    dias_recordatorio_impago`, por defecto 7, editable en Ajustes), un cron diario prepara un borrador
    de email de recordatorio (plantilla `collectionEmail`, no LLM) y lo deja en el panel nuevo
    **"Propuestas de DISA"** (`/admin/propuestas`, badge en el topbar). El dueño **aprueba y envía**
    (reutiliza `registerCollectionAction` → Resend), edita o descarta. **NUNCA se autoenvía.** Tabla
    `disa_proposals` genérica (para más tipos), idempotencia por índice único (factura,tipo). Permisos:
    ver → invoices.read/cobros.read; aprobar → cobros.manage (anti-backdoor). Verificado: gate 22/0 +
    navegador 8/0 + envío REAL por HTTP a la dirección del dueño. `verify-propuestas-d5.mjs`.
    - ✅ **CRON INSTALADO (11 jul 2026):** `bamburu-propuestas.timer` copiado a `/etc/systemd/system`,
      `enable --now`. Diario 07:45 Europe/Madrid, antes del resumen de avisos (08:00). Verificado que
      **corre solo** bajo systemd y que **no duplica** aunque el panel ya haya generado ese día (20
      propuestas antes → 20 después; el índice único hace el trabajo). Documentado en
      `deploy/systemd/README.md`. **Un solo timer para los dos tipos** — D5b lo reutiliza.
    - ✅ **D5b — PAGO A PROVEEDOR POR VENCER (11 jul 2026).** El espejo de D5, invertido en el tiempo:
      en vez de cobros ya vencidos, pagos que están A PUNTO de vencer. Factura de compra con importe
      pendiente cuyo vencimiento cae dentro de los próximos `company_config.dias_aviso_pago` (Ajustes,
      7 por defecto, campo hermano del de impago). **No incluye lo ya vencido** (fuera de esta pieza).
      La propuesta muestra proveedor, nº de factura, importe pendiente, vencimiento y días que faltan.
      **La acción NO es un email** — a un proveedor no se le avisa de que se le va a pagar: es un ATAJO
      A PAGAR. "Aprobar y registrar pago" abre el **MISMO modal** del botón "Pagar" de `/admin/pagos`
      (`views/pago-modal.js`), precargado con lo pendiente, y escribe por el **ÚNICO** endpoint de pagos
      (`POST /api/erp/supplier-invoices/:id/payments`); editar = lo que ese modal ya permite (importe,
      fecha, forma, nota). Descartar → no se repite. **Mismo candado que "Pagar": `purchases.create`
      para aprobar, `purchases.read` para ver — ningún permiso nuevo.** El badge y la lista se filtran
      POR TIPO según permiso: quien no tiene compras no ve —ni cuenta— las propuestas de pago.
      Esquema **aditivo**: `disa_proposals.supplier_invoice_id`/`supplier_id` + índice único
      `(supplier_invoice_id, type)`; NO se sobrecarga `invoice_id` (las facturas de venta y las de
      compra son espacios de ids distintos). Verificado: `verify-propuestas-pagos.mjs` 48/0 +
      `gate-propuestas-pagos-permisos.mjs` 32/0 (navegador, permisos reales, E2E: aprobar → pago real
      en `supplier_payments` → propuesta cerrada) + punta a punta con factura de compra REAL (FRP-0005,
      121,00 €, vence en 3 días). Regresión de DISA y Pagos en verde.
    - ✅ **D5c — EMITIR LA FACTURA RECURRENTE QUE TOCA (14 jul 2026, `2b8927d`).** Tercer tipo de
      propuesta (`emitir_recurrente`). DISA detecta las **igualas/cuotas que tocan este ciclo y siguen
      sin emitir** —las ocurrencias en `borrador`, vía `borradoresPendientes()`— y las deja en el panel
      con cliente, concepto, importe y el día que toca. **Aprobar = EMITIR, un clic. No manda ningún email.**
      El **motor de recurrentes ya existía entero** (plantillas, ocurrencias, cron, pantalla): lo que
      faltaba era que DISA lo pusiera DELANTE en vez de esperar a que entres a mirar — el mismo salto
      que dio D5 (de avisar, a preparar).
      **NO nace una segunda forma de emitir una factura:** "Aprobar" llama a `emitirOcurrencia`, **el
      MISMO servicio** que hay detrás del botón de `/admin/recurrentes` (→ `createInvoice` → huella
      Verifactu), y exige **`invoices.create`, el mismo permiso que ese POST** — si no, sería un camino
      más flojo de emitir. El guardián de la doble emisión sigue en el motor (409), no en el panel.
      **Importe SIEMPRE en vivo** desde la plantilla: si le subes el precio a la iguala después de que
      DISA la proponga, se emite —y se enseña— el precio de HOY (probado a propósito: 121 → 242).
      Esquema **aditivo**: `disa_proposals.occurrence_id` + índice único `(occurrence_id, type)`, hermano
      de los otros dos; conviven porque en SQLite los NULL de un índice único son todos distintos entre sí.
      Descartar → no se re-propone. **Candado a propósito MÁS estricto que el de sus hermanos:
      `recurrentes.read` Y `invoices.create`** (la tarjeta enseña datos de la plantilla; emitir cuesta
      `invoices.create`). Quien no puede emitir **no la ve**: ni lista, ni badge, ni se le genera. Falla
      cerrado; **ningún permiso nuevo**. Enganchado en `generarTodo()` → corre en el timer de las 07:45,
      **sin segundo cron**.
      **PRUEBAS — decisión importante:** el camino feliz (aprobar → factura emitida de verdad) se corre
      sobre una **COPIA desechable** de la BD real, **NO en el negocio vivo**. No es pereza: **una factura
      emitida es INMUTABLE** (CANON), y borrarla al terminar el gate para "dejar el tenant como estaba"
      **rompería la cadena de huellas Verifactu**. Así que la emisión se prueba **entera y por la RUTA
      REAL** sobre la copia (`verify-propuestas-recurrentes.mjs` **55/0**: emite con número y huella, la
      ocurrencia queda emitida, la propuesta resuelta, y deja de proponerse sola), y el gate de navegador
      prueba **pantalla + candado** contra el servidor vivo cerrando por **Descartar**, que no emite nada
      (`gate-propuestas-recurrentes.mjs` **28/0**). Que el negocio queda con **cero facturas nuevas** es
      una aserción del gate, no una promesa. (La cola de envío a la AEAT está **inactiva** en desarrollo
      por falta de certificado FNMT: emitir ahí no mandaría nada a Hacienda — pero la factura quedaría.)
      Barrido completo **35/35**.
    - **Navegación HECHA (10 jul, `3b54cf8`):** el riel izquierdo ahora abre con **Inicio** (icono casa
      → `/admin`) y **DISA** como 2º icono, un flyout con el MISMO patrón que las áreas: **Propuestas**
      (`/admin/propuestas`) y **Hablar con DISA** (abre el widget flotante existente vía `disaOpen()`;
      si la pantalla lo oculta cae a `/admin/disa` — nunca crea hilo nuevo). El **badge de pendientes se
      mudó del topbar al icono de DISA** (mismo `contarPropuestasPendientes`, `propBadgeSync` retargeteado;
      se retiró `#tbProps`). Solo navegación/vista; gateado igual (invoices.read/cobros.read). Verificado:
      `gate-nav-inicio-disa.mjs` 34/0.
    - ✅ **D5d — CLIENTES DORMIDOS · reenganche (14 jul 2026, `a30009a`).** Cuarto tipo de propuesta
      (`cliente_dormido`). DISA detecta al cliente **que te compraba y dejó de hacerlo**, y te propone
      reengancharlo. Mismo panel, mismo cron de las 07:45, misma tabla.
      **EL RITMO SE APRENDE, NO SE IMPONE.** Un cliente que compra cada semana lleva dormido a los 30
      días; uno que compra cada trimestre, no — medirlos con la misma vara es lo que convierte un aviso
      útil en ruido que se ignora. Con **2+ compras**: hueco **MEDIANO** (no la media: una compra rara no
      debe torcer el ritmo de un año) **× 2**, con **suelo de 30 días**. Con **1 compra**: **respaldo de
      90**. El que **NUNCA compró NO entra** (no está dormido: nunca despertó). Regla de venta =
      `countsAsReceivable`, la misma que cobros. Las **ventas de mostrador SIN cliente no ensucian a
      nadie**, y no por un filtro: se agrupa por `client_id`, así que una venta que no es de nadie no
      puede dormir a nadie. Ajustables anotados en `ventas-metrics.js`.
      **APROBAR NO ENVÍA NADA** (opción C): aprobar = **DISA REDACTA** y te lo enseña; **enviarlo es un
      segundo clic, tuyo, después de leerlo**. La propuesta sigue *pendiente* tras redactar — aprobar la
      **prepara**, no la resuelve.
      **NO nace un segundo camino de email.** `registerCollectionAction` (el de los recordatorios) está
      **atado a una factura**, y un cliente dormido no tiene ninguna que colgar — *de eso va*. Se usa la
      vía que YA existe para escribir a un cliente sin factura: **`registerClientActivitySvc`
      (type=email) → `core/mailer.sendEmail`**, el único envoltorio de Resend del proyecto ("el mismo
      que cobros"), y **queda registrado en `client_activities`** como si lo hubieras escrito tú.
      **Tono `reenganche` NUEVO** en `opportunityEmail` (aditivo): reutilizar `seguimiento` escribía
      *"Retomo el hilo de TU SOLICITUD"* a alguien que no ha pedido nada — un email sutilmente falso a un
      cliente que ya se fue es **peor que no escribirle**. Sin marketing, sin culpa.
      **REAPARICIÓN:** índice único **PARCIAL** `(client_id, type) WHERE status='pendiente'` → no se
      repite el pendiente, pero el **historial convive sin reescribirse**. El **descanso de 90 días** lo
      aplica el generador, y **cuenta también tras ENVIAR**, no solo tras descartar: si no, al mandar el
      email la propuesta se cerraría, el índice dejaría de bloquear, y a la mañana siguiente le
      escribirías **otra vez** — una máquina de spam en dos líneas.
      `disa_proposals` y `client_activities` **FUERA de WRITABLE_TABLES** (afirmado en el gate).
      **Candado: `clients.read` Y `crm.manage`**. Sin permisos nuevos.
      **DOS BUGS REALES cazados por el camino:** (1) **el badge MENTÍA** — la lista de "qué tipos ve este
      usuario" estaba escrita DOS VECES (rutas y layout del riel), y al añadir D5c solo se actualizó una:
      el badge llevaba el día sin contar las recurrentes. Ahora la regla es **única** (`tiposVisiblesPara`)
      y una aserción la vigila. (2) **el ritmo se medía en FACTURAS, no en días** — lo destapó una clienta
      real con **tres facturas del MISMO día** (una visita, tres documentos): salían "dos huecos de 0
      días" → ritmo 0 → dormida a los 30, explicado con el disparate de *"compra cada 0 días"*. Tres
      facturas de una visita son **UNA compra**; ahora se mide en días distintos.
      Verificado: `verify-propuestas-dormidos.mjs` **92/0** (copias desechables) + `gate-propuestas-
      dormidos.mjs` **39/0** (navegador; el clic de enviar va por **Resend de verdad al buzón sumidero**
      `delivered@resend.dev` — **cero correos a personas**). Barrido **37/37**.
      - ✅ **El fantasma del mostrador, AFIRMADO (14 jul 2026, `c95c95c`).** Verificación pedida aparte,
        sobre el punto ciego que más podía doler. **Las tres pasan con el producto TAL CUAL: no se tocó
        ni una línea de producto.** (1) Una venta de mostrador **ANÓNIMA nunca genera propuesta** —sin
        ficha no hay a quién escribir—: se siembran 3 (una de hace 400 días, que podría "dormir" a
        alguien, y una de ayer, que podría "despertarlo") y se afirma 0 propuestas nuevas, mismo conjunto
        de clientes, ninguna con `client_id` NULL. (2) **LA INVARIANTE:** no se compara el flojo "¿sigue
        dormido?", sino **la ficha ENTERA de sueño** (días, ritmo, umbral, nº de compras, última compra)
        de **seis clientes de ritmos distintos**, byte a byte, **con y sin** las ventas anónimas — y en
        **los dos sentidos** (quitarlas tampoco mueve nada). Si el fantasma se colara por cualquier
        rendija, uno de esos números se movería. (3) **El mostrador ATRIBUIDO SÍ cuenta:** un cliente que
        pasó por el mostrador y la venta quedó pegada a su ficha — sin contar el ticket saldría DORMIDO
        (facturas de hace 200 y 150 días, umbral 100); con el ticket de hace 10 días **no lo está y no se
        te propone**. *Nota de proceso:* la primera versión de (1) falló, y **NO era del producto: era del
        gate** —generaba la línea base DESPUÉS de sembrar los fantasmas—. Se comprobó en aislamiento
        antes de tocar nada; el orden correcto queda escrito en el propio gate.
    - ✅ **D5e — VENCIMIENTOS FISCALES (15 jul 2026, `413bde1`).** Quinto tipo de propuesta
      (`vencimiento_fiscal`) y el primero que **no cuelga de un documento** (factura/ocurrencia) ni de un
      cliente: cuelga de la **FICHA FISCAL del tenant** (qué presenta) y del **CALENDARIO** (cuándo vence).
      Mismo panel, mismo cron, misma tabla.
      **BAMBURU PREPARA, NUNCA PRESENTA (CANON §0-ter).** "Marcar como preparado" cierra el recordatorio y
      —para 303/130— te lleva al borrador en Impuestos; **presentar es tuyo, en la sede de la AEAT**. Aquí
      no nace ningún camino de presentación.
      **SOLO SE PROPONE LO DECLARADO.** `fiscal_profile` (singleton, **FUERA de WRITABLE_TABLES**: DISA no
      se escribe a sí misma qué presentas) es la fuente de verdad; **nunca se asume 303+130 para todos**
      —callarse el 111 de quien tiene un empleado es peor que no avisar—. Sin declarar (`configured_at`
      NULL) no se propone nada, ni con actividad que lo alimentaría. Se declara en **Ajustes › Situación
      fiscal**, en lenguaje llano (sin ver números de modelo si no quieres).
      **LAS FECHAS SON APROXIMADAS A PROPÓSITO** (`calendario-fiscal.js`, lógica PURA): el plazo real se
      corre por fin de semana/festivo, así que se da la fecha NOMINAL con **margen de 10 días** y **gracia
      de 3** (el plazo real suele correrse HACIA DELANTE), y cada propuesta lleva la línea `NOTA_AEAT`. Una
      **regla en código**, no una tabla de fechas a mano que se quedaría vieja en silencio.
      **303/130 traen importe estimado** del motor de contabilidad (casilla 71 / c19), marcado como
      estimación y recalculado EN VIVO; **111/115 y anuales avisan de la fecha y NO inventan cifra**
      (importe null). Si dejas de declarar un modelo, su pendiente pasa a `viva=false` y el panel lo avisa,
      en vez de empujarte a presentar lo que ya no te toca.
      **Idempotencia:** índice único `(fiscal_model, fiscal_year, fiscal_period, type)` → una sola propuesta
      por vencimiento para siempre; el periodo siguiente es otra clave. **El cron genera el 5º tipo:** un
      solo timer para los cinco. **Candado `invoices.read`** (el mismo que la pantalla de modelos): quien no
      ve los modelos no ve sus vencimientos, ni en la lista, ni en el badge, ni se le generan. Falla cerrado.
      Verificado: `verify-propuestas-fiscales.mjs` **62/0** (copias desechables + clon limpio). De paso, el
      gate de dormidos afirmaba `tipos===4`; con el quinto tipo pasó a **5**.
    - 📋 **Diagnóstico SOLO LECTURA (14 jul 2026) — terreno para 3 propuestas nuevas.** Se pidieron tres;
      el diagnóstico **dio la vuelta a lo que se esperaba**. Veredicto de cada una:
      - 🟢 **Facturas recurrentes por emitir → VERDE.** El motor **ya existía entero**; no había que
        deducir cadencias de nada. **CONSTRUIDA: es D5c, arriba.**
      - ✅ **Clientes dormidos → CONSTRUIDA: es D5d, arriba** (era ÁMBAR; las dos decisiones se tomaron:
        descanso de 90 días —también tras enviar— y los que nunca compraron quedan FUERA). El punto ciego
        del mostrador se resolvió por diseño: se agrupa por cliente, así que una venta sin cliente no
        duerme a nadie. *(Diagnóstico original, para el registro:)* La última
        compra por cliente sale directa (`MAX(issue_date)`), y `ventas-metrics.js:clientesInactivos()`
        ya hace el cálculo — pero **solo devuelve un número**, hay que extenderlo a filas. El umbral
        encaja igual que sus hermanos (`dias_cliente_dormido` en `company_config` + input en Ajustes).
        **PUNTO CIEGO REAL:** las **ventas de mostrador van sin cliente** (serie S, `client_id=NULL` — 35
        de 72 facturas vivas), así que **quien te compra en el mostrador parecería dormido**. Eso no lo
        arregla el código: es un dato que no está. **DECISIONES PENDIENTES:** (a) cada cuánto se puede
        **re-proponer** un cliente — a diferencia de una factura, que se paga y muere, un cliente **puede
        volver a dormirse**, y el "una propuesta por (cliente,tipo) para siempre" del modelo actual no
        vale tal cual; (b) qué hacer con los clientes que **NUNCA compraron** (¿dormidos, o nunca
        despertaron?). Ojo: eso sí exigiría una **clave de deduplicación genérica** (`(type, periodo)`),
        que **NO se construyó** en D5c a propósito.
      - 🟢 **Vencimientos fiscales (IVA/IRPF) → CONSTRUIDA: es D5e, arriba.** *(Era VERDE y esperaba tu decisión; se tomó y se construyó.)* *(La sorpresa:
        se esperaba que fuera la bloqueada por el motor contable.)* **El motor contable NO está a medias:
        está CERRADO** (Piezas 1–4), y **`modelo303(db,year,q)` y `modelo130(db,year,q)` ya calculan** las
        casillas oficiales del trimestre — **ejecutados en solo lectura sobre T3-2026 y responden**. Lo que
        falta **no es motor**: es el **calendario fiscal** (20-abr / 20-jul / 20-oct / 30-ene, con día hábil
        y corte de domiciliación), que **este TABLERO declara "fuera, sin encargo"** (línea 210). **Requiere
        decisión del dueño para desbloquearse.** Salvedades para cuando se construya: **CANON §0-ter —
        Bamburu PREPARA, nunca presenta**; hay que **propagar los `warnings`** de los modelos (IVA sin
        desglosar, etc.), no esconderlos tras una cifra limpia; y "IRPF del trimestre" es el **130** (pago
        fraccionado) — el **111 no se puede hacer**: `supplier_invoices` no guarda retención, por decisión
        explícita del código.
    - **Siguientes piezas de proactividad (sin encargo, para planificar):** más tipos de propuesta
      (subsanación Verifactu, etc.); push en vivo (SSE) en vez del sondeo de 60 s; que DISA proponga
      desde la propia campana. Es el resto del diseño de D5.
- **Lo que queda del Eje B es diseñar/construir MÁS proactividad.** De las tres propuestas del
  diagnóstico, **las TRES están HECHAS** (D5c recurrentes, D5d dormidos, D5e vencimientos fiscales).
  La última exigía tu decisión sobre el calendario fiscal (estaba "fuera, sin encargo"): se tomó, se
  construyó y se verificó (62/0 + clon limpio). Siguiente proactividad, sin encargo: subsanación
  Verifactu, push en vivo (SSE), proponer desde la campana.

## Verificación (transversal)

- ✅ **HECHO (11 jul 2026) — RESUCITADOS LOS GATES DE NAVEGADOR MUERTOS + runner de regresión.**
  **14** gates guardaban la ruta de la BD a mano (`/home/ibrahin/bamburu/...`); al migrar el servidor a
  `/home/ubuntu` (~19 jun) murieron TODOS y llevaban **tres semanas sin probar nada**. Además, el
  Chromium que trae puppeteer no arranca en este ARM. **Arreglo:** `scripts/lib/gate-env.mjs` resuelve
  la ruta desde la ubicación del script (nunca a mano) y **aborta con código 2** si falta la BD o el
  Chromium — un gate que no arranca ya no puede disfrazarse de aprobado.
  **`scripts/run-gates.mjs`** (nuevo): el barrido que faltaba. Manda el **código de salida**, no lo que
  el gate imprima; un gate que sale 0 sin resumen es SOSPECHOSO y cuenta como fallo; un gate pedido que
  no existe es error; e imprime SIEMPRE la deuda. Grupos: `pagos`, `disa`, `inventario`, `avisos`, `--all`.
  **Resultado real: 23/23 en verde**, con la regresión de Pagos en navegador cubriendo otra vez
  (`gate-pagos-proveedor` 15, `gate-pago-cuenta` 12, `gate-abono-proveedor` 16, `gate-gasto-proveedor` 18,
  `gate-c1c-diferencias-cierre` 20, `gate-disa-dictar-compra` 20). **Ningún bug de producto salió del
  falso verde.**
- ✅ **HECHO (14 jul 2026) — SALDADA LA DEUDA DE LOS 7 GATES DE NAVEGADOR. Barrido 33/33, deuda a cero.**
  `9a36232`. Diagnosticados uno a uno **ejecutándolos**, antes de tocar nada: **ninguno era un bug del
  producto**, y **no se ha tocado una línea de producto**. Pero solo 4 estaban caducados — el diagnóstico
  que había apuntado aquí el 11-jul **acertaba en 4 y fallaba en 3**:
  - **CADUCADOS de verdad (4), arreglados y dentro del barrido:**
    - `gate-recepciones-c1b` (16→**32**) y `gate-devoluciones-proveedor` (17→**32**) — confirmado: el
      guardián de traslados bloquea con 409 **y hace bien**. Su dato era **prestado** (el producto 1, que
      otros mueven). Ahora cada uno **se trae su propio producto** (recién nacido, sin traslados) para el
      camino feliz **y además AFIRMA el bloqueo** sobre un producto sí trasladado: se prueban los **dos**
      caminos, no uno en vez del otro.
    - `gate-orden-compra-c1a` (24→**30**) — `alert()` → `toast()`, confirmado. Y el `alert` fantasma
      **envenenaba la cola de diálogos**: el `prompt()` siguiente se comía la respuesta sobrante y anulaba
      con motivo vacío → moría en un timeout ajeno a la causa. El email real ya no va al dueño: se sigue
      probando **contra Resend de verdad**, pero a su buzón sumidero (`delivered@resend.dev`).
    - `gate-almacenes` (10→**20**) — se envenenaba solo: se buscaba **por nombre** y enganchaba el almacén
      rancio de la pasada anterior. Nombre único por pasada + **borra lo suyo** al salir (idempotente,
      verificado con dos pasadas seguidas).
  - **NO estaban caducados: les faltaba ENTORNO (3).** Aquí el diagnóstico anterior **era falso**:
    - `gate-c2-captura` y `gate-disa-captura-chat` — **`#step2` sí existe**. La causa real era un **429**:
      el tenant agotó su **tope de gasto de IA del mes (5,089 € de 5 €)** y el freno de `core/llm.js` corta
      antes de llamar a la API — funcionando **como debe**. Una prueba que depende del saldo de una cuenta
      no puede vivir en un barrido → **partidas en dos**: la extracción con modelo real se corre **a mano**
      (y **aborta con código 2 si no hay cuota**, en vez de morir con una traza engañosa), y **la pantalla
      entra al barrido** sembrando el adjunto en BD, sin modelo: **`gate-c2-revision` (28)** y
      **`gate-disa-adjuntar` (18)**, ambos nuevos. Esas pantallas pasan de **cero cobertura** a cubiertas.
    - `gate-registro-tailscale` — necesita la red de Tailscale, que aquí no resuelve. Apuntarlo a localhost
      dejaría de probar lo que existe para probar → **aborta (código 2)** y se declara **ENTORNO** en el
      runner: su falta de cobertura **se ve** en cada pasada.
  - **Dos falsos verdes cazados de paso:** una aserción **tautológica** (`x === x`, no podía fallar) y un
    control de acceso que **no probaba nada** (daba por hecho que el empleado 3 no tenía permiso de compras
    — **sí lo tiene**, así que el 403 nunca se comprobó). El empleado sin permiso ahora **se crea a propósito**.
  - Las **seis** pruebas de navegador **limpian lo suyo por ID** y dejan el tenant como lo encontraron
    (stock cuadrado con el libro incluido). `scripts/lib/gate-fixtures.mjs` (nuevo) es el andamio común.
  - **El barrido sigue siendo honesto**, verificado a propósito: una prueba que sale 0 **sin demostrar nada**
    sigue contando como **FALLO** (`SOSPECHOSO`).
- 🌍 **Sin entorno aquí (anotado, no oculto).** No son deuda ni bugs; el runner los grita en cada pasada:
  - **Tope de IA agotado** en el tenant de desarrollo este mes → `gate-c2-captura` y `gate-disa-captura-chat`
    no se pueden correr **ni a mano** hasta que se renueve el mes o se suba `platform_limits.ai_cap_eur`.
  - **Tailscale no está** en este servidor → `gate-registro-tailscale` solo corre donde lo haya (`tailscale up`).
  - `gate-pago-voz-avisos` y `verify-disa-pedidos-modelo-real` llaman al **modelo real**: fuera del barrido
    por naturaleza, a mano y a conciencia.

## Sala de máquinas (servidor / BD)

- ✅ **HECHO (11 jul 2026) — cerrados los 3 hallazgos del diagnóstico del 10 jul.**
  1. **Superadmin ya no escribe por una conexión propia.** `setTenantAiCap` abría su `new Database()`
     de escritura a la `.db` del negocio, fuera de la caché. Dos escritores contra el mismo fichero
     SQLite se serializan: una escritura atascada dejaba al negocio esperando (`busy_timeout` 5 s).
     Ahora escribe por `getTenantDb()` — **la misma conexión cacheada que usa el panel del negocio**.
     Las demás aperturas de superadmin son `readonly: true` (un lector no compite por el bloqueo).
     `arquitectura.md` decía "solo lectura" y era falso: corregido, ahora nombra la excepción.
     Gate nuevo `verify-superadmin-escrituras` (10/0): se pone rojo si alguien reintroduce una
     escritura fuera de la caché. Probado además por HTTP real (tope 5,00 € → 12,50 €).
  2. **`data/bamburu.db` (327 KB) borrado.** El grep encontró una referencia —`init-staging.mjs` lo
     usaba de `db_filename`— pero **ningún tenant apuntaba ahí** y el fichero era una BD de semilla
     del 19-jun jamás usada (1 usuario, 0 clientes, 0 facturas, esquema viejo con `sales_orders`).
     Borrado con respaldo. `init-staging.mjs` corregido a `data/tenants/staging.db` (la convención),
     para que el huérfano no pueda volver a nacer.
  3. **El WAL, acotado — y el diagnóstico estaba EQUIVOCADO en este punto.** No era que "no hiciera
     checkpoint": un `wal_checkpoint(PASSIVE)` a mano devolvía `busy=0` y copiaba TODAS las páginas.
     Los 4,1 MB eran exactamente el umbral de `wal_autocheckpoint` (1000 páginas × 4096 B). Lo que
     pasa es que SQLite **no encoge el fichero** tras un checkpoint: lo reutiliza en el sitio y se
     queda en su marca máxima. El arreglo no es un cron, es **`journal_size_limit = 4 MiB`**
     (`WAL_SIZE_LIMIT`), puesto en `core/control-db.js` y en la caché de `tenant-middleware`. Gate
     nuevo `verify-wal-acotado` (9/0), A/B con la misma carga sobre dos copias: **sin tope deja
     12,74 MB, con tope 4,00 MB**. Tras la regresión completa, ningún `-wal` vivo pasa de 4 MiB.
  - Regresión completa **26/26**. Grupo nuevo del runner: `node scripts/run-gates.mjs infra`.
- ✅ **HECHO (11 jul 2026) — la búsqueda por email ya no abre la BD de nadie en escritura.**
  El hermano del hallazgo 1: `getTenantByEmail` y `getTenantsByEmail` (las usan el **alta** y el
  **login por email**) recorren la `.db` de CADA negocio activo y las abrían en **lectura+escritura**
  solo para un `SELECT`. Dos pegas: una conexión de escritura de más que se serializa con la del
  propio negocio, y —peor— si el fichero **no existía, SQLite lo CREABA vacío** en el intento: una
  `.db` fantasma por cada tenant descuadrado, nacida de una simple búsqueda. Ahora las dos comparten
  un helper que abre con `{ readonly: true, fileMustExist: true }`. Gate nuevo
  `verify-tenant-lookup-readonly` (17/0), que además **demuestra el bug viejo** (sin esos flags,
  SQLite crea el fichero). Probados los dos flujos reales: `/find-tenant` por HTTP y `emailTaken`.
  Regresión **27/27**.
- ✅ **HECHO (11 jul 2026) — auditoría de la clave de Anthropic + rotación.** La clave **nunca** se
  había filtrado: 0 en el árbol, 0 en los **5.967 objetos de git** (incl. sueltos), 0 en los `.service`
  (todos usan `EnvironmentFile`), 0 en los logs rotados, `.gitignore` correcto, fichero `0600`.
  **La filtré yo al auditar**, con un `sudo grep -F "$CLAVE"` — `sudo` registra la línea de comando
  entera. Limpiado `auth.log`; clave **rotada** y verificada con una llamada real a DISA. La lección
  (nunca un secreto en `argv`) queda en `errores-conocidos.md`.

## Eje C: Seguridad (pendiente de planificar)

---

## Función por encargo del dueño (fuera de los ejes A/B/C)

### Auditoría de código del 9 jul — los 11 hallazgos, cerrados  ✅ HECHO (2026-07-09)
`/code-review` a nivel `xhigh` sobre `cc5bec3`, `021f5df` y `d515242`: 19 candidatos, **11 confirmados**
por un verificador independiente (1 refutado). Se cierran todos, en orden de gravedad.

**CRÍTICO 1 — fuga de permisos.** `GET /api/erp/avisos` no exigía permiso, y la campana lo llama en
TODA página admin: un empleado sin `cobros.read` leía *"María García López · F2026-0017 · Te deben
€15,61, vencida hace 12 días"*, más los nombres de proveedores y lo que se les debe. Sus hermanas sí lo
exigían (`cobros.js:17`, `pagos.js:16`, `inventory.js:15`). Ahora cada fuente declara el permiso de su
pantalla de origen (`PERM_POR_FUENTE`) y el motor **ni siquiera ejecuta** las que no puedes ver — cierra
la fuga y ahorra el escaneo caro. **Falla cerrado**: fuente sin permiso declarado, fuente que no se
sirve. *Consecuencia:* el conteo pasa a ser **por usuario**; el invariante deja de ser "todas las
superficies cuentan lo mismo" y pasa a "lo mismo QUE TÚ PUEDES VER". El correo diario va al negocio (sin
usuario) y sigue contándolas todas.

**CRÍTICO 2 — freno propio.** El tope general subió a 600/min por IP en el mismo commit que añadió este
endpoint caro (`openDebts`, O(clientes × facturas), y el POST lo corría dos veces). 600 escaneos/min
tumbaban el panel del negocio. Freno propio de **120/min con clave negocio+IP** (va detrás de
`tenantMiddleware`): una oficina no se come el cupo de otra. Verificado: `200×120 · 429×10`, el negocio
B intacto, y un token de A contra el Host de B → `401`.

**Corrección.** `marcarVistoYResumir` pisaba la huella entera y borraba los "no visto" puestos a mano;
**fusionar no lo arreglaba** (volver a añadir la clave que quitaste la marca igual), así que pasa a
`resumirAvisos`: **un resumen de conteos no descarta nada**. `hoyLocal()` con `Europe/Madrid` — en UTC,
entre las 00:00 y las 02:00 de España una factura recién vencida desaparecía. `bellSync` invalida su
caché y repinta si el panel está abierto (antes la campana seguía ofreciendo la factura ya cobrada); y
DISA deja de apagar el punto a mano, que era mentir sobre el servidor.

**Eficiencia y limpieza.** El motor se ejecutaba **dos veces** por carga de `/admin` (badge + campana) y
**dos veces** por marcado: ahora una sola pasada, compartida por el contexto. Los **tres formateadores**
de detalle (motor, email, pantalla) son uno solo, `detalleAviso()`; para las fuentes de dinero, el
`detalle` del motor se calculaba solo para que la pantalla lo pisara.

**Documentado, no revertido:** la clave `fr:` de los recurrentes cambió (antes era un JSON con comillas,
inseguro dentro de un `data-key`), así que los borradores ya descartados **reaparecen una vez** tras el
despliegue. Está escrito en `avisoKey()`.

**Verificación:** `node --check` en 10 ficheros · 6 módulos importan · motor **47 OK** · cobros paso 2
**47 OK** · cobros 2.1 **46 OK** · gate de estado **25 OK** · gate de acciones **23 OK** · permisos en
**dos negocios 16 OK** (`scripts/verify-avisos-permisos.mjs`, nuevo) · navegador real: el usuario
limitado ve *"No tienes nada pendiente"* y **ni una cifra**; el dueño ve sus 8 items. El usuario de
prueba queda **archivado** (`active=0`), nunca borrado.

**Fuera de alcance (no tocado):** `verifactu-cola.js`, sus scripts y sus unidades systemd — necesita su
propia revisión antes de activarse, precisamente porque mete registros fiscales en esta zona.

### Verifactu · Cola de envío automático por negocio  ✅ HECHO (2026-07-09) — `7b394c6`
Encargo expreso del dueño, a raíz del **hallazgo de los 240 s** de la Tarea 2 Fase A: el envío dejó de
ser manual. Al emitir una factura, su registro sale hacia la AEAT **en segundos**. Aditivo y reversible.
No toca huella/QR/encadenado (Tarea 1), no envía anulaciones, no subsana el 2004. Detalle completo en
`docs/verifactu/tarea2-cola-envio-automatico.md`.

> **⚠️ ESTO ES UNA PRUEBA DE CONCEPTO, NO EL PRODUCTO FINAL.** Lo construido y lo remitido el 9-jul va con
> el **certificado personal del dueño** (FNMT de persona física). Demostró que la tubería funciona de punta
> a punta contra la AEAT — y eso es exactamente todo lo que demostró. **La versión de producto es la de
> colaborador social:** un único certificado de Bamburu para todos los negocios + autorización de
> representación firmada por cada dueño (decisión del 2026-07-10, ver `docs/contexto/decisiones.md`).
> **No leer "cola hecha" como "Verifactu para clientes hecho".** La tarea de producto, entera y sin trocear,
> está en el Backlog · Contabilidad y cumplimiento fiscal.

- **⚠️ Hay DOS relojes, y empujan en contra.** Además de la ventana de 240 s de la huella, el **control
  de flujo** (art. 16.2 Orden HAC/1177/2024) obliga a esperar el `TiempoEsperaEnvio` devuelto (t inicial
  = 60 s) entre envíos, y **un envío = un obligado** (una Cabecera). Un sobre por factura da un techo de
  **1 registro/60 s**: en una ráfaga de mostrador la 6ª factura llegaría fuera de ventana. Por eso la
  cola **AGRUPA** todo lo pendiente del negocio en UN sobre (1..1000 `RegistroFactura`). En calma la
  factura sale en ~1 s; en ráfaga salen juntas dentro del minuto. **El envío "inmediato por factura" del
  encargo no era implementable tal cual**; el objetivo sí se cumple.

- **`enviarLote` es ahora el único orquestador.** `buildEnvelope` ya admitía N registros; faltaba quien
  los agrupara. `enviarRegistro` (botón manual + script de preproducción) **delega** en un lote de 1:
  imposible que el camino manual y el automático diverjan. El gate de T2 (17/17) valida el lote a N=1.

- **Reintentos.** Solo el fallo de COMUNICACIÓN se reintenta (backoff 5→15→45→135→300→300 s; agotados
  los 6 intentos → terminal + aviso). Un **rechazo** de la AEAT no se reintenta (el mismo XML da el mismo
  rechazo) y un **bloqueo por datos** ni sale: los dos van directos a aviso. Lo aceptado no se reenvía
  jamás (idempotencia del motor). Pasados los 240 s se sigue enviando: remitido tarde > no remitido.

- **Multi-tenant.** Cada negocio remite con SU certificado: `VERIFACTU_CERT_DIR/<slug>.p12` + contraseña
  en `VERIFACTU_CERT_PASS_<SLUG>`, con caída al `VERIFACTU_CERT_PATH` global. **La contraseña sigue sin
  escribirse en ningún fichero del repo** (decisión de la Fase A, intacta): si no está en el entorno del
  servicio, la cola de ese negocio **no se activa** y la pantalla dice el motivo exacto. Hoy, por tanto,
  **la cola está inactiva en los 6 negocios** y el comportamiento es el de siempre (botón manual).

- **Concurrencia.** Cola en proceso + barrido de systemd (`bamburu-verifactu-cola.timer`, cada 2 min) como
  red de seguridad para reinicios y caídas largas. Cerrojo entre procesos: reclamar una fila empuja su
  `next_retry_at` al futuro (lease 120 s) en una transacción `IMMEDIATE`. El reloj del control de flujo se
  deriva de la BD, no de memoria, para que sobreviva a un reinicio. `next_retry_at` va **siempre** en ISO-Z:
  `CURRENT_TIMESTAMP` ('AAAA-MM-DD HH:MM:SS') y `toISOString()` no se comparan bien como cadenas (`0x20` < `'T'`).

- **El histórico NO se drena.** La cola solo toca filas con `next_retry_at` no nulo, y eso solo lo pone
  ella. Los 85 registros antiguos de `desarrollo-bamburu` y el `incorrecto` (1239) de `helados-ibrahin` se
  quedan quietos: remitirlos hoy solo devolvería `AceptadoConErrores`.

- **Avisos** (fuente `enviosVerifactu` en el motor existente, sin crear uno nuevo): solo lo que quedó en
  punto muerto — rechazado, bloqueado por datos, o comunicación agotada. Lo que se reintenta solo NO avisa.
  **Urgencia 2000** (por encima de las facturas vencidas, cuya urgencia crece con los días): un registro
  fiscal sin remitir es lo más grave del panel y no debe quedar sepultado. *Decisión del dueño, 2026-07-09.*
  Sin botón de acción directa, como las recurrentes: reenviar tiene valor legal → se revisa antes
  (`gate-avisos-pantalla` amplía su excepción "confirm-first" a Recurrente **y** Verifactu). *Decisión del dueño.*

- **Corregido de mi propia pieza:** al agrupar, cada fila de auditoría guardaba el sobre ENTERO → coste
  cuadrático (50 tickets en hora punta ≈ 3 MB por vaciado, sin techo). Ahora, en lotes de varios, cada
  fila guarda **lo suyo**: su `<RegistroAlta>` y su `<RespuestaLinea>` (emparejada por serie exacta, no
  por subcadena: `F2026-1000` es subcadena de `F2026-10000`). CSV y `EstadoEnvio` ya vivían en columnas.

- **Verificación.** Gate nuevo `verify-verifactu-cola.mjs` **62/0** (encolado, ventana de 240 s, agrupación,
  control de flujo, idempotencia, cerrojo, red caída + reintento, backoff hasta terminal, rechazo que no se
  reintenta, lote mixto, avisos, histórico intacto, aislamiento entre negocios, emisión nunca bloqueada).
  **Regresión 24/24 gates, 0 fallos** (T1 18/0, T2 17/0, T1-http 7/0, mostrador, pedidos, contabilidad ×5, CRM…).
  **3 facturas reales** sobre COPIA de la BD de `ibrahin-repuestos`: un solo sobre, 3/3 `Correcto`, hueco
  huella→envío **1,2 s**, la cadena continúa desde la huella real de `S2026-0002`, los 2 aceptados no se reenvían.

- **Fuera de alcance, para encargos propios:**
  - **Envío real a preproducción CON la cola**: falta el `.p12` del dueño y su contraseña en el entorno del
    servicio. Hasta entonces la cola está inactiva (comportamiento idéntico al actual).
  - Envío de **anulaciones** · **subsanación** del 2004 · **Fase B legal**.
  - Bug latente de `verifactu-envio.js` (`prevRegistro` por `id` sin filtrar por emisor) — sigue vivo, es encadenado.
  - **`company_config.fiscal_id` vacío** en `duniya`, `rachibra` e `inversiones-disan`: la Cabecera saldría con
    `ObligadoEmision` vacío. Hoy teórico (sin certificado, su cola no arranca). El gate de T2 no lo detectaba
    porque `runMigrations` siembra `fiscal_id=''` y su `INSERT OR IGNORE` no lo pisa.
  - **`verify-pieza-c-http` es un gate FRÁGIL preexistente** (no roto por esta pieza): compara
    `round(round(S)+t)` con `round(S+t)` sobre "Ventas del mes", así que alterna según los céntimos
    acumulados. Demostrado: falla igual con el código anterior a esta tarea. *Estado: arreglar el gate.*

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
    **→ DECIDIDO el 2026-07-10: colaborador social, un único certificado de Bamburu**; descartado que cada
    negocio aporte el suyo. (El Anexo II **no** era la alternativa: es el modelo de la autorización de
    representación, que se usa dentro de este modelo.) Queda solo el trámite. Ver
    `docs/contexto/decisiones.md` y la tarea única del Backlog.
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

#### ⬜ Verifactu para clientes — colaborador social  ·  TAREA ÚNICA, NO TROCEAR
**A ejecutar cuando Ibrahin lo indique.** Se hace entera o no se empieza: media tarea deja registros
fiscales a medio camino. Decisión que la fija: `docs/contexto/decisiones.md` (2026-07-10).

> **Verifactu clientes = registro colaborador social + certificado único Bamburu + pantalla de
> autorización de representación + activar + probar.**

- **Modelo.** Bamburu se registra ante la AEAT como **envío autorizado** (convenio de colaboración social
  para empresas de sistemas informáticos de facturación, **«Tipo 17»**) y remite los registros de **todos**
  los negocios con **un único certificado propio**. **Ningún cliente instala certificado.**
- **Autorización de representación.** Cada dueño la firma **dentro de Bamburu**, con el **modelo del Anexo II**
  (Resolución 18-12-2024, BOE 31-12-2024); la AEAT admite capturarlo por formulario dentro del propio SaaS.
  Debe quedar **guardada y ser acreditable ante la AEAT**: un "acepto los términos" **no basta**. Es pantalla
  + persistencia, no un checkbox.
- **El motor no se reescribe.** Cola, agrupación por obligado en un sobre, reintentos y encadenamiento se
  reutilizan **tal cual**. Solo cambian (a) el certificado firmante y (b) el flujo de autorización.
- **Requisito ya confirmado contra fuente oficial AEAT:** *un lote = un solo obligado tributario*, envíos
  separados por negocio. **Ya cumplido** por la cola actual (una Cabecera por sobre).
- **El alta es un trámite legal y externo, y solo lo puede iniciar Ibrahin.** Se hará con la plataforma al
  100 %, antes del lanzamiento. **Sin urgencia:** envío voluntario hasta la obligación general del
  **1 ene 2027**.

- **Verifactu — lo que existe hoy es una PRUEBA DE CONCEPTO:** ✅ Fase A (motor SOAP+mTLS, dos registros
  aceptados en preproducción) y ✅ cola de envío automático por negocio (2026-07-09), ambas con el
  **certificado personal del dueño**. Demostraron que la tubería llega a la AEAT de punta a punta. **No son
  el producto.** El `.p12` se borró del servidor tras el envío del 9-jul (regla de la Fase A) y el timer de
  la cola sigue sin instalar; **ya no hace falta activar nada con el certificado personal** — la activación
  real llega con el de Bamburu. Hoy vive solo el envío manual: `/admin/verifactu/envios` o
  `scripts/verifactu-enviar-preproduccion.mjs`. Estado verificado en `docs/verifactu/estado-certificado.md`.
- **Verifactu — ampliaciones técnicas pendientes:** envío de **anulaciones** (hoy solo altas), **subsanación**
  del aviso 2004, validación XSD formal. *(La ~~Fase B legal~~ queda resuelta por la decisión del 2026-07-10:
  el modelo de certificado ya está elegido — colaborador social, un único certificado de Bamburu. Queda solo
  el trámite, dentro de la tarea única de arriba. La ~~cola + timer por tenant~~ ya está hecha.)*
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

### Inventario (Pilar 3 — EN CURSO, no cerrado)
Lo que falta **no son cabos sueltos: es alcance pendiente del pilar.** No se empieza sin encargo.
- ✅ **Multi-almacén CERRADO** — las tres capas. Capa 1/2 (operar por almacén) `da7871e` · Capa 3
  (**traslados** `TR-NNNN`) `3af928f`. Verificado el 2026-07-10 sobre copia de BD real: el traslado valida
  stock en origen, es atómico, y **el valor total del inventario no cambia** al mover mercancía (solo cambia
  dónde está). DISA ya los ejecuta. Gates: `test-transfers` 30/0 · `verify-traslado-auditoria` 13/0.
- ⬜ **Stock mínimo / punto de pedido.**
- ⬜ **Trazabilidad por lote / nº de serie.**
- ⬜ **Sync e-commerce** (Shopify / Woo / Prestashop) — Capa 2 (congelada).

### Multiusuario / permisos
- **Administración de permisos por DISA (registrada, 2 pasos EN ORDEN).** *Paso 1 — Fundamento:* repasar TODAS las rutas/servicios de los pilares y confirmar que cada acción exige el permiso correcto (`requirePerm`), no solo sesión, con un modelo de permisos limpio agrupado por áreas. *Paso 2 — DISA administra hablando:* el dueño gestiona usuarios/accesos por conversación y DISA lo traduce vía servicio validado (DISA nunca escribe permisos directo; patrón T5/cobros). El Paso 2 no arranca sin el Paso 1 cerrado.

### Riesgos / decisiones abiertas
- **D3 · [riesgo legal a resolver] Documento de pedido titulado "FACTURA" que no es la factura Verifactu** (`routes/orders.js:442`). Quedó neutralizado al desmontar `orders.js` en PIEZA C; verificar que ya no es alcanzable y decidir renombrar/retirar/aclarar. *Estado: revisar.*
- **D6 · [a verificar] XSS en páginas públicas de la tienda** (HTML guardado por admin sin escapar). La tienda está apagada de forma reversible (D1); revisar antes de reabrir en Capa 2. *(El bug de fuga de stock de `cancel_order` ya quedó resuelto al archivar `sales_orders`, D4.)*

### Deuda técnica
- ✅ **Etiquetas de `activity_logs`: CERRADO (2026-07-10).** DISA y las rutas nombraban distinto la misma
  cosa (`invoices`/`invoice`, `products`/`product`, `clients`/`client`, `suppliers`/`supplier`,
  `admin_users`/`admin_user`), y la vía genérica de DISA escribía el **nombre de la tabla**. Ahora las
  **26 entidades viven en `core/activity-entities.js`** y las importan los dos lados: 110 sustituciones,
  cero literales tecleados. La pantalla `/admin/activity` estrena **filtro por entidad y buscador** (antes
  no tenía ninguno de los dos). El histórico **no se reescribe**: las filas viejas conservan su etiqueta y
  el desplegable las sigue ofreciendo. Gate: `verify-actividad-etiquetas.mjs` (32/0).
  *(Ojo: `logActivity` de DISA es un helper LOCAL con firma distinta a la de `core/auth.js` — no copiar el
  orden de argumentos.)*
- ✅ **DISA: acciones de PEDIDO RETIRADAS (2026-07-10).** Eran cinco (`create_order`, `edit_order`,
  `update_order_status`, `cancel_order` y el puente `create_invoice_from_order`) y escribían contra
  `sales_orders` / `sales_items` / `order_status_history`, las tres **archivadas por D1**: reventaban con
  "no such table". D1 las había neutralizado con una guarda que respondía "en migración", pero dejó los
  `case` y su declaración en el prompt, así que **DISA seguía anunciando una función que no existía**.
  Retiradas del todo: guarda, `case`, prompt, permisos, el import de `generateInvoice` y la sección §6 de
  `test-disa-clientes-t5` (un test aparcado que no probaba nada). **El flujo humano no se tocó.** Gates:
  `verify-disa-sin-pedidos` (32/0, estructural) y `verify-disa-pedidos-modelo-real` (10/0, contra el modelo
  de verdad: pide crear/cancelar/facturar un pedido y DISA declina y redirige a `/admin/pedidos`).
- ⬜ **`modules/erp/routes/orders.js` está desmontado** (POS viejo, `routes/index.js:106` y `:159`) pero
  sigue en el árbol, con 6 `logActivity` que nunca se ejecutan. Retirarlo o revivirlo, no dejarlo a medias.
  *(Sus hermanos ya cayeron: `generateInvoice` de `invoices.js` sigue neutralizada desde D1 —lanza 410— y su
  ruta `/from-order/:orderId` tampoco se usa. Van juntos en el mismo encargo.)*
- **DISA `create_order` multi-línea:** limitación heredada de la base e-commerce; los pedidos multi-línea entran con el flujo pedido→albarán→factura.
- ~~Arreglar `scripts/gate-avisos-badge.mjs`~~ — **ya no reproduce**: ejecutado el 2026-07-10 pasa **25 OK**.
  Si vuelve a fallar por la ruta de BD fija, reabrir con la salida del fallo.

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
