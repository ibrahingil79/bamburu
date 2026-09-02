#!/usr/bin/env node
// manifiesto-copias.mjs — Manifiesto encadenado de huellas del histórico de copias.
//
// QUÉ PROBLEMA RESUELVE. `bamburu-backup.sh` verifica muy bien lo que sube ESA noche
// (tamaño + huella + restore byte a byte), pero en cuanto el bucle de subida termina, el
// fichero recién subido no se vuelve a mirar nunca. Una copia de hace cinco días se puede
// editar, vaciar o borrar en Drive y nada lo nota hasta el día en que haga falta restaurar.
//
// CÓMO LO RESUELVE, con el mismo patrón que `modules/superadmin/integridad.js` aplicado a
// ficheros en vez de a filas: cada artefacto subido se anota en un fichero JSON Lines
// (una línea por artefacto, SOLO SE AÑADE), cada línea enlaza con el hash de la anterior
// (`prev` → `hash`, SHA-256 del JSON canónico), y en CADA pasada se recorren TODOS los
// objetos de la ventana de retención contra lo registrado — sin descargar ninguno,
// preguntándole al destino la huella que él mismo calculó (Google Drive expone SHA-256 sin
// coste extra, incluso a través de rclone).
//
// LOS DOS MUNDOS, sin rama blanda en ninguno (la lección del MD5/crypt de
// `bamburu-backup.sh`): en claro, `rclone lsjson --hash sha256` da la huella directamente.
// Cifrado, un remote `crypt` no expone huellas de contenido en claro, así que se pide la
// huella del TEXTO CIFRADO al remote base, y la correspondencia nombre→ruta cifrada la da
// `rclone backend encode` (determinista: la misma ruta en claro siempre cifra igual, así
// que solo hace falta codificar los nombres que todavía no están registrados).
//
// QUÉ NO CUBRE, y hay que decirlo porque un manifiesto que se vende como más de lo que es
// vale menos que ninguno: este fichero vive en el servidor, así que quien controle el
// servidor puede reescribirlo entero. Contra eso está el ancla del correo diario (la cabeza
// de la cadena viaja fuera, a un buzón que el servidor no puede reescribir) — eso lo hace
// `bamburu-backup.sh`, no este fichero. Aquí solo se detecta manipulación/borrado en Drive.
//
// Subcomandos:
//   pasada            --manifiesto <ruta> --estado <ruta> --remote <REMOTE>
//                      --modo claro|cifrado --retencion <días> --fecha <AAAA-MM-DD>
//                      --artefactos <fichero>
//   verificar-cadena  --manifiesto <ruta>
//   estado            --estado <ruta>
//
// Sale con 0 si todo cuadra, 1 si hay alguna alarma (o un fallo al hablar con el destino).
// Nunca lanza una excepción sin capturar: todo error se convierte en un mensaje en
// castellano y un código de salida, para que bash pueda decidir sin adivinar.
import { readFileSync, writeFileSync, renameSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const RCLONE = process.env.RCLONE_BIN || '/usr/bin/rclone';

// --- Utilidades de cadena ----------------------------------------------------------------
// El JSON canónico de una línea es SIEMPRE estas claves, en este orden, sin "hash". La MISMA
// función se usa para escribir y para verificar (la lección de `verifyTenantInvoices`, que
// reutiliza `calcHash` de la emisión): así no puede haber una forma de calcular al escribir
// y otra al comprobar.
function canonizar(e) {
  return JSON.stringify({
    n: e.n,
    ts: e.ts,
    fecha: e.fecha,
    etiqueta: e.etiqueta,
    remote: e.remote,
    nombre: e.nombre,
    origen: e.origen,
    bytes: e.bytes,
    sha256: e.sha256,
    destino: {
      modo: e.destino.modo,
      ruta: e.destino.ruta,
      base: e.destino.base,
      bytes: e.destino.bytes,
      sha256: e.destino.sha256,
    },
    prev: e.prev,
  });
}

function hashDe(e) {
  return createHash('sha256').update(canonizar(e)).digest('hex');
}

function extraerFecha(nombre) {
  const m = String(nombre).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function epochDeFecha(fechaAAAAMMDD) {
  return new Date(`${fechaAAAAMMDD}T00:00:00Z`).getTime();
}

function corto(hash) {
  return hash ? `${hash.slice(0, 12)}…` : '(vacía)';
}

function ahora() {
  return Math.floor(Date.now() / 1000);
}

// --- Lectura y verificación de la cadena existente ----------------------------------------
// Recorre el manifiesto de principio a fin. Si un `hash` no cuadra con su línea, o un `prev`
// no enlaza con el anterior, o una línea no es JSON válido, devuelve la alarma y el punto
// hasta el que la cadena SÍ era válida — y quien llame no debe añadir nada por encima.
function leerYVerificarCadena(ruta) {
  if (!existsSync(ruta)) return { entradas: [], lineasCrudas: [], cabeza: '', alarma: null };
  const texto = readFileSync(ruta, 'utf8');
  const lineasCrudas = texto.split('\n').filter((l) => l.trim() !== '');
  const entradas = [];
  let prev = '';
  for (let i = 0; i < lineasCrudas.length; i++) {
    let obj;
    try {
      obj = JSON.parse(lineasCrudas[i]);
    } catch {
      return { entradas, lineasCrudas: lineasCrudas.slice(0, i), cabeza: prev, alarma: `línea ${i + 1} del manifiesto no es JSON válido` };
    }
    if (!obj || typeof obj !== 'object' || !obj.destino) {
      return { entradas, lineasCrudas: lineasCrudas.slice(0, i), cabeza: prev, alarma: `línea ${i + 1} del manifiesto no tiene la forma esperada` };
    }
    const hashCalc = hashDe(obj);
    if (obj.hash !== hashCalc) {
      return { entradas, lineasCrudas: lineasCrudas.slice(0, i), cabeza: prev, alarma: `línea ${i + 1} ("${obj.nombre ?? '?'}"): el hash no cuadra con su contenido — el manifiesto fue editado` };
    }
    if ((obj.prev || '') !== prev) {
      return { entradas, lineasCrudas: lineasCrudas.slice(0, i), cabeza: prev, alarma: `línea ${i + 1} ("${obj.nombre ?? '?'}"): el enlace con la línea anterior está roto` };
    }
    entradas.push(obj);
    prev = obj.hash;
  }
  return { entradas, lineasCrudas, cabeza: prev, alarma: null };
}

// --- Escritura atómica (manifiesto y estado) ----------------------------------------------
// tmp en el mismo directorio + rename + chmod 600 explícito, como
// `scripts/cifrar-copias-de-seguridad.sh:273-277` con el fichero de destinos. El manifiesto
// NUNCA se reescribe línea a línea: se le añaden líneas nuevas al final del contenido que ya
// tenía, y el fichero completo se sustituye de una vez.
function escribirAtomico(ruta, contenido) {
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp`;
  const prevUmask = process.umask(0o077);
  try {
    writeFileSync(tmp, contenido, { mode: 0o600 });
  } finally {
    process.umask(prevUmask);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, ruta);
  chmodSync(ruta, 0o600);
}

function escribirManifiesto(ruta, lineasCrudas, nuevasEntradas) {
  const todas = [...lineasCrudas, ...nuevasEntradas.map((e) => JSON.stringify(e))];
  escribirAtomico(ruta, todas.length ? `${todas.join('\n')}\n` : '');
}

function escribirEstado(ruta, estadoObj) {
  escribirAtomico(ruta, `${JSON.stringify(estadoObj)}\n`);
}

function leerEstadoSiExiste(ruta) {
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}

// --- rclone, siempre por execFileSync (nunca por shell) ------------------------------------
function rclone(args) {
  return execFileSync(RCLONE, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

// Mundo EN CLARO: una sola llamada da tamaño y SHA-256 de TODOS los objetos.
// Sin rama blanda: un objeto sin `Hashes.sha256` es un fallo, no un aviso — mismo criterio
// que `bamburu-backup.sh` con el MD5.
function leerDestinoClaro(remote) {
  let salida;
  try {
    salida = rclone(['lsjson', remote, '--hash', '--hash-type', 'sha256', '--files-only']);
  } catch (e) {
    throw new Error(`no se pudo listar el destino en claro "${remote}": ${e.message}`);
  }
  let items;
  try {
    items = JSON.parse(salida || '[]');
  } catch {
    throw new Error(`"rclone lsjson ${remote}" no devolvió JSON válido`);
  }
  const mapa = new Map();
  for (const it of items) {
    const sha = it.Hashes && it.Hashes.sha256;
    if (!sha) throw new Error(`el destino no devuelve huella SHA-256 para "${it.Path}"`);
    mapa.set(it.Path, { bytes: it.Size, sha256: sha });
  }
  return mapa; // nombre en claro -> { bytes, sha256 }
}

// Mundo CIFRADO, paso (a)+(b): nombres en claro a través del crypt, y el remote base
// (`rclone config show` — el tipo NUNCA se decide por `$?`, mismo criterio que
// `bamburu-backup.sh:127`, aquí no hace falta porque quien llama ya validó `--modo`).
function leerDestinoCifrado(remote) {
  const idx = remote.indexOf(':');
  if (idx === -1) throw new Error(`--remote "${remote}" no tiene la forma <remote>:<ruta>`);
  const nombreCrypt = remote.slice(0, idx);
  const subpath = remote.slice(idx + 1).replace(/\/+$/, '');

  let salidaLsf;
  try {
    salidaLsf = rclone(['lsf', remote, '--files-only']);
  } catch (e) {
    throw new Error(`no se pudo listar el destino cifrado "${remote}": ${e.message}`);
  }
  const nombresEnClaro = salidaLsf.split('\n').map((s) => s.trim()).filter(Boolean);

  let salidaShow;
  try {
    salidaShow = rclone(['config', 'show', nombreCrypt]);
  } catch (e) {
    throw new Error(`no se pudo leer la configuración del remote "${nombreCrypt}": ${e.message}`);
  }
  const lineaRemote = salidaShow.split('\n').find((l) => l.startsWith('remote = '));
  if (!lineaRemote) throw new Error(`"rclone config show ${nombreCrypt}" no tiene línea "remote = " (¿no es un crypt?)`);
  const base = lineaRemote.slice('remote = '.length).trim();

  return { nombresEnClaro, nombreCrypt, subpath, base };
}

// Mundo CIFRADO, paso (c): huellas de TODOS los objetos del remote base — una sola llamada,
// cubre tanto lo ya registrado (por su ruta guardada) como lo nuevo (por la ruta recién
// codificada).
function leerMapaBase(base) {
  let salida;
  try {
    salida = rclone(['lsjson', base, '-R', '--hash', '--hash-type', 'sha256', '--files-only']);
  } catch (e) {
    throw new Error(`no se pudo listar el remote base "${base}": ${e.message}`);
  }
  let items;
  try {
    items = JSON.parse(salida || '[]');
  } catch {
    throw new Error(`"rclone lsjson ${base}" no devolvió JSON válido`);
  }
  const mapa = new Map();
  for (const it of items) {
    const sha = it.Hashes && it.Hashes.sha256;
    if (!sha) throw new Error(`el destino base no devuelve huella SHA-256 para "${it.Path}"`);
    mapa.set(it.Path, { bytes: it.Size, sha256: sha });
  }
  return mapa; // ruta cifrada -> { bytes, sha256 }
}

// Correspondencia nombre en claro -> ruta cifrada, EN LOTE. Solo se llama para nombres que
// todavía no tienen una ruta cifrada registrada: los ya conocidos usan la que guardó su
// propio registro, porque cifrar el mismo nombre siempre da la misma ruta.
function codificarRutas(nombreCrypt, subpath, nombres) {
  if (nombres.length === 0) return new Map();
  const rutasPedidas = nombres.map((n) => `${subpath}/${n}`);
  let salida;
  try {
    salida = rclone(['backend', 'encode', `${nombreCrypt}:`, ...rutasPedidas]);
  } catch (e) {
    throw new Error(`no se pudo codificar los nombres con "rclone backend encode": ${e.message}`);
  }
  const lineas = salida.split('\n').filter((l) => l.trim() !== '');
  if (lineas.length !== nombres.length) {
    throw new Error(`"rclone backend encode" devolvió ${lineas.length} líneas para ${nombres.length} nombres pedidos`);
  }
  const mapa = new Map();
  nombres.forEach((n, i) => mapa.set(n, lineas[i].trim()));
  return mapa;
}

function leerArtefactos(ruta) {
  if (!ruta || !existsSync(ruta)) return [];
  const texto = readFileSync(ruta, 'utf8');
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const partes = l.split(/\s+/);
      const [nombre, sha256, bytes] = partes;
      if (!nombre || !sha256 || bytes === undefined) throw new Error(`línea de artefactos mal formada: "${l}"`);
      return { nombre, sha256, bytes: Number(bytes) };
    });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function imprimirResumen({ comprobados, alarmas, cabeza, observadosNuevos, extra }) {
  console.log(`Manifiesto: ${comprobados} objetos comprobados · ${alarmas.length} alarmas · 0 descargas · cabeza ${cabeza || '(vacía)'}`);
  if (observadosNuevos) console.log(`${observadosNuevos} objetos que esta copia no subió (registrados por primera vez)`);
  if (extra) console.log(extra);
  for (const a of alarmas) console.log(`ALARMA: ${a}`);
}

// --- El subcomando principal ---------------------------------------------------------------
function cmdPasada(args) {
  const manifiestoRuta = args.manifiesto;
  const estadoRuta = args.estado;
  const remote = args.remote;
  const modo = args.modo;
  const fechaHoy = args.fecha;
  if (!manifiestoRuta || !estadoRuta || !remote || !fechaHoy) {
    throw new Error('faltan argumentos: --manifiesto --estado --remote --modo --retencion --fecha --artefactos');
  }
  if (modo !== 'claro' && modo !== 'cifrado') throw new Error(`--modo tiene que ser "claro" o "cifrado" (llegó "${modo}")`);
  const retencionDias = Number(args.retencion);
  if (!Number.isFinite(retencionDias) || retencionDias <= 0) throw new Error(`--retencion inválida: "${args.retencion}"`);

  // La etiqueta no llega por argumento (bash ya la resuelve en $LABEL, y $LABEL sale de
  // BACKUP_LABEL, que la unit fija por entorno): este proceso hijo hereda el mismo entorno,
  // así que se lee igual que lo hace bash, con el mismo valor por defecto.
  const etiqueta = process.env.BACKUP_LABEL || 'principal';
  const artefactos = leerArtefactos(args.artefactos);

  const lectura = leerYVerificarCadena(manifiestoRuta);
  if (lectura.alarma) {
    escribirEstado(estadoRuta, {
      ts: ahora(), etiqueta, modo, cabeza: lectura.cabeza,
      registros: lectura.entradas.length, comprobados: 0, observados_nuevos: 0,
      alarmas: [lectura.alarma],
    });
    imprimirResumen({ comprobados: 0, alarmas: [lectura.alarma], cabeza: lectura.cabeza, observadosNuevos: 0, extra: 'la cadena del manifiesto no cuadra: no se ha añadido nada.' });
    process.exit(1);
  }

  // Comparar contra la cabeza que dejó registrada la pasada anterior: la cadena puede ser
  // internamente consistente y aun así estar TRUNCADA (líneas finales borradas), porque
  // quitar el final de una cadena de hashes no rompe los enlaces que quedan.
  const estadoAnterior = leerEstadoSiExiste(estadoRuta);
  if (estadoAnterior && typeof estadoAnterior.cabeza === 'string' && estadoAnterior.cabeza !== lectura.cabeza) {
    const motivo = `el manifiesto no coincide con la cabeza registrada la pasada anterior (antes ${corto(estadoAnterior.cabeza)}, ahora ${corto(lectura.cabeza)}) — ¿truncado o sustituido?`;
    escribirEstado(estadoRuta, {
      ts: ahora(), etiqueta, modo, cabeza: lectura.cabeza,
      registros: lectura.entradas.length, comprobados: 0, observados_nuevos: 0,
      alarmas: [motivo],
    });
    imprimirResumen({ comprobados: 0, alarmas: [motivo], cabeza: lectura.cabeza, observadosNuevos: 0, extra: 'no se ha añadido nada.' });
    process.exit(1);
  }

  // Último registro por nombre, tal y como estaba ANTES de esta pasada.
  const ultimoPorNombre = new Map();
  for (const e of lectura.entradas) ultimoPorNombre.set(e.nombre, e);
  const nombresYaRegistrados = new Set(ultimoPorNombre.keys());

  let mapaDestinoClaro = null;
  let mapaBase = null;
  let infoCifrado = null;
  let nombresEnDestino = [];
  let mapaCodificado = new Map();

  try {
    if (modo === 'claro') {
      mapaDestinoClaro = leerDestinoClaro(remote);
      nombresEnDestino = Array.from(mapaDestinoClaro.keys());
    } else {
      infoCifrado = leerDestinoCifrado(remote);
      nombresEnDestino = infoCifrado.nombresEnClaro;
      mapaBase = leerMapaBase(infoCifrado.base);
      const nuevos = nombresEnDestino.filter((nm) => !nombresYaRegistrados.has(nm));
      mapaCodificado = codificarRutas(infoCifrado.nombreCrypt, infoCifrado.subpath, nuevos);
    }
  } catch (e) {
    // Sin rama blanda: si no se puede hablar con el destino, es un FALLO, no un cero.
    escribirEstado(estadoRuta, {
      ts: ahora(), etiqueta, modo, cabeza: lectura.cabeza,
      registros: lectura.entradas.length, comprobados: 0, observados_nuevos: 0,
      alarmas: [e.message],
    });
    imprimirResumen({ comprobados: 0, alarmas: [e.message], cabeza: lectura.cabeza, observadosNuevos: 0, extra: 'no se ha podido leer el destino: no se ha añadido nada.' });
    process.exit(1);
  }

  function destinoDe(nombre) {
    if (modo === 'claro') return mapaDestinoClaro.get(nombre) || null;
    const previo = ultimoPorNombre.get(nombre);
    const ruta = previo ? previo.destino.ruta : mapaCodificado.get(nombre);
    if (!ruta) return null;
    const info = mapaBase.get(ruta);
    return info ? { ...info, ruta } : null;
  }

  const alarmas = [];
  const nuevasEntradas = [];
  let n = lectura.entradas.length;
  let prev = lectura.cabeza;
  let observadosNuevos = 0;

  const nombresArtefactos = new Set(artefactos.map((a) => a.nombre));

  // 3 · Registrar los artefactos de esta noche ("subido").
  for (const art of artefactos) {
    const d = destinoDe(art.nombre);
    if (!d) { alarmas.push(`"${art.nombre}" se subió esta noche pero no aparece en el destino`); continue; }
    if (!d.sha256) { alarmas.push(`el destino no devuelve huella SHA-256 para "${art.nombre}" recién subido`); continue; }
    if (modo === 'claro' && d.sha256 !== art.sha256) {
      alarmas.push(`"${art.nombre}": el SHA-256 del destino no coincide con el subido esta noche`);
      continue;
    }
    n += 1;
    const entrada = {
      n, ts: ahora(), fecha: extraerFecha(art.nombre) || fechaHoy, etiqueta, remote, nombre: art.nombre,
      origen: 'subido', bytes: art.bytes, sha256: art.sha256,
      destino: {
        modo, ruta: modo === 'cifrado' ? d.ruta : art.nombre,
        base: modo === 'cifrado' ? infoCifrado.base : remote,
        bytes: d.bytes, sha256: d.sha256,
      },
      prev,
    };
    const linea = { ...entrada, hash: hashDe(entrada) };
    nuevasEntradas.push(linea);
    ultimoPorNombre.set(art.nombre, linea);
    prev = linea.hash;
  }

  // 4 · Registrar como "observado" todo lo del destino que nadie reclama.
  for (const nombre of nombresEnDestino) {
    if (nombresArtefactos.has(nombre)) continue;
    if (nombresYaRegistrados.has(nombre)) continue;
    const d = destinoDe(nombre);
    if (!d) { alarmas.push(`"${nombre}" aparece en el destino pero no se pudo leer su huella`); continue; }
    n += 1;
    const entrada = {
      n, ts: ahora(), fecha: extraerFecha(nombre) || fechaHoy, etiqueta, remote, nombre,
      origen: 'observado',
      bytes: modo === 'cifrado' ? null : d.bytes,
      sha256: modo === 'cifrado' ? null : d.sha256,
      destino: {
        modo, ruta: modo === 'cifrado' ? d.ruta : nombre,
        base: modo === 'cifrado' ? infoCifrado.base : remote,
        bytes: d.bytes, sha256: d.sha256,
      },
      prev,
    };
    const linea = { ...entrada, hash: hashDe(entrada) };
    nuevasEntradas.push(linea);
    ultimoPorNombre.set(nombre, linea);
    prev = linea.hash;
    observadosNuevos += 1;
  }

  // 5 · Verificar el histórico: cada nombre con registro previo a esta pasada, contra el
  // destino de HOY. Si se re-subió esta misma noche, `ultimoPorNombre` ya trae el registro
  // fresco (paso 3) y la comparación es consigo mismo — verde, tal y como pide el caso "re-
  // subida el mismo día".
  let comprobados = 0;
  const hoyMs = epochDeFecha(fechaHoy);
  for (const nombre of nombresYaRegistrados) {
    const registro = ultimoPorNombre.get(nombre);
    const actual = destinoDe(nombre);
    comprobados += 1;
    if (!actual) {
      const fechaArt = extraerFecha(registro.nombre) || registro.fecha;
      const edadDias = Math.floor((hoyMs - epochDeFecha(fechaArt)) / 86400000);
      if (edadDias < retencionDias - 1) {
        alarmas.push(`falta "${nombre}" en el destino (edad ${edadDias}d, retención ${retencionDias}d) — ¿borrado?`);
      }
      continue;
    }
    if (actual.sha256 !== registro.destino.sha256) {
      alarmas.push(`"${nombre}": la huella cambió respecto a lo registrado — ¿manipulado?`);
    }
  }

  escribirManifiesto(manifiestoRuta, lectura.lineasCrudas, nuevasEntradas);
  escribirEstado(estadoRuta, {
    ts: ahora(), etiqueta, modo, cabeza: prev, registros: n,
    comprobados, observados_nuevos: observadosNuevos, alarmas,
  });
  imprimirResumen({ comprobados, alarmas, cabeza: prev, observadosNuevos });
  process.exit(alarmas.length ? 1 : 0);
}

function cmdVerificarCadena(args) {
  if (!args.manifiesto) throw new Error('falta --manifiesto <ruta>');
  const { entradas, cabeza, alarma } = leerYVerificarCadena(args.manifiesto);
  if (alarma) {
    console.log(`líneas: ${entradas.length} · cabeza: ${cabeza || '(vacía)'} · ROTA: ${alarma}`);
    process.exit(1);
  }
  console.log(`líneas: ${entradas.length} · cabeza: ${cabeza || '(vacía)'}`);
  process.exit(0);
}

function cmdEstado(args) {
  if (!args.estado) throw new Error('falta --estado <ruta>');
  if (!existsSync(args.estado)) {
    console.log('sin estado registrado (el manifiesto nunca ha completado una pasada)');
    process.exit(1);
  }
  let e;
  try {
    e = JSON.parse(readFileSync(args.estado, 'utf8'));
  } catch {
    console.log('estado ilegible (JSON inválido)');
    process.exit(1);
  }
  const alarmas = Array.isArray(e.alarmas) ? e.alarmas : [];
  console.log(`${e.etiqueta} · ${e.modo} · ts=${e.ts} · registros=${e.registros} · comprobados=${e.comprobados} · observados_nuevos=${e.observados_nuevos} · ${alarmas.length} alarmas · cabeza=${e.cabeza || '(vacía)'}`);
  for (const a of alarmas) console.log(`ALARMA: ${a}`);
  process.exit(alarmas.length ? 1 : 0);
}

function main() {
  const [, , comando, ...resto] = process.argv;
  const args = parseArgs(resto);
  try {
    if (comando === 'pasada') return cmdPasada(args);
    if (comando === 'verificar-cadena') return cmdVerificarCadena(args);
    if (comando === 'estado') return cmdEstado(args);
    console.error('uso: manifiesto-copias.mjs <pasada|verificar-cadena|estado> [opciones]');
    process.exit(2);
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}

main();
