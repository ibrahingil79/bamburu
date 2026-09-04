#!/usr/bin/env node
// orq.js — La línea de comandos. Todo en español y legible.
import fs from 'node:fs';
import path from 'node:path';
import { cargarConfig } from './nucleo/config.js';
import { Almacen } from './nucleo/almacen.js';
import { arrancar } from './bucle.js';
import { cargarSecretos, FICHERO_SECRETOS } from './nucleo/entorno.js';
import { tareasPendientes, buscarSiguienteTarea } from './reader.js';
import { averiaOciosoConTablero } from './nucleo/maquina.js';
import { estadoDelDespliegue } from './nucleo/despliegue.js';

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
  // Se LEE, no se recupera: `recuperar()` reescribe la instantánea, y el dueño de
  // ese fichero es el daemon, que puede estar corriendo mientras se teclea esto.
  const estado = almacenDe(cfg).leerEstado();
  const pid = pidVivo(cfg);
  const L = [];
  L.push('', '═'.repeat(66), '  ESTADO DEL ORQUESTADOR', '═'.repeat(66), '');
  L.push(pid ? `  Daemon:      corriendo (pid ${pid})` : '  Daemon:      PARADO');
  L.push(`  Modelos:     ${Object.entries(cfg.cli.modeloPorPapel).map(([p, m]) => `${p} → ${m}`).join('  ·  ')}`);
  L.push(estado.esperandoCuota
    ? `  Situación:   PARADO esperando cuota ${desdeHace(estado.esperaDesde)} (la tarea sigue en: ${NOMBRE_PASO[estado.paso] || estado.paso})`
    : `  Situación:   ${NOMBRE_PASO[estado.paso] || estado.paso} ${desdeHace(estado.pasoDesde)}`);
  L.push(...loQueCreeDeLaCuota(cfg));
  L.push(...loQueCorreDeVerdad(cfg));
  L.push('');
  if (estado.tarea) {
    L.push(`  Tarea:       ${estado.tarea.titulo}`);
    L.push(`  Id:          ${estado.tarea.id}`);
    L.push(`  Intento:     ${estado.intento} de ${cfg.ciclo.maxIntentosRevision}`);
    if (estado.replanteos) L.push(`  Replanteos:  ${estado.replanteos}`);
    // Las dos mitades SIEMPRE, aquí y en la línea de la cuota de arriba. El 1 sep 2026 esta
    // línea decía «Cuota al empezar: 46% de sesión usado» tres renglones debajo de «cree que
    // queda 46% de sesión»: los dos números eran ciertos —46 gastado al coger la tarea, 46 libre
    // seis minutos después— y juntos parecían una contradicción. Un número solo, sin su mitad,
    // obliga a quien lo lee a recordar cuál de las dos cosas mide.
    if (estado.cuotaInicio != null) {
      L.push(`  Cuota al coger la tarea: ${estado.cuotaInicio}% GASTADO (quedaba ${100 - estado.cuotaInicio}%)`);
    }
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

  // La cola. Antes no salía por ningún lado: el 31 ago 2026 el daemon decía «ocioso» y no
  // había forma de ver desde fuera que quedaban cuatro tareas escritas esperando.
  L.push('', ...colaDelTablero(cfg, estado));

  L.push('', `  Registro:    ${path.join(cfg.rutasAbs.logs, 'orquestador.log')}`, '');
  process.stdout.write(L.join('\n') + '\n');
}

/**
 * QUÉ CREE EL ORQUESTADOR SOBRE LA CUOTA, con su antigüedad.
 *
 * ⚙️ DE DÓNDE SALE (1 sep 2026, avería 2). El daemon decía «queda 12 %» mientras la pantalla de
 * uso de Ibrahin marcaba 0 % usado, y no había forma de verlo desde fuera: el número solo salía
 * en líneas sueltas del registro y en el parte de cada tres horas. Para descubrir el desfase hubo
 * que matar el daemon y arrancarlo de cero.
 *
 * Esto NO consulta `/usage`: enseña la ÚLTIMA LECTURA DEL DAEMON, tal cual, con cuándo la tomó.
 * Es a propósito y es la mitad importante — una consulta nueva diría lo que hay, no lo que él
 * cree, y el desfase entre las dos cosas era justo la avería. Para el número de verdad,
 * `/usage` en el chat; comparar los dos es cosa de un vistazo.
 */
function loQueCreeDeLaCuota(cfg) {
  let c;
  try { c = JSON.parse(fs.readFileSync(cfg.rutasAbs.cuota, 'utf8')); }
  catch { return ['  Cuota:       (todavía no ha anotado ninguna lectura)']; }

  if (!c.fiable) {
    const L = [`  Cuota:       NO LA SABE ${desdeHace(c.leidoEn)} — ${c.motivo || 'sin detalle'}`];
    // CON QUÉ ESTÁ DECIDIENDO MIENTRAS TANTO. «No la sabe» a secas no dice si está parado o
    // trabajando, y son dos averías distintas: la primera es la fábrica quieta, la segunda es
    // cuota gastándose sin comprobar. Desde el 1 sep 2026 se enseñan las dos.
    const u = c.ultimaFiable;
    if (u && Number.isFinite(u.sesionPct)) {
      L.push(`               tira de la última lectura buena: QUEDABA ${(100 - u.sesionPct).toFixed(0)}% de sesión`
           + `, de hace ${Math.max(1, Math.round((u.edadMs || 0) / 60000))} min`);
    } else {
      L.push('               y no tiene ninguna lectura buena reciente de la que tirar: está parado');
    }
    L.push('               si esto dura, mira logs/usage-ilegible-*.txt: ahí está la salida cruda');
    return L;
  }

  const L = [`  Cuota:       cree que QUEDA ${(100 - c.sesionPct).toFixed(0)}% de sesión (${c.sesionPct.toFixed(0)}% gastado)`
           + `${c.semanaPct != null ? ` y ${(100 - c.semanaPct).toFixed(0)}% de la semanal (${c.semanaPct.toFixed(0)}% gastado)` : ''}`
           + `  ·  leído ${desdeHace(c.leidoEn)}`];
  if (c.reinicioSesion) L.push(`               la sesión se reinicia ${c.reinicioSesion}${vencido(c.reinicioSesionMs) ? '  ⚠️ esa hora YA PASÓ' : ''}`);
  if (c.reinicioSemana) L.push(`               la semanal se reinicia ${c.reinicioSemana}`);
  L.push('               contrástalo con /usage en el chat: si no cuadran, el desfase es la avería');
  return L;
}

const vencido = (ms) => Number.isFinite(ms) && ms < Date.now();

/**
 * ¿CORRE CADA PROCESO EL CÓDIGO QUE HAY ESCRITO?
 *
 * ⚙️ DE DÓNDE SALE (1 sep 2026). Ibrahin escribió «Preguntas» al bot y le contestó con la ayuda:
 * la orden existía en el disco desde hacía dos horas y **no en el proceso que corría**, arrancado
 * casi seis horas antes. Desde fuera los dos casos se ven igual — `systemctl` dice `active` en los
 * dos—, y eso es lo que hace que un despliegue a medias pueda durar horas sin que nadie lo note.
 *
 * Al producto SÍ lo reinicia el programador al terminar una tarea (se lo manda `CLAUDE.md`).
 * **A la propia máquina —orquestador y vigía— no la reinicia nadie**, y ése era el agujero.
 */
function loQueCorreDeVerdad(cfg) {
  let ss;
  try { ss = estadoDelDespliegue(cfg.repo.raiz); } catch { return []; }
  const malos = ss.filter((s) => s.desfasado === true);
  if (!malos.length) {
    const vivos = ss.filter((s) => s.activo).length;
    return [`  Despliegue:  ✅ los ${vivos} procesos vivos corren el código que hay escrito`];
  }
  const L = [`  Despliegue:  ⚠️  ${malos.length} proceso(s) CORREN CÓDIGO VIEJO`];
  for (const m of malos) {
    L.push(`               · ${m.unidad}: ${m.minutos} min por detrás (${m.fichero})`);
    L.push(`                 arréglalo con: sudo systemctl restart ${m.unidad}`);
  }
  return L;
}

/** Lo que el tablero ofrece, y si hay contradicción entre «ofrece» y «puedo coger». */
function colaDelTablero(cfg, estado) {
  let pendientes = [];
  let siguiente = null;
  try {
    const texto = fs.readFileSync(cfg.tableroAbs, 'utf8');
    pendientes = tareasPendientes(texto);
    siguiente = buscarSiguienteTarea(texto, { excluir: (estado.apartadas || []).map((a) => a.id) });
  } catch (e) {
    return [`  Tablero:     no lo pude leer (${e.message})`];
  }

  if (!pendientes.length) return ['  Tablero:     sin tareas pendientes'];

  const L = [`  Tablero:     ${pendientes.length} pendiente(s)`];
  for (const t of pendientes.slice(0, 8)) {
    const marca = t.id === siguiente?.id ? '→' : ' ';
    L.push(`    ${marca} ${t.id}${t.rotulada ? '  (rotulada SIGUIENTE)' : ''}`);
  }
  if (pendientes.length > 8) L.push(`      …y ${pendientes.length - 8} más`);

  // Ocioso con el tablero lleno NO es ocioso. Si pasa, aquí se ve, con la MISMA regla
  // que usa el daemon.
  const averia = (!estado.tarea && !siguiente) ? averiaOciosoConTablero(pendientes) : null;
  if (averia) L.push('', `  🚨 AVERÍA: ${averia.motivo}`);
  return L;
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
    // EL DESGLOSE, que es para lo que se guarda: un total no deja comparar el cambio de modelo
    // de UN papel — se compara total contra total y la diferencia se le atribuye a lo que a uno
    // le parezca. Con esto se ve qué papel se llevó los puntos, con qué modelo y en cuántas
    // llamadas. Las tareas de antes del 1 sep 2026 no lo tienen y salen sin esta línea.
    const g = f.gastoPorPapel || {};
    for (const [papel, d] of Object.entries(g)) {
      L.push(`        · ${papel.padEnd(12)} ${String(d.modelos?.join('/') || '?').padEnd(18)}`
           + ` ${Number(d.puntos ?? 0).toFixed(0).padStart(3)} pts · ${Number(d.costeUsd ?? 0).toFixed(4)} $`
           + ` · ${d.llamadas} llamada(s) · ${Math.round((d.ms || 0) / 60000)} min`);
    }
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
  // Se dice el PLAZO, no solo «termina el paso». Hasta el 1 sep 2026 esta frase prometía algo
  // que el daemon no cumplía: no terminaba el paso, terminaba la TAREA entera, y sin tope.
  const segs = Math.round(cfg.ciclo.plazoParadaMs / 1000);
  process.stdout.write(señal === 'SIGTERM'
    ? `\n  Parada buena pedida al pid ${pid}. Le da ${segs} s al paso en curso y luego lo corta.\n`
      + `  Si tienes prisa, repite la orden: el segundo aviso corta sin esperar.\n`
      + `  Míralo con: node orchestrator/orq.js estado\n\n`
    : `\n  ⚠️  Parada de EMERGENCIA enviada al pid ${pid}.\n  Puede haber dejado una llamada a medias. Al arrancar retomará desde el último paso guardado.\n\n`);
  return 0;
}

async function forzarParte(cfg) {
  const { redactar, entregar } = await import('./vigia/parte.js');
  const { Vigilante } = await import('./cuota/vigilante.js');
  const { leerTablero, buscarSiguienteTarea, tareasPendientes } = await import('./reader.js');
  const { crearRegistro } = await import('./nucleo/registro.js');
  const log = crearRegistro({ dirLogs: cfg.rutasAbs.logs, nombre: 'orquestador.log' });
  // Se LEE, no se recupera: `recuperar()` reescribe la instantánea, y el dueño de
  // ese fichero es el daemon, que puede estar corriendo mientras se teclea esto.
  const estado = almacenDe(cfg).leerEstado();
  const cuota = await new Vigilante({ config: cfg, rutaLogs: cfg.rutasAbs.logs }).consultar();
  let enTablero = null;
  let pendientesEnTablero = [];
  try {
    const texto = leerTablero(cfg.tableroAbs);
    enTablero = buscarSiguienteTarea(texto, { excluir: (estado.apartadas || []).map((a) => a.id) });
    pendientesEnTablero = tareasPendientes(texto);
  } catch { /* el parte lo dice */ }
  // Sin esto, un parte pedido a mano seguiría diciendo «el tablero no ofrece ninguna tarea
  // más» con el tablero lleno: la misma frase falsa del 31 ago, en otro sitio.
  const averia = (!estado.tarea && !enTablero) ? averiaOciosoConTablero(pendientesEnTablero) : null;
  const texto = redactar({ estado, cuota, historialReciente: [], tareaEnTablero: enTablero,
                           pendientesEnTablero, averia, desde: null, config: cfg });
  const r = await entregar({ texto, config: cfg, logger: log });
  process.stdout.write(`\n${texto.replace(/<[^>]+>/g, '')}\n\n  → ${r.ok ? 'Anotado.' : `Guardado (${r.pendientes} pendiente/s): ${r.motivo || 'no se pudo anotar'}`}\n\n`);
  return 0;
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
