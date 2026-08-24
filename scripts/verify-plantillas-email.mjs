// Gate — PLANTILLAS DE EMAIL EDITABLES (Ajustes). Sobre COPIAS de BD reales: los datos vivos no se tocan.
//
// Lo que hay que demostrar, y no de palabra:
//   · Guardar una editada (familia CLIENTE) y que el email que SE PREPARA use el texto nuevo, no el de
//     fábrica. Esta es LA prueba: si el envío siguiera leyendo el código, todo lo demás sería decorado.
//   · Que los huecos se rellenan con los datos de un cliente sembrado.
//   · CLIENTE: quitar un hueco necesario AVISA pero deja guardar (es su voz).
//   · SISTEMA: quitar el enlace crítico BLOQUEA el guardado. Afirmado para recuperar-contraseña y
//     para el enlace del portal — los dos correos que, sin su enlace, dejan a alguien fuera.
//   · "Volver al original" restaura EXACTAMENTE la de fábrica (que nunca se pierde: vive en el código).
//   · Candado: sin permiso de administración de Ajustes no se edita nada.
//   · email_templates FUERA de WRITABLE_TABLES.
//
// El envío REAL por Resend (al buzón sumidero) va en gate-plantillas-email.mjs, con el clic.
//
//   node scripts/verify-plantillas-email.mjs
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import {
  CATALOGO, TONO_UNICO, renderEmail, renderEmailFabrica, plantillaDeFabrica, plantillaEnVigor,
  revisarPlantilla, htmlAtexto, FAMILIA_SISTEMA, FAMILIA_CLIENTE,
} from '../modules/erp/email-templates.js';
import { collectionEmail } from '../modules/erp/cobros.js';
import { opportunityEmail } from '../modules/erp/crm.js';
import { createSettingsRoutes } from '../modules/erp/routes/settings.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const copias = [];
function copia(slug = 'desarrollo-bamburu') {
  const p = join(tmpdir(), 'tpl-' + slug + '-' + process.pid + '-' + copias.length + '.db');
  copyFileSync(`data/tenants/${slug}.db`, p);
  copias.push(p);
  const db = new Database(p);
  runMigrations(db);
  db.prepare('DELETE FROM email_templates').run();
  return db;
}

// Un usuario REAL en la copia, con SUS permisos reales. `requirePerm` los consulta contra la BD (no
// contra un array que le pasemos), así que el candado se prueba como se vive: con un usuario de verdad.
let uidSeq = 0;
function usuarioCon(db, perms) {
  const email = 'zz-tpl-' + (++uidSeq) + '@bamburu.test';
  const r = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Gate plantillas',?,'x','employee',1)").run(email);
  const uid = Number(r.lastInsertRowid);
  for (const p of perms) {
    const [module, action] = p.split('.');
    const row = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(module, action);
    if (row) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, row.id);
  }
  return uid;
}

// `opts.owner` → sesión de dueño (bypass, como en el resto del panel). Si no, un empleado con
// exactamente los permisos que se le den.
function appPara(db, perms, opts = {}) {
  const sess = opts.owner
    ? { userName: 'gate', userId: 2, role: 'owner', csrfToken: 'x' }
    : { userName: 'gate', userId: usuarioCon(db, perms), role: 'employee', csrfToken: 'x' };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('isOwner', !!opts.owner); c.set('isAdmin', false);
    c.set('userPerms', perms);
    c.set('db', db);
    c.set('session', sess);
    await next();
  });
  app.route('/', createSettingsRoutes(db).api);
  return app;
}
const J = (m, app, path, body) => app.request(path, {
  method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

try {
  const db = copia();

  // ── 1. Esquema y catálogo ───────────────────────────────────────────────────
  console.log('\n[1] Esquema y catálogo');
  const cols = new Set(db.prepare('PRAGMA table_info(email_templates)').all().map(c => c.name));
  ok(['tipo', 'tono', 'subject', 'html'].every(c => cols.has(c)), 'la tabla email_templates existe (aditiva)');
  ok(db.prepare('SELECT COUNT(*) n FROM email_templates').get().n === 0,
     'nace VACÍA: la de fábrica vive en el código, aquí solo se guardan las ediciones');

  const tipos = Object.keys(CATALOGO);
  // EL CATÁLOGO SE DECLARA POR NOMBRE, NO POR NÚMERO. Estaba clavado en 8 y el producto ya iba por
  // 10: el sistema de citas trajo `confirmacion_cita` y `recordatorio_cita`, y los avisos
  // `resumen_avisos`. Crecimiento legítimo, comprobación caducada. Con la lista escrita, añadir un
  // tipo obliga a pasar por aquí y decidir a qué familia va — que es justo lo que hay que decidir.
  const TIPOS_ESPERADOS = ['cobro_factura', 'cobro_cuenta', 'comercial', 'presupuesto', 'orden_compra',
                           'recuperar_password', 'portal_cliente', 'confirmacion_cita', 'recordatorio_cita', 'resumen_avisos'];
  const faltan = TIPOS_ESPERADOS.filter(t => !tipos.includes(t));
  const sobran = tipos.filter(t => !TIPOS_ESPERADOS.includes(t));
  ok(!faltan.length && !sobran.length,
     'el catálogo tiene exactamente los tipos de email declarados (' + tipos.length + ')',
     faltan.length ? 'faltan: ' + faltan.join(', ') : (sobran.length ? 'sin declarar: ' + sobran.join(', ') : 'los ' + tipos.length));
  // Los de SISTEMA son los que el negocio NO elige mandar: salen solos. Son cinco desde que las
  // citas y el resumen de avisos entraron en el catálogo.
  const SISTEMA_ESPERADO = ['recuperar_password', 'portal_cliente', 'confirmacion_cita', 'recordatorio_cita', 'resumen_avisos'];
  const sistema = tipos.filter(t => CATALOGO[t].familia === FAMILIA_SISTEMA);
  ok(sistema.length === SISTEMA_ESPERADO.length && SISTEMA_ESPERADO.every(t => sistema.includes(t)),
     'los de SISTEMA están identificados: ' + sistema.join(', '));

  // Toda plantilla de fábrica debe renderizar sin dejar huecos sin rellenar, y pasar SU PROPIA revisión.
  let renderizadas = 0;
  for (const [id, t] of Object.entries(CATALOGO)) {
    for (const tono of (t.tonos ? t.tonos.map(x => x.clave) : [TONO_UNICO])) {
      const r = renderEmailFabrica(id, tono, t.ejemplo);
      if (!r.subject || !r.html || /\{\{/.test(r.subject + r.html)) { ok(false, id + '/' + tono + ' deja huecos sin rellenar'); }
      const rev = revisarPlantilla(id, plantillaDeFabrica(id, tono));
      if (rev.bloquea || rev.avisos.length) { ok(false, 'la FÁBRICA de ' + id + '/' + tono + ' no pasa su propia red de seguridad'); }
      renderizadas++;
    }
  }
  // 20 = tipos × tonos. Sube cuando entra un tipo nuevo; el recuento se dice, no se adivina.
  ok(renderizadas === 20, 'las plantillas de fábrica renderizan y pasan su propia red de seguridad', renderizadas + ' plantillas');

  // ── 2. LA PRUEBA DE VERDAD: lo guardado es lo que se envía ───────────────────
  console.log('\n[2] Lo guardado es lo que se envía (no el código)');
  const app = appPara(db, ['company.read', 'company.update'], { owner: true });

  const MIO = '<div><p>Hola {{cliente}}, soy Ibrahin.</p><p>Se te ha quedado pendiente la {{factura}}, de {{importe}}. Cuando puedas, la miramos.</p></div>';
  const r = await (await J('PUT', app, '/email-templates/cobro_factura/firme-medio',
    { subject: 'Un recordatorio de {{empresa}} — {{factura}}', html: MIO })).json();
  ok(r.ok && (!r.avisos || !r.avisos.length), 'guardo mi versión del recordatorio de pago (sin avisos: conservo los huecos)');

  // Y ahora lo que importa: el email que SE PREPARA para enviar.
  const client = { id: 1, name: 'María García', email: 'm@x.test' };
  const inv = { id: 1, invoice_number: 'F2026-0042', total: 363, due_date: '2026-06-30' };
  const company = { company_name: 'Velas Ibrahin', currency_symbol: '€' };
  const tpl = collectionEmail('firme-medio', { inv, client, cobro: { pendiente: 363 }, company, db });

  ok(/soy Ibrahin/.test(tpl.html), 'el email preparado usa MI TEXTO, no el de fábrica');
  ok(!/Agradeceríamos que la regularices/.test(tpl.html), 'y el texto de fábrica ya NO aparece por ningún lado');
  ok(tpl.subject === 'Un recordatorio de Velas Ibrahin — F2026-0042', 'mi asunto, con los huecos rellenos: ' + JSON.stringify(tpl.subject));

  // ── 3. Los huecos se rellenan con los datos del cliente sembrado ─────────────
  console.log('\n[3] Los huecos se rellenan con datos reales');
  ok(/María García/.test(tpl.html), 'el hueco {{cliente}} → "María García"');
  ok(/F2026-0042/.test(tpl.html), 'el hueco {{factura}} → "F2026-0042"');
  ok(/363[.,]00/.test(tpl.html) || /363,00/.test(tpl.html), 'el hueco {{importe}} → el pendiente real (363,00 €)');
  ok(!/\{\{/.test(tpl.html + tpl.subject), 'no queda NI UN hueco sin rellenar en la cara del cliente');
  ok(tpl.text && !/</.test(tpl.text.replace(/&lt;|&gt;/g, '')), 'y sale también la versión en texto plano, para el que no pinte HTML');

  // Los valores se ESCAPAN: un cliente que se llame <script> no inyecta nada en el email.
  const malicioso = collectionEmail('firme-medio',
    { inv, client: { name: '<script>alert(1)</script>' }, cobro: { pendiente: 1 }, company, db });
  ok(!/<script>/.test(malicioso.html), 'los datos se escapan: un cliente llamado "<script>" no inyecta nada');

  // El resto de tipos también respetan la edición (no solo el que probé).
  const rc = await (await J('PUT', app, '/email-templates/comercial/reenganche',
    { subject: 'Te echo de menos, {{cliente}}', html: '<p>Hola {{cliente}}, vuelve cuando quieras. — {{empresa}}</p>' })).json();
  ok(rc.ok, 'guardo también mi reenganche');
  const tre = opportunityEmail('reenganche', { client, company, opp: null, db });
  ok(/vuelve cuando quieras/.test(tre.html) && tre.subject === 'Te echo de menos, María García',
     'y DISA prepara el reenganche con MI texto (la propuesta de cliente dormido usa esto)');

  // ── 4. FAMILIA CLIENTE: avisa, pero deja guardar ────────────────────────────
  console.log('\n[4] Familia CLIENTE: avisa, no bloquea (es tu voz)');
  const sinFactura = await J('PUT', app, '/email-templates/cobro_factura/amable',
    { subject: 'Tienes algo pendiente', html: '<p>Hola {{cliente}}, tienes un pago pendiente. Un saludo.</p>' });
  const bodySin = await sinFactura.json();
  ok(sinFactura.status === 200 && bodySin.ok, 'quito el nº de factura y el importe → SÍ me deja guardar (200)');
  ok(bodySin.avisos && bodySin.avisos.length >= 2, 'pero me AVISA de lo que he quitado (' + (bodySin.avisos || []).length + ' avisos)');
  ok((bodySin.avisos || []).some(a => /Nº de factura/i.test(a)), 'el aviso dice EXACTAMENTE qué falta: ' + JSON.stringify((bodySin.avisos || [])[0]));
  const guardadaSin = plantillaEnVigor(db, 'cobro_factura', 'amable');
  ok(guardadaSin.editada && /tienes un pago pendiente/i.test(guardadaSin.html), 'y se guardó de verdad: su decisión, no la nuestra');

  // ── 5. FAMILIA SISTEMA: bloqueo DURO ────────────────────────────────────────
  console.log('\n[5] Familia SISTEMA: sin el enlace, NO se guarda');
  for (const [tipo, quePasa] of [
    ['recuperar_password', 'quien lo reciba se queda fuera de su cuenta'],
    ['portal_cliente', 'tu cliente no puede entrar a ver sus facturas'],
  ]) {
    const sinEnlace = await J('PUT', app, '/email-templates/' + tipo + '/' + TONO_UNICO,
      { subject: 'Hola', html: '<p>Hola {{nombre}}{{cliente}}, entra en tu cuenta.</p>' });   // ← sin {{enlace}}
    const b = await sinEnlace.json();
    ok(sinEnlace.status === 400 && b.bloqueada, tipo + ': quitar el enlace → 400 BLOQUEADO (' + quePasa + ')');
    ok(/enlace/i.test(b.error || ''), '  y el mensaje explica POR QUÉ: ' + JSON.stringify((b.error || '').slice(0, 90) + '…'));
    ok(!db.prepare('SELECT 1 FROM email_templates WHERE tipo=?').get(tipo), '  NO se guardó nada: la plantilla sigue siendo la de fábrica');
    // Con el enlace puesto, la misma edición SÍ entra: se bloquea por el enlace, no por capricho.
    const conEnlace = await J('PUT', app, '/email-templates/' + tipo + '/' + TONO_UNICO,
      { subject: 'Hola', html: '<p>Entra aquí: <a href="{{enlace}}">acceder</a></p>' });
    ok(conEnlace.status === 200, '  con el enlace puesto, la misma edición SÍ se guarda (el bloqueo es del enlace, no del texto)');
  }
  // Y el resumen diario, cuyo elemento crítico es la LISTA (sin ella el correo llega vacío).
  const sinLista = await J('PUT', app, '/email-templates/resumen_avisos/' + TONO_UNICO,
    { subject: 'Tu día', html: '<p>Buenos días.</p>' });
  ok(sinLista.status === 400, 'resumen diario: quitar la lista de avisos → 400 (llegaría un correo vacío)');

  // ── 6. Volver al original ───────────────────────────────────────────────────
  console.log('\n[6] Volver al original');
  const fabrica = plantillaDeFabrica('cobro_factura', 'firme-medio');
  const del = await (await J('DELETE', app, '/email-templates/cobro_factura/firme-medio')).json();
  ok(del.ok, 'volver al original → 200');
  ok(del.subject === fabrica.subject && del.html === fabrica.html, 'y devuelve EXACTAMENTE la de fábrica, carácter a carácter');
  ok(!db.prepare("SELECT 1 FROM email_templates WHERE tipo='cobro_factura' AND tono='firme-medio'").get(),
     'la fila de la edición desaparece (no hay copia de fábrica que restaurar: nunca se sobrescribió)');
  const trasVolver = collectionEmail('firme-medio', { inv, client, cobro: { pendiente: 363 }, company, db });
  ok(/Agradeceríamos que la regularices/.test(trasVolver.html) && !/soy Ibrahin/.test(trasVolver.html),
     'y el email vuelve a prepararse con el texto de fábrica');

  // ── 7. Vista previa ─────────────────────────────────────────────────────────
  console.log('\n[7] Vista previa');
  const pv = await (await J('POST', app, '/email-templates/cobro_factura/amable/preview',
    { subject: 'Prueba {{factura}}', html: '<p>Hola {{cliente}}, debes {{importe}}.</p>' })).json();
  ok(/F2026-0042/.test(pv.subject), 'la previa rellena los huecos con datos de EJEMPLO');
  ok(/María García/.test(pv.html), 'y el cuerpo también');
  ok(!/\{\{/.test(pv.html), 'sin huecos crudos a la vista');
  ok(pv.revision && !pv.revision.bloquea, 'la previa trae la revisión (avisos/bloqueo) antes de guardar');
  const pvMala = await (await J('POST', app, '/email-templates/portal_cliente/_/preview',
    { subject: 'x', html: '<p>sin enlace</p>' })).json();
  ok(pvMala.revision && pvMala.revision.bloquea, 'y en un correo de sistema sin enlace, la previa YA avisa de que no podrá guardarse');

  // ── 8. Candado de permiso ───────────────────────────────────────────────────
  //
  // EL MODELO REAL DE AJUSTES, comprobado en la BD y no supuesto: el módulo `company` NO EXISTE en la
  // tabla `permissions`. O sea que `company.read`/`company.update` no se le pueden CONCEDER a nadie:
  // solo pasan quienes hacen bypass — dueño y admin. Ajustes es, de hecho, cosa del dueño.
  // Las plantillas heredan ESE candado, tal cual, que además es el más estricto que hay. Y no se
  // afloja para los de sistema, que son justo los que llevan los enlaces con los que alguien entra.
  console.log('\n[8] Candado: el mismo de Ajustes (dueño/admin), sin aflojarlo');
  ok(!db.prepare("SELECT 1 FROM permissions WHERE module='company'").get(),
     'comprobado: el permiso company.* NO se puede conceder a un empleado (no existe) → Ajustes es del dueño');

  // Un empleado, por muchos permisos que tenga de OTRAS cosas, no entra.
  const empleado = appPara(db, ['invoices.read', 'clients.read', 'crm.manage']);
  // Foto de ANTES: lo que el empleado intente NO debe cambiar ni un byte de esto.
  const antesDelIntento = JSON.stringify(db.prepare('SELECT tipo,tono,subject,html FROM email_templates ORDER BY tipo,tono').all());

  ok((await empleado.request('/email-templates')).status === 403, 'un empleado NO ve ni el catálogo → 403');
  ok((await J('PUT', empleado, '/email-templates/cobro_factura/amable', { subject: 'PIRATA', html: '<p>PIRATA</p>' })).status === 403,
     'ni puede guardar una plantilla → 403');
  ok((await J('DELETE', empleado, '/email-templates/cobro_factura/amable')).status === 403, 'ni volver al original → 403');
  ok((await J('PUT', empleado, '/email-templates/recuperar_password/_',
       { subject: 'PIRATA', html: '<a href="{{enlace}}">PIRATA</a>' })).status === 403,
     'y el candado NO se afloja para los de SISTEMA (los que llevan los enlaces de acceso)');

  const despuesDelIntento = JSON.stringify(db.prepare('SELECT tipo,tono,subject,html FROM email_templates ORDER BY tipo,tono').all());
  ok(antesDelIntento === despuesDelIntento, 'y sus intentos NO cambiaron ni un byte de la BD (ni guardó, ni borró)');
  ok(!/PIRATA/.test(despuesDelIntento), 'su texto no está por ningún lado');

  // El dueño sí, claro.
  ok((await app.request('/email-templates')).status === 200, 'el dueño sí administra las plantillas');

  // ── 9. Fuera de WRITABLE_TABLES ─────────────────────────────────────────────
  console.log('\n[9] DISA no reescribe los textos que tu negocio manda');
  const disaSrc = readFileSync('modules/disa/index.js', 'utf8');
  const bloque = disaSrc.slice(disaSrc.indexOf('const WRITABLE_TABLES'), disaSrc.indexOf('const WRITABLE_TABLES') + 1600);
  const escribibles = bloque.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(!/'email_templates'/.test(escribibles), 'email_templates NO está en WRITABLE_TABLES');

  // ── 10. Aislamiento entre negocios ──────────────────────────────────────────
  console.log('\n[10] Aislamiento');
  const dbB = copia('ibrahin-repuestos');
  const appB = appPara(dbB, ['company.read', 'company.update'], { owner: true });
  await J('PUT', appB, '/email-templates/cobro_factura/amable', { subject: 'Del otro negocio {{factura}}', html: '<p>{{cliente}} {{importe}}</p>' });
  const mia = plantillaEnVigor(db, 'cobro_factura', 'amable');
  ok(!/Del otro negocio/.test(mia.subject), 'la plantilla del otro negocio NO se cuela en el mío (una BD por negocio)');

} finally {
  for (const p of copias) { for (const f of [p, p + '-wal', p + '-shm']) { try { unlinkSync(f); } catch {} } }
  console.log('\n  (copias desechables borradas; el negocio vivo NO se ha tocado)');
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Plantillas de email: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
