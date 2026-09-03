#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DE ESCRITURAS DE EXISTENCIAS FUERA DEL LIBRO — que nadie vuelva a poner el número a pelo.
//
// DE DÓNDE SALE (AUD-004, comprobado vivo el 2 sep 2026 y arreglado el 3). `edit_product` de DISA
// hacía esto, tal cual:
//
//     UPDATE products SET name=?, price=?, stock=? WHERE id=?
//
// `products.stock` NO es un dato: es una CACHÉ derivada de `stock_movements`, y escribirla a pelo se
// salta de una vez las seis guardas de `adjustStock` —físico, traza por lote, motivo, almacén, aviso
// de reserva y coste medio— y encima **no sobrevive**: en cuanto el producto tiene un movimiento
// real, `recomputeStock` recalcula desde el libro y borra el número sin avisar.
//
// Y no estaba solo: al mirarlo aparecieron DOS más en el mismo fichero (`create_variant` y
// `edit_variant`). **El mismo fallo suele estar en más de un sitio, y por eso esto es un censo y no
// un parche.**
//
// QUÉ EXIGE: toda escritura de existencias vive en un sitio DECLARADO aquí abajo, con su motivo y su
// recuento EXACTO. Si aparece una nueva → rojo. Si una declarada baja de número → rojo también, por
// declaración rancia: alguien la quitó y no bajó el número, y un puntero caducado manda al siguiente
// al sitio equivocado con toda la confianza del mundo.
//
// SE PRUEBA A SÍ MISMO EN CADA PASADA, antes de mirar el producto. La lección es del propio repo:
// un censo que dice CERO sin ser cierto es peor que no tenerlo, porque cierra la pregunta.
//
//   node scripts/censo-stock-fuera-del-libro.mjs             → veredicto
//   node scripts/censo-stock-fuera-del-libro.mjs --detalle   → cada escritura, con su línea
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { soloCodigo, sinComentariosHtml, sinComentariosDeLinea } from './lib/solo-codigo.mjs';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DETALLE = process.argv.includes('--detalle');

// Una escritura de existencias: un UPDATE que toca la columna `stock` de una de las dos tablas, o un
// INSERT en ellas que la nombra. `stock=stock-?` entra por el mismo patrón.
const RE = /\b(?:UPDATE\s+(products|product_variants)\s+SET\b[^;'"`]*?\bstock\s*=|INSERT\s+INTO\s+(products|product_variants)\s*\([^)]*\bstock\b)/gi;

// ── LOS SITIOS LEGÍTIMOS, CON SU MOTIVO Y SU RECUENTO EXACTO ─────────────────────────────────────
const DECLARADOS = {
  'modules/erp/stock.js': { n: 1, motivo:
    'recomputeStock: EL ÚNICO sitio autorizado. Escribe la caché a partir de la SUMA del libro, nunca de un número que le pasen.' },
  'modules/erp/routes/products.js': { n: 3, motivo:
    'createProductSvc (el alta apunta acto seguido su movimiento de apertura) + alta y edición de VARIANTE, que es campo de Capa 2 y no tiene libro (ver TABLERO §Deuda técnica).' },
  'modules/erp/models.js': { n: 2, motivo:
    'migraciones: la que convirtió products.stock en caché derivada y la de servicios→productos. Históricas y de una sola vez.' },
  'modules/store/routes.js': { n: 2, motivo:
    'tienda pública, CAPA 2 APAGADA (/store responde 404 desde D1). Congelada por CLAUDE.md: no se toca hasta descongelar.' },
};

function limpiar(src) {
  return sinComentariosHtml(soloCodigo(src)).split('\n').map(sinComentariosDeLinea).join('\n');
}

function barrer(dir, hallazgos) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data'].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { barrer(p, hallazgos); continue; }
    if (!f.name.endsWith('.js')) continue;
    const bruto = fs.readFileSync(p, 'utf8');
    const codigo = limpiar(bruto);
    const lineas = bruto.split('\n');
    for (const m of codigo.matchAll(RE)) {
      const linea = codigo.slice(0, m.index).split('\n').length;
      hallazgos.push({ fichero: path.relative(RAIZ, p), linea,
                       tabla: m[1] || m[2], texto: (lineas[linea - 1] || '').trim().slice(0, 110) });
    }
  }
  return hallazgos;
}

// ── LA AUTOPRUEBA. Siempre, antes de mirar el producto ───────────────────────────────────────────
// El SQL va partido para que un `grep` del repo buscando escrituras de stock no cuente los ejemplos
// de esta comprobación como código de producto.
const U = 'UPDATE ', I = 'INSERT INTO ';
const MUESTRAS = [
  { cazar: true,  src: "db.prepare('" + U + "products SET name=?, price=?, stock=? WHERE id=?').run(a,b,c,d);" },
  { cazar: true,  src: "db.prepare('" + U + "product_variants SET stock=? WHERE id=?').run(n, id);" },
  { cazar: true,  src: "db.prepare('" + U + "products SET stock=stock-? WHERE id=?').run(q, id);" },
  { cazar: true,  src: "db.prepare(`" + I + "products (name,slug,stock) VALUES (?,?,?)`).run(a,b,c);" },
  { cazar: false, src: "db.prepare('" + U + "products SET name=?, price=? WHERE id=?').run(a,b,c);" },
  { cazar: false, src: "adjustStock(db, id, { mode: 'set', value: 10, reason: 'error_conteo' });" },
  { cazar: false, src: "// " + U + "products SET stock=?   ← esto es un comentario, no cuenta" },
];

let autofallos = 0;
for (const [i, m] of MUESTRAS.entries()) {
  const cazado = [...limpiar(m.src).matchAll(RE)].length > 0;
  if (cazado !== m.cazar) {
    autofallos++;
    say('  ✗ AUTOPRUEBA ' + (i + 1) + ': se esperaba ' + (m.cazar ? 'CAZARLA' : 'dejarla pasar')
        + ' y salió ' + (cazado ? 'cazada' : 'pasada') + '  →  ' + m.src.slice(0, 88));
  }
}
if (autofallos) {
  say('\n✗ EL CENSO NO SE FÍA DE SÍ MISMO: ' + autofallos + ' de ' + MUESTRAS.length + ' muestras mal juzgadas.');
  say('  No ha mirado el producto. Un censo ciego que dice CERO es peor que no tenerlo.');
  say('RESULTADO: 0 ✓  ·  1 ✗');
  process.exit(1);
}

// ── EL PRODUCTO ──────────────────────────────────────────────────────────────────────────────────
const todos = [];
barrer(path.join(RAIZ, 'modules'), todos);
barrer(path.join(RAIZ, 'core'), todos);

const porFichero = {};
for (const h of todos) (porFichero[h.fichero] ||= []).push(h);

const sinDeclarar = [];
for (const [f, hs] of Object.entries(porFichero)) {
  const d = DECLARADOS[f];
  if (!d || hs.length !== d.n) sinDeclarar.push(...hs);
}
// Declaraciones rancias: prometen más escrituras de las que hay. No dejan hallazgo, así que sin esto
// pasarían inadvertidas — y el censo estaría avalando un sitio que ya no existe.
const rancias = Object.entries(DECLARADOS)
  .map(([f, d]) => ({ fichero: f, declarado: d.n, hay: (porFichero[f] || []).length }))
  .filter(r => r.hay < r.declarado);

say('\nAUTOPRUEBA: ' + MUESTRAS.length + '/' + MUESTRAS.length + ' muestras bien juzgadas '
    + '(4 envenenadas cazadas, 3 buenas respetadas)');
say('ESCRITURAS DE EXISTENCIAS EN modules/ y core/: ' + todos.length
    + '  (no se cuentan las que están en comentarios)\n');
for (const [f, hs] of Object.entries(porFichero).sort((a, b) => b[1].length - a[1].length)) {
  const d = DECLARADOS[f];
  const ok = d && hs.length === d.n;
  say((ok ? '  · ' : '  ✗ ') + String(hs.length).padStart(2) + '  ' + f + (ok ? '   [declarado]' : '   ← SIN DECLARAR'));
  if (ok) say('        ' + d.motivo);
  if (DETALLE || !ok) for (const h of hs) say('        :' + String(h.linea).padEnd(5) + h.tabla + '  ' + h.texto);
}

if (sinDeclarar.length) {
  say('\n✗ ESCRITURAS DE EXISTENCIAS SIN DECLARAR: ' + sinDeclarar.length);
  say('  El stock se mueve por `adjustStock` / `recordMovement`, que dejan su apunte en el libro.');
  say('  `products.stock` es una CACHÉ: quien la escribe a pelo la pierde en el próximo recálculo.');
  say('  Si la escritura es legítima, DECLÁRALA arriba con su motivo — en silencio, no.');
}
if (rancias.length) {
  say('\n✗ DECLARACIONES RANCIAS: ' + rancias.length + '  (declaran más de lo que hay: bájalas o quítalas)');
  for (const r of rancias) say('  · ' + r.fichero + ' — declara ' + r.declarado + ' y quedan ' + r.hay);
}
const fallos = sinDeclarar.length + rancias.length;
say('\nRESULTADO: ' + (fallos ? 0 : 1) + ' ✓  ·  ' + fallos + ' ✗');
process.exit(fallos ? 1 : 0);
