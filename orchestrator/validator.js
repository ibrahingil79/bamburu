// validator.js — Comprueba análisis, código y revisión. Devuelve veredictos, no lanza.
import fs from 'node:fs';
import { commitsDesde, lineasAnadidas } from './reader.js';

export const MARCA_INICIO = '<!-- ORQUESTADOR:PLANTILLA-INICIO -->';
export const MARCA_FIN = '<!-- ORQUESTADOR:PLANTILLA-FIN -->';

const MINIMO_ANALISIS = 500;
const PALABRAS_ANALISIS = /capa|patr[oó]n|validaci[oó]n|arquitectura/i;

// Escritos con clase de caracteres a propósito: si el literal apareciera aquí,
// este mismo fichero haría fallar la comprobación al pasar por el diff.
const PROHIBIDOS = [
  { nombre: 'console.log', regex: /console\s*\.\s*log\s*\(/ },
  { nombre: 'TO' + 'DO', regex: /\bTO[D]O\b/ },
];

function ok(resumen, detalles = []) { return { ok: true, resumen, detalles }; }
function mal(resumen, detalles = []) { return { ok: false, resumen, detalles }; }

/** Quita el bloque de plantilla que escribió el orquestador, para no contarlo como trabajo del arquitecto. */
export function sinPlantilla(texto) {
  const i = texto.indexOf(MARCA_INICIO);
  const j = texto.indexOf(MARCA_FIN);
  if (i === -1 || j === -1 || j < i) return texto;
  return (texto.slice(0, i) + texto.slice(j + MARCA_FIN.length)).trim();
}

/**
 * ANÁLISIS: existe, más de 500 caracteres propios, y habla de arquitectura.
 */
export function validarAnalisis(ruta) {
  if (!fs.existsSync(ruta)) return mal(`No existe el análisis: ${ruta}`);

  const bruto = fs.readFileSync(ruta, 'utf8');
  const propio = sinPlantilla(bruto).trim();

  if (propio.length === 0) {
    return mal('El análisis sigue siendo la plantilla vacía: el arquitecto no ha escrito nada.');
  }
  if (propio.length <= MINIMO_ANALISIS) {
    return mal(
      `El análisis tiene ${propio.length} caracteres propios y hacen falta más de ${MINIMO_ANALISIS}.`,
      ['Sin contar el bloque de plantilla que dejó el orquestador.'],
    );
  }
  if (!PALABRAS_ANALISIS.test(propio)) {
    return mal(
      'El análisis no menciona ninguna de: «capa», «patrón», «validación», «arquitectura».',
      ['No es un análisis arquitectónico si no nombra la arquitectura.'],
    );
  }
  return ok(`Análisis válido: ${propio.length} caracteres propios.`);
}

/**
 * CÓDIGO: al menos un commit nuevo, el taskId citado en algún mensaje,
 * y ningún console.log ni marca de pendiente en las líneas añadidas de código.
 */
export function validarCodigo({ base, taskId, cwd }) {
  const commits = commitsDesde(base, cwd);

  if (commits.length === 0) {
    return mal(`No hay ningún commit nuevo desde ${base.slice(0, 7)}.`, [
      'El programador no ha confirmado nada, o lo dejó sin confirmar en el árbol de trabajo.',
    ]);
  }

  const cita = commits.filter((c) => `${c.asunto}\n${c.cuerpo}`.toLowerCase().includes(taskId.toLowerCase()));
  if (cita.length === 0) {
    return mal(
      `Ninguno de los ${commits.length} commits nuevos menciona «${taskId}» en su mensaje.`,
      commits.map((c) => `  ${c.corto}  ${c.asunto}`),
    );
  }

  const sucias = [];
  for (const linea of lineasAnadidas(base, cwd)) {
    for (const p of PROHIBIDOS) {
      if (p.regex.test(linea.texto)) {
        sucias.push(`  ${linea.fichero}:${linea.numero}  [${p.nombre}]  ${linea.texto.trim().slice(0, 100)}`);
      }
    }
  }
  if (sucias.length) {
    return mal(`Hay ${sucias.length} línea(s) añadidas con restos que no deben quedar:`, sucias);
  }

  return ok(
    `${commits.length} commit(s) nuevos, ${cita.length} citando «${taskId}», sin restos en el código.`,
    commits.map((c) => `  ${c.corto}  ${c.asunto}`),
  );
}

/**
 * REVISIÓN: tiene que pronunciarse, y solo una vez.
 */
export function validarReview(ruta) {
  if (!fs.existsSync(ruta)) return mal(`No existe la revisión: ${ruta}`);

  const texto = fs.readFileSync(ruta, 'utf8');
  const aprobado = texto.includes('✅ APROBADO');
  const rechazado = texto.includes('❌ RECHAZADO');

  if (aprobado && rechazado) {
    return mal('La revisión dice «✅ APROBADO» y «❌ RECHAZADO» a la vez. Ambigua: no continúo.');
  }
  if (aprobado) return { ...ok('Revisión: ✅ APROBADO.'), veredicto: 'aprobado', texto };
  if (rechazado) return { ...ok('Revisión: ❌ RECHAZADO.'), veredicto: 'rechazado', texto };

  const pistas = [];
  if (/\bAPROBADO\b/.test(texto)) pistas.push('Aparece «APROBADO» pero sin el ✅ delante.');
  if (/\bRECHAZADO\b/.test(texto)) pistas.push('Aparece «RECHAZADO» pero sin el ❌ delante.');
  return mal('La revisión no contiene ni «✅ APROBADO» ni «❌ RECHAZADO».', pistas);
}
