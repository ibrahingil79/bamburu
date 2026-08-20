#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL BARRIDO COMPLETO ES A DEMANDA — y este script es lo que impide que «a demanda» acabe siendo
// «nunca».
//
// LA NORMA VIVE EN UN SOLO SITIO: **RITUAL.md · sección «LA REGRESIÓN»**. Aquí NO se reescribe, y no
// es puntillismo: este comentario ya llegó a contener una versión propia de la norma —«el corto va
// antes de cada commit, siempre y sin preguntar»— que Ibrahin nunca acordó, y que sobrevivió a la
// primera corrección precisamente por estar copiada en cuatro sitios. Lo único que hace falta saber
// aquí: **nada se ejecuta solo; se ejecuta cuando él lo pide**, y este script sirve para PROPONERLO
// y para que un «no» no se olvide.
//
// POR QUÉ HACE FALTA UN SCRIPT Y NO BASTA CON ACORDARSE. Porque «me acuerdo» es exactamente lo que
// falló antes en este repo: catorce gates muertos tres semanas, un KPI de Notion actualizado durante
// semanas sobre un bloque que no existía. Un compromiso que depende de la memoria de alguien no es
// un compromiso, es una intención. Aquí el estado vive en `TABLERO.md` —la fuente única—, en un
// bloque delimitado que este script lee y escribe, y que dice en voz alta cuántos días y cuántos
// commits lleva sin barrerse.
//
//   node scripts/barrido-estado.mjs                    # el parte: al abrir y al cerrar la sesión
//   node scripts/barrido-estado.mjs --registrar-hecho "59/71" --segundos 360
//   node scripts/barrido-estado.mjs --registrar-pendiente    # Ibrahin ha dicho que no
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { GRUPOS, AFECTA } from './lib/gates-mapa.mjs';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TABLERO = join(APP_DIR, 'TABLERO.md');
const INICIO = '<!-- BARRIDO:INICIO -->';
const FIN = '<!-- BARRIDO:FIN -->';

const git = cmd => { try { return execSync(cmd, { cwd: APP_DIR, encoding: 'utf8' }).trim(); } catch { return ''; } };
const hoy = () => new Date().toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// ── LEER EL BLOQUE ──────────────────────────────────────────────────────────────────────────────
// Si el bloque no está, NO se inventa un estado: se dice que falta. Un parte que se calla cuando no
// sabe es peor que no tener parte — es la misma regla que gobierna el runner.
export function leer() {
  const s = readFileSync(TABLERO, 'utf8');
  const i = s.indexOf(INICIO), j = s.indexOf(FIN);
  if (i < 0 || j < 0) return null;
  const bloque = s.slice(i, j);
  const campo = re => (bloque.match(re) || [])[1] || null;
  return {
    fecha: campo(/\*\*Último barrido completo:\*\*\s*([0-9-]{10})/),
    commit: campo(/`([0-9a-f]{7,40})`/),
    // El resultado, en negrita, con la forma «59/71». Se busca por la FORMA del dato y no por lo
    // que lo rodea: así sobrevive a que la línea lleve o no los segundos detrás.
    resultado: campo(/\*\*(\d+\/\d+)\*\*/),
    pendienteDesde: campo(/PENDIENTE desde\s*([0-9-]{10})/),
    dijoNo: campo(/dijo que no el\s*([0-9-]{10})/),
  };
}

// ── QUÉ HA CAMBIADO DESDE ENTONCES ──────────────────────────────────────────────────────────────
// Commits, ficheros y —lo que de verdad importa para decidir— QUÉ ÁREAS tocan esos ficheros, con la
// misma tabla `AFECTA` que usa el modo corto. Si algún fichero no lo cubre ninguna regla, se dice:
// significa que el corto habría corrido el barrido entero, y es un argumento para lanzarlo.
export function cambiosDesde(commit) {
  if (!commit) return null;
  const existe = git('git cat-file -t ' + commit) === 'commit';
  if (!existe) return { desconocido: true };
  const commits = Number(git('git rev-list --count ' + commit + '..HEAD')) || 0;
  const ficheros = new Set();
  for (const cmd of ['git diff --name-only ' + commit + '..HEAD', 'git diff --name-only HEAD',
                     'git diff --name-only --cached', 'git ls-files --others --exclude-standard']) {
    for (const l of git(cmd).split('\n')) if (l.trim()) ficheros.add(l.trim());
  }
  const grupos = new Set(); const sinRegla = [];
  for (const f of ficheros) {
    const regla = AFECTA.find(r => r.re.test(f));
    if (!regla || regla.grupos === null) { sinRegla.push(f); continue; }
    for (const g of regla.grupos) grupos.add(g);
  }
  return { commits, ficheros: [...ficheros], grupos: [...grupos], sinRegla,
           gates: new Set([...grupos].flatMap(g => GRUPOS[g] || [])).size };
}

// ── EL PARTE ────────────────────────────────────────────────────────────────────────────────────
export function parte() {
  const e = leer();
  const lineas = [];
  if (!e) {
    lineas.push('⚠️  No encuentro el bloque del barrido en TABLERO.md (' + INICIO + ').');
    lineas.push('    No me lo invento: hasta que esté, no puedo decir desde cuándo no se corre.');
    return { lineas, e: null, c: null };
  }
  const c = cambiosDesde(e.commit);
  const dias = e.fecha ? diasEntre(e.fecha, hoy()) : null;
  lineas.push('EL BARRIDO COMPLETO (los ' + new Set(Object.values(GRUPOS).flat()).size + ' gates)');
  lineas.push('  · última vez: ' + (e.fecha || '(nunca)') + (e.commit ? ' · ' + e.commit : '')
    + (e.resultado ? ' · ' + e.resultado : '')
    + (dias === null ? '' : '  →  hace ' + dias + (dias === 1 ? ' día' : ' días')));
  if (e.pendienteDesde) {
    lineas.push('  · ⚠️  PENDIENTE desde ' + e.pendienteDesde
      + (e.dijoNo ? ' (Ibrahin dijo que no el ' + e.dijoNo + ')' : ''));
  }
  if (c && c.desconocido) {
    lineas.push('  · no puedo comparar: ese commit ya no está en este repo.');
  } else if (c) {
    lineas.push('  · desde entonces: ' + c.commits + (c.commits === 1 ? ' commit' : ' commits') + ' y '
      + c.ficheros.length + (c.ficheros.length === 1 ? ' fichero tocado' : ' ficheros tocados'));
    if (c.sinRegla.length) {
      lineas.push('  · y hay cambios que NINGUNA regla acota (tronco o fichero nuevo): '
        + c.sinRegla.slice(0, 4).join(', ') + (c.sinRegla.length > 4 ? ' …' : ''));
      lineas.push('    → eso significa que el corto ya corría el barrido entero: aquí el completo pesa más.');
    } else if (c.grupos.length) {
      lineas.push('  · áreas tocadas: ' + c.grupos.join(', ') + ' (' + c.gates + ' gates de los ' 
        + new Set(Object.values(GRUPOS).flat()).size + ')');
    }
  }
  return { lineas, e, c };
}

// ── ESCRIBIR EL BLOQUE ──────────────────────────────────────────────────────────────────────────
// Idempotente: reescribe SOLO lo que hay entre los dos marcadores. Nada más de TABLERO.md se toca.
function escribir(cuerpo) {
  const s = readFileSync(TABLERO, 'utf8');
  const i = s.indexOf(INICIO), j = s.indexOf(FIN);
  if (i < 0 || j < 0) {
    console.error('✗ No encuentro los marcadores ' + INICIO + ' / ' + FIN + ' en TABLERO.md.');
    process.exit(1);
  }
  writeFileSync(TABLERO, s.slice(0, i) + INICIO + '\n' + cuerpo + s.slice(j));
}

const CABECERA = `## 🔁 EL BARRIDO — A DEMANDA

> **Este bloque lo mantiene \`scripts/barrido-estado.mjs\`. No se edita a mano.**
> **Ningún barrido y ningún gate se ejecuta solo. Ni el de la tarea.** Se ejecutan cuando Ibrahin
> lo pide. La norma, entera y sin resumir, está en **RITUAL.md · «LA REGRESIÓN»**; aquí solo se
> apunta. Al cerrar una entrega **se propone** —qué se ha tocado, qué modo se recomienda y desde
> cuándo no se corre— y se espera un sí. Si dice que no, queda pendiente aquí y se vuelve a
> proponer al abrir la siguiente sesión.

`;

export function registrarHecho(resultado, segundos) {
  const commit = git('git rev-parse --short HEAD') || '(sin commit)';
  const cuerpo = CABECERA
    + '- **Último barrido completo:** ' + hoy() + ' · `' + commit + '` · **' + (resultado || '?') + '**'
    + (segundos ? ' · ' + segundos + ' s' : '') + '\n'
    + '- **Estado:** ✅ al día\n\n';
  escribir(cuerpo);
  return { fecha: hoy(), commit, resultado };
}

export function registrarPendiente() {
  const e = leer() || {};
  const desde = e.pendienteDesde || e.fecha || hoy();
  const cuerpo = CABECERA
    + '- **Último barrido completo:** ' + (e.fecha || '(nunca)') + (e.commit ? ' · `' + e.commit + '`' : '')
    + (e.resultado ? ' · **' + e.resultado + '**' : '') + '\n'
    + '- **Estado:** ⚠️ **PENDIENTE desde ' + desde + '** — se propuso y Ibrahin dijo que no el '
    + hoy() + '. Se vuelve a proponer al abrir la siguiente sesión.\n\n';
  escribir(cuerpo);
  return { desde };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const esCli = process.argv[1] && process.argv[1].endsWith('barrido-estado.mjs');
if (esCli) {
  const args = process.argv.slice(2);
  const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
  if (args.includes('--registrar-hecho')) {
    const r = registrarHecho(val('registrar-hecho'), val('segundos'));
    console.log('✓ Registrado en TABLERO.md: barrido completo ' + r.fecha + ' · ' + r.commit + ' · ' + r.resultado);
  } else if (args.includes('--registrar-pendiente')) {
    const r = registrarPendiente();
    console.log('✓ Registrado en TABLERO.md: barrido completo PENDIENTE desde ' + r.desde);
    console.log('  Se volverá a proponer al abrir la siguiente sesión.');
  } else {
    const p = parte();
    console.log('');
    for (const l of p.lineas) console.log(l);
    console.log('');
    // Se propone si NUNCA se ha corrido, si quedó pendiente, si no se puede comparar, o si hay
    // cambios desde el último. El «no hay nada que proponer» es el caso raro, no el de por defecto:
    // ante la duda se propone, porque el coste de proponer de más son diez segundos y el de callar
    // es una entrega sin barrer.
    const hayQueProponer = !p.e || !p.e.fecha || p.e.pendienteDesde
      || !p.c || p.c.desconocido || p.c.commits > 0 || p.c.ficheros.length > 0;
    if (hayQueProponer) {
      console.log('→ Toca PROPONERLO. Se lanza SOLO con un sí:  node scripts/run-gates.mjs --all');
      console.log('  Si dice que no:                            node scripts/barrido-estado.mjs --registrar-pendiente');
    } else {
      console.log('→ Nada que proponer: ni un commit ni un fichero desde el último barrido.');
    }
    console.log('');
  }
}
