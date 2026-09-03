#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DE CONSULTAS DE DISA SIN TOPE NI RELOJ — que no vuelva a colarse un camino sin límites.
//
// DE DÓNDE SALE (AUD-005). `query_database` ejecutaba el SQL que escribía el modelo con
// `db.prepare(sql).all()`: **sin tope de filas y sin plazo**. El tope se le PEDÍA al modelo en la
// descripción de la herramienta —«Usa LIMIT 20 como maximo»—, que es un ruego, no un cerrojo.
// Medido el 3 sep 2026: `SELECT * FROM invoices` del negocio grande son 928 filas y **1.098 KB de
// JSON viajando al proveedor de IA**, con nombres, NIF e importes de los clientes del cliente.
//
// QUÉ EXIGE, y es una regla, no una lista de casos: **dentro de `modules/disa/` nadie ejecuta SQL
// contra la base salvo por `consultarConLimites`**, que es quien impone el tope y mata el hilo al
// vencer el plazo. Cualquier `db.prepare(...).all()/.get()/.iterate()` que aparezca ahí y no esté
// DECLARADO abajo con su motivo sale en ROJO.
//
// Y exige además que los límites sigan viviendo en UN SOLO SITIO (`limites-consulta.js`): si alguien
// escribe el número a mano en otro fichero, también es rojo. Es la lección de la llave del cobro —
// una regla repartida vuelve en cuanto alguien la olvida.
//
// SE PRUEBA A SÍ MISMO en cada pasada, antes de mirar el producto: un censo que dice CERO sin ser
// cierto es peor que no tenerlo, porque cierra la pregunta.
//
//   node scripts/censo-consultas-disa.mjs
//   node scripts/censo-consultas-disa.mjs --detalle
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { soloCodigo, sinComentariosHtml, sinComentariosDeLinea } from './lib/solo-codigo.mjs';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DETALLE = process.argv.includes('--detalle');

// Ejecutar SQL: `.prepare(...)` seguido de `.all(`, `.get(`, `.iterate(`, `.pluck(` o `.run(`.
const RE = /\.prepare\s*\([\s\S]{0,400}?\)\s*\.\s*(all|get|iterate|pluck|run)\s*\(/g;

// ── LOS SITIOS DECLARADOS DE `modules/disa/`, CON SU MOTIVO Y SU RECUENTO EXACTO ─────────────────
// Recuento EXACTO a propósito: uno nuevo es rojo, y una declaración que sobra también (alguien lo
// quitó y no bajó el número, y un puntero caducado manda al siguiente al sitio equivocado).
//
// Sí, 101 en `index.js` es un número que se moverá con cualquier refactor, y ESE es el trato: que
// quien añada una consulta a DISA tenga que pasar por aquí y preguntarse si necesita tope. Los
// números salen de contar, no de estimar (3 sep 2026).
const DECLARADOS = {
  'modules/disa/consulta-worker.js': { n: 1, motivo:
    'EL sitio bueno: el hilo que se puede matar. Ejecuta con `iterate` para parar en la fila del tope, y el hilo principal lo termina al vencer el plazo.' },
  'modules/disa/index.js': { n: 101, motivo:
    'consultas FIJAS escritas en el repo (contexto del mensaje, hilos, agentes, avisos, acciones): su forma no la decide el modelo y llevan su LIMIT donde hace falta. Lo que el modelo escribe va SIEMPRE por consultarConLimites.' },
  'modules/disa/informes.js': { n: 1, motivo:
    'una consulta fija por id (descuento de un cliente). Los informes no ejecutan SQL aquí: van por `cruzar(..., limit)`, que ya trae su tope, y desde el 3 sep 2026 anuncian el recorte.' },
};

// Los límites viven en un solo sitio. Quien los escriba a mano fuera de ahí, rojo.
const FICHERO_LIMITES = 'modules/disa/limites-consulta.js';
const RE_NUMERO_A_MANO = /\b(?:maxFilas|max_filas|plazoMs|plazo_ms|timeoutMs)\s*[:=]\s*\d+/g;

function limpiar(src) {
  return sinComentariosHtml(soloCodigo(src)).split('\n').map(sinComentariosDeLinea).join('\n');
}

function barrer(dir, hallazgos, aMano) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { barrer(p, hallazgos, aMano); continue; }
    if (!f.name.endsWith('.js')) continue;
    const rel = path.relative(RAIZ, p);
    const bruto = fs.readFileSync(p, 'utf8');
    const codigo = limpiar(bruto);
    const lineas = bruto.split('\n');
    for (const m of codigo.matchAll(RE)) {
      const linea = codigo.slice(0, m.index).split('\n').length;
      hallazgos.push({ fichero: rel, linea, texto: (lineas[linea - 1] || '').trim().slice(0, 100) });
    }
    if (rel !== FICHERO_LIMITES) {
      for (const m of codigo.matchAll(RE_NUMERO_A_MANO)) {
        const linea = codigo.slice(0, m.index).split('\n').length;
        aMano.push({ fichero: rel, linea, texto: m[0] });
      }
    }
  }
}

// ── AUTOPRUEBA ───────────────────────────────────────────────────────────────────────────────────
const P = '.prepare(';
const MUESTRAS = [
  { cazar: true,  src: "const rows = db" + P + "sql).all();" },
  { cazar: true,  src: "const r = db" + P + "'SELECT 1').get();" },
  { cazar: true,  src: "for (const x of db" + P + "sql).iterate()) {}" },
  { cazar: false, src: "const r = await consultarConLimites(ruta, sql);" },
  { cazar: false, src: "const st = db" + P + "sql);   // preparada y nada mas" },
  { cazar: false, src: "// db" + P + "sql).all()   ← comentario, no cuenta" },
];
let autofallos = 0;
for (const [i, m] of MUESTRAS.entries()) {
  const cazado = [...limpiar(m.src).matchAll(RE)].length > 0;
  if (cazado !== m.cazar) {
    autofallos++;
    say('  ✗ AUTOPRUEBA ' + (i + 1) + ': se esperaba ' + (m.cazar ? 'CAZARLA' : 'dejarla pasar')
        + ' y salió ' + (cazado ? 'cazada' : 'pasada') + '  →  ' + m.src.slice(0, 80));
  }
}
if (autofallos) {
  say('\n✗ EL CENSO NO SE FÍA DE SÍ MISMO: ' + autofallos + ' de ' + MUESTRAS.length + ' muestras mal juzgadas.');
  say('  No ha mirado el producto. Un censo ciego que dice CERO es peor que no tenerlo.');
  say('RESULTADO: 0 ✓  ·  1 ✗');
  process.exit(1);
}

// ── EL PRODUCTO ──────────────────────────────────────────────────────────────────────────────────
const todos = [], aMano = [];
barrer(path.join(RAIZ, 'modules', 'disa'), todos, aMano);

const porFichero = {};
for (const h of todos) (porFichero[h.fichero] ||= []).push(h);

const sinDeclarar = [];
for (const [f, hs] of Object.entries(porFichero)) {
  const d = DECLARADOS[f];
  if (!d || hs.length !== d.n) sinDeclarar.push(...hs);
}
const rancias = Object.entries(DECLARADOS)
  .map(([f, d]) => ({ fichero: f, declarado: d.n, hay: (porFichero[f] || []).length }))
  .filter(r => r.hay !== r.declarado);

say('\nAUTOPRUEBA: ' + MUESTRAS.length + '/' + MUESTRAS.length + ' muestras bien juzgadas (3 envenenadas cazadas, 3 buenas respetadas)');
say('EJECUCIONES DE SQL EN modules/disa/: ' + todos.length + '  (no se cuentan las de comentarios)\n');
for (const [f, hs] of Object.entries(porFichero).sort((a, b) => b[1].length - a[1].length)) {
  const d = DECLARADOS[f];
  const bien = d && hs.length === d.n;
  say((bien ? '  · ' : '  ✗ ') + String(hs.length).padStart(3) + '  ' + f + (bien ? '   [declarado]' : '   ← SIN DECLARAR o el recuento no cuadra'));
  if (bien) say('        ' + d.motivo);
  if (DETALLE || !bien) for (const h of hs) say('        :' + String(h.linea).padEnd(5) + h.texto);
}

if (aMano.length) {
  say('\n✗ LÍMITES ESCRITOS A MANO FUERA DE ' + FICHERO_LIMITES + ': ' + aMano.length);
  for (const h of aMano) say('  · ' + h.fichero + ':' + h.linea + '  ' + h.texto);
  say('  Los valores viven en un solo sitio, con su motivo. Una regla repartida vuelve en cuanto alguien la olvida.');
}
if (sinDeclarar.length || rancias.length) {
  say('\n✗ CAMINOS DE CONSULTA SIN DECLARAR o con el recuento descuadrado.');
  say('  Todo SQL que escriba el MODELO tiene que ir por `consultarConLimites` (tope + plazo real).');
  say('  Si la consulta es FIJA y está escrita en el repo, declárala arriba con su motivo y su número.');
  for (const r of rancias) say('  · ' + r.fichero + ' — declara ' + r.declarado + ' y hay ' + r.hay);
}
const fallos = (sinDeclarar.length ? 1 : 0) + rancias.length + aMano.length;
say('\nRESULTADO: ' + (fallos ? 0 : 1) + ' ✓  ·  ' + fallos + ' ✗');
process.exit(fallos ? 1 : 0);
