export function docsHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Documentación — Bamburu</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0A0F1E;--bg2:#0D1229;--bg3:#111833;
  --teal:#0D9488;--teal-l:#14B8A6;--teal-d:#0F766E;
  --text:#F1F5F9;--text2:#CBD5E1;--text3:#94A3B8;--text4:#64748B;
  --border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.1);
  --nav-h:60px;--sb-w:260px;
}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);line-height:1.8;-webkit-font-smoothing:antialiased}

/* Nav */
.docs-nav{position:fixed;top:0;left:0;right:0;height:var(--nav-h);background:rgba(10,15,30,0.92);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.docs-nav-logo{font-size:18px;font-weight:800;color:#fff;text-decoration:none;letter-spacing:-0.02em}
.docs-nav-logo span{color:var(--teal-l)}
.docs-nav-logo small{font-size:11px;font-weight:500;color:var(--text4);margin-left:8px;letter-spacing:0}
.docs-nav-right{display:flex;align-items:center;gap:20px}
.docs-nav-right a{color:var(--text3);text-decoration:none;font-size:13px;font-weight:500;transition:color 0.2s}
.docs-nav-right a:hover{color:#fff}
.docs-nav-back{background:rgba(255,255,255,0.05);border:1px solid var(--border2);padding:7px 14px;border-radius:8px;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text3)!important}
.docs-nav-back:hover{border-color:rgba(255,255,255,0.2);color:#fff!important}
.menu-btn{display:none;background:none;border:1px solid var(--border2);border-radius:7px;padding:6px 10px;color:var(--text3);cursor:pointer;font-size:12px;font-family:inherit}

/* Sidebar */
.docs-sidebar{position:fixed;top:var(--nav-h);left:0;width:var(--sb-w);height:calc(100vh - var(--nav-h));overflow-y:auto;background:var(--bg2);border-right:1px solid var(--border);padding:20px 0;z-index:150;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.06) transparent}
.sb-group-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text4);padding:16px 20px 6px;margin-top:4px}
.sb-group-label:first-child{margin-top:0}
.sb-link{display:block;padding:7px 20px;font-size:13px;color:var(--text3);text-decoration:none;border-left:2px solid transparent;transition:all 0.15s;line-height:1.4}
.sb-link:hover{color:var(--text);background:rgba(255,255,255,0.03)}
.sb-link.active{color:var(--teal-l);background:rgba(13,148,136,0.08);border-left-color:var(--teal-l);font-weight:500}

/* Content */
.docs-content{margin-left:var(--sb-w);padding-top:var(--nav-h);min-height:100vh}
.docs-inner{max-width:760px;padding:48px 48px 80px;margin:0 auto}

/* Typography */
.docs-inner h1{font-size:32px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:12px;line-height:1.2}
.docs-inner h2{font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.02em;margin:48px 0 12px;padding-top:48px;border-top:1px solid var(--border)}
.docs-inner h2:first-of-type{border-top:none;margin-top:24px}
.docs-inner h3{font-size:16px;font-weight:600;color:#fff;margin:28px 0 8px}
.docs-inner p{color:var(--text2);font-size:15px;margin-bottom:16px}
.docs-inner ul,.docs-inner ol{color:var(--text2);font-size:15px;padding-left:20px;margin-bottom:16px}
.docs-inner li{margin-bottom:6px}
.docs-inner a{color:var(--teal-l);text-decoration:none}
.docs-inner a:hover{text-decoration:underline}
.docs-inner strong{color:#fff;font-weight:600}
.docs-inner .lead{font-size:17px;color:var(--text2);margin-bottom:24px;line-height:1.7}

/* Code inline */
code{background:rgba(13,148,136,0.1);color:var(--teal-l);border-radius:4px;padding:2px 6px;font-size:13px;font-family:'Courier New',monospace}

/* Tip box */
.tip{background:rgba(13,148,136,0.06);border-left:3px solid var(--teal);border-radius:0 8px 8px 0;padding:14px 18px;margin:20px 0;font-size:14px;color:var(--text2)}
.tip strong{color:var(--teal-l)}
.warn{background:rgba(245,158,11,0.06);border-left:3px solid #F59E0B;border-radius:0 8px 8px 0;padding:14px 18px;margin:20px 0;font-size:14px;color:var(--text2)}
.warn strong{color:#F59E0B}

/* Step list */
.steps{list-style:none;padding:0;margin:16px 0;counter-reset:steps}
.steps li{counter-increment:steps;padding:12px 16px 12px 48px;position:relative;font-size:15px;color:var(--text2);background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;margin-bottom:8px}
.steps li::before{content:counter(steps);position:absolute;left:14px;top:50%;transform:translateY(-50%);width:22px;height:22px;background:var(--teal);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;line-height:22px;text-align:center}

/* Table */
.docs-table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}
.docs-table th{text-align:left;padding:10px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text4);border-bottom:1px solid var(--border)}
.docs-table td{padding:10px 14px;color:var(--text2);border-bottom:1px solid rgba(255,255,255,0.03)}
.docs-table tr:hover td{background:rgba(255,255,255,0.02)}

/* FAQ item */
.faq-item{border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden}
.faq-q{padding:16px 20px;font-size:15px;font-weight:600;color:#fff;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.15s}
.faq-q:hover{background:rgba(255,255,255,0.03)}
.faq-a{padding:0 20px 16px;font-size:14px;color:var(--text2);line-height:1.7;display:none}
.faq-item.open .faq-a{display:block}
.faq-item.open .faq-q{background:rgba(13,148,136,0.05)}
.faq-chevron{transition:transform 0.2s;color:var(--text4);flex-shrink:0}
.faq-item.open .faq-chevron{transform:rotate(180deg)}

/* Badge */
.badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;vertical-align:middle}
.badge-soon{background:rgba(245,158,11,0.12);color:#F59E0B;border:1px solid rgba(245,158,11,0.2)}
.badge-new{background:rgba(13,148,136,0.12);color:var(--teal-l);border:1px solid rgba(13,148,136,0.2)}

/* Section anchor offset */
.docs-inner section{scroll-margin-top:calc(var(--nav-h) + 24px)}

/* Responsive */
@media(max-width:900px){
  :root{--sb-w:0px}
  .docs-sidebar{transform:translateX(-260px);width:260px;transition:transform 0.25s;box-shadow:4px 0 30px rgba(0,0,0,0.5)}
  .docs-sidebar.open{transform:translateX(0)}
  .docs-content{margin-left:0}
  .docs-inner{padding:32px 24px 60px}
  .menu-btn{display:block}
  .docs-inner h1{font-size:26px}
  .docs-inner h2{font-size:20px}
}
</style>
</head>
<body>

<nav class="docs-nav">
  <a href="/" class="docs-nav-logo">Bam<span>buru</span><small>Docs</small></a>
  <div class="docs-nav-right">
    <button class="menu-btn" onclick="document.querySelector('.docs-sidebar').classList.toggle('open')">&#9776; Menú</button>
    <a href="/" class="docs-nav-back">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      Volver a bamburu.com
    </a>
  </div>
</nav>

<aside class="docs-sidebar" id="sidebar">
  <div class="sb-group-label">Empezar</div>
  <a class="sb-link" href="#que-es">¿Qué es Bamburu?</a>
  <a class="sb-link" href="#registro">Registro y configuración</a>
  <a class="sb-link" href="#primer-producto">Primer producto</a>
  <a class="sb-link" href="#primera-venta">Primera venta</a>

  <div class="sb-group-label">DISA</div>
  <a class="sb-link" href="#disa-que">¿Qué puede hacer DISA?</a>
  <a class="sb-link" href="#disa-hablar">Cómo hablar con DISA</a>
  <a class="sb-link" href="#disa-acciones">Acciones que ejecuta</a>
  <a class="sb-link" href="#disa-limites">Límites y planes</a>

  <div class="sb-group-label">Catálogo</div>
  <a class="sb-link" href="#productos">Productos</a>
  <a class="sb-link" href="#categorias">Categorías y etiquetas</a>
  <a class="sb-link" href="#variantes">Variantes</a>

  <div class="sb-group-label">Ventas</div>
  <a class="sb-link" href="#pedidos">Pedidos</a>
  <a class="sb-link" href="#pos">Punto de venta</a>
  <a class="sb-link" href="#descuentos">Descuentos</a>
  <a class="sb-link" href="#devoluciones">Devoluciones</a>

  <div class="sb-group-label">Finanzas</div>
  <a class="sb-link" href="#facturas">Facturas y Verifactu</a>
  <a class="sb-link" href="#compras">Compras a proveedores</a>

  <div class="sb-group-label">Equipo</div>
  <a class="sb-link" href="#usuarios">Usuarios y roles</a>
  <a class="sb-link" href="#permisos">Permisos granulares</a>
  <a class="sb-link" href="#2fa">2FA</a>

  <div class="sb-group-label">Multi-país</div>
  <a class="sb-link" href="#espana">España</a>
  <a class="sb-link" href="#mexico">México</a>
  <a class="sb-link" href="#colombia">Colombia</a>

  <div class="sb-group-label">Ayuda</div>
  <a class="sb-link" href="#faq">Preguntas frecuentes</a>
</aside>

<main class="docs-content">
<div class="docs-inner">

  <!-- EMPEZAR -->
  <h1>Documentación de Bamburu</h1>
  <p class="lead">Todo lo que necesitas para gestionar tu negocio con Bamburu y DISA. Desde la configuración inicial hasta las funciones avanzadas.</p>

  <section id="que-es">
    <h2>¿Qué es Bamburu?</h2>
    <p>Bamburu es un ERP (sistema de gestión empresarial) diseñado para autónomos y pequeñas empresas hispanohablantes. Combina todas las herramientas que necesitas — productos, pedidos, clientes, inventario y facturación — con <strong>DISA</strong>, un asistente de inteligencia artificial que gestiona tu negocio en lenguaje natural.</p>
    <h3>¿Para quién es?</h3>
    <ul>
      <li>Autónomos que quieren profesionalizar su gestión sin complicarse</li>
      <li>Pequeñas tiendas físicas y online (1-20 personas)</li>
      <li>Negocios en España, México o Colombia que necesitan facturación local</li>
      <li>Cualquier negocio que quiere usar IA para gestionar operaciones</li>
    </ul>
    <h3>Qué incluye</h3>
    <ul>
      <li><strong>Catálogo</strong>: productos, categorías, etiquetas y variantes</li>
      <li><strong>Ventas</strong>: pedidos, punto de venta y devoluciones</li>
      <li><strong>Inventario</strong>: stock en tiempo real con alertas de mínimos</li>
      <li><strong>Clientes</strong>: base de datos con historial de compras</li>
      <li><strong>Facturación</strong>: facturas electrónicas con Verifactu para España</li>
      <li><strong>Compras</strong>: proveedores y pedidos de reposición</li>
      <li><strong>Equipo</strong>: usuarios con permisos granulares y 2FA</li>
      <li><strong>DISA</strong>: asistente IA que consulta y opera tu negocio</li>
      <li><strong>Tienda web</strong>: catálogo público con checkout integrado</li>
    </ul>
  </section>

  <section id="registro">
    <h2>Registro y configuración</h2>
    <p>La primera vez que entras a Bamburu, lo más importante es completar los datos de tu empresa para que las facturas salgan correctas.</p>
    <ol class="steps">
      <li>Ve a <strong>bamburu.com</strong> y haz clic en "Probar gratis". Introduce tu email y una contraseña segura.</li>
      <li>Accede al panel y ve a <strong>Configuración → Empresa</strong>. Rellena: nombre comercial, NIF/CIF (o RFC/NIT según tu país), dirección fiscal y teléfono.</li>
      <li>Selecciona tu <strong>país</strong>. Bamburu configurará automáticamente el IVA por defecto, el símbolo de moneda y el formato de factura.</li>
      <li>Si tienes equipo, ve a <strong>Usuarios → Nuevo usuario</strong> y asigna roles y permisos a cada persona.</li>
      <li>Opcional: activa el <strong>2FA</strong> en Configuración → Seguridad para proteger tu cuenta.</li>
    </ol>
    <div class="tip"><strong>Tip DISA</strong>: Puedes pedirle a DISA que te guíe: <em>"DISA, ayúdame a configurar los datos de mi empresa"</em>. Te hará las preguntas necesarias y actualizará la configuración.</div>
  </section>

  <section id="primer-producto">
    <h2>Primer producto</h2>
    <p>Crear tu primer producto tarda menos de un minuto.</p>
    <ol class="steps">
      <li>Ve a <strong>Catálogo → Productos</strong> y haz clic en "+ Nuevo producto".</li>
      <li>Introduce el <strong>nombre</strong> (aparecerá en facturas y tienda web), descripción y precio de venta.</li>
      <li>Añade el <strong>precio de coste</strong> si quieres ver el margen en los reportes.</li>
      <li>Selecciona o crea una <strong>categoría</strong> para organizar tu catálogo.</li>
      <li>Define el <strong>stock inicial</strong>. Bamburu lo irá descontando automáticamente con cada venta.</li>
      <li>Si necesitas vender el producto en diferentes tallas, colores u opciones, activa la pestaña <strong>Variantes</strong>.</li>
    </ol>
    <div class="tip"><strong>Tip DISA</strong>: <em>"Crea un producto: Vela Lavanda 200g, precio 18.50€, coste 6€, stock 50, categoría Aromaterapia"</em>. DISA lo crea en segundos.</div>
  </section>

  <section id="primera-venta">
    <h2>Primera venta</h2>
    <p>Hay dos formas de registrar una venta según si es presencial o a distancia.</p>
    <h3>Opción A — Pedido manual</h3>
    <ol class="steps">
      <li>Ve a <strong>Ventas → Pedidos → Nuevo pedido</strong>.</li>
      <li>Busca al cliente existente o crea uno nuevo directamente desde el formulario.</li>
      <li>Añade los productos al pedido. El stock se reserva automáticamente.</li>
      <li>Confirma el pedido. Su estado cambia a "Confirmado".</li>
      <li>Cuando esté listo, genera la factura con el botón <strong>"Facturar"</strong>. El PDF queda disponible para descargar.</li>
    </ol>
    <h3>Opción B — Punto de Venta</h3>
    <ol class="steps">
      <li>Ve a <strong>Ventas → POS</strong>.</li>
      <li>Toca o busca los productos que quieres vender.</li>
      <li>Aplica un descuento si lo hay.</li>
      <li>Confirma el pago (efectivo, tarjeta u otro método).</li>
      <li>El stock se actualiza y el pedido queda registrado automáticamente.</li>
    </ol>
    <div class="tip"><strong>Tip DISA</strong>: <em>"¿Cuánto vendí hoy?"</em> — DISA te da el resumen de ventas del día al instante.</div>
  </section>

  <!-- DISA -->
  <section id="disa-que">
    <h2>¿Qué puede hacer DISA?</h2>
    <p>DISA (Digital Intelligent Sales Assistant) es el asistente IA integrado en Bamburu. No es un chatbot genérico: tiene acceso directo a los datos de tu negocio y puede ejecutar acciones reales.</p>
    <h3>Consultar información</h3>
    <ul>
      <li>Resumen de ventas del día, semana o mes</li>
      <li>Stock actual de cualquier producto</li>
      <li>Estado de pedidos pendientes</li>
      <li>Top clientes y productos más vendidos</li>
      <li>Alertas de stock bajo, pedidos sin enviar, etc.</li>
      <li>Análisis comparativos entre periodos</li>
    </ul>
    <h3>Ejecutar acciones</h3>
    <ul>
      <li>Crear, editar y actualizar productos</li>
      <li>Ajustar stock de inventario</li>
      <li>Crear pedidos y registrar clientes</li>
      <li>Cambiar estados de pedidos</li>
      <li>Generar reportes personalizados</li>
    </ul>
    <h3>Dónde acceder</h3>
    <ul>
      <li><strong>Panel DISA</strong>: sección DISA en el menú lateral — conversaciones completas con historial</li>
      <li><strong>Widget flotante</strong>: botón D en la esquina inferior derecha, disponible en todas las páginas del panel</li>
      <li><strong>Dashboard</strong>: accesos rápidos en la pantalla de inicio</li>
    </ul>
  </section>

  <section id="disa-hablar">
    <h2>Cómo hablar con DISA</h2>
    <p>DISA entiende español natural. No necesitas comandos especiales ni sintaxis concreta. Habla como lo harías con un empleado de confianza.</p>
    <h3>Consultas de información</h3>
    <ul>
      <li><em>"¿Cuánto vendí esta semana?"</em></li>
      <li><em>"¿Qué productos tienen menos de 5 unidades en stock?"</em></li>
      <li><em>"Muéstrame los 3 clientes que más han comprado este mes"</em></li>
      <li><em>"¿Cuántos pedidos están pendientes de envío?"</em></li>
      <li><em>"¿Cuál es mi producto más rentable?"</em></li>
    </ul>
    <h3>Acciones directas</h3>
    <ul>
      <li><em>"Ajusta el stock de Vela Lavanda a 30 unidades"</em></li>
      <li><em>"Crea un producto: Aceite Bergamota 30ml, precio 14€, stock 20"</em></li>
      <li><em>"Cambia el estado del pedido 42 a enviado"</em></li>
      <li><em>"Crea un cliente: Ana López, ana@correo.com, teléfono 600123456"</em></li>
      <li><em>"Desactiva el producto Set Romántico hasta el mes que viene"</em></li>
    </ul>
    <h3>Consejos para mejores resultados</h3>
    <ul>
      <li><strong>Sé específico</strong> con nombres y cantidades. "Ajusta el stock a 30" funciona mejor que "actualiza el stock".</li>
      <li><strong>DISA pide confirmación</strong> antes de ejecutar cambios. Revisa siempre lo que va a hacer antes de confirmar.</li>
      <li><strong>Si no entiende</strong> tu pregunta, añade más contexto. Reformula con el nombre exacto del producto o cliente.</li>
      <li><strong>Usa el historial</strong>: las conversaciones se guardan en DISA → Conversaciones para poder revisarlas.</li>
    </ul>
  </section>

  <section id="disa-acciones">
    <h2>Acciones que ejecuta DISA</h2>
    <p>DISA puede ejecutar las siguientes operaciones directamente en tu base de datos.</p>
    <table class="docs-table">
      <thead><tr><th>Módulo</th><th>Acciones disponibles</th></tr></thead>
      <tbody>
        <tr><td><strong>Productos</strong></td><td>Crear, editar nombre/precio/stock/descripción, desactivar/activar</td></tr>
        <tr><td><strong>Inventario</strong></td><td>Ajustar stock, consultar mínimos, listar productos sin stock</td></tr>
        <tr><td><strong>Pedidos</strong></td><td>Crear borrador, cambiar estado, listar por fecha o estado</td></tr>
        <tr><td><strong>Clientes</strong></td><td>Crear, editar nombre/email/teléfono, consultar historial</td></tr>
        <tr><td><strong>Reportes</strong></td><td>Ventas por periodo, top productos, resumen del negocio, alertas</td></tr>
      </tbody>
    </table>
    <div class="warn"><strong>Importante</strong>: DISA siempre muestra lo que va a hacer antes de ejecutarlo. Si algo no está bien, puedes cancelar o corregir antes de confirmar la acción.</div>
  </section>

  <section id="disa-limites">
    <h2>Límites y planes</h2>
    <p>Durante el programa beta, DISA tiene un límite de <strong>50 mensajes por mes</strong> para mantener la calidad del servicio.</p>
    <ul>
      <li>Los mensajes se cuentan por negocio (tenant), no por usuario</li>
      <li>El contador se reinicia el primero de cada mes</li>
      <li>El número de mensajes restantes se muestra en la barra de progreso del panel DISA</li>
      <li>Los planes de pago con límites superiores estarán disponibles al salir de beta</li>
    </ul>
    <div class="tip"><strong>Consejo</strong>: Las consultas de información y las acciones cuentan igual. Aprovecha los mensajes para acciones de mayor valor (crear productos, ajustar stock en lote) en lugar de consultas simples que puedes ver directamente en el panel.</div>
  </section>

  <!-- CATÁLOGO -->
  <section id="productos">
    <h2>Productos</h2>
    <p>El catálogo es el corazón de Bamburu. Cada producto tiene todos los campos que necesitas para gestión interna y presentación en la tienda web.</p>
    <h3>Campos disponibles</h3>
    <ul>
      <li><strong>Nombre</strong>: aparece en facturas, pedidos y tienda web</li>
      <li><strong>Descripción</strong>: texto libre para la tienda web</li>
      <li><strong>Precio de venta</strong>: con o sin IVA según tu configuración</li>
      <li><strong>Precio de coste</strong>: para calcular márgenes en analytics</li>
      <li><strong>Stock</strong>: se descuenta automáticamente al confirmar pedidos</li>
      <li><strong>Stock mínimo</strong>: umbral para alertas de reposición</li>
      <li><strong>Categoría</strong>: clasificación principal del catálogo</li>
      <li><strong>Etiquetas</strong>: clasificación adicional múltiple</li>
      <li><strong>Variantes</strong>: versiones con precio y stock independientes</li>
      <li><strong>Imágenes</strong>: se muestran en tienda web y fichas de producto</li>
      <li><strong>Estado</strong>: activo / inactivo (inactivo no aparece en la tienda)</li>
    </ul>
    <h3>Buscar y filtrar</h3>
    <p>Desde la lista de productos puedes filtrar por categoría, etiqueta, estado o stock bajo. Usa la búsqueda por nombre para encontrar cualquier producto al instante.</p>
  </section>

  <section id="categorias">
    <h2>Categorías y etiquetas</h2>
    <h3>Categorías</h3>
    <p>Las categorías son la jerarquía principal del catálogo. Cada producto pertenece a una categoría. Se usan en la tienda web para la navegación del cliente y en los reportes para análisis por segmento de negocio.</p>
    <p>Puedes crear tantas categorías como necesites: <em>Velas, Aceites, Cestas, Complementos...</em></p>
    <h3>Etiquetas</h3>
    <p>Las etiquetas son clasificación libre y múltiple. Un producto puede tener varias etiquetas. Son útiles para:</p>
    <ul>
      <li>Campañas temporales: <code>san-valentin</code>, <code>navidad</code>, <code>verano</code></li>
      <li>Filtros especiales: <code>oferta</code>, <code>destacado</code>, <code>nuevo</code></li>
      <li>Clasificaciones internas: <code>proveedor-a</code>, <code>sin-gluten</code></li>
    </ul>
    <div class="tip"><strong>Ejemplo</strong>: Categoría = <em>Velas</em>, Etiquetas = <em>oferta, San Valentín, más vendido</em>. La categoría organiza, las etiquetas flexibilizan.</div>
  </section>

  <section id="variantes">
    <h2>Variantes</h2>
    <p>Las variantes permiten tener un mismo producto en múltiples versiones, cada una con su propio stock y precio.</p>
    <h3>Cuándo usar variantes</h3>
    <ul>
      <li>Ropa con tallas (S, M, L, XL) y colores</li>
      <li>Productos en diferentes formatos (100ml, 250ml, 500ml)</li>
      <li>Pack individual vs. pack de 3 o 6 unidades</li>
    </ul>
    <h3>Cómo configurarlas</h3>
    <ol class="steps">
      <li>Abre el producto y ve a la pestaña <strong>Variantes</strong>.</li>
      <li>Define los atributos: por ejemplo, <em>Talla</em> con valores S, M, L.</li>
      <li>Bamburu genera automáticamente todas las combinaciones.</li>
      <li>Ajusta el precio y stock de cada combinación según necesites.</li>
    </ol>
    <p>Al crear un pedido, el cliente (o tú) selecciona la variante concreta y el stock de esa variante específica se descuenta.</p>
  </section>

  <!-- VENTAS -->
  <section id="pedidos">
    <h2>Pedidos</h2>
    <p>Todos los pedidos pasan por un flujo de estados que refleja el ciclo de vida real de una venta.</p>
    <h3>Estados del pedido</h3>
    <table class="docs-table">
      <thead><tr><th>Estado</th><th>Significado</th></tr></thead>
      <tbody>
        <tr><td><strong>Borrador</strong></td><td>Pedido creado pero no confirmado. El stock no está reservado.</td></tr>
        <tr><td><strong>Confirmado</strong></td><td>El cliente ha aceptado. Stock reservado. Ya se puede facturar.</td></tr>
        <tr><td><strong>Preparando</strong></td><td>Tu equipo está preparando el envío o la entrega.</td></tr>
        <tr><td><strong>Enviado</strong></td><td>En camino al cliente. Puedes añadir número de seguimiento.</td></tr>
        <tr><td><strong>Entregado</strong></td><td>Finalizado con éxito.</td></tr>
        <tr><td><strong>Cancelado</strong></td><td>Anulado. El stock reservado se libera automáticamente.</td></tr>
        <tr><td><strong>Devuelto</strong></td><td>El cliente ha devuelto la mercancía. Stock reincorporado.</td></tr>
      </tbody>
    </table>
    <h3>Desde un pedido puedes</h3>
    <ul>
      <li>Generar la factura (solo desde estado Confirmado o superior)</li>
      <li>Cambiar el estado y añadir notas internas</li>
      <li>Ver el historial completo de cambios con fecha y usuario</li>
      <li>Crear una devolución parcial o total</li>
    </ul>
  </section>

  <section id="pos">
    <h2>Punto de venta</h2>
    <p>El POS está diseñado para ventas presenciales rápidas. No necesitas crear el pedido manualmente: el sistema lo hace todo.</p>
    <ul>
      <li>Busca productos por nombre o código de barras (próximamente)</li>
      <li>Toca para añadir unidades o introduce una cantidad</li>
      <li>Aplica descuentos porcentuales o en importe fijo</li>
      <li>Selecciona el método de pago: efectivo, tarjeta, transferencia u otro</li>
      <li>El stock se actualiza y el pedido queda registrado automáticamente</li>
    </ul>
    <div class="tip"><strong>Uso ideal</strong>: Mercados, ferias, tiendas físicas o cualquier venta donde quieres cobrar rápido sin rellenar formularios.</div>
  </section>

  <section id="descuentos">
    <h2>Descuentos</h2>
    <p>Bamburu soporta dos tipos de descuentos que se pueden combinar.</p>
    <h3>Códigos de descuento</h3>
    <p>El cliente introduce un código en el checkout de la tienda web. Puedes configurar:</p>
    <ul>
      <li>Descuento en porcentaje (ej: 15%) o importe fijo (ej: 5€)</li>
      <li>Fecha de inicio y fin de validez</li>
      <li>Número máximo de usos totales o por cliente</li>
      <li>Importe mínimo de compra para aplicarlo</li>
      <li>Productos o categorías específicas a las que aplica</li>
    </ul>
    <h3>Descuentos automáticos</h3>
    <p>Se aplican sin código, según reglas predefinidas. Útil para:</p>
    <ul>
      <li>2x1 o descuentos por volumen</li>
      <li>Descuentos en categorías durante una campaña</li>
      <li>Precio especial para grupos de clientes</li>
    </ul>
  </section>

  <section id="devoluciones">
    <h2>Devoluciones</h2>
    <p>Cuando un cliente devuelve un producto, gestiona la devolución directamente desde el pedido original.</p>
    <ol class="steps">
      <li>Abre el pedido que quieres devolver desde <strong>Ventas → Pedidos</strong>.</li>
      <li>Haz clic en <strong>"Crear devolución"</strong>.</li>
      <li>Selecciona los productos y las cantidades a devolver (puede ser parcial).</li>
      <li>El stock de los artículos devueltos se reincorpora automáticamente.</li>
      <li>Se genera un <strong>abono</strong> (factura rectificativa) que queda registrado en el historial de facturas.</li>
    </ol>
    <div class="tip"><strong>Tip</strong>: Las devoluciones parciales también son posibles. Si el cliente devuelve 1 de 3 artículos, solo ese stock vuelve al inventario.</div>
  </section>

  <!-- FINANZAS -->
  <section id="facturas">
    <h2>Facturas y Verifactu</h2>
    <p>Bamburu genera facturas electrónicas completas con todos los campos legales requeridos.</p>
    <h3>Qué incluye cada factura</h3>
    <ul>
      <li>Numeración correlativa automática (no editable para cumplir la normativa)</li>
      <li>Datos fiscales completos del emisor y del cliente</li>
      <li>Líneas de detalle con descripción, cantidad, precio unitario y total</li>
      <li>Base imponible, porcentaje de IVA e importe de IVA</li>
      <li>Total de la factura</li>
      <li>PDF descargable e imprimible</li>
    </ul>
    <h3>Verifactu (España)</h3>
    <p>Desde 2026, la normativa española exige que las facturas lleven una <strong>huella digital (hash SHA-256)</strong> encadenada. Bamburu lo implementa automáticamente:</p>
    <ul>
      <li>Cada factura incluye su propio hash calculado sobre sus datos</li>
      <li>El hash de la factura anterior se encadena, formando una cadena infalsificable</li>
      <li>No puedes modificar ni eliminar facturas emitidas (cumplimiento legal)</li>
      <li>El sistema puede enviar las facturas a la AEAT cuando la integración esté disponible</li>
    </ul>
    <h3>Cómo generar una factura</h3>
    <ol class="steps">
      <li>Abre un pedido en estado Confirmado o superior.</li>
      <li>Haz clic en <strong>"Generar factura"</strong>.</li>
      <li>La factura queda registrada con numeración automática.</li>
      <li>Descarga el PDF desde el botón de descarga.</li>
    </ol>
  </section>

  <section id="compras">
    <h2>Compras a proveedores</h2>
    <p>Gestiona el ciclo completo de compras: desde el proveedor hasta la recepción de mercancía y actualización de stock.</p>
    <ol class="steps">
      <li>Ve a <strong>Compras → Proveedores</strong> y crea tu proveedor con sus datos fiscales.</li>
      <li>Crea un <strong>pedido de compra</strong>: selecciona el proveedor, añade los productos y las cantidades que pides.</li>
      <li>Cuando recibes la mercancía, abre el pedido de compra y márcalo como <strong>"Recibido"</strong>. El stock sube automáticamente.</li>
      <li>Registra la <strong>factura del proveedor</strong> con el importe real para tener control de costes y márgenes.</li>
    </ol>
    <div class="tip"><strong>Tip DISA</strong>: <em>"¿Qué productos necesito reponer?"</em> — DISA te lista todos los artículos que están por debajo de su stock mínimo.</div>
  </section>

  <!-- EQUIPO -->
  <section id="usuarios">
    <h2>Usuarios y roles</h2>
    <p>Añade a tu equipo con el nivel de acceso exacto que necesita cada persona.</p>
    <h3>Roles predefinidos</h3>
    <table class="docs-table">
      <thead><tr><th>Rol</th><th>Acceso</th></tr></thead>
      <tbody>
        <tr><td><strong>Propietario</strong></td><td>Acceso total. Solo puede haber uno por cuenta. No puede ser eliminado.</td></tr>
        <tr><td><strong>Administrador</strong></td><td>Acceso total excepto gestión del propietario.</td></tr>
        <tr><td><strong>Empleado</strong></td><td>Acceso definido por permisos individuales. Flexible.</td></tr>
        <tr><td><strong>Solo lectura</strong></td><td>Puede ver todo lo que se le permita, nunca modificar.</td></tr>
      </tbody>
    </table>
    <h3>Añadir un usuario</h3>
    <ol class="steps">
      <li>Ve a <strong>Equipo → Usuarios</strong>.</li>
      <li>Haz clic en <strong>"Nuevo usuario"</strong>.</li>
      <li>Introduce nombre, email y contraseña temporal.</li>
      <li>Selecciona el rol. Si es Empleado, asigna permisos específicos.</li>
      <li>El usuario puede (y debería) cambiar la contraseña en su primer acceso.</li>
    </ol>
  </section>

  <section id="permisos">
    <h2>Permisos granulares</h2>
    <p>Para usuarios con rol Empleado, puedes definir exactamente qué módulos y acciones puede realizar cada persona.</p>
    <h3>Estructura de permisos</h3>
    <p>Cada permiso sigue el formato <code>modulo.accion</code>:</p>
    <table class="docs-table">
      <thead><tr><th>Módulo</th><th>Acciones posibles</th></tr></thead>
      <tbody>
        <tr><td><code>products</code></td><td>read, create, edit, delete</td></tr>
        <tr><td><code>orders</code></td><td>read, create, edit, delete</td></tr>
        <tr><td><code>clients</code></td><td>read, create, edit, delete</td></tr>
        <tr><td><code>invoices</code></td><td>read, create</td></tr>
        <tr><td><code>inventory</code></td><td>read, edit</td></tr>
        <tr><td><code>suppliers</code></td><td>read, create, edit, delete</td></tr>
        <tr><td><code>purchases</code></td><td>read, create, edit, delete</td></tr>
        <tr><td><code>discounts</code></td><td>read, create, edit, delete</td></tr>
        <tr><td><code>analytics</code></td><td>read</td></tr>
        <tr><td><code>activity</code></td><td>read</td></tr>
        <tr><td><code>admin</code></td><td>manage_users, settings</td></tr>
      </tbody>
    </table>
    <h3>Ejemplo práctico</h3>
    <p>Para un vendedor que solo gestiona pedidos y clientes pero no puede tocar productos ni configuración:</p>
    <ul>
      <li><code>orders.read</code>, <code>orders.create</code>, <code>orders.edit</code></li>
      <li><code>clients.read</code>, <code>clients.create</code></li>
    </ul>
    <p>El menú lateral se ajusta automáticamente: solo verá las secciones para las que tiene permiso.</p>
    <div class="tip"><strong>Tip</strong>: Si no asignas ningún permiso a un Empleado, no podrá acceder a ninguna sección (acceso denegado con modal informativo).</div>
  </section>

  <section id="2fa">
    <h2>2FA — Autenticación de dos factores</h2>
    <p>El 2FA añade una capa extra de seguridad. Aunque alguien consiga tu contraseña, no podrá entrar sin el código temporal.</p>
    <h3>Cómo activarlo</h3>
    <ol class="steps">
      <li>Ve a <strong>Configuración → Seguridad</strong>.</li>
      <li>Haz clic en <strong>"Activar 2FA"</strong>.</li>
      <li>Instala una app de autenticación: Google Authenticator, Authy o similar.</li>
      <li>Escanea el código QR que aparece en pantalla con la app.</li>
      <li>Introduce el código de 6 dígitos para confirmar la activación.</li>
    </ol>
    <p>Desde ese momento, cada vez que inicies sesión necesitarás la contraseña más el código temporal de 6 dígitos.</p>
    <h3>2FA para el equipo</h3>
    <p>Los administradores pueden hacer el 2FA <strong>obligatorio</strong> para todos los usuarios desde Configuración → Seguridad → "Exigir 2FA a todos los usuarios". Los usuarios que no lo tengan activado serán redirigidos a la pantalla de configuración al entrar.</p>
    <div class="warn"><strong>Importante</strong>: Guarda los códigos de recuperación que te da el sistema al activar el 2FA. Si pierdes el acceso a tu app de autenticación, son la única forma de recuperar la cuenta.</div>
  </section>

  <!-- MULTI-PAÍS -->
  <section id="espana">
    <h2>España</h2>
    <p>Bamburu está completamente adaptado a la normativa española.</p>
    <table class="docs-table">
      <thead><tr><th>Parámetro</th><th>Valor</th></tr></thead>
      <tbody>
        <tr><td>Moneda</td><td>EUR (€)</td></tr>
        <tr><td>IVA general</td><td>21%</td></tr>
        <tr><td>IVA reducido</td><td>10%</td></tr>
        <tr><td>IVA superreducido</td><td>4%</td></tr>
        <tr><td>Identificación fiscal</td><td>NIF (personas físicas), CIF/NIF (empresas)</td></tr>
        <tr><td>Facturación</td><td>Verifactu (hash SHA-256 encadenado, obligatorio desde 2026)</td></tr>
        <tr><td>Formato de fecha</td><td>DD/MM/AAAA</td></tr>
      </tbody>
    </table>
    <p>El sistema configura automáticamente todos estos parámetros al seleccionar España como país de la empresa.</p>
  </section>

  <section id="mexico">
    <h2>México</h2>
    <p>Bamburu soporta la fiscalidad mexicana con los formatos y requerimientos locales.</p>
    <table class="docs-table">
      <thead><tr><th>Parámetro</th><th>Valor</th></tr></thead>
      <tbody>
        <tr><td>Moneda</td><td>MXN ($)</td></tr>
        <tr><td>IVA general</td><td>16%</td></tr>
        <tr><td>Tasa 0%</td><td>Alimentos, medicamentos y otros</td></tr>
        <tr><td>Identificación fiscal</td><td>RFC (Registro Federal de Contribuyentes)</td></tr>
        <tr><td>Facturación electrónica</td><td>CFDI <span class="badge badge-soon">Próximamente</span></td></tr>
        <tr><td>Formato de fecha</td><td>DD/MM/AAAA</td></tr>
      </tbody>
    </table>
    <p>El régimen fiscal se puede configurar en los datos de empresa para que aparezca correctamente en las facturas.</p>
  </section>

  <section id="colombia">
    <h2>Colombia</h2>
    <p>Soporte para la normativa colombiana con integración DIAN en desarrollo.</p>
    <table class="docs-table">
      <thead><tr><th>Parámetro</th><th>Valor</th></tr></thead>
      <tbody>
        <tr><td>Moneda</td><td>COP ($)</td></tr>
        <tr><td>IVA general</td><td>19%</td></tr>
        <tr><td>Tasa 0%</td><td>Canasta básica y servicios exentos</td></tr>
        <tr><td>Identificación fiscal</td><td>NIT (Número de Identificación Tributaria)</td></tr>
        <tr><td>Facturación electrónica</td><td>DIAN <span class="badge badge-soon">Próximamente</span></td></tr>
        <tr><td>Retenciones</td><td>En desarrollo</td></tr>
      </tbody>
    </table>
  </section>

  <!-- FAQ -->
  <section id="faq">
    <h2>Preguntas frecuentes</h2>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿Puedo importar mis productos desde Excel o CSV? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">La importación masiva desde CSV está en el roadmap. Por ahora, la forma más rápida es pedirle a DISA que cree productos en lote: <em>"Crea estos 5 productos: [lista]"</em>. DISA los crea uno por uno confirmando cada uno.</div>
    </div>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿Puedo tener varias tiendas o negocios? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">Cada cuenta Bamburu es un negocio independiente. Si gestionas varios negocios, necesitas una cuenta distinta para cada uno. La gestión multi-negocio desde una sola cuenta está en el roadmap para 2026.</div>
    </div>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿Qué pasa con mis datos si cancelo la cuenta? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">Puedes exportar toda tu información en cualquier momento desde Configuración → Exportar datos. Antes de cancelar, te recomendamos hacer una exportación completa. Los datos se eliminan de nuestros servidores 30 días después de la cancelación.</div>
    </div>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿DISA puede cometer errores? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">Sí. DISA usa inteligencia artificial y puede malinterpretar instrucciones ambiguas o datos con nombres similares. Por eso siempre muestra lo que va a hacer antes de ejecutarlo. Revisa siempre la acción propuesta antes de confirmar, especialmente en operaciones de eliminación o cambios masivos de precio.</div>
    </div>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿Es seguro? ¿Dónde están mis datos? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">Todos los datos se almacenan en servidores en la UE. Las contraseñas se guardan con bcrypt (hashing seguro, nunca en texto plano). Todo el tráfico va cifrado por HTTPS. El 2FA está disponible para todos los usuarios. Cada negocio tiene su base de datos aislada (arquitectura multitenant).</div>
    </div>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿Puedo conectar Shopify, WooCommerce o Amazon? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">Las integraciones con plataformas externas están en el roadmap para la segunda mitad de 2026. Si tienes una integración prioritaria, escríbenos desde el panel → Feedback.</div>
    </div>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿Dónde reporto un bug o pido una función? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">Desde el panel de administración: menú lateral → Feedback. También puedes pedirle a DISA que registre tu comentario: <em>"DISA, quiero dar feedback sobre la sección de facturas"</em>. El equipo revisa todos los feedbacks semanalmente.</div>
    </div>

    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(this)">¿Cómo funciona la tienda web? <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="faq-a">La tienda web está sincronizada con tu catálogo de Bamburu en tiempo real. Los productos activos aparecen automáticamente. Puedes personalizar el diseño, colores y textos desde Configuración → Tienda web. El dominio personalizado se configura apuntando tu DNS a los servidores de Bamburu.</div>
    </div>
  </section>

</div>
</main>

<script>
// Sidebar active section tracking
var links = document.querySelectorAll('.sb-link');
var sections = [];
links.forEach(function(link) {
  var id = link.getAttribute('href').replace('#', '');
  var el = document.getElementById(id);
  if (el) sections.push({ id: id, el: el, link: link });
});

function updateActive() {
  var scrollY = window.scrollY + 100;
  var active = null;
  for (var i = sections.length - 1; i >= 0; i--) {
    if (sections[i].el.offsetTop <= scrollY) { active = sections[i]; break; }
  }
  links.forEach(function(l) { l.classList.remove('active'); });
  if (active) active.link.classList.add('active');
}

window.addEventListener('scroll', updateActive, { passive: true });
updateActive();

// Close sidebar on mobile link click
links.forEach(function(link) {
  link.addEventListener('click', function() {
    document.getElementById('sidebar').classList.remove('open');
  });
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', function(e) {
  var sb = document.getElementById('sidebar');
  if (sb.classList.contains('open') && !sb.contains(e.target) && !e.target.classList.contains('menu-btn')) {
    sb.classList.remove('open');
  }
});

// FAQ toggle
window.toggleFaq = function(el) {
  var item = el.parentElement;
  var wasOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(function(i) { i.classList.remove('open'); });
  if (!wasOpen) item.classList.add('open');
};
</script>
</body>
</html>`;
}
