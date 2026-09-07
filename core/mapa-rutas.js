// core/mapa-rutas.js — LA CLASIFICACIÓN DE PERMISOS, EN UN SOLO SITIO.
//
// De dónde sale: `scripts/censo-permisos-rutas.mjs` (tarea `permisos-paso-1-censo-rutas`, 7 sep
// 2026) la traía dentro, para un censo que se ejecuta a mano. La tarea `barrera-de-permisos`
// (8 sep 2026) necesita la MISMA clasificación en dos sitios — el generador de la declaración (a
// mano, con tiempo) y el arranque del servidor (automático, con prisa) — y una clasificación que
// vive en dos copias es la forma exacta en que empiezan a decir cosas distintas. Se saca a un
// tercer sitio que los dos importan.
//
// LA PARTE CARA (localizar fichero:línea con el inspector de Node) SE QUEDA FUERA A PROPÓSITO.
// Medido el 8 sep 2026: montar la app (`loadModules`) cuesta 653 ms — coste que el servidor paga
// igual, con o sin esto —, y `localizar()` sobre las ~1.100 funciones implicadas cuesta 741 ms
// MÁS. Pero el veredicto (¿permiso, sesión o nada?) no necesita el inspector en absoluto: sale de
// leer `fn.bamburuGuarda`, una propiedad de la propia función — coste nulo. `localizar()` solo
// sirve para el `fichero:línea` del informe humano, así que se queda en el script de fuera, y esto
// se puede llamar en el arranque real sin que nadie lo note.
//
// Las cuatro reglas de conteo (una ruta = método+camino, el orden del `use()` manda, una guarda se
// reconoce por lo que hace no por su nombre, sesión no es permiso) están documentadas con su
// porqué en `scripts/censo-permisos-rutas.mjs` y en `docs/seguridad/permisos-por-ruta.md`.

// Comprobaciones que NO son middleware: se llaman dentro del manejador, así que solo se ven leyendo
// el código de la función que de verdad sirve la ruta (no el fichero entero).
export const POR_DENTRO = [
  ['checkPermission', /\bcheckPermission\s*\(/],
  ['puedeHistorial', /\bpuedeHistorial\s*\(/],
  ['soloDueno', /\bsoloDueno\s*\(/],
  ['hasPerm', /\bhasPerm\s*\(/],
  ['isOwner', /\bget\(\s*['"]isOwner['"]\s*\)/],
  ['isAdmin', /\bget\(\s*['"]isAdmin['"]\s*\)/],
];

// Lo que hace que un middleware SEA una guarda: que pueda negar el paso. Se mira su código, no su
// nombre, porque cada módulo bautiza las suyas como quiere.
export const NIEGA_EL_PASO = [
  /redirect\s*\(\s*['"`][^'"`]*login/i,      // te manda a la pantalla de entrada
  /,\s*401\s*\)/,                            // «no autorizado»
  /,\s*403\s*\)/,                            // «prohibido»
  /\bdenegarPermiso\s*\(/,                   // la pantalla común de permiso denegado
];

/**
 * ¿El camino de un middleware (`/admin/*`) alcanza a esta ruta?
 *
 * `/x/*` alcanza también a `/x` PELADO — medido con Hono a mano el 7 sep 2026 (`use('*')` dentro de
 * un `route('/superadmin', …)` corta igual `/superadmin` que `/superadmin/algo`).
 */
export function alcanza(patron, camino) {
  if (patron === '*' || patron === '/*' || patron === '/') return true;
  if (patron.endsWith('/*')) {
    const raiz = patron.slice(0, -2);                 // '/admin/*' → '/admin'
    return camino === raiz || camino.startsWith(raiz + '/');
  }
  return patron === camino;
}

/**
 * Clasifica TODAS las rutas de `app.routes`. Sin `sitio` (o con un Map vacío), no cuesta nada más
 * que recorrer la tabla — es lo que llama la barrera de arranque. Con `sitio` (Map fn → 'f:línea',
 * de `localizar()` en el script de censo) añade el `donde` para el informe humano.
 */
export function clasificarRutas(app, sitio = new Map()) {
  const entradas = app.routes;
  const fuenteDe = h => { try { return Function.prototype.toString.call(h); } catch { return ''; } };
  const nombreDe = h => h?.name || '(anónima)';

  // Agrupar por (método, camino). Hono mete UNA ENTRADA POR MANEJADOR, así que una ruta declarada
  // como `get(p, guarda, manejador)` aparece dos veces: contar entradas no es contar rutas.
  const porRuta = new Map();
  for (let i = 0; i < entradas.length; i++) {
    const e = entradas[i];
    if (e.method === 'ALL') continue;
    const clave = `${e.method} ${e.path}`;
    if (!porRuta.has(clave)) porRuta.set(clave, { metodo: e.method, camino: e.path, propios: [], desde: i });
    porRuta.get(clave).propios.push(e.handler);
  }

  const salida = [];
  for (const [, r] of porRuta) {
    // REGLA 2 — el orden manda: solo alcanzan los `use()` registrados ANTES de esta ruta.
    const cadena = [];
    for (let i = 0; i < r.desde; i++) {
      const m = entradas[i];
      if (m.method === 'ALL' && alcanza(m.path, r.camino)) cadena.push(m.handler);
    }
    cadena.push(...r.propios);

    const permisos = new Set();
    const guardas = [];            // toda pieza que puede negar el paso, con su nombre y su sitio
    let sesion = false;
    const porDentro = new Set();

    for (const h of cadena) {
      const g = h?.bamburuGuarda;
      const fuente = fuenteDe(h);
      if (g?.tipo === 'permiso' && g.permiso) {
        permisos.add(g.permiso);
        guardas.push({ nombre: nombreDe(h), permiso: g.permiso, donde: sitio.get(h) || '' });
        continue;
      }
      if (g?.tipo === 'sesion') {
        sesion = true;
        guardas.push({ nombre: nombreDe(h), permiso: null, donde: sitio.get(h) || '' });
        continue;
      }
      // REGLA 3 — guarda sin etiqueta: se reconoce por poder negar el paso.
      if (NIEGA_EL_PASO.some(re => re.test(fuente))) {
        sesion = true;
        guardas.push({ nombre: nombreDe(h), permiso: null, donde: sitio.get(h) || '', sinNombrar: true });
      }
    }
    // Comprobaciones POR DENTRO: solo en el manejador FINAL, que es el que sirve la ruta.
    const ultimo = r.propios[r.propios.length - 1];
    const fuenteFinal = fuenteDe(ultimo);
    for (const [nombre, re] of POR_DENTRO) if (re.test(fuenteFinal)) porDentro.add(nombre);

    salida.push({
      metodo: r.metodo,
      camino: r.camino,
      donde: sitio.get(ultimo) || '(sin localizar)',
      permisos: [...permisos].sort(),
      sesion,
      guardas,
      porDentro: [...porDentro].sort(),
      veredicto: permisos.size ? 'permiso'
               : porDentro.size ? 'por dentro'
               : sesion ? 'solo sesion'
               : 'sin guarda',
    });
  }
  salida.sort((a, b) => a.camino.localeCompare(b.camino) || a.metodo.localeCompare(b.metodo));
  return {
    rutas: salida,
    entradasEnLaTabla: entradas.length,
    middleware: entradas.filter(e => e.method === 'ALL').length,
    total: salida.length,
    conPermiso: salida.filter(r => r.veredicto === 'permiso').length,
    porDentro: salida.filter(r => r.veredicto === 'por dentro').length,
    soloSesion: salida.filter(r => r.veredicto === 'solo sesion').length,
    sinGuarda: salida.filter(r => r.veredicto === 'sin guarda').length,
  };
}
