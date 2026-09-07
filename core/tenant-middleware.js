import Database from 'better-sqlite3';
import path from 'path';
import { statSync } from 'fs';
import { getTenantBySlug, getSessionByToken, WAL_SIZE_LIMIT, controlDb as controlDbRef } from './control-db.js';
import { restringirBd } from './db-file-perms.js';
import { tenantStorage } from './db.js';
import { runMigrations } from '../modules/erp/models.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EL CACHÉ DE CONEXIONES A BASES DE NEGOCIO  (tarea `conexiones-que-no-se-cierran`, 7 sep 2026)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// **Qué pasaba.** Este `Map` guardaba cada conexión y NO LA SOLTABA JAMÁS. Ni cuando el negocio se
// borraba, ni cuando alguien eliminaba sus ficheros. En una sola pasada del barrido el servicio
// acumulaba **92 conexiones a ficheros de base ya borrados**, y el 6 de septiembre eso **tumbó el
// acceso al panel entero**: una conexión que sujeta un `-wal` y un `-shm` BORRADOS queda hablando
// con un diario fantasma y **deja de ver lo que escriben los demás procesos**. Reproducido fuera de
// Bamburu la madrugada del 7 sep: la conexión vieja veía **1 fila de 2**.
//
// **Las TRES situaciones que ahora se distinguen** (y que el censo cuenta por separado, porque sin
// ese desglose no se puede comprobar nada):
//
//   · SANA    — el fichero está, y lo que sostenemos debajo es lo que está en el disco.
//   · MUERTA  — el fichero de la base YA NO EXISTE. Es la del barrido: la comprobación crea su
//               negocio, le pega unas peticiones al servicio vivo (96 de las 256 lo hacen) y luego
//               borra la fila y los ficheros. El servicio se quedaba la conexión para siempre.
//   · RANCIA  — el fichero SIGUE ahí (y el negocio sigue en `control.db`), pero lo que sostenemos
//               por debajo ya murió: el `-wal`/`-shm` que tenemos abierto no es el que hay en el
//               disco. **Es el fallo de sesión del 6 sep.** No da error, no falla `integrity_check`
//               y las bases están sanas: lo único que pasa es que el proceso mira a otro sitio.
//               Por eso costó un diagnóstico entero y tres hipótesis descartadas.
//
// **Cómo se detecta, medido y no supuesto:** comparando INODOS. Al abrir se anota el inodo del `.db`
// y el del `-shm`; si el `.db` desaparece → MUERTA; si alguno de los dos inodos ya no coincide con
// el del disco → RANCIA. El ensayo del 7 sep confirmó que el inodo del `-shm` cambia exactamente
// cuando aparece el síntoma.
//
// **Quién huérfana la conexión la primera vez sigue SIN MEDIR.** Se buscó en caja acotada —quién
// borra un `-wal` de un negocio vivo— y cerró en negativo: los 36 sitios que borran un `-wal` lo
// hacen sobre su propio negocio de prueba. Va a ficha aparte. **No hace falta saberlo:** con la
// detección y la reapertura puestas, el sistema se recupera solo aunque no se sepa nunca quién fue.

const tenantConnections = new Map();   // slug → entrada  { db, ruta, inoDb, inoShm, ultimoUso }
const cierresPendientes = new Set();   // conexiones retiradas del caché, esperando su gracia para cerrar

// ── Los números, con su derivación escrita ──────────────────────────────────────────────────────
//
// TOPE_ABIERTAS — red de seguridad, NO el arreglo. El arreglo es el cierre al desaparecer la base.
//   **El motivo es la MEMORIA, no el límite de ficheros.** Cada base abierta sostiene su caché de
//   páginas de SQLite y, desde el cifrado del 6 sep, además la llave del cifrador. El límite de
//   ficheros NO es motivo de nada aquí: medido el 7 sep, `LimitNOFILE` es 524.288 y una base cuesta
//   3,1 descriptores → la caída por descriptores está a ~169.000 negocios. Citarlo sería falso.
//   200 es holgado a propósito: hoy hay 15 negocios, así que nunca se alcanza en marcha normal y
//   solo actúa si algo se desmadra.
const TOPE_ABIERTAS = 200;
// CADUCIDAD_MS — la pieza del día a día: un negocio que lleva rato sin tocarse se cierra solo y
//   reabrirlo no cuesta nada (una apertura de SQLite). Mantiene el número bajo sin que nadie llegue
//   al tope. 20 minutos deja viva toda una sesión de trabajo continuada.
const CADUCIDAD_MS = 20 * 60 * 1000;
// REPASO_MS — cada cuánto se repasa el caché. Tiene que ser bastante más corto que un barrido (945 s
//   la última vez) para que el número se estabilice solo mientras el barrido corre, no después.
const REPASO_MS = 30 * 1000;
// GRACIA_MS — una conexión retirada no se cierra en el acto: puede haber una petición en vuelo
//   usándola. Se saca del caché ya (la siguiente petición abre una nueva) y se cierra un poco
//   después. Sin esto, el arreglo podría reventar una petición del dueño.
const GRACIA_MS = 5 * 1000;
// La revisión al usar una conexión se hace SIEMPRE, en cada petición, sin freno. Lo primero que
//   escribí tenía un freno de un segundo para ahorrar `stat`s, y estaba mal: dejaba entregar una
//   conexión rancia durante ese segundo, que es justo lo que esta tarea viene a impedir. **Lo cazó
//   el propio gate**, no el razonamiento. Medido antes de quitarlo: los dos `stat` cuestan
//   **14,6 µs por petición** — 8,8 ms por minuto al tope del limitador (600 peticiones/min). El
//   freno no compraba nada y abría un hueco.

function inodoDe(f) { try { return statSync(f).ino; } catch { return null; } }

function rutaDe(nombre) {
  return path.isAbsolute(nombre) ? nombre : path.join(process.cwd(), nombre);
}

// Abre la base de un negocio y la deja lista. Es lo que había antes dentro de `getTenantDb`, sacado
// aparte porque ahora también se usa al REABRIR una conexión rancia.
function abrirBase(tenant) {
  const db = new Database(tenant.db_filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Que el fichero -wal se devuelva al disco al terminar cada checkpoint, en vez de quedarse para
  // siempre en su marca máxima. Mismo tope que control.db (ver WAL_SIZE_LIMIT).
  db.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT}`);
  // De qué negocio es esta conexión. La cola de envío a la AEAT lo necesita para resolver el
  // certificado del obligado (cada negocio remite con el suyo) sin arrastrar el slug por la firma
  // de media docena de funciones de facturación. Ausente = no hay tenant resuelto (scripts, tests)
  // y la cola no se activa: un gate nunca dispara una petición a la AEAT por accidente.
  db.bamburuSlug = tenant.slug;
  runMigrations(db);
  // C6/B9 — red de seguridad: al abrir, la BD queda privada aunque naciera abierta. Es lo que
  // arregla las que ya existen sin tocarlas a mano, y lo que impide que una BD restaurada de una
  // copia (que llega con los permisos del backup) se quede abierta sin que nadie mire. Solo actúa
  // si de verdad hay bits de grupo/otros, así que no hace ruido en las que ya están bien.
  const ruta = rutaDe(tenant.db_filename);
  restringirBd(ruta);
  return { db, ruta, inoDb: inodoDe(ruta), inoShm: inodoDe(ruta + '-shm'), ultimoUso: Date.now() };
}

// Clasifica una entrada del caché SIN tocarla: 'sana' | 'muerta' | 'rancia'.
export function estadoDeConexion(e) {
  const inoDb = inodoDe(e.ruta);
  if (inoDb === null) return 'muerta';            // el fichero de la base ya no existe
  if (e.inoDb !== null && inoDb !== e.inoDb) return 'rancia';   // lo sustituyeron por otro fichero
  const inoShm = inodoDe(e.ruta + '-shm');
  // Si al abrir aún no había `-shm` (lo crea la primera lectura), se adopta el que haya ahora en vez
  // de declarar rancia: no saberlo no es lo mismo que saber que está mal.
  if (e.inoShm === null) { e.inoShm = inoShm; return 'sana'; }
  if (inoShm !== e.inoShm) return 'rancia';       // el diario que sostenemos ya no es el del disco
  return 'sana';
}

// Saca una conexión del caché AHORA y la cierra: en el acto si `yaMismo`, y si no tras la gracia.
// Devuelve true si había algo.
//
// **Por qué una RANCIA se cierra EN EL ACTO y no espera la gracia.** Medido el 7 sep 2026: mientras
// una conexión huérfana sigue abierta, esa base queda partida en dos y **lo que escriban los demás
// procesos se pierde para siempre** —también después de cerrarla, porque al cerrar ella vuelca SU
// versión encima—. La gracia existe para no reventar una petición en vuelo; pero una petición en
// vuelo sobre una conexión rancia **ya está leyendo un fantasma**, y mantenerla viva cinco segundos
// más envenena la base para todo el que pase. Entre un 500 en esa petición y perder escrituras de
// otros, se elige el 500. (Lo que la propia huérfana escribió NO se pierde: se vuelca al cerrarla.)
function retirar(slug, motivo, { yaMismo = false } = {}) {
  const e = tenantConnections.get(slug);
  if (!e) return false;
  tenantConnections.delete(slug);
  e.motivoDeCierre = motivo;
  if (yaMismo) { try { e.db.close(); } catch { /* ya estaba cerrada */ } return true; }
  cierresPendientes.add(e);
  const t = setTimeout(() => {
    cierresPendientes.delete(e);
    try { e.db.close(); } catch { /* ya estaba cerrada, o nunca llegó a abrirse del todo */ }
  }, GRACIA_MS);
  if (typeof t.unref === 'function') t.unref();
  return true;
}

/**
 * Cierra la conexión de UN negocio. Es la puerta que no existía: hasta el 7 sep 2026 no había en
 * todo el árbol ni una sola forma de sacar un slug del caché (`tenantConnections.delete` → 0
 * resultados). Devuelve true si había una conexión abierta.
 */
export function cerrarTenant(slug, motivo = 'a petición') {
  return retirar(slug, motivo);
}

/**
 * Repasa el caché entero y cierra lo que ya no sirve. Es lo que de verdad devuelve el número a cero
 * después de un barrido: las conexiones fantasma **no se vuelven a usar nunca** —su negocio ya no
 * existe—, así que detectarlas "al usarlas" no las cerraría jamás. Hace falta que alguien pase.
 */
export function repasarConexiones({ ahora = Date.now() } = {}) {
  const cerradas = { muertas: 0, rancias: 0, caducadas: 0, porTope: 0 };
  for (const [slug, e] of [...tenantConnections]) {
    const estado = estadoDeConexion(e);
    if (estado === 'muerta') { retirar(slug, 'la base ya no existe'); cerradas.muertas++; continue; }
    if (estado === 'rancia') { retirar(slug, 'conexión rancia', { yaMismo: true }); cerradas.rancias++; continue; }
    if (ahora - e.ultimoUso > CADUCIDAD_MS) { retirar(slug, 'inactividad'); cerradas.caducadas++; }
  }
  // Tope: si aún sobran, se van las menos usadas recientemente.
  while (tenantConnections.size > TOPE_ABIERTAS) {
    let viejo = null, cuando = Infinity;
    for (const [slug, e] of tenantConnections) if (e.ultimoUso < cuando) { cuando = e.ultimoUso; viejo = slug; }
    if (!viejo) break;
    retirar(viejo, 'tope de bases abiertas');
    cerradas.porTope++;
  }
  return cerradas;
}

/**
 * EL CONTADOR CONSULTABLE. Dice cuántas bases hay abiertas y en qué estado, con el mismo desglose
 * del Paso 0. Sin esto no se puede demostrar nada: "pocas conexiones" no es una medida.
 * NO modifica el caché — se puede llamar sin miedo desde una pantalla.
 */
export function censoConexiones() {
  const censo = { abiertas: tenantConnections.size, sanas: 0, muertas: 0, rancias: 0, pendientesDeCierre: cierresPendientes.size, detalle: [] };
  for (const [slug, e] of tenantConnections) {
    const estado = estadoDeConexion(e);
    censo[estado === 'sana' ? 'sanas' : estado === 'muerta' ? 'muertas' : 'rancias']++;
    censo.detalle.push({ slug, estado, inactivaSegundos: Math.round((Date.now() - e.ultimoUso) / 1000) });
  }
  censo.detalle.sort((a, b) => a.slug.localeCompare(b.slug));
  return censo;
}

/**
 * Cierre ordenado de las bases de negocio al parar el servicio. **Solo las bases**: no se toca la
 * señal de apagado en general (es otra ficha), y por eso cuelga de `exit` —que es síncrono y no
 * intercepta ninguna señal— en vez de instalar un manejador de SIGTERM.
 */
export function cerrarBasesDeNegocio() {
  let n = 0;
  for (const [, e] of tenantConnections) { try { e.db.close(); n++; } catch { /* ya cerrada */ } }
  tenantConnections.clear();
  for (const e of cierresPendientes) { try { e.db.close(); } catch { /* ya cerrada */ } }
  cierresPendientes.clear();
  return n;
}

// El repaso periódico. `unref()` para que este temporizador NUNCA sea el motivo de que un proceso
// siga vivo: en un script que importe este módulo, no debe cambiar cuándo termina.
const repaso = setInterval(() => { try { repasarConexiones(); } catch { /* nunca tumbar el servicio por el repaso */ } }, REPASO_MS);
if (typeof repaso.unref === 'function') repaso.unref();

process.once('exit', () => { try { cerrarBasesDeNegocio(); } catch { /* saliendo igualmente */ } });

// Abre (o reutiliza) la BD de un tenant ya resuelto. Compartida por el middleware y por
// el auto-login del apex, para no duplicar la apertura/migración ni la caché.
export function getTenantDb(tenant) {
  let e = tenantConnections.get(tenant.slug);
  if (e) {
    const estado = estadoDeConexion(e);
    if (estado !== 'sana') {
      // Se cierra y se vuelve a abrir. El criterio es RECUPERARSE, no encontrar al culpable.
      retirar(tenant.slug, estado === 'muerta' ? 'la base ya no existe' : 'conexión rancia', { yaMismo: estado === 'rancia' });
      e = null;
    }
  }
  if (!e) {
    e = abrirBase(tenant);
    tenantConnections.set(tenant.slug, e);
    if (tenantConnections.size > TOPE_ABIERTAS) repasarConexiones();
  }
  e.ultimoUso = Date.now();
  return e.db;
}

// Middleware de Hono: resuelve a qué negocio pertenece la petición, abre su BD y la
// inyecta en el contexto (c.get('db') / c.get('tenant')) y en tenantStorage.
//
// Resolución en dos caminos, sin romper el aislamiento:
//  1) VÍNCULO DE SESIÓN (control.db `tenant_sessions`): si la cookie `asess` está atada a
//     un negocio, ese negocio manda. Es el camino que hace falta cuando el host NO
//     identifica al tenant (desarrollo: un solo host para todos). En producción la cookie
//     `asess` es host-only, así que coincide con el subdominio → no rompe el aislamiento.
//  2) SUBDOMINIO (camino primario en producción; fallback en desarrollo): primera etiqueta
//     del host → slug del negocio. Es lo que había y se mantiene intacto.
export async function tenantMiddleware(c, next) {
  if (c.req.path === '/registro' || c.req.path === '/') return next();

  let tenant = null;

  // 1) Vínculo sesión→negocio. (Resuelve el negocio aunque esté suspendido; la suspensión
  //    se aplica más abajo de forma unificada, no aquí.)
  const cookie = c.req.header('cookie') || '';
  const m = cookie.match(/asess=([A-Za-z0-9_-]+)/);
  if (m) {
    const bound = getSessionByToken(m[1]);
    if (bound && bound.tenant) tenant = bound.tenant;
  }

  // 2) Selección de negocio en curso de login (cookie `btenant`, host-only y corta): la
  //    pone /find-tenant al resolver el email→negocio, para alcanzar el negocio correcto
  //    cuando el host no lo identifica (desarrollo: un solo host). La sesión autenticada
  //    (paso 1) manda sobre esto, así que no permite saltar de negocio con sesión abierta.
  if (!tenant) {
    const bt = cookie.match(/btenant=([a-z0-9-]+)/);
    if (bt) {
      const t = getTenantBySlug(bt[1]);
      if (t) tenant = t;
    }
  }

  // 3) Subdominio (camino primario en producción; fallback en desarrollo).
  if (!tenant) {
    const host = c.req.header('host') ?? '';
    const dotIndex = host.indexOf('.');
    const slug = dotIndex !== -1 ? host.slice(0, dotIndex) : null;
    if (!slug) return c.json({ error: 'Tenant no identificado' }, 404);

    tenant = getTenantBySlug(slug);
    if (!tenant) return c.json({ error: 'Negocio no encontrado' }, 404);
  }

  // Suspensión (resuelto el negocio por cualquier vía). Lo fija el superadmin en control.db:
  //  - suspended_security: acceso CORTADO del todo (cuenta comprometida).
  //  - suspended_admin: deja ENTRAR pero en SOLO LECTURA (impago); el guard de escritura y el
  //    banner se encargan del resto. Nunca se le secuestran datos.
  if (tenant.status === 'suspended_security') {
    return c.html(cuentaSuspendidaPage(), 403);
  }

  const tenantDb = getTenantDb(tenant);
  c.set('db', tenantDb);
  c.set('tenant', tenant);
  c.set('tenantReadOnly', tenant.status === 'suspended_admin');

  // ── LA FRANJA DE IMPAGO (tarea `suscripcion-impago-y-corte`) ────────────────────────────────────
  // El cliente que entra a trabajar tiene que VERLO, sin depender de que abra el correo. Una consulta
  // por clave primaria, y tolerante a fallo: si esto peta, la franja no sale y el producto entra
  // igual — un negocio caído porque no se pudo leer su estado de pago sería mucho peor que una
  // franja que falta.
  try {
    const imp = controlDbRef.prepare(
      'SELECT estado, corte_previsto, cortado_por_impago FROM tenant_suscripciones WHERE tenant_id = ?'
    ).get(tenant.id);
    c.set('impago', imp && imp.estado === 'pago_pendiente'
      ? { corteEl: imp.corte_previsto || null, cortado: imp.cortado_por_impago === 1 }
      : null);
  } catch { c.set('impago', null); }

  return tenantStorage.run(tenantDb, () => next());
}

// Pantalla de corte total (cuenta suspendida por seguridad). Sin pistas de por qué.
function cuentaSuspendidaPage() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cuenta suspendida</title>
<style>body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0}
.box{max-width:440px;padding:40px;text-align:center}.box h1{font-size:22px;margin:0 0 12px}.box p{color:#94a3b8;line-height:1.6}</style>
</head><body><div class="box"><h1>Cuenta suspendida</h1>
<p>El acceso a esta cuenta está suspendido. Por favor, contacta con soporte para resolverlo.</p></div></body></html>`;
}

// Guard de SOLO LECTURA para negocios suspendidos por impago (status suspended_admin):
// bloquea toda ESCRITURA del tenant; deja pasar la lectura y las rutas de sesión/cuenta para
// que el dueño pueda entrar, ver sus datos y salir. Nunca se le secuestran datos.
// (Para negocios NO suspendidos, c.get('tenantReadOnly') es falsy → no hace nada.)
export async function readOnlyGuard(c, next) {
  if (!c.get('tenantReadOnly')) return next();
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const p = c.req.path;
  // ⚙️ 2 SEP 2026 (suscripcion-plan-y-alta) — LA PUERTA DE SALIDA TIENE QUE ESTAR ABIERTA.
  //
  // Encontrado probando el alta de tarjeta de punta a punta: la pantalla de suscripción abría
  // (es un GET), pero el POST que crea el Checkout de Stripe caía aquí con
  // «Tu cuenta está en modo SOLO LECTURA por regularizar […] hasta reactivarla».
  //
  // O sea: **el negocio al que se le pide que regularice era justo el que no podía regularizar.**
  // El mensaje dice «hasta reactivarla» y el guardián le quitaba la única forma de hacerlo. Y no es
  // un caso raro: es EL caso: `suspended_admin` es precisamente el estado al que lleva el impago
  // (tarea `suscripcion-impago-y-corte`), cuyo criterio dice que en la pantalla del corte se ha de
  // decir «exactamente qué hay que hacer para volver». Sin esto, lo que hubiera que hacer sería
  // imposible.
  //
  // Se abre SOLO la suscripción, y no afloja nada más: esas rutas son de dueño (`soloDueno`), no
  // tocan ni un dato del negocio —escriben en `tenant_suscripciones`, que vive en control.db— y su
  // único efecto es hablar con Stripe. Todo lo demás sigue exactamente igual de cerrado.
  const allow = ['/admin/login', '/admin/verify-2fa', '/admin/logout', '/admin/forgot-password', '/admin/reset-password', '/admin/change-password',
                 '/admin/suscripcion', '/api/erp/suscripcion'];
  if (allow.some(a => p === a || p.startsWith(a + '/'))) return next();
  const msg = 'Tu cuenta está en modo SOLO LECTURA por regularizar. No puedes crear ni modificar nada hasta reactivarla. Tus datos están intactos.';
  if (p.startsWith('/api/')) return c.json({ error: msg }, 403);
  return c.html(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Solo lectura</title></head><body style="font-family:-apple-system,sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#334155;padding:0 20px"><h2>Cuenta en solo lectura</h2><p style="line-height:1.6">${msg}</p><p style="margin-top:20px"><a href="/admin">← Volver al panel</a></p></body></html>`, 403);
}

// Devuelve la conexión cacheada para un slug, o null si aún no se ha abierto.
export function getTenantConnection(slug) {
  return tenantConnections.get(slug)?.db ?? null;
}
