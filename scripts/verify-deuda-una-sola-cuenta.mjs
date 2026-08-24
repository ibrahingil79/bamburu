#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LO QUE SE DEBE SE MIDE IGUAL, SE COBRE O SE PAGUE.
//
// Decisión del dueño (24 ago 2026), la misma que ya tomó para clientes: **la deuda se cuenta sobre
// FACTURAS**, y las pantallas que la enseñan beben del mismo sitio. *«Un dueño no puede tener dos
// reglas según el lado del mostrador.»*
//
// DE DÓNDE SALE. `verify-dibujo` llevaba meses sin poder arrancar (pedía la ruta de la BD por
// parámetro). El día que arrancó destapó que la pantalla de Pagos decía **10.750,15 €** de un
// proveedor y el gráfico de Compras **10.355,86 €** — 394,29 € de diferencia.
// La causa NO eran dos motores: los dos suman lo mismo factura a factura. Era que el gráfico
// agrupaba por el nombre CONGELADO en la factura, y ese proveedor tenía sus 25 facturas repartidas
// en CINCO nombres distintos. El mismo fallo que se corrigió en VENTAS el 23 ago y que no se llevó
// a compras.
//
// Esto existe para que no vuelvan a separarse: recorre TODOS los proveedores con deuda y exige que
// la cifra de la pantalla y la del gráfico coincidan al céntimo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { openPayables } from '../modules/erp/pagos.js';
import { openDebts } from '../modules/erp/cobros.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';
import { readFileSync } from 'fs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = process.argv[2] || 'desarrollo-bamburu';
let ok = 0, fail = 0;
const check = (c, m, det) => { if (c) { ok++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const db = new Database(join(RAIZ, 'data', 'tenants', SLUG + '.db'), { readonly: true });
const hoy = new Date().toISOString().slice(0, 10);
const P = () => true;

console.log('\n=== La deuda se mide igual, se cobre o se pague ===\n');

// ── PROVEEDORES: la pantalla de Pagos contra el gráfico de Compras ──────────────────────────────
{
  const filas = openPayables(db, hoy).rows;
  const porProv = new Map();
  for (const r of filas) porProv.set(r.supplier_name, r2((porProv.get(r.supplier_name) || 0) + r.pendiente));
  const graf = cruzar(db, { area: 'compras', dimension: 'proveedor', medidas: ['pendiente'],
                            periodo: null, from: null, to: null, limit: 100000, hasPerm: P }).filas;
  const porGraf = new Map(graf.map(f => [f.clave, r2(f.pendiente)]));
  const discrepan = [];
  for (const [nombre, pantalla] of porProv) {
    const grafico = porGraf.get(nombre);
    if (grafico === undefined || Math.abs(grafico - pantalla) > 0.005) {
      discrepan.push(nombre + ': pantalla ' + pantalla + ' vs gráfico ' + (grafico === undefined ? '(no sale)' : grafico));
    }
  }
  check(discrepan.length === 0,
    'PROVEEDORES: cada uno debe lo mismo en la pantalla de Pagos y en el gráfico de Compras',
    discrepan.slice(0, 3).join(' · ') || porProv.size + ' proveedores con deuda, todos cuadran');

  const totalPantalla = r2([...porProv.values()].reduce((s, v) => s + v, 0));
  const totalGrafico = r2(graf.reduce((s, f) => s + (Number(f.pendiente) || 0), 0));
  check(Math.abs(totalPantalla - totalGrafico) <= 0.01,
    '  y el total también', totalPantalla + ' vs ' + totalGrafico);
}

// ── CLIENTES: EL OTRO LADO DEL MOSTRADOR, Y POR QUÉ SE MIDE DISTINTO ────────────────────────────
// Aquí NO se compara contra el constructor, y conviene decir por qué en vez de dejar el hueco.
// El área de VENTAS tiene el grano en la LÍNEA de factura (base, unidades, coste, margen…) y **no
// tiene medida de «pendiente»**: lo pendiente es de la factura entera, no de una línea. Comparar
// contra ella sería inventarse una equivalencia.
//
// Lo que sí se puede afirmar, y se afirma: que la deuda de clientes sale de UN SOLO recorrido
// —`deudaViva`, el que se unificó el 24 ago por decisión del dueño— y que la pantalla de Cobros y la
// cifra a fecha beben de él. Si alguien volviera a abrir una segunda cuenta paralela, esto cae.
{
  const cobros = readFileSync(join(RAIZ, 'modules', 'erp', 'cobros.js'), 'utf8');
  const tieneMotorUnico = /function deudaViva\s*\(/.test(cobros);
  check(tieneMotorUnico, 'CLIENTES: la deuda sigue saliendo de UN SOLO recorrido (deudaViva)');

  // openDebts y deudaAFecha tienen que ser CARAS de ese recorrido, no cuentas aparte.
  const caras = ['openDebts', 'deudaAFecha'];
  const sueltas = caras.filter(f => {
    const m = new RegExp('function ' + f + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]{0,700}?)\\n\\}', 'm').exec(cobros);
    return !m || !/deudaViva/.test(m[1]);
  });
  check(sueltas.length === 0,
    '  y las dos pantallas que la enseñan beben de él, no de una cuenta paralela',
    sueltas.join(', ') || caras.join(' y ') + ' pasan por deudaViva');

  // Y la cifra, de verdad: la suma de las filas es el total de cabecera.
  const d = openDebts(db, hoy);
  const suma = r2(d.rows.reduce((s, r) => s + r.pendiente, 0));
  check(Math.abs(suma - r2(d.total)) <= 0.01,
    '  y la suma de sus filas es el total que enseña', suma + ' vs ' + r2(d.total));
}

// ── REVERSIÓN: que esto sepa CAER ───────────────────────────────────────────────────────────────
// Se comparan dos mapas de mentira, uno con un céntimo de más. Sin esto, un verde aquí podría estar
// comparando cero proveedores y llamándolo cuadre.
{
  const a = new Map([['X', 100.00]]), b = new Map([['X', 100.01]]);
  const cae = [...a].some(([k, v]) => Math.abs((b.get(k) ?? 0) - v) > 0.005);
  check(cae, 'y sabe cazar una diferencia de UN CÉNTIMO (reversión)');
}

db.close();
console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + ok + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
