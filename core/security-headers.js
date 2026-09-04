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
// ⚙️ 4 SEP 2026 (csp-unsafe-inline) — TRES SUPERFICIES MÁS, UNA A UNA Y MIGRADAS ANTES.
//   · /portal   — el portal del cliente. NO hizo falta migrar nada: se midió sobre el HTML SERVIDO
//                 y tenía CERO handlers de atributo y CERO bloques de código en línea. Endurecerla
//                 fue gratis, y es la superficie por la que entran personas de fuera.
//   · /acceso   — tenía 2 handlers de atributo y 1 bloque en línea. Se migraron los dos botones a
//                 addEventListener y el bloque lleva nonce. `/acceso/entrar` no tiene código en
//                 línea (comprobado sirviéndolo), así que entra con la misma regla.
//   · /         — la landing. 1 handler (el botón del menú) y 2 bloques en línea. Migrados igual.
//                 La regla es EXACTA (^/$): '/' es prefijo de todo, y un `startsWith` habría
//                 endurecido el ERP entero de golpe — que es justo lo que esta ficha prohíbe.
//
// ANTES DE ENDURECER, LAS TRES PASARON POR EL MODO AVISO (CSP_PROBE=1, abajo): se cargaron en un
// navegador de verdad con la política estricta en Report-Only y se contaron las violaciones que
// registraría. CERO en las tres. El censo se hizo mirando el HTML servido, no el código, y aun así
// se comprobó: en esta ficha el grep ya ha mentido dos veces.
const SUPERFICIES_ESTRICTAS = [
  /^\/superadmin(\/|$)/,
  /^\/registro(\/|$)/,
  /^\/api\/registro(\/|$)/,
  /^\/reservar(\/|$)/,
  /^\/portal(\/|$)/,
  /^\/acceso(\/|$)/,
  /^\/$/,
  // ⚙️ 4 SEP 2026 (csp-erp-migrar-handlers) — LA PRIMERA PANTALLA DEL PANEL.
  // LA REGLA ES EXACTA (^/admin$) Y NO UN PREFIJO. `/^\\/admin/` endurecería las 363 pantallas de
  // golpe, y a casi todas les quedan handlers de atributo: se quedarían con los botones MUDOS sin
  // avisar. Es literalmente lo que esta ficha existe para impedir. Cada pantalla entra aquí sola,
  // y solo cuando su censo da CERO handlers y CERO bloques sin nonce.
  /^\/admin$/,
  // ⚙️ 5 SEP 2026 — 222 PANTALLAS DEL PANEL, tras migrar el widget de DISA (sus 7 handlers y su
  // bloque salían en 233 de ellas). Cada regla va ANCLADA con ^…$ y NUNCA como prefijo: con `$`,
  // `/^\/admin\/quotes$/` cubre la lista y **no** toca `/admin/quotes/9`, que aún tiene handlers
  // propios. Un prefijo se los habría llevado por delante y sus botones se quedarían mudos.
  // Las 212 de mensajes del portal comparten FORMA, no prefijo: el `\d+$` del final es lo que
  // impide que esta regla alcance nada más.
  /^\/admin\/portal\/mensajes\/\d+$/,
  /^\/admin\/albaranes$/,
  /^\/admin\/pedidos$/,
  /^\/admin\/portal$/,
  /^\/admin\/purchase-orders$/,
  /^\/admin\/quotes$/,
  /^\/admin\/rentabilidad$/,
  /^\/admin\/stock-transfers$/,
  /^\/admin\/supplier-returns$/,
  /^\/admin\/verifactu\/envios$/,
  // ⚙️ 5 SEP 2026 (2ª tanda) — ONCE pantallas más: las que solo necesitaban el `nonce` de su bloque
  // y no tenían ni un handler. Todas ancladas, como el resto.
  //
  // ⚙️ 5 SEP 2026, 3ª tanda — `/admin/descuentos` ENTRA. Se quedó fuera del lote anterior porque
  // reportaba 6 violaciones que no venían de su código sino de los DATOS: nombres de producto con
  // `<img onerror=…>` que dejó un gate viejo. Con la limpieza autorizada por Ibrahin (5 sep) esos
  // productos se fueron, y la pantalla da CERO en Report-Only. Se endurece ahora.
  /^\/admin\/analytics$/,
  /^\/admin\/crm\/tareas$/,
  /^\/admin\/fichaje$/,
  /^\/admin\/migracion$/,
  /^\/admin\/migracion\/importar$/,
  // ⚠️ RETIRADAS EL 5 SEP 2026, EL MISMO DÍA QUE SE PUSIERON, Y ES LA LECCIÓN DE LA TANDA:
  //     /^\/admin\/purchases\/\d+$/ y /^\/admin\/supplier-returns\/\d+$/
  // Se endurecieron por FORMA tras ver limpias las pantallas del censo. Pero esas plantillas tienen
  // botones CONDICIONALES —`${estado === 'confirmada' ? '<button onclick=…>' : ''}`— que solo
  // aparecen en cierto estado del documento. El censo muestreó documentos que no los mostraban, así
  // que /admin/purchases/1, /admin/purchases/5 y /admin/supplier-returns/7 quedaron endurecidas CON
  // un handler vivo: su botón de anular estuvo MUERTO, en silencio, justo el fallo que esta ficha
  // existe para impedir.
  //
  // LA REGLA QUE SALE DE AQUÍ: una regla POR FORMA solo vale si TODAS las pantallas de esa forma
  // están limpias EN TODOS SUS ESTADOS. Mientras una plantilla tenga handlers condicionales, sus
  // fichas se endurecen de una en una o no se endurecen.
  /^\/admin\/settings\/avisos$/,
  /^\/admin\/suscripcion$/,
  /^\/admin\/vigia$/,
  /^\/admin\/descuentos$/,
  // ⚙️ 5 SEP 2026, 4ª tanda — LAS FICHAS DE PEDIDO, ALBARÁN Y DEVOLUCIÓN. Estas SÍ se pueden
  // endurecer por forma, y el criterio que lo permite es más fuerte que «las que miré estaban
  // limpias», que fue lo que falló esta misma mañana:
  //
  //   **su plantilla entera (`routes/pedidos.js`, `albaranes.js`, `supplier-returns.js`) tiene CERO
  //   handlers de atributo**, así que NINGÚN estado del documento puede pintar uno.
  //
  // Es comprobable de un vistazo y no depende de qué documentos haya en la base. Hacía falta:
  // los 16 pedidos del negocio de desarrollo están TODOS anulados, así que los botones de borrador
  // y de confirmado no se podían ver navegando ni con la mejor voluntad.
  /^\/admin\/pedidos\/\d+$/,
  /^\/admin\/pedidos\/new$/,
  /^\/admin\/albaranes\/\d+$/,
  /^\/admin\/albaranes\/new$/,
  /^\/admin\/supplier-returns\/\d+$/,
  /^\/admin\/supplier-returns\/new$/,
  // ⚙️ 4 SEP 2026, 5ª tanda — PRESUPUESTO, ORDEN DE COMPRA Y COMPRA DIRECTA, con el mismo criterio:
  // `routes/quotes.js`, `purchase-orders.js` y `purchases.js` tienen CERO handlers de atributo, así
  // que ningún estado del documento puede pintar uno. Aquí entran también las pantallas de ALTA y
  // EDICIÓN, y eso obligó a arreglar algo que el censo no podía ver:
  //
  //   el buscador de línea (`views/line-search.js`) se pinta DESDE JavaScript, así que sus handlers
  //   NO aparecen en el HTML servido. El censo daba `/admin/pedidos/new` y `/admin/albaranes/new`
  //   por limpias, se endurecieron el 5 sep… y su buscador de catálogo llevaba desde entonces MUDO
  //   en producción, sin error visible. Lo cazó el modo aviso en un navegador de verdad, que es el
  //   único que mira el DOM ya montado. Migrado el componente, las dos vuelven a responder.
  /^\/admin\/quotes\/\d+$/,
  /^\/admin\/quotes\/new$/,
  /^\/admin\/quotes\/\d+\/edit$/,
  /^\/admin\/purchase-orders\/\d+$/,
  /^\/admin\/purchase-orders\/new$/,
  /^\/admin\/purchase-orders\/\d+\/edit$/,
  /^\/admin\/purchase-orders\/\d+\/receipts\/new$/,
  /^\/admin\/purchases\/\d+$/,
  /^\/admin\/purchases\/new$/,
  // ⚙️ 4 SEP 2026, 6ª tanda — LA COLA POR TAMAÑO, de menos a más. Cada una migrada entera antes de
  // entrar aquí, y comprobada PULSANDO en el gate, no cargando.
  /^\/admin\/citas\/servicios$/,
  /^\/admin\/mostrador$/,
  /^\/admin\/avisos$/,
  /^\/admin\/crm$/,
  /^\/admin\/crm\/cola$/,
  /^\/admin\/citas$/,
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
