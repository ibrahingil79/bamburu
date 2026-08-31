// validador.js — Juzga las entregas. Funciones puras sobre texto: se prueban sin nada montado.
//
// Reutiliza `validarCodigo` del validator.js anterior (la parte de git estaba bien hecha) y
// añade lo que el encargo hace obligatorio: criterios de aceptación en el análisis, y un
// veredicto con motivos de una lista cerrada.
import fs from 'node:fs';
import { validarCodigo } from '../validator.js';

export { validarCodigo };

export const MOTIVOS_RECHAZO = Object.freeze(['CRITERIO-INCUMPLIDO', 'FUERA-DE-ALCANCE', 'SIN-PRUEBAS', 'NIVEL-INSUFICIENTE']);

const MINIMO_ANALISIS = 800;
const PALABRAS_ARQUITECTURA = /\b(capa|patr[oó]n|validaci[oó]n|arquitectura|acoplamiento|contrato)\b/i;
const MARCA_PARADA = /^\s*🛑\s*TAREA MAL PLANTEADA/im;
const MARCA_REPLANTEO = /^\s*♻️\s*REPLANTEAMIENTO/im;
const MARCA_IMPOSIBLE = /^\s*🛑\s*AN[ÁA]LISIS IMPOSIBLE/im;

const ok = (resumen, extra = {}) => ({ ok: true, resumen, motivos: [], ...extra });
const mal = (resumen, motivos = [], extra = {}) => ({ ok: false, resumen, motivos, ...extra });

/** Casillas markdown `- [ ] texto` bajo un encabezado que hable de criterios (o en todo el texto). */
export function extraerCriterios(texto) {
  const lineas = String(texto).split('\n');
  const idx = lineas.findIndex((l) => /criterios?\s+de\s+aceptaci[oó]n/i.test(l));
  const ambito = idx === -1 ? lineas : lineas.slice(idx);
  const fuera = [];
  for (const l of ambito) {
    const m = /^\s*[-*+]\s*\[( |x|X)\]\s*(.+?)\s*$/.exec(l);
    if (m && m[2].trim().length >= 10) fuera.push({ hecho: m[1].toLowerCase() === 'x', texto: m[2].trim() });
  }
  return fuera;
}

/**
 * ANÁLISIS. Sin criterios de aceptación se rechaza: es la regla que sostiene todo lo demás,
 * porque el revisor no tiene contra qué juzgar.
 */
export function validarAnalisis(ruta, { minCriterios = 3 } = {}) {
  if (!fs.existsSync(ruta)) return mal(`No existe el análisis: ${ruta}`, [`el arquitecto no escribió ${ruta}`]);

  const texto = fs.readFileSync(ruta, 'utf8');

  // El arquitecto tiene derecho a parar. No es un fallo: es un resultado.
  if (MARCA_PARADA.test(texto)) {
    return { ok: false, paroArquitecto: true, resumen: 'El arquitecto declaró la tarea mal planteada.',
             motivos: [primerParrafoTras(texto, MARCA_PARADA) || 'sin motivo escrito'], texto };
  }

  const propio = texto.trim();
  const motivos = [];
  if (propio.length <= MINIMO_ANALISIS) {
    motivos.push(`el análisis tiene ${propio.length} caracteres y hacen falta más de ${MINIMO_ANALISIS}`);
  }
  if (!PALABRAS_ARQUITECTURA.test(propio)) {
    motivos.push('no menciona capa, patrón, validación ni arquitectura: no es un análisis arquitectónico');
  }

  const criterios = extraerCriterios(texto);
  if (criterios.length === 0) {
    motivos.push('NO TRAE CRITERIOS DE ACEPTACIÓN. Escríbelos como casillas «- [ ] ...» bajo un apartado «Criterios de aceptación». Sin ellos el revisor no puede juzgar nada y el análisis no vale.');
  } else if (criterios.length < minCriterios) {
    motivos.push(`solo trae ${criterios.length} criterio(s) de aceptación y hacen falta al menos ${minCriterios}`);
  }

  if (motivos.length) return mal(`El análisis no vale (${motivos.length} motivo/s).`, motivos, { criterios, texto });
  return ok(`Análisis válido: ${propio.length} caracteres, ${criterios.length} criterios de aceptación.`,
            { criterios, texto, replanteo: MARCA_REPLANTEO.test(texto) });
}

/** ¿El programador dijo que el análisis es imposible? Es un resultado, no un fallo. */
export function detectarAnalisisImposible(ruta) {
  if (!fs.existsSync(ruta)) return null;
  const texto = fs.readFileSync(ruta, 'utf8');
  if (!MARCA_IMPOSIBLE.test(texto)) return null;
  return { motivo: primerParrafoTras(texto, MARCA_IMPOSIBLE) || 'sin motivo escrito', texto };
}

/**
 * REVISIÓN. Tiene que pronunciarse, una sola vez, y si rechaza tiene que decir por qué
 * con una etiqueta de la lista cerrada.
 */
export function validarRevision(ruta, { criterios = [] } = {}) {
  if (!fs.existsSync(ruta)) return mal(`No existe la revisión: ${ruta}`, [`el revisor no escribió ${ruta}`]);

  const texto = fs.readFileSync(ruta, 'utf8');
  const aprobado = texto.includes('✅ APROBADO');
  const rechazado = texto.includes('❌ RECHAZADO');

  if (aprobado && rechazado) {
    return mal('La revisión dice «✅ APROBADO» y «❌ RECHAZADO» a la vez: es ambigua.',
      ['el documento contiene las dos cadenas de veredicto; escribe solo una']);
  }
  if (!aprobado && !rechazado) {
    const pistas = [];
    if (/\bAPROBADO\b/.test(texto)) pistas.push('aparece «APROBADO» pero sin el ✅ delante');
    if (/\bRECHAZADO\b/.test(texto)) pistas.push('aparece «RECHAZADO» pero sin el ❌ delante');
    return mal('La revisión no trae veredicto legible.',
      [...pistas, 'la primera línea tiene que ser exactamente «✅ APROBADO» o «❌ RECHAZADO»']);
  }

  const etiquetas = MOTIVOS_RECHAZO.filter((m) => texto.includes(m));
  const cubiertos = criteriosCubiertos(texto, criterios);

  if (rechazado) {
    if (!etiquetas.length) {
      return mal('Rechaza pero no cita ningún motivo de la lista cerrada.',
        [`un rechazo tiene que citar al menos uno de: ${MOTIVOS_RECHAZO.join(', ')}`]);
    }
    return { ok: true, veredicto: 'rechazado', etiquetas, texto, cubiertos,
             resumen: `Revisión: ❌ RECHAZADO (${etiquetas.join(', ')}).`,
             motivos: extraerPuntosDeRechazo(texto, etiquetas) };
  }

  // Un aprobado sin la tabla de criterios no vale: es justo la constancia de que miró.
  if (criterios.length && cubiertos.faltan.length) {
    return mal('Aprueba sin pronunciarse sobre todos los criterios de aceptación.',
      [`no se pronuncia sobre ${cubiertos.faltan.length} criterio(s): ${cubiertos.faltan.slice(0, 3).map((c) => `«${c.slice(0, 60)}»`).join('; ')}`,
       'un aprobado necesita la tabla con los criterios uno a uno']);
  }
  return { ok: true, veredicto: 'aprobado', etiquetas: [], texto, cubiertos,
           resumen: `Revisión: ✅ APROBADO (${criterios.length} criterio/s revisados).`, motivos: [] };
}

/**
 * ¿Se pronuncia sobre cada criterio? Se comprueba por solapamiento de palabras largas, no por
 * cadena exacta: el revisor los reescribe al ponerlos en la tabla, y exigir literalidad haría
 * fallar revisiones correctas. Umbral bajo a propósito — esto detecta un criterio OLVIDADO,
 * no juzga la calidad de la revisión.
 */
export function criteriosCubiertos(textoRevision, criterios) {
  const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rev = norm(textoRevision);
  const faltan = [];
  for (const c of criterios) {
    const palabras = norm(c.texto).split(/[^a-z0-9]+/).filter((w) => w.length >= 5);
    if (!palabras.length) continue;
    const encontradas = palabras.filter((w) => rev.includes(w)).length;
    if (encontradas / palabras.length < 0.4) faltan.push(c.texto);
  }
  return { total: criterios.length, faltan };
}

/** Los puntos del rechazo, para dárselos al programador tal cual. */
function extraerPuntosDeRechazo(texto, etiquetas) {
  const puntos = [];
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    if (!etiquetas.some((e) => lineas[i].includes(e))) continue;
    const cabecera = lineas[i].replace(/^#+\s*/, '').trim();
    const cuerpo = [];
    for (let j = i + 1; j < lineas.length && cuerpo.length < 6; j++) {
      if (/^#{1,6}\s/.test(lineas[j])) break;
      if (lineas[j].trim()) cuerpo.push(lineas[j].trim());
    }
    puntos.push(cuerpo.length ? `${cabecera} — ${cuerpo.join(' ')}`.slice(0, 600) : cabecera);
  }
  if (!puntos.length) puntos.push(texto.trim().slice(0, 800));
  return puntos;
}

function primerParrafoTras(texto, regex) {
  const m = regex.exec(texto);
  if (!m) return null;
  const resto = texto.slice(m.index + m[0].length).trim();
  return resto.split(/\n\s*\n/)[0]?.trim().slice(0, 600) || null;
}
