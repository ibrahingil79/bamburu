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
// QUÉ SE CIFRA Y QUÉ NO. ~~La lista es CERRADA y se decide por la RUTA.~~ **⚙️ CORREGIDO EL 6 SEP
// 2026, EL MISMO DÍA: decidirlo por la ruta estaba mal y falló por los dos lados** — una base real
// copiada fuera de su sitio no había forma de abrirla, y un fichero cualquiera colocado en la carpeta
// buena se trataba como cifrado. Lo destapó el barrido completo. **Una base es de Bamburu por lo que
// ES, no por su carpeta**; el detalle entero, con lo que se midió y por qué no hay marca posible
// dentro del fichero, está más abajo en «DÓNDE guarda el programa sus bases, y QUÉ es cada fichero».
// Se tacha en vez de borrarse, que es lo que manda este repositorio.
//
// En corto: **el sitio propone y el fichero dispone**, y hay una tercera puerta EXPLÍCITA
// (`{ bamburuLlave: true }`) para abrir una base que esté fuera de su sitio. Una base nueva de alta
// de negocio nace cifrada sin que `core/tenant-provisioning.js` tenga que acordarse de nada.
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

// ── DÓNDE guarda el programa sus bases, y QUÉ es cada fichero ────────────────────────────────────
//
// ⚙️ REHECHO EL 6 SEP 2026, y el motivo está medido. La primera versión decidía si aplicar la llave
// **solo por la forma de la ruta**, y eso fallaba por los DOS lados a la vez — las dos caras salieron
// en el barrido completo de ese día:
//
//   · Una base REAL copiada fuera de su sitio se volvía **imposible de abrir**. `verify-wal-acotado`
//     hace `copyFileSync('data/control.db', '/tmp/wal-….db')` —a propósito y bien razonado: necesita
//     el fichero en crudo para poder medir el WAL— y ahí ya no había forma de darle la llave:
//     `SqliteError: file is not a database`.
//   · Y un fichero CUALQUIERA colocado en la carpeta buena se trataba como base cifrada.
//     `gate-copias-cifradas` siembra su banco con dos bases EN CLARO hechas con el `sqlite3` del
//     sistema, en `<banco>/data/control.db` y `<banco>/data/tenants/zz-prueba.db`; la forma de la
//     ruta coincidía, se les aplicaba una llave que no tenían, y el gate entero se caía.
//
// **UNA BASE ES DE BAMBURU POR LO QUE ES, NO POR SU CARPETA.** Lo malo es que «lo que es» no se
// puede leer del fichero: **MEDIDO el 6 sep 2026** — dos bases cifradas con la MISMA llave empiezan
// por 16 bytes distintos y aleatorios (`b6da6921…` y `93e1b226…`), porque eso es la SAL de cada
// fichero. **No hay marca que reconocer, y no es un olvido del cifrado: es su diseño.** Un fichero
// cifrado debe parecer ruido; una cabecera mágica le diría a quien lo robe qué tiene entre manos.
// LUKS sí se marca, pero es un contenedor con sitio para una cabecera propia; una base SQLite no lo
// tiene, y prepender bytes la rompería. SQLCipher y VeraCrypt tampoco marcan, por lo mismo.
//
// Así que la respuesta es la otra que usan esas herramientas: **la llave se da A PROPÓSITO.**
// Quedan TRES puertas, y solo tres:
//
//   1. `new Database(ruta)` sobre un fichero que NO está donde el programa guarda lo suyo
//      → jamás se cifra ni se descifra solo. Se comporta exactamente como el better-sqlite3 de
//        siempre.
//   2. `new Database(ruta)` sobre un fichero que SÍ está en ese sitio → se decide por lo que HAY:
//        · no existe todavía  → nace cifrada (así un alta de negocio no depende de que nadie se acuerde)
//        · existe y NO es SQLite en claro → se abre con la llave (es nuestra, o es basura y se dirá)
//        · existe y ES SQLite en claro → **se abre en claro, y se dice a gritos**. No se le aplica
//          una llave que no tiene: eso convertía un fichero suelto en un error incomprensible.
//          Que ahí no debería haber una base en claro **lo vigila el gate**, que es su trabajo.
//   3. `new Database(ruta, { bamburuLlave: true })` → «soy una herramienta o un técnico y quiero
//      abrir una base de Bamburu que está fuera de su sitio, con la llave del servidor». Funciona en
//      cualquier ruta, y es EXPLÍCITO: nadie lo escribe sin querer.

/**
 * ¿Está este fichero donde el programa guarda SUS bases? — `…/data/control.db` y
 * `…/data/tenants/*.db`.
 *
 * Ojo: esto ya NO decide si se cifra. Solo dice «aquí es donde vive lo mío», que es la mitad de la
 * pregunta; la otra mitad la contesta el fichero.
 *
 * Se mira la FORMA de la ruta y no una raíz fija, porque Bamburu no siempre corre desde el repo:
 * `core/control-db.js` abre `path.join(process.cwd(), 'data', 'control.db')`, y
 * `restauracion-sistema-completo.mjs` levanta el `index.js` REAL con el `cwd` en un árbol restaurado
 * de /tmp. Atarlo a `/home/ubuntu/bamburu` dejaría el ensayo de restauración —la prueba de que se
 * puede volver— abriendo sin llave unas bases que sí la tienen.
 */
function enSuSitio(ruta) {
  if (typeof ruta !== 'string' || !ruta) return false;
  if (ruta === ':memory:' || ruta.startsWith('file:')) return false;
  const abs = path.resolve(ruta);
  const dir = path.dirname(abs);
  if (path.basename(abs) === 'control.db' && path.basename(dir) === 'data') return true;
  return abs.endsWith('.db')
    && path.basename(dir) === 'tenants'
    && path.basename(path.dirname(dir)) === 'data';
}

/** ¿Es un fichero SQLite SIN cifrar? Se mira el fichero, no su nombre. */
function esSQLiteEnClaro(ruta) {
  try { return fs.readFileSync(ruta, { length: 16 }).subarray(0, 15).toString('latin1') === 'SQLite format 3'; }
  catch { return false; }   // no existe, o no se puede leer: no es «en claro»
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

/**
 * LAS TRES PUERTAS, EN UN SOLO SITIO. Devuelve `{ hex, aviso }`:
 *   · `hex` = la llave que hay que aplicar, o `null` para abrir tal cual.
 *   · `aviso` = lo que hay que gritar por el journal, si algo huele mal.
 *
 * Se llama ANTES de abrir el fichero, porque abrirlo lo crea y borra la pregunta.
 */
function decidirLlave(ruta, sinLlave, pedida) {
  // PUERTA 0 · «no me pongas llave». Dos usos, ninguno de producción: la migración, que necesita
  // leer una base todavía EN CLARO, y el gate, que necesita demostrar que sin llave NO se abre.
  if (sinLlave) return { hex: null, aviso: null };

  // PUERTA 3 · a propósito, y en cualquier ruta. `true` = «con la llave del servidor»; una cadena =
  // «con ESTA llave» (lo usa la migración, que trabaja sobre copias antes de ponerlas en su sitio).
  if (pedida !== undefined) {
    if (pedida === true) {
      const h = llave();
      if (!h) throw new Error('se pidió abrir con la llave del servidor y no hay llave (' + motivoSinLlave + ')');
      return { hex: h, aviso: null };
    }
    const h = normalizar(pedida);
    if (!h) throw new Error('la llave pasada a mano no son 64 caracteres hexadecimales (32 bytes)');
    return { hex: h, aviso: null };
  }

  // PUERTA 1 · fuera del sitio del programa: no se toca. Es el better-sqlite3 de siempre.
  if (!enSuSitio(ruta)) return { hex: null, aviso: null };

  // PUERTA 2 · en su sitio: manda lo que HAY en el fichero.
  if (esSQLiteEnClaro(ruta)) {
    // No se le pone una llave que no tiene. Pero tampoco se calla: una base en claro en la carpeta
    // de las bases vivas es una anomalía —una copia vieja restaurada a mano, un `cp` de más— y quien
    // mire el journal tiene que verla. Que además sea un ROJO lo decide el gate, no esta función.
    return {
      hex: null,
      aviso: '⚠️  BASE EN CLARO donde deberían estar las cifradas: ' + path.basename(ruta)
           + '\n   Se abre tal cual (es lo que hay), pero NO está protegida en reposo.'
           + '\n   Compruébalo con: node scripts/gate-cifrado-en-reposo.mjs',
    };
  }

  const h = llave();
  if (!h) throw new Error(textoSinLlave());
  return { hex: h, aviso: null };
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

    // ⚠️ LA DECISIÓN SE TOMA **ANTES** DE ABRIR, y eso es obligatorio: abrir CREA el fichero si no
    // existe, así que después ya no hay forma de saber qué había ahí. En JavaScript se puede
    // ejecutar código antes de `super()` mientras no se toque `this`, y esto no lo toca.
    const decision = decidirLlave(ruta, sinLlave, pedida);

    super(ruta, op);

    if (decision.aviso) console.error(decision.aviso);
    if (!decision.hex) return;
    const hex = decision.hex;

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

Database.enSuSitio = enSuSitio;
Database.esSQLiteEnClaro = esSQLiteEnClaro;
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
