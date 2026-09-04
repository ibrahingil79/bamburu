#!/usr/bin/env node
//
// comprobar-clave-anthropic.mjs — ¿la clave de Anthropic que hay puesta RESPONDE?
//
// QUÉ HACE. Una llamada REAL al proveedor, la más pequeña posible (modelo barato, un token de
// respuesta), y dice tres cosas y solo tres: responde · no responde · no se ha podido comprobar.
//
// LO QUE ESTE PROGRAMA NO IMPRIME NUNCA, Y ES SU RAZÓN DE SER: la clave, un fragmento suyo, su
// longitud, su huella, ni nada derivado de ella. Ni cuando va bien ni cuando falla. Todo lo que sale
// por pantalla pasa antes por `tapar()`, porque un mensaje de error de una librería puede traer la
// petición entera dentro — y la petición lleva la cabecera `x-api-key`.
//
// POR QUÉ PASA POR `callClaude` Y NO HACE SU PROPIO `fetch`: la regla del proyecto (core/llm.js) es
// que ese fichero es el ÚNICO que conoce la clave y el transporte. Una comprobación que se saltara
// esa regla mediría un camino que el producto no usa.
//
// Y POR QUÉ HACE FALTA EL «ESPÍA» DE ABAJO. `callClaude` aplasta CUALQUIER respuesta no-OK del
// proveedor a un `status` 502 genérico («rechazó temporalmente la solicitud»). Para el usuario de
// DISA eso está bien; para comprobar una credencial es inservible: un 401 «esta clave no vale» y un
// 500 del proveedor llegan aquí idénticos. Se vio en la primera prueba en rojo de este mismo
// programa — con una clave inventada dijo «no es cosa de la clave, reintenta», que es justo la
// respuesta contraria a la que hace falta. Así que se usa `fetchImpl`, que es un punto de
// inyección que `callClaude` YA ofrece, sólo para anotar el código HTTP REAL antes de que se
// pierda. El espía no mira ni registra las cabeceras — ahí viaja la clave — ni el cuerpo.
//
// TRES RESULTADOS, TRES CÓDIGOS DE SALIDA DISTINTOS — porque «ha fallado» y «no he podido probarlo»
// no son lo mismo, y confundirlos es como nacen los falsos verdes:
//   0 · responde
//   1 · NO responde (la clave no vale, o el proveedor la rechaza)
//   2 · no se ha podido comprobar (no hay clave puesta, o el tope de gasto del mes corta antes de
//       llamar, o no hay red). Esto NO es un aprobado y NO es un suspenso de la clave.
//
//   node scripts/comprobar-clave-anthropic.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// EL ORDEN DE ESTAS DOS LÍNEAS ES EL PROGRAMA. El freno de gasto de `callClaude` abre
// `data/control.db` con ruta RELATIVA, y lo hace AL IMPORTARSE, no al llamarse. Como los `import`
// se evalúan antes que cualquier línea del cuerpo, un `process.chdir()` escrito debajo de un
// `import` estático llega TARDE: el programa revienta al lanzarlo desde otra carpeta antes de haber
// ejecutado nada. Por eso se cambia de carpeta primero y se importa después, a mano.
// (La primera versión lo tenía al revés. Lo destapó lanzarlo desde /tmp, no el razonamiento.)
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const { callClaude, hasAnthropicKey } = await import('../core/llm.js');

// Cinturón: nada sale de aquí sin pasar por este filtro.
const tapar = (s) => String(s == null ? '' : s).replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-«oculto»');

const ok    = (m) => { console.log('\n✅ LA CLAVE RESPONDE — ' + tapar(m) + '\n'); process.exit(0); };
const mal   = (m) => { console.error('\n❌ LA CLAVE NO RESPONDE — ' + tapar(m) + '\n'); process.exit(1); };
const nose  = (m, pista) => {
  console.error('\n⚠️  NO SE HA PODIDO COMPROBAR — ' + tapar(m));
  if (pista) console.error('   ' + tapar(pista));
  console.error('   Esto NO es un aprobado: la clave sigue sin verificar.\n');
  process.exit(2);
};

if (!hasAnthropicKey()) {
  nose('no hay ninguna clave puesta.',
       'Falta la línea ANTHROPIC_API_KEY= en /etc/bamburu.env, o está vacía.');
}

// Anota el código HTTP real y devuelve la respuesta intacta. NO toca `init` (lleva la clave).
let estadoReal = 0;
const fetchEspia = async (url, init) => {
  const r = await fetch(url, init);
  estadoReal = r.status;
  return r;
};

console.log('Llamando al proveedor de verdad (una petición mínima)…');
try {
  const r = await callClaude({
    model: 'claude-haiku-4-5-20251001',   // el más barato de los que ya usa el producto
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ok' }],
    timeoutMs: 20000,
    fetchImpl: fetchEspia,
  });
  if (r && (r.content || r.id)) ok('el proveedor ha contestado correctamente.');
  mal('el proveedor ha contestado, pero con una respuesta que no se entiende.');
} catch (e) {
  const codigo = e?.code || '';
  // El del espía MANDA: es el que dio el proveedor. El de `callClaude` es el aplastado.
  const estado = estadoReal || e?.status || 0;

  // El freno de gasto corta ANTES de llamar: no se ha probado la clave, no se ha suspendido.
  if (codigo === 'llm_global_cap' || codigo === 'llm_tenant_cap') {
    nose('el tope de gasto de IA de este mes corta antes de llamar al proveedor.',
         'Sube el tope o espera al mes que viene; la clave se queda sin comprobar.');
  }
  // 401/403: esto SÍ es la clave.
  if (estado === 401 || estado === 403) {
    mal('el proveedor la ha RECHAZADO (HTTP ' + estado + '). O no es válida, o está revocada, '
      + 'o se pegó cortada o con espacios.');
  }
  if (estado === 400) {
    mal('el proveedor ha rechazado la petición (HTTP 400). Suele ser una clave pegada a medias.');
  }
  if (estado === 429) {
    nose('el proveedor ha respondido «demasiadas peticiones» (HTTP 429).',
         'La clave puede ser buena; vuelve a lanzarlo en un minuto.');
  }
  if (estado >= 500) {
    nose('el proveedor ha dado un error suyo (HTTP ' + estado + ').', 'No es cosa de la clave. Reintenta.');
  }
  if (/tardó demasiado|contactar/i.test(e?.message || '')) {
    nose('no se ha podido contactar con el proveedor.', 'Puede ser la red del servidor, no la clave.');
  }
  mal((e?.message || 'error desconocido') + (estado ? ' (HTTP ' + estado + ')' : ''));
}
