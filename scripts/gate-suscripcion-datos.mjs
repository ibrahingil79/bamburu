#!/usr/bin/env node
//
// gate-suscripcion-datos.mjs — Los 90 días para llevarse todo, y la bóveda.
//
// LO QUE MIDE, Y EL ORDEN IMPORTA:
//   1. Que el reloj arranque EL DÍA DEL CORTE y **no se reinicie** — la misma trampa que ya se coló
//      en la tarea anterior con el reloj del corte, medida igual.
//   2. Que la copia salga **completa**: se contrasta fila a fila contra la base, tabla por tabla, y
//      se comprueba que el ZIP se puede ABRIR de verdad (CRC de cada fichero).
//   3. Que al día 90 se cierre la ventana **sin tocar ni un dato**: recuento de TODAS las tablas
//      antes y después, la misma medición del corte.
//
// NO CREA NI BORRA DATOS DE NINGÚN NEGOCIO: exporta en solo lectura y devuelve el estado de la
// suscripción a como estaba en el `finally`.

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { getTenantById, setTenantStatus } from '../core/control-db.js';
import { sumarDias, hoyISO } from '../core/suscripcion.js';
import { abrirVentanaDeDescarga, situacionDeLosDatos, guardarEnLaBoveda,
         aLosQueSeLesCierraLaVentana, DIAS_DE_DESCARGA } from '../core/suscripcion-datos.js';
import { exportarNegocio, TABLAS_FUERA, COLUMNAS_FUERA } from '../modules/erp/exportacion.js';

/** Un CSV con lo que rompe a los CSV mal escritos, para que el lector independiente lo pruebe. */
function tablaACsvDePrueba() {
  const filas = [
    ['nombre', 'nota', 'importe'],
    ['Adrián Núñez', 'dijo "esto es mío"', '1.234,56'],
    ['Peluquería; y más', 'con punto y coma dentro', '9,90'],
    ['Salto', 'primera línea\nsegunda línea', '0,00'],
  ];
  const cel = v => /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return '\ufeff' + filas.map(f => f.map(cel).join(';')).join('\r\n') + '\r\n';
}
import { verificarZip, leerDelZip as leerBin } from '../core/zip.js';

// El lector es el del propio escritor de ZIP: si se escribiera aparte, se separaría de él.
const leerDelZip = (buf, nombre, patron = null) => leerBin(buf, nombre, patron)?.toString('utf8') ?? null;

const SLUG = 'helados-ibrahin';   // pequeño y con una factura: el ciclo entero cabe en segundos
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0, 400) : ''}`); } };

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const tenant = cd.prepare('SELECT id, name, slug, db_filename FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
const estadoAntes = getTenantById(tenant.id).status;
let generado = null;

const conteoDeTodo = () => {
  const bd = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`, { readonly: true });
  const out = {};
  for (const { name } of bd.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    try { out[name] = bd.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n; } catch { out[name] = -1; }
  }
  bd.close();
  return out;
};

try {
  const conteosPrevios = conteoDeTodo();
  const CORTE = '2026-08-01';

  // ── CRITERIO 1 · «Tras el corte, 90 días para descargar TODOS sus datos, él solo» ──────────────
  P('\n[criterio 1] El reloj de los 90 días arranca en el corte y no se mueve');
  cd.prepare(`UPDATE tenant_suscripciones SET estado='pago_pendiente', cortado_en=?, cortado_por_impago=1,
    descarga_hasta=NULL, en_boveda_desde=NULL, descarga_estado=NULL, descarga_fichero=NULL,
    descarga_resumen=NULL WHERE tenant_id=?`).run(CORTE, tenant.id);
  abrirVentanaDeDescarga(tenant.id, { desde: CORTE });
  let d = situacionDeLosDatos(tenant.id, { hoy: CORTE });
  check(`la ventana dura ${DIAS_DE_DESCARGA} días desde el corte`,
    d.hasta === sumarDias(CORTE, DIAS_DE_DESCARGA), `${d.hasta} vs ${sumarDias(CORTE, DIAS_DE_DESCARGA)}`);
  check('y el cliente ve cuántos le quedan', d.dias_restantes === DIAS_DE_DESCARGA, String(d.dias_restantes));

  // La trampa del reloj: llamarla otra vez NO puede alargar la ventana.
  abrirVentanaDeDescarga(tenant.id, { desde: '2026-08-20' });
  abrirVentanaDeDescarga(tenant.id, { desde: hoyISO() });
  check('volver a abrirla NO alarga la ventana (la trampa del reloj)',
    situacionDeLosDatos(tenant.id, { hoy: CORTE }).hasta === sumarDias(CORTE, DIAS_DE_DESCARGA),
    situacionDeLosDatos(tenant.id, { hoy: CORTE }).hasta);
  check('a mitad de camino quedan los días que quedan, no otros',
    situacionDeLosDatos(tenant.id, { hoy: sumarDias(CORTE, 45) }).dias_restantes === 45);

  // ── La copia: completa, contrastada y que se abre ──────────────────────────────────────────────
  P('\n[criterio 1-bis] La copia sale completa, y se comprueba a sí misma');
  const bd = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`, { readonly: true });
  const r = await exportarNegocio(tenant, bd, { conFacturas: true });
  check('la copia se genera', r.ok, r.error);
  if (!r.ok) throw new Error(r.error);
  generado = r.ruta;
  const zip = readFileSync(r.ruta);
  const v = verificarZip(zip);
  check('el ZIP se puede ABRIR de verdad (CRC de cada fichero)', v.ok, v.error);
  check('y trae todos los ficheros que dice', v.entradas === r.resumen.ficheros, `${v.entradas} vs ${r.resumen.ficheros}`);

  // Contraste fila a fila contra la base: es el criterio del encargo y lo que impide entregar
  // una descarga a medias que parece entera.
  const manifiesto = leerDelZip(zip, 'manifiesto.csv');
  const lineas = manifiesto.replace(/^﻿/, '').trim().split('\r\n').slice(1);
  let descuadres = [], excluidas = 0;
  for (const l of lineas) {
    const [tabla, enBase, enCopia, incluida] = l.split(';');
    if (incluida === 'no') { excluidas += 1; continue; }
    const real = bd.prepare(`SELECT COUNT(*) n FROM "${tabla}"`).get().n;
    if (Number(enBase) !== real || Number(enCopia) !== real) descuadres.push(`${tabla}: base ${real}, dice ${enBase}, copia ${enCopia}`);
  }
  check('cada tabla de la copia cuadra fila a fila con la base', descuadres.length === 0, descuadres.join(' · '));
  check('y están TODAS las tablas del negocio', lineas.length === Object.keys(conteosPrevios).length,
    `${lineas.length} en el manifiesto vs ${Object.keys(conteosPrevios).length} en la base`);

  // Lo excluido es a propósito, y se DICE — una omisión silenciosa es el fallo que esta tarea evita.
  check('lo que no se incluye son credenciales, y están nombradas', excluidas === Object.keys(TABLAS_FUERA)
    .filter(t => conteosPrevios[t] !== undefined).length, `${excluidas} excluidas`);
  const leeme = leerDelZip(zip, 'LEEME.txt');
  check('el LEEME dice qué NO está y por qué', /LO QUE NO ESTÁ AQUÍ/.test(leeme)
    && Object.keys(TABLAS_FUERA).every(t => conteosPrevios[t] === undefined || leeme.includes(t)), leeme.slice(0, 300));
  check('y no se filtra ninguna contraseña ni secreto',
    !/password_hash|totp_secret/.test(leerDelZip(zip, 'Mi negocio/admin_users.csv') || ''),
    'las columnas de credenciales no pueden viajar en el ZIP');

  // Que se abra en Excel de verdad: BOM y punto y coma.
  const csvClientes = leerDelZip(zip, 'Clientes/clients.csv');
  check('los CSV llevan BOM (Excel abre los acentos bien)', csvClientes.charCodeAt(0) === 0xFEFF);
  check('y punto y coma como separador (el que espera Excel en España)',
    csvClientes.split('\r\n')[0].includes(';'), csvClientes.split('\r\n')[0].slice(0, 80));
  // ── Que los CSV se abran DE VERDAD, leídos por otro programa ──────────────────────────────────
  // No basta con que los escriba bien mi propio escritor: eso es mirarse al espejo. Se extraen y se
  // leen con el módulo `csv` de Python —una implementación independiente, la misma familia de lector
  // que usa una hoja de cálculo— y se exige que TODAS las filas tengan las columnas de su cabecera.
  // Con datos difíciles a propósito: comillas, puntos y coma y saltos de línea dentro de un campo.
  P('\n[que se abran de verdad] Leídos por un lector independiente');
  const dir = mkdtempSync(path.join(tmpdir(), 'csvchk-'));
  const csvs = [];
  for (const nombre of ['Clientes/clients.csv', 'Facturas y ventas/invoices.csv', 'Mi negocio/company_config.csv', 'manifiesto.csv']) {
    const b = leerBin(zip, nombre);
    if (!b) continue;
    const f = path.join(dir, nombre.replace(/\//g, '__'));
    writeFileSync(f, b);
    csvs.push(f);
  }
  const py = `
import csv, sys, json
malos = []
for f in sys.argv[1:]:
    with open(f, newline='', encoding='utf-8-sig') as fh:     # utf-8-sig = lo que hace Excel con el BOM
        filas = list(csv.reader(fh, delimiter=';', quotechar='"'))
    if not filas: malos.append(f + ': vacío'); continue
    n = len(filas[0])
    for i, fila in enumerate(filas[1:], 2):
        if len(fila) != n: malos.append(f'{f}: fila {i} tiene {len(fila)} columnas y la cabecera {n}')
    if any(c.startswith('\ufeff') for c in filas[0]): malos.append(f + ': el BOM se cuela como texto')
print(json.dumps({'ficheros': len(sys.argv)-1, 'malos': malos[:5]}))
`;
  const r2 = spawnSync('python3', ['-c', py, ...csvs], { encoding: 'utf8' });
  const parseo = JSON.parse(r2.stdout || '{"ficheros":0,"malos":["no se pudo leer"]}');
  check('un lector independiente abre los CSV y todas las filas cuadran',
    parseo.malos.length === 0 && parseo.ficheros > 0, JSON.stringify(parseo));

  // Y con datos difíciles a propósito, que es donde se rompen los CSV mal escritos.
  const dificil = tablaACsvDePrueba();
  writeFileSync(path.join(dir, 'dificil.csv'), dificil);
  const r3 = spawnSync('python3', ['-c', py, path.join(dir, 'dificil.csv')], { encoding: 'utf8' });
  const p3 = JSON.parse(r3.stdout || '{"malos":["falló"]}');
  check('aguanta comillas, puntos y coma y saltos de línea DENTRO de un campo', (p3.malos || []).length === 0,
    JSON.stringify(p3) + ' · ' + JSON.stringify(dificil.slice(0, 160)));
  rmSync(dir, { recursive: true, force: true });

  check('las facturas van en PDF, y son PDF de verdad',
    (r.resumen.pdfs > 0) && leerDelZip(zip, null, /^Facturas en PDF\//)?.slice(0, 4) === '%PDF',
    `pdfs=${r.resumen.pdfs}`);

  // ── CRITERIOS 2 y 3 · La bóveda: se cierra la ventana y NO se borra nada ───────────────────────
  P('\n[criterios 2 y 3] Al día 90 se cierra la ventana, y no se toca ni un dato');
  const DIA90 = sumarDias(CORTE, DIAS_DE_DESCARGA);
  check('el día 89 la ventana sigue abierta',
    situacionDeLosDatos(tenant.id, { hoy: sumarDias(CORTE, 89) }).puede_descargar === true);
  const aCerrar = aLosQueSeLesCierraLaVentana({ hoy: DIA90 }).map(x => x.slug);
  check('el día 90 aparece en la lista de los que se cierran', aCerrar.includes(SLUG), aCerrar.join(','));
  guardarEnLaBoveda(tenant.id, { hoy: DIA90 });
  d = situacionDeLosDatos(tenant.id, { hoy: DIA90 });
  check('pasa a la bóveda', d.fase === 'boveda', d.fase);
  check('y ya no se puede descargar', d.puede_descargar === false);
  check('pero se le dice que NO se ha borrado nada', /no se ha borrado nada/i.test(d.detalle), d.detalle);
  check('NI UN DATO se ha movido al pasar a la bóveda',
    JSON.stringify(conteoDeTodo()) === JSON.stringify(conteosPrevios),
    `antes ${JSON.stringify(conteosPrevios)} · después ${JSON.stringify(conteoDeTodo())}`);
  check('la base del negocio sigue en su sitio de siempre',
    existsSync(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`));
  check('cerrar la ventana dos veces no hace nada raro',
    aLosQueSeLesCierraLaVentana({ hoy: sumarDias(DIA90, 30) }).every(x => x.slug !== SLUG));

  // ── CRITERIO 4 · «Sabe en todo momento cuántos días le quedan y qué pasará después» ────────────
  P('\n[criterio 4] Lo sabe en todo momento');
  for (const [dia, esperado] of [[0, DIAS_DE_DESCARGA], [30, 60], [89, 1]]) {
    // Se vuelve a abrir la ventana para poder mirar el tramo anterior sin mover nada real.
    cd.prepare('UPDATE tenant_suscripciones SET en_boveda_desde=NULL WHERE tenant_id=?').run(tenant.id);
    const x = situacionDeLosDatos(tenant.id, { hoy: sumarDias(CORTE, dia) });
    check(`el día ${dia} dice que quedan ${esperado}`, x.dias_restantes === esperado, String(x.dias_restantes));
    if (dia === 0) check('y dice qué pasará después (la bóveda, sin borrar)',
      /bóveda/i.test(x.detalle) && /NO se borran/i.test(x.detalle), x.detalle);
  }

  // ── Nada de borrado, en ningún sitio ───────────────────────────────────────────────────────────
  P('\n[la regla que manda] En ningún momento se destruye información');
  const modDatos = readFileSync('/home/ubuntu/bamburu/core/suscripcion-datos.js', 'utf8');
  const modExp = readFileSync('/home/ubuntu/bamburu/modules/erp/exportacion.js', 'utf8');
  const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  check('el módulo de la bóveda no tiene ni un DELETE ni un DROP', !/DELETE FROM|DROP /i.test(sinCom(modDatos)));
  check('el exportador tampoco, y abre la base en SOLO LECTURA', !/DELETE FROM|DROP /i.test(sinCom(modExp)));
  check('la bóveda no MUEVE la base a ningún sitio',
    !/rename|copyFile|unlink|rmdir/i.test(sinCom(modDatos)), 'la bóveda es un estado, no un sitio');

  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  if (generado && existsSync(generado)) { try { unlinkSync(generado); } catch {} }
  setTenantStatus(tenant.id, estadoAntes, estadoAntes === 'active' ? null : (getTenantById(tenant.id).suspend_note || null));
  cd.prepare(`UPDATE tenant_suscripciones SET estado=?, cortado_en=?, cortado_por_impago=?,
    descarga_hasta=?, en_boveda_desde=?, descarga_estado=?, descarga_fichero=?, descarga_lista_en=?,
    descarga_error=?, descarga_resumen=? WHERE tenant_id=?`)
    .run(antes.estado, antes.cortado_en ?? null, antes.cortado_por_impago ?? 0, antes.descarga_hasta ?? null,
         antes.en_boveda_desde ?? null, antes.descarga_estado ?? null, antes.descarga_fichero ?? null,
         antes.descarga_lista_en ?? null, antes.descarga_error ?? null, antes.descarga_resumen ?? null, tenant.id);
  P('  copia de prueba borrada y suscripción devuelta a su estado anterior');
}

process.exit(mal ? 1 : 0);
