import { Hono } from 'hono';
import { adminLayout, skeletonRows, can } from '../layout.js';
import { estadoAvisos, avisoKey, marcarVistos, desmarcarVistos } from '../avisos.js';
import { pagoModalHtml, pagoCuentaModalHtml, pagoModalScript } from '../views/pago-modal.js';
import { cobroModalHtml, cobroModalScript } from '../views/cobro-modal.js';
import { stockModalHtml, stockModalScript } from '../views/stock-modal.js';
import { activeWarehouses } from './warehouses.js';

// Pantalla central de AVISOS: "todo lo que requiere tu atención, en un sitio, y se RESUELVE aquí".
// No añade fuentes ni cálculo propio: lee del motor (modules/erp/avisos.js), que ya agrega las
// cuatro fuentes y las ordena por urgencia. El número de esta pantalla, el del contador del rail,
// el de la campana, el del Inicio y el del email diario son EL MISMO por construcción.
//
// VISTO POR AVISO: cada fila lleva su marca de "visto" (y se puede desmarcar). Abrir la pantalla
// NO marca nada por su cuenta — eso convertía el "visto" en un efecto secundario en vez de una
// decisión. También está "Marcar todos como vistos". La huella es la misma que enciende el punto
// de la campana, así que apagar el último aviso sin ver la pone gris al instante.
//
// SE ACTÚA AQUÍ, no se enlaza a otra pantalla: cada fila abre el MISMO modal compartido que usan
// Cobros, Pagos e Inventario (views/cobro-modal.js, pago-modal.js, stock-modal.js), que pegan a
// los ÚNICOS endpoints validados. Cero lógica de negocio duplicada aquí dentro. Al guardar, la
// lista se recarga: el aviso resuelto desaparece y el contador baja EN VIVO (también el del rail
// y el de la campana), sin recargar la página ni arrastrar un número viejo.
//
// Excepción deliberada — factura recurrente en borrador: emitirla crea una factura con valor
// legal (cadena de hash). No se emite desde una fila de una lista: el enlace lleva a
// /admin/recurrentes, donde se REVISA el borrador y se emite. Confirm-first (CLAUDE.md).
export function createAvisosRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  const today = () => new Date().toISOString().slice(0, 10);
  const symbol = () => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';

  // Texto de la fila con el DINERO bien formateado (símbolo del negocio + 2 decimales), espejo
  // de filaDetalle() del email diario. El motor devuelve `detalle` sin moneda (no conoce el
  // símbolo del tenant); las fuentes sin importe (stock, recurrentes) usan su detalle tal cual.
  function detalleDe(a, sym) {
    const r = a.ref || {};
    const money = n => sym + Number(n || 0).toFixed(2);
    if (a.tipo === 'cobro_vencido') {
      return 'Te deben ' + money(r.pendiente) + ' · vencida hace ' + r.dias_vencida
        + ' día' + (r.dias_vencida === 1 ? '' : 's') + ' (' + (r.due_date || '-') + ')';
    }
    if (a.tipo === 'vencimiento_proveedor') {
      const estado = r.vencida
        ? 'Vencida hace ' + r.dias_vencida + ' día' + (r.dias_vencida === 1 ? '' : 's')
        : (r.dias_para_vencer === 0 ? 'Vence HOY'
          : 'Vence en ' + r.dias_para_vencer + ' día' + (r.dias_para_vencer === 1 ? '' : 's'))
          + ' (' + (r.due_date || '-') + ')';
      return estado + ' · pendiente ' + money(r.pendiente);
    }
    return a.detalle;
  }

  // Etiqueta y color de cada fuente. El enlace del título va al DOCUMENTO (contexto); la ACCIÓN
  // se hace en el modal, sin salir de aquí. Una fuente nueva sin entrada aquí sale con su tipo
  // crudo y sin acción: se degrada, no se rompe.
  const VISTA = {
    envio_verifactu:       { etiqueta: 'Verifactu',        badge: 'b-red',    href: () => '/admin/verifactu/envios' },
    cobro_vencido:         { etiqueta: 'Cobro vencido',    badge: 'b-red',    href: r => '/admin/invoices/' + r.invoice_id },
    vencimiento_proveedor: { etiqueta: 'Pago a proveedor', href: r => '/admin/supplier-invoices/' + r.supplier_invoice_id,
                             badge: r => (r.vencida ? 'b-red' : 'b-yellow') },
    factura_recurrente:    { etiqueta: 'Recurrente',       badge: 'b-blue',   href: () => '/admin/recurrentes' },
    stock_bajo:            { etiqueta: 'Stock bajo',       badge: 'b-yellow', href: r => '/admin/inventory?q=' + encodeURIComponent(r.nombre || '') },
  };

  // `nuevos` = claves que este usuario aún no ha marcado como vistas.
  function decorar(avisos, sym, nuevos) {
    return avisos.map(a => {
      const v = VISTA[a.tipo];
      const ref = a.ref || {};
      const refHref = a.tipo === 'stock_bajo' ? { ...ref, nombre: a.titulo } : ref;
      const key = avisoKey(a);
      return {
        key, nuevo: nuevos.has(key),
        tipo: a.tipo, titulo: a.titulo, detalle: detalleDe(a, sym), urgencia: a.urgencia, ref,
        etiqueta: v ? v.etiqueta : a.tipo,
        badge: v ? (typeof v.badge === 'function' ? v.badge(ref) : v.badge) : 'b-gray',
        href: v ? v.href(refHref) : null,
      };
    });
  }

  // Respuesta común de las tres rutas: el estado recalculado en vivo para ESTE usuario.
  function estadoJson(c) {
    const est = estadoAvisos(db, today(), c.get('session')?.userId);
    const nuevos = new Set(est.nuevos || []);
    return {
      count: est.count, estado: est.estado, sinVer: nuevos.size,
      avisos: decorar(est.avisos, symbol(), nuevos),
    };
  }

  // GET /api/erp/avisos — recalcula TODO en el momento de la llamada. `estado`/`sinVer` son de
  // este usuario (huella por usuario); `count` es del negocio.
  api.get('/', c => {
    try { return c.json(estadoJson(c)); }
    catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/avisos/visto — marca como VISTOS los avisos cuyas claves lleguen en `keys`.
  // Sin `keys` (o vacío) → marca todos. Nada se auto-marca por el mero hecho de abrir la
  // pantalla: "visto" lo decide el usuario, aviso a aviso o de golpe.
  api.post('/visto', async c => {
    try {
      const body = await c.req.json().catch(() => ({}));
      marcarVistos(db, body.keys || [], today(), c.get('session')?.userId);
      return c.json(estadoJson(c));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/avisos/no-visto — lo contrario: "esto todavía lo tengo que mirar".
  api.post('/no-visto', async c => {
    try {
      const body = await c.req.json().catch(() => ({}));
      desmarcarVistos(db, body.keys || [], today(), c.get('session')?.userId);
      return c.json(estadoJson(c));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /admin/avisos — la pantalla. Sin requirePerm: muestra exactamente lo que ya cuenta el
  // badge que este usuario viene viendo en todas las pantallas. Las ACCIONES sí van gateadas por
  // permiso, una a una (y además cada endpoint revalida el permiso por su cuenta).
  views.get('/', c => {
    const sym = symbol();
    const csrf = c.get('session')?.csrfToken || '';
    const warehouses = activeWarehouses(db);
    // Mismos permisos que exige cada endpoint validado al que pega su modal.
    const puede = {
      pago:   can(c, 'purchases.create'),   // POST /api/erp/supplier-invoices/:id/payments
      cobro:  can(c, 'cobros.manage'),      // POST /api/erp/invoices/:id/payments
      stock:  can(c, 'inventory.edit'),     // POST /api/erp/products/:id/stock/adjust
    };

    const content = `
      <div class="ph"><h2>Avisos</h2>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-secondary" id="avVerTodos" onclick="marcarTodosVistos()"><i class="ti ti-checks"></i> Marcar todos como vistos</button>
          <button class="btn btn-secondary" onclick="loadAvisos()"><i class="ti ti-refresh"></i> Actualizar</button>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-body" style="display:flex;align-items:baseline;gap:.75rem">
          <span style="color:var(--muted)">Requieren tu atención</span>
          <span id="avTotal" style="font-size:1.8rem;font-weight:700">—</span>
          <span id="avSinVer" class="badge b-red" style="display:none"></span>
          <span id="avDesglose" style="color:var(--muted);font-size:.85rem"></span>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Todos tus avisos (más urgentes arriba)</h3><input class="search" id="searchBox" placeholder="Buscar cliente, proveedor, factura o producto..." oninput="filterRows()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Visto</th><th>Tipo</th><th>Aviso</th><th>Detalle</th><th>Acción</th></tr></thead>
          <tbody id="avBody">${skeletonRows(5)}</tbody>
        </table></div>
      </div>
      <style>
        /* Una fila SIN VER se distingue de un vistazo; marcarla la apaga. */
        #avBody tr.sinver td { background: var(--danger-s); }
        #avBody tr.sinver td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
        .av-visto { background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;
                    font-family:inherit;font-size:11px;padding:3px 8px;color:var(--muted);white-space:nowrap }
        .av-visto:hover { border-color:var(--accent);color:var(--accent) }
        .av-visto.on { color:var(--ok);border-color:var(--border2) }
      </style>

      ${cobroModalHtml()}
      ${pagoModalHtml()}
      ${pagoCuentaModalHtml()}
      ${stockModalHtml()}
      <script>
      ${cobroModalScript(sym)}
      ${pagoModalScript(sym)}
      ${stockModalScript(sym, warehouses)}

      const PUEDE = ${JSON.stringify(puede)};
      let avRows = [];

      // Botonera de cada fila: el MISMO modal compartido que la pantalla de origen. Nada de
      // lógica de negocio aquí: el modal pega al endpoint validado, que revalida el permiso.
      function accionesHtml(a){
        const r = a.ref || {};
        const ver = a.href ? '<a class="btn btn-secondary btn-sm" href="'+a.href+'">Ver</a>' : '';
        if (a.tipo === 'cobro_vencido') {
          if (!PUEDE.cobro) return ver;
          return '<button class="btn btn-primary btn-sm" onclick="openCobros('+r.invoice_id+')">Registrar cobro</button>'
               + ' <button class="btn btn-secondary btn-sm" title="Recordatorio, promesa de pago…" onclick="openGestion('+r.invoice_id+')">Gestionar</button>';
        }
        if (a.tipo === 'vencimiento_proveedor') {
          if (!PUEDE.pago) return ver;
          return '<button class="btn btn-primary btn-sm" onclick="openPagos('+r.supplier_invoice_id+')">Registrar pago</button>'
               + ' <button class="btn btn-secondary btn-sm" title="Saldar varias facturas de este proveedor" onclick="openPagoCuenta('+r.supplier_id+')">A cuenta</button>';
        }
        if (a.tipo === 'stock_bajo') {
          if (!PUEDE.stock) return ver;
          const nm = String(a.titulo||'').replace(/'/g,'');
          return '<button class="btn btn-primary btn-sm" onclick="openAjustar('+r.product_id+',\\''+escHtml(nm)+'\\','+Number(r.stock||0)+')">Ajustar stock</button>'
               + ' <button class="btn btn-secondary btn-sm" onclick="openStockKardex('+r.product_id+',\\''+escHtml(nm)+'\\')">Ver stock</button>';
        }
        // Recurrente en borrador: emitir crea una factura con valor legal → se revisa primero.
        if (a.tipo === 'factura_recurrente') {
          return '<a class="btn btn-primary btn-sm" href="/admin/recurrentes">Revisar y emitir</a>';
        }
        // Verifactu sin remitir: reenviar es un acto con valor legal, y además ninguno de los tres
        // casos (rechazado / bloqueado / comunicación agotada) se arregla pulsando "reintentar" a
        // ciegas. Mismo criterio que la recurrente: se lleva a la pantalla, se mira y se decide.
        if (a.tipo === 'envio_verifactu') {
          return '<a class="btn btn-primary btn-sm" href="/admin/verifactu/envios">Revisar envío</a>';
        }
        return ver;
      }

      function pintar(data){
        avRows = data.avisos || [];
        document.getElementById('avTotal').textContent = String(data.count || 0);
        const sv = document.getElementById('avSinVer');
        sv.style.display = data.sinVer ? '' : 'none';
        sv.textContent = data.sinVer + ' sin ver';
        document.getElementById('avVerTodos').disabled = !data.sinVer;
        const cuenta = {};
        avRows.forEach(function(a){ cuenta[a.etiqueta] = (cuenta[a.etiqueta]||0) + 1; });
        const partes = Object.keys(cuenta).map(function(k){ return cuenta[k] + ' · ' + k.toLowerCase(); });
        document.getElementById('avDesglose').textContent = partes.length ? '(' + partes.join(', ') + ')' : '';
        document.getElementById('avBody').innerHTML = avRows.length ? avRows.map(function(a){
          // Marca de visto POR AVISO: pulsar la alterna. Es la misma huella que enciende el punto
          // de la campana, así que apagar el último aviso sin ver la pone gris. La clave viaja en
          // data-key (nunca dentro de un onclick): la lee el listener delegado de más abajo.
          const marca = '<button class="av-visto'+(a.nuevo?'':' on')+'" data-key="'+escHtml(a.key)+'" data-visto="'+(a.nuevo?'1':'0')+'"'
            + ' title="'+(a.nuevo?'Marcar este aviso como visto':'Volver a marcarlo como no visto')+'">'
            + (a.nuevo?'Marcar visto':'✓ Visto')+'</button>';
          return '<tr class="frow'+(a.nuevo?' sinver':'')+'">'
            +'<td>'+marca+'</td>'
            +'<td><span class="badge '+a.badge+'">'+escHtml(a.etiqueta)+'</span></td>'
            +'<td>'+(a.href?'<a href="'+a.href+'"><strong>'+escHtml(a.titulo)+'</strong></a>':'<strong>'+escHtml(a.titulo)+'</strong>')+'</td>'
            +'<td style="color:var(--muted)">'+escHtml(a.detalle)+'</td>'
            +'<td style="white-space:nowrap">'+accionesHtml(a)+'</td>'
            +'</tr>';
        }).join('') : window.emptyRow(5, 'No hay nada que requiera tu atención. Todo al día.', { tone: 'ok' });
        // La campana vive en el layout y lee del mismo motor: se sincroniza sin recargar.
        if (typeof window.bellSync === 'function') window.bellSync(data.sinVer || 0, data.count || 0);
        filterRows();
      }

      async function loadAvisos(){
        try { pintar(await api('GET','/api/erp/avisos')); }
        catch(e){ toast(e.message||'Error','err'); }
      }

      // Marcar / desmarcar UN aviso. Abrir la pantalla NO marca nada: lo decides tú.
      document.getElementById('avBody').addEventListener('click', async function(e){
        const btn = e.target.closest('.av-visto'); if (!btn) return;
        const visto = btn.dataset.visto === '1';
        try { pintar(await api('POST','/api/erp/avisos/'+(visto?'visto':'no-visto'),{ keys:[btn.dataset.key] })); }
        catch(err){ toast(err.message||'Error','err'); }
      });
      window.marcarTodosVistos = async function(){
        try { pintar(await api('POST','/api/erp/avisos/visto',{}));  // sin keys = todos
              toast('Avisos marcados como vistos'); }
        catch(e){ toast(e.message||'Error','err'); }
      };
      // Si los marcas desde el panel de la campana, esta pantalla se entera.
      window.avisosOnVisto = function(){ loadAvisos(); };

      function filterRows(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        document.querySelectorAll('#avBody tr.frow').forEach(function(tr){ tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      }

      // Puntos de extensión de los modales compartidos: en cuanto se registra el cobro / el pago
      // / el ajuste, el aviso deja de existir → se recalcula la lista y el aviso desaparece solo.
      window.cobroOnSaved = function(){ loadAvisos(); };
      window.pagoOnSaved  = function(){ loadAvisos(); };
      window.stockOnSaved = function(){ loadAvisos(); };

      loadAvisos();
      </script>`;
    return c.html(adminLayout('Avisos', content, 'avisos', csrf, c));
  });

  return { api, views };
}
