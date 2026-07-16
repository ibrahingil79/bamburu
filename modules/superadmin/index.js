// Panel de SUPERADMIN — sala de máquinas de la plataforma (solo Ibrahin).
// Se monta ANTES del tenant-middleware y SOLO en el apex (en un subdominio de negocio → 404).
//
// Lee control.db y las .db de cada tenant en SOLO LECTURA. La ÚNICA excepción es el tope de IA
// (setTenantAiCap), que escribe en la .db del negocio — y lo hace por la CONEXIÓN CACHEADA de
// tenant-middleware, la misma que usa el panel de ese negocio, nunca por una conexión propia.
// (Suspender/reactivar un negocio escribe en control.db, no en la .db del tenant.)
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import path from 'path';
import { escHtml } from '../../core/escape.js';
import { hashPassword, verifyPassword } from '../../core/auth.js';
import { rateLimit } from '../../core/rate-limit.js';
import { getTenantDb } from '../../core/tenant-middleware.js';   // la caché de conexiones de la app
import { saLayout } from './layout.js';
import { mountSalud } from './salud.js';
import { mountBackups } from './backups.js';
import { mountSeguridad } from './seguridad.js';
import { mountErrores } from './errores.js';
import { mountIntegridad } from './integridad.js';
import { mountAvance } from './avance.js';
import {
  getTenantBySlug, getTenantById, listTenants, setTenantStatus,
  getSuperadminByEmail, getSuperadminById, setSuperadminPassword,
  createSuperadminSession, getSuperadminSessionByToken, destroySuperadminSession,
} from '../../core/control-db.js';

const TENANT_CAP_DEFAULT = 5;   // espejo del default de core/llm.js
const SADM_COOKIE = 'sadm=%; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400';
const month = () => new Date().toISOString().slice(0, 7);
const tenantAbs = (t) => path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);

// Gasto de IA del mes + tope (lee la .db del tenant en SOLO LECTURA; tolerante a fallos).
function tenantAiInfo(t) {
  let spend = 0, cap = null;
  try {
    const db = new Database(tenantAbs(t), { readonly: true, fileMustExist: true });
    try { spend = db.prepare('SELECT eur FROM disa_spend WHERE month=?').get(month())?.eur || 0; } catch {}
    try { const v = db.prepare("SELECT value FROM platform_limits WHERE key='ai_cap_eur'").get()?.value; if (typeof v === 'number') cap = v; } catch {}
    db.close();
  } catch {}
  return { spend, cap };   // cap=null → se usa el default
}

// Acción de control SANCIONADA: fija el tope de IA en la .db del tenant.
//
// Escribe por la CONEXIÓN CACHEADA de tenant-middleware (getTenantDb), la misma que usa el panel de
// ese negocio, en vez de abrir una segunda conexión de escritura propia. Abrir la suya era el patrón
// que el diagnóstico de carga marcó como riesgo: dos escritores contra el mismo fichero SQLite se
// serializan, y si esta escritura se atasca, deja al negocio esperando (busy_timeout: 5 s).
// Ahora esta escritura hace exactamente la misma cola que cualquier otra del panel — ni más, ni menos.
//
// getTenantDb() ya corre runMigrations, que crea platform_limits: por eso aquí no hace falta
// CREATE TABLE. Y NO se cierra la conexión: la caché es su dueña y la comparte con el resto de la app.
function setTenantAiCap(t, capEur) {
  const db = getTenantDb(t);
  db.prepare("INSERT INTO platform_limits (key,value) VALUES ('ai_cap_eur',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(capEur);
}

const eur = (n) => Number(n || 0).toFixed(2).replace('.', ',') + ' €';

// ── middlewares ─────────────────────────────────────────────────────────────
// El panel NO existe en un subdominio de negocio (solo apex/localhost).
function apexGuard(c, next) {
  const host = (c.req.header('host') || '').split(':')[0];
  const i = host.indexOf('.');
  const first = i !== -1 ? host.slice(0, i) : null;
  if (first && first !== 'www' && getTenantBySlug(first)) return c.notFound();
  return next();
}
function superadminAuth(c, next) {
  const m = (c.req.header('cookie') || '').match(/sadm=([A-Za-z0-9_-]+)/);
  const sess = m ? getSuperadminSessionByToken(m[1]) : null;
  if (!sess) return c.redirect('/superadmin/login');
  c.set('sa', sess);
  if (sess.mustChangePassword && c.req.path !== '/superadmin/change-password') return c.redirect('/superadmin/change-password');
  return next();
}
function saCsrf(c, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const sess = c.get('sa');
    const token = c.req.header('x-csrf-token');
    if (!sess || !token || token !== sess.csrfToken) return c.json({ error: 'CSRF inválido' }, 403);
  }
  return next();
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, keyPrefix: 'superadmin-login', message: 'Demasiados intentos. Espera 15 minutos.' });

export function register(app) {
  const sa = new Hono();
  sa.use('*', apexGuard);

  // ── Login (público) ───────────────────────────────────────────────────────
  sa.get('/login', c => {
    const err = c.req.query('error');
    return c.html(loginPage(err));
  });
  sa.post('/login', loginLimiter, async c => {
    const body = await c.req.parseBody();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const admin = getSuperadminByEmail(email);
    const ok = admin && await verifyPassword(password, admin.password_hash);
    if (!ok || !ok.valid) return c.redirect('/superadmin/login?error=1');
    const { token } = createSuperadminSession(admin.id);
    const headers = new Headers({ Location: admin.must_change_password ? '/superadmin/change-password' : '/superadmin/negocios' });
    headers.set('Set-Cookie', SADM_COOKIE.replace('%', token));
    return new Response(null, { status: 302, headers });
  });

  // ── A partir de aquí, protegido ───────────────────────────────────────────
  sa.use('*', superadminAuth);
  sa.use('*', saCsrf);

  sa.post('/logout', c => {
    const m = (c.req.header('cookie') || '').match(/sadm=([A-Za-z0-9_-]+)/);
    if (m) destroySuperadminSession(m[1]);
    c.header('Set-Cookie', 'sadm=; Path=/; Max-Age=0');
    return c.json({ ok: true });
  });

  sa.get('/', c => c.redirect('/superadmin/negocios'));

  // ── Cambio de contraseña (obligatorio al primer login) ────────────────────
  sa.get('/change-password', c => {
    const sess = c.get('sa');
    return c.html(changePasswordPage(sess, c.get('cspNonce')));
  });
  sa.post('/change-password', async c => {
    const sess = c.get('sa');
    let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida' }, 400); }
    const pw = String(body.password || '');
    if (pw.length < 8) return c.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    setSuperadminPassword(sess.id, await hashPassword(pw));
    return c.json({ ok: true });
  });

  // ── Zona 5: NEGOCIOS ──────────────────────────────────────────────────────
  sa.get('/negocios', c => {
    const sess = c.get('sa');
    const tenants = listTenants();
    const rows = tenants.map(t => {
      const { spend, cap } = tenantAiInfo(t);
      const capVal = cap == null ? TENANT_CAP_DEFAULT : cap;
      const over = spend >= capVal;
      const statusBadge =
        t.status === 'active' ? '<span class="badge b-green">activo</span>'
        : t.status === 'suspended_admin' ? '<span class="badge b-amber">solo lectura</span>'
        : t.status === 'suspended_security' ? '<span class="badge b-red">cortado</span>'
        : `<span class="badge b-gray">${escHtml(t.status || '')}</span>`;
      const alta = (t.created_at || '').slice(0, 10);
      const actions = t.status === 'active'
        ? `<button class="btn" data-act="cap">Tope IA</button> <button class="btn btn-red" data-act="suspend">Suspender</button>`
        : `<button class="btn" data-act="cap">Tope IA</button> <button class="btn btn-amber" data-act="reactivar">Reactivar</button>`;
      return `<tr data-id="${t.id}" data-name="${escHtml(t.name)}" data-cap="${capVal}">
        <td><strong>${escHtml(t.name)}</strong><br><span style="color:#64748b;font-size:11px">${escHtml(t.slug)}.bamburu.com</span></td>
        <td>${escHtml(alta || '-')}</td>
        <td>${statusBadge}${t.suspend_note ? `<br><span style="color:#94a3b8;font-size:11px">${escHtml(t.suspend_note)}</span>` : ''}</td>
        <td style="${over ? 'color:#f87171;font-weight:700' : ''}">${eur(spend)} <span style="color:#64748b">/ ${eur(capVal)}${cap == null ? ' (def)' : ''}</span></td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('');

    const content = `
      <h1>Negocios</h1>
      <div class="sa-sub">Todos los inquilinos de la plataforma — alta, estado y gasto de IA del mes contra su tope.</div>
      <div class="card" style="padding:0;overflow:hidden">
        <table>
          <thead><tr><th>Negocio</th><th>Alta</th><th>Estado</th><th>Gasto IA (mes)</th><th>Acciones</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:#64748b">Sin negocios</td></tr>'}</tbody>
        </table>
      </div>
      <script nonce="${c.get('cspNonce')}">
        // C4b-1: los botones de cada fila se atienden por DELEGACIÓN. La CSP estricta bloquea los
        // handlers de atributo (el nonce solo cubre el bloque de script), y la fila ya lleva data-id.
        document.addEventListener('DOMContentLoaded', function(){
          document.querySelector('table tbody').addEventListener('click', function(e){
            const b = e.target.closest('button[data-act]');
            if (!b) return;
            const id = Number(b.closest('tr').dataset.id);
            if (b.dataset.act === 'cap') saCap(id);
            else if (b.dataset.act === 'suspend') saSuspend(id);
            else if (b.dataset.act === 'reactivar') saReactivar(id);
          });
        });
        function saCap(id){
          const tr=document.querySelector('tr[data-id="'+id+'"]');
          saOpenModal('<h3>Tope de IA · '+saEsc(tr.dataset.name)+'</h3>'
            +'<label>Tope de gasto de IA al mes (€)</label>'
            +'<input id="capVal" type="number" min="0" step="0.5" value="'+tr.dataset.cap+'">'
            +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="btn" id="capCancel">Cancelar</button><button class="btn btn-amber" id="capSave">Guardar</button></div>');
          document.getElementById('capCancel').onclick=saCloseModal;
          document.getElementById('capSave').onclick=function(){ saCapSave(id); };
        }
        async function saCapSave(id){
          const v=parseFloat(document.getElementById('capVal').value);
          if(!(v>=0)){ alert('Tope inválido'); return; }
          try{ await saApi('POST','/superadmin/negocios/'+id+'/cap',{cap_eur:v}); location.reload(); }catch(e){ alert(e.message); }
        }
        function saSuspend(id){
          const tr=document.querySelector('tr[data-id="'+id+'"]');
          var h='<h3>Suspender · '+saEsc(tr.dataset.name)+'</h3>'
            +'<label>Motivo (se le muestra al negocio en el modo impago)</label>'
            +'<textarea id="susNote" rows="2" placeholder="Ej.: factura de junio pendiente"></textarea>'
            +'<label style="margin-top:14px">Tipo de suspensión</label>'
            +'<div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">'
            +'<button class="btn btn-amber" id="susAdmin">Administrativo / impago → entra en SOLO LECTURA</button>'
            +'<button class="btn btn-red" id="susSec">Seguridad / cuenta comprometida → acceso CORTADO</button>'
            +'</div><div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn" id="susCancel">Cancelar</button></div>';
          saOpenModal(h);
          document.getElementById('susCancel').onclick=saCloseModal;
          document.getElementById('susAdmin').onclick=function(){ saSuspendDo(id,'admin'); };
          document.getElementById('susSec').onclick=function(){ saSuspendDo(id,'security'); };
        }
        async function saSuspendDo(id,mode){
          try{ await saApi('POST','/superadmin/negocios/'+id+'/suspend',{mode:mode,note:document.getElementById('susNote').value}); location.reload(); }catch(e){ alert(e.message); }
        }
        async function saReactivar(id){
          if(!confirm('¿Reactivar este negocio (vuelve al estado normal)?')) return;
          try{ await saApi('POST','/superadmin/negocios/'+id+'/reactivate'); location.reload(); }catch(e){ alert(e.message); }
        }
      </script>`;
    return c.html(saLayout('Negocios', content, 'negocios', sess, sess.csrfToken, c.get('cspNonce')));
  });

  sa.post('/negocios/:id/cap', async c => {
    const t = getTenantById(parseInt(c.req.param('id')));
    if (!t) return c.json({ error: 'Negocio no encontrado' }, 404);
    let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida' }, 400); }
    const cap = Number(body.cap_eur);
    if (!(cap >= 0) || !isFinite(cap)) return c.json({ error: 'Tope inválido' }, 400);
    setTenantAiCap(t, cap);
    return c.json({ ok: true });
  });

  sa.post('/negocios/:id/suspend', async c => {
    const t = getTenantById(parseInt(c.req.param('id')));
    if (!t) return c.json({ error: 'Negocio no encontrado' }, 404);
    let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida' }, 400); }
    const mode = body.mode === 'security' ? 'suspended_security' : 'suspended_admin';
    const note = String(body.note || '').trim().slice(0, 300) || null;
    setTenantStatus(t.id, mode, note);
    return c.json({ ok: true });
  });

  sa.post('/negocios/:id/reactivate', c => {
    const t = getTenantById(parseInt(c.req.param('id')));
    if (!t) return c.json({ error: 'Negocio no encontrado' }, 404);
    setTenantStatus(t.id, 'active', null);
    return c.json({ ok: true });
  });

  mountSalud(sa);      // zona 1 · Salud
  mountBackups(sa);    // zona 6 · Copias
  mountSeguridad(sa);  // zona 2 · Seguridad
  mountErrores(sa);    // zona 4 · Errores
  mountIntegridad(sa); // zona 3 · Integridad de facturas
  mountAvance(sa);     // zona 7 · Avance (Notion, solo lectura)

  app.route('/superadmin', sa);
  console.log('✅ Superadmin: panel en /superadmin');
}

// ── Páginas sueltas (login / cambio de contraseña) ───────────────────────────
function shell(title, inner) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)} · Superadmin</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{width:100%;max-width:380px;padding:36px 32px;background:#0D1229;border:1px solid rgba(255,255,255,.08);border-radius:18px}
.logo{font-weight:800;color:#fff;text-align:center;margin-bottom:6px}.logo span{color:#f59e0b}
h1{font-size:17px;color:#fff;text-align:center;margin-bottom:22px;font-weight:600}
label{display:block;font-size:12px;color:#94a3b8;margin:14px 0 6px}
input{width:100%;padding:11px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;font-size:14px;font-family:inherit}
.btn{width:100%;margin-top:20px;padding:12px;background:#f59e0b;color:#070B14;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit}
.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);color:#fca5a5;font-size:13px;padding:10px;border-radius:9px;margin-bottom:14px;text-align:center}
.ok{color:#34d399;font-size:13px;text-align:center;margin-top:12px}
</style></head><body><div class="card"><div class="logo">Bam<span>buru</span> · Superadmin</div>${inner}</div></body></html>`;
}
function loginPage(err) {
  return shell('Acceso', `<h1>Sala de máquinas</h1>
    ${err ? '<div class="err">Credenciales incorrectas.</div>' : ''}
    <form method="POST" action="/superadmin/login">
      <label>Email</label><input type="email" name="email" required autofocus autocomplete="username">
      <label>Contraseña</label><input type="password" name="password" required autocomplete="current-password">
      <button class="btn" type="submit">Entrar</button>
    </form>`);
}
function changePasswordPage(sess, nonce = '') {
  return shell('Cambiar contraseña', `<h1>Elige una contraseña nueva</h1>
    <p style="color:#94a3b8;font-size:13px;text-align:center;margin-bottom:8px">${escHtml(sess.email)} — cambio obligatorio.</p>
    <label>Contraseña nueva (mín. 8)</label><input id="pw1" type="password" autocomplete="new-password">
    <label>Repite la contraseña</label><input id="pw2" type="password" autocomplete="new-password">
    <button class="btn" id="btnSavePw">Guardar y continuar</button>
    <div class="ok" id="msg"></div>
    <script nonce="${nonce}">
      window.SA_CSRF=${JSON.stringify(sess.csrfToken)};
      window.addEventListener('DOMContentLoaded', function(){ document.getElementById('btnSavePw').onclick = save; });
      async function save(){
        const a=document.getElementById('pw1').value,b=document.getElementById('pw2').value;
        if(a.length<8){ msg.textContent='Mínimo 8 caracteres.'; msg.style.color='#fca5a5'; return; }
        if(a!==b){ msg.textContent='No coinciden.'; msg.style.color='#fca5a5'; return; }
        try{
          const r=await fetch('/superadmin/change-password',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':window.SA_CSRF},body:JSON.stringify({password:a})});
          const d=await r.json(); if(!r.ok) throw new Error(d.error||'Error');
          location.href='/superadmin/negocios';
        }catch(e){ msg.textContent=e.message; msg.style.color='#fca5a5'; }
      }
    </script>`);
}
