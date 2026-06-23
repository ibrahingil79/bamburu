// Verificación — Pilar 4 · Pieza 1: PRESUPUESTO + motor de conversión (lógica, BD temporal).
//   node scripts/verify-quotes.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { createQuoteSvc, updateQuoteSvc, emitQuoteSvc, anularQuoteSvc, anularYRehacerQuoteSvc, setFollowStatusSvc, convertQuoteSvc, emailQuoteSvc, quoteTotals } from '../modules/erp/routes/quotes.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round(n * 100) / 100;

console.log('\n=== Presupuesto (quotes) — Parte A (lógica) ===\n');
const dbPath = join(tmpdir(), 'q-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1,'Acme SL','B11111111',21)").run();
  db.prepare("UPDATE company_config SET fiscal_id='B11111111', country='ES', irpf_default=15, company_name='Acme SL', address='Calle Mayor 1', phone='600', email='acme@x.com' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id, address, email, client_type) VALUES ('Cliente Empresa SL','B22222222','Av. Test 2','cli@x.com','empresa')").run().lastInsertRowid;
  const ins = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)");
  const prod = ins.run('Mesa roble','mesa','MESA1',10,50,'active','physical',21,'general').lastInsertRowid;

  // 1) Crear borrador: línea catálogo (2×10, 21%) + línea libre (1×100, 21%). Cliente empresa → IRPF 15%.
  const qid = createQuoteSvc(db, { client_id: cli, lines: [
    { product_id: prod, description: '', quantity: 2, unit_price: 10, tax_rate: 21 },
    { description: 'Montaje a medida', quantity: 1, unit_price: 100, tax_rate: 21 },
  ]});
  let q = db.prepare('SELECT * FROM quotes WHERE id=?').get(qid);
  ok(q.status === 'borrador' && q.quote_number === null, 'borrador creado SIN número (no consume PRE-NNNN)');
  ok(db.prepare("SELECT last_seq FROM code_counters WHERE entity='quote'").get() === undefined, 'el contador de presupuestos no se tocó en el borrador');
  // totales: base 120, IVA 25.20, IRPF 18.00 (15% s/120), total 127.20
  ok(r2(q.subtotal) === 120 && r2(q.tax_amount) === 25.2 && r2(q.irpf_amount) === 18 && r2(q.total) === 127.2,
     'totales borrador: base 120 · IVA 25.20 · IRPF 18.00 · total 127.20  (got ' + [q.subtotal,q.tax_amount,q.irpf_amount,q.total].map(r2).join(' / ') + ')');
  const it = db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id').all(qid);
  ok(it.length === 2 && it[0].product_id === prod && it[0].description === 'Mesa roble' && it[1].product_id === null,
     'líneas: catálogo (product_id + nombre del producto) + línea libre (product_id NULL)');

  // 2) Editar borrador (sigue sin número)
  updateQuoteSvc(db, qid, { client_id: cli, lines: [{ product_id: prod, description: '', quantity: 3, unit_price: 10, tax_rate: 21 }] });
  q = db.prepare('SELECT * FROM quotes WHERE id=?').get(qid);
  ok(q.quote_number === null && r2(q.subtotal) === 30, 'editar borrador OK, sigue sin número (base 30)');

  // 3) Emitir → PRE-0001 + foto congelada
  const em = emitQuoteSvc(db, qid);
  q = db.prepare('SELECT * FROM quotes WHERE id=?').get(qid);
  ok(em.quote_number === 'PRE-0001' && q.status === 'emitido', 'emitir → número PRE-0001 y estado emitido (número SOLO al emitir)');
  ok(q.company_name === 'Acme SL' && q.client_name === 'Cliente Empresa SL' && q.client_fiscal_id === 'B22222222',
     'foto congelada de emisor + cliente copiada al emitir');

  // 4) transiciones bloqueadas
  let blocked = 0;
  try { updateQuoteSvc(db, qid, { client_id: cli, lines: [{ description: 'x', quantity: 1, unit_price: 1, tax_rate: 21 }] }); } catch (e) { if (e.status === 400) blocked++; }
  try { emitQuoteSvc(db, qid); } catch (e) { if (e.status === 400) blocked++; }
  ok(blocked === 2, 'un emitido NO se edita ni se re-emite (400 en ambos)');

  // 5) Foto congelada: cambiar empresa + cliente DESPUÉS no toca el emitido
  db.prepare("UPDATE company_config SET company_name='OTRO NOMBRE' WHERE id=1").run();
  db.prepare("UPDATE clients SET name='Cliente Renombrado' WHERE id=?").run(cli);
  q = db.prepare('SELECT * FROM quotes WHERE id=?').get(qid);
  ok(q.company_name === 'Acme SL' && q.client_name === 'Cliente Empresa SL', 'cambiar Ajustes/cliente tras emitir NO altera el presupuesto emitido (foto congelada)');

  // 6) seguimiento
  setFollowStatusSvc(db, qid, 'aceptado');
  ok(db.prepare('SELECT follow_status FROM quotes WHERE id=?').get(qid).follow_status === 'aceptado', 'seguimiento aceptado/rechazado/caducado (aceptado)');

  // 7) conversión a FACTURA: arrastra líneas + enlace origen↔destino
  const conv = convertQuoteSvc(db, qid, 'invoice');
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(conv.invoice_id);
  const invItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(conv.invoice_id);
  ok(!!inv && invItems.length === 1 && r2(invItems[0].total_price) === 30, 'conversión crea una FACTURA real arrastrando las líneas del presupuesto');
  const link = db.prepare("SELECT * FROM document_links WHERE source_type='quote' AND source_id=? AND dest_type='invoice'").get(qid);
  ok(link && link.dest_id === conv.invoice_id, 'enlace bidireccional origen↔destino en document_links (quote→invoice)');
  let conv2blocked = false; try { convertQuoteSvc(db, qid, 'invoice'); } catch (e) { conv2blocked = e.status === 400; }
  ok(conv2blocked, 're-convertir a factura el mismo presupuesto → 400 (ya convertido, sin duplicar)');
  let ticketDeferred = false; try { convertQuoteSvc(db, qid, 'ticket'); } catch (e) { ticketDeferred = e.status === 501; }
  ok(ticketDeferred, 'convertir a TICKET → 501 (destino registrado; se construye con la pieza de TPV)');

  // 8) numeración correlativa: un 2º presupuesto emitido → PRE-0002
  const q2 = createQuoteSvc(db, { client_id: cli, lines: [{ description: 'Servicio', quantity: 1, unit_price: 50, tax_rate: 21 }] });
  const em2 = emitQuoteSvc(db, q2);
  ok(em2.quote_number === 'PRE-0002', 'segundo emitido → PRE-0002 (contador solo avanza al emitir)');

  // 9) anular + anular-y-rehacer
  anularQuoteSvc(db, q2, 'cliente desistió');
  ok(db.prepare('SELECT status FROM quotes WHERE id=?').get(q2).status === 'anulado', 'anular (con motivo) → estado anulado');
  const q3 = createQuoteSvc(db, { client_id: cli, lines: [{ description: 'X', quantity: 1, unit_price: 9, tax_rate: 21 }] });
  emitQuoteSvc(db, q3);
  const re = anularYRehacerQuoteSvc(db, q3, 'corregir precio');
  ok(db.prepare('SELECT status FROM quotes WHERE id=?').get(q3).status === 'anulado'
     && db.prepare('SELECT replaces_quote_id, status FROM quotes WHERE id=?').get(re.id).replaces_quote_id === q3
     && db.prepare('SELECT COUNT(*) n FROM quote_items WHERE quote_id=?').get(re.id).n === 1,
     'anular-y-rehacer: anula el emitido y abre un borrador nuevo enlazado con las mismas líneas');

  // 10b) email a destinatario EDITABLE (mock — no envía de verdad).
  let mailedTo = null;
  const mock = async (p) => { mailedTo = p.to; return { data: { id: 'mock' }, error: null }; };
  // El cliente del presupuesto qid tiene email cli@x.com en su ficha (pre-relleno del campo "Para").
  ok(db.prepare('SELECT email FROM clients WHERE id=?').get(cli).email === 'cli@x.com', 'cliente con email en ficha → ese correo es el pre-relleno del campo "Para"');
  // Cambiar el destino a OTRO correo válido → envía a ese; la ficha NO cambia.
  const mailRes1 = await emailQuoteSvc(db, qid, { to: 'otro@dominio.com', sendEmail: mock });
  ok(mailRes1.sent && mailedTo === 'otro@dominio.com', 'enviar a un correo distinto del de la ficha → llega a ese (otro@dominio.com)');
  ok(db.prepare('SELECT email FROM clients WHERE id=?').get(cli).email === 'cli@x.com', 'editar el destino NO modifica la ficha del cliente');
  // Cliente SIN email en ficha → escribo uno válido → envía igualmente.
  const cliNoMail = db.prepare("INSERT INTO clients (name, fiscal_id, client_type) VALUES ('Sin Email','C33333333','particular')").run().lastInsertRowid;
  const qNoMail = createQuoteSvc(db, { client_id: cliNoMail, lines: [{ description: 'X', quantity: 1, unit_price: 5, tax_rate: 21 }] });
  emitQuoteSvc(db, qNoMail);
  const mailRes2 = await emailQuoteSvc(db, qNoMail, { to: 'nuevo@x.com', sendEmail: mock });
  ok(mailRes2.sent && mailedTo === 'nuevo@x.com', 'cliente SIN email en ficha → escribir un correo válido → se envía a nuevo@x.com');
  // Campo vacío → 400 (ya NO "ficha sin email"). Formato inválido → 400.
  let emptyErr = false; try { await emailQuoteSvc(db, qNoMail, { to: '', sendEmail: mock }); } catch (e) { emptyErr = e.status === 400 && /correo de destino/i.test(e.message); }
  ok(emptyErr, 'campo de destino vacío → 400 ("indica un correo de destino")');
  let badErr = false; try { await emailQuoteSvc(db, qNoMail, { to: 'no-es-un-email', sendEmail: mock }); } catch (e) { badErr = e.status === 400 && /formato/i.test(e.message); }
  ok(badErr, 'formato de email inválido → 400');

  // 10) migración idempotente: re-ejecutar no rompe ni duplica
  const before = db.prepare('SELECT COUNT(*) n FROM quotes').get().n;
  runMigrations(db);
  ok(db.prepare('SELECT COUNT(*) n FROM quotes').get().n === before, 'runMigrations idempotente (datos intactos al re-ejecutar)');
} finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}
console.log('\n=== RESULTADO PARTE A: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
