// ESCALERA · PASO 7 · PIEZA 6 — PUERTA PÚBLICA DE RESERVA: rutas y pantalla.
//
// TRES GRUPOS DE RUTAS, y conviene no confundirlos:
//   · createReservaPublicaRoutes  → /reservar/<handle>   SIN sesión, SIN CSRF. La puerta.
//   · createReservaEnlaceRoutes   → /cita/<token>/…      SIN sesión. Cambiar/anular con ventana; se
//     monta JUNTO a las rutas de la pieza 5 (rutas de 2 segmentos, no chocan con su /:token).
//   · createReservaAdminRoutes    → /api/erp/reserva-publica  CON candado citas.edit. Los mandos.
//
// LO QUE SALE SIN SESIÓN: servicios públicos, personas públicas con el nombre del dueño, huecos. Y
// nada más. Ni un cliente, ni otra cita, ni un admin_users.name, ni el motivo real de un 404.
//
// LA PANTALLA es primero móvil y habla el mismo idioma visual que la página de la cita de la pieza 5
// (mismos colores, mismas tarjetas, mismo modo oscuro). UN solo <script> con nonce y CERO handlers de
// atributo: /reservar es superficie de CSP ESTRICTA (ver core/security-headers.js).

import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { escHtml, jsonForScript } from '../../../core/escape.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { rateLimit } from '../../../core/rate-limit.js';
import { sendEmail } from '../../../core/mailer.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { citaPublicaAjustesSchema } from '../schemas.js';
import { hhmm } from '../citas-engine.js';
import {
  citaBaseUrl, citaEnlace, enviarEmailCita, registrarAviso, serviciosDeCita, normalizeMovil,
} from '../citas-avisos.js';
import { ajustesCitas, resolverCitaPorToken } from './citas.js';
import {
  ajustesPublicos, handleEfectivo, slugHandle, exigirPuerta, textoConsentimiento,
  personasPublicas, reservaDeCita, ventanaCliente, PUERTA_CERRADA,
} from '../reserva-publica-config.js';
import {
  serviciosPublicos, huecosPublicos, crearReservaPublica, cambiarReservaPublica,
  anularReservaPublica, aprobarReserva, rechazarReserva, caducarReservasPendientes,
} from '../reserva-publica.js';

const E = escHtml;
const idsDeQuery = (q) => String(q || '').split(',').map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0);

// Un 404 de puerta cerrada, en el idioma de quien pregunta. Siempre el MISMO cuerpo.
const cerrada404 = (c) => c.req.path.endsWith('/huecos') || c.req.header('accept')?.includes('application/json')
  ? c.json({ error: PUERTA_CERRADA }, 404)
  : c.html(paginaPuertaCerrada(), 404);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA PUERTA — /reservar (sin sesión, sin CSRF)
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function createReservaPublicaRoutes(db) {
  const app = new Hono();

  // FRENO 1 — por IP. Un cliente reservando toca la puerta unas pocas docenas de veces (mira días,
  // cambia de servicio). 90/min deja trabajar a una familia entera detrás del mismo router y corta un
  // barrido. Mismo mecanismo (y misma vigilancia en el panel de superadmin) que el enlace de la cita.
  app.use('*', rateLimit({
    windowMs: 60_000, max: 90, keyPrefix: 'reserva-pub',
    message: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.',
  }));

  // FRENO 2 — por TELÉFONO (y, si no hay, por email), solo en el POST. Sin esto, una botnet repartida
  // por mil IPs podía sembrar la agenda de un negocio con reservas basura a nombre del mismo móvil.
  // Seis reservas por hora y número: nadie legítimo pide más, y el que lo pide puede llamar.
  app.use('*', rateLimit({
    windowMs: 3_600_000, max: 6, keyPrefix: 'reserva-tel',
    message: 'Has hecho varias reservas seguidas. Espera un rato o llámanos.',
    keyFn: async (c) => {
      if (c.req.method !== 'POST') return null;
      try {
        const b = await c.req.json();          // Hono cachea el body parseado: el handler lo reusa
        const n = normalizeMovil(b?.movil || '');
        if (n.valido && n.e164) return 'tel:' + n.e164;
        const mail = String(b?.email || '').trim().toLowerCase();
        return mail ? 'mail:' + mail : null;   // sin sujeto no hay a quién limitar → pasa (el freno por IP sigue)
      } catch { return null; }
    },
  }));

  // La dirección sin handle lleva a la canónica (así el dueño puede repartir la corta si quiere).
  app.get('/', c => {
    const aj = ajustesPublicos(db);
    if (!aj.activa) return cerrada404(c);
    return c.redirect('/reservar/' + handleEfectivo(db), 302);
  });

  app.get('/:handle', c => {
    try {
      exigirPuerta(db, c.req.param('handle'));
      return c.html(paginaReserva(db, c));
    } catch (e) { return e.status === 404 ? cerrada404(c) : c.html(paginaPuertaCerrada(), 500); }
  });

  // Paso 1 y 2: el catálogo público (servicios) y quién los presta. Nada más viaja.
  app.get('/:handle/personas', c => {
    try {
      exigirPuerta(db, c.req.param('handle'));
      const ids = idsDeQuery(c.req.query('service_ids'));
      return c.json({ personas: personasPublicas(db, ids) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Paso 3: los huecos. Salen del motor de la pieza 5 (ver reserva-publica.js) — aquí no se calcula.
  app.get('/:handle/huecos', c => {
    try {
      exigirPuerta(db, c.req.param('handle'));
      const fecha = c.req.query('fecha');
      const ids = idsDeQuery(c.req.query('service_ids'));
      const uid = c.req.query('user_id') ? parseInt(c.req.query('user_id'), 10) : null;
      if (!fecha || !ids.length) return c.json({ huecos: [] });
      const hs = huecosPublicos(db, { fecha, service_ids: ids, user_id: uid || null });
      // user_ids NO sale a la calle: es el reparto interno del equipo. El servidor lo vuelve a
      // resolver al confirmar, así que el navegador no necesita saberlo.
      return c.json({ huecos: hs.map(h => ({ min: h.min, hora: h.hora })) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Paso 4: reservar. Revalida TODO en servidor (huecos, antelación, consentimiento, trampa).
  app.post('/:handle/reservar', async c => {
    let body;
    try {
      exigirPuerta(db, c.req.param('handle'));
      body = await c.req.json();
    } catch (e) { return c.json({ error: e.status === 404 ? PUERTA_CERRADA : 'Revisa los datos de la reserva.' }, e.status || 400); }

    let r;
    try {
      r = crearReservaPublica(db, body);
    } catch (e) {
      // Choque: 409 con huecos cercanos, igual que dentro. Nunca un error seco.
      if (e.status === 409) return c.json({ error: safeError(e), huecos: e.huecos || [] }, 409);
      return c.json({ error: safeError(e) }, e.status || 500);
    }

    // ── AVISOS: se reutiliza TODO lo que ya hay. Cero mensajería nueva. ──────────────────────────
    // Al cliente: la plantilla `confirmacion_cita` de la pieza 5, con SU enlace por llave (confirmar /
    // no puedo ir) y la política repetida. Si el envío falla, la reserva NO se cae: queda hecha y el
    // fallo se archiva en cita_avisos ('email_fallo'), que es lo que ve el negocio en su cola.
    // Al negocio: NO se manda nada aquí. La cita ya está en su agenda y en su Cola de envíos, y si
    // está en modo "yo apruebo", la fuente `reserva_publica` de avisos.js la pone en la campana, en
    // /admin/avisos, en Inicio y en el email diario. Esos son los canales que ya hay.
    if (r.email) {
      const aj = ajustesCitas(db);
      const pub = ajustesPublicos(db);
      const enlace = citaEnlace(citaBaseUrl(c.get('tenant')?.slug), r.token);
      try {
        await enviarEmailCita(db, {
          tipo: 'confirmacion', destinatario: r.email, empresa: aj.company_name, replyTo: aj.email,
          cliente: body?.nombre || '', servicio: serviciosDeCita(db, r.id).join(' + '),
          fecha: body.fecha, hora: hhmm(body.inicio_min), direccion: aj.address, enlace,
          politica: pub.politica,
        }, sendEmail);
        registrarAviso(db, { cita_id: r.id, tipo: 'confirmacion', canal: 'email', estado: 'email_enviado', nota: 'Reserva por Internet' });
      } catch (e) {
        registrarAviso(db, { cita_id: r.id, tipo: 'confirmacion', canal: 'email', estado: 'email_fallo', nota: safeError(e) });
      }
    }

    return c.json({
      ok: true, codigo: r.codigo, enlace: '/cita/' + r.token,
      aprobacion: r.aprobacion,
      message: r.aprobacion === 'pendiente'
        ? 'Hemos recibido tu solicitud. El negocio te confirmará la cita.'
        : 'Tu cita está reservada.',
    });
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL ENLACE DEL CLIENTE — /cita/<token>/{huecos,cambiar,anular}  (sin sesión, por LLAVE)
// Se monta junto a las rutas públicas de la pieza 5. Son rutas de DOS segmentos, así que no compiten
// con su `/:token`; y solo actúan sobre citas NACIDAS FUERA (las de dentro devuelven 403 y su enlace
// se comporta exactamente como en la pieza 5).
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function createReservaEnlaceRoutes(db) {
  const app = new Hono();

  // Mismo freno que el enlace de la pieza 5: por IP+negocio, 40/min. El token es la defensa; esto solo
  // corta el barrido de tokens.
  app.use('*', rateLimit({
    windowMs: 60_000, max: 40, keyPrefix: 'cita-link',
    message: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.',
  }));

  // Huecos para reprogramar: los de SU misma persona y SUS mismos servicios, por el motor de siempre.
  app.get('/:token/huecos', c => {
    const cita = resolverCitaPorToken(db, c.req.param('token'));
    if (!cita) return c.json({ error: 'Enlace no válido' }, 403);
    if (!reservaDeCita(db, cita.id)) return c.json({ error: 'Esta cita no se gestiona desde aquí.' }, 403);
    const v = ventanaCliente(db, cita);
    if (!v.puede) return c.json({ error: v.motivo }, 403);
    try {
      const fecha = c.req.query('fecha');
      if (!fecha) return c.json({ huecos: [] });
      const ids = db.prepare('SELECT product_id FROM cita_servicios WHERE cita_id=? ORDER BY orden,id').all(cita.id).map(x => x.product_id);
      const hs = huecosPublicos(db, { fecha, service_ids: ids, user_id: cita.user_id });
      return c.json({ huecos: hs.map(h => ({ min: h.min, hora: h.hora })) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  app.post('/:token/cambiar', async c => {
    const cita = resolverCitaPorToken(db, c.req.param('token'));
    if (!cita) return c.json({ error: 'Enlace no válido' }, 403);
    try {
      const body = await c.req.json();
      const r = cambiarReservaPublica(db, cita.id, body);
      return c.json({ ok: true, ...r, message: 'Cita cambiada' });
    } catch (e) {
      if (e.status === 409) return c.json({ error: safeError(e), huecos: e.huecos || [] }, 409);
      return c.json({ error: safeError(e) }, e.status || 500);
    }
  });

  app.post('/:token/anular', c => {
    const cita = resolverCitaPorToken(db, c.req.param('token'));
    if (!cita) return c.json({ error: 'Enlace no válido' }, 403);
    try {
      anularReservaPublica(db, cita.id);
      return c.json({ ok: true, message: 'Cita anulada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LOS MANDOS DEL DUEÑO — /api/erp/reserva-publica  (candado citas.edit / citas.read)
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function createReservaAdminRoutes(db) {
  const api = new Hono();

  api.get('/ajustes', requirePerm('citas.read'), c => {
    try {
      const pub = ajustesPublicos(db);
      const personas = db.prepare(
        `SELECT u.id, u.name, COALESCE(pp.visible,0) AS visible, COALESCE(pp.nombre_publico,'') AS nombre_publico
           FROM admin_users u LEFT JOIN cita_pub_personas pp ON pp.user_id=u.id
          WHERE u.active=1 ORDER BY u.name`
      ).all().map(p => ({ ...p, visible: !!p.visible }));
      const servicios = db.prepare(
        `SELECT p.id, p.name, COALESCE(sc.reservable,0) AS reservable, COALESCE(sc.publico,0) AS publico,
                sc.duracion_min
           FROM products p LEFT JOIN service_config sc ON sc.product_id=p.id
          WHERE p.type='service' AND (p.status IS NULL OR p.status<>'archived') ORDER BY p.name`
      ).all().map(s => ({ ...s, reservable: !!s.reservable, publico: !!s.publico, configurado: s.duracion_min != null }));
      return c.json({
        ajustes: pub, handle_efectivo: handleEfectivo(db), personas, servicios,
        base_url: citaBaseUrl(c.get('tenant')?.slug),
        consentimiento: textoConsentimiento(ajustesCitas(db).company_name),
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.post('/ajustes', requirePerm('citas.edit'), validate(citaPublicaAjustesSchema), c => {
    try {
      const d = c.get('validated');
      // El handle se normaliza SIEMPRE (el dueño puede teclear "Peluquería Lola"). Vacío = se genera
      // del nombre del negocio al leerlo, así que no se guarda nada inventado.
      const handle = slugHandle(d.cita_pub_handle || '');
      db.transaction(() => {
        db.prepare(
          `UPDATE company_config SET cita_pub_activa=?, cita_pub_handle=?, cita_pub_antelacion_min=?,
             cita_pub_ventana_dias=?, cita_pub_modo=?, cita_pub_retencion_horas=?,
             cita_pub_cancelar_horas=?, cita_pub_cancelar_activo=?, cita_pub_politica=?,
             cita_pub_privacidad_url=? WHERE id=1`
        ).run(
          d.cita_pub_activa ? 1 : 0, handle, d.cita_pub_antelacion_min, d.cita_pub_ventana_dias,
          d.cita_pub_modo, d.cita_pub_retencion_horas, d.cita_pub_cancelar_horas,
          d.cita_pub_cancelar_activo ? 1 : 0, d.cita_pub_politica || '', d.cita_pub_privacidad_url || '',
        );
        // Personas: lo que no venga marcado queda en visible=0. "Por defecto NO" también al guardar.
        const up = db.prepare(
          `INSERT INTO cita_pub_personas (user_id,visible,nombre_publico,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET visible=excluded.visible,
               nombre_publico=excluded.nombre_publico, updated_at=CURRENT_TIMESTAMP`
        );
        for (const p of d.personas) up.run(p.user_id, p.visible ? 1 : 0, (p.nombre_publico || '').trim());
      })();
      logActivity(db, c.get('session'), 'Cambió los ajustes de la reserva por Internet', ENTITY.CITA, 0, '');
      return c.json({ message: 'Ajustes guardados', handle_efectivo: handleEfectivo(db) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Un servicio se abre o se cierra al público de uno en uno. Exige estar configurado como reservable:
  // abrir al público algo sin tiempo definido sería publicar un hueco que el motor no sabe calcular.
  // ── §4 · LAS DOS RESPUESTAS AL AVISO DE QUE SE ENCENDIÓ SOLA ────────────────────────────────────
  // El encargo pide «un interruptor para apagarla en un clic si no la quiere». Un clic es un clic: no
  // vale mandarle a los ajustes a buscar una casilla. Por eso son dos endpoints tontos, sin cuerpo.
  //
  // Las dos echan `cita_pub_auto_visto`: la noticia se da UNA vez y se calla, conteste lo que conteste.
  // Y ninguna toca `cita_pub_auto`, el pestillo: ya estaba echado desde el encendido, y es lo que
  // garantiza que apagarla aquí sea definitivo y no se la vuelva a encontrar abierta mañana.
  api.post('/aviso-encendido/apagar', requirePerm('citas.edit'), c => {
    try {
      db.prepare('UPDATE company_config SET cita_pub_activa=0, cita_pub_auto_visto=1 WHERE id=1').run();
      logActivity(db, c.get('session'), 'Apagó la página de reservas', ENTITY.CITA, 0, 'desde el aviso de encendido automático');
      return c.json({ ok: true, message: 'Página de reservas apagada' });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.post('/aviso-encendido/vale', requirePerm('citas.edit'), c => {
    try {
      db.prepare('UPDATE company_config SET cita_pub_auto_visto=1 WHERE id=1').run();
      return c.json({ ok: true, message: 'De acuerdo, se queda abierta' });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.post('/servicio/:id', requirePerm('citas.edit'), c => {
    try {
      const pid = parseInt(c.req.param('id'), 10);
      const publico = c.req.query('publico') === '1';
      const sc = db.prepare('SELECT product_id, reservable, duracion_min FROM service_config WHERE product_id=?').get(pid);
      if (!sc) return c.json({ error: 'Configura primero el tiempo del servicio (pulsa «Configurar»).' }, 400);
      if (publico && (!sc.reservable || sc.duracion_min == null)) {
        return c.json({ error: 'Este servicio aún no se puede pedir por cita. Márcalo como reservable y dale un tiempo antes de publicarlo.' }, 400);
      }
      db.prepare('UPDATE service_config SET publico=?, updated_at=CURRENT_TIMESTAMP WHERE product_id=?').run(publico ? 1 : 0, pid);
      return c.json({ message: publico ? 'Servicio publicado' : 'Servicio retirado de la página pública' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Modo "YO APRUEBO": la bandeja, aprobar y rechazar.
  api.get('/solicitudes', requirePerm('citas.read'), c => {
    try {
      const filas = db.prepare(
        `SELECT c.id, c.codigo, c.fecha, c.inicio_min, c.user_id, r.email, r.retiene_hasta,
                COALESCE(NULLIF(c.cliente_suelto_nombre,''), cl.name, 'Cliente') AS cliente,
                c.cliente_suelto_movil, u.name AS persona
           FROM cita_reserva_publica r JOIN citas c ON c.id=r.cita_id
           LEFT JOIN clients cl ON cl.id=c.cliente_id
           LEFT JOIN admin_users u ON u.id=c.user_id
          WHERE r.aprobacion='pendiente' AND c.archived=0 AND c.estado<>'anulada'
          ORDER BY c.fecha, c.inicio_min`
      ).all();
      const now = Math.floor(Date.now() / 1000);
      return c.json(filas.map(f => ({
        ...f, hora: hhmm(f.inicio_min),
        servicios: serviciosDeCita(db, f.id).join(' + '),
        horas_restantes: f.retiene_hasta == null ? null : Math.max(0, Math.round((f.retiene_hasta - now) / 3600)),
      })));
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.post('/solicitudes/:id/aprobar', requirePerm('citas.edit'), c => {
    try {
      const r = aprobarReserva(db, parseInt(c.req.param('id'), 10));
      logActivity(db, c.get('session'), 'Aprobó una reserva por Internet', ENTITY.CITA, r.id, '');
      return c.json({ message: 'Cita confirmada', ...r });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/solicitudes/:id/rechazar', requirePerm('citas.edit'), c => {
    try {
      const r = rechazarReserva(db, parseInt(c.req.param('id'), 10));
      logActivity(db, c.get('session'), 'Rechazó una reserva por Internet', ENTITY.CITA, r.id, '');
      return c.json({ message: 'Solicitud rechazada y hueco liberado', ...r });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  // Barrido de caducidad a demanda (el cron lo llama por su lado). Idempotente.
  api.post('/caducar', requirePerm('citas.edit'), c => {
    try { return c.json({ caducadas: caducarReservasPendientes(db) }); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  return api;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA PANTALLA PÚBLICA (primero móvil, mismo idioma visual que la página de la cita de la pieza 5)
// ════════════════════════════════════════════════════════════════════════════════════════════════
function estilos() {
  return `
    :root{color-scheme:light dark}
    *{box-sizing:border-box}
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:1.25rem 1rem 3rem}
    @media (prefers-color-scheme:dark){
      body{background:#0f172a;color:#e2e8f0}
      .card{background:#1e293b !important;border-color:#334155 !important}
      .opt{background:#1e293b !important;border-color:#334155 !important}
      input,select,textarea{background:#0f172a !important;color:#e2e8f0 !important;border-color:#334155 !important}
      .row{border-color:#334155 !important}
    }
    .wrap{max-width:520px;margin:0 auto}
    h1{font-size:1.3rem;margin:.2rem 0}
    h2{font-size:1rem;margin:0 0 .75rem}
    .muted{color:#64748b;font-size:.9rem;line-height:1.5}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:1.25rem;margin:1rem 0;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    .row{display:flex;justify-content:space-between;gap:.75rem;padding:.5rem 0;border-bottom:1px solid #e2e8f0}
    .row:last-child{border-bottom:0}.row b{font-weight:600;text-align:right}
    .btn{display:block;width:100%;text-align:center;padding:.9rem;border-radius:12px;border:0;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.75rem;font-family:inherit}
    .ok{background:#16a34a;color:#fff}
    .sec{background:transparent;color:#1d4ed8;border:1px solid #1d4ed8}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    /* Las opciones son BOTONES grandes, no una lista: en un móvil se pulsan con el pulgar. */
    .opt{display:flex;justify-content:space-between;align-items:center;gap:.75rem;width:100%;text-align:left;
         background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:.85rem 1rem;margin-bottom:.5rem;
         font-size:1rem;font-family:inherit;color:inherit;cursor:pointer;min-height:52px}
    .opt[aria-pressed=true]{border-color:#1d4ed8;box-shadow:0 0 0 2px rgba(29,78,216,.25)}
    .opt small{display:block;color:#64748b;font-size:.8rem;margin-top:.15rem}
    .opt .pr{font-weight:700;white-space:nowrap}
    .horas{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:.5rem}
    .hora{padding:.75rem .25rem;border:1px solid #e2e8f0;border-radius:10px;background:#fff;font-size:1rem;
          font-family:inherit;color:inherit;cursor:pointer;min-height:48px}
    .hora[aria-pressed=true]{border-color:#1d4ed8;background:#1d4ed8;color:#fff}
    @media (prefers-color-scheme:dark){.hora{background:#1e293b;border-color:#334155}}
    label.f{display:block;font-size:.85rem;font-weight:600;margin:.85rem 0 .3rem}
    input,select,textarea{width:100%;padding:.8rem;border-radius:10px;border:1px solid #cbd5e1;font-size:1rem;
      font-family:inherit;background:#fff;color:#0f172a}
    textarea{min-height:70px;resize:vertical}
    .chk{display:flex;gap:.6rem;align-items:flex-start;margin-top:1rem;font-size:.85rem;line-height:1.5}
    .chk input{width:auto;flex:0 0 auto;margin-top:.15rem;min-width:20px;min-height:20px}
    .pol{font-size:.85rem;line-height:1.55;white-space:pre-wrap;background:rgba(100,116,139,.1);padding:.8rem;border-radius:10px;margin-top:.75rem}
    .pol b{display:block;margin-bottom:.3rem;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
    .pasos{display:flex;gap:.35rem;margin:.75rem 0 0}
    .paso{flex:1;height:4px;border-radius:2px;background:#cbd5e1}
    .paso.on{background:#1d4ed8}
    .err{display:none;background:#fee2e2;color:#991b1b;padding:.8rem;border-radius:10px;margin-top:.75rem;font-size:.9rem;line-height:1.5}
    .fin{background:#dcfce7;color:#166534;padding:1rem;border-radius:12px;text-align:center;font-weight:600;line-height:1.5}
    .vacio{color:#64748b;font-size:.9rem;padding:.5rem 0}
    /* El campo trampa: fuera de la vista Y fuera del recorrido del teclado. Un lector de pantalla
       tampoco lo anuncia (aria-hidden en el contenedor). Un bot que rellena "todo" cae aquí. */
    .trampa{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  `;
}

function paginaPuertaCerrada() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>No encontrado</title><style>${estilos()}</style></head>
    <body><div class="wrap"><div class="card" style="text-align:center">
      <h1>No encontrado</h1>
      <p class="muted">Esta página no existe o ya no está disponible.</p>
    </div></div></body></html>`;
}

function paginaReserva(db, c) {
  const aj = ajustesCitas(db);
  const pub = ajustesPublicos(db);
  const handle = handleEfectivo(db);
  const servicios = serviciosPublicos(db);
  const nonce = c.get('cspNonce') || '';
  // Todo lo que el navegador necesita va en UN bloque JSON escapado para <script> (jsonForScript:
  // sin eso, un nombre de servicio con "</script>" cerraría la etiqueta — la lección de C4a).
  const datos = {
    handle,
    empresa: aj.company_name,
    servicios,
    simbolo: aj.currency_symbol,
    politica: pub.politica,
    privacidad_url: pub.privacidad_url,
    consentimiento: textoConsentimiento(aj.company_name),
    modo: pub.modo,
    ventana_dias: pub.ventana_dias,
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Pedir cita — ${E(aj.company_name)}</title>
    <meta name="robots" content="noindex">
    <style>${estilos()}</style></head>
    <body><div class="wrap">
      <h1>Pedir cita en ${E(aj.company_name)}</h1>
      <div class="muted">${aj.address ? E(aj.address) : 'Elige el servicio, con quién y cuándo.'}</div>
      <div class="pasos" id="pasos"><i class="paso on"></i><i class="paso"></i><i class="paso"></i><i class="paso"></i></div>

      <div class="card" id="p1">
        <h2>1 · ¿Qué necesitas?</h2>
        <div id="listaServicios">${servicios.length ? '' : '<div class="vacio">Ahora mismo no hay servicios disponibles para pedir por Internet.</div>'}</div>
        <button class="btn ok" id="a2" disabled>Continuar</button>
      </div>

      <div class="card" id="p2" style="display:none">
        <h2>2 · ¿Con quién?</h2>
        <div id="listaPersonas"></div>
        <button class="btn ok" id="a3" disabled>Continuar</button>
        <button class="btn sec" data-volver="1">Atrás</button>
      </div>

      <div class="card" id="p3" style="display:none">
        <h2>3 · ¿Qué día y a qué hora?</h2>
        <label class="f" for="fecha">Día</label>
        <input type="date" id="fecha">
        <div id="listaHoras" class="horas" style="margin-top:.75rem"></div>
        <div id="avisoHoras" class="vacio"></div>
        <button class="btn ok" id="a4" disabled>Continuar</button>
        <button class="btn sec" data-volver="2">Atrás</button>
      </div>

      <div class="card" id="p4" style="display:none">
        <h2>4 · Tus datos</h2>
        <div id="resumen"></div>
        <label class="f" for="nombre">Nombre y apellidos *</label>
        <input id="nombre" autocomplete="name" maxlength="120">
        <label class="f" for="movil">Móvil</label>
        <input id="movil" type="tel" autocomplete="tel" maxlength="30" placeholder="+34 600 000 000">
        <label class="f" for="email">Email</label>
        <input id="email" type="email" autocomplete="email" maxlength="200">
        <label class="f" for="nota">¿Algo que debamos saber?</label>
        <textarea id="nota" maxlength="500"></textarea>
        <div class="trampa" aria-hidden="true"><label for="apellido_2">No rellenar</label><input id="apellido_2" tabindex="-1" autocomplete="off"></div>
        ${pub.politica ? `<div class="pol"><b>Política de cancelación</b>${E(pub.politica)}</div>` : ''}
        <div class="chk">
          <input type="checkbox" id="consent">
          <label for="consent">${E(datos.consentimiento)}${pub.privacidad_url
            ? ` <a href="${E(pub.privacidad_url)}" target="_blank" rel="noopener noreferrer">Ver la política de privacidad</a>.` : ''}</label>
        </div>
        <div class="err" id="err"></div>
        <button class="btn ok" id="enviar">Confirmar la cita</button>
        <button class="btn sec" data-volver="3">Atrás</button>
      </div>

      <div class="card" id="pFin" style="display:none"><div class="fin" id="finTexto"></div>
        <a class="btn sec" id="finEnlace" href="#">Ver mi cita</a></div>

      <script nonce="${E(nonce)}">
      (function(){
        var D = ${jsonForScript(datos)};
        var el = function(id){ return document.getElementById(id); };
        var sel = { servicios: [], user_id: null, fecha: '', inicio_min: null, personaNombre: '' };

        function paso(n){
          [1,2,3,4].forEach(function(i){ el('p'+i).style.display = (i===n?'':'none'); });
          el('pFin').style.display='none';
          var barras = el('pasos').children;
          for(var i=0;i<barras.length;i++) barras[i].className = 'paso' + (i < n ? ' on' : '');
          window.scrollTo(0,0);
        }
        function dinero(v){ return v.toFixed(2).replace('.', ',') + ' ' + D.simbolo; }

        // ── Paso 1: servicios (varios, si el motor los encadena — y los encadena) ──
        var cont = el('listaServicios');
        D.servicios.forEach(function(s){
          var b = document.createElement('button');
          b.type='button'; b.className='opt'; b.setAttribute('aria-pressed','false');
          var izq = document.createElement('span');
          izq.appendChild(document.createTextNode(s.nombre));
          var sm = document.createElement('small');
          sm.textContent = s.duracion_min + ' min · IVA ' + s.iva_pct + '% incluido';
          izq.appendChild(sm);
          var pr = document.createElement('span'); pr.className='pr'; pr.textContent = dinero(s.precio_total);
          b.appendChild(izq); b.appendChild(pr);
          b.addEventListener('click', function(){
            var i = sel.servicios.indexOf(s.id);
            if(i>=0){ sel.servicios.splice(i,1); b.setAttribute('aria-pressed','false'); }
            else { sel.servicios.push(s.id); b.setAttribute('aria-pressed','true'); }
            el('a2').disabled = sel.servicios.length===0;
          });
          cont.appendChild(b);
        });

        el('a2').addEventListener('click', async function(){
          paso(2);
          var lista = el('listaPersonas'); lista.textContent='Cargando…';
          try{
            var r = await fetch('/reservar/'+D.handle+'/personas?service_ids='+sel.servicios.join(','));
            var d = await r.json();
            if(!r.ok) throw new Error(d.error||'Error');
            lista.textContent='';
            var opciones = [{id:null, nombre:'Cualquiera disponible'}].concat(d.personas||[]);
            if(!d.personas || !d.personas.length){
              lista.appendChild(document.createTextNode(''));
              var v = document.createElement('div'); v.className='vacio';
              v.textContent='Ahora mismo no hay nadie disponible para eso. Prueba con otro servicio.';
              lista.appendChild(v); el('a3').disabled = true; return;
            }
            opciones.forEach(function(p){
              var b = document.createElement('button');
              b.type='button'; b.className='opt'; b.setAttribute('aria-pressed','false');
              b.textContent = p.nombre;
              b.addEventListener('click', function(){
                sel.user_id = p.id; sel.personaNombre = p.nombre;
                Array.prototype.forEach.call(lista.children, function(o){ if(o.setAttribute) o.setAttribute('aria-pressed','false'); });
                b.setAttribute('aria-pressed','true');
                el('a3').disabled = false;
              });
              lista.appendChild(b);
            });
          }catch(e){ lista.textContent = 'No hemos podido cargar los profesionales.'; }
        });

        el('a3').addEventListener('click', function(){
          paso(3);
          var hoy = new Date(); var f = el('fecha');
          f.min = hoy.toISOString().slice(0,10);
          f.max = new Date(hoy.getTime() + D.ventana_dias*86400000).toISOString().slice(0,10);
          if(!f.value) f.value = f.min;
          cargarHoras();
        });

        async function cargarHoras(){
          var caja = el('listaHoras'), aviso = el('avisoHoras');
          caja.textContent=''; aviso.textContent='Buscando huecos…';
          sel.inicio_min = null; el('a4').disabled = true;
          sel.fecha = el('fecha').value;
          if(!sel.fecha){ aviso.textContent='Elige un día.'; return; }
          try{
            var u = '/reservar/'+D.handle+'/huecos?fecha='+encodeURIComponent(sel.fecha)+'&service_ids='+sel.servicios.join(',');
            if(sel.user_id) u += '&user_id='+sel.user_id;
            var r = await fetch(u); var d = await r.json();
            if(!r.ok) throw new Error(d.error||'Error');
            if(!d.huecos || !d.huecos.length){ aviso.textContent='Ese día no queda ningún hueco. Prueba con otro.'; return; }
            aviso.textContent='';
            d.huecos.forEach(function(h){
              var b = document.createElement('button');
              b.type='button'; b.className='hora'; b.setAttribute('aria-pressed','false'); b.textContent = h.hora;
              b.addEventListener('click', function(){
                sel.inicio_min = h.min;
                Array.prototype.forEach.call(caja.children, function(o){ o.setAttribute('aria-pressed','false'); });
                b.setAttribute('aria-pressed','true');
                el('a4').disabled = false;
              });
              caja.appendChild(b);
            });
          }catch(e){ aviso.textContent='No hemos podido cargar las horas. Inténtalo de nuevo.'; }
        }
        el('fecha').addEventListener('change', cargarHoras);

        el('a4').addEventListener('click', function(){
          paso(4);
          var res = el('resumen'); res.textContent='';
          var nombres = D.servicios.filter(function(s){ return sel.servicios.indexOf(s.id)>=0; });
          var total = nombres.reduce(function(a,s){ return a + s.precio_total; }, 0);
          var filas = [
            ['Servicio', nombres.map(function(s){return s.nombre;}).join(' + ')],
            ['Con', sel.personaNombre || 'Cualquiera disponible'],
            ['Día', sel.fecha],
            ['Hora', (function(){ var m=sel.inicio_min; var h=Math.floor(m/60), mm=m%60; return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm; })()],
            ['Total (IVA incluido)', dinero(total)],
          ];
          filas.forEach(function(f){
            var d1 = document.createElement('div'); d1.className='row';
            var s1 = document.createElement('span'); s1.className='muted'; s1.textContent=f[0];
            var b1 = document.createElement('b'); b1.textContent=f[1];
            d1.appendChild(s1); d1.appendChild(b1); res.appendChild(d1);
          });
        });

        Array.prototype.forEach.call(document.querySelectorAll('[data-volver]'), function(b){
          b.addEventListener('click', function(){ paso(parseInt(b.getAttribute('data-volver'),10)); });
        });

        el('enviar').addEventListener('click', async function(){
          var err = el('err'); err.style.display='none';
          var falla = function(m){ err.textContent=m; err.style.display='block'; window.scrollTo(0,document.body.scrollHeight); };
          if(!el('nombre').value.trim()) return falla('Dinos tu nombre.');
          if(!el('movil').value.trim() && !el('email').value.trim()) return falla('Déjanos un móvil o un email para poder avisarte.');
          if(!el('consent').checked) return falla('Marca la casilla de consentimiento para poder reservar.');
          el('enviar').disabled = true;
          try{
            var body = {
              service_ids: sel.servicios, user_id: sel.user_id, fecha: sel.fecha, inicio_min: sel.inicio_min,
              nombre: el('nombre').value.trim(), movil: el('movil').value.trim(), email: el('email').value.trim(),
              nota: el('nota').value.trim(), consent: el('consent').checked, trampa: el('apellido_2').value,
            };
            var r = await fetch('/reservar/'+D.handle+'/reservar', {
              method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body),
            });
            var d = await r.json();
            if(!r.ok){
              el('enviar').disabled = false;
              var extra = (d.huecos && d.huecos.length) ? ' Huecos cerca: ' + d.huecos.map(function(h){return h.hora;}).join(', ') + '.' : '';
              if(r.status===409){ falla((d.error||'Ese hueco ya no está libre.') + extra); paso(3); cargarHoras(); return; }
              return falla((d.error||'No hemos podido reservar.') + extra);
            }
            [1,2,3,4].forEach(function(i){ el('p'+i).style.display='none'; });
            el('pFin').style.display='';
            el('finTexto').textContent = d.message + (d.codigo ? ' (referencia ' + d.codigo + ')' : '');
            el('finEnlace').href = d.enlace;
            var barras = el('pasos').children;
            for(var i=0;i<barras.length;i++) barras[i].className='paso on';
            window.scrollTo(0,0);
          }catch(e){ el('enviar').disabled=false; falla('No hemos podido reservar. Inténtalo de nuevo.'); }
        });
      })();
      </script>
    </div></body></html>`;
}
