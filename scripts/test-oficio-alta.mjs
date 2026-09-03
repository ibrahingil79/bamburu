// PERFIL DE OFICIO — el ALTA y los AJUSTES, de punta a punta (Escalera · paso 8).
//   node scripts/test-oficio-alta.mjs        (necesita el servidor levantado para [1])
//
// QUÉ DEMUESTRA:
//   [1] la pantalla del alta ofrece los SEIS botones, servidos desde la MISMA lista que usa el ERP;
//   [2] un negocio creado con cada oficio nace con su vocabulario y su catálogo, SIN tocar un ajuste
//       (esto es la prueba 1 del encargo, ya sobre el alta real: provisionTenant);
//   [3] el paso saltado, el texto libre y un oficio inventado caen en «Otro», y «Otro» nace como
//       nacía antes (los negocios que ya existen no se rompen);
//   [4] `business_sector` y `disa_profile.sector` NO se tocan ni se leen para esto;
//   [5] los mandos de Ajustes: cambiar de oficio no siembra solo, y sembrar solo añade lo que falta.
// Crea tenants de prueba en la control.db REAL y los borra al terminar, como test-registro-alta.
import path from 'path';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { createProductSvc } from '../modules/erp/routes/products.js';
import { OFICIOS, vocabulario, oficioDe, catalogoDe, serviciosQueFaltan, sembrarCatalogo, fijarOficio } from '../modules/erp/oficios.js';

import { soltarAtaduras } from './lib/tirar-negocio.mjs';
let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓ ' + label + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ FALLO: ' + label + (extra ? ' — ' + extra : '')); }
};
function deleteTenant(slug) {
  const t = getTenantBySlug(slug);
  // ⚙️ 3 SEP 2026 — SUELTA LAS ATADURAS ANTES DE BORRAR EL NEGOCIO. Desde el 2 de septiembre
  // `createTenant` siembra la prueba de 15 días, así que todo negocio nuevo tiene fila en
  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY y el negocio de
  // prueba se queda dentro de control.db para siempre. `soltarAtaduras` le pregunta al esquema.
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}
const creados = [];
const TS = Date.now();
const BASE = 'http://desarrollo-bamburu.localhost:3000';

// Da de alta un negocio como lo hace el registro, y devuelve su BD abierta.
async function alta(oficio, etiqueta) {
  const nombre = 'GOF ' + etiqueta + ' ' + TS;
  const res = await provisionTenant({
    businessName: nombre,
    ownerName: 'Dueño ' + etiqueta,
    email: 'gof-' + etiqueta + '-' + TS + '@t.local',
    password: 'contrasena-larga-123',
    country: 'ES',
    sector: 'lo que el usuario escribió en el chat, en texto libre',
    oficio,
  });
  creados.push(res.slug);
  return { db: new Database(path.join(process.cwd(), res.db_filename)), slug: res.slug };
}
const serviciosDe = db => db.prepare(
  "SELECT p.name, sc.duracion_min FROM products p JOIN service_config sc ON sc.product_id=p.id WHERE p.type='service' ORDER BY p.name"
).all();

try {
  console.log('\n[1] La pantalla del alta ofrece los SEIS botones');
  {
    let init = null, html = '';
    try {
      const r = await fetch(BASE + '/api/registro/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      init = await r.json();
      html = await (await fetch(BASE + '/registro')).text();
    } catch (e) {
      check('el servidor responde en ' + BASE, false, e.message + ' — ¿está levantado?');
    }
    if (init) {
      check('/api/registro/init devuelve la lista de oficios', Array.isArray(init.oficios));
      check('son SEIS', (init.oficios || []).length === 6, (init.oficios || []).map(o => o.id).join(', '));
      check('coinciden con los del ERP (una sola fuente, no una copia)',
        JSON.stringify((init.oficios || []).map(o => o.id)) === JSON.stringify(OFICIOS.map(o => o.id)));
      check('cada uno trae su etiqueta para el botón',
        (init.oficios || []).every(o => typeof o.label === 'string' && o.label.length > 0));
      check('la pantalla trae el paso de oficio', /oficio-grid/.test(html) && /oficio-btn/.test(html));
      check('los botones se enganchan por addEventListener (la CSP estricta bloquea los atributos)',
        /addEventListener\('click'/.test(html) && !/<button[^>]*class="oficio-btn"[^>]*onclick/.test(html));
    }
  }

  console.log('\n[2] Un negocio de cada oficio nace hablando su idioma, sin tocar un ajuste');
  for (const of of OFICIOS) {
    const { db } = await alta(of.id, of.id);
    const voz = vocabulario(db);
    const svc = serviciosDe(db);
    check(of.label + ': el oficio queda guardado', oficioDe(db) === of.id);
    check(of.label + ': dice «' + of.cliente_sing + '»', voz.cliente_sing === of.cliente_sing);
    check(of.label + ': los puestos son «' + of.puesto_plural + '»', voz.puesto_plural === of.puesto_plural);
    check(of.label + ': arranca con ' + of.servicios.length + ' servicios', svc.length === of.servicios.length, svc.length + ' encontrados');
    check(of.label + ': con las duraciones investigadas',
      of.servicios.every(s => (svc.find(x => x.name === s.nombre) || {}).duracion_min === s.duracion_min));
    db.close();
  }

  console.log('\n[3] Paso saltado, texto libre e inventado → «Otro», que es el estado de siempre');
  for (const [valor, etiqueta] of [['', 'vacio'], ['Peluquería de toda la vida', 'textolibre'], ['fontaneria', 'inventado']]) {
    const { db } = await alta(valor, etiqueta);
    const voz = vocabulario(db);
    check('«' + (valor || '(vacío)') + '» → otro', oficioDe(db) === 'otro');
    check('  …y nace como nacía antes: Puesto/Puestos, Cliente, sin catálogo',
      voz.puesto_sing === 'Puesto' && voz.puesto_plural === 'Puestos' && voz.cliente_sing === 'Cliente' && serviciosDe(db).length === 0);
    db.close();
  }

  console.log('\n[4] business_sector y disa_profile.sector no se tocan ni se leen para esto');
  {
    const { db } = await alta('salud', 'sectores');
    const bs = db.prepare("SELECT value FROM settings WHERE key='business_sector'").get();
    check('business_sector sigue guardando el texto libre del chat, intacto',
      (bs?.value || '') === 'lo que el usuario escribió en el chat, en texto libre', bs?.value);
    check('…y NO se ha copiado el oficio encima', (bs?.value || '') !== 'salud');
    const dp = db.prepare('SELECT sector, business_type FROM disa_profile WHERE id=1').get();
    check('disa_profile.sector sigue vacío (nadie lo ha tocado)', (dp?.sector || '') === '' && (dp?.business_type || '') === '');
    check('y aun así el oficio es salud: son cosas distintas', oficioDe(db) === 'salud');
    db.close();
  }

  console.log('\n[5] Los mandos de Ajustes: cambiar no siembra; sembrar solo añade lo que falta');
  {
    const { db } = await alta('peluqueria', 'ajustes');
    const antes = serviciosDe(db).length;
    // Cambiar de oficio: cambia las palabras, NO crea productos.
    fijarOficio(db, 'taller');
    check('cambiar de oficio NO siembra nada por su cuenta', serviciosDe(db).length === antes, antes + ' servicios, iguales');
    check('pero sí cambia las palabras', vocabulario(db).puesto_plural === 'Boxes');
    const faltan = serviciosQueFaltan(db, 'taller');
    check('y dice cuántos faltarían', faltan.length === catalogoDe('taller').length, faltan.length + ' de taller');
    // Sembrar: añade solo esos, sin tocar los de peluquería.
    const nuevos = sembrarCatalogo(db, 'taller', createProductSvc);
    check('sembrar añade exactamente los que faltaban', nuevos.length === faltan.length);
    check('y los de peluquería siguen ahí', serviciosDe(db).length === antes + faltan.length);
    check('sembrar otra vez no duplica nada', sembrarCatalogo(db, 'taller', createProductSvc).length === 0);
    db.close();
  }
} catch (e) {
  fail++; console.error('\n  ✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  for (const slug of creados) { try { deleteTenant(slug); } catch {} }
  console.log('\n  (limpiados ' + creados.length + ' tenants de prueba)');
}

console.log('\n──────────────────────────────');
console.log('  ' + ok + ' OK · ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
