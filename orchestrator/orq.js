#!/usr/bin/env node
// orq.js — La línea de comandos. Todo en español y legible.
import fs from 'node:fs';
import path from 'node:path';
import { cargarConfig } from './nucleo/config.js';
import { Almacen } from './nucleo/almacen.js';
import { arrancar } from './bucle.js';
import { cargarSecretos, FICHERO_SECRETOS } from './nucleo/entorno.js';

const AYUDA = `
Orquestador de Bamburu

  node orchestrator/orq.js <comando>

Comandos:
  arrancar            arranca el daemon (retoma donde quedó)
  una-vuelta          da una sola vuelta y termina (para probar)
  estado              enseña en qué anda ahora mismo
  parar               parada BUENA: termina el paso en curso y no coge otra tarea
  parar-ya            parada de EMERGENCIA: corta lo que esté haciendo (puede dejar algo a medias)
  historial           tareas hechas, rechazadas, replanteadas y apartadas, con su consumo
  parte               fuerza el envío del parte ahora (y vacía la cola de pendientes)
  conectar-telegram   te pregunta los dos datos de Telegram y los guarda
  probar-telegram     comprueba el aviso de Telegram y manda un mensaje de prueba
  ayuda               esto
`;

const NOMBRE_PASO = {
  OCIOSO: 'esperando a que haya tarea', ANALISIS: 'el arquitecto está analizando',
  VALIDAR_ANALISIS: 'comprobando el análisis', CONSTRUCCION: 'el programador está construyendo',
  VALIDAR_CODIGO: 'comprobando el código', REVISION: 'el revisor está juzgando',
  VALIDAR_REVISION: 'leyendo el veredicto', CIERRE: 'cerrando la tarea',
  ESPERANDO_CUOTA: 'PARADO esperando a que vuelva la cuota',
};

function desdeHace(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `desde hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `desde hace ${h} h ${min % 60} min` : `desde hace ${Math.floor(h / 24)} d`;
}

function almacenDe(cfg) {
  return new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
}
const rutaPid = (cfg) => path.join(path.dirname(cfg.rutasAbs.estado), 'daemon.pid');

function pidVivo(cfg) {
  try {
    const pid = Number(fs.readFileSync(rutaPid(cfg), 'utf8').trim());
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
}

function mostrarEstado(cfg) {
  const { estado } = almacenDe(cfg).recuperar();
  const pid = pidVivo(cfg);
  const L = [];
  L.push('', '═'.repeat(66), '  ESTADO DEL ORQUESTADOR', '═'.repeat(66), '');
  L.push(pid ? `  Daemon:      corriendo (pid ${pid})` : '  Daemon:      PARADO');
  L.push(estado.esperandoCuota
    ? `  Situación:   PARADO esperando cuota ${desdeHace(estado.esperaDesde)} (la tarea sigue en: ${NOMBRE_PASO[estado.paso] || estado.paso})`
    : `  Situación:   ${NOMBRE_PASO[estado.paso] || estado.paso} ${desdeHace(estado.pasoDesde)}`);
  L.push('');
  if (estado.tarea) {
    L.push(`  Tarea:       ${estado.tarea.titulo}`);
    L.push(`  Id:          ${estado.tarea.id}`);
    L.push(`  Intento:     ${estado.intento} de ${cfg.ciclo.maxIntentosRevision}`);
    if (estado.replanteos) L.push(`  Replanteos:  ${estado.replanteos}`);
    if (estado.cuotaInicio != null) L.push(`  Cuota al empezar: ${estado.cuotaInicio}% de sesión usado`);
    if (estado.historial.length) {
      L.push('', '  Intentos hasta ahora:');
      for (const h of estado.historial) L.push(`    ${h.intento}. ${h.veredicto}${h.motivos?.length ? ` — ${h.motivos[0].slice(0, 70)}` : ''}`);
    }
  } else {
    L.push('  Tarea:       ninguna entre manos');
  }
  if (estado.subidaPendiente) {
    L.push('', `  ⚠️  Hay trabajo aprobado SIN SUBIR: ${estado.ultimoFalloSubida?.motivo || 'sin detalle'}`);
  }
  if (estado.apartadas?.length) {
    L.push('', `  ⛔ Apartadas esperando decisión (${estado.apartadas.length}):`);
    for (const a of estado.apartadas.slice(-5)) L.push(`    · ${a.titulo} — ${a.motivo}`);
  }
  L.push('', `  Registro:    ${path.join(cfg.rutasAbs.logs, 'orquestador.log')}`, '');
  process.stdout.write(L.join('\n') + '\n');
}

function mostrarHistorial(cfg) {
  const filas = almacenDe(cfg).leerHistorial();
  if (!filas.length) { process.stdout.write('\n  Aún no hay historial.\n\n'); return; }
  const L = ['', '═'.repeat(78), '  HISTORIAL', '═'.repeat(78), ''];
  for (const f of filas.slice(-40)) {
    const icono = f.resultado === 'cerrada' ? '✅' : '⛔';
    const gasto = (f.cuotaFin != null && f.cuotaIni != null) ? `${(f.cuotaFin - f.cuotaIni).toFixed(0)} pts` : '—';
    L.push(`  ${icono} ${String(f.cuando).slice(0, 16).replace('T', ' ')}  ${f.titulo}`);
    L.push(`      intentos: ${f.intentos ?? '?'} · replanteos: ${f.replanteos ?? 0} · cuota: ${gasto}${f.subida === false ? ' · SIN SUBIR' : ''}`);
    if (f.motivo) L.push(`      motivo: ${f.motivo}`);
  }
  const cerradas = filas.filter((f) => f.resultado === 'cerrada').length;
  L.push('', `  Total: ${cerradas} cerrada(s), ${filas.length - cerradas} apartada(s).`, '');
  process.stdout.write(L.join('\n') + '\n');
}

function parar(cfg, señal) {
  const pid = pidVivo(cfg);
  if (!pid) { process.stdout.write('\n  El daemon no está corriendo.\n\n'); return 1; }
  process.kill(pid, señal);
  process.stdout.write(señal === 'SIGTERM'
    ? `\n  Parada buena pedida al pid ${pid}. Termina el paso en curso y para.\n  Míralo con: node orchestrator/orq.js estado\n\n`
    : `\n  ⚠️  Parada de EMERGENCIA enviada al pid ${pid}.\n  Puede haber dejado una llamada a medias. Al arrancar retomará desde el último paso guardado.\n\n`);
  return 0;
}

async function forzarParte(cfg) {
  const { redactar, entregar } = await import('./vigia/parte.js');
  const { Vigilante } = await import('./cuota/vigilante.js');
  const { leerTablero, buscarSiguienteTarea } = await import('./reader.js');
  const { crearRegistro } = await import('./nucleo/registro.js');
  const log = crearRegistro({ dirLogs: cfg.rutasAbs.logs, nombre: 'orquestador.log' });
  const { estado } = almacenDe(cfg).recuperar();
  const cuota = await new Vigilante({ config: cfg }).consultar();
  let enTablero = null;
  try { enTablero = buscarSiguienteTarea(leerTablero(cfg.tableroAbs)); } catch { /* el parte lo dice */ }
  const texto = redactar({ estado, cuota, historialReciente: [], tareaEnTablero: enTablero, desde: null, config: cfg });
  const r = await entregar({ texto, config: cfg, logger: log });
  process.stdout.write(`\n${texto.replace(/<[^>]+>/g, '')}\n\n  → ${r.ok ? 'Entregado por Telegram.' : `Guardado (${r.pendientes} pendiente/s): ${r.motivo || 'no se pudo entregar'}`}\n\n`);
  return 0;
}

/**
 * Pregunta los dos datos y los guarda. Existe para que Ibrahin NO tenga que abrir un fichero
 * ni escribir un comando con el secreto dentro: si el token fuera un argumento, se quedaría
 * escrito en el historial del terminal para siempre.
 */
async function conectarTelegram(cfg) {
  const readline = await import('node:readline/promises');
  const fs = await import('node:fs');
  const { FICHERO_SECRETOS } = await import('./nucleo/entorno.js');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const salir = (c) => { rl.close(); return c; };

  process.stdout.write([
    '', '═'.repeat(64), '  CONECTAR TELEGRAM', '═'.repeat(64), '',
    '  Te voy a pedir dos datos. Los guardo yo en su sitio seguro;',
    '  no tienes que abrir ningún fichero.', '',
    '  Si no los tienes todavía, los pasos para sacarlos están en el',
    '  documento «encender-telegram» de la carpeta docs/orquestador.', '',
  ].join('\n') + '\n');

  const token = (await rl.question('  1. Pega el dato largo de BotFather (lleva dos puntos en medio):\n     ')).trim();
  if (!token) { process.stdout.write('\n  No has pegado nada. No he cambiado nada.\n\n'); return salir(1); }
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    process.stdout.write([
      '', '  ⚠️  Ese dato no tiene la pinta que debería.',
      '     Tiene que ser: unos números, dos puntos, y una ristra larga de letras.',
      '     Ejemplo de la FORMA (no lo copies, es inventado):  8123456789:AAH-xxxxxxxxxxxxxxx',
      '', '  No he cambiado nada. Vuelve a intentarlo cuando lo tengas entero.', '',
    ].join('\n') + '\n');
    return salir(1);
  }

  const chat = (await rl.question('\n  2. Pega el número de tu conversación (puede empezar por un guión):\n     ')).trim();
  if (!/^-?\d{3,}$/.test(chat)) {
    process.stdout.write('\n  ⚠️  Eso no es un número de conversación. No he cambiado nada.\n\n');
    return salir(1);
  }
  rl.close();

  let texto;
  try { texto = fs.readFileSync(FICHERO_SECRETOS, 'utf8'); }
  catch { texto = ''; }
  const cabecera = texto.split(/^#?ORQUESTADOR_TELEGRAM_TOKEN=/m)[0];
  const nuevo = `${cabecera.replace(/\s*$/, '')}\n\nORQUESTADOR_TELEGRAM_TOKEN=${token}\nORQUESTADOR_TELEGRAM_CHAT_ID=${chat}\n`;

  try {
    fs.writeFileSync(FICHERO_SECRETOS, nuevo, { mode: 0o600 });
    fs.chmodSync(FICHERO_SECRETOS, 0o600);
  } catch (e) {
    process.stdout.write(`\n  ❌ No he podido guardarlo: ${e.code === 'EACCES' ? 'no tengo permiso' : e.message}\n`);
    process.stdout.write('     Lánzalo como el usuario «ubuntu».\n\n');
    return 1;
  }

  process.stdout.write('\n  ✅ Guardado. Ahora lo pruebo.\n');
  process.env.ORQUESTADOR_TELEGRAM_TOKEN = token;
  process.env.ORQUESTADOR_TELEGRAM_CHAT_ID = chat;
  return probarTelegram(cfg);
}

async function probarTelegram(cfg) {
  const { enviar, configurado, queFalta } = await import('./vigia/telegram.js');
  const { pista } = await import('./nucleo/secretos.js');
  const L = [];
  const decir = (t) => L.push(t);
  const soltar = () => { process.stdout.write('\n' + L.join('\n') + '\n\n'); };

  decir('═'.repeat(64));
  decir('  COMPROBACIÓN DEL AVISO DE TELEGRAM');
  decir('═'.repeat(64));
  decir('');

  const r = cargarSecretos();
  if (!r.existe) {
    decir(`  ❌ No encuentro el fichero de datos secretos.`);
    decir('');
    decir(`     Tendría que estar en:  ${FICHERO_SECRETOS}`);
    decir('     Avísame y lo vuelvo a crear.');
    soltar(); return 1;
  }
  if (!r.legible) {
    decir(`  ❌ El fichero de datos secretos ${r.motivo}.`);
    decir('');
    decir('     Prueba a lanzar esto mismo como el usuario «ubuntu».');
    soltar(); return 1;
  }

  const falta = queFalta(cfg, process.env);
  if (!configurado(cfg, process.env)) {
    decir('  ⏳ Todavía no has puesto los datos de Telegram.');
    decir('');
    decir(`     Falta por rellenar: ${falta.length === 2 ? 'los dos datos' : 'uno de los dos'}.`);
    if (falta.includes('ORQUESTADOR_TELEGRAM_TOKEN')) decir('       · el dato largo que da @BotFather');
    if (falta.includes('ORQUESTADOR_TELEGRAM_CHAT_ID')) decir('       · el número de tu conversación');
    decir('');
    decir('     Los pasos, con capturas de lo que vas a ver, están en:');
    decir('       docs/orquestador/encender-telegram.md');
    decir('');
    decir('     Mientras tanto NO pasa nada: el orquestador trabaja igual y');
    decir('     guarda los partes para mandártelos en cuanto lo rellenes.');
    soltar(); return 1;
  }

  decir('  Los dos datos están puestos:');
  decir(`     · dato de @BotFather:   ${pista(process.env.ORQUESTADOR_TELEGRAM_TOKEN)}`);
  decir(`     · número de conversación: ${process.env.ORQUESTADOR_TELEGRAM_CHAT_ID}`);
  decir('');
  decir('  Mandando un mensaje de prueba…');

  const cuando = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  const env = await enviar({
    texto: `✅ <b>Prueba del orquestador</b>\n\nSi lees esto, el aviso está bien puesto.\n\n<i>${cuando}</i>`,
    config: cfg,
  });

  decir('');
  if (env.ok) {
    decir('  ✅ ENVIADO. Mira tu Telegram: tienes que ver un mensaje de prueba.');
    decir('');
    decir('     Si NO lo ves, el número de conversación es de otro sitio.');
    decir('     Repite el paso 5 de las instrucciones.');
    soltar(); return 0;
  }

  decir(`  ❌ NO SE PUDO ENVIAR: ${env.motivo}`);
  decir('');
  const m = String(env.motivo || '');
  if (/401|unauthorized|token/i.test(m)) {
    decir('     Eso significa que el dato largo de @BotFather está mal copiado.');
    decir('     Vuelve al paso 3: cópialo entero, sin espacios delante ni detrás.');
  } else if (/chat not found|400/i.test(m)) {
    decir('     Eso significa que el número de la conversación no es el bueno,');
    decir('     o que todavía no le has escrito al bot.');
    decir('     Vuelve al paso 4: escríbele «hola» al bot y repite el paso 5.');
  } else if (/403|blocked/i.test(m)) {
    decir('     Has bloqueado al bot en Telegram. Desbloquéalo y repite.');
  } else {
    decir('     Parece un problema de conexión. Vuelve a probar en un minuto.');
  }
  decir('');
  decir('     El orquestador NO se para por esto: guarda los partes y los manda luego.');
  soltar(); return 1;
}

async function principal() {
  const comando = process.argv[2] || 'ayuda';
  if (['ayuda', '--help', '-h'].includes(comando)) { process.stdout.write(AYUDA); return 0; }

  const cfg = cargarConfig();
  switch (comando) {
    case 'arrancar':    return arrancar({ config: cfg });
    case 'una-vuelta':  return arrancar({ config: cfg, unaVuelta: true });
    case 'estado':      mostrarEstado(cfg); return 0;
    case 'historial':   mostrarHistorial(cfg); return 0;
    case 'parar':       return parar(cfg, 'SIGTERM');
    case 'parar-ya':    return parar(cfg, 'SIGINT');
    case 'parte':       cargarSecretos(); return forzarParte(cfg);
    case 'probar-telegram': return probarTelegram(cfg);
    case 'conectar-telegram': return conectarTelegram(cfg);
    default:
      process.stderr.write(`\n  No conozco el comando «${comando}».\n${AYUDA}`);
      return 1;
  }
}

principal()
  .then((c) => process.exit(c || 0))
  .catch((e) => {
    process.stderr.write(`\n❌ ${e.message}\n`);
    if (process.env.ORQ_DEBUG) process.stderr.write(String(e.stack) + '\n');
    process.exit(1);
  });
