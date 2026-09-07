import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { orderReceptionState } from './purchase-order-receipts.js';
import { getAttachment, readAttachmentBuffer } from '../attachments.js';

// ════════════════════════════════════════════════════════════════════════════
// C2 — Captura de factura de proveedor por foto/PDF. RETIRADA (Ibrahin, 6 sep 2026):
// necesitaba inteligencia artificial (Claude, visión) y Bamburu ya no la usa.
//
// ⚙️ 7 SEP 2026 (`sacar-disa-paso-2-borrado`) — BORRADO EL PIPELINE DE EXTRACCIÓN, no solo
// apagado. Este fichero tenía ~1.030 líneas; el paso 1 (apagar) dejó vivas la pantalla de
// "función retirada" y dos rutas de lectura, e inertes ~600 líneas de subida, extracción con
// el modelo, revisión interactiva y confirmación — nunca vuelven a ejecutarse, porque nada
// puede producir ya los datos que consumían. Se han quitado.
//
// LO QUE SE QUEDA, y por qué:
//   · La pantalla "Esta función está retirada", con su enlace a registrar a mano.
//   · `GET /file/:id` — sirve el documento de una factura YA capturada. `modules/erp/
//     attachments.js` (`originDocBlock`) lo enlaza para enseñar el "Documento origen" en
//     compras y recepciones antiguas. Sin esta ruta, esas pantallas mostrarían un enlace roto.
//   · `GET /supplier-orders` y `supplierOpenOrders()` — el mismo caso: código genérico de
//     "órdenes enviadas con pendiente de un proveedor" que esta ruta ya exponía; se deja tal
//     cual por si algo más lo necesita, sin tocar su lógica.
//
// LO QUE SE HA IDO: la subida (`POST /`), la extracción con Claude, el cuadre automático
// contra catálogo/proveedores, la confirmación/aterrizaje (`POST /confirm`), la captura
// dictada por voz al chat, y la pantalla de revisión interactiva completa. Nada de esto tenía
// ya forma de ejecutarse — apagar la IA les cortó la única entrada.
// ════════════════════════════════════════════════════════════════════════════

// Órdenes ENVIADAS del proveedor con pendiente > 0 (ni recibidas ni cerradas/anuladas).
export function supplierOpenOrders(db, supplierId) {
  const orders = db.prepare("SELECT * FROM purchase_orders WHERE supplier_id=? AND status='enviada' ORDER BY id DESC").all(supplierId);
  const out = [];
  for (const o of orders) {
    if (o.received_status === 'recibida' || o.received_status === 'cerrada_manual') continue;
    const st = orderReceptionState(db, o.id);
    if (st.totalPendiente > 0) {
      out.push({ id: o.id, order_number: o.order_number, date: o.date, total_pendiente: st.totalPendiente, lines: st.lines });
    }
  }
  return out;
}

export function createPurchaseCaptureRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // Órdenes enviadas con pendiente de un proveedor. Genérico; no depende de la extracción.
  api.get('/supplier-orders', requirePerm('purchases.read'), c => {
    try {
      const sid = parseInt(c.req.query('supplier_id'));
      if (!sid) return c.json([]);
      return c.json(supplierOpenOrders(db, sid));
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Servir el documento de una factura YA capturada: SOLO con sesión + permiso de lectura de
  // compras. Lo usa `originDocBlock` (modules/erp/attachments.js) en compras y recepciones
  // antiguas — sigue viva aunque la captura por foto esté retirada.
  api.get('/file/:id', requirePerm('purchases.read'), c => {
    try {
      const att = getAttachment(db, parseInt(c.req.param('id')));
      if (!att) return c.json({ error: 'No encontrado' }, 404);
      const buf = readAttachmentBuffer(att);
      if (!buf) return c.json({ error: 'Archivo no disponible' }, 404);
      const safeName = (att.original_name || 'documento').replace(/[^\w.\- ]/g, '_');
      return new Response(buf, {
        headers: {
          'Content-Type': att.mime || 'application/octet-stream',
          'Content-Disposition': 'inline; filename="' + safeName + '"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // La única pantalla que queda: retirada, con su salida hacia el alta a mano.
  views.get('/', requirePerm('purchases.create'), c => {
    const csrf = c.get('session')?.csrfToken || '';
    return c.html(adminLayout('Capturar factura', capturePage(), 'purchases', csrf, c));
  });

  return { api, views };
}

function capturePage() {
  return `
  <div class="ph">
    <h2>Capturar factura de proveedor</h2>
    <a href="/admin/purchases" class="btn btn-secondary">Volver</a>
  </div>

  <div class="card" style="max-width:640px;margin:0 auto">
    <div class="card-body" style="text-align:center;padding:2rem">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="1.5" style="margin-bottom:1rem"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>
      <h3 style="margin:0 0 .75rem">Esta función está retirada</h3>
      <p style="color:var(--text2);margin:0 0 1rem;line-height:1.6">
        Leer la factura desde una foto o un PDF necesitaba inteligencia artificial, y
        <strong>Bamburu ya no la usa</strong>. Es una decisión del 6 de septiembre de 2026.
      </p>
      <p style="color:var(--text2);margin:0 0 1.5rem;line-height:1.6">
        Puedes registrar la factura <strong>a mano</strong>, que sigue funcionando igual que siempre.
        Y <strong>las facturas que ya capturaste no se han tocado</strong>: están donde estaban.
      </p>
      <a href="/admin/supplier-invoices/new" class="btn btn-primary">Registrar factura a mano</a>
      <a href="/admin/purchases" class="btn btn-secondary" style="margin-left:.5rem">Ver compras</a>
    </div>
  </div>`;
}
