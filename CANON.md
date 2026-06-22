# CANON.md — Bamburu

> Este es el único documento que manda. Si cualquier otro archivo (TABLERO.md,
> CLAUDE.md, etc.) dice algo distinto de lo que está aquí, gana este documento.
> Al empezar cualquier sesión (con Ibrahin o con Claude Code) se lee este archivo primero.
> Última actualización: 2026-06-14

---

## 0. Principio de cabecera (manda sobre todo lo demás)

Bamburu no es "un software para autónomos". Es software de gestión de clase mundial —con todo lo que tiene el mejor software del mundo— a un precio que un autónomo pueda costear. Un negocio pequeño no es un negocio simple. Si un autónomo no usa hoy ciertas funciones no es porque no las necesite, sino porque no puede pagar el software que las tiene. Bamburu rompe eso.

Regla que gobierna toda decisión de alcance: nunca se omite, recorta ni simplifica una función por el tamaño del cliente. Si algo no entra ahora, es por orden/momento de construcción, jamás por "el autónomo no lo necesita".

---

## 0-bis. El iPhone del nicho (principio rector del producto)

Bamburu se enciende y se usa en minutos, como un iPhone —no como un Android, que exige
aprender antes de servir. Cualquiera (un frutero, una peluquera, un fotógrafo, sin
conocimientos técnicos) debe poder usarlo desde el primer momento, sin manual y sin
formación. De aquí se derivan reglas innegociables:

- **Una sola versión.** No hay versión "fácil" y versión "pro". Hay una sola, que es la
  fácil con toda la potencia dentro. El autónomo más simple y la gestoría más exigente
  usan exactamente el mismo Bamburu.
- **Toda la potencia, escondida hasta que hace falta.** Ninguna función se quita ni se
  recorta por ser el cliente pequeño; se esconde. La complejidad está siempre disponible
  debajo y aparece sola, vía DISA, el día que el usuario la necesita —no antes.
- **Nadie ve lo que no es suyo.** Cada negocio ve solo lo que usa. El frutero nunca ve
  una rectificativa ni un embudo; el fotógrafo nunca ve un cobro de mostrador. DISA
  detecta la forma del negocio y monta la cara que le corresponde.
- **Si necesita manual, está mal hecho.** La facilidad es trabajo del fabricante, no del
  usuario. Cada vez que haya que explicarle algo al usuario, el fallo es de diseño y se
  rehace.
- **El onboarding lo hace DISA, no un formulario.** Al entrar por primera vez, DISA
  pregunta dos o tres cosas en lenguaje normal y deja el producto montado y listo para
  trabajar. Nada de pantallas vacías ni fichas de treinta campos.
- **La complejidad la absorbe el fabricante.** Esconder bien cuesta más que enseñar todo.
  Ese coste lo paga Bamburu para que el usuario no lo toque. Es el precio del iPhone, y
  es innegociable.

**Consecuencia directa en Ventas:** un solo motor de venta (mismo cliente, catálogo,
stock y factura) con varias caras —mostrador, agenda, tablero— que DISA enciende según
el tipo de negocio. Se cambia la cara, nunca las tripas.

---

## 1. Misión (la estrella polar)

Bamburu le hace fácil gestionar su empresa a cualquiera —autónomo, pequeña o mediana
empresa— con la IA como protagonista: le hablas a DISA en un par de líneas y ella lo
hace por ti.

La forma principal de usar Bamburu es conversando con DISA. Las pantallas y menús
existen como respaldo —para ver, revisar o ajustar lo que la IA hace— pero el usuario
no necesita pelearse con ellos. Bamburu nunca enseña un lienzo en blanco: DISA habla
primero y propone.

Esto no es un módulo ni una fase. Es la razón de existir de Bamburu. Si una función no
se siente fácil y conversacional, está mal diseñada aunque funcione.

---

## 2. Los 4 pilares y el ciclo del producto

Bamburu gira en torno al producto y al ciclo de negocio:
**comprar → almacenar → vender → entregar**. La factura no es una etapa del ciclo: es
el documento legal que acompaña a la venta.

El producto es la raíz. Cada producto tiene un **tipo**, y el tipo decide qué parte del
ciclo aplica:
- **Físico** (ej. recambios): ciclo completo — se compra, se almacena con stock, se
  vende y se entrega.
- **Servicio** (ej. fotografía): se vende y se factura; no lleva stock propio.
- **Digital**: se vende y se entrega; sin stock físico.

Vender servicios no impide comprar: el fotógrafo compra cámara, papel, material. Eso
entra en Compras y Stock como **material del negocio** (lo que usas para trabajar),
distinto del producto que revendes.

**Los 4 pilares (estado):**
- **CATÁLOGO** — ✅ CERRADO. Productos (tipo: físico / digital / servicio), Categorías.
- **CLIENTES** — ✅ CERRADO. Clientes, Grupos, CRM (+ cobros y voz de DISA sobre clientes).
- **INVENTARIO** — 🟡 EN CURSO. Compras, Stock, Proveedores, Devoluciones, Descuentos.
- **VENTAS** — pendiente. Pedidos → Albaranes / notas de entrega → Facturas.

No se añaden piezas salvo que se detecte que falta algo real. Lo que existe, se lleva a
su mejor versión.

---

## 3. Orden de construcción (fases)

Se construye un pilar cada vez, en este orden, porque Ventas necesita a los otros tres
ya hechos (vendes un producto, a un cliente, desde un almacén):

1. **Producto (Catálogo)** — la raíz. ✅ CERRADO (2026-06-03).
2. **Cliente** — a quién vendes. ✅ CERRADO (2026-06-08).
3. **Almacén (Inventario)** — qué tienes y de dónde sale. 🟡 EN CURSO (2026-06-08).
4. **Ventas** — pedido → albarán → factura; usa los tres anteriores. Pendiente.

**Primer paso — Producto, mínimo para darlo por listo:** ✅ COMPLETO (2026-06-03)
- Tipo de producto: físico / digital / servicio. ✅
- IVA por producto. ✅
- Un solo catálogo: unificar Productos + Servicios (eliminar la tabla suelta de
  servicios de A3). ✅
- Buscador y filtros usables: por nombre, código y categoría. ✅ (P4: búsqueda nombre/SKU + filtro categoría + paginación por URL)

**Fuera de este primer paso (más adelante):** variantes, galería de imágenes, SEO,
coste/margen, unidad (por hora/sesión), multi-almacén.

### Inventario (Pilar 3) — modelo de stock (Paso 1 HECHO 2026-06-08)

Se copia el modelo de los ERP grandes: **el stock NO se guarda y se pisa**; es la **SUMA de
un libro de movimientos** (`stock_movements`, append-only, delta con signo). `products.stock`
es solo una **caché derivada** (siempre = suma del libro; se mantiene tras cada movimiento)
para que el POS siga rápido. Un movimiento contabilizado es **inmutable**: nunca se edita ni
se borra; para corregir se crea otro que lo **revierte** — misma filosofía que el ciclo de vida
de la factura (original intacta, asiento nuevo enlazado). Solo los productos **físicos** llevan
stock/kardex (servicio y digital no). **Multi-almacén** preparado en datos (cada movimiento lleva
`warehouse_id`) pero la UI usa un almacén por defecto; transferencias y selección de almacén,
más adelante. Todo escritor de stock (POS, Compras, ajustes) pasa por el mismo libro: una sola
fuente de verdad.

**Regla viva:** este orden y estos alcances no son sagrados. Si al construir algo no
cuadra, se cambia, se quita o se mejora. La realidad del producto manda sobre el plan.

---

## 4. Arquitectura multi-país (gestión universal + enchufe fiscal por país)

**Capa de gestión (universal, desde el día uno).** Catálogo, clientes, inventario,
ventas, hablar con DISA, emitir el documento de venta. Igual para cualquier
hispanohablante. No toca ninguna autoridad fiscal. A nadie se le cierra la puerta.

**Capa de cumplimiento fiscal (un "enchufe" por país).** Convierte el documento de
venta en factura legal del país. Cada país es un enchufe independiente:
- **España (Verifactu) → lo hacemos nosotros, 100 %.** Mercado principal, control total
  donde más importa. Obligatorio jul-2027.
- **LATAM (México/SAT, Colombia/DIAN, Argentina/ARCA…) → vía proveedor externo
  certificado con API.** No se construye a mano; coste por factura que va dentro del
  precio del plan.

Se diseña como enchufes desde el principio: añadir un país = conectar un módulo, no
reescribir el producto.

### El modelo fiscal: IVA vs IRPF (crítico — no modelarlo mal)

Son dos cosas distintas y se modelan en sitios distintos:

- **IVA → depende del PRODUCTO y del PAÍS.** Cada país tiene sus **bandas** de IVA;
  España = General 21 % / Reducido 10 % / Superreducido 4 % / Exento. **El producto
  guarda su banda** (no un número tecleado), y el % se resuelve desde la tabla de
  bandas del país (`core/vat-bands.js`; hoy solo ES). Añadir un país = añadir su tabla
  de bandas, sin tocar el producto.

- **IRPF / retención → NO es del producto ni del servicio.** Depende de **QUIÉN
  factura** (régimen del negocio: profesional con retención 15 % — o 7 % los primeros
  años de nuevo autónomo —; empresarial no retiene) y de **A QUIÉN** (si el cliente es
  particular, no hay retención). Por eso el IRPF se decide en **Settings (datos del
  negocio)** + en la **factura según el cliente**, y se construye en **Ventas**, no en
  el producto ni antes.

- **Responsabilidad fiscal.** La responsabilidad final del tipo aplicado es del usuario.
  Bamburu **ayuda** (bandas legales, enlaces a la AEAT, DISA) pero **no garantiza** el
  tipo correcto en casos dudosos.

### Ciclo de vida de la factura (ES) — anular y rectificar (HECHO 2026-06-04)

Una factura emitida **nunca se edita ni se borra** (rompería la cadena de hash; es infracción).
Las dos únicas operaciones legales son **asientos nuevos enlazados** en la cadena; la original solo
cambia su `status` (campo fuera del hash):

- **Anular** (factura que nunca debió existir: error/duplicado/operación no realizada): asiento de
  anulación nuevo (`invoice_anulaciones`) hash-enlazado a la original; pide motivo; original → `anulada`.
- **Rectificativa** (operación real con datos/importes mal): es el **único** mecanismo de corrección en
  España — **no existen notas de crédito/débito** (eso es LATAM, vía proveedor externo). Factura nueva en
  **serie propia 'R'** con numeración y cadena propias, que referencia a la original (→ `rectificada`),
  con **tipo R1–R5** y **modalidad sustitución (S) / diferencias (I)**; admite **importe negativo (abono)**.

Pendiente aparte (Verifactu, Pilar 4): QR + leyenda VERI*FACTU y envío a la AEAT. El ciclo de vida local
(documentos + estados + enlace en la cadena de hash) ya está construido.

### Cobros / pendiente de pago (HECHO 2026-06-04, T4 Paso 1)

El estado de cobro de una factura **nunca se guarda**: se calcula siempre en vivo (`modules/erp/cobros.js`)
desde los cobros (`invoice_payments`, totales o parciales) y la fecha de vencimiento (`invoices.due_date`,
guardada al emitir = emisión + plazo del cliente). Estado = pendiente / cobrada en parte / cobrada / vencida
(+ días vencida y tramo 0–30/30–60/+60). **Qué cuenta como deuda del cliente:** anulada no; rectificada por
**sustitución** no (la cobra su rectificativa), por **diferencias** sí; abono (negativo) resta. El registro de
cobro tiene **un único punto de escritura** (`POST /api/erp/invoices/:id/payments`, guard `isCobrable`) y se
usa desde tres sitios (factura, sección Cobros, ficha de cliente) con un modal compartido. **El PDF/documento
de la factura no incluye nada de cobros** (es control interno, no documento legal). Pendiente (Paso 2): perfiles
de cobro, próxima acción y voz de DISA sobre cobros.

---

## 5. Diferenciación y disciplina de construcción

**La diferenciación.** Bamburu no gana por ser el primero ni por tener más funciones
—ya hay software de gestión de sobra. Gana por dos cosas, y solo si se ejecutan bien:
1. **IA proactiva, no reactiva.** DISA habla primero y propone: "este cliente te debe
   300 € hace 20 días, ¿reclamo?", "se acerca el trimestre, aparta X de IVA", "te queda
   poco stock de este recambio". Es un asesor, no un bot que espera órdenes.
2. **Ejecución impecable.** No queremos mil funciones a medias; queremos que las que hay
   sean las mejores. Ser "uno más" = perder.

**Regla de oro de construcción.** Los motores (producto, stock, ventas, facturación) se
terminan antes o a la vez que la capa de DISA que los acciona. DISA es tan fiable como
el motor que tiene debajo. Si DISA dice "te he facturado" y la factura sale ilegal, la
magia se rompe — y en facturación eso es una multa, no un bug. La fiabilidad del núcleo
sostiene el protagonismo de la IA.

**Corrección inmediata de lo construido.** Lo que YA está construido y funciona se corrige
en el momento, no se posterga — la deuda sobre lo hecho se acumula y degrada el producto.
PERO lo que aún no existe no es "corrección": es construcción, y respeta el orden de
pilares (Producto → Cliente → Inventario → Ventas). No se usa esta regla para adelantar
funciones de pilares futuros.

**Reglas de diseño permanentes:**
- Toda sección con lista (productos, clientes, facturas, pedidos, etc.) lleva filtro de
  búsqueda desde que se construye.
- Todo proceso que añade un producto a un documento (pedido, factura, albarán, compra)
  lleva buscador de producto que rellena la línea; nunca solo entrada manual.
- **Regla de integridad — sin duplicados.** Toda entidad con identidad única (cliente→NIF,
  proveedor→NIF/CIF, producto→SKU, categoría/grupo→nombre) debe impedir o avisar de duplicados en sus
  puntos de entrada: formulario, API y acciones de DISA. Las facturas ya lo cumplen vía
  numeración correlativa + hash encadenado. Cada pilar aplica esta regla a sus entidades
  cuando se construye.

---

## 6. Pendientes apuntados (para no olvidar)

- **Multi-almacén** — soportar varios almacenes por ubicación (ej. Madrid, Málaga) y por
  función (producto terminado vs. materias primas). Define de dónde sale lo que se vende
  y de dónde se consume el material de trabajo. **Preparado en datos** (Pilar 3 Paso 1: cada
  `stock_movement` lleva `warehouse_id` y hay un "Almacén principal" sembrado); falta la **UI**
  multi-almacén + **transferencias** (`type='transferencia'` ya definido, sin uso). Pieza de peso.
- **A quién vender primero** — la misión apunta a autónomos + pequeñas + medianas. Sigue
  siendo amplio; decidir por cuál arrancar a vender de verdad cuando toque estrategia
  comercial.
- **Módulos futuros registrados (10 jun 2026, decisión del dueño)** — solo registro, sin
  adelantar pilares: **DISA como producto** (proactividad, personalidad y superficie propia:
  el diferencial del §5 con nombre propio de módulo), **agendado automático de citas**
  (reservas para autónomos de servicios), **CRM comercial** (seguimiento sobre la ficha de
  cliente) y **control horario** (registro de jornada, normativa ES). Ventas completas y el
  sistema de diseño ya estaban previstos. Orden tentativo y detalle en TABLERO.md
  ("Roadmap futuro").
- **Módulos futuros registrados (15 jun 2026, decisión del dueño) — Plataforma / Capa 2, fuera del
  orden de pilares, NO iniciar hasta indicación:** **Telegram como canal de producto** (comunicación
  interna del equipo + operar DISA por Telegram desde el móvil; atención al cliente queda como pregunta
  abierta), **mapas con OpenStreetMap** (geolocalización y direcciones, sin Google Maps) y **suite
  ofimática ligera** (ver/editar hojas, texto y PDF dentro de Bamburu). Solo registro, sin adelantar
  pilares; detalle en TABLERO.md ("Roadmap futuro", entradas 11–13).

---

## 7. Nota: qué cambió respecto al CANON anterior (y por qué)

El CANON anterior definía Bamburu como software para el **autónomo de servicios, sin
stock, sin catálogo de productos**, con el e-commerce "congelado" en una Capa 2 y la
facturación como núcleo.

Construyendo se vio que eso era erróneo: **el producto es la raíz de la que parte todo**,
y el negocio real es el ciclo comprar → almacenar → vender → entregar. La factura no es
el núcleo, es el documento legal que acompaña a la venta. Por eso se reescribió:
- El producto físico (con stock) pasa a ser el centro, no algo "congelado".
- Los servicios son un **tipo de producto**, no un módulo aparte.
- La estructura se ordena en **4 pilares** (Catálogo, Ventas, Clientes, Inventario) en
  lugar del modelo de "capas e-commerce".
- Se mantiene intacto lo que seguía siendo cierto: el protagonismo de DISA, la
  diferenciación por IA proactiva + ejecución, y el modelo fiscal multi-país.

---

## 8. Principios de visión (decisiones de estrategia, registrados 2026-06-14)

> Registrados como principios de visión; no cambian la tarea actual (compras/inventario). El detalle de
> los módulos de visión vive en TABLERO.md (roadmap futuro).

**P1. Modelo adaptativo multinicho.** En el onboarding conversacional, DISA determina el tipo de negocio y
presenta una estructura a medida: cada negocio ve en primer plano solo lo suyo. El resto **no se oculta**:
queda accesible y activable a un clic. Las funciones fuera del perfil del negocio se activan **con recargo**.
- *Enfoque técnico recomendado:* componer el perfil por **capacidades** (¿vende producto?, ¿da cita previa?,
  ¿tiene empleados?, ¿cobra cuotas?) para que los negocios **mixtos** encajen.
- *Línea base vs recargo:* **PENDIENTE de afinar por Ibrahin.** Principio: el **núcleo de gestionar cualquier
  negocio y DISA van en la base**; el recargo es solo para módulos pesados opcionales.

**P2. Postura fiscal: aliado del gestor, no sustituto.** Bamburu deja los datos listos —libro registro
impecable, borradores de modelos, avisos de DISA sobre el trimestre— para que **el gestor presente**. Bamburu
**NO presenta impuestos ante Hacienda**. Se evita así la responsabilidad legal.

**P3. Fuente real de liderazgo.** Bamburu no gana por tener IA. Gana por tener **el negocio entero en un solo
dato**: funciones que el especialista no puede construir porque no tiene nuestros datos —la obra que se compara
sola con las compras reales, el food cost que se actualiza solo, la previsión de caja, la lista de espera que se
autorrellena, la cuota que se cobra y reclama sola—. DISA orquesta esas funciones; es **una palanca más, no la
única**.

### Contexto de mercado (autónomos España, 2025 — por tamaño de colectivo)
1. **Comercio** ~725.000 · 2. **Construcción/oficios** ~414.000 · 3. **Servicios profesionales** ~341.000 ·
4. **Hostelería** ~316.000 · 5. **Salud/bienestar/belleza** (~142.000 sanitarias + peluquería/estética).
Consecuencia: el **comercio es el nicho nº 1**, lo que refuerza el **TPV** como pieza de peso (ver roadmap en TABLERO.md).

**Especificación de funciones por nicho: ver [docs/ESTRATEGIA-NICHOS.md](docs/ESTRATEGIA-NICHOS.md).**
