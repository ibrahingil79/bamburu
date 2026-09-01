// cli.js — La única puerta por la que se llama a Claude Code. Nadie más lanza procesos.
//
// Resuelve las tres trampas medidas en docs/diagnostico-claude-cli-limitaciones.md:
//
//   1. `--allowedTools` es VARIÁDICO y se traga el prompt posicional (exit 1). Aquí el
//      prompt va por STDIN, que además no tiene el tope de 128 KB del argumento y evita
//      todo el escapado del shell. Es la vía más robusta de las tres medidas.
//   2. Sin `--allowedTools`, las herramientas se deniegan EN SILENCIO con exit 0. Por eso
//      se pide `--output-format json` y se comprueba `permission_denials`, no solo el
//      código de salida.
//   3. El CLI no trae timeout propio: lo ponemos aquí, y al vencer se mata el árbol entero.
import { spawn } from 'node:child_process';
import { ErrorOrquestador, CLASES } from '../nucleo/errores.js';

// Red de seguridad secundaria: frases con las que una puerta cerrada se anuncia.
// Van como FRASES y no como palabras sueltas por una cicatriz heredada del token-monitor
// anterior: con «límite» a secas, el prompt del revisor —que pide mirar los «casos límite»—
// hacía creer al sistema que la cuenta se había quedado sin saldo.
const SIN_CUOTA = /hit your (?:session|weekly|opus|sonnet) limit|usage limit reached|rate.?limit|quota exceeded|too many requests|credit balance|insufficient (?:credit|funds|quota)|l[ií]mite de uso alcanzado/i;

/**
 * Lanza `claude -p` y devuelve un resultado clasificado. NO lanza excepciones por fallos
 * del modelo: devuelve `{ ok:false, error }` con el error ya tipado, porque quien decide
 * qué hacer con un fallo es la máquina de estados, no esta función.
 *
 * @returns { ok, texto, json, error?, ms, cuotaSospechosa }
 */
export function invocar({ prompt, herramientas = [], cwd, config, señal = null, alSalir = null }) {
  const { binario, modelo, timeoutMs, maxSalidaBytes } = config.cli;

  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', '--model', modelo];
    if (herramientas.length) args.push('--allowedTools', herramientas.join(','));

    const t0 = Date.now();
    let hijo;
    try {
      hijo = spawn(binario, args, {
        cwd,
        env: { ...process.env, HOME: process.env.HOME },
        stdio: ['pipe', 'pipe', 'pipe'],
        // Grupo propio: al vencer el plazo se mata el árbol entero y no queda ni un huérfano.
        detached: true,
      });
    } catch (e) {
      const clase = e.code === 'ENOENT' ? CLASES.CONFIGURACION : CLASES.DESCONOCIDO;
      return resolve(fallo(new ErrorOrquestador(clase, `no pude lanzar «${binario}»: ${e.message}`), t0));
    }

    let salida = '';
    let errores = '';
    let vencido = false;
    let cortado = false;

    // La manija de fuera MARCA la llamada como cortada, no solo mata al hijo. Sin esto, una
    // llamada que cortamos a propósito volvía clasificada como «la salida no es JSON (código
    // 143)» —143 es 128+SIGTERM, o sea nuestra propia señal— y el ciclo la apuntaba como fallo
    // técnico del papel. Medido el 1 sep 2026 verificando la parada.
    if (alSalir) alSalir(() => { cortado = true; matarArbol(hijo); });

    const reloj = setTimeout(() => { vencido = true; matarArbol(hijo); }, timeoutMs);

    const abortar = () => { cortado = true; matarArbol(hijo); };
    if (señal) {
      if (señal.aborted) abortar();
      else señal.addEventListener('abort', abortar, { once: true });
    }

    hijo.stdout.on('data', (t) => {
      salida += t;
      if (salida.length > maxSalidaBytes) salida = salida.slice(-maxSalidaBytes);
    });
    // stderr se recoge pero NO se usa para decidir nada: en esta máquina trae avisos de
    // reglas de permisos que no son errores, y su número ni siquiera es estable.
    hijo.stderr.on('data', (t) => {
      errores += t;
      if (errores.length > 65536) errores = errores.slice(-65536);
    });

    try { hijo.stdin.end(prompt); }
    catch (e) { clearTimeout(reloj); return resolve(fallo(new ErrorOrquestador(CLASES.DESCONOCIDO, `no pude escribir el prompt: ${e.message}`), t0)); }

    hijo.on('error', (e) => {
      clearTimeout(reloj);
      if (señal) señal.removeEventListener?.('abort', abortar);
      resolve(fallo(new ErrorOrquestador(CLASES.DESCONOCIDO, `el proceso falló: ${e.message}`), t0));
    });

    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      if (señal) señal.removeEventListener?.('abort', abortar);
      resolve(clasificar({ codigo, salida, errores, vencido, cortado, timeoutMs, t0 }));
    });
  });
}

/** Mata el grupo entero. Si el grupo ya no existe, se intenta con el proceso a secas. */
function matarArbol(hijo) {
  try { process.kill(-hijo.pid, 'SIGTERM'); }
  catch { try { hijo.kill('SIGTERM'); } catch { /* ya estaba muerto */ } }
}

function fallo(error, t0) {
  return { ok: false, texto: '', json: null, error, ms: Date.now() - t0, cuotaSospechosa: error.esperaCuota };
}

/**
 * Aquí se decide qué fue lo que pasó. El orden de las comprobaciones importa:
 * primero lo que sabemos con certeza, y «desconocido» solo al final.
 */
export function clasificar({ codigo, salida, errores, vencido, cortado, timeoutMs, t0 }) {
  const ms = Date.now() - t0;
  const todo = `${salida}\n${errores}`;

  if (cortado) return fallo(new ErrorOrquestador(CLASES.LLAMADA_CORTADA, 'la cortamos desde fuera: no llegó a terminar'), t0);
  if (vencido) {
    return fallo(new ErrorOrquestador(CLASES.TIEMPO_AGOTADO,
      `la llamada pasó de ${Math.round(timeoutMs / 60000)} min y se cortó`, { ms }), t0);
  }

  let json = null;
  try { json = JSON.parse(salida); } catch { /* abajo se decide qué significa */ }

  // Sin JSON: o murió antes de escribir, o dijo algo en texto plano. La salida se escribe
  // de golpe al final, así que un fichero vacío es lo normal cuando el proceso no llegó.
  if (!json) {
    if (SIN_CUOTA.test(todo)) {
      return fallo(new ErrorOrquestador(CLASES.CUOTA_AGOTADA, `sin cuota: ${resumen(todo)}`, { codigo }), t0);
    }
    if (codigo === 0 && !salida.trim()) {
      return fallo(new ErrorOrquestador(CLASES.MODELO_SIN_RESPUESTA, 'terminó bien pero no escribió nada', { codigo }), t0);
    }
    return fallo(new ErrorOrquestador(CLASES.SALIDA_INVALIDA,
      `la salida no es JSON (código ${codigo}): ${resumen(salida) || resumen(errores) || 'vacía'}`, { codigo }), t0);
  }

  // Con JSON, los campos mandan sobre el código de salida.
  //
  // Los permisos denegados se DETECTAN siempre, pero solo son fatales si además no hubo
  // entrega. Lo enseñó la prueba de laboratorio del 31 ago 2026: al arquitecto le denegaron
  // Bash y aun así escribió un análisis de 18 KB con sus 7 criterios, perfectamente válido —
  // y esta función lo tiraba a la basura, gastando otra llamada para nada.
  // La regla buena es «manda el artefacto»: se avisa de la denegación, y quien juzga si el
  // trabajo vale es la validación del paso, no el transporte.
  const denegados = Array.isArray(json.permission_denials) ? json.permission_denials : [];
  const herramientasDenegadas = [...new Set(denegados.map((d) => d.tool_name))];
  if (denegados.length && !String(json.result || '').trim()) {
    return fallo(new ErrorOrquestador(CLASES.PERMISOS_DENEGADOS,
      `se denegaron herramientas en silencio y no entregó nada: ${herramientasDenegadas.join(', ')}`,
      { herramientas: herramientasDenegadas, denegados: denegados.length }), t0);
  }
  if (json.subtype === 'error_max_turns') {
    return fallo(new ErrorOrquestador(CLASES.MODELO_SIN_RESPUESTA, 'se agotaron los turnos antes de terminar', { codigo }), t0);
  }
  if (json.is_error || codigo !== 0) {
    const texto = String(json.result || '');
    const clase = SIN_CUOTA.test(texto) || SIN_CUOTA.test(todo) ? CLASES.CUOTA_AGOTADA : CLASES.DESCONOCIDO;
    return fallo(new ErrorOrquestador(clase, `la llamada falló (código ${codigo}): ${resumen(texto)}`, { codigo }), t0);
  }
  if (!String(json.result || '').trim()) {
    return fallo(new ErrorOrquestador(CLASES.MODELO_SIN_RESPUESTA, 'la respuesta vino vacía', { codigo }), t0);
  }

  return {
    ok: true,
    texto: String(json.result),
    json,
    denegadas: herramientasDenegadas,   // aviso, no fallo: manda el artefacto
    ms,
    coste: json.total_cost_usd ?? null,   // estimación local de consumo, NO un cargo
    sesion: json.session_id ?? null,
    cuotaSospechosa: false,
  };
}

const resumen = (t) => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 300);
export const pareceSinCuota = (t) => SIN_CUOTA.test(String(t || ''));
