# CANON.md — Bamburu

> Este es el único documento que manda. Si cualquier otro archivo (TABLERO.md,
> CLAUDE.md, etc.) dice algo distinto de lo que está aquí, gana este documento.
> Al empezar cualquier sesión (con Ibrahin o con Claude Code) se lee este archivo primero.
> Última actualización: 2026-05-29

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

**Los 4 pilares:**
- **CATÁLOGO** — Productos (tipo: físico / digital / servicio), Categorías.
- **VENTAS** — Pedidos → Albaranes / notas de entrega → Facturas.
- **CLIENTES** — Clientes, Grupos, CRM.
- **INVENTARIO** — Compras, Stock, Proveedores, Devoluciones, Descuentos.

No se añaden piezas salvo que se detecte que falta algo real. Lo que existe, se lleva a
su mejor versión.

---

## 3. Orden de construcción (fases)

Se construye un pilar cada vez, en este orden, porque Ventas necesita a los otros tres
ya hechos (vendes un producto, a un cliente, desde un almacén):

1. **Producto (Catálogo)** — la raíz.
2. **Cliente** — a quién vendes.
3. **Almacén (Inventario)** — qué tienes y de dónde sale.
4. **Ventas** — pedido → albarán → factura; usa los tres anteriores.

**Primer paso — Producto, mínimo para darlo por listo:**
- Tipo de producto: físico / digital / servicio.
- IVA por producto.
- Un solo catálogo: unificar Productos + Servicios (eliminar la tabla suelta de
  servicios de A3).
- Buscador y filtros usables: por nombre, código y categoría.

**Fuera de este primer paso (más adelante):** variantes, galería de imágenes, SEO,
coste/margen, unidad (por hora/sesión), multi-almacén.

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

---

## 6. Pendientes apuntados (para no olvidar)

- **Multi-almacén** — soportar varios almacenes por ubicación (ej. Madrid, Málaga) y por
  función (producto terminado vs. materias primas). Define de dónde sale lo que se vende
  y de dónde se consume el material de trabajo. Es funcionalidad de peso: se aborda al
  construir Stock, no antes.
- **A quién vender primero** — la misión apunta a autónomos + pequeñas + medianas. Sigue
  siendo amplio; decidir por cuál arrancar a vender de verdad cuando toque estrategia
  comercial.

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
