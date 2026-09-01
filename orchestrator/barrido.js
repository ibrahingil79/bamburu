// barrido.js — El barrido de comprobaciones, en los ratos muertos del orquestador.
//
// POR QUÉ EXISTE (1 sep 2026). El barrido nocturno se retiró el 26 ago 2026 (`bff11d0`) porque
// lanzarlo tras cada encargo era inviable, y esa decisión sigue en pie: NADA de esto lo dispara
// después de trabajar. Lo que se aprovecha es OTRA cosa — el tiempo en que el orquestador está
// PARADO esperando a que se reinicie la ventana de cuota. La madrugada del 1 sep fueron
// 3 h 22 min de espera muerta, y una pasada entera cuesta entre 20 y 30 minutos.
//
// POR QUÉ NO CUESTA CUOTA, que es lo que lo hace posible: de las 208 comprobaciones del barrido,
// 205 no tocan el modelo. Las que llaman a la IA de verdad están DECLARADAS FUERA a propósito
// (`EXCLUIDOS` de `scripts/run-gates.mjs`), porque «un gate que depende del saldo de una cuenta no
// puede vivir en un barrido de regresión». Así que esto gasta tiempo de máquina, no cuota.
//
// LAS CUATRO REGLAS QUE LO GOBIERNAN, y las cuatro son del encargo del 1 sep:
//
//   1. UNA SOLA PASADA POR ESPERA. No es un bucle. Quien llama lleva la cuenta; aquí solo se
//      corre una vez por invocación.
//   2. MANDA EL TRABAJO. Si vuelve la cuota a mitad del barrido, se CORTA y se retoma la tarea.
//      Construir tiene prioridad sobre comprobar, siempre. Por eso se sondea la cuota mientras
//      corre en vez de esperar a que termine.
//   3. EL RESULTADO VA AL PARTE. Qué se ejecutó y qué salió rojo.
//   4. NO PUEDE TUMBAR AL DAEMON. Este módulo NO LANZA NUNCA. Cualquier desastre —que no exista
//      el script, que el proceso muera, que la salida sea basura— sale por `estado: 'reventado'`
//      con su motivo, y el orquestador sigue su vuelta como si nada.
//
// ⚙️ LA CICATRIZ (1 sep 2026, primer uso real). Esto se lanzaba SIN ARGUMENTOS, y
// `run-gates.mjs` exige al menos uno: contestó con su ayuda y salió 64. Ocho pruebas en verde,
// porque las ocho escribían un `run-gates.mjs` FALSO que ignoraba `argv` — el doble borró
// justo la frontera que estaba rota. De ahí dos cosas de este fichero:
//   · la invocación (guion + argumentos) vive en `orquestador.config.json`, a la vista, y
//   · el código 64 tiene su propio diagnóstico: 64 es EX_USAGE, «lo he llamado mal YO».
//     Decir «no se pudo leer ningún resultado» ante un 64 es señalar al barrido cuando el
//     que se ha equivocado es quien lo llama.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cargarSecretos } from './nucleo/entorno.js';

/** Cada cuánto se le pregunta a la cuota si ha vuelto, mientras el barrido corre. */
const SONDEO_CUOTA_MS = 60000;

/** Lo que significa que un programa de línea de comandos salga 64: lo has invocado mal. */
const EX_USAGE = 64;

/** Tope de salida que se guarda en memoria. Un barrido largo escupe mucho y no cabe entero. */
const MAX_SALIDA = 2 * 1024 * 1024;

/**
 * Saca de la salida del barrido qué se ejecutó y qué no pasó.
 *
 * Se apoya en el bloque «RESULTADO POR NOMBRE» que `run-gates.mjs` imprime SIEMPRE con formato
 * fijo —lo imprime precisamente para poder comparar dos barridos—, así que es lo más estable
 * que hay que leer. Si el formato cambiara, esto devuelve listas vacías y lo dice: no inventa.
 */
export function leerResultado(salida) {
  const ejecutados = [], rojos = [];
  for (const linea of String(salida || '').split('\n')) {
    // ⚙️ NO se ancla en el icono, y esto lo cazó su propia prueba: `🛑` es un par sustituto y
    // `⚠️` lleva selector de variación, así que una clase de caracteres se los comía y los
    // ABORTADO y SOSPECHOSO desaparecían del recuento de rojos — un parte que dice menos rojos
    // de los que hay es peor que no mandarlo. Se ancla en el VEREDICTO, que es texto plano.
    const m = /^(\S+)\s+([a-z0-9][a-z0-9-]*)\s+(PASA|FALLA|ABORTADO|SOSPECHOSO)\s*$/.exec(linea.trim());
    if (!m) continue;
    ejecutados.push(m[2]);
    if (m[3] !== 'PASA') rojos.push({ gate: m[2], estado: m[3] });
  }
  return { ejecutados, rojos };
}

/**
 * Corre UNA pasada del barrido, cortándola si vuelve la cuota.
 *
 * @param opciones.cfg          config del orquestador
 * @param opciones.log          registro
 * @param opciones.hayCuotaYa   async () => boolean. Se sondea cada minuto; si dice `true`, se corta.
 * @param opciones.entorno      variables de entorno de las que partir
 * @param opciones.alSalir      recibe una función que corta el barrido desde fuera. La usa la
 *                              parada buena del daemon: un barrido dura 20-30 min y un SIGTERM
 *                              no puede esperarlos (1 sep 2026, avería 3).
 * @returns {Promise<{estado, ejecutados, rojos, segs, motivo}>} — NUNCA lanza.
 *          estado: 'completo' | 'cortado' | 'reventado'
 */
export async function correrBarrido({ cfg, log, hayCuotaYa = async () => false, entorno = process.env, alSalir = null }) {
  const t0 = Date.now();
  const segs = () => Math.round((Date.now() - t0) / 1000);
  const inv = invocacion(cfg);
  const guion = path.join(cfg.repo.raiz, inv.guion);

  if (!existsSync(guion)) {
    return { estado: 'reventado', ejecutados: [], rojos: [], segs: 0, motivo: `no existe ${inv.guion}` };
  }

  // Los gates hablan con el servidor de verdad y necesitan sus claves. La unit del orquestador
  // carga /etc/orquestador.env, que NO es el mismo fichero: sin esto, el módulo ERP no levanta y
  // TODO daría 404 — «parece que no hay violaciones cuando lo que no hay es app» (CLAUDE.md).
  const env = { ...entorno };
  try { cargarSecretos('/etc/bamburu.env', env); } catch { /* si no se puede leer, los gates lo cantarán en rojo */ }

  let hijo = null, salida = '', cortado = false, motivoCorte = null;

  try {
    hijo = spawn(process.execPath, [guion, ...inv.argumentos], {
      cwd: cfg.repo.raiz, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { estado: 'reventado', ejecutados: [], rojos: [], segs: segs(), motivo: `no se pudo lanzar: ${e.message}` };
  }
  log?.info?.(`Barrido: ${inv.guion} ${inv.argumentos.join(' ')}`);

  const recoger = (trozo) => {
    if (salida.length < MAX_SALIDA) salida += trozo;
  };
  hijo.stdout?.on('data', (d) => recoger(String(d)));
  hijo.stderr?.on('data', (d) => recoger(String(d)));
  // Un EPIPE o un fallo de spawn asíncrono llegan por aquí. Se tragan: el `close` manda.
  hijo.on('error', (e) => { salida += `\n[error del proceso] ${e.message}\n`; });

  // Cortar, con su motivo. Dos cosas mandan sobre un barrido y las dos entran por aquí:
  // que vuelva la cuota (regla 2: manda el trabajo) y que paren el daemon (avería 3 del 1 sep).
  const cortar = (motivo) => {
    if (cortado) return;
    cortado = true;
    motivoCorte = motivo;
    log?.info?.(`▶ Corto el barrido: ${motivo}.`);
    try { hijo.kill('SIGTERM'); } catch { /* ya se estaba muriendo */ }
    // Si no se muere por las buenas en 10 s, se corta en seco. No se espera a un barrido
    // moribundo teniendo trabajo que hacer —ni teniendo que devolver el control a systemd.
    setTimeout(() => { try { hijo.kill('SIGKILL'); } catch { /* ya no está */ } }, 10000).unref?.();
  };
  // La manija de fuera. Se entrega ANTES de ponerse a esperar, para que un SIGTERM que
  // llegue en el primer segundo del barrido tenga a quién llamar.
  alSalir?.(() => cortar('paran el orquestador'));

  // El vigilante de la cuota, en paralelo. Es la regla 2: manda el trabajo.
  const reloj = setInterval(async () => {
    try {
      if (await hayCuotaYa()) cortar('vuelve a haber cuota y manda la tarea');
    } catch { /* si no se puede medir la cuota, el barrido sigue: no es motivo para cortarlo */ }
  }, SONDEO_CUOTA_MS);

  const code = await new Promise((res) => {
    hijo.on('close', (c) => res(c));
  }).catch(() => null);

  clearInterval(reloj);

  const { ejecutados, rojos } = leerResultado(salida);
  if (cortado) {
    return { estado: 'cortado', ejecutados, rojos, segs: segs(), motivo: motivoCorte || 'lo cortaron' };
  }
  // EL 64 SE DICE POR SU NOMBRE. Es EX_USAGE: el barrido está bien y quien lo ha llamado mal
  // somos nosotros. El 1 sep 2026 esto se reportó como «no se pudo leer ningún resultado», que
  // manda a mirar al sitio equivocado y costó el primer uso real entero.
  if (code === EX_USAGE) {
    return { estado: 'reventado', ejecutados, rojos, segs: segs(),
             motivo: `LO HE INVOCADO MAL (código 64 = EX_USAGE): «${inv.guion} ${inv.argumentos.join(' ')}». `
                   + `Contestó con su ayuda, así que no acepta esos argumentos. Se arreglan en `
                   + `orquestador.config.json → barrido.argumentos, no aquí.` };
  }
  // `run-gates` sale con código distinto de 0 cuando hay rojos: eso NO es que haya reventado, es
  // su veredicto. Reventado es no haber podido leer ni un resultado.
  if (!ejecutados.length) {
    const cola = salida.split('\n').filter(Boolean).slice(-3).join(' · ').slice(0, 300);
    return { estado: 'reventado', ejecutados, rojos, segs: segs(), motivo: `no se pudo leer ningún resultado (código ${code}): ${cola}` };
  }
  return { estado: 'completo', ejecutados, rojos, segs: segs(), motivo: null };
}

/**
 * Qué se lanza y con qué argumentos. Sale de la config, NO del código.
 *
 * Los valores por defecto están aquí y no en el JSON por una razón: si alguien borra la sección
 * `barrido` del fichero, el orquestador tiene que seguir pasando el barrido bien, no dejar de
 * pasarlo. Y si pone `argumentos: []`, se respeta y el 64 lo cantará por su nombre.
 */
export function invocacion(cfg) {
  const b = cfg.barrido || {};
  return {
    guion: b.guion || 'scripts/run-gates.mjs',
    argumentos: Array.isArray(b.argumentos) ? b.argumentos : ['--all'],
  };
}
