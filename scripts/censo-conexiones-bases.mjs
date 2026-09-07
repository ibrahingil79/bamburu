#!/usr/bin/env node
// Censo de conexiones a bases de negocio del SERVICIO VIVO — el contador consultable.
//
// Mide desde fuera, leyendo `/proc/<pid>/fd` del proceso de `bamburu.service`, que es el mismo
// método con el que se midió el Paso 0 de `conexiones-que-no-se-cierran` (7 sep 2026). No hace
// falta sudo: el servicio corre como `ubuntu` y el censo también.
//
// Distingue las TRES cosas, y ese desglose es el que hace posible comprobar algo:
//   SANA   — el fichero está y lo que el servicio sostiene debajo es lo que hay en el disco.
//   MUERTA — el `.db` que el servicio tiene abierto YA NO EXISTE. Son las del barrido.
//   RANCIA — el `.db` sigue vivo, pero su `-wal`/`-shm` murió por debajo. Es el fallo de sesión
//            del 6 sep: no da error, no falla `integrity_check`, y el proceso mira a otro sitio.
//
//   node scripts/censo-conexiones-bases.mjs            → informe legible
//   node scripts/censo-conexiones-bases.mjs --json     → para otra herramienta

import { readlinkSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';

export function pidDelServicio() {
  try {
    const pid = Number(execFileSync('systemctl', ['show', '-p', 'MainPID', '--value', 'bamburu'], { encoding: 'utf8' }).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

/** Censo de un proceso por su pid. Devuelve { pid, sanas, muertas, rancias, bases: [...] }. */
export function censoDelProceso(pid) {
  const bases = new Map();   // ruta de la base → { ruta, dbBorrado, diarioBorrado, descriptores }
  let descriptores = 0;
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    let destino;
    try { destino = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
    descriptores++;
    const borrado = destino.endsWith(' (deleted)');
    const ruta = borrado ? destino.slice(0, -' (deleted)'.length) : destino;
    if (!/\.db(-wal|-shm)?$/.test(ruta)) continue;
    const base = ruta.replace(/-(wal|shm)$/, '');
    if (!bases.has(base)) bases.set(base, { ruta: base, dbBorrado: false, diarioBorrado: false, descriptores: 0 });
    const b = bases.get(base);
    b.descriptores++;
    if (borrado) { if (base === ruta) b.dbBorrado = true; else b.diarioBorrado = true; }
  }
  const lista = [...bases.values()].map(b => ({
    ...b,
    // El `.db` borrado manda: si la base no existe, da igual lo que pase con su diario.
    estado: b.dbBorrado ? 'muerta' : b.diarioBorrado ? 'rancia' : 'sana',
  })).sort((a, b2) => a.ruta.localeCompare(b2.ruta));
  return {
    pid, descriptores, bases: lista,
    abiertas: lista.length,
    sanas:   lista.filter(b => b.estado === 'sana').length,
    muertas: lista.filter(b => b.estado === 'muerta').length,
    rancias: lista.filter(b => b.estado === 'rancia').length,
  };
}

/** Censo del servicio vivo, o null si no está en marcha. */
export function censoDelServicio() {
  const pid = pidDelServicio();
  if (!pid) return null;
  try { return censoDelProceso(pid); } catch { return null; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = censoDelServicio();
  if (!c) { console.error('bamburu.service no está en marcha (o no se pudo leer su proceso).'); process.exit(2); }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(c, null, 2)); process.exit(0); }
  const nombre = r => r.replace(/^.*\/(data\/)?/, '').replace(/\.db$/, '');
  console.log(`\nCONEXIONES A BASES · bamburu.service (pid ${c.pid})\n`);
  console.log(`  descriptores del proceso : ${c.descriptores}`);
  console.log(`  bases abiertas           : ${c.abiertas}\n`);
  console.log(`    🟢 sanas    ${String(c.sanas).padStart(4)}`);
  console.log(`    🔴 muertas  ${String(c.muertas).padStart(4)}   (el fichero de la base ya no existe)`);
  console.log(`    🟠 rancias  ${String(c.rancias).padStart(4)}   (la base vive, su diario murió debajo)\n`);
  for (const b of c.bases.filter(x => x.estado !== 'sana')) {
    console.log(`    ${b.estado === 'muerta' ? '🔴' : '🟠'} ${b.estado.padEnd(7)} ${nombre(b.ruta)}`);
  }
  if (c.muertas === 0 && c.rancias === 0) console.log('    (ninguna: todas sanas)');
  console.log();
}
