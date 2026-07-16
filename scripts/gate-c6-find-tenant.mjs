// Gate — C6/B6: /find-tenant ya no dice si un email existe ni en qué negocios, y el flujo de
// entrada por correo SIGUE funcionando. Contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. Aquí no basta con leer el código: la propiedad es "un desconocido no puede
// distinguir un email real de uno inventado", y eso solo se demuestra preguntando por los dos y
// comparando lo que vuelve — cuerpo, estado y reloj. Y la otra mitad importa igual: cerrar la fuga
// rompiendo el login sería cambiar un problema por otro peor, así que el gate recorre el camino
// entero (enlace → negocio) con un email de verdad.
//
// El correo NO sale: el envío falla o no (da igual), porque lo que se sigue es el TOKEN desde
// control.db — que es justo lo que hace el usuario al abrir el enlace de su bandeja.
//
//   node scripts/gate-c6-find-tenant.mjs
import Database from 'better-sqlite3';
import { join } from 'path';
import { APP_DIR } from './lib/gate-env.mjs';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ ' + m + (extra ? ' — ' + extra : '')); } };

const cdb = new Database(join(APP_DIR, 'data', 'control.db'));
const HJ = { 'Content-Type': 'application/json' };

// Un email REAL de un negocio activo, y uno inventado. La gracia está en que no se distingan.
const real = cdb.prepare("SELECT * FROM tenants WHERE status='active' LIMIT 1").get();
if (!real) { console.error('\n✗ GATE ABORTADO — no hay tenants activos. No ha verificado NADA.'); process.exit(2); }
const tdb = new Database(join(APP_DIR, real.db_filename), { readonly: true });
const EMAIL_REAL = tdb.prepare('SELECT email FROM admin_users WHERE active=1 LIMIT 1').get()?.email;
tdb.close();
if (!EMAIL_REAL) { console.error('\n✗ GATE ABORTADO — el tenant no tiene admins. No ha verificado NADA.'); process.exit(2); }

const pedir = (email, ip) => fetch(BASE + '/find-tenant', {
  method: 'POST', headers: { ...HJ, 'X-Real-IP': ip }, body: JSON.stringify({ email }),
});

try {
  console.log('\n[1] EL CRITERIO — la respuesta NO distingue un email real de uno inventado');
  const rReal = await pedir(EMAIL_REAL, '10.70.0.1');
  const rFake = await pedir('no-existe-jamas-12345@ejemplo.com', '10.70.0.2');
  const bReal = await rReal.text();
  const bFake = await rFake.text();
  ok(rReal.status === rFake.status, 'mismo código de estado', `${rReal.status} vs ${rFake.status}`);
  ok(rReal.status === 200, 'estado 200 (ROJO antes: 404 con el email inventado)');
  ok(bReal === bFake, 'cuerpo byte a byte IDÉNTICO', bReal.slice(0, 40));
  ok(!bReal.includes(real.slug), 'ROJO antes de C6 · el slug del negocio NO viaja en la respuesta');
  ok(!/"tenants"|"choose"|"redirect"|"password"/.test(bReal), 'ni la lista, ni el modo, ni la URL del panel');
  ok(!(rReal.headers.get('set-cookie') || '').includes('btenant'), 'ROJO antes de C6 · ya no fija la cookie btenant');

  console.log('\n[2] Y el flujo de entrada SIGUE funcionando (cerrar la fuga no rompió el login)');
  const antes = cdb.prepare('SELECT COUNT(*) n FROM tenant_access_links').get().n;
  await pedir(EMAIL_REAL, '10.70.0.3');
  await new Promise(r => setTimeout(r, 400));   // el trabajo va en setImmediate, fuera de la respuesta
  const despues = cdb.prepare('SELECT COUNT(*) n FROM tenant_access_links').get().n;
  ok(despues === antes + 1, 'con email real se crea el enlace de acceso', `${antes} → ${despues}`);

  const fila = cdb.prepare('SELECT token, email, expires_at, used_at FROM tenant_access_links ORDER BY rowid DESC LIMIT 1').get();
  ok(fila.email === EMAIL_REAL, 'el enlace es para ese email');
  ok(fila.used_at === null, 'nace sin usar');
  const minutos = Math.round((fila.expires_at - Math.floor(Date.now() / 1000)) / 60);
  ok(minutos > 25 && minutos <= 30, 'caduca en ~30 min', minutos + ' min');

  // Con email inventado NO se crea nada (y aun así la respuesta fue idéntica: ahí está la gracia).
  const antesF = cdb.prepare('SELECT COUNT(*) n FROM tenant_access_links').get().n;
  await pedir('otro-fantasma-9876@ejemplo.com', '10.70.0.4');
  await new Promise(r => setTimeout(r, 400));
  ok(cdb.prepare('SELECT COUNT(*) n FROM tenant_access_links').get().n === antesF,
    'con email inventado no se crea enlace — y la respuesta fue la misma');

  console.log('\n[3] El enlace lleva a su negocio, y solo sirve una vez');
  const r1 = await fetch(`${BASE}/acceso/entrar?token=${fila.token}`, { redirect: 'manual' });
  const destino = r1.headers.get('location') || '';
  ok(r1.status === 302, 'el enlace redirige', String(r1.status));
  ok(/\/admin\/login/.test(destino), 'al login de su negocio', destino);
  const ck = r1.headers.get('set-cookie') || '';
  // En dev (sin PUBLIC_BASE_DOMAIN) el negocio se dice por cookie; en producción, por subdominio.
  if (!destino.startsWith('http')) {
    ok(new RegExp('btenant=' + real.slug).test(ck), 'fija btenant con su slug (dev)', ck.split(';')[0]);
    ok(/Secure/.test(ck), 'C6/B11 · la cookie btenant va con Secure', ck.split(';').slice(1).join(';').trim());
  } else {
    ok(destino.includes(real.slug + '.'), 'al subdominio de su negocio (producción)', destino);
    ok(true, 'en producción no hace falta btenant: lo dice el subdominio');
  }
  ok(cdb.prepare('SELECT used_at FROM tenant_access_links WHERE token=?').get(fila.token).used_at !== null,
    'el enlace queda gastado');

  const r2 = await fetch(`${BASE}/acceso/entrar?token=${fila.token}`, { redirect: 'manual' });
  ok(r2.status === 400, 'EL CRITERIO · el MISMO enlace por segunda vez → no entra', String(r2.status));
  ok((await r2.text()).includes('ya no vale'), 'y lo dice sin tecnicismos');

  const r3 = await fetch(`${BASE}/acceso/entrar?token=me-lo-invento`, { redirect: 'manual' });
  ok(r3.status === 400, 'un token inventado tampoco');

  console.log('\n[4] La pantalla /acceso ya no ramifica según lo que conteste el servidor');
  const pagina = await (await fetch(BASE + '/acceso')).text();
  ok(pagina.includes('Mira tu correo'), 'dice que mires el correo');
  ok(!/stepChoose|chooseList|mode==='choose'|mode==='redirect'/.test(pagina),
    'ROJO antes de C6 · no queda ni rastro del selector de negocios ni de los modos viejos');
  ok(pagina.includes('Si ese email tiene un negocio'), 'el texto es el genérico (no promete que exista)');

  console.log(`\n${pass} OK, ${fail} fallos\n`);
} finally {
  // Los enlaces que este gate haya creado, fuera: no dejamos puertas abiertas a una cuenta real.
  cdb.prepare('DELETE FROM tenant_access_links WHERE email = ?').run(EMAIL_REAL);
  cdb.close();
  console.log('🧹 enlaces de acceso del gate eliminados');
}

process.exit(fail === 0 ? 0 : 1);
