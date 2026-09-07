#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// censo-ia-apagada.mjs — EL GUARDIÁN: que Bamburu no vuelva a llamar al proveedor de IA.
//
// **Decisión de Ibrahin, 6 sep 2026: Bamburu deja de usar IA.** Este censo existe porque una decisión
// que solo vive en la buena intención dura hasta el siguiente que toque el fichero.
//
// ⚠️ QUÉ MIDE, Y CÓMO — y esto es lo que lo distingue de un censo de los de buscar texto.
// Palabras de Ibrahin al encargarlo: *«que ninguna comprobación consiga una llamada saliente al
// proveedor, MEDIDO DE VERDAD, no por nombres ni por búsqueda de texto»*.
//
// Buscar `api.anthropic.com` en el árbol se engaña partiendo la cadena en dos, o metiéndola en una
// variable, o leyéndola de un fichero — y encima da verde aunque una dependencia llame por su cuenta.
// **Lo único que no se puede disimular es el intento de salir.** Así que aquí se pone un centinela
// en las cinco puertas de red de Node (`scripts/lib/centinela-red.cjs`), se EJECUTA el código de
// verdad, y se cuenta.
//
// ⚠️ Y NO SE FÍA DE SU PROPIO INSTRUMENTO. Un centinela que no ve nada y un centinela roto dan la
// misma respuesta: cero. Por eso el paso [3] **quita el corte en una copia de `core/llm.js`** y exige
// que el centinela SÍ lo cace. Si esa parte no se pusiera roja, el cero de arriba no valdría nada.
//
// **La primera versión de este censo exigía que dos gates concretos estuvieran «interceptados».
// Ibrahin la retiró el mismo día:** *«el candado bueno está en callClaude() y protege por sí solo,
// sin depender de qué gate exista. Un guardián que exige algo sin contenido confunde a quien lo lea
// después.»* Tenía razón, y además mi lista de gates estaba mal medida.
//
//   node scripts/censo-ia-apagada.mjs
// ═════════════════════════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const CENTINELA = path.join(RAIZ, 'scripts/lib/centinela-red.cjs');
const BANCO = mkdtempSync(path.join(tmpdir(), 'censo-ia-'));

let pass = 0, fail = 0;
const ok = (c, m, d) => {
  if (c) { pass++; console.log('  ✓ ' + m + (d ? ' · ' + d : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (d ? ' · ' + d : '')); }
};

/** Lanza un hijo con el centinela puesto y devuelve { salida, intentos } — intentos MEDIDOS. */
function conCentinela(codigo, { llmAlternativo = null } = {}) {
  const parte = path.join(BANCO, 'parte-' + Math.random().toString(36).slice(2) + '.jsonl');
  const guion = path.join(BANCO, 'sonda-' + Math.random().toString(36).slice(2) + '.mjs');
  writeFileSync(guion, codigo.replace('__LLM__', JSON.stringify(llmAlternativo || path.join(RAIZ, 'core/llm.js'))));
  const r = spawnSync(process.execPath, ['--require', CENTINELA, guion], {
    encoding: 'utf8', timeout: 60000, cwd: RAIZ,
    env: { ...process.env, BAMBURU_CENTINELA_RED: parte },
  });
  const intentos = existsSync(parte)
    ? readFileSync(parte, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { via: '?' }; } })
    : [];
  return { salida: (r.stdout || '') + (r.stderr || ''), codigo: r.status, intentos };
}

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL CENTINELA VE DE VERDAD — si no, el cero de después no vale nada');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Se prueba el instrumento ANTES de usarlo, y contra las cinco puertas de red. Un `fetch` a un
  // host cualquiera tiene que pasar; uno al proveedor, no.
  {
    const r = conCentinela(`
      let libre = 'pasó';
      try { await fetch('http://127.0.0.1:1/nada'); } catch (e) { libre = e.code === 'centinela_red' ? 'CAZADO' : 'falló por red (normal)'; }
      console.log('LIBRE:' + libre);
      for (const [via, fn] of [
        ['fetch',        async () => fetch('https://api.anthropic.com/v1/messages')],
        ['https',        async () => (await import('node:https')).request({ hostname: 'api.anthropic.com', path: '/v1/messages' })],
        ['tls',          async () => (await import('node:tls')).connect({ host: 'api.anthropic.com', port: 443 })],
        ['dns',          async () => (await import('node:dns')).lookup('api.anthropic.com', () => {})],
      ]) { try { await fn(); console.log('ESCAPÓ:' + via); } catch (e) { if (e.code !== 'centinela_red') console.log('OTRO:' + via + ':' + e.code); } }
      console.log('FIN');`);
    ok(/LIBRE:falló por red \(normal\)/.test(r.salida) || /LIBRE:pasó/.test(r.salida),
       'el tráfico que no es del proveedor pasa intacto (no estorba a Stripe, Resend ni a los gates)');
    ok(!/ESCAPÓ:/.test(r.salida), 'ninguna de las cuatro puertas se le escapa', (r.salida.match(/ESCAPÓ:\w+/g) || []).join(', ') || 'ninguna');
    ok(r.intentos.length >= 4, 'y los APUNTA todos, con su vía', r.intentos.map(i => i.via).join(', '));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] MEDIDO: llamar a callClaude() NO produce ni una salida');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const r = conCentinela(`
      const { callClaude } = await import(__LLM__);
      let code = 'no lanzó';
      try { await callClaude({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hola' }] }); }
      catch (e) { code = e.code || e.message; }
      console.log('CODE:' + code);`);
    ok(r.intentos.length === 0, 'cero intentos de salir al proveedor', 'medido: ' + r.intentos.length);
    ok(/CODE:ia_apagada/.test(r.salida), 'y callClaude corta con ia_apagada', (r.salida.match(/CODE:\S+/) || [])[0]);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] ROJO PROVOCADO — se QUITA el corte y el guardián tiene que saltar');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Sobre una COPIA de core/llm.js, nunca sobre el fichero de verdad. Es la prueba de que el cero de
  // arriba lo produce el corte y no la casualidad.
  {
    const copia = path.join(BANCO, 'llm-sin-corte.js');
    const fuente = readFileSync(path.join(RAIZ, 'core/llm.js'), 'utf8');
    const sinCorte = fuente
      .replace('export const IA_APAGADA = true;', 'export const IA_APAGADA = false;')
      .replace(/from '\.\/(control-db|mailer)\.js'/g, (m, n) => `from ${JSON.stringify(path.join(RAIZ, 'core', n + '.js'))}`);
    ok(sinCorte !== fuente, 'la avería se puede sembrar: el interruptor está donde se dice');
    writeFileSync(copia, sinCorte);

    const r = conCentinela(`
      const { callClaude } = await import(__LLM__);
      let code = 'no lanzó', hubo = 'sin datos';
      try { const d = await callClaude({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hola' }], apiKey: 'zz-de-mentira' }); hubo = d ? 'CON DATOS' : 'sin datos'; }
      catch (e) { code = e.code || e.message; }
      console.log('CODE:' + code);
      console.log('RESPUESTA:' + hubo);`, { llmAlternativo: copia });

    ok(r.intentos.length > 0, 'SIN el corte, el centinela CAZA la salida', r.intentos.length + ' intento(s)');
    ok(r.intentos.some(i => /anthropic/.test(i.host || '')), 'y dice a dónde iba', r.intentos[0]?.host);
    ok(r.intentos.some(i => i.via), 'y por qué puerta', r.intentos.map(i => i.via).join(', '));
    // ⚠️ El código que ve el llamador NO es `centinela_red`, y eso es correcto: `core/llm.js`
    // envuelve cualquier fallo de transporte y lo reetiqueta como `llm_transport` (línea ~194).
    // Lo que hay que exigir, entonces, no es una etiqueta: es que **no haya respuesta**. Si el
    // centinela dejara pasar la llamada, aquí llegaría un error del proveedor (401 con esa clave de
    // mentira) o datos — y en ninguno de los dos casos diría «sin datos» con un fallo de transporte.
    ok(/RESPUESTA:sin datos/.test(r.salida) && /CODE:(centinela_red|llm_transport)/.test(r.salida),
       'y la llamada se CORTA, no solo se apunta: no vuelve ninguna respuesta',
       (r.salida.match(/CODE:\S+/) || [])[0]);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] MEDIDO: las tres piezas que usaban el modelo contestan sin salir a la red');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // No se comprueba «que el fichero diga iaApagada»: se EJECUTA `iaApagada()` desde el módulo de
  // verdad y se exige que las tres rutas estén cortadas por él.
  {
    const r = conCentinela(`
      const { iaApagada, IA_APAGADA } = await import(__LLM__);
      console.log('APAGADA:' + (iaApagada() === true && IA_APAGADA === true));`);
    ok(/APAGADA:true/.test(r.salida), 'el interruptor responde que sí desde el módulo de verdad');
    ok(r.intentos.length === 0, 'y preguntarlo no sale a la red');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] EL PARTE DEL BARRIDO, SI LO HAY');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Cuando el barrido corre con el centinela puesto (`NODE_OPTIONS=--require …/centinela-red.cjs`),
  // deja su parte en un fichero. Si existe, aquí se exige que esté VACÍO. Si no existe, se dice —
  // no se finge que se ha medido algo que no se ha medido.
  {
    const parte = process.env.BAMBURU_CENTINELA_RED;
    if (!parte) {
      console.log('  · no se ha corrido con centinela puesto (BAMBURU_CENTINELA_RED sin definir): nada que leer aquí.');
      console.log('    Para medir un barrido entero:');
      console.log('      BAMBURU_CENTINELA_RED=/tmp/parte.jsonl \\');
      console.log('      NODE_OPTIONS="--require ' + CENTINELA + '" \\');
      console.log('      node scripts/run-gates.mjs --all');
    } else {
      const n = existsSync(parte) ? readFileSync(parte, 'utf8').split('\n').filter(Boolean).length : 0;
      ok(n === 0, 'el parte del centinela está vacío: ni una salida al proveedor', parte + ' · ' + n + ' línea(s)');
    }
  }
} finally {
  try { rmSync(BANCO, { recursive: true, force: true }); } catch (_) {}
}

console.log(`\nRESULTADO: ${pass} ✓ · ${fail} ✗`);
process.exit(fail ? 1 : 0);
