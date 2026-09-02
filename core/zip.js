// zip.js — Un escritor de ZIP mínimo, sin dependencias.
//
// POR QUÉ ESTÁ ESCRITO A MANO Y NO ES UNA LIBRERÍA MÁS. En este servidor no hay ninguna
// (`archiver`, `adm-zip`, `jszip`: ninguna instalada), y meter una para esto sería arrastrar decenas
// de paquetes al árbol —y a la cadena de suministro que hay que vigilar— para escribir un formato de
// 1989 que cabe en cien líneas. Es el mismo criterio con el que se habló con Stripe por `fetch` en
// vez de por su SDK.
//
// POR QUÉ ZIP Y NO `tar.gz`. Porque el criterio del dueño es que el cliente pueda abrirlo **sin ser
// informático**: un `.zip` se abre con doble clic en Windows y en Mac desde hace treinta años. Un
// `.tar.gz` obliga a instalar algo o a saber qué es.
//
// QUÉ IMPLEMENTA: el ZIP clásico (sin ZIP64), con DEFLATE por `zlib` —que ya viene con Node— y CRC32.
// Suficiente y correcto para lo que hace falta. **Lo que NO implementa, dicho para que nadie lo
// descubra tarde:** archivos de más de 4 GB o más de 65.535 entradas, que necesitarían ZIP64. Con
// 136 tablas y las facturas de un negocio no se llega ni de lejos; si algún día se llegara, esto
// **falla en voz alta** en vez de escribir un fichero corrupto.

import { deflateRawSync, inflateRawSync } from 'zlib';

const TOPE_ZIP32 = 0xffffffff;
const TOPE_ENTRADAS = 0xffff;

// Tabla de CRC-32, calculada una vez. Es la huella que lleva cada entrada del ZIP y la que hace que
// el descompresor sepa que el fichero llegó entero.
const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** La fecha en el formato MS-DOS que usa el ZIP (sí, sigue siendo el de 1980). */
function fechaDos(d = new Date()) {
  const hora = ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xffff;
  const fecha = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { hora, fecha };
}

/**
 * Construye un ZIP en memoria.
 *
 * `entradas`: [{ nombre, contenido }] — `contenido` es Buffer o string (se pasa a UTF-8).
 * `nombre` puede llevar carpetas: `Clientes/clientes.csv`.
 *
 * En memoria y no por streaming a propósito: la copia entera de un negocio son unos megas, y así el
 * paquete se puede COMPROBAR antes de entregarlo. Un ZIP servido a trozos ya no se puede contrastar
 * contra la base, y entregar una descarga a medias que parece entera es el peor fallo posible aquí.
 */
export function crearZip(entradas, { fecha = new Date() } = {}) {
  if (entradas.length > TOPE_ENTRADAS) {
    throw new Error(`El ZIP admite ${TOPE_ENTRADAS} entradas y se le han pedido ${entradas.length}: haría falta ZIP64.`);
  }
  const { hora, fecha: dosFecha } = fechaDos(fecha);
  const locales = [];
  const central = [];
  let desplazamiento = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const crudo = Buffer.isBuffer(e.contenido) ? e.contenido : Buffer.from(String(e.contenido), 'utf8');
    const comprimido = deflateRawSync(crudo, { level: 6 });
    // Si comprimir no ayuda —ya lo está, como un PDF— se guarda tal cual: método 0.
    const usaDeflate = comprimido.length < crudo.length;
    const datos = usaDeflate ? comprimido : crudo;
    const metodo = usaDeflate ? 8 : 0;
    const huella = crc32(crudo);

    if (crudo.length > TOPE_ZIP32 || datos.length > TOPE_ZIP32) {
      throw new Error(`«${e.nombre}» pasa de 4 GB: haría falta ZIP64.`);
    }

    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0);      // firma de cabecera local
    cabecera.writeUInt16LE(20, 4);              // versión necesaria
    cabecera.writeUInt16LE(0x0800, 6);          // bandera: nombres en UTF-8
    cabecera.writeUInt16LE(metodo, 8);
    cabecera.writeUInt16LE(hora, 10);
    cabecera.writeUInt16LE(dosFecha, 12);
    cabecera.writeUInt32LE(huella, 14);
    cabecera.writeUInt32LE(datos.length, 18);
    cabecera.writeUInt32LE(crudo.length, 22);
    cabecera.writeUInt16LE(nombre.length, 26);
    cabecera.writeUInt16LE(0, 28);              // sin campos extra
    locales.push(cabecera, nombre, datos);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);           // firma de entrada del directorio central
    dir.writeUInt16LE(20, 4);                   // versión con la que se creó
    dir.writeUInt16LE(20, 6);                   // versión necesaria
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(metodo, 10);
    dir.writeUInt16LE(hora, 12);
    dir.writeUInt16LE(dosFecha, 14);
    dir.writeUInt32LE(huella, 16);
    dir.writeUInt32LE(datos.length, 20);
    dir.writeUInt32LE(crudo.length, 24);
    dir.writeUInt16LE(nombre.length, 28);
    dir.writeUInt16LE(0, 30);                   // extra
    dir.writeUInt16LE(0, 32);                   // comentario
    dir.writeUInt16LE(0, 34);                   // disco
    dir.writeUInt16LE(0, 36);                   // atributos internos
    dir.writeUInt32LE(0, 38);                   // atributos externos
    dir.writeUInt32LE(desplazamiento, 42);
    central.push(dir, nombre);

    desplazamiento += cabecera.length + nombre.length + datos.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);             // firma de fin de directorio central
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);
  fin.writeUInt16LE(0, 20);                     // sin comentario

  return Buffer.concat([cuerpo, directorio, fin]);
}


/**
 * Vuelve a LEER un ZIP y comprueba que se abre: recorre su directorio central, descomprime cada
 * fichero y contrasta el CRC.
 *
 * POR QUÉ EXISTE. Escribir bytes y dar por hecho que forman un ZIP válido es exactamente el verde
 * que miente contra el que este proyecto tiene una regla escrita. La descarga de un negocio que se
 * entrega y no se abre es peor que no entregarla: el cliente cree que tiene sus datos.
 *
 * Devuelve `{ ok, entradas, error }` y no lanza.
 */
export function verificarZip(buf) {
  try {
    // El fin del directorio central está al final; se busca hacia atrás porque puede haber
    // comentario (aquí no lo hay, pero buscarlo cuesta nada y no se rompe si algún día lo hay).
    let fin = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) return { ok: false, entradas: 0, error: 'no se encuentra el fin del directorio central' };

    const total = buf.readUInt16LE(fin + 10);
    let p = buf.readUInt32LE(fin + 16);
    let vistas = 0;

    for (let n = 0; n < total; n++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) {
        return { ok: false, entradas: vistas, error: `entrada ${n} del directorio con firma mala` };
      }
      const metodo = buf.readUInt16LE(p + 10);
      const huella = buf.readUInt32LE(p + 16);
      const comprimido = buf.readUInt32LE(p + 20);
      const crudo = buf.readUInt32LE(p + 24);
      const lNombre = buf.readUInt16LE(p + 28);
      const lExtra = buf.readUInt16LE(p + 30);
      const lCom = buf.readUInt16LE(p + 32);
      const desp = buf.readUInt32LE(p + 42);
      const nombre = buf.slice(p + 46, p + 46 + lNombre).toString('utf8');

      if (buf.readUInt32LE(desp) !== 0x04034b50) {
        return { ok: false, entradas: vistas, error: `«${nombre}»: cabecera local con firma mala` };
      }
      const lNombreL = buf.readUInt16LE(desp + 26);
      const lExtraL = buf.readUInt16LE(desp + 28);
      const ini = desp + 30 + lNombreL + lExtraL;
      const datos = buf.slice(ini, ini + comprimido);
      const contenido = metodo === 8 ? inflateRawSync(datos) : datos;

      if (contenido.length !== crudo) {
        return { ok: false, entradas: vistas, error: `«${nombre}»: dice ${crudo} bytes y salen ${contenido.length}` };
      }
      if (crc32(contenido) !== huella) {
        return { ok: false, entradas: vistas, error: `«${nombre}»: la huella no cuadra, el fichero está corrupto` };
      }

      vistas += 1;
      p += 46 + lNombre + lExtra + lCom;
    }
    return { ok: true, entradas: vistas, error: null };
  } catch (e) {
    return { ok: false, entradas: 0, error: e.message || String(e) };
  }
}


/**
 * Saca UN fichero de un ZIP, por nombre exacto o por patrón. Devuelve Buffer o `null`.
 *
 * Vive AQUÍ y no en quien lo use: un lector escrito aparte se separa del escritor al primer arreglo,
 * y entonces la comprobación deja de medir lo que el producto escribe.
 */
export function leerDelZip(buf, nombre, patron = null) {
  let fin = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) return null;
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  for (let n = 0; n < total; n++) {
    const metodo = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20);
    const lN = buf.readUInt16LE(p + 28), lE = buf.readUInt16LE(p + 30), lC = buf.readUInt16LE(p + 32);
    const desp = buf.readUInt32LE(p + 42);
    const nom = buf.slice(p + 46, p + 46 + lN).toString('utf8');
    if (nom === nombre || (patron && patron.test(nom))) {
      const ini = desp + 30 + buf.readUInt16LE(desp + 26) + buf.readUInt16LE(desp + 28);
      const datos = buf.slice(ini, ini + comp);
      return metodo === 8 ? inflateRawSync(datos) : datos;
    }
    p += 46 + lN + lE + lC;
  }
  return null;
}
