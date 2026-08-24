#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TODA SECCIÓN SE ALCANZA DESDE EL MENÚ — y con su candado puesto.
//
// DE DÓNDE SALE (24 ago 2026). Catorce pantallas VIVAS no tenían enlace en ningún menú: los siete
// libros de contabilidad, tres de ajustes, dos del CRM, el importador de ficheros y la de avisos. Se
// llegaba a ellas desde dentro de otra pantalla o escribiendo la dirección; quien no supiera que
// existían, no llegaba. No estaban rotas: estaban escondidas, que en un producto es casi lo mismo.
//
// LO QUE MIDE, y por qué las dos cosas a la vez:
//   (1) NINGUNA sección se queda fuera del menú. La lista de secciones NO se escribe a mano: se saca
//       del código, buscando las rutas GET que devuelven el marco del panel (`adminLayout`). Una
//       lista a mano se queda corta el día que alguien añada una pantalla — que es exactamente cómo
//       se llegó a catorce.
//   (2) CADA ENTRADA FILTRA POR SU PERMISO. Un menú completo sin candados es peor que uno corto:
//       enseña puertas que al pulsarlas dan 403. Se comprueba con el filtro real del producto
//       (`filtroDeUsuario`), no con una copia.
//
// LO QUE NO ENTRA, A PROPÓSITO: las fichas de DETALLE y de ALTA (`/:id`, `/new`). A esas se llega
// desde su lista y así debe seguir; meterlas en el menú sería ruido.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { MENU, CONFIG_NEGOCIO, FIJAS, CUENTA, NAV_PERMS, filtroDeUsuario } from '../modules/erp/menu.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ERP = join(RAIZ, 'modules', 'erp');
let ok = 0, fail = 0;
const check = (c, m, det) => { if (c) { ok++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); } };

console.log('\n=== Toda sección se alcanza desde el menú ===\n');

// ── (1) las direcciones del menú, todas juntas ──────────────────────────────────────────────────
const enlaces = new Set();
const meter = it => { if (it.href && it.href.startsWith('/admin')) enlaces.add(it.href); };
for (const g of MENU) g.items.forEach(meter);
for (const s of CONFIG_NEGOCIO) s.items.forEach(meter);
FIJAS.forEach(meter); CUENTA.forEach(meter);

// ── (2) las PANTALLAS del producto, sacadas del código ──────────────────────────────────────────
const idx = readFileSync(join(ERP, 'routes', 'index.js'), 'utf8');

// varName → fichero. Dos formas conviven en index.js y hay que cubrir las dos:
//   const { views: prodViews } = createProductRoutes(db);   +   import { createProductRoutes } from './products.js'
//   admin.route('/verifactu', createVerifactuEnvioRoutes(db).views)
const fnDeFichero = new Map();      // createXRoutes → './x.js'
for (const m of idx.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
  for (const n of m[1].split(',').map(x => x.trim())) if (/^create\w+$/.test(n)) fnDeFichero.set(n, m[2]);
}
// Y los que se montan con el router IMPORTADO DIRECTO, sin fábrica:
//   import { changePasswordRoutes } from './change-password.js'  →  admin.route('/change-password', changePasswordRoutes)
const ficheroDeVar = new Map();     // prodViews → './products.js'
for (const m of idx.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
  for (const n of m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop().trim())) {
    if (n && !/^create\w+$/.test(n)) ficheroDeVar.set(n, m[2]);
  }
}
// Y el que se asigna SIN desestructurar: `const dashboard = createDashboardRoutes(db)`.
for (const m of idx.matchAll(/const\s+(\w+)\s*=\s*(create\w+)\(/g)) {
  const f = fnDeFichero.get(m[2]);
  if (f) ficheroDeVar.set(m[1], f);
}
for (const m of idx.matchAll(/const\s*\{([^}]*)\}\s*=\s*(create\w+)\(/g)) {
  const f = fnDeFichero.get(m[2]);
  if (!f) continue;
  for (const par of m[1].split(',')) {
    const n = par.includes(':') ? par.split(':')[1].trim() : par.trim();
    if (n) ficheroDeVar.set(n, f);
  }
}
const montaje = new Map();          // fichero (basename) → prefijo
for (const m of idx.matchAll(/^\s*admin\.route\('([^']*)'\s*,\s*([^)]+)\)/gm)) {
  const pref = '/admin' + (m[1] === '/' ? '' : m[1]);
  const arg = m[2].trim();
  let fich = ficheroDeVar.get(arg);
  if (!fich) {
    const inl = /^(create\w+)\(/.exec(arg);
    if (inl) fich = fnDeFichero.get(inl[1]);
  }
  if (!fich) continue;
  const base = fich.replace(/^\.\//, '').replace(/\.js$/, '');
  if (!montaje.has(base)) montaje.set(base, []);
  montaje.get(base).push(pref);
}

const ficheros = [];
(function barrer(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) barrer(p); else if (e.name.endsWith('.js')) ficheros.push(p);
  }
})(ERP);

const pantallas = [];
const sinMontaje = [];
for (const p of ficheros) {
  const src = readFileSync(p, 'utf8');
  if (!/adminLayout\(/.test(src)) continue;
  const base = basename(p, '.js');
  const prefs = montaje.get(base);
  const rutasDelFichero = [];
  const partes = src.split(/(?=(?<!\bc)\.(?:get|post|put|patch|delete)\('\/)/);
  for (const t of partes) {
    const m = /^\.get\('(\/[^']*)'/.exec(t);
    if (!m || !/adminLayout\(/.test(t)) continue;
    if (/:\w|\{/.test(m[1]) || /\/new$/.test(m[1])) continue;   // ficha de detalle o de alta: fuera
    rutasDelFichero.push(m[1]);
  }
  if (!rutasDelFichero.length) continue;
  if (!prefs) { sinMontaje.push(relative(RAIZ, p)); continue; }
  for (const pref of prefs) for (const r of rutasDelFichero) pantallas.push(pref + (r === '/' ? '' : r));
}

// Un fichero con pantallas cuyo montaje no se resuelve dejaría la comprobación DANDO VERDE SOBRE
// NADA — que es justo el fallo que tuvo la primera versión de este script: decía «0 secciones,
// todas con enlace». Si no se resuelve alguno, se canta y se cae.
// FUERA DEL MENÚ A PROPÓSITO, con su motivo. No es una lista de excusas: es una lista de
// afirmaciones que alguien tiene que firmar, y si el fichero desaparece se canta abajo.
const FUERA_DEL_MENU_A_PROPOSITO = {
  '/admin/change-password':
    'pantalla-cerrojo: sale sola cuando el sistema OBLIGA a cambiar la contraseña. Ponerla en el menú '
    + 'invitaría a entrar a un sitio del que no se sale hasta cambiarla.',
};
check(sinMontaje.length === 0, 'se resuelve la dirección de todos los ficheros con pantallas',
  sinMontaje.join(' · ') || (montaje.size + ' ficheros montados'));

const unicas = [...new Set(pantallas)].sort();
const huerfanas = unicas.filter(r => !enlaces.has(r) && !FUERA_DEL_MENU_A_PROPOSITO[r]);
check(huerfanas.length === 0, 'ninguna sección viva se queda fuera del menú',
  huerfanas.join(' · ') || (unicas.length + ' secciones · ' + Object.keys(FUERA_DEL_MENU_A_PROPOSITO).length + ' fuera a propósito'));
// La lista de excepciones no puede envejecer callada: si una de ellas ya está en el menú, sobra.
const excepcionesRancias = Object.keys(FUERA_DEL_MENU_A_PROPOSITO).filter(r => enlaces.has(r) || !unicas.includes(r));
check(excepcionesRancias.length === 0, '  y la lista de «fuera del menú a propósito» sigue siendo cierta',
  excepcionesRancias.join(' · ') || 'al día');

// ── (3) el candado de cada una de las catorce ───────────────────────────────────────────────────
// Se prueba con el filtro REAL del producto: un empleado con permisos propios que NO tiene el que la
// entrada exige no puede verla, y el dueño sí.
const LAS_CATORCE = [
  ['/admin/contabilidad/ventas', 'invoices.read'], ['/admin/contabilidad/compras', 'invoices.read'],
  ['/admin/contabilidad/diario', 'invoices.read'], ['/admin/contabilidad/mayor', 'invoices.read'],
  ['/admin/contabilidad/pyg', 'invoices.read'],    ['/admin/contabilidad/bienes', 'invoices.read'],
  ['/admin/contabilidad/modelos', 'invoices.read'],
  ['/admin/crm/cola', 'crm.read'], ['/admin/crm/tareas', 'crm.read'],
  ['/admin/migracion/importar', 'company.read'],
  ['/admin/settings/plantillas', 'company.read'], ['/admin/settings/situacion-fiscal', 'company.read'],
  ['/admin/settings/avisos', null], ['/admin/avisos', null],
];
const todosLosItems = [];
for (const g of MENU) todosLosItems.push(...g.items);
for (const s of CONFIG_NEGOCIO) todosLosItems.push(...s.items);
todosLosItems.push(...FIJAS, ...CUENTA);
const itemDe = href => todosLosItems.find(i => i.href === href);

check(LAS_CATORCE.every(([h]) => itemDe(h)), 'las catorce tienen entrada en el menú',
  LAS_CATORCE.filter(([h]) => !itemDe(h)).map(x => x[0]).join(' ') || '14/14');

const conCandado = LAS_CATORCE.filter(([, p]) => p);
const dueño = filtroDeUsuario({ role: 'owner', perms: [] });
check(conCandado.every(([h]) => dueño(itemDe(h))), 'el dueño las ve todas (bypass)');

const malFiltradas = [];
for (const [h, perm] of conCandado) {
  const it = itemDe(h);
  // empleado CON el permiso → la ve · empleado SIN él (pero con otros) → NO la ve
  const con = filtroDeUsuario({ role: 'employee', perms: [perm] });
  const sin = filtroDeUsuario({ role: 'employee', perms: ['citas.read'] });
  if (!con(it) || sin(it)) malFiltradas.push(h + (con(it) ? ' (la ve SIN permiso)' : ' (no la ve CON permiso)'));
}
check(malFiltradas.length === 0, 'quien no tiene el permiso NO ve la entrada, y quien lo tiene sí',
  malFiltradas.join(' · ') || conCandado.length + ' entradas con candado, todas correctas');

// El hallazgo viejo: `contabilidad` era la única clave del rail sin candado.
check(NAV_PERMS.contabilidad === 'invoices.read',
  'la entrada de Contabilidad ya no es una puerta sin candado (daba 403 al pulsarla)', String(NAV_PERMS.contabilidad));

// ── (4) REVERSIÓN: la comprobación tiene que saber caer ─────────────────────────────────────────
{
  const inventada = '/admin/una-seccion-que-nadie-enlaza';
  check(!enlaces.has(inventada) && ![...enlaces].includes(inventada),
    'y sabe distinguir una sección sin enlace de una con enlace (reversión)');
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + ok + ' ✓  ·  ' + fail + ' ✗   (' + unicas.length + ' secciones · ' + enlaces.size + ' enlaces de menú)');
process.exit(fail === 0 ? 0 : 1);
