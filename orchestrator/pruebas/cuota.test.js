// Las reglas de la LECTURA de cuota. Salen todas de la misma avería del 1 sep 2026: una
// lectura ilegible a las 13:54:52 dejó la fábrica parada hasta las 14:00:04 con un 32%
// disponible, y el vigía leía `/usage` sin problema a las 13:58:25.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vigilante } from '../cuota/vigilante.js';
import { ErrorOrquestador, CLASES } from '../nucleo/errores.js';

const USAGE = (pct) => 'You are currently using your subscription to power your Claude Code usage\n\n'
  + `Current session: ${pct}% used · resets Sep 1, 6pm (UTC)\n`
  + 'Current week (all models): 35% used · resets Sep 3, 6pm (UTC)\n';

const CONFIG = {
  cli: { binario: 'claude', modelo: 'm', timeoutMs: 1000, maxSalidaBytes: 1000 },
  cuota: { cacheMs: 300000, timeoutConsultaMs: 1000, reintentosLectura: 3, esperaEntreLecturasMs: 1 },
};

// La avería EXACTA: exit 0 y una salida que no parsea. No es un error inventado.
const ILEGIBLE = () => ({
  ok: false, texto: '', json: null, ms: 10, cuotaSospechosa: false,
  error: new ErrorOrquestador(CLASES.SALIDA_INVALIDA, 'la salida no es JSON (código 0): {"num_turns":0,"stop_reason":null',
    { codigo: 0, salidaCruda: '{"num_turns":0,"stop_reason":null', erroresCrudos: '' }),
});
const BUENA = (pct) => ({ ok: true, texto: USAGE(pct), json: {}, ms: 10, cuotaSospechosa: false });

/** Un invocador de guion que además cuenta cuántas veces lo llaman. */
function guion(...pasos) {
  const fn = async () => { fn.veces++; return (pasos[fn.veces - 1] ?? pasos[pasos.length - 1])(); };
  fn.veces = 0;
  return fn;
}

test('una lectura ilegible se reintenta ahí mismo: la segunda salva la vuelta', async () => {
  const inv = guion(ILEGIBLE, () => BUENA(68));
  const v = new Vigilante({ config: CONFIG, invocador: inv });
  const r = await v.consultar();
  assert.equal(inv.veces, 2, 'tiene que reintentar, no rendirse a la primera');
  assert.equal(r.fiable, true);
  assert.equal(r.sesionPct, 68);
});

test('reintentar es ACOTADO: si de verdad no se puede leer, se dice que no se sabe', async () => {
  const inv = guion(ILEGIBLE);
  const v = new Vigilante({ config: CONFIG, invocador: inv });
  const r = await v.consultar();
  assert.equal(inv.veces, 3, 'ni una más que `reintentosLectura`');
  assert.equal(r.fiable, false);
});

test('UN FALLO NO SE CACHEA: la vuelta siguiente vuelve a preguntar, no repite el «no lo sé»', async () => {
  // Es LA avería. Antes, el «no lo sé» de las 13:54:52 ocupaba la caché sus 5 minutos enteros
  // y el daemon se plantaba con un 32% disponible sin volver a mirar.
  const inv = guion(ILEGIBLE, ILEGIBLE, ILEGIBLE, () => BUENA(68));
  const v = new Vigilante({ config: CONFIG, invocador: inv });
  assert.equal((await v.consultar()).fiable, false);
  const segunda = await v.consultar();
  assert.equal(segunda.deCache, false, 'un fallo no puede hacerse pasar por una lectura');
  assert.equal(segunda.fiable, true);
  assert.equal(segunda.sesionPct, 68);
});

test('una lectura BUENA sí se cachea: preguntar no cuesta cuota, pero tampoco se pregunta en bucle', async () => {
  const inv = guion(() => BUENA(40));
  const v = new Vigilante({ config: CONFIG, invocador: inv });
  await v.consultar();
  const segunda = await v.consultar();
  assert.equal(segunda.deCache, true);
  assert.equal(inv.veces, 1);
});

test('la última lectura buena viaja con su antigüedad ya calculada, para que la máquina no mire el reloj', async () => {
  let t = 1_000_000;
  const v = new Vigilante({ config: CONFIG, invocador: guion(() => BUENA(30), ILEGIBLE), reloj: () => t });
  await v.consultar();
  t += 4 * 60000;
  const r = await v.consultar({ forzar: true });
  assert.equal(r.fiable, false);
  assert.equal(r.ultimaFiable.sesionPct, 30);
  assert.equal(r.ultimaFiable.edadMs, 4 * 60000);
});

test('tras una llamada MUERTA POR CUOTA, una lectura ilegible no resucita el valor holgado de antes', async () => {
  // Sin esto, el arranque con el último valor conocido daría permiso para gastar una cuota
  // que acabamos de ver morir: el agujero se abre justo donde más caro sale.
  const v = new Vigilante({ config: CONFIG, invocador: guion(() => BUENA(20), ILEGIBLE) });
  await v.consultar();
  assert.equal(v.instantanea().sesionPct, 20);
  v.marcarSinCuota('la llamada del programador murió sin cuota');
  const r = await v.consultar({ forzar: true });
  assert.equal(r.ultimaFiable.sesionPct, 100, 'lo último que se sabe es que NO queda');
});
