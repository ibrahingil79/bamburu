// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL CARGADOR DE MÓDULOS — y, desde el 3 sep 2026 (AUD-007), quien decide si Bamburu merece arrancar.
//
// LO QUE HACÍA ANTES, en doce líneas: importaba cada módulo dentro de un `try`, y ante cualquier
// fallo escribía `⚠️ Módulo X error: …` en la consola **y seguía arrancando**. Con código de salida
// 0, así que para systemd el arranque había sido un éxito y no había nada que reintentar.
//
// NO ERA TEÓRICO. En el journal de esta máquina, en 30 días: **cinco veces**, y **tres de ellas se
// cayó el ERP entero** —`/admin/*` devolviendo 404 mientras el proceso decía `🚀 Bamburu listo`—.
// Duraron entre 17 y 89 segundos, y no las cazó ninguna alarma: las cazó que había una persona
// desplegando en ese momento. A las tres de la mañana no las habría visto nadie.
//
// Y HABÍA UN TERCER MODO DE FALLO QUE NO ESTABA NI EN LA FICHA: si un módulo no exporta `register`,
// el `if` de antes no tenía `else`. **No se montaba y no se decía absolutamente nada** — ni el
// aviso. No había línea que buscar en el journal: no existía.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { join } from 'path';
import { avisarArranqueRoto } from './aviso-arranque.js';

// ── QUIÉN ES ESENCIAL, EN UN SOLO SITIO Y CON SU MOTIVO ─────────────────────────────────────────
// DECISIÓN DE IBRAHIN, 3 SEP 2026: **esencial es solo el ERP.** El motivo, en sus términos: hoy el
// problema no es que falte una parte, es que nadie se entera; y una caída total de los 8 negocios
// porque DISA no importa es peor que una degradación que se oye. CANON §3-bis pide que las dos
// puertas existan, no que la casa se caiga si falta una.
//
// `esencial: true`  → si no carga, Bamburu NO ARRANCA. El proceso muere diciendo cuál y por qué.
// `esencial: false` → arranca sin él, pero **nunca en silencio**: journal + Telegram.
export const MODULOS = [
  { nombre: 'erp',    esencial: true,
    porque: 'el panel de administración y /api/erp: todo el producto de dentro. Sin él el dueño no puede facturar, cobrar ni mirar nada, y es la avería que ya ocurrió tres veces' },
  { nombre: 'store',  esencial: false,
    porque: 'la tienda pública está APAGADA desde D1 (el montaje de /store y /api/store está comentado a propósito y /store devuelve 404). Hoy este módulo no monta ni una ruta' },
  { nombre: 'disa',   esencial: false,
    porque: 'la IA es una de las dos puertas de CANON §3-bis y su ausencia degrada el producto, pero la puerta visual sigue entera y el negocio se puede operar. Decisión de Ibrahin, 3 sep 2026' },
  { nombre: 'portal', esencial: false,
    porque: 'el portal del cliente final (/portal/:token) es cara al público, pero son tres rutas y su caída no impide operar el negocio. Decisión de Ibrahin, 3 sep 2026' },
];

// ⚠️ Y DOS QUE NO PASAN POR AQUÍ, para que nadie los busque en la lista de arriba: `registro` y
// `superadmin` entran por `import` ESTÁTICO en `index.js` (líneas 14 y 15). Un import estático que
// falla mata el proceso antes de que Node llegue a ejecutar `index.js`, así que **ya se comportan
// como esenciales** — no por diseño, sino por cómo funciona Node. Se dejan como están: meterlos
// aquí sería moverlos a un camino MÁS blando que el que ya tienen.
export const ESENCIALES_POR_IMPORT_ESTATICO = ['registro', 'superadmin'];

export async function loadModules(app, db) {
  const modulesDir = join(process.cwd(), 'modules');
  for (const { nombre, esencial } of MODULOS) {
    let fallo = null;
    try {
      const { register } = await import(join(modulesDir, nombre, 'index.js'));
      // El tercer modo de fallo, el que era mudo: importa bien pero no trae `register`.
      if (typeof register !== 'function') {
        fallo = new Error('el módulo se importó pero NO exporta una función `register`, así que no monta nada');
      } else {
        register(app, db);
        console.log('✅ Módulo cargado: ' + nombre);
      }
    } catch (e) {
      fallo = e;
    }
    if (fallo) await tratarFallo({ nombre, esencial, error: fallo });
  }
}

async function tratarFallo({ nombre, esencial, error }) {
  // Se escribe SIEMPRE y con la traza entera. `e.message` a secas era lo que había antes, y de
  // «Unexpected reserved word» no sale ni el fichero: hay que abrir el código a ciegas.
  const cabecera = esencial
    ? '🛑 MÓDULO ESENCIAL CAÍDO: ' + nombre + ' — Bamburu NO va a arrancar'
    : '⚠️ Módulo opcional caído: ' + nombre + ' — Bamburu arranca SIN él';
  console.error(cabecera);
  console.error('   Motivo: ' + (error?.message || error));
  if (error?.stack) console.error(error.stack);

  // El aviso no puede impedir el fallo: `avisarArranqueRoto` no lanza y tiene su propio plazo. Y su
  // resultado se imprime salga o no salga — que el aviso NO haya salido es en sí mismo una noticia.
  const aviso = await avisarArranqueRoto({ modulo: nombre, esencial, error });
  console.error('   Aviso a Telegram: ' + (aviso.enviado ? 'enviado' : 'NO enviado — ' + aviso.motivo));

  if (!esencial) return;

  // Y aquí se acaba el arranque. Se LANZA en vez de `process.exit()` a propósito: bajo systemd la
  // salida estándar es un socket y en Node esas escrituras son asíncronas, así que un `exit()`
  // inmediato puede cortar justo las líneas de arriba —las únicas que explican qué pasó—. El camino
  // fatal de Node las vacía antes de morir, y sale con código 1, que es lo que `Restart=on-failure`
  // necesita ver para que este arranque cuente como fallido.
  throw new Error('Bamburu no arranca: el módulo esencial «' + nombre + '» no carga. '
    + 'Motivo: ' + (error?.message || error), { cause: error });
}
