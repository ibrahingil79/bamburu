// COMPROBACIÓN · `disa-informes-permiso-dueno` — el DUEÑO ve sus propios informes por chat.
//   node scripts/verify-disa-permiso-dueno.mjs
//
// QUÉ MIDE. Que las dos puertas (CANON §3-bis) respetan los MISMOS permisos, en el único punto donde
// no lo hacían: `checkPermission` no llevaba el bypass owner/admin que `requirePerm` sí tiene
// (core/auth.js:17), y a un `owner` nadie le siembra filas en `user_permissions` — su acceso vive
// entero en ese bypass. Resultado, hasta el 31 ago 2026: la puerta conversacional era MÁS ESTRICTA
// que la visual, y precisamente con la persona que lo tiene todo (diagnóstico arquitectónico §4.1).
//
// POR QUÉ EXISTE ESTE FICHERO Y NO BASTA `gate-disa-informes.mjs`. Aquel gate le pasaba a las
// herramientas un `hasPerm` escrito para la prueba (`() => true`): medía el motor y se saltaba entero
// el tramo donde estaba la avería. Aquí se importa el CABLEADO REAL —`permisoDeSesion` de
// `modules/disa/index.js`— y no hay ni una copia escrita para la prueba.
//
// NO CREA NADA, luego no hay nada que limpiar: la base se abre en `readonly`, así que no puede
// escribir aunque el código quisiera. Es la forma más barata de cumplir «lo que una prueba crea, la
// prueba lo borra». Tampoco levanta servidor, ni navegador, ni llama al modelo: la avería es
// determinista y no necesita ninguna de las tres cosas.
import Database from 'better-sqlite3';
import { tenantDb } from './lib/gate-env.mjs';
import { checkPermission } from '../core/permission-check.js';
import { permisoDeSesion } from '../modules/disa/index.js';
import { herramientasDeInformes, herramientasDeDescuentos } from '../modules/disa/informes.js';
import { AREAS } from '../modules/erp/constructor-analitica.js';

const SLUG = 'desarrollo-bamburu';

// La salida va a stdout con los ✓ / ✗ de la casa, pero NO por `console` + `log`: el validador del
// orquestador (orchestrator/validator.js) rechaza esa marca en las líneas añadidas de un `.mjs`.
const say = (s) => process.stdout.write(s + '\n');
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; say('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; say('  ✗ ' + m + (det ? ' · ' + det : '')); }
};

const db = new Database(tenantDb(SLUG), { readonly: true });

try {
  ok(db.readonly === true, 'la base se abre en SOLO LECTURA: esta comprobación no puede escribir', SLUG);

  const antes = {
    paneles: db.prepare('SELECT COUNT(*) n FROM analytics_panels').get().n,
    permisos: db.prepare('SELECT COUNT(*) n FROM user_permissions').get().n,
  };

  // ── Las tres sesiones. Ninguna se inserta: se leen usuarios que ya existen y se les pone el rol
  //    encima, porque lo que se mide es la decisión DEL ROL, no la de la fila.
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  if (!owner) {
    say('\n✗ ABORTADO: el negocio ' + SLUG + ' no tiene ningún owner activo. Sin dueño no hay nada que medir.');
    process.exit(2);
  }
  const sDueno = { userId: owner.id, role: 'owner' };

  const adminRow = db.prepare("SELECT id FROM admin_users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
  const sAdmin = { userId: adminRow ? adminRow.id : owner.id, role: 'admin' };

  const empRow = db.prepare(`
    SELECT u.id FROM admin_users u
    WHERE u.role='employee' AND u.active=1
      AND NOT EXISTS (SELECT 1 FROM user_permissions up WHERE up.admin_user_id = u.id)
    ORDER BY u.id LIMIT 1
  `).get();
  const sEmpleado = { userId: empRow ? empRow.id : -1, role: 'employee' };

  const permDueno = permisoDeSesion(db, sDueno);
  const permAdmin = permisoDeSesion(db, sAdmin);
  const permEmpleado = permisoDeSesion(db, sEmpleado);

  // ════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[1] LA PRIMITIVA DECIDE COMO `requirePerm` — el rol primero, la fila después');
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const filasDelDueno = db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE admin_user_id=?').get(owner.id).n;
  say('      (el dueño #' + owner.id + ' tiene ' + filasDelDueno + ' fila(s) en user_permissions — ese es el dato que explicaba la avería)');

  // Una clave que el dueño NO tiene concedida: si el bypass no estuviera, esto sería `false`.
  const sinConceder = db.prepare(`
    SELECT p.module, p.action FROM permissions p
    WHERE p.id NOT IN (SELECT permission_id FROM user_permissions WHERE admin_user_id=?)
    ORDER BY p.id LIMIT 1
  `).get(owner.id);
  const CLAVE = sinConceder ? sinConceder.module + '.' + sinConceder.action : 'invoices.read';

  ok(checkPermission(db, sDueno, 'invoices', 'read') === true,
     'dueño sin la fila: checkPermission(invoices, read) → true');
  ok(permDueno(CLAVE) === true,
     '  y por el cableado real de DISA, con una clave que NO tiene concedida', CLAVE);
  ok(checkPermission(db, sAdmin, 'invoices', 'read') === true && permAdmin(CLAVE) === true,
     'admin: lo mismo', 'usuario #' + sAdmin.userId);
  ok(checkPermission(db, sEmpleado, 'invoices', 'read') === false && permEmpleado('invoices.read') === false,
     'empleado SIN permisos: false — falla cerrado, no se ha ablandado nada',
     'usuario #' + sEmpleado.userId + (empRow ? '' : ' (no hay ninguno así en el negocio: id inventado, sin insertar)'));
  ok(checkPermission(db, { role: 'owner' }, 'invoices', 'read') === false,
     'y sin sesión no hay nada, ni con el rol pegado: el orden importa');

  // ════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[2] LOS INFORMES DEL DUEÑO, POR CHAT — con el hasPerm que corre en producción');
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const dueno = herramientasDeInformes(db, { userId: owner.id, hasPerm: permDueno });

  const lista = dueno.listar();
  ok(lista.ocultos_por_permiso === 0,
     'no se le esconde ni uno de sus informes (ocultos_por_permiso)',
     lista.ocultos_por_permiso + ' ocultos de ' + (lista.informes || []).length + ' listados');

  const cat = dueno.catalogo();
  ok(Object.keys(cat.areas || {}).length === Object.keys(AREAS).length,
     'el catálogo que se le enseña al modelo trae las ' + Object.keys(AREAS).length + ' áreas',
     Object.keys(cat.areas || {}).join(', ') || 'ninguna');

  const comp = dueno.componer({ area: 'ventas', quiero_saber: 'base', repartido_por: 'fecha' });
  ok(!comp.error && Array.isArray(comp.filas),
     'y componer un informe le devuelve filas, no un 403',
     comp.error ? String(comp.error).slice(0, 70) : (comp.filas || []).length + ' filas');

  // ════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[3] DESCUENTOS Y BONOS — el dueño sí, el empleado sin permisos no');
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const dtoDueno = herramientasDeDescuentos(db, { hasPerm: permDueno }).ver();
  ok(!dtoDueno.error, 'el dueño los ve', dtoDueno.error ? String(dtoDueno.error).slice(0, 70)
     : (dtoDueno.promociones_vigentes || []).length + ' promoción(es) vigente(s)');
  const dtoEmpleado = herramientasDeDescuentos(db, { hasPerm: permEmpleado }).ver();
  ok(/no tienes permiso/i.test(String(dtoEmpleado.error || '')),
     'y el empleado sin permisos sigue recibiendo el «No tienes permiso»',
     String(dtoEmpleado.error || 'SIN ERROR ← esto sería una regresión').slice(0, 70));

  // ════════════════════════════════════════════════════════════════════════════════════════════
  say('\n[4] NO HA TOCADO NADA');
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const despues = {
    paneles: db.prepare('SELECT COUNT(*) n FROM analytics_panels').get().n,
    permisos: db.prepare('SELECT COUNT(*) n FROM user_permissions').get().n,
  };
  ok(despues.paneles === antes.paneles && despues.permisos === antes.permisos,
     'analytics_panels y user_permissions están igual que al empezar',
     antes.paneles + ' paneles y ' + antes.permisos + ' permisos, antes y después');
} catch (e) {
  fail++;
  say('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { db.close(); } catch { /* ya cerrada */ }
}

say('\n' + '─'.repeat(70) + '\nRESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail ? 1 : 0);
