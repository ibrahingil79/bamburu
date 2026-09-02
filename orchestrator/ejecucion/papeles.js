// papeles.js — Compone el prompt de cada papel. Solo texto: no llama a nadie.
//
// Los tres papeles son el mismo `claude -p` con instrucciones distintas, y esas
// instrucciones viven en ficheros versionados (orchestrator/roles/*.md). Aquí solo se
// rellenan los huecos y se le añade el contexto de ESTA tarea y ESTE intento.
import fs from 'node:fs';
import { ErrorOrquestador, CLASES } from '../nucleo/errores.js';

const cache = new Map();

export function cargarPapel(ruta) {
  if (cache.has(ruta)) return cache.get(ruta);
  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); }
  catch (e) { throw new ErrorOrquestador(CLASES.CONFIGURACION, `no pude leer el papel ${ruta}: ${e.message}`); }
  cache.set(ruta, texto);
  return texto;
}

export function olvidarPapeles() { cache.clear(); }

function rellenar(plantilla, valores) {
  return plantilla.replace(/\{\{(\w+)\}\}/g, (m, clave) => (clave in valores ? String(valores[clave]) : m));
}

function bloqueTarea(tarea) {
  // ⚙️ ESTOS CRITERIOS SON DE IBRAHIN, Y SE DICE (2 sep 2026). Antes iban bajo el rótulo
  // «Criterios que ya trae el tablero», que suena a sugerencia. No lo son: son el encargo, y
  // el arquitecto los reproduce LITERALMENTE o el análisis no pasa. Un criterio a medias `[~]`
  // se marca como tal, porque un criterio a medias FRENA el cierre.
  const criterios = tarea.criterios?.length
    ? tarea.criterios.map((c) => `- [${c.aMedias ? '~' : c.hecho ? 'x' : ' '}] ${c.texto}`).join('\n')
    : '(el tablero no trae criterios: los escribes tú, es tu trabajo)';
  return [
    '## La tarea',
    '',
    `- **id:** \`${tarea.id}\``,
    `- **título:** ${tarea.titulo}`,
    '',
    '**Descripción**',
    '',
    tarea.descripcion || '(sin descripción)',
    '',
    '**LOS CRITERIOS DE IBRAHIN — mandan sobre todo lo demás**',
    '',
    criterios,
    '',
    '> Éstos **no se tocan**. El arquitecto los copia TAL CUAL en su apartado de criterios de',
    '> aceptación y añade los suyos debajo; el revisor tiene que decir qué pasa con **cada uno**,',
    '> con SÍ o NO y su prueba. Quitar, sustituir o rebajar uno invalida el análisis — y si uno',
    '> te parece mal planteado, **paras y lo dices**, no lo reescribes.',
    '> Un criterio marcado `[~]` está A MEDIAS: mientras siga así, la tarea **no se puede cerrar**.',
  ].join('\n');
}

/** El historial de rechazos, que es lo que convierte un reintento en algo distinto del anterior. */
function bloqueHistorial(historial) {
  if (!historial?.length) return '';
  const lineas = historial.map((h, i) => {
    const motivos = h.motivos?.length ? h.motivos.map((m) => `    - ${m}`).join('\n') : '    - (sin motivos escritos)';
    return `**Intento ${h.intento}** — ${h.veredicto}\n${motivos}`;
  });
  return ['## Lo que ya se intentó', '', ...lineas].join('\n\n');
}

export function componer({ papel, rutaPapel, tarea, rutas, estado, extra = {} }) {
  const base = rellenar(cargarPapel(rutaPapel), {
    RUTA_ANALISIS: rutas.analisis,
    RUTA_REVIEW: rutas.review,
    RUTA_INFORME: rutas.informe,
    TASK_ID: tarea.id,
  });

  const trozos = [base, '', '---', '', bloqueTarea(tarea)];

  if (papel === 'arquitecto' && estado.replanteos > 0) {
    trozos.push('', '---', '', '## ESTO ES UN REPLANTEAMIENTO', '',
      `Ya se intentó ${estado.historial.length} vez/veces y no salió. Lee el historial y cambia el ENFOQUE, no las palabras.`,
      '', bloqueHistorial(estado.historial));
  }

  if (papel === 'programador' && extra.motivos?.length) {
    trozos.push('', '---', '', '## VIENES DE UN RECHAZO — corrige exactamente esto', '',
      extra.motivos.map((m) => `- ${m}`).join('\n'),
      '', `El texto completo del revisor está en: ${rutas.review}`);
  }

  if (extra.rehacer && extra.motivos?.length) {
    trozos.push('', '---', '', '## TU ENTREGA ANTERIOR NO VALIÓ', '',
      extra.motivos.map((m) => `- ${m}`).join('\n'),
      '', 'Rehazla entera arreglando eso.');
  }

  if (papel === 'revisor') {
    trozos.push('', '---', '', '## Qué hay que revisar', '',
      `- Análisis pactado: \`${rutas.analisis}\``,
      `- Commits desde: \`${extra.base || 'HEAD~1'}\``,
      extra.commits?.length
        ? `- Commits:\n${extra.commits.map((c) => `  - \`${c.corto}\` ${c.asunto}`).join('\n')}`
        : '- Commits: (ninguno)',
      '', `Míralos con: \`git diff ${extra.base || 'HEAD~1'}..HEAD\``);
  }

  return trozos.join('\n');
}
