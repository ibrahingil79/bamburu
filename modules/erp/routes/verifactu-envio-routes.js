// Rutas de VERI*FACTU · Tarea 2 (Fase A) — pantalla CONSULTABLE del estado de remisión a la AEAT
// y acción "enviar" (al entorno de PRUEBAS). Solo lectura para ver, invoices.create para enviar
// (el envío tiene peso legal, igual que emitir). No toca la huella/QR (Tarea 1). Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { enviarRegistro, getEnvio, certStatus, ESTADO } from '../verifactu-envio.js';

const ESTADO_LABEL = {
  [ESTADO.PENDIENTE]:  ['Pendiente', '#6b7280'],
  [ESTADO.BLOQUEADO]:  ['Bloqueado (datos)', '#b45309'],
  [ESTADO.CORRECTO]:   ['Aceptado', '#15803d'],
  [ESTADO.CON_ERRORES]:['Aceptado con errores', '#b45309'],
  [ESTADO.INCORRECTO]: ['Rechazado', '#b91c1c'],
  [ESTADO.ERROR_COM]:  ['Error de comunicación', '#b91c1c'],
};

function estadoBadge(estado) {
  const [label, color] = ESTADO_LABEL[estado] || [estado || 'Pendiente', '#6b7280'];
  return `<span style="color:${color};font-weight:600">${escHtml(label)}</span>`;
}

export function createVerifactuEnvioRoutes(db) {
  const views = new Hono();

  // Lista de registros de ALTA con su estado de envío (consultable por documento).
  views.get('/envios', requirePerm('invoices.read'), c => {
    const cs = certStatus();
    const registros = db.prepare(`
      SELECT r.id, r.num_serie, r.fecha_expedicion, r.tipo_factura, r.importe_total,
             e.estado, e.csv, e.codigo_error, e.descripcion_error, e.aviso, e.enviado_at, e.intentos
        FROM verifactu_registros r
        LEFT JOIN verifactu_envios e ON e.registro_id = r.id
       WHERE r.record_type='alta'
       ORDER BY r.id DESC`).all();
    const csrf = c.get('session')?.csrfToken || '';
    const certAviso = cs.present
      ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid #15803d;background:#f0fdf4;font-size:12px;color:#166534">Certificado configurado: el envío real al entorno de pruebas de la AEAT está disponible.</div>`
      : `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid #d97706;background:#fffbeb;font-size:12px;color:#92400e"><b>Falta el certificado FNMT.</b> ${escHtml(cs.reason)} Hasta configurarlo, "Enviar" avisará sin romper (el motor está probado contra simulador).</div>`;
    const rows = registros.map(r => {
      const detalle = r.codigo_error ? `${escHtml(r.codigo_error)} · ${escHtml(r.descripcion_error || '')}` : escHtml(r.aviso || r.csv || '');
      const puede = r.estado !== ESTADO.CORRECTO && r.estado !== ESTADO.CON_ERRORES;
      const btn = puede
        ? `<form method="post" action="/admin/verifactu/enviar/${r.id}" style="display:inline"><input type="hidden" name="_csrf" value="${escHtml(csrf)}"><button class="btn" type="submit">Enviar a pruebas</button></form>`
        : `<span style="color:var(--text2);font-size:12px">Enviado</span>`;
      return `<tr>
        <td>${escHtml(r.num_serie)}</td><td>${escHtml(r.fecha_expedicion)}</td><td>${escHtml(r.tipo_factura || '')}</td>
        <td style="text-align:right">${escHtml(r.importe_total || '')}</td>
        <td>${estadoBadge(r.estado)}</td>
        <td style="font-size:12px;color:var(--text2)">${detalle}</td>
        <td>${btn}</td></tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text2)">Sin registros de facturación</td></tr>';
    const content = `<div class="ph"><h2>Envío Verifactu a la AEAT</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.5rem">Remisión de los registros de facturación (huella congelada por la Tarea 1) al entorno de <b>pruebas (preproducción)</b> de la AEAT. Estado por documento; reenviar no duplica (idempotente).</div>
      ${certAviso}
      <div class="card"><table>
        <thead><tr><th>Nº factura</th><th>Fecha</th><th>Tipo</th><th style="text-align:right">Importe</th><th>Estado AEAT</th><th>Detalle / CSV / aviso</th><th>Acción</th></tr></thead>
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
