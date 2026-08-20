// ESCALERA · PASO 7 · PIEZA 6 — PUERTA PÚBLICA DE RESERVA (servicios compartidos, sin sesión).
//
// LA REGLA QUE MANDA AQUÍ: el motor de la pieza 5 se USA, no se toca. Los huecos que ve un cliente
// desde la calle salen de huecos() —la MISMA función que alimenta la agenda de dentro—, llamada con
// otros argumentos de política (antelación 2 h, ventana 60 días), nunca con otro cálculo. Por eso la
// PRUEBA DE COINCIDENCIA puede exigir igualdad AL MINUTO: no hay dos implementaciones que puedan
// desviarse, hay una sola con dos juegos de parámetros. La rejilla y el corte del mismo día NO son
// política de escaparate (son cómo trabaja el negocio) y se toman de los ajustes de dentro.
//
// LO QUE SALE POR AQUÍ, Y NADA MÁS: servicios marcados públicos, personas marcadas públicas con el
// nombre que puso el DUEÑO, y huecos. Nunca un cliente, nunca otra cita, nunca un admin_users.name.
//
// EL CLIENTE NO SE DUPLICA Y NO SE INVENTA: si el móvil normalizado o el email ya son de una ficha
// activa, la reserva se ENLAZA a ella; si no, nace como cliente SUELTO, exactamente igual que cuando
// se crea desde la agenda. La puerta pública NO da de alta fichas (decisión del dueño, 28 jul 2026).
//
// ESCRIBIR PASA SIEMPRE POR LA PIEZA 5: createCitaSvc / moverCitaSvc / anularCitaSvc / cambiarEstadoSvc.
// Aquí no hay un solo INSERT en `citas`. Así la geometría congelada, la autoasignación de puesto, la
// guarda de solape en servidor, el código y el token son LOS MISMOS que por dentro, por construcción.

import { resolveVatRate } from '../../core/vat-bands.js';
import { huecos, ahoraLocal, hhmm, geometriaCadena } from './citas-engine.js';
import { normalizeMovil } from './citas-avisos.js';
import {
  ajustesCitas, resolveServiceConfigs, createCitaSvc, moverCitaSvc, anularCitaSvc, cambiarEstadoSvc,
} from './routes/citas.js';
import { reservaPublicaSchema, reservaCambioSchema } from './schemas.js';
import {
  ajustesPublicos, cerrada, textoConsentimiento, reservaDeCita, esCitaPublica, ventanaCliente,
  esServicioPublico, exigirServiciosPublicos, personasPublicas, esPersonaPublica,
  reservasPublicasPendientes, SQL_PUBLICABLE,
} from './reserva-publica-config.js';

// Se reexportan para que quien importe "el módulo de la puerta" tenga todo en un sitio, aunque las
// lecturas puras vivan en la hoja (ver la cabecera de reserva-publica-config.js).
export { esServicioPublico, exigirServiciosPublicos, personasPublicas, esPersonaPublica, reservasPublicasPendientes };

const err = (msg, status) => { const e = new Error(msg); e.status = status; return e; };

// ── Qué se enseña fuera ───────────────────────────────────────────────────────────────────────────
// Servicios: reservable (pieza 5) Y publico (pieza 6) Y no archivado Y —desde el 18 ago 2026— CON
// PRECIO Y CON DURACIÓN. Esa última mitad es `SQL_PUBLICABLE`, y viene del módulo hoja para que la
// lista de fuera y el `esServicioPublico` que valida cada reserva digan EXACTAMENTE lo mismo: si una
// dijera que sí y la otra que no, el cliente vería un servicio que al reservar da "no encontrado".
// Precio e IVA SALEN DEL CATÁLOGO — aquí no se recalcula nada, solo se resuelve el % de la banda
// igual que hace la factura.
export function serviciosPublicos(db) {
  const aj = ajustesCitas(db);
  return db.prepare(
    `SELECT p.id, p.name, p.price, p.tax_band, p.tax_rate,
            sc.duracion_min, sc.muerto_ini_min, sc.muerto_dur_min, sc.margen_min
       FROM products p JOIN service_config sc ON sc.product_id = p.id
      WHERE sc.publico=1 AND ${SQL_PUBLICABLE}
      ORDER BY p.name`
  ).all().map(s => {
    const iva = resolveVatRate(aj.country, s.tax_band, Number(s.tax_rate) || 0).rate;
    const base = Number(s.price) || 0;
    return {
      id: s.id, nombre: s.name,
      precio: base, iva_pct: iva,
      precio_total: Math.round(base * (1 + iva / 100) * 100) / 100,
      // Lo que el cliente pasa en el negocio = "tiempo contigo" (el tiempo de espera va DENTRO de
      // esos minutos). El margen posterior es del negocio, no del cliente: no se le enseña.
      duracion_min: s.duracion_min,
    };
  });
}
// ── HUECOS — el motor de la pieza 5, con la política de fuera ──────────────────────────────────────
export function politicaHuecos(db) {
  const aj = ajustesCitas(db), pub = ajustesPublicos(db);
  return {
    grid: aj.grid,                                  // cómo trabaja el negocio (igual que dentro)
    corte_mismo_dia_min: aj.corte_mismo_dia_min,    // ídem
    antelacion_min: pub.antelacion_min,             // política de la puerta (defecto 2 h)
    ventana_dias: pub.ventana_dias,                 // política de la puerta (defecto 60 días)
  };
}

// Huecos públicos de un día. `user_id` null = "cualquiera disponible" (unión de los de cada persona
// pública elegible). Devuelve [{min, hora, user_ids:[…]}] ordenado por minuto.
//
// NO se filtra por puesto libre, A PROPÓSITO: la agenda de dentro tampoco lo hace al listar huecos, y
// la coincidencia al minuto es requisito. Si al confirmar no hay puesto, createCitaSvc responde 409 y
// se proponen huecos cercanos — exactamente el mismo gesto que por dentro.
export function huecosPublicos(db, { fecha, service_ids, user_id = null, ahora = null }) {
  exigirServiciosPublicos(db, service_ids);
  const aj = ajustesCitas(db);
  const pol = politicaHuecos(db);
  const geo = geometriaCadena(resolveServiceConfigs(db, service_ids, aj.margen_defecto_min));
  const now = ahora || ahoraLocal();

  let personas;
  if (user_id) {
    if (!esPersonaPublica(db, user_id, service_ids)) throw cerrada();
    personas = [{ id: Number(user_id) }];
  } else {
    personas = personasPublicas(db, service_ids);
  }

  const porMinuto = new Map();
  for (const p of personas) {
    const hs = huecos(db, {
      fecha, user_id: p.id, recurso_id: null,
      dur_min: geo.dur_total, margen_min: geo.margen_min,
      grid: pol.grid, antelacion_min: pol.antelacion_min,
      ventana_dias: pol.ventana_dias, corte_mismo_dia_min: pol.corte_mismo_dia_min,
      ahora: now,
    });
    for (const m of hs) {
      if (!porMinuto.has(m)) porMinuto.set(m, []);
      porMinuto.get(m).push(p.id);
    }
  }
  return [...porMinuto.entries()].sort((a, b) => a[0] - b[0])
    .map(([min, ids]) => ({ min, hora: hhmm(min), user_ids: ids }));
}

// Pocos huecos CERCANOS a la hora pedida, para proponer alternativas cuando algo choca — el mismo
// gesto que hace la agenda por dentro (no un error seco).
export function huecosCercanosPublicos(db, { fecha, service_ids, user_id, inicio_min, ahora = null }, cuantos = 4) {
  try {
    return huecosPublicos(db, { fecha, service_ids, user_id: user_id || null, ahora })
      .map(h => ({ min: h.min, hora: h.hora, dist: Math.abs(h.min - inicio_min) }))
      .sort((a, b) => a.dist - b.dist).slice(0, cuantos)
      .sort((a, b) => a.min - b.min).map(({ min, hora }) => ({ min, hora }));
  } catch { return []; }
}

// ── El cliente: se ENLAZA si ya existe, nunca se duplica, nunca se da de alta ──────────────────────
// Busca por móvil NORMALIZADO (E.164) y por email en minúsculas, sobre fichas activas. Devuelve solo
// el id: quien llama no aprende NADA más, y la pantalla no dice jamás si había ficha o no.
export function resolverClientePublico(db, { movil = '', email = '' } = {}) {
  const n = normalizeMovil(movil || '');
  if (n.valido && n.e164) {
    const porMovil = db.prepare(
      "SELECT id FROM clients WHERE active=1 AND movil_e164 IS NOT NULL AND movil_e164<>'' AND movil_e164=? ORDER BY id LIMIT 1"
    ).get(n.e164);
    if (porMovil) return { cliente_id: porMovil.id, movil_e164: n.e164, movil_valido: n.valido };
  }
  const mail = String(email || '').trim().toLowerCase();
  if (mail) {
    const porMail = db.prepare(
      "SELECT id FROM clients WHERE active=1 AND email IS NOT NULL AND TRIM(email)<>'' AND LOWER(TRIM(email))=? ORDER BY id LIMIT 1"
    ).get(mail);
    if (porMail) return { cliente_id: porMail.id, movil_e164: n.e164, movil_valido: n.valido };
  }
  return { cliente_id: null, movil_e164: n.e164, movil_valido: n.valido };
}

// ── RESERVAR (servicio validado compartido) ───────────────────────────────────────────────────────
export function crearReservaPublica(db, input, ctx = {}) {
  const r = reservaPublicaSchema.safeParse(input);
  if (!r.success) throw err('Revisa los datos de la reserva.', 400);
  const d = r.data;

  // Campo trampa: un humano nunca lo rellena (va oculto y fuera del recorrido del teclado). Si trae
  // algo, no se crea nada. El mensaje es el genérico: no se le enseña al bot qué le delató.
  if ((d.trampa || '').trim()) throw err('No hemos podido procesar la reserva.', 400);
  if (!d.consent) throw err('Necesitamos que aceptes el tratamiento de tus datos para poder reservar.', 400);

  const movilNorm = normalizeMovil(d.movil || '');
  const email = String(d.email || '').trim();
  if (!movilNorm.valido && !email) throw err('Déjanos un móvil o un email para poder avisarte.', 400);

  const aj = ajustesCitas(db);
  const pub = ajustesPublicos(db);
  if (!pub.activa) throw cerrada();
  exigirServiciosPublicos(db, d.service_ids);
  const ahora = ctx.ahora || ahoraLocal();

  // REVALIDACIÓN EN SERVIDOR. Se recalculan los huecos AQUÍ, con la política de la puerta, y la hora
  // pedida tiene que estar entre ellos. Esto es lo que hace cumplir la antelación mínima y la máxima
  // aunque el navegador mande lo que quiera, y lo que convierte un hueco ya pisado en un 409 honesto.
  const disponibles = huecosPublicos(db, { fecha: d.fecha, service_ids: d.service_ids, user_id: d.user_id || null, ahora });
  const hueco = disponibles.find(h => h.min === d.inicio_min);
  if (!hueco) {
    const e = err('Ese hueco ya no está libre.', 409);
    e.huecos = huecosCercanosPublicos(db, { fecha: d.fecha, service_ids: d.service_ids, user_id: d.user_id || null, inicio_min: d.inicio_min, ahora });
    throw e;
  }
  // "Cualquiera disponible" → la primera persona pública (orden estable por id) con ese hueco libre.
  const userId = d.user_id ? Number(d.user_id) : hueco.user_ids[0];

  // El cliente: enlazar si ya existe; si no, suelto (igual que en la agenda). NO se crea ficha.
  const cli = resolverClientePublico(db, { movil: d.movil, email });

  // Modo del dueño. En AMBOS casos la cita EXISTE desde ya → RETIENE el hueco (ocupacionPersona solo
  // descuenta las anuladas). La diferencia es el estado y si caduca sola.
  const aprobar = pub.modo === 'aprobar';
  const retieneHasta = aprobar ? (ctx.nowEpoch || Math.floor(Date.now() / 1000)) + pub.retencion_horas * 3600 : null;

  const run = db.transaction(() => {
    const cita = createCitaSvc(db, {
      cliente_id: cli.cliente_id,
      cliente_suelto_nombre: cli.cliente_id ? '' : d.nombre,
      cliente_suelto_movil: cli.cliente_id ? '' : (movilNorm.valido ? movilNorm.e164 : ''),
      user_id: userId,
      fecha: d.fecha,
      inicio_min: d.inicio_min,
      service_ids: d.service_ids,
      nota: d.nota || '',
      estado: 'pedida',
    }, { created_by: null });

    if (!aprobar) cambiarEstadoSvc(db, cita.id, 'confirmada');

    db.prepare(
      `INSERT INTO cita_reserva_publica (cita_id,email,consent_texto,politica_texto,aprobacion,retiene_hasta)
       VALUES (?,?,?,?,?,?)`
    ).run(cita.id, email, textoConsentimiento(aj.company_name), pub.politica,
          aprobar ? 'pendiente' : 'auto', retieneHasta);
    return cita;
  });

  let cita;
  try { cita = run(); }
  catch (e) {
    // El solape de servidor (409 de createCitaSvc) puede ganarnos la carrera entre calcular el hueco
    // y escribir. Se responde igual que dentro: 409 con huecos cercanos, no un error seco.
    if (e.status === 409) {
      e.huecos = huecosCercanosPublicos(db, { fecha: d.fecha, service_ids: d.service_ids, user_id: d.user_id || null, inicio_min: d.inicio_min, ahora });
    }
    throw e;
  }
  return {
    ...cita, user_id: userId, email,
    aprobacion: aprobar ? 'pendiente' : 'auto',
    cliente_id: cli.cliente_id,
  };
}

// ── Cambiar / anular desde el enlace del cliente (solo citas nacidas FUERA) ────────────────────────
export function cambiarReservaPublica(db, citaId, input, ctx = {}) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(citaId);
  if (!cita) throw err('Cita no encontrada', 404);
  if (!esCitaPublica(db, citaId)) throw err('Esta cita no se gestiona desde aquí.', 403);
  const ahora = ctx.ahora || ahoraLocal();
  const v = ventanaCliente(db, cita, ahora);
  if (!v.puede) throw err(v.motivo, 403);
  const r = reservaCambioSchema.safeParse(input);
  if (!r.success) throw err('Revisa el día y la hora.', 400);
  const d = r.data;

  const service_ids = db.prepare('SELECT product_id FROM cita_servicios WHERE cita_id=? ORDER BY orden,id').all(citaId).map(x => x.product_id);
  const libres = huecosPublicos(db, { fecha: d.fecha, service_ids, user_id: cita.user_id, ahora });
  if (!libres.some(h => h.min === d.inicio_min)) {
    const e = err('Ese hueco ya no está libre.', 409);
    e.huecos = huecosCercanosPublicos(db, { fecha: d.fecha, service_ids, user_id: cita.user_id, inicio_min: d.inicio_min, ahora });
    throw e;
  }
  // Mover pasa por el servicio validado de la pieza 5 → revalida el solape en servidor otra vez.
  moverCitaSvc(db, citaId, { fecha: d.fecha, inicio_min: d.inicio_min });
  return { id: Number(citaId), fecha: d.fecha, inicio_min: d.inicio_min, hora: hhmm(d.inicio_min) };
}

export function anularReservaPublica(db, citaId, ctx = {}) {
  const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(citaId);
  if (!cita) throw err('Cita no encontrada', 404);
  if (!esCitaPublica(db, citaId)) throw err('Esta cita no se gestiona desde aquí.', 403);
  const v = ventanaCliente(db, cita, ctx.ahora || ahoraLocal());
  if (!v.puede) throw err(v.motivo, 403);
  // CAMINO 3 · el cliente anula desde su enlace. Se rellena SOLO: al cliente no se le pregunta quién
  // anula, porque es él — preguntárselo sería pedirle que rellene un formulario para decir lo que ya
  // sabemos por el camino que ha usado.
  anularCitaSvc(db, citaId, 'El cliente anuló su cita desde el enlace', 'cliente');
  return { id: Number(citaId), estado: 'anulada' };
}

// ── Modo "YO APRUEBO": aprobar, rechazar y CADUCAR SOLA ────────────────────────────────────────────
export function aprobarReserva(db, citaId) {
  const res = reservaDeCita(db, citaId);
  if (!res) throw err('Esta cita no viene de la puerta pública.', 404);
  if (res.aprobacion !== 'pendiente') return { id: Number(citaId), aprobacion: res.aprobacion };
  db.transaction(() => {
    cambiarEstadoSvc(db, citaId, 'confirmada');
    db.prepare("UPDATE cita_reserva_publica SET aprobacion='aprobada', retiene_hasta=NULL WHERE cita_id=?").run(citaId);
  })();
  return { id: Number(citaId), aprobacion: 'aprobada' };
}
export function rechazarReserva(db, citaId, motivo = 'El negocio no pudo atender la solicitud') {
  const res = reservaDeCita(db, citaId);
  if (!res) throw err('Esta cita no viene de la puerta pública.', 404);
  if (res.aprobacion !== 'pendiente') return { id: Number(citaId), aprobacion: res.aprobacion };
  db.transaction(() => {
    // CAMINO 4 · el negocio RECHAZA una solicitud de cita. Lo decide él, así que es suya.
    anularCitaSvc(db, citaId, motivo, 'negocio');
    db.prepare("UPDATE cita_reserva_publica SET aprobacion='rechazada', retiene_hasta=NULL WHERE cita_id=?").run(citaId);
  })();
  return { id: Number(citaId), aprobacion: 'rechazada' };
}

// La solicitud que nadie contestó se cae sola y DEVUELVE EL HUECO. Idempotente: pasar dos veces no
// cambia nada. `nowEpoch` se inyecta (así el test no depende del reloj).
export function caducarReservasPendientes(db, nowEpoch = Math.floor(Date.now() / 1000)) {
  const pend = db.prepare(
    "SELECT cita_id FROM cita_reserva_publica WHERE aprobacion='pendiente' AND retiene_hasta IS NOT NULL AND retiene_hasta<=?"
  ).all(nowEpoch);
  let n = 0;
  for (const p of pend) {
    db.transaction(() => {
      // CAMINO 5 · la solicitud caduca sola sin que nadie conteste. Aquí NO hay autor humano, y eso se
      // escribe tal cual ('automatico') en vez de dejarlo en blanco: «lo anuló el reloj» es un dato,
      // «no se sabe» sería otro distinto y no es este.
      anularCitaSvc(db, p.cita_id, 'La solicitud de cita caducó sin respuesta', 'automatico');
      db.prepare("UPDATE cita_reserva_publica SET aprobacion='caducada', retiene_hasta=NULL WHERE cita_id=?").run(p.cita_id);
    })();
    n++;
  }
  return n;
}
