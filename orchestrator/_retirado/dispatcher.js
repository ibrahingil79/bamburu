// dispatcher.js — Registro en disco, pausas manuales y los prompts que hay que copiar a Code.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const SALIDA = (s) => process.stdout.write(s + '\n');

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

export function marcaTiempo(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Un registro que escribe a la vez en pantalla y en logs/orchestrator-{marca}.log.
 * En simulacro no toca el disco.
 */
export function crearRegistro({ dirLogs, dryRun, nombre = null }) {
  // Sin nombre, un fichero por ejecución de tarea. Con nombre (el daemon: daemon.log),
  // uno solo que se va acumulando, porque su historia es continua.
  const ruta = path.join(dirLogs, nombre || `orchestrator-${marcaTiempo()}.log`);
  if (!dryRun) {
    fs.mkdirSync(dirLogs, { recursive: true });
    if (nombre) fs.appendFileSync(ruta, '', 'utf8');
    else fs.writeFileSync(ruta, '', 'utf8');
  }

  const escribir = (nivel, texto) => {
    const hora = new Date().toISOString();
    if (!dryRun) {
      try { fs.appendFileSync(ruta, `${hora} [${nivel}] ${texto}\n`, 'utf8'); } catch { /* el registro nunca tumba la ejecución */ }
    }
    SALIDA(texto);
  };

  return {
    ruta: dryRun ? '(simulacro: no se escribe registro)' : ruta,
    blanco: () => escribir('----', ''),
    info: (t) => escribir('INFO', `    ${t}`),
    detalle: (t) => escribir('INFO', t),
    paso: (n, t) => escribir('PASO', `\n▸ PASO ${n} — ${t}`),
    exito: (t) => escribir('  OK', `    ✅ ${t}`),
    aviso: (t) => escribir('AVIS', `    ⚠️  ${t}`),
    error: (t) => escribir(' ERR', `    ❌ ${t}`),
    titulo: (t) => escribir('INFO', `\n${'═'.repeat(78)}\n${t}\n${'═'.repeat(78)}`),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Despacho automático
// ─────────────────────────────────────────────────────────────────────────────

const BIN_CLAUDE = process.env.ORCHESTRATOR_CLAUDE_BIN || 'claude';
const MODELO = process.env.ORCHESTRATOR_CLAUDE_MODEL || 'claude-opus-5';
const EXTRA = (process.env.ORCHESTRATOR_CLAUDE_ARGS || '').split(/\s+/).filter(Boolean);
const TIEMPO_DESPACHO = Number(process.env.ORCHESTRATOR_DISPATCH_TIMEOUT || 30 * 60 * 1000);

/**
 * Lanza Claude Code con el prompt y espera a que termine.
 *
 * Sin nada en ORCHESTRATOR_CLAUDE_ARGS, Claude Code pedirá permiso para escribir
 * ficheros y para usar git; bajo systemd no hay quien conteste y el despacho se
 * queda colgado hasta que vence el plazo. Esa puerta se abre a mano, a sabiendas,
 * poniendo ORCHESTRATOR_CLAUDE_ARGS=--dangerously-skip-permissions. No viene
 * puesto de fábrica: dejar a un agente escribir y confirmar sin preguntar es una
 * decisión de Ibrahin, no un valor por defecto que yo pueda dar por supuesto.
 */
export function despacharConClaude({ prompt, registro, cwd }) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--model', MODELO, ...EXTRA];
    registro.info(`Despacho: ${BIN_CLAUDE} -p <prompt> --model ${MODELO} ${EXTRA.join(' ')}`.trim());
    if (!EXTRA.length) {
      registro.aviso('ORCHESTRATOR_CLAUDE_ARGS está vacío: si Claude Code pide permisos, nadie contestará.');
    }

    let hijo;
    try {
      hijo = spawn(BIN_CLAUDE, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, codigo: null, salida: String(e.message) });
    }

    let salida = '';
    let vencido = false;
    const reloj = setTimeout(() => { vencido = true; hijo.kill('SIGTERM'); }, TIEMPO_DESPACHO);
    const recoger = (t) => { salida += t; if (salida.length > 2 * 1024 * 1024) salida = salida.slice(-1024 * 1024); };
    hijo.stdout.on('data', recoger);
    hijo.stderr.on('data', recoger);
    hijo.on('error', (e) => { clearTimeout(reloj); resolve({ ok: false, codigo: null, salida: String(e.message) }); });
    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      if (vencido) {
        return resolve({ ok: false, codigo: null, vencido: true,
          salida: `${salida}\n[cortado: pasó de ${Math.round(TIEMPO_DESPACHO / 60000)} min]` });
      }
      resolve({ ok: codigo === 0, codigo, salida });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pausas
// ─────────────────────────────────────────────────────────────────────────────

function preguntar(mensaje) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(mensaje, (r) => { rl.close(); resolve(String(r || '').trim().toLowerCase()); });
  });
}

/**
 * El punto de traspaso entre el orquestador y quien hace el trabajo.
 *
 *   modo 'manual' — deja el prompt en un fichero y espera a que alguien pulse ENTER.
 *   modo 'claude' — lanza Claude Code con ese mismo prompt y espera a que termine.
 *
 * En los dos casos, al volver comprueba que el fichero de salida existe y no está
 * vacío: quien dice haber terminado tiene que haber dejado algo escrito.
 * Devuelve { ok, despacho }.
 */
export async function pausa({ registro, fase, prompt, rutaPrompt, rutaSalida, dryRun, sinPausa, modo = 'manual', cwd }) {
  registro.blanco();
  registro.detalle(`${'─'.repeat(78)}`);
  registro.detalle(`⏸  PAUSA — ${fase}`);
  registro.detalle(`${'─'.repeat(78)}`);
  registro.detalle(prompt);
  registro.detalle(`${'─'.repeat(78)}`);

  if (!dryRun) {
    fs.mkdirSync(path.dirname(rutaPrompt), { recursive: true });
    fs.writeFileSync(rutaPrompt, prompt + '\n', 'utf8');
    registro.info(`Prompt listo para copiar en:  ${rutaPrompt}`);
    registro.info(`    cat ${rutaPrompt}`);
  }
  registro.info(`Se espera que quede escrito:  ${rutaSalida}`);

  if (dryRun) {
    registro.aviso('Simulacro: no hay pausa, no se escribe el prompt y no se comprueba la salida.');
    return { ok: true, despacho: null };
  }

  if (modo === 'claude') {
    const r = await despacharConClaude({ prompt, registro, cwd });
    const cola = r.salida.trim().split('\n').slice(-6).join('\n');
    if (cola) registro.detalle(cola.split('\n').map((l) => '      │ ' + l).join('\n'));
    if (!r.ok) registro.error(`El despacho terminó con código ${r.codigo === null ? '(sin código)' : r.codigo}.`);
    else registro.exito('El despacho terminó bien.');

    if (fs.existsSync(rutaSalida) && fs.statSync(rutaSalida).size > 0) {
      registro.exito(`Existe y no está vacío: ${rutaSalida}`);
      return { ok: true, despacho: r };
    }
    registro.error(`${fs.existsSync(rutaSalida) ? 'Está vacío' : 'No existe'}: ${rutaSalida}`);
    return { ok: false, despacho: r };
  }

  if (sinPausa) {
    registro.aviso('--sin-pausa: no espero a nadie, compruebo la salida directamente.');
  } else if (!process.stdin.isTTY) {
    registro.error('No hay terminal interactiva y esto necesita una pausa manual.');
    registro.info('Ejecútalo en un terminal, usa --dispatch=claude, o --sin-pausa si ya está hecho.');
    return { ok: false, despacho: null };
  }

  for (let intento = 1; ; intento++) {
    if (!sinPausa) {
      const r = await preguntar('\n    ENTER cuando esté hecho (o «x» para abortar): ');
      if (r === 'x') { registro.aviso('Abortado a mano.'); return { ok: false, despacho: null }; }
    }

    if (fs.existsSync(rutaSalida) && fs.statSync(rutaSalida).size > 0) {
      registro.exito(`Existe y no está vacío: ${rutaSalida}`);
      return { ok: true, despacho: null };
    }

    const que = fs.existsSync(rutaSalida) ? 'está vacío' : 'no existe';
    registro.error(`${rutaSalida} ${que}.`);
    if (sinPausa || intento >= 5) {
      registro.error('No sigo sin el fichero de salida.');
      return { ok: false, despacho: null };
    }
    registro.info('Escríbelo y vuelve a pulsar ENTER.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Los prompts
// ─────────────────────────────────────────────────────────────────────────────

function encabezadoTarea(tarea) {
  const criterios = tarea.criterios.length
    ? tarea.criterios.map((c) => `  - [${c.hecho ? 'x' : ' '}] ${c.texto}`).join('\n')
    : '  (el tablero no lista criterios: acuérdalos con Ibrahin antes de dar nada por bueno)';
  return [
    `Tarea:        ${tarea.titulo}`,
    `taskId:       ${tarea.id}`,
    `Descripción:  ${tarea.descripcion}`,
    `Criterios de aceptación:`,
    criterios,
  ].join('\n');
}

export function promptArquitecto(tarea, rutas) {
  return `Eres el Code Architect de Bamburu.

${encabezadoTarea(tarea)}

Escribe el análisis arquitectónico en:
  ${rutas.analisis}

El fichero ya existe con una plantilla. Rellénalo BAJO el bloque de plantilla; puedes
borrar la plantilla al terminar si prefieres.

El orquestador no dará el análisis por bueno si no cumple las dos cosas:
  · más de 500 caracteres propios (sin contar la plantilla);
  · menciona al menos una de: «capa», «patrón», «validación», «arquitectura».

Léelas como el mínimo, no como el objetivo. Lo que se te pide de verdad:
  1. Qué falla hoy y por qué, con las rutas y las líneas concretas del repo.
  2. En qué capa vive el cambio y qué patrón sigue el resto del código para lo mismo.
  3. La decisión, y las alternativas descartadas con el motivo.
  4. Qué se toca, fichero por fichero.
  5. Qué NO entra en esta tarea.
  6. Cómo se comprueba que quedó bien.

No escribas código de producción. Esto es el plano, no la obra.`;
}

export function promptProgramador(tarea, rutas) {
  return `Eres el Code Programmer de Bamburu.

${encabezadoTarea(tarea)}

Lee ANTES de tocar nada, y trabaja según lo que diga:
  ${rutas.analisis}

Reglas que el orquestador va a comprobar después, sin excepción:
  · al menos un commit nuevo;
  · el mensaje de commit contiene literalmente «${tarea.id}»;
  · las líneas de código que añadas no llevan console.log ni marcas de pendiente
    (esas dos las comprueba el orquestador sobre el diff, solo en ficheros .js/.ts).

Si el análisis se equivoca en algo, PARA y dilo. No lo arregles por tu cuenta:
el arquitecto y tú tenéis que estar de acuerdo antes de que exista el código.`;
}

export function promptRevision(tarea, rutas, commits) {
  const lista = commits.length
    ? commits.map((c) => `  ${c.corto}  ${c.asunto}`).join('\n')
    : '  (ninguno)';
  return `Eres el Code Architect de Bamburu, revisando lo que se construyó.

${encabezadoTarea(tarea)}

Análisis que se pactó:  ${rutas.analisis}
Commits a revisar:
${lista}

  git diff ${commits.length ? commits[0].sha + '^' : 'HEAD~1'}..HEAD

Escribe la revisión en:
  ${rutas.review}

Tiene que empezar por el veredicto, escrito EXACTAMENTE con una de estas dos formas
(el orquestador lee esa cadena y solo esa):

  ✅ APROBADO
  ❌ RECHAZADO

Si es ❌ RECHAZADO, di qué falta y qué hay que cambiar, punto por punto: ese texto se
vuelca tal cual en el fichero de feedback y es lo único que el programador va a leer.

Revisa, en este orden:
  1. ¿Hace lo que decía el análisis? ¿Se desvió sin decirlo?
  2. ¿Cumple los criterios de aceptación de arriba, uno a uno?
  3. ¿Respeta la capa y el patrón del resto del código?
  4. ¿Qué se rompe? Casos límite, concurrencia, datos ya existentes.
  5. ¿Sobra código? ¿Falta comprobación?

Aprobar algo que no cumple cuesta más caro que rechazarlo.`;
}
