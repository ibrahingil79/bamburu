# TABLERO — Fase de optimización

> **DÓNDE ESTAMOS HOY (2026-07-16).** Eje A (UX) **completo**. Multi-almacén **cerrado** (las tres capas;
> los traslados se verificaron el 10-jul: el valor del inventario no cambia al mover stock). Módulo de
> **Avisos al 100 %** (contador en vivo + fuente "cliente en riesgo"; el bucle de la campana, arreglado).
> **Verifactu para clientes NO es "activar la cola"**: el plan es **colaborador social** (un único
> certificado de Bamburu + autorización de representación del cliente), y está **aparcado** hasta tener la
> plataforma al 100 % — ver `docs/contexto/decisiones.md` (2026-07-10).
>
> **EJE C — SEGURIDAD: ✅ COMPLETO (C1–C6, 16 jul) + C5-bis (rescate de los dueños) + C5-ter (cerrojo del
> superadmin y email fuera de los eventos, 17 jul).** Los tres ejes de la fase de optimización quedan
> cerrados (A: UX · B: DISA · C: Seguridad), y no queda ningún cabo anotado del Eje C.
>
> **ORDEN VIGENTE (17 jul 2026): LA ESCALERA — ver la sección `## LA ESCALERA` al final, y CANON §4.**
> La fase de optimización quedó cerrada y la sucede una **escalera numerada** donde cada peldaño se
> apoya en el anterior: **1 sincerar → 2 margen → 3 informes → 4a/4b constructor de analíticas (la
> puerta visual) → 5 DISA predictiva → 6 dashboards → 7-9 oficios → 10-19 el resto.** **Se acabaron
> "El Foso" y el "Roadmap futuro"**: cada módulo tiene número. **Pasos 1 (sincerar), 2 (margen) y 3
> (catálogo de las 5 áreas + responsable + informes por área + plan financiero) HECHOS (17 jul).**
> **HECHO el constructor completo: 4a (ventas) + 4a-bis (compras/clientes/inventario) + 4b (cálculos
> propios, combinar fuentes, compartir paneles).** **Contabilidad sigue FUERA, pendiente de tu decisión.**
> **Pasos 5 (DISA predictiva: vigía + voz + dibujo + priorización/Inicio) y 6 (Inicio personalizable)
> HECHOS y VALIDADOS por Ibrahim en pantalla (21 jul 2026). Paso 7 (servicios profesionales · 1er oficio)
> EN CURSO: Piezas 1 (proyecto), 2 (registro de tiempo) y 3 (facturar horas) VALIDADAS por Ibrahim en
> pantalla (21 jul; «Proyectos» ya es área propia del rail). **Pieza 4 COMPLETA (parte 1: rentabilidad
> por proyecto — resultado contable; parte 2: coste de las horas — resultado de gestión), ENTREGADA y
> verificada por test + gate en navegador real (22 jul).** Siguiente: **Pieza 5 (calendario)**, a la
> espera de tu encargo. No se inicia nada sin tu encargo.** El **Backlog** de abajo NO
> compite con la escalera: es lo que le falta a El Suelo (el umbral) más la deuda. Plan del Eje C
> cargado desde la auditoría del 15 jul (ver la
> sección "Eje C: Seguridad"). **C1 (Verifactu, ALTA), C2 (verificación con administrador), C3 (tres
> victorias rápidas), C4a + C4a-bis HECHOS** → **M1 (XSS almacenado) CERRADO ENTERO**. **C4b: hechos
> C4b-0 (nonce + sonda), C4b-1 (registro y superadmin ya sirven `script-src` SIN `'unsafe-inline'`) y
> C4b-2 (los 4 scripts de CDN, autoalojados)**. **C4b-3 (store) y C4b-4 (ERP): DECIDIDOS el 16 jul —
> NO se les aplica la CSP; deuda consciente, con dueño y por escrito** (ver sus fichas). **C5 HECHO
> (16 jul)**: sesiones revocadas al desactivar, freno + enumeración cerrada en `forgot-password`, y 2FA
> con códigos de rescate en el superadmin. Siguiente tarea real: **C6** (los 12 hallazgos BAJA), con
> **C5-bis** (códigos de rescate para los dueños) anotada como producto. Eje A (UX) y Eje B (DISA, seis
> propuestas de proactividad) completos; Pilar 3 (inventario) cerrado.
>
> **Inventario (Pilar 3) CERRADO (15 jul 2026):** multi-almacén (`da7871e`/`3af928f`), stock mínimo /
> punto de pedido (`8b4fbe4`) y trazabilidad por lote / nº de serie (`f56ad84`). Ver el Backlog.

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

## Eje B: DISA  ✅ COMPLETO (D0–D5f)
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
    - ✅ **D5f — REPOSICIÓN DE STOCK (15 jul 2026, `8b4fbe4` + `ff98547`).** Sexto tipo (`reposicion_stock`)
      y cierre del **stock mínimo / punto de pedido** del Pilar 3 (ver Backlog › Inventario). Se ancla al
      PROVEEDOR habitual del producto (reutiliza `supplier_id`). Tres piezas: **NIVELES** por (producto,
      almacén) —tabla `stock_levels`, mínimo+objetivo, apagados por defecto, solo físicos, FUERA de
      WRITABLE_TABLES, editables en la ficha—; **AVISO** "bajo mínimo" en campana+correo, que **reemplaza la
      heurística fija stock<5** (una sola línea en `stockBajo`) y se mide contra el DISPONIBLE por almacén
      (físico − reservado); y la **PROPUESTA** que AGRUPA por proveedor → un borrador de orden de compra con
      todos sus productos bajo mínimo (cantidad = objetivo − disponible; coste = `lastKnownCost`; reutiliza
      `createPurchaseOrderSvc`). **Aprobar CREA el borrador y lleva a la vista para revisarlo; NO lo envía**
      (2º clic del dueño). Un producto sin proveedor habitual **avisa pero no se propone** (pide asignarle
      uno, no lo inventa). Candado **`purchases.create`**. **NO DUPLICAR:** una viva por proveedor (índice
      único parcial); descartada no reaparece con la misma huella; no se apila sobre un borrador vivo;
      recuperación + re-caída se re-propone. **Bug arreglado de paso:** `products.supplier_id` no se
      guardaba (faltaba en `productSchema`, Zod lo stripeaba) → el "proveedor habitual" ya persiste.
      Verificado: `verify-propuestas-reposicion.mjs` **46/0** (copias + clon limpio) + `gate-propuestas-
      reposicion.mjs` **16/0** (navegador, servidor real, limpia por id). Los gates de dormidos/fiscal
      pasaron a **6 tipos**.
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

## Eje C: Seguridad  ✅ COMPLETO (C1–C6)

> Origen: **auditoría de seguridad de SOLO LECTURA del 15 jul 2026** (`docs/seguridad/auditoria-ejeC.md`,
> commit `24dbf2a`). Postura general **buena** (aislamiento entre negocios sólido y fail-closed, DISA no se
> sale de `WRITABLE_TABLES`, backups montados y verificados, transporte/cabeceras casi completos). Cada
> tarea referencia su(s) **código(s) de hallazgo del informe** con file:line — no descripciones de memoria.
> Orden = por gravedad y reversibilidad. **Estado (16 jul): CERRADO — C1 a C6 hechas.** Lo que NO se
> arregló (B5, B11-tienda, B12 como riesgo asumido; B10 aplazado; C4b-3/C4b-4 descartadas) está por escrito
> con dueño y fecha en sus fichas y en el informe. El estado vivo de cada tarea está en su ficha, abajo —
> esta línea no lo duplica.

- ✅ **C1 — [A1 · ALTA] Cadena legal de Verifactu encadenada por NIF del emisor (15 jul 2026, `2fdc9bf`).**
  Lo que quedaba sin proteger: el encadenado elegía el previo por `id` GLOBAL, así que un cambio de NIF en
  Ajustes cruzaría dos cadenas legales en silencio (irreparable una vez enviado a la AEAT). **PASO 0 (solo
  lectura):** `id_emisor` estaba POBLADO en los 3 tenants con registros y coincidía con el NIF de cada
  empresa (0 vacíos) → sin relleno; las 2 facturas enviadas a la AEAT, intactas. **Arreglo:** (a) filtro por
  `id_emisor` en los dos sitios — `verifactu.js` (`lastHuella(db, idEmisor)`) y `verifactu-envio.js` (previo
  del envío `AND id_emisor=?`); (b) **candado** en Ajustes: bloquea el cambio de `company_config.fiscal_id`
  si ya hay registros Verifactu (409); (c) **guarda** en `recordVerifactuAlta/Anulacion`: detiene la emisión
  (409) si la base ya tiene registros de otro NIF; (d) **cinturón** idempotente (migración por bandera) que
  completa `id_emisor` vacío con el NIF de la empresa (0 filas hoy; no toca la huella). Para un solo NIF las
  cadenas quedan IDÉNTICAS (sin cambio de comportamiento). Verificado: `verify-verifactu-cadena-nif.mjs`
  **18/0** (reproduce el fallo global≠per-NIF, guarda, candado, cinturón, datos intactos) + comprobación en
  navegador de que emitir una factura sigue funcionando y encadena bien. Regresión verde (t1 18/0, t2 17/0,
  mostrador 24/0, cola 62/0). *(De paso, hallazgo nuevo: `verify-mostrador-overstock.mjs` emite tickets al
  tenant VIVO y no limpia sus registros Verifactu — higiene de gate a arreglar; anotable como BAJA del Eje C.)*

- ✅ **C2 — Verificación con administrador de los 4 puntos "no verificados" (16 jul 2026).** VERIFICACIÓN
  (sin cambios de config/código), regla de oro cumplida (ningún valor de secreto impreso). **Los 4 salieron
  OK — ningún problema, ninguna tarea nueva.** (1) Redirect http→https en runtime: petición real por `:80` →
  **308 → https://** (apex y subdominio con query). (2) Remoto rclone `gdrive:` válido y alcanzable, con la
  copia MÁS RECIENTE de HOY (8 archivos en Drive, diaria sin huecos, restore-test real en el journal). (3)
  `/etc/bamburu.env` = **600 ubuntu:ubuntu**, no legible por terceros; claves presentes por nombre (sin
  valores); el CF_API_TOKEN va en el entorno de Caddy, no aquí. (4) Caddy **sin directiva `log`** y
  `/var/log/caddy/` vacío; **0** líneas con el token de reset en journald (Caddy y bamburu) → el token no
  acaba en ningún log. Detalle en `docs/seguridad/auditoria-ejeC.md` § "C2 — verificación con administrador".

- ✅ **C3 — Victorias rápidas (tres arreglos, 16 jul 2026).** VERIFICADO: `npm audit` sin la CVE de `hono`;
  barrido oficial `run-gates --all` **43/46** — los 3 rojos (`verify-propuestas-dormidos`, `gate-recepciones-c1b`,
  `gate-c1c-diferencias-cierre`) son **pre-existentes por datos vivos, NO C3**: `dormidos` confirmado por `git stash`
  (falla igual en el código previo) y los dos de navegador fallan por precondición de datos (`stock 309→309`, el
  `confirmReceipt is not defined` cae en cascada al aterrizar en la página equivocada) — el diff de esos ficheros es
  solo server-side y sus gemelos (`gate-propuestas-dormidos`, `gate-orden-compra-c1a`) pasan. App arranca y responde igual.
  - **[M2] `hono` 4.12.18 → 4.12.30** (parchea la CVE HIGH de restricción por IP). Sin cambios incompatibles con el
    uso actual; regresión en verde. `package.json` a `^4.12.30`, `npm audit` = 0 vulnerabilidades.
  - **[M7] El login ya no registra email ni estado de 2FA** — `modules/erp/routes/auth.js`
    (`console.log('[Login] user:', email, '| totp_enabled:', …)` → `console.log('[Login] ok userId:', user.id)`).
    Comprobado en vivo: provocado un login real, el journal muestra `[Login] ok userId: N` y CERO email/totp/2FA.
  - **[M4] Ningún `e.message` de SQL viaja al cliente** — helper central `core/errors.js` `safeError(e)`: un 4xx
    intencional muestra su mensaje; SQL/inesperado → mensaje genérico y el detalle va SOLO al log del servidor.
    Aplicado a 236 `catch` en 38 ficheros. Gate `verify-safe-error` (15/0) añadido al grupo `infra` del barrido.
    Comprobado en vivo: categoría duplicada → el cliente ve "Ha ocurrido un error, inténtalo de nuevo." y el
    `[error] SqliteError: UNIQUE constraint failed: categories.name` queda en el log del servidor, nunca en el cliente.

> **C4 SE PARTIÓ EN TRES (16 jul 2026, decisión del dueño).** El informe daba M1 como «BAJO por caso, 6
> sitios»; el barrido de verdad encontró **67 puntos** (58 abiertos tras C4a). Y M8 (la CSP) resultó ser un
> refactor de todo el admin —**414 `onclick` + 109 handlers + 81 `<script>` inline**, y los nonces NO cubren
> los handlers de atributo—, no una tarea de sesión. Empaquetarlos juntos habría dejado el XSS real esperando
> semanas a la CSP. C4a (hecho) · C4a-bis (los 58) · C4b (la CSP).

- ✅ **C4a — [M1] Saneado del XSS almacenado: los 6 del informe + una clase de fallo que el informe no vio
  (16 jul 2026).** Los 6 listados, envueltos en `escHtml` respetando la convención de cada fichero
  (`escHtml` a pelo en `clients.js`/`products.js`, `window.escHtml` en `categories.js`/`discounts.js`):
  notas de cliente, grupos, categorías, descuentos automáticos (`a.name` + `a.condition_value`) y los dos
  `<option>` del editor de producto. Más el `<option>` server-rendered de proveedor (`purchases.js`, que no
  importaba `escHtml`) y el escape PARCIAL del almacén (`replace(/</g,'&lt;')` → `escHtml`).
  - **HALLAZGO NUEVO — ruptura de `</script>`, peor que los seis:** `purchases.js` inyectaba el catálogo en
    un `<script>` con `var PRODUCTS=${productsJson}`. Un producto llamado `</script><img src=x onerror=…>`
    cerraba la etiqueta y el resto se parseaba como HTML. **`escHtml` NO lo arregla** (dentro de un
    `<script>` no se decodifican entidades). Defensa: **`jsonForScript()` en `core/escape.js`** (helper
    central, un solo sitio, como `safeError()` en C3). El código ya conocía el vector en UN sitio
    (`store/routes.js:1444`) y no en su gemelo — la misma evidencia de omisión que el almacén.
  - **LOS 3 MÁS GRAVES DEL BARRIDO, arreglados aquí** (el resto → C4a-bis):
    - **`superadmin/index.js:177,189` — ANÓNIMO → SESIÓN DE SUPERADMIN.** Cadena verificada entera:
      `/api/registro/crear` es **público** (rate-limit, sin auth) · `businessName` se valida con `str(120)`
      = `z.string().trim().min(1).max(120)`, **sin filtro de HTML** · la lista de Negocios escapa bien
      (`:156-157`) **pero** `saCap()`/`saSuspend()` leen `tr.dataset.name`, que el navegador devuelve
      **DECODIFICADO**, y lo reinyectan por `innerHTML`. Un desconocido se da de alta con un nombre-payload
      y ejecuta código en la sesión del superadmin **en cuanto se pulsa un botón de su fila**. El `escHtml`
      del atributo es justo lo que lo escondía. Arreglo: `saEsc()` en `superadmin/layout.js`, junto al
      `saOpenModal` que hace el `innerHTML`. **Matiza el titular del informe** («ningún agujero crítico
      explotable de forma anónima»): plantarlo es anónimo; ejecutarlo depende de un clic del superadmin.
    - **`invoices.js` — datos de empresa sin escapar en TODA factura** (`document_name`, `invoice_number`,
      `company_name`, `company_fiscal_id`, `company_address`, `tax_name` ×3, `notes`, `it.description`).
    - **`stock-modal.js:50` + `inventory.js:50` — `WAREHOUSES` (Clase B).** El gate demostró que arreglar
      solo el componente compartido NO bastaba: `inventory.js` declara **su propia** const `WAREHOUSES`
      duplicada en la misma página (la del componente vive dentro de un IIFE, por eso conviven). El
      `</script>` rompía el `<script>` entero y se llevaba por delante hasta el IIFE ya arreglado.
  - **Verificado:** `verify-xss-escape` **14/0** + `gate-xss-escape` **23/0** (navegador, 4 pantallas:
    Categorías · Nueva compra · Inventario · Superadmin), ambos en el grupo `infra` del barrido. **El gate
    REPRODUCE el fallo**: con `git stash` sobre el código anterior da **18 rojos** — `/admin/purchases/new`
    moría con `SyntaxError` y `PRODUCTS` a `undefined`, y en Superadmin el payload **sí** ponía
    `window.__xss` tras pulsar «Tope IA». Limpia tras de sí, también en `control.db`.
  - **Lo que NO se pudo probar en vivo, y por qué:** el papel de la factura lee `inv.company_name` etc. de
    la **fila de `invoices`** (snapshot congelado al emitir), no de la config viva. Plantar un payload ahí
    exigiría **mutar una factura ya emitida** —documento legal con huella Verifactu—, que el ritual prohíbe.
    Ese arreglo queda verificado por revisión + regresión, no por payload. Anotado a conciencia.

- ✅ **C4a-bis — [M1] Cerrado el resto del XSS almacenado: 44 puntos (16 jul 2026).** Con esto, **M1 queda
  cerrado entero**: no queda ni un sink de Clase B con datos de usuario, ni un escape parcial de los
  inventariados. Misma solución central que C4a, sin mecanismos nuevos: `escHtml` (`core/escape.js` y su
  espejo `window.escHtml`) para HTML, `jsonForScript` para todo lo que aterriza en un `<script>`.
  - **ERA 44, NO 58 — y el error era mío, del TABLERO.** El "58" era el recuento del barrido **anterior** a
    los 3 arreglos graves de C4a, y esos 3 se llevaron 15 puntos por delante (las 10 líneas de `invoices.js`,
    las 2 de superadmin, las 2 de `WAREHOUSES` y el parcial de `inventory.js:21`). El inventario real, ya
    verificado contra el código: **43 abiertos** + **1 hallado al verificar** (`orders.js:932`, `PRODUCTS` con
    `JSON.stringify` crudo — Clase B, no estaba en la lista). Lección: un inventario con `~` y `…` no es una
    lista cerrada; hay que fijarlo con `file:line` verificado o no sirve para acotar alcance.
  - **Reparto de los 44:** 9 de Clase B (`albaranes.js` `linesJson` · `purchase-orders.js` `catalog`+`SEED` ·
    `stock-transfers.js` `catalog` · `supplier-returns.js` `ORIGINS` · `quotes.js`/`pedidos.js` `PRELOAD` ·
    `invoices.js` `SEED_LINES` · `orders.js` `PRODUCTS`) · 8 de Clase A servidor (papel de compra ×6 +
    `store/routes.js` ×2) · 18 de Clase A cliente · 9 escapes parciales completados.
  - **12 de los 44 están en CÓDIGO MUERTO, y hay que saberlo:** `/admin/orders` y `/admin/shipping` dan
    **404** — sus `admin.route(...)` están comentados (`routes/index.js:108,112`) y `shipping_methods` está
    archivada; es el clúster de e-commerce que desmontó D1. Son `orders.js` (9 puntos) y `shipping.js` (3).
    Se arreglan igual —red por si se remontan— pero **no eran vulnerabilidades vivas** y **no se pueden
    verificar en navegador**: la pantalla no existe.
  - **`store/routes.js` (2, Capa 2 congelada) — tocado CON permiso expreso del dueño.** Es el único XSS del
    inventario que alcanza a un CLIENTE FINAL, no al panel: `<img src="${p.image_url}">` rompía el atributo,
    y en `:1380` además `onclick="setMainImg(${JSON.stringify(img)},this)"` metía comillas dobles dentro de
    un `onclick="..."`. Se usa `escHtml` y NO `safeUrl` a propósito: la CSP permite `data:` y `blob:` en
    `img-src`, y `safeUrl` los rechazaría — rompería imágenes que hoy funcionan.
  - **Verificado:** `verify-xss-escape` **49/0** · `gate-xss-escape` **29/0** (navegador). **Ambos DEMUESTRAN
    el fallo** contra el código previo (`git stash` de solo `modules/`, para no revertir los propios gates):
    **9 rojos** en el guardián estático y **6 rojos** en navegador, con `ReferenceError: catalog is not
    defined` — el `</script>` mataba el script entero. Barrido `run-gates --all` **45/48**: los 3 rojos son
    los MISMOS pre-existentes por datos vivos (`verify-propuestas-dormidos`, `gate-recepciones-c1b`,
    `gate-c1c-diferencias-cierre`), NO de esta tarea.
  - **Por qué parte del gate es ESTÁTICA (`verify-xss-escape` [5]/[6]) y no de navegador:** cada sink que
    falta vive en una pantalla que exige un DOCUMENTO montado (un albarán nace de un pedido confirmado;
    `PRELOAD`, de un presupuesto guardado; `ORIGINS`, de una compra recibida). Montar esos fixtures cuesta
    más que el arreglo y mete escrituras de documentos —algunos con valor legal— dentro de un gate de
    seguridad. Lo que sí se afirma sin ambigüedad es la REGLA: si el dato lo escribe el usuario y aterriza
    en un `<script>`, se serializa con `jsonForScript`. Los sinks alcanzables (catálogo ×2, inventario,
    nueva compra, categorías, superadmin) se prueban de verdad en navegador.
  - **Deuda de fondo, NO cerrada aquí (no estaba en el alcance):** ~14 ficheros definen su propio `esc` local
    — es `core/escape.js` duplicado 14 veces. No es un agujero (los inventariados ya se completaron), pero es
    la causa de que estos fallos se repitan. Quedan parciales fuera del inventario en `layout.js:111,186,300`,
    `email-templates.js:28` y `contabilidad-export.js:136` (este último es escape XML, otro contexto).

- 🟡 **C4b — [M8] Quitar `'unsafe-inline'` de `script-src`. C4b-0, C4b-1 y C4b-2 HECHOS (16 jul 2026).
  Falta decidir C4b-3 (store) y C4b-4 (ERP) — AHORA CON DATOS MEDIDOS.**

  > **EL DATO QUE DECIDE C4b-4, ya no es una opinión: `CSP_PROBE=1` sobre las 23 pantallas del ERP da
  > 108 violaciones, TODAS `script-src-elem` (bloques `<script>`) y CERO de handlers. Porque los
  > `onclick` NO violan al cargar: solo al PULSARLOS.** Comprobado en `/admin/categories`: 5 violaciones
  > al cargar, **25 botones con `onclick` en el DOM sin delatar ni una**, y al primer clic aparece
  > `script-src-attr`. Traducido: **una pantalla del ERP puede parecer perfecta y tener 25 botones
  > muertos.** Verificar C4b-4 exige PULSAR los ~470, uno a uno. Ese es el coste real, y ahora está medido.

  > **La premisa que lo cambia todo: la CSP es una cabecera POR RESPUESTA.** No hay que migrar los 522
  > handlers para empezar a proteger — se puede endurecer superficie a superficie. Y **las superficies
  > críticas son diminutas: registro 2 handlers, superadmin 11.** El 90% del problema (470) está en el ERP,
  > que es justo donde menos urge. Esto convierte "refactor de todo el admin" en "13 handlers y dos
  > superficies", con el ERP como decisión aparte y con datos.

  **Regla técnica que manda el diseño:** en cuanto una respuesta lleva un **nonce** en `script-src`, el
  navegador **IGNORA `'unsafe-inline'`** en esa respuesta. No existe migración parcial DENTRO de una página:
  es todo-o-nada **por respuesta**. Por eso el corte es por superficie, y por eso no se puede "ir soltando"
  el `unsafe-inline` poco a poco en la misma página.

  **Medido el 16 jul (no de memoria):**
  - **522** handlers son **atributo HTML** (`on…="…"`) → los bloquea la CSP. Otros **8** son asignaciones JS
    (`el.onclick = fn`) y **NO** las bloquea: el número real es **522**, no 530.
  - Reparto: **registro 2** · **superadmin 11** · **store 20** · **disa 19** · **ERP 470**.
  - **DISA NO es superficie separable:** su widget se inyecta en `adminLayout` (`layout.js:1178`) → comparte
    respuesta, y por tanto CSP, con el ERP. Van juntos (489).
  - **83** `<script>` inline (68 en el ERP) y solo **2** externos.
  - `base-uri 'self'` y `object-src 'none'` **ya están puestos**, y no hay `'unsafe-eval'`: de M8 solo queda
    el `'unsafe-inline'`.

  ### ✅ C4b-0 — Fontanería + instrumento de medida — HECHO
  Nonce por petición en `core/security-headers.js` (se genera ANTES de `next()`, va a `c.set('cspNonce')`
  y la política se elige DESPUÉS según `SUPERFICIES_ESTRICTAS`). Y la sonda: **`CSP_PROBE=1`** añade la
  política estricta en `Content-Security-Policy-Report-Only` a las superficies NO endurecidas — no bloquea
  nada, solo apunta. Apagada por defecto: producción no la ve.
  **Resultado de medir el ERP (23 pantallas): 108 violaciones, todas `script-src-elem`.** O sea, los
  bloques `<script>` (4-5 por pantalla, porque casi todas comparten `adminLayout`), NO los 470 handlers
  — esos solo se delatan al pulsar. La sonda mide media montaña; la otra media exige clics.
  *(Para correrla: `set -a; . /etc/bamburu.env; set +a` y arrancar una instancia con `CSP_PROBE=1` en otro
  puerto. Sin las variables de entorno el módulo ERP no carga y todo da 404 — parece que no hay
  violaciones cuando lo que pasa es que no hay app.)*

  ### ✅ C4b-1 — registro (2) + superadmin (11) — HECHO. Las dos superficies que más duelen
  `/registro` es **público y anónimo**; superadmin es **la cuenta que ve todos los negocios** — donde C4a
  encontró el peor agujero del proyecto. **Ambas sirven ya `script-src 'self' 'nonce-…'`, SIN
  `'unsafe-inline'`.** El ERP conserva la política de siempre, a propósito.
  - **Cómo se migró cada tipo de handler** (respetando el idioma de cada fichero, sin inventar un
    framework): los botones de FILA de superadmin → **delegación** sobre `tbody` leyendo `data-act` (la
    fila ya tenía `data-id`); los botones de MODAL (los que nacen del `innerHTML` de `saOpenModal`) →
    `id` + `.onclick=`, que es **el idioma que ese fichero YA usaba** en `susAdmin`/`susSec`; registro →
    `addEventListener` en el script.
  - **Nonce**: uno por petición (`randomBytes(16)`), pasado a `saLayout(...,nonce)`, a
    `changePasswordPage(sess,nonce)` y a `onboardingHtml(nonce)`; las vistas con `<script>` propio lo
    leen de `c.get('cspNonce')`.
  - **DOS FALLOS QUE CAZÓ EL GATE, y que son la lección de C4b:** (1) el enganche de registro quedó dentro
    de `showCreateButton()`, que solo corre al final del alta → los 2 botones **muertos al cargar**, sin
    error y sin violación de CSP; (2) al moverlo arriba, `ReferenceError`: `togglePw`/`crear` son
    `window.x = function(){}` (asignaciones, **no** declaraciones), así que no se hoistean → se enganchan
    con una función flecha para que la búsqueda ocurra al PULSAR. **Ninguno de los dos se ve al cargar la
    página.** Esto es exactamente lo que pasaría ×470 en el ERP.
  - **Verificado:** `gate-csp-estricta` **19/0** (en el grupo `infra`). Comprueba la cabecera, que el nonce
    CAMBIA en cada petición, que el ERP NO se ha endurecido de rebote, y **pulsa los botones** de verdad
    («Mostrar» cambia a «Ocultar»; «Tope IA» abre su modal por delegación; «Cancelar» lo cierra), con CERO
    violaciones. **Demuestra el fallo**: contra el código previo (`git stash` de solo `modules/ core/`) da
    **8 rojos limpios**, sin reventar.

  ### ✅ C4b-2 — Los scripts de CDN, autoalojados — HECHO. **Eran 4, no 2**
  El plan decía 2 porque el `grep` miró en `modules/` y **no en `index.js`**: la **landing pública** cargaba
  además **gsap + ScrollTrigger** (`index.js:343-344`), también sin `integrity=`. Los 4 iban a pelo desde
  `cdn.jsdelivr.net`: comprometer ese CDN = **JS arbitrario en el panel Y en la landing**, y eso no lo tapa
  ningún escapado.
  - Ahora se sirven desde `'self'` en `public/vendor/` (misma convención que `tabler`, que ya estaba
    autoalojado): `gsap/` (gsap 3.12.5 + ScrollTrigger), `chartjs/` (chart.js **4.5.1**), `sortablejs/`
    (1.15.0). **Bajados con `npm pack`, NO con curl del CDN**: así la integridad la verifica el registro de
    npm y no el mismo CDN del que se desconfía.
  - **`cdn.jsdelivr.net` fuera de `script-src`, `style-src` y `font-src`.** `fonts.googleapis/gstatic` SE
    QUEDAN: los usan la tienda, la landing y `public/bamburu.css`.
  - De paso se **congela la versión**: `chart.js@4` flotaba a la última 4.x sola, en cada carga.
  - **Verificado en navegador:** landing (`window.gsap` + `ScrollTrigger`) y Analítica (`window.Chart`, 2
    gráficos pintando) — 200, sin errores JS, sin violaciones. **Sortable NO se pudo probar: vive en
    `/admin/store-settings`, que da 404** (constructor de tienda desmontado por D2, `routes/index.js:115`).
    Cuarta vez que aparece código muerto en este eje.

  ### 🔒 C4b-3 — store (20 handlers) — DECIDIDO (16 jul 2026): NO, mientras esté apagada
  **Decisión del dueño. La tienda NO se endurece mientras esté apagada/desmontada.** Endurecer una
  superficie que hoy no sirve a nadie es pagar el riesgo de romperla sin cobrar la protección: no hay
  usuario al que proteger porque no hay tienda encendida. **Si algún día se reactiva como producto, el
  endurecimiento entra CON esa reactivación** — no después y no como tarea suelta: forma parte de volver a
  encenderla, igual que volver a probarla. Esto es deuda **consciente y con dueño**, no un olvido.

  ### 🔒 C4b-4 — ERP + DISA (489) — DECIDIDO (16 jul 2026): NO se le aplica la CSP
  **Decisión del dueño, con los datos de la sonda ya medidos (abajo).** El panel de gestión (470 botones)
  se queda con `'unsafe-inline'`. Las tres razones, en orden:
  1. **El XSS ya está cerrado y con tests** (M1 completo: C4a + C4a-bis, 44 puntos saneados con gate). Aquí
     la CSP sería cinturón contra un XSS **futuro**, no contra uno vivo.
  2. **El precio es romper botones EN SILENCIO.** Un `onclick=` bajo CSP estricta no da error: simplemente
     no hace nada. Y la sonda demostró que **no se delatan al cargar, solo al pulsarlos** (25 botones en
     `/admin/categories` y CERO violaciones hasta el primer clic). Verificar exige pulsar ~470 a mano.
  3. **El 90% del valor ya está cobrado por el 2% del trabajo:** las dos superficies donde un XSS dolía de
     verdad —registro (anónimo) y superadmin (ve todos los negocios)— ya van con CSP estricta (C4b-1/2).
  **Deuda aceptada, con dueño y por escrito.** Si algún día se hace: por pantalla, con `CSP_PROBE=1` y
  pulsando todo. Terminar en "deuda anotada" es el resultado honesto, no un fracaso.

  #### Los datos que sostienen la decisión de C4b-4 (medidos, no estimados)
  470 + 19 handlers, 39 ficheros, 68 `<script>`. Las piezas compartidas cubren poco (~43 vía
  `rowMenu`/`emptyRow`/`cta:onclick`): el resto son **~470 ediciones a mano**.
  - **Lo que dice la sonda (medido, no estimado):** 23 pantallas, **108 violaciones al cargar, todas
    `script-src-elem`** — o sea, los BLOQUES `<script>` (4-5 por pantalla, casi todos de `adminLayout`).
    Esa parte es **barata**: marcar con nonce ~68 etiquetas.
  - **Lo que la sonda NO puede medir, y es el problema:** en `/admin/categories` hay **25 botones con
    `onclick` en el DOM y CERO violaciones al cargar**; al primer clic aparece `script-src-attr`. Los
    handlers **solo se delatan al pulsarlos**. Verificar los 470 exige pulsarlos uno a uno; los gates
    cubren ~49 escenarios, no 470 botones.
  - **Y el valor, dicho honesto:** M1 está CERRADO y con gate. Aquí la CSP es cinturón contra un XSS
    **futuro**, no contra uno vivo. Las dos superficies donde un XSS de verdad dolía (registro anónimo y
    superadmin) **ya están protegidas** — que era el 90% del valor por el 2% del trabajo.

  ### NO entra en C4b: `style-src`
  Son **2027** `style="..."` y el valor es muy inferior (inyección de ESTILO, no ejecución de código). Se
  queda `'unsafe-inline'` en `style-src`, a propósito y por escrito.

- ✅ **C5 — Endurecer el acceso (16 jul 2026).** Los tres entregables cerrados. **PASO 0 (solo lectura):**
  las sesiones son store en SERVIDOR (`admin_sessions` por tenant, cookie `asess`; el superadmin aparte en
  `control.db` + cookie `sadm`) → revocar es borrar una fila, no hay JWT que esperar a que caduque. Dos
  sorpresas, las dos a favor: el flujo de `forgot-password` YA existía con caducidad (1 h) y un solo uso
  (`used=0/1`) — de los tres puntos de M6 solo faltaba el freno; y el TOTP ya estaba escrito y probado en
  `core/totp.js` (M3 era cablearlo, no construirlo).
  - ✅ **[M5] Revocar las sesiones al desactivar un usuario.** El gate se puso en `getAdminSession`
    (`core/auth.js`), no en la ruta: así expulsa venga la desactivación de donde venga (panel, script, UPDATE
    a mano), y la sesión muerta se borra al detectarla. `PUT /users` además corta sus sesiones y su espejo en
    `control.db` (higiene, no el candado). Verificado: `test-c5-sesiones.mjs` **10/0** (rojo 4/10 antes).
  - ✅ **[M6] Freno en `forgot-password` + enumeración cerrada.** Dos limitadores encadenados: por **IP**
    (5/15 min, contra el barrido de una lista) y por **email** (3/15 min, contra inundar UN buzón desde mil
    IPs) — el de IP solo no cubre lo segundo. Para eso `rateLimit` acepta ahora `keyFn` (aditivo; sin ella se
    comporta igual que siempre). El **email nunca entra en `security_events`**: PII, misma lección que C3/M7.
    La enumeración tenía DOS fugas, no una: (a) si Resend fallaba salía un **500**, que solo podía verse con
    un email registrado — el error era la confirmación; (b) el reloj. Medido antes de tocar nada: **6,8 ms
    con cuenta real vs 0,7 ms sin ella — 10,4× y SIN SOLAPAMIENTO**, o sea que UNA medición clasificaba un
    email. El primer intento de arreglo (llamar sin esperar) **no bastó**: el cuerpo de una función `async`
    corre síncrono hasta su primer `await`, y el INSERT y `renderEmail` son de better-sqlite3 = síncronos.
    Con `setImmediate`: **1,01×, ramas indistinguibles**. Verificado: `test-c5-forgot.mjs` **24/0** (rojo
    9 fallos antes) + medición de 40 muestras por rama + comprobación contra el servidor vivo (freno real
    5→429; cuenta real vs inventada = misma huella de cuerpo).
  - ✅ **[M3] 2FA (TOTP) para el superadmin, con códigos de rescate.** Decisión del dueño: app de
    autenticación, no email. Alta con QR + secreto y **exigiendo un código válido** (activar a ciegas =
    cerrar con la llave dentro); 10 códigos de rescate mostrados UNA vez, guardados con bcrypt, de un solo
    uso (`used_at`, no borrado: deja rastro de cuándo). Regenerar y desactivar **piden el código**: si
    bastara la sesión, el 2FA no protegería del robo de sesión. Usar un rescate levanta evento en la zona
    Seguridad. Migración aditiva (`superadmin_recovery_codes`). Último recurso documentado:
    `scripts/superadmin-2fa-off.mjs <email>`. Verificado: `test-c5-2fa-superadmin.mjs` **39/0** (control.db
    desechable; los códigos TOTP los genera **otplib**, librería independiente → prueba de que una app real
    entra) + `gate-c5-2fa-superadmin.mjs` **18/0** en navegador real contra la CSP estricta, con cuenta
    desechable (activar el 2FA de la cuenta real desde un script es el bloqueo que C5 evita).
  - ✅ **Extra decidido por el dueño (salida de emergencia):** `scripts/reset-admin.js` ya limpia
    `totp_secret`/`totp_enabled`. **No era un extra: sin esto el script no rescataba a nadie con 2FA** — la
    persona entraba con la contraseña nueva y chocaba contra la pantalla del código, fuera para siempre.
    Hoy no había nadie en riesgo (`totp_enabled=0` en los 6 negocios), pero era un bloqueo permanente
    esperando al primer dueño que activara el 2FA.
  - *Hallazgo de paso:* `otplib` está en **`dependencies`** y no lo importa nadie en producción (el TOTP es
    `core/totp.js`, escrito a mano). Ahora solo lo usan el test y el gate → le tocaría `devDependencies`.
    Anotado, no tocado (fuera del alcance de C5).

- ✅ **C5-bis — Códigos de rescate para los DUEÑOS de negocio (16 jul 2026).** El dueño que active el 2FA
  y pierda el móvil ya NO se queda fuera: entra con un código de rescate, sin depender de que alguien
  entre por SSH un domingo. Reflejo del mecanismo del superadmin (C5), sin tocarlo.
  - **PASO 0 — lo que decidió el diseño:** `core/recovery-codes.js` **ya era el helper compartido**
    (genérico, no sabe nada del superadmin) → se reutiliza sin tocar una línea. La otra mitad —guardar y
    consumir— **no se puede compartir**: la del superadmin vive en `control.db` con `superadmin_id`; la del
    dueño, en la BD de cada negocio con `admin_user_id`. Bases distintas, ciclos distintos: se refleja
    (`enableAdminTotp`/`disableAdminTotp`/… en `core/auth.js`, reciben `db`), no se fuerza un helper común.
  - ✅ **Activar exige código y entrega 10 códigos** (`/admin/perfil/confirm-2fa`), en transacción: activar
    sin dar rescate es cerrar con la llave dentro. Se enseñan **una vez** (se renderizan, no se redirige:
    un redirect los perdería), con copiar y descargar, y el **"Terminar" nace BLOQUEADO** hasta marcar "he
    guardado". El modo de fallo real no es que los roben: es cerrar la pestaña sin guardarlos.
  - ✅ **En el login, el mismo campo acepta app o rescate** (`auth.js`, `POST /admin/verify-2fa`): primero
    TOTP, luego rescate; de un solo uso y atómico. Usarlo queda en **su Actividad** (con cuántos quedan) y
    levanta evento `login_2fa_rescate`. El código NUNCA se registra: sería publicar la llave usada.
  - ✅ **Regenerar exige código** (app o rescate) e invalida el juego anterior; el Perfil muestra cuántos
    quedan y cambia de tono si quedan pocos o ninguno. **Desactivar borra los códigos** (llave bajo el
    felpudo). Migración aditiva e idempotente por tenant: `admin_recovery_codes`.
  - ✅ **DISA no los toca:** añadida a `QUERY_PROTECTED_TABLES` — no bastaba con dejarla fuera del mapa de
    lectura, porque owner/admin hacen **bypass** de ese mapa y podría pedírselos por chat. (Escribir ya era
    imposible: `WRITABLE_TABLES` es allowlist.)
  - ✅ **Puerta trasera cerrada (decisión del dueño).** `/admin/setup-2fa`, `/admin/confirm-2fa` y
    `/admin/disable-2fa` seguían **montadas y funcionando** pese a que U8 consolidó el 2FA en el Perfil:
    activaban 2FA **sin códigos de rescate** — el mismo bloqueo, por detrás. Retiradas con **302 al Perfil**
    (patrón de U8 con `/admin/security`: "un 302 no rompe a nadie; un 404 sí"). De paso cierra lo que
    `security.js:15-18` dejó anotado como pendiente del Eje C: se montaban **fuera del middleware CSRF**.
    Ahora el 2FA del dueño tiene UNA puerta, y es la que entrega códigos.
  - Verificado: `test-c5bis-rescate-duenyo` **52/0** (tenant desechable; los TOTP los genera **otplib** →
    prueba de que una app real entra) + `gate-c5bis-rescate-duenyo` **19/0** en navegador real, de punta a
    punta: activa, ve los 10, cierra sesión, entra con un rescate y ese código ya falla al reutilizarlo.
    Regresión verde: **2FA del superadmin intacto** (gate 18/0, test 44/0), login sin 2FA sin cambios,
    forgot 25/0, sesiones 10/0, C6 32/0 + 28/0, registro 26/0, CSP 19/0.

- ✅ **C5-ter — Dos cabos del Eje C (17 jul 2026).** Coherencia con lo hecho en C5-bis y C6; sin producto
  nuevo. Los dos salían del "Dónde lo dejé" del 16-jul.
  - ✅ **T1 · El cerrojo "he guardado mis códigos", ahora también en el superadmin.** Era un **enlace
    normal** que se pasaba de largo sin leer, mientras el cliente sí tenía cerrojo desde C5-bis: la cuenta
    MÁS poderosa de la plataforma era la única sin él. Es el estándar del sector (GitHub, Google, AWS,
    Stripe no te dejan salir de la pantalla de códigos sin una acción afirmativa). **Mecanismo reutilizado,
    no inventado:** la misma casilla + `pointer-events` de `perfil.js`. Detalle que condicionaba:
    `/superadmin` va con **CSP estricta**, así que el JS vive dentro de los `<script nonce>` que ya
    existían (`cerrojoCodigosJs` devuelve el CUERPO, no la etiqueta, para que el nonce lo ponga quien
    inserta y no se le pueda olvidar). Un `onclick` de atributo ahí habría muerto en silencio.
  - ✅ **T2 · El email fuera de la tabla de eventos de seguridad.** Era **la contradicción del Eje C**: en
    C6 cerramos que nadie pudiera sonsacar por HTTP "¿existe este email?" y la tabla lo guardaba **en
    claro**, con la lista de los probados y cuáles existían. **Un solo punto de escritura** de los 11 que
    hay (`routes/auth.js`, dentro de `fallar()`); los otros 10 ya eran seguros. Minimización de datos:
    cuenta conocida → `usuario #<id>` (la referencia estable que ya usa el resto del sistema); email
    desconocido → **no se guarda** (solo "cuenta desconocida", que es la señal útil —alguien barriendo—
    sin el dato personal). **Sin hash:** nada correlaciona por `detail` (solo se PINTA en el panel;
    `securityCounts` agrupa por `type`), así que habría sido mecanismo nuevo sin nadie que lo use.
    Sin migración: la tabla no cambia de forma. La vigilancia no pierde nada — sigue la IP, el negocio, y
    si el intento iba contra una cuenta real o inventada.
  - ✅ **Y el comentario que mentía.** `auth.js` enunciaba desde C3/M7 que "NO se registra el email": era
    cierto de la línea de debajo (el `console.log`) y **falso como regla** —15 líneas más arriba sí iba a
    la tabla—. Un comentario que enuncia una regla que el propio fichero incumple es peor que no tenerlo:
    deja tranquilo a quien lo lee. Ahora es cierto, y lo dice.
  - **Filas viejas:** solo 2 (6-jul y 16-jul), residuo de pruebas, en una tabla **rodante** (se autopoda a
    ~1000 filas) → se van solas. No se tocan, por instrucción del dueño: hoy no hay clientes reales, así
    que no hay histórico que rascar. Lo que importa es que las nuevas nazcan sin email, y nacen.
  - Verificado: `test-c5ter-sin-email` **16/0** + `gate-c5ter-cerrojo-superadmin` **15/0** en navegador real
    con cuenta desechable (no se puede terminar sin marcar, se pulsa de verdad y no lleva a ninguna parte;
    marcar desbloquea; y un código de rescate vale una sola vez). Comprobado además **contra el servidor
    vivo**: un login fallido con la cuenta real deja `usuario #2`, no el email. Regresión verde (C5-bis
    52/0 + 19/0, superadmin 44/0 + 18/0, C6 32/0 + 28/0, forgot 25/0, sesiones 10/0, registro 26/0,
    CSP 19/0).
  - *Papercut de gates arreglado de paso:* los gates comparten la IP de loopback y el freno del login de
    superadmin son 8/15 min, así que **encadenar la suite ponía rojo al siguiente gate** por un fallo que
    no era suyo (me pasó y lo perseguí: el freno de C6 haciendo su trabajo). El gate nuevo declara IP
    propia, como ya hacía el de C5-bis. Verificado encadenando los dos gates de superadmin dos veces: 4/4
    en verde.

- ✅ **C6 — Los 12 hallazgos BAJA (16 jul 2026).** **8 arreglados · 3 asumidos por escrito · 1 aplazado con
  aviso.** Cierra el Eje C. El detalle, las decisiones y el porqué de cada "no", en
  `docs/seguridad/auditoria-ejeC.md` § "C6 — Los 12 hallazgos BAJA: cierre".
  - **Trabajado contra el código de HOY, no contra el informe:** 5 de los 12 `file:line` estaban rancios
    (C3/C4a/C4b/C5 movieron el código desde el 15-jul). Se localizó cada uno antes de tocar nada.
  - ✅ **[B3] El reset de contraseña ya EXPULSA** — era el peor de los doce y el único donde el sistema
    prometía algo que no cumplía: resetear no echaba a nadie, así que el intruso seguía dentro ≤24 h con la
    contraseña ya cambiada. Ahora cierra todas las sesiones y quema los enlaces pendientes. Mínimo a 10
    (servidor y pantalla), igual que el cambio propio: un mínimo es el más flojo de sus caminos.
  - ✅ **[B2] Allowlist de permisos en servidor** — la lista de ocultos vivía DENTRO del handler de la
    pantalla y solo servía para no pintarlos; la API los aceptaba. La seguridad era que el checkbox no
    estuviera dibujado. Ahora es fuente única (`HIDDEN_PERMS`) y la aplica la API. Falla entero (400 al lote)
    y queda en Actividad.
  - ✅ **[B4] Freno por CUENTA en el login, como ralentización** — decisión del dueño y bien traída: un freno
    por cuenta que RECHACE es un arma (cualquiera falla 5 veces contra tu email y te deja fuera). Ralentiza
    hasta 10 s y **nunca bloquea**; cuenta fallos, no intentos; un acierto los borra. Reutiliza el `keyFn` de
    C5. Un email inexistente se frena igual → el reloj no chiva.
  - ✅ **[B6] `/find-tenant` ya no chiva** — no se podía arreglar solo el texto: el flujo NECESITA contestar
    para redirigir, así que si contesta, delata. Cambiado a **enlace por correo** (patrón Slack "Find your
    workspaces", y el mismo de C5: la respuesta, fuera de banda). Token de un solo uso, 30 min, tabla
    aditiva `tenant_access_links`. La respuesta HTTP es `{"mode":"sent"}` exista o no el email. `/acceso` se
    simplifica: ya no ramifica (cada rama era, ella sola, la respuesta a "¿existe y dónde?").
  - ✅ **[B1] + [B7] Ningún secreto se imprime** — el alta ya no vuelca la contraseña semilla en cada negocio
    nuevo, y los 3 scripts de ops la piden por teclado sin eco (`scripts/lib/prompt-secret.mjs`). Sin TTY
    **abortan** en vez de degradarse: un script de credenciales que se apaña solo cuando lo capturan es el
    fallo que se evita.
  - ✅ **[B8] DISA no loguea los valores del WHERE** — `redactarSql()` conserva la forma (tablas, joins,
    cláusula) y pierde los valores. Eran los datos del dueño: "la factura de Juan Pérez" acababa en el journal.
  - ✅ **[B9] Las BD nacen privadas** — arreglados los 6 ficheros abiertos (los `-wal`/`-shm` también llevan
    datos, y el informe solo citaba los `.db`) **y la causa**: `chmod` explícito al crear y al abrir
    (`core/db-file-perms.js`), no umask — un umask solo protege a quien lo tenga puesto.
  - 🔒 **[B5] · [B11 tienda] · [B12] — riesgo ASUMIDO, con dueño y fecha.** B5 falla cerrado y tocar la
    selección de BD arriesga el aislamiento a cambio de nada; la cookie de la tienda no se endurece mientras
    esté apagada (misma decisión que C4b-3: si se reactiva, entra con ella); B12 es código muerto que no
    concede permisos, y retirarlo o cablearlo es decisión de diseño, no higiene. *(La otra mitad de B11, la
    cookie `btenant`, SÍ se cerró: sale con `Secure`.)*
  - ⏸️ **[B10] systemd — aplazado y con aviso.** Es el único que puede **tirar el servicio**: `ProtectHome`
    con las BD en `/home/ubuntu` es exactamente cómo se rompe. Si entra: solo, nunca mezclado, con
    verificación en vivo.
  - Verificado: `test-c6-acceso` **32/0** · `test-c6-secretos` **28/0** · `gate-c6-find-tenant` **22/0** (en
    el servidor real). Regresión verde: forgot 25/0, sesiones 10/0, 2FA 44/0, registro 26/0, CSP 19/0, gate
    2FA 18/0.
  - *Hallazgo nuevo, anotado sin arreglar (no estaba en el encargo):* el email SÍ entra en `security_events`
    (`routes/auth.js`, los dos caminos de fallo del login). C3/M7 lo sacó del `console.log` y dejó la tabla,
    aunque el comentario de al lado diga lo contrario. Defendible como telemetría del operador, incoherente
    con la regla que el propio código enuncia. **Decidir a conciencia.**

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

## Backlog — El Suelo y deuda (NO es la escalera)
Todas las tareas pendientes anteriores, **conservadas**. No se inician sin encargo del dueño.
**Esto NO es una lista de espera rival de la escalera:** es lo que le falta a **El Suelo** (el umbral de
admisión al mercado — Verifactu, contabilidad, permisos) más la deuda técnica y los riesgos abiertos.
La escalera (§LA ESCALERA, CANON §4) es **la ventaja**; esto es **el suelo bajo los pies**. Son cosas
distintas y por eso viven en sitios distintos.

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

### Inventario (Pilar 3 — ✅ CERRADO 15 jul 2026)
El pilar queda completo: multi-almacén + stock mínimo/punto de pedido + trazabilidad por lote/serie.
- ✅ **Multi-almacén CERRADO** — las tres capas. Capa 1/2 (operar por almacén) `da7871e` · Capa 3
  (**traslados** `TR-NNNN`) `3af928f`. Verificado el 2026-07-10 sobre copia de BD real: el traslado valida
  stock en origen, es atómico, y **el valor total del inventario no cambia** al mover mercancía (solo cambia
  dónde está). DISA ya los ejecuta. Gates: `test-transfers` 30/0 · `verify-traslado-auditoria` 13/0.
- ✅ **Stock mínimo / punto de pedido — CERRADO (15 jul 2026, `8b4fbe4` + `ff98547`).** Nivel MÍNIMO y
  OBJETIVO por (producto, almacén) —tabla `stock_levels`, apagados por defecto, solo físicos, editables en
  la ficha del producto—. El disparo se mide contra el DISPONIBLE del almacén (físico − reservado). AVISO
  "bajo mínimo" en campana + correo (reemplaza la heurística fija stock<5). Y la 6ª propuesta de DISA
  (**D5f**, `reposicion_stock`): agrupa por proveedor → borrador de orden de compra hasta el objetivo;
  aprobar lo CREA (no lo envía). Detalle en la sección de propuestas (Eje B). Gates: `verify-propuestas-
  reposicion` 46/0 + `gate-propuestas-reposicion` 16/0 (navegador).
- ✅ **Trazabilidad por lote / nº de serie — CERRADO (15 jul 2026, `f56ad84` + `13a61df`).** Un producto
  físico se marca `lot` (lotes con caducidad) o `serial` (nº de serie único). Modelo UNIFICADO: lote y
  serie son una "unidad de traza" (`stock_lots`) con `code` único por producto; la serie es un lote de
  capacidad 1. El saldo por lote se **deriva del libro** (`stock_movements.lot_id`), sin segunda fuente de
  verdad. **Red de seguridad:** `tracking='none'` (el defecto) no se toca — todo igual que hoy. ENTRA por
  recepción de compra (captura lote+caducidad o nº de serie); SALE por mostrador y albarán con **FEFO**
  (antes caduca, primero sale; un trazado no se sobrevende); anular reingresa a SU lote. **Guardas:** un
  trazado no se mueve por ajuste/traslado/devolución a proveedor/compra directa (con lote, más adelante).
  UI: flag en la ficha, captura por línea en la recepción, informe de lotes/series (saldo + caducidad).
  Núcleo `trazabilidad.js`. Invariante afirmada: **∑ saldos de lotes == stock**. Gates: `verify-trazabilidad`
  30/0 + `verify-trazabilidad-flujos` 20/0 (servicios reales) + `gate-trazabilidad` 6/0 (navegador).
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

## LA ESCALERA — el orden vigente (CANON §4)

> **Sustituye al "Roadmap futuro — módulos" y a la lista de la auditoría vs Holded.** No se ha perdido
> nada: **cada módulo de las dos listas está colocado abajo, en el peldaño que le toca por dependencia
> técnica**. El orden vive en `CANON.md` §4; aquí vive el detalle y la colocación.
>
> **Ya no hay "roadmap", ni "espera", ni capa aparte.** Lo que no está hecho está en un peldaño. Un
> módulo sin número no existe — y si aparece uno nuevo, se le busca peldaño, no una lista.
>
> **Sigue mandando la regla de siempre: no se inicia un paso sin encargo del dueño** (CANON §6). La
> escalera dice en qué ORDEN se apoyan las cosas, no que se construyan solas.
>
> *(Lo pendiente de **El Suelo** —Verifactu colaborador social, Balance, modelos AEAT, permisos Paso
> 1/2, conciliación…— NO está en la escalera: sigue en el Backlog de abajo. El Suelo es el umbral de
> admisión al mercado, no un peldaño de la ventaja.)*

### ⬜ 1 — Sincerar
Que los textos digan la verdad sobre lo construido. **HECHO en este encargo (17 jul 2026)**: la promesa
falsa de margen en la ayuda pública, el "Analítica lee el clúster viejo" de `DISEÑO.md` y el "Chart.js
desde CDN" de `MAPA_FUNCIONAL.md`. Origen: `docs/backlog-auditoria.md` (§8, 14 textos obsoletos) — el
resto de esa lista sigue ahí y se salda cuando toque.

### ✅ 2 — Margen  ·  HECHO (2026-07-17)
El dueño ve **cuánto gana**, no solo cuánto factura. Sin pedirle ni un dato nuevo: usa el WAC que
Bamburu ya calcula solo desde las compras.
- **PASO 0 (solo lectura) — el hallazgo que cambió la forma de la tarea:** la línea de venta no
  guardaba el coste… **ni siquiera de qué producto era**. `createInvoice` *recibía* el `product_id`
  (`schemas.js:196`) y lo **tiraba** al insertar, así que la analítica agrupaba por descripción
  (`ventas-metrics.js` lo confesaba en un comentario). No se puede congelar el WAC sin saber de quién
  es → el snapshot son **dos columnas**, no una.
- **Migración aditiva** (`models.js`, tras los addCol de A2): `invoice_items.product_id` ·
  `unit_cost` (WAC congelado) · `cost_source` (`'snapshot'` vs `'backfill'`) + índice. **Backfill una
  sola vez por bandera** (`migration_invoice_items_coste_backfill_2026_v1`), casando por descripción
  —el único puente que existía— con el WAC de HOY, **marcado `backfill`** porque no es el del día de
  la venta. Reversible: las columnas son aditivas y nada se reescribe.
- **Los 4 caminos vivos congelan** (`invoices.js`, helper único `snapshotCoste`): `createInvoice`
  (embudo de recurrentes/presupuestos/albaranes/pedidos), `createRectificativa`, `emitTicketSvc`
  (mostrador) y `emitSustitutivaSvc`. El muerto (`generateInvoice`, 410 por D1) se deja.
  **La F3 HEREDA el coste congelado del ticket** en vez de re-fotografiar: la venta ocurrió al emitir
  el ticket, y es el mismo hecho económico con otro papel.
  **No toca la huella:** `calcHash` come número, fecha, NIF, total y huella previa — nunca las líneas.
- **`NULL` no es cero, y esa es toda la tarea.** Servicio, digital, línea libre o físico nunca
  comprado → `unit_cost = NULL` = *"no lo sé"*. Se apartan como **"sin coste registrado"**: no entran
  en el beneficio y el informe **dice qué parte de las ventas queda fuera**. El margen % se calcula
  **solo sobre lo que tiene coste**, nunca sobre el total. Sin esto, este tenant declararía 985.106 €
  de beneficio al 93,5 % — una cifra preciosa y falsa.
- **Motor en `ventas-metrics.js`** (`margenResumen` · `margenPorProducto`), sobre el MISMO
  `countingSalesInvoices` que el resto: el ingreso del informe y el de la home no pueden discrepar.
  IVA fuera (se opera sobre `total_price`, la base). Los abonos **netean solos** (cantidad negativa →
  ingreso y coste restan a la vez).
- **Pantalla + export**: informe de Rentabilidad en `/admin/analytics` (beneficio, margen %, ingresos
  con coste, coste, aviso de lo que queda fuera, y desglose por producto con "—" donde no se sabe).
  **CSV**, con su fila TOTAL — *el encargo decía "XLSX/CSV/PDF", pero la Analítica **solo exporta
  CSV** (XLSX/PDF es de Contabilidad); añadirlos habría sido inventar el formato nuevo que el propio
  encargo prohibía.* Candado **`analytics.read`, el que ya existía**: sin permiso, 403 en vista,
  API y export — el export no es la puerta de atrás del permiso (CANON §3-bis, las dos puertas).
- **Verificado:** `verify-margen` **38/0** (BD desechable: IVA fuera, coste congelado, WAC que se
  mueve después y NO reescribe el pasado, los tres casos sin coste apartados, cuadre total vs. suma
  por producto, abono que netea, mostrador, idempotencia ×2, huella intacta) + `gate-margen-pantalla`
  **16/0** (navegador real, empleado sin permiso creado y borrado, idempotente en dos pasadas).
  Grupo nuevo del runner: `node scripts/run-gates.mjs margen`. Barrido `--all` **45/50**: los 5 rojos
  son ajenos — 3 pre-existentes por datos vivos y 2 por **precondición de datos** (0 propuestas
  pendientes en el tenant); `gate-nav-inicio-disa` **demostrado con `git stash`**: falla idéntico
  (32 OK, 2 fallos) con el código anterior, y `gate-propuestas-dormidos` pasa **39/0** al correrlo solo.
- **Cabos anotados, no descubiertos tarde:** (a) un **abono** congela el WAC de hoy, así que si el
  coste se movió entre la venta y la devolución, el neteo lo arrastra; (b) el backfill casa por
  nombre y **hay 25 productos homónimos** ("Difusor de bambú artesanal premium") → elige uno
  arbitrario; por eso va marcado `backfill`; (c) un negocio **solo de servicios** no tendrá margen:
  todo su ingreso caerá en "sin coste registrado" — correcto, pero hay que decidir qué se le enseña.
- **Realidad medida en el tenant de pruebas:** 113 líneas · base 985.106,95 € · **con coste solo
  63.460,90 € (6,4 %)**. *(El PASO 0 dijo 159 líneas: mi `LEFT JOIN` por nombre multiplicaba las de
  los 25 homónimos. El ratio aguantaba; el conteo no.)*
- ✅ **Reenganchada al menú (17 jul 2026).** La Analítica llevaba **viva y sin enlace desde U7
  (8-jul)**: respondía 200 y no había forma de llegar salvo tecleando la URL — por eso el informe no
  se encontraba. Área nueva **"Analítica" → "Informes"** (`/admin/analytics`), la **casa de los pasos
  3 y 4**. Usa `navPerms.analytics`, que **ya estaba declarado sin item que lo usara** (hallazgo de U7,
  ahora saldado). **Es un área y no un enlace directo por una razón de seguridad:** la rama `g.home`
  del riel **no pasa por `navFilter`**, así que la entrada se vería sin permiso y solo fallaría al
  pulsar; queda avisado en el código para quien la use algún día. **No se reenganchó nada más**:
  `/admin/discounts` y `/admin/tags` siguen fuera por decisión del dueño (U7), y `/admin/orders` y
  `/admin/shipping` siguen desmontados (404, D1/D2) — el gate lo afirma. **Verificado antes de
  enganchar:** la Analítica no lee **ni una tabla** del clúster viejo.
  Solo navegación: sin tocar el cálculo. Gate ampliado a **26/0**.
- **Dos hallazgos del reenganche, anotados y NO tocados (preexistentes, ajenos a este paso):**
  1. **Un empleado con CERO permisos ve el menú entero.** El filtro es
     `hasCustomPerms = !isAdmin && !isOwner && perms.length > 0`: sin permisos propios no se filtra
     nada. La puerta sigue cerrada (403 al pulsar), pero el menú enseña puertas que no se abren. Vale
     para TODAS las entradas, no solo esta.
  2. **`DISEÑO.md` §3.3 decía "no se fuerza una sexta área"** — y esta es la sexta. Decisión expresa
     del dueño (17-jul) y coherente con CANON §3-bis (las dos puertas): la puerta visual necesita
     puerta. El §3.3 se queda como regla para lo que venga; esta excepción está por escrito.

### ✅ 3 — Informes por área + plan financiero · **COMPLETO (17 jul 2026)**
Catálogo de las 5 áreas · Responsable de cliente · Bloque 1 (informes) · Bloque 2 (plan financiero).

#### ✅ Catálogo de piezas de las 5 áreas — **91 piezas inventariadas**
Con qué podrá montar informes el constructor del paso 4. Cada pieza, con su fuente y su permiso.
**Ninguna pieza sin dato se descartó**: se marcó "a habilitar" con lo que haría falta.
- **VENTAS 20/21** (`invoices.read` · fuente `ventas-metrics.js`) — todo existe salvo **vendedor**.
  *Producto y categoría solo son posibles gracias al paso 2* (`invoice_items.product_id`).
- **COMPRAS 14/17** (`purchases.read`) — falta **usuario que compró**; producto/categoría **parcial**:
  `supplier_invoice_items` solo tiene `concepto` libre — pero **un gasto puro no tiene producto por
  naturaleza** (un alquiler no es un artículo). No es carencia: es el dominio.
- **INVENTARIO 17/17** (`inventory.read`) — completo, lote/serie y bajo mínimo incluidos.
- **CONTABILIDAD 16/17** — completo salvo **IRPF soportado en compras**: `supplier_invoices` no guarda
  retención **por decisión explícita del código**, y es lo que bloquea el modelo 111 (ya en el Backlog).
- **CLIENTES 18/19** (`clients.read`) — completo; `clientesDormidos`/`umbralDormido` ya dan frecuencia
  y última compra.
- **○ Zona/provincia (ventas y clientes): el caso a no confundir.** La columna **existe** (la trajo
  Facturae) y está **vacía en 15 de 15**. No es pieza a habilitar: es captura de datos. Marcarla como
  "existe" engañaría al constructor del paso 4; hoy daría un único grupo "(sin provincia)".

#### 📋 Piezas a habilitar — su propio peldaño, ninguna era "barata y directa"
1. **Usuario en los documentos (ventas + compras).** Es UNA pieza, no dos: ningún documento guardaba
   quién lo hizo. **Resuelta a medias por el responsable, abajo** — el mostrador ya guarda quién cobra.
   Lo que queda (¿quién *tecleó* una factura con cliente?) exige pasar la sesión por 5 puntos de
   emisión, y uno es un **cron** (recurrentes: no tiene vendedor, tiene "automático"). Decisión de
   producto, no columna.
2. **Producto/categoría en facturas de gasto** — ver arriba: es el dominio, no una carencia.
3. **IRPF soportado en compras** — ya tiene sitio en el Backlog (modelo 111).

#### ✅ CRM — RESPONSABLE DE CLIENTE + atribución de la venta (17 jul 2026)
Función nueva de CRM que la analítica del paso 4 aprovechará. **Asignación solo a mano** (ni reparto
automático ni DISA — anotado como peldaño futuro por si algún día se quiere).
- **LA CASCADA DE TRES** (decisión del dueño), fuente única en `ventas-metrics.js`:
  **(1)** hay cliente → responsable del cliente, **derivado EN VIVO** · **(2)** si no, `emitted_by` →
  quien cobró, **congelado** (solo mostrador) · **(3)** si no → **sin asignar**.
- **La asimetría es el diseño, no un descuido.** El coste (paso 2) se congela porque es un HECHO del
  día de la venta; el responsable se deriva porque es una RELACIÓN VIVA: reasignar un cliente
  **reatribuye su histórico**, que es lo que un CRM debe hacer. Verificado que derivar es seguro: los
  clientes se **archivan**, nunca se borran, y hay **0 facturas con un `client_id` inexistente**.
- **La rama 3 salió del PASO 0, y el encargo no la preveía:** hay **4 facturas de serie F sin cliente
  y sin tipo** (junio) que no son mostrador **ni** tienen cliente — no las cubría ninguna de las dos
  reglas. Caen en "sin asignar" y el modelo queda cerrado ante cualquier caso futuro.
- **Migración aditiva**: `clients.responsable_user_id` + `invoices.emitted_by` + índices. Los clientes
  **nacen sin asignar** a propósito; la analítica se llena a medida que el dueño reparte.
- **Backfill del histórico del mostrador**: el dato ya existía en `activity_logs` ("Emitió ticket de
  mostrador" con `user_id`). **41 de 42 tickets** recuperados (1 sin log) — no nace vacío. Los 4 raros,
  correctamente sin emisor. No toca la huella: `emitted_by` no entra en `calcHash`.
- **Dimensión + filtro** en Analítica (Ventas y Clientes), con **"Sin asignar" como fila más**:
  esconderla descuadraría el total contra Ventas y nadie sabría por qué.
- **Dos puertas, dos candados:** ventas por responsable exige `analytics.read` **Y** `invoices.read`;
  clientes por responsable, `analytics.read` **Y** `clients.read`. Una pieza que cruza áreas exige
  **todos** los permisos que toca (CANON §3-bis), y si falta uno **se dice cuál** en vez de pintar un
  hueco mudo que se lea como "no hay datos".
- **Un responsable desactivado** cae en "sin asignar" sin perder el dato (el id sigue en la ficha) y su
  cartera vuelve sola al reactivarlo.
- Verificado: `verify-responsable` **27/0** (BD desechable, usuarios propios: asignar atribuye ·
  reasignar reatribuye el histórico · mostrador congelado que NO se mueve al cambiar el cliente · rama
  3 · cuadre Σ por responsable == total · desactivar/reactivar · idempotencia · huella y margen
  intactos) + `gate-margen-pantalla` ampliado a **33/0** (navegador: tarjeta, filtro, ficha con su
  desplegable, y el 403 cruzando áreas). Grupo `margen` del runner: **3/3**.

#### ⬜ Anotado como peldaño FUTURO (decisión del dueño: hoy NO)
- **Reparto automático de clientes / que DISA asigne el responsable.** La asignación es **solo a mano**
  a propósito. Si algún día se quiere, encaja aquí: el dato y la cascada ya existen, y DISA tendría que
  pasar por el servicio validado (`updateClientSvc`), nunca escribir la columna directa — patrón T5.
- **Usuario que TECLEA una factura con cliente** (el "vendedor" del catálogo, pieza ⚠ 1). Distinto del
  responsable: uno es *quién la hizo*, el otro *de quién es el cliente*. Exige decidir qué es una
  factura recurrente emitida por un cron ("automático") antes de tocar código.

#### ✅ BLOQUE 1 — Informes por área (17 jul 2026)
**Once informes** en `/admin/analytics` (los 10 nuevos + el de responsable, ya construido), en tres
pestañas, con **CSV único** y cada área tras `analytics.read` **+ el permiso de su área**.
- **Ventas**: por periodo (mes/trimestre/año, con su evolución) · por cliente · por responsable ·
  cobrado vs. pendiente. **Compras**: por proveedor · gasto por categoría (`expense_category`, ya
  poblada) · pendiente de pago por vencimiento. **Clientes**: ranking · dormidos (con su ritmo
  aprendido) · deuda vencida · nuevos por mes.
- **INVENTARIO y CONTABILIDAD, fuera a propósito**: ya se ven en Stock y en Libros y modelos.
  Duplicarlos crearía dos sitios que dicen lo mismo, y el día que discrepasen nadie sabría cuál creer.
- **Fuente única, ni una regla nueva**: todo se apoya en `countingSalesInvoices` (ventas),
  `countsAsPayable`/`openPayables` (compras) y `openDebts` (deuda). `ventasPorMes()` **no se tocó** —lo
  consume DISA y suma con IVA—: se le dio un hermano, `ventasPorPeriodo()`, que agrega por
  mes/trimestre/año, filtra por responsable y devuelve la **base sin IVA**.
- **Hallazgo del camino:** los tramos de vencimiento son los DEL MOTOR (`0-30`/`30-60`/`+60`, leídos de
  `pagos.js:69`), no unos inventados. Y **los abonos van en su propio tramo**: `openPayables` los
  incluye con importe NEGATIVO para que Σ cuadre, y `pagoState` les deja `tramo=null` porque **un abono
  no vence** — sin esa rama caían en "aún no vencida", una etiqueta falsa (no es un pago que no toca:
  es dinero que te deben) que además restaba y descuadraba el tramo.
- Verificado: `verify-informes` **27/0** — el gate no comprueba que "responda", comprueba que **CUADRE**:
  Σ por periodo == Σ por cliente == Σ por responsable == `ventasResumen.base`; mes/trimestre/año suman
  igual y agrupan distinto; el IVA fuera; la anulada no cuenta; Σ tramos == `openPayables.total`;
  y lo que no tiene dueño ni categoría **no se esconde** (o el total dejaría de cuadrar).

#### ✅ BLOQUE 2 — Plan financiero: objetivos vs. real (17 jul 2026)
El dueño fija metas de **facturación** y **beneficio**, por **mes/trimestre/año**, **globales o por
responsable**; la pantalla compara contra lo real y da la desviación en importe y en %.
- **LA DECISIÓN QUE LO SOSTIENE — beneficio = MARGEN, no el P&G.** El PASO 0 destapó que el encargo
  pedía las dos cosas y **son números distintos**: `cuentaPyG` resta TODOS los gastos (alquiler,
  software, sueldos); el margen solo el coste de lo vendido. Se eligió el margen (decisión del dueño)
  porque **(a)** cuadra en los tres alcances —global = Σ responsables + sin asignar— y el P&G **no
  puede**: el libro contable no sabe de responsables (un asiento de alquiler no es de nadie); y **(b)**
  es lo que un comercial puede mover. **El P&G se queda en Contabilidad como única verdad del resultado
  del negocio.** Con el mismo aviso de Rentabilidad: el margen solo juzga lo que tiene coste.
- **Migración aditiva**: `financial_targets` (tipo · periodo · clave · alcance · user_id · valor) con
  índice único por `(tipo, periodo, clave, alcance, COALESCE(user_id,0))` — el `COALESCE` porque en
  SQLite dos NULL son distintos y sin él "global" admitiría filas repetidas. Fijar dos veces
  **sustituye**; valor 0 **quita** la meta (sin botón aparte ni un estado "meta a cero" ilegible).
- **La clave habla la MISMA gramática que `clavePeriodo()`** (`2026-07` · `2026-T3` · `2026`) y su forma
  se valida al fijar. Si no, una meta con clave rara compararía contra nada y el plan diría "0 € real"
  tan tranquilo — el modo de fallo más silencioso de esta función.
- **Los niveles NO se fuerzan a cuadrar** (decisión del dueño): cada uno se fija a mano y la pantalla
  enseña lo real al lado, **con un texto que dice que un descuadre no es un error — son metas, no
  contabilidad**. Un periodo sin meta **no sale**: un plan lleno de ceros que nadie puso sería ruido.
- **Permisos:** ver el plan → `analytics.read` + `invoices.read`. **Fijar → solo owner/admin**, sin
  crear permiso nuevo (el candado más estricto que ya existe). El botón no es el candado: el servidor
  lo vuelve a comprobar (403 afirmado en el gate).
- Verificado: `verify-plan-financiero` **35/0** (los tres periodos, los dos alcances, el rango derivado
  de la clave —febrero bisiesto incluido—, **el global == Ana + el resto**, el aviso de sin-coste,
  sustituir sin duplicar, quitar con 0, las 5 claves imposibles rechazadas, idempotencia) +
  `gate-margen-pantalla` ampliado a **44/0** (navegador: las tres pestañas pulsadas, el plan y su 403).
  Probado además **por HTTP contra el servidor real** (meta de 500.000 € → −208.430,50 €, −41,7 %),
  limpiando las metas de prueba al terminar.

### Anotado del peldaño 3 (no bloquea; cada uno cuando toque)
- Las **4 piezas a habilitar** del catálogo (usuario que teclea · producto en gasto puro · IRPF
  soportado · provincia sin rellenar). Ver `docs/analitica/catalogo-piezas.md`.
- **Reparto automático / que DISA asigne el responsable** — hoy NO, por decisión del dueño.
Módulo de **informes predefinidos por área** (ventas, compras, clientes…) + **plan financiero**
(objetivos mes a mes vs. real). Va más allá de los KPIs sueltos del panel actual.
*Origen: auditoría Bamburu vs Holded (9 jul 2026), repaso con el manual funcional completo de Holded
(más detallado que la del 4 jul). Era "Analítica" en esa lista.*

### 🟡 4a — Constructor de analíticas · **VENTAS HECHO (17 jul 2026)** · faltan las otras 4 áreas

**La puerta visual ya existe**: el dueño cruza lo que quiere y elige cómo verlo, sobre sus datos.
Vive en `/admin/analytics` (el área "Analítica" que se creó al reengancharla — la duda del "dónde"
quedó zanjada ahí). Motor: `modules/erp/constructor-analitica.js`.

**LA DECISIÓN QUE DEFINE LA PIEZA — el constructor NO arma SQL.** Salió del mini-plan y es lo único
que impide que esta función rompa el proyecto: armar SQL con una allowlist (el patrón de
`query_database`, D1) protege los **permisos** pero **no las reglas de negocio**. Un gráfico que
consultara `invoices` por su cuenta contaría **anuladas**, contaría **tickets sustituidos** y las
**rectificativas no netearían** — y el dueño tendría un gráfico, hecho por él, que dice un total de
ventas distinto del de la pantalla de Ventas. No sospecharía nunca. Aquí la regla de conteo se aplica
**UNA vez en el origen** (`countingSalesInvoices`) y todo lo demás es agrupar sobre ese conjunto ya
verificado. **Afirmado contra el servidor real: las 5 dimensiones dan 973.267,93 €, lo mismo que el
informe de Ventas.** El coste es cargar líneas en memoria — que es lo que `countingSalesInvoices` ya
hacía; si un negocio llegara a cientos de miles, se acota por fecha.

- **9 dimensiones · 6 medidas · 4 gráficos** (barras · líneas · tarta · tabla), del catálogo del paso 3
  — ni una pieza inventada. Un campo sin `valor` en el mapa **no existe**: falla cerrado.
- **Permisos por campo**: cliente/tipo/provincia/forma de pago → `clients.read`; producto/categoría →
  `products.read`; todo el constructor → `analytics.read` + `invoices.read`. El desplegable filtrado
  **NO es el candado**: `cruzar()` lo revalida (probado pidiéndolo a mano → 403). **Filtrar** por un
  campo que no ves también se deniega: acotar y mirar el total sería deducir el dato.
- **El margen no se regala** ni cruzando por lo que sea: sin coste conocido → `—`, nunca 0 ni 100 %, y
  el aviso viaja con el cruce (solo si pides margen; si miras facturación sería ruido).
- **Paneles: de quien los crea** (decisión del dueño; compartir es 4b). Guardan la **RECETA, no los
  datos** — al abrirlos se vuelve a cruzar y **se revalidan los permisos de HOY**. Si guardaran
  resultados, un panel sería una fuga con fecha: perder un permiso y seguir viendo lo de antes. El
  `user_id` sale de la sesión, nunca del cuerpo; y va en el `WHERE` (nadie edita ni borra el de otro).
- Verificado: `verify-constructor` **34/0** (las 9 dimensiones dan el mismo total; una factura anulada
  de 5.000 € **no aparece**; permisos por campo y por filtro; paneles ajenos; idempotencia) +
  `gate-margen-pantalla` **56/0** (navegador: se cambia el cruce de verdad, el "—" en tabla, y las 5
  dimensiones == el informe de Ventas contra el servidor real).

#### ✅ 4a-bis — LAS OTRAS ÁREAS · **Compras · Clientes · Inventario (17 jul) + Contabilidad (18 jul) — COMPLETO**
El constructor ya cubre **cuatro áreas**, cada una con su GRANO propio y su regla de conteo ya
verificada — **no es "repetir ventas ×4"**: el motor se generalizó a un registro de áreas (`AREAS` en
`constructor-analitica.js`) manteniendo Ventas **idéntico** (su gate siguió en 34/0 tras el refactor).
- ✅ **COMPRAS** — grano: factura recibida. Regla: `countsAsPayable` (anuladas fuera; abonos netean);
  el pendiente, de `supplierInvoicePago` (el mismo que Pagos). Dimensiones: fecha · proveedor ·
  categoría de gasto · tipo (gasto puro / mercancía, por `entity_type`). Medidas: comprado sin IVA ·
  nº facturas · pendiente de pago. **Cuadra:** Σ por proveedor == Σ por categoría == 2.042,55 € (dato
  vivo), la anulada no cuenta.
- ✅ **CLIENTES** — grano: cliente activo (no línea). Facturación de `ventasPorCliente` (regla intacta),
  deuda de `clientDebt`. Dimensiones: tipo · provincia · forma de pago · perfil de cobro · responsable.
  Medidas: nº clientes · facturación · deuda · nº compras · **ticket medio del grupo** (facturado/compras,
  NO media de medias). **El mostrador sin cliente no se atribuye a nadie** — 800 €, no 850: correcto.
- ✅ **INVENTARIO** — grano: movimiento de stock. **Mide FLUJO, no niveles**, y es una verdad técnica
  del PASO 0: el stock actual y el WAC dependen del ORDEN del libro (media móvil) y **no se reconstruyen
  sumando** un periodo — el nivel ya vive en Stock. Medidas: nº movimientos · entradas · salidas · neto ·
  valor movido a coste. **Cuadra:** Σ neto == Σ(quantity) del libro (743 uds, 168 movimientos);
  entradas − salidas == neto.
- ✅ **CONTABILIDAD — 5ª área, HECHA (18 jul 2026, encargo del dueño).** El riesgo era que diera **otro
  beneficio que el P&G**; se evita por diseño: se **cuelga de `cuentaPyG`** (el motor del P&G, la misma
  fuente que Libros y modelos), **NO de `ledger_lines`** — la regla contable (solo grupos 6/7, importe =
  `haber−debe`, clasificación PGC) se aplica una sola vez, en el motor, y el constructor **solo agrupa**
  sus importes.
  - **Grano:** (mes, partida). `filas()` llama a `cuentaPyG` **por mes** (periodo atómico, recortado a
    `[from,to]`) y emite una fila por partida con importe ≠ 0. La contabilidad es **aditiva** sobre
    rangos disjuntos → agrupar por fecha (mes/trim/año) o por partida da el mismo total que el P&G.
  - **Dimensiones:** Periodo · Partida (las 17 líneas del PGC) · Sección (Explotación/Financiero/
    Impuestos). **Medidas:** Resultado (beneficio) · Ingresos · Gastos — es partir el MISMO importe
    neto por su signo, no medidas inventadas. **Solo se listan las partidas con dato** (3 de 17 hoy).
  - **CUADRE AL CÉNTIMO, dato vivo:** cruzar por periodo, por partida y por sección da **1.273.511,38 €**
    — exactamente `resultadoEjercicio` del P&G. `ingresos − gastos == resultado`. Un rango acotado (T2)
    también cuadra con el P&G de ese rango (679.063,86 €).
  - **Candado:** `invoices.read` (el mismo que la pantalla de Libros); sin él, 403 a mano. Un panel de
    Contabilidad guarda la RECETA: al abrirlo sin permiso → 403; con permiso se **recalcula** al P&G de
    hoy (probado con datos vivos). Y es **comparable en el tiempo** en 4b (tiene fecha).
  - Verificado: `verify-constructor` **82/0** (los 10 casos de Contabilidad: cuadre por las 3
    dimensiones, ingresos−gastos, solo-con-dato, candado, rango acotado, comparable) + `gate-margen-
    pantalla` **79/0** (navegador: la 5ª área cuadra con el P&G contra el servidor real).
- **Candado por área:** cada una tras su permiso base (invoices/purchases/clients/inventory `.read`);
  `areasPara` solo ofrece las que el usuario puede, y `cruzar()` lo revalida (403 a mano, probado). Un
  campo de otra área no vale (`serie` en compras → 400); un área inventada, 400.
- **Cruzar ENTRE áreas es 4b** ("combinar fuentes"): granos distintos no se suman sin decidir antes cómo.
- Verificado: `verify-constructor` **51/0** (Ventas intacto + las tres áreas cuadran cada una con su
  fuente + candado por área + el periodo que no aplica en clientes) · `gate-margen-pantalla` **66/0**
  (navegador: selector de área que redibuja, las 4 áreas cruzando contra el servidor real, área
  inventada cortada).

> **Ficha original del 4a (referencia):**
Motor tipo Power BI: **catálogo de campos en cristiano** (ventas, márgenes, clientes, compras, stock,
caja…), el usuario **elige cómo cruzarlos**, **elige el tipo de gráfico a su estilo** (no gráficos
cerrados) y **guarda los suyos**. **Pantalla de panel propia = la puerta del usuario visual**
(CANON §3-bis, "Las dos puertas").
> **PIEZA MAYOR: se planifica en su propio mini-plan al llegar su turno.** No se detalla aquí.
> Dos cosas que ese mini-plan tendrá que resolver, anotadas para que no se descubran tarde:
> **(1)** dónde vive la pantalla — `DISEÑO.md` §3.3 dice *"no se fuerza una sexta área"*, así que habrá
> que decidir si el panel es área, o vive como Inicio/DISA en el riel (que no son áreas). **(2)** los
> permisos: un constructor de gráficos es un lector de datos, y CANON §3-bis exige que no saque por un
> gráfico lo que la pantalla te niega — mismo problema que resolvió D1 con `query_database` de DISA
> (allowlist, falla cerrado); hay solución de la que copiar.

### ✅ 4b — Constructor avanzado · HECHO (17 jul 2026)
Cálculos propios · combinar fuentes · compartir paneles. *(Más tipos de gráfico: los 4 de 4a bastan;
ampliar es aditivo cuando se pida.)*
- ✅ **CÁLCULOS PROPIOS con evaluador SEGURO (sin `eval`).** El usuario escribe una fórmula sobre las
  medidas de su área (`beneficio / base * 100`). **No se usa `eval` ni `new Function`** —el proyecto no
  los usa en ningún sitio y no los introduzco: una fórmula es texto del usuario, y `eval` sobre eso es
  ejecución de código arbitrario en el servidor—. Se tokeniza, se valida contra las medidas del área
  (variable desconocida → 400), se comprueba que el RPN esté completo (`base /` → 400) y se evalúa con
  un mini-intérprete de aritmética. **Un valor sin dato propaga NULL** (margen sin coste no da 100 %);
  **división por cero → null, no Infinity.** Se compila al GUARDAR también: no se guarda una receta rota.
- ✅ **COMBINAR FUENTES = comparar áreas EN EL TIEMPO.** La única dimensión común a
  ventas/compras/inventario es la **fecha**, así que "combinar" **no es sumar granos distintos** (una
  línea de venta y una factura de compra no se suman): es poner cada área como **su propia serie** sobre
  el eje temporal — "facturación vs. gasto por mes". Cada serie sale del `cruzar` de SU área (regla
  intacta) y **revalida su permiso**; clientes no entra (no tiene fecha). Donde un área no tiene dato
  ese periodo, va **NULL** (un hueco, no un 0). Afirmado: comparar ventas+compras deja ventas en 850,
  no la contamina.
- ✅ **COMPARTIR PANELES.** `analytics_panels.compartido` (aditivo). Un panel compartido lo ve el
  equipo, pero **guarda la RECETA, no los datos**: al abrirlo se re-cruza y **se revalidan los permisos
  de hoy** — un panel de Compras compartido **no se abre** para quien no tenga `purchases.read` (falla
  cerrado, ya lo hacía la arquitectura de 4a). Solo el dueño comparte/descomparte/borra (WHERE
  user_id); compartir no es ceder el control. La lista separa "los míos" de "compartidos contigo (autor)".
- Verificado: `verify-constructor` **72/0** (evaluador: inyección/variable falsa/incompleta/÷0 todas
  cortadas; comparar sin sumar granos + revalida permiso; compartir la receta no los datos) +
  `gate-margen-pantalla` **76/0** (navegador: cálculo propio con su ayuda, comparar 2 series, candado
  de 4b). Grupo margen 6/6.
- **Bug propio cazado, la lección de C4b otra vez:** un `\n` dentro de un `confirm(...)` en el JS de la
  pantalla se convirtió en salto de línea REAL al emitirse desde el template literal, rompiendo todo el
  script de cliente (invisible a `node --check`, que valida el template como string). Quitado el `\n`.

> **La escalera de analítica (pasos 2-4b) queda cerrada** salvo el paso 6 (dashboards personalizables:
> componer el Inicio con paneles guardados — ahora es posible porque los paneles existen) y la decisión
> pendiente de **Contabilidad en el constructor**.

### ✅ 5 — DISA predictiva · VALIDADO por Ibrahim en pantalla (21 jul 2026)
Previsión de caja **3/6/12 meses** · detección de anomalías · agente que avisa. Es "DISA como producto
proactivo/predictivo" — lo que el mapa de capas prometía y nunca tuvo número.
**Usa el motor de 4a para MOSTRAR: DISA analiza, no dibuja.**
*No reabre el Eje B (✅ COMPLETO, D0–D5f, seis propuestas de proactividad): aquello era DISA que
**prepara y propone**; esto es DISA que **predice**.*

- **PIEZA 1 — EL VIGÍA (motor de detección) · ✅ VALIDADA por Ibrahim (21 jul 2026).**
  Motor `modules/erp/vigia.js` + ruta/pantalla `modules/erp/routes/vigia.js` (`/admin/vigia`, gate
  `analytics.read`) + entrada de menú en Analítica. **NO hace sus propias cuentas:** cada hallazgo toma
  la cifra TAL CUAL del motor de su área —el mismo que pinta la pantalla— así que es imposible que
  contradiga a Cobros/Pagos/Ventas/Plan. Seis detectores: deuda de cliente vencida (`openDebts`,
  `cobros.read`) · cliente que se duerme (`clientesDormidos`, `clients.read`) · caída de facturación y
  de margen mes vs. mes anterior (`cruzar`, área Ventas, `invoices.read`) · desvío del plan
  (`planFinanciero`, `invoices.read`) · pago a proveedor que vence pronto (`openPayables`,
  `purchases.read`). **Solo lectura**, sin persistencia (se calcula en vivo) y **sin tocar
  WRITABLE_TABLES**. Permisos por detector: un empleado sin el permiso de un área no recibe sus
  hallazgos (van a `sinPermiso`) y forzarlos da 403. Umbrales fijos documentados en el código (vencida
  ≥1 d · caída ≥20% · desvío ≥10% · pago ≤7 d); su pantalla de configuración es pieza posterior.
  Verificado: `test-vigia` (33/0, lógica: cuadre + no-inventa + detecta + permisos), `verify-vigia`
  (cuadre sobre datos reales: deuda €232,75 = Cobros, pago €55 = Pagos), `gate-vigia-pantalla` (13/0,
  navegador: pinta 58 hallazgos reales, menú, candado por pantalla, 0 errores JS/CSP). Pieza posterior:
  previsión de caja, persistencia visto/descartado (en tabla `disa_*` fuera de WRITABLE_TABLES) y el
  agente que avisa.

- **PIEZA 2 — LA VOZ (narración + decisión propuesta) · ✅ VALIDADA por Ibrahim (21 jul 2026).**
  Módulo `modules/erp/voz.js` (función PURA `hallazgo → aviso`) + ruta/vista en `modules/erp/routes/vigia.js`
  (API `/api/erp/vigia/avisos` + tarjetas en `/admin/vigia`, encima del detalle crudo). Viste cada
  hallazgo del vigía con **(a) qué pasa + desde cuándo** y **(b) decisión propuesta** (jamás un hueco
  vacío). **CERO CIFRAS INVENTADAS:** el texto se compone por PLANTILLAS por tipo de detector, rellenadas
  SOLO con los campos limpios del hallazgo (`cifra`, `fecha`, códigos de `ref`); ningún número sale de
  IA ni se recalcula. El nombre del cliente/proveedor y el detalle exacto (de X a Y, objetivo/real) se
  muestran VERBATIM desde el `titulo`/`motivo` del propio vigía (su texto, sus números → imposible
  contradecirle); la decisión referencia la factura por su código, no por un nombre reparseado (que en
  datos reales puede llevar payload XSS: se escapa siempre al pintar). **NO EJECUTA:** solo texto, sin
  botón/formulario/enlace de acción; no manda nada ni toca datos de negocio. **Sin persistencia, sin
  consultas propias a BD, sin reabrir permisos:** hereda el filtrado del vigía (sin permiso de un área
  no hay hallazgo → no hay aviso; forzarlo da 403). **No toca** el motor del vigía, los motores de área,
  el constructor, Verifactu, KPIs ni WRITABLE_TABLES.
  Verificado: `test-voz` (87/0, lógica: cero cifras inventadas + cuadre aviso↔hallazgo + siempre decide
  + no ejecuta + permisos + trazable), `verify-voz` (datos reales *desarrollo*: 58/58 avisos cuadran con
  su motor y 0 dígitos inventados), `gate-voz-pantalla` (16/0, navegador: 58 tarjetas con su decisión,
  importe idéntico a la API, 0 controles de acción, candado heredado + 403, 0 errores JS/CSP).
  Regresión: `gate-vigia-pantalla` 13/0 y grupos `infra` (XSS/CSP/safe-error) + `margen` (motores) 14/14
  en verde; los 2 rojos preexistentes (`gate-avisos-pantalla`, `verify-avisos-crm-riesgo`) son ajenos
  (campana/CRM), documentados en `run-gates`. **NOTA DE PRODUCTO para validación:** las plantillas de
  decisión del encargo nombran al `[cliente]`/`[proveedor]` y el valor `[X]` del mes anterior; el vigía
  NO los expone como campos limpios (solo dentro de `titulo`/`motivo`), así que la decisión nombra la
  factura por su código y el nombre aparece en la cabecera del aviso (verbatim). Si se prefiere el nombre
  DENTRO de la frase de decisión, la vía limpia sería un campo `datos:{}` aditivo en el vigía (relajar
  "no tocar el vigía") — queda a decisión de Ibrahim. Pieza posterior: previsión de caja + la capa de
  EJECUCIÓN (recordatorios, correos) que sí acciona la decisión que la voz solo propone.

- **PIEZA 3 — EL DIBUJO (gráfico de apoyo por aviso) · ✅ VALIDADA por Ibrahim (21 jul 2026).**
  Módulo `modules/erp/dibujo.js` (compone una RECETA por tipo de aviso) + `public/js/grafico-constructor.js`
  (el render del constructor alojado UNA vez, para reutilizarlo sin duplicarlo) + enganche en
  `modules/erp/routes/vigia.js` (la API `/avisos` adjunta la receta; la vista pinta bajo cada aviso un
  gráfico perezoso). **REUTILIZA EL MOTOR DEL CONSTRUCTOR, no construye uno nuevo:** el gráfico se obtiene
  pasando la receta al MISMO endpoint `/api/erp/analytics/constructor/cruzar` y dibujándolo con la MISMA
  librería (Chart.js, mismo vendor local) — imposible que dé una cifra distinta del constructor hecho a
  mano. **NO se toca `analytics.js`** (el constructor): el render se aloja aparte y se reutiliza; `vigia.js`
  no hace ni un `new Chart(`. Recetas por tipo: caída de facturación/margen → `ventas·fecha·(base|beneficio)·mes`
  (EXACTAS: es la misma `cruzar` que dio la cifra del vigía); desvío del plan → serie real por periodo
  (hueco: el constructor no tiene medida "objetivo"); pago → `compras·proveedor·pendiente` (hueco: no hay
  dimensión "vencimiento"; misma fuente que Pagos); deuda/dormido → `ventas·fecha·base` filtrado por ese
  cliente (hueco: el constructor no tiene área de cobros/antigüedad; el nombre del filtro se resuelve
  `client_id→name`, solo lectura, un rótulo — no una cifra). **Permisos heredados:** `cruzar` revalida el
  permiso del área; quien ve un aviso pero no el área de su gráfico recibe una nota honesta ("no puedes ver
  este gráfico"), no un gráfico inventado. **Solo lectura**, sin persistencia, sin tocar motores/Verifactu/
  KPIs/WRITABLE_TABLES. Verificado: `test-dibujo` (32/0: receta==cruce a mano + punto==cifra + mismo motor),
  `verify-dibujo` (real *desarrollo*: 58/58 recetas cuadran; deuda María García López y pago Gabriela Gil
  55 € = Σ openPayables), `gate-dibujo-pantalla` (13/0: gráfico dibujado por Chart.js del constructor,
  pintado==API, un solo motor, candado heredado + nota de 403, 0 errores). Regresión: `gate-vigia-pantalla`
  13/0, `gate-voz-pantalla` 16/0, `gate-margen-pantalla` 79/0 + `verify-constructor` 82/0 (el constructor
  INTACTO), `infra` (XSS/CSP) 15/15 verde. **NOTA DE PRODUCTO para validación:** solo caída de facturación y
  de margen son EXACTAS; los otros 4 son el gráfico expresable más cercano con su hueco anotado en pantalla,
  porque el constructor no tiene hoy área de cobros/antigüedad, medida de objetivo ni dimensión de
  vencimiento. Si se quiere el gráfico "ideal" de esos tipos, es un paso posterior (ampliar el constructor).
  Alternativa señalada: extraer `dibujar()` de `analytics.js` al módulo compartido (fuente única real de
  render, tocando el constructor) — queda a decisión de Ibrahim.

- **PIEZA 5 — DÓNDE TE ESPERA (priorización + Inicio + barrido de permisos) · ✅ VALIDADA por Ibrahim
  (21 jul 2026). Con ella, el peldaño 5 (detección proactiva) queda CERRADO.**
  Módulo `modules/erp/prioridad.js` (ordena y etiqueta los avisos ya producidos por las piezas 1-3) +
  enganche en `routes/vigia.js` (la API `/avisos` ordena; la lista sale por grupos con píldora) + bloque
  nuevo en el Inicio (`views/disaHome.html.js`). **Solo ordena y coloca; no toca la detección, la voz ni
  el dibujo, ni crea cifras.** (A) PRIORIZACIÓN — grupos: ALTA = deuda·pago·desvío · MEDIA = caídas ·
  BAJA = dormido; dentro del grupo, por importe (€) de mayor a menor, y sin € (dormido) por urgencia
  (días); desempate estable. La lista de `/admin/vigia` sale ordenada, el de más impacto arriba, con
  cabecera de grupo y píldora Alta/Media/Baja por aviso. (B) INICIO — bloque compacto "Vigía de DISA ·
  lo más importante" con los top 5 (texto + prioridad) y enlace a `/admin/vigia`; carga por `fetch`
  `/avisos?top=5`, es lo MISMO que la lista (misma fuente, mismo orden) — no puede discrepar; **no se
  reestructura el resto del Inicio**, solo se añade el bloque. **Permisos heredados en los 4 puntos**
  (lista cruda, voz, gráfico, Inicio): quien no ve un área no ve su aviso por ningún lado, ni asoma en
  su Inicio, y da 403 al forzar (`?detector=` y `cruzar area=`). **`?top=N` no adjunta gráfico** (el
  Inicio no dibuja). Solo lectura, sin persistencia, sin tocar el constructor/motores/Verifactu/KPIs/
  WRITABLE_TABLES. Verificado: `test-prioridad` (13/0: grupos + orden + no inventa), `gate-espera-pantalla`
  (20/0: [1] orden Alta→Media→Baja con cabeceras y píldoras; [2] Inicio asoma top 5 y COINCIDE con la
  lista; [3] BARRIDO DE PERMISOS en un solo pase — sin `purchases.read` el pago no aparece en voz/tabla/
  gráfico/Inicio y da 403 en `/avisos?detector=pago` y `cruzar area=compras`). Regresión: `gate-vigia`
  13/0, `gate-voz` 16/0, `gate-dibujo` 13/0, `infra` (XSS/CSP) 15/15, `verify-constructor` verde.
  **Rojo AJENO (no propio):** `gate-nav-inicio-disa` deja 2 rojos porque el tenant *desarrollo* tiene
  **0 propuestas de DISA pendientes** (1 enviada + 27 descartadas) y ese gate necesita ≥1 para probar el
  badge de `disa_proposals` (dato vivo, nada que ver con esta pieza; "cero errores JS al cargar /admin"
  pasa — el bloque nuevo carga limpio). Ejemplo real (desarrollo): arriba, prioridad ALTA, las deudas de
  María García López de mayor importe (F2026-0023 €60493,95, F2026-0022 €12100, …); pagos y caídas
  intercalados por €; el cliente dormido, al final (BAJA). **Al validar Ibrahim en pantalla, el peldaño 5
  (detección proactiva) queda cerrado.**

### ✅ 6 — Dashboards personalizables · INICIO PERSONALIZABLE VALIDADO por Ibrahim en pantalla (21 jul 2026)
El usuario compone su **Inicio** con sus propios gráficos guardados en 4a. Aquí entra también el
**sidebar personalizable** (ocultar/reordenar módulos) — *de las "mejoras menores" de la auditoría vs
Holded*: es la misma idea (que el usuario ordene su casa) y comparte la decisión de dónde se guarda la
preferencia.

- **INICIO PERSONALIZABLE (opción C · híbrido) · ✅ VALIDADO por Ibrahim en pantalla (21 jul 2026).
  Con ello, el peldaño 6 queda CERRADO.**
  El Inicio se compone en una **rejilla** de bloques: los **paneles guardados del constructor** (4a/4b) +
  los **bloques nativos** que el Inicio ya tenía (cifras del negocio, avisos, vigía de DISA). Colocar =
  añadir/quitar, reordenar (drag, Sortable.js ya vendido) y **redimensionar** (ancho/alto en la rejilla).
  **DEFAULT POR EMPRESA (no por rol):** en PASO 0 se comprobó que los permisos se aplican POR USUARIO
  (`user_permissions`; las tablas de roles con nombre existen pero NO gobiernan el acceso — `requirePerm`/
  `can()` solo miran `user_permissions`), así que el default del dueño es uno de empresa, con filtrado por
  permiso de usuario. **Cascada:** `usuario:<id>` > `empresa` > `fábrica` (semilla en código, nunca lienzo
  en blanco). **Dos niveles de edición:** el dueño edita el default de empresa; cada usuario retoca su
  capa. **Reset** en los dos: usuario → "volver al de mi empresa"; dueño → "volver al de fábrica".
  Módulos: `modules/erp/inicio-layout.js` (cascada + persistencia + paleta + saneo por permiso) +
  `modules/erp/routes/inicio.js` (API `/api/erp/inicio/{layout,bloques,datos,empresa}`) + tabla nueva
  `dashboard_layouts` (`scope` PK: `fabrica`|`empresa`|`usuario:<id>`, `blocks` JSON) — **FUERA de
  WRITABLE_TABLES**, es config de presentación por tenant. La vista `views/disaHome.html.js` cambia SOLO
  la región de "esto pide tu atención" (las viejas cifras/fila-de-avisos/#dhVigia) por la rejilla; el
  saludo, la tarjeta de DISA y el chat quedan intactos. **REUTILIZA el motor del constructor:** un panel
  se pinta pasando su receta a `/constructor/cruzar` + `grafico-constructor.js` (Chart.js, mismo vendor) —
  **cero cifras propias, cuadra al céntimo** con el constructor. **PERMISOS heredados:** un bloque de un
  área que el usuario no ve NO aparece en la paleta, NO se pinta y NO se le cuela (ni el del default del
  dueño); 403 al forzar (`PUT /inicio/layout` con panel ajeno, o `cruzar area=`). Solo lectura de negocio:
  guarda la COLOCACIÓN, no deriva ni escribe cifras. Verificado: `test-inicio` (22/0: cascada + dos
  niveles + reset + omisión por permiso + paleta + normalizar + no-escribe), `gate-inicio-pantalla` (19/0,
  los 8 criterios con datos reales: fábrica montada, colocar/redimensionar/persistir un panel, cuadre al
  céntimo con el constructor, default de empresa visto por un empleado, retoque propio, resets, y permisos
  con 403). Regresión: `gate-espera-pantalla` 20/0 (actualizado: la vigía asoma ahora como bloque de la
  rejilla), `gate-vigia/voz/dibujo-pantalla`, `infra` (XSS/CSP) 15/15, `verify-constructor` verde. **Rojo
  AJENO (no propio):** `gate-nav-inicio-disa` deja 2 rojos por 0 propuestas de DISA pendientes en el tenant
  (badge de `disa_proposals`, dato vivo); "cero errores JS al cargar /admin" PASA (la rejilla carga limpia).
  Pieza posterior (anotada, no en esta tarea): el **sidebar personalizable** (ocultar/reordenar módulos).
  **Al validar Ibrahim en pantalla, el peldaño 6 queda cerrado; después, el peldaño 7 (primer oficio:
  servicios profesionales).**

### ⬜ 7 — Servicios profesionales · **1er oficio**
**Agenda** + **control de tiempo facturable** + **rentabilidad por proyecto**. Es la primera "cara por
oficio" (CANON §7: interfaces por profesión).
Aquí aterrizan, de las listas viejas:
- **Citas / Agenda** (iba marcada 🔺 prioritaria en el roadmap).
- **CRM comercial → su agenda/calendario** *(el **embudo/oportunidades** está **✅ HECHO 2026-07-09** —
  no se reabre; lo que quedaba pendiente era su agenda)*.
- **Control horario (registro de jornada)** — el fichaje, hermano del tiempo facturable.
- **Rentabilidad por proyecto** (era "Proyectos / rentabilidad").

- **PIEZA 1 — EL PROYECTO (entidad + pantalla) · ✅ VALIDADA por Ibrahim en pantalla (21 jul 2026).**
  Primera pieza del peldaño 7: SOLO la entidad "proyecto" y su pantalla de gestión;
  el registro de tiempo, facturar horas, rentabilidad y calendario son piezas 2-5 y NO entran hoy.
  Espejo EXACTO del patrón de clientes. Tabla `proyectos` (migración aditiva e idempotente, sin DROP):
  `codigo` PRY-NNNN (contador `code_counters`, no editable), `nombre`, `cliente_id`/`responsable_id`
  (FK lógicas OPCIONALES, resueltas EN VIVO por LEFT JOIN como el responsable del peldaño 3), `modo_cobro`
  (lista cerrada `horas`|`precio_cerrado`), `tarifa_hora`/`precio_cerrado` (según modo; el otro a null),
  `fecha_inicio`/`fecha_fin_prevista`, `estado` (`abierto`|`cerrado`), `active` (archivar-no-borrar),
  `notas`. **FUERA de WRITABLE_TABLES** (DISA no la escribe). Servicio validado compartido
  `modules/erp/routes/proyectos.js` (create/update/archive/restore con zod + `.status`), pantalla
  `/admin/proyectos` (buscador nombre/código, filtro Activos/Archivados, paginación 25, alta/edición/
  ficha/archivar/restaurar), permisos nuevos `proyectos.read`/`proyectos.edit` (bypass owner/admin,
  `requirePerm` en TODAS las rutas incluidas las VISTAS — M2), entrada "Proyectos" en el rail (provisional,
  en Ventas; oculta sin `proyectos.read`). Verificado: `test-proyectos` 20/0 (alta horas/precio, modo
  fuera de lista → 400, código correlativo/único/no-editable, editar, archivar+restaurar, cliente/
  responsable en vivo, migración idempotente sin DROP), `gate-proyectos-pantalla` 18/0 (entrada aparece y
  se llega pulsándola, CRUD desde pantalla, buscador/filtro, permisos con 403, 0 errores JS). Regresión
  14/14 verde (actividad-etiquetas 32, XSS/CSP, constructor 82). **Ventas (facturado sin IVA) sigue
  973.267,93 €**; Verifactu y las 5 áreas del constructor intactas. Commit `dfd20ca`. Pieza siguiente:
  PIEZA 2 — registro de tiempo (con la tarifa de la persona). **Al validar Ibrahim, esta pieza se cierra;
  el peldaño 7 sigue abierto hasta completar sus piezas.**

- **PIEZA 2 — REGISTRO DE TIEMPO · ✅ VALIDADA por Ibrahim en pantalla (21 jul 2026).**
  Registro por **cronómetro** (empezar/parar) y por **entrada manual**; **un solo cronómetro activo por
  persona** (arrancar uno nuevo finaliza el anterior). Cada entrada = proyecto (Pieza 1) + descripción +
  **duración EXACTA en segundos, sin redondeos** + **facturable/no facturable**. El **importe se calcula
  EN VIVO con la tarifa de la PERSONA** (nueva columna `admin_users.tarifa_hora`, la fija el dueño/admin en
  Usuarios), con la **tarifa del proyecto de respaldo** si la persona no tiene, o "— sin tarifa" si no hay
  ninguna (no inventa un 0). Vive **dentro de la ficha del proyecto** (lista + total de horas + total
  facturable) y en **pantalla propia `/admin/tiempo` con vista semanal** (cronómetro en vivo + lista por
  día + totales). Tabla nueva `time_entries` (aditiva, idempotente, sin DROP; índice único parcial = un
  cronómetro por persona; **FUERA de WRITABLE_TABLES**). Servicio validado `modules/erp/routes/tiempo.js`
  (start/stop/create/update/delete con `.status`). **Permisos nuevos `tiempo.read`/`tiempo.edit` +
  PROPIEDAD:** cada uno edita las suyas; dueño/admin (bypass) las de cualquiera; `requirePerm` en TODAS
  las rutas incluida la vista; sin `tiempo.read` no ve la entrada ni entra por URL (403). Eliminar =
  **ocultar** (no destruir). **FUERA:** facturar horas, rentabilidad, calendario (piezas 3-5); no se
  enlaza `project_id` a facturas. Verificado: `test-tiempo` 23/0 (cronómetro sin redondeo · un solo activo
  por persona · manual · facturable · importe con respaldo del proyecto / sin tarifa · propiedad + edición
  dueño/admin · ocultar · total por proyecto · migración idempotente), `gate-tiempo-pantalla` 17/0
  (cronómetro y manual desde pantalla, importe cuadrado, ficha de proyecto con total, vista semanal,
  permisos con 403 y propiedad, 0 errores JS). Regresión 9/9 verde (actividad-etiquetas 32, XSS/CSP,
  `gate-proyectos` 18/0) + constructor. **Ventas (facturado sin IVA) sigue 973.267,93 €**; Verifactu
  intacto. Pieza siguiente: PIEZA 3 — facturar horas. **NO se cierra sin que Ibrahim valide en pantalla.**

- **PIEZA 3 — FACTURAR HORAS · ✅ VALIDADA por Ibrahim en pantalla (21 jul 2026).** *(Además, a petición
  suya, «Proyectos» pasó a ÁREA PROPIA del rail, fuera de Ventas — commit da86ccd.)*
  Lleva las **horas facturables** de un proyecto (Pieza 2) a una **factura REAL**. **Cero camino nuevo de
  emisión**: reutiliza `createInvoice` del motor (correlativo + hash Verifactu + asiento contable + cola
  T2). Pantalla `/admin/facturar-horas`: eliges proyecto (+ rango de fechas opcional) → salen sus horas
  facturables con importe → seleccionas → **vista previa** que agrupa **una línea por (tarea + tarifa)**
  (cantidad = horas sumadas, precio = tarifa/hora) → IVA (por defecto el de la empresa) e **IRPF** editables
  → "Generar factura" → te lleva a la factura. **Cliente = el del proyecto** (sin cliente → 400 "asigna un
  cliente"; se avisa en la propia pantalla). **Entrada sin tarifa no se factura** (400). **"Facturada" se
  deriva EN VIVO**: `time_entries.invoice_id` puesto **Y** la factura enlazada `emitida`; si la factura se
  **anula, la entrada se libera sola** (sin tocar el motor de anulación). Una entrada facturada **no se
  edita ni elimina** (409, guarda en `tiempo.js`) y luce **🔒 Facturada** en la vista semanal y en la ficha
  del proyecto. **Migración aditiva**: columna `time_entries.invoice_id` + índice (sin DROP; `time_entries`
  sigue **FUERA de WRITABLE_TABLES**). **Permiso `invoices.create` en TODAS las rutas incluida la vista**
  (no por propiedad: quien puede facturar factura las horas del equipo). Ficheros: `models.js` (columna +
  índice), `schemas.js` (`facturarHorasSchema`), `routes/facturar-horas.js` (nuevo: servicio + vista),
  `routes/tiempo.js` (`SELECT_BASE` con LEFT JOIN a `invoices`, `facturada` en `conImporte`, guarda
  `noFacturada`), `routes/proyectos.js` (badge en la ficha), `layout.js` (nav + permiso), `routes/index.js`
  (mount). Verificado: `test-facturar-horas` 31/0 (qué entra/qué no · agrupación tarea+tarifa · **cuadra al
  céntimo** · marcado/bloqueo · **anular libera** · sin tarifa/sin cliente → 400 · otro proyecto → 400 ·
  IVA override + IRPF · migración idempotente), `gate-facturar-horas-pantalla` 21/0 (menú + pantalla ·
  facturables · previa cuadrada · **factura REAL emitida cuadrando 300+63=363** · entradas facturadas y
  bloqueadas · permisos 403 y candado por permiso, no por bypass · 0 errores JS · **neto-cero en Ventas**
  tras crear+anular). Nuevo grupo de regresión `servicios` en `run-gates.mjs` (proyectos + tiempo + facturar
  horas + `verify-constructor`): **7/7 verde**. **Ventas (facturado sin IVA) sigue 973.267,93 €**; Verifactu
  y el constructor intactos. **RESIDUO por diseño**: la factura de prueba del gate se anula (permanece en la
  cadena inmutable, neto-cero en Ventas). **FUERA:** rentabilidad por proyecto (pieza 4, ahí se enlaza
  `project_id` a facturas/compras) y calendario (pieza 5). **NO cerrar en Notion sin validación en pantalla.**

- **PIEZA 4 (parte 1) — RENTABILIDAD POR PROYECTO · 🟡 ENTREGADA (21 jul 2026), pendiente de validación en
  pantalla.** Etiqueta de proyecto (`project_id`, FK nullable, leída EN VIVO) en las **dos** tablas que
  postean al P&G: **factura de venta** (`invoices`, cubre venta + abono/rectificativa) y **factura recibida**
  (`supplier_invoices`, cubre compra-mercadería + gasto + abono de proveedor). La "compra directa"
  (`purchases`) queda FUERA a propósito: es stock/activo, no postea a grupos 6/7. **Hallazgo clave de la
  auditoría:** `cuentaPyG` es una vista del **libro diario**, no de los documentos → el filtro por proyecto
  resuelve el asiento → su documento (`origin_type`/`origin_id`, ya indexado) → `project_id`, **EN VIVO**
  (sin columna nueva en el diario, sin tocar el posteo ni Verifactu). `cuentaPyG(db,from,to,{project})`
  ACOTA sin cambiar la matemática: `<id>` = ese proyecto; `null` = estructura (no asignado); sin opts =
  todo. **Regla dura verificada: Σ(P&G de cada proyecto) + estructura = P&G total, al céntimo.** Motor nuevo
  `modules/erp/rentabilidad.js` (rentabilidadProyecto/comparativaProyectos, única fuente = P&G filtrado).
  **Panel** en la ficha del proyecto (ingresos facturado sin IVA − gastos = resultado + margen %; **cobrado**
  aparte como caja, no cambia el resultado). **Comparativa** `/admin/rentabilidad` (lista por proyecto +
  estructura + TOTAL, marca en **rojo** los que pierden). **Selector "Proyecto"** en el detalle de la factura
  de venta y de la recibida (reasignable, en vivo; en venta es campo NO fiscal fuera del hash) + en el alta
  de factura recibida. **Auto-etiqueta:** la factura de "Facturar horas" nace con su proyecto; la
  rectificativa hereda el de la original (el abono netea dentro del proyecto). **Permisos:** la etiqueta la
  pone quien edita el documento (invoices.create / purchases.create); el panel y la comparativa exigen
  **proyectos.read Y invoices.read** (candado AND en TODAS las rutas incluida la vista; navFilter admite
  array de permisos; sin ambos: ni menú ni URL, 403). Migración aditiva/idempotente, sin DROP; ambas tablas
  siguen FUERA de WRITABLE_TABLES. Ficheros: `models.js` (2 columnas + índices), `contabilidad-pyg.js`
  (`pygRows` + opts), `rentabilidad.js` (motor, nuevo), `routes/rentabilidad.js` (nuevo), `routes/proyectos.js`
  (panel), `routes/invoices.js` (endpoint proyecto + selector + rectificativa hereda), `routes/supplier-invoices.js`
  (esquema + svc + endpoint + selector), `routes/facturar-horas.js` (auto-etiqueta), `schemas.js`, `layout.js`
  (nav + permiso AND), `routes/index.js` (mount). Verificado: `test-rentabilidad-proyecto` 22/0 (filtro cuadra
  · Σ+estructura=total al céntimo · reasignar mueve en vivo · cobrado aparte · comparativa marca perdedores ·
  migración idempotente), `gate-rentabilidad-pantalla` 15/0 (asignar desde pantalla venta+gasto · panel ·
  comparativa en rojo · permisos AND 403 · 0 errores JS · **neto-cero en Ventas Y en P&G total**),
  `test-contabilidad-pyg` 36/0 (matemática del P&G intacta), grupo `servicios` **9/9** + `margen` 6/6.
  **Ventas seguía 973.267,93 €**; Verifactu, P&G total, las 5 áreas del constructor y los KPIs intactos.
  *(Nota 22 jul: el tenant de desarrollo se reseeded con datos "taller" tras esta validación, así que su
  base de Ventas hoy es ~115.497 €, no 973.267,93 €; el número absoluto ya no aplica — lo que se verifica
  es que cada trabajo NO lo mueve, vía neto-cero.)*

- **PIEZA 4 (parte 2) — COSTE DE LAS HORAS EN LA RENTABILIDAD · ✅ ENTREGADA y verificada (22 jul 2026,
  commit `3d19945`).** Valora a COSTE cada entrada de tiempo y suma por proyecto para dar, junto al
  "resultado contable" de la parte 1 (INTACTO), un **"resultado de gestión"** que resta también el coste de
  las horas. **Cascada del panel:** Ingresos − Gastos directos = **Resultado contable** (parte 1, del P&G
  filtrado) − **Coste de las horas** (Σ horas × coste-hora congelado) = **Resultado de gestión** (nuevo).
  **Coste-hora por persona:** columna nueva `admin_users.coste_hora` (ESPEJO de `tarifa_hora`; la tarifa es
  VENTA/facturación, el coste es COSTE), editable en la misma pantalla de Usuarios y con el mismo permiso
  (`admin.manage_users`). **Congelado (filosofía WAC):** cada entrada guarda `time_entries.coste_hora_congelado`
  al crearla (columnas nuevas `coste_hora_congelado` + `coste_backfill`); cambiar el coste-hora de una persona
  HOY **no reescribe** un proyecto pasado. Backfill idempotente de las entradas previas (estampa el coste-hora
  del momento, marcado `coste_backfill=1`). **Sin coste-hora (0/vacío) = "sin coste registrado", NO coste 0:**
  esas horas se **apartan** y el panel avisa cuántas quedan fuera (idéntico al aviso "sin tarifa" de la pieza 2).
  **Capa de GESTIÓN, no contable:** el coste de horas **NO entra en `cuentaPyG`, ni en el diario, ni toca
  Verifactu**; aviso honesto y visible ("el resultado de gestión incluye el coste estimado de las horas y NO es
  el resultado contable; tu P&G no cambia"). **Comparativa** `/admin/rentabilidad`: columnas nuevas **Coste
  horas** y **Resultado gestión** + aviso agregado de horas sin coste; badge "pierde con horas" (gana en
  contable, pierde tras el coste). **Permisos:** el panel y la comparativa mantienen el candado AND de la parte 1
  (`proyectos.read` Y `invoices.read`); editar el coste-hora exige `admin.manage_users`; el coste-hora congelado
  NO se filtra por la API de tiempo. Migración aditiva/idempotente, sin DROP; `time_entries` y `proyectos` siguen
  FUERA de WRITABLE_TABLES. Ficheros: `models.js` (2 cols en time_entries + col en admin_users + backfill),
  `schemas.js` (`coste_hora` en userUpdate), `routes/users.js` (campo + guardado + aclaración tarifa=venta),
  `routes/tiempo.js` (congela el coste al crear la entrada), `rentabilidad.js` (`costeHorasProyecto` + cascada
  en rentabilidadProyecto/comparativaProyectos), `routes/rentabilidad.js` (columnas + avisos en la comparativa),
  `routes/proyectos.js` (cascada en el panel de la ficha). Verificado: **`test-coste-horas-proyecto` 28/0**
  (coste = Σ horas×coste congelado · sin coste apartado · congelado no altera el pasado · gestión = contable −
  coste · contable intacto · cuadre Σ+estructura=total intacto · backfill marcado · migración idempotente),
  **`gate-coste-horas-pantalla` 17/0** (cascada en pantalla · coste horas · aviso horas sin coste · aviso honesto
  gestión≠contable · columnas en la comparativa · permisos del coste-hora 403 · sin fuga por la API de tiempo ·
  0 errores JS · **neto-cero en Ventas Y P&G total**). Regresión: `test-rentabilidad-proyecto` 22/0,
  `test-tiempo` 23/0, `test-facturar-horas` 31/0, `test-contabilidad-pyg` 36/0, `verify-constructor` 82/0,
  `test-contabilidad` 38/0, `test-proyectos` 20/0, `test-coste-wac` 19/0 — todo verde. **La pieza 4 queda
  COMPLETA (parte 1 + parte 2). El peldaño 7 SIGUE ABIERTO: siguiente pieza 5 (calendario), a la espera de
  encargo.**

### ⬜ 8 — Salud / bienestar · **2º oficio**
Agenda presencial.

### ⬜ 9 — Belleza / estética · **3er oficio**
Agenda + caja del día.

### ⬜ 10 — Proyectos · partes de horas · servicio de campo
**Proyectos**: gestión de tareas internas **tipo kanban** — distinto del CRM *(de la auditoría vs
Holded)*. **Partes de horas** · **Servicio de campo / órdenes de trabajo** · **Parte de obra**.

### ⬜ 11 — TPV / POS módulo completo

### ⬜ 12 — Cobro recurrente + domiciliación SEPA

### ⬜ 13 — Telegram como canal de DISA

### ⬜ 14 — Mapas (OpenStreetMap)

### ⬜ 15 — App móvil nativa

### ⬜ 16 — API pública / webhooks

### ⬜ 17 — Integraciones / marketplace
*(Descartado a propósito y por escrito el 9-jul: el marketplace de asesorías/gestorías de Holded — es
un canal de leads, no una función de gestión.)*

### ⬜ 18 — Documentos / suite ofimática ligera

### ⬜ 19 — Multiempresa · Multi-moneda · Fabricación · Firma digital de documentos · Helpdesk
Aquí entra también **RRHH**: ficha de empleado (datos fiscales/contrato) + **nóminas** + organigrama
*(de la auditoría vs Holded)*. Va aquí y no en el 7 a propósito: el **control horario** sí es del oficio
(paso 7), pero nóminas y organigrama son un módulo de plantilla, no una cara por profesión.

### Sin peldaño propio — entran donde toquen (anotadas, no perdidas)
De las **"mejoras menores de UX/plataforma"** de la auditoría vs Holded. No son módulos: son mejoras
sueltas que se enganchan a lo que ya existe, y por eso no ocupan peldaño.
- **Importar contactos en bloque desde archivo** (clientes/proveedores) → cuelga de Clientes/Proveedores.
  *Hermana del **importador CSV de productos**, que la ayuda pública ya promete (`docs.html.js:630`).*
- **Buzón de email propio para reenviar tickets de gasto** → cuelga de la captura de compras que ya existe.
- **Búsqueda global + botón de creación rápida universal** → cuelgan del chrome del panel (`layout.js`).
- **Calendario fiscal de vencimientos** → **YA CONSTRUIDO** el 15-jul: `calendario-fiscal.js` lo hizo
  **D5e** y alimenta las propuestas de DISA. Lo que falta es enchufarlo a la **campana** como fuente de
  avisos (ver §Eje B). *Esta línea de la auditoría vs Holded quedó saldada sin que la lista se enterara.*

---

> El detalle completo de cada módulo del roadmap, de las decisiones registradas (D1–D6) y de todas las
> piezas ya cerradas se conserva en `docs/contexto/` y en el historial de `git` (TABLERO anterior).
