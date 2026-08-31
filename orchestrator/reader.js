// reader.js — Lee TABLERO.md y el estado de git. No escribe nada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de texto
// ─────────────────────────────────────────────────────────────────────────────

/** Quita tildes y pasa a minúsculas, para comparar sin sorpresas. */
export function normalizar(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Convierte un título en un identificador manejable: "Aislar bloqueos SQLite" → "aislar-bloqueos-sqlite" */
export function slug(s) {
  return normalizar(s)
    .replace(/[`*_>#]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Nivel de un encabezado markdown, o 0 si la línea no lo es. */
function nivelEncabezado(linea) {
  const m = /^(#{1,6})\s+/.exec(linea);
  return m ? m[1].length : 0;
}

/** Texto del encabezado sin almohadillas ni adornos. */
function tituloEncabezado(linea) {
  return linea.replace(/^#{1,6}\s+/, '').replace(/\s*#+\s*$/, '').trim();
}

/**
 * Devuelve [inicio, fin) del bloque que abre el encabezado de la línea `i`:
 * hasta el siguiente encabezado de nivel igual o superior, o el final.
 */
function limitesBloque(lineas, i) {
  const nivel = nivelEncabezado(lineas[i]);
  for (let j = i + 1; j < lineas.length; j++) {
    const n = nivelEncabezado(lineas[j]);
    if (n > 0 && n <= nivel) return [i, j];
  }
  return [i, lineas.length];
}

/**
 * Las líneas de un bloque que son SUYAS: hasta el primer encabezado anidado.
 * Sin esto, "# TABLERO" se quedaría con los campos de todas sus subsecciones y
 * cualquier búsqueda por id casaría con el documento entero.
 */
function preambulo(cuerpo) {
  const corte = cuerpo.findIndex((l) => nivelEncabezado(l) > 0);
  return corte === -1 ? cuerpo : cuerpo.slice(0, corte);
}

/**
 * Campos escritos como "- **id:** valor", "**id:** valor" o "id: valor".
 * Devuelve un mapa con la clave normalizada (sin tildes, minúsculas).
 */
function extraerCampos(lineas) {
  const campos = {};
  for (const linea of lineas) {
    const m = /^\s*(?:[-*+]\s*)?\*{0,2}([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{2,20})\*{0,2}\s*:\s*(.+?)\s*$/.exec(linea);
    if (!m) continue;
    const clave = normalizar(m[1]).trim().replace(/\s+/g, '');
    const valor = m[2].replace(/^\*+|\*+$/g, '').replace(/^`|`$/g, '').trim();
    if (valor && campos[clave] === undefined) campos[clave] = valor;
  }
  return campos;
}

/** Criterios: casillas "- [ ]" / "- [x]", y si no hay, los bullets bajo una línea que hable de criterios. */
function extraerCriterios(lineas) {
  const casillas = [];
  for (const linea of lineas) {
    const m = /^\s*[-*+]\s*\[( |x|X)\]\s*(.+?)\s*$/.exec(linea);
    if (m) casillas.push({ hecho: m[1].toLowerCase() === 'x', texto: m[2].trim() });
  }
  if (casillas.length) return casillas;

  const sueltos = [];
  let dentro = false;
  for (const linea of lineas) {
    if (/criterio/i.test(normalizar(linea)) && !/^\s*[-*+]\s/.test(linea)) { dentro = true; continue; }
    if (!dentro) continue;
    const m = /^\s*[-*+]\s+(.+?)\s*$/.exec(linea);
    if (m) { sueltos.push({ hecho: false, texto: m[1].trim() }); continue; }
    if (linea.trim() === '') continue;
    if (nivelEncabezado(linea) > 0) break;
  }
  return sueltos;
}

/** Primer párrafo de prosa del bloque, ignorando campos, casillas y citas. */
function extraerDescripcion(lineas) {
  const trozos = [];
  for (const linea of lineas) {
    const t = linea.trim();
    if (t === '') { if (trozos.length) break; continue; }
    if (nivelEncabezado(linea) > 0) { if (trozos.length) break; continue; }
    if (/^[-*+]\s*\[( |x|X)\]/.test(t)) break;
    if (/^\s*(?:[-*+]\s*)?\*{0,2}[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{2,20}\*{0,2}\s*:/.test(t)) continue;
    if (/^<!--/.test(t)) continue;
    trozos.push(t.replace(/^>\s?/, ''));
  }
  return trozos.join(' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura del TABLERO
// ─────────────────────────────────────────────────────────────────────────────

export function leerTablero(ruta) {
  if (!fs.existsSync(ruta)) {
    throw new Error(`No encuentro el tablero en ${ruta}`);
  }
  return fs.readFileSync(ruta, 'utf8');
}

/** Construye la tarea a partir de un bloque de encabezado ya localizado. */
function tareaDesdeBloque(lineas, i, origen) {
  const [ini, fin] = limitesBloque(lineas, i);
  const cuerpo = lineas.slice(ini + 1, fin);
  const campos = extraerCampos(preambulo(cuerpo));
  const encabezado = tituloEncabezado(lineas[i]);

  // El título: lo que queda del encabezado tras quitarle el rótulo "SIGUIENTE TAREA",
  // o el campo tarea/título, o la primera línea con contenido.
  let titulo = encabezado
    .replace(/^\s*[^\p{L}\p{N}]*\s*/u, '')
    .replace(/siguiente\s+tarea(\s+oficial)?/i, '')
    // Un encabezado «TAREA — X» es rótulo + título: el rótulo sobra. Se exige el separador
    // para no comerse un título que empiece de verdad por esa palabra.
    .replace(/^\s*tareas?\s*(?=[—–\-:·|])/i, '')
    .replace(/^\s*hecha\s*\([^)]*\)\s*/i, '')
    .replace(/\s*·\s*`[0-9a-f, `]+`\s*$/i, '')
    .replace(/^[\s—–\-:·|]+/, '')
    .trim();
  if (!titulo) titulo = campos.titulo || campos.tarea || campos.nombre || '';
  if (!titulo) titulo = campos.descripcion || '';
  if (!titulo) {
    const primera = cuerpo.find((l) => l.trim() && nivelEncabezado(l) === 0 && !/^<!--/.test(l.trim()));
    titulo = primera ? primera.trim().replace(/^[>*\-\s]+/, '').replace(/\*+$/, '') : encabezado;
  }

  const descripcion = campos.descripcion || campos.descripcion || extraerDescripcion(cuerpo) || titulo;
  const id = campos.id || campos.taskid || campos.tarea || slug(titulo);

  return {
    id: slug(id),
    titulo,
    descripcion,
    criterios: extraerCriterios(cuerpo),
    bruto: lineas.slice(ini, fin).join('\n'),
    linea: ini + 1,          // 1-indexada, para mensajes al humano
    inicio: ini,
    fin,
    origen,
  };
}

/**
 * Busca la tarea siguiente. Dos formatos, en este orden:
 *   1. Un encabezado markdown "## SIGUIENTE TAREA" (el formato que el orquestador quiere).
 *   2. Repliegue: una línea de prosa "SIGUIENTE TAREA OFICIAL: ..." (el formato que hoy tiene
 *      TABLERO.md). Se lee, pero no se puede reescribir sin riesgo: ver updater.marcarHecha.
 */
export function buscarSiguienteTarea(texto) {
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    if (nivelEncabezado(lineas[i]) === 0) continue;
    if (/siguiente\s+tarea/.test(normalizar(tituloEncabezado(lineas[i])))) {
      return tareaDesdeBloque(lineas, i, 'bloque');
    }
  }

  for (let i = 0; i < lineas.length; i++) {
    const m = /siguiente\s+tarea(?:\s+oficial)?\s*:\s*(.+)$/i.exec(normalizar(lineas[i]) === '' ? '' : lineas[i]);
    if (!m) continue;
    const crudo = m[1].replace(/\*+\s*$/, '').replace(/\s*<!--.*$/, '').trim();
    if (!crudo) continue;
    const titulo = crudo.split(/\s+[—–-]\s+/)[0].trim() || crudo;
    return {
      id: slug(titulo),
      titulo,
      descripcion: crudo,
      criterios: [],
      bruto: lineas[i],
      linea: i + 1,
      inicio: i,
      fin: i + 1,
      origen: 'prosa',
    };
  }

  return null;
}

/** Busca una tarea concreta por su id, en cualquier encabezado del documento. */
export function buscarTareaPorId(texto, idPedido) {
  const lineas = texto.split('\n');
  const objetivo = slug(idPedido);

  const exactas = [];
  const parecidas = [];
  for (let i = 0; i < lineas.length; i++) {
    if (nivelEncabezado(lineas[i]) === 0) continue;
    const tarea = tareaDesdeBloque(lineas, i, 'bloque');
    if (tarea.id === objetivo) exactas.push(tarea);
    else if (tarea.id.includes(objetivo) || slug(tituloEncabezado(lineas[i])).includes(objetivo)) {
      parecidas.push(tarea);
    }
  }

  // Entre varias que encajan, gana la más pequeña: es la sección de la tarea,
  // no el capítulo que la contiene.
  const porTamaño = (a, b) => (a.fin - a.inicio) - (b.fin - b.inicio);
  if (exactas.length) return exactas.sort(porTamaño)[0];

  if (parecidas.length === 1) return parecidas[0];
  if (parecidas.length > 1) {
    const lista = parecidas.sort(porTamaño).slice(0, 10)
      .map((c) => `  · ${c.id}  (línea ${c.linea})`).join('\n');
    throw new Error(`«${idPedido}» no es exacto y encaja con ${parecidas.length} tareas. Concreta más:\n${lista}`);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado de git
// ─────────────────────────────────────────────────────────────────────────────

function git(args, cwd = RAIZ) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function esRepo(cwd = RAIZ) {
  try { git(['rev-parse', '--git-dir'], cwd); return true; } catch { return false; }
}

export function cabeza(cwd = RAIZ) {
  return git(['rev-parse', 'HEAD'], cwd).trim();
}

export function rama(cwd = RAIZ) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
}

/** Ficheros con cambios sin confirmar (los del árbol de trabajo y los preparados). */
export function arbolSucio(cwd = RAIZ) {
  return git(['status', '--porcelain'], cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Commits en base..HEAD, del más antiguo al más nuevo. */
export function commitsDesde(base, cwd = RAIZ) {
  const salida = git(['log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', `${base}..HEAD`], cwd);
  return salida
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha, asunto, cuerpo] = r.split('\x1f');
      return { sha, corto: sha.slice(0, 7), asunto: (asunto || '').trim(), cuerpo: (cuerpo || '').trim() };
    });
}

/**
 * Líneas AÑADIDAS en base..HEAD, solo en ficheros de código.
 * Se limita al código a propósito: TABLERO.md y los informes están llenos de prosa
 * en castellano donde "todo" aparece a cada paso.
 */
export function lineasAnadidas(base, cwd = RAIZ) {
  const salida = git(
    ['diff', '--unified=0', '--no-color', `${base}..HEAD`, '--', '*.js', '*.mjs', '*.cjs', '*.ts', '*.mts', '*.jsx', '*.tsx'],
    cwd,
  );
  const anadidas = [];
  let fichero = null;
  let numero = 0;
  for (const linea of salida.split('\n')) {
    if (linea.startsWith('+++ ')) {
      const destino = linea.slice(4).trim();
      fichero = destino === '/dev/null' ? null : destino.replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(linea);
    if (hunk) { numero = Number(hunk[1]); continue; }
    if (linea.startsWith('+') && !linea.startsWith('+++')) {
      if (fichero) anadidas.push({ fichero, numero, texto: linea.slice(1) });
      numero++;
    }
  }
  return anadidas;
}

/** Resuelve una referencia de git (sha, rama, HEAD~3…) o lanza si no existe. */
export function resolver(ref, cwd = RAIZ) {
  try {
    return git(['rev-parse', '--verify', `${ref}^{commit}`], cwd).trim();
  } catch {
    throw new Error(`«${ref}» no es una referencia de git válida en este repo.`);
  }
}
