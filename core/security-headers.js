export function securityHeaders() {
  return async (c, next) => {
    await next();

    // Comunes a todas las respuestas
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    // HSTS solo si estamos sirviendo HTTPS (en producción detrás de proxy)
    const proto = c.req.header('x-forwarded-proto');
    if (proto === 'https') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // CSP: política estricta
    // Permitimos:
    //   - self para todo (scripts, estilos, imágenes, fuentes, conexiones)
    //   - inline styles (las páginas usan style="..." inline)
    //   - inline scripts del propio servidor (las páginas tienen <script> inline)
    //   - data: para imágenes (favicons, logos pequeños embebidos)
    //   - blob: para imágenes (previews antes de subir)
    //   - https: para imágenes (productos pueden tener URL externa)
    //
    // NOTAS:
    // - 'unsafe-inline' en script-src es necesario porque las páginas tienen
    //   <script> con window.CSRF_TOKEN inyectado y otros handlers inline.
    //   Si más adelante movemos todo el JS a archivos externos, podemos quitarlo.
    // - 'unsafe-inline' en style-src es necesario por el uso de style="..." inline.

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "form-action 'self' https://*.bamburu.com",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ');

    c.header('Content-Security-Policy', csp);
  };
}
