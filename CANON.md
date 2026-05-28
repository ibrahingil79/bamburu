# CANON.md — Bamburu

> **Este es el único documento que manda.**
> Si cualquier otro archivo (TAREAS.md, DISA_VISION.md, MAPA_FUNCIONAL.md, PROYECTO.txt…)
> dice algo distinto de lo que está aquí, **gana este documento**.
> Última actualización: 2026-05-28

---

## 1. Misión (la estrella polar)

Bamburu le hace la vida fácil al autónomo: gestiona todo su negocio **hablándole**
a una IA **proactiva**.

Esto no es un módulo ni una fase. Es la razón de existir de Bamburu y guía cada
decisión de diseño, desde la pantalla más simple hasta la más compleja. Si una
función no se siente fácil y conversacional, está mal diseñada aunque funcione.

**Principio rector:** Bamburu nunca te enseña un lienzo en blanco. La proactividad
de DISA es lo que cumple esta promesa: si la IA habla primero y propone, el usuario
nunca se queda mirando el vacío sin saber qué hacer.

---

## 2. La diferenciación (leer antes de construir nada)

Bamburu **no es innovador por ser el primero** — no lo es. Ya existen herramientas
que facturan con IA (FactuChat, Deductia en España; Facturitas, FactuBot en LATAM).
Casi todas son bots *reactivos y delgados*: emiten la factura que les pides y poco más.

La diferenciación de Bamburu está en TRES cosas, y solo es real si se ejecutan bien:

1. **IA proactiva, no reactiva.** Los demás esperan órdenes. DISA habla primero:
   "María te debe 300 € hace 20 días, ¿reclamo?", "se acerca el trimestre, aparta X
   de IVA", "este mes facturaste 30 % menos". Es un asesor, no un bot.
2. **Profundidad de gestión, no solo emisión.** Los demás emiten facturas. Bamburu
   gestiona el ciclo: facturar + cobrar + gastos + panel como un todo conversacional.
3. **Verticalización futura.** La jugada ganadora a medio plazo: ser EL software de
   UN tipo de autónomo concreto (p. ej. fotógrafos), no "facturación para todos".
   No se decide ahora (ver sección 7).

**Regla de oro:** ganamos por EJECUCIÓN, como Salesforce o Amazon (que empezaron
estrechos y ejecutaron mejor), no por amplitud ni por novedad. Ser "uno más" = perder.

---

## 3. Usuario objetivo

El autónomo de servicios: fotógrafo, fontanero, consultora, diseñador,
fisioterapeuta. Factura un trabajo, lo cobra, registra lo que gasta y quiere saber
cómo va. **No tiene tienda online, ni catálogo de productos, ni inventario.**

Bamburu apunta al autónomo hispanohablante. Cualquiera —de España, Uruguay,
México o donde sea— puede registrarse y **gestionar su negocio** desde el día uno.
Lo que cambia por país es solo el sello fiscal legal de la factura (ver sección 6).
El primer país con cumplimiento fiscal completo es **España**.

---

## 4. La línea (qué entra y qué no)

**El criterio, una sola pregunta:**
*¿Esto ayuda al autónomo de servicios a gestionar su negocio?*

- **Sí →** entra en la Capa 1.
- **No →** es una capa posterior. No se niega, se ordena.

Cada vez que aparezca una idea nueva, se pasa por esta pregunta antes de tocarla.

---

## 5. El modelo de capas (identidad de Bamburu)

Bamburu nació como alternativa a Shopify/WooCommerce (e-commerce) y giró hacia
facturación + autónomos + IA. Para no quedar a medio camino entre dos productos,
se ordena así (decisión: "Camino 3"):

### Capa 1 — Bamburu Autónomo (AHORA: lo que se construye y se vende)
El núcleo, todo accionable hablando con DISA y con DISA avisando de forma proactiva:

1. **Facturar** — factura legal desde cero (sin pedido), con IVA + IRPF, PDF, email.
2. **Clientes**.
3. **Cobros** — saber qué te deben y el estado de cada cobro.
4. **Gastos** — lo que paga el autónomo (materiales, suministros, dietas).
5. **Panel** — cuánto llevas facturado, qué te deben.
6. **Catálogo mixto de servicios** — guarda lo que se repite (la "sesión", la "hora
   de consultoría": nombre + precio + IVA + IRPF) Y permite escribir líneas libres
   sueltas para lo irrepetible, sin guardarlas. No es el módulo de productos del
   e-commerce (eso es Capa 2).
7. **Configuración del autónomo (Settings)** — impresora, IVA/IRPF por defecto,
   logo, datos del negocio. No urgente (va después de gastos/cobros/panel), pero
   pieza del núcleo de Capa 1: el autónomo necesita poder ajustar sus defaults
   sin tocar BD.
8. **DISA proactiva** como forma principal de usar todo lo anterior. INNEGOCIABLE.

**Cómo se siente:** el autónomo se registra y DISA ya le habla y propone. Le dice
"factúrale 300 € a María por la sesión de ayer", DISA propone la factura estructurada,
él confirma con un toque, sale legal y le llega a María por email en PDF. Días después
DISA avisa sola del cobro pendiente. Sin un solo formulario intimidante.

### Capa 2 — Bamburu Comercio (DESPUÉS, cuando la Capa 1 funcione y tenga usuarios)
Se DESCONGELA el e-commerce que ya existe a medias en el código: productos,
inventario, stock, POS, pedidos, catálogo público, constructor web. Recupera el
propósito Shopify original, pero sobre una base sólida, no como deuda a medias.

### Capa 3 — Visión futura (CONGELADA)
DISA con 3 cerebros completos (Vigilante de plataforma, multi-agentes), Telegram,
panel de administración de tenants, marketplace, streams de ingresos completos.

> **Disciplina del modelo de capas:** lo de Capas 2 y 3 está CONGELADO Y ARCHIVADO
> —fuera del menú y de la vista, marcado como tal en el código—, NO "en pausa activa".
> No se toca hasta cerrar la capa anterior. Nada se borra; se ordena en el tiempo.

---

## 6. Arquitectura multi-país (dos sub-capas dentro de la gestión)

**Capa de gestión (universal, desde Capa 1).** Clientes, gastos, cobros, panel,
hablar con DISA, emitir documento de cobro. Igual para cualquier hispanohablante.
No toca ninguna autoridad fiscal. **A nadie se le cierra la puerta.**

**Capa de cumplimiento fiscal (un "enchufe" por país).** Convierte el documento de
cobro en factura legal del país. Cada país es un enchufe independiente:

- **España (Verifactu) → lo hacemos NOSOTROS, 100 %.** Mercado principal, ya existe
  el hash encadenado a medias, y Verifactu es el sistema más nuevo y menos dependiente
  de intermediarios. Control total donde más importa. Obligatorio jul-2027 (margen real).
- **LATAM (México/SAT, Colombia/DIAN, Argentina/ARCA…) → vía PROVEEDOR externo.**
  No se construye a mano. Hay proveedores ya certificados con API (algunos multipaís,
  pensados para SaaS que facturan por muchos usuarios). Coste por factura/suscripción
  que va dentro del precio del plan. Mucho más barato que construirlo y mantenerlo.

La capa fiscal se diseña como "enchufes" desde el principio: añadir un país = conectar
un módulo, no reescribir el producto.

---

## 7. Estrategia de nicho (verticalización)

**Decisión:** arrancar general-de-servicios (Capa 1 tal cual) y **dejar que el mercado
revele el nicho.** Desde el lanzamiento, observar de qué sector vienen los que más usan
y recomiendan Bamburu. Cuando los datos señalen un nicho (p. ej. fotógrafos), afinar el
producto hacia él (vocabulario, plantillas) y dominarlo.

- El motor de Capa 1 es el mismo para cualquier autónomo de servicios; verticalizar
  es cambiar plantillas/vocabulario, no reconstruir.
- Especializarse NO encierra: se crece por nichos adyacentes, cada uno un escalón
  (como Amazon de libros a todo).
- El error a evitar NO es arrancar general — es quedarse general para siempre por
  miedo a elegir.

---

## 8. Mercado y realidad competitiva

- **Tamaño:** ~3,4 M autónomos en España; ~2 M personas físicas; ~1,5 M de servicios
  (mercado direccionable).
- **Viento de cola:** Verifactu obliga a casi todos a cambiar de herramienta antes de
  jul-2027. Cientos de miles en movimiento. Mejor momento para entrar.
- **Competencia (real y financiada):** Holded (todo-en-uno, ~7,50-50 €/mes), Quipu
  (referencia autónomos, ~8,50-13 €/mes), Contasimple, Billin, FacturaDirecta,
  Declarando, STEL Order, Anfix, Sage. Con IA conversacional: FactuChat, Deductia.
- **Cifra objetivo para vivir de esto:** ~500-800 clientes de pago sostenidos
  (≈0,05 % del mercado). NO hay que ganarle a Holded; basta con que ~1 de cada 2.000
  autónomos de servicios elija Bamburu. Alcanzable SOLO con ejecución y foco.

---

## 9. Estado real del código (auditado 2026-05-28)

| Pieza | Estado | Detalle |
|---|---|---|
| Arquitectura multi-tenant | ✅ Funciona | Subdominio + BD SQLite aislada por tenant. BD central de routing (control.db). No tocar. |
| Autenticación | ✅ Funciona | bcrypt, 2FA TOTP, recuperación por email (Resend), onboarding conversacional. |
| Clientes | ✅ Funciona | CRUD completo, campos fiscales (fiscal_id, dirección…), grupos. |
| Numeración + hash | ✅ Funciona | Correlativo por serie/año (F2026-0001), hash SHA-256 encadenado. |
| **Crear factura sin pedido** | ✅ Funciona | `/admin/invoices/new` emite factura directa con cliente, fecha y líneas libres. Correlativo + hash encadenado. POS intacto. (A1 cerrado 2026-05-28) |
| **IRPF + múltiples IVA** | ✅ Funciona | IVA por línea (21/10/4/Exento) + IRPF global (0/7/15, solo ES). Desglose en la imprimible. POS intacto. (A2 cerrado 2026-05-28) |
| **PDF real** | ❌ Falta | Hoy solo HTML imprimible del navegador. |
| **Enviar factura por email** | ❌ Falta | Resend ya configurado; falta endpoint + acción. |
| **QR + leyenda VERI*FACTU** | ❌ Falta | El hash ya existe; faltan QR y leyenda. |
| **Cobros (qué me deben)** | ❌ Falta | No hay estado de cobro de facturas. |
| **Gastos** | ❌ Falta | No existe (las "compras a proveedores" son coste de mercancía, no gastos del autónomo). |
| **Settings del autónomo** | ⏳ Parcial | `/admin/settings` existe con empresa/IVA/logo, pero no expone IRPF por defecto ni impresora. Necesita un rediseño orientado al autónomo. No urgente. |
| **Catálogo de servicios** | ⏳ A decidir | Existe tabla de productos del e-commerce; decidir si el catálogo de servicios la reutiliza (filtrando tipo "servicio") o es tabla nueva. Decisión técnica para Claude Code. |
| **DISA proactiva sobre el core** | ⏳ Parcial | DISA existe (chat, threads, query_database, acciones con confirmación) pero opera sobre el ERP-tienda. Falta enfocarla en facturar/cobrar/gastos y darle la capa proactiva de avisos. |

**Regla de oro de construcción:** los motores (facturación, cobros, gastos) se terminan
**antes o a la vez** que la capa de DISA que los acciona. DISA es tan fiable como el motor
que hay debajo. Si DISA dice "te he facturado a María" y la factura sale ilegal, la magia
se rompe — y en facturación eso es una multa, no un bug. La fiabilidad del núcleo es lo
que sostiene el protagonismo de la IA.

---

## 10. Estado de los demás documentos

| Documento | Estado | Qué hacer con él |
|---|---|---|
| **CANON.md** (este) | ✅ Fuente de verdad | Mantener actualizado. Manda sobre todo. |
| TAREAS.md | ⚠️ Histórico | Roadmap viejo de 6 sprints. Útil como registro, NO como plan. |
| DISA_VISION.md | 🔮 Visión futura | Los 3 cerebros son Capa 3. Solo la parte proactiva sobre el core entra en Capa 1. |
| MAPA_FUNCIONAL.md | ⚠️ Desactualizado | Sección Facturación obsoleta (ver sección 9). Los módulos de tienda = Capa 2 congelada. |
| PROYECTO.txt | ❌ Obsoleto | Describe el viejo single-tenant. Ignorar. |
| BUSINESS_MODEL.md / STRATEGIC_PILLARS.md | 🚫 No existen | Referencias rotas en TAREAS.md. Borrar las menciones. |

---

## 11. Cómo se usa este documento

- Al empezar **cualquier** sesión (contigo o con Claude Code), se lee este archivo primero.
- Cualquier idea nueva pasa por **la línea** (sección 4) antes de tocarse.
- Cuando una pieza de Capa 1 se termina, se actualiza la tabla de la sección 9.
- Si algo de aquí cambia, se cambia **aquí primero**, no en otro documento.
