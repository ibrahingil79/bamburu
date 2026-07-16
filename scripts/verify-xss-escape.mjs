// Gate — C4a/M1 (Eje C): el texto que escribe el usuario NUNCA se convierte en HTML ni en JS.
// Dos clases de fallo, dos defensas distintas:
//   A) Concatenación en HTML  → escHtml (core/escape.js y su espejo window.escHtml de layout.js).
//   B) JSON dentro de un <script> inline → jsonForScript: escHtml NO sirve ahí, porque dentro de
//      un <script> el navegador no decodifica entidades HTML; lo que rompe es '</script>'.
//
//   node scripts/verify-xss-escape.mjs
import { escHtml, jsonForScript } from '../core/escape.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

console.log('\n[1] escHtml neutraliza los vectores de HTML');
ok(escHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'la etiqueta se vuelve texto, no elemento');
ok(!escHtml('<script>alert(1)</script>').includes('<'), 'no sobrevive ningún "<" sin escapar');
ok(escHtml('" onmouseover="alert(1)') === '&quot; onmouseover=&quot;alert(1)', 'comilla doble escapada → no se sale de un atributo');
ok(escHtml("' onmouseover='alert(1)") === '&#39; onmouseover=&#39;alert(1)', 'comilla simple escapada → no se sale de un atributo');
ok(escHtml(null) === '' && escHtml(undefined) === '', 'null/undefined → cadena vacía (no "null" ni excepción)');
ok(escHtml(0) === '0', 'el 0 se conserva (no se lo come un falsy)');

console.log('\n[2] jsonForScript corta la ruptura de <script> (el fallo de purchases.js:244)');
// El ataque real: un producto que se llama así cerraba la etiqueta y el resto se parseaba como HTML.
const payload = { name: '</script><img src=x onerror=alert(1)>' };
const salida = jsonForScript(payload);
ok(!salida.includes('</script>'), 'la salida NO contiene "</script>" literal → la etiqueta no se cierra antes de tiempo');
ok(!salida.includes('<'), 'no sobrevive ningún "<" crudo en la salida');
ok(salida.includes('\\u003c'), 'el "<" viaja escapado como \\u003c');

console.log('\n[3] …y sigue siendo JSON válido: el dato llega intacto al navegador');
// Esto es lo que impide que el arreglo rompa la pantalla: el escape es transparente al parsear.
ok(JSON.parse(salida).name === payload.name, 'JSON.parse devuelve EXACTAMENTE el nombre original');
const productos = [{ id: 1, name: 'Tornillo M8 <acero>', sku: 'T-8' }, { id: 2, name: 'Cable & clavija "premium"', sku: 'C-2' }];
ok(JSON.parse(jsonForScript(productos)).every((p, i) => p.name === productos[i].name && p.id === productos[i].id),
   'una lista de productos con <, & y comillas se reconstruye idéntica');
ok(jsonForScript(null) === 'null' && jsonForScript([]) === '[]', 'null y lista vacía → JSON válido (no rompe la página)');

console.log('\n[4] Las dos defensas NO son intercambiables (por qué hacen falta las dos)');
// Si alguien "arregla" un <script> con escHtml, el XSS sigue vivo: dentro de un <script> el
// navegador NO decodifica &lt; — el texto llega crudo al motor de JS.
ok(escHtml('</script>').includes('&lt;') && !escHtml('</script>').includes('<'),
   'escHtml sí escapa "<" … pero en contexto HTML, donde la entidad se decodifica al mostrarla');
ok(jsonForScript('</script>') !== JSON.stringify('</script>'),
   'jsonForScript se aparta de JSON.stringify justo en el carácter que rompe la etiqueta');

// ── [5] C4a-bis · Guardián de los sinks de Clase B ────────────────────────────────────────────
// POR QUÉ ESTA PARTE ES ESTÁTICA Y NO DE NAVEGADOR. Cada uno de estos sinks vive en una pantalla que
// exige un DOCUMENTO montado (un albarán nace de un pedido confirmado; PRELOAD, de un presupuesto ya
// guardado; ORIGINS, de una compra recibida). Montar esos fixtures cuesta más que el arreglo y mete
// escrituras de documentos —algunas con valor legal— en un gate de seguridad. Lo que SÍ se puede
// afirmar sin ambigüedad es la regla: si el dato lo escribe el usuario y aterriza en un <script>,
// se serializa con jsonForScript. Un JSON.stringify crudo aquí es el fallo, y esto lo caza.
// Los sinks que SÍ son alcanzables se prueban de verdad en gate-xss-escape.mjs.
import { readFileSync } from 'fs';

console.log('\n[5] Ningún sink de Clase B con datos del usuario usa JSON.stringify crudo');
const SINKS_B = [
  ['modules/erp/routes/albaranes.js',       'linesJson',   'líneas del pedido: description + sku'],
  ['modules/erp/routes/purchase-orders.js', 'catalog',     'catálogo: name + sku'],
  ['modules/erp/routes/purchase-orders.js', 'SEED',        'borrador: notes + líneas'],
  ['modules/erp/routes/stock-transfers.js', 'catalog',     'catálogo: name + sku'],
  ['modules/erp/routes/supplier-returns.js','ORIGINS',     'orígenes: supplier_name + label'],
  ['modules/erp/routes/quotes.js',          'PRELOAD',     'líneas del presupuesto: description'],
  ['modules/erp/routes/pedidos.js',         'PRELOAD',     'líneas del pedido: description'],
  ['modules/erp/routes/invoices.js',        'SEED_LINES',  'líneas de la factura: description'],
  ['modules/erp/routes/orders.js',          'PRODUCTS',    'catálogo (ruta hoy desmontada, red por si vuelve)'],
  ['modules/erp/routes/purchases.js',       'productsJson','catálogo: name + sku (C4a)'],
  ['modules/erp/routes/inventory.js',       'WAREHOUSES',  'almacenes: name (C4a)'],
  ['modules/erp/views/stock-modal.js',      'WAREHOUSES',  'almacenes: name (C4a)'],
];
for (const [fichero, sink, que] of SINKS_B) {
  const src = readFileSync(fichero, 'utf8');
  // La línea que SERIALIZA el sink. Se exige que además de declararlo lleve un serializador: varios
  // ficheros tienen DOS `const catalog` —la consulta SQL del servidor y el sink del navegador— y sin
  // este filtro el guardián señalaría la consulta, que no serializa nada. (Falso positivo real, visto
  // en stock-transfers.js:309 vs :349.)
  const decl = new RegExp('(const|var|let)\\s+' + sink + '\\s*=|[,\\s]' + sink + '\\s*=');
  const defs = src.split('\n').filter(l => decl.test(l) && /(jsonForScript|JSON\.stringify)/.test(l));
  ok(defs.length >= 1, fichero.split('/').pop() + ' · ' + sink + ' — se encuentra dónde se serializa');
  if (defs.length) {
    ok(defs.every(l => /jsonForScript/.test(l) && !/JSON\.stringify/.test(l)),
       '  …usa jsonForScript y NO JSON.stringify crudo (' + que + ')');
  }
}

console.log('\n[6] La pieza central está importada allí donde se usa (un jsonForScript sin importar es un 500)');
for (const fichero of [...new Set(SINKS_B.map(s => s[0]))]) {
  const src = readFileSync(fichero, 'utf8');
  if (/jsonForScript\(/.test(src)) {
    ok(/import \{[^}]*jsonForScript[^}]*\} from '[^']*core\/escape\.js'/.test(src),
       fichero.split('/').pop() + ' — importa jsonForScript de core/escape.js');
  }
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Escapado XSS (M1): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
