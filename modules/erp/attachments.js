// C2 — Adjuntos (documentos origen): foto/PDF de la factura de proveedor que el
// usuario sube. El BINARIO vive FUERA del control de versiones, en una carpeta de
// uploads por tenant (junto a las BD de tenants, data/uploads/<slug>/); en la BD solo
// se guarda el metadato (tabla `attachments`). Nada se borra: un adjunto se conserva
// aunque el documento que enlaza se anule. Servir el archivo SIEMPRE con sesión +
// permiso de lectura de compras (nunca como estático público).
//
// Módulo deliberadamente sin dependencias "pesadas" para que lo puedan importar tanto
// las rutas de captura como las fichas de compra/recepción sin ciclos de import.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, isAbsolute, resolve, sep } from 'path';
import { randomBytes } from 'crypto';

// Tipos aceptados por la captura (acordes con lo que admite la API de Anthropic en
// bloques image/document) → su extensión en disco.
export const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'application/pdf': 'pdf',
};

// Límite de subida. Un PDF/foto de factura cabe de sobra; protege de subidas enormes
// (la API de Anthropic además limita el tamaño del request). 12 MB.
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

// ── QUÉ ES DE VERDAD ESTE FICHERO ────────────────────────────────────────────────────────────────
// LA ÚNICA DEFINICIÓN DEL PROYECTO (`documentos.js` la reexporta; antes vivía allí y solo la usaba
// el logo). La extensión no dice nada y el `type` que manda el navegador tampoco: los dos los
// escribe quien sube. Lo único que no se puede renombrar son los primeros bytes.
//
// Cubre EXACTAMENTE los cinco tipos de ALLOWED_MIME, ni uno más: una firma que se reconoce es una
// firma que autoriza, así que la lista corta es la lista segura. Lo que no se reconoce, no entra.
export function mimeReal(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF'
      && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const seis = buf.toString('ascii', 0, 6);
  if (seis === 'GIF87a' || seis === 'GIF89a') return 'image/gif';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

// La carpeta de adjuntos: la frontera que ningún adjunto cruza al leerse.
export function raizAdjuntos() {
  return join(process.cwd(), 'data', 'uploads');
}

// Una extensión NUNCA es texto libre del usuario: `migracion` la deriva del nombre que sube el
// cliente, y de ahí saldría un `.php` o un `.htaccess` en la carpeta de adjuntos con solo llamar
// así al fichero. Se deja en letras y números, y corta.
function extSegura(x) {
  const e = String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return e || null;
}

const rechazo = (msg) => { const e = new Error(msg); e.status = 400; throw e; };

// Carpeta de uploads del tenant. Se crea si no existe. data/ está en .gitignore →
// fuera del repo. El aislamiento por tenant es por carpeta (igual que las BD).
export function uploadsDir(tenant) {
  const slug = (tenant && tenant.slug) ? tenant.slug : 'default';
  const dir = join(raizAdjuntos(), slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Guarda el binario con un nombre NO adivinable (16 bytes aleatorios) y registra el
// metadato en `attachments`. entity_type/entity_id quedan NULL hasta que la captura
// aterriza en una recepción ('po_receipt') o una compra directa ('purchase').
// `ext` permite guardar con extensión propia un fichero que NO nace de una subida del usuario (p. ej.
// el Facturae que genera el propio Bamburu). Se deja fuera de ALLOWED_MIME a propósito: esa lista
// gobierna qué se admite SUBIR, y ampliarla dejaría colar un XML como si fuera factura de proveedor.
// EL CONTENIDO MANDA, NO LO QUE DIGA QUIEN SUBE. Un `.exe` renombrado a `.png` llega con
// `type: image/png` si el navegador quiere; lo que no puede falsificar es empezar por los bytes de
// un PNG. Aquí se miran los bytes, y el mime que se GUARDA es el medido, no el declarado — que es
// justo el que luego sale por `Content-Type` al servir el fichero.
//
// LA LÍNEA ESTÁ EN «LO QUE ESTE PRODUCTO PINTA». Si lo declarado es uno de los cinco tipos de
// ALLOWED_MIME —los que salen por pantalla como imagen o como PDF— el contenido TIENE que
// coincidir, y si no coincide no entra. Los adjuntos opacos siguen su camino, porque lo suyo no se
// enseña, se archiva: el volcado de datos de `migracion` es cualquier formato por diseño, y el XML
// de Facturae lo genera este mismo servidor. Ninguno de los dos declara un tipo pintable.
export function saveAttachment(db, tenant, { buffer, originalName, mime, kind = 'supplier_invoice', ext: extOverride = null }) {
  if (!buffer || !buffer.length) rechazo('El archivo está vacío.');
  const real = mimeReal(buffer);

  if (ALLOWED_MIME[mime]) {
    if (!real) rechazo('Ese archivo no es una imagen ni un PDF. Cambiarle el nombre o la extensión no lo convierte en uno.');
    if (real !== mime) rechazo('El archivo dice ser ' + mime + ' y su contenido es ' + real + '. No se guarda.');
  }

  // La extensión sale de lo MEDIDO siempre que se haya podido medir; el `ext` de quien llama es el
  // último recurso, y aun así saneado.
  const ext = (real ? ALLOWED_MIME[real] : null) || extSegura(extOverride) || 'bin';
  const mimeGuardado = real || mime || 'application/octet-stream';
  const dir = uploadsDir(tenant);
  const fname = randomBytes(16).toString('hex') + '.' + ext;
  writeFileSync(join(dir, fname), buffer);
  // path RELATIVO a cwd (portable entre despliegues); se resuelve al servir.
  const slug = (tenant && tenant.slug) ? tenant.slug : 'default';
  const rel = join('data', 'uploads', slug, fname);
  const r = db.prepare(
    'INSERT INTO attachments (kind, original_name, path, mime, size) VALUES (?,?,?,?,?)'
  ).run(kind, originalName || '', rel, mimeGuardado, buffer.length);
  return { id: r.lastInsertRowid, path: rel, mime: mimeGuardado, size: buffer.length };
}

export function getAttachment(db, id) {
  return db.prepare('SELECT * FROM attachments WHERE id=?').get(id) || null;
}

// Enlaza el adjunto al documento creado (al aterrizar la captura).
export function linkAttachment(db, id, entityType, entityId) {
  db.prepare('UPDATE attachments SET entity_type=?, entity_id=? WHERE id=?').run(entityType, entityId, id);
}

export function attachmentsFor(db, entityType, entityId) {
  return db.prepare(
    'SELECT * FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY id'
  ).all(entityType, entityId);
}

// LA RUTA DE UN ADJUNTO NO SALE DE LA CARPETA DE ADJUNTOS. La ruta viene de la BASE DE DATOS, y una
// ruta no es de fiar por venir de ahí: basta un fallo en cualquier sitio que escriba en
// `attachments.path` para que se cuele una ruta absoluta (`/etc/bamburu.env`) o una con saltos
// (`data/uploads/x/../../../.secrets/id_rsa`), y esto la servía TAL CUAL — la absoluta ni se tocaba.
// La comprobación es de RESULTADO, no de forma: se resuelve la ruta entera y se exige que lo
// resuelto siga colgando de `data/uploads/`. Así da igual cómo esté escrita la trampa.
export function rutaDeAdjunto(att) {
  if (!att || !att.path) return null;
  const raiz = resolve(raizAdjuntos());
  const abs = isAbsolute(att.path) ? resolve(att.path) : resolve(process.cwd(), att.path);
  if (abs !== raiz && !abs.startsWith(raiz + sep)) return null;   // falla cerrado: fuera, no se lee
  return abs;
}

// Lee el binario del disco (null si el fichero ya no está o si la ruta se sale; nunca lanza).
export function readAttachmentBuffer(att) {
  const abs = rutaDeAdjunto(att);
  if (!abs || !existsSync(abs)) return null;
  try { return readFileSync(abs); } catch { return null; }
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Bloque "Documento origen" para la ficha de la compra/recepción resultante. El archivo
// se sirve por el endpoint protegido (sesión + permiso), nunca como estático.
export function originDocBlock(db, entityType, entityId) {
  const atts = attachmentsFor(db, entityType, entityId);
  if (!atts.length) return '';
  const items = atts.map(a => {
    // Adjunto SIN fichero (compra dictada por voz a DISA): no hay foto/PDF que servir →
    // nota en vez de un enlace roto.
    if (!a.path) return `<div style="color:var(--text2)">🎙️ ${esc(a.original_name || 'Compra dictada por voz a DISA')}</div>`;
    const url = '/api/erp/purchases/capture/file/' + a.id;
    const isImg = (a.mime || '').startsWith('image/');
    return isImg
      ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(a.original_name)}" style="max-width:240px;max-height:320px;border-radius:8px;border:1px solid var(--border)"></a>`
      : `<a href="${url}" target="_blank" rel="noopener" class="btn btn-secondary">Ver PDF — ${esc(a.original_name || 'documento.pdf')}</a>`;
  }).join('<div style="height:.5rem"></div>');
  return `<div class="card" style="margin-top:1rem">
    <div class="card-head"><h3>Documento origen</h3></div>
    <div class="card-body">
      ${items}
      <div style="color:var(--text3);font-size:.78rem;margin-top:.6rem">Factura del proveedor capturada (foto/PDF). El documento nuestro es esta recepción/compra; la factura del proveedor se conserva como soporte.</div>
    </div>
  </div>`;
}
