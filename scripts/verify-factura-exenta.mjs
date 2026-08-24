#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// UNA FACTURA SIN IVA TIENE QUE DECIR POR QUÉ LO ESTÁ.
//
// El RD 1619/2012 (art. 6.1.j) obliga a **mencionar la disposición que declara la exención**. Sin esa
// línea la factura está incompleta, y quien la recibe no sabe si es una exención legal o un IVA que
// se olvidó de poner.
//
// DE DÓNDE SALE (24 ago 2026, corrección de Ibrahin sobre el oficio de salud): la exención sanitaria
// del art. 20.Uno.3.º LIVA pide DOS cosas a la vez —profesional sanitario titulado Y finalidad
// terapéutica—. El MISMO fisioterapeuta factura sin IVA una rehabilitación y al 21 % un masaje
// relajante. Por eso la leyenda NO se pinta por ser una clínica: se pinta **solo si esta factura
// lleva de verdad alguna línea exenta**.
//
// POR QUÉ NO SE EMITE UNA FACTURA DE PRUEBA. Emitir entra en la cadena de VERI*FACTU y **ya no se
// puede borrar**: es la lección que costó 154 facturas de gate imborrables en agosto. Aquí se mide
// la pieza que decide la leyenda —con las dos respuestas, la que la pone y la que NO— y se afirma
// que la factura impresa la LLAMA. Lo que no se puede probar sin ensuciar, se dice.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { leyendaExencion } from '../modules/erp/routes/invoices.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0, fail = 0;
const check = (c, m, det) => { if (c) { ok++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); } };

console.log('\n=== Una factura sin IVA dice por qué lo está ===\n');

const LEY = /art\. 20\.Uno\.3\.º de la Ley 37\/1992/;

// (1) CON línea exenta → la leyenda sale, y nombra la ley.
const conExenta = leyendaExencion([{ tax_rate: 0, total_price: 60 }], { tax_rate: 0 });
check(LEY.test(conExenta), 'una factura con línea exenta imprime el artículo que la exime', conExenta.replace(/<[^>]+>/g, '').trim().slice(0, 80));

// (2) SIN línea exenta → NO sale. Es la mitad que de verdad protege: una leyenda de exención en una
//     factura con IVA es una afirmación falsa sobre un documento fiscal.
const conIva = leyendaExencion([{ tax_rate: 21, total_price: 100 }], { tax_rate: 21 });
check(conIva === '', 'una factura con IVA NO la imprime (no se afirma una exención que no existe)', JSON.stringify(conIva));

// (3) MIXTA: si una sola línea va exenta, la mención tiene que estar.
const mixta = leyendaExencion([{ tax_rate: 21, total_price: 100 }, { tax_rate: 0, total_price: 60 }], { tax_rate: 21 });
check(LEY.test(mixta), 'una factura MIXTA (una línea exenta y otra con IVA) también la imprime');

// (4) Sin líneas, cayendo al tipo de la cabecera: los dos casos.
check(LEY.test(leyendaExencion([], { tax_rate: 0 })), 'sin líneas y con tipo 0 en la cabecera, la imprime');
check(leyendaExencion([], { tax_rate: 21 }) === '', 'sin líneas y con tipo 21, no');

// (5) Y EL PAPEL LA LLAMA. Sin esto lo de arriba sería una función correcta que nadie usa.
const src = readFileSync(join(RAIZ, 'modules', 'erp', 'routes', 'invoices.js'), 'utf8');
const iRender = src.indexOf('<div class="doc-hash">');
check(iRender > 0 && src.slice(0, iRender).includes('${leyendaExencion(items, inv)}'),
  'la factura impresa la llama, justo antes del bloque de la huella');

// (6) Y LA FRONTERA, EXPLICADA DONDE SE DECIDE. Al crear un servicio nuevo en el oficio de salud, el
// dueño elige la banda: la pantalla tiene que decirle en una frase dónde está la raya. Solo en salud
// —en un taller sobraría— y nombrando los dos lados, que es lo que la hace útil.
{
  const citas = readFileSync(join(RAIZ, 'modules', 'erp', 'routes', 'citas.js'), 'utf8');
  const iSel = citas.indexOf("id=\"nsIva\"");
  const trozo = iSel > 0 ? citas.slice(iSel, iSel + 900) : '';
  check(/esSalud \?/.test(trozo), 'la ayuda del IVA solo sale en el oficio de salud');
  check(/exento/i.test(trozo) && /21 ?%/.test(trozo) && /sanitario titulado/i.test(trozo),
    '  y explica los DOS lados de la raya: qué va exento y qué va al 21 %');
  check(/relajante|estétic|pilates|aseguradora/i.test(trozo),
    '  con los casos que de verdad se confunden (masaje, estética, pilates, informe)');
}

// (7) REVERSIÓN: la comprobación tiene que saber caer si la ley dejara de nombrarse.
check(!LEY.test('<div>Operación exenta de IVA</div>'),
  'y sabe distinguir una leyenda que NOMBRA la ley de una que solo dice «exenta» (reversión)');

console.log('\n  ⚠️ LO QUE ESTO NO PRUEBA, dicho a propósito: no se emite una factura exenta de verdad');
console.log('     para verla impresa. Emitir entra en la cadena de VERI*FACTU y ya no se puede borrar.');
console.log('     Cuando exista una factura exenta real en un negocio, se mira el papel.');
console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + ok + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
