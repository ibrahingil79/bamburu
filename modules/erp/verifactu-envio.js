// ── VERI*FACTU · Tarea 2 (Fase A) — REMISIÓN de los registros a la AEAT (SOAP + mTLS) ──
//
// Transmite al ENTORNO DE PRUEBAS (preproducción) los registros de facturación que la Tarea 1 ya
// dejó CONGELADOS en verifactu_registros (huella, FechaHoraHusoGenRegistro e importes). Aquí NO se
// re-deriva ni se toca la huella/QR/encadenado (Tarea 1 es inmutable): solo se construye el XML de
// remisión con esos valores exactos, se envía y se guarda la respuesta de la AEAT.
//
// Endpoints/namespaces verificados contra el WSDL oficial en vivo (2026-07-05). Certificado
// cualificado (FNMT) cargado desde el entorno, fuera del repo; si falta, el motor funciona contra
// el SIMULADOR y el envío real avisa sin romper. Aditivo, idempotente.

import fs from 'fs';
import { safeError } from '../../core/errors.js';
import http from 'http';
import https from 'https';
import { join } from 'path';
import { fmtImporte } from './verifactu.js';   // Tarea 1 (inmutable): formato oficial de importes
import { fiscalGroupKey, verifactuClassification, validateFiscalClassification } from '../../core/fiscal-classification.js';

// Namespaces canónicos (targetNamespace de los XSD; apuntan a www2 aunque el XSD se sirva de prewww2).
export const NS_LR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
export const NS_SF = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';
export const NS_RESP = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const xmlEsc = s => String(s == null ? '' : s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const el = (tag, val) => `<${tag}>${xmlEsc(val)}</${tag}>`;

// ── Endpoints oficiales (WSDL SistemaFacturacion.wsdl, operación RegFactuSistemaFacturacion) ──
export const AEAT_ENDPOINTS = {
  pruebas:     'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  produccion:  'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
};

// ── Estados del envío (persistidos en verifactu_envios.estado) ──
export const ESTADO = {
  PENDIENTE:  'pendiente',            // aún no enviado
  BLOQUEADO:  'bloqueado_datos',      // falta un dato obligatorio → no se envía (AVISO, nunca inventar)
  CORRECTO:   'correcto',             // EstadoRegistro = Correcto
  CON_ERRORES:'aceptado_con_errores', // AceptadoConErrores (registrado; subsanar con alta Subsanacion=S)
  INCORRECTO: 'incorrecto',           // rechazado por la AEAT
  ERROR_COM:  'error_comunicacion',   // SoapFault / red / sin certificado / HTTP != 200
};

// ── SistemaInformatico (parametrizable; NO quemado) ───────────────────────────
// Los identificadores técnicos del SIF los fija Bamburu (productor del software); el NIF y el
// NombreRazón del productor se rellenan por entorno junto con el certificado (los aporta el dueño).
// Multi-tenant SaaS → MultiOT=S, IndicadorMultiplesOT=S (doc AEAT §SistemaInformatico).
export function sistemaInformatico() {
  return {
    NombreRazon: process.env.VERIFACTU_PRODUCTOR_NOMBRE || '',
    NIF: process.env.VERIFACTU_PRODUCTOR_NIF || '',
    IdSistemaInformatico: process.env.VERIFACTU_ID_SIF || 'BM',   // 2 posiciones, lo asigna el productor
    NombreSistemaInformatico: process.env.VERIFACTU_NOMBRE_SIF || 'Bamburu',
    Version: process.env.VERIFACTU_VERSION_SIF || '1.0',
    NumeroInstalacion: process.env.VERIFACTU_NUM_INSTALACION || '1',   // única por instalación/instancia
    TipoUsoPosibleSoloVerifactu: 'S',
    TipoUsoPosibleMultiOT: 'S',
    IndicadorMultiplesOT: 'S',
  };
}
// Campos del SistemaInformatico que aún no están rellenos (para AVISO, no para inventar).
export function sistemaInformaticoFaltantes() {
  const s = sistemaInformatico();
  const faltan = [];
  if (!s.NombreRazon) faltan.push('NombreRazon del productor (VERIFACTU_PRODUCTOR_NOMBRE)');
  if (!s.NIF) faltan.push('NIF del productor (VERIFACTU_PRODUCTOR_NIF)');
  return faltan;
}

// ── Certificado (mTLS) desde el entorno; nunca quemado en código ──────────────
// FNMT exportado como .p12/.pfx → Node tls acepta { pfx, passphrase }. Ausente → null (simulador).
export function loadCertificate() {
  const path = process.env.VERIFACTU_CERT_PATH;
  if (!path) return null;
  let pfx;
  try { pfx = fs.readFileSync(path); } catch { return null; }
  return { pfx, passphrase: process.env.VERIFACTU_CERT_PASS || '' };
}
// Estado del certificado, para avisar con claridad sin romper.
export function certStatus() {
  const path = process.env.VERIFACTU_CERT_PATH;
  if (!path) return { present: false, reason: 'Falta VERIFACTU_CERT_PATH en el entorno: certificado FNMT no configurado (envío real no disponible; el simulador sí).' };
  try { fs.accessSync(path, fs.constants.R_OK); } catch { return { present: false, reason: `No se puede leer el certificado en ${path}.` }; }
  return { present: true };
}

// ── Certificado POR NEGOCIO (multi-tenant), con caída al global ───────────────
// Quien remite es el obligado, y es SU certificado el que autentica el transporte mTLS: la cola
// tiene que resolverlo por negocio o cruzaría identidades entre tenants. Convención:
//   VERIFACTU_CERT_DIR/<slug>.p12  (o .pfx)   ·  contraseña en VERIFACTU_CERT_PASS_<SLUG>
// Si no hay directorio, o ese negocio no tiene fichero, se cae al VERIFACTU_CERT_PATH global (el
// camino que ya existía y que usa el script de preproducción). El slug se valida contra el mismo
// alfabeto que control.db ([a-z0-9-]) antes de tocar el sistema de ficheros: nunca se concatena
// una cadena ajena en una ruta.
//
// La CONTRASEÑA sigue sin escribirse en ningún fichero del repo. Vive en el entorno del proceso, y
// si no está, la cola de ese negocio NO se activa (motivoColaInactiva lo dice): no se inventa, no
// se pide por teclado (no hay teclado) y no se lanzan intentos contra un muro.
const SLUG_OK = /^[a-z0-9-]+$/;
const slugEnv = slug => String(slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');

export function certPathForTenant(slug) {
  const dir = process.env.VERIFACTU_CERT_DIR;
  if (dir && slug && SLUG_OK.test(slug)) {
    for (const ext of ['p12', 'pfx']) {
      const p = join(dir, `${slug}.${ext}`);
      try { fs.accessSync(p, fs.constants.R_OK); return p; } catch { /* prueba la siguiente extensión */ }
    }
  }
  return process.env.VERIFACTU_CERT_PATH || null;
}

// Contraseña del .p12 de un negocio. `undefined` = no configurada (≠ '' , que es contraseña vacía
// legítima). La cola distingue los dos casos: sin definir → no arranca; vacía → lo intenta.
export function certPassForTenant(slug) {
  const propia = process.env['VERIFACTU_CERT_PASS_' + slugEnv(slug)];
  return propia !== undefined ? propia : process.env.VERIFACTU_CERT_PASS;
}

// Estado del certificado de UN negocio (para avisar con claridad, sin romper).
export function certStatusForTenant(slug) {
  const path = certPathForTenant(slug);
  if (!path) return { present: false, reason: 'Falta el certificado FNMT: ni VERIFACTU_CERT_DIR/' + (slug || '<negocio>') + '.p12 ni VERIFACTU_CERT_PATH están configurados (envío real no disponible; el simulador sí).' };
  try { fs.accessSync(path, fs.constants.R_OK); } catch { return { present: false, reason: `No se puede leer el certificado en ${path}.` }; }
  return { present: true, path };
}

export function loadCertificateForTenant(slug) {
  const cs = certStatusForTenant(slug);
  if (!cs.present) return null;
  let pfx;
  try { pfx = fs.readFileSync(cs.path); } catch { return null; }
  return { pfx, passphrase: certPassForTenant(slug) || '' };
}

// ── Persistencia del estado de envío (idempotente por registro_id) ────────────
export function getEnvio(db, registroId) {
  return db.prepare('SELECT * FROM verifactu_envios WHERE registro_id=?').get(registroId) || null;
}

// Upsert idempotente: crea o actualiza la fila del registro. `bumpIntentos: true` cuenta un intento
// de comunicación real (no lo hacen los estados de bloqueo por datos). enviado_at solo se fija si se
// pasa (no se borra en updates posteriores).
export function upsertEnvio(db, registroId, f = {}) {
  const row = {
    registro_id: registroId,
    estado: f.estado ?? ESTADO.PENDIENTE,
    entorno: f.entorno ?? null,
    endpoint: f.endpoint ?? null,
    estado_envio: f.estado_envio ?? null,
    estado_registro: f.estado_registro ?? null,
    codigo_error: f.codigo_error ?? null,
    descripcion_error: f.descripcion_error ?? null,
    csv: f.csv ?? null,
    tiempo_espera_envio: f.tiempo_espera_envio ?? null,
    http_status: f.http_status ?? null,
    request_xml: f.request_xml ?? null,
    response_xml: f.response_xml ?? null,
    aviso: f.aviso ?? null,
    enviado_at: f.enviado_at ?? null,
    bump: f.bumpIntentos ? 1 : 0,
  };
  db.prepare(`
    INSERT INTO verifactu_envios (registro_id, estado, entorno, endpoint, estado_envio, estado_registro,
      codigo_error, descripcion_error, csv, tiempo_espera_envio, http_status, request_xml, response_xml,
      aviso, intentos, enviado_at, updated_at)
    VALUES (@registro_id, @estado, @entorno, @endpoint, @estado_envio, @estado_registro, @codigo_error,
      @descripcion_error, @csv, @tiempo_espera_envio, @http_status, @request_xml, @response_xml, @aviso,
      @bump, @enviado_at, CURRENT_TIMESTAMP)
    ON CONFLICT(registro_id) DO UPDATE SET
      estado=excluded.estado, entorno=excluded.entorno, endpoint=excluded.endpoint,
      estado_envio=excluded.estado_envio, estado_registro=excluded.estado_registro,
      codigo_error=excluded.codigo_error, descripcion_error=excluded.descripcion_error,
      csv=excluded.csv, tiempo_espera_envio=excluded.tiempo_espera_envio, http_status=excluded.http_status,
      request_xml=excluded.request_xml, response_xml=excluded.response_xml, aviso=excluded.aviso,
      intentos=verifactu_envios.intentos + @bump,
      enviado_at=COALESCE(excluded.enviado_at, verifactu_envios.enviado_at),
      updated_at=CURRENT_TIMESTAMP
  `).run(row);
  return getEnvio(db, registroId);
}

// ¿Ya está aceptado por la AEAT? (idempotencia: no reenviar lo 'correcto').
export function yaAceptado(envio) {
  return !!envio && (envio.estado === ESTADO.CORRECTO || envio.estado === ESTADO.CON_ERRORES);
}

// ════════════════════════════════════════════════════════════════════════════
// PASO 2 — Constructor del XML de remisión (RegistroAlta + Cabecera + envelope SOAP).
// Los importes, la huella y la FechaHoraHusoGenRegistro se toman EXACTOS del registro CONGELADO
// (Tarea 1). El desglose por tipo de IVA y la CalificacionOperacion se DERIVAN de invoice_items
// (mismo patrón que contabilidad.js). Lo que no se pueda determinar con certeza → AVISO, nunca
// inventado (el envío se marca 'bloqueado_datos' y no sale).
// ════════════════════════════════════════════════════════════════════════════

// Desglose por tipo de IVA reconstruido desde las líneas; con fallback de cabecera para facturas
// legacy sin desglose en línea (mismo criterio que contabilidad.js/postInvoice).
export function desgloseFromItems(invoice, items) {
  const groups = new Map();
  for (const it of items || []) {
    const fiscal = validateFiscalClassification(it);
    const key = fiscalGroupKey(fiscal);
    const g = groups.get(key) || { ...fiscal, rate: fiscal.tax_rate, base: 0, cuota: 0 };
    g.base = r2(g.base + (Number(it.total_price) || 0));
    g.cuota = r2(g.cuota + (Number(it.tax_amount) || 0));
    groups.set(key, g);
  }
  let arr = [...groups.values()];
  const sumCuota = r2(arr.reduce((s, g) => s + g.cuota, 0));
  if (Math.round(sumCuota * 100) === 0 && Math.round(r2(invoice.tax_amount) * 100) !== 0) {
    let rate = Number(invoice.tax_rate) || 0;
    if (!rate && r2(invoice.subtotal)) { const eff = Math.round(r2(invoice.tax_amount) / r2(invoice.subtotal) * 100); if ([0, 4, 10, 21].includes(eff)) rate = eff; }
    // Una factura histórica sin snapshot no se reclasifica: el caller la bloqueará.
    arr = [{ fiscal_treatment: 'pending', rate, base: r2(invoice.subtotal), cuota: r2(invoice.tax_amount) }];
  }
  return arr.filter(g => Math.round(g.base * 100) !== 0 || Math.round(g.cuota * 100) !== 0).sort((a, b) => b.rate - a.rate);
}

// Construye el <RegistroAlta> de UN registro congelado. Devuelve { xml, avisos, bloqueado }.
// `bloqueado=true` (con avisos) cuando falta un dato obligatorio o los importes no cuadran: NO se
// envía y se marca 'bloqueado_datos'. Defaults documentados: CalificacionOperacion S1, ClaveRegimen 01.
export function buildRegistroAlta({ registro, invoice, items, prevRegistro, companyName, sistemaInfo, claveRegimen = '01' }) {
  const avisos = [];
  const tipo = registro.tipo_factura || 'F1';
  const esSimplificada = tipo === 'F2';

  // Destinatario: obligatorio de facto salvo F2 (simplificada). NIF+nombre del cliente.
  const nifDest = invoice.client_fiscal_id || '';
  const nombreDest = invoice.client_name || '';
  if (!esSimplificada && !nifDest) avisos.push(`Falta el NIF del destinatario (obligatorio en factura ${tipo}); corrige la factura antes de remitir.`);

  // Desglose por tipo de IVA.
  let desglose = [];
  try { desglose = desgloseFromItems(invoice, items); }
  catch (e) { avisos.push(`Clasificación fiscal incompleta: ${e.message}`); }
  if (!desglose.length) avisos.push('No hay desglose de IVA reconstruible (ni líneas ni IVA en cabecera).');
  const sumBase = r2(desglose.reduce((s, g) => s + g.base, 0));
  const sumCuota = r2(desglose.reduce((s, g) => s + g.cuota, 0));
  if (Math.round(sumCuota * 100) !== Math.round(r2(registro.cuota_total) * 100)) avisos.push(`El IVA del desglose (${sumCuota}) no cuadra con la CuotaTotal congelada (${registro.cuota_total}).`);
  if (Math.round(r2(sumBase + sumCuota) * 100) !== Math.round(r2(registro.importe_total) * 100)) avisos.push(`Base+IVA del desglose (${r2(sumBase + sumCuota)}) no cuadra con el ImporteTotal congelado (${registro.importe_total}).`);

  // SistemaInformatico (productor): NIF/NombreRazon se rellenan con el certificado.
  if (!sistemaInfo.NombreRazon || !sistemaInfo.NIF) avisos.push('SistemaInformatico incompleto: falta NIF/NombreRazón del productor del software (se configura junto al certificado).');

  // Encadenamiento: primer registro o huella del anterior (de la cadena única, congelada).
  let encad;
  if (registro.primer_registro === 'S') {
    encad = el('sf:PrimerRegistro', 'S');
  } else if (prevRegistro) {
    encad = `<sf:RegistroAnterior>${el('sf:IDEmisorFactura', prevRegistro.id_emisor)}${el('sf:NumSerieFactura', prevRegistro.num_serie)}${el('sf:FechaExpedicionFactura', prevRegistro.fecha_expedicion)}${el('sf:Huella', registro.prev_huella)}</sf:RegistroAnterior>`;
  } else {
    avisos.push('No se encuentra el registro anterior de la cadena (Encadenamiento).');
    encad = '';
  }

  const descripcion = (items && items[0] && items[0].description) || invoice.document_name || 'Operación';
  const detalles = desglose.map(g => {
    const c = verifactuClassification(g);
    const clasificacion = c.operacionExenta ? el('sf:OperacionExenta', c.operacionExenta) : el('sf:CalificacionOperacion', c.calificacionOperacion);
    const importes = g.fiscal_treatment === 'taxable' && !g.fiscal_reverse_charge
      ? el('sf:TipoImpositivo', fmtImporte(g.rate)) + el('sf:BaseImponibleOimporteNoSujeto', fmtImporte(g.base)) + el('sf:CuotaRepercutida', fmtImporte(g.cuota))
      : el('sf:BaseImponibleOimporteNoSujeto', fmtImporte(g.base));
    return `<sf:DetalleDesglose>${el('sf:Impuesto', '01')}${el('sf:ClaveRegimen', claveRegimen)}${clasificacion}${importes}</sf:DetalleDesglose>`;
  }).join('');
  const destinatariosXml = (!esSimplificada && nifDest)
    ? `<sf:Destinatarios><sf:IDDestinatario>${el('sf:NombreRazon', nombreDest)}${el('sf:NIF', nifDest)}</sf:IDDestinatario></sf:Destinatarios>` : '';

  // Orden EXACTO del XSD (RegistroFacturacionAltaType). Opcionales no usados se omiten.
  const xml = '<sf:RegistroAlta>' +
    el('sf:IDVersion', '1.0') +
    `<sf:IDFactura>${el('sf:IDEmisorFactura', registro.id_emisor)}${el('sf:NumSerieFactura', registro.num_serie)}${el('sf:FechaExpedicionFactura', registro.fecha_expedicion)}</sf:IDFactura>` +
    el('sf:NombreRazonEmisor', companyName) +
    el('sf:TipoFactura', tipo) +
    el('sf:DescripcionOperacion', descripcion) +
    destinatariosXml +
    `<sf:Desglose>${detalles}</sf:Desglose>` +
    el('sf:CuotaTotal', registro.cuota_total) +
    el('sf:ImporteTotal', registro.importe_total) +
    `<sf:Encadenamiento>${encad}</sf:Encadenamiento>` +
    '<sf:SistemaInformatico>' +
      el('sf:NombreRazon', sistemaInfo.NombreRazon) +
      el('sf:NIF', sistemaInfo.NIF) +
      el('sf:NombreSistemaInformatico', sistemaInfo.NombreSistemaInformatico) +
      el('sf:IdSistemaInformatico', sistemaInfo.IdSistemaInformatico) +
      el('sf:Version', sistemaInfo.Version) +
      el('sf:NumeroInstalacion', sistemaInfo.NumeroInstalacion) +
      el('sf:TipoUsoPosibleSoloVerifactu', sistemaInfo.TipoUsoPosibleSoloVerifactu) +
      el('sf:TipoUsoPosibleMultiOT', sistemaInfo.TipoUsoPosibleMultiOT) +
      el('sf:IndicadorMultiplesOT', sistemaInfo.IndicadorMultiplesOT) +
    '</sf:SistemaInformatico>' +
    el('sf:FechaHoraHusoGenRegistro', registro.fecha_hora_huso) +
    el('sf:TipoHuella', '01') +
    el('sf:Huella', registro.huella) +
  '</sf:RegistroAlta>';

  return { xml, avisos, bloqueado: avisos.length > 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// PASO 2-bis — Constructor del XML de ANULACIÓN (RegistroAnulacion).
//
// No sale de buildRegistroAlta porque `RegistroFacturacionAnulacionType` es OTRA secuencia: no lleva
// Desglose, ni CuotaTotal/ImporteTotal, ni TipoFactura, ni Destinatarios, ni NombreRazonEmisor, y su
// IDFactura usa nombres de elemento distintos (IDEmisorFacturaAnulada / NumSerieFacturaAnulada /
// FechaExpedicionFacturaAnulada). Igual que el alta, todo sale del registro CONGELADO por la Tarea 1:
// aquí no se re-deriva ni se toca la huella, ni el encadenado, ni la fecha.
// ════════════════════════════════════════════════════════════════════════════

// ── EL FORMATO DE FECHA DE LA AEAT: SE GUARDA, NO SE CONVIERTE ────────────────────────────────
// Comprobado contra el esquema oficial descargado en vivo el 23-ago-2026 (SuministroInformacion.xsd):
//
//   <simpleType name="fecha">
//     <restriction base="string">
//       <length value="10"/>
//       <pattern value="\d{2,2}-\d{2,2}-\d{4,4}"/>
//     </restriction>
//   </simpleType>
//
// Ese tipo `sf:fecha` lo usan POR IGUAL `FechaExpedicionFactura` (alta) y `FechaExpedicionFacturaAnulada`
// (anulación): UN solo formato, DD-MM-YYYY, y el mismo en los dos. Circula el aviso de que "el alta
// admite dos formatos y la anulación solo el internacional año-mes-día": es FALSO en sus dos mitades,
// y actuar sobre él rompe justo lo que dice arreglar — '2026-08-23' pasa el <length 10> pero FALLA el
// <pattern>, y la AEAT devuelve el 4102 ("El XML no cumple el esquema") en cada anulación.
// Por eso aquí NO se normaliza a ISO: se GUARDA el formato y, si algún día no cuadra, se para el envío
// (bloqueado_datos + aviso) en vez de mandar un XML que ya sabemos que se va a rechazar.
// El único campo en formato internacional es `FechaHoraHusoGenRegistro` (type="dateTime"), y lo es en
// el alta Y en la anulación por igual; ya lo genera genTimestampMadrid() (Tarea 1, inmutable).
export const RE_FECHA_AEAT = /^\d{2}-\d{2}-\d{4}$/;
export const esFechaAeat = v => RE_FECHA_AEAT.test(String(v == null ? '' : v));

// Construye el <RegistroAnulacion> de UN registro congelado. Devuelve { xml, avisos, bloqueado }.
// `bloqueado=true` (con avisos) cuando falta uno de los datos obligatorios: NO se envía y se marca
// 'bloqueado_datos'. Mismo contrato que buildRegistroAlta.
//
// SinRegistroPrevio NO se usa (decisión del dueño, 23-ago-2026): en Bamburu el alta siempre acaba
// remitiéndose, así que la anulación espera detrás de su alta y las dos se comunican en orden. El
// campo existe en el XSD y se deja deliberadamente fuera; no está "preparado" ni comentado a medias.
export function buildRegistroAnulacion({ registro, prevRegistro, sistemaInfo }) {
  const avisos = [];

  // ── LOS CUATRO DATOS IDENTIFICATIVOS, SIN EXCEPCIÓN ──
  // Sin cualquiera de ellos la AEAT rechaza el registro, así que ninguno se inventa ni se deriva:
  // o está en el registro congelado, o el envío se para con un aviso que dice cuál falta.
  //   1. NIF del emisor            → IDEmisorFacturaAnulada
  //   2. serie y número anulados   → NumSerieFacturaAnulada
  //   3. su fecha de emisión       → FechaExpedicionFacturaAnulada (DD-MM-YYYY)
  //   4. la fecha en que se anula  → FechaHoraHusoGenRegistro (ISO-8601 con huso, congelada al anular)
  if (!registro.id_emisor) avisos.push('Falta el NIF del emisor de la factura anulada (IDEmisorFacturaAnulada).');
  if (!registro.num_serie) avisos.push('Falta la serie y número de la factura anulada (NumSerieFacturaAnulada).');
  if (!registro.fecha_expedicion) avisos.push('Falta la fecha de emisión de la factura anulada (FechaExpedicionFacturaAnulada).');
  else if (!esFechaAeat(registro.fecha_expedicion)) avisos.push('La fecha de emisión de la factura anulada ("' + registro.fecha_expedicion + '") no cumple el formato DD-MM-YYYY que exige el tipo sf:fecha del esquema oficial; no se remite (la AEAT la rechazaría con el error 4102).');
  if (!registro.fecha_hora_huso) avisos.push('Falta la fecha y hora de la anulación (FechaHoraHusoGenRegistro).');
  if (!registro.huella) avisos.push('Falta la huella del registro de anulación.');

  // SistemaInformatico (productor): NIF/NombreRazon se rellenan con el certificado.
  if (!sistemaInfo.NombreRazon || !sistemaInfo.NIF) avisos.push('SistemaInformatico incompleto: falta NIF/NombreRazón del productor del software (se configura junto al certificado).');

  // Encadenamiento: primer registro o huella del anterior (de la cadena única del MISMO NIF, congelada).
  let encad;
  if (registro.primer_registro === 'S') {
    encad = el('sf:PrimerRegistro', 'S');
  } else if (prevRegistro) {
    // La fecha del registro anterior también es sf:fecha: misma guarda, mismo motivo.
    if (!esFechaAeat(prevRegistro.fecha_expedicion)) avisos.push('La fecha del registro anterior del encadenamiento ("' + prevRegistro.fecha_expedicion + '") no cumple el formato DD-MM-YYYY que exige sf:fecha.');
    encad = '<sf:RegistroAnterior>' + el('sf:IDEmisorFactura', prevRegistro.id_emisor) + el('sf:NumSerieFactura', prevRegistro.num_serie) + el('sf:FechaExpedicionFactura', prevRegistro.fecha_expedicion) + el('sf:Huella', registro.prev_huella) + '</sf:RegistroAnterior>';
  } else {
    avisos.push('No se encuentra el registro anterior de la cadena (Encadenamiento).');
    encad = '';
  }

  // Orden EXACTO del XSD (RegistroFacturacionAnulacionType). Los opcionales —RefExterna,
  // SinRegistroPrevio, RechazoPrevio, GeneradoPor, Generador— se omiten a propósito.
  const xml = '<sf:RegistroAnulacion>' +
    el('sf:IDVersion', '1.0') +
    '<sf:IDFactura>' +
      el('sf:IDEmisorFacturaAnulada', registro.id_emisor) +
      el('sf:NumSerieFacturaAnulada', registro.num_serie) +
      el('sf:FechaExpedicionFacturaAnulada', registro.fecha_expedicion) +
    '</sf:IDFactura>' +
    '<sf:Encadenamiento>' + encad + '</sf:Encadenamiento>' +
    '<sf:SistemaInformatico>' +
      el('sf:NombreRazon', sistemaInfo.NombreRazon) +
      el('sf:NIF', sistemaInfo.NIF) +
      el('sf:NombreSistemaInformatico', sistemaInfo.NombreSistemaInformatico) +
      el('sf:IdSistemaInformatico', sistemaInfo.IdSistemaInformatico) +
      el('sf:Version', sistemaInfo.Version) +
      el('sf:NumeroInstalacion', sistemaInfo.NumeroInstalacion) +
      el('sf:TipoUsoPosibleSoloVerifactu', sistemaInfo.TipoUsoPosibleSoloVerifactu) +
      el('sf:TipoUsoPosibleMultiOT', sistemaInfo.TipoUsoPosibleMultiOT) +
      el('sf:IndicadorMultiplesOT', sistemaInfo.IndicadorMultiplesOT) +
    '</sf:SistemaInformatico>' +
    el('sf:FechaHoraHusoGenRegistro', registro.fecha_hora_huso) +
    el('sf:TipoHuella', '01') +
    el('sf:Huella', registro.huella) +
  '</sf:RegistroAnulacion>';

  return { xml, avisos, bloqueado: avisos.length > 0 };
}

// Envuelve N <RegistroAlta> en la Cabecera (ObligadoEmision) + envelope SOAP 1.1.
//
// OJO con los namespaces (verificado contra el XSD oficial, no de memoria): en SuministroLR.xsd,
// `Cabecera` y `RegistroFactura` se declaran LOCALES dentro de RegFactuSistemaFacturacion, y ese
// esquema tiene elementFormDefault="qualified" → ambos elementos viven en el namespace sfLR,
// aunque el TIPO de Cabecera (sf:CabeceraType) venga del otro esquema. `Cabecera` ni siquiera
// existe en SuministroInformacion.xsd. Sus HIJOS (ObligadoEmision, NombreRazon, NIF) sí son de
// sf, porque los declara CabeceraType allí (también qualified).
//
// Mandarla como <sf:Cabecera> provoca un SoapFault de la AEAT:
//   Codigo[4102].El XML no cumple el esquema. Falta informar campo obligatorio.: Cabecera
export function buildEnvelope({ obligadoNombre, obligadoNif, registrosXml }) {
  const cabecera = `<sfLR:Cabecera><sf:ObligadoEmision>${el('sf:NombreRazon', obligadoNombre)}${el('sf:NIF', obligadoNif)}</sf:ObligadoEmision></sfLR:Cabecera>`;
  const registros = registrosXml.map(x => `<sfLR:RegistroFactura>${x}</sfLR:RegistroFactura>`).join('');
  const cuerpo = `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}">${cabecera}${registros}</sfLR:RegFactuSistemaFacturacion>`;
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;
}

// ════════════════════════════════════════════════════════════════════════════
// PASO 3 — Cliente SOAP (mTLS) + parser de la respuesta de la AEAT.
// ════════════════════════════════════════════════════════════════════════════

// POST del envelope SOAP. mTLS: el certificado (pfx) va en la conexión TLS (el XML NO se firma en
// modalidad Veri*factu). http vs https según el esquema del endpoint (el simulador local usa http).
// Devuelve { httpStatus, body }. Errores de red/timeout se propagan como rechazo de la promesa.
export function sendSoap(xml, { endpoint, cert = null, timeoutMs = 30000, rejectUnauthorized = true }) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const isHttps = u.protocol === 'https:';
    const opts = {
      method: 'POST', hostname: u.hostname, port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""', 'Content-Length': Buffer.byteLength(xml) },
      timeout: timeoutMs,
    };
    if (isHttps) {
      opts.rejectUnauthorized = rejectUnauthorized;
      if (cert) { opts.pfx = cert.pfx; opts.passphrase = cert.passphrase; }   // mTLS: certificado de cliente
    }
    const req = (isHttps ? https : http).request(opts, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end', () => resolve({ httpStatus: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado conectando con la AEAT')));
    req.write(xml); req.end();
  });
}

// Extrae el texto de un elemento por su nombre LOCAL, ignorando el prefijo de namespace (la AEAT usa
// sus propios prefijos). Devuelve null si no aparece.
function pick(xml, tag) {
  const m = xml.match(new RegExp('<(?:[\\w.-]+:)?' + tag + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?' + tag + '>'));
  return m ? m[1].trim() : null;
}

// Parsea la RespuestaSuministro (o un SoapFault). Estructura verificada contra RespuestaSuministro.xsd:
// CSV, TiempoEsperaEnvio, EstadoEnvio (Correcto/ParcialmenteCorrecto/Incorrecto) y N RespuestaLinea
// (IDFactura, EstadoRegistro Correcto/AceptadoConErrores/Incorrecto, CodigoErrorRegistro, Descripcion).
export function parseRespuesta(body) {
  const b = String(body || '');
  if (/<(?:[\w.-]+:)?Fault\b/.test(b)) {   // SOAP 1.1 (faultstring) o 1.2 (Reason/Text)
    const faultString = pick(b, 'faultstring') || pick(b, 'Text') || pick(b, 'faultcode') || 'SOAP Fault';
    return { soapFault: true, faultString, estadoEnvio: null, tiempoEspera: null, csv: null, lineas: [] };
  }
  const lineas = [];
  const re = /<(?:[\w.-]+:)?RespuestaLinea>([\s\S]*?)<\/(?:[\w.-]+:)?RespuestaLinea>/g;
  let m;
  while ((m = re.exec(b))) {
    const seg = m[1];
    lineas.push({
      numSerie: pick(seg, 'NumSerieFactura'),
      // `Operacion/TipoOperacion` (Alta|Anulacion, SuministroInformacion.xsd) es lo ÚNICO que
      // distingue la respuesta de un alta de la de su anulación: las dos llevan el MISMO
      // NumSerieFactura. Sin esto, emparejar por serie las cruza (ver enviarLote).
      tipoOperacion: pick(seg, 'TipoOperacion'),
      estadoRegistro: pick(seg, 'EstadoRegistro'),
      codigoError: pick(seg, 'CodigoErrorRegistro'),
      descripcionError: pick(seg, 'DescripcionErrorRegistro'),
    });
  }
  const tiempo = pick(b, 'TiempoEsperaEnvio');
  return {
    soapFault: false,
    csv: pick(b, 'CSV'),
    estadoEnvio: pick(b, 'EstadoEnvio'),
    tiempoEspera: tiempo != null ? Number(tiempo) : null,
    lineas,
  };
}

// Mapea el EstadoRegistro devuelto (por línea) al estado interno del envío.
export function estadoRegistroToEstado(estadoRegistro) {
  switch (estadoRegistro) {
    case 'Correcto': return ESTADO.CORRECTO;
    case 'AceptadoConErrores': return ESTADO.CON_ERRORES;
    case 'Incorrecto': return ESTADO.INCORRECTO;
    default: return ESTADO.ERROR_COM;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PASO 4 — Orquestación IDEMPOTENTE del envío de un LOTE de registros (alta y anulación).
//
// Va por lotes porque la ley obliga: el control de flujo (art. 16.2 Orden HAC/1177/2024) impone
// esperar el `TiempoEsperaEnvio` devuelto (t inicial = 60 s) entre envíos, mientras que la huella
// caduca a los 240 s. Un sobre por factura da un techo de 1 registro/60 s: en una ráfaga de
// mostrador la sexta factura llegaría fuera de ventana. Agrupando 1..1000 RegistroFactura en UNA
// Cabecera, ambos relojes se cumplen a la vez. `buildEnvelope` ya lo admitía; era esto lo que no.
//
// Un envío = UN obligado (una sola Cabecera): el lote se rechaza si mezcla emisores.
// No reenvía lo ya aceptado (idempotencia). Falta de datos → 'bloqueado_datos' con AVISO (no sale).
// Falta de certificado contra la AEAT → 'error_comunicacion' con aviso claro (no rompe). Contra el
// simulador (endpoint http / cert null) va sin certificado. Persiste TODO: estado, CSV, error, XML.
//
// Devuelve un array PARALELO a registroIds (misma posición, misma factura); un hueco es null.
// ════════════════════════════════════════════════════════════════════════════
export async function enviarLote(db, registroIds, opts = {}) {
  const ids = [...new Set((registroIds || []).map(Number))];
  const resultados = new Map();
  const lote = [];                     // { registro, xml } — lo que de verdad sale por el cable
  const sistemaInfo = opts.sistemaInfo || sistemaInformatico();
  let companyName = null;

  for (const registroId of ids) {
    const registro = db.prepare('SELECT * FROM verifactu_registros WHERE id=?').get(registroId);
    if (!registro) throw new Error(`Registro de facturación ${registroId} no existe`);

    // Idempotencia: no reenviar lo ya aceptado por la AEAT.
    const existing = getEnvio(db, registroId);
    if (yaAceptado(existing) && !opts.forzar) { resultados.set(registroId, existing); continue; }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(registro.invoice_id) || {};
    // A1 (Eje C): el registro previo del ENCADENAMIENTO se busca dentro de la cadena DEL MISMO NIF emisor
    // (`id_emisor`), nunca el último global — o el XML enviado a la AEAT cruzaría dos cadenas legales.
    const prevRegistro = registro.primer_registro === 'S' ? null
      : db.prepare('SELECT * FROM verifactu_registros WHERE id < ? AND id_emisor = ? ORDER BY id DESC LIMIT 1').get(registroId, registro.id_emisor);
    if (companyName === null) companyName = db.prepare('SELECT company_name FROM company_config WHERE id=1').get()?.company_name || invoice.company_name || '';

    // Alta y anulación son DOS tipos distintos del XSD (RegistroFacturacionAltaType /
    // RegistroFacturacionAnulacionType): cada uno con su constructor. El resto del camino —sobre,
    // mTLS, respuesta, persistencia, reintentos— es el mismo para los dos.
    const built = registro.record_type === 'anulacion'
      ? buildRegistroAnulacion({ registro, prevRegistro, sistemaInfo })
      : buildRegistroAlta({ registro, invoice, items: db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(registro.invoice_id), prevRegistro, companyName, sistemaInfo });
    if (built.bloqueado) {
      resultados.set(registroId, upsertEnvio(db, registroId, { estado: ESTADO.BLOQUEADO, aviso: built.avisos.join(' | ') }));
      continue;
    }
    lote.push({ registro, xml: built.xml });
  }

  const salida = () => ids.map(id => resultados.get(id) ?? null);
  if (!lote.length) return salida();

  // Una Cabecera lleva UN ObligadoEmision. Mezclar emisores produciría un XML que miente sobre
  // quién remite: se para aquí, no se manda a medias.
  const emisores = [...new Set(lote.map(x => x.registro.id_emisor))];
  if (emisores.length > 1) throw new Error('Un envío solo puede llevar registros de UN obligado (Cabecera única); llegaron: ' + emisores.join(', '));

  const entorno = opts.entorno || 'pruebas';
  const endpoint = opts.endpoint || AEAT_ENDPOINTS[entorno];
  const esAeat = /aeat\.es|agenciatributaria\.gob\.es/.test(endpoint);
  const cert = opts.cert !== undefined ? opts.cert : (esAeat ? loadCertificateForTenant(opts.slug) : null);
  if (esAeat && !cert) {
    const aviso = 'No se puede enviar a la AEAT: ' + certStatusForTenant(opts.slug).reason;
    for (const { registro } of lote) resultados.set(registro.id, upsertEnvio(db, registro.id, { estado: ESTADO.ERROR_COM, entorno, endpoint, aviso }));
    return salida();
  }

  const envelope = buildEnvelope({ obligadoNombre: companyName, obligadoNif: emisores[0], registrosXml: lote.map(x => x.xml) });
  const ahora = opts.now || new Date().toISOString();

  // Auditoría por registro, SIN coste cuadrático. `verifactu_envios` tiene una fila por registro, así
  // que guardar el sobre entero en cada una multiplica su tamaño por N (50 tickets de una ráfaga →
  // ~3 MB por vaciado, creciendo sin techo en la BD del negocio). Cuando el sobre es de UN registro,
  // se guarda tal cual (comportamiento de siempre, el del botón manual). Cuando lleva varios, cada
  // fila guarda LO SUYO: su <RegistroAlta> y su <RespuestaLinea>. No se pierde nada — el obligado de
  // la Cabecera es `id_emisor`, y el CSV y el EstadoEnvio del sobre ya viven en sus propias columnas.
  const solo = lote.length === 1;
  const peticionDe = x => (solo ? envelope : x.xml);

  // La <RespuestaLinea> de UNA serie. Se ancla en el TAG completo (<NumSerieFactura>X</NumSerieFactura>),
  // no en la serie suelta: 'F2026-1000' es subcadena de 'F2026-10000' y cazaría la línea del vecino.
  // El token templado impide además saltar de una RespuestaLinea a la siguiente.
  // Con `tipoOper` exige ADEMÁS su <TipoOperacion> dentro del mismo bloque: un alta y su anulación
  // comparten NumSerieFactura, así que la serie sola guardaría en las dos filas el mismo trozo.
  const escRe = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const BLOQUE = '<(?:[\\w.-]+:)?RespuestaLinea>(?:(?!</(?:[\\w.-]+:)?RespuestaLinea>)[\\s\\S])*?';
  const NO_CIERRE = '(?:(?!</(?:[\\w.-]+:)?RespuestaLinea>)[\\s\\S])*?';
  const FIN = '[\\s\\S]*?</(?:[\\w.-]+:)?RespuestaLinea>';
  const lineaXml = (body, serie, tipoOper) => {
    const b = String(body || '');
    const serieTag = '<(?:[\\w.-]+:)?NumSerieFactura>' + escRe(serie) + '</(?:[\\w.-]+:)?NumSerieFactura>';
    if (tipoOper) {
      // En RespuestaExpedidaType, Operacion va DESPUÉS de IDFactura: serie primero, tipo después.
      const conTipo = new RegExp(BLOQUE + serieTag + NO_CIERRE
        + '<(?:[\\w.-]+:)?TipoOperacion>' + escRe(tipoOper) + '</(?:[\\w.-]+:)?TipoOperacion>' + FIN);
      const m = b.match(conTipo);
      if (m) return m[0];
    }
    const m = b.match(new RegExp(BLOQUE + serieTag + FIN));
    return m ? m[0] : null;
  };

  let resp;
  try {
    resp = await sendSoap(envelope, { endpoint, cert, timeoutMs: opts.timeoutMs || 30000, rejectUnauthorized: opts.rejectUnauthorized !== false });
  } catch (e) {
    // Red caída / AEAT sin responder: NO hubo envío. `http_status` queda NULL a propósito — es lo que
    // la cola mira para saber que el control de flujo no se ha consumido y puede reintentar antes.
    for (const x of lote) resultados.set(x.registro.id, upsertEnvio(db, x.registro.id, { estado: ESTADO.ERROR_COM, entorno, endpoint, descripcion_error: safeError(e), aviso: 'Error de comunicación con la AEAT: ' + e.message, request_xml: peticionDe(x), enviado_at: ahora, bumpIntentos: true }));
    return salida();
  }

  const parsed = parseRespuesta(resp.body);
  if (parsed.soapFault) {
    // El fault es del sobre entero (no trae líneas): se guarda íntegro en cada fila. Es corto.
    for (const x of lote) resultados.set(x.registro.id, upsertEnvio(db, x.registro.id, { estado: ESTADO.ERROR_COM, entorno, endpoint, http_status: resp.httpStatus, descripcion_error: parsed.faultString, aviso: 'SoapFault de la AEAT: ' + parsed.faultString, request_xml: peticionDe(x), response_xml: resp.body, enviado_at: ahora, bumpIntentos: true }));
    return salida();
  }

  // Cada RespuestaLinea con SU registro. La AEAT no garantiza el orden, así que se empareja por
  // contenido — pero NO por NumSerieFactura a secas: una ANULACIÓN lleva el MISMO número de serie que
  // su alta, y con una clave por serie sola las dos filas se quedan con el estado de una de ellas
  // (la última gana). El desempate es `Operacion/TipoOperacion` (Alta|Anulacion), que el XSD de la
  // respuesta trae justo para esto. Si la respuesta no lo informa, solo se acepta el emparejamiento
  // cuando NO hay ambigüedad (una única línea con esa serie); si la hay, se cae al índice posicional.
  const OPERACION = { alta: 'Alta', anulacion: 'Anulacion' };
  const porSerie = new Map();
  for (const l of parsed.lineas) {
    if (!l.numSerie) continue;
    if (!porSerie.has(l.numSerie)) porSerie.set(l.numSerie, []);
    porSerie.get(l.numSerie).push(l);
  }
  const lineaDe = registro => {
    const mismas = porSerie.get(registro.num_serie) || [];
    if (!mismas.length) return null;
    const exacta = mismas.find(l => l.tipoOperacion === OPERACION[registro.record_type]);
    if (exacta) return exacta;
    return (mismas.length === 1 && !mismas[0].tipoOperacion) ? mismas[0] : null;
  };
  lote.forEach((x, i) => {
    const { registro } = x;
    const linea = lineaDe(registro) || parsed.lineas[i] || {};
    resultados.set(registro.id, upsertEnvio(db, registro.id, {
      estado: estadoRegistroToEstado(linea.estadoRegistro),
      entorno, endpoint, http_status: resp.httpStatus,
      estado_envio: parsed.estadoEnvio, estado_registro: linea.estadoRegistro,
      codigo_error: linea.codigoError, descripcion_error: linea.descripcionError,
      csv: parsed.csv, tiempo_espera_envio: parsed.tiempoEspera,
      request_xml: peticionDe(x),
      response_xml: solo ? resp.body : (lineaXml(resp.body, registro.num_serie, OPERACION[registro.record_type]) || resp.body),
      enviado_at: ahora, bumpIntentos: true,
    }));
  });
  return salida();
}

// Envío de UN registro (pantalla "Enviar" y script de preproducción). Delega en el lote de tamaño 1
// para que el camino manual y el automático no puedan divergir nunca: un solo orquestador.
export async function enviarRegistro(db, registroId, opts = {}) {
  const [envio] = await enviarLote(db, [registroId], opts);
  return envio;
}
