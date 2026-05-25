/**
 * Escapa caracteres especiales HTML. Usar en CUALQUIER interpolación de datos
 * que vengan de la BD, request, o cualquier fuente no controlada.
 * Válido también dentro de atributos HTML (escapa ' y ").
 */
export function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Como escHtml pero preserva los saltos de línea convirtiéndolos en <br>.
 * Usar para descripciones de producto, comentarios largos, etc.
 */
export function escHtmlMultiline(s) {
  return escHtml(s).replace(/\r?\n/g, '<br>');
}

/**
 * Valida y normaliza una URL para uso en href/src.
 * Rechaza javascript:, data:, vbscript:, file:. Devuelve '' si no es segura.
 * Acepta: http://, https://, mailto:, tel:, rutas relativas (/foo) y anchors (#foo).
 */
export function safeUrl(s) {
  if (!s) return '';
  const url = String(s).trim();
  if (url.startsWith('/') || url.startsWith('#')) return escHtml(url);
  const lower = url.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') ||
      lower.startsWith('mailto:') || lower.startsWith('tel:')) {
    return escHtml(url);
  }
  return '';
}
