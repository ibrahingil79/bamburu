#!/usr/bin/env node
// Gate — el mapa de permisos por ruta sigue siendo cierto.
//
// Ficha `permisos-paso-1-censo-rutas` (7 sep 2026). El censo
// (`scripts/censo-permisos-rutas.mjs`) dice qué exige cada una de las 610 rutas. Un mapa así caduca
// en la primera semana si nadie lo vigila, y **un censo que dice algo falso es peor que no tenerlo,
// porque cierra la pregunta** — este censo ya se equivocó tres veces mientras se construía.
//
// Vigila tres cosas:
//   [1] Las guardas de `core/` siguen DICIENDO qué permiso exigen. Si alguien quita la etiqueta, el
//       censo empieza a declarar «sin guarda» rutas protegidas, en silencio.
//   [2] NO HAY RUTAS PÚBLICAS NUEVAS. La lista de las que no tienen guarda está fijada aquí abajo:
//       una ruta nueva sin guarda es un rojo, y hay que decidirla a propósito, no descubrirla.
//   [3] Lo que el censo dice, el servidor lo cumple: una muestra de rutas guardadas DENIEGA de
//       verdad sin sesión. Es la comprobación que cazó el fallo grande del censo.
//
//   node scripts/gate-permisos-por-ruta.mjs

import { request as peticionHttp } from 'node:http';
import { censar } from './censo-permisos-rutas.mjs';

/**
 * Pide una ruta al servicio vivo CON su cabecera `Host`, que es lo que decide de qué negocio es la
 * petición. **No se usa `fetch`**: el de Node borra `Host` por norma (es cabecera prohibida), así
 * que todas las peticiones llegaban sin negocio y el servidor contestaba 404 — y este gate daba por
 * abiertas rutas que en realidad redirigen a la entrada. Se cazó comparando con `curl`.
 */
function pedir(puerto, camino, host) {
  return new Promise(res => {
    const r = peticionHttp({ host: '127.0.0.1', port: puerto, path: camino, method: 'GET', headers: { host } },
      resp => { resp.resume(); res(resp.statusCode); });
    r.on('error', () => res(0));
    r.end();
  });
}
import { requirePerm, adminAuth, requireHistorial } from '../core/auth.js';
import { permissionMiddleware } from '../core/permission-check.js';

let pass = 0, fail = 0;
const ok = (c, t, d = '') => { if (c) { pass++; console.log(`  ✓ ${t}`); } else { fail++; console.log(`  ✗ ${t}${d ? ' — ' + d : ''}`); } };

// ── LAS PUERTAS PÚBLICAS, FIJADAS A PROPÓSITO ──────────────────────────────────────────────────
// Comprobadas una a una contra el servidor vivo el 7 sep 2026. Si aparece una ruta nueva aquí
// fuera, este gate se pone rojo: que una ruta no pida nada tiene que ser una decisión, no un
// descuido. Para añadir una, se añade AQUÍ, y quien lo haga deja escrito por qué.
const PUBLICAS = new Set([
  'GET /',                        // la portada
  'GET /favicon.ico', 'GET /favicon.svg',
  'GET /docs',                    // la documentación pública
  'GET /acceso', 'GET /acceso/entrar', 'POST /find-tenant',   // la entrada: aún no hay sesión
  'GET /registro',                // el alta de un negocio nuevo
  'POST /api/registro/init', 'POST /api/registro/crear', 'POST /api/registro/disa',
  'GET /superadmin/login',        // la entrada del superadmin
  'POST /stripe/webhook',         // lo valida la FIRMA de Stripe, no una sesión
  'GET /admin/autologin',         // exige un vale de un solo uso; sin él manda a /acceso
]);

const censo = await censar();

console.log('\n[1] las guardas de core/ siguen diciendo qué exigen');
{
  const p = requirePerm('ventas.ver');
  ok(p.bamburuGuarda?.tipo === 'permiso' && p.bamburuGuarda.permiso === 'ventas.ver',
     'requirePerm dice su permiso', JSON.stringify(p.bamburuGuarda));
  ok(adminAuth({}).bamburuGuarda?.tipo === 'sesion', 'adminAuth se declara SESIÓN, no permiso');
  ok(requireHistorial().bamburuGuarda?.permiso === 'historial.read', 'requireHistorial dice su permiso');
  ok(permissionMiddleware({}, 'stock', 'read').bamburuGuarda?.permiso === 'stock.read',
     'permissionMiddleware compone su permiso');
}

console.log('\n[2] el mapa tiene sentido y no hay puertas públicas nuevas');
{
  ok(censo.total > 500, `el censo encuentra las rutas (${censo.total})`);
  ok(censo.conPermiso > 400, `y la mayoría exige un permiso con nombre (${censo.conPermiso})`);
  const sinGuarda = censo.rutas.filter(r => r.veredicto === 'sin guarda').map(r => `${r.metodo} ${r.camino}`);
  const nuevas = sinGuarda.filter(r => !PUBLICAS.has(r));
  ok(nuevas.length === 0, 'ninguna ruta nueva se queda sin guarda', nuevas.join(' · '));
  const idas = [...PUBLICAS].filter(r => !sinGuarda.includes(r));
  ok(idas.length === 0, 'y las públicas conocidas siguen existiendo', idas.join(' · '));
}

console.log('\n[3] lo que el censo dice, el servidor lo cumple');
{
  const PUERTO = process.env.BAMBURU_PUERTO || 3000;
  const HOST = process.env.BAMBURU_HOST_PRUEBA || 'peluqueria-gil.bamburu.com';
  const vivo = await pedir(PUERTO, '/admin/login', HOST);
  if (!vivo) {
    console.log('  · el servicio no está en marcha — no se puede medir contra él');
  } else {
    // Una muestra estable (no aleatoria: un gate no puede dar distinto cada noche).
    const guardadas = censo.rutas
      .filter(r => r.metodo === 'GET' && r.veredicto === 'permiso' && !r.camino.includes(':') && r.camino.startsWith('/admin/'))
      .map(r => r.camino).sort().filter((_, i) => i % 17 === 0).slice(0, 8);
    let denegadas = 0;
    for (const camino of guardadas) {
      const s = await pedir(PUERTO, camino, HOST);
      if (s === 302 || s === 401 || s === 403) denegadas++;
      else console.log(`      ⚠️ ${camino} → ${s}`);
    }
    ok(guardadas.length >= 5, `hay muestra que medir (${guardadas.length} rutas)`);
    ok(denegadas === guardadas.length, 'todas las de la muestra DENIEGAN sin sesión',
       `${denegadas} de ${guardadas.length}`);
    // Y la otra dirección: una pública responde sin mandarte a la entrada.
    const portada = await pedir(PUERTO, '/', 'bamburu.com');
    ok(portada === 200, 'y la portada pública sigue abierta', String(portada));
  }
}

console.log('\n[4] ROJO PROVOCADO — sin la etiqueta, el censo declara «sin guarda» lo que sí la tiene');
{
  const { Hono } = await import('hono');
  const conEtiqueta = new Hono();
  conEtiqueta.use('*', requirePerm('ventas.ver'));
  conEtiqueta.get('/x', c => c.text('ok'));
  const guarda = conEtiqueta.routes.find(r => r.method === 'ALL')?.handler;
  ok(guarda?.bamburuGuarda?.permiso === 'ventas.ver', 'con etiqueta, la guarda se identifica');

  const copia = async (c, next) => next();          // la misma guarda, pero SIN etiqueta ni negativa
  ok(!copia.bamburuGuarda, 'sin etiqueta, no se identifica: el censo la daría por «sin guarda»');
  ok(!/redirect\s*\(\s*['"`][^'"`]*login/i.test(copia.toString()),
     'y tampoco la salvaría el reconocimiento por lo que hace: no niega el paso');

  // Y el rojo que de verdad importa: una RUTA PÚBLICA NUEVA. Se mete una en el resultado del censo
  // y se exige que la comprobación [2] la cace. Sin esto, [2] podría estar comparando dos listas
  // vacías y dando verde sobre nada.
  const conIntrusa = [
    ...censo.rutas.filter(r => r.veredicto === 'sin guarda').map(r => `${r.metodo} ${r.camino}`),
    'POST /api/erp/facturas/borrar-todo',
  ];
  const cazadas = conIntrusa.filter(r => !PUBLICAS.has(r));
  ok(cazadas.length === 1 && cazadas[0] === 'POST /api/erp/facturas/borrar-todo',
     'una ruta pública NUEVA se caza: la comprobación [2] cae y dice cuál', cazadas.join(' · '));
}

console.log(`\nRESULTADO: ${pass} ✓ · ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
