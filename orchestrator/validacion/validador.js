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
const MARCA_PROMESA = /^#{1,4}\s*LA PROMESA\s*$/im;

// ⚙️ LAS DOS CLASES DE PARADA (1 sep 2026). Antes había UNA sola marca y las dos cosas caían en el
// mismo cajón: el aviso al móvil de Ibrahin decía «No es un error técnico: es una decisión de
// producto» tanto si de verdad hacía falta una decisión suya como si la tarea estaba escrita sobre
// algo que ya no existe. Ese día le llegaron DOS avisos así y NINGUNO era una decisión —las seis
// pantallas llevaban ocho días borradas, y el cifrado estaba mal redactado—.
//
//   · PREMISA FALSA      → la tarea afirma algo que no es cierto. Es basura en el tablero. Se
//                          cierra sola CON SU PRUEBA y no gasta una interrupción de nadie.
//   · DECISIÓN DE IBRAHIN → falta algo que solo él decide. ESTO, y solo esto, sube al móvil.
const MARCA_PREMISA_FALSA = /^\s*🛑\s*PREMISA FALSA/im;
const MARCA_DECISION_IBRAHIN = /^\s*🛑\s*DECISI[ÓO]N DE IBRAHIN/im;

// La prueba y la pregunta son OBLIGATORIAS, cada una en su clase, y con rótulo literal para que se
// puedan leer sin adivinar. Sin prueba no se cierra nada: una tarea que se cierra sola sobre una
// afirmación sin comprobar es peor que dejarla abierta.
const RE_PRUEBA = /^\s*\*\*Prueba:\*\*\s*([\s\S]*?)(?=\n\s*\n|\n\s*\*\*|$)/im;
const RE_PREGUNTA = /^\s*\*\*Pregunta:\*\*\s*([\s\S]*?)(?=\n\s*\n|\n\s*\*\*|$)/im;

/**
 * De qué clase es la parada del arquitecto, y si trae lo que su clase exige.
 *
 * @returns { clase, motivo, prueba, pregunta } — `clase` es 'premisa-falsa',
 *          'decision-de-ibrahin' o 'sin-clasificar'.
 *
 * REGLA DE SEGURIDAD: una premisa falsa SIN prueba **no es una premisa falsa**. Se degrada a
 * 'sin-clasificar' y sube a Ibrahin, que es el camino lento pero el que no destruye nada. Cerrar
 * una tarea sola es irreversible en la práctica —nadie vuelve a mirar lo que se cerró—, así que el
 * error seguro es escalar de más, nunca cerrar de más.
 */
export function clasificarParada(texto) {
  const t = String(texto || '');
  const trozo = (re) => { const m = re.exec(t); return m ? m[1].trim().replace(/\s+/g, ' ') : null; };

  if (MARCA_PREMISA_FALSA.test(t)) {
    const prueba = trozo(RE_PRUEBA);
    const motivo = primerParrafoTras(t, MARCA_PREMISA_FALSA) || 'sin motivo escrito';
    if (!prueba) {
      return { clase: 'sin-clasificar', motivo,
               falta: 'dijo PREMISA FALSA pero NO escribió «**Prueba:**». Sin prueba no se cierra nada.' };
    }
    return { clase: 'premisa-falsa', motivo, prueba };
  }
  if (MARCA_DECISION_IBRAHIN.test(t)) {
    const motivo = primerParrafoTras(t, MARCA_DECISION_IBRAHIN) || 'sin motivo escrito';
    return { clase: 'decision-de-ibrahin', motivo, pregunta: trozo(RE_PREGUNTA) };
  }
  return { clase: 'sin-clasificar', motivo: primerParrafoTras(t, MARCA_PARADA) || 'sin motivo escrito',
           falta: 'usó el rótulo antiguo «🛑 TAREA MAL PLANTEADA», que no dice de qué clase es.' };
}
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
/**
 * PASOS QUE EXIGEN HABLAR CON UNA PERSONA A MITAD. La máquina no tiene con quién parar.
 *
 * ⚙️ DE DÓNDE SALE (2 sep 2026). «Cifrar las copias de seguridad» llevaba dentro un *«para y
 * dime lo que has encontrado antes de seguir»*. El programador se atascó ahí **dos veces
 * seguidas, con seis minutos de diferencia**, sin tocar un solo fichero. No es un fallo suyo:
 * es un plano escrito para una conversación metido en una cadena automática.
 *
 * Los patrones son IMPERATIVOS y de mitad de camino, a propósito. Un análisis puede —y debe—
 * hablar de la firma de Ibrahin al final sin que eso sea una parada: «esta tarea la firma
 * Ibrahin» no es lo mismo que «pregúntale a Ibrahin y espera». La lista se queda corta antes
 * que ancha: un rojo falso aquí cuesta una vuelta entera, que es justo lo que se está quitando.
 */
const PIDEN_PERSONA = [
  { que: 'para y pregunta a mitad',        re: /\bpara\s+y\s+(dime|preg[uú]nta\w*|consulta|espera)\b/i },
  { que: 'no sigue sin respuesta',         re: /\bno\s+(sigas|contin[uú]es|avances)\s+hasta\s+que\s+(te\s+)?(responda|conteste|confirme|diga)\b/i },
  { que: 'antes de seguir, pregunta',      re: /\bantes\s+de\s+seguir[,:]?\s*(dime|preg[uú]nta\w*|consulta|confirma)\b/i },
  { que: 'espera confirmación a mitad',    re: /\bespera\s+(su|mi|la)\s+(respuesta|confirmaci[oó]n|visto\s+bueno)\s+antes\s+de\b/i },
];

export function pasosQuePidenPersona(texto) {
  const t = String(texto || '');
  return PIDEN_PERSONA.filter((p) => p.re.test(t)).map((p) => p.que);
}

export function validarAnalisis(ruta, { minCriterios = 3, firma = '', criteriosTablero = [],
                                        maxCriteriosPropios = Infinity } = {}) {
  if (!fs.existsSync(ruta)) return mal(`No existe el análisis: ${ruta}`, [`el arquitecto no escribió ${ruta}`]);

  const texto = fs.readFileSync(ruta, 'utf8');

  // El arquitecto tiene derecho a parar. No es un fallo: es un resultado. Y desde el 1 sep 2026
  // tiene que decir DE QUÉ CLASE es, porque una premisa falsa y una decisión de producto no van al
  // mismo sitio.
  if (MARCA_PARADA.test(texto) || MARCA_PREMISA_FALSA.test(texto) || MARCA_DECISION_IBRAHIN.test(texto)) {
    const c = clasificarParada(texto);
    const resumen = {
      'premisa-falsa': 'El arquitecto demostró que la tarea parte de algo que no es cierto.',
      'decision-de-ibrahin': 'El arquitecto paró: falta una decisión que solo puede dar Ibrahin.',
      'sin-clasificar': 'El arquitecto declaró la tarea mal planteada, sin decir de qué clase.',
    }[c.clase];
    return { ok: false, paroArquitecto: true, resumen, clase: c.clase,
             prueba: c.prueba || null, pregunta: c.pregunta || null,
             motivos: [c.motivo].concat(c.falta ? [c.falta] : []), texto };
  }

  const propio = texto.trim();
  const motivos = [];
  if (propio.length <= MINIMO_ANALISIS) {
    motivos.push(`el análisis tiene ${propio.length} caracteres y hacen falta más de ${MINIMO_ANALISIS}`);
  }
  if (!PALABRAS_ARQUITECTURA.test(propio)) {
    motivos.push('no menciona capa, patrón, validación ni arquitectura: no es un análisis arquitectónico');
  }

  // ⚙️ SI LA TAREA LA FIRMA IBRAHIN, LA PROMESA ES OBLIGATORIA (1 sep 2026).
  // Sin ella, el aviso que le llega al móvil no puede contarle qué está firmando, y la respuesta
  // correcta de una persona ante eso es no firmar. O sea: un análisis sin promesa cuesta la tarea
  // entera. Se exige aquí, con el mismo peso que los criterios de aceptación.
  if (firma && !MARCA_PROMESA.test(texto)) {
    motivos.push('ESTA TAREA LA FIRMA ' + firma.toUpperCase() + ' Y NO TRAE «## LA PROMESA». '
      + 'Escribe ese apartado con qué cambia para quien usa Bamburu, qué se le garantiza y qué pasa '
      + 'si falla. Sin código: es lo que le llega al móvil y lo único que puede juzgar.');
  }

  const criterios = extraerCriterios(texto);
  if (criterios.length === 0) {
    motivos.push('NO TRAE CRITERIOS DE ACEPTACIÓN. Escríbelos como casillas «- [ ] ...» bajo un apartado «Criterios de aceptación». Sin ellos el revisor no puede juzgar nada y el análisis no vale.');
  } else if (criterios.length < minCriterios) {
    motivos.push(`solo trae ${criterios.length} criterio(s) de aceptación y hacen falta al menos ${minCriterios}`);
  }

  // ── EL PLANO SE COMPRUEBA CONTRA SÍ MISMO, antes de dárselo al programador ──
  const persona = pasosQuePidenPersona(texto);
  if (persona.length) {
    motivos.push('EL PLANO EXIGE HABLAR CON UNA PERSONA A MITAD, y aquí no hay nadie con quien parar: '
      + persona.join(', ') + '. Si de verdad falta una decisión, PARA la tarea y dilo con «premisa falsa» '
      + 'o «decisión de Ibrahin»; lo que no puede es quedarse escrito dentro de un paso.');
  }

  // Y que no pida trabajo FUERA del cambio. El dato: la única tarea que salió a la primera fue
  // la única cuyo plano pedía una cosa y nada más; el formato del dinero, que es lo más sencillo
  // que se ha hecho, costó cuatro intentos y un replanteamiento por lo que el plano exigía
  // alrededor. Los de Ibrahin no cuentan aquí: son el encargo. Se cuentan los AÑADIDOS.
  //
  // ⚠️ Y SOLO CUANDO EL TABLERO TRAE CRITERIOS. Si no trae ninguno, escribirlos ES el trabajo del
  // arquitecto —lo dice su propio encargo— y contarlos como «añadidos» tumbaría cualquier
  // análisis honesto con más de tres. Estuvo a punto de pasar con el manifiesto de huellas.
  const esDelTablero = (c) => criteriosTablero.some((t) => {
    const a = aplanar(c.texto); const b = aplanar(t.texto);
    return b.length >= 12 && (a.includes(b) || b.includes(a));
  });
  const propios = criterios.filter((c) => !esDelTablero(c));
  if (criteriosTablero.length && Number.isFinite(maxCriteriosPropios) && propios.length > maxCriteriosPropios) {
    motivos.push(`AÑADES ${propios.length} criterios tuyos sobre los ${criteriosTablero.length} del tablero, y el tope son `
      + `${maxCriteriosPropios}. Cada criterio de más es trabajo fuera del cambio que se pidió, y es lo que `
      + 'hace que una tarea dé cuatro vueltas. Deja lo que hace falta para que el cambio esté bien hecho.');
  }

  // Y AQUÍ SE PARA EL CAMBIAZO, antes de gastar una construcción. Si falta uno de los de
  // Ibrahin, el análisis no vale por bueno que sea el resto.
  const sinReproducir = criteriosDelTableroQueFaltan(texto, criteriosTablero);
  if (sinReproducir.length) {
    motivos.push(`FALTAN ${sinReproducir.length} CRITERIO(S) DEL TABLERO. Los de Ibrahin se copian TAL CUAL `
      + 'en «Criterios de aceptación» y los tuyos van debajo. No se quitan, no se sustituyen y no se '
      + 'rebajan: si crees que uno está mal planteado, para y dilo, no lo reescribas.');
    for (const c of sinReproducir) motivos.push(`  falta, literal: «${c}»`);
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
export function validarRevision(ruta, { criterios = [], criteriosTablero = [] } = {}) {
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

  // ⚙️ Y LOS DE IBRAHIN SE JUZGAN UNO A UNO, SIEMPRE (2 sep 2026). Van aparte de los del
  // arquitecto y con su propio motivo de rechazo, porque son los que de verdad deciden si la
  // tarea está hecha. Un aprobado que no se pronuncia sobre uno de ellos no es un aprobado:
  // es un aprobado sobre otra tarea. Los del arquitecto son un añadido; éstos son el encargo.
  const deIbrahin = criteriosCubiertos(texto, criteriosTablero);
  if (criteriosTablero.length && deIbrahin.faltan.length) {
    return mal('Aprueba sin decir qué pasa con cada criterio DEL TABLERO.',
      [`no se pronuncia sobre ${deIbrahin.faltan.length} de los ${criteriosTablero.length} criterios que puso Ibrahin`,
       ...deIbrahin.faltan.map((c) => `  sin juzgar: «${String(c).slice(0, 160)}»`),
       'la tabla de la revisión tiene que llevarlos, uno por fila, con SÍ o NO y su prueba']);
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
 * LA LISTA DEL TABLERO MANDA. Devuelve los criterios de Ibrahin que el texto NO reproduce.
 *
 * ⚙️ DE DÓNDE SALE (2 sep 2026, el peor fallo que ha tenido la fábrica). El revisor juzgaba la
 * lista de criterios que escribe el ARQUITECTO, no la del tablero, y nadie comparaba las dos.
 * En «Cifrar las copias de seguridad» el criterio 1 de Ibrahin era **«las dos copias suben
 * cifradas»** y el que se juzgó fue **«hoy sigue habiendo copia»**. No son variantes del mismo
 * requisito: son requisitos OPUESTOS —uno exige que salga cifrada, el otro que siga funcionando
 * sin cifrar—. El revisor comprobó bien, con pruebas de verdad, y aprobó otra cosa. La tarea
 * consta hecha, se subió dos veces, y las copias siguen en claro.
 *
 * SE EXIGE REPRODUCCIÓN LITERAL, y es a propósito. Comparar «parecidos» es lo que permitió el
 * cambiazo: cualquier medida de parecido tiene un umbral, y por debajo del umbral cabe un
 * requisito contrario. Copiar una línea no cuesta nada y no admite interpretación. El arquitecto
 * puede AÑADIR los criterios técnicos que quiera debajo; lo que no puede es quitar ni rebajar.
 *
 * La comparación se hace sobre texto aplanado —sin acentos, sin énfasis de markdown y con los
 * espacios colapsados— para no rechazar por un asterisco de más. Y por SUBCADENA, porque el
 * tablero corta los criterios largos por la primera línea: el fragmento tiene que estar dentro.
 */
export function criteriosDelTableroQueFaltan(texto, criteriosTablero = []) {
  const t = aplanar(texto);
  const faltan = [];
  for (const c of criteriosTablero) {
    const n = aplanar(c.texto);
    // Un criterio de tres palabras no se puede exigir literal sin provocar falsos rojos.
    if (n.length < 12) continue;
    if (!t.includes(n)) faltan.push(c.texto);
  }
  return faltan;
}

const aplanar = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[`*_~]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

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
