// Gate del alta con MODELO REAL (patrón C2). Conversación completa de principio a fin
// contra el servidor vivo: init (bienvenida desde backend) → conversación → resumen +
// ready → crear con contraseña por campo seguro → auto-login aterrizando en /admin.
// Crea un tenant de prueba y lo limpia al final.
import path from 'path';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { controlDb, getTenantBySlug, getTenantByEmail } from '../core/control-db.js';

const APEX = 'http://localhost:3000';                 // onboarding vive en el apex
const RID = Math.random().toString(36).slice(2, 7);
const HJ = { 'Content-Type': 'application/json' };

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};
const post = async (base, u, body) => {
  const r = await fetch(base + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

function cleanup(slug) {
  if (!slug) return;
  const t = getTenantBySlug(slug);
  if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);   // FK antes que el negocio
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}

let createdSlug = null;
try {
  console.log('\n[1] Bienvenida desde el backend (init)');
  const init = await post(APEX, '/api/registro/init', {});
  const sid = init.body.session_id;
  check('init devuelve session_id', !!sid);
  check('init devuelve bienvenida cálida y abierta (no "solo el nombre")',
    /soy disa/i.test(init.body.reply || '') && /cuéntamelo|háblame|a qué te dedicas/i.test(init.body.reply || ''),
    JSON.stringify((init.body.reply || '').slice(0, 60)));

  console.log('\n[2] Conversación con DISA (modelo real): datos + EMAIL DUPLICADO antes del resumen');
  const DUP_EMAIL = 'ibrahingil@gmail.com';   // ya pertenece al tenant dev → debe rechazarse
  const email = `gate.alta.${RID}.${Date.now()}@ejemplo.com`;
  const bizName = `Peluquería Gate ${RID}`;

  const send = async (msg) => {
    const r = await post(APEX, '/api/registro/disa', { message: msg, session_id: sid });
    check('responde 200', r.status === 200, (r.body.reply || r.body.error || '').slice(0, 50));
    return r.body;
  };

  // Turno 1: nombre + sector + propietario + ubicación (sin email aún).
  await send(`Hola, tengo una peluquería que se llama "${bizName}". Soy Lola Pérez y estoy en Madrid.`);

  // Turno 2: email DUPLICADO → debe verificarse AQUÍ y re-preguntar, SIN resumen ni botón.
  const dup = await send(`Mi email es ${DUP_EMAIL}`);
  check('email duplicado NO marca ready (no aparece el botón)', dup.ready === false);
  check('no se muestra resumen ni botón con el email duplicado', !dup.summary);
  check('DISA avisa de que el email está en uso y pide otro (antes del resumen)',
    /(uso|registrad|existe|otro|distin|otra direcci)/i.test(dup.reply || ''), (dup.reply || '').slice(0, 80));
  check('el marcador [LISTO:...] no se filtra', !/\[LISTO/i.test(dup.reply || ''));

  // Turno 3+: email válido y libre → ahora sí avanza al resumen + ready.
  // Varios empujones de margen para absorber la variabilidad del modelo.
  let ready = false, lastReply = '';
  for (const msg of [`Vale, usa este: ${email}`, 'Sí, correcto.', 'Sí, perfecto, continúa.', 'Correcto, adelante.']) {
    if (ready) break;
    const b = await send(msg);
    lastReply = b.reply || '';
    if (b.ready) {
      ready = true;
      check('con email válido DISA marca ready con resumen', !!b.summary, JSON.stringify(b.summary));
      check('el resumen lleva el email bueno (no el duplicado)', (b.summary?.email || '') === email.toLowerCase());
      check('el resumen lleva el sector', /peluquer/i.test(b.summary?.sector || ''), b.summary?.sector);
      check('el marcador [LISTO:...] NO se muestra al usuario', !/\[LISTO/i.test(lastReply));
    }
  }
  check('la conversación llegó a ready con el email válido', ready);
  if (!ready) throw new Error('No se alcanzó ready: ' + lastReply.slice(0, 120));

  console.log('\n[3] Crear con contraseña por campo seguro; redirect RELATIVO');
  const short = await post(APEX, '/api/registro/crear', { session_id: sid, password: '123' });
  check('contraseña corta rechazada por el servidor', short.status === 400 && short.body.field === 'password',
    `${short.status} ${short.body.field}`);
  const crear = await post(APEX, '/api/registro/crear', { session_id: sid, password: 'clave-gate-1234' });
  check('crear responde 200 con redirect', crear.status === 200 && !!crear.body.redirect, crear.body.redirect);
  const redirect = crear.body.redirect || '';
  check('redirect RELATIVO al host actual (sin subdominio inventado)', redirect.startsWith('/admin/autologin?token='), redirect);
  check('redirect NO contiene ningún host (ni bamburu.com)', !/https?:\/\//.test(redirect));

  const t = getTenantByEmail(email.toLowerCase());
  createdSlug = t?.slug || null;
  check('tenant creado, localizable por email', !!t, createdSlug);

  console.log('\n[4] Auto-login (apex, resuelve el negocio por TOKEN) + vínculo cookie→negocio');
  const r302 = await fetch(APEX + redirect, { redirect: 'manual' });
  const setCookie = r302.headers.get('set-cookie') || '';
  check('autologin responde 302 a /admin', r302.status === 302 && r302.headers.get('location') === '/admin',
    `${r302.status} ${r302.headers.get('location')}`);
  check('autologin fija cookie de sesión asess', /asess=/.test(setCookie));
  const asess = (setCookie.match(/asess=([^;]+)/) || [])[1];
  const bind = controlDb.prepare('SELECT tenant_id FROM tenant_sessions WHERE session_token=?').get(asess);
  check('vínculo asess→negocio registrado y apunta al NUEVO negocio', !!t && bind?.tenant_id === t.id, JSON.stringify(bind));

  console.log('\n[5] En el host apex (sin subdominio) SOLO el vínculo resuelve el panel');
  const panel = await fetch(APEX + '/admin', { headers: { Cookie: 'asess=' + asess } });
  const panelHtml = await panel.text();
  check('GET /admin con la sesión → 200 (panel del nuevo negocio)', panel.status === 200);
  check('es el panel, no el login', !/Introduce tu contrase/i.test(panelHtml) && panelHtml.length > 500);
  // y la sesión vive en la BD del negocio nuevo
  const abs = path.join(process.cwd(), 'data', 'tenants', createdSlug + '.db');
  const tdb = new Database(abs);
  check('sector guardado en el nuevo negocio (defecto F)', (tdb.prepare("SELECT value v FROM settings WHERE key='business_sector'").get()?.v || '').length > 0);
  check('la sesión existe en la BD del nuevo negocio', !!tdb.prepare('SELECT user_id FROM admin_sessions WHERE token=?').get(asess));
  tdb.close();

  console.log('\n[6] Login por /acceso tras crear (BUG REPORTADO): credenciales correctas → entra');
  // Simula un navegador limpio (sin asess): /find-tenant por email → /admin/login con btenant.
  const ft = await fetch(APEX + '/find-tenant', { method: 'POST', headers: HJ, body: JSON.stringify({ email }) });
  const ftBody = await ft.json();
  const ftCookie = ft.headers.get('set-cookie') || '';
  check('/find-tenant encuentra el negocio por email', ft.status === 200 && ftBody.slug === createdSlug, JSON.stringify(ftBody));
  check('/find-tenant fija cookie btenant con el slug', new RegExp('btenant=' + createdSlug).test(ftCookie), ftCookie.split(';')[0]);
  const btenant = (ftCookie.match(/btenant=([^;]+)/) || [])[1];
  const loginRes = await fetch(APEX + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'btenant=' + btenant },
    body: new URLSearchParams({ email, password: 'clave-gate-1234' }).toString(),
  });
  const loginCookie = loginRes.headers.get('set-cookie') || '';
  check('login con credenciales CORRECTAS → 302 /admin (no "credenciales incorrectas")',
    loginRes.status === 302 && loginRes.headers.get('location') === '/admin', `${loginRes.status} ${loginRes.headers.get('location')}`);
  check('login fija sesión asess', /asess=/.test(loginCookie));
  const asess2 = (loginCookie.match(/asess=([^;]+)/) || [])[1];
  const panel2 = await fetch(APEX + '/admin', { headers: { Cookie: 'asess=' + asess2 } });
  check('entra al panel del negocio tras login por /acceso', panel2.status === 200);
  // contraprueba: contraseña incorrecta → NO entra (302 a error)
  const bad = await fetch(APEX + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'btenant=' + btenant },
    body: new URLSearchParams({ email, password: 'mal-mal-mal' }).toString(),
  });
  check('contraseña incorrecta → NO entra (302 a error, no a /admin)',
    bad.status === 302 && bad.headers.get('location') !== '/admin', bad.headers.get('location'));
} catch (e) {
  fail++; console.log('  ✗ EXCEPCIÓN:', e.message);
} finally {
  console.log('\n[limpieza] eliminando el tenant de prueba:', createdSlug);
  try { cleanup(createdSlug); console.log('  ✓ tenant de prueba eliminado'); }
  catch (e) { console.log('  ✗ no se pudo limpiar:', e.message); }
}

console.log(`\n===== RESULTADO: ${ok} OK, ${fail} fallos =====`);
process.exit(fail ? 1 : 0);
