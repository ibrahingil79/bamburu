#!/usr/bin/env node
//
// verify-correos-permisos.mjs — LA REGLA DE LOS CORREOS AL EQUIPO.
//
// «Un correo NUNCA puede contener un dato que su destinatario no podría ver entrando él mismo.»
//
// Tiene DOS patas, porque una sola no basta:
//
//   [A] DE COMPORTAMIENTO. Se monta un negocio de mentira con deuda, ventas y citas, y se pide el
//       correo de tres personas distintas: el dueño, un empleado CON acceso a cobros y un empleado
//       SIN acceso a nada de dinero. Se ENSEÑA el correo entero de cada uno y se comprueba que en el
//       del tercero no aparece ni una cifra de dinero. No se mira una bandera: se lee el texto.
//
//   [B] ESTRUCTURAL, sobre el código. La regla se cumplía antes por CONVENIO —estaba escrita dentro
//       del cron— y eso no es un invariante: es que el que la escribió se acordó. Aquí se comprueba
//       que el único sitio que manda correo a alguien del equipo es `core/correo-equipo.js`, que
//       ningún bloque puede viajar sin declarar su permiso, y que un destinatario inactivo no recibe
//       nada. Si mañana alguien escribe otro correo al equipo y no pasa por la puerta, esto cae.
//
//   node scripts/verify-correos-permisos.mjs
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../modules/erp/models.js';
import { destinatarioDe, puedeVer, filtrarPorPermiso, enviarAlEquipo } from '../core/correo-equipo.js';
import { parteDelDia, parteTexto, permDeLinea } from '../modules/erp/parte-diario.js';
import { puedeDe, permisosDeUsuario, hoyLocal } from '../modules/erp/avisos.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

// Un negocio de mentira, en memoria: nada que limpiar y nada que otro gate pueda moverme.
const db = new Database(':memory:');
runMigrations(db);

const HOY = hoyLocal();
const ayer = (() => { const d = new Date(HOY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 40); return d.toISOString().slice(0, 10); })();

function permId(mod, act) {
  const r = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act);
  return r && r.id;
}
function crearUsuario(nombre, email, role, permisos) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,?,1)")
    .run(nombre, email, 'x', role).lastInsertRowid;
  for (const p of permisos) {
    const [m, a] = p.split('.');
    const pid = permId(m, a);
    if (pid) db.prepare('INSERT INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(id, pid);
  }
  return id;
}

try {
  // ── ESCENARIO: deuda vencida de verdad, para que haya algo que contar ─────────────────────────
  db.prepare("UPDATE company_config SET company_name='Negocio de Prueba SL' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES ('Cliente Uno','X1111111X','ES',1)").run().lastInsertRowid;
  db.prepare(`INSERT INTO invoices (invoice_number, year, sequence, client_id, issue_date, due_date,
                                    subtotal, tax_amount, total, status, company_name, company_fiscal_id)
              VALUES ('F2026-9001', 2026, 9001, ?, ?, ?, 1000, 210, 1210, 'emitida', 'Negocio de Prueba SL', 'B00000000')`)
    .run(cli, ayer, ayer);

  const idDuenyo = crearUsuario('Dueña', 'duena@prueba.test', 'owner', []);
  const idConCobros = crearUsuario('Con cobros', 'concobros@prueba.test', 'employee', ['cobros.read']);
  const idSinDinero = crearUsuario('Sin dinero', 'sindinero@prueba.test', 'employee', ['citas.read']);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[A] EL CORREO DE CADA UNO, ENTERO Y A LA VISTA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const CIFRA = /\d[\d.]*,\d{2}\s*€|€\s*\d/;              // un importe, en cualquiera de las dos formas
  const correos = {};
  for (const [etiqueta, uid] of [['DUEÑA', idDuenyo], ['EMPLEADO con cobros.read', idConCobros], ['EMPLEADO sin acceso al dinero', idSinDinero]]) {
    const { role, perms } = permisosDeUsuario(db, uid);
    const parte = parteDelDia(db, { hoy: HOY, puede: puedeDe({ role, perms }), elegidas: null, sym: '€' });
    const bloques = parte.frases.map(f => ({ id: f.id, perm: permDeLinea(f.id), texto: f.texto }));

    let enviado = null;
    const res = await enviarAlEquipo(db, {
      userId: uid, bloques,
      componer: (quedan) => ({ subject: 'Tu negocio hoy', text: parteTexto(quedan.map(b => ({ texto: b.texto }))) }),
    }, async (payload) => { enviado = payload; return { data: { id: 'fake' }, error: null }; });

    correos[etiqueta] = { res, enviado };
    console.log('\n  ──────── ' + etiqueta + ' (rol=' + role + ' · permisos=' + (perms.join(',') || 'ninguno') + ')');
    console.log('  destinatario: ' + (res.destino || '(ninguno)') + ' · enviado=' + res.enviado + ' · motivo=' + res.motivo);
    if (res.fuera && res.fuera.length) console.log('  fuera por permiso: ' + res.fuera.map(x => x.id + ' (' + x.perm + ')').join(', '));
    console.log('  ──── EL CORREO ENTERO ────');
    console.log(enviado ? ('  ASUNTO: ' + enviado.subject + '\n' + (enviado.text || '').split('\n').map(l => '  | ' + l).join('\n'))
                        : '  (no se manda ningún correo)');
  }

  console.log('');
  const dna = correos['DUEÑA'], conC = correos['EMPLEADO con cobros.read'], sinD = correos['EMPLEADO sin acceso al dinero'];
  ok(dna.res.enviado && CIFRA.test(dna.enviado.text || ''), 'la DUEÑA sí recibe su correo, con la cifra dentro',
     (dna.enviado && (dna.enviado.text || '').replace(/\s+/g, ' ').slice(0, 70)) || '(vacío)');
  ok(conC.res.enviado && CIFRA.test(conC.enviado.text || ''), 'el empleado CON cobros.read recibe la deuda: lo mismo que ve en su pantalla',
     (conC.enviado && (conC.enviado.text || '').replace(/\s+/g, ' ').slice(0, 70)) || '(vacío)');
  ok(!sinD.res.enviado, 'al empleado SIN acceso al dinero NO se le manda nada', 'motivo: ' + sinD.res.motivo);
  ok(sinD.enviado === null, '  y no es que se mande vacío: es que no se llama al envío');
  ok(sinD.res.motivo === 'vacio_tras_filtrar', '  el motivo queda escrito, no se pierde', sinD.res.motivo);
  ok((sinD.res.fuera || []).length === 0, '  (aquí no cae nada en la puerta: el parte ya venía filtrado antes)');

  // LA PRUEBA QUE DE VERDAD MIDE LA PUERTA. Arriba, el parte ya llegaba filtrado, así que la puerta
  // no tenía nada que quitar — y una puerta que nunca quita nada no ha demostrado que sepa hacerlo.
  // Aquí se hace lo que haría un LLAMADOR DESCUIDADO: se le pasan al empleado sin acceso al dinero
  // exactamente los bloques del dueño, con sus cifras dentro. La puerta tiene que dejarlos fuera.
  const bloquesDelDuenyo = (() => {
    const { role, perms } = permisosDeUsuario(db, idDuenyo);
    const parte = parteDelDia(db, { hoy: HOY, puede: puedeDe({ role, perms }), elegidas: null, sym: '€' });
    return parte.frases.map(f => ({ id: f.id, perm: permDeLinea(f.id), texto: f.texto }));
  })();
  ok(bloquesDelDuenyo.length > 0 && bloquesDelDuenyo.some(b => CIFRA.test(b.texto)),
     'el llamador descuidado trae bloques CON cifras de dinero', bloquesDelDuenyo.map(b => b.id).join(', '));

  let payloadDescuidado = null;
  const resDescuidado = await enviarAlEquipo(db, {
    userId: idSinDinero, bloques: bloquesDelDuenyo,
    componer: (quedan) => ({ subject: 'Tu negocio hoy', text: parteTexto(quedan.map(b => ({ texto: b.texto }))) }),
  }, async (payload) => { payloadDescuidado = payload; return { data: { id: 'fake' }, error: null }; });

  ok(!resDescuidado.enviado && payloadDescuidado === null,
     'LA PUERTA LO PARA: aunque se le pasen las cifras del dueño, al empleado no le sale correo',
     'motivo: ' + resDescuidado.motivo);
  ok((resDescuidado.fuera || []).length === bloquesDelDuenyo.length,
     '  y deja constancia de CADA bloque que quitó, con su permiso',
     (resDescuidado.fuera || []).map(f => f.id + '←' + f.perm).join(' · '));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[B] LA REGLA NO SE PUEDE SALTAR');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Un bloque sin permiso declarado revienta, no se manda "por si acaso".
  let reventó = false;
  try { filtrarPorPermiso([{ id: 'suelto', texto: 'Has vendido 10.000,00 €' }], () => true); }
  catch { reventó = true; }
  ok(reventó, 'un bloque SIN permiso declarado no se manda: revienta al escribirlo');

  // Un destinatario inactivo no recibe nada, aunque el bloque sea suyo.
  db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(idConCobros);
  let llamado = false;
  const resInactivo = await enviarAlEquipo(db, {
    userId: idConCobros,
    bloques: [{ id: 'deuda_total', perm: 'cobros.read', texto: 'Te deben 1.210,00 €' }],
    componer: () => ({ subject: 'x', text: 'x' }),
  }, async () => { llamado = true; return { data: {}, error: null }; });
  ok(!resInactivo.enviado && resInactivo.motivo === 'inactivo' && !llamado,
     'a quien se le ha quitado el acceso NO se le sigue mandando el parte', 'motivo: ' + resInactivo.motivo);
  db.prepare('UPDATE admin_users SET active=1 WHERE id=?').run(idConCobros);

  // Y los permisos se leen de la BASE: quien llama no puede traer los suyos.
  const d = destinatarioDe(db, idSinDinero);
  ok(!puedeVer(d)('cobros.read') && puedeVer(d)('citas.read'),
     'los permisos del destinatario salen de la base, no de quien llama', d.perms.join(','));

  // ── LA PUERTA ES LA ÚNICA ─────────────────────────────────────────────────────────────────────
  // Se recorre el código buscando envíos de correo cuyo destinatario sea una persona del equipo. Un
  // `to:` que salga de `admin_users` y no pase por `enviarAlEquipo` es exactamente la fuga que esta
  // regla existe para impedir.
  const ficheros = [];
  const mirar = ruta => {
    let st; try { st = statSync(ruta); } catch { return; }
    if (st.isDirectory()) { for (const f of readdirSync(ruta)) mirar(join(ruta, f)); return; }
    if (/\.(js|mjs)$/.test(ruta)) ficheros.push(ruta);
  };
  for (const d2 of ['modules', 'core', 'scripts']) mirar(join(APP_DIR, d2));

  // EXCEPCIONES, CON SU MOTIVO ESCRITO. No hay lista de perdonados sin razón: cada una dice por qué
  // no es una fuga, y si mañana deja de ser cierto, se ve aquí.
  const EXCEPCIONES = {
    'modules/erp/routes/settings.js':
      'manda una PRUEBA de una plantilla de correo a TU PROPIA dirección, con los datos de EJEMPLO '
      + 'de la plantilla (María García, F2026-0042…), nunca con datos del negocio. Ni el destinatario '
      + 'es otro, ni el contenido es real: no hay nada que filtrar.',
  };
  const sospechosos = [];
  for (const f of ficheros) {
    const rel = f.replace(APP_DIR + '/', '');
    if (rel === 'core/correo-equipo.js' || rel === 'scripts/verify-correos-permisos.mjs') continue;
    if (EXCEPCIONES[rel]) continue;
    const src = readFileSync(f, 'utf8');
    if (!/sendEmail\s*\(/.test(src)) continue;
    if (/enviarAlEquipo\s*\(/.test(src)) continue;         // ya pasa por la puerta
    // ¿Su destinatario sale de admin_users? Se mira si el fichero consulta esa tabla Y manda correo.
    if (/FROM\s+admin_users|admin_users\s+WHERE/i.test(src)) sospechosos.push(rel);
  }
  ok(sospechosos.length === 0,
     'ningún sitio manda correo a alguien del equipo por fuera de la puerta única',
     sospechosos.join(', ') || ('ninguno · ' + Object.keys(EXCEPCIONES).length + ' excepción(es) declarada(s) con su motivo'));
  for (const [f, motivo] of Object.entries(EXCEPCIONES)) console.log('    · excepción: ' + f + ' — ' + motivo);

} finally {
  db.close();
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
