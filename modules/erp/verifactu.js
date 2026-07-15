// ── VERI*FACTU · Tarea 1 — Registro de facturación oficial (alta/anulación) ──
//
// Cadena de huella OFICIAL de la AEAT, SEPARADA de la cadena propietaria de integridad
// (invoices.verifactu_hash, que recorre superadmin/integridad.js). Implementa el documento
// oficial "Detalle de las especificaciones técnicas para la generación de la huella o hash
// de los registros de facturación" v0.1.2 (27/08/2024) y las "Características del QR" v0.5.0.
//
// Huella = SHA-256 (UTF-8) → hex MAYÚSCULAS (64 chars). Encadenamiento ÚNICO por tenant:
// cada registro (alta o anulación) enlaza con la huella del registro INMEDIATAMENTE anterior
// (cualquier tipo), en orden de id. La cadena ARRANCA LIMPIA en la implantación: el primer
// registro lleva prev_huella='' y primer_registro='S'. Las facturas anteriores NO se registran
// retroactivamente (no tenemos su FechaHoraHusoGenRegistro real; backdatear falsearía la huella).
//
// Verificado contra los 3 ejemplos oficiales del propio documento (ver scripts/verify-verifactu-t1.mjs).

import { createHash } from 'crypto';

// Servicio de cotejo del receptor para facturas VERI*FACTU. PRODUCCIÓN (Característ. QR v0.5.0).
// El entorno de pruebas (prewww2.aeat.es) entra en la Tarea 2, al cablear el envío.
export const COTEJO_BASE_URL = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR';

// Regla oficial: cada valor se toma "eliminando los espacios al inicio y al final".
const t = v => String(v == null ? '' : v).trim();

const sha256Upper = str => createHash('sha256').update(str, 'utf8').digest('hex').toUpperCase();

// 'YYYY-MM-DD' → 'DD-MM-YYYY' (FechaExpedicionFactura / parámetro fecha del QR).
export function toFechaExpedicion(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

// Importe/cuota con PUNTO decimal y 2 decimales; conserva el signo (abonos negativos).
export function fmtImporte(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

// Cadena de entrada de la huella del registro de ALTA (orden y formato EXACTOS del doc oficial).
export function altaHuellaString({ idEmisor, numSerie, fechaExpedicion, tipoFactura, cuotaTotal, importeTotal, prevHuella, fechaHoraHuso }) {
  return 'IDEmisorFactura=' + t(idEmisor) +
    '&NumSerieFactura=' + t(numSerie) +
    '&FechaExpedicionFactura=' + t(fechaExpedicion) +
    '&TipoFactura=' + t(tipoFactura) +
    '&CuotaTotal=' + t(cuotaTotal) +
    '&ImporteTotal=' + t(importeTotal) +
    '&Huella=' + t(prevHuella) +
    '&FechaHoraHusoGenRegistro=' + t(fechaHoraHuso);
}
export const altaHuella = d => sha256Upper(altaHuellaString(d));

// Cadena de entrada de la huella del registro de ANULACIÓN.
export function anulacionHuellaString({ idEmisor, numSerie, fechaExpedicion, prevHuella, fechaHoraHuso }) {
  return 'IDEmisorFacturaAnulada=' + t(idEmisor) +
    '&NumSerieFacturaAnulada=' + t(numSerie) +
    '&FechaExpedicionFacturaAnulada=' + t(fechaExpedicion) +
    '&Huella=' + t(prevHuella) +
    '&FechaHoraHusoGenRegistro=' + t(fechaHoraHuso);
}
export const anulacionHuella = d => sha256Upper(anulacionHuellaString(d));

// Marca de tiempo CONGELADA del momento de generación, ISO-8601 con huso de Europe/Madrid
// (p.ej. 2026-06-23T18:20:30+02:00). La huella depende de este instante: se PERSISTE tal cual
// y la Tarea 2 deberá transmitir EXACTAMENTE este valor. No se re-deriva después.
export function genTimestampMadrid(now = new Date()) {
  const tz = 'Europe/Madrid';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map(x => [x.type, x.value])
  );
  const offPart = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(now).find(x => x.type === 'timeZoneName').value;   // 'GMT+2' / 'GMT+1' / 'GMT'
  const m = offPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const sign = m ? m[1] : '+';
  const hh = String(m ? parseInt(m[2], 10) : 0).padStart(2, '0');
  const mm = String(m && m[3] ? parseInt(m[3], 10) : 0).padStart(2, '0');
  const hour = p.hour === '24' ? '00' : p.hour;   // algunos entornos dan '24' a medianoche
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

// URL del QR de cotejo (parámetros URL-encoded, UTF-8). Orden oficial: nif, numserie, fecha, importe.
export function cotejoUrl({ nif, numSerie, fecha, importe }) {
  const e = encodeURIComponent;
  return COTEJO_BASE_URL +
    '?nif=' + e(t(nif)) +
    '&numserie=' + e(t(numSerie)) +
    '&fecha=' + e(t(fecha)) +
    '&importe=' + e(t(importe));
}

// Huella del último registro de la cadena ÚNICA del tenant (alta o anulación), o '' si es el
// primer registro. Lectura por MAX(id): dentro de la MISMA transacción síncrona de emisión
// (better-sqlite3 es síncrono → lectura + inserción atómicas), no hay carrera de "huella anterior".
// A1 (Eje C): Verifactu exige UNA cadena de huellas POR OBLIGADO TRIBUTARIO (NIF). Se filtra por
// `id_emisor` para que un registro NUNCA encadene con el de otro NIF — una cadena cruzada es corrupción
// legal irreparable una vez enviada a la AEAT. Para un solo NIF (la invariante normal) el resultado es
// idéntico al de antes (todos los registros son de ese NIF), así que las cadenas existentes no cambian.
export function lastHuella(db, idEmisor) {
  const r = db.prepare('SELECT huella FROM verifactu_registros WHERE id_emisor = ? ORDER BY id DESC LIMIT 1').get(idEmisor);
  return r?.huella || '';
}

// GUARDA DEFENSIVA (A1): una BD de tenant = un solo obligado tributario. Si al emitir un registro para
// `idEmisor` la base YA contiene registros de OTRO NIF, es un estado imposible (el candado de Ajustes lo
// impide) → se DETIENE la emisión en vez de producir una cadena cruzada en silencio. Cinturón por si el
// candado se saltara por cualquier vía: mejor parar que firmar una cadena corrupta.
function assertUnSoloEmisor(db, idEmisor) {
  const otro = db.prepare('SELECT id_emisor FROM verifactu_registros WHERE id_emisor <> ? LIMIT 1').get(idEmisor);
  if (otro) {
    const e = new Error('Verifactu: esta base ya tiene registros de otro NIF emisor (' + otro.id_emisor + '); no se puede emitir con ' + (idEmisor || '(vacío)') + ' sin cruzar la cadena legal. Revisa el NIF de la empresa antes de emitir.');
    e.status = 409; throw e;
  }
}

const INSERT_REGISTRO = `INSERT INTO verifactu_registros
  (invoice_id, record_type, id_emisor, num_serie, fecha_expedicion, tipo_factura,
   cuota_total, importe_total, prev_huella, huella, fecha_hora_huso, primer_registro)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;

// Genera y PERSISTE el registro de ALTA de una factura ya insertada. Llamar DENTRO de la
// transacción de emisión. `inv` es la fila/objeto de factura (company_fiscal_id, invoice_number,
// issue_date, subtotal, tax_amount, record_type, rectification_type, id).
export function recordVerifactuAlta(db, inv) {
  const idEmisor = inv.company_fiscal_id || '';
  assertUnSoloEmisor(db, idEmisor);
  const numSerie = inv.invoice_number;
  const fechaExpedicion = toFechaExpedicion(inv.issue_date);
  // TipoFactura (lista L2 AEAT): F1 alta ordinaria · F2 factura SIMPLIFICADA (ticket, sin
  // destinatario) · R1..R5 rectificativa. Si quien emite pasa tipo_factura explícito (p. ej. el
  // mostrador con 'F2'), se respeta; si no, ordinaria F1 / rectificativa su R*.
  const tipoFactura = inv.tipo_factura
    ? inv.tipo_factura
    : (inv.record_type === 'rectificativa' ? (inv.rectification_type || 'R1') : 'F1');
  const cuotaTotal = fmtImporte(inv.tax_amount);                                   // CuotaTotal = IVA repercutido
  const importeTotal = fmtImporte((Number(inv.subtotal) || 0) + (Number(inv.tax_amount) || 0)); // base + IVA (sin IRPF; cuadra con el desglose)
  const prevHuella = lastHuella(db, idEmisor);
  const primer = prevHuella === '' ? 'S' : 'N';
  const fechaHoraHuso = genTimestampMadrid();
  const huella = altaHuella({ idEmisor, numSerie, fechaExpedicion, tipoFactura, cuotaTotal, importeTotal, prevHuella, fechaHoraHuso });
  const res = db.prepare(INSERT_REGISTRO).run(
    inv.id, 'alta', idEmisor, numSerie, fechaExpedicion, tipoFactura,
    cuotaTotal, importeTotal, prevHuella, huella, fechaHoraHuso, primer
  );
  return { id: res.lastInsertRowid, record_type: 'alta', huella, prev_huella: prevHuella, fecha_hora_huso: fechaHoraHuso, primer_registro: primer };
}

// Genera y PERSISTE el registro de ANULACIÓN de una factura. Llamar DENTRO de la transacción
// de anulación. `original` es la fila de la factura anulada.
export function recordVerifactuAnulacion(db, original) {
  const idEmisor = original.company_fiscal_id || '';
  assertUnSoloEmisor(db, idEmisor);
  const numSerie = original.invoice_number;
  const fechaExpedicion = toFechaExpedicion(original.issue_date);
  const prevHuella = lastHuella(db, idEmisor);
  const primer = prevHuella === '' ? 'S' : 'N';
  const fechaHoraHuso = genTimestampMadrid();
  const huella = anulacionHuella({ idEmisor, numSerie, fechaExpedicion, prevHuella, fechaHoraHuso });
  const res = db.prepare(INSERT_REGISTRO).run(
    original.id, 'anulacion', idEmisor, numSerie, fechaExpedicion, null,
    null, null, prevHuella, huella, fechaHoraHuso, primer
  );
  return { id: res.lastInsertRowid, record_type: 'anulacion', huella, prev_huella: prevHuella, fecha_hora_huso: fechaHoraHuso, primer_registro: primer };
}
