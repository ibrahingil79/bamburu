// Test de LÓGICA — FACTURAR HORAS (Escalera · paso 7 · PIEZA 3), sobre BD temporal.
//   node scripts/test-facturar-horas.mjs
//
// Demuestra: qué entradas son facturables (facturable=1, finalizadas, no facturadas, en rango); agrupación
// UNA línea por (tarea + tarifa); la factura REAL creada por el motor CUADRA AL CÉNTIMO con la vista previa;
// las entradas quedan marcadas (facturada EN VIVO), fuera de la lista y bloqueadas para editar/eliminar;
// anular la factura las LIBERA solas; sin tarifa → 400; proyecto sin cliente → 400; IVA por defecto de la
// empresa + override; IRPF; entrada de otro proyecto rechazada; migración idempotente (columna + índice).
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createProyectoSvc } from '../modules/erp/routes/proyectos.js';
import { createEntry, updateEntry, deleteEntry, tiempoDeProyecto } from '../modules/erp/routes/tiempo.js';
import { facturables, previewFacturaHoras, facturarHoras } from '../modules/erp/routes/facturar-horas.js';
import { anularInvoice } from '../modules/erp/routes/invoices.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
const intenta = fn => { try { return { r: fn() }; } catch (e) { return { e }; } };
function nuevaBD() {
  const f = join(tmpdir(), 'fh-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, tax_rate, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA',21,'€')").run();
  return db;
}
const nuevoUsuario = (db, name, tarifa) => db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,tarifa_hora) VALUES (?,?,?,'employee',1,?)").run(name, name + '@t.local', 'x', tarifa).lastInsertRowid;
const nuevoCliente = (db, name) => db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES (?,?, 'ES',1)").run(name, 'X0000000X').lastInsertRowid;
const HOY = new Date().toISOString().slice(0, 10);
const ADMIN = { esAdmin: true, userId: 0 };

try {
  const db = nuevaBD();
  const U1 = nuevoUsuario(db, 'Ana', 60);        // tarifa 60/h
  const U2 = nuevoUsuario(db, 'Beto', null);     // sin tarifa propia
  const CLI = nuevoCliente(db, 'Cliente ACME');
  const P1 = createProyectoSvc(db, { nombre: 'Web ACME', modo_cobro: 'horas', tarifa_hora: 40, cliente_id: CLI }).id;   // CON cliente, CON tarifa de proyecto
  const P2 = createProyectoSvc(db, { nombre: 'Interno sin cliente', modo_cobro: 'horas', tarifa_hora: 50 }).id;         // SIN cliente (tarifa 50)
  const P3 = createProyectoSvc(db, { nombre: 'Con cliente sin tarifa', modo_cobro: 'horas', cliente_id: CLI }).id;      // CON cliente, SIN tarifa de proyecto

  console.log('\n=== 1. facturables(): qué entra y qué no ===\n');
  const e1 = createEntry(db, U1, { proyecto_id: P1, fecha: HOY, horas: 2, minutos: 0, facturable: true, descripcion: 'Maquetación' });   // 2h, tarifa persona 60
  const e2 = createEntry(db, U1, { proyecto_id: P1, fecha: HOY, horas: 1, minutos: 0, facturable: false, descripcion: 'Café' });         // NO facturable
  const e3 = createEntry(db, U2, { proyecto_id: P1, fecha: HOY, horas: 3, minutos: 0, facturable: true, descripcion: 'Backend' });        // U2 sin tarifa propia → cae a la del proyecto (40)
  const fbles = facturables(db, { proyecto_id: P1 });
  ok(fbles.length === 2, 'solo 2 facturables (excluye la NO facturable): ' + fbles.length);
  ok(fbles.every(e => e.id !== e2.id), 'la entrada NO facturable no aparece');
  const rE1 = fbles.find(e => e.id === e1.id), rE3 = fbles.find(e => e.id === e3.id);
  ok(rE1.tarifa_efectiva === 60 && rE1.importe === 120, 'e1: tarifa de la PERSONA (60) → 2h = 120€');
  ok(rE3.tarifa_efectiva === 40 && !rE3.sin_tarifa, 'e3: sin tarifa de persona → cae a la del PROYECTO (40)');

  console.log('\n=== 2. Vista previa: UNA línea por (tarea + tarifa) ===\n');
  // Otra entrada con la MISMA descripción y MISMA tarifa que e1 → deben AGRUPARSE en una sola línea.
  const e4 = createEntry(db, U1, { proyecto_id: P1, fecha: HOY, horas: 1, minutos: 0, facturable: true, descripcion: 'Maquetación' });   // +1h a 60 = mismo grupo que e1
  const prev = previewFacturaHoras(db, { proyecto_id: P1 });
  const lMaq = prev.lineas.find(l => l.description === 'Maquetación');
  ok(prev.lineas.length === 2, '2 líneas: "Maquetación"@60 (e1+e4 juntas) y "Backend"@40: ' + prev.lineas.map(l => l.description + '@' + l.unit_price).join(', '));
  ok(lMaq && lMaq.quantity === 3 && lMaq.base === 180, 'la línea "Maquetación" agrupa 2h+1h = 3h → 180€');
  ok(prev.iva_defecto === 21, 'IVA por defecto = el de la empresa (21)');

  console.log('\n=== 3. Facturar: cuadra al céntimo + entradas marcadas ===\n');
  const ids = prev.entradas.filter(e => !e.sin_tarifa).map(e => e.id);
  const subtotalEsperado = Math.round(prev.lineas.reduce((s, l) => s + l.base, 0) * 100) / 100;   // 180 + 120 = 300
  const res = facturarHoras(db, { proyecto_id: P1, entry_ids: ids });
  const inv = db.prepare('SELECT subtotal, tax_amount, total, status FROM invoices WHERE id=?').get(res.invoice_id);
  ok(inv.status === 'emitida', 'la factura nace EMITIDA');
  ok(inv.subtotal === subtotalEsperado, 'subtotal factura (' + inv.subtotal + ') == suma de bases de la vista previa (' + subtotalEsperado + ')');
  ok(inv.tax_amount === Math.round(subtotalEsperado * 21) / 100, 'IVA de la factura = 21% del subtotal (' + inv.tax_amount + ')');
  ok(inv.total === Math.round((subtotalEsperado + subtotalEsperado * 0.21) * 100) / 100, 'total factura = base + IVA (' + inv.total + ')');
  ok(res.n_lineas === 2, 'la factura tiene 2 líneas (una por tarea+tarifa)');
  const items = db.prepare('SELECT COUNT(*) n FROM invoice_items WHERE invoice_id=?').get(res.invoice_id).n;
  ok(items === 2, 'invoice_items = 2');

  console.log('\n=== 4. Las entradas quedan facturadas, fuera y bloqueadas ===\n');
  const marcadas = db.prepare('SELECT COUNT(*) n FROM time_entries WHERE invoice_id=? ').get(res.invoice_id).n;
  ok(marcadas === ids.length, 'todas las entradas facturadas quedan enlazadas a la factura (' + marcadas + ')');
  const fbles2 = facturables(db, { proyecto_id: P1 });
  ok(fbles2.length === 0, 'ya no aparecen como facturables (0)');
  const proyTras = tiempoDeProyecto(db, P1);
  const eMarc = proyTras.entradas.find(e => e.id === e1.id);
  ok(eMarc.facturada === true && eMarc.invoice_number === res.invoice_number, 'en la ficha del proyecto la entrada figura FACTURADA (' + eMarc.invoice_number + ')');
  ok(intenta(() => updateEntry(db, ADMIN, e1.id, { proyecto_id: P1, fecha: HOY, horas: 5, minutos: 0, facturable: true })).e?.status === 409, 'editar una entrada facturada → 409');
  ok(intenta(() => deleteEntry(db, ADMIN, e1.id)).e?.status === 409, 'eliminar una entrada facturada → 409');

  console.log('\n=== 5. No se puede facturar dos veces (misma entrada) ===\n');
  ok(intenta(() => facturarHoras(db, { proyecto_id: P1, entry_ids: [e1.id] })).e?.status === 409, 'reintentar facturar una ya facturada → 409');

  console.log('\n=== 6. Anular la factura LIBERA las entradas (facturada en vivo) ===\n');
  anularInvoice(db, res.invoice_id, 'Prueba de anulación');
  ok(db.prepare('SELECT status FROM invoices WHERE id=?').get(res.invoice_id).status === 'anulada', 'la factura queda anulada');
  const fbles3 = facturables(db, { proyecto_id: P1 });
  ok(fbles3.length === ids.length, 'las entradas VUELVEN a ser facturables tras la anulación (' + fbles3.length + ') — sin tocar el motor de anulación');
  const eLib = tiempoDeProyecto(db, P1).entradas.find(e => e.id === e1.id);
  ok(eLib.facturada === false, 'la entrada ya NO figura como facturada');
  ok(intenta(() => updateEntry(db, ADMIN, e1.id, { proyecto_id: P1, fecha: HOY, horas: 2, minutos: 0, facturable: true })).e === undefined, 'liberada: se puede volver a editar');

  console.log('\n=== 7. Guardas: proyecto sin cliente y entrada sin tarifa ===\n');
  // (a) proyecto SIN cliente (P2): aunque la entrada tenga tarifa (U1=60), falla por cliente.
  const eP2 = createEntry(db, U1, { proyecto_id: P2, fecha: HOY, horas: 1, minutos: 0, facturable: true, descripcion: 'Y' });
  ok(intenta(() => facturarHoras(db, { proyecto_id: P2, entry_ids: [eP2.id] })).e?.status === 400, 'facturar un proyecto SIN cliente → 400');
  // (b) entrada SIN tarifa (P3 tiene cliente pero no tarifa; U2 tampoco) → sin_tarifa y no facturable.
  const eSin = createEntry(db, U2, { proyecto_id: P3, fecha: HOY, horas: 1, minutos: 0, facturable: true, descripcion: 'X' });
  ok(facturables(db, { proyecto_id: P3 }).find(e => e.id === eSin.id).sin_tarifa === true, 'entrada sin ninguna tarifa se marca sin_tarifa');
  ok(intenta(() => facturarHoras(db, { proyecto_id: P3, entry_ids: [eSin.id] })).e?.status === 400, 'facturar entrada sin tarifa → 400');

  console.log('\n=== 8. Entrada de OTRO proyecto rechazada + IVA override + IRPF ===\n');
  const CLI2 = nuevoCliente(db, 'Cliente 2');
  db.prepare('UPDATE proyectos SET cliente_id=? WHERE id=?').run(CLI2, P2);   // ahora P2 SÍ tiene cliente
  ok(intenta(() => facturarHoras(db, { proyecto_id: P2, entry_ids: [eP2.id, e3.id] })).e?.status === 400, 'mezclar una entrada de OTRO proyecto (e3∈P1) → 400');
  // Emitir P2 con IVA 10 e IRPF 15. eP2 lo hizo U1 (tarifa 60), 1h → base 60.
  const resP2 = facturarHoras(db, { proyecto_id: P2, entry_ids: [eP2.id], tax_rate: 10, irpf_rate: 15 });
  const invP2 = db.prepare('SELECT subtotal, tax_rate, tax_amount, irpf_rate, irpf_amount FROM invoices WHERE id=?').get(resP2.invoice_id);
  ok(invP2.subtotal === 60 && invP2.tax_amount === 6, 'IVA override 10%: base 60 → IVA 6');
  ok(invP2.irpf_rate === 15 && invP2.irpf_amount === 9, 'IRPF 15% aplicado: 9,00€');

  console.log('\n=== 9. Migración idempotente (columna + índice) ===\n');
  runMigrations(db); runMigrations(db);   // no debe lanzar ni duplicar
  const col = db.prepare("SELECT COUNT(*) n FROM pragma_table_info('time_entries') WHERE name='invoice_id'").get().n;
  ok(col === 1, 'columna time_entries.invoice_id existe (una sola vez)');
  const idx = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_time_entries_invoice'").get().n;
  ok(idx === 1, 'índice idx_time_entries_invoice existe');

  console.log('\n────────────────────────────────────────');
  console.log(`RESULTADO: ${pass} OK, ${fail} FALLOS`);
} catch (e) {
  console.error('\n💥 EXCEPCIÓN NO CONTROLADA:', e);
  fail++;
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
process.exit(fail ? 1 : 0);
