#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DE LA PUERTA DE DISA — que ninguna ruta de escritura quede fuera de la protección común.
//
// DE DÓNDE SALE (AUD-006). El router de DISA se montaba directo y **no heredaba el `csrfProtect()`
// que sí llevan los routers del ERP**: nueve rutas de escritura sin ninguna protección. Con la
// sesión de la víctima abierta, una página ajena podía mandarle un mensaje a DISA en su nombre o
// subirle un adjunto que arranca la lectura por IA de una factura.
//
// QUÉ VIGILA, y son DOS cosas distintas:
//   1. **Que la puerta siga puesta**: el router de DISA se monta detrás de un `Hono` que hace
//      `use('*', adminAuth(db))` y `use('*', csrfProtect())`, EN ESE ORDEN. El orden no es un
//      detalle: `csrfProtect()` lee `c.get('session')` y devuelve 401 si no la encuentra, así que
//      con el auth detrás **todas las escrituras darían 401** y DISA quedaría inservible.
//   2. **Que nadie monte rutas de DISA por fuera de esa puerta**: si aparece un
//      `app.route('/…disa…', X)` donde `X` no es la puerta, es un camino sin protección.
//
// LO QUE NO VIGILA, a propósito: las rutas de solo lectura. `csrfProtect()` deja pasar GET, HEAD y
// OPTIONS, así que no hay nada que comprobar ahí — y exigirlo daría un rojo permanente, que es como
// se enseña a ignorar un centinela.
//
// SE PRUEBA A SÍ MISMO en cada pasada, antes de mirar el producto: un censo que dice cero sin ser
// cierto es peor que no tenerlo, porque cierra la pregunta.
//
//   node scripts/censo-disa-csrf.mjs
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { soloCodigo, sinComentariosHtml, sinComentariosDeLinea } from './lib/solo-codigo.mjs';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const FICHERO = 'modules/disa/index.js';

const limpiar = (src) =>
  sinComentariosHtml(soloCodigo(src)).split('\n').map(sinComentariosDeLinea).join('\n');

// La puerta: un Hono que aplica auth y DESPUÉS csrf, y que lleva el router dentro.
const RE_AUTH  = /(\w+)\s*\.use\(\s*'\*'\s*,\s*adminAuth\(\s*db\s*\)\s*\)/;
const RE_CSRF  = /(\w+)\s*\.use\(\s*'\*'\s*,\s*csrfProtect\(\s*\)\s*\)/;
const RE_DENTRO = (p) => new RegExp('\\b' + p + '\\s*\\.route\\(\\s*[\'"]\\/[\'"]\\s*,\\s*router\\s*\\)');
// Los montajes de DISA en la app: qué se monta en cada dirección.
const RE_MONTA = /app\s*\.route\(\s*'([^']*disa[^']*)'\s*,\s*(\w+)\s*\)/gi;
// Escrituras declaradas en el router (para poder decir cuántas cubre la puerta).
const RE_ESCRIBE = /router\.(post|put|patch|delete)\(\s*'([^']*)'/g;

function analizar(codigo) {
  const mAuth = RE_AUTH.exec(codigo);
  const mCsrf = RE_CSRF.exec(codigo);
  if (!mAuth || !mCsrf) return { ok: false, motivo: 'no encuentro la puerta: falta el use(\'*\', adminAuth(db)) o el use(\'*\', csrfProtect())' };
  if (mAuth[1] !== mCsrf[1]) return { ok: false, motivo: 'el auth y el csrf no están en la misma puerta (' + mAuth[1] + ' vs ' + mCsrf[1] + ')' };
  if (mAuth.index > mCsrf.index) return { ok: false, motivo: 'el csrf va ANTES que el auth: sin sesión, csrfProtect devuelve 401 y DISA queda inservible' };
  const puerta = mAuth[1];
  if (!RE_DENTRO(puerta).test(codigo)) return { ok: false, motivo: 'la puerta «' + puerta + '» no lleva el router dentro (' + puerta + '.route(\'/\', router))' };
  const fuera = [];
  for (const m of codigo.matchAll(RE_MONTA)) if (m[2] !== puerta) fuera.push(m[1] + ' → ' + m[2]);
  if (fuera.length) return { ok: false, motivo: 'hay montajes de DISA fuera de la puerta: ' + fuera.join(', ') };
  return { ok: true, puerta, montajes: [...codigo.matchAll(RE_MONTA)].map(m => m[1]) };
}

// ── AUTOPRUEBA ───────────────────────────────────────────────────────────────────────────────────
const BUENA = "const p = new Hono();\np.use('*', adminAuth(db));\np.use('*', csrfProtect());\np.route('/', router);\napp.route('/admin/disa', p);\napp.route('/api/disa', p);";
const MUESTRAS = [
  { ok: true,  nombre: 'la puerta bien puesta', src: BUENA },
  { ok: false, nombre: 'sin csrf en la puerta', src: BUENA.replace("p.use('*', csrfProtect());\n", '') },
  { ok: false, nombre: 'el csrf ANTES que el auth', src: "const p = new Hono();\np.use('*', csrfProtect());\np.use('*', adminAuth(db));\np.route('/', router);\napp.route('/admin/disa', p);" },
  { ok: false, nombre: 'un montaje por fuera de la puerta', src: BUENA + "\napp.route('/api/disa2', router);" },
  { ok: false, nombre: 'la puerta no lleva el router dentro', src: BUENA.replace("p.route('/', router);\n", '') },
];
let autofallos = 0;
for (const m of MUESTRAS) {
  const r = analizar(limpiar(m.src));
  if (r.ok !== m.ok) {
    autofallos++;
    say('  ✗ AUTOPRUEBA «' + m.nombre + '»: se esperaba ' + (m.ok ? 'VERDE' : 'ROJO') + ' y salió ' + (r.ok ? 'verde' : 'rojo · ' + r.motivo));
  }
}
if (autofallos) {
  say('\n✗ EL CENSO NO SE FÍA DE SÍ MISMO: ' + autofallos + ' de ' + MUESTRAS.length + ' muestras mal juzgadas.');
  say('  No ha mirado el producto. Un censo ciego que dice CERO es peor que no tenerlo.');
  say('RESULTADO: 0 ✓  ·  1 ✗');
  process.exit(1);
}

// ── EL PRODUCTO ──────────────────────────────────────────────────────────────────────────────────
const ruta = path.join(RAIZ, FICHERO);
if (!fs.existsSync(ruta)) {
  // Si el fichero se mueve, esto NO puede decir «todo bien»: no ha comprobado nada.
  say('\n✗ NO EXISTE ' + FICHERO + ': el censo no ha podido comprobar NADA. Esto no es un aprobado.');
  say('RESULTADO: 0 ✓  ·  1 ✗');
  process.exit(1);
}
const codigo = limpiar(fs.readFileSync(ruta, 'utf8'));
const r = analizar(codigo);
const escrituras = [...codigo.matchAll(RE_ESCRIBE)].map(m => m[1].toUpperCase() + ' ' + m[2]);

say('\nAUTOPRUEBA: ' + MUESTRAS.length + '/' + MUESTRAS.length + ' muestras bien juzgadas (1 buena respetada, 4 averías cazadas)');
say('RUTAS DE ESCRITURA EN EL ROUTER DE DISA: ' + escrituras.length);
for (const e of escrituras) say('  · ' + e);

if (r.ok) {
  say('\n✓ LA PUERTA ESTÁ PUESTA: «' + r.puerta + '» aplica adminAuth y DESPUÉS csrfProtect, y lleva el router dentro.');
  say('  Montada en: ' + r.montajes.join(' y ') + ' — las dos por la misma puerta.');
  say('  Las ' + escrituras.length + ' escrituras la heredan; una ruta nueva nace protegida.');
} else {
  say('\n✗ LA PUERTA DE DISA NO ESTÁ BIEN: ' + r.motivo);
  say('  Se monta como en el ERP (modules/erp/routes/index.js:124-126):');
  say("    const puerta = new Hono();");
  say("    puerta.use('*', adminAuth(db));   // primero el auth: csrfProtect necesita la sesión");
  say("    puerta.use('*', csrfProtect());");
  say("    puerta.route('/', router);");
}
say('\nRESULTADO: ' + (r.ok ? 1 : 0) + ' ✓  ·  ' + (r.ok ? 0 : 1) + ' ✗');
process.exit(r.ok ? 0 : 1);
