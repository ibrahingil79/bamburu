// Rutas de VERI*FACTU · Tarea 2 (Fase A) — pantalla CONSULTABLE del estado de remisión a la AEAT
// y acción "enviar" (al entorno de PRUEBAS). Solo lectura para ver, invoices.create para enviar
// (el envío tiene peso legal, igual que emitir). No toca la huella/QR (Tarea 1). Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout, emptyRow } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { enviarRegistro, getEnvio, certStatus, ESTADO } from '../verifactu-envio.js';
import { motivoColaInactiva } from '../verifactu-cola.js';

const ESTADO_LABEL = {
  [ESTADO.PENDIENTE]:  ['Pendiente', 'var(--text2)'],
  [ESTADO.BLOQUEADO]:  ['Bloqueado (datos)', 'var(--warn)'],
  [ESTADO.CORRECTO]:   ['Aceptado', 'var(--ok)'],
  [ESTADO.CON_ERRORES]:['Aceptado con errores', 'var(--warn)'],
  [ESTADO.INCORRECTO]: ['Rechazado', 'var(--danger)'],
  [ESTADO.ERROR_COM]:  ['Error de comunicación', 'var(--danger)'],
};

function estadoBadge(estado) {
  const [label, color] = ESTADO_LABEL[estado] || [estado || 'Pendiente', 'var(--text2)'];
  return `<span style="color:${color};font-weight:600">${escHtml(label)}</span>`;
}

export function createVerifactuEnvioRoutes(db) {
  const views = new Hono();

  // Lista de registros de ALTA con su estado de envío (consultable por documento).
  views.get('/envios', requirePerm('invoices.read'), c => {
    const cs = certStatus();
    const slug = c.get('tenant')?.slug || null;
    const motivoCola = motivoColaInactiva(slug);   // null = la cola remite sola
    const registros = db.prepare(`
      SELECT r.id, r.num_serie, r.fecha_expedicion, r.tipo_factura, r.importe_total,
             e.estado, e.csv, e.codigo_error, e.descripcion_error, e.aviso, e.enviado_at, e.intentos,
             e.next_retry_at
        FROM verifactu_registros r
        LEFT JOIN verifactu_envios e ON e.registro_id = r.id
       WHERE r.record_type='alta'
       ORDER BY r.id DESC`).all();
    const csrf = c.get('session')?.csrfToken || '';
    // Estado de la COLA: es lo que decide si una factura recién emitida llega dentro de los 240 s de
    // la huella. Si no está activa, se dice por qué y se deja claro que el botón manual sigue ahí.
    const colaAviso = motivoCola === null
      ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--ok);background:var(--ok-s);font-size:12px;color:var(--ok)"><b>Envío automático activo.</b> Al emitir una factura, su registro sale hacia la AEAT en segundos (dentro de la ventana de 240 s de la huella). Si falla, se reintenta solo y, si se agotan los intentos, aparece como aviso.</div>`
      : `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-s);font-size:12px;color:var(--warn)"><b>Envío automático inactivo.</b> ${escHtml(motivoCola)} Los registros esperan al botón "Enviar" de abajo. <b>Ojo:</b> la AEAT exige que el registro llegue dentro de ~240 s desde que se emitió la factura; enviado a mano más tarde, lo acepta pero con errores.</div>`;
    const certAviso = cs.present
      ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--ok);background:var(--ok-s);font-size:12px;color:var(--ok)">Certificado configurado: el envío real al entorno de pruebas de la AEAT está disponible.</div>`
      : `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-s);font-size:12px;color:var(--warn)"><b>Falta el certificado FNMT.</b> ${escHtml(cs.reason)} Hasta configurarlo, "Enviar" avisará sin romper (el motor está probado contra simulador).</div>`;
    const rows = registros.map(r => {
      const detalle = r.codigo_error ? `${escHtml(r.codigo_error)} · ${escHtml(r.descripcion_error || '')}` : escHtml(r.aviso || r.csv || '');
      const puede = r.estado !== ESTADO.CORRECTO && r.estado !== ESTADO.CON_ERRORES;
      const btn = puede
        ? `<form method="post" action="/admin/verifactu/enviar/${r.id}" style="display:inline"><input type="hidden" name="_csrf" value="${escHtml(csrf)}"><button class="btn" type="submit">Enviar a pruebas</button></form>`
        : `<span style="color:var(--text2);font-size:12px">Enviado</span>`;
      // La cola solo posee las filas con next_retry_at: decirlo evita que el dueño reenvíe a mano algo
      // que ya se está reintentando solo.
      const cola = r.next_retry_at
        ? `<span style="color:var(--text2)">Reintento automático · intento ${r.intentos || 0}</span>`
        : (r.intentos ? `<span style="color:var(--text2)">${r.intentos} intento${r.intentos === 1 ? '' : 's'}</span>` : '');
      return `<tr>
        <td>${escHtml(r.num_serie)}</td><td>${escHtml(r.fecha_expedicion)}</td><td>${escHtml(r.tipo_factura || '')}</td>
        <td style="text-align:right">${escHtml(r.importe_total || '')}</td>
        <td>${estadoBadge(r.estado)}</td>
        <td style="font-size:12px;color:var(--text2)">${detalle}</td>
        <td style="font-size:12px">${cola}</td>
        <td>${btn}</td></tr>`;
    }).join('') || emptyRow(8, 'Aún no hay registros que enviar. Se generan solos al emitir tus facturas.');
    const content = `<div class="ph"><h2>Envío Verifactu a la AEAT</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.5rem">Remisión de los registros de facturación (huella congelada por la Tarea 1) al entorno de <b>pruebas (preproducción)</b> de la AEAT. Estado por documento; reenviar no duplica (idempotente).</div>
      ${colaAviso}
      ${certAviso}
      <div class="card"><table>
        <thead><tr><th>Nº factura</th><th>Fecha</th><th>Tipo</th><th style="text-align:right">Importe</th><th>Estado AEAT</th><th>Detalle / CSV / aviso</th><th>Cola</th><th>Acción</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return c.html(adminLayout('Envío Verifactu', content, 'verifactu-envio', csrf, c));
  });

  // Acción: enviar UN registro al entorno de pruebas. Idempotente (no reenvía lo aceptado).
  views.post('/enviar/:id', requirePerm('invoices.create'), async c => {
    const id = Number(c.req.param('id'));
    try { await enviarRegistro(db, id, { entorno: 'pruebas' }); }
    catch (e) { /* el estado de error queda persistido; no rompemos la vista */ }
    return c.redirect('/admin/verifactu/envios');
  });

  return { views };
}
