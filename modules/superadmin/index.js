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
  enableSuperadminTotp, disableSuperadminTotp, listUnusedRecoveryCodes,
  consumeRecoveryCode, countUnusedRecoveryCodes, recordSecurityEvent,
} from '../../core/control-db.js';
import { randomBytes } from 'crypto';
import QRCode from 'qrcode';
import { generateSecret, verify as verifyTOTP, keyuri } from '../../core/totp.js';
import { generarCodigosRescate, buscarCodigo } from '../../core/recovery-codes.js';
import { getClientIp } from '../../core/rate-limit.js';

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

// C5/M3 — el hueco entre "la contraseña es correcta" y "el código también".
//
// `pendiente2FA`: contraseña ya verificada, esperando el código. Es un vale de 5 minutos, NO una
// sesión: no abre nada por sí solo, solo dice "de esta cuenta ya se demostró la contraseña". Vive en
// memoria a propósito — un reinicio lo tira y como mucho obliga a repetir el login. Y NUNCA viaja el
// id de la cuenta al navegador: viaja este token opaco, que no dice nada de quién es.
//
// `secretoPendiente`: el secreto TOTP durante el alta, antes de que se demuestre que la app lo tiene
// bien. Solo pasa a la BD cuando un código válido lo prueba — si se guardara antes, un alta a medias
// (cierras la pestaña tras escanear) dejaría la cuenta con un 2FA activo que nadie sabe generar.
const pendiente2FA = new Map();
const secretoPendiente = new Map();
const TTL_PENDIENTE = 5 * 60 * 1000;
const TTL_SECRETO = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendiente2FA) if (now - v.created > TTL_PENDIENTE) pendiente2FA.delete(k);
  for (const [k, v] of secretoPendiente) if (now - v.created > TTL_SECRETO) secretoPendiente.delete(k);
}, 60000).unref();

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
    if (!ok || !ok.valid) {
      recordSecurityEvent('superadmin_login_failed', getClientIp(c), 'apex', 'POST /superadmin/login');
      return c.redirect('/superadmin/login?error=1');
    }
    // C5/M3 — con 2FA activo, la contraseña ya NO abre la puerta: solo da derecho a que te pidan el
    // código. Aquí no se crea sesión ni cookie; eso pasa al otro lado de /verify-2fa.
    if (admin.totp_enabled && admin.totp_secret) {
      const pending = randomBytes(20).toString('base64url');
      pendiente2FA.set(pending, { id: admin.id, created: Date.now() });
      return c.html(verify2faPage(pending));
    }
    return abrirSesion(admin);
  });

  // Segundo factor. Va ANTES de superadminAuth a propósito: quien llega aquí todavía no tiene sesión
  // —esa es justo la cuestión—. Y por eso mismo tampoco pasa por saCsrf: no hay sesión de la que
  // robar nada. El vale `pending` es lo que ata esta petición al login de hace un momento.
  sa.post('/verify-2fa', loginLimiter, async c => {
    const body = await c.req.parseBody();
    const pending = String(body.pending || '');
    const code = String(body.code || '');

    const entry = pendiente2FA.get(pending);
    if (!entry || Date.now() - entry.created > TTL_PENDIENTE) {
      pendiente2FA.delete(pending);
      return c.redirect('/superadmin/login?error=expirado');
    }
    const admin = getSuperadminById(entry.id);
    if (!admin || !admin.totp_enabled || !admin.totp_secret) return c.redirect('/superadmin/login?error=1');

    // Primero el código de la app (el caso normal). Si no cuela, se prueba como código de rescate:
    // el orden importa poco para la seguridad y mucho para el coste — un TOTP correcto no debería
    // pagar diez bcrypt de rescate por el camino.
    let entra = verifyTOTP(code, admin.totp_secret);
    let porRescate = false;
    if (!entra) {
      const fila = await buscarCodigo(code, listUnusedRecoveryCodes(admin.id));
      // consumeRecoveryCode devuelve false si otra petición lo gastó primero: el código se quema
      // AQUÍ, y solo si de verdad estaba sin usar. Un mismo papel no abre dos veces.
      if (fila && consumeRecoveryCode(fila.id)) { entra = true; porRescate = true; }
    }
    if (!entra) {
      recordSecurityEvent('superadmin_2fa_failed', getClientIp(c), 'apex', 'POST /superadmin/verify-2fa');
      return c.html(verify2faPage(pending, 'malo'), 400);
    }

    pendiente2FA.delete(pending);
    if (porRescate) {
      // Que se gaste un código de rescate es NOTICIA: o perdiste el móvil, o alguien está entrando
      // con un papel tuyo. Queda en la zona de Seguridad del panel, que es donde lo vas a mirar.
      const quedan = countUnusedRecoveryCodes(admin.id);
      recordSecurityEvent('superadmin_2fa_rescate', getClientIp(c), 'apex', `código de rescate usado · quedan ${quedan}`);
      console.warn(`[Superadmin] Entrada con CÓDIGO DE RESCATE. Quedan ${quedan}.`);
    }
    return abrirSesion(admin);
  });

  // Crear la sesión + plantar la cookie es idéntico con 2FA y sin él; el único sitio donde se hace.
  function abrirSesion(admin) {
    const { token } = createSuperadminSession(admin.id);
    const headers = new Headers({ Location: admin.must_change_password ? '/superadmin/change-password' : '/superadmin/negocios' });
    headers.set('Set-Cookie', SADM_COOKIE.replace('%', token));
    return new Response(null, { status: 302, headers });
  }

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

  // ── C5/M3 · 2FA (TOTP) ────────────────────────────────────────────────────
  sa.get('/2fa', async c => {
    const sess = c.get('sa');
    const admin = getSuperadminById(sess.id);
    if (admin.totp_enabled) {
      return c.html(dosFactoresActivoPage(sess, countUnusedRecoveryCodes(sess.id), c.get('cspNonce')));
    }
    // Secreto nuevo en cada visita: mientras no haya un código válido que lo confirme, no vale nada
    // y no se guarda. Recargar la página = empezar de cero, que es lo que espera quien recarga.
    const secret = generateSecret();
    secretoPendiente.set(sess.id, { secret, created: Date.now() });
    const qr = await QRCode.toDataURL(keyuri(admin.email, 'Bamburu Superadmin', secret), { width: 200, margin: 1 });
    return c.html(altaDosFactoresPage(sess, secret, qr, c.get('cspNonce')));
  });

  sa.post('/2fa/activar', async c => {
    const sess = c.get('sa');
    let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida' }, 400); }
    const pendiente = secretoPendiente.get(sess.id);
    if (!pendiente || Date.now() - pendiente.created > TTL_SECRETO) {
      return c.json({ error: 'El alta ha caducado. Recarga la página y vuelve a escanear.' }, 400);
    }
    // EXIGIR un código válido antes de activar es lo que separa "2FA puesto" de "2FA que te deja
    // fuera": prueba que la app tiene el secreto y que el reloj del servidor y el del móvil se
    // entienden. Sin esta comprobación, activar a ciegas es cerrar la puerta con la llave dentro.
    if (!verifyTOTP(String(body.code || ''), pendiente.secret)) {
      return c.json({ error: 'Ese código no es válido. Comprueba que copias el de Bamburu Superadmin.' }, 400);
    }
    const { codigos, hashes } = await generarCodigosRescate();
    enableSuperadminTotp(sess.id, pendiente.secret, hashes);
    secretoPendiente.delete(sess.id);
    recordSecurityEvent('superadmin_2fa_activado', getClientIp(c), 'apex', 'POST /superadmin/2fa/activar');
    // La ÚNICA vez que los códigos existen en claro. A partir de aquí solo hay hashes: ni este panel
    // ni nadie puede volver a enseñarlos. Se pueden regenerar, no recuperar.
    return c.json({ ok: true, codigos });
  });

  sa.post('/2fa/regenerar', async c => {
    const sess = c.get('sa');
    let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida' }, 400); }
    const admin = getSuperadminById(sess.id);
    if (!admin.totp_enabled || !admin.totp_secret) return c.json({ error: 'El 2FA no está activo.' }, 400);
    // Se pide el código de la app: tener la sesión abierta no basta para reescribir la lista de
    // llaves de emergencia. Quien encuentre el portátil desbloqueado no se fabrica una entrada.
    if (!verifyTOTP(String(body.code || ''), admin.totp_secret)) {
      return c.json({ error: 'Código incorrecto.' }, 400);
    }
    const { codigos, hashes } = await generarCodigosRescate();
    enableSuperadminTotp(sess.id, admin.totp_secret, hashes);   // mismo secreto, códigos nuevos
    recordSecurityEvent('superadmin_2fa_codigos_regenerados', getClientIp(c), 'apex', 'POST /superadmin/2fa/regenerar');
    return c.json({ ok: true, codigos });
  });

  sa.post('/2fa/desactivar', async c => {
    const sess = c.get('sa');
    let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida' }, 400); }
    const admin = getSuperadminById(sess.id);
    if (!admin.totp_enabled || !admin.totp_secret) return c.json({ error: 'El 2FA no está activo.' }, 400);
    // Quitar el segundo factor exige demostrarlo otra vez. Si bastara la sesión, el 2FA solo
    // protegería del robo de contraseña, no del robo de sesión — y entonces sobraría media función.
    if (!verifyTOTP(String(body.code || ''), admin.totp_secret)) {
      return c.json({ error: 'Código incorrecto.' }, 400);
    }
    disableSuperadminTotp(sess.id);
    recordSecurityEvent('superadmin_2fa_desactivado', getClientIp(c), 'apex', 'POST /superadmin/2fa/desactivar');
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
  // `expirado` no es un fallo de credenciales: el vale de 5 min del segundo paso se agotó. Decirlo
  // tal cual evita el susto de "¿me he equivocado de contraseña?" cuando no ha pasado nada raro.
  const aviso = err === 'expirado'
    ? '<div class="err">La verificación caducó. Entra otra vez.</div>'
    : err ? '<div class="err">Credenciales incorrectas.</div>' : '';
  return shell('Acceso', `<h1>Sala de máquinas</h1>
    ${aviso}
    <form method="POST" action="/superadmin/login">
      <label>Email</label><input type="email" name="email" required autofocus autocomplete="username">
      <label>Contraseña</label><input type="password" name="password" required autocomplete="current-password">
      <button class="btn" type="submit">Entrar</button>
    </form>`);
}

// Segundo paso del login. El mismo campo acepta el código de la app y el de rescate: quien llega
// aquí sin móvil no tiene que encontrar otro botón — escribe lo que tiene y funciona.
function verify2faPage(pending, err = '') {
  return shell('Verificación', `<h1>Código de verificación</h1>
    ${err ? '<div class="err">Código incorrecto o ya usado.</div>' : ''}
    <form method="POST" action="/superadmin/verify-2fa">
      <input type="hidden" name="pending" value="${escHtml(pending)}">
      <label>Código de tu app (o uno de rescate)</label>
      <input type="text" name="code" required autofocus autocomplete="one-time-code"
             inputmode="text" maxlength="20" placeholder="000000">
      <button class="btn" type="submit">Verificar</button>
    </form>`);
}

// Los códigos de rescate se enseñan aquí y NUNCA más. Por eso la pantalla insiste tanto, por eso
// existe el botón de copiar, y por eso (C5-ter) el "Terminar" está BLOQUEADO hasta que se marque
// que se han guardado: el modo de fallo real no es que alguien los robe, es que se cierre la
// pestaña sin guardarlos y nadie lo note hasta el día del apuro.
//
// Hasta C5-ter esto era un enlace normal — se pasaba de largo sin leer. El cliente sí tenía el
// cerrojo desde C5-bis (perfil.js), así que la cuenta MÁS poderosa de la plataforma era la única
// sin él. Es el mismo mecanismo, no uno nuevo: casilla + pointer-events, igual que allí.
function bloqueCodigos() {
  return `<div id="codigosBox" style="display:none">
      <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);border-radius:9px;padding:12px;margin:14px 0">
        <p style="color:#fbbf24;font-size:13px;font-weight:700;margin-bottom:4px">Guárdalos AHORA</p>
        <p style="color:#94a3b8;font-size:12px;line-height:1.5">No se volverán a mostrar. Cada uno sirve UNA vez y sustituye al código de la app si pierdes el móvil. Imprímelos o guárdalos donde guardas lo importante — no en este ordenador.</p>
      </div>
      <pre id="codigos" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:12px;color:#e2e8f0;font-size:13px;line-height:1.9;text-align:center;font-family:ui-monospace,monospace;white-space:pre-wrap"></pre>
      <button class="btn" id="btnCopiar" style="background:rgba(255,255,255,.08);color:#e2e8f0">Copiar al portapapeles</button>
      <label style="display:flex;align-items:flex-start;gap:9px;margin:14px 0;font-size:13px;color:#e2e8f0;cursor:pointer">
        <input type="checkbox" id="rcOk" style="margin-top:2px;width:16px;height:16px;flex-shrink:0">
        <span>He guardado mis códigos de rescate en un sitio seguro.</span>
      </label>
      <a href="/superadmin/negocios" class="btn" id="rcFin" style="display:block;text-align:center;text-decoration:none;pointer-events:none;opacity:.45">Terminar</a>
    </div>`;
}

// C5-ter — engancha el cerrojo. Se llama desde los <script nonce> de las dos pantallas que usan
// bloqueCodigos(): /superadmin va con CSP ESTRICTA, así que el JS TIENE que vivir dentro de un
// bloque con nonce — un onclick de atributo aquí no correría, y el botón moriría en silencio.
//
// Devuelve el CUERPO de la función, no una etiqueta <script>: así el nonce lo pone quien lo inserta
// y esto no puede olvidárselo.
const cerrojoCodigosJs = `
      function engancharCerrojo(){
        var ok = document.getElementById('rcOk');
        var fin = document.getElementById('rcFin');
        if (!ok || !fin) return;
        ok.addEventListener('change', function(e){
          fin.style.pointerEvents = e.target.checked ? 'auto' : 'none';
          fin.style.opacity = e.target.checked ? '1' : '.45';
        });
      }`;

function altaDosFactoresPage(sess, secret, qr, nonce = '') {
  return shell('Activar 2FA', `<h1>Activar doble factor</h1>
    <div id="paso1">
      <p style="color:#94a3b8;font-size:13px;text-align:center;margin-bottom:14px">Escanea con Google Authenticator, Authy, 1Password o cualquier app TOTP.</p>
      <div style="text-align:center;background:#fff;padding:10px;border-radius:12px"><img src="${qr}" width="200" height="200" alt="Código QR para configurar el 2FA"></div>
      <p style="color:#94a3b8;font-size:12px;text-align:center;margin:12px 0 4px">¿No puedes escanear? Escribe esta clave:</p>
      <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:9px;color:#e2e8f0;font-size:12px;text-align:center;word-break:break-all;font-family:ui-monospace,monospace">${escHtml(secret)}</div>
      <label>Escribe el código que muestra la app</label>
      <input id="code" type="text" inputmode="numeric" maxlength="7" autocomplete="one-time-code" placeholder="000000">
      <button class="btn" id="btnActivar">Verificar y activar</button>
      <div class="ok" id="msg"></div>
      <p style="text-align:center;margin-top:14px"><a href="/superadmin/negocios" style="color:#64748b;font-size:12px;text-decoration:none">← Volver sin activar</a></p>
    </div>
    ${bloqueCodigos()}
    <script nonce="${nonce}">
      window.SA_CSRF=${JSON.stringify(sess.csrfToken)};
      window.addEventListener('DOMContentLoaded', function(){
        document.getElementById('btnActivar').onclick = activar;
        document.getElementById('btnCopiar').onclick = copiar;
        engancharCerrojo();
      });${cerrojoCodigosJs}
      function pinta(codigos){
        document.getElementById('paso1').style.display='none';
        document.getElementById('codigos').textContent = codigos.join('\\n');
        document.getElementById('codigosBox').style.display='block';
      }
      function copiar(){
        navigator.clipboard.writeText(document.getElementById('codigos').textContent)
          .then(function(){ document.getElementById('btnCopiar').textContent='Copiados ✓'; });
      }
      async function activar(){
        var msg=document.getElementById('msg');
        msg.style.color='#fca5a5'; msg.textContent='';
        try{
          const r=await fetch('/superadmin/2fa/activar',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':window.SA_CSRF},body:JSON.stringify({code:document.getElementById('code').value})});
          const d=await r.json(); if(!r.ok) throw new Error(d.error||'Error');
          pinta(d.codigos);
        }catch(e){ msg.textContent=e.message; }
      }
    </script>`);
}

function dosFactoresActivoPage(sess, quedan, nonce = '') {
  // Quedarse sin códigos con el 2FA puesto es estar a un móvil roto de perder la plataforma: por eso
  // el aviso cambia de tono según cuántos queden, en vez de ser un número más en la pantalla.
  const color = quedan === 0 ? '#fca5a5' : quedan <= 3 ? '#fbbf24' : '#34d399';
  const nota = quedan === 0
    ? 'No te queda ninguno. Si pierdes el móvil, la única salida es el servidor. Regenéralos.'
    : quedan <= 3 ? 'Te quedan pocos. Regenéralos cuando puedas.' : 'Cada uno sirve una vez.';
  return shell('2FA', `<h1>Doble factor activo</h1>
    <p style="color:#94a3b8;font-size:13px;text-align:center;margin-bottom:6px">${escHtml(sess.email)}</p>
    <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:12px;text-align:center;margin-bottom:6px">
      <div style="color:${color};font-size:22px;font-weight:800">${quedan}</div>
      <div style="color:#94a3b8;font-size:12px">códigos de rescate sin usar</div>
      <div style="color:#64748b;font-size:11px;margin-top:6px">${nota}</div>
    </div>
    <div id="paso1">
      <label>Código de tu app (hace falta para cualquiera de las dos cosas)</label>
      <input id="code" type="text" inputmode="numeric" maxlength="7" autocomplete="one-time-code" placeholder="000000">
      <button class="btn" id="btnRegen">Generar códigos de rescate nuevos</button>
      <button class="btn" id="btnOff" style="background:rgba(239,68,68,.15);color:#fca5a5;margin-top:10px">Desactivar el doble factor</button>
      <div class="ok" id="msg"></div>
      <p style="text-align:center;margin-top:14px"><a href="/superadmin/negocios" style="color:#64748b;font-size:12px;text-decoration:none">← Volver al panel</a></p>
    </div>
    ${bloqueCodigos()}
    <script nonce="${nonce}">
      window.SA_CSRF=${JSON.stringify(sess.csrfToken)};
      window.addEventListener('DOMContentLoaded', function(){
        document.getElementById('btnRegen').onclick = regenerar;
        document.getElementById('btnOff').onclick = desactivar;
        document.getElementById('btnCopiar').onclick = copiar;
        engancharCerrojo();
      });${cerrojoCodigosJs}
      function copiar(){
        navigator.clipboard.writeText(document.getElementById('codigos').textContent)
          .then(function(){ document.getElementById('btnCopiar').textContent='Copiados ✓'; });
      }
      async function llama(url){
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':window.SA_CSRF},body:JSON.stringify({code:document.getElementById('code').value})});
        const d=await r.json(); if(!r.ok) throw new Error(d.error||'Error');
        return d;
      }
      async function regenerar(){
        var msg=document.getElementById('msg'); msg.style.color='#fca5a5'; msg.textContent='';
        try{
          const d=await llama('/superadmin/2fa/regenerar');
          document.getElementById('paso1').style.display='none';
          document.getElementById('codigos').textContent = d.codigos.join('\\n');
          document.getElementById('codigosBox').style.display='block';
        }catch(e){ msg.textContent=e.message; }
      }
      async function desactivar(){
        if(!confirm('¿Desactivar el doble factor? La cuenta más poderosa de la plataforma se quedará solo con contraseña.')) return;
        var msg=document.getElementById('msg'); msg.style.color='#fca5a5'; msg.textContent='';
        try{ await llama('/superadmin/2fa/desactivar'); location.href='/superadmin/2fa'; }
        catch(e){ msg.textContent=e.message; }
      }
    </script>`);
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
