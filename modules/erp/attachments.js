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
import { join, isAbsolute } from 'path';
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

// Carpeta de uploads del tenant. Se crea si no existe. data/ está en .gitignore →
// fuera del repo. El aislamiento por tenant es por carpeta (igual que las BD).
export function uploadsDir(tenant) {
  const slug = (tenant && tenant.slug) ? tenant.slug : 'default';
  const dir = join(process.cwd(), 'data', 'uploads', slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Guarda el binario con un nombre NO adivinable (16 bytes aleatorios) y registra el
// metadato en `attachments`. entity_type/entity_id quedan NULL hasta que la captura
// aterriza en una recepción ('po_receipt') o una compra directa ('purchase').
export function saveAttachment(db, tenant, { buffer, originalName, mime, kind = 'supplier_invoice' }) {
  const ext = ALLOWED_MIME[mime] || 'bin';
  const dir = uploadsDir(tenant);
  const fname = randomBytes(16).toString('hex') + '.' + ext;
  writeFileSync(join(dir, fname), buffer);
  // path RELATIVO a cwd (portable entre despliegues); se resuelve al servir.
  const slug = (tenant && tenant.slug) ? tenant.slug : 'default';
  const rel = join('data', 'uploads', slug, fname);
  const r = db.prepare(
    'INSERT INTO attachments (kind, original_name, path, mime, size) VALUES (?,?,?,?,?)'
  ).run(kind, originalName || '', rel, mime, buffer.length);
  return { id: r.lastInsertRowid, path: rel, mime, size: buffer.length };
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

// Lee el binario del disco (null si el fichero ya no está; nunca lanza).
export function readAttachmentBuffer(att) {
  if (!att || !att.path) return null;
  const abs = isAbsolute(att.path) ? att.path : join(process.cwd(), att.path);
  if (!existsSync(abs)) return null;
  try { return readFileSync(abs); } catch { return null; }
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Bloque "Documento origen" para la ficha de la compra/recepción resultante. El archivo
// se sirve por el endpoint protegido (sesión + permiso), nunca como estático.
export function originDocBlock(db, entityType, entityId) {
  const atts = attachmentsFor(db, entityType, entityId);
  if (!atts.length) return '';
  const items = atts.map(a => {
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
