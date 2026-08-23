// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL MAPA DE LA FICHA DE CLIENTE (bloque F) — motor
//
// DOS PIEZAS Y UNA SOLA IDEA: que abrir una ficha NO dependa de nadie de fuera.
//
//   1. LA DIRECCIÓN SE RESUELVE AL GUARDAR, no al mirar. Cuando se crea o se edita un cliente, se
//      pregunta UNA vez a Nominatim (el buscador de OpenStreetMap) dónde cae esa dirección y se
//      guarda el punto. La ficha, después, solo lee de nuestra base.
//   2. LAS TESELAS PASAN POR NUESTRO SERVIDOR, con caché en disco. El navegador no habla con
//      openstreetmap.org: le pide las imágenes a Bamburu, que las baja UNA vez y las guarda. La
//      segunda ficha que caiga en el mismo barrio ya no sale de este disco.
//
// LO QUE NO SE TOCA (encargo): los datos del cliente y el formulario de dirección. Por eso el punto
// NO vive en `clients` sino en su propia tabla `client_geo`: es un dato DERIVADO —una caché— que se
// puede tirar y reconstruir, y que no tiene por qué ensuciar la ficha fiscal de nadie.
//
// ── POR QUÉ HAY UNA CRIBA Y NO SE PINTA LO PRIMERO QUE CONTESTE ─────────────────────────────────
// «No enseñar un mapa del océano» (F4) tiene una versión peor y más difícil de ver: la chincheta
// SEGURA EN EL PUEBLO EQUIVOCADO. Medido contra el servicio real el 23 ago 2026:
//
//     street=Calle Gran Via 32 · postalcode=28013 · city=Madrid
//       → «Ferretería Majariega, 32, Calle Gran Vía, MAJADAHONDA, 28220»   ← otro municipio
//     street=Gran Via 32 · city=Madrid  (sin el código postal)
//       → «32, Gran Vía, Centro, Madrid, 28013»                            ← la buena
//
// Las dos respuestas vienen con `place_rank` 30 (portal), o sea que la precisión declarada NO
// distingue una de otra. Lo que las distingue es COMPARARLAS CON LO QUE SE PIDIÓ. De ahí las tres
// reglas de `aceptaResultado()` y el segundo intento sin código postal. Si tras eso no hay un punto
// del que fiarse, no hay mapa — y no se avisa de nada, que es lo que pide el encargo.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { mkdir, readFile, writeFile, rename } from 'fs/promises';
import { randomBytes } from 'crypto';
import path from 'path';

// Nominatim y el servidor de teselas piden que quien les llama se identifique. Va el producto y su
// dominio: NUNCA el correo de nadie ni el nombre del negocio (el servicio de fuera no tiene por qué
// saber qué cliente se está mirando, y menos aún quién lo mira).
const AGENTE = 'Bamburu/1.0 (+https://bamburu.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TESELAS = 'https://tile.openstreetmap.org';
const ESPERA_MS = 8000;

// ── LA DIRECCIÓN DEL CLIENTE ────────────────────────────────────────────────────────────────────
// La CALLE manda: sin ella no hay dirección que pintar. Un cliente que solo tiene «Madrid» no tiene
// dirección — tiene una ciudad—, y una chincheta en el centro de Madrid con un enlace de «cómo
// llegar» no es un dato incompleto: es un dato FALSO. El resto (CP, ciudad, provincia, país) entra
// en la consulta para afinar y para poder criticar la respuesta, pero no basta por sí solo.
export function direccionDeCliente(cli) {
  const t = v => String(v == null ? '' : v).trim();
  if (!cli) return null;
  const calle = t(cli.address);
  if (!calle) return null;
  const partes = { calle, cp: t(cli.postal_code), ciudad: t(cli.city), provincia: t(cli.province), pais: t(cli.country) };
  // La HUELLA es la dirección exacta que se resolvió. Sirve para dos cosas y las dos importan:
  // no volver a preguntar por lo que no ha cambiado, y —sobre todo— no pintar NUNCA un punto que
  // pertenece a una dirección anterior. Si la huella guardada no coincide con la de hoy, no hay mapa.
  const huella = [partes.calle, partes.cp, partes.ciudad, partes.provincia, partes.pais]
    .join(' | ').replace(/\s+/g, ' ').toLowerCase();
  return { partes, huella, texto: [partes.calle, partes.cp, partes.ciudad, partes.provincia, partes.pais].filter(Boolean).join(', ') };
}

// ── LA CRIBA ────────────────────────────────────────────────────────────────────────────────────
// `place_rank` de Nominatim: 4 país · 8 comunidad · 12 provincia · 15-16 ciudad · 19 barrio ·
// 26 calle · 30 portal. Por debajo de 26 lo que devuelve es una MANCHA, no un sitio: ahí es donde
// nace literalmente el «mapa del océano».
const RANGO_CALLE = 26;
const llano = s => String(s == null ? '' : s).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

export function aceptaResultado(r, partes) {
  if (!r) return false;
  const lat = Number(r.lat), lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  if (!(Number(r.place_rank) >= RANGO_CALLE)) return false;       // NaN incluido: si no lo declara, no vale
  const a = r.address || {};
  const cpSuyo = llano(a.postcode);
  const suyas = [a.city, a.town, a.village, a.municipality, a.county].filter(Boolean).map(llano);
  const miaCiudad = llano(partes.ciudad);
  // (1) Si dimos código postal y él contesta con OTRO, se ha ido a otro sitio: es el caso Majadahonda.
  if (partes.cp && cpSuyo && cpSuyo !== llano(partes.cp)) return false;
  // (2) Y si dimos ciudad, la suya tiene que parecerse. La comparación es por inclusión en los dos
  // sentidos a propósito: «A Coruña»/«La Coruña» y «Palma»/«Palma de Mallorca» son la misma ciudad
  // escrita de dos maneras, y un mapa menos por un guion es peor que ninguna de las dos.
  if (miaCiudad && suyas.length && !suyas.some(x => x.includes(miaCiudad) || miaCiudad.includes(x))) return false;
  // (3) Y LA QUE FALTABA: si dimos algo con lo que contrastar y su respuesta no trae NI código postal
  // NI municipio, no hay forma de saber si acertó. Un punto que no se puede comprobar no se enseña —
  // que es la misma regla de las otras dos, aplicada al caso en que el silencio es la respuesta.
  if ((partes.cp || miaCiudad) && !cpSuyo && !suyas.length) return false;
  return true;
}

// ── EL TURNO ────────────────────────────────────────────────────────────────────────────────────
// Nominatim es gratis y pide a cambio como mucho UNA petición por segundo. Se cumple con una cola
// de uno en uno: como esto solo corre al guardar un cliente, nadie espera delante de una pantalla.
let ultimaSalida = 0;
let cola = Promise.resolve();
function turno(fn) {
  const mio = cola.then(async () => {
    const falta = 1100 - (Date.now() - ultimaSalida);
    if (falta > 0) await new Promise(r => setTimeout(r, falta));
    try { return await fn(); } finally { ultimaSalida = Date.now(); }
  });
  cola = mio.then(() => {}, () => {});   // la cola nunca se rompe por un fallo de uno
  return mio;
}

async function preguntar(params) {
  const u = new URL(NOMINATIM);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');
  u.searchParams.set('addressdetails', '1');
  const corta = new AbortController();
  const reloj = setTimeout(() => corta.abort(), ESPERA_MS);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': AGENTE, 'Accept-Language': 'es' }, signal: corta.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return (Array.isArray(j) && j[0]) ? j[0] : null;
  } catch { return null; } finally { clearTimeout(reloj); }
}

// Devuelve {lat, lon, etiqueta} o null. NUNCA lanza: que el servicio de fuera esté caído no puede
// ser un error para quien está guardando un cliente.
export async function resolver(partes) {
  const base = { street: partes.calle, city: partes.ciudad, state: partes.provincia, country: partes.pais };
  let r = await turno(() => preguntar(partes.cp ? { ...base, postalcode: partes.cp } : base));
  // Segundo intento SIN código postal. No es terquedad: es el caso medido de arriba, donde el CP
  // arrastra la búsqueda a otro municipio y quitarlo la devuelve a la calle correcta. La criba se
  // vuelve a aplicar igual de dura, así que este intento no puede colar nada que el primero rechazara.
  if (!aceptaResultado(r, partes) && partes.cp) r = await turno(() => preguntar(base));
  if (!aceptaResultado(r, partes)) return null;
  return { lat: Number(r.lat), lon: Number(r.lon), etiqueta: String(r.display_name || '').slice(0, 300) };
}

// ── LA CACHÉ EN LA BASE DEL NEGOCIO ─────────────────────────────────────────────────────────────
export function geoDeCliente(db, clientId) {
  try { return db.prepare('SELECT * FROM client_geo WHERE client_id=?').get(clientId) || null; }
  catch { return null; }   // tabla aún sin migrar: sin mapa, sin ruido
}

const GUARDAR = `INSERT INTO client_geo (client_id,huella,lat,lon,etiqueta,resuelto,updated_at)
                 VALUES (?,?,?,?,?,?,datetime('now'))
                 ON CONFLICT(client_id) DO UPDATE SET
                   huella=excluded.huella, lat=excluded.lat, lon=excluded.lon,
                   etiqueta=excluded.etiqueta, resuelto=excluded.resuelto, updated_at=excluded.updated_at`;

// Resuelve la dirección de un cliente y guarda el punto. Es lo que corre AL GUARDAR.
export async function refrescarGeo(db, clientId) {
  const cli = db.prepare('SELECT id,address,city,postal_code,province,country FROM clients WHERE id=?').get(clientId);
  if (!cli) return null;
  const d = direccionDeCliente(cli);
  if (!d) {
    // Se ha quedado sin calle. NO se borra la fila (regla permanente: archivar, no destruir): se
    // marca como no resuelta y se le quita la huella, con lo que deja de pintarse al instante.
    if (geoDeCliente(db, clientId)) db.prepare(GUARDAR).run(clientId, '', null, null, null, 0);
    return null;
  }
  const previo = geoDeCliente(db, clientId);
  // Si la dirección no ha cambiado y ya está resuelta, no se vuelve a preguntar: guardar el teléfono
  // de un cliente no es motivo para molestar a un servicio de fuera. Si NO se pudo resolver, sí se
  // reintenta — guardar otra vez suele ser justo el gesto de quien acaba de corregir la dirección.
  if (previo && previo.resuelto === 1 && previo.huella === d.huella) return previo;
  const punto = await resolver(d.partes);
  db.prepare(GUARDAR).run(clientId, d.huella, punto ? punto.lat : null, punto ? punto.lon : null,
    punto ? punto.etiqueta : null, punto ? 1 : 0);
  return geoDeCliente(db, clientId);
}

// El disparo desde el guardado: NI se espera NI puede reventar la operación. Guardar un cliente es
// una escritura en nuestra base; que un buscador de fuera no conteste no puede hacerla fallar.
export function programarGeo(db, clientId) {
  Promise.resolve().then(() => refrescarGeo(db, clientId)).catch(() => {});
}

// ── LO QUE LEE LA FICHA ─────────────────────────────────────────────────────────────────────────
// Síncrono y sin salir a la red: es lo único que se ejecuta al abrir un cliente. Devuelve null —y
// entonces no se pinta NADA— en los cuatro casos: sin calle, sin punto guardado, punto que no se
// pudo resolver, o punto que pertenece a una dirección ANTERIOR a la que hoy tiene la ficha.
export function mapaDeCliente(db, cli) {
  const d = direccionDeCliente(cli);
  if (!d) return null;
  const g = geoDeCliente(db, cli.id);
  if (!g || Number(g.resuelto) !== 1 || g.huella !== d.huella) return null;
  const lat = Number(g.lat), lon = Number(g.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, direccion: d.texto };
}

// ── LAS TESELAS, POR NUESTRO SERVIDOR ───────────────────────────────────────────────────────────
// z/x/y llegan de la calle: se validan como ENTEROS y dentro del rango del nivel de zoom antes de
// tocar nada. La URL se compone con números ya comprobados — nunca con el texto recibido—, que es
// lo que impide que esta ruta se convierta en un mandadero para pedir lo que sea a donde sea.
const Z_MIN = 1, Z_MAX = 19;
const enVuelo = new Map();
const carpeta = () => path.join(process.cwd(), 'data', 'teselas');

export function coordenadaDeTesela(z, x, y) {
  const nz = Number(z), nx = Number(x), ny = Number(y);
  if (!Number.isInteger(nz) || !Number.isInteger(nx) || !Number.isInteger(ny)) return null;
  if (nz < Z_MIN || nz > Z_MAX) return null;
  const lado = 2 ** nz;
  if (nx < 0 || ny < 0 || nx >= lado || ny >= lado) return null;
  return { z: nz, x: nx, y: ny };
}

export async function tesela(z, x, y) {
  const c = coordenadaDeTesela(z, x, y);
  if (!c) return null;
  const dir = path.join(carpeta(), String(c.z), String(c.x));
  const fich = path.join(dir, c.y + '.png');
  try { return await readFile(fich); } catch { /* aún no está: se baja */ }

  const clave = c.z + '/' + c.x + '/' + c.y;
  if (enVuelo.has(clave)) return enVuelo.get(clave);   // dos fichas del mismo barrio no la bajan dos veces
  const bajada = (async () => {
    const corta = new AbortController();
    const reloj = setTimeout(() => corta.abort(), ESPERA_MS);
    try {
      const r = await fetch(TESELAS + '/' + clave + '.png', { headers: { 'User-Agent': AGENTE }, signal: corta.signal });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) return null;
      await mkdir(dir, { recursive: true });
      // Se escribe a un temporal y se renombra: si el proceso muere a medias, en la caché no queda
      // un PNG cortado que luego se sirva para siempre como si fuera bueno.
      const tmp = fich + '.' + randomBytes(4).toString('hex') + '.tmp';
      await writeFile(tmp, buf);
      await rename(tmp, fich);
      return buf;
    } catch { return null; } finally { clearTimeout(reloj); enVuelo.delete(clave); }
  })();
  enVuelo.set(clave, bajada);
  return bajada;
}
