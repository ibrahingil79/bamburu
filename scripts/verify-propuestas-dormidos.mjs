// Gate — PROPUESTA DE DISA: cliente dormido (reenganche). Tipo `cliente_dormido`.
//
// Ciclo completo sobre COPIAS de BD reales: los datos vivos NO se tocan. Se siembran clientes con
// RITMOS DISTINTOS y se comprueba que la detección hace lo que promete — que es lo difícil de esto:
// un cliente que compra cada semana lleva dormido a los 30 días; uno que compra cada trimestre, no.
// Medir a los dos con la misma vara es lo que convierte una propuesta útil en ruido que se ignora.
//
// Cubre: el ritmo aprendido (mediana ×2 con suelo), el respaldo de la compra única, los que NUNCA
// compraron (fuera), las ventas de mostrador SIN cliente (no ensucian a nadie), las facturas anuladas
// (no cuentan como compra), el descanso de 90 días (descartada Y enviada), la idempotencia por índice
// PARCIAL, que APROBAR NO ENVÍA NADA, que la tabla está FUERA de WRITABLE_TABLES, y el candado.
//
// El envío REAL por Resend (al buzón sumidero) se prueba en gate-propuestas-dormidos.mjs, con el clic.
//
//   node scripts/verify-propuestas-dormidos.mjs
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import {
  generarPropuestasDormidos, propuestasPendientes, contarPropuestasPendientes, redactarReenganche,
  enDescanso, tiposVisiblesPara, TIPO_DORMIDO, DIAS_DESCANSO_DORMIDO,
} from '../modules/erp/propuestas.js';
import { clientesDormidos, umbralDormido, FACTOR_RITMO, DIAS_SUELO, DIAS_UNA_COMPRA } from '../modules/erp/ventas-metrics.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { createPropuestasRoutes } from '../modules/erp/routes/propuestas.js';

const HOY = '2026-07-14';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const copias = [];
function copia(slug) {
  const p = join(tmpdir(), 'dorm-' + slug + '-' + process.pid + '.db');
  copyFileSync(`data/tenants/${slug}.db`, p);
  copias.push(p);
  const db = new Database(p);
  runMigrations(db);
  db.prepare('DELETE FROM disa_proposals').run();
  return db;
}

function appPara(db, perms, opts = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('isOwner', !!opts.owner); c.set('isAdmin', false);
    c.set('userPerms', perms);
    c.set('session', { userName: 'gate', userId: 99, csrfToken: 'x' });
    await next();
  });
  app.route('/', createPropuestasRoutes(db).api);
  return app;
}
const POST = (app, path, body = {}) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const diasAntes = (n) => { const d = new Date(Date.parse(HOY + 'T00:00:00Z') - n * 86400000); return d.toISOString().slice(0, 10); };

// Un cliente con las compras que le pongamos (en días atrás desde HOY). Devuelve su id.
function sembrarCliente(db, nombre, email, comprasHaceDias = []) {
  const r = db.prepare("INSERT INTO clients (name, email, active) VALUES (?,?,1)").run(nombre, email);
  const id = Number(r.lastInsertRowid);
  for (const d of comprasHaceDias) {
    createInvoice(db, { client_id: id, issue_date: diasAntes(d), lines: [{ description: 'Servicio', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  }
  return id;
}
const esDormido = (lista, id) => lista.some(d => d.client_id === id);
const propuestoPara = (db, id) => db.prepare("SELECT * FROM disa_proposals WHERE client_id=? AND type=? AND status='pendiente'").get(id, TIPO_DORMIDO);

// Una VENTA DE MOSTRADOR: factura simplificada (serie S, tipo F2), exactamente como la emite el
// mostrador. `clientId` null = ANÓNIMA (el caso normal: el 49 % de la facturación de este negocio);
// con id = quedó atribuida a la ficha de un cliente, que también pasa.
let seqMostrador = 9000;
function ventaMostrador(db, haceDias, clientId = null) {
  seqMostrador++;
  const r = db.prepare(
    `INSERT INTO invoices (invoice_number, series, year, sequence, client_id, issue_date,
       company_name, company_fiscal_id, subtotal, tax_amount, total, status, tipo_factura)
     VALUES (?, 'S', 2026, ?, ?, ?, 'Desarrollo', 'B00000000', 100, 21, 121, 'emitida', 'F2')`
  ).run('S2026-' + seqMostrador, seqMostrador, clientId, diasAntes(haceDias));
  return Number(r.lastInsertRowid);
}

try {
  // ── 1. Esquema ──────────────────────────────────────────────────────────────
  console.log('\n[1] Esquema y ajustables');
  const db = copia('desarrollo-bamburu');
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='disa_proposals'").all();
  const parcial = idx.find(i => i.name === 'idx_disa_proposals_dormido_pendiente');
  ok(!!parcial && /UNIQUE/i.test(parcial.sql), 'existe el índice único PARCIAL de dormidos');
  ok(!!parcial && /status='pendiente'/.test(parcial.sql), 'y es PARCIAL sobre las PENDIENTES (deja convivir el historial, no lo reescribe)');
  ok(idx.some(i => i.name === 'idx_disa_proposals_invoice_type'), 'los índices de sus hermanas siguen intactos');
  ok(FACTOR_RITMO === 2 && DIAS_SUELO === 30 && DIAS_UNA_COMPRA === 90, 'ajustables en su sitio: factor ×2, suelo 30 d, respaldo 90 d');
  ok(DIAS_DESCANSO_DORMIDO === 90, 'descanso de 90 días antes de volver a proponer al mismo cliente');

  // ── 2. LA REGLA: cada cliente con SU vara ───────────────────────────────────
  console.log('\n[2] Detección: el ritmo se APRENDE, no se impone');
  // Semanal (hueco 7 d): umbral = max(7×2, 30) = 30 por el SUELO.
  const semanalDormido = sembrarCliente(db, 'ZZ Semanal dormido', 'a@zz.test', [61, 54, 47, 40]);      // última hace 40 d
  const semanalAlDia   = sembrarCliente(db, 'ZZ Semanal al día',  'b@zz.test', [31, 24, 17, 10]);      // última hace 10 d
  // Trimestral (hueco 90 d): umbral = max(90×2, 30) = 180.
  const trimestralOk   = sembrarCliente(db, 'ZZ Trimestral al día', 'c@zz.test', [280, 190, 100]);     // última hace 100 d
  const trimestralDorm = sembrarCliente(db, 'ZZ Trimestral dormido', 'd@zz.test', [380, 290, 200]);    // última hace 200 d
  // Una sola compra → respaldo fijo de 90 d.
  const unicaDormida   = sembrarCliente(db, 'ZZ Una compra vieja', 'e@zz.test', [120]);
  const unicaReciente  = sembrarCliente(db, 'ZZ Una compra reciente', 'f@zz.test', [60]);
  // Nunca compró.
  const nuncaCompro    = sembrarCliente(db, 'ZZ Nunca compró', 'g@zz.test', []);

  const dormidos = clientesDormidos(db, HOY);

  ok(esDormido(dormidos, semanalDormido), 'SEMANAL a 40 días → DORMIDO (su ritmo es 7 d; el suelo de 30 lo delata)');
  ok(!esDormido(dormidos, semanalAlDia), 'SEMANAL a 10 días → no dormido (el suelo de 30 d protege al muy frecuente)');
  ok(!esDormido(dormidos, trimestralOk),
     'TRIMESTRAL a 100 días → NO dormido (un listón fijo de 90 lo habría marcado por error: compra cada 90 d)');
  ok(esDormido(dormidos, trimestralDorm), 'TRIMESTRAL a 200 días → DORMIDO (se pasó de su ×2 = 180)');
  ok(esDormido(dormidos, unicaDormida), 'UNA sola compra hace 120 días → DORMIDO (respaldo de 90)');
  ok(!esDormido(dormidos, unicaReciente), 'UNA sola compra hace 60 días → no dormido (aún dentro del respaldo)');
  ok(!esDormido(dormidos, nuncaCompro), 'el que NUNCA compró NO entra: no está dormido, es que nunca despertó');

  // El porqué, comprobable:
  const dSem = dormidos.find(d => d.client_id === semanalDormido);
  ok(dSem.ritmo_dias === 7 && dSem.umbral_dias === 30, 'aprende el ritmo real: 7 d de hueco mediano, umbral 30');
  // (Huecos reales de un trimestral: 90 y 91 días → mediana 90,5 → umbral 181. Lo que importa es que
  //  está MUY por encima de los 90 de un listón fijo, no el redondeo exacto.)
  const dTri = umbralDormido(['2026-01-01', '2026-04-01', '2026-07-01']);
  ok(dTri.umbral >= 180, 'un trimestral tendría umbral ' + dTri.umbral + ' días, no 90: un listón fijo lo maltrataría');
  ok(dSem.motivo && /compra cada 7 días/.test(dSem.motivo), 'la propuesta puede EXPLICARSE ("' + dSem.motivo + '")');

  // La mediana, no la media: una compra rara no debe torcer el ritmo.
  const rara = umbralDormido(['2026-01-01', '2026-01-08', '2026-01-15', '2026-06-15']);   // huecos 7,7,151
  ok(rara.ritmo === 7, 'usa la MEDIANA: un hueco raro de 151 días no le sube el ritmo (media habría dado ~55)');

  // ── EL BUG QUE ENCONTRÓ UN CLIENTE REAL ─────────────────────────────────────
  // Ana Fernández tenía TRES facturas del MISMO día (una visita, tres documentos). Contando FACTURAS
  // salían "dos huecos de 0 días" → ritmo 0 → se le daba por dormida a los 30 días, con la explicación
  // indefendible de que "compra cada 0 días de media". Tres facturas de una misma visita son UNA
  // compra. Se mide en DÍAS DE COMPRA, no en facturas.
  const mismoDia = umbralDormido(['2026-05-28', '2026-05-28', '2026-05-28']);
  ok(mismoDia.dias_compra === 1, 'tres facturas del MISMO día = UNA compra, no tres');
  ok(mismoDia.umbral === DIAS_UNA_COMPRA, 'y sin ritmo que aprender le toca el respaldo de 90 días, no el suelo de 30');
  ok(mismoDia.ritmo === null && !/cada 0 días/.test(mismoDia.motivo),
     'la explicación NO dice el disparate de "compra cada 0 días" ("' + mismoDia.motivo + '")');
  const anaComoCliente = sembrarCliente(db, 'ZZ Tres facturas un día', 'i@zz.test', [47, 47, 47]);
  ok(!esDormido(clientesDormidos(db, HOY), anaComoCliente),
     'y a 47 días NO se la propone: compró una vez, y el respaldo son 90 días (antes se colaba)');

  // ── 3. EL FANTASMA DEL MOSTRADOR ────────────────────────────────────────────
  //
  // Una venta de mostrador ANÓNIMA (factura simplificada, serie S, sin `client_id`) es la mitad de la
  // facturación de este negocio. No es de NADIE: ni tiene a quién reengancharse, ni puede hacer que
  // otro parezca dormido o despierto. Es el riesgo real de esta propuesta —proponerte escribir a un
  // cliente que en realidad te compra todas las semanas en el mostrador, o al revés— así que no basta
  // con contarlo: hay que afirmarlo.
  console.log('\n[3] El fantasma del mostrador: la venta anónima no es de nadie');

  // (a) UNA VENTA ANÓNIMA NUNCA GENERA PROPUESTA. Sin ficha no hay a quién escribir.
  //
  // OJO CON EL ORDEN, que aquí me equivoqué yo primero: hay que generar la LÍNEA BASE **antes** de
  // sembrar los fantasmas. Si se genera después, las propuestas de los clientes legítimos que ya
  // estaban dormidos se cuentan como si las hubieran creado los fantasmas, y el gate acusa al
  // producto de un fallo que es del gate.
  const baseGen = generarPropuestasDormidos(db, { today: HOY });
  const clientesBase = db.prepare('SELECT client_id FROM disa_proposals WHERE type=? ORDER BY client_id').all(TIPO_DORMIDO).map(r => r.client_id);
  const candidatosAntes = clientesDormidos(db, HOY);
  ok(clientesBase.length >= 3, 'línea base: ' + clientesBase.length + ' propuestas, de clientes CON ficha');

  // Ventas anónimas repartidas: una MUY vieja (podría "dormir" a alguien) y una de AYER (podría
  // "despertarlo"). Si el fantasma contara para alguien, una de las dos lo delataría.
  const anon = [ventaMostrador(db, 400), ventaMostrador(db, 200), ventaMostrador(db, 1)];
  ok(db.prepare('SELECT COUNT(*) n FROM invoices WHERE id IN (' + anon.join(',') + ') AND client_id IS NULL').get().n === 3,
     'sembradas 3 ventas de mostrador ANÓNIMAS (serie S, sin cliente)');

  const rAnon = generarPropuestasDormidos(db, { today: HOY });
  ok(rAnon.creadas === 0, 'las ventas anónimas NO generan NI UNA propuesta nueva (creadas: ' + rAnon.creadas + ')');
  const clientesTras = db.prepare('SELECT client_id FROM disa_proposals WHERE type=? ORDER BY client_id').all(TIPO_DORMIDO).map(r => r.client_id);
  ok(JSON.stringify(clientesTras) === JSON.stringify(clientesBase),
     'y las propuestas siguen siendo EXACTAMENTE las mismas, de los mismos clientes');
  ok(!db.prepare('SELECT 1 FROM disa_proposals WHERE type=? AND client_id IS NULL').get(TIPO_DORMIDO),
     'NINGUNA propuesta de dormido apunta a "nadie" (client_id NULL)');
  ok(clientesDormidos(db, HOY).every(d => d.client_id != null),
     'todo candidato a dormido tiene ficha: no hay fantasmas en la lista');
  // LA VÍA DE CONTACTO SE EXIGE DONDE TOCA: en la PROPUESTA, no en el análisis. `clientesDormidos`
  // mide quién se ha enfriado, y eso no depende de si tiene correo; el filtro vive en
  // `generarPropuestasDormidos` («sin email no hay reenganche posible»), que descarta a quien no se
  // puede reenganchar y lo CUENTA. Esta comprobación se lo pedía al análisis, así que se puso roja
  // en cuanto el negocio tuvo clientes sin correo — con el producto haciendo lo correcto en el sitio
  // correcto. Ahora se comprueba lo que de verdad importa: que no salga NI UNA propuesta imposible.
  const propsDorm = db.prepare(
    'SELECT p.client_id, c.email FROM disa_proposals p LEFT JOIN clients c ON c.id = p.client_id WHERE p.type = ?'
  ).all(TIPO_DORMIDO);
  ok(propsDorm.every(x => !!x.email),
     'y NINGUNA propuesta apunta a quien no tiene forma de recibirla',
     propsDorm.length + ' propuestas, ' + propsDorm.filter(x => !x.email).length + ' sin correo');

  // (b) LA INVARIANTE: el estado de un cliente REAL es IDÉNTICO con y sin las ventas anónimas.
  //     No se compara "¿sigue dormido?", que sería flojo: se compara su FICHA ENTERA de sueño
  //     (días, ritmo, umbral, nº de compras, última compra). Si el fantasma se colara por cualquier
  //     rendija del cálculo, uno de esos números se movería.
  const fichaDe = (lista, id) => {
    const d = lista.find(x => x.client_id === id);
    return d ? JSON.stringify({ dormido: true, dias: d.dias_sin_comprar, ritmo: d.ritmo_dias, umbral: d.umbral_dias, compras: d.compras, ultima: d.ultima_compra })
             : JSON.stringify({ dormido: false });
  };
  const conFantasmas = clientesDormidos(db, HOY);
  for (const [nombre, id] of [['semanal DORMIDO', semanalDormido], ['semanal al día', semanalAlDia],
                              ['trimestral al día', trimestralOk], ['trimestral DORMIDO', trimestralDorm],
                              ['una compra vieja', unicaDormida], ['una compra reciente', unicaReciente]]) {
    ok(fichaDe(candidatosAntes, id) === fichaDe(conFantasmas, id),
       'el fantasma NO altera al cliente "' + nombre + '": su ficha de sueño es idéntica  ' + fichaDe(conFantasmas, id));
  }
  ok(conFantasmas.length === candidatosAntes.length,
     'y la lista de dormidos tiene exactamente los mismos: ' + candidatosAntes.length + ' → ' + conFantasmas.length);

  // Y al revés, por si acaso: quitarlas tampoco cambia nada (la invariante en los dos sentidos).
  db.prepare('DELETE FROM invoices WHERE id IN (' + anon.join(',') + ')').run();
  const sinFantasmas = clientesDormidos(db, HOY);
  ok(fichaDe(sinFantasmas, semanalDormido) === fichaDe(conFantasmas, semanalDormido)
     && sinFantasmas.length === conFantasmas.length,
     'quitar las ventas anónimas tampoco mueve nada: el fantasma no contaba, ni para bien ni para mal');

  // (c) MOSTRADOR ATRIBUIDO: si la venta SÍ quedó pegada a una ficha, ESA compra CUENTA como
  //     cualquier otra. El cliente compra por F y por mostrador — es el mismo cliente.
  //     La prueba es dura a propósito: sin contar el ticket, este cliente saldría DORMIDO.
  //     Sus facturas F son de hace 200 y 150 días (ritmo 50 → umbral 100), así que a 150 días
  //     estaría dormido. Pero hace 10 días pasó por el mostrador y quedó apuntado a su ficha.
  const conTicket = sembrarCliente(db, 'ZZ Compra en mostrador', 'j@zz.test', [200, 150]);
  ok(esDormido(clientesDormidos(db, HOY), conTicket), 'antes del ticket: DORMIDO (última compra hace 150 días, umbral 100)');
  ventaMostrador(db, 10, conTicket);   // ← mostrador ATRIBUIDO a su ficha
  const trasTicket = clientesDormidos(db, HOY);
  ok(!esDormido(trasTicket, conTicket),
     'el ticket de mostrador ATRIBUIDO a su ficha SÍ cuenta: ya NO está dormido (compró hace 10 días)');
  const fichaTicket = umbralDormido(
    db.prepare('SELECT issue_date FROM invoices WHERE client_id=? ORDER BY issue_date').all(conTicket).map(r => r.issue_date));
  ok(fichaTicket.dias_compra === 3, 'y su ticket cuenta como un DÍA DE COMPRA más (3, no 2): entra en su ritmo');
  generarPropuestasDormidos(db, { today: HOY });
  ok(!propuestoPara(db, conTicket), 'así que NO se te propone reengancharlo: te compró la semana pasada');

  // ── 3b. Facturas ANULADAS: tampoco cuentan como compra ──────────────────────
  const soloAnulada = sembrarCliente(db, 'ZZ Solo anulada', 'h@zz.test', [200]);
  db.prepare("UPDATE invoices SET status='anulada' WHERE client_id=?").run(soloAnulada);
  ok(!esDormido(clientesDormidos(db, HOY), soloAnulada), 'cliente con su única factura ANULADA → no cuenta como compra (no se propone)');

  // ── 4. Generación de propuestas ─────────────────────────────────────────────
  console.log('\n[4] Generación');
  const sinEmail = sembrarCliente(db, 'ZZ Dormido sin email', null, [200]);
  const r1 = generarPropuestasDormidos(db, { today: HOY });
  // Se afirma sobre los clientes que ESTE gate siembra, no sobre un total que depende de los datos
  // vivos de la copia. Un gate que se apoya en datos ajenos se pudre. (Las propuestas de los dormidos
  // ya nacieron en la línea base del bloque [3]; aquí se comprueba que SIGUEN y quiénes son.)
  ok(!!propuestoPara(db, semanalDormido) && !!propuestoPara(db, trimestralDorm) && !!propuestoPara(db, unicaDormida),
     'los tres dormidos con email tienen su propuesta');
  ok(!propuestoPara(db, trimestralOk) && !propuestoPara(db, semanalAlDia) && !propuestoPara(db, nuncaCompro),
     'los que NO están dormidos no tienen ninguna');
  ok(r1.sinEmail >= 1 && !propuestoPara(db, sinEmail),
     'dormido SIN email → NO se propone (sería un botón que no puede funcionar); se cuenta como hallazgo');
  const p1 = propuestoPara(db, semanalDormido);
  ok(p1.body === '' , 'la propuesta nace SIN borrador: el texto se redacta al aprobar, no la madrugada en que se detectó');
  ok(p1.invoice_id === null && p1.occurrence_id === null, 'se ancla al CLIENTE, no a un documento (no hay documento: de eso va)');

  // ── 5. Idempotencia (índice PARCIAL) ────────────────────────────────────────
  console.log('\n[5] Idempotencia');
  const r2 = generarPropuestasDormidos(db, { today: HOY });
  ok(r2.creadas === 0, 'segunda pasada: 0 creadas');
  const r3 = generarPropuestasDormidos(db, { today: HOY });
  ok(r3.creadas === 0, 'tercera pasada: sigue sin duplicar');
  ok(db.prepare("SELECT COUNT(*) n FROM disa_proposals WHERE client_id=? AND type=? AND status='pendiente'").get(semanalDormido, TIPO_DORMIDO).n === 1,
     'sigue habiendo UNA sola propuesta pendiente para ese cliente');
  let choco = false;
  try { db.prepare("INSERT INTO disa_proposals (type, client_id, status) VALUES (?,?,'pendiente')").run(TIPO_DORMIDO, semanalDormido); }
  catch { choco = true; }
  ok(choco, 'el índice PARCIAL rechaza una segunda PENDIENTE del mismo cliente (el candado está en la BD)');

  // ── 6. APROBAR = REDACTAR. NO ENVÍA NADA. ───────────────────────────────────
  console.log('\n[6] Aprobar redacta, y NO envía');
  const actividadAntes = db.prepare("SELECT COUNT(*) n FROM client_activities WHERE client_id=?").get(semanalDormido).n;
  const app = appPara(db, ['clients.read', 'crm.manage']);
  const resR = await POST(app, '/' + p1.id + '/redactar');
  const bodyR = await resR.json();
  ok(resR.status === 200 && bodyR.ok, 'POST /:id/redactar → 200');
  ok(bodyR.subject && bodyR.body && bodyR.body.length > 30, 'DISA devuelve un borrador con asunto y cuerpo');
  ok(/ZZ Semanal dormido/.test(bodyR.body) || /ZZ Semanal dormido/.test(bodyR.subject) || bodyR.to === 'a@zz.test',
     'el borrador es PARA ese cliente (' + bodyR.to + ')');
  ok(!/factura|deuda|vencid|pagar/i.test(bodyR.body), 'tono de reenganche, NO de cobro: no habla de facturas ni de deudas');
  // El fallo que casi se cuela: reutilizar el tono 'seguimiento' escribía "Retomo el hilo de TU
  // SOLICITUD" a un cliente que no ha pedido nada. Un email sutilmente falso a alguien que ya se fue
  // es peor que no escribirle. El borrador NO puede inventarse un asunto que no existe.
  ok(!/tu solicitud|solicitud/i.test(bodyR.body + ' ' + bodyR.subject),
     'NO se inventa una "solicitud" que el cliente nunca hizo (no hay obra abierta: hay una relación fría)');
  ok(!/echamos de menos|te extrañamos|oferta|descuento|promoc/i.test(bodyR.body),
     'ni culpa ni marketing: se saluda y se deja la puerta abierta');
  const pRedactada = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(p1.id);
  ok(pRedactada.body && pRedactada.body.trim().length > 0, 'el borrador queda guardado en la propuesta');
  ok(pRedactada.status === 'pendiente', 'y la propuesta SIGUE PENDIENTE: aprobar no la resuelve, la PREPARA');
  ok(db.prepare("SELECT COUNT(*) n FROM client_activities WHERE client_id=?").get(semanalDormido).n === actividadAntes,
     'NO se ha registrado ningún contacto: aprobar NO ENVIÓ NADA');
  ok(pRedactada.resolved_at === null, 'sin resolved_at: no se ha resuelto nada todavía');

  // El panel la enseña ya redactada, y con el porqué en vivo.
  const lista = propuestasPendientes(db, HOY, [TIPO_DORMIDO]);
  const vista = lista.find(x => x.id === p1.id);
  ok(vista.redactada === true, 'el panel sabe que ya está redactada (enseña el borrador, no el botón de redactar)');
  ok(vista.dias_sin_comprar === 40 && vista.viva === true, 'y recalcula sus días EN VIVO (40)');

  // ── 7. Enviar: los caminos que NO deben pasar (el envío real va en el gate) ──
  console.log('\n[7] Enviar: guardas');
  const appSinPerm = appPara(db, ['clients.read']);   // ve clientes pero NO puede escribirles
  const resNo = await POST(appSinPerm, '/' + p1.id + '/enviar', { subject: 'x', body: 'y' });
  ok(resNo.status === 403, 'sin crm.manage → POST /enviar 403');
  const pTrasIntento = db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(p1.id);
  ok(pTrasIntento.status === 'pendiente', 'y la propuesta sigue pendiente (no se dio por enviada)');
  const resVacio = await POST(app, '/' + p1.id + '/enviar', { subject: '', body: '' });
  ok(resVacio.status === 400, 'no se envía un borrador VACÍO → 400');

  // ── 8. Descartar + DESCANSO de 90 días ──────────────────────────────────────
  console.log('\n[8] Descanso de 90 días');
  const resD = await POST(app, '/' + p1.id + '/descartar');
  ok(resD.status === 200, 'descartar → 200');
  ok(db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(p1.id).status === 'descartada', 'queda descartada');
  // EL DESCARTE LO SELLA LA RUTA CON LA HORA REAL DEL SERVIDOR, y este escenario vive en una fecha
  // simulada. El descanso de 90 días se contaba entonces desde el HOY de verdad y no desde el del
  // guion: mientras las dos fechas estuvieron cerca no se notó, y al separarse el cliente seguía «en
  // descanso» a los 91 días simulados — un fallo cantado con el producto funcionando bien. Se sella
  // el descarte en la fecha del guion, que es la única con la que este escenario tiene sentido.
  db.prepare('UPDATE disa_proposals SET resolved_at=? WHERE id=?').run(HOY + 'T10:00:00Z', p1.id);

  const r4 = generarPropuestasDormidos(db, { today: HOY });
  ok(!propuestoPara(db, semanalDormido), 'al día siguiente NO se re-propone (está descansando)');
  ok(r4.enDescanso >= 1, 'el generador lo cuenta como "en descanso" (' + r4.enDescanso + ')');
  const desc = enDescanso(db, semanalDormido, HOY);
  ok(desc && desc.faltan > 0, 'le faltan ' + (desc && desc.faltan) + ' días de descanso');

  // A los 89 días: todavía no.
  const casi = new Date(Date.parse(HOY + 'T00:00:00Z') + 89 * 86400000).toISOString().slice(0, 10);
  generarPropuestasDormidos(db, { today: casi });
  ok(!propuestoPara(db, semanalDormido), 'a los 89 días: sigue sin re-proponerse');

  // A los 91: vuelve, porque sigue dormido.
  const pasado = new Date(Date.parse(HOY + 'T00:00:00Z') + 91 * 86400000).toISOString().slice(0, 10);
  const r5 = generarPropuestasDormidos(db, { today: pasado });
  ok(!!propuestoPara(db, semanalDormido), 'pasados los 90 días SÍ vuelve a proponerse (sigue sin comprar)');
  ok(db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE client_id=? AND type=?').get(semanalDormido, TIPO_DORMIDO).n === 2,
     'y la descartada NO se reescribió: hay DOS filas, el historial se conserva');

  // ── 9. El descanso cuenta también para la ENVIADA (si no, sería una máquina de spam) ──
  console.log('\n[9] El descanso también tras ENVIAR (o sería spam)');
  const pNueva = propuestoPara(db, semanalDormido);
  db.prepare("UPDATE disa_proposals SET status='aprobada_enviada', resolved_at=? WHERE id=?").run(pasado + 'T10:00:00Z', pNueva.id);
  const r6 = generarPropuestasDormidos(db, { today: pasado });
  ok(!propuestoPara(db, semanalDormido) && r6.enDescanso >= 1,
     'recién ENVIADO el email, NO se vuelve a proponer al día siguiente (un email no le hace comprar)');
  const tras90 = new Date(Date.parse(pasado + 'T00:00:00Z') + 91 * 86400000).toISOString().slice(0, 10);
  generarPropuestasDormidos(db, { today: tras90 });
  ok(!!propuestoPara(db, semanalDormido), 'y 90 días después del envío, si sigue dormido, vuelve a proponerse');

  // ── 10. FUERA de WRITABLE_TABLES ────────────────────────────────────────────
  console.log('\n[10] DISA no puede escribir en sus propias propuestas');
  const disaSrc = readFileSync('modules/disa/index.js', 'utf8');
  const bloque = disaSrc.slice(disaSrc.indexOf('const WRITABLE_TABLES'), disaSrc.indexOf('const WRITABLE_TABLES') + 1600);
  const escribibles = bloque.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(!/'disa_proposals'/.test(escribibles), 'disa_proposals NO está en WRITABLE_TABLES: DISA no puede escribirse sus propias propuestas');
  ok(!/'client_activities'/.test(escribibles), 'client_activities tampoco: el registro de contacto solo lo escribe el servicio validado');

  // ── 11. EL CANDADO ──────────────────────────────────────────────────────────
  console.log('\n[11] Candado de permisos');
  const dbC = copia('desarrollo-bamburu');
  const cli = sembrarCliente(dbC, 'ZZ Candado', 'k@zz.test', [200]);
  generarPropuestasDormidos(dbC, { today: HOY });
  const pC = propuestoPara(dbC, cli);
  ok(!!pC, 'hay una propuesta que proteger');

  const appNada = appPara(dbC, []);
  ok((await appNada.request('/')).status === 403, 'sin permisos: GET /propuestas → 403');

  // Ve clientes pero NO puede escribirles → NO la ve.
  const appSoloLee = appPara(dbC, ['clients.read', 'invoices.read']);
  const gLee = await (await appSoloLee.request('/')).json();
  ok(!(gLee.propuestas || []).some(x => x.type === TIPO_DORMIDO), 'SIN crm.manage: la propuesta de dormido NO aparece en su lista');
  const cLee = await (await appSoloLee.request('/contador')).json();
  ok(!(gLee.propuestas || []).some(x => x.id === pC.id), 'ni el badge se la cuela');
  ok((await POST(appSoloLee, '/' + pC.id + '/redactar')).status === 403, 'ni puede pedir el borrador a mano → 403');
  ok((await POST(appSoloLee, '/' + pC.id + '/enviar', { subject: 'x', body: 'y' })).status === 403, 'ni enviarlo → 403');
  ok((await POST(appSoloLee, '/' + pC.id + '/descartar')).status === 403, 'ni descartarla → 403');

  // Puede escribir pero NO ve clientes → tampoco la ve (la tarjeta enseña la ficha del cliente).
  const appSinClientes = appPara(dbC, ['crm.manage']);
  const gSin = await (await appSinClientes.request('/')).json();
  ok(!(gSin.propuestas || []).some(x => x.type === TIPO_DORMIDO), 'SIN clients.read: tampoco la ve');

  // Y quien SÍ puede, la ve y la cuenta.
  const appOk = appPara(dbC, ['clients.read', 'crm.manage']);
  const gOk = await (await appOk.request('/')).json();
  ok((gOk.propuestas || []).some(x => x.id === pC.id), 'quien SÍ puede: la ve en su lista');
  const cOk = await (await appOk.request('/contador')).json();
  ok(cOk.count >= 1, 'y el badge se la cuenta (' + cOk.count + ')');
  const appOwner = appPara(dbC, [], { owner: true });
  const gOwner = await (await appOwner.request('/')).json();
  ok((gOwner.propuestas || []).some(x => x.id === pC.id), 'el dueño la ve (bypass de owner, como en los otros tipos)');

  // La generación TAMBIÉN se filtra: quien no puede verla, no la dispara.
  dbC.prepare('DELETE FROM disa_proposals').run();
  await POST(appSoloLee, '/generar');
  ok(!propuestoPara(dbC, cli), 'quien no tiene permiso ni siquiera GENERA la propuesta (falla cerrado)');
  await POST(appOk, '/generar');
  ok(!!propuestoPara(dbC, cli), 'y quien lo tiene, sí');

  // ── 11b. EL BADGE Y EL PANEL DICEN EL MISMO NÚMERO ──────────────────────────
  //
  // Fija un bug real: la lista de "qué tipos ve este usuario" estaba escrita DOS VECES (rutas del
  // panel y layout del badge). Al añadir tipos nuevos solo se actualizó una, y el panel enseñaba 22
  // propuestas mientras el badge decía 21. Ahora la regla es única (`tiposVisiblesPara`) — y esto lo
  // vigila: si alguien añade un quinto tipo y se olvida del badge, esta aserción cae.
  console.log('\n[11b] El badge no puede mentir');
  const gPanel = await (await appOwner.request('/')).json();
  const cBadge = await (await appOwner.request('/contador')).json();
  ok(cBadge.count === (gPanel.propuestas || []).length,
     'el badge (' + cBadge.count + ') dice EXACTAMENTE lo mismo que el panel (' + (gPanel.propuestas || []).length + ')');
  ok((gPanel.propuestas || []).some(p => p.type === TIPO_DORMIDO),
     'y el número incluye los dormidos (el tipo nuevo entra en el badge, no se queda fuera)');
  const tiposOwner = tiposVisiblesPara({ get: k => k === 'isOwner' }, (c, p) => true);
  ok(tiposOwner.length === 6, 'la fuente única declara los SEIS tipos (' + tiposOwner.join(', ') + ')');

  // ── 12. Aislamiento ─────────────────────────────────────────────────────────
  console.log('\n[12] Aislamiento entre negocios');
  const dbB = copia('ibrahin-repuestos');
  generarPropuestasDormidos(dbB, { today: HOY });
  ok(!dbB.prepare('SELECT 1 FROM clients WHERE name LIKE ?').get('ZZ %'),
     'el otro negocio no ve NI UNO de los clientes sembrados (una BD por negocio)');

} finally {
  for (const p of copias) { for (const f of [p, p + '-wal', p + '-shm']) { try { unlinkSync(f); } catch {} } }
  console.log('\n  (copias desechables borradas; el negocio vivo NO se ha tocado)');
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Propuestas de cliente dormido: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
