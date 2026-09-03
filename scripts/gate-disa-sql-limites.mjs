#!/usr/bin/env node
//
// gate-disa-sql-limites.mjs — QUE UNA CONSULTA DE DISA TENGA TOPE Y RELOJ, Y QUE EL RECORTE SE DIGA.
//
// DE DÓNDE SALE (AUD-005). `query_database` hacía `db.prepare(sql).all()` a secas: sin tope de filas
// y sin plazo. El tope se le PEDÍA al modelo en la descripción de la herramienta —«Usa LIMIT 20 como
// maximo»—, que es un ruego, no un cerrojo. Medido el 3 sep 2026 sobre el negocio grande: un
// `SELECT * FROM invoices` son 928 filas y **1.098 KB de JSON viajando al proveedor de IA**.
//
// QUÉ EXIGE, y todo se mide CONTANDO, no leyendo el código:
//   [1] EL FALLO, REPRODUCIDO PRIMERO: la vía vieja se trae la tabla entera. Línea base.
//   [2] Tope IMPUESTO POR EL SERVIDOR: sin LIMIT y con `LIMIT 5000` sale igual de recortado.
//   [3] El recorte SE ANUNCIA: en el resultado que ve DISA y en el registro de la plataforma.
//   [4] Una consulta lenta se CANCELA DE VERDAD al vencer el plazo, el error se maneja y se anota,
//       y **el servidor sigue respondiendo mientras tanto** (se le pide otra cosa por HTTP a la vez).
//   [5] Los permisos siguen exactamente igual: lo que se denegaba, se deniega.
//   [6] Los INFORMES también dicen que recortaron (era el segundo sitio, y no estaba en la ficha).
//
// Se trae su propio negocio y lo tira al terminar con `tirarNegocio`. No usa el modelo: entra por la
// costura `executeAction`/herramientas, así que no depende del saldo del proveedor de IA.
//
//   node scripts/gate-disa-sql-limites.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { APP_DIR } from './lib/gate-env.mjs';
import { tirarNegocio } from './lib/tirar-negocio.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { getTenantBySlug, listErrors } from '../core/control-db.js';
import { consultarConLimites } from '../modules/disa/consulta.js';
import { MAX_FILAS, PLAZO_MS } from '../modules/disa/limites-consulta.js';
import { evaluateQueryAccess } from '../modules/disa/index.js';

const RID = randomBytes(3).toString('hex');
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

let slug = null, db = null, ruta = null;
const SEMBRADAS = MAX_FILAS + 50;   // por encima del tope, para que el recorte tenga que ocurrir

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] UN NEGOCIO DE CERO, con más filas que el tope');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const alta = await provisionTenant({
    businessName: 'Gate SQL Limites ' + RID, ownerName: 'Dueña Gate',
    email: 'delivered@resend.dev', password: 'Gate.Sql.' + RID + '!', phone: '+34 600 000 000',
  });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  ruta = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
  db = new Database(ruta);
  db.pragma('busy_timeout = 10000');

  const ins = db.prepare("INSERT INTO clients (name, email, fiscal_id, active) VALUES (?,?,?,1)");
  const sembrar = db.transaction(() => {
    for (let i = 0; i < SEMBRADAS; i++) ins.run('ZZ Cliente ' + RID + ' ' + i, 'zz' + i + '-' + RID + '@bamburu.test', 'B' + String(10000000 + i));
  });
  sembrar();
  const total = db.prepare('SELECT COUNT(*) n FROM clients').get().n;
  ok(total >= SEMBRADAS, 'sembrados ' + SEMBRADAS + ' clientes, por encima del tope de ' + MAX_FILAS, total + ' en la base');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA VÍA VIEJA, REPRODUCIDA — la línea base');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const viejo = db.prepare('SELECT * FROM clients').all();
  const kb = Buffer.byteLength(JSON.stringify({ rows: viejo, count: viejo.length }), 'utf8') / 1024;
  ok(viejo.length === total,
     'ASÍ ERA: `db.prepare(sql).all()` se trae la tabla ENTERA, sin tope',
     viejo.length + ' filas · ' + kb.toFixed(0) + ' KB que habrían viajado al proveedor');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL TOPE LO IMPONE EL SERVIDOR, diga lo que diga la consulta');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const sinLimit = await consultarConLimites(ruta, 'SELECT * FROM clients');
  ok(sinLimit.count === MAX_FILAS, 'sin LIMIT: llegan exactamente ' + MAX_FILAS, 'llegaron ' + sinLimit.count);
  ok(sinLimit.recortado === true, 'y viene marcado como RECORTADO');
  ok(/RECORTADO/.test(sinLimit.aviso || ''), 'con el aviso en el propio resultado que ve DISA', (sinLimit.aviso || '').slice(0, 60) + '…');
  ok(/NO son todas/i.test(sinLimit.aviso || ''), 'y el aviso dice sin rodeos que NO son todas');

  const pidiendoMas = await consultarConLimites(ruta, 'SELECT * FROM clients LIMIT 5000');
  ok(pidiendoMas.count === MAX_FILAS && pidiendoMas.recortado === true,
     'pidiendo LIMIT 5000 sale IGUAL de recortado: el modelo no puede saltárselo', 'llegaron ' + pidiendoMas.count);

  const cabe = await consultarConLimites(ruta, 'SELECT * FROM clients LIMIT 5');
  ok(cabe.count === 5 && !cabe.recortado, 'y una consulta que cabe NO se marca como recortada (sin falsos avisos)', cabe.count + ' filas');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] EL RECORTE QUEDA ANOTADO EN EL REGISTRO DE LA PLATAFORMA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const { registrarConsultaDisa } = await import('../modules/disa/consulta.js');
  const antesLog = listErrors(200).length;
  registrarConsultaDisa(db, { sql: "SELECT * FROM clients WHERE name='?'", tenant: slug, userId: 2, ms: 12, recortado: true, filas: MAX_FILAS });
  const nuevos = listErrors(200).filter(e => e.tenant_slug === slug);
  ok(nuevos.length > 0, 'la consulta recortada deja apunte en el registro', nuevos.length + ' apunte(s)');
  const ap = nuevos[0] || {};
  ok(/RECORTADA/.test(ap.message || ''), 'y el apunte dice que se recortó', (ap.message || '').slice(0, 70));
  ok(!/Juan|Pérez/i.test(ap.message || '') && /SQL\(saneado\)/.test(ap.message || ''),
     'con el SQL SANEADO: los literales son datos del cliente y no van al registro');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] UNA CONSULTA LENTA SE CANCELA DE VERDAD, y el negocio sigue respondiendo');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Un cruce que ORDENA por una expresión: SQLite tiene que ordenarlo todo antes de la primera fila,
  // así que un reloj «entre filas» no llegaría. Es el caso que obliga a matar el hilo.
  const LENTA = 'SELECT a.id FROM clients a, clients b, clients c ORDER BY (a.id * b.id * c.id)';
  const t0 = Date.now();
  const lentaPromesa = consultarConLimites(ruta, LENTA);
  // MIENTRAS corre: se le pide otra cosa al servidor por HTTP. Si la consulta bloqueara el bucle de
  // eventos —que es lo que hacía antes—, esto se quedaría esperando y el tiempo lo delataría.
  const tHttp = Date.now();
  const resp = await fetch('http://' + slug + '.localhost:3000/admin/login');
  const msHttp = Date.now() - tHttp;
  const lenta = await lentaPromesa;
  const msTotal = Date.now() - t0;

  ok(lenta.plazo_agotado === true, 'la consulta lenta se cancela por plazo', (lenta.error || '').slice(0, 60) + '…');
  ok(!lenta.rows, 'y NO devuelve datos a medias');
  ok(msTotal >= PLAZO_MS && msTotal < PLAZO_MS + 4000,
     'se corta AL cumplirse el plazo, ni antes ni mucho después', msTotal + ' ms (plazo ' + PLAZO_MS + ')');
  ok(resp.status === 200 && msHttp < 2000,
     'y el negocio SIGUE RESPONDIENDO mientras tanto (antes se bloqueaba el servidor entero)',
     'HTTP ' + resp.status + ' en ' + msHttp + ' ms');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] LOS PERMISOS SIGUEN EXACTAMENTE IGUAL');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const ctx = { isAdmin: false, allTables: ['clients', 'admin_users'], hasPerm: () => false };
  ok(!!evaluateQueryAccess('UPDATE clients SET name=1', ctx), 'lo que no es SELECT se sigue denegando');
  ok(!!evaluateQueryAccess('SELECT * FROM admin_users', ctx), 'una tabla protegida se sigue denegando');
  ok(!!evaluateQueryAccess('SELECT * FROM clients', ctx), 'y sin permiso de área, también');
  ok(evaluateQueryAccess('SELECT * FROM clients', { isAdmin: true, allTables: ['clients'], hasPerm: () => true }) === null,
     'y el dueño sigue pudiendo consultar lo suyo');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] LOS INFORMES TAMBIÉN DICEN QUE RECORTARON');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // El informe reparte por cliente: hacen falta clientes CON algo facturado para que salgan filas.
  // ⚠️ Y si la siembra falla, ESTE GATE TIENE QUE DECIRLO. La primera versión lo envolvía en un
  // `catch {}` y, al no haber filas, la comprobación pasaba por una rama que decía «no había filas
  // suficientes»: un VERDE QUE NO DEMOSTRABA NADA, que en este repo cuenta como fallo.
  const algunos = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 6').all();
  const insInv = db.prepare(
    "INSERT INTO invoices (invoice_number, year, sequence, client_id, issue_date, company_name, company_fiscal_id,"
    + " subtotal, tax_amount, total, status) VALUES (?,?,?,?,date('now'),'ZZ Gate','B00000001',?,?,?,'emitida')");
  algunos.forEach((c, i) => insInv.run('ZZ-' + RID + '-' + i, 2026, 9000 + i, c.id, 100 + i, 21, 121 + i));
  const facturadas = db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  ok(facturadas >= 6, 'sembradas facturas para poder forzar el recorte del informe', facturadas + ' facturas');

  const { herramientasDeInformes } = await import('../modules/disa/informes.js');
  const H = herramientasDeInformes(db, { userId: 2, hasPerm: () => true, limite: 3 });
  const comp = H.ejecutar('componer_informe', { area: 'clientes', repartido_por: 'cliente', quiero_saber: 'facturado', periodo: 'siempre' });
  if (comp && comp.error) {
    ok(false, 'el informe de prueba se pudo componer', comp.error);
  } else {
    // Sin rama blanda: si no hay filas suficientes, el escenario no se montó y ESO es un fallo.
    ok((comp.filas || []).length === 3, 'el informe devuelve exactamente el tope de 3 filas que se le puso',
       'filas ' + (comp.filas || []).length);
    ok(comp.recortado === true, 'y viene marcado como RECORTADO (antes esta bandera se tiraba)', 'recortado=' + comp.recortado);
    ok(/RECORTADO/.test(comp.aviso || ''), 'con su aviso escrito para que DISA lo diga', (comp.aviso || '').slice(0, 55) + '…');
  }

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  try { if (db) db.close(); } catch {}
  if (slug) { console.log('\n[limpieza] tirando el negocio de prueba: ' + slug); tirarNegocio(slug); }
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
