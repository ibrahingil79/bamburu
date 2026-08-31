// ── LOS TEXTOS DE ERROR Y LA PÁGINA DE ERROR MAQUETADA (U3) ──────────────────────────────────────
//
// HOJA A PROPÓSITO: `core/auth.js` la importa para la página de 403 de `requirePerm`, y `layout.js`
// cierra un ciclo con `core/auth.js` por nueve rutas (`avisos.js → reposicion.js →
// routes/purchase-orders.js → core/auth.js`, entre otras). Si algún día este fichero importa algo de
// `modules/erp/`, el ciclo vuelve.
//
// Movido desde `modules/erp/layout.js` el 31 ago 2026 SIN tocar una línea de lógica. `layout.js`
// reexporta las cuatro piezas, así que ningún importador de antes cambia de ruta.
import { ROOT_TOKENS } from './tokens.js';

// ── Mensajes de ERROR compartidos (U3) ────────────────────────────────────────────
// FUENTE ÚNICA de los textos de error (plantillas T1–T11 de docs/ux/u3-textos-errores.md).
// Voz de DISA en el admin: qué pasó en llano + qué hacer. El portal público usa su propia
// voz NEUTRA en su shell (modules/portal). Espejo exacto en window.ERR para el front.
export const ERR = {
  GEN:       'No hemos podido completar la acción. Vuelve a intentarlo en un momento; si sigue pasando, escríbenos a soporte.',
  GEN_SHORT: 'No se pudo completar. Inténtalo de nuevo.',
  NET:       'Parece que se perdió la conexión. Revisa tu internet y vuelve a intentarlo.',
  LOAD:      'No hemos podido cargar los datos. Recarga la página; si sigue igual, inténtalo en un momento.',
  PERM:      'No tienes permiso para esta acción. Si lo necesitas, pídeselo al dueño o a un administrador del negocio.',
  VALID:     'Revisa el formulario: hay algún campo incompleto o con un formato que no cuadra.',
  PDF:       'No hemos podido generar el PDF ahora mismo. Vuelve a intentarlo en un momento; si persiste, avísanos.',
  EMAIL:     'No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.',
  SERVER:    'Algo ha ido mal por nuestro lado. Vuelve atrás e inténtalo de nuevo; si se repite, escríbenos a soporte.',
  PAGE:      'No encontramos esta página. Puede que el enlace haya cambiado.',
};

// Traduce un mensaje CRUDO (error SQLite, tokens internos, códigos de permiso) a lenguaje
// llano. NO cambia la causa ni cuándo se lanza el error: solo el TEXTO que se muestra. Si el
// mensaje ya es llano (regla de negocio), lo devuelve intacto. Mismas reglas en back y front
// (espejo en window.cleanErrMsg). Duplicados UNIQUE → mensaje contextual por tabla.columna.
const DUP_MSG = {
  'categories.name':     'Ya existe una categoría con ese nombre. Usa otro.',
  'admin_users.email':   'Ya hay un usuario con ese email.',
  'discount_codes.code': 'Ese código de descuento ya está en uso. Prueba con otro.',
  'products.sku':        'Ya existe un producto con ese SKU. Usa una referencia distinta.',
};
export function cleanErrMsg(msg) {
  let s = (msg == null ? '' : String(msg)).trim();
  if (!s) return ERR.GEN_SHORT;
  const uq = s.match(/UNIQUE constraint failed:\s*([a-z0-9_]+\.[a-z0-9_]+)/i);
  if (uq) return DUP_MSG[uq[1].toLowerCase()] || 'Ya existe un registro con ese valor. Revisa los datos e inténtalo de nuevo.';
  // Cualquier otro error interno de base de datos / runtime → genérico (nunca crudo al usuario).
  if (/SQLITE_|no such (table|column)|NOT NULL constraint|datatype mismatch|FOREIGN KEY constraint|CHECK constraint|constraint failed|is not defined|Cannot read propert|is not a function|\bat .+\.js:\d+/i.test(s)) return ERR.GEN;
  if (/^Datos inválidos/i.test(s)) return ERR.VALID;
  // Tokens internos y códigos de permiso filtrados entre paréntesis → fuera (sin tocar el resto).
  s = s.replace(/\s*\((?:confirm_[a-z_]+|cobros\.manage|purchases\.create|D\d)\)/g, '');
  s = s.replace(/\s*\((?:R1[–-]R5|S o I)\)/g, '');
  return s;
}

// ── Página de ERROR maquetada (U3) ────────────────────────────────────────────────
// Reemplaza los `c.text(...)` crudos por una página con el MISMO lenguaje visual que los
// estados vacíos de U2 (icono sobre --accent-soft + frase + acción). Standalone (no depende
// de sesión ni permisos): sirve para 404 de documento, PDF fallido, 500 global y 404 de ruta.
// El icono es SVG inline (sin depender del webfont). `title`/`message`/`action` van escapados.
export function errorShell(title, message, opts = {}) {
  const { action = '', href = '' } = opts;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ico = `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  const cta = (action && href) ? `<a class="e-act" href="${esc(href)}">${esc(action)} →</a>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
    + `<style>${ROOT_TOKENS}
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--text);background:var(--bg);margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
    .e-card{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:2.75rem 2rem;max-width:30rem;width:100%;text-align:center;box-shadow:0 12px 36px rgba(16,24,40,.06)}
    .e-ic{width:46px;height:46px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:inline-flex;align-items:center;justify-content:center;margin-bottom:1rem}
    .e-ti{font-size:1.05rem;font-weight:600;color:var(--text);margin:0 0 .5rem}
    .e-tx{font-size:.9rem;color:var(--text2);line-height:1.5;margin:0}
    .e-act{display:inline-block;margin-top:1.25rem;background:var(--accent);color:#fff;text-decoration:none;padding:.5rem 1rem;border-radius:var(--radius);font-size:.85rem;font-weight:500}</style></head>`
    + `<body><div class="e-card"><span class="e-ic">${ico}</span>`
    + `<h1 class="e-ti">${esc(title)}</h1><p class="e-tx">${esc(message)}</p>${cta}</div></body></html>`;
}

// Atajo: devuelve la respuesta de error maquetada con su código. Uso en rutas:
// return errorPage(c, 404, 'No encontramos esta factura', '…', {action, href}).
export function errorPage(c, status, title, message, opts = {}) {
  return c.html(errorShell(title, message, opts), status);
}
