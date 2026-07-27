// Test — TEXTOS de citas (AGENDA SENCILLA §1/§5), sobre el servidor real.
//   node scripts/test-textos-citas.mjs
//
// Demuestra: en las pantallas de citas NO aparece la jerga "recurso", "token" ni "tiempo muerto";
// y el nombre CONFIGURABLE de los puestos (silla/cabina/…) se aplica en TODAS las pantallas.
// (No renombra tablas ni código: solo lo que ve el usuario.)
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';

const BASE = 'http://desarrollo-bamburu.localhost:3000', HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 LIMIT 1").get();
const now = Math.floor(Date.now() / 1000), tok = 'txt-' + Date.now();
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tok, owner.id, now, now + 3600, 'x');
// Guardamos el label actual para restaurarlo; probamos con "Cabinas".
const prev = db.prepare('SELECT cita_puesto_sing, cita_puesto_plural FROM company_config WHERE id=1').get() || {};
let b;
const VISIBLE = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')   // el JS del cliente lleva variables como recurso_id/token: NO es texto en pantalla
  .replace(/<[^>]+>/g, ' ');                       // quitar etiquetas → solo el texto visible

try {
  db.prepare("UPDATE company_config SET cita_puesto_sing='Cabina', cita_puesto_plural='Cabinas' WHERE id=1").run();
  b = await puppeteer.launch(launchOpts());
  const p = await b.newPage();
  await p.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/' });

  const paginas = { agenda: '/admin/citas', servicios: '/admin/citas/servicios', puestos: '/admin/citas/recursos', horarios: '/admin/citas/horarios', ajustes: '/admin/citas/ajustes', cola: '/admin/citas/cola' };
  const textos = {};
  for (const [k, path] of Object.entries(paginas)) {
    await p.goto(BASE + path, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 300));
    textos[k] = VISIBLE(await p.content());
  }

  console.log('\n=== 1. sin jerga en pantalla ===\n');
  for (const [k, t] of Object.entries(textos)) {
    ok(!/\brecursos?\b/i.test(t), 'la pantalla «' + k + '» no dice "recurso"', (t.match(/\brecursos?\b/i) || [''])[0]);
  }
  for (const [k, t] of Object.entries(textos)) ok(!/\btiempo muerto\b/i.test(t), 'la pantalla «' + k + '» no dice "tiempo muerto"');
  for (const [k, t] of Object.entries(textos)) ok(!/\btoken\b|\bslot\b/i.test(t), 'la pantalla «' + k + '» no dice "token" ni "slot"');

  console.log('\n=== 2. el nombre configurable del puesto se aplica en todas las pantallas ===\n');
  ok(/Cabinas/.test(textos.puestos), 'la pantalla de puestos usa el nombre elegido (Cabinas)');
  ok(/Cabina/.test(textos.servicios), 'la pantalla de servicios pide la «Cabina necesaria»');
  ok(/Por cabina/i.test(textos.agenda) || /Cabina/.test(textos.agenda), 'la agenda ofrece el eje «Por cabina»');
  ok(/Cabina/.test(textos.ajustes), 'ajustes muestra el nombre del puesto');
  // En el menú (cualquiera de las páginas lleva el nav): la entrada de puestos se llama "Cabinas".
  ok(/Cabinas/.test(textos.agenda), 'el menú lateral llama "Cabinas" a los puestos');

  console.log('\n=== 3. el enlace de la cita se llama "enlace" (no "token") ===\n');
  ok(/enlace/i.test(textos.cola), 'la cola habla de "enlace", no de "token"');

  console.log('\n' + (fail === 0 ? '✅ TODO VERDE' : '❌ HAY FALLOS') + ` — ${pass} ok, ${fail} fallos`);
  await b.close();
} catch (e) { console.error('💥', e.stack || e.message); fail++; try { await b.close(); } catch {} }
finally {
  try { db.prepare('UPDATE company_config SET cita_puesto_sing=?, cita_puesto_plural=? WHERE id=1').run(prev.cita_puesto_sing || 'Puesto', prev.cita_puesto_plural || 'Puestos'); } catch {}
  try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok); } catch {}
  db.close();
}
process.exit(fail ? 1 : 0);
