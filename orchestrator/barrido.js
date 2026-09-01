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
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cargarSecretos } from './nucleo/entorno.js';

/** Cada cuánto se le pregunta a la cuota si ha vuelto, mientras el barrido corre. */
const SONDEO_CUOTA_MS = 60000;

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
 * @returns {Promise<{estado, ejecutados, rojos, segs, motivo}>} — NUNCA lanza.
 *          estado: 'completo' | 'cortado' | 'reventado'
 */
export async function correrBarrido({ cfg, log, hayCuotaYa = async () => false, entorno = process.env }) {
  const t0 = Date.now();
  const segs = () => Math.round((Date.now() - t0) / 1000);
  const guion = path.join(cfg.repo.raiz, 'scripts', 'run-gates.mjs');

  if (!existsSync(guion)) {
    return { estado: 'reventado', ejecutados: [], rojos: [], segs: 0, motivo: 'no existe scripts/run-gates.mjs' };
  }

  // Los gates hablan con el servidor de verdad y necesitan sus claves. La unit del orquestador
  // carga /etc/orquestador.env, que NO es el mismo fichero: sin esto, el módulo ERP no levanta y
  // TODO daría 404 — «parece que no hay violaciones cuando lo que no hay es app» (CLAUDE.md).
  const env = { ...entorno };
  try { cargarSecretos('/etc/bamburu.env', env); } catch { /* si no se puede leer, los gates lo cantarán en rojo */ }

  let hijo = null, salida = '', cortado = false;

  try {
    hijo = spawn(process.execPath, [guion], {
      cwd: cfg.repo.raiz, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { estado: 'reventado', ejecutados: [], rojos: [], segs: segs(), motivo: `no se pudo lanzar: ${e.message}` };
  }

  const recoger = (trozo) => {
    if (salida.length < MAX_SALIDA) salida += trozo;
  };
  hijo.stdout?.on('data', (d) => recoger(String(d)));
  hijo.stderr?.on('data', (d) => recoger(String(d)));
  // Un EPIPE o un fallo de spawn asíncrono llegan por aquí. Se tragan: el `close` manda.
  hijo.on('error', (e) => { salida += `\n[error del proceso] ${e.message}\n`; });

  // El vigilante de la cuota, en paralelo. Es la regla 2: manda el trabajo.
  const reloj = setInterval(async () => {
    try {
      if (await hayCuotaYa()) {
        cortado = true;
        log?.info?.('▶ Vuelve a haber cuota: corto el barrido, manda la tarea.');
        try { hijo.kill('SIGTERM'); } catch { /* ya se estaba muriendo */ }
        // Si no se muere por las buenas en 10 s, se corta en seco. No se espera a un barrido
        // moribundo teniendo trabajo que hacer.
        setTimeout(() => { try { hijo.kill('SIGKILL'); } catch { /* ya no está */ } }, 10000).unref?.();
      }
    } catch { /* si no se puede medir la cuota, el barrido sigue: no es motivo para cortarlo */ }
  }, SONDEO_CUOTA_MS);

  const code = await new Promise((res) => {
    hijo.on('close', (c) => res(c));
  }).catch(() => null);

  clearInterval(reloj);

  const { ejecutados, rojos } = leerResultado(salida);
  if (cortado) {
    return { estado: 'cortado', ejecutados, rojos, segs: segs(), motivo: 'volvió la cuota y manda la tarea' };
  }
  // `run-gates` sale con código distinto de 0 cuando hay rojos: eso NO es que haya reventado, es
  // su veredicto. Reventado es no haber podido leer ni un resultado.
  if (!ejecutados.length) {
    const cola = salida.split('\n').filter(Boolean).slice(-3).join(' · ').slice(0, 300);
    return { estado: 'reventado', ejecutados, rojos, segs: segs(), motivo: `no se pudo leer ningún resultado (código ${code}): ${cola}` };
  }
  return { estado: 'completo', ejecutados, rojos, segs: segs(), motivo: null };
}
