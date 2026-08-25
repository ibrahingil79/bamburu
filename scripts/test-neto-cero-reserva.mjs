// Test — NETO-CERO de la PUERTA PÚBLICA (Escalera · paso 7 · PIEZA 6), sobre BD temporal + motores REALES.
//   node scripts/test-neto-cero-reserva.mjs
//
// DOS COSAS QUE HAY QUE DEMOSTRAR, y son distintas:
//
//  1. RESERVAR NO ES VENDER. Una reserva desde la calle NO emite factura, NO cobra, NO toca la cadena
//     Verifactu ni el diario ni el P&G. Es lo que el encargo pone fuera de alcance, y es exactamente el
//     tipo de cosa que se cuela sin que nadie mire: basta que alguien "aproveche" que ya hay un
//     product_id y un precio para llamar a createInvoice. Aquí se mide después de CADA paso.
//
//  2. Y CUANDO SÍ SE VENDE, SIGUE CUADRANDO. El dueño atiende la cita reservada y cobra por el motor de
//     siempre; anularla lo revierte por SU motor. Ventas y P&G vuelven al valor exacto de partida.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { atenderCitaSvc, anularCitaSvc } from '../modules/erp/routes/citas.js';
import {
  crearReservaPublica, cambiarReservaPublica, anularReservaPublica,
  aprobarReserva, rechazarReserva, caducarReservasPendientes,
} from '../modules/erp/reserva-publica.js';
import { dowDeFecha } from '../modules/erp/citas-engine.js';
import { ventasResumen } from '../modules/erp/ventas-metrics.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
const FROM = '2000-01-01', TO = '2100-01-01';

function nuevaBD() {
  const f = join(tmpdir(), 'neto-reserva-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare(
    `UPDATE company_config SET company_name='Test SL', fiscal_id='B00000000', country='ES',
       invoice_series='F', currency_symbol='€', cita_pub_activa=1, cita_pub_handle='test',
       cita_pub_antelacion_min=0, cita_pub_ventana_dias=60, cita_pub_politica='Avisa con 24 h.' WHERE id=1`
  ).run();
  return db;
}
function proximoLunes(desdeDias = 7) {
  const base = Date.now() + desdeDias * 86400000;
  for (let i = 0; i < 14; i++) {
    const f = new Date(base + i * 86400000).toISOString().slice(0, 10);
    if (dowDeFecha(f) === 1) return f;
  }
  return new Date(base).toISOString().slice(0, 10);
}

try {
  const db = nuevaBD();
  const U = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Ana Sistema','ana@t.local','x','employee',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO cita_pub_personas (user_id,visible,nombre_publico) VALUES (?,1,'Ana')").run(U);
  const S = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES ('Corte',20,'service','general',21,'active')").run().lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,margen_min,publico) VALUES (?,1,30,0,1)").run(S);
  for (let d = 1; d <= 5; d++) db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(d, 9 * 60, 14 * 60);

  const F = proximoLunes();
  const AHORA = { fecha: proximoLunes(0), min: 8 * 60, dow: dowDeFecha(proximoLunes(0)) };
  const T0 = 1800000000;

  // Todo lo que NO debe moverse al reservar, medido de golpe.
  const snap = () => ({
    ventas: ventasResumen(db),
    pyg: cuentaPyG(db, FROM, TO).resultadoExplotacion,
    facturas: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    lineas: db.prepare('SELECT COUNT(*) n FROM invoice_items').get().n,
    asientos: db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='journal_entries'").get().n
      ? db.prepare('SELECT COUNT(*) n FROM journal_entries').get().n : 0,
    verifactu: db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='verifactu_registros'").get().n
      ? db.prepare('SELECT COUNT(*) n FROM verifactu_registros').get().n : 0,
  });
  const igual = (a, b) => a.ventas.count === b.ventas.count && a.ventas.total === b.ventas.total
    && a.pyg === b.pyg && a.facturas === b.facturas && a.lineas === b.lineas
    && a.asientos === b.asientos && a.verifactu === b.verifactu;
  const dif = (a, b) => 'ventas ' + a.ventas.total + '→' + b.ventas.total + ' · P&G ' + a.pyg + '→' + b.pyg
    + ' · facturas ' + a.facturas + '→' + b.facturas + ' · verifactu ' + a.verifactu + '→' + b.verifactu;

  const base = snap();
  console.log('\n=== 1. RESERVAR NO EMITE, NO COBRA, NO TOCA NADA DEL DINERO ===\n');
  ok(base.ventas.count === 0 && base.facturas === 0, 'de partida: cero ventas y cero facturas');

  const r1 = crearReservaPublica(db, {
    service_ids: [S], user_id: U, fecha: F, inicio_min: 10 * 60,
    nombre: 'María', movil: '600111222', email: 'maria@ej.test', consent: true,
  }, { ahora: AHORA });
  const trasReserva = snap();
  ok(igual(base, trasReserva), 'tras RESERVAR desde la calle, todo igual — ' + dif(base, trasReserva));
  ok(db.prepare('SELECT invoice_id FROM citas WHERE id=?').get(r1.id).invoice_id === null, 'la cita reservada no cuelga de ninguna factura');

  cambiarReservaPublica(db, r1.id, { fecha: F, inicio_min: 11 * 60 }, { ahora: AHORA });
  ok(igual(base, snap()), 'tras CAMBIAR la hora desde el enlace, todo igual');

  anularReservaPublica(db, r1.id, { ahora: AHORA });
  ok(igual(base, snap()), 'tras ANULAR desde el enlace, todo igual');

  // Modo "yo apruebo": aprobar, rechazar y caducar tampoco mueven un euro.
  db.prepare("UPDATE company_config SET cita_pub_modo='aprobar' WHERE id=1").run();
  const r2 = crearReservaPublica(db, { service_ids: [S], user_id: U, fecha: F, inicio_min: 10 * 60, nombre: 'A', movil: '600222333', consent: true }, { ahora: AHORA, nowEpoch: T0 });
  ok(igual(base, snap()), 'una SOLICITUD pendiente no mueve nada');
  aprobarReserva(db, r2.id);
  ok(igual(base, snap()), 'APROBARLA tampoco (confirmar no es cobrar)');
  const r3 = crearReservaPublica(db, { service_ids: [S], user_id: U, fecha: F, inicio_min: 12 * 60, nombre: 'B', movil: '600333444', consent: true }, { ahora: AHORA, nowEpoch: T0 });
  rechazarReserva(db, r3.id);
  ok(igual(base, snap()), 'RECHAZARLA tampoco');
  const r4 = crearReservaPublica(db, { service_ids: [S], user_id: U, fecha: F, inicio_min: 13 * 60, nombre: 'C', movil: '600444555', consent: true }, { ahora: AHORA, nowEpoch: T0 });
  caducarReservasPendientes(db, T0 + 25 * 3600);
  ok(igual(base, snap()), 'y CADUCAR sola tampoco');
  ok(db.prepare('SELECT COUNT(*) n FROM invoices').get().n === 0,
     'después de 4 reservas, 1 cambio, 1 anulación, 1 aprobación, 1 rechazo y 1 caducidad: CERO facturas');

  console.log('\n=== 2. NO HAY GANCHO DE PAGO EN NINGUNA PARTE ===\n');
  {
    // El encargo prohíbe señal/prepago Y prohíbe dejar ganchos. Se comprueba sobre el CÓDIGO, porque un
    // gancho dormido no se ve en los datos: se ve el día que alguien lo enchufa.
    const { readFileSync } = await import('fs');
    const fuentes = [
      'modules/erp/reserva-publica.js',
      'modules/erp/reserva-publica-config.js',
      'modules/erp/routes/reserva-publica.js',
    ].map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
    const prohibidos = /stripe|redsys|paypal|checkout|payment_intent|prepago|se[ñn]al_|deposito_|pasarela|sepa_|tarjeta_token/i;
    ok(!prohibidos.test(fuentes), 'la puerta pública no menciona ninguna pasarela, señal ni prepago');
    ok(!/createInvoice|emitTicketSvc|resolveVatRate\(.*cobr/i.test(fuentes.replace(/resolveVatRate/g, 'X')) || !/createInvoice|emitTicketSvc/.test(fuentes),
       'y no importa ni llama a los motores de emisión (createInvoice / emitTicketSvc)');
    ok(!/cita_pub_(senal|deposito|pago|precio_senal)/i.test(fuentes), 'ni hay columnas de configuración de señal esperando a ser usadas');
  }

  console.log('\n=== 3. Y CUANDO EL DUEÑO SÍ COBRA, CUADRA (por el motor de siempre) ===\n');
  {
    db.prepare("UPDATE company_config SET cita_pub_modo='auto' WHERE id=1").run();
    const antes = snap();
    const r = crearReservaPublica(db, {
      service_ids: [S], user_id: U, fecha: F, inicio_min: 9 * 60,
      nombre: 'Cobrada', movil: '600555666', consent: true,
    }, { ahora: AHORA });
    ok(igual(antes, snap()), 'la reserva por sí sola: nada');

    const at = atenderCitaSvc(db, r.id, { cobrar: true, via: 'ticket', payment_method: 'efectivo' });
    ok(at.invoice_id, 'al ATENDER con cobro se emite por el motor de siempre (ticket), no por un camino nuevo');
    const conCobro = snap();
    ok(conCobro.ventas.count === antes.ventas.count + 1 && conCobro.ventas.total > antes.ventas.total,
       'y entonces sí aparece en Ventas (total ' + conCobro.ventas.total + ')');
    ok(db.prepare('SELECT status FROM invoices WHERE id=?').get(at.invoice_id).status === 'emitida', 'la factura queda emitida');

    anularCitaSvc(db, r.id, 'Prueba neto-cero pieza 6');
    ok(db.prepare('SELECT status FROM invoices WHERE id=?').get(at.invoice_id).status === 'anulada',
       'anular la cita revierte el cobro por SU motor (anularInvoice)');
    const final = snap();
    ok(final.ventas.count === antes.ventas.count && final.ventas.total === antes.ventas.total,
       'VENTAS vuelve EXACTAMENTE al valor de partida (' + final.ventas.total + ' = ' + antes.ventas.total + ')');
    ok(final.pyg === antes.pyg, 'y el P&G también (' + final.pyg + ' = ' + antes.pyg + ')');
    ok(final.ventas.total === base.ventas.total && final.pyg === base.pyg,
       'NETO-CERO de toda la sesión: Ventas y P&G iguales al principio de todo');
  }

  console.log('\n' + '─'.repeat(72));
  console.log(fail === 0 ? `✅ NETO-CERO — ${pass} comprobaciones, 0 fallos` : `❌ ${fail} FALLO(S) de ${pass + fail}`);
} finally {
  for (const [db, f] of dbs) { try { db.close(); unlinkSync(f); } catch {} }
}
process.exit(fail === 0 ? 0 : 1);
