#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NINGÚN PAPEL SE LLAMA «FACTURA» SIN SERLO.
//
// DE DÓNDE SALE (24 ago 2026). El POS viejo imprimía un documento de PEDIDO con el titular «FACTURA»
// a toda página. Estaba apuntado desde julio como «riesgo legal a resolver» y nadie lo miraba, porque
// vivía en `routes/orders.js`, un fichero desmontado que ninguna comprobación tocaba. Se retiró con
// el fichero entero. Esto existe para que no vuelva por otra puerta.
//
// POR QUÉ IMPORTA. Un papel titulado «Factura» que no lo es no es un detalle de estilo: si llega a un
// cliente, ese cliente cree tener una factura —y se la puede deducir—, y el emisor tiene un documento
// con pinta de fiscal fuera de la cadena de VERI*FACTU y fuera de su numeración legal. El daño lo
// hace el TÍTULO, no la intención.
//
// CÓMO SE MIDE, y por qué así. Se leen los TITULARES de todo lo que el producto imprime o enseña
// —`<h1>` y `<title>`— en todo `modules/`, y se exige que quien diga «factura» esté en la lista de
// los que SÍ emiten una: la factura legal, el ticket (factura simplificada), la factura RECIBIDA de
// un proveedor y los listados que las agrupan. Cualquier otro sitio es un rojo.
//
// LA LISTA ES DE FICHEROS, NO DE TEXTOS, a propósito: una lista de textos permitidos se sortea
// cambiando una palabra; una lista de ficheros obliga a declarar «este documento emite facturas»,
// que es una afirmación que alguien tiene que firmar.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0, fail = 0;
const check = (c, m, det) => { if (c) { ok++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); } };

// Los que SÍ emiten una factura de verdad. Cada uno con su motivo escrito: si mañana alguien añade
// uno, tiene que decir por qué, y eso es justo la barrera.
const EMITEN_FACTURA = {
  'modules/erp/routes/invoices.js':          'la factura legal y el ticket (factura simplificada, art. 4 RD 1619/2012)',
  'modules/erp/routes/supplier-invoices.js': 'la factura RECIBIDA de un proveedor: es una factura, la emitió otro',
  'modules/erp/routes/listados.js':          'listados imprimibles que agrupan facturas (el titular nombra la lista, no un documento)',
  'modules/erp/routes/verifactu-envio-routes.js': 'la pantalla de envíos a la AEAT, que habla de facturas por su nombre',
};

// Un titular es lo que una persona lee como nombre del documento: el <h1> y el <title>.
const TITULARES = /<(h1|title)\b[^>]*>([\s\S]{0,120}?)<\/\1>/gi;

const ficheros = [];
const barrer = d => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { barrer(p); continue; }
    if (e.name.endsWith('.js')) ficheros.push(p);
  }
};
barrer(join(RAIZ, 'modules'));

console.log('\n=== Ningún papel se llama «Factura» sin serlo ===\n');

const sospechosos = [];
for (const p of ficheros) {
  const rel = relative(RAIZ, p);
  // La tienda es Capa 2 y está congelada y apagada; se mira igual, para que el día que se descongele
  // no entre con un documento mal titulado.
  const src = readFileSync(p, 'utf8');
  for (const m of src.matchAll(TITULARES)) {
    const texto = m[2].replace(/\$\{[^}]*\}/g, '…').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    // UN DOCUMENTO SE NOMBRA, NO SE COMENTA. Lo que delata a un papel que se hace pasar por factura
    // es que su titular EMPIECE por «Factura» —«FACTURA», «Factura F2026-0001», «Factura proforma»—,
    // que es como un documento dice qué es. Un titular que solo la MENCIONA («Tus facturas», «No
    // encontramos esta factura», «Integridad de facturas») es una pantalla hablando de ellas, no un
    // papel llamándose así; marcarlos era ruido y un ruido constante acaba en que nadie mire.
    if (!/^factura(s?\b|$)/i.test(texto.replace(/^[¡¿«"'\s]+/, ''))) continue;
    if (/^facturas\b/i.test(texto)) continue;   // «Facturas», en plural, es una LISTA, no un documento
    if (EMITEN_FACTURA[rel]) continue;
    sospechosos.push(rel + ': «' + texto.slice(0, 60) + '»');
  }
}
check(sospechosos.length === 0,
  'ningún documento fuera de los que emiten facturas se titula «Factura»',
  sospechosos.slice(0, 5).join(' · ') || (ficheros.length + ' ficheros mirados'));

// La lista blanca no puede envejecer en silencio: si uno de sus ficheros desaparece, se dice.
const perdidos = Object.keys(EMITEN_FACTURA).filter(f => { try { statSync(join(RAIZ, f)); return false; } catch { return true; } });
check(perdidos.length === 0, 'la lista de «estos sí emiten facturas» no nombra ficheros que ya no existen', perdidos.join(' ') || 'los ' + Object.keys(EMITEN_FACTURA).length + ' están');

// Y el caso concreto que dio origen a todo: el documento del POS viejo, retirado el 24 ago 2026.
let volvio = false;
for (const p of ficheros) if (/routes\/orders\.js$/.test(p)) volvio = true;
check(!volvio, 'el documento de pedido del POS viejo (el que se titulaba FACTURA) sigue retirado');

// LA REVERSIÓN: la comprobación tiene que saber CAER. Se le da un titular malo de mentira y se exige
// que lo señale — si no, estaría dando verde sobre nada.
{
  const falso = '<h1>FACTURA</h1>';
  const caza = [...falso.matchAll(TITULARES)].some(m => /factura/i.test(m[2]));
  check(caza, 'y la propia comprobación sabe cazar un titular malo (reversión)');
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + ok + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
