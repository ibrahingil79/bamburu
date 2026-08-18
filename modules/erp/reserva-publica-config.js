// ESCALERA · PASO 7 · PIEZA 6 — PUERTA PÚBLICA: configuración y reglas de ventana (módulo HOJA).
//
// POR QUÉ ESTÁ SEPARADO DE reserva-publica.js. Ese necesita los servicios validados de la pieza 5
// (routes/citas.js), y routes/citas.js necesita saber si una cita nació fuera y si el cliente aún
// puede tocarla. Un solo fichero cerraría el círculo de imports. Aquí vive solo lo que se resuelve
// con `db` + el motor de tiempo, así que no importa nada de routes/ y los dos lados pueden usarlo.
//
// LA REGLA DE LA VENTANA VIVE AQUÍ Y SOLO AQUÍ: la página del cliente y el servidor la leen del mismo
// sitio. Si hubiera dos copias, un día dirían cosas distintas y el botón enseñado no sería el botón
// permitido.

import { ahoraLocal, diasEntre, hhmm, hayHorarioNegocio } from './citas-engine.js';

// El 404 de la puerta cerrada. SIEMPRE el mismo texto y el mismo código: apagada, handle que no
// cuadra o servicio no público responden IGUAL. Una respuesta distinta por caso sería un oráculo que
// dice "este negocio existe pero está cerrado" o "este servicio existe pero no lo enseño".
export const PUERTA_CERRADA = 'No encontrado';
export const cerrada = () => { const e = new Error(PUERTA_CERRADA); e.status = 404; return e; };

// ── Ajustes de la puerta pública (company_config), con los defectos del encargo ────────────────────
export function ajustesPublicos(db) {
  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  return {
    activa: !!cfg.cita_pub_activa,
    handle: (cfg.cita_pub_handle || '').trim(),
    antelacion_min: cfg.cita_pub_antelacion_min == null ? 120 : cfg.cita_pub_antelacion_min,
    ventana_dias: cfg.cita_pub_ventana_dias == null ? 60 : cfg.cita_pub_ventana_dias,
    modo: cfg.cita_pub_modo === 'aprobar' ? 'aprobar' : 'auto',
    retencion_horas: cfg.cita_pub_retencion_horas == null ? 24 : cfg.cita_pub_retencion_horas,
    cancelar_horas: cfg.cita_pub_cancelar_horas == null ? 24 : cfg.cita_pub_cancelar_horas,
    cancelar_activo: cfg.cita_pub_cancelar_activo == null ? true : !!cfg.cita_pub_cancelar_activo,
    politica: cfg.cita_pub_politica || '',
    privacidad_url: cfg.cita_pub_privacidad_url || '',
    // El encendido automático (§4): si ya se intentó y si el dueño ya vio el aviso.
    auto: !!cfg.cita_pub_auto,
    auto_visto: !!cfg.cita_pub_auto_visto,
  };
}

// ── §4 · LA PÁGINA DE RESERVAS SE ENCIENDE SOLA ───────────────────────────────────────────────────
// DECISIÓN DE IBRAHIN (18 ago 2026): que no haya que descubrirla. Se enciende automáticamente en
// cuanto el negocio tiene (a) horario propio definido y (b) al menos un servicio con precio distinto
// de cero y con duración.
//
// NO ANTES, y esto no es negociable por una razón concreta: los servicios sembrados nacen a precio
// cero y el horario de fábrica es de 8:00 a 21:00 los siete días (`DEFAULT_OPEN`). Encenderla antes
// publicaría al mundo una página con los precios en blanco y horarios de domingo que el negocio no
// cumple. Se enciende sola, sí, pero cuando hay algo publicable.
//
// ES DE UNA SOLA VEZ (`cita_pub_auto`). En cuanto se intenta, el pestillo se echa y el automatismo no
// vuelve a tocar el interruptor jamás. Sin eso, el dueño que la apaga se la encontraría encendida otra
// vez al guardar el siguiente servicio: el interruptor de apagado sería un adorno, y perder el control
// de tu propia puerta pública es peor que no tenerla.
//
// LO QUE PUBLICA: los servicios que YA son publicables (`SQL_PUBLICABLE`) se marcan `publico=1` en ese
// mismo momento — encender la puerta y no enseñar nada detrás sería encender nada. Los demás esperan a
// tener precio y duración; a partir de aquí, quien decide qué se enseña es el dueño, servicio a
// servicio, como siempre.
//
// NUNCA LANZA: se llama desde el camino de guardar un horario o un servicio, y un fallo aquí no puede
// tumbar ese guardado. Devuelve qué pasó, para quien quiera contarlo.
export function servicioPublicableCount(db) {
  try {
    return db.prepare(
      `SELECT COUNT(*) n FROM products p JOIN service_config sc ON sc.product_id=p.id WHERE ${SQL_PUBLICABLE}`
    ).get().n;
  } catch { return 0; }
}

export function autoEncenderReservas(db) {
  try {
    const cfg = db.prepare('SELECT cita_pub_activa, cita_pub_auto FROM company_config WHERE id=1').get() || {};
    // El pestillo ya echado, o una puerta que el dueño abrió a mano: no se toca nada nunca más.
    if (cfg.cita_pub_auto) return { encendida: false, motivo: 'ya se intentó' };
    if (cfg.cita_pub_activa) {
      db.prepare('UPDATE company_config SET cita_pub_auto=1, cita_pub_auto_visto=1 WHERE id=1').run();
      return { encendida: false, motivo: 'ya estaba encendida a mano' };
    }
    if (!hayHorarioNegocio(db)) return { encendida: false, motivo: 'sin horario propio' };
    const publicables = servicioPublicableCount(db);
    if (!publicables) return { encendida: false, motivo: 'sin servicios con precio y duración' };

    db.transaction(() => {
      db.prepare(`UPDATE service_config SET publico=1, updated_at=CURRENT_TIMESTAMP
                   WHERE product_id IN (SELECT p.id FROM products p JOIN service_config sc ON sc.product_id=p.id
                                         WHERE ${SQL_PUBLICABLE})`).run();
      db.prepare('UPDATE company_config SET cita_pub_activa=1, cita_pub_auto=1, cita_pub_auto_visto=0 WHERE id=1').run();
    })();
    return { encendida: true, servicios: publicables, handle: handleEfectivo(db) };
  } catch { return { encendida: false, motivo: 'error' }; }
}

// ── La dirección: /reservar/<handle> ──────────────────────────────────────────────────────────────
// Corta y legible. Si el dueño no la pone, se genera del nombre del negocio; y si eso tampoco da nada
// utilizable, 'reservar'. La puerta siempre tiene una dirección — nunca una vacía.
export function slugHandle(s) {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
export function handleEfectivo(db) {
  const aj = ajustesPublicos(db);
  if (aj.handle) return slugHandle(aj.handle) || 'reservar';
  const cfg = db.prepare('SELECT company_name FROM company_config WHERE id=1').get() || {};
  return slugHandle(cfg.company_name) || 'reservar';
}
// Puerta ENCENDIDA y handle correcto; cualquier otra cosa → el MISMO 404 (ver PUERTA_CERRADA).
// El chequeo del handle es además lo que impide, en desarrollo (un solo host, donde la cookie de
// sesión gana al subdominio), que el dueño logueado en un negocio abra la puerta pública de otro.
export function exigirPuerta(db, handle) {
  const aj = ajustesPublicos(db);
  if (!aj.activa) throw cerrada();
  if (slugHandle(handle) !== handleEfectivo(db)) throw cerrada();
  return aj;
}

// ── §4 · EL AVISO DE QUE SE ENCENDIÓ SOLA ─────────────────────────────────────────────────────────
// FUENTE DE AVISOS, como las otras siete. Se avisa por LOS CANALES QUE YA HAY —la campana, la pantalla
// de avisos, el Inicio y el correo diario— y no se inventa una mensajería nueva: es el mismo criterio
// con el que entraron las solicitudes de cita por Internet en la pieza 6.
//
// Dice tres cosas, que son las tres que el encargo pide: QUE se encendió, CUÁL es la dirección y QUÉ
// se ve en ella. El interruptor de apagado en un clic lo pinta la pantalla de avisos (`accionesHtml`),
// porque un botón necesita un sitio donde vivir y el motor solo redacta.
//
// Aparece MIENTRAS siga encendida y el dueño no haya contestado (`cita_pub_auto_visto`). En cuanto
// pulsa cualquiera de los dos botones, se calla para siempre: no es una tarea pendiente que repetir,
// es una noticia que se da una vez.
export function reservaPublicaEncendida(db) {
  try {
    const aj = ajustesPublicos(db);
    if (!aj.auto || aj.auto_visto || !aj.activa) return [];
    const n = servicioPublicableCount(db);
    const personas = personasPublicas(db).length;
    return [{
      tipo: 'reserva_publica_encendida',
      // Por encima de todo lo vencido: es una puerta que se abrió al mundo y el dueño tiene que
      // enterarse HOY, no cuando baje del resto de la lista.
      urgencia: 100000,
      titulo: 'Tu página de reservas ya está abierta',
      detalle: 'Se ha encendido sola porque ya tienes horario y servicios con precio. Tus clientes pueden pedir cita en /reservar/'
        + handleEfectivo(db) + ' · se ven ' + n + ' servicio' + (n === 1 ? '' : 's')
        + (personas ? ' y ' + personas + ' persona' + (personas === 1 ? '' : 's') : ' y ninguna persona todavía')
        + '. Si no la quieres, apágala aquí mismo.',
      ref: { source: 'reserva_publica_encendida', handle: handleEfectivo(db), servicios: n, personas },
    }];
  } catch { return []; }
}

// ── Quién y qué se enseña fuera (lecturas puras; viven aquí para que routes/citas.js las use) ──────
// ── QUÉ ES PUBLICABLE ─────────────────────────────────────────────────────────────────────────────
// Un servicio reservable DENTRO no es reservable DESDE FUERA: hacen falta las DOS marcas. Y desde el
// 18 ago 2026, además, PRECIO Y DURACIÓN.
//
// POR QUÉ, y no es una manía: los servicios que siembra el perfil de oficio nacen a PRECIO CERO. Una
// página de reservas que enseña «Corte de pelo — 0,00 €» no es una página incompleta, es una página
// que MIENTE al cliente sobre lo que va a pagar. Y sin duración no hay hueco que ofrecer. Los demás no
// se pierden: esperan a tener precio y duración, y entonces se publican como cualquier otro.
//
// Esta condición vive en UN SOLO SITIO, `SQL_PUBLICABLE`, porque la usan tres cosas —esta función, la
// lista de `serviciosPublicos` y el encendido automático— y el día que discrepen, la puerta pública
// enseñaría un servicio que el motor luego rechaza (o al revés).
export const SQL_PUBLICABLE =
  `p.type='service' AND sc.reservable=1 AND sc.duracion_min > 0 AND p.price > 0
   AND (p.status IS NULL OR p.status<>'archived')`;

export function esServicioPublico(db, id) {
  return db.prepare(
    `SELECT 1 FROM products p JOIN service_config sc ON sc.product_id=p.id
      WHERE p.id=? AND sc.publico=1 AND ${SQL_PUBLICABLE}`
  ).get(id) != null;
}
// Los ids pedidos, validados contra lo público. Cualquier id que no lo sea → el 404 de la puerta
// (nunca "no reservable": el de fuera no puede distinguir un servicio oculto de uno inexistente).
export function exigirServiciosPublicos(db, ids) {
  if (!Array.isArray(ids) || !ids.length) throw cerrada();
  for (const id of ids) if (!esServicioPublico(db, id)) throw cerrada();
  return ids;
}

// Personas visibles fuera, con el nombre que puso EL DUEÑO. Si un servicio declara quién lo presta
// (service_providers), la persona debe poder prestarlos TODOS —una cita tiene una sola persona—; un
// servicio sin proveedores declarados significa "cualquiera" y no restringe.
// NUNCA se devuelve admin_users.name: sin nombre público, "Profesional N".
export function personasPublicas(db, serviceIds = []) {
  const filas = db.prepare(
    `SELECT u.id, pp.nombre_publico FROM admin_users u
       JOIN cita_pub_personas pp ON pp.user_id = u.id
      WHERE u.active=1 AND pp.visible=1 ORDER BY u.id`
  ).all();
  const declaradosDe = new Map();
  for (const sid of serviceIds) {
    declaradosDe.set(sid, db.prepare('SELECT user_id FROM service_providers WHERE product_id=?').all(sid).map(r => r.user_id));
  }
  const elegibles = filas.filter(f => {
    for (const sid of serviceIds) {
      const dec = declaradosDe.get(sid) || [];
      if (dec.length && !dec.includes(f.id)) return false;
    }
    return true;
  });
  return elegibles.map((f, i) => ({
    id: f.id,
    nombre: (f.nombre_publico || '').trim() || ('Profesional ' + (i + 1)),
  }));
}
export function esPersonaPublica(db, userId, serviceIds = []) {
  return personasPublicas(db, serviceIds).some(p => p.id === Number(userId));
}

// ── El texto del consentimiento: UNO, generado en el servidor ──────────────────────────────────────
// La pantalla lo PINTA de aquí y el servidor GUARDA esto mismo. No hay dos redacciones que puedan
// separarse, así que lo archivado es literalmente lo que el cliente leyó.
export function textoConsentimiento(empresa) {
  return 'Acepto que ' + (empresa || 'el negocio') + ' trate mis datos para gestionar esta cita, y he leído la política de privacidad y la política de cancelación.';
}

// ── Origen y ventana del cliente ──────────────────────────────────────────────────────────────────
export function reservaDeCita(db, citaId) {
  try { return db.prepare('SELECT * FROM cita_reserva_publica WHERE cita_id=?').get(citaId) || null; }
  catch { return null; }   // tenant sin la migración de la pieza 6 todavía
}
// La MERA EXISTENCIA de la fila es la marca de origen: la tabla `citas` de la pieza 5 no cambió.
export function esCitaPublica(db, citaId) { return reservaDeCita(db, citaId) != null; }

// Minutos que faltan para una cita, desde un "ahora" local dado. Negativo = ya pasó.
export function minutosHastaCita(cita, ahora) {
  return diasEntre(cita.fecha, ahora.fecha) * 1440 + cita.inicio_min - ahora.min;
}

// ¿Puede el cliente cambiar o anular esta cita AHORA?
// `aplica:false` = la cita NO nació fuera → la pieza 5 manda y su enlace sigue funcionando igual que
// siempre (decisión del dueño, 28 jul 2026: la ventana solo rige para las nacidas fuera).
export function ventanaCliente(db, cita, ahora = null) {
  if (!esCitaPublica(db, cita.id)) return { aplica: false, puede: true, horas: 0 };
  const pub = ajustesPublicos(db);
  if (!pub.cancelar_activo) {
    return { aplica: true, puede: false, horas: pub.cancelar_horas, desactivado: true,
      motivo: 'Para cambiar o anular tu cita, ponte en contacto con el negocio.' };
  }
  const faltan = minutosHastaCita(cita, ahora || ahoraLocal());
  const puede = faltan >= pub.cancelar_horas * 60;
  return {
    aplica: true, puede, horas: pub.cancelar_horas, faltan_min: faltan,
    motivo: puede ? ''
      : 'Ya no se puede cambiar ni anular por Internet (el plazo era de ' + pub.cancelar_horas + ' h antes de la cita). Ponte en contacto con el negocio.',
  };
}

// ── FUENTE DE AVISOS AL NEGOCIO (se engancha al motor de avisos.js que YA existe) ──────────────────
// Cero mensajería nueva: registrar esta función en SOURCES la hace aparecer sola en la campana, en
// /admin/avisos, en Inicio y en el email diario. Avisa de las solicitudes por aprobar, con lo que les
// queda de vida antes de caducar solas.
export function reservasPublicasPendientes(db, today, nowEpoch = Math.floor(Date.now() / 1000)) {
  const hoy = today || ahoraLocal().fecha;
  const filas = db.prepare(
    `SELECT c.id, c.codigo, c.fecha, c.inicio_min, r.retiene_hasta,
            COALESCE(NULLIF(c.cliente_suelto_nombre,''), cl.name, 'Cliente') AS cliente
       FROM cita_reserva_publica r JOIN citas c ON c.id = r.cita_id
       LEFT JOIN clients cl ON cl.id = c.cliente_id
      WHERE r.aprobacion='pendiente' AND c.archived=0 AND c.estado<>'anulada' AND c.fecha>=?
      ORDER BY c.fecha, c.inicio_min`
  ).all(hoy);
  return filas.map(f => {
    const horas = f.retiene_hasta == null ? null : Math.max(0, Math.round((f.retiene_hasta - nowEpoch) / 3600));
    return {
      tipo: 'reserva_publica',
      // Por encima de la recurrente (200) y del cliente en riesgo (300), por debajo del dinero
      // vencido (1000+): una solicitud que caduca sola en horas es urgente, pero jamás debe tapar
      // una factura sin cobrar. Cuanto menos le queda, más arriba DENTRO de la fuente.
      urgencia: 400 + (horas == null ? 0 : Math.max(0, 24 - Math.min(horas, 24))),
      titulo: f.cliente + ' · ' + f.fecha + ' a las ' + hhmm(f.inicio_min),
      detalle: horas == null
        ? 'Solicitud de cita por Internet, pendiente de que la apruebes.'
        : 'Solicitud de cita por Internet: caduca sola en ' + horas + ' h si no respondes.',
      ref: { source: 'reserva_publica', cita_id: f.id, codigo: f.codigo, fecha: f.fecha, hora: hhmm(f.inicio_min), horas_restantes: horas },
    };
  });
}
