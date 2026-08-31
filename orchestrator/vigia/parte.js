// parte.js — Redacta el parte y lo entrega. Si no se puede entregar, lo guarda.
//
// La cola de pendientes es la razón de ser de este módulo: el encargo dice que con Telegram
// caído o sin configurar el ciclo NO se detiene. Así que el parte se escribe siempre, se
// intenta mandar, y si no sale se guarda para el próximo intento. Nunca se pierde.
import { leerLineas, escribirAtomico } from '../nucleo/almacen.js';
import { enviar, configurado, queFalta } from './telegram.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function desdeHace(iso, ahora = Date.now()) {
  if (!iso) return 'no sé desde cuándo';
  const min = Math.round((ahora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h ${min % 60} min` : `hace ${Math.floor(h / 24)} d ${h % 24} h`;
}

const NOMBRE_PASO = {
  OCIOSO: 'esperando tarea', ANALISIS: 'analizando', VALIDAR_ANALISIS: 'revisando el análisis',
  CONSTRUCCION: 'construyendo', VALIDAR_CODIGO: 'comprobando el código',
  REVISION: 'revisando', VALIDAR_REVISION: 'leyendo el veredicto',
  CIERRE: 'cerrando la tarea', ESPERANDO_CUOTA: 'parado esperando cuota',
};

/**
 * Redacta el parte. Función pura: se le pasa todo y devuelve texto. Se prueba sin red.
 */
export function redactar({ estado, cuota, historialReciente, tareaEnTablero, pendientesEnTablero = [], averia = null, desde, ahora = Date.now(), config }) {
  const L = [];
  const t = (s) => L.push(s);

  t('<b>🤖 Parte del orquestador</b>');
  t(`<i>Últimas ${Math.round(config.vigia.intervaloParteMs / 3600000)} horas</i>`);
  t('');

  // 0 · La avería va ARRIBA DEL TODO, antes que lo terminado. Un sistema parado teniendo
  // trabajo no es una nota al pie: es la única noticia del parte.
  if (averia) {
    t('<b>🚨 AVERÍA — NO estoy ocioso, estoy parado</b>');
    t(esc(averia.motivo));
    for (const n of averia.nombres || []) t(`• sin coger: ${esc(n)}`);
    t('<i>El tablero tiene trabajo y no consigo cogerlo. Esto no se arregla solo.</i>');
    t('');
  }

  // 1 · Terminado
  const hechas = historialReciente.filter((h) => h.resultado === 'cerrada');
  if (hechas.length) {
    t(`<b>✅ Terminado (${hechas.length})</b>`);
    for (const h of hechas) t(`• ${esc(h.titulo)}${h.subida === false ? ' <i>(hecho, pendiente de subir)</i>' : ''}`);
  } else {
    t('<b>✅ Terminado</b>');
    t('• Nada nuevo desde el último parte.');
  }
  t('');

  // 2 · Lo que se arregló solo
  const arreglos = historialReciente.filter((h) => h.resultado !== 'tablero-saneado' && ((h.intentos > 1) || h.replanteos > 0));
  if (arreglos.length) {
    t('<b>🔧 Resuelto sin molestarte</b>');
    for (const h of arreglos) {
      const partes = [];
      if (h.intentos > 1) partes.push(`${h.intentos - 1} rechazo(s) corregido(s)`);
      if (h.replanteos > 0) partes.push(`${h.replanteos} replanteamiento(s)`);
      t(`• ${esc(h.titulo)}: ${partes.join(' y ')}`);
    }
    t('');
  }

  // 2-bis · Lo que el sistema se arregló del tablero. Va en el parte y NO como pregunta:
  // el formato del documento no es decisión de Ibrahin.
  const saneos = historialReciente.filter((h) => h.resultado === 'tablero-saneado');
  if (saneos.length) {
    const todos = saneos.flatMap((h) => h.arreglos || []);
    t('<b>🧹 Del tablero, arreglado solo</b>');
    for (const a of todos.slice(0, 6)) t(`• ${esc(a.que)} → ${esc(a.comoQueda)}`);
    if (todos.length > 6) t(`• …y ${todos.length - 6} más`);
    t('<i>Son cosas de cómo estaba escrito el documento, no de qué hay que construir.</i>');
    t('');
  }

  // 3 · En curso
  t('<b>⏳ Ahora mismo</b>');
  if (estado.esperandoCuota) {
    t(`• Parado esperando cuota, ${desdeHace(estado.esperaDesde, ahora)}.`);
    if (estado.tarea) t(`• La tarea «${esc(estado.tarea.titulo)}» queda a medio hacer, en: ${NOMBRE_PASO[estado.paso] || estado.paso}.`);
    if (cuota?.reinicioSesion) t(`• Calculo volver cuando se reinicie: ${esc(cuota.reinicioSesion)}.`);
  } else if (estado.tarea) {
    t(`• <b>${esc(estado.tarea.titulo)}</b>`);
    t(`• Va por: ${NOMBRE_PASO[estado.paso] || estado.paso}, ${desdeHace(estado.pasoDesde, ahora)}.`);
    if (estado.intento > 1) t(`• Intento ${estado.intento}${estado.replanteos ? ` (replanteada ${estado.replanteos} vez/veces)` : ''}.`);
  } else {
    t('• Sin tarea entre manos.');
  }
  t('');

  // 4 · Pendiente
  t('<b>📋 Pendiente</b>');
  // Se dice CUÁNTAS quedan, no solo cuál es la siguiente: «el tablero no ofrece ninguna tarea
  // más» era la frase que el 31 ago 2026 habría tapado la avería, dicha con toda tranquilidad.
  const nPend = pendientesEnTablero.length;
  if (tareaEnTablero) {
    t(`• Siguiente en el tablero: ${esc(tareaEnTablero.titulo)}`);
    if (nPend > 1) t(`• Quedan ${nPend} pendientes en total.`);
  } else if (nPend) {
    t(`• ⚠️ El tablero tiene ${nPend} pendiente(s) y no puedo coger ninguna.`);
  } else {
    t('• El tablero no ofrece ninguna tarea más.');
  }
  t('');

  // 5 · Apartadas — lo único que pide decisión
  if (estado.apartadas?.length) {
    t('<b>⛔ Esperando decisión tuya</b>');
    for (const a of estado.apartadas.slice(-5)) {
      t(`• <b>${esc(a.titulo)}</b>: ${esc(a.motivo)}`);
    }
    t('');
  }

  // 6 · Cuota
  t('<b>🔋 Cuota</b>');
  if (cuota?.fiable) {
    const gasto = desde?.sesionPct != null ? cuota.sesionPct - desde.sesionPct : null;
    if (gasto != null) t(`• Estas horas se ha gastado: ${gasto >= 0 ? gasto.toFixed(0) : '—'} puntos.`);
    t(`• Queda ${(100 - cuota.sesionPct).toFixed(0)}% de la ventana corta${cuota.reinicioSesion ? ` (se reinicia ${esc(cuota.reinicioSesion)})` : ''}.`);
    if (cuota.semanaPct != null) t(`• Queda ${(100 - cuota.semanaPct).toFixed(0)}% de la semanal.`);
  } else {
    t(`• No he podido leerla: ${esc(cuota?.motivo || 'sin detalle')}.`);
  }
  t('');

  // 7 · Subida
  if (estado.subidaPendiente) {
    t('<b>⚠️ GitHub</b>');
    t(`• Hay trabajo aprobado sin subir: ${esc(estado.ultimoFalloSubida?.motivo || 'sin detalle')}`);
    t('• Lo reintento solo en la siguiente tarea.');
    t('');
  }

  return L.join('\n').trim();
}

/** Aviso suelto. Solo para una cosa: una tarea apartada que necesita decisión. */
export function redactarApartada({ tarea, motivo, historial }) {
  const L = ['<b>⛔ Una tarea necesita tu decisión</b>', ''];
  L.push(`<b>${esc(tarea.titulo)}</b>`, '');
  L.push(`<b>Qué se pidió:</b> ${esc(tarea.descripcion || tarea.titulo).slice(0, 400)}`);
  L.push(`<b>Por qué no sale:</b> ${esc(motivo)}`);
  if (historial?.length) {
    L.push('', '<b>Qué se intentó:</b>');
    for (const h of historial.slice(-4)) {
      L.push(`• Intento ${h.intento}: ${esc((h.motivos || []).join('; ')).slice(0, 200) || esc(h.veredicto)}`);
    }
  }
  L.push('', '<i>No es un error técnico: es una decisión de producto. El sistema sigue con la siguiente tarea.</i>');
  return L.join('\n');
}

/**
 * Aviso suelto de AVERÍA. Sale al momento, sin esperar al parte de las 3 horas, porque el
 * sistema está parado teniendo trabajo y cada hora de silencio es una hora perdida.
 *
 * Sale UNA vez por avería distinta (lo controla ciclo.js): si no, serían 60 mensajes por hora.
 */
export function redactarAveria({ motivo, nombres = [], pendientes = 0 }) {
  const L = ['<b>🚨 El orquestador está parado, no ocioso</b>', ''];
  L.push(esc(motivo), '');
  if (nombres.length) {
    L.push('<b>Lo que hay en el tablero y no cojo:</b>');
    for (const n of nombres) L.push(`• ${esc(n)}`);
    if (pendientes > nombres.length) L.push(`• …y ${pendientes - nombres.length} más`);
    L.push('');
  }
  L.push('<i>Antes esto se veía igual que estar ocioso y no se avisaba: el sistema daba vueltas');
  L.push('cada minuto en silencio. Ahora se dice.</i>');
  return L.join('\n');
}

/**
 * Entrega con cola. Se intenta mandar lo pendiente primero (en orden) y luego lo nuevo.
 * Nunca lanza. Devuelve qué pasó, para que el ciclo lo registre y siga.
 */
export async function entregar({ texto, config, entorno = process.env, logger }) {
  const ruta = config.rutasAbs.partesPendientes;
  const pendientes = leerLineas(ruta);

  if (!configurado(config, entorno)) {
    guardar(ruta, pendientes, { texto, cuando: new Date().toISOString() }, config);
    logger?.aviso(`Vigía sin configurar (falta ${queFalta(config, entorno).join(' y ')}): el parte queda guardado.`);
    return { ok: false, guardado: true, pendientes: pendientes.length + 1, motivo: 'sin configurar' };
  }

  const cola = [...pendientes, { texto, cuando: new Date().toISOString() }];
  const quedan = [];
  let enviados = 0;

  for (const p of cola) {
    if (quedan.length) { quedan.push(p); continue; }   // si uno falla, el resto espera: se mantiene el orden
    const r = await enviar({ texto: p.texto, config, entorno });
    if (r.ok) { enviados++; continue; }
    if (!r.reintentable) {
      logger?.error(`Telegram rechaza y no tiene arreglo solo: ${r.motivo}. Descarto ese parte.`);
      continue;
    }
    logger?.aviso(`No pude entregar el parte (${r.motivo}). Se guarda para luego.`);
    quedan.push(p);
  }

  escribirAtomico(ruta, quedan.map((p) => JSON.stringify(p)).join('\n') + (quedan.length ? '\n' : ''));
  return { ok: quedan.length === 0, enviados, pendientes: quedan.length };
}

function guardar(ruta, pendientes, nuevo, config) {
  const max = config.vigia.telegram.maxPendientes;
  const cola = [...pendientes, nuevo].slice(-max);
  escribirAtomico(ruta, cola.map((p) => JSON.stringify(p)).join('\n') + '\n');
}
