// ════════════════════════════════════════════════════════════════════════════════════════════════
// PANEL DE CONTROL · MIGRACIONES PEDIDAS — el sitio donde el equipo las ve SIN depender del correo
//
// POR QUÉ EXISTE. El 24 ago 2026 el dueño avisó de que las peticiones de migración no le llegaban al
// equipo. Medido: la petición SÍ se registraba y el correo SÍ se mandaba —Resend lo aceptaba, por eso
// `email_ok` decía 1—, pero iba a `hola@bamburu.com`, que **REBOTA**: el dominio bamburu.com está
// verificado para ENVIAR y con la recepción DESACTIVADA, así que no hay buzón detrás. Una sonda al
// mismo buzón dio estado `bounced`.
//
// Cambiar la dirección arregla el síntoma. Esto arregla la causa: **un buzón caído no puede hacer
// desaparecer a un cliente que quiere entrar.** Las peticiones viven en la base de cada negocio, y
// aquí se ven TODAS juntas, con su fichero, sin que haga falta que llegue ningún correo.
//
// SOLO LEE. Ni un `UPDATE` ni un `DELETE` sobre la base de un negocio: se abre en modo lectura, que
// es la misma regla que el resto del panel de control.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { escHtml } from '../../core/escape.js';
import { listTenants } from '../../core/control-db.js';
import { saLayout } from './layout.js';

const ORIGENES = { holded: 'Holded', quipu: 'Quipu', excel: 'Excel o CSV', otro: 'Otro programa' };

// Todas las peticiones de todos los negocios, la más nueva primero.
export function peticionesDeTodos() {
  const out = [];
  for (const t of listTenants()) {
    const dbPath = path.join(process.cwd(), 'data', 'tenants', t.slug + '.db');
    if (!fs.existsSync(dbPath)) continue;
    let db;
    try { db = new Database(dbPath, { readonly: true }); } catch { continue; }
    try {
      const filas = db.prepare(
        `SELECT p.id, p.origen, p.origen_otro, p.quiere, p.comentario, p.fichero, p.fichero_bytes,
                p.estado, p.user_name, p.email_ok, p.created_at, p.attachment_id,
                a.path AS adjunto_path, a.original_name AS adjunto_nombre, a.size AS adjunto_size
           FROM migracion_peticiones p
           LEFT JOIN attachments a ON a.id = p.attachment_id
          WHERE COALESCE(p.active,1)=1
          ORDER BY p.created_at DESC, p.id DESC`).all();
      const empresa = (db.prepare('SELECT company_name, email FROM company_config WHERE id=1').get() || {});
      for (const f of filas) out.push({ ...f, slug: t.slug, empresa: empresa.company_name || t.slug, email: empresa.email || '' });
    } catch { /* negocio sin la tabla todavía */ }
    finally { try { db.close(); } catch {} }
  }
  out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return out;
}

export function mountMigraciones(sa) {
  sa.get('/migraciones', c => {
    const sess = c.get('sa');
    const peticiones = peticionesDeTodos();
    const pendientes = peticiones.filter(p => (p.estado || 'pendiente') === 'pendiente').length;
    const sinCorreo = peticiones.filter(p => !p.email_ok).length;

    const filas = peticiones.map(p => {
      const deDonde = p.origen === 'otro' ? (p.origen_otro || 'Otro') : (ORIGENES[p.origen] || p.origen || '—');
      const correo = p.email_ok
        ? '<span class="badge b-green">aceptado</span>'
        : '<span class="badge b-red">NO salió</span>';
      const fichero = p.adjunto_path
        ? `<a href="/superadmin/migraciones/${p.slug}/${p.id}/fichero">${escHtml(p.adjunto_nombre || p.fichero || 'fichero')}</a>`
          + ` <span style="color:#64748b;font-size:.78rem">(${Math.round((p.adjunto_size || 0) / 1024)} KB)</span>`
        : (p.fichero
            ? `<span style="color:#f59e0b">${escHtml(p.fichero)} — no se guardó</span>`
            : '<span style="color:#64748b">no adjuntó</span>');
      return `<tr>
        <td style="color:#64748b;font-size:.8rem;white-space:nowrap">${escHtml(String(p.created_at || '').slice(0, 16))}</td>
        <td><strong>${escHtml(p.empresa)}</strong><div style="color:#64748b;font-size:.78rem">${escHtml(p.slug)}</div></td>
        <td>${escHtml(p.user_name || '—')}<div style="color:#64748b;font-size:.78rem">${escHtml(p.email || '')}</div></td>
        <td>${escHtml(deDonde)}</td>
        <td style="font-size:.84rem">${escHtml((p.quiere || '').split(',').join(', '))}</td>
        <td>${fichero}</td>
        <td>${correo}</td>
        <td style="color:#94a3b8;font-size:.82rem;max-width:260px">${escHtml(p.comentario || '—')}</td>
      </tr>`;
    }).join('');

    const content = `
      <h1>Migraciones pedidas</h1>
      <div class="sa-sub">Todas las peticiones de todos los negocios, con su fichero. <strong>Esta pantalla no
        depende del correo</strong>: si el buzón del equipo falla, la petición sigue aquí.</div>
      <div class="card" style="display:flex;gap:28px;align-items:center">
        <div><div style="font-size:26px;font-weight:700">${peticiones.length}</div>
             <div style="color:#94a3b8;font-size:.82rem">peticiones en total</div></div>
        <div><div style="font-size:26px;font-weight:700;color:${pendientes ? '#f59e0b' : '#10b981'}">${pendientes}</div>
             <div style="color:#94a3b8;font-size:.82rem">sin atender</div></div>
        <div><div style="font-size:26px;font-weight:700;color:${sinCorreo ? '#ef4444' : '#10b981'}">${sinCorreo}</div>
             <div style="color:#94a3b8;font-size:.82rem">cuyo correo no salió</div></div>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Cuándo</th><th>Negocio</th><th>Quién lo pide</th><th>Viene de</th>
                     <th>Quiere traer</th><th>Fichero</th><th>Correo al equipo</th><th>Comentario</th></tr></thead>
          <tbody>${filas || '<tr><td colspan="8" style="color:#64748b">Ninguna petición todavía.</td></tr>'}</tbody>
        </table>
      </div>`;
    return c.html(saLayout('Migraciones', content, 'migraciones', sess));
  });

  // EL FICHERO. Se sirve desde el almacén de adjuntos del negocio, comprobando que el adjunto es
  // EL de esa petición: sin eso, un id a mano serviría cualquier documento del negocio.
  sa.get('/migraciones/:slug/:id/fichero', c => {
    const slug = String(c.req.param('slug') || '');
    const id = parseInt(c.req.param('id'));
    if (!/^[a-z0-9-]+$/.test(slug) || !Number.isFinite(id)) return c.text('Petición no válida', 400);
    const dbPath = path.join(process.cwd(), 'data', 'tenants', slug + '.db');
    if (!fs.existsSync(dbPath)) return c.text('Negocio no encontrado', 404);
    let db;
    try { db = new Database(dbPath, { readonly: true }); } catch { return c.text('No se pudo abrir', 500); }
    try {
      const r = db.prepare(
        `SELECT a.path, a.original_name, a.mime FROM migracion_peticiones p
           JOIN attachments a ON a.id = p.attachment_id
          WHERE p.id=?`).get(id);
      if (!r || !r.path) return c.text('Esa petición no tiene fichero guardado', 404);
      const abs = path.join(process.cwd(), r.path);
      if (!abs.startsWith(path.join(process.cwd(), 'data', 'uploads'))) return c.text('Ruta no válida', 400);
      if (!fs.existsSync(abs)) return c.text('El fichero ya no está en disco', 404);
      const buf = fs.readFileSync(abs);
      return new Response(buf, { headers: {
        'content-type': r.mime || 'application/octet-stream',
        'content-disposition': 'attachment; filename="' + String(r.original_name || 'fichero').replace(/"/g, '') + '"',
      } });
    } finally { try { db.close(); } catch {} }
  });
}
