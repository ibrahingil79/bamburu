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
// una única "raíz" (SHA-256) que resume todo el material fiscal del negocio hasta un corte exacto:
// los tres MAX(id) de invoices / invoice_anulaciones / verifactu_registros en ese instante. Los
// anclajes van numerados y encadenados entre sí (raiz_anterior), así que borrar uno del medio se ve.
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

// ── La raíz canónica: una sola huella que resume el material fiscal hasta un corte exacto ──
// Formato ESTABLE a propósito (ver docs/verifactu/anclaje-externo.md): tocarlo invalida todos los
// anclajes anteriores. Los topes por id son lo que hace que la raíz de ayer siga verificando hoy.
export function raizCanonica(db, { hastaInvoiceId, hastaAnulacionId, hastaRegistroId, raizAnterior }) {
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
    'bamburu-anclaje-v1',
    'raiz_anterior=' + (raizAnterior || ''),
    'invoices=' + facturas.length,
    ...facturas.map(f => [f.id, f.series, f.year, f.sequence, f.invoice_number, f.verifactu_hash].join('|')),
    'anulaciones=' + anulaciones.length,
    ...anulaciones.map(a => [a.id, a.invoice_id, a.invoice_number, a.verifactu_hash].join('|')),
    'registros=' + registros.length,
    ...registros.map(r => [r.id, r.record_type, r.num_serie, r.huella].join('|')),
  ];

  return { raiz: sha256Upper(lineas.join('\n')), n_facturas: facturas.length, n_anulaciones: anulaciones.length, n_registros: registros.length };
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

// Verifica en local (sin red) un token .tsr ya guardado contra la raíz que dice proteger.
function verificarToken(raiz, token, caPath) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'bamburu-anclaje-verif-'));
    const respPath = join(dir, 'resp.tsr');
    writeFileSync(respPath, token);
    const salida = execFileSync('openssl', ['ts', '-verify', '-digest', String(raiz).toLowerCase(), '-in', respPath, '-CAfile', caPath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { ok: /Verification: OK/.test(salida), detalle: salida.trim() };
  } catch (e) {
    return { ok: false, detalle: ((e.stdout || '') + (e.stderr || '')).toString() || e.message };
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
  const { raiz, n_facturas, n_anulaciones, n_registros } = raizCanonica(db, {
    hastaInvoiceId: maxInv, hastaAnulacionId: maxAnu, hastaRegistroId: maxReg, raizAnterior,
  });

  const sello = await sellar(raiz, { tsaUrl, caPath, timeoutMs: opts.timeoutMs });
  const secuencia = sello.ok ? (ultimo ? ultimo.secuencia + 1 : 1) : 0;

  db.prepare(`INSERT INTO verifactu_anclajes
      (secuencia, raiz, raiz_anterior, hasta_invoice_id, hasta_anulacion_id, hasta_registro_id,
       n_facturas, n_anulaciones, n_registros, cadena_ok, cadena_detalle, tsa_url, token, sellado_at, estado, error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(secuencia, raiz, raizAnterior, maxInv, maxAnu, maxReg,
      n_facturas, n_anulaciones, n_registros, cadenaOk ? 1 : 0, cadenaDetalle, tsaUrl,
      sello.ok ? sello.token : null, sello.ok ? sello.selladoAt : null, sello.ok ? 'sellado' : 'fallo',
      sello.ok ? null : sello.error);

  return { anclado: sello.ok, secuencia: sello.ok ? secuencia : null, raiz, cadenaOk, cadenaDetalle, error: sello.ok ? null : sello.error };
}

// ── El juez: recorre la sucesión de anclajes sellados y dice si cuadra. SOLO LEE. ──
export function verificarAnclajes(db, opts = {}) {
  const filas = db.prepare(`SELECT * FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia ASC`).all();
  if (!filas.length) return { ok: true, total: 0, ultimo: null, alarma: null };

  const caPath = opts.caPath ?? process.env.VERIFACTU_ANCLAJE_TSA_CA;
  let raizAnteriorEsperada = '';
  let secuenciaEsperada = 1;
  let alarma = null;

  for (const f of filas) {
    const recomp = raizCanonica(db, {
      hastaInvoiceId: f.hasta_invoice_id, hastaAnulacionId: f.hasta_anulacion_id,
      hastaRegistroId: f.hasta_registro_id, raizAnterior: f.raiz_anterior,
    });
    if (recomp.raiz !== f.raiz) {
      alarma = { secuencia: f.secuencia, sellado_at: f.sellado_at, motivo: 'se ha tocado material fiscal ya sellado' };
      break;
    }
    if ((f.raiz_anterior || '') !== raizAnteriorEsperada) {
      alarma = { secuencia: f.secuencia, sellado_at: f.sellado_at, motivo: 'falta un anclaje: la cadena de raíces está rota' };
      break;
    }
    if (f.secuencia !== secuenciaEsperada) {
      alarma = { secuencia: f.secuencia, sellado_at: f.sellado_at, motivo: 'hueco en la numeración: falta el anclaje ' + secuenciaEsperada };
      break;
    }
    if (caPath && f.token) {
      const verifica = verificarToken(f.raiz, f.token, caPath);
      if (!verifica.ok) {
        alarma = { secuencia: f.secuencia, sellado_at: f.sellado_at, motivo: 'el sello no es válido: ' + verifica.detalle };
        break;
      }
    }
    raizAnteriorEsperada = f.raiz;
    secuenciaEsperada = f.secuencia + 1;
  }

  const ultimoFila = filas[filas.length - 1];
  if (!alarma) {
    const latidoH = opts.latidoH ?? ANCLAJE_LATIDO_H;
    const edadH = (Date.now() - Date.parse(ultimoFila.created_at)) / 3600000;
    if (edadH > latidoH * 2) {
      alarma = { secuencia: ultimoFila.secuencia, sellado_at: ultimoFila.sellado_at, motivo: `el último sello tiene ${Math.round(edadH)} h: hace más de ${latidoH * 2} h que no se ancla` };
    }
  }

  return { ok: !alarma, total: filas.length, ultimo: ultimoFila, alarma };
}
