// parte.js — Redacta el parte y lo entrega. Si no se puede entregar, lo guarda.
//
// La cola de pendientes es la razón de ser de este módulo: el encargo dice que con Telegram
// caído o sin configurar el ciclo NO se detiene. Así que el parte se escribe siempre, se
// intenta mandar, y si no sale se guarda para el próximo intento. Nunca se pierde.
import { leerLineas, escribirAtomico } from '../nucleo/almacen.js';
import { revisarTeclado } from './ordenes.js';
import { enviar, configurado, queFalta } from './telegram.js';
import { alcanzaParaCiclo } from '../nucleo/maquina.js';

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
export function redactar({ estado, cuota, historialReciente, tareaEnTablero, pendientesEnTablero = [], averia = null, desde, ahora = Date.now(), config, barridos = [], premisasFalsas = [] }) {
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
    // La hora que se promete es la de LA VENTANA QUE CORTA. Si el que frena es el límite
    // semanal, anunciar el reinicio de la sesión es prometer una hora que no desbloquea nada
    // (1 sep 2026, avería 2).
    // El parte es lo que avisa de que algo va mal: no puede reventar él. Sin sección de
    // cuota en la config no se adivina cuál corta, se dice la de sesión y se sigue.
    const corta = config?.cuota ? alcanzaParaCiclo(cuota, config) : { ventana: null };
    const cual = corta.ventana === 'semanal'
      ? { hora: cuota?.reinicioSemana, nombre: 'la ventana semanal' }
      : { hora: cuota?.reinicioSesion, nombre: 'la ventana de sesión' };
    if (cual.hora) t(`• Calculo volver cuando se reinicie ${cual.nombre}: ${esc(cual.hora)}.`);
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

  // 6-ante · Las que se cerraron solas porque su premisa era falsa (1 sep 2026, bloque 4).
  // Van AQUÍ y no en un aviso al móvil a propósito: no hay nada que decidir, así que no valen una
  // interrupción. Pero SÍ se cuentan, porque cada una es una entrada podrida que alguien escribió y
  // que conviene ver acumularse — si aparecen tres en una semana, el problema es cómo se escribe el
  // tablero, no las tareas.
  if (premisasFalsas.length) {
    t(`<b>🧹 Cerradas solas: su premisa era falsa (${premisasFalsas.length})</b>`);
    for (const pf of premisasFalsas) t(redactarPremisaFalsa(pf));
    t('<i>No te avisé de éstas: no eran decisiones tuyas, eran entradas caducadas del tablero.</i>');
    t('');
  }

  // 6-bis · El barrido de los ratos muertos (bloque 4 del encargo del 1 sep 2026).
  // Va DESPUÉS de la cuota a propósito: es lo que se hizo PORQUE no había cuota, y así se lee
  // seguido. Solo aparece si hubo alguno: un parte de una espera sin barrido no dice nada.
  if (barridos.length) {
    t('<b>🧪 Comprobaciones en los ratos de espera</b>');
    for (const b of barridos) {
      if (b.estado === 'reventado') {
        t(`• ⚠️ No se pudo pasar: ${esc(b.motivo || 'sin detalle')}`);
        continue;
      }
      const cola = b.estado === 'cortado' ? ' <i>(cortado: volvió la cuota y mandó la tarea)</i>' : '';
      t(`• ${b.ejecutados.length} ejecutadas en ${Math.round(b.segs / 60)} min${cola}`);
      if (b.rojos.length) {
        t(`• ❌ <b>${b.rojos.length} en rojo:</b>`);
        for (const r of b.rojos.slice(0, 12)) t(`   · ${esc(r.gate)} (${esc(r.estado)})`);
        if (b.rojos.length > 12) t(`   · …y ${b.rojos.length - 12} más`);
      } else if (b.ejecutados.length) {
        t('• ✅ Ninguna en rojo.');
      }
    }
    t('');
  }

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
/**
 * El aviso de que una tarea se ha apartado. Va al móvil de Ibrahin, y suele leerse de pie.
 *
 * ⚙️ DOS ARREGLOS DEL 1 SEP 2026, los dos del mismo encargo:
 *
 * 1. **LLEVA EL MOTIVO ENTERO.** Antes decía «el arquitecto declaró la tarea mal planteada» y se
 *    quedaba ahí: lo que el arquitecto había ENCONTRADO viajaba en `detalle` y **nadie lo pasaba a
 *    esta función**. Con eso Ibrahin no podía decidir nada desde el móvil — tenía que entrar al
 *    servidor a leer el análisis para enterarse de qué le estaban preguntando.
 *
 * 2. **NO MIENTE SOBRE DE QUÉ CLASE ES.** La última línea decía SIEMPRE «No es un error técnico:
 *    es una decisión de producto». Ese día se mandó dos veces y **las dos fueron falsas**: las seis
 *    pantallas llevaban ocho días borradas, y el cifrado estaba mal redactado. Ahora la frase
 *    depende de la clase, y la clase la declara el arquitecto.
 */
export function redactarApartada({ tarea, motivo, historial, clase = 'sin-clasificar', pregunta = null, detalle = [] }) {
  const decision = clase === 'decision-de-ibrahin';
  const L = [decision
    ? '<b>⛔ Una tarea necesita una decisión tuya</b>'
    : '<b>⚠️ Una tarea se ha parado y no sé de qué clase es</b>', ''];
  L.push(`<b>${esc(tarea.titulo)}</b>`, '');

  // LA PREGUNTA VA ARRIBA DEL TODO. Es lo único que Ibrahin tiene que contestar, y si va al final
  // compite con el resto del mensaje en una pantalla de móvil.
  if (decision && pregunta) L.push(`<b>❓ ${esc(pregunta)}</b>`, '');

  L.push(`<b>Qué se pidió:</b> ${esc(tarea.descripcion || tarea.titulo).slice(0, 400)}`);
  L.push(`<b>Qué encontró el arquitecto:</b> ${esc(motivo).slice(0, 900)}`);

  // El resto de lo que dejó escrito, que es donde suele estar el porqué de verdad.
  const extra = (detalle || []).filter((d) => d && d !== motivo);
  if (extra.length) {
    L.push('', '<b>Y además:</b>');
    for (const d of extra.slice(0, 4)) L.push(`• ${esc(d).slice(0, 300)}`);
  }

  if (historial?.length) {
    L.push('', '<b>Qué se intentó:</b>');
    for (const h of historial.slice(-4)) {
      L.push(`• Intento ${h.intento}: ${esc((h.motivos || []).join('; ')).slice(0, 200) || esc(h.veredicto)}`);
    }
  }

  L.push('', decision
    ? '<i>No es un error técnico: falta una decisión que solo puedes tomar tú. El sistema sigue con la siguiente tarea.</i>'
    : '<i>El arquitecto paró SIN decir si es una decisión tuya o una entrada caducada del tablero, así que te lo mando por si acaso. Si resulta que la tarea estaba escrita sobre algo que ya no es cierto, no hacía falta molestarte. El sistema sigue con la siguiente tarea.</i>');
  return L.join('\n');
}

/**
 * EL AVISO DE UNA TAREA QUE ESPERA TU FIRMA.
 *
 * ⚙️ LO QUE HACE DISTINTO A ESTE MENSAJE (1 sep 2026): **no describe el código, describe la
 * promesa.** Qué cambia para quien usa Bamburu, qué se le garantiza y qué pasa si falla. Ibrahin
 * no firma cambios —lo dijo con esas palabras—: decide qué promete el producto. Un aviso que
 * cuente commits y ficheros le está pidiendo que apruebe algo que no puede juzgar.
 *
 * La promesa la escribe el ARQUITECTO, en su apartado «## LA PROMESA», y viaja hasta aquí sin que
 * nadie la resuma. Si no la escribió, se dice — no se inventa una.
 */
export function redactarFirma({ tarea, quien, rama, promesa, commits = 0 }) {
  const L = ['<b>✍️ Terminada y esperando tu firma</b>', ''];
  L.push(`<b>${esc(tarea.titulo)}</b>`, '');

  if (promesa) {
    L.push('<b>Qué le prometes al cliente si esto entra:</b>', esc(promesa).slice(0, 1800), '');
  } else {
    L.push('⚠️ <b>El arquitecto NO escribió la promesa</b>, así que no te la puedo contar en tus términos.',
           `Lo que se pidió: ${esc(tarea.descripcion || tarea.titulo).slice(0, 300)}`,
           'Si no sabes qué estás firmando, <b>no lo firmes</b>: dime «hablemos» y lo miramos.', '');
  }

  L.push('<b>Está terminada, probada y FUERA DE PRODUCCIÓN.</b>');
  L.push(`Vive en la rama <code>${esc(rama)}</code> con sus ${commits} commit(s). Nada de esto toca a nadie hasta que digas que sí.`);
  L.push('');
  L.push('<b>Puedes contestar tres cosas:</b>');
  L.push(`• <b>apruebo ${esc(tarea.id)}</b> — entra en producción`);
  L.push(`• <b>rechazo ${esc(tarea.id)}</b> + por qué — vuelve a la cola con tu motivo`);
  L.push(`• <b>hablemos de ${esc(tarea.id)}</b> — lo discutimos, sin prisa`);
  L.push('');
  L.push('<i>No me bloqueas: ya estoy con la siguiente tarea.</i>');
  return L.join('\n');
}

/**
 * La línea del parte para una tarea que se cerró sola por premisa falsa. NO es un aviso suelto: va
 * en el parte de las tres horas, como información. No hay nada que decidir.
 */
export function redactarPremisaFalsa({ tarea, motivo, prueba }) {
  return [
    `• <b>${esc(tarea.titulo)}</b> — cerrada sola: lo que pedía no era cierto.`,
    `   ${esc(motivo).slice(0, 300)}`,
    `   <b>Prueba:</b> ${esc(prueba).slice(0, 300)}`,
  ].join('\n');
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
    // El parte llega cada tres horas y a veces es lo ÚNICO que Ibrahin recibe en todo el día:
    // si no llevara el teclado, quien solo lea partes no lo vería aparecer nunca. Si la revisión
    // no pasa va `null`, y `enviar` manda el parte igual.
    const r = await enviar({ texto: p.texto, config, entorno, teclado: tecladoDe(config) });
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

/** El teclado fijo, si pasa la revisión. `null` si no: el parte sale igual. */
function tecladoDe(config) {
  const r = revisarTeclado(config.vigia?.teclado);
  return r.ok ? r.filas : null;
}
