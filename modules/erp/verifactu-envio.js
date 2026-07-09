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
import http from 'http';
import https from 'https';
import { join } from 'path';
import { fmtImporte } from './verifactu.js';   // Tarea 1 (inmutable): formato oficial de importes

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
  const byRate = {};
  for (const it of items || []) {
    const rate = Number(it.tax_rate) || 0;
    (byRate[rate] ||= { rate, base: 0, cuota: 0 });
    byRate[rate].base = r2(byRate[rate].base + (Number(it.total_price) || 0));
    byRate[rate].cuota = r2(byRate[rate].cuota + (Number(it.tax_amount) || 0));
  }
  let arr = Object.values(byRate);
  const sumCuota = r2(arr.reduce((s, g) => s + g.cuota, 0));
  if (Math.round(sumCuota * 100) === 0 && Math.round(r2(invoice.tax_amount) * 100) !== 0) {
    let rate = Number(invoice.tax_rate) || 0;
    if (!rate && r2(invoice.subtotal)) { const eff = Math.round(r2(invoice.tax_amount) / r2(invoice.subtotal) * 100); if ([0, 4, 10, 21].includes(eff)) rate = eff; }
    arr = [{ rate, base: r2(invoice.subtotal), cuota: r2(invoice.tax_amount) }];
  }
  return arr.filter(g => Math.round(g.base * 100) !== 0 || Math.round(g.cuota * 100) !== 0).sort((a, b) => b.rate - a.rate);
}

// Construye el <RegistroAlta> de UN registro congelado. Devuelve { xml, avisos, bloqueado }.
// `bloqueado=true` (con avisos) cuando falta un dato obligatorio o los importes no cuadran: NO se
// envía y se marca 'bloqueado_datos'. Defaults documentados: CalificacionOperacion S1, ClaveRegimen 01.
export function buildRegistroAlta({ registro, invoice, items, prevRegistro, companyName, sistemaInfo, calificacion = 'S1', claveRegimen = '01' }) {
  const avisos = [];
  const tipo = registro.tipo_factura || 'F1';
  const esSimplificada = tipo === 'F2';

  // Destinatario: obligatorio de facto salvo F2 (simplificada). NIF+nombre del cliente.
  const nifDest = invoice.client_fiscal_id || '';
  const nombreDest = invoice.client_name || '';
  if (!esSimplificada && !nifDest) avisos.push(`Falta el NIF del destinatario (obligatorio en factura ${tipo}); corrige la factura antes de remitir.`);

  // Desglose por tipo de IVA.
  const desglose = desgloseFromItems(invoice, items);
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
  const detalles = desglose.map(g =>
    `<sf:DetalleDesglose>${el('sf:Impuesto', '01')}${el('sf:ClaveRegimen', claveRegimen)}${el('sf:CalificacionOperacion', calificacion)}${el('sf:TipoImpositivo', fmtImporte(g.rate))}${el('sf:BaseImponibleOimporteNoSujeto', fmtImporte(g.base))}${el('sf:CuotaRepercutida', fmtImporte(g.cuota))}</sf:DetalleDesglose>`
  ).join('');
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
// PASO 4 — Orquestación IDEMPOTENTE del envío de un LOTE de registros de alta.
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

    // Fase A: solo altas. La remisión de anulaciones es ampliación posterior (no romper).
    if (registro.record_type !== 'alta') {
      resultados.set(registroId, upsertEnvio(db, registroId, { estado: ESTADO.BLOQUEADO, aviso: 'Fase A solo remite registros de ALTA; la anulación se enviará en una ampliación posterior.' }));
      continue;
    }

    // Idempotencia: no reenviar lo ya aceptado por la AEAT.
    const existing = getEnvio(db, registroId);
    if (yaAceptado(existing) && !opts.forzar) { resultados.set(registroId, existing); continue; }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(registro.invoice_id) || {};
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(registro.invoice_id);
    const prevRegistro = registro.primer_registro === 'S' ? null
      : db.prepare('SELECT * FROM verifactu_registros WHERE id < ? ORDER BY id DESC LIMIT 1').get(registroId);
    if (companyName === null) companyName = db.prepare('SELECT company_name FROM company_config WHERE id=1').get()?.company_name || invoice.company_name || '';

    const built = buildRegistroAlta({ registro, invoice, items, prevRegistro, companyName, sistemaInfo });
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
  const lineaXml = (body, serie) => {
    const esc = serie.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('<(?:[\\w.-]+:)?RespuestaLinea>(?:(?!</(?:[\\w.-]+:)?RespuestaLinea>)[\\s\\S])*?'
      + '<(?:[\\w.-]+:)?NumSerieFactura>' + esc + '</(?:[\\w.-]+:)?NumSerieFactura>'
      + '[\\s\\S]*?</(?:[\\w.-]+:)?RespuestaLinea>');
    const m = String(body || '').match(re);
    return m ? m[0] : null;
  };

  let resp;
  try {
    resp = await sendSoap(envelope, { endpoint, cert, timeoutMs: opts.timeoutMs || 30000, rejectUnauthorized: opts.rejectUnauthorized !== false });
  } catch (e) {
    // Red caída / AEAT sin responder: NO hubo envío. `http_status` queda NULL a propósito — es lo que
    // la cola mira para saber que el control de flujo no se ha consumido y puede reintentar antes.
    for (const x of lote) resultados.set(x.registro.id, upsertEnvio(db, x.registro.id, { estado: ESTADO.ERROR_COM, entorno, endpoint, descripcion_error: e.message, aviso: 'Error de comunicación con la AEAT: ' + e.message, request_xml: peticionDe(x), enviado_at: ahora, bumpIntentos: true }));
    return salida();
  }

  const parsed = parseRespuesta(resp.body);
  if (parsed.soapFault) {
    // El fault es del sobre entero (no trae líneas): se guarda íntegro en cada fila. Es corto.
    for (const x of lote) resultados.set(x.registro.id, upsertEnvio(db, x.registro.id, { estado: ESTADO.ERROR_COM, entorno, endpoint, http_status: resp.httpStatus, descripcion_error: parsed.faultString, aviso: 'SoapFault de la AEAT: ' + parsed.faultString, request_xml: peticionDe(x), response_xml: resp.body, enviado_at: ahora, bumpIntentos: true }));
    return salida();
  }

  // Cada RespuestaLinea con SU registro por NumSerieFactura: la AEAT no garantiza el orden, y dentro
  // de un lote de altas el correlativo de serie es único. El índice queda solo de red de seguridad.
  const porSerie = new Map(parsed.lineas.filter(l => l.numSerie).map(l => [l.numSerie, l]));
  lote.forEach((x, i) => {
    const { registro } = x;
    const linea = porSerie.get(registro.num_serie) || parsed.lineas[i] || {};
    resultados.set(registro.id, upsertEnvio(db, registro.id, {
      estado: estadoRegistroToEstado(linea.estadoRegistro),
      entorno, endpoint, http_status: resp.httpStatus,
      estado_envio: parsed.estadoEnvio, estado_registro: linea.estadoRegistro,
      codigo_error: linea.codigoError, descripcion_error: linea.descripcionError,
      csv: parsed.csv, tiempo_espera_envio: parsed.tiempoEspera,
      request_xml: peticionDe(x),
      response_xml: solo ? resp.body : (lineaXml(resp.body, registro.num_serie) || resp.body),
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
