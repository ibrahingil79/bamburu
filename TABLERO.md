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
> **PASO 7 (servicios profesionales · 1er oficio) ✅ CERRADO el 28 jul 2026** con la pieza 6 (puerta
> pública de reserva): las 6 piezas entregadas y verificadas. **El puntero de la escalera está en el
> PELDAÑO 8 (Salud / bienestar · 2º oficio), a la espera de encargo.**
> Pasos 5 (DISA predictiva: vigía + voz + dibujo + priorización/Inicio) y 6 (Inicio personalizable)
> HECHOS y VALIDADOS por Ibrahim en pantalla (21 jul 2026). **Paso 7 CERRADO (28 jul 2026):** piezas 1
> (proyecto), 2 (registro de tiempo) y 3 (facturar horas) VALIDADAS por Ibrahim en pantalla (21 jul;
> «Proyectos» ya es área propia del rail); pieza 4 completa (rentabilidad contable + coste de las horas,
> 22 jul); pieza 5 (sistema de citas: motor + agenda interna) + Agenda sencilla (27 jul); **pieza 6
> (puerta pública de reserva, 28 jul) — la que cierra el peldaño.**
> **PELDAÑO 8 EN CURSO: PIEZA 1 (perfil de oficio en la agenda) ✅ ENTREGADA el 15 ago 2026.** Al crear
> el negocio se elige entre SEIS oficios y la agenda habla su idioma desde el primer minuto: cambia las
> palabras de pantalla y precarga el catálogo de servicios (duraciones reales de España, con fuente
> anotada). Nada más: no toca el motor, no enciende ni apaga funciones, no quita nada. Los negocios que
> ya existen quedan en «Otro» y no cambian. **El peldaño 8 sigue ABIERTO.** No se inicia nada sin tu encargo.
> **PELDAÑO 8 · PIEZA 3 ✅ ENTREGADA (17 ago 2026): EL VIGÍA APRENDE DE AGENDA.** Cuatro detectores
> nuevos —hueco que se va a perder, cliente fuera de su ritmo, se fue sin próxima cita, y ausencias
> (el estado `no_show` existía de verdad)— leyendo del motor de citas, sin cifras propias y sin
> escribir nada. El PASO 0 tumbó el método que pedía el encargo: `huecos()` **no puede** dar ocupación
> ni horas libres. **El peldaño 8 sigue ABIERTO.**
> **ENCARGO SUELTO ✅ HECHO (17 ago 2026): AVISOS Y CORREOS.** El resumen por correo deja de ser una
> tarea fija de las 8:00 al correo del negocio y pasa a ser **de cada persona**: se apaga, se cambia de
> hora, se recorta por fuente, **filtra por permisos** y cuenta **un parte en frases** en vez de «233
> avisos». Y cada correo automático o de botón que sale hacia los clientes gana su interruptor (con la
> confirmación de reserva **bloqueada** mientras la puerta pública esté encendida). Ver su ficha en
> «Función por encargo del dueño». Descubrimiento del PASO 0: **`company_config.email` estaba vacío en
> 6 de 7 negocios**, así que el correo diario solo llegaba a uno.
> **TAREA TRANSVERSAL DE PRESENTACIÓN ✅ HECHA (17 ago 2026): NAVEGACIÓN — MENOS RUIDO SIN PERDER NADA.**
> Como la «Agenda sencilla», **no es pieza de ningún peldaño** y no mueve el puntero de la escalera.
> Cada desplegable se parte en dos bloques (día a día arriba · «Ajustes de \<Área\>» abajo) **sin plegar
> nada**; el buscador del topbar —que era decorado, sin `input` ni destino— pasa a navegar por el menú
> con Ctrl/⌘+K; y cada uno **se ancla sus atajos** arriba del rail (máx. 8, **por usuario**) **y mueve
> de orden lo que quiera** —las áreas del rail y las entradas de cada desplegable, arrastrando—, con un
> botón para volver al menú de fábrica. **N antes = N después = 50 puertas**, pulsadas una a una.
> **AMPLIADA EL 18 AGO 2026 (decisión de producto de Ibrahin):** en Agenda solo vive lo que se usa
> atendiendo clientes — se queda con 2 entradas y las otras 6 se mudan, renombradas, a una sección
> propia de la configuración del negocio, **con su permiso exacto cada una** y sin heredar el candado
> de la pantalla que las aloja. Los puestos nacen ocultos y aparecen solos; la página de reservas se
> enciende sola cuando hay horario y precios. **Siguen siendo 50 puertas**, ahora en dos superficies.
> Del PASO 0: la tabla de preferencias que el encargo mandaba
> reutilizar **no servía** (se reutiliza `dashboard_layouts`, cero tablas nuevas), y las etiquetas del
> menú **se pintaban sin escapar** con texto libre del dueño dentro. El **Backlog** de abajo NO
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

### Avisos y correos — que el dueño mande sobre su bandeja de entrada  ✅ HECHO (2026-08-17)
Encargo expreso del dueño. Cierra los dos cabos que dejó abiertos el correo diario del 9-jul y las
plantillas editables del 14-jul: **el resumen no se podía apagar, ni mover de hora, ni recortar, ni
filtraba por permisos** (iba al correo del NEGOCIO), y **ningún correo automático tenía interruptor**.
Aditivo: tres tablas nuevas, ni un DROP, ninguna columna renombrada.

- **EL PASO 0 TUMBÓ CUATRO SUPOSICIONES DEL ENCARGO, y las cuatro cambiaron el plan:**
  1. **No existe una fuente de «vencimientos fiscales».** Las 7 fuentes reales son `envio_verifactu`,
     `vencimiento_proveedor`, `cobro_vencido`, `cliente_en_riesgo`, `stock_bajo`, `factura_recurrente`
     y `reserva_publica`. La séptima que se creía fiscal es **Verifactu**, y no avisa de plazos con
     Hacienda: avisa de que **un envío concreto a la AEAT falló**. Avisos de plazos fiscales **no
     existen** y serían función nueva.
  2. **El correo vacío ya no salía.** `bamburu-avisos.mjs:59` ya cortaba con cero avisos —comprobado
     ejecutándolo, no leyéndolo—. Lo que faltaba era **constancia de que se evaluó**: un día sin avisos
     y un día en que el cron no llegó a correr se veían **exactamente igual** desde fuera.
  3. **`fuentesPermitidas(c)` NO era reutilizable «tal cual»**: lee del CONTEXTO de Hono y el cron no
     tiene contexto. Se extrajo el cálculo a `fuentesDe({role, perms})` + `permisosDeUsuario(db, id)`
     en `avisos.js`, y `layout.js` **delega**. Un solo sistema de permisos, no dos.
  4. **No son 8 tipos / 18 variantes: son 10 / 20** (la pieza 5 añadió confirmación y recordatorio de
     cita). Y la «variante» es **el tono del mismo correo** (amable/firme/formal/última), que elige
     quien envía → **el interruptor va por TIPO**, como se pedía.
- **EL HALLAZGO QUE MÁS CAMBIÓ LA TAREA: `company_config.email` está VACÍO en 6 de los 7 negocios.**
  El correo diario solo podía llegar a **uno**. `admin_users.email` es la identidad de login y existe
  en el **100 %** de los usuarios. Así que el destinatario **se invierte**: va a la dirección personal
  siempre, y el correo del negocio queda como respaldo **solo del dueño** y **se reporta** cuando se
  usa. Al encender esto, `helados-ibrahin` recibió su primer parte: llevaba meses con avisos que no
  veía nadie.
- **BLOQUE 1 · lo que Bamburu te cuenta a ti** (`avisos_pref_usuario`, **la ausencia de fila es el
  defecto**: activado, cada día, 8:00, todas las fuentes → nadie deja de recibir por la migración).
  Interruptor maestro, diaria/semanal con día, hora, y casillas por fuente **de las que puede ver**.
  El filtro es una **intersección** con el permiso VIVO: una casilla marcada de algo que ya no puede
  ver no se le manda.
- **EL CONTENIDO PASA DE RECUENTO A PARTE** (`parte-diario.js`). Decía «233 avisos que requieren tu
  atención» —que no es información, es el tamaño del montón—; ahora dice *«Te deben 1.240,00 €, de los
  que 380,00 € están vencidos. 2 personas esperan que apruebes su reserva»*, con **enlace directo a
  cada cosa**. Las cifras salen del **mismo `avisosDelDia`** que la campana: cero criterios nuevos.
  Dos frases NO son avisos —**la agenda del día y la deuda total**— y se leen de `citas` y de
  `openDebts()`, **solo lectura, autorizado por el dueño**: sin ellas «380 € vencidos» es media noticia.
  **Y el asunto lleva la noticia** (`Tu negocio hoy · 6 citas hoy · 380,00 € vencidos`): es lo único
  que se lee en la notificación del móvil sin abrir nada.
- **EL TEMPORIZADOR PASA A HORARIO**, sin planificador nuevo. Y no pregunta «¿es tu hora exacta?» sino
  **«¿tu hora ya pasó y aún no te he escrito hoy?»**: con `Persistent=true`, un servidor apagado siete
  horas provoca **UNA** pasada de recuperación, no siete, y con la igualdad se quedaba fuera todo el
  que tuviera una hora intermedia. La idempotencia (`resumen_envios`, UNIQUE por fecha+persona) impide
  el duplicado. `daily_alert_log` **no se toca**: su clave primaria es `fecha` a secas y ampliarla
  habría exigido recrear la tabla.
- **BLOQUE 2 · lo que Bamburu envía a tus clientes** (`email_tipo_pref`, otra vez ausencia = encendido).
  Interruptor en los **2 automáticos** y en los **5 de botón** (decisión del dueño). Los **2
  transaccionales** (recuperar contraseña, portal) **no lo llevan y se explica por qué**: apagar el de
  la contraseña deja a alguien fuera de su cuenta, que es lo mismo que el editor de plantillas **ya
  bloquea**. Botón **«Mándame una prueba a mí»**: a la dirección **de la sesión**, nunca del body, y con
  datos de ejemplo.
  - **DOS CHOQUES RESUELTOS SIN CREAR UN SEGUNDO MANDO:** (a) `recordatorio_cita` **ya tenía**
    interruptor (`cita_modo_recordatorio`, que **nace apagado**); el nuevo **lo refleja**, porque uno
    nuevo «encendido por defecto» habría empezado a mandar recordatorios que hoy no se mandan. (b) la
    **confirmación de reserva** queda **bloqueada** mientras la puerta pública esté encendida —lo
    prometido en la pieza 6: la política de cancelación se repite en ese correo— y el **servidor
    devuelve 409**, no solo la pantalla.
- **Una sola pantalla, `/admin/settings/avisos`, y SIN `requirePerm` en el bloque 1 — a propósito.**
  El resto de Ajustes exige `company.read`, que en la práctica es dueño o admin (`company` ni siquiera
  está en la tabla `permissions`). Con ese candado, **un empleado no podría apagar su propio correo**
  ni usar el enlace del pie. El bloque 2 sí lo lleva. Cada endpoint toma el id **de la sesión**: nadie
  puede leer ni cambiar la preferencia de otro.
- **Deuda saldada:** `test-pago-voz-avisos` llevaba en rojo desde el 14-jul porque el asunto decía
  «1 avisos» y la prueba esperaba «1 aviso». Como este encargo reescribe el asunto, **entraba**: 50/0.
- **Verificado:** `gate-avisos-correos` **45/0** — negocio **creado desde cero** y borrado al final,
  correos **enviados de verdad** al buzón sumidero de Resend (cero correos a personas): apagar → no
  llega · encender a otra hora → llega a esa hora y **con los datos reales del negocio** · sin nada que
  contar → no se envía **pero consta** · dos usuarios, misma pasada, **la de cobros prohibido no recibe
  ni una cifra de deuda** · dos pasadas seguidas → **un solo correo** · recordatorio de cita apagado →
  no sale, encendido → sale · confirmación **bloqueada con la puerta pública** (409) · cobro apagado →
  el envío se niega con el motivo · móvil 390×844 y escritorio, **0 errores JS**.
- **Regresión VERDE en su número exacto**: gate-plantillas-email 41/0, gate-agenda-sencilla 11/0,
  test-reserva-publica 130/0, gate-registro-alta 34/0, test-oficio 94/0, test-oficio-alta 52/0,
  gate-oficio-pantalla 28/0, verify-disa-query-permisos 43/0, **test-pago-voz-avisos 50/0** (era 46/1).
- **Anotado, no tocado:** `verify-plantillas-email` sigue en rojo previo (cuenta 8 tipos/18 variantes;
  la pieza 5 los dejó en 10/20 y no lo actualizó). El guardián vigente es `gate-plantillas-email`, 41/0.

### Reorganizar el menú: Agenda se queda con lo que se usa atendiendo clientes  ✅ HECHO (2026-08-18)

**DECISIÓN DE PRODUCTO DE IBRAHIN, y es la regla que decide todo lo demás:** *en Agenda solo vive lo
que se usa atendiendo clientes; todo lo que se monta una vez y se olvida vive en la configuración del
negocio*. **No se eliminó ninguna función**: seis entradas se mudan de sitio y se renombran.

**AGENDA SE QUEDA CON DOS:** «Agenda» y «Recordatorios a clientes» (era «Cola de envíos» — mismo sitio,
mismo contador al lado cuando hay pendientes). Con 0 entradas de ajuste el desplegable **va de una
pieza solo**: lo decide `MIN_AJUSTES` (3), que ya existía. No se tocó ningún umbral.

**LAS SEIS MUDADAS**, en el orden en que se monta un negocio, dentro de la sección «Cómo funciona mi
agenda» de `/admin/settings`: **Cuándo abro** (Horarios) · **Cuánto dura cada servicio** (Servicios
reservables) · **Mi equipo** (Quién atiende, sin el atajo de Agenda) · **Cómo se piden las citas**
(Ajustes de citas) · **Mi página de reservas** (Reservas por Internet) · **los puestos** (nombre del
oficio: Sillas/Cabinas/Salas/Boxes). **Las rutas NO cambian** y **los permisos NO cambian.**

**CORRECCIÓN DE IBRAHIN (18 ago 2026):** la sección de la agenda va **AL FINAL** de la pantalla, detrás
de los datos del negocio, avisos, plantillas y situación fiscal. Estaba la primera y no debía: esta
pantalla es la configuración DEL NEGOCIO, y lo de la agenda es una sección suya, no su portada. El
orden INTERNO de las seis no cambia (sigue siendo el orden en que se monta un negocio).

**UNA SOLA LISTA, NO DOS.** La sección **no** se escribe a mano en `routes/settings.js`: vive en
`CONFIG_NEGOCIO` (`modules/erp/menu.js`), la misma mesa de la que comen el rail, el buscador y las
anclas, y la pinta `configNegocioHTML()` en `layout.js`. Escribirla en la pantalla habría creado la
segunda lista que la cabecera de `menu.js` lleva meses prohibiendo.

**CORRECCIÓN DE IBRAHIN sobre el hallazgo de la auditoría previa, y es el corazón de la pieza: LA
SECCIÓN NO HEREDA EL CANDADO DE LA PÁGINA QUE LA CONTIENE.** `/admin/settings` exigía `company.read`
en seco; con eso, mudar habría **cerrado** seis puertas a quien tiene `citas.read` y no es dueño. Ahora
entra quien tenga **algo** que ver ahí y ve **exactamente eso**: cada entrada conserva su permiso
exacto (`citas.read`, `citas.edit`, `admin.manage_users`), y el bloque de empresa —y su `<script>`—
solo se pinta con `company.read`, con las APIs negando igual que antes. Ni se abre ni se cierra nada.

**«SILLAS Y APARATOS» NACE OCULTA.** Es la única entrada condicional del menú: aparece sola cuando hay
un puesto de alta **o** algún servicio exige uno. Para el negocio que la necesita y aún no lo sabe, la
puerta está **dentro de «Cuánto dura cada servicio»**: al marcar que un servicio necesita un sitio, se
da de alta ahí mismo, **sin recargar y sin cerrar el modal**, y la entrada aparece.

**LA PÁGINA DE RESERVAS SE ENCIENDE SOLA** cuando el negocio tiene (a) horario propio y (b) al menos un
servicio con precio ≠ 0 y con duración. **No antes**, y por un motivo concreto: los servicios sembrados
nacen a 0 € y el horario de fábrica es 8:00–21:00 los siete días — encenderla antes publicaría precios
en blanco y domingos que el negocio no cumple. Al encenderse **avisa al dueño por los canales que ya
hay** (campana, pantalla de avisos, Inicio, correo diario) con el enlace, qué se ve y **un interruptor
para apagarla en un clic**. Es de **una sola vez** (`cita_pub_auto`): si el automatismo pudiera volver a
encenderla, el interruptor de apagado sería mentira. Y **solo se publica lo que tiene precio y
duración** (`SQL_PUBLICABLE`, en un solo sitio para que la lista pública y la validación de cada reserva
no puedan discrepar).

**EL BUSCADOR ENCUENTRA LAS 8 POR SU NOMBRE NUEVO Y POR EL VIEJO** (`alias`): quien lleva un año
tecleando «Cola de envíos» u «Horarios» sigue llegando, y ve en el resultado el nombre nuevo. Un alias
nunca crea un destino ni salta un permiso.

**VERIFICACIÓN — `gate-menu-navegacion` 154/0** (era 105/0). **N ANTES = N DESPUÉS = 50 puertas**,
comprobadas **una a una por identidad** sumando las dos superficies (36 del rail + 6 de la
configuración + 2 fijas + 6 de cuenta); en un negocio recién creado son 49, porque la de puestos es
condicional, y la 50ª se comprueba al darla de alta. Las seis responden **200 desde su sitio nuevo y
desde su ruta vieja**. Un segundo usuario con `citas.read` y **sin** `company.read` entra, ve solo sus
dos, pulsa y recibe 200, y no ve —ni encuentra— nada más de esa pantalla (sus APIs, 403).
Además: `test-textos-citas` 27/0 · `gate-agenda-calendario` 38/0 · `gate-agenda-sencilla` 14/0 ·
`gate-agenda-visual` 68/0 · `gate-citas-pantalla` 25/0.

**DOS COMPROBACIONES CAMBIARON DE SITIO, y se dice para que no parezcan perdidas:**
- *Arrastrar una entrada al bloque de ajustes* se hacía en Agenda, la única área que llegaba al umbral.
  Ya no se parte ninguna de fábrica, así que el escenario se **fabrica con la preferencia de orden del
  propio usuario** (que es lo que hoy puede partir un desplegable). Bajar `MIN_AJUSTES` para que la
  prueba siguiera valiendo habría sido cambiar el producto para que el gate no se queje.
- *El nombre del puesto en el menú* (`test-textos-citas`) se comprobaba en el rail. Ahora se comprueba
  en la sección — **y mirando la fila concreta**, porque buscar el texto en la página daba verde con el
  cambio deshecho: esa pantalla también pinta el rail. Pasaba por el motivo equivocado.

**VALIDADO DESHACIENDO EL ARREGLO** (regla de `session.json`): con el producto en `HEAD` y los gates
nuevos, `gate-menu-navegacion` cae a **78/20** y `gate-agenda-calendario` a **37/1**. `test-textos-citas`
daba **27/0 igual** hasta apretar la aserción; ahora cae a **26/1**.

**Regresión completa:** `run-gates.mjs --all` 50/63. **Los 13 rojos son previos**: los mismos 13, por
nombre, con el árbol revertido a `HEAD` (comprobado con copia del árbol y `diff -q` al restaurar).
Causa del más cercano a lo tocado, `gate-avisos-badge`: **gate caducado** — busca `a.disa-fig-link` en
el Inicio y esa clase ya no la usa ningún elemento (solo queda su CSS), así que la tarjeta no se
encuentra; no es un fallo del producto. **Anotado, no arreglado** (otro tema).

**HALLAZGO, no tocado:** ninguno de los seis gates de agenda/menú está en los grupos de
`run-gates.mjs`, así que **no entran en `--all`**. Hoy se corren a mano. Si se quiere que la regresión
completa los cubra, hay que meterlos en un grupo — decisión del dueño, porque alarga el barrido.

**Capturas:** `/home/ubuntu/menu-shots/` (Agenda con sus dos entradas · la sección en su sitio · sin
puestos frente a con un puesto). **Desplegado y verificado por HTTPS** en `peluqueria-gil.bamburu.com`:
Agenda con 2 entradas, la sección con sus 5, y las 7 rutas viejas a 200.

### La regresión, de 11 min 30 s a 6 min — en paralelo, con dos modos y sin bajar el listón  ✅ HECHO (2026-08-20)

**LA AUDITORÍA PRIMERO, Y DESMINTIÓ LO QUE PARECÍA.** El barrido tardaba **11 min 30 s** (medido con
`time`, 71 gates). El tiempo NO se iba donde uno diría: arrancar Chromium son **0,6 s** (26 s en todo
el barrido, un **3 %**) y dar de alta un negocio de prueba **0,36 s** (3 s en total, un **0,4 %**).
Optimizar cualquiera de las dos cosas no habría cambiado nada. Donde se va el tiempo es en el trabajo
de verdad: **176 cargas de página a ~0,9 s (158 s, 22 %)** y **101 s de esperas fijas** declaradas
dentro de los propios gates (14 %) — `gate-cliente-ficha-completa` duerme 38 s a propósito de sus 122.
El resto son aserciones, siembra y quince gates que mandan correo real al buzón sumidero de Resend.
Contra eso no hay truco de arranque: hay que hacer varias cosas a la vez.

**Consecuencia directa: «el negocio de prueba se prepara una vez y se reutiliza» AHORRA 2,5 s.** Se
dice porque es la verdad medida, no lo que se esperaba. Lo que sí valía —y es lo que se ha hecho— era
la otra mitad de esa frase: **declarar cuáles empiezan de cero**, porque sin esa declaración no se
puede paralelizar sin romper nada. Son siete, en `EMPIEZAN_DE_CERO`, y la declaración **se comprueba
contra el código en cada pasada**: si un gate llama a `provisionTenant` y no está en la lista (o al
revés), el runner lo dice. Una declaración que nadie verifica se pudre en dos semanas.

**EL PLANIFICADOR: tres clases y tres topes.** 43 de los 71 gates escriben en el MISMO negocio de
desarrollo, así que a lo bruto no es «más rápido», es un gate contando las facturas que le crea otro.
Cada gate cae en una clase: **empieza de cero** (negocio propio, paralelismo libre), **solo**
(necesita el negocio en silencio) o **compartido** (toca solo lo suyo, con su producto de sufijo único
y borrado por ID — el patrón que `gate-fixtures.mjs` ya traía escrito «para que dos gates a la vez no
puedan pisarse»).

**LOS CUATRO NÚMEROS, Y NINGUNO ES UN CAPRICHO:**
- **2 con navegador a la vez.** Dos motivos, los dos medidos. (1) `index.js` frena a **600
  peticiones/min por IP** y todos los gates salen de 127.0.0.1: con 4 a la vez se frenaron **7
  peticiones en un solo minuto** —apenas por encima del tope— y **eso tumbó SEIS gates**, porque un
  429 en una carga de página deja la pantalla sin su script. **Ese freno no se toca: es un control de
  seguridad.** (2) Con 3, una pasada de cada cuatro moría con `TargetCloseError: Target.createTarget`
  (Chromium sin poder abrir pestaña con tres navegadores para cuatro núcleos); el gate suelto pasa
  6/0, así que no era suyo. **Un rojo que sale una vez de cada cuatro es peor que uno fijo**: enseña a
  desconfiar del barrido.
- **2 sobre el negocio compartido** · **4 procesos en total** · **los SOLOS, de uno en uno.**
- El barrido guarda los tiempos en `data/tiempos-gates.json` (fuera del repo) y arranca por lo más
  lento: si `gate-cliente-ficha-completa` (2 min) entrara el último, todos esperarían por él.

**SEIS ROJOS REALES DE CONCURRENCIA, DECLARADOS UNO A UNO. Ningún gate se ha tocado.** Salieron al
paralelizar y cada uno tenía razón; lo que se ha escrito es POR QUÉ corre solo:
- `gate-facturar-horas-pantalla` y `gate-rentabilidad-pantalla` miden el **total de ventas del negocio
  entero** antes y después y exigen neto-cero al céntimo: salió `340.087,01 → 341.087,01`, y la
  diferencia era **una factura de otro gate**.
- `gate-nav-inicio-disa` cuenta las **propuestas pendientes** y las compara con el badge del riel: los
  seis gates de propuestas se las movían entre las dos lecturas (39 → 40).
- `gate-avisos-badge` y `verify-avisos-permisos` cuentan **todos los avisos** del negocio.
- `gate-devoluciones-proveedor` afirma que el stock y el WAC del **producto 1 —el vivo, el compartido—**
  vuelven al valor de partida: otro gate se lo dejó en 47 donde esperaba 52.

**Y UN FALLO QUE ERA MÍO, NO DE LOS GATES.** La bandera que bloquea a los compartidos se calculaba UNA
vez al entrar en la pasada del planificador, así que al arrancar un «solo» el bucle **seguía admitiendo
compartidos detrás de él**. `gate-avisos-badge` y `gate-nav-inicio-disa` arrancaron juntos y los dos
contaron mal. Se vio porque el barrido se corrió **cinco veces**, no una: un fallo de concurrencia que
sale una vez de cada tres no aparece en la primera pasada.

**LOS DOS MODOS (RITUAL.md actualizado):**
- **`--tocado`, antes de cada commit.** Sale de `git diff` y de tres fuentes que se SUMAN: la tabla
  `AFECTA`, **el grafo de imports** (todo gate que importe un fichero cambiado — automático, no se
  pudre; cubre el 58 % del árbol, y el 42 % restante son rutas y vistas que los gates ejercitan por
  HTTP sin importarlas, de ahí la tabla) y los gates que hayas cambiado tú. **Un fichero que no cubra
  ninguna regla NO se adivina: corre el barrido entero y dice qué fichero lo obligó.** Medido: tocar
  la vista del Inicio → 8 gates, **2 min 50 s**; una ruta de compras → 22 gates; un motor troncal →
  todo. `--lista` enseña la selección sin correr nada.
- **`--all`, una vez, al cerrar.** **6 minutos.** Es EL veredicto; el corto no cierra una tarea.

**LA COMPROBACIÓN QUE PEDÍA EL ENCARGO: mismo resultado, gate por gate, por nombre.** El barrido en
serie de partida (**11 min 30 s**, 59/71) se guardó como veredicto ordenado y se comparó con `diff`
contra **dos pasadas consecutivas en paralelo**: **idénticas las dos**, y **idénticas entre sí**.
Mismos 59 verdes, mismos 12 rojos por nombre —los mismos 12 previos— y **cero peticiones frenadas**
(`security_events` no sumó ni una en ninguna de las dos). **11 min 30 s → 6 min 00 s: 1,9×.**

**Lo que NO se ha hecho, a propósito:** no se ha tocado el freno de peticiones, no se ha bajado ni una
aserción, no se ha sacado ni un gate del barrido y no se ha silenciado ni un rojo. Con 3 navegadores
el barrido baja a 4 min 30 s, pero es inestable; **se prefiere un minuto y medio más y que el verde
signifique algo**.

### El Inicio deja de ser una lista de deberes: EL CUADRO DE MANDO DEL DÍA — **TAREA TRANSVERSAL** (el puntero del peldaño 8 NO se mueve)  ✅ HECHO (2026-08-20)

**QUÉ ERA EL INICIO Y QUÉ ES AHORA.** Era un saludo, una tarjeta de DISA, cuatro cifras sueltas
(ventas · pedidos · pendientes · avisos), el panel de arranque, la rejilla componible y **medio
pantallazo de chat**: compositor, accesos rápidos, cuatro tarjetas de sugerencia y su hilo. Ahora es
lo que un dueño mira a primera hora, en este orden: **HOY** (la franja del día) · **TUS NÚMEROS**
(cuatro tarjetas grandes) · **EL GRÁFICO** (ventas por día, con el mes anterior detrás) · **TU
NEGOCIO EN CIFRAS** (tres listas cortas) · **OPORTUNIDADES** · **DISA DECIDE** · **PON EN MARCHA TU
NEGOCIO** (plegado) · **TUS PANELES** (la rejilla del paso 6, intacta).

**LO QUE DESTAPÓ EL PASO 0 — cuatro cosas que había que decidir antes de escribir una línea:**
- **Serie por día: existe UN motor y devuelve el total CON IVA.** `ventasPorDia` (ventas-metrics)
  suma `invoices.total`; el **constructor NO sabe agrupar por día** — `clavePeriodo` solo entiende
  mes/trimestre/año. Así que el gráfico grande se pinta con lo que hay y **lo dice en su pie**; el
  titular de la tarjeta va **sin IVA** (base), que es lo que cuadra con el informe de ventas, y la
  cifra con IVA viaja a su lado para que las dos se reconcilien de un vistazo. **No se ha inventado
  una serie en base**, que es lo que habría hecho falta para tenerlo todo en la misma magnitud.
- **Dos cifras no tienen motor para compararse, y se dice.** La **deuda** (`openDebts`) se mide a día
  de hoy y **nada reconstruye la deuda de una fecha pasada**; los **clientes nuevos**
  (`clientesNuevosPorMes`) se cuentan **por meses completos**, así que no hay forma honesta de
  comparar medio mes con medio mes. Las dos tarjetas enseñan «— sin comparación» **y el motivo**,
  nunca un 0 ni un porcentaje inventado.
- **La migración solo tenía UNA puerta**, y se pliega. `/admin/migracion` se alcanzaba únicamente
  desde el paso «trae tus datos» del panel de arranque — no está en el menú ni en ninguna otra
  pantalla. Confirmado leyendo la tabla de rutas y el fichero del menú.
- **El chat del Inicio usaba dos endpoints en exclusiva**: `/api/disa/chips` (GET+POST) y
  `/api/disa/alerts/open`. Los demás (`/message`, `/threads`, `/attach`) los siguen usando el widget
  flotante y la pantalla `/admin/disa`.

**CERO CÁLCULO NUEVO, Y SE PUEDE COMPROBAR.** Nace `modules/erp/cuadro-mando.js`, que **no es un
motor: es un camarero**. Cada cifra sale del motor de su pantalla —`ventasResumen`, `openDebts`,
`margenResumen` → el motor único, `clientesNuevosPorMes`, `margenPorProducto`, `ventasPorCliente`,
`pipelineByStage`, `datosHoy` (→ `agendaData` + `ocupacionDia`), `detectar` + `priorizar`— y el gate
las contrasta **por otro camino** contra el informe de ventas, la torre de Cobros, el informe de
margen y el informe de clientes. **Ni una tabla nueva. Ni una columna nueva.**

**PERMISOS POR LISTA BLANCA, FILTRADOS EN EL SERVIDOR.** Diez secciones, cada una con **todos** los
permisos que exige. La composición **ni siquiera llama al motor** de una sección que este usuario no
puede ver: no es que se esconda al pintar, es que el dato no existe en la respuesta. Forzar
`/api/erp/inicio/cuadro/<sección>` da **403** si le falta un permiso y **404** si la sección no
existe. El gate lo prueba con un empleado de verdad y busca la cifra exacta en el cuerpo Y en el HTML.

**EL SUELO DE LOS RANKINGS, DICHO EN VOZ ALTA.** `SUELO_UNIDADES = 3`: para entrar en «lo que más
vendes» o «lo que más te deja» hay que haber vendido **al menos 3 unidades en el periodo**, y la
pantalla escribe ese número y **cuántos productos se han quedado fuera por él**. Sin suelo, «el que
peor va» sería siempre el que diste de alta ayer. Los sin coste conocido no entran en el ranking de
rentabilidad —sin coste no hay margen que juzgar, ni 0 % ni 100 %— y también se dice cuántos son.

**NINGÚN PORCENTAJE DE MARGEN SIN SU BASE (CANON).** La tarjeta de margen lleva el sufijo del modo de
la empresa («sobre lo que cobras» / «sobre lo que te costó»), **sobre cuánto** se divide y **cuánto
queda fuera** por no tener coste. Cada fila del ranking de rentabilidad, igual.

**DISA DECIDE SE COMPONE, NO SE COPIA — y por un motivo que conviene dejar escrito.** `voz.js` escribe
el dinero en **formato inglés** (`€232.75`) y las fechas en **ISO** (`2026-07-28`). Esta pantalla tiene
la regla dura de español, así que la línea se arma de **campos estructurados** (cifra · etiqueta del
detector · nombre · código del documento · fecha) y se escribe cada uno en español al pintarlo. Las
dos salidas malas estaban descartadas: tocar la voz cambia también la pantalla del vigía y cuatro
gates (otra tarea), y reescribir su texto con expresiones regulares es **reparsear** — justo lo que su
cabecera prohíbe, y lo que destroza un nombre de cliente con caracteres raros.

**EL PANEL DE ARRANQUE CAMBIA DE CRITERIO.** Antes se plegaba solo cuando estaban **todos** los pasos
hechos; ahora se pliega cuando el negocio **tiene actividad real** (`hayActividad`: alguna factura o
alguna cita). Un negocio que lleva un año facturando pero no ha encendido los recordatorios abría su
Inicio con la lista de deberes por delante de sus cifras. El pliegue **se sigue recordando por
usuario** y la preferencia de la persona gana siempre.

**DE PASO, DOS DUPLICADOS CAZADOS EN PANTALLA:**
- **La rejilla de fábrica enseñaba lo mismo dos veces.** Traía «Cifras del negocio», «Hoy en la
  agenda» y el «Vigía de DISA», que ahora están arriba, fijos y más grandes. De fábrica queda **solo
  «Avisos pendientes»**, que no lo pinta nadie más. Los otros tres **siguen en la paleta** para quien
  los quiera colocar, y **los layouts ya guardados se respetan**: esto es la semilla, no una migración.
- **Dos «Ventas del mes» distintas en la misma pantalla.** El bloque nativo iba **con IVA** y la
  tarjeta nueva **sin IVA**. Ahora los dos leen `base` del mismo motor y el bloque lo dice en su
  rótulo.

**LA MIGRACIÓN GANA SU SEGUNDA PUERTA:** entrada fija en **Datos del negocio** (`/admin/settings`),
con el mismo candado que la pantalla (`company.read`) — un cambio de sitio no abre ni cierra puertas.
La del panel de arranque sigue donde estaba. **Dos puertas, y ninguna depende de la otra.**

**EL CHAT SE VA DEL INICIO, Y SOLO DEL INICIO.** DISA sigue entera en `/admin/disa` y en su entrada
del menú, que es a donde lleva ahora. **Los endpoints que quedan sin uso NO se han borrado**: se
señalan aquí (`/api/disa/chips` GET+POST y `/api/disa/alerts/open`), que es otra decisión y de otro día.

**VERIFICACIÓN — `gate-inicio-cuadro-mando` 60/0, contra la DIRECCIÓN PÚBLICA** (`https://<negocio>.
bamburu.com`, navegador de verdad, nada por localhost ni por atajo de API). Los once casos del encargo,
más el bloque HOY contrastado contra la agenda y la comprobación de que ni una fecha ISO ni un importe
en formato inglés se cuelan en «DISA decide».

**VALIDADO SABOTEANDO — los cuatro sabotajes tumban el gate:** quitar el suelo del ranking → **4
rojos** (y «Extensiones», vendida una sola vez, aparece como el farolillo); quitar la base del margen
→ **3 rojos**; dejar el panel siempre desplegado → **2 rojos**; quitar el filtro de permisos → **2
rojos**, y el segundo enseña **la cifra de ventas del negocio viajando al navegador de un empleado que
no puede verla**.

**TRES GATES DE ANTES SE ADAPTAN AL REDISEÑO, y ninguno se afloja:**
- **`gate-inicio-arranque` 66/0** (era 65/0). Dos aserciones miraban la rejilla de FÁBRICA buscando
  tres bloques y el bloque «Hoy». Lo que protegían —que el panel no APAGUE el Inicio y que a un
  negocio con agenda se le ofrezca «Hoy»— sigue comprobándose, ahora contra la rejilla real y contra
  la PALETA; y se le añade una aserción nueva: que el cuadro de mando se pinta **con** la rejilla, no
  en su lugar.
- **`gate-cliente-ficha-completa` 150/0.** Miraba dentro del panel de arranque dándolo por
  desplegado; ahora lo **abre** primero, que es lo que hace un dueño.
- **`gate-avisos-badge` 25/0.** Disparaba el resumen desde la tarjeta del chat, que ya no existe. Lo
  que protegía —**que pedir el resumen NO marque los avisos como vistos**— se comprueba pidiéndoselo
  al endpoint, que sigue existiendo: si algún día se vuelve a enganchar a un botón, la red ya está.

**Regresión completa: `run-gates.mjs --all` 59/71, y los 12 rojos son EXACTAMENTE los 12 previos**
(los mismos, por nombre, que dejó `f683781`). Ninguno toca el Inicio. Los de plantillas de email se
comprobaron **revirtiendo `settings.js` a `HEAD`**: fallan idénticos sin mi cambio (un 409 de Resend y
un catálogo de 10 tipos donde el gate espera 8). Otro tema.

**TRES DETALLES QUE SALIERON AL MIRARLO EN LA DIRECCIÓN PÚBLICA** (negocio sin ventas todavía), los
tres arreglados: el chip de comparación decía «— 0,00 €», que se lee igual que el «—» de «no hay
dato» siendo cosas distintas (ahora dice «igual que el mes pasado»); el eje del gráfico repetía
«0 € · 0 € · 1 € · 1 €» porque con todo a cero Chart.js reparte el eje en fracciones que se
redondeaban al mismo texto (ahora solo se rotulan los enteros); y la cifra de «DISA decide» salía sin
unidad —un «13» delante de «hueco que se va a perder»—, así que cada detector no monetario lleva
ahora su rótulo (h libres · días · faltas), tomado de lo que él mismo declara.

**QUÉ NO SE HA TOCADO:** los motores de cálculo, el esquema de base de datos (**ninguna tabla nueva**),
las pantallas de Agenda, CRM, Facturas y Oportunidades, el detector de enfriamiento y WRITABLE_TABLES.

**ANOTADO Y NO CONSTRUIDO** (no es de esta tarea):
- **`voz.js` escribe dinero en inglés y fechas en ISO.** Afecta a la pantalla del vigía y a cuatro
  gates; arreglarlo es una tarea con su propia verificación.
- **No hay motor de serie diaria en base (sin IVA)** ni de deuda a fecha pasada ni de altas de cliente
  por tramo de mes. Los tres se enseñan hoy como «—» o con su magnitud declarada.
- Los dos endpoints del chat que quedan sin uso.

### El Inicio de un negocio que arranca: panel «Pon en marcha tu negocio», bloque «Hoy» y migración asistida — **TAREA TRANSVERSAL** (el puntero del peldaño 8 NO se mueve)  ✅ HECHO (2026-08-19)

**LO QUE DESTAPÓ EL PASO 0: el panel de U6 y la rejilla del Inicio COMPETÍAN.** `disaHome.html.js`
envolvía la rejilla en un `onboarding ? '' : …`, así que **mientras faltara un paso la rejilla no se
pintaba** y, en cuanto se completaban, **el panel desaparecía para siempre**. Un dueño nuevo no veía
nunca su Inicio; uno rodado no podía volver a lo que dejó a medias. Ahora conviven: la rejilla se
pinta siempre y el panel se **pliega en una línea** cuando ya no hace falta, con el pliegue recordado
por usuario.

**PANEL «PON EN MARCHA TU NEGOCIO» — absorbe el de U6, no lo duplica.** Sus cuatro pasos viven ahora
en `arranque.js`, repartidos en tres bloques que dicen para qué sirven: *para poder facturar* · *para
empezar a trabajar* · *para que el negocio ande solo*. Reutiliza el anillo y el patrón de guía de
DISA tal cual. **Ningún paso se marca a mano: no existe el endpoint**, y el gate lo prueba forzando
tres rutas distintas. Cada uno se deriva de un dato real —NIF puesto, logo, horario, servicios con
precio Y duración, equipo, reservas encendidas, recordatorios encendidos, primera factura, migración
pedida— sin añadir una sola bandera al esquema.

**UN DETALLE QUE SALIÓ AL PROBARLO Y ESTÁ BIEN COMO ESTÁ:** sembrar el catálogo del oficio **no**
marca «tus servicios», porque la semilla los crea con duración pero **a precio 0 a propósito** («las
fuentes publican duraciones, no precios»). El paso pide las dos cosas, así que solo se marca cuando
el dueño pone el precio — que es exactamente para lo que existe el paso. El gate lo comprueba en los
dos sentidos.

**LA LISTA SE ADAPTA AL OFICIO SIN PERDER NADA.** Peluquería: 11 pasos. Asesoría: 7 arriba y **4 en
«Más opciones»**, cada uno diciendo por qué está ahí. Se usa el perfil que YA existe (`usa_proyectos`)
y `usaAgenda`, que mira el estado real: a quien ya usa la agenda nunca se le esconden sus pasos.

**Y NI UN ENLACE A UN 404:** los destinos no se declaran a mano, **se le preguntan a la propia
aplicación** por su tabla de rutas montadas. Si una ruta desaparece, el paso deja de ofrecerse solo.

**BLOQUE «HOY» EN LA REJILLA — cero cifra propia.** Las citas salen de `agendaData`, la MISMA función
que sirve la vista día de la agenda; las horas libres, de `ocupacionDia`, de donde come el detector de
huecos del vigía. Contrastado por otro camino de código en el gate: 3 = 3 citas y 405 = 405 minutos.
**Sin agenda no existe ni en la paleta** —misma guarda que los cuatro detectores de agenda—, y con
`citas.read` filtrado en el servidor: sin permiso **el dato ni se calcula**, y forzar la ruta da 403.
Entra en el default de fábrica de los oficios con agenda.

**Un matiz que no se esconde:** sin horario puesto el motor abre de 8 a 21 todos los días, así que
«te quedan N horas libres» sería un número inventado. El bloque **lo dice** y manda a ponerlo.

**MIGRACIÓN ASISTIDA — el destino real de «trae tus datos».** Pantalla propia, tabla aditiva fuera de
WRITABLE_TABLES, correo al equipo con el adjunto y acuse en pantalla y por correo. **La pantalla dice
que la migración la hace el equipo de Bamburu, a mano y gratis, y NO insinúa un importador automático
que no existe** — la misma regla que con WhatsApp. El registro se guarda **aunque el correo falle**, y
entonces la pantalla lo dice en vez de fingir que todo fue bien.

**VERIFICACIÓN — `gate-inicio-arranque` 65/0**, con los **cuatro sabotajes demostrados**: quitar la
derivación del estado, quitar la guarda de agenda, quitar el filtro de permiso y quitar el plegado
hacen caer el gate. El tercero enseña en su salida **el día entero de citas viajando a un navegador
que no debía verlo**, que es como se ve una fuga.

**DE PASO, TRES ARREGLOS:**
- **`gate-avisos-badge` sale de los rojos previos.** Buscaba `a.disa-fig-link`, la tarjeta del Inicio
  anterior al peldaño 6. Ahora busca por el DESTINO (`/admin/avisos`), que es lo que de verdad
  protege y lo que no cambia con el próximo rediseño. **25 OK.**
- **El `max-height` fijo del hero, cortado de raíz.** Recortaba el contenido en cuanto crecía: primero
  se comió el cuarto paso del alta (640 px) y luego la rejilla entera (1200 px). Perseguir el número
  es perder siempre: ahora en abierto **no hay tope** y el píxel exacto se mide en JS justo antes de
  plegar, que es lo único que la animación necesitaba.
- **«Ventas del mes» se escribía en inglés** (`€30`). Ya está en español, como el resto.

**Regresión completa: 58/70 y los 12 rojos son un SUBCONJUNTO de los 13 previos.** Por el camino, dos
falsos rojos que conviene no confundir con deuda: una corrida abortó **porque yo estaba editando
ficheros mientras corría** —la red de `exigeCodigoServido` funcionando, negándose a dar verde sobre
código que el proceso no servía— y dejó residuo (cuatro proyectos y un usuario de prueba) que puso en
rojo a otros cinco gates hasta limpiarlo.

### Ficha de cliente: rendimiento, contraste y el chip de Proyectos — correcciones sobre la entrega del día  ✅ HECHO (2026-08-19)

**«VER» TARDABA 2-3 SEGUNDOS. Medido: `/360` tardaba 1.000 ms**, y todo lo demás iba por debajo de
120 ms. Tres causas, las tres de repetir trabajo:
- **El vigía entero se ejecutaba DOS VECES** por petición (≈600 ms de los 1.000): una para `disa` y
  otra para `recomienda`, para sacar exactamente el mismo resultado. Ahora corre una vez y se reparte.
- **La lista de ventas del negocio se barría CUATRO veces** (primer documento, gasto total, gasto del
  periodo, días de visita): 4 × 55 ms del mismo trabajo. Memorizada por petición — misma lista, misma
  regla, pedida una vez.
- **Y un `let lista` MUERTO en el vigía**: la variable existía desde siempre y el bucle recorría
  `DETECTORES` ignorándola, así que pedir un subconjunto no ahorraba nada. Ahora la ficha pide solo
  los detectores que pueden señalar a un cliente (`porCliente`, declarado por cada detector, no una
  lista aparte). **Comprobado que el resultado para ese cliente es idéntico**, hallazgo a hallazgo.

**1.000 ms → 280 ms**, y del clic a las ocho tarjetas pintadas: **356 ms**.

**«VER FICHA COMPLETA» pedía `/360` OTRA VEZ** para lo mismo que la ventana ya tenía. Ahora recibe
esos datos. **Del clic a la tabla de facturas: 42 ms.**

**CONTRASTE.** Color donde dice algo, no de adorno: **la deuda viva en rojo y el margen en verde**
(rojo si es negativo). El resto se queda en negro — si se colorea todo, no destaca nada. Y el
subtítulo del porcentaje sube de contraste: era el dato que acompaña al titular y se leía en gris
claro sobre blanco.

**EL CHIP DE PROYECTOS EN DESARROLLO: aparecía por dos motivos, los dos correctos.** El oficio de ese
negocio es **«otro»**, que mantiene `usa_proyectos` en **true a propósito** (los negocios que ya
existían no pierden nada de su pantalla por una migración); y además **el negocio tiene 4 proyectos
vivos**. Se refina la regla para que diga lo que F1 dice de verdad: *«se ocultan si el negocio NO USA
esa función»* — y **tener proyectos ES usarla**, así que el chip se enseña aunque el oficio no lo
traiga. Esconder un chip que lleva a datos reales sería esconderle al dueño lo suyo. Comprobado:
oficio taller **con** proyectos → visible; taller **sin** proyectos → oculto (y encendible en «Más
opciones»).

**DOS GATES MÁS AL BARRIDO, Y LO QUE DESTAPARON.** `gate-vigia-pantalla` y `gate-vigia-agenda`
tampoco estaban. Al meterlos:
- `gate-vigia-agenda` sale **rojo en 1 aserción de 41**, y está **demostrado que es previo** (idéntico
  con `vigia.js` revertido a HEAD). Se declara en `ROJOS_CONOCIDOS` del runner **con su motivo**, para
  que salga por su nombre en cada barrido: un rojo con dueño es información, uno anónimo es ruido.
- `gate-nav-inicio-disa` se puso rojo por **cruce entre gates**: comprobaba el orden de fábrica del
  menú y heredaba **una preferencia de reordenación que yo dejé en el tenant compartido** probando a
  mano la tarea de navegación. Arreglado en el gate (retira la preferencia del usuario que mira antes
  de medir): un gate que comprueba el orden de fábrica no puede depender de lo que haya en la base.

**Regresión completa: 55/69**, con los 13 rojos de siempre más `gate-vigia-agenda`, declarado.

### Ficha de cliente completa: la ficha entera en la ventana, registro de contactos y estética de tarjetas — **TAREA TRANSVERSAL** (el puntero de la escalera NO se mueve)  ✅ HECHO (2026-08-19)

**LO QUE EL PASO 0 DESTAPÓ, Y ERA CULPA MÍA.** La entrega anterior dejó las tarjetas bien y **la
pantalla que las rodea mal**. Medido: en Bamburu `.card` **no lleva padding** —vive en `.card-body`—
y yo había escrito el contenido dentro de `.card` a pelo, así que **17 sitios de la ficha completa
tenían el texto pegado al borde**, en los cuatro anchos. Y a 390 px las celdas de la tabla de
facturas se pintaban **44 px fuera de su caja**, sin llegar a hacer scroll.

**POR QUÉ NO LO CACÉ:** mi gate medía **solo `.bf-card`** —el componente que yo había construido— y
no midió nunca la pantalla que lo contiene. El mismo error de siempre: verificar mi pieza en vez de
lo que el usuario ve. El gate nuevo mide **todo elemento con texto de las dos superficies**, cae
también si el texto solo *toca* el borde, y **abre los desplegables antes de medir**.

**LA VENTANA YA NO TE ECHA.** «Ver ficha completa» abría otra página: se perdía el sitio, el filtro y
la lista, y volver era un viaje. Ahora es **una capa más de la misma ventana**, con su flecha. La
página entera queda para cuando alguien recarga la dirección o la comparte — que es justo cuando sí
se quiere una página. Las dos superficies llaman al **mismo renderizador**: no hay una segunda copia
del HTML en ninguna parte.

**LAS TARJETAS, EN ORDEN DE URGENCIA** — te debe · margen · gasto · **periodo elegible** · ticket ·
última visita · **último contacto** · cada cuánto viene. **«Cliente desde» sale de las tarjetas**: no
pide ninguna acción, así que baja a los datos del cliente junto al NIF y el teléfono. No se pierde.
**Cada tarjeta abre lo que EXPLICA su cifra**, no todas a facturas: las tres del tiempo abren el
registro de contactos, la del margen su desglose documento a documento, la de la deuda la gestión de
cobro. Y **«Últimos 12 meses» dejó de ser una decisión nuestra**: 3, 6, 12 meses, este año o fechas
propias, elegido dentro de la tarjeta, con el título cambiando y **recordado por usuario** en la
tabla de preferencias que ya existía.

**EL REGISTRO DE CONTACTOS (entidad nueva) Y LA REGLA QUE PROTEGE A DISA.** `client_contacts`, fuera
de WRITABLE_TABLES. Se apuntan **solos** —factura, cita atendida, cancelada o plantón, correo del CRM,
y lo que manda Bamburu **marcado como automático**— y **a mano en dos clics** el teléfono, el
presencial y el WhatsApp. **WhatsApp no está conectado a Bamburu y la pantalla lo dice**: no se finge
una integración que no existe.

La trampa evidente habría sido juntarlo todo en «última vez que supimos de él». Sería un desastre:
**tres recordatorios automáticos harían parecer vivo a un cliente que lleva 18 meses sin aparecer**, y
el detector de enfriamiento dejaría de avisar justo de los que se están yendo. Por eso hay **dos
cosas y dos tarjetas**: contacto (todo) y visita (*pisó el negocio o compró*). **El detector sigue
leyendo exactamente la misma consulta que ayer**, sin una coma cambiada. El gate lo comprueba con un
cliente real: 4 visitas, 18 meses parado, tres correos automáticos y una llamada — **sigue dormido,
su ritmo no se mueve un día, y las dos tarjetas dan fechas distintas**.

**LOS CHIPS, POR LO QUE EL NEGOCIO USA, NUNCA POR VALER 0.** Se lee el perfil de oficio que YA existe
(`usa_proyectos`) y `usaAgenda`, sin inventar otro sistema. Taller sin Proyectos; negocio sin agenda
sin Citas; **asesoría con 0 proyectos SÍ los ve** — es su trabajo, y ese 0 le enseña que puede
empezar. Y **nada se elimina**: lo oculto vive en «Más opciones» y se enciende de un clic.

**VERIFICACIÓN — `gate-cliente-ficha-completa` 150/0.** Los cuatro sabotajes están demostrados:
hacer que un correo automático cuente como visita, quitarle el aire a las cajas, devolver «Ver ficha
completa» a otra página y ocultar los chips por valer 0 **hacen caer el gate**, comprobado deshaciendo
cada cambio y volviéndolo a poner.

**LA HERRAMIENTA APRENDIÓ TRES TRAMPAS MÁS.** `scripts/lint-plantillas.mjs` ahora caza también:
el backtick en un comentario **de bloque** (`/* */`, que se me coló y me rompió el fichero igual que
los de `//`); y **el escape que la plantilla se come** — `\s` dentro de un regex escrito en una
plantilla llega al navegador como `s`, y `/\*\*…\*\*/g` llega como `/**…**/g`, que el navegador lee
como comentario. Eso último dejó la capa de visitas **en blanco con el endpoint devolviendo 200**. El
remedio ya estaba en el propio proyecto y yo no lo usaba: **`String.raw`**, como `JS_AGENDA` en
citas.js. De paso el lint aprendió a saltarse los regex y a contar llaves, porque su primera versión
acusaba en falso a cuatro ficheros — y **un lint que grita en falso se acaba ignorando**.

**Y DOS FALLOS DE CSRF DEL MISMO TIPO:** el paso del alta y el selector de periodo llamaban con
`fetch` a pelo, sin el token. El servidor respondía 403 y el botón **parecía no hacer nada**. Ahora el
token va dentro del helper compartido, no en cada llamada.

**Y DOS COSAS QUE DESTAPÓ LA REGRESIÓN, LAS DOS MÍAS.**
- **`gate-propuestas-dormidos` se puso rojo** —verde en HEAD, rojo con mi árbol: mío sin discusión—.
  Sus 39 comprobaciones pasaban; lo que fallaba era su **limpieza**: al borrar el cliente de prueba,
  la clave foránea de `client_contacts` lo impedía. El producto **nunca borra un cliente** (archiva
  con `active=0`), así que no es un fallo de uso real, pero seis gates lo hacen. Arreglado donde toca
  y no gate a gate: un **trigger** que se lleva los contactos con el cliente, que es lo que habría
  hecho un `ON DELETE CASCADE` de haberlo escrito al crear la tabla. Aditivo e idempotente.
- **CUATRO GATES MÍOS NO ESTABAN EN EL BARRIDO.** `gate-cliente-360`, `gate-menu-navegacion`,
  `gate-agenda-visual` y el de esta tarea: los corría a mano al entregarlos y `--all` **no los
  ejecutaba nunca**. Es literalmente la historia que cuenta la cabecera de `run-gates.mjs` (catorce
  gates muertos tres semanas sin que nadie se enterara), y la estaba repitiendo. Grupo `clientes`
  nuevo, y la regresión pasa de 63 a **67 gates**.
- Al meterlos, `gate-cliente-360` cayó y destapó **una fuga de permisos que era mía**: el «cada
  cuánto viene» leía la agenda **sin comprobar `citas.read`**, así que quien no puede ver citas
  obtenía fechas sacadas de ellas. Ahora cada fuente pide su permiso: sin citas, el ritmo sale solo
  de los documentos que sí puede ver.

**REGRESIÓN COMPLETA: 54/67, y los 13 rojos son los MISMOS de siempre** (demostrado en la entrega
anterior revirtiendo el árbol, y confirmado aquí porque el rojo nuevo desapareció al arreglarlo).

**ANOTADO Y NO CONSTRUIDO:** el eje de los gráficos del constructor sigue rotulando el dinero en
formato inglés (viene del ayudante de gráficos compartido); el registro de contactos **nace vacío** y
se llena con lo que pase desde hoy — lo histórico se sigue leyendo de las facturas y de la agenda, y
no se ha reescrito ni un dato (R4).

### Ficha de cliente (ventana flotante + tarjetas + DISA que recomienda) y **los dos márgenes en toda la plataforma** — **TAREA TRANSVERSAL** (el puntero de la escalera NO se mueve)  ✅ HECHO (2026-08-19)

**EL FALLO QUE DESTAPÓ EL PASO 0, Y ERA PEOR DE LO QUE PARECÍA.** Ibrahin vio «36,3 % de margen» en un
cliente con **4.018 € de venta** y **1.577 € de coste** y no encontró ninguna cuenta que lo diera:
898/4018 = 22,3 %, 898/1577 = 56,9 %. Ninguna de las dos. **El divisor era un tercer número que no
estaba en pantalla:** 2.475 €, la parte de la venta cuyas líneas tienen coste conocido. Los otros
1.543 € (el 38,4 % de lo que ese cliente compró) quedaban fuera del cálculo entero, sin decirlo.

La regla en sí es defendible —dividir 898 € entre 4.018 € hundiría el margen con una venta que no
participó—, pero **el número publicado no era ni «sobre la venta» ni «sobre el coste»: era un tercero
sin nombre**. Y no era un caso raro: en el mismo negocio, **«Mostrador» enseñaba un 40,0 %** sobre una
venta de 151.095 € de la que solo **45 €** tenían coste. Un porcentaje calculado sobre el 0,03 % de la
venta, presentado como el margen del conjunto. **Cinco pantallas hacían lo mismo y ninguna lo decía.**

**LO DEMÁS DEL PASO 0**
- **«Cada cuánto viene: con 0 visitas todavía»** en un cliente con 21 facturas. «Visita» era, y solo
  era, *cita de agenda atendida*: en un negocio que factura sin agenda la frase era falsa. Ahora **si
  el negocio lleva agenda manda la agenda** (idéntico al vigía, que es donde opera) **y si no, mandan
  sus documentos**. Ese cliente pasó de «0 visitas» a «cada 26 días, 21 visitas».
- **El texto no se salía por «alto fijo»** —no había ninguno—: la rejilla daba columnas de 150 px
  donde una frase de 60 caracteres ocupaba cuatro líneas y estiraba **las ocho tarjetas a 120 px**.
  Donde **sí** se cortaba texto era en la ventana: la tabla de facturas medía **1.071 px dentro de un
  modal de 1.047** y partía el botón «Gestionar» por el borde. Medido, no mirado.
- **«Actividad y embudo»** se llamaba «Actividad y oportunidades» y su pie decía `tl.length > 15`:
  miraba el largo del **timeline**, no si había oportunidades. Con **0 oportunidades y 21 facturas**
  el enlace «Ver todo en Oportunidades» salía igual, colgando de una lista de facturas y llevando a
  un embudo vacío. Verificado en el DOM antes de tocarlo.
- **El alta (U6) no era ampliable:** el `3` estaba escrito **a mano en cinco sitios**. Añadir un paso
  sin cazarlos todos dejaba el anillo en 4/3 y el checklist no se retiraba nunca. Ahora todo sale de
  `onbSteps.length` y añadir un paso son **dos** cosas: una entrada en el array y su booleano.
- Y el dinero se imprimía **en inglés**: `€4018.00` en vez de `4.018,00 €`, con el formato español
  correcto ya escrito en otro fichero del propio proyecto.

**EL MOTOR ÚNICO DE MARGEN** (`modules/erp/margen.js`) devuelve **siempre las dos cifras** sobre el
**mismo conjunto de líneas** —las que tienen coste—, que es la única pareja donde el importe en euros
es **idéntico** en los dos modos. **Las siete superficies pasan por él**: ficha de cliente,
constructor, informes (resumen y por producto), rentabilidad por proyecto, plan financiero y avisos.
Cero fórmulas sueltas. **Ni un número cambió de valor** al conectarlas.

**AJUSTE DE EMPRESA «Cómo calculo mi margen»**, de fábrica *sobre la venta*. Decide el **titular** en
todas las pantallas a la vez. **R1: Contabilidad y P&G no obedecen** —ahí manda «sobre la venta»
elija lo que elija el dueño, y la pantalla lo dice—. **R2: las empresas que ya existen no cambian ni
un número**: la ausencia del ajuste ya vale «sobre la venta», así que **no hubo migración de datos**.

**LA VENTANA FLOTANTE** con dirección propia (`/admin/clients/<id>`): se copia, se comparte y al
recargar abre la ficha completa, que es una página de verdad. Atrás cierra y devuelve a la lista **con
su filtro y su página**. Se navega **en capas** (resumen → detalle → volver), nunca ventanas apiladas.
En móvil, hoja inferior arrastrable. **Las ocho tarjetas se abren** y enseñan de dónde sale su cifra —
la de margen lista **factura a factura** con la base y lo que queda fuera, que es la respuesta física
al 36,3 %. **«Te debe» abre la gestión de cobro**, no una lista muerta.

**DISA RECOMIENDA, NO INFORMA.** Mueren los seis avisos idénticos en fila («Factura F2026-0184 de Ana
Suárez Campos vencida», y otras cinco iguales). En su lugar, **una línea por familia con la decisión
tomada**: «Tiene 6 facturas vencidas por 1.255,30 €. La más antigua lleva 737 días. Te recomiendo
gestionar el cobro de la cuenta entera», con sus botones. **Cero cálculo nuevo**: la cifra es la suma
de lo que el vigía ya publicó. Sin nada que recomendar, **el bloque no aparece** — ni una frase vacía.

**NADA DESAPARECE.** La tabla larga de facturas salió de la ventana (que es el resumen) y está entera
en la ficha completa, con sus botones de cobro; la historia, las notas y el ranking siguen donde
estaban. El chip de «Deuda» sí desaparece: ya es una tarjeta, y decirlo dos veces no es informar.

**VERIFICACIÓN — `gate-cliente-ficha-margen` 125/0** sobre un negocio creado desde cero (1.200 € con
coste, 840 € de coste, 400 € sin coste conocido → 360 €, 30,0 % / 42,9 %). Incluye el **barrido que
cierra el fallo de origen**: recorre las pantallas buscando un % de margen huérfano y **cae si
encuentra uno**, aunque el cálculo sea perfecto. Y **el sabotaje está demostrado**: deshacer el sufijo
de la base, igualar los dos porcentajes, volver a listar un aviso por documento o quitarle el recorte
a la tarjeta **hacen caer el gate** — comprobado revirtiendo cada cambio y volviéndolo a poner.

**UN AGUJERO DEL PROPIO GATE, ENCONTRADO Y TAPADO.** La primera versión medía solo el *resultado*
(«¿se sale el texto?») y con textos cortos daba verde **sobre un componente ya roto**: le quité el
recorte y no se enteró. Ahora mide **el mecanismo** —que las tres líneas siguen siendo nowrap +
ellipsis + overflow:hidden y que el valor entero sigue en `title`— y además hay un cliente de prueba
con nombre de 92 caracteres. El primer nombre largo de un cliente real lo habría destapado en
producción, no aquí.

**RED NUEVA CONTRA UNA TRAMPA DEL PROYECTO** — `scripts/lint-plantillas.mjs`. Un backtick dentro de un
comentario que va dentro de una plantilla **cierra la plantilla**; me pasó **tres veces en esta misma
tarea**. El lint lo caza antes del reinicio, distinguiendo el caso malo del inocente (`https://` no es
un comentario; un backtick escapado es correcto). La cuarta vez la cazó él, no un arranque roto.

**ANOTADO Y NO CONSTRUIDO:** el eje de los gráficos del constructor sigue rotulando el dinero en
formato inglés (`€0.9`) — viene del ayudante de gráficos compartido, no de estas pantallas; y el
ranking «Qué te compra» agrupa por descripción de línea, así que dos productos con el mismo nombre se
suman (era así antes y sigue igual).

### Ficha de cliente 360 — **TAREA TRANSVERSAL** (el puntero de la escalera NO se mueve)  ✅ HECHO (2026-08-19)

**NO es pieza del peldaño 8.** La ficha era una **ficha de cobros**: deuda, facturas y poco más. Ahora
cuenta la historia del cliente.

**LO QUE DESTAPÓ EL PASO 0**
- **La ficha no existía como pantalla:** era un **modal** dentro de la lista. Sin dirección propia no
  se podía enlazar, ni pasar a un empleado, ni volver con el botón atrás, ni recibir los enlaces de
  los avisos de DISA. Por eso ahora es también una **página**.
- **Ya había una línea de tiempo** en el CRM, con troceo por permisos y una nota escrita en el propio
  código: *«ver CRM no puede ser la llave maestra que revele facturas y cobros»*. **Se extendió esa**,
  no se escribió una segunda.
- **El «cada cuánto viene» ya estaba calculado** por el detector de enfriamiento (mediana de días
  entre visitas atendidas, y con menos de 3 visitas **no se inventa ritmo**). Se reutiliza; no se
  recalcula.
- **Las horas no tienen cliente:** cuelgan del proyecto. Se leen **a través del proyecto** — decisión
  de Ibrahin: no se añade cliente a las entradas de tiempo.
- **De diez tablas implicadas, solo DOS tenían índice por cliente.** La ficha hace ocho o diez
  consultas por cliente en una pantalla: los siete que faltaban entran en la migración.
- Y una que ahorró trabajo: **las ventas de mostrador con cliente ya son facturas**, así que no son
  una fuente aparte. Las de mostrador **sin** cliente no son de nadie — y eso hay que **no** romperlo.

**LO CONSTRUIDO** — (A) cabecera de siete cifras, cada una de su motor. (B) línea de tiempo única,
**paginada y con filtro por tipo**, con las cuatro fuentes nuevas: agenda (incluidas canceladas y
plantones), proyectos, horas y notas. (C) **notas con autor, fecha e historial** en tabla propia,
fuera de las que DISA puede escribir — y **el campo de texto libre de siempre sigue intacto**, sin
migrar ni pisar. (D) contadores que abren su lista, **incluidos los que están a 0**. (E) qué compra,
últimos 12 meses. (F) los avisos que el vigía ya calcula para ese cliente.

**«CLIENTE DESDE» = SU PRIMER DOCUMENTO REAL** (factura que cuenta como venta o **cita atendida**), no
la fecha de alta: en una peluquería el primer contacto es una cita, y contarla desde el alta diría que
un cliente de dos años es de ayer. **Nunca en blanco:** sin documentos dice «Aún no te ha comprado», y
la fecha de alta sigue visible donde estaba.

**EL MODAL NO PIERDE NADA.** Sigue abriéndose desde la lista con su deuda, sus facturas y su
«Registrar cobro» a los mismos clics. Gana **una** cosa: el enlace «Ver ficha completa». Todo lo del
360 vive **solo** en la página — dos sitios pintando lo mismo acaban discrepando.

**PERMISOS: el filtro es del SERVIDOR.** Lo que un usuario no puede ver **no viaja**; no se pinta en
gris ni se esconde con CSS. Y pedirlo a mano da 403.

**VERIFICACIÓN — `gate-cliente-360` 47/0** sobre un negocio creado desde cero. La deuda cuadra **al
céntimo** con el motor de cobros y el gasto con el informe de ventas por cliente; el ritmo es el mismo
número que usa el vigía para avisar (contrastado por **otro camino de código**); sin coste el margen
sale **«—», nunca 0 ni 100 %**; la factura anulada **sigue en la línea de tiempo, marcada, y ya no
suma**; la venta de mostrador sin cliente no aparece en la ficha de nadie; un cliente vacío **no deja
la pantalla en blanco**; los avisos de la ficha son **los mismos cuatro** que los del vigía; neto-cero
comprobado (ni una factura, ni un hash, ni una línea cambian al abrirla); y a 390 px **sin scroll
horizontal** y sin errores de JS.
**REGRESIÓN COMPLETA VERDE.**

**DE PASO, un gate deja de depender del reloj** —la tercera vez con la misma trampa—:
`gate-agenda-visual` comprobaba la línea de ahora contra un horario de 9–18 mientras el navegador va
en UTC, así que a las 8:50 medía el reloj y no el producto.

**ANOTADO Y NO CONSTRUIDO:** enganchar los avisos de DISA y las demás pantallas a la ficha completa
(hoy siguen abriendo lo que abrían); los contadores de Citas y Oportunidades llevan a su lista **sin
filtrar por cliente** porque esas pantallas todavía no aceptan ese filtro.

### El despliegue entra en la entrega: «empujado» ≠ «se ve»  ✅ HECHO (2026-08-18)

**EL FALLO, con nombre:** tres commits empujados (`3f051b0`, `21e62bc`, `083657a`), los gates en verde,
y `peluqueria-gil.bamburu.com` enseñando la agenda de antes. **Node carga los módulos AL ARRANCAR**, así
que un fichero editado y no reiniciado **no existe para nadie**.

**LO QUE SE COMPROBÓ, en este orden:**
- El servicio corre desde `/home/ubuntu/bamburu` (`WorkingDirectory` del unit) y hay **UN solo proceso**
  de la aplicación en `127.0.0.1:3000`. **Caddy** escucha en 80/443 con `reverse_proxy 127.0.0.1:3000`,
  y `peluqueria-gil.bamburu.com` resuelve a la IP de **esta** máquina. **No hay caché intermedia**: se
  pidió lo mismo al proceso y por HTTPS y el cuerpo es idéntico.
- El proceso había arrancado a las **11:16:12** y `citas.js` estaba tocado a las **11:16:13** — un
  segundo después. **Ahí estaba la carrera.**
- Se reinició y se verificó **contra la dirección pública** que sirve el código nuevo (los seis
  marcadores del lienzo y del mes presentes; el segundo título del mes, ausente).

**RESPUESTA A LA PREGUNTA DE LOS GATES (punto 3): SÍ prueban contra el proceso que atiende al público.**
Todos apuntan a `:3000`, que es el que Caddy proxya; **ninguno levanta una instancia aparte**. Pero eso
**no bastaba**, y conviene que quede escrito: el gate prueba **el proceso**, no **el código de disco**.
Editar sin reiniciar da un verde sobre el código VIEJO, y ese verde se apunta en un commit que contiene
código que nadie ha ejecutado. **Ese era el agujero real.**

**LAS TRES REDES QUE LO CIERRAN**
1. `scripts/lib/gate-env.mjs` — **ABORTA cualquier gate de navegador** (código 2, «no ha verificado
   NADA») si el proceso lleva levantado desde antes del último cambio en `modules/`, `core/` o
   `index.js`. Pasa por `launchOpts()`, así que **ningún gate se la puede saltar**. Probado: tocando un
   fichero sin reiniciar, el gate corta en seco.
2. `gate-agenda-visual` termina **saliendo a la calle**: pide `/admin/citas` por **HTTPS a
   `peluqueria-gil.bamburu.com`** con sesión y comprueba que trae el código nuevo. 68/0.
3. `scripts/desplegar.mjs` — **el último paso de toda tarea que toque código servido.** Reinicia si hace
   falta y verifica contra la dirección pública. Si sale rojo, la tarea no está hecha. Añadido al
   `RITUAL.md` como paso 0 del cierre.

**DE PASO, dos gates dejan de depender del reloj** — la misma trampa de ayer: `gate-agenda-visual` y
`gate-agenda-calendario` apuntaban con el ratón a un punto del lienzo que, por la tarde, queda fuera de
vista o debajo de la cabecera fija (el lienzo arranca desplazado a la hora actual). Ahora llevan el
elemento al centro antes de tocarlo.

**REGRESIÓN 15/15 VERDE** con la guarda nueva activa.

### Agenda · corrección 2 (P1 alta de cita · P2 cambiar de mes · P3 layout del mes)  ✅ HECHO (2026-08-18)

**P1 — EL ALTA DE CITA. Reproducido en navegador antes de tocar nada.** De los tres caminos del
encargo, **los tres funcionaban**: (a) hueco → cliente que ya existe ✓ · (b) hueco → cliente nuevo al
vuelo ✓ · (c) botón «Nueva cita» ✓. **El que fallaba era un cuarto** que no estaba en la lista y que se
hace a diario: **elegir el cliente y después seguir escribiendo** —añadir el apellido, corregir una
letra—. Mensaje exacto: **«Elige o crea un cliente»**, y la cita no se creaba. Y un segundo fallo con el
mismo síntoma: un cliente dado de alta **después** de cargar la pantalla **no aparecía en el buscador**,
que desde fuera se lee igual de mal.
- **NO ES REGRESIÓN DE `3f051b0` NI DE LA CORRECCIÓN 1, y se demuestra:** `git diff 3550e48 da5a73b --
  routes/citas.js` está **vacío** (la tanda de navegación no tocó el fichero), y con `citas.js`
  revertido a `3550e48` el fallo **se reproduce idéntico**. Viene de antes de esta semana.
- **Causas:** `cFiltra()` corría en cada tecla y **borraba** el cliente elegido; ahora solo lo suelta
  cuando el texto deja de ser el nombre elegido, y aun así **el nombre escrito ya no se pierde**
  (`cResuelveCliente()` lo recoge al guardar: si es clavado el de un cliente de la ficha se usa ESE, si
  no entra como cliente nuevo). Y `META` se pedía **una** vez y se guardaba para siempre: ahora se
  refresca al abrir el panel, y si la red falla se sigue con lo que había.
- **EL GATE ESTABA VERDE SOBRE UNA FUNCIÓN ROTA, y era por dónde probaba:** metía el valor en el input
  y llamaba a `cFiltra()` a mano, o sea saltándose lo que hace una persona. Ahora **teclea de verdad**
  (`p.type`) y añade las dos comprobaciones que faltaban. **Probado que prueban: con el arreglo
  deshecho el gate da 11 OK / 3 FALLOS; con él, 14 OK / 0.**

**P2 — CAMBIAR DE MES. Respuesta a la pregunta: las flechas SÍ respondían** (pulsar ‹ pasaba de agosto
a julio). Lo que pasaba es que estaban **a 624 px del título**, en el otro extremo de la barra, así que
no había forma de saber que servían para eso. Ahora van **pegadas al título** junto a «Hoy» (166 px), y
se añade **rueda del ratón / gesto vertical** sobre la rejilla: un mes por gesto, **con freno** de
450 ms —un trackpad manda decenas de eventos por gesto—. En Día y Semana la rueda **sigue desplazando
el lienzo** y no cambia de fecha. El título ya abría el selector y «Hoy» ya volvía al mes actual: se
comprueban igualmente.

**P3 — EL LAYOUT DEL MES.** Rejilla de verdad: casillas con separador de 0.5px y **línea entre semanas
más marcada** (antes no había ni una línea), **altura mínima 84 px**, el **número arriba a la izquierda
a 12 px** (no centrado), hasta **3 citas escritas** por día con su punto de estado y **«+N más»**, los
días sin citas **callados**, **fuera el segundo «Agosto 2026»** de dentro de la tarjeta, el **zoom
S/M/L solo en Día y Semana**, y fin de semana y días de otro mes con número gris y fondo apagado.

**UN FALLO PROPIO QUE DESTAPÓ LA REGRESIÓN, y que afectaba al usuario:** desde que la agenda es un
lienzo con scroll propio, **colocarse en la hora actual cerraba solo el desplegable del menú lateral**.
El listener de `layout.js` iba con `capture:true` y veía **todos** los scrolls, no solo el de la página.
Ahora solo cierra con el scroll de la página. `gate-menu-navegacion` lo cazó (104 OK · 1 fallo) y
vuelve a 105/0.

**VERIFICACIÓN — `gate-agenda-visual` 65/0** (era 47/0) con las comprobaciones nuevas de P2 y P3, y
`gate-agenda-sencilla` **14/0** (era 11/0) con las de P1. **Probado que las nuevas prueban:** con P2 y
P3 deshechos el gate da **57 OK / 8 FALLOS**; con ellos, 65/0. **Datos de prueba de verdad:** 11 citas,
**6 días distintos** y **5 en un mismo día** — un mes vacío no demuestra nada.
**REGRESIÓN 15/15 VERDE, cero rojos nuevos.**

**UNA ASERCIÓN ACTUALIZADA, y se dice:** `gate-agenda-calendario` leía el título del mes por `.mes-tit`,
el segundo título que P3 manda quitar; pasa a leer el grande de la cabecera. **Misma exigencia:** sigue
teniendo que decir «Mes AAAA».

### Agenda: acabado visual (día, semana y mes) — **TAREA TRANSVERSAL de presentación**  ✅ HECHO (2026-08-18)
**NO es pieza del peldaño 8** y **no mueve el puntero de la escalera**: es presentación, como la
«Agenda sencilla» y como la navegación de ayer. **No se tocó el motor**: ni `huecos()`, ni
`tramosPersona`/`ocupacionPersona`, ni la guarda de solape (409), ni el horario con excepciones, ni los
permisos, ni la puerta pública, ni los avisos, ni el alta en 3 toques.

**LO QUE DESTAPÓ EL PASO 0, y decidió cómo se construyó**
- **La rejilla era una `<table>` de filas de 30 min** (`citas.js`, bucle `for(t=START;t<END;t+=STEP)`),
  con las celdas a 27 px y la cita colgada de la media hora anterior — por eso una cita de más de 30
  min se desbordaba de su `<td>`. Ahora es un **lienzo**: cada cita se coloca por sus **minutos
  reales**. Una cita a las 9:10 se dibuja a las 9:10 (medido: 12 px con la hora a 72 px).
- **Tres gates dependían de esa tabla.** Se avisó ANTES de construir y se acordó con Ibrahin:
  · Las **zonas de clic siguen siendo de 30 min** (`.agcell.libre` con su `data-col`/`data-min`), y van
    **por DEBAJO** de las citas en el apilado (z-index 1 frente a 3). Si quedaran encima, pulsar una
    cita abriría el alta de una nueva y arrastrar para mover dejaría de funcionar. **Va en el gate.**
  · Las cabeceras llevan clase **estable `.agcol-head`** con su `data-col`, y `gate-agenda-sencilla`
    lee por ahí en vez de por `#agenda thead th`. **La aserción no se debilita.**
  · Y lo que la `<table>` daba gratis y hubo que pedir a mano: **cabeceras fijas arriba y columna de
    horas fija a la izquierda** al hacer scroll. También va en el gate.
- **El color de estado estaba DUPLICADO** —`COLORS` en el servidor para la leyenda y `var COLOR` en el
  cliente para los bloques, los mismos cuatro valores copiados—. Ahora hay **UNA tabla**
  (`ESTADOS_COLOR`) de la que salen los **tres tonos** (suave = fondo · fuerte = barra y punto ·
  oscuro = texto), y el cliente la recibe serializada. **Los cuatro estados conservan nombre y
  familia**: pedida gris · confirmada verde · atendida azul · no se presentó rojo. Los valores
  «fuerte» son los DE SIEMPRE: cambia cómo se expresan, no lo que significan.
- **La vista Mes no tenía de dónde sacar las citas**: `/api/erp/citas/mes` devolvía solo el número.
  Se amplió, acotado como pidió Ibrahin: **4 citas por día como mucho**, ordenadas por hora, y **tres
  campos** (hora, cliente, estado). Y **hereda los mismos filtros que Día**: quien no tiene columna en
  Día tampoco sale en Mes. El candado sigue siendo `citas.read`, intacto.
- El «globo flotante» del mes **no era un globo**: era el `title=` nativo del navegador más un pie que
  seguía al ratón. Fuera los dos; el pie es del día **seleccionado**.

**LO CONSTRUIDO** — (1) lienzo con `--alto-hora` y **zoom de 3 pasos** (48/72/96) recordado por usuario
en `agPrefs`, rasantes de hora y media hora, columna de horas de 44 px con **etiqueta solo en punto** y
formato «9:00», **línea de ahora** en rojo con su punto y su pastilla que se recoloca sola cada minuto,
**scroll de apertura** con la hora actual a un tercio, y **fuera de horario atenuado pero clicable**.
(2) La cita como **bloque**: fondo suave, barra de 3 px, esquinas 0/6 px, texto en el tono oscuro y
**degradación por altura** sin cortar palabras (≥60 px tres líneas · 40-59 dos · 22-39 solo el cliente,
con el servicio al `title`). El tramo de espera, gris y **sin barra**. (3) Cabecera con el **mes en
grande** (mes negro, año gris; el selector de fecha lo abre el título), «Hoy» en rojo, **tira de 7
días** en vista Día, el aviso de sin-horario **cerrable y recordado**, la leyenda replegada tras una
(i), y un solo primario. (4) Mes con **hasta 3 citas escritas** y «+N más», días sin citas en silencio,
días de otros meses en gris claro, y **un clic selecciona / dos abren**.

**VERIFICACIÓN — `gate-agenda-visual` 47/0**, negocio creado desde cero, con las 10 del encargo y las
**3 que pidió Ibrahin**: pulsar encima de una cita alcanza y abre ESA cita (no el alta) · cabeceras y
columna de horas fijas al hacer scroll · el mes respeta los filtros (con «ver todo el equipo» aparece
la cita de quien libra; sin él, no) y no viaja más de 4 citas por día.
**PRUEBA DE HUMO de extremo a extremo, en navegador:** negocio nuevo → horario 9:00-18:00 → cita a las
**9:10** → se ve en **Día** (top 12 px), **Semana** (idéntica) y **Mes** («9:10 · Marta Gómez», sin
globo) → se cambia el estado y **la barra pasa de gris a verde**. 0 errores de JS.
**REGRESIÓN 15/15 VERDE, cero rojos nuevos:** `gate-agenda-sencilla` 11/0, `gate-citas-pantalla` 25/0,
`test-textos-citas` 24/0, `test-citas` 39/0, `test-enlace-cita` 14/0, `test-avisos-cita` 20/0,
`test-neto-cero-cita` 8/0, `gate-menu-navegacion` 105/0, `gate-agenda-calendario` 38/0,
`gate-reserva-publica-pantalla` 51/0, `gate-vigia-agenda` 41/0, `gate-inicio-pantalla` 19/0,
`gate-xss-escape` 29/0, `gate-csp-estricta` 19/0.

**DOS ASERCIONES ACTUALIZADAS, y se dice en vez de darlo por hecho.** No son rojos maquillados: son
conductas que este encargo cambia a propósito.
- `gate-agenda-sencilla`: leía las columnas por `#agenda thead th`. Sin `<table>` ese selector no
  existe; pasa a `.agcol-head`. **Mismo enunciado, misma exigencia.**
- `gate-agenda-calendario`: exigía que **un** clic en el mes abriera el día. El encargo pide que un
  clic **seleccione** y dos abran. La prueba ahora comprueba las dos cosas (que un clic no se salga
  del mes, y que dos abran ESE día), así que exige **más** que antes, no menos.

**ANOTADO Y NO CONSTRUIDO:** arrastrar para REDIMENSIONAR una cita por su borde (hoy se arrastra para
mover, que ya existía y sigue igual); y el solape de dos citas a la misma hora en la misma columna, que
se sigue pintando una encima de otra como hasta ahora — el encargo no lo pedía.

### Navegación: menos ruido sin perder nada — **TAREA TRANSVERSAL de presentación**  ✅ HECHO (2026-08-17)
**NO es pieza del peldaño 8** — es capa de presentación que cruza toda la app, como en su día la
**Agenda sencilla**. El puntero de la escalera NO se mueve: el peldaño 8 sigue ABIERTO donde estaba.

**La regla que mandó en toda la tarea:** no se elimina, no se esconde y no se aplaza NI UNA función.
En julio se probó un menú "lean" que escondía funciones y se revirtió a propósito (U1, `494d2ab`). El
objetivo era que se vieran menos cosas A LA VEZ, no que hubiera menos cosas.

**EL PASO 0 TUMBÓ DOS SUPOSICIONES DEL ENCARGO Y DESTAPÓ DOS AGUJEROS**
- **No existe la tabla de preferencias por usuario reutilizable que pedía usar.** `avisos_pref_usuario`
  (`299a15d`) es una tabla TIPADA de un solo propósito (activo/frecuencia/día/hora/fuentes): no cabe en
  ella una lista ordenada de anclas sin añadirle una columna que no pinta nada ahí. Lo reutilizable es
  el patrón del **peldaño 6**: `dashboard_layouts` (`scope` TEXT como clave, JSON dentro, **ausencia de
  fila = fábrica**) con sus `getLayout/setLayout/delLayout`, que aceptan cualquier ámbito. Decisión del
  dueño: **reutilizarla tal cual**, con ámbito `menu:usuario:<id>`. **Cero tablas nuevas, cero
  migración.** Queda escrito en los dos ficheros que **nadie puede borrar por prefijo** en esa tabla.
- **La "caja de búsqueda que ya existe" no era una caja de búsqueda.** Era decorado: un `<div>` con un
  `<span>` de texto fijo, sin `input`, sin JS y sin destino — y su reclamo prometía *«Buscar cliente,
  factura, producto…»*, o sea DATOS. No se le podía "añadir" navegación: había que hacerla real.
  Decisión del dueño: se hace real **para el menú** y el reclamo pasa a decir la verdad («Buscar en el
  menú… ⌘K»). **ANOTADO Y NO CONSTRUIDO: la búsqueda de datos** (clientes, facturas, productos).
- **AGUJERO 1 (anotado, NO arreglado, por orden del encargo):** `contabilidad` es la única de las 40
  claves del rail SIN entrada en `navPerms`, mientras `/admin/contabilidad` exige `invoices.read`. Un
  empleado con permisos propios y sin ese permiso **ve «Libros y modelos» y se come un 403 al pulsar**.
  El buscador lo hereda igual —ni mejor ni peor— para que los dos se arreglen a la vez.
- **AGUJERO 2 (arreglado de paso, decisión del dueño):** las etiquetas del menú se pintaban SIN escapar,
  y una de ellas es texto libre del dueño (`cita_puesto_plural` → la entrada «Puestos»). Un dueño que
  escribiera `<img onerror=…>` dejaba **XSS almacenado en todas las pantallas de todos sus empleados**.
  Caía en la línea exacta que había que reescribir. Comprobado con carga real: sale como texto.

**LO QUE SE CONSTRUYÓ — tres cosas y UN SOLO SITIO.** La definición del menú sale de `adminLayout` a
**`modules/erp/menu.js`**, y de ahí comen las tres caras: el rail, el buscador y las anclas. **No hay
una segunda lista de destinos** — se quedaría vieja y acabaría enseñando puertas que el menú esconde.
- **(A) Jerarquía dentro de cada área.** El desplegable se parte en dos bloques —arriba y sin rótulo lo
  del día a día; abajo, bajo «Ajustes de \<Área\>», la configuración y los maestros— **pero solo donde
  merece la pena**. **Es SEPARAR, no plegar:** todo sigue visible en la misma pantalla y al mismo número
  de clics. Ante la duda, ARRIBA (por eso «Envío Verifactu» se queda arriba).
  **CORRECCIÓN 4 DE IBRAHIN (18 ago 2026): «en el desplegable de Clientes hay como dos secciones,
  quiero una sola».** Tenía razón: con 3 entradas arriba y 1 abajo, dos rótulos son más cartel que
  menú. Se añade un umbral (`MIN_AJUSTES = 3`): por debajo de tres entradas de ajuste el área va de
  **UNA pieza**, con sus ajustes al final y **sin rótulo**. Hoy solo **Agenda** se parte (6 de sus 8
  entradas son de configurar, que es donde se ganaba algo); **Clientes, Compras y gastos, Inventario y
  Catálogo van enteros**. La marca `ajustes: true` de cada entrada NO se toca: dice lo que la entrada
  ES, y el día que un área junte tres ajustes su bloque aparece solo. **No se pierde nada:** las cuatro
  entradas afectadas (Grupos, Proveedores, Almacenes, Categorías) siguen ahí, las últimas de su lista,
  y el gate lo comprueba una a una.
- **(D) MOVER DE ORDEN — CORRECCIÓN 2 DE IBRAHIN, y CAMBIA UNA REGLA DEL ENCARGO.** El encargo decía
  «las áreas de fábrica **NO se reordenan**»; Ibrahin pidió que **sí**, y que también se ordenen las
  entradas de cada desplegable. Queda así: **se arrastra todo** —las áreas del rail, las entradas
  dentro de su área y los anclados entre ellos—, con la marca de si se suelta antes o después según por
  qué mitad se entre. **La línea de «Ajustes de \<Área\>» es un destino de verdad:** soltar una entrada
  encima la pasa a ajustes y soltarla arriba la devuelve al día a día; en las áreas que hoy no tienen
  ajustes la línea **aparece al arrastrar** (si no, vaciar ese bloque sería un viaje sin vuelta).
  **Lo que NO cambia:** nada se esconde, nada se quita, y **ninguna entrada se muda a otra área** (el
  servidor da 403 si se fuerza). Botón **«Restablecer mi menú»** al pie del rail, que solo aparece si
  hay algo que restablecer y devuelve el menú de fábrica borrando la fila entera.
  **LA REGLA QUE PROTEGE EL INVENTARIO:** un orden guardado es una lista de claves, y una lista de
  claves **envejece** —mañana hay una función nueva que nadie tenía guardada—. Por eso lo que no está
  en la lista **no desaparece: se coloca detrás, en su orden de fábrica.** Un menú personalizado en
  agosto tiene que seguir enseñando la función que se construya en septiembre, sin tocar nada.
- **(B) Buscador que navega.** Coincidencia **por nombre**, sin sinónimos ni difusa; solo se normalizan
  mayúsculas y tildes («almacen» encuentra «Almacenes»). Atajo Ctrl/⌘+K, flechas y Enter. Se alimenta
  del menú YA filtrado, así que por construcción no puede enseñar lo que el rail esconde. **«Cerrar
  sesión» queda fuera del buscador a propósito**: un destino que se dispara con Enter no puede ser el
  que te echa. Sigue exactamente donde estaba.
- **(C) Anclar y ordenar lo propio.** Frontera de Salesforce: la casa viene ordenada y el usuario pone
  sus atajos ENCIMA. Chincheta en cada entrada, bloque propio arriba del rail, se reordenan
  arrastrando, **máximo 8**, **por usuario** (nunca por negocio). Las áreas de fábrica no se reordenan,
  no se renombran y no se quitan; **anclar no saca la entrada de su área**. Quien no ancla nada ve el
  menú de hoy, byte por byte. Si una entrada anclada deja de estar permitida, **el ancla calla**: no se
  pinta, no se borra y vuelve sola al devolverle el permiso.
  **CORRECCIÓN 1 DE IBRAHIN:** la primera entrega solo ponía chincheta en las entradas de
  los desplegables, y «cualquier entrada del menú» incluye **las ÁREAS**. Ahora se ancla **también un
  menú principal**: su atajo aparece arriba y **abre el MISMO desplegable, con sus dos bloques**; el
  área sigue en su sitio, en su orden y con su nombre. Los dos tipos se **reordenan mezclados** en el
  mismo bloque. Para que no hubiera dos HTML del rail (uno en el servidor y otro en el navegador), el
  pintado se extrajo a un **renderizador único** (`anclasBloqueHTML`) y el endpoint devuelve el bloque
  **ya pintado**. De paso, tres arreglos de colocación que salieron al probarlo en pantalla: el rail
  desplegado pasa de 216 a **240 px** (con 216 la chincheta partía «Compras y gastos»); en el cajón del
  móvil la chincheta de un área se iba **al centro del acordeón abierto** (el `.navg` crece con el
  submenú inline); y la de una entrada anclada se colgaba del `.sidebar` y **saltaba a la esquina**
  (el `<a>` no era `position:relative`).

**CORRECCIÓN 3 DE IBRAHIN (18 ago 2026) — «Portal de cliente» se muda de Ventas a CLIENTES.** Cambia
otra regla del encargo («no se mueve ninguna entrada de área»), y por eso se anota. Es la puerta por la
que un CLIENTE entra a ver sus facturas, y desde ella se le manda su enlace: pertenece a «a quién le
vendes», no a los documentos de venta. **El inventario NO encoge: siguen siendo 42 entradas de rail y
50 puertas**, una de ellas en otra área — el gate lo comprueba igual. **Su candado NO cambia:** sigue
exigiendo `invoices.read`, el de su pantalla, no el de Clientes; mover una entrada de sitio no puede
abrir ni cerrar una puerta de tapadillo. Y a quien ya la tuviera colocada a mano en Ventas **no se le
rompe nada**: la clave vieja se ignora y la entrada aparece en Clientes, en su sitio de fábrica (es la
misma regla del orden que envejece).

**NO SE TOCÓ:** ni una ruta, ni un endpoint de datos, ni un permiso, ni un dato. Ningún área nueva. Los endpoints nuevos (`GET/PUT /api/erp/menu/anclas`,
`PUT/DELETE /api/erp/menu/orden`) guardan **colocación**, no datos de negocio, y **cero tablas nuevas**:
una fila por usuario en `dashboard_layouts` con todo lo suyo del menú (`{anclas, areas, entradas}`).

**VERIFICACIÓN — `gate-menu-navegacion` 105/0** (línea base actualizada: «Portal de cliente» cuenta ya
en Clientes, y el total sigue siendo 50), en navegador real, sobre un negocio **creado desde
cero** (oficio «peluquería»), entrando por el formulario de login y pulsando como pulsaría el dueño:
- **LA PRUEBA QUE MANDA — no amputación: N ANTES = N DESPUÉS = 50 puertas** (42 en el rail + Inicio +
  Ayuda + 6 de cuenta), identidad comprobada UNA A UNA contra el inventario del PASO 0, y **las 41 con
  pantalla pulsadas de verdad: todas HTTP 200**. Agenda enseña sus 8 entradas **a la vez** (8/8
  visibles): separar, no plegar. La etiqueta del oficio sigue llegando al menú («Sillas» en peluquería).
- Buscar «presupuesto», «almacen» y «conciliaci» → las tres rutas correctas con Enter; flecha+Enter va
  al 2º resultado; Ctrl+K enfoca.
- **CADA ÁREA tiene su chincheta** (10 de 10). Anclar tres entradas **y un área entera**: el área llega
  arriba con su nombre, **trae su desplegable de 7 entradas** y lo abre igual; las áreas de fábrica
  siguen en su orden y el rail sigue con sus 42 entradas — es un atajo, no un traslado.
- Reordenar (área y entradas **mezcladas**), **cerrar sesión pulsando y volver a entrar**: siguen
  ancladas y en su orden. Quitarlas todas → menú **idéntico al de fábrica**, bloque **vacío y sin
  ocupar un píxel**, y **sin fila** en la tabla. El servidor rechaza la 9ª.
- **(D) ARRASTRANDO DE VERDAD** (arrastre real del navegador, no una llamada a la API): un **área** se
  mueve de sitio en el rail y no se pierde ni una de las 42 entradas; una **entrada** se mueve dentro
  de su desplegable y su área sigue completa; soltar una entrada **sobre la línea** la pasa al bloque de
  ajustes **sin perderla** —y esa línea, en un área que no tiene ajustes, **aparece al arrastrar**—.
  Un orden guardado **incompleto** (una sola entrada listada) **no amputa**: lo listado va delante y el
  resto detrás, en orden de fábrica. El orden **sobrevive a cerrar sesión**, y **restablecer** devuelve
  áreas y entradas a fábrica, hace desaparecer el botón y **borra la fila**.
- Segundo usuario con MENOS permisos (9 de 42 entradas): **el buscador no enseña ni una puerta que no
  esté en su menú**; sus anclas son suyas; anclar lo que no ve → **403**.
- Móvil a 390 px: cajón, ancladas arriba, acordeón con su rótulo, ninguna entrada se sale, buscador
  usable, **0 errores de JS**.
- **Regresión en su número exacto, CERO rojos nuevos: 21/23.** Verde: `gate-nav-inicio-disa` 34/0,
  `gate-inicio-pantalla`, `gate-citas-pantalla`, `gate-agenda-sencilla` 11/0, `gate-agenda-calendario`,
  `gate-oficio-pantalla` 28/0, `gate-vigia-agenda` 41/0, `gate-vigia-pantalla`, `gate-espera-pantalla`,
  `gate-proyectos/tiempo/facturar-horas/rentabilidad/coste-horas/margen-pantalla`,
  `gate-reserva-publica-pantalla` 51/0, `gate-avisos-contador-vivo`, `gate-xss-escape` 29/0,
  `verify-xss-escape` 49/0, `gate-csp-estricta` 19/0.
- **Los rojos son PREVIOS/AJENOS, demostrado y con su CAUSA** (revertidos los ficheros a HEAD,
  reiniciado y reejecutado: salida IDÉNTICA; restaurado y verificado con `diff -q`):
  · `gate-avisos-badge` (4 fallos, 12 OK) — **CADUCADO**: busca `a.disa-fig-link` y `.disa-row`, que son
    del Inicio FIJO anterior al peldaño 6 (`7fda12a`). El dato sigue estando, ahora en el bloque «Avisos
    pendientes» de la rejilla.
  · `gate-avisos-pantalla` (3 fallos, 1 OK) — **dato de partida caducado**: apunta a la factura
    `F2026-0017`, que tras resembrar el tenant quedó **anulada**, así que no genera aviso de cobro ni
    tiene botón «Registrar cobro».
  · `gate-agenda-sencilla` y `gate-oficio-pantalla` — **DEPENDEN DE LA HORA DEL DÍA, y no se sabía.**
    (2 fallos / 9 OK y 2 fallos / 26 OK por la noche; **11/0 y 28/0 a la mañana siguiente**, con el
    código ya cerrado: el diagnóstico quedó confirmado.) Los dos pasaron VERDES dos veces esta misma sesión y se pusieron
    rojos por la tarde con el MISMO código (y siguen rojos con los ficheros revertidos a HEAD). Causa
    medida, no supuesta: sin horario configurado el día abre 8:00–21:00 (`DEFAULT_OPEN`) y el motor
    **descarta los huecos ya pasados** (`citas-engine.js:222`); la zona del negocio es Madrid, así que
    a las **20:40** quedaban **0 huecos hoy** para cualquier duración —a las 09:00 habrían sido 24—, y
    sus dos aserciones piden justamente que el motor **proponga un hueco de hoy**. **Anotado: son
    gates de ventana horaria**; correrlos de día, o fijarles la fecha de prueba a mañana.

**ANOTADO Y NO CONSTRUIDO:** el **orden por defecto del menú según el oficio del negocio** · la
**búsqueda de datos** en el buscador del topbar · el **candado de `contabilidad`** (AGUJERO 1).

**HALLAZGO SUELTO, DE OTRO MÓDULO (anotado, NO tocado aquí):** en un negocio **recién creado**,
`GET /api/disa/threads` responde **500** — `SqliteError: no such column: t.pinned`
(`modules/disa/index.js:2051`). La columna la añade un `ALTER TABLE` en `modules/disa/index.js:127`
que en un tenant nuevo **aún no ha corrido** cuando la pantalla ya pregunta. Salió a la luz porque
`gate-menu-navegacion` crea negocios de cero; no es de esta tarea y no se ha tocado nada de DISA.

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

### ✅ 7 — Servicios profesionales · **1er oficio** · **CERRADO (28 jul 2026)**
**Agenda** + **control de tiempo facturable** + **rentabilidad por proyecto**. Es la primera "cara por
oficio" (CANON §7: interfaces por profesión).

> **PELDAÑO CERRADO el 28 jul 2026 con la PIEZA 6 (puerta pública de reserva).** Las seis piezas
> entregadas y verificadas: **1** el proyecto · **2** registro de tiempo · **3** facturar horas ·
> **4** rentabilidad (contable + coste de las horas) · **5** sistema de citas (motor + agenda interna),
> más **Agenda sencilla** (capa de presentación) · **6** puerta pública de reserva. Un negocio de
> servicios puede hoy: publicar su página de reservas, recibir citas 24 h, atenderlas, cobrarlas por los
> motores de siempre y ver qué le renta. **Queda anotado y NO bloquea:** el **control horario (fichaje)**
> y la **agenda del CRM** de la lista de abajo no se construyeron — no estaban en ningún encargo, y el
> dueño decide si les da número propio o entran en otro peldaño.
> **⬅️ EL PUNTERO DE LA ESCALERA PASA AL PELDAÑO 8 (Salud / bienestar · 2º oficio).**
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
  COMPLETA (parte 1 + parte 2).**

- **PIEZA 5 — SISTEMA DE CITAS (motor + agenda interna) · ✅ ENTREGADA y verificada (27 jul 2026, commit `45dc9c7`).**
  El motor de la cita previa y su agenda interna. **UN solo motor para dos negocios**: cita previa
  (peluquería/estética/salud) y servicios por horas (piezas 1-4). NO es el **calendario FISCAL** (D5e,
  15-jul) — otra cosa, ni se toca ni se reutiliza su nombre.
  - **Servicio reservable = capa SOBRE el catálogo existente**, NO un segundo catálogo: se añade al
    producto de tipo `service` la geometría de la reserva en `service_config` (`duracion_min`, tiempo
    muerto interior `muerto_ini/dur_min` —la persona queda LIBRE ese rato, el tinte—, `margen_min`
    posterior), quién puede prestarlo (`service_providers`) y qué recurso exige (`service_resources`).
    **Precio e IVA SIGUEN viniendo del catálogo** (fuente única).
  - **Recursos** (`recursos`): silla, cabina, sala, box, equipo. Una cita puede exigir persona Y recurso.
  - **Horarios** (`horario_tramos` negocio/persona, descansos = hueco entre tramos; `horario_excepciones`
    con fecha: vacaciones/festivo/cierre/horario especial). **La excepción manda** sobre la regla semanal;
    persona sin horario propio hereda el del negocio.
  - **Huecos EN VIVO** (no en tabla): horario − citas − márgenes, devolviendo LIBRE el tiempo muerto
    interior de otra cita. Rejilla 15/30, antelación mínima, ventana máxima, corte del mismo día.
  - **La cita** (`citas` + `cita_servicios`, geometría CONGELADA al reservar): cliente de la ficha o
    **cliente suelto** (nombre + móvil), servicios encadenados, persona, recurso, fecha, hora, nota.
    Estados pedida→confirmada→atendida|no_show|anulada. Archivar-no-borrar. **Guarda de solape en
    SERVIDOR** (409 por persona o por recurso; el tiempo muerto interior es la única excepción, y solo
    para la persona: la silla no se libera). **Bloquear un rato** sin cita (`agenda_bloqueos`).
  - **Agenda** día/semana, por persona y por recurso, arrastrar para mover **revalidando en servidor**.
  - **Salida al dinero (1.8):** "Atendida" cobra **reutilizando los motores existentes** (TPV
    `emitTicketSvc` para cliente suelto / `createInvoice` para factura completa). **CERO camino de emisión
    nuevo, cero hash propio.** Si la cita cuelga de un proyecto, puede generar su entrada de tiempo
    reutilizando el registro de la pieza 2 (`createEntry`, no facturable si ya se cobró).
  - **Enlace de la cita (1.9):** cada cita lleva una LLAVE no adivinable (`randomBytes(32)`), ruta pública
    `/cita/<token>` (sin sesión, sin CSRF; el token ES la defensa; rate-limit propio 40/min; caduca pasada
    la cita). Solo abre SU cita: CONFIRMAR o AVISAR de que no puede ir. No lista ni adivina otra.
  - **Avisos (1.10-1.12):** confirmación y recordatorio, **todos pueden ir A MANO**. WhatsApp por enlace
    OFICIAL `wa.me` (coste cero, sin cuenta Meta; **PROHIBIDO** WhatsApp Web / librerías no oficiales),
    SMS por `sms:` nativo, y EMAIL —el único que además sale SOLO por el cron + plantillas Resend que YA
    existen (2 plantillas nuevas SISTEMA con `{{enlace}}` crítico). Ajustes: canal por defecto y modo
    (manual / auto_email). **Estado HONESTO**: "marcado como enviado" (con canal y hora), NUNCA
    "entregado"/"leído". **La cola de envíos** (`/admin/citas/cola`): citas de mañana pendientes de
    recordatorio + de hoy pendientes de confirmación, doce en doce clics.
  - **Dato listo para el canal automático (1.13):** móvil E.164 (`clients.movil_e164` + marca "sin móvil
    válido") y consentimiento RGPD con fecha. NO se construye capa de canales; solo el DATO.
  - **DISA solo lectura sobre la agenda (1.14):** añadida a `QUERY_TABLE_READ_PERMS` con `citas.read`
    (mismo patrón que pedidos) y contexto "qué hay hoy/mañana"; `citas` FUERA de WRITABLE_TABLES → no crea
    ni mueve citas.
  - **Permisos:** `citas.read`/`citas.edit`, `requirePerm` en TODAS las rutas (incluida la vista); el
    enlace va por llave, no por sesión. Área "Agenda" propia en el rail (agenda, cola, servicios
    reservables, recursos, horarios, ajustes).
  - **Cron automático:** `bamburu-recordatorios-cita` (timer systemd 09:00 Europe/Madrid) manda el
    recordatorio por email SOLO a los tenants con `cita_modo_recordatorio='auto_email'`; idempotente.
  - Migración aditiva e idempotente, sin DROP; **todas las tablas nuevas FUERA de WRITABLE_TABLES**. NO se
    tocó Verifactu, P&G, diario, proyectos/tiempo/facturar-horas/rentabilidad ni el constructor.
  - Ficheros: `models.js` (10 tablas + cols en clients/company_config + permisos citas), `codes.js`
    (prefijo CITA-), `citas-engine.js` (huecos/solape/horarios/estados, PURO), `citas-avisos.js`
    (móvil E.164, wa/sms/email, cola), `routes/citas.js` (API + vistas + rutas públicas), `schemas.js`,
    `email-templates.js` (2 plantillas), `routes/index.js`, `layout.js` (nav), `routes/users.js` (label),
    `disa/index.js` (lectura agenda), `activity-entities.js`, `scripts/bamburu-recordatorios-cita.mjs` +
    unit/timer systemd.
  - **Verificado:** `test-citas` 35/0 (huecos con horario+margen+tiempo muerto; solape por persona y
    recurso; excepción manda; antelación/ventana/corte; estados; zona Europe/Madrid), `test-enlace-cita`
    14/0 (la llave solo abre SU cita; no se lista ni adivina; caduca; rate-limit), `test-avisos-cita`
    20/0 (texto+enlace en los 3 canales; sin móvil cae a email; nunca "entregado"), `test-neto-cero-cita`
    8/0 (crear+cobrar+anular deja Ventas y P&G EXACTAMENTE igual), `gate-citas-pantalla` 24/0 (crear desde
    modal, mover con 409, agenda por persona y por recurso, cobro cuadrando, cola con botón WhatsApp que
    lleva el enlace, marcar="marcado", 403 sin permiso, 0 errores JS). **Regresión verde**: proyectos 20,
    tiempo 23, facturar-horas 31, rentabilidad 22, contabilidad-pyg 36, contabilidad 38, cobros 47,
    disa-clientes 30, disa-stock 22, gate-proyectos 18, gate-rentabilidad 15, gate-tiempo 18,
    gate-plantillas-email 41 (10 tipos/20 variantes), gate-xss 29, verify-actividad 32, verify-disa-query
    43. (gate-nav-inicio-disa: 30/32 — los 2 fallos son precondición de datos, el tenant reseeded no tiene
    propuestas de impago pendientes para encender el badge; no lo toca esta pieza.)
  - **La pieza 5 queda COMPLETA. El peldaño 7 SIGUE ABIERTO: siguiente pieza 6 — PUERTA PÚBLICA DE
    RESERVA (ficha abajo), a la espera de encargo.**

- **AGENDA SENCILLA — ajuste de presentación de la pieza 5, va ANTES de la PIEZA 6 · ✅ ENTREGADA y
  verificada (27 jul 2026, commit `4679d62`).** NO es "pieza 5b": es una capa de PRESENTACIÓN sobre el
  motor intacto. **Regla dura: no se eliminó ni una función** — solo cambió qué se ve de entrada y cómo se
  llama; lo que estorbaba se guardó tras un clic.
  - **Llamar a las cosas por su nombre (solo textos; NO se renombró tabla ni código):** «Recurso» →
    **PUESTO**, con el nombre configurable por el negocio en Ajustes (Sillas/Cabinas/Salas/…), aplicado en
    TODAS las pantallas y en el menú (nuevas columnas `company_config.cita_puesto_sing`/`_plural`). Los tres
    campos del servicio pasan a lenguaje normal: **Tiempo contigo** / **Tiempo de espera** (con la frase
    «Estos minutos aparecerán como hueco libre para atender a otra persona»; se pliega si va a 0) / **Margen
    después** — re-expresados sobre las MISMAS columnas (`duracion_min`/`muerto_ini`/`muerto_dur`/`margen`).
    Fuera «recurso», «token», «tiempo muerto» de pantalla.
  - **La pantalla del día con lo justo:** de entrada HOY, por persona, y **solo quien trabaja hoy** (quien
    libra no ocupa columna). La vista por puesto, la semana y los filtros van tras «Vistas y filtros» (un
    clic) y se **recuerda lo último**. La **Cola de envíos** sale de la agenda y tiene **contador en el
    menú** («Cola de envíos · N»). Cada cita en la rejilla enseña solo hora · cliente · servicio + color de
    estado, con **leyenda** siempre visible; el resto vive al abrir la cita. El **tramo de espera** se
    dibuja en otro tono dentro del mismo bloque («Aquí estás libre»).
  - **Crear en tres toques:** se pulsa el hueco vacío de la rejilla (de ahí salen persona y hora, no se
    re-preguntan) → panel con SOLO cliente (buscador que filtra; si no existe se usa ahí mismo con nombre y
    móvil) y servicio (duración/precio solos del catálogo, encadenables). El **puesto se autoasigna** (primer
    libre) si el servicio lo exige, y se dice cuál. Todo lo demás (puesto, nota, duración, aviso ya, otra
    persona/hora) va en **«Más opciones»**, plegado, pero **sigue existiendo TODO**. Si algo choca, el aviso
    **propone huecos cercanos** («Huecos cerca: 11:00, 11:30»), no un error seco.
  - **El motor NO se tocó** (huecos, solape en servidor, horarios, enlace por llave, avisos, cola, cobro,
    Verifactu, P&G). Todo lo nuevo (personas-que-trabajan, puesto-libre, sugerencia, huecos-cercanos, contador
    del menú) se calcula CON el motor, no cambiándolo. De paso se arregló un bug latente desde la pieza 5: la
    ruta `GET /:id` tragaba `GET /horario` (la pantalla de Horarios no cargaba); se acota `/:id` a numérico.
  - **Verificado:** `gate-agenda-sencilla` 11/0 (crear desde el hueco vacío con persona/hora heredadas;
    vista de entrada solo quien trabaja hoy + «Ver todo el equipo»; cliente nuevo sin salir del panel; tramo
    de espera distinto; choque propone huecos; 0 errores JS), `test-textos-citas` 24/0 (sin «recurso»/«token»/
    «tiempo muerto» en pantalla; nombre configurable del puesto en todas). Regresión de la pieza 5 y del resto
    VERDE: test-citas 39/0, test-enlace-cita 14/0, test-avisos-cita 20/0, test-neto-cero-cita 8/0,
    gate-citas-pantalla 25/0, proyectos 20, tiempo 23, facturar-horas 31, rentabilidad 22, coste-horas 28,
    contabilidad-pyg 36, contabilidad 38, plantillas 41, XSS 29. **Ninguna función desapareció.**

- **PIEZA 6 — PUERTA PÚBLICA DE RESERVA · ✅ ENTREGADA y verificada (28 jul 2026).** El cliente final
  ELIGE hueco y reserva SOLO, 24 h, por la **dirección propia del negocio** (no el enlace de una cita
  concreta). **Decisión del dueño confirmada: NO depende del constructor de páginas web** — la página de
  reserva la publica el sistema de citas (verificado jul 2026 contra Square, Fresha y Acuity).
  **CORRECCIÓN DE ESTA FICHA:** decía «Incluye señal / prepago (cancelación cobrada)». El encargo del
  28-jul lo deja **EXPRESAMENTE FUERA** (no hay pasarela de pago) y **prohíbe dejar ganchos**. Manda el
  encargo; la señal no entra y no hay nada dormido esperándola (se comprueba en test-neto-cero-reserva).

  - **LO QUE DESTAPÓ EL PASO 0 (auditoría de solo lectura, antes de escribir una línea):**
    1. **El «alta de cliente al vuelo» de la pieza 5 NO da de alta clientes.** Lo que la agenda llama
       «usar como cliente nuevo» escribe nombre y móvil DENTRO de la fila de `citas`
       (`cliente_suelto_nombre`/`_movil`); no crea fila en `clients`, no tiene email y **no deduplica por
       nada**. El encargo pedía «reutilizar esa alta y deduplicar por teléfono y email»: no existía eso que
       reutilizar. **Decisión del dueño (28 jul): la puerta pública NO crea fichas** (simétrica con la
       agenda), pero **sí busca antes**: si el móvil normalizado (E.164) o el email ya son de una ficha
       ACTIVA, la reserva se **ENLAZA** a ella (`cliente_id`); si no, nace suelta. Así «si ya existe, se
       enlaza, NO se duplica» se cumple entero sin sembrar fichas basura.
    2. **El enlace `/cita/<token>` de la pieza 5 NO identifica al negocio.** El token se busca en la BD que
       el `tenantMiddleware` YA resolvió (por subdominio en producción; por cookie en desarrollo). No sirve
       como dirección pública fija por negocio, y **no había ninguna dirección configurable**. Cambio
       mínimo aplicado: `/reservar/<handle>` bajo el subdominio del negocio, sin tocar la resolución de
       tenant ni `control.db`.
    3. **`citas.token_expira` se escribe y NUNCA se lee.** La caducidad real del enlace es `fecha < hoy`.
       Es código muerto de la pieza 5; se anota, no se toca (fuera de alcance).
    4. **La «cola de envíos» no es una cola:** es una vista calculada en vivo (`colaEnvios`). Para avisar al
       NEGOCIO el canal que existe es otro: el colector de fuentes de `avisos.js`.
  - **La dirección (A):** `https://<negocio>.bamburu.com/reservar/<handle>`. `handle` en
    `company_config.cita_pub_handle`, editable por el dueño y **generado del nombre del negocio** si lo deja
    vacío. El negocio lo sigue resolviendo el SUBDOMINIO; el handle se **comprueba** contra el del tenant y
    si no cuadra → 404. De paso tapa un agujero de desarrollo (un solo host, donde la cookie de sesión gana
    al subdominio). **Interruptor general `cita_pub_activa` APAGADO por defecto**: hasta que el dueño lo
    enciende, la dirección responde 404 — no «vacío», 404.
  - **El flujo (B), primero móvil y con el mismo idioma visual de la página pública de la pieza 5:**
    servicio → profesional («cualquiera disponible» o uno concreto) → día y hora → datos y confirmar.
    **Precio, IVA y duración salen del catálogo** (`products` + `service_config`), sin recalcular nada.
    **Varios servicios en una cita SÍ**, porque el motor ya los encadena. Al confirmar se **revalida en
    servidor** y, si el hueco se ocupó, **409 con huecos cercanos**, igual que dentro.
  - **Los huecos salen DEL MOTOR DE LA PIEZA 5** (`huecos()` de `citas-engine.js`), llamado con otros
    ARGUMENTOS de política (antelación 2 h, ventana 60 días), **nunca con otro cálculo**. La rejilla y el
    corte del mismo día se toman de los ajustes de dentro: son cómo trabaja el negocio, no escaparate.
    «Cualquiera disponible» es la unión de `huecos()` por persona pública elegible — usando el motor, no
    cambiándolo. **NO se filtra por puesto libre**, a propósito: dentro tampoco se filtra al listar, y si al
    confirmar no hay puesto, `createCitaSvc` responde 409 con alternativas.
  - **Los mandos del dueño (C)**, dentro del área de Agenda (`/admin/citas/publica`): qué servicios se
    reservan desde fuera (`service_config.publico`, **por servicio, defecto NO**), quién aparece y **con qué
    nombre** (`cita_pub_personas`, **por persona, defecto NO**), antelación mínima (**2 h**) y máxima
    (**60 días**), modo **automático** (defecto) o **«yo apruebo»** —donde la solicitud **RETIENE el hueco**
    y **caduca sola a las 24 h**—, ventana de cambio/anulación del cliente (**24 h**, configurable,
    desactivable) y **texto de política de cancelación**.
  - **El cliente (D):** alta al vuelo simétrica con la agenda (**no se crean fichas**) + **enlace** si el
    móvil normalizado o el email ya existen. **La pantalla NUNCA revela si un teléfono o un email ya está en
    la base**: el resultado de la búsqueda no sale del servidor. **Casilla obligatoria de consentimiento**
    con enlace a la política de privacidad; se archiva el **texto exacto aceptado con fecha y hora**
    (`cita_reserva_publica.consent_texto`/`consent_at`) y **la política tal como se mostró**, no la de hoy.
  - **Avisos (E) — cero mensajería nueva.** Al cliente: la plantilla `confirmacion_cita` de la pieza 5, con
    **su enlace por llave** (confirmar / no puedo ir) y la política repetida (hueco `{{politica}}`, opcional
    y no crítico: sin política, el correo sale idéntico al de la pieza 5). Al negocio: **una fuente nueva en
    el colector de `avisos.js`** (`reserva_publica`, permiso `citas.read`), y con eso aparece sola en la
    campana, en `/admin/avisos`, en Inicio y en el email diario. Si el email al cliente falla, **la reserva
    NO se cae**: queda hecha y el fallo se archiva como `email_fallo`.
  - **Seguridad (F):** las rutas sin sesión solo devuelven servicios públicos, personas públicas y huecos —
    nunca clientes, nunca otras citas, nunca nombres de terceros. **El nombre visible del profesional es el
    que pone el dueño**; sin nombre público se enseña «Profesional N», **jamás `admin_users.name`**. Freno
    **por IP** (90/min) **y por teléfono/email** (6/hora) + **campo trampa** oculto y fuera del recorrido del
    teclado. El **404 de la puerta es el mismo** para apagada, handle equivocado y servicio no público: no es
    un oráculo. **`/reservar` entra en las superficies de CSP ESTRICTA** (`script-src` con nonce, sin
    `unsafe-inline`), como `/registro`: un solo `<script>` con nonce y cero handlers de atributo.
  - **La pieza 5 NO se tocó donde el encargo lo prohíbe** (huecos, solapes, horarios). Lo que sí cambió es
    aditivo y condicional: `resolverCitaPorToken` se saca de una clausura a función exportada (mismo
    comportamiento, letra por letra) y `paginaCita` gana una rama que **solo se enciende si la cita nació
    fuera**. **Decisión del dueño: la ventana de cambio/anulación rige SOLO para las nacidas fuera** — el
    enlace de una cita creada en la agenda se comporta exactamente como antes (se prueba: sección 9 de
    `test-reserva-publica`).
  - **Migración aditiva e idempotente, sin DROP:** 10 columnas `cita_pub_*` en `company_config`,
    `service_config.publico`, y **dos tablas nuevas** (`cita_pub_personas`, `cita_reserva_publica`), ambas
    **FUERA de WRITABLE_TABLES**. **La tabla `citas` no gana ni una columna**: el origen público es la MERA
    EXISTENCIA de la fila en `cita_reserva_publica`.
  - **Cron:** `bamburu-caducar-reservas` (timer systemd **horario**, no diario: la retención la fija el
    dueño y puede ser de 2 h; un barrido diario dejaría el hueco retenido más de lo configurado).
    Idempotente.
  - Ficheros: `models.js` (migración), `schemas.js` (2 esquemas), **`reserva-publica-config.js`** (módulo
    HOJA: config, ventana, quién/qué se enseña, fuente de avisos — separado a propósito para no cerrar el
    círculo de imports `avisos → routes/citas → layout → avisos`), **`reserva-publica.js`** (servicios
    validados; escribe SIEMPRE por `createCitaSvc`/`moverCitaSvc`/`anularCitaSvc`), **`routes/reserva-publica.js`**
    (rutas públicas + enlace + mandos + la pantalla), `routes/citas.js` (rama aditiva), `citas-avisos.js`
    (`politica` opcional), `email-templates.js` (hueco `{{politica}}`), `avisos.js` (fuente),
    `layout.js` (nav), `routes/index.js` (montaje), `core/security-headers.js` (CSP estricta),
    `scripts/bamburu-caducar-reservas.mjs` + unit/timer systemd.
  - **Verificado:** `test-reserva-publica` **130/0** (puerta apagada por defecto · el 404 no es oráculo ·
    solo sale lo marcado · reserva completa · 409 con huecos cercanos · antelación mín/máx en servidor ·
    consentimiento y campo trampa · cliente enlazado sin duplicar y sin crear ficha · «yo apruebo» retiene y
    caduca · cambiar/anular dentro y fuera de ventana · la pieza 5 intacta · cualquiera-disponible · cero
    fuga · migración idempotente), **`test-coincidencia-huecos` 40/0** — **LA PRUEBA DE COINCIDENCIA**:
    barrido de **183/183 combinaciones día×servicio y 1993 huecos comparados**, idénticos AL MINUTO, con
    descansos, excepciones, tiempo de espera interior, márgenes, bloqueos, horario propio, rejilla de 15 y
    corte del mismo día; y con políticas distintas, la lista pública es SUBCONJUNTO de la interna, nunca algo
    distinto. **`test-neto-cero-reserva` 21/0** (reservar/cambiar/anular/aprobar/rechazar/caducar no mueven
    Ventas, P&G, facturas ni Verifactu; no hay gancho de pago en el código; y cuando el dueño SÍ cobra,
    cuadra y la anulación lo revierte). **`gate-reserva-publica-pantalla` 51/0** (móvil 390×844 y escritorio
    1400×900: 4 pasos, 0 errores JS/CSP, política visible ANTES de confirmar, cero fuga medida sobre el HTML
    Y sobre todo lo que viaja por la red, cita dentro de la agenda, enlace del cliente, permisos 403).
  - **Regresión VERDE**: test-citas 39/0, test-enlace-cita 14/0, test-avisos-cita 20/0, test-neto-cero-cita
    8/0, test-textos-citas 24/0, gate-citas-pantalla 25/0, gate-agenda-sencilla 11/0, gate-plantillas-email
    41/0, verify-xss-escape 49/0, gate-xss-escape 29/0, verify-disa-query-permisos 43/0,
    verify-avisos-permisos 16/0, gate-avisos-contador-vivo 17/0, verify-actividad-etiquetas 32/0,
    verify-constructor 82/0, proyectos 20/0, tiempo 23/0, facturar-horas 31/0, rentabilidad 22/0,
    coste-horas 28/0, contabilidad-pyg 36/0, contabilidad 38/0.
  - **BARRIDO COMPLETO de los 122 scripts `test-*`/`verify-*`: 21 en rojo, TODOS PREVIOS.** No se supone:
    se **revirtieron los 9 ficheros seguidos a HEAD, se reinició el servidor y se reejecutaron los 18 que
    fallan de verdad** (los otros 3 —`verify-dibujo`, `verify-vigia`, `verify-voz`— no fallan: exigen
    argumentos y el barrido los llamó sin ellos). **Fallan IGUAL, uno por uno, sin una línea de esta pieza:**
    `test-pago-voz-avisos`, `verify-albaranes-browser`, `verify-avisos-crm-riesgo`,
    `verify-inventory-fix-browser`, `verify-llm-migracion`, `verify-mostrador-browser`,
    `verify-over-stock-ui`, `verify-pedidos-browser`, `verify-pedidos-disa`, `verify-pieza-c-http`,
    `verify-plantillas-email`, `verify-propuestas-dormidos`, `verify-propuestas-fiscales`,
    `verify-quotes-browser`, `verify-suggest-legible`, `verify-sustitutiva-browser`,
    `verify-traslado-auditoria`, `verify-u3-errores`. Más los gates `gate-avisos-pantalla` (3),
    `gate-avisos-badge` (4), comprobados igual. La mayoría son **precondiciones de datos del tenant
    reseeded** (no existe el pedido/presupuesto/stock que el gate espera), el mismo patrón que el TABLERO ya
    anotó para `gate-nav-inicio-disa` en la pieza 5.
    **DOS son deuda con nombre, y conviene no perderlos:**
    · **`verify-plantillas-email` 3 fallos** — cuenta 8 tipos / 3 SISTEMA / 18 variantes; la **pieza 5** los
    dejó en **10 / 5 / 20** y no actualizó ese script. El guardián vigente es `gate-plantillas-email`
    (41/0 verde). No se toca aquí: es deuda de la pieza 5, y arreglarla es afirmar números de trabajo ajeno.
    · **`test-pago-voz-avisos` 1 fallo** — el asunto de fábrica del resumen dice **«1 avisos»** (plural mal
    con n=1) y el test espera «1 aviso». Es un bug de TEXTO real, previo, en `resumen_avisos`.
  - **DE PASO SE CERRÓ UN AGUJERO DEL MOTOR DE AVISOS que esta pieza destapó:** `resumenAvisos` solo recorre
    `TIPO_ORDEN`, así que una fuente registrada en `SOURCES` pero ausente de esa lista **existe y no se
    cuenta, EN SILENCIO**; y `avisoKey` caía al genérico (JSON de todo el `ref`), que incluye
    `horas_restantes` — la identidad del aviso habría cambiado **cada hora** y habría reaparecido como nuevo
    después de marcarlo visto. Añadidos `TIPO_ORDEN`, `TIPO_FRASE` y un caso propio en `avisoKey`
    (`rp:<cita_id>`), con su comentario de por qué, y las tres cosas quedan **probadas** en
    `test-reserva-publica` (secciones de la 7).
  - **CON ESTO EL PELDAÑO 7 QUEDA CERRADO** (piezas 1-6 + Agenda sencilla). Siguiente: **PELDAÑO 8**.

- **CONSTRUCTOR DE PÁGINAS WEB (⬜, sin turno asignado — pendiente de que el dueño lo ordene).** Antes solo
  vivía en `TAREAS.md` (histórico, Capa 2, backlog); se sube aquí para que no quede suelto. Su ÚNICA
  relación con las citas es **EMBEBER el botón de reserva** de la pieza 6 — **nunca requisito previo**.
  Verificado jul 2026 (Square/Fresha/Acuity): la página de reserva la publica el sistema de citas, no el
  constructor. *(Nota: el "agendado automático de citas (13 jun)" que citaba el encargo NO existe en
  TABLERO ni en el código — no había nada suelto que consolidar; "Citas / Agenda" era la pieza 5, ya
  entregada.)*

- **ENVÍO AUTOMÁTICO DESATENDIDO POR WHATSAPP / SMS (⬜, peldaño propio — a la espera de encargo).**
  · **NO es requisito de lanzamiento.** Con la vía manual de la pieza 5, un negocio opera entero sin él;
    es una MEJORA para quien tenga volumen o no quiera pulsar un botón por cita.
  · **WhatsApp SOLO por la plataforma OFICIAL de Meta.** PROHIBIDO WhatsApp Web y librerías no oficiales
    (las del QR): incumplen las condiciones y pueden costarle al cliente su número. No se reabre.
  · **Modelo de coste decidido por el DUEÑO:** Bamburu NO asume el coste. La cuenta es del negocio, que
    decide si contrata y paga; Bamburu pone el mensaje y el enlace.
  · Referencia jul 2026: ~0,0166 €/mensaje de aviso en España (tarifa Meta, revisable cada trimestre);
    desde el 1-oct-2026 Meta cobra también las respuestas dentro de la ventana de 24 h. SMS: 3-4× más caro.
  · Lo caro no es enviar: es que el **alta en Meta** (verificación de empresa, número dedicado, plantillas
    aprobadas) ocurra DENTRO de Bamburu sin que el autónomo se pelee con Meta.

- **DISA PROACTIVA SOBRE LA AGENDA (⬜, pendiente de que el dueño le dé número).** Huecos sin llenar,
  cliente que dejó de reservar. Hoy DISA solo LEE la agenda (pieza 1.14); esto sería el paso proactivo
  (avisar/proponer), apoyado en el vigía (peldaño 5).

### 🟡 8 — Salud / bienestar · **2º oficio**  ⬅️ **AQUÍ ES DONDE VAMOS** · **EN CURSO (pieza 1 entregada, 15 ago 2026)**
Agenda presencial. **Se apoya en el peldaño 7, que quedó cerrado el 28 jul 2026**: el motor de citas, la
agenda interna y la puerta pública de reserva ya existen y son de USO GENERAL, no de un oficio. Lo que
este peldaño añade es la cara propia del sector, no otro motor.

- **PIEZA 1 — PERFIL DE OFICIO EN LA AGENDA · ✅ ENTREGADA y verificada (15 ago 2026).** Al crear el
  negocio se ELIGE a qué se dedica, y la agenda habla su idioma desde el primer minuto sin configurar
  nada. **OJO AL ALCANCE:** el encargo no fue solo salud — son **SEIS oficios** (Peluquería y barbería ·
  Estética y belleza · Fisioterapia y salud · Taller mecánico · Asesoría y consultoría · Otro). Da la
  «cara propia del sector» que prometía esta ficha para el 2º oficio y, de paso, para los peldaños 9
  (belleza) y parte del 7. **El peldaño 8 SIGUE ABIERTO**: esto es la cara, no el oficio entero.
  - **EL OFICIO HACE EXACTAMENTE DOS COSAS, y está escrito así en el código:** (1) cambia palabras de
    pantalla; (2) precarga el catálogo de servicios. **NO toca el motor, NO enciende ni apaga funciones,
    NO quita nada.** Se demuestra: `test-oficio` sección 9 comprueba que no crea citas, ni puestos, ni
    horarios, que `citas` no gana una columna y que la puerta pública **sigue apagada**.
  - **LO QUE DESTAPÓ EL PASO 0 (auditoría de solo lectura, antes de escribir una línea):**
    1. **El vocabulario YA estaba partido en dos.** `cita_puesto_plural` se leía en `ajustesCitas()`
       (`routes/citas.js`) y OTRA VEZ, por su cuenta, en el parche del menú de `layout.js:465-475`. Con
       una palabra se notaba poco; con un diccionario por oficio, el menú habría dicho una cosa y la
       pantalla otra. **Se unificó ANTES de meter nada** (orden exigido por el dueño): ahora las dos
       lecturas salen de `vocabulario()`.
    2. **Ya existían DOS conceptos de sector, y ninguno lo lee el producto.** `settings.business_sector`
       (texto libre que escribe el LLM del alta, `tenant-provisioning.js:97`) — sus ÚNICOS consumidores
       en todo el repo eran dos scripts de prueba — y `disa_profile.sector`/`business_type`, que solo usa
       DISA en su prompt. **Decisión del dueño: NO se tocan, NO se migran, NO se leen para esto.** El
       oficio es un enum propio (`company_config.oficio`), elegido pulsando un botón.
    3. **La agenda preguntaba por la persona aunque el negocio tuviera una sola.** No había ni un
       `if` sobre el número de personas en `routes/citas.js` ni en `routes/reserva-publica.js`.
  - **CONTRADICCIÓN DEL ENCARGO, RESUELTA POR EL DUEÑO ANTES DE TOCAR NADA.** El encargo pedía que la
    pantalla de crear cita enseñara de entrada quién/qué/cuándo/con quién, y su prueba 2 exigía «3 o 4
    campos». Eso **contradecía la Agenda Sencilla** (27 jul), donde desde el hueco de la rejilla se piden
    DOS cosas y persona/hora **se heredan de la celda pulsada** — afirmado por `gate-agenda-sencilla`
    11/0. **Decisión del dueño (15 ago): se recorta SOLO el panel del botón «Nueva cita»; el panel del
    hueco NO se toca.** Prueba 2 corregida por él y cumplida al pie de la letra.
  - **Lo que se ve ahora:** desde **«Nueva cita»**, negocio de UNA persona → **TRES campos** (cliente ·
    servicio · día y hora); de VARIAS → **CUATRO** (+ «Con quién»). Con una sola persona el campo **no se
    pinta y la cita se le asigna sola** — el `<select>` sigue en el DOM, oculto y preseleccionado, para
    que `cGuardar`/`cRecalc`/`cSugerir` no necesiten ni un caso especial. Desde el **hueco**, siguen
    siendo **DOS**. Puesto, proyecto, nota y avisar quedan tras **«Más opciones»**, cerrado de entrada:
    **nada se eliminó**, solo dejó de estar delante.
  - **El catálogo NO está inventado.** Cada duración viene de lo que se publica hoy en España, anotada
    servicio a servicio en `oficios.js`: agendas públicas de **Fresha** (barberías de Madrid, peluquerías
    de Barcelona) y **Booksy** (estética/uñas de Barcelona), tarifas de clínica de fisioterapia, tiempos
    de taller y duraciones de cita de gestoría. **El tiempo de espera y el margen nacen a 0 a propósito**:
    las fuentes publican el TOTAL de la cita, no su reparto interno, y ese reparto sí sería inventárselo.
    Peluquería 8 · Estética 8 · Salud 4 · Taller 5 · Asesoría 4 · **Otro 0** (no se inventa a qué se dedica).
    **Salud nace EXENTA de IVA** (asistencia sanitaria de profesional titulado, art. 20.Uno.3º LIVA), no al 21%.
  - **Los que YA existen no se rompen, y se demuestra:** la columna nace en `'otro'`, cuyo puesto es
    `Puesto/Puestos` — **literalmente el default histórico** — y cuyo catálogo está vacío. Un tenant
    migrado sin pasar por el alta ve exactamente lo que veía ayer (`test-oficio` §3).
  - **Cambiar de oficio después** (Datos del negocio): **NUNCA borra ni pisa**. Cambiar el selector solo
    cambia palabras y **dice** qué falta; añadirlos es un **segundo botón**, a propósito. Un servicio
    sembrado y luego editado (o renombrado) se respeta y el de fábrica se añade al lado. Idempotente.
    Y el nombre de los puestos **solo sigue al oficio si nadie lo escribió a mano** (`puestoEsDeFabrica`).
  - **Módulo HOJA `modules/erp/oficios.js`**, por la misma razón que `reserva-publica-config.js`:
    `layout.js` (menú) y `routes/citas.js` (pantallas) necesitan las mismas palabras, y si el diccionario
    viviera en `routes/` se cerraría el círculo. `createProductSvc` entra como **argumento**, no como
    import. Los servicios nacen por el MISMO camino que «Nuevo servicio»: cero puerta nueva de creación.
  - **Alcance del vocabulario (decisión del dueño):** SOLO las pantallas de `/admin/citas` y su menú.
    **`email-templates.js`, `citas-avisos.js` y `reserva-publica.js` NO se tocan** — el cliente final
    nunca ve «paciente». Los mandos de `/admin/citas/publica` se dejan también con «Cliente», por ser la
    pantalla de la pieza 6. `gate-plantillas-email` y `test-reserva-publica` siguen verdes **sin tocarlos**.
  - **Migración aditiva:** UNA columna (`company_config.oficio`, `DEFAULT 'otro'`). Sin DROP, sin
    reescribir, sin tabla nueva. Verifactu, cadenas de hash, libro de stock y WRITABLE_TABLES, intactos.
  - Ficheros: **`oficios.js`** (nuevo, HOJA), `models.js` (1 columna), `routes/citas.js` (unificación +
    panel + diccionario), `layout.js` (el menú deja de consultar por su cuenta), `routes/settings.js`
    (mandos + 3 endpoints), `core/signup-schema.js`, `core/tenant-provisioning.js`, `modules/registro/index.js`.
  - **Verificado:** `test-oficio` **94/0** (los 6 oficios arrancan solos · «otro» = lo de siempre · una
    sola fuente de palabras · cambiar de oficio no borra ni pisa · el puesto a mano no se pisa · siembra
    idempotente · duraciones al minuto · el motor sin tocar), `test-oficio-alta` **52/0** (los 6 botones
    salen de la misma lista que el ERP · alta real con cada oficio · paso saltado/texto libre/inventado →
    «otro» · `business_sector` y `disa_profile.sector` intactos · mandos de Ajustes),
    `gate-oficio-pantalla` **28/0** (4 campos con varias · 3 con una y se asigna sola · cita creada de
    verdad con esos tres · nada desapareció · **el panel del hueco sigue pidiendo DOS** · pantalla y menú
    dicen lo mismo · móvil 390×844 sin desbordar · **0 errores JS**).
  - **Regresión de las piezas 5 y 6, VERDE y en su número exacto**: test-citas 39/0, test-enlace-cita
    14/0, test-avisos-cita 20/0, test-neto-cero-cita 8/0, test-textos-citas 24/0, **test-reserva-publica
    130/0**, **test-coincidencia-huecos 40/0** (los huecos de dentro y los de la página pública siguen
    coincidiendo AL MINUTO), test-neto-cero-reserva 21/0, gate-citas-pantalla 25/0, **gate-agenda-sencilla
    11/0**, gate-reserva-publica-pantalla 51/0, **gate-plantillas-email 41/0**. Y alrededor:
    verify-xss-escape 49/0, gate-xss-escape 29/0, test-registro-alta 26/0, verify-constructor 82/0,
    proyectos 20/0, tiempo 23/0, facturar-horas 31/0, rentabilidad 22/0, coste-horas 28/0,
    contabilidad-pyg 36/0, contabilidad 38/0, verify-avisos-permisos 16/0, verify-actividad-etiquetas
    32/0, verify-disa-query-permisos 43/0.
  - **UN ROJO QUE NO ES DE ESTA PIEZA, comprobado como manda el ritual:** `gate-registro-alta` da 11/3.
    Se revirtieron los 7 ficheros a HEAD, se reinició el servidor y se reejecutó: **falla IGUAL, 11/3,
    sin una línea de este trabajo.** Los 3 fallos son de la conversación con el LLM («No se alcanzó
    ready»), no del alta. Se anota, no se toca.
    **⚠️ ESTE ROJO ERA EL ALTA CAÍDA, Y NO SE VIO (ver la ficha de la INCIDENCIA, abajo).** Demostrar que
    un rojo no es tuyo NO es lo mismo que saber qué es. Ese paso faltó.

- **PIEZA 2 — LA AGENDA COMO UN CALENDARIO DE VERDAD · ✅ ENTREGADA y verificada (15 ago 2026).** Tres
  cosas que el dueño encontró rotas o inútiles al probarla.
  - **LO QUE DESTAPÓ EL PASO 0 — y desmintió la sospecha de partida.** Se creó un negocio de cero y se
    miró: la rejilla **NO sale vacía**. Pinta 1 columna y **26 huecos, los 26 pulsables** (el motor abre
    el día por defecto 8:00–21:00, `DEFAULT_OPEN`). El clic llevaba funcionando desde la pieza 5. Lo que
    NO existía era **la manera de descubrirlo**: `.agcell` solo llevaba `cursor:pointer` —que únicamente
    se ve si ya estás encima— y **no había ni una regla `:hover` en todo el repo**. El dueño no podía
    elegir hora porque **no sabía que podía**, no porque no hubiera dónde pulsar. Eso cambió el arreglo:
    no había que crear huecos, había que hacerlos visibles.
  - **HALLAZGO EXTRA, no pedido, arreglado:** la rejilla estaba **CLAVADA de 08:00 a 21:00** en el dibujo
    del cliente y **no derivaba del horario**. Un negocio que abre a las 7:00 tenía huecos reservables
    **desde fuera** (la puerta pública sí usa el motor) que **dentro no se veían**. Ahora el rango sale
    del servidor con el mismo motor (`rangoRejilla`, sobre `tramosAmbito`); sin horario configurado
    devuelve el 8–21 de siempre, así que lo que se veía antes se sigue viendo igual.
  - **(A) TRES VISTAS: Día · Semana · Mes**, y **fuera del cajón de filtros** — cambiar de día a semana no
    es filtrar, es lo primero que se busca. Botones a la vista + flechas ‹ › que avanzan en **la unidad
    que se está mirando** (día, semana o mes). **Mes NO es la rejilla por columnas**: es un calendario
    normal, lunes primero, y cada día dice **cuántas citas tiene y cuánto hueco queda**. Pulsar un día
    abre **ese** día. **No hay vista de año, a propósito.**
    - **De dónde sale «cuánto hueco queda»:** `huecos()` necesita una DURACIÓN (calcula dónde cabe un
      servicio concreto) y en un resumen mensual no hay servicio elegido; preguntarle con una duración
      inventada daría un número sin significado. Se usan las MISMAS piezas del motor un escalón más
      abajo —`tramosPersona` + `ocupacionPersona`, ya exportadas— y se restan. **No hay cálculo paralelo.**
  - **(B) EL HUECO SE VE PULSABLE:** fondo de acento, borde y la pista **«+ Nueva cita»** al pasar por
    encima; `tabindex` + `role=button` + Enter/Espacio, para que también se llegue con teclado. El flujo
    de la Agenda Sencilla (persona y hora heredadas del hueco) **no se tocó**: `gate-agenda-sencilla` 11/0.
  - **(C) AGENDA SIN HORARIO — SE CORRIGIÓ EL ENUNCIADO DEL ENCARGO.** Pedía decir «qué falta». Pero
    **no falta nada**: el negocio puede crear citas ya, y el día abierto por defecto es una decisión
    deliberada del motor. Un cartel de «te faltan los horarios» habría dicho que está bloqueado cuando no
    lo está, contradiciendo `DEFAULT_OPEN`. El aviso dice la verdad y **enseña a usarla**: «Tu agenda ya
    funciona… **pulsa cualquier hueco libre** y creas la cita ahí mismo», con el horario a un clic al lado.
    **No bloquea nada.**
  - **(D) «PROYECTO» SOLO EN LOS OFICIOS QUE LO USAN.** Nuevo `usa_proyectos` en `oficios.js`. **Se
    OCULTA, nunca se saca del DOM**: `editCitaSvc` escribe `project_id=?` con lo que llegue, así que un
    campo ausente **le borraría el proyecto a la cita al editarla**. Y **«otro» lo mantiene**: son los
    negocios que ya existían y hoy lo ven; a esos no se les quita nada de la pantalla por una migración.
    Se comprobó que el campo NO es decorativo: alimenta `invoices.project_id` al cobrar (rentabilidad) y
    el registro de tiempo al atender.
  - **Sin migración**: esta pieza no añade ni una columna. `citas` intacta; motor, puerta pública,
    Verifactu, hashes, stock y WRITABLE_TABLES, sin tocar.
  - **Verificado:** `gate-agenda-calendario` **25/0** — y la primera prueba es **la que manda**: *crea un
    negocio de cero y llega hasta tener una cita puesta*, sin sembrar nada a mano (negocio nuevo → aviso
    → hueco con su pista → cita a las 11:00 en la BD, con «Arreglo de barba» de su propio catálogo). Más
    las tres vistas, mes→día, flechas por unidad, Proyecto por oficio (peluquería no / asesoría sí),
    móvil 390×844 sin desbordar y **0 errores JS**.
  - **Regresión VERDE en su número exacto**: test-citas 39/0, test-enlace-cita 14/0, test-avisos-cita
    20/0, test-neto-cero-cita 8/0, test-textos-citas 24/0, **test-reserva-publica 130/0**,
    **test-coincidencia-huecos 40/0**, test-neto-cero-reserva 21/0, test-oficio 94/0, test-oficio-alta
    52/0, test-llm-texto-respuesta 13/0, gate-citas-pantalla 25/0, **gate-agenda-sencilla 11/0**,
    gate-reserva-publica-pantalla 51/0, gate-oficio-pantalla 28/0, **gate-registro-alta 34/0**.

- **INCIDENCIA · EL ALTA CAÍDA EN PRODUCCIÓN · ✅ RESUELTA (15 ago 2026, `bfd0a24`).** El usuario
  escribía «peluqería» en el asistente de bienvenida y DISA **no contestaba nunca**.
  - **Síntoma engañoso:** no había error, ni traza, ni 500. La ruta devolvía **HTTP 200 con la respuesta
    VACÍA**, el cliente pintaba una burbuja vacía y parecía que DISA «pensaba» sin fin. **Log limpio.**
  - **Causa:** el modelo empezó a devolver un bloque **`thinking` DELANTE** del texto. El código leía
    `apiData.content[0].text` → `undefined` → `|| ''` → respuesta vacía. **Cambio de FORMA en la
    respuesta de la API, sin un solo cambio en nuestro código.** No lo provocó el commit `369173f`
    (perfil de oficio): se comprobó revirtiendo a HEAD antes de tocar nada.
  - **El arreglo ya estaba escrito:** `core/llm.js` **ya exportaba `textFromResponse()`**, que filtra por
    `type === 'text'`. El alta nunca lo usó. Había **tres formas distintas** de sacar el texto conviviendo
    en el repo; ahora hay una. Corregidos `modules/registro/index.js`, `modules/disa/index.js` (dos
    sitios) y `scripts/verify-llm-migracion.mjs`.
  - **LA PRUEBA QUE FALTABA — `test-llm-texto-respuesta` 13/0.** No es que no hubiera pruebas:
    `gate-registro-alta` y `verify-llm-migracion` §2 **estaban en rojo y avisaban** desde el barrido de
    la pieza 6. Fallaron por otra cosa: **las dos necesitan el modelo de verdad**, así que son lentas,
    cuestan dinero y fallan por motivos ajenos — y un rojo así se tolera y se cataloga como «previo».
    La nueva es **determinista, offline y en milisegundos**: fabrica la respuesta de la API a mano
    (`fetchImpl`), reproduce la caída, y añade una **GUARDIA que barre `modules/`, `core/` y `scripts/`
    y se pone roja si algún fichero vuelve a leer `content[0].text`** (probada mordiendo: se reintrodujo
    el bug a propósito en los dos módulos y lo cazó). Ignora comentarios, para poder explicarse.
  - **Verificado:** `gate-registro-alta` **34/0** (era 11/3) — alta completa: conversación → resumen →
    negocio creado → login; `verify-llm-migracion` **6/0** (era rojo); `test-llm-texto-respuesta` 13/0;
    `test-registro-alta` 26/0, `verify-disa-query-permisos` 43/0, `test-oficio` 94/0, `test-oficio-alta`
    52/0, `gate-oficio-pantalla` 28/0.
  - **De los 21 rojos «previos» del barrido de la pieza 6, DOS eran esto.** Los otros siguen anotados.

- **PIEZA 3 — EL VIGÍA APRENDE DE AGENDA · ✅ ENTREGADA y verificada (17 ago 2026).** Cuatro detectores
  nuevos en el vigía del peldaño 5, **solo lectura**, texto por plantilla, **sin IA** y **sin una sola
  cifra propia**: cada número sale del motor de citas, el mismo que pinta la agenda y la puerta pública.
  **Ni una columna nueva, ni una escritura** (el gate lo demuestra con foto de tablas antes/después).
  - **EL PASO 0 TUMBÓ EL MÉTODO QUE PEDÍA EL ENCARGO, y era el corazón de la pieza.** Pedía sacar los
    huecos de `huecos()`, «el mismo motor que pinta la agenda». **No se puede**: `huecos()` responde a
    otra pregunta —*¿dónde cabe un servicio de X minutos para la persona Y?*— y devuelve minutos de
    inicio alineados a la rejilla. Necesita una duración (aquí no hay servicio elegido), **sus
    resultados se solapan** (un bloque libre de 3 h con rejilla de 30 min da 6 inicios, que no son 6
    horas) y **no coincidiría con la agenda**, que dibuja rango menos citas. Se usan las piezas un
    escalón más abajo —`tramosPersona` y `ocupacionPersona`, que son las que `huecos()` llama por
    dentro—, exactamente como ya hizo la vista de mes de la pieza 2 y por el mismo motivo escrito.
    **Sigue siendo el motor: no hay cálculo paralelo.** Decisión del dueño.
  - **(A) HUECO QUE SE VA A PERDER** — los próximos 3 días **abiertos** (desde mañana: el hueco de esta
    mañana ya se perdió) con ocupación **< 60 %**. Dice qué día, cuántas horas y **en qué tramos y de
    quién**. Grupo **ALTA**: es dinero de mañana y **caduca**.
  - **(B) CLIENTE FUERA DE SU RITMO** — ritmo propio = **mediana** de días entre visitas atendidas
    (días distintos: dos citas el mismo día son una visita, la misma lección que ya aprendió el
    detector de facturas). Con **menos de 3 visitas no se inventa ritmo**. Avisa a **×1,5**, y el texto
    dice el ritmo real y **qué servicio hizo la última vez**.
  - **(C) SE FUE SIN PRÓXIMA CITA** — atendido en los últimos 7 días y sin ninguna cita futura viva. Uno
    por cliente (agrupado en la consulta: no puede repetirse).
  - **(D) AUSENCIAS — SE CONSTRUYÓ porque el estado EXISTE.** `citas-engine.js` declara
    `ESTADOS = ['pedida','confirmada','atendida','no_show','anulada']` con su etiqueta «No se presentó»
    y su transición: **se lee, no se deduce**. Se mide por `citas.fecha` porque no hay sello
    `no_show_at` — y es el dato correcto de todas formas.
  - **EL SOLAPE, RESUELTO CEDIENDO JURISDICCIÓN.** El viejo «cliente que se duerme» mide por FACTURAS
    (×2, suelo de 30 días) y el nuevo por CITAS (×1,5, sin suelo): en un negocio que factura cada visita
    son la misma persona **con umbrales que ni coinciden** — el mismo cliente saldría dos veces diciendo
    cosas distintas. Ahora **todo cliente con ritmo aprendible por citas queda bajo el detector de
    citas, haya saltado o no**, y se le retira del de facturas. El que compra **sin pedir cita**
    (mostrador) no tiene historial de citas y **sigue vigilado por el viejo, intacto**.
  - **ORDEN POR PROXIMIDAD (`prioridad.js`, aditivo).** Los avisos de agenda **no llevan importe en
    euros** —un hueco libre no vale un número hasta que alguien lo llena, y estimarlo sería inventarse
    dinero—, así que ordenarlos por su `cifra` pondría arriba el día más vacío en vez del más cercano.
    Dentro de cada grupo: **primero los de importe** (por importe, como siempre), **después los de
    agenda por distancia a hoy**. Se mide en **valor absoluto**, que vale igual para lo que viene (un
    hueco de mañana) que para lo que pasó (una visita de hace tres días).
  - **SI EL NEGOCIO NO USA AGENDA, LOS CUATRO CALLAN**, y no es cortesía: **sin horario configurado el
    motor abre TODOS los días de 8:00 a 21:00** (`DEFAULT_OPEN`, decisión deliberada de la pieza 5), así
    que un negocio que jamás toca la agenda tendría 13 h libres por persona y día — el detector A sería
    una máquina de ruido perpetuo. Guarda doble: sin horario de negocio **Y** sin ninguna cita.
  - **SIN GRÁFICO, Y SE DICE POR QUÉ.** El constructor tiene cinco áreas (ventas, compras, clientes,
    inventario, contabilidad) y **ninguna sabe expresar citas**. Se declara la receta «sin gráfico» con
    ese motivo exacto, en vez de dejar que caiga en el mensaje genérico: el hueco queda **explicado**, no
    parece un olvido. **No se crea el área de agenda en este encargo** (queda anotado abajo).
  - **Permisos:** los cuatro exigen `citas.read`, el permiso de la pantalla dueña del dato. Quien no
    puede ver la agenda no los recibe **ni en la lista, ni en el texto, ni en el Inicio**, se le **dice**
    qué detectores no puede ver, y forzar por URL da **403**. Cero código de permisos nuevo: es el
    mecanismo que ya tenían los seis detectores del peldaño 5.
  - **Verificado:** `gate-vigia-agenda` **41/0**. La primera prueba es la que manda y es la del encargo:
    **negocio creado de cero → oficio peluquería → catálogo sembrado → citas → los avisos en /admin/vigia
    y asomando en el Inicio**, sin datos precargados. Y la que de verdad importa: **las horas libres del
    aviso son idénticas AL MINUTO a las de la agenda** —contrastadas contra `/api/erp/citas/mes`, que es
    OTRO camino de código llegando al mismo número—, más «meter una cita de 2 h resta exactamente 120
    min». Cliente cada 5 semanas con 4 → **no avisa**; a las 8 → **sí**; con 2 visitas → **nunca**.
    Ningún cliente en los dos detectores a la vez. Móvil 390×844 y **0 errores JS**.
  - **Regresión VERDE en su número exacto** (medida antes y después): test-vigia **37/0** (era 33/0: +4,
    uno por detector nuevo), gate-vigia-pantalla 13/0, test-citas 39/0, test-enlace-cita 14/0,
    test-avisos-cita 20/0, test-neto-cero-cita 8/0, test-textos-citas 24/0, test-reserva-publica 130/0,
    test-coincidencia-huecos 40/0, test-neto-cero-reserva 21/0, gate-citas-pantalla 25/0,
    gate-reserva-publica-pantalla 51/0, gate-agenda-sencilla 11/0, gate-agenda-calendario 37/0,
    test-oficio 94/0, test-oficio-alta 52/0, gate-oficio-pantalla 28/0.
  - **ANOTADO, no construido:** el **área de agenda en el constructor de analíticas** (sin ella estos
    avisos no pueden llevar gráfico). Y `citas` no guarda **quién** anula: `anulada_at` dice cuándo, no
    si fue el cliente o el negocio — hoy no hace falta para nada, pero el día que se quiera distinguir
    «me lo canceló el cliente» de «lo cancelé yo», ese dato **no existe**.

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
