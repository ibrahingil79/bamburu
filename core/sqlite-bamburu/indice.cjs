// ═════════════════════════════════════════════════════════════════════════════════════════════════
// EL PUNTO ÚNICO DE APERTURA DE LAS BASES — y el único sitio del árbol donde existe la llave.
//
// ⚠️ ESTE PAQUETE SE LLAMA `better-sqlite3` A PROPÓSITO. En el `package.json` del repo la
// dependencia `better-sqlite3` apunta a esta carpeta (`file:core/sqlite-bamburu`). Por dentro es
// `better-sqlite3-multiple-ciphers` —el mismo motor, la misma API SÍNCRONA, la misma generación 9—
// envuelto en una clase que aplica la llave. Quien lea `package.json` lo ve en la propia línea de la
// dependencia: no hay nada escondido, y no hay dos copias de SQLite en el proceso.
//
// POR QUÉ ASÍ, Y NO UNA FUNCIÓN `abrirBd()` QUE LLAME CADA SITIO. Medido sobre el árbol de hoy:
// **345 `new Database(` en 255 ficheros**. Un diseño en el que cada sitio tiene que ACORDARSE de
// poner la llave falla el primer día que alguien escriba el 346 — y falla de la peor manera posible:
// `new Database('data/tenants/loquesea.db')` sin llave sobre un fichero que no existe **no da error,
// CREA UNA BASE NUEVA EN CLARO**. Eso ya pasó en este repo sin cifrado ninguno: es `null.db`, la base
// fantasma que un gate creó el 3 sep 2026 y que estuvo semanas en `data/tenants/` sin que nadie la
// echara de menos. Con la llave en el motor, olvidarla deja de ser posible: no hay segunda puerta.
//
// QUÉ SE CIFRA Y QUÉ NO — la lista es CERRADA y se decide por la RUTA, no por adivinación:
//   · `data/control.db`     → cifrada
//   · `data/tenants/*.db`   → cifradas
//   · todo lo demás         → exactamente como antes (`:memory:`, ficheros de prueba en /tmp, los
//                             bancos de los gates, las copias de trabajo). No se toca nada.
// Es la lista de las bases VIVAS del censo del 6 sep 2026: `control.db` + 11 negocios. Una base
// nueva de alta de negocio cae dentro POR SU RUTA, así que **nace cifrada desde el primer byte** sin
// que `core/tenant-provisioning.js` tenga que decir nada — ni acordarse.
//
// LA LLAVE. Vive en un fichero de entorno del servidor, 0600, FUERA del repositorio y FUERA de
// `/etc/bamburu.env`. Ese segundo detalle es deliberado, y es el mismo criterio que ya se aplicó a la
// llave de las copias: `/etc/bamburu.env` entra ENTERO en el `process.env` del proceso web expuesto a
// Internet, y cualquier vuelco de entorno (un informe de error, una pantalla de diagnóstico) se lo
// llevaría puesto. Aquí la llave se lee del disco UNA vez, se guarda en una variable de este módulo,
// y **nunca entra en `process.env`**. Si alguien la pone en el entorno para una prueba, se lee y se
// BORRA del entorno en el acto.
//
// NUNCA SE IMPRIME. Ni entera, ni a medias, ni en un mensaje de error, ni en una traza. Los mensajes
// de fallo dicen qué pasa y qué hacer, y no enseñan ni la llave ni la ruta de ninguna base.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
'use strict';

const Motor = require('better-sqlite3-multiple-ciphers');
const fs = require('fs');
const path = require('path');

// ── Dónde vive la llave ──────────────────────────────────────────────────────────────────────────
// `BAMBURU_FICHERO_LLAVE` existe para el gate y para la migración, que necesitan trabajar contra una
// llave de mentira sin tocar la del servidor. No es una puerta trasera: apunta a OTRO fichero, con
// el mismo formato y las mismas exigencias.
const FICHERO_LLAVE = process.env.BAMBURU_FICHERO_LLAVE || '/etc/bamburu-bases.env';
const VARIABLE = 'BAMBURU_LLAVE_BASES';

// ── El cifrado elegido, en un solo sitio ─────────────────────────────────────────────────────────
// `chacha20` es ChaCha20-Poly1305 (esquema `sqleet`), el que trae SQLite3 Multiple Ciphers por
// defecto. Va AUTENTICADO página a página: además de ocultar, detecta manipulación.
//
// `kdf_iter = 1` NO es un atajo, y por eso lleva su motivo escrito aquí. Las iteraciones de PBKDF2
// existen para encarecer la fuerza bruta contra una CONTRASEÑA que se inventa un humano y que tiene
// poca entropía. Nuestra llave son 32 bytes en bruto del generador del sistema —256 bits de entropía
// real, nada que adivinar— y derivarla 64.007 veces no la hace ni un bit más fuerte. Lo que sí hace
// es costar 30 ms en CADA apertura: medido en esta máquina, **29,9 ms** con el KDF por defecto contra
// **0,41 ms** con `kdf_iter = 1`, frente a **0,29 ms** de una base en claro. Es el mismo razonamiento
// por el que SQLCipher tiene «raw key mode».
const CIFRADO = Object.freeze({ cipher: 'chacha20', kdf_iter: 1 });

// ── Qué es una base VIVA de Bamburu ──────────────────────────────────────────────────────────────
/**
 * ¿Es una de las bases vivas del sistema? Se decide por la FORMA de la ruta —`…/data/control.db` y
 * `…/data/tenants/*.db`— y no por una raíz fija, porque Bamburu no siempre corre desde el repo.
 *
 * NO ES UN DETALLE. `core/control-db.js` abre `path.join(process.cwd(), 'data', 'control.db')`, y
 * `restauracion-sistema-completo.mjs` levanta el `index.js` REAL con `cwd` en un árbol restaurado de
 * /tmp. Si esto se atara a `/home/ubuntu/bamburu`, el ensayo de restauración —que es la prueba de
 * que se puede volver— abriría las bases restauradas SIN llave, y una base cifrada de verdad no
 * abriría. La regla que se aplica aquí es la misma que usa el programa para encontrar sus datos.
 *
 * Las rutas relativas se resuelven contra `process.cwd()`, otra vez porque es lo que hace el
 * programa: `data/tenants/<slug>.db` es como está escrito en `control.db`.
 */
function esBaseViva(ruta) {
  if (typeof ruta !== 'string' || !ruta) return false;
  if (ruta === ':memory:' || ruta.startsWith('file:')) return false;
  const abs = path.resolve(ruta);
  const dir = path.dirname(abs);
  if (path.basename(abs) === 'control.db' && path.basename(dir) === 'data') return true;
  return abs.endsWith('.db')
    && path.basename(dir) === 'tenants'
    && path.basename(path.dirname(dir)) === 'data';
}

// ── Leer la llave: una vez por proceso, y nunca al entorno ───────────────────────────────────────
let llaveEnMemoria;          // undefined = aún no se ha mirado · null = mirado y NO hay
let motivoSinLlave = '';

function normalizar(valor) {
  const v = String(valor == null ? '' : valor).trim().replace(/^['"]|['"]$/g, '');
  return /^[0-9a-fA-F]{64}$/.test(v) ? v.toLowerCase() : null;
}

function leerDelFichero() {
  let texto;
  try {
    texto = fs.readFileSync(FICHERO_LLAVE, 'utf8');
  } catch (e) {
    motivoSinLlave =
      e.code === 'ENOENT' ? 'el fichero de la llave no existe'
      : e.code === 'EACCES' ? 'el fichero de la llave existe pero este usuario no puede leerlo'
      : 'no se pudo leer el fichero de la llave';
    return null;
  }
  const linea = texto.split(/\r?\n/).find(l => l.trim().startsWith(VARIABLE + '='));
  if (!linea) { motivoSinLlave = 'el fichero de la llave no contiene ' + VARIABLE; return null; }
  const hex = normalizar(linea.slice(linea.indexOf('=') + 1));
  if (!hex) { motivoSinLlave = VARIABLE + ' no son 64 caracteres hexadecimales (32 bytes)'; return null; }
  return hex;
}

function llave() {
  if (llaveEnMemoria !== undefined) return llaveEnMemoria;

  // Del entorno, si alguien la puso ahí — y se BORRA del entorno en el acto, para que no siga
  // viajando en `process.env` el resto de la vida del proceso.
  if (process.env[VARIABLE]) {
    const hex = normalizar(process.env[VARIABLE]);
    delete process.env[VARIABLE];
    if (!hex) motivoSinLlave = VARIABLE + ' del entorno no son 64 caracteres hexadecimales (32 bytes)';
    llaveEnMemoria = hex;
    return llaveEnMemoria;
  }

  llaveEnMemoria = leerDelFichero();
  return llaveEnMemoria;
}

/**
 * El texto que se ve cuando Bamburu no puede abrir sus bases. Dice QUÉ pasa y QUÉ hacer; no enseña
 * la llave, ni un trozo de ella, ni la ruta de ninguna base de negocio.
 */
function textoSinLlave() {
  return 'Bamburu no arranca: falta la llave de cifrado de las bases (' + motivoSinLlave + ').\n'
    + '   Las bases están cifradas en reposo y sin la llave no se pueden abrir. Esto NO se degrada:\n'
    + '   arrancar a medias serviría pantallas vacías, como si los negocios no tuvieran datos.\n'
    + '   La llave va en ' + FICHERO_LLAVE + ', como ' + VARIABLE + '=<64 hex>, con permisos 600.\n'
    + '   Cómo generarla y dónde custodiarla: docs/seguridad/cifrado-en-reposo.md';
}

function textoLlaveMala() {
  return 'Bamburu no arranca: la llave de cifrado NO abre las bases.\n'
    + '   O no es la llave con la que se cifraron, o la base no está cifrada con ella.\n'
    + '   No se toca nada y no se arranca a medias. Ver docs/seguridad/cifrado-en-reposo.md';
}

// ── La clase ─────────────────────────────────────────────────────────────────────────────────────
// Extiende el motor real. Todo lo demás —`prepare`, `transaction`, `pragma`, `exec`, `backup`,
// `function`, `aggregate`, `close`…— se hereda tal cual: para el resto del árbol esto ES
// better-sqlite3, con la misma API síncrona y el mismo comportamiento.
class Database extends Motor {
  constructor(ruta, opciones) {
    // Las dos opciones propias no llegan al motor.
    const op = Object.assign({}, opciones);
    const sinLlave = op.bamburuSinLlave === true;
    const pedida = op.bamburuLlave;
    delete op.bamburuSinLlave;
    delete op.bamburuLlave;

    super(ruta, op);

    // `bamburuSinLlave` tiene DOS usos y ninguno es de producción: la migración, que necesita leer
    // una base todavía EN CLARO; y el gate, que necesita demostrar que sin llave NO se abre.
    if (sinLlave) return;

    let hex = null;
    if (pedida !== undefined) {
      hex = normalizar(pedida);
      if (!hex) { this.cerrarCallando(); throw new Error('la llave pasada a mano no son 64 caracteres hexadecimales (32 bytes)'); }
    } else {
      if (!esBaseViva(ruta)) return;      // no es una base de Bamburu: se comporta como siempre
      hex = llave();
      if (!hex) { this.cerrarCallando(); throw new Error(textoSinLlave()); }
    }

    try {
      Database.aplicarLlave(this, hex);
    } catch (e) {
      this.cerrarCallando();
      throw e;
    }

    // Que la llave SIRVE no se sabe hasta leer una página. Sin esta comprobación, una llave
    // equivocada saldría mucho más tarde, dentro de una consulta cualquiera y disfrazada de «file is
    // not a database» — y quien lo lea se irá a buscar una base corrupta, que es el sitio
    // equivocado. Sobre un fichero recién creado (0 bytes) esto no lee nada y pasa: una base nueva
    // no tiene página que descifrar, y se cifra en la primera escritura.
    try {
      this.prepare('SELECT count(*) FROM sqlite_master').get();
    } catch (e) {
      this.cerrarCallando();
      const err = new Error(textoLlaveMala());
      err.cause = e;
      err.bamburuLlaveIncorrecta = true;
      throw err;
    }
  }

  /** Cerrar sin tapar el error de verdad: el fallo que se quiere contar es el de la llave. */
  cerrarCallando() { try { this.close(); } catch (_) { /* ya estaba cerrada o nunca llegó a abrirse */ } }
}

// ── Lo que necesitan la migración y el gate, y nadie más ─────────────────────────────────────────

/** Aplica la configuración de cifrado y la llave a una conexión ya abierta. */
Database.aplicarLlave = function aplicarLlave(db, hex) {
  const h = normalizar(hex);
  if (!h) throw new Error('llave inválida: hacen falta 64 caracteres hexadecimales (32 bytes)');
  db.pragma("cipher = '" + CIFRADO.cipher + "'");
  db.pragma('kdf_iter = ' + CIFRADO.kdf_iter);
  db.pragma('key = "x\'' + h + '\'"');
};

/** Cifra EN EL SITIO una base abierta en claro (`PRAGMA rekey`). Es lo que usa la migración. */
Database.cifrarEnElSitio = function cifrarEnElSitio(db, hex) {
  const h = normalizar(hex);
  if (!h) throw new Error('llave inválida: hacen falta 64 caracteres hexadecimales (32 bytes)');
  db.pragma("cipher = '" + CIFRADO.cipher + "'");
  db.pragma('kdf_iter = ' + CIFRADO.kdf_iter);
  db.pragma('rekey = "x\'' + h + '\'"');
};

/**
 * ABRIR UNA COPIA — un fichero que ES una base de Bamburu pero NO está en su sitio: el snapshot que
 * acaba de bajar de Drive, la copia restaurada en un temporal, la del ensayo nocturno.
 *
 * Por su ruta no se puede saber si va cifrada: una copia de hace tres semanas está en claro y la de
 * anoche no. Así que se mira la CABECERA del fichero, que no miente, y se abre como toque. No es una
 * rama blanda: aquí las dos respuestas son legítimas, y la función DICE cuál ha usado para que quede
 * escrito en el registro de la copia. Quien exige que una base VIVA esté cifrada es el gate, y ese
 * no admite las dos.
 */
Database.abrirCopia = function abrirCopia(ruta, opciones) {
  let enClaro;
  try {
    enClaro = fs.readFileSync(ruta, { length: 16 }).subarray(0, 15).toString('latin1') === 'SQLite format 3';
  } catch (e) {
    const err = new Error('no se puede leer el fichero (' + (e.code || e.message) + ')');
    err.cause = e;
    throw err;
  }
  const op = Object.assign({}, opciones);
  if (enClaro) op.bamburuSinLlave = true;
  else if (op.bamburuLlave === undefined) {
    const hex = llave();
    if (!hex) throw new Error('la copia está cifrada y no hay llave para abrirla (' + motivoSinLlave + ')');
    op.bamburuLlave = hex;
  }
  const db = new Database(ruta, op);
  db.bamburuEnClaro = enClaro;
  return db;
};

Database.esBaseViva = esBaseViva;
Database.CIFRADO = CIFRADO;
Database.FICHERO_LLAVE = FICHERO_LLAVE;
Database.VARIABLE_LLAVE = VARIABLE;
Database.SqliteError = Motor.SqliteError;
Database.textoSinLlave = textoSinLlave;
Database.textoLlaveMala = textoLlaveMala;

/** ¿Hay llave utilizable? NO la devuelve: solo dice sí o no, y por qué no. */
Database.hayLlave = function hayLlave() {
  const l = llave();
  return { hay: !!l, motivo: l ? '' : motivoSinLlave };
};

/** Solo para la migración y el gate. Lo que devuelve NO se imprime nunca. */
Database.llaveParaMigrar = function llaveParaMigrar() { return llave(); };

module.exports = Database;
