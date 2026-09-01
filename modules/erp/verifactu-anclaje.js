// ── VERI*FACTU · Anclaje externo — la cadena, sellada por un tercero que no somos nosotros ──
//
// Lo que resuelve: `calcHash` (invoices.js) y la huella oficial (verifactu.js) son funciones puras
// sobre datos que están en el mismo fichero .db. Quien tiene el fichero puede recalcular la cadena
// entera y el verificador propio (`verifyTenantInvoices`) sale verde igual — lo dice
// docs/seguridad/vectores-de-ataque.md y aquí se cierra ese límite, no antes de que el envío a la
// AEAT (verifactu-envio.js/verifactu-cola.js) se pueda encender, y también para las facturas que esa
// cadena oficial nunca va a cubrir por arrancar limpia en la implantación.
//
// Cada anclaje congela, con la firma de una autoridad de sellado de tiempo (TSA, RFC-3161) EXTERNA,
// una raíz de DOS NIVELES:
//   · la raíz fiscal — resume ENTERO el material fiscal del negocio hasta un corte exacto (los tres
//     MAX(id) de invoices / invoice_anulaciones / verifactu_registros en ese instante). Cara de
//     recomponer, O(facturas).
//   · la raíz — SHA-256 de la cabecera de la propia fila (sus columnas + la raíz fiscal). Barata de
//     recomponer, O(1): es lo que sella la TSA, y comprobarla no exige releer ninguna factura.
// Los anclajes van numerados y encadenados entre sí (raiz_anterior), así que borrar uno del medio se
// ve. El juez (`verificarAnclajes`, más abajo) es un CLASIFICADOR: cada fila cae en exactamente un
// cubo y el veredicto se calcula contando, no por ausencia de alarma — ver docs/verifactu/anclaje-externo.md.
//
// SOLO LEE las tres tablas fiscales — no las toca, no las escribe, no depende de que estén sanas
// para poder anclar (si la cadena está rota se ancla igual, con la alarma escrita: congelar la
// prueba de un estado roto vale más que no congelar nada).
//
// Apagado por defecto, y sin interruptor que se quede encendido por descuido: `motivoAnclajeInactivo`
// exige VERIFACTU_ANCLAJE_TSA y VERIFACTU_ANCLAJE_TSA_CA en el entorno del servicio (/etc/bamburu.env),
// donde el orquestador no escribe. Sin esas dos variables, el código puede vivir en el árbol sin
// anclar nada — el mismo cerrojo que se acabó poniendo en las copias de seguridad.
//
// Detalle completo, qué prueba y qué NO prueba: docs/verifactu/anclaje-externo.md.
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { verifyTenantInvoices } from '../superadmin/integridad.js';

const sha256Upper = str => createHash('sha256').update(str, 'utf8').digest('hex').toUpperCase();

export const ANCLAJE_LATIDO_H = Number(process.env.ANCLAJE_LATIDO_H) > 0 ? Number(process.env.ANCLAJE_LATIDO_H) : 24;
// Cuántos anclajes, como máximo, recorre de un tirón el botón «Comprobar ahora» de la pantalla. Cada
// anclaje son 3 SELECT completos (raizFiscal, solo en el ÚLTIMO de la ventana) + un openssl ts -verify
// + un openssl ts -reply -text (medido: ~11 ms), y como better-sqlite3 es síncrono y execFileSync
// bloquea el bucle de eventos, sin acotar el botón congela el proceso entero (todos los negocios, no
// solo este) mientras recorre la sucesión. 25 ≈ 0,3 s. Con `limite < total` el veredicto que devuelve
// verificarAnclajes() es SIEMPRE parcial (nunca el veredicto verde): el botón no puede decir que todo
// está bien sobre anclajes que no ha mirado.
export const ANCLAJE_COMPROBAR_LIMITE = Number(process.env.ANCLAJE_COMPROBAR_LIMITE) > 0 ? Number(process.env.ANCLAJE_COMPROBAR_LIMITE) : 25;
const SELLO_TIMEOUT_MS = 15000;

function opensslDisponible() {
  try { execFileSync('openssl', ['version'], { stdio: ['ignore', 'ignore', 'ignore'] }); return true; }
  catch { return false; }
}

// ── ¿Puede este negocio anclar ahora? Devuelve el MOTIVO de que no, o null si sí. ──
// Calcada de motivoColaInactiva (verifactu-cola.js): es la única puerta, y el producto y su cartel
// en pantalla nunca discrepan porque los dos preguntan aquí.
export function motivoAnclajeInactivo(slug) {
  if (process.env.VERIFACTU_ANCLAJE === 'off') return 'El anclaje externo está apagado (VERIFACTU_ANCLAJE=off).';
  if (!slug) return 'Sin negocio identificado: el anclaje solo corre con el tenant resuelto.';
  if (!process.env.VERIFACTU_ANCLAJE_TSA) {
    return 'No hay ninguna autoridad de sellado configurada: las facturas se encadenan, pero nadie de fuera las está sellando.';
  }
  const ca = process.env.VERIFACTU_ANCLAJE_TSA_CA;
  if (!ca || !existsSync(ca)) {
    return 'Falta el certificado raíz de la autoridad de sellado (VERIFACTU_ANCLAJE_TSA_CA): sin él no se puede verificar lo que devuelva la TSA, y un sello sin verificar no se guarda.';
  }
  if (!opensslDisponible()) return 'openssl no está disponible en este servidor: el anclaje no puede sellar ni verificar sin él.';
  return null;
}

// ── Nivel 1 · la raíz FISCAL: resume ENTERO el material fiscal hasta un corte exacto ──
// Cara de recomponer, O(facturas): solo se paga una vez por auditoría completa, para la ÚLTIMA fila
// de la ventana (§4.2.5.3.3 del análisis) — la raíz fiscal del último anclaje es función de TODAS las
// filas fiscales selladas, así que tocar cualquiera de ellas la cambia.
// Formato ESTABLE a propósito (ver docs/verifactu/anclaje-externo.md): tocarlo invalida todos los
// anclajes anteriores. Los topes por id son lo que hace que la raíz de ayer siga verificando hoy.
export function raizFiscal(db, { hastaInvoiceId, hastaAnulacionId, hastaRegistroId }) {
  const facturas = db.prepare(
    'SELECT id, series, year, sequence, invoice_number, verifactu_hash FROM invoices WHERE id <= ? ORDER BY id ASC'
  ).all(hastaInvoiceId);
  const anulaciones = db.prepare(
    'SELECT id, invoice_id, invoice_number, verifactu_hash FROM invoice_anulaciones WHERE id <= ? ORDER BY id ASC'
  ).all(hastaAnulacionId);
  const registros = db.prepare(
    'SELECT id, record_type, num_serie, huella FROM verifactu_registros WHERE id <= ? ORDER BY id ASC'
  ).all(hastaRegistroId);

  const lineas = [
    'bamburu-anclaje-fiscal-v2',
    'invoices=' + facturas.length,
    ...facturas.map(f => [f.id, f.series, f.year, f.sequence, f.invoice_number, f.verifactu_hash].join('|')),
    'anulaciones=' + anulaciones.length,
    ...anulaciones.map(a => [a.id, a.invoice_id, a.invoice_number, a.verifactu_hash].join('|')),
    'registros=' + registros.length,
    ...registros.map(r => [r.id, r.record_type, r.num_serie, r.huella].join('|')),
  ];

  return { raizFiscal: sha256Upper(lineas.join('\n')), n_facturas: facturas.length, n_anulaciones: anulaciones.length, n_registros: registros.length };
}

// ── Nivel 2 · la cabecera: las columnas de la propia fila + la raíz fiscal, en un único texto ──
// UNA sola función que construye el texto exacto — la usan raizCanonica() (para sellar) y
// cabeceraDeFila() (para comprobar una fila ya guardada), para que las dos no puedan divergir.
function textoCabecera({ raizAnterior, hastaInvoiceId, hastaAnulacionId, hastaRegistroId, nFacturas, nAnulaciones, nRegistros, cadenaOk, cadenaDetalleSha, tsaUrl, raizFiscal: rf }) {
  return [
    'bamburu-anclaje-v2',
    'raiz_anterior=' + (raizAnterior || ''),
    'hasta_invoice_id=' + hastaInvoiceId,
    'hasta_anulacion_id=' + hastaAnulacionId,
    'hasta_registro_id=' + hastaRegistroId,
    'n_facturas=' + nFacturas,
    'n_anulaciones=' + nAnulaciones,
    'n_registros=' + nRegistros,
    'cadena_ok=' + (cadenaOk ? 1 : 0),
    'cadena_detalle_sha=' + (cadenaDetalleSha || ''),
    'tsa_url=' + tsaUrl,
    'raiz_fiscal=' + rf,
  ].join('\n');
}

// La raíz que se sella: recompone la raíz fiscal (nivel 1) y la envuelve en la cabecera (nivel 2).
// Recibe lo que YA tiene calculado `anclar()` en el momento de anclar.
export function raizCanonica(db, { hastaInvoiceId, hastaAnulacionId, hastaRegistroId, raizAnterior, cadenaOk, cadenaDetalle, tsaUrl }) {
  const rf = raizFiscal(db, { hastaInvoiceId, hastaAnulacionId, hastaRegistroId });
  const cadenaDetalleSha = cadenaDetalle ? sha256Upper(cadenaDetalle) : '';
  const texto = textoCabecera({
    raizAnterior, hastaInvoiceId, hastaAnulacionId, hastaRegistroId,
    nFacturas: rf.n_facturas, nAnulaciones: rf.n_anulaciones, nRegistros: rf.n_registros,
    cadenaOk, cadenaDetalleSha, tsaUrl, raizFiscal: rf.raizFiscal,
  });
  return { raiz: sha256Upper(texto), raizFiscal: rf.raizFiscal, n_facturas: rf.n_facturas, n_anulaciones: rf.n_anulaciones, n_registros: rf.n_registros };
}

// Recompone la cabecera de una fila YA GUARDADA de verifactu_anclajes, usando su raiz_fiscal
// ALMACENADA (no la recalcula: eso es lo que hace esto O(1)). Sirve para comprobar en un solo
// SHA-256 que las columnas de una fila son las mismas que se sellaron — sin ellas no hay forma de
// que cambiar `n_facturas`, `sellado_at`, `tsa_url` o `cadena_ok` en la fila pase desapercibido.
export function cabeceraDeFila(fila) {
  const cadenaDetalleSha = fila.cadena_detalle ? sha256Upper(fila.cadena_detalle) : '';
  const texto = textoCabecera({
    raizAnterior: fila.raiz_anterior, hastaInvoiceId: fila.hasta_invoice_id, hastaAnulacionId: fila.hasta_anulacion_id, hastaRegistroId: fila.hasta_registro_id,
    nFacturas: fila.n_facturas, nAnulaciones: fila.n_anulaciones, nRegistros: fila.n_registros,
    cadenaOk: !!fila.cadena_ok, cadenaDetalleSha, tsaUrl: fila.tsa_url, raizFiscal: fila.raiz_fiscal,
  });
  return sha256Upper(texto);
}

// ── La ida y vuelta RFC-3161, en un directorio de usar y tirar. Nunca lanza. ──
export async function sellar(raiz, { tsaUrl, caPath, timeoutMs = SELLO_TIMEOUT_MS } = {}) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'bamburu-anclaje-'));
    const reqPath = join(dir, 'req.tsq');
    const respPath = join(dir, 'resp.tsr');
    const digest = String(raiz).toLowerCase();

    // -cert pide que el token incluya el certificado firmante: sin él no se puede verificar dentro
    // de unos años, cuando la CA ya no esté publicada en ningún otro sitio.
    execFileSync('openssl', ['ts', '-query', '-digest', digest, '-sha256', '-cert', '-out', reqPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    const reqBytes = readFileSync(reqPath);

    let respBytes;
    try {
      const res = await fetch(tsaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/timestamp-query', 'Accept': 'application/timestamp-reply' },
        body: reqBytes,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, token: null, selladoAt: null, error: 'la TSA respondió ' + res.status };
      respBytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return { ok: false, token: null, selladoAt: null, error: 'no se pudo contactar con la TSA: ' + (e.message || e) };
    }
    writeFileSync(respPath, respBytes);

    // Un sello que no verifica es peor que ninguno: cierra la pregunta. NO se guarda.
    let salidaVerify;
    try {
      salidaVerify = execFileSync('openssl', ['ts', '-verify', '-digest', digest, '-in', respPath, '-CAfile', caPath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    } catch (e) {
      const salida = ((e.stdout || '') + (e.stderr || '')).toString();
      return { ok: false, token: null, selladoAt: null, error: 'el sello no verifica: ' + (salida || e.message) };
    }
    if (!/Verification: OK/.test(salidaVerify)) {
      return { ok: false, token: null, selladoAt: null, error: 'el sello no verifica: ' + salidaVerify.trim() };
    }

    // La hora la dice la TSA, no nuestro reloj. Si por lo que sea no se puede leer, el token sigue
    // siendo válido (ya se verificó arriba); se guarda sin hora exacta antes que tirar un sello bueno.
    let selladoAt = null;
    try {
      const texto = execFileSync('openssl', ['ts', '-reply', '-in', respPath, '-text'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      const m = texto.match(/Time stamp:\s*(.+)/);
      if (m) { const d = new Date(m[1].trim()); if (!Number.isNaN(d.getTime())) selladoAt = d.toISOString(); }
    } catch { /* sin hora exacta; el sello sigue siendo válido */ }

    return { ok: true, token: respBytes, selladoAt, error: null };
  } catch (e) {
    return { ok: false, token: null, selladoAt: null, error: e.message || String(e) };
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* directorio de usar y tirar */ } }
  }
}

// Verifica en local (sin red) un token .tsr ya guardado contra la raíz que dice proteger, y de paso
// lee la hora que firmó la TSA (para la frescura del §3.4/3.2.9: nunca se mide con nuestro reloj).
function verificarToken(raiz, token, caPath) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'bamburu-anclaje-verif-'));
    const respPath = join(dir, 'resp.tsr');
    writeFileSync(respPath, token);

    let ok = false, detalle = '';
    try {
      const salida = execFileSync('openssl', ['ts', '-verify', '-digest', String(raiz).toLowerCase(), '-in', respPath, '-CAfile', caPath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      ok = /Verification: OK/.test(salida);
      detalle = salida.trim();
    } catch (e) {
      detalle = ((e.stdout || '') + (e.stderr || '')).toString() || e.message || String(e);
    }

    let horaToken = null;
    try {
      const texto = execFileSync('openssl', ['ts', '-reply', '-in', respPath, '-text'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      const m = texto.match(/Time stamp:\s*(.+)/);
      if (m) { const d = new Date(m[1].trim()); if (!Number.isNaN(d.getTime())) horaToken = d.toISOString(); }
    } catch { /* sin hora legible: el veredicto de la firma ya está decidido arriba */ }

    // Se recorta a la primera línea: el resto (incluido un volcado de asn1_d2i_read_bio cuando el
    // token es basura) no debe acabar en una URL ni en la pantalla del dueño.
    const primeraLinea = (detalle.split('\n')[0] || detalle).trim();
    return { ok, detalle: primeraLinea, horaToken };
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* directorio de usar y tirar */ } }
  }
}

// ── Una pasada de anclaje para UN negocio ────────────────────────────────────────────────────
export async function anclar(db, opts = {}) {
  const slug = opts.slug ?? db.bamburuSlug ?? null;
  const motivo = motivoAnclajeInactivo(slug);
  if (motivo) return { anclado: false, motivo };

  const ahoraMs = opts.ahoraMs ?? Date.now();
  const latidoH = opts.latidoH ?? ANCLAJE_LATIDO_H;
  const tsaUrl = process.env.VERIFACTU_ANCLAJE_TSA;
  const caPath = process.env.VERIFACTU_ANCLAJE_TSA_CA;

  // Los tres topes y el último anclaje SELLADO, en una sola transacción síncrona: lo que se emita
  // después de leer el MAX(id) sencillamente pertenece al anclaje siguiente. No hay estado a medias.
  const { maxInv, maxAnu, maxReg, ultimo } = db.transaction(() => ({
    maxInv: db.prepare('SELECT COALESCE(MAX(id),0) m FROM invoices').get().m,
    maxAnu: db.prepare('SELECT COALESCE(MAX(id),0) m FROM invoice_anulaciones').get().m,
    maxReg: db.prepare('SELECT COALESCE(MAX(id),0) m FROM verifactu_registros').get().m,
    ultimo: db.prepare(`SELECT * FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC LIMIT 1`).get() || null,
  }))();

  // Sin material fiscal no hay nada que anclar (y evita gastar sellos en bases de gate vacías).
  if (maxInv === 0 && maxReg === 0) return { anclado: false, motivo: 'no hay material fiscal que anclar todavía' };

  const subioAlgo = !ultimo || maxInv > ultimo.hasta_invoice_id || maxAnu > ultimo.hasta_anulacion_id || maxReg > ultimo.hasta_registro_id;
  const pasoElLatido = !ultimo || (ahoraMs - Date.parse(ultimo.created_at)) >= latidoH * 3600 * 1000;
  if (!subioAlgo && !pasoElLatido) return { anclado: false, motivo: 'nada nuevo que anclar y aún no toca el latido diario' };

  // La cadena propietaria cuadra consigo misma o no — se ancla IGUAL, dejando la alarma escrita.
  let cadena;
  try { cadena = verifyTenantInvoices(db.name); }
  catch (e) { cadena = { ok: false, alarm: { invoice_number: '—', reason: 'no se pudo verificar: ' + e.message } }; }
  const cadenaOk = !!cadena.ok;
  const cadenaDetalle = cadena.ok ? null : `factura ${cadena.alarm?.invoice_number ?? '—'}: ${cadena.alarm?.reason ?? 'alarma sin detalle'}`;

  const raizAnterior = ultimo ? ultimo.raiz : '';
  const { raiz, raizFiscal: rfValor, n_facturas, n_anulaciones, n_registros } = raizCanonica(db, {
    hastaInvoiceId: maxInv, hastaAnulacionId: maxAnu, hastaRegistroId: maxReg, raizAnterior, cadenaOk, cadenaDetalle, tsaUrl,
  });

  const sello = await sellar(raiz, { tsaUrl, caPath, timeoutMs: opts.timeoutMs });
  const secuencia = sello.ok ? (ultimo ? ultimo.secuencia + 1 : 1) : 0;

  db.prepare(`INSERT INTO verifactu_anclajes
      (secuencia, raiz, raiz_fiscal, raiz_anterior, hasta_invoice_id, hasta_anulacion_id, hasta_registro_id,
       n_facturas, n_anulaciones, n_registros, cadena_ok, cadena_detalle, tsa_url, token, sellado_at, estado, error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(secuencia, raiz, rfValor, raizAnterior, maxInv, maxAnu, maxReg,
      n_facturas, n_anulaciones, n_registros, cadenaOk ? 1 : 0, cadenaDetalle, tsaUrl,
      sello.ok ? sello.token : null, sello.ok ? sello.selladoAt : null, sello.ok ? 'sellado' : 'fallo',
      sello.ok ? null : sello.error);

  return { anclado: sello.ok, secuencia: sello.ok ? secuencia : null, raiz, cadenaOk, cadenaDetalle, error: sello.ok ? null : sello.error };
}

// Compara dos ISO-8601 AL SEGUNDO (el token no lleva milisegundos con la misma precisión que Date, y
// exigir igualdad exacta a nivel de ms produciría falsas alarmas de redondeo).
function mismoSegundo(isoA, isoB) {
  const ta = Date.parse(isoA), tb = Date.parse(isoB);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.floor(ta / 1000) === Math.floor(tb / 1000);
}

// Clasifica UNA fila de la ventana de sellados (§4.2.5.3.2 del análisis). Devuelve
// { tipo: 'verificado' | 'sinComprobar' | 'alarma', motivo? }. Para la ÚLTIMA fila de la ventana,
// además, recompone la raíz fiscal (una sola vez, O(facturas)) y mide la frescura con el reloj del
// tercero — nunca con created_at, que es una columna nuestra y el atacante también puede editar.
function clasificarFilaVentana(f, { esUltima, secuenciaEsperada, raizAnteriorEsperada, caPath, db, ahoraMs, latidoH }) {
  if (f.estado === 'sellado' && f.error) {
    return { tipo: 'alarma', motivo: 'el anclaje está marcado como sellado pero trae un error de origen registrado: dato inconsistente' };
  }
  if (f.raiz_fiscal == null) {
    return { tipo: 'sinComprobar', motivo: 'anclaje en formato v1, anterior a este cambio: no se puede comprobar' };
  }
  if (cabeceraDeFila(f) !== f.raiz) {
    return { tipo: 'alarma', motivo: 'se han cambiado los datos del anclaje después de sellarlo' };
  }
  if (f.secuencia !== secuenciaEsperada) {
    return { tipo: 'alarma', motivo: 'hueco en la numeración: falta el anclaje ' + secuenciaEsperada };
  }
  if ((f.raiz_anterior || '') !== raizAnteriorEsperada) {
    return { tipo: 'alarma', motivo: 'falta un anclaje: la cadena de raíces está rota' };
  }
  if (!f.token) {
    return { tipo: 'alarma', motivo: 'dice sellada y no tiene sello' };
  }
  if (!caPath) {
    return { tipo: 'sinComprobar', motivo: 'falta el certificado raíz de la TSA' };
  }

  const verif = verificarToken(f.raiz, f.token, caPath);
  if (!verif.ok) {
    return { tipo: 'alarma', motivo: 'el sello no es válido: ' + verif.detalle };
  }
  if (f.sellado_at && verif.horaToken && !mismoSegundo(f.sellado_at, verif.horaToken)) {
    return { tipo: 'alarma', motivo: 'la fecha del sello no es la que firmó la TSA' };
  }

  if (esUltima) {
    const recomp = raizFiscal(db, { hastaInvoiceId: f.hasta_invoice_id, hastaAnulacionId: f.hasta_anulacion_id, hastaRegistroId: f.hasta_registro_id });
    if (recomp.raizFiscal !== f.raiz_fiscal) {
      return { tipo: 'alarma', motivo: 'se ha tocado material fiscal ya sellado' };
    }
    const horaReferencia = f.sellado_at || verif.horaToken || null;
    if (horaReferencia) {
      const edadH = (ahoraMs - Date.parse(horaReferencia)) / 3600000;
      if (edadH > latidoH * 2) {
        return { tipo: 'alarma', motivo: `el último sello tiene ${Math.round(edadH)} h: hace más de ${latidoH * 2} h que no se ancla` };
      }
    }
  }

  return { tipo: 'verificado' };
}

// Una vez hay una única alarma de material fiscal tocado, y todo lo demás está limpio, busca en
// binario (log₂ n recomposiciones) cuál es el PRIMER anclaje cuya raíz fiscal ya no cuadra con la que
// tiene guardada — para poder decir "la primera prueba de que se tocó es el anclaje 47, sellado el 3
// de septiembre" en vez de solo señalar al último. Es diagnóstico: el veredicto ya es 'alarma' antes
// de buscar, y solo se ejecuta cuando el encadenado y todos los tokens están limpios (si no, la
// propiedad que hace válida la búsqueda —monotonía— no está garantizada).
function localizarPrimerTocado(db, selladas) {
  let ini = 0, fin = selladas.length - 1, primero = selladas.length - 1;
  while (ini <= fin) {
    const mid = (ini + fin) >> 1;
    const fila = selladas[mid];
    const recomp = raizFiscal(db, { hastaInvoiceId: fila.hasta_invoice_id, hastaAnulacionId: fila.hasta_anulacion_id, hastaRegistroId: fila.hasta_registro_id });
    if (recomp.raizFiscal !== fila.raiz_fiscal) { primero = mid; fin = mid - 1; }
    else { ini = mid + 1; }
  }
  return selladas[primero];
}

// ── El juez: CLASIFICA cada fila en un cubo y calcula el veredicto CONTANDO. SOLO LEE. ──
// Ya no es una lista de motivos de alarma (el verde era el valor por defecto del bucle): ahora cada
// fila de verifactu_anclajes —TODAS, no solo las 'sellado'— cae en exactamente un cubo, y el veredicto
// sale de los contadores. El valor por defecto de la variable del veredicto es 'alarma'; el literal
// que dice que todo está en orden SE GANA.
//
// opts.limite acota la comprobación criptográfica a los ÚLTIMOS N anclajes sellados (lo usa el botón
// «Comprobar ahora»: sin acotar, recorrer toda la sucesión bloquea el proceso entero). Los sellados
// que quedan fuera de la ventana NO desaparecen de la cuenta: van al cubo `fueraDeVentana`, y con
// `fueraDeVentana > 0` el veredicto NUNCA puede decir que todo está en orden — solo que está
// PARCIALMENTE comprobado. Sin límite (el uso por defecto, y el que usa el gate y el barrido diario)
// recorre la sucesión completa desde el principio.
export function verificarAnclajes(db, opts = {}) {
  const limite = opts.limite ?? null;
  const caPath = opts.caPath ?? process.env.VERIFACTU_ANCLAJE_TSA_CA;
  const ahoraMs = opts.ahoraMs ?? Date.now();
  const latidoH = opts.latidoH ?? ANCLAJE_LATIDO_H;

  // ── 1 · Censo de TODAS las filas: cada una cae en un cubo, sin excepción ──
  const todas = db.prepare('SELECT * FROM verifactu_anclajes ORDER BY secuencia ASC, id ASC').all();
  const totalFilas = todas.length;

  let fallidas = 0;
  let alarmadas = 0;
  let alarma = null;
  const marcarAlarma = (fila, motivo) => {
    alarmadas++;
    if (!alarma) alarma = { secuencia: fila.secuencia, sellado_at: fila.sellado_at, motivo };
  };

  const selladas = [];
  for (const f of todas) {
    if (f.estado === 'sellado') { selladas.push(f); continue; }
    if (f.estado === 'fallo') {
      if (f.secuencia === 0 && f.token === null && f.error !== null) { fallidas++; continue; }
      marcarAlarma(f, 'una fila marcada como fallo lleva número de orden y sello: alguien ha escondido un anclaje');
      continue;
    }
    marcarAlarma(f, 'hay una fila con un estado que este producto no escribe nunca');
  }

  // ── 2 · La ventana de sellados, encadenada en orden ──
  const sellados = selladas.length;
  const ventana = limite ? selladas.slice(Math.max(0, selladas.length - limite)) : selladas;
  const fueraDeVentana = sellados - ventana.length;

  let verificados = 0;
  let sinComprobar = 0;
  // SIN límite (recorrido completo), la cadena tiene que arrancar de verdad: secuencia 1 y
  // raiz_anterior vacía. Si el anclaje 1 se ha BORRADO entero, el recorrido completo no puede aceptar
  // lo que trae el que ahora es el primero como si fuera el principio — eso sería el mismo agujero
  // que [D] del análisis, solo que sin `limite`.
  // CON límite, no hay anclaje cargado ANTES del primero del lote contra el que contrastar su
  // raiz_anterior: se acepta la que trae y solo se exige continuidad DENTRO del lote. Como esa primera
  // fila ya está fuera de lo que `fueraDeVentana` cubre, el veredicto no puede salir en verde de todos
  // modos mientras haya algo fuera de la ventana.
  let raizAnteriorEsperada = limite && ventana.length ? (ventana[0].raiz_anterior || '') : '';
  let secuenciaEsperada = limite && ventana.length ? ventana[0].secuencia : 1;

  for (let i = 0; i < ventana.length; i++) {
    const f = ventana[i];
    const r = clasificarFilaVentana(f, { esUltima: i === ventana.length - 1, secuenciaEsperada, raizAnteriorEsperada, caPath, db, ahoraMs, latidoH });
    if (r.tipo === 'alarma') marcarAlarma(f, r.motivo);
    else if (r.tipo === 'sinComprobar') sinComprobar++;
    else verificados++;
    raizAnteriorEsperada = f.raiz;
    secuenciaEsperada = f.secuencia + 1;
  }

  // ── 3 · Si la única alarma es material fiscal tocado, y todo lo demás está limpio, precisar cuál ──
  const todoV2 = selladas.every(f => f.raiz_fiscal != null);
  if (alarma && alarmadas === 1 && sinComprobar === 0 && fueraDeVentana === 0 && todoV2
      && alarma.motivo === 'se ha tocado material fiscal ya sellado') {
    const filaTocada = localizarPrimerTocado(db, selladas);
    alarma = { secuencia: filaTocada.secuencia, sellado_at: filaTocada.sellado_at, motivo: 'se ha tocado material fiscal ya sellado (la primera prueba de ello es este anclaje)' };
  }

  // ── 4 · El veredicto, por conteo — el caso imposible también sale en rojo ──
  const cuadranLosCubos = verificados + sinComprobar + alarmadas + fueraDeVentana + fallidas === totalFilas;

  let veredicto = 'alarma';
  if (!cuadranLosCubos) veredicto = 'alarma';
  else if (sellados === 0) veredicto = 'sin-sellos';
  else if (alarmadas > 0) veredicto = 'alarma';
  else if (fueraDeVentana > 0) veredicto = 'parcial';
  else if (sinComprobar > 0) veredicto = 'sin-comprobar';
  else if (verificados === sellados) veredicto = 'cuadra';

  return {
    veredicto, totalFilas, sellados, fallidas, verificados, sinComprobar, fueraDeVentana, alarmadas,
    alarma, ultimo: selladas.length ? selladas[selladas.length - 1] : null,
  };
}

// ── Traduce el veredicto a la frase que ve una persona, SIEMPRE con la cobertura dentro. ──
// La usan los tres sitios que hablan de esto (pantalla, botón, correo diario) para que no puedan
// discrepar — el mismo principio que motivoAnclajeInactivo.
export function textoVeredicto(r) {
  const fechaLegible = iso => iso ? new Date(iso).toLocaleString('es-ES') : 'fecha desconocida';
  if (r.veredicto === 'sin-sellos') {
    return 'nunca se ha sellado nada: no hay ningún anclaje que comprobar.';
  }
  if (r.veredicto === 'parcial') {
    const comprobados = r.sellados - r.fueraDeVentana;
    return `comprobados los últimos ${comprobados} de ${r.sellados} anclajes — de los otros ${r.fueraDeVentana} no se dice nada.`;
  }
  if (r.veredicto === 'sin-comprobar') {
    return `la numeración y el encadenado están en orden, pero ${r.sinComprobar} de ${r.sellados} sello(s) no se ha(n) podido comprobar: falta el certificado raíz de la TSA.`;
  }
  if (r.veredicto === 'alarma') {
    return r.alarma
      ? `ALARMA en el anclaje ${r.alarma.secuencia} (sellado ${fechaLegible(r.alarma.sellado_at)}): ${r.alarma.motivo}`
      : 'ALARMA: la cadena de sellos no está en orden.';
  }
  // El único valor que queda, y es el que se gana comprobando uno a uno todos los sellos: ninguno
  // fuera de ventana, ninguno sin comprobar, ninguna alarma.
  return `${r.verificados} de ${r.sellados} anclajes comprobados uno a uno, todos en orden.`;
}
