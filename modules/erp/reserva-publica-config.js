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

import { ahoraLocal, diasEntre, hhmm } from './citas-engine.js';

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
  };
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

// ── Quién y qué se enseña fuera (lecturas puras; viven aquí para que routes/citas.js las use) ──────
// Un servicio reservable DENTRO no es reservable DESDE FUERA: hacen falta las DOS marcas.
export function esServicioPublico(db, id) {
  return db.prepare(
    `SELECT 1 FROM products p JOIN service_config sc ON sc.product_id=p.id
      WHERE p.id=? AND p.type='service' AND sc.reservable=1 AND sc.publico=1
        AND (p.status IS NULL OR p.status<>'archived')`
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
