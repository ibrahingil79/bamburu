// DESPLEGAR — el último paso de CUALQUIER tarea que toque código servido.
//
// NACE DE UN FALLO REAL (18 ago 2026): tres commits empujados, gates en verde, y la dirección pública
// enseñando la agenda de antes. Node carga los módulos AL ARRANCAR, así que un fichero editado y no
// reiniciado no existe para nadie: el repo dice una cosa y la pantalla otra.
//
// Una tarea NO está hecha cuando el commit está empujado. Está hecha cuando se ve en la dirección
// pública. Esto lo comprueba y lo dice, en vez de darlo por supuesto.
//
//   node scripts/desplegar.mjs              → reinicia si hace falta y verifica
//   node scripts/desplegar.mjs --verificar  → solo mira, no reinicia
import { execSync } from 'child_process';
import { statSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { controlDb } from '../core/control-db.js';
import { APP_DIR } from './lib/gate-env.mjs';

const soloVerificar = process.argv.includes('--verificar');
const REF = process.env.BAMBURU_DOMINIO_REF || 'peluqueria-gil.bamburu.com';
let fallos = 0;
const ok = (c, m, x = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x ? ' — ' + x : '')); if (!c) fallos++; };

function masNuevo() {
  let max = 0, cual = '';
  const mirar = r => {
    let st; try { st = statSync(r); } catch { return; }
    if (st.isDirectory()) { for (const f of readdirSync(r)) mirar(join(r, f)); return; }
    if (!/\.(js|mjs)$/.test(r)) return;
    if (st.mtimeMs > max) { max = st.mtimeMs; cual = r; }
  };
  for (const d of ['modules', 'core', 'index.js']) mirar(join(APP_DIR, d));
  return { ms: max, fichero: cual.replace(APP_DIR + '/', '') };
}
const arranque = () => Date.parse(execSync('systemctl show bamburu -p ActiveEnterTimestamp --value', { encoding: 'utf8' }).trim());

console.log('\n══ DESPLIEGUE ══');
const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const sucio = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
console.log('  commit en el repo: ' + commit + (sucio ? '  ⚠️  con cambios SIN commitear' : ''));

let a = arranque(), n = masNuevo();
console.log('  proceso levantado: ' + new Date(a).toISOString());
console.log('  fichero más nuevo: ' + n.fichero + ' (' + new Date(n.ms).toISOString() + ')');

// ── LA SINTAXIS, ANTES DE REINICIAR ────────────────────────────────────────────────────────────
// ⚙️ 5 SEP 2026. Nace de un fallo real de esta misma tarde: se desplegó un fichero con un acento
// grave dentro de un comentario que vive en una plantilla de texto —el error que ya ha mordido
// siete veces en este repositorio— y el servicio no arrancó. **Producción estuvo en 502 cerca de un
// minuto**, y el aviso que lo habría dicho estaba silenciado en la llamada.
//
// Reiniciar con el código roto es la única forma de tirar Bamburu con un despliegue. Comprobar la
// sintaxis antes cuesta un segundo y lo impide: si algo no compila, NO se reinicia y se dice cuál.
function sintaxisSana() {
  const malos = [];
  const ver = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
      const p2 = join(dir, e.name);
      if (e.isDirectory()) { ver(p2); continue; }
      if (!e.name.endsWith('.js') && !e.name.endsWith('.mjs')) continue;
      try { execSync('node --check ' + JSON.stringify(p2), { stdio: 'pipe' }); }
      catch (err) {
        const txt = String(err.stderr || err.stdout || err.message);
        malos.push(p2.replace(APP_DIR + '/', '') + ' — ' + (txt.split('\n').find(l => /Error/.test(l)) || '').trim());
      }
    }
  };
  for (const d of ['core', 'modules', 'scripts']) { try { ver(join(APP_DIR, d)); } catch { /* no existe */ } }
  try { execSync('node --check ' + JSON.stringify(join(APP_DIR, 'index.js')), { stdio: 'pipe' }); }
  catch { malos.push('index.js — no compila'); }
  return malos;
}
const rotos = sintaxisSana();
ok(rotos.length === 0, 'todo el código compila ANTES de reiniciar',
   rotos.length ? rotos.length + ' fichero(s): ' + rotos[0] : '');
for (const m of rotos.slice(0, 5)) console.error('      · ' + m);
if (rotos.length) {
  console.error('\n  ✗ NO SE REINICIA: reiniciar con esto tumbaría producción. Arregla y repite.');
  process.exit(1);
}

if (n.ms > a + 2000) {
  if (soloVerificar) { ok(false, 'el proceso NO sirve el código de disco', 'falta reiniciar'); }
  else {
    console.log('\n  → el proceso es más viejo que el código: REINICIANDO');
    execSync('sudo systemctl restart bamburu');
    await new Promise(r => setTimeout(r, 3000));
    a = arranque();
    console.log('  proceso levantado: ' + new Date(a).toISOString());
  }
}
ok(masNuevo().ms <= a + 2000, 'el proceso sirve el código que hay en disco');
ok(execSync('systemctl is-active bamburu', { encoding: 'utf8' }).trim() === 'active', 'el servicio está vivo');

// Y la prueba que de verdad cierra la tarea: pedirle a la DIRECCIÓN PÚBLICA una pantalla con sesión.
const slug = REF.split('.')[0];
const t = controlDb.prepare('SELECT slug, db_filename FROM tenants WHERE slug=?').get(slug);
if (!t) { ok(false, 'no existe el negocio de referencia «' + slug + '» para probar la dirección pública'); }
else {
  const db = new Database(t.db_filename.startsWith('/') ? t.db_filename : join(APP_DIR, t.db_filename));
  const u = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1").get()
         || db.prepare('SELECT id FROM admin_users WHERE active=1 LIMIT 1').get();
  const tok = randomBytes(32).toString('base64url');
  const s = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, u.id, s, s + 180, randomBytes(32).toString('base64url'));
  try {
    const r = await fetch('https://' + REF + '/admin/citas', { headers: { cookie: 'asess=' + tok, 'Cache-Control': 'no-cache' } });
    const html = await r.text();
    ok(r.status === 200, 'https://' + REF + ' responde', 'HTTP ' + r.status);
    ok(html.length > 5000, 'y devuelve la pantalla entera', html.length + ' bytes');
    // Huella del código servido: sirve para ver de un vistazo QUÉ está sirviendo, no solo que responde.
    const marcas = ['ag-wrap', 'agcol-head', 'ag-ahora', 'ruedaMes', 'agZoom', 'cResuelveCliente'];
    const faltan = marcas.filter(m => !html.includes(m));
    ok(faltan.length === 0, 'y sirve el código de la agenda al día', faltan.length ? 'FALTAN: ' + faltan.join(', ') : marcas.length + ' marcadores');
  } catch (e) { ok(false, 'no se pudo pedir a la dirección pública', String(e.message || e).slice(0, 90)); }
  finally { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok); db.close(); }
}
console.log('\n' + (fallos ? '✗ EL DESPLIEGUE NO ESTÁ LIMPIO: ' + fallos + ' fallo(s). La tarea NO está hecha.'
                           : '✓ DESPLEGADO Y VISIBLE EN LA DIRECCIÓN PÚBLICA. Ahora sí está hecha.'));
process.exit(fallos ? 1 : 0);
