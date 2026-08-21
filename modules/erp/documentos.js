// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL MEMBRETE DE LOS DOCUMENTOS — la casa única de «de quién es este papel y cómo se pinta»
// ════════════════════════════════════════════════════════════════════════════════════════════════
// POR QUÉ NACE ESTE FICHERO. El Paso 0 de la tarea C midió tres cosas que no se ven desde ninguna
// pantalla y que habrían salido caras al construir el motor de listados encima:
//
//   1. `docParties` —la regla de negocio de CUÁNDO manda la foto congelada del documento y cuándo la
//      configuración EN VIVO— estaba definida CUATRO veces (presupuesto, pedido, albarán y orden de
//      compra). Las tres de venta eran idénticas carácter por carácter: 14 líneas, tres copias.
//   2. Y ni siquiera eran cuatro caminos, sino un TERCERO por su cuenta: la factura y el ticket no
//      llamaban a ninguna de las cuatro — leían `inv.company_name` a pelo, porque la factura guarda
//      su propia foto. O sea que la misma regla vivía escrita de tres formas distintas.
//   3. Para pintar EXACTAMENTE lo mismo había DOS dialectos: la factura usaba las clases `.doc-*` de
//      `layout.js` y los otros tres repetían el mismo HTML con los estilos a mano en cada etiqueta.
//
// LA REGLA VIVE AQUÍ Y SOLO AQUÍ. `partesDe()` es la única función del proyecto que decide
// congelado-vs-vivo. La contraparte cambia (un cliente en una venta, un proveedor en una compra) y
// eso NO es una excepción a la regla: es un parámetro. La regla es la misma para los seis papeles.
//
// LO QUE NO UNIFORMA: el CONTENIDO. Cada papel pinta los campos que pintaba —el albarán no enseña el
// email del cliente, la orden de compra sí enseña los teléfonos— porque eso son decisiones del
// documento, no del membrete. Aquí se unifica cómo se ve, no qué dice.
import { getAttachment, readAttachmentBuffer } from './attachments.js';
import { escHtml } from '../../core/escape.js';

// El adjunto del logo lleva marca propia. La ruta que lo sirve SOLO acepta este kind: así no se
// puede usar como puerta trasera a los adjuntos de facturas de proveedor (misma defensa que la foto
// de perfil, `user_photo`).
export const LOGO_KIND = 'company_logo';

// Solo imágenes, y de las que un navegador y Chromium pintan sin discutir. Fuera el PDF (que
// `attachments.js` sí admite para facturas de proveedor) y fuera el SVG: un SVG es un documento con
// scripts dentro, y esto se incrusta en un papel que se manda por correo.
export const LOGO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// DOS MEGAS. No es un número redondo por gusto: el logo se incrusta en base64 dentro del PDF, y
// base64 engorda un tercio. Con 2 MB el papel más pesado sigue siendo mandable por correo.
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

// ── QUÉ ES DE VERDAD ESTE FICHERO ────────────────────────────────────────────────────────────────
// La extensión no dice nada: un `.exe` renombrado a `.png` sigue siendo un `.exe`, y el navegador
// manda el `type` que le da la gana. Así que se mira lo ÚNICO que no se puede renombrar: los
// primeros bytes. Si no coinciden con una imagen de verdad, no entra.
export function mimeReal(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ── EL LOGO, INCRUSTADO ──────────────────────────────────────────────────────────────────────────
// SE INCRUSTA, NO SE ENLAZA, y esto es lo que decide todo lo demás. El PDF lo genera Chromium EN EL
// SERVIDOR: si el papel llevara un `<img src="https://…">`, cada PDF haría una petición saliente al
// host que dijera quien editó ese campo —eso es un SSRF de manual— y además ataría tus facturas a
// que un servidor de terceros siga vivo dentro de cinco años. Un documento fiscal no puede depender
// de eso. Con un `data:` no sale ni un paquete de la máquina.
export function logoDataUri(db, attId) {
  if (!attId) return null;
  try {
    const att = getAttachment(db, Number(attId));
    if (!att || att.kind !== LOGO_KIND) return null;      // falla cerrado: kind ajeno → sin logo
    const buf = readAttachmentBuffer(att);
    if (!buf || !buf.length) return null;
    const mime = mimeReal(buf) || att.mime;
    if (!LOGO_MIME.has(mime)) return null;
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch { return null; }                                 // un logo que no se puede leer no rompe una factura
}

// El `<img>` del membrete, o nada. SIN LOGO NO SE PINTA NADA: ni un hueco reservado ni un icono
// roto — un negocio que no ha subido logo tiene que ver un papel limpio, no un papel incompleto.
// El tamaño va ACOTADO EN MILÍMETROS y no en píxeles porque el destino es una hoja A4: un PNG de
// 4000 px de ancho se pinta a 40 mm igual que uno de 200, y no puede empujar el documento a una
// segunda página. `object-fit:contain` conserva la proporción; sin él, un logo apaisado saldría
// aplastado.
export function logoImgHtml(dataUri) {
  if (!dataUri) return '';
  // `data-membrete="logo"` NO es decoración: el QR de Veri*Factu también es un `data:image/png`, así
  // que buscar «hay un data URI» confunde el logo con el QR — le pasó al gate en su primera pasada.
  // Con marca propia, la comprobación dice lo que cree decir.
  return '<img data-membrete="logo" src="' + dataUri + '" alt="" style="max-width:40mm;max-height:18mm;'
       + 'width:auto;height:auto;object-fit:contain;display:block;margin-bottom:10px">';
}

// ── LA REGLA: ¿FOTO CONGELADA O CONFIGURACIÓN EN VIVO? ───────────────────────────────────────────
// LA ÚNICA DEFINICIÓN DEL PROYECTO. Si el documento trae `company_name`, es que se congeló al
// emitirlo y manda la foto: una factura de marzo tiene que seguir enseñando la dirección de marzo,
// aunque el negocio se haya mudado. Si no la trae, es un borrador y se lee lo de hoy.
//
// EL LOGO SIGUE LA MISMA REGLA, y por eso viaja aquí y no aparte: cambiar hoy el logo NO reescribe
// una factura de marzo. Los documentos anteriores a esta tarea no tienen `company_logo_id`, así que
// salen sin logo — que es exactamente lo que eran cuando se emitieron.
//
// `contraparte` no es una excepción a la regla: es un parámetro. En una venta es el cliente; en una
// orden de compra, el proveedor —que la emites TÚ al proveedor, así que el emisor sigue siendo tu
// negocio—. Lo único que cambia de verdad es de qué tabla sale la otra parte y que un proveedor
// guarda la ciudad en su propia columna.
export function partesDe(db, doc, contraparte = 'cliente') {
  const esProveedor = contraparte === 'proveedor';
  const cfg = () => db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};

  if (doc && doc.company_name != null) {
    const otra = esProveedor
      ? { name: doc.supplier_name, fiscal_id: doc.supplier_fiscal_id, address: doc.supplier_address,
          email: doc.supplier_email || '', phone: doc.supplier_phone || '' }
      : { name: doc.client_name, fiscal_id: doc.client_fiscal_id, address: doc.client_address,
          email: doc.client_email, phone: doc.client_phone || '' };
    return {
      emisor: {
        name: doc.company_name, fiscal_id: doc.company_fiscal_id, address: doc.company_address,
        phone: doc.company_phone, email: doc.company_email,
        logo: logoDataUri(db, doc.company_logo_id),
      },
      [contraparte]: otra,
    };
  }

  const c = cfg();
  const otra = esProveedor
    ? (() => {
        const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(doc?.supplier_id) || {};
        return { name: s.name || '', fiscal_id: s.fiscal_id || '',
                 address: [s.address, s.city].filter(Boolean).join(', '),
                 email: s.email || '', phone: s.phone || '' };
      })()
    : (() => {
        const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(doc?.client_id) || {};
        return { name: cl.name || '', fiscal_id: cl.fiscal_id || '', address: cl.address || '',
                 email: cl.email || '', phone: cl.phone || '' };
      })();
  return {
    emisor: {
      name: c.company_name || '', fiscal_id: c.fiscal_id || '', address: c.address || '',
      phone: c.phone || '', email: c.email || '',
      logo: logoDataUri(db, c.company_logo_id),
    },
    [contraparte]: otra,
  };
}

// El id del logo que hay que CONGELAR al emitir un documento. Se llama al crear, no al pintar.
export function logoIdVigente(db) {
  try { return db.prepare('SELECT company_logo_id FROM company_config WHERE id=1').get()?.company_logo_id || null; }
  catch { return null; }
}

// ── EL MEMBRETE, EN UN SOLO DIALECTO ─────────────────────────────────────────────────────────────
// Las clases `.doc-*` de `layout.js`, que es el dialecto que la factura ya usaba y que
// `printableShell` ya lleva al PDF. No nace uno nuevo: se usa el que hay.
//
// `campos` dice QUÉ pinta cada lado, porque eso sí es de cada documento: el albarán no enseña el
// email del cliente y la orden de compra sí enseña los teléfonos. Unificar el estilo no uniforma el
// contenido.
const LINEA = { fiscal_id: v => v, address: v => v, email: v => v, phone: v => v };

function ladoHtml(rotulo, datos, campos, delante = '') {
  // OJO CON EL SITIO DEL LOGO: `.doc-cols` es una rejilla de DOS columnas, así que el `<img>` tiene
  // que ir DENTRO del bloque del emisor. Colgándolo como hermano ocuparía una celda él solo y
  // empujaría la contraparte a una tercera columna que no existe.
  if (!datos) return '<div>' + delante + '</div>';
  const extras = (campos || ['fiscal_id', 'address'])
    .filter(k => LINEA[k] && datos[k])
    .map(k => (k === 'fiscal_id')
      ? '<div>' + escHtml(datos[k]) + '</div>'
      : '<div style="color:var(--text2)">' + escHtml(datos[k]) + '</div>')
    .join('');
  return '<div>'
    + delante
    + '<div class="doc-label">' + escHtml(rotulo) + '</div>'
    + '<div><strong>' + escHtml(datos.name || '') + '</strong></div>'
    + extras
    + '</div>';
}

// El bloque de dos columnas: emisor a la izquierda (con su logo encima) y la contraparte a la
// derecha. Si no hay contraparte —el ticket de mostrador, que es una factura simplificada sin
// destinatario— la columna se queda vacía, igual que estaba.
export function membreteHtml({ emisor, otra = null, rotuloOtra = 'Cliente',
                               camposEmisor = ['fiscal_id', 'address'],
                               camposOtra = ['fiscal_id', 'address'] }) {
  const izq = ladoHtml('Emisor', emisor, camposEmisor, logoImgHtml(emisor && emisor.logo));
  return '<div class="doc-cols">' + izq + ladoHtml(rotuloOtra, otra, camposOtra) + '</div>';
}
