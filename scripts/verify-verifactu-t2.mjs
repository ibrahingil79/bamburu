// Verificación VERI*FACTU · Tarea 2 (Fase A) — remisión de registros a la AEAT (SIMULADOR local).
//   node scripts/verify-verifactu-t2.mjs
// Ejercita el motor completo SIN certificado ni red a la AEAT: construye el XML desde los registros
// CONGELADOS de la Tarea 1, lo envía a un simulador SOAP local (camino feliz + error) y persiste el
// estado por documento. Comprueba idempotencia, bloqueo por datos (AVISO, no inventar), F2 sin
// destinatario, y el aviso claro cuando falta el certificado contra el endpoint real de la AEAT.
import Database from 'better-sqlite3';
import http from 'http';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { enviarRegistro, getEnvio, ESTADO } from '../modules/erp/verifactu-envio.js';

const DBF = join(tmpdir(), 'vf2-gate-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// SistemaInformatico completo (en el gate el productor está configurado; en real llega con el cert).
const SI = { NombreRazon: 'Bamburu Software SL', NIF: 'B12345678', IdSistemaInformatico: 'BM', NombreSistemaInformatico: 'Bamburu', Version: '1.0', NumeroInstalacion: '1', TipoUsoPosibleSoloVerifactu: 'S', TipoUsoPosibleMultiOT: 'S', IndicadorMultiplesOT: 'S' };

// Simulador SOAP local: series marcadas como "rechazables" devuelven Incorrecto; el resto Correcto.
const rechazar = new Set();
let contadorEnvios = 0;
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    contadorEnvios++;
    const serie = (b.match(/NumSerieFactura>([^<]+)</) || [])[1] || 'X';
    res.setHeader('Content-Type', 'text/xml');
    if ([...rechazar].some(s => b.includes(`<sf:NumSerieFactura>${s}</sf:NumSerieFactura>`))) {
      return res.end(`<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
        <R:RespuestaRegFactuSistemaFacturacion xmlns:R="urn:r" xmlns:s="urn:s"><s:CSV>CSV-X</s:CSV>
        <s:TiempoEsperaEnvio>120</s:TiempoEsperaEnvio><s:EstadoEnvio>Incorrecto</s:EstadoEnvio>
        <R:RespuestaLinea><s:IDFactura><s:NumSerieFactura>${serie}</s:NumSerieFactura></s:IDFactura>
        <s:EstadoRegistro>Incorrecto</s:EstadoRegistro><s:CodigoErrorRegistro>1122</s:CodigoErrorRegistro>
        <s:DescripcionErrorRegistro>Dato incorrecto</s:DescripcionErrorRegistro></R:RespuestaLinea>
        </R:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`);
    }
    res.end(`<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
      <R:RespuestaRegFactuSistemaFacturacion xmlns:R="urn:r" xmlns:s="urn:s"><s:CSV>CSV-OK-${serie}</s:CSV>
      <s:TiempoEsperaEnvio>60</s:TiempoEsperaEnvio><s:EstadoEnvio>Correcto</s:EstadoEnvio>
      <R:RespuestaLinea><s:IDFactura><s:NumSerieFactura>${serie}</s:NumSerieFactura></s:IDFactura>
      <s:EstadoRegistro>Correcto</s:EstadoRegistro></R:RespuestaLinea>
      </R:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`);
  });
});

const regAltaDe = invoiceId => db.prepare("SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type='alta' ORDER BY id LIMIT 1").get(invoiceId);

try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}/VerifactuSOAP`;
  const sim = { endpoint, cert: null, sistemaInfo: SI };

  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name) VALUES (1,'Test SL','89890001K','ES','F','R','IVA')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Cliente Uno','B99999999','empresa',0)").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Sin NIF','','particular',0)").run();
  try { db.prepare("INSERT INTO warehouses (name, is_default) VALUES ('Principal',1)").run(); } catch {}
  const cliConNif = db.prepare("SELECT id FROM clients WHERE fiscal_id='B99999999'").get().id;
  const cliSinNif = db.prepare("SELECT id FROM clients WHERE fiscal_id=''").get().id;

  console.log('\n=== Camino feliz: F1 con NIF → aceptado por el simulador ===\n');
  const f1 = createInvoice(db, { client_id: cliConNif, issue_date: '2026-03-10', irpf_rate: 0, lines: [{ description: 'Servicio', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  const reg1 = regAltaDe(f1.id);
  const e1 = await enviarRegistro(db, reg1.id, sim);
  ok(e1.estado === ESTADO.CORRECTO, 'F1 con NIF → estado ACEPTADO (correcto)');
  ok(e1.csv === 'CSV-OK-' + reg1.num_serie && e1.estado_envio === 'Correcto', 'persistido: CSV + EstadoEnvio Correcto');
  ok(e1.tiempo_espera_envio === 60 && e1.http_status === 200, 'persistido: TiempoEsperaEnvio(60) + HTTP 200');
  ok(!!e1.request_xml && !!e1.response_xml && e1.request_xml.includes('<sf:Huella>' + reg1.huella + '</sf:Huella>'), 'persistido: XML enviado (con huella congelada) + respuesta cruda');
  ok(e1.intentos === 1 && !!e1.enviado_at, 'persistido: 1 intento + fecha de envío');

  console.log('\n=== Idempotencia: reenviar lo aceptado NO duplica ni reenvía ===\n');
  const enviosAntes = contadorEnvios;
  const e1b = await enviarRegistro(db, reg1.id, sim);
  ok(contadorEnvios === enviosAntes, 'reenviar un registro ACEPTADO no vuelve a llamar a la AEAT');
  ok(e1b.intentos === 1, 'intentos sigue en 1 (no se reintenta lo aceptado)');
  ok(db.prepare('SELECT COUNT(*) c FROM verifactu_envios WHERE registro_id=?').get(reg1.id).c === 1, 'una sola fila de envío por registro (idempotente)');

  console.log('\n=== Camino de error: la AEAT rechaza (Incorrecto + código) ===\n');
  const f2 = createInvoice(db, { client_id: cliConNif, issue_date: '2026-03-11', irpf_rate: 0, lines: [{ description: 'Otro', quantity: 1, unit_price: 50, tax_rate: 21 }] });
  const reg2 = regAltaDe(f2.id);
  rechazar.add(reg2.num_serie);
  const e2 = await enviarRegistro(db, reg2.id, sim);
  ok(e2.estado === ESTADO.INCORRECTO, 'rechazo → estado INCORRECTO');
  ok(e2.codigo_error === '1122' && /incorrecto/i.test(e2.descripcion_error || ''), 'persistido: código y descripción del error (no se traga)');
  // el rechazado SÍ se puede reenviar (reintento)
  const e2b = await enviarRegistro(db, reg2.id, sim);
  ok(e2b.intentos === 2, 'un registro rechazado SÍ se puede reintentar (intentos=2)');

  console.log('\n=== Bloqueo por datos: F1 SIN NIF → no se envía, AVISO (no inventar) ===\n');
  const f3 = createInvoice(db, { client_id: cliSinNif, issue_date: '2026-03-12', irpf_rate: 0, lines: [{ description: 'Sin nif', quantity: 1, unit_price: 30, tax_rate: 21 }] });
  const reg3 = regAltaDe(f3.id);
  const enviosPrev = contadorEnvios;
  const e3 = await enviarRegistro(db, reg3.id, sim);
  ok(e3.estado === ESTADO.BLOQUEADO && /NIF del destinatario/.test(e3.aviso || ''), 'F1 sin NIF → bloqueado_datos con AVISO');
  ok(contadorEnvios === enviosPrev, 'bloqueado por datos → NO se llama a la AEAT');

  console.log('\n=== F2 (ticket, simplificada) → sin destinatario, se acepta ===\n');
  const tk = emitTicketSvc(db, { payment_method: 'efectivo', lines: [{ description: 'Venta libre', quantity: 1, unit_price: 10, tax_rate: 21 }] });
  const regTk = regAltaDe(tk.id);
  const eTk = await enviarRegistro(db, regTk.id, sim);
  ok(eTk.estado === ESTADO.CORRECTO, 'F2 sin NIF → aceptado (Destinatarios no obligatorio en simplificada)');
  ok(!eTk.request_xml.includes('<sf:Destinatarios>'), 'F2: el XML NO lleva Destinatarios');

  console.log('\n=== Sin certificado contra el endpoint REAL de la AEAT → aviso claro, no rompe ===\n');
  const f4 = createInvoice(db, { client_id: cliConNif, issue_date: '2026-03-13', irpf_rate: 0, lines: [{ description: 'Real', quantity: 1, unit_price: 20, tax_rate: 21 }] });
  const reg4 = regAltaDe(f4.id);
  const e4 = await enviarRegistro(db, reg4.id, { entorno: 'pruebas', sistemaInfo: SI });   // sin cert, endpoint real AEAT
  ok(e4.estado === ESTADO.ERROR_COM && /certificado/i.test(e4.aviso || ''), 'sin cert contra AEAT → error_comunicacion con aviso de certificado (sin excepción)');

  console.log('\n=== Consultable: getEnvio devuelve el estado por documento ===\n');
  ok(getEnvio(db, reg1.id).estado === ESTADO.CORRECTO && getEnvio(db, reg2.id).estado === ESTADO.INCORRECTO, 'getEnvio consultable por registro');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  server.close();
  db.close();
  try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
