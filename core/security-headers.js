import { randomBytes } from 'crypto';

// ── C4b · Superficies con CSP ESTRICTA (script-src SIN 'unsafe-inline', con nonce) ──────────────
//
// POR QUÉ SE ENDURECE POR SUPERFICIE Y NO DE GOLPE. La CSP es una cabecera POR RESPUESTA, y en cuanto
// una respuesta lleva un nonce en script-src el navegador IGNORA 'unsafe-inline' EN ESA RESPUESTA.
// Es todo-o-nada por página: no se puede "ir soltando" el unsafe-inline dentro de una misma pantalla.
// Como el 90% de los handlers de atributo (470 de 522) están en el ERP y las superficies que más
// duelen son diminutas —registro (2 handlers, pública y anónima) y superadmin (11, la cuenta que ve
// todos los negocios)—, se endurecen esas y el ERP se queda con la política de siempre hasta que se
// decida (C4b-4). Meter aquí una ruta cuyo HTML aún tenga onclick="..." = botones muertos EN SILENCIO.
// PIEZA 6 (28 jul 2026) — /reservar entra aquí desde el primer día. Es el mismo perfil que /registro:
// superficie PÚBLICA y ANÓNIMA, escrita entera de cero, con UN solo <script> con nonce y CERO
// handlers de atributo. Endurecerla ahora es gratis; hacerlo después de que crezca, no.
const SUPERFICIES_ESTRICTAS = [
  /^\/superadmin(\/|$)/,
  /^\/registro(\/|$)/,
  /^\/api\/registro(\/|$)/,
  /^\/reservar(\/|$)/,
];

export function securityHeaders() {
  return async (c, next) => {
    // El nonce se genera ANTES de la ruta para que la plantilla pueda leerlo con c.get('cspNonce')
    // y marcar sus <script>. Uno nuevo por petición: un nonce reutilizable no vale para nada.
    const nonce = randomBytes(16).toString('base64');
    c.set('cspNonce', nonce);

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
    // - 'unsafe-inline' en script-src sigue aquí porque las páginas tienen <script> inline y ~522
    //   handlers de atributo (onclick="..."). Se quita por SUPERFICIE en C4b-1, no de golpe: en cuanto
    //   una respuesta lleva un nonce, el navegador IGNORA 'unsafe-inline' en ESA respuesta.
    // - 'unsafe-inline' en style-src se queda A PROPÓSITO: son 2027 style="..." y el valor es muy
    //   inferior (inyección de estilo, no ejecución de código). Decidido en el plan de C4b.
    // - C4b-2 (16 jul 2026): FUERA cdn.jsdelivr.net. Las 4 librerías que venían de ahí (gsap +
    //   ScrollTrigger en la landing, Chart.js en Analítica, Sortable en Ajustes) se cargaban SIN
    //   integrity=, así que la CSP confiaba en ese CDN a ciegas: comprometerlo = JS arbitrario en el
    //   panel y en la landing pública. Ahora se sirven desde 'self' (public/vendor/), con la versión
    //   CONGELADA en el repo — chart.js iba por "@4", que flotaba a la última 4.x sola.
    // - fonts.googleapis/gstatic SÍ siguen: los usan la tienda, la landing y public/bamburu.css.

    const estricta = SUPERFICIES_ESTRICTAS.some(re => re.test(c.req.path));

    const politica = (scriptSrc) => [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "form-action 'self' https://*.bamburu.com",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ');

    const ESTRICTA = `script-src 'self' 'nonce-${nonce}'`;
    const LEGADO = "script-src 'self' 'unsafe-inline'";

    c.header('Content-Security-Policy', politica(estricta ? ESTRICTA : LEGADO));

    // INSTRUMENTO DE MEDIDA (C4b-0), apagado por defecto. Con CSP_PROBE=1 las superficies que aún NO
    // están endurecidas reciben ADEMÁS la política estricta en modo Report-Only: el navegador NO
    // bloquea nada, solo APUNTA lo que bloquearía. Sirve para inventariar el ERP de verdad antes de
    // decidir C4b-4 — porque el grep ya ha mentido dos veces (los "58" que eran 43; 12 puntos en
    // código muerto). Report-Only no puede romper nada: no bloquea, informa.
    if (process.env.CSP_PROBE === '1' && !estricta) {
      c.header('Content-Security-Policy-Report-Only', politica(ESTRICTA));
    }
  };
}
