import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, configNegocioHTML } from '../layout.js';
// LA SECCIÓN DE CITAS DE ESTA PANTALLA NO SE ESCRIBE AQUÍ. Su lista vive en menu.js, que es la
// misma de la que comen el buscador y las anclas. Escribirla a mano aquí sería la segunda lista
// que la cabecera de menu.js lleva meses prohibiendo: el día que cambie una, la otra miente.
import { menuDeUsuario } from '../menu.js';
import { requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { companySchema, storeSettingsSchema } from '../schemas.js';
import { getCountryConfig } from '../../../core/control-db.js';
import {
  CATALOGO, TONO_UNICO, esTonoValido, plantillaEnVigor, plantillaDeFabrica,
  renderPlantilla, htmlAtexto, revisarPlantilla,
} from '../email-templates.js';
// PASO 8 — PERFIL DE OFICIO. Se cambia desde aquí ("los ajustes del negocio"). El módulo es HOJA; el
// creador de productos se le pasa como argumento (ver el porqué en modules/erp/oficios.js).
import { OFICIOS, oficioDe, fijarOficio, serviciosQueFaltan, sembrarCatalogo } from '../oficios.js';
import { createProductSvc } from './products.js';
// AVISOS Y CORREOS. La preferencia por persona y los interruptores del negocio; el parte lo redacta
// parte-diario.js y los permisos los resuelve avisos.js — aquí no se calcula ninguna de las dos cosas.
import {
  getPref, setPref, FRECUENCIAS, DIAS,
  CORREOS, CORREOS_SIN_INTERRUPTOR, correoActivo, correoBloqueado, setCorreoActivo,
} from '../avisos-preferencias.js';
import { lineas, parteDelDia } from '../parte-diario.js';
import { permisosDeUsuario, puedeDe } from '../avisos.js';
import { sendEmail } from '../../../core/mailer.js';
import { MODOS, MODO_POR_DEFECTO, modoDeEmpresa, setModoDeEmpresa, marcarModoPreguntado } from '../margen.js';

export function createSettingsRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();
  const storeViews = new Hono();

  // ── API: COMPANY ───────────────────────────────────────────────
  api.get('/company', requirePerm('company.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM company_config WHERE id=1').get()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── API: OFICIO (PASO 8) ───────────────────────────────────────
  // El oficio hace DOS cosas y solo dos: cambia palabras de pantalla y precarga servicios. Aquí no se
  // enciende ni se apaga nada, y el motor de citas ni se entera.
  api.get('/oficio', requirePerm('company.read'), c => {
    try {
      const actual = oficioDe(db);
      return c.json({
        oficio: actual,
        oficios: OFICIOS.map(o => ({ id: o.id, label: o.label, servicios: o.servicios.length })),
        faltan: serviciosQueFaltan(db, actual),
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Cambiar de oficio. NO siembra: solo cambia las palabras y dice qué servicios faltarían. Sembrar es
  // un segundo botón, a propósito — cambiar cómo se llaman las cosas no debe crearte productos de golpe.
  api.put('/oficio', requirePerm('company.update'), c => {
    return c.req.json().then(body => {
      try {
        const fijado = fijarOficio(db, body?.oficio);   // normaliza: lo que no sea de los seis → 'otro'
        return c.json({ ok: true, oficio: fijado, faltan: serviciosQueFaltan(db, fijado) });
      } catch (e) { return c.json({ error: safeError(e) }, 500); }
    }).catch(() => c.json({ error: 'Petición inválida.' }, 400));
  });

  // Añadir SOLO los que falten. Nunca borra, nunca pisa, nunca archiva: lo que el negocio ya tenga
  // —creado por él o sembrado y luego editado— se queda exactamente como está. Idempotente.
  api.post('/oficio/sembrar', requirePerm('company.update'), c => {
    try {
      const actual = oficioDe(db);
      const creados = sembrarCatalogo(db, actual, createProductSvc);
      return c.json({ ok: true, creados, faltan: serviciosQueFaltan(db, actual) });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── G2 · CÓMO CALCULO MI MARGEN ──────────────────────────────────────────────────────────────
  // Decide qué porcentaje manda como TITULAR en todas las pantallas. No recalcula nada ni reescribe
  // ningún dato: las dos cifras se calculan siempre, y esto solo elige cuál se enseña primero.
  // Por eso cambiarlo se ve al instante en todas partes y volver atrás no cuesta nada.
  //
  // CONTABILIDAD Y P&G NO OBEDECEN A ESTO (R1): ahí manda «sobre la venta», elija lo que elija el
  // dueño, y la pantalla lo dice. Un resultado contable no cambia de definición por una preferencia.
  api.get('/margen', requirePerm('company.read'), c =>
    c.json({ modo: modoDeEmpresa(db), por_defecto: MODO_POR_DEFECTO, modos: MODOS }));

  // G4 · la respuesta del paso del alta. Tres salidas y las tres TERMINAN el paso: elegir A,
  // elegir B y SALTAR. Saltar no escribe el modo —la ausencia ya vale «sobre la venta»— y solo
  // apunta que se preguntó, así que «no contestó» y «contestó venta» siguen siendo distinguibles.
  // No bloquea el alta jamás: si esto falla, la pantalla lo dice y el paso se queda ahí.
  api.post('/margen/alta', requirePerm('company.update'), async c => {
    try {
      const d = await c.req.json();
      if (d && d.saltar) { marcarModoPreguntado(db); return c.json({ ok: true, modo: MODO_POR_DEFECTO, saltado: true }); }
      if (!MODOS[d?.modo]) return c.json({ error: 'Modo desconocido' }, 400);
      setModoDeEmpresa(db, d.modo);
      return c.json({ ok: true, modo: d.modo });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.put('/margen', requirePerm('company.update'), async c => {
    try {
      const { modo } = await c.req.json();
      if (!MODOS[modo]) return c.json({ error: 'Modo desconocido' }, 400);
      setModoDeEmpresa(db, modo);
      return c.json({ ok: true, modo });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.put('/company', requirePerm('company.update'), validate(companySchema), async c => {
    try {
      const d = c.get('validated');
      // A1 (Eje C) — CANDADO del NIF: el NIF de la empresa es el EMISOR de la cadena legal de Verifactu.
      // Si ya se ha emitido alguna factura con registro Verifactu, cambiarlo cruzaría la cadena (corrupción
      // legal irreparable). Se bloquea con un mensaje claro. Decisión de producto: se bloquea, no se avisa.
      const cur = db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get() || {};
      if ((d.fiscal_id || '') !== (cur.fiscal_id || '') && db.prepare('SELECT 1 FROM verifactu_registros LIMIT 1').get()) {
        return c.json({ error: 'No puedes cambiar el NIF de la empresa: ya has emitido facturas con registro Verifactu, y el NIF es el emisor de la cadena legal firmada (no se puede reescribir). Si el NIF está mal, no emitas más facturas y contacta con soporte.' }, 409);
      }
      // postal_code/city/province: dirección fiscal estructurada que exige Facturae. Sin ellos,
      // ninguna factura de este negocio puede exportarse (el emisor también va con dirección completa).
      // D5 — dias_recordatorio_impago: umbral para las propuestas de DISA. Si no viene, se conserva
      // el valor actual (COALESCE con lo guardado), no se pisa con el defecto.
      const diasProp = (d.dias_recordatorio_impago === '' || d.dias_recordatorio_impago == null)
        ? null : Math.max(0, Math.min(365, Math.floor(Number(d.dias_recordatorio_impago) || 0)));
      // D5b — dias_aviso_pago: hermano del anterior, días ANTES del vencimiento para proponer el pago
      // a un proveedor. Mismo trato: si no viene, se conserva lo guardado.
      const diasPago = (d.dias_aviso_pago === '' || d.dias_aviso_pago == null)
        ? null : Math.max(0, Math.min(365, Math.floor(Number(d.dias_aviso_pago) || 0)));
      db.prepare('UPDATE company_config SET company_name=?,fiscal_id=?,tax_rate=?,logo_url=?,address=?,postal_code=?,city=?,province=?,phone=?,email=?,website=?,country=?,currency=?,currency_symbol=?,tax_name=?,fiscal_id_label=?,document_name=?,irpf_default=?,dias_recordatorio_impago=COALESCE(?,dias_recordatorio_impago),dias_aviso_pago=COALESCE(?,dias_aviso_pago) WHERE id=1').run(d.company_name||'', d.fiscal_id||'', parseFloat(d.tax_rate)||0, d.logo_url||'', d.address||'', d.postal_code||'', d.city||'', d.province||'', d.phone||'', d.email||'', d.website||'', d.country||'ES', d.currency||'EUR', d.currency_symbol||sym, d.tax_name||'IVA', d.fiscal_id_label||'NIF/CIF', d.document_name||'Factura', parseFloat(d.irpf_default)||0, diasProp, diasPago);
      return c.json({message:'Guardado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── API: SITUACIÓN FISCAL (fiscal_profile) ─────────────────────
  // QUÉ modelos presenta este negocio: la FUENTE DE VERDAD de la que DISA deriva los vencimientos
  // fiscales (calendario-fiscal.js → modelosDeclarados). Mismo candado que el resto de Ajustes:
  // `company.read` para mirar, `company.update` para declarar. Fuera de WRITABLE_TABLES a propósito:
  // solo el dueño declara su situación; DISA nunca se la escribe a sí misma.
  api.get('/fiscal-profile', requirePerm('company.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM fiscal_profile WHERE id=1').get() || {}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.put('/fiscal-profile', requirePerm('company.update'), async c => {
    try {
      const d = await c.req.json();
      const b = v => (v === true || v === 1 || v === '1' || v === 'on') ? 1 : 0;
      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      const now = new Date().toISOString();
      // configured_at se SELLA la primera vez (COALESCE): a partir de ahí deja de ser NULL. Es lo que
      // distingue "nunca declaró" (no se le propone nada, ni con actividad) de "declaró que no presenta".
      db.prepare(`UPDATE fiscal_profile SET
          presenta_iva=?, presenta_irpf_directa=?, tiene_retenciones_trabajo=?, tiene_retenciones_alquiler=?,
          situacion_especial=?, no_cubierto=?,
          configured_at=COALESCE(configured_at, ?), updated_at=?, updated_by=?
        WHERE id=1`)
        .run(b(d.presenta_iva), b(d.presenta_irpf_directa), b(d.tiene_retenciones_trabajo),
             b(d.tiene_retenciones_alquiler), b(d.situacion_especial),
             String(d.no_cubierto || '').slice(0, 2000), now, now, String(quien));
      return c.json({ message: 'Guardado' });
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── API: STORE — D2: editor "Tienda Online" DESMONTADO. Endpoints neutralizados (404).
  // store_settings SE CONSERVA (NO se archiva): el diseño se guarda por si la tienda vuelve (Capa 2).
  // El cuerpo original queda inalcanzable debajo (return temprano), no se borra.
  api.get('/store', requirePerm('store_settings.read'), c => {
    return c.json({ error: 'Editor de tienda desmontado (D2)' }, 404);
    try { return c.json(db.prepare('SELECT * FROM store_settings WHERE id=1').get()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.put('/store', requirePerm('store_settings.update'), validate(storeSettingsSchema), async c => {
    return c.json({ error: 'Editor de tienda desmontado (D2)' }, 404);
    try {
      const d = c.get('validated');
      db.prepare('UPDATE store_settings SET store_name=?,tagline=?,logo_url=?,banner_url=?,primary_color=?,announcement=?,facebook_url=?,instagram_url=?,twitter_url=?,terms_html=?,privacy_html=?,returns_html=?,seo_title=?,seo_description=?,theme=?,homepage_sections=? WHERE id=1').run(d.store_name||'', d.tagline||'', d.logo_url||'', d.banner_url||'', d.primary_color||'#10b981', d.announcement||'', d.facebook_url||'', d.instagram_url||'', d.twitter_url||'', d.terms_html||'', d.privacy_html||'', d.returns_html||'', d.seo_title||'', d.seo_description||'', d.theme||'minimal_light', d.homepage_sections||null);
      return c.json({message:'Guardado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── VIEW: COMPANY SETTINGS ─────────────────────────────────────
  // Aquí abajo vivía una tarjeta "Seguridad de tu cuenta" que enlazaba /admin/setup-2fa.
  // Retirada: el 2FA es seguridad PERSONAL del usuario, no configuración de la EMPRESA, y estaba
  // duplicado con /admin/security. Su único sitio es ahora /admin/perfil.
  // ══ PLANTILLAS DE EMAIL ════════════════════════════════════════════════════
  //
  // Mismo permiso que el resto de Ajustes: `company.read` para mirar, `company.update` para tocar.
  // Los de SISTEMA no aflojan el permiso — al revés: son los más sensibles (llevan los enlaces con
  // los que alguien entra en su cuenta), así que van con el mismo candado y con bloqueo duro.
  //
  // La plantilla de FÁBRICA vive en el código y no se puede perder. Esta tabla solo guarda ediciones,
  // así que "volver al original" es borrar la fila. Nada que restaurar, nada que se pueda corromper.

  // El catálogo entero, agrupado por familia, con el estado de cada plantilla (editada o de fábrica).
  api.get('/email-templates', requirePerm('company.read'), c => {
    try {
      const editadas = new Set(db.prepare('SELECT tipo, tono FROM email_templates').all().map(r => r.tipo + '|' + r.tono));
      const out = { cliente: [], sistema: [] };
      for (const [id, t] of Object.entries(CATALOGO)) {
        const variantes = (t.tonos || [{ clave: TONO_UNICO, label: null }]).map(v => ({
          tono: v.clave, label: v.label, editada: editadas.has(id + '|' + v.clave),
        }));
        out[t.familia].push({
          tipo: id, label: t.label, descripcion: t.descripcion, familia: t.familia,
          huecos: t.huecos, criticos: t.criticos || [], requeridos: t.requeridos || [],
          variantes,
        });
      }
      return c.json(out);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Una plantilla concreta: la EN VIGOR (editada o de fábrica) + la de fábrica, para poder comparar.
  api.get('/email-templates/:tipo/:tono', requirePerm('company.read'), c => {
    try {
      const { tipo, tono } = c.req.param();
      if (!esTonoValido(tipo, tono)) return c.json({ error: 'Plantilla desconocida' }, 404);
      const vigor = plantillaEnVigor(db, tipo, tono);
      const fab = plantillaDeFabrica(tipo, tono);
      const t = CATALOGO[tipo];
      return c.json({
        tipo, tono, familia: t.familia, label: t.label,
        subject: vigor.subject, html: vigor.html, editada: vigor.editada,
        fabrica: { subject: fab.subject, html: fab.html },
        huecos: t.huecos, criticos: t.criticos || [], requeridos: t.requeridos || [],
        motivoCritico: t.motivoCritico || null,
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // VISTA PREVIA con datos de ejemplo. Nunca con datos reales de un cliente: una previsualización no
  // es una excusa para sacar la ficha de nadie por una API de Ajustes.
  api.post('/email-templates/:tipo/:tono/preview', requirePerm('company.read'), async c => {
    try {
      const { tipo, tono } = c.req.param();
      if (!esTonoValido(tipo, tono)) return c.json({ error: 'Plantilla desconocida' }, 404);
      const body = await c.req.json().catch(() => ({}));
      const t = CATALOGO[tipo];
      const p = (body.subject != null || body.html != null)
        ? { subject: String(body.subject || ''), html: String(body.html || '') }   // lo que tiene delante, sin guardar
        : plantillaEnVigor(db, tipo, tono);
      const html = renderPlantilla(p.html, t.ejemplo, { html: true });
      return c.json({
        subject: renderPlantilla(p.subject, t.ejemplo, { html: false }),
        html,
        text: htmlAtexto(html),
        revision: revisarPlantilla(tipo, p),
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // AVISOS Y CORREOS — dos bloques, dos candados distintos, y la diferencia importa.
  //
  // BLOQUE 1 (mi resumen) va SIN `requirePerm`. Es deliberado y es el corazón del encargo: el resto
  // de Ajustes exige `company.read`, que en la práctica significa dueño o administrador (`company`
  // ni siquiera existe en la tabla `permissions`, así que un empleado nunca pasa). Si esta parte
  // llevara ese candado, un empleado no podría apagar SU PROPIO correo ni usar el enlace del pie —
  // el correo que recibe él, en su bandeja. Eso no es un ajuste del negocio: es su bandeja.
  // Cada endpoint solo toca las filas del usuario de la sesión; nadie puede leer ni cambiar la
  // preferencia de otro, porque el id NO viaja en la petición: se toma de la sesión.
  //
  // BLOQUE 2 (los correos a clientes) sí es del negocio → `company.read` para mirar, y
  // `company.update` para tocar, como el resto de Ajustes.
  // ════════════════════════════════════════════════════════════════════════════════════════════

  api.get('/avisos/mias', c => {
    try {
      const userId = c.get('session')?.userId;
      const { role, perms } = permisosDeUsuario(db, userId);
      const puede = puedeDe({ role, perms });
      const pref = getPref(db, userId);
      // Solo se le enseñan las fuentes que puede ver: una casilla de algo que tiene prohibido sería
      // ofrecerle recibir por correo lo que la pantalla le niega.
      const mias = lineas().filter(l => puede(l.perm));
      const marcada = id => !pref.fuentes.length || pref.fuentes.includes(id);
      return c.json({
        pref: { activo: pref.activo, frecuencia: pref.frecuencia, dia_semana: pref.dia_semana, hora: pref.hora },
        lineas: mias.map(l => ({ id: l.id, label: l.label, marcada: marcada(l.id) })),
        email: db.prepare('SELECT email FROM admin_users WHERE id=?').get(userId)?.email || '',
        frecuencias: FRECUENCIAS, dias: DIAS,
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.put('/avisos/mias', async c => {
    try {
      const userId = c.get('session')?.userId;
      const body = await c.req.json().catch(() => ({}));
      const pref = setPref(db, userId, body);
      return c.json({ ok: true, pref });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // Cómo se vería HOY su parte. Sirve para que la pantalla no sea un formulario a ciegas: se ve el
  // resultado de las casillas antes de guardar nada. Y enseña el veredicto de la regla innegociable
  // ("hoy no habría correo"), calculado por el MISMO `parteDelDia` que decide el envío de verdad.
  api.get('/avisos/mi-parte', c => {
    try {
      const userId = c.get('session')?.userId;
      const { role, perms } = permisosDeUsuario(db, userId);
      const pref = getPref(db, userId);
      const sym = db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€';
      const parte = parteDelDia(db, { puede: puedeDe({ role, perms }), elegidas: pref.fuentes, sym });
      return c.json({ n: parte.n, titular: parte.titular, frases: parte.frases.map(f => ({ texto: f.texto, enlace: f.enlace })) });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── BLOQUE 2 · los correos que el negocio manda a sus clientes ─────────────────────────────────
  api.get('/avisos/correos', requirePerm('company.read'), c => {
    try {
      return c.json({
        correos: CORREOS.map(x => ({
          ...x,
          label: CATALOGO[x.tipo]?.label || x.tipo,
          descripcion: CATALOGO[x.tipo]?.descripcion || '',
          activo: correoActivo(db, x.tipo),
          bloqueo: correoBloqueado(db, x.tipo),
        })),
        sinInterruptor: CORREOS_SIN_INTERRUPTOR.map(x => ({ ...x, label: CATALOGO[x.tipo]?.label || x.tipo })),
        puedeEditar: can(c, 'company.update'),
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.put('/avisos/correos/:tipo', requirePerm('company.update'), async c => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const activo = setCorreoActivo(db, c.req.param('tipo'), !!body.activo, c.get('session')?.userId || null);
      return c.json({ ok: true, activo });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // "MÁNDAME UNA PRUEBA A MÍ" — a la dirección de QUIEN PULSA, sacada de la sesión, nunca de la
  // petición: si el destinatario viajara en el body, esto sería un formulario para mandar correo a
  // quien quisieras desde el dominio del negocio. Y con los datos de EJEMPLO de la plantilla, jamás
  // con los de un cliente real.
  api.post('/avisos/correos/:tipo/prueba', requirePerm('company.read'), async c => {
    try {
      const tipo = c.req.param('tipo');
      const t = CATALOGO[tipo];
      if (!t) return c.json({ error: 'Ese correo no existe' }, 404);
      const userId = c.get('session')?.userId;
      const yo = db.prepare('SELECT email, name FROM admin_users WHERE id=?').get(userId);
      const destino = String(yo?.email || '').trim();
      if (!destino) return c.json({ error: 'Tu usuario no tiene una dirección de correo donde recibir la prueba.' }, 400);

      const tono = t.tonos ? t.tonos[0].clave : TONO_UNICO;
      const p = plantillaEnVigor(db, tipo, tono);
      const html = renderPlantilla(p.html, t.ejemplo, { html: true });
      const subject = '[PRUEBA] ' + renderPlantilla(p.subject, t.ejemplo, { html: false });
      const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
      const { error } = await sendEmail({
        from: (company.company_name || 'Bamburu') + ' <noreply@bamburu.com>',
        to: destino, subject, html, text: htmlAtexto(html),
        ...(company.email ? { replyTo: company.email } : {}),
      });
      if (error) return c.json({ error: 'No hemos podido enviar la prueba. Inténtalo más tarde.' }, 502);
      return c.json({ ok: true, to: destino });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // GUARDAR. Aquí vive la RED DE SEGURIDAD, y es distinta por familia:
  //   · cliente → avisa (200 con `avisos`), pero guarda. Es su voz.
  //   · sistema → BLOQUEA (400) si falta el elemento crítico. No se guarda nada.
  api.put('/email-templates/:tipo/:tono', requirePerm('company.update'), async c => {
    try {
      const { tipo, tono } = c.req.param();
      if (!esTonoValido(tipo, tono)) return c.json({ error: 'Plantilla desconocida' }, 404);
      const body = await c.req.json().catch(() => ({}));
      const subject = String(body.subject || '').trim();
      const html = String(body.html || '').trim();

      const rev = revisarPlantilla(tipo, { subject, html });
      if (rev.bloquea) return c.json({ error: rev.motivo, bloqueada: true }, 400);

      const quien = c.get('session')?.userName || '';
      db.prepare(`INSERT INTO email_templates (tipo, tono, subject, html, updated_at, updated_by)
                  VALUES (?,?,?,?,?,?)
                  ON CONFLICT(tipo, tono) DO UPDATE SET subject=excluded.subject, html=excluded.html,
                    updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
        .run(tipo, tono, subject, html, new Date().toISOString(), String(quien));
      return c.json({ ok: true, avisos: rev.avisos, message: 'Plantilla guardada. A partir de ahora se envía con tu texto.' });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // VOLVER AL ORIGINAL: borrar la edición. La de fábrica está en el código, así que no hay nada que
  // restaurar — vuelve sola en cuanto la fila deja de existir.
  api.delete('/email-templates/:tipo/:tono', requirePerm('company.update'), c => {
    try {
      const { tipo, tono } = c.req.param();
      if (!esTonoValido(tipo, tono)) return c.json({ error: 'Plantilla desconocida' }, 404);
      db.prepare('DELETE FROM email_templates WHERE tipo=? AND tono=?').run(tipo, tono);
      const fab = plantillaDeFabrica(tipo, tono);
      return c.json({ ok: true, ...fab, message: 'Restaurada la plantilla original.' });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── PANTALLA: LA CONFIGURACIÓN DEL NEGOCIO ────────────────────────────────────────────────────
  // Desde el 18 ago 2026 esta pantalla aloja DOS cosas con candados DISTINTOS:
  //   · lo suyo de siempre —empresa, oficio, impuestos, avisos, plantillas, situación fiscal—, que
  //     exige `company.read`;
  //   · la sección de citas mudada desde Agenda, donde CADA ENTRADA conserva su propio permiso.
  //
  // Por eso la puerta ya no puede ser un `requirePerm('company.read')` seco: dejaría fuera a quien
  // tiene `citas.read` y no `company.read`, y la mudanza le habría CERRADO seis puertas que hoy abre
  // desde el desplegable de Agenda. Un cambio de sitio no puede abrir ni cerrar una puerta.
  //
  // Entra quien tenga ALGO que ver aquí, y ve EXACTAMENTE eso. No se afloja ni un candado: el bloque
  // de empresa —y su <script>, que llama a /api/erp/settings/company— solo se PINTA con `company.read`,
  // y la API sigue exigiéndolo por su cuenta. Quien entre sin ese permiso ve su sección y nada más.
  // Se resuelve UNA vez por petición y se guarda en el contexto: la guardia la necesita para decidir
  // si deja entrar, y la vista para pintar. Sin esto se recorría el menú entero dos veces por carga.
  const seccionesDe = c => {
    const ya = c.get('cfgNegocio');
    if (ya) return ya;
    let secs = [];
    try {
      secs = menuDeUsuario(db, {
        role: c.get('session')?.role || '', perms: c.get('userPerms') || [], userId: c.get('session')?.userId,
      }).config || [];
    } catch { secs = []; }
    c.set('cfgNegocio', secs);
    return secs;
  };
  const puedeVerAjustes = async (c, next) => {
    if (!c.get('session')) return c.redirect('/admin/login');
    if (can(c, 'company.read') || seccionesDe(c).length) return next();
    return c.html('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>window.addEventListener("DOMContentLoaded",function(){if(typeof showAccessDenied==="function")showAccessDenied();else alert("Acceso no permitido");});<\/script></body></html>', 403);
  };

  views.get('/', puedeVerAjustes, c => {
    const verEmpresa = can(c, 'company.read');
    const config = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const sym = config.currency_symbol || '€';
    const countryInfo = getCountryConfig(config.country || 'ES');
    const countryName = countryInfo ? countryInfo.name : (config.country || 'España');
    // La sección mudada desde Agenda. Va AL FINAL de la pantalla (ver el orden más abajo); su orden
    // INTERNO sí es el orden en que se monta un negocio, y ese no cambia.
    const seccionCitas = configNegocioHTML(seccionesDe(c), { active: '' });
    const bloqueEmpresa = !verEmpresa ? '' : `
      <div class="card" style="max-width:700px">
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nombre de la empresa</label><input class="form-control" id="cName"></div>
            <div class="form-group"><label class="form-label">NIF / ID Fiscal</label><input class="form-control" id="cFiscal"></div>
          </div>
          <div class="form-group">
            <label class="form-label">País</label>
            <input type="text" class="form-control" value="${countryName}" disabled style="background:var(--bg3);color:var(--text2);cursor:not-allowed">
            <input type="hidden" id="countryCode" value="${config.country || 'ES'}">
            <small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">El país se configura al crear el negocio y no puede cambiarse.</small>
          </div>
          <!-- PASO 8 — PERFIL DE OFICIO. Cambia las palabras de tu agenda y te precarga los servicios
               típicos. Nada más: no enciende ni apaga funciones, y no toca lo que ya tengas. -->
          <div class="form-group">
            <label class="form-label">¿A qué te dedicas?</label>
            <select class="form-control" id="cOficio"></select>
            <small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">Cambia cómo se llaman las cosas en tu agenda (por ejemplo «paciente» en salud) y te ofrece los servicios típicos de tu oficio. <strong>Nunca borra ni cambia los servicios que ya tengas</strong>: solo te ofrece añadir los que falten.</small>
            <div id="oficioFaltan" style="margin-top:.6rem"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Moneda (código)</label><input class="form-control" id="currencyCode"></div>
            <div class="form-group"><label class="form-label">Símbolo de moneda</label><input class="form-control" id="currencySymbol" style="max-width:120px"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nombre del impuesto</label><input class="form-control" id="taxName"></div>
            <div class="form-group"><label class="form-label">Etiqueta ID fiscal</label><input class="form-control" id="fiscalIdLabel"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nombre documento fiscal</label><input class="form-control" id="documentName"></div>
            <div class="form-group"><label class="form-label">Impuesto por defecto (%)</label><input class="form-control" type="number" id="cTax" min="0" max="100" step="0.1"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Retención de IRPF por defecto (%)</label><input class="form-control" type="number" id="cIrpfDefault" min="0" max="100" step="0.1"><small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">Es tu retención como autónomo. Precarga la factura: clientes empresa/profesional la aplican; particulares, no. Puedes cambiarla en cada factura.</small></div>
            <div class="form-group"><label class="form-label">Recordatorio de impago (días tras el vencimiento)</label><input class="form-control" type="number" id="cDiasImpago" min="0" max="365" step="1"><small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">DISA prepara un borrador de recordatorio de pago cuando una factura de venta lleva vencida más días que este umbral. Por defecto 7. Los borradores aparecen en «Propuestas de DISA» para que los apruebes; nunca se envían solos.</small></div>
            <div class="form-group"><label class="form-label">Aviso de pago a proveedor (días antes del vencimiento)</label><input class="form-control" type="number" id="cDiasPago" min="0" max="365" step="1"><small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">DISA te propone registrar el pago de una factura de compra cuando le quedan menos días que este umbral para vencer. Por defecto 7. Las propuestas aparecen en «Propuestas de DISA»; nada se paga solo: tú apruebas.</small></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" id="cEmail"></div>
            <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="cPhone"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Web</label><input class="form-control" id="cWeb"></div>
          </div>
          <div class="form-group"><label class="form-label">Dirección fiscal</label><input class="form-control" id="cAddr" placeholder="Calle y número"></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Código postal</label><input class="form-control" id="cPostal" maxlength="10" placeholder="28001"></div>
            <div class="form-group"><label class="form-label">Municipio</label><input class="form-control" id="cCity" placeholder="Madrid"></div>
            <div class="form-group"><label class="form-label">Provincia</label><input class="form-control" id="cProvince" placeholder="Madrid"></div>
          </div>
          <small style="color:var(--text2);font-size:12px;margin:-8px 0 16px;display:block">Dirección completa: obligatoria para generar la factura electrónica <strong>Facturae</strong>.</small>
          <div class="form-group"><label class="form-label">URL Logo empresa</label><input class="form-control" id="cLogo"></div>
          <button class="btn btn-primary" onclick="saveCompany()">Guardar cambios</button>
        </div>
      </div>
      <!-- G2 — El ajuste vive AQUÍ y no escondido en un informe: es una decisión del dueño sobre
           cómo lee su propio negocio, no una opción de una pantalla. -->
      <div class="card" style="max-width:700px;margin-top:1rem">
        <div class="card-body">
          <h3 style="margin:0 0 .3rem;font-size:1rem">Cómo calculo mi margen</h3>
          <p style="color:var(--text2);font-size:13px;margin:0 0 .8rem">Hay dos formas de decir lo mismo y las dos son correctas; cambia la que se enseña primero en toda la plataforma. <strong>Ningún número cambia de valor</strong>: las dos cifras se calculan siempre, y al abrir el detalle salen las dos.</p>
          <div style="background:var(--bg3);border-radius:10px;padding:.7rem .85rem;font-size:.84rem;margin-bottom:.85rem">
            Algo que te cuesta <strong>100 ${sym}</strong> y vendes por <strong>140 ${sym}</strong>: ganas 40 ${sym}. Eso es un <strong>28,6 % sobre lo que cobras</strong> o un <strong>40 % sobre lo que te costó</strong>.
          </div>
          <div id="mgOpciones" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.6rem"></div>
          <p style="color:var(--text2);font-size:12px;margin:.8rem 0 0">La <strong>Contabilidad</strong> y la <strong>Cuenta de resultados</strong> no cambian nunca: por definición contable el margen va sobre la venta, y ahí manda esa regla elijas lo que elijas. Esas pantallas lo dicen en voz alta.</p>
        </div>
      </div>
      <div class="card" style="max-width:700px;margin-top:1rem">
        <div class="card-body">
          <h3 style="margin:0 0 .3rem;font-size:1rem">Avisos y correos</h3>
          <p style="color:var(--text2);font-size:13px;margin:0 0 .8rem">Cuándo (y si) quieres tu resumen por correo, qué lleva, y qué correos automáticos salen hacia tus clientes. Aquí se enciende y se apaga; el texto se escribe en Plantillas.</p>
          <a class="btn btn-secondary" href="/admin/settings/avisos"><i class="ti ti-bell-cog"></i> Avisos y correos</a>
        </div>
      </div>
      <div class="card" style="max-width:700px;margin-top:1rem">
        <div class="card-body">
          <h3 style="margin:0 0 .3rem;font-size:1rem">Plantillas de email</h3>
          <p style="color:var(--text2);font-size:13px;margin:0 0 .8rem">Todos los correos que tu negocio envía —recordatorios de pago, presupuestos, reenganche, recuperar contraseña…— con tu voz. Los datos (nombre, factura, importe) los rellena Bamburu solo.</p>
          <a class="btn btn-secondary" href="/admin/settings/plantillas"><i class="ti ti-mail"></i> Editar plantillas de email</a>
        </div>
      </div>
      <div class="card" style="max-width:700px;margin-top:1rem">
        <div class="card-body">
          <h3 style="margin:0 0 .3rem;font-size:1rem">Situación fiscal</h3>
          <p style="color:var(--text2);font-size:13px;margin:0 0 .8rem">Dinos qué presentas a Hacienda (IVA, IRPF, retenciones…) y DISA te recordará cada modelo antes de que venza. Nunca presenta nada por ti: te lo deja preparado para que lo revises.</p>
          <a class="btn btn-secondary" href="/admin/settings/situacion-fiscal"><i class="ti ti-calendar"></i> Declarar mi situación fiscal</a>
        </div>
      </div>
      <!-- ── LA SEGUNDA PUERTA DE LA MIGRACIÓN ASISTIDA ────────────────────────────────────────
           La migración solo se alcanzaba desde un paso del panel «Pon en marcha tu negocio», y ese
           panel se pliega. Una función a la que solo se llega por una puerta que puede plegarse es
           una función que desaparece. Aquí gana entrada FIJA, en la configuración del negocio, que
           es donde se busca lo que se monta una vez. La otra puerta sigue donde estaba: son dos, y
           ninguna depende de la otra.
           MISMO CANDADO, NO UNO NUEVO: este bloque solo se pinta con company.read, que es
           exactamente lo que exige /admin/migracion. Un cambio de sitio no abre ni cierra puertas. -->
      <div class="card" style="max-width:700px;margin-top:1rem">
        <div class="card-body">
          <h3 style="margin:0 0 .3rem;font-size:1rem">Trae tus datos del programa anterior</h3>
          <p style="color:var(--text2);font-size:13px;margin:0 0 .8rem">Si vienes de Holded, Quipu, un Excel o cualquier otro programa, <strong>no vuelvas a teclear nada</strong>: dinos de dónde vienes y qué quieres traer. <strong>La migración la hace el equipo de Bamburu, a mano y gratis.</strong></p>
          <a class="btn btn-secondary" href="/admin/migracion"><i class="ti ti-file-import"></i> Pedir la migración</a>
        </div>
      </div>


      <script>
      // G2 — dos botones grandes, no un desplegable escondido: es una decisión, no un ajuste fino.
      var MG_MODO = null;
      function mgPinta(){
        var defs = { venta:{t:'Sobre lo que cobras', e:'Gano un 28,6 %', p:'De cada 100 ${sym} que facturas, lo que te queda después de pagar lo que vendiste.'},
                     coste:{t:'Sobre lo que te costó', e:'Le meto un 40 %', p:'Lo que le sumas al precio de compra para poner el precio de venta.'} };
        document.getElementById('mgOpciones').innerHTML = Object.keys(defs).map(function(k){
          var sel = MG_MODO === k;
          return '<button type="button" data-mg="'+k+'" aria-pressed="'+sel+'" style="text-align:left;font-family:inherit;cursor:pointer;'
            + 'border:2px solid '+(sel?'var(--accent)':'var(--border2)')+';background:'+(sel?'var(--accent-soft)':'var(--bg2)')+';'
            + 'border-radius:12px;padding:.75rem .9rem">'
            + '<div style="font-weight:700;font-size:.92rem;color:'+(sel?'var(--accent)':'var(--text)')+'">'+defs[k].e+'</div>'
            + '<div style="font-size:.78rem;color:var(--text2);margin-top:.1rem">'+defs[k].t.toLowerCase()+'</div>'
            + '<div style="font-size:.75rem;color:var(--text3);margin-top:.35rem">'+defs[k].p+'</div>'
            + (sel?'<div style="font-size:.72rem;color:var(--accent);font-weight:600;margin-top:.35rem">✓ Es el que ves ahora</div>':'')
            + '</button>';
        }).join('');
      }
      api('GET','/api/erp/settings/margen').then(function(d){ MG_MODO = d.modo; mgPinta(); }).catch(function(){});
      document.getElementById('mgOpciones').addEventListener('click', function(ev){
        var b = ev.target.closest('button[data-mg]'); if(!b) return;
        var k = b.getAttribute('data-mg'); if (k === MG_MODO) return;
        api('PUT','/api/erp/settings/margen',{modo:k}).then(function(){
          MG_MODO = k; mgPinta();
          toast('Hecho. Ahora el margen se enseña ' + (k==='coste'?'sobre lo que te costó':'sobre lo que cobras') + ' en toda la plataforma.');
        }).catch(function(e){ toast(e.message,'err'); });
      });
      api('GET','/api/erp/settings/company').then(d=>{
        document.getElementById('cName').value=d.company_name||'';
        document.getElementById('cFiscal').value=d.fiscal_id||'';
        document.getElementById('currencyCode').value=d.currency||'EUR';
        document.getElementById('currencySymbol').value=d.currency_symbol||'${sym}';
        document.getElementById('taxName').value=d.tax_name||'IVA';
        document.getElementById('fiscalIdLabel').value=d.fiscal_id_label||'NIF/CIF';
        document.getElementById('documentName').value=d.document_name||'Factura';
        document.getElementById('cTax').value=d.tax_rate||21;
        document.getElementById('cIrpfDefault').value=d.irpf_default||0;
        document.getElementById('cDiasImpago').value=(d.dias_recordatorio_impago==null?7:d.dias_recordatorio_impago);
        document.getElementById('cDiasPago').value=(d.dias_aviso_pago==null?7:d.dias_aviso_pago);
        document.getElementById('cEmail').value=d.email||'';
        document.getElementById('cPhone').value=d.phone||'';
        document.getElementById('cWeb').value=d.website||'';
        document.getElementById('cAddr').value=d.address||'';
        document.getElementById('cPostal').value=d.postal_code||'';
        document.getElementById('cCity').value=d.city||'';
        document.getElementById('cProvince').value=d.province||'';
        document.getElementById('cLogo').value=d.logo_url||'';
      });

      // ── PASO 8 — PERFIL DE OFICIO ────────────────────────────────────────────────────────────
      // Dos botones separados a propósito: cambiar de oficio SOLO cambia las palabras; los servicios
      // se añaden pulsando aparte. Así nadie se encuentra ocho productos nuevos por tocar un select.
      var OFICIOS_LISTA=[];
      function escOf(s){return String(s==null?'':s).replace(/[<>&"]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];});}
      function pintaFaltan(faltan){
        var box=document.getElementById('oficioFaltan');
        if(!faltan||!faltan.length){ box.innerHTML='<span style="color:var(--text2);font-size:12px">Ya tienes todos los servicios de arranque de tu oficio.</span>'; return; }
        box.innerHTML='<div style="font-size:12px;color:var(--text2);margin-bottom:.4rem">Te faltan <strong>'+faltan.length+'</strong> servicios de arranque: '
          +faltan.map(function(s){return escOf(s.nombre)+' ('+s.duracion_min+' min)';}).join(' · ')
          +'</div><button type="button" class="btn btn-secondary btn-sm" id="btnSembrar">Añadir los que faltan</button>';
        document.getElementById('btnSembrar').addEventListener('click',sembrarOficio);
      }
      async function cargarOficio(){
        try{
          var d=await api('GET','/api/erp/settings/oficio');
          OFICIOS_LISTA=d.oficios||[];
          var sel=document.getElementById('cOficio');
          sel.innerHTML=OFICIOS_LISTA.map(function(o){return '<option value="'+escOf(o.id)+'"'+(o.id===d.oficio?' selected':'')+'>'+escOf(o.label)+'</option>';}).join('');
          pintaFaltan(d.faltan);
        }catch(e){ /* los ajustes nunca se rompen por esto */ }
      }
      async function cambiarOficio(){
        try{
          var d=await api('PUT','/api/erp/settings/oficio',{oficio:document.getElementById('cOficio').value});
          toast('Oficio guardado ✓');
          pintaFaltan(d.faltan);
        }catch(e){ toast(e.message,'err'); }
      }
      async function sembrarOficio(){
        var b=document.getElementById('btnSembrar'); if(b){ b.disabled=true; b.textContent='Añadiendo…'; }
        try{
          var d=await api('POST','/api/erp/settings/oficio/sembrar',{});
          toast((d.creados||[]).length+' servicios añadidos ✓');
          pintaFaltan(d.faltan);
        }catch(e){ toast(e.message,'err'); if(b){ b.disabled=false; b.textContent='Añadir los que faltan'; } }
      }
      document.getElementById('cOficio').addEventListener('change',cambiarOficio);
      cargarOficio();

      async function saveCompany(){
        try{await api('PUT','/api/erp/settings/company',{company_name:document.getElementById('cName').value,fiscal_id:document.getElementById('cFiscal').value,country:document.getElementById('countryCode').value,currency:document.getElementById('currencyCode').value,currency_symbol:document.getElementById('currencySymbol').value,tax_name:document.getElementById('taxName').value,fiscal_id_label:document.getElementById('fiscalIdLabel').value,document_name:document.getElementById('documentName').value,tax_rate:document.getElementById('cTax').value,irpf_default:document.getElementById('cIrpfDefault').value,dias_recordatorio_impago:document.getElementById('cDiasImpago').value,dias_aviso_pago:document.getElementById('cDiasPago').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,website:document.getElementById('cWeb').value,address:document.getElementById('cAddr').value,postal_code:document.getElementById('cPostal').value,city:document.getElementById('cCity').value,province:document.getElementById('cProvince').value,logo_url:document.getElementById('cLogo').value});toast('Guardado ✓');}catch(e){toast(e.message,'err')}
      }
      </script>`;
    // EL ORDEN DE LA PANTALLA: cabecera · lo del NEGOCIO · la sección mudada, AL FINAL.
    // Corrección de Ibrahin (18 ago 2026): los ajustes de la agenda no pueden ir por delante de los
    // del negocio. Esta pantalla es la configuración DEL NEGOCIO; lo de la agenda es una sección
    // suya, no su portada. Quien no tenga `company.read` recibe cabecera + su sección, y punto — ni
    // el formulario de empresa, ni avisos, ni plantillas, ni situación fiscal, ni el <script> que
    // los pide a la API.
    const content = `
      <div class="ph"><h2>Configuración Empresa</h2></div>
      ${bloqueEmpresa}
      ${seccionCitas}`;
    return c.html(adminLayout('Configuración Empresa', content, 'settings', c.get('session')?.csrfToken || '', c));
  });

  // ── PANTALLA: Plantillas de email ──────────────────────────────────────────
  // Editor VISUAL (contenteditable): negrita, cursiva, enlace, listas. El usuario no ve etiquetas.
  // El HTML crudo existe, pero PLEGADO: quien lo quiera, lo abre; quien no, ni se entera.
  // Los huecos se INSERTAN con un clic (nunca se teclean: un `{{factrua}}` mal escrito sale vacío).
  views.get('/plantillas', requirePerm('company.read'), c => {
    const csrf = c.get('session')?.csrfToken || '';
    const puedeEditar = can(c, 'company.update');
    const content = `
      <div class="ph"><h2>Plantillas de email</h2>
        <a class="btn btn-secondary" href="/admin/settings"><i class="ti ti-arrow-left"></i> Volver a Ajustes</a>
      </div>
      <div class="card" style="margin-bottom:1rem"><div class="card-body" style="color:var(--muted)">
        Estos son <strong>todos</strong> los correos que tu negocio envía. Puedes reescribirlos con tu voz.
        Los <strong>huecos</strong> (<code>{{cliente}}</code>, <code>{{factura}}</code>…) los rellena Bamburu
        solo, con los datos de cada envío: insértalos con un clic, no los escribas a mano.
        ${puedeEditar ? '' : '<br><strong>Solo lectura:</strong> necesitas permiso de administración de Ajustes para editarlas.'}
      </div></div>
      <div id="tplLista"><p style="color:var(--muted)">Cargando…</p></div>

      <div class="modal" id="tplModal"><div class="modal-content" style="max-width:860px">
        <div class="modal-head"><h3 id="tplTitulo">Plantilla</h3>
          <button class="modal-x" onclick="closeModal('tplModal')">&times;</button></div>
        <div class="modal-body">
          <div id="tplCritico" class="alert alert-warn" style="display:none;margin-bottom:1rem"></div>

          <div class="form-group"><label class="form-label">Asunto</label>
            <input class="form-control" id="tplSubject"></div>

          <label class="form-label">Mensaje</label>
          <div class="tpl-tools">
            <button type="button" class="btn btn-secondary btn-sm" onmousedown="return fmt(event,'bold')"><b>B</b></button>
            <button type="button" class="btn btn-secondary btn-sm" onmousedown="return fmt(event,'italic')"><i>I</i></button>
            <button type="button" class="btn btn-secondary btn-sm" onmousedown="return fmt(event,'insertUnorderedList')">• Lista</button>
            <button type="button" class="btn btn-secondary btn-sm" onmousedown="return ponerEnlace(event)">🔗 Enlace</button>
          </div>
          <div id="tplEditor" class="tpl-editor" contenteditable="true"></div>

          <div style="margin-top:.6rem">
            <div style="font-size:.8rem;color:var(--muted);margin-bottom:.3rem">Huecos que este email sabe rellenar — pincha para insertarlos donde tengas el cursor:</div>
            <div id="tplHuecos" class="tpl-huecos"></div>
          </div>

          <details style="margin-top:1rem">
            <summary style="cursor:pointer;color:var(--muted);font-size:.85rem">Editar el HTML a mano (avanzado)</summary>
            <textarea id="tplHtml" class="form-control" style="min-height:160px;font-family:ui-monospace,monospace;font-size:.8rem;margin-top:.5rem"></textarea>
            <button class="btn btn-secondary btn-sm" style="margin-top:.4rem" onclick="delHtmlAlEditor()">Aplicar al editor visual</button>
          </details>

          <div id="tplAvisos" style="margin-top:1rem"></div>
          <div id="tplPreview" style="display:none;margin-top:1rem">
            <div style="font-size:.8rem;color:var(--muted);margin-bottom:.3rem">Vista previa (con datos de ejemplo, nunca de un cliente real):</div>
            <div style="border:1px solid var(--border2);border-radius:10px;overflow:hidden">
              <div style="padding:.5rem .8rem;background:var(--bg);border-bottom:1px solid var(--border2);font-size:.85rem"><strong>Asunto:</strong> <span id="pvSubject"></span></div>
              <iframe id="pvBody" style="width:100%;height:320px;border:0;background:#fff"></iframe>
            </div>
          </div>
        </div>
        <div class="modal-foot" style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-secondary" onclick="previsualizar()">Vista previa</button>
          ${puedeEditar ? '<button class="btn btn-primary" onclick="guardar()">Guardar</button>' : ''}
          ${puedeEditar ? '<button class="btn btn-secondary" onclick="volverAlOriginal()">Volver al original</button>' : ''}
          <button class="btn btn-secondary" onclick="closeModal('tplModal')">Cerrar</button>
        </div>
      </div></div>

      <style>
        .tpl-fam{margin-bottom:1.5rem}
        .tpl-fam h3{margin:0 0 .3rem;font-size:1rem}
        .tpl-fam .sub{color:var(--muted);font-size:.85rem;margin-bottom:.7rem}
        .tpl-card{border:1px solid var(--border2);border-radius:12px;padding:.9rem 1rem;margin-bottom:.6rem;background:var(--card)}
        .tpl-card h4{margin:0 0 .2rem;font-size:.95rem}
        .tpl-card .desc{color:var(--muted);font-size:.83rem;margin-bottom:.6rem}
        .tpl-vars{display:flex;gap:.4rem;flex-wrap:wrap}
        .tpl-editada{font-size:.7rem;font-weight:600;color:#047857;background:rgba(16,185,129,.14);padding:.1rem .4rem;border-radius:5px}
        .tpl-tools{display:flex;gap:.3rem;margin-bottom:.3rem;flex-wrap:wrap}
        .tpl-editor{min-height:200px;border:1px solid var(--border2);border-radius:10px;padding:.8rem;background:var(--bg);overflow:auto}
        .tpl-editor:focus{outline:2px solid var(--accent,#3b82f6);outline-offset:1px}
        .tpl-huecos{display:flex;gap:.35rem;flex-wrap:wrap}
        .tpl-hueco{cursor:pointer;font-size:.75rem;font-family:ui-monospace,monospace;border:1px dashed var(--border2);border-radius:6px;padding:.15rem .45rem;background:var(--bg)}
        .tpl-hueco.crit{border-color:#b45309;color:#b45309;border-style:solid}
      </style>
      <script>
      const PUEDE_EDITAR = ${puedeEditar ? 'true' : 'false'};
      let TPL = null;   // { tipo, tono, familia, huecos, criticos, ... }

      async function cargar(){
        const cat = await api('GET','/api/erp/settings/email-templates');
        const box = document.getElementById('tplLista');
        box.innerHTML = fam('Correos a tus clientes', 'Los que salen con tu nombre. Si te cargas un dato importante, te avisamos — pero es tu voz y tu decisión.', cat.cliente)
          + fam('Correos de sistema', 'Los operativos. Llevan el enlace con el que alguien entra a su cuenta o a su portal: <strong>sin ese enlace no te dejamos guardar</strong>.', cat.sistema);
      }
      function fam(titulo, sub, tipos){
        return '<div class="tpl-fam"><h3>'+titulo+'</h3><div class="sub">'+sub+'</div>'
          + tipos.map(t =>
            '<div class="tpl-card"><h4>'+escHtml(t.label)+'</h4><div class="desc">'+escHtml(t.descripcion)+'</div>'
            + '<div class="tpl-vars">'
            + t.variantes.map(v =>
                '<button class="btn btn-secondary btn-sm" onclick="abrir(\\''+t.tipo+'\\',\\''+v.tono+'\\')">'
                + escHtml(v.label || 'Editar')
                + (v.editada ? ' <span class="tpl-editada">tuya</span>' : '') + '</button>').join('')
            + '</div></div>').join('')
          + '</div>';
      }

      async function abrir(tipo, tono){
        TPL = await api('GET','/api/erp/settings/email-templates/'+tipo+'/'+tono);
        document.getElementById('tplTitulo').textContent = TPL.label + (TPL.editada ? ' (editada por ti)' : ' (original)');
        document.getElementById('tplSubject').value = TPL.subject;
        document.getElementById('tplEditor').innerHTML = TPL.html;
        document.getElementById('tplHtml').value = TPL.html;
        document.getElementById('tplAvisos').innerHTML = '';
        document.getElementById('tplPreview').style.display = 'none';
        const crit = document.getElementById('tplCritico');
        if (TPL.familia === 'sistema') {
          crit.style.display = '';
          crit.innerHTML = '<strong>Correo de sistema.</strong> ' + escHtml(TPL.motivoCritico || '')
            + ' No podrás guardar si quitas ese elemento.';
        } else { crit.style.display = 'none'; }
        document.getElementById('tplHuecos').innerHTML = TPL.huecos.map(h =>
          '<span class="tpl-hueco'+(TPL.criticos.includes(h.clave)?' crit':'')+'" onclick="insertar(\\'{{'+h.clave+'}}\\')" title="'+escHtml(h.label)+'">'
          + '{{'+h.clave+'}}</span>').join('');
        document.getElementById('tplEditor').contentEditable = PUEDE_EDITAR ? 'true' : 'false';
        openModal('tplModal');
      }

      // ── Editor visual: sin ver una sola etiqueta ──
      function fmt(ev, cmd){ ev.preventDefault(); document.execCommand(cmd,false,null); return false; }
      function ponerEnlace(ev){
        ev.preventDefault();
        const url = prompt('¿A qué dirección enlaza?', 'https://');
        if (url) document.execCommand('createLink', false, url);
        return false;
      }
      // Los huecos se INSERTAN en el cursor. Nunca se teclean: un {{factrua}} mal escrito saldría vacío.
      function insertar(txt){
        const ed = document.getElementById('tplEditor');
        ed.focus();
        document.execCommand('insertText', false, txt);
      }
      function delHtmlAlEditor(){
        document.getElementById('tplEditor').innerHTML = document.getElementById('tplHtml').value;
        toast('Aplicado al editor visual');
      }
      const htmlActual = () => document.getElementById('tplEditor').innerHTML;

      async function previsualizar(){
        const r = await api('POST','/api/erp/settings/email-templates/'+TPL.tipo+'/'+TPL.tono+'/preview',
          { subject: document.getElementById('tplSubject').value, html: htmlActual() });
        document.getElementById('pvSubject').textContent = r.subject;
        document.getElementById('pvBody').srcdoc = r.html;
        document.getElementById('tplPreview').style.display = '';
        pintarRevision(r.revision);
      }
      function pintarRevision(rev){
        const box = document.getElementById('tplAvisos');
        if (!rev) { box.innerHTML=''; return; }
        let h = '';
        if (rev.bloquea) h += '<div class="alert alert-danger"><strong>No se puede guardar.</strong> '+escHtml(rev.motivo)+'</div>';
        for (const a of (rev.avisos||[])) h += '<div class="alert alert-warn">⚠ '+escHtml(a)+'</div>';
        box.innerHTML = h;
      }

      async function guardar(){
        try {
          const r = await api('PUT','/api/erp/settings/email-templates/'+TPL.tipo+'/'+TPL.tono,
            { subject: document.getElementById('tplSubject').value, html: htmlActual() });
          // Familia CLIENTE: puede guardar Y avisar. El aviso no es un error: es un "oye, mira esto".
          if (r.avisos && r.avisos.length) pintarRevision({ bloquea:false, avisos:r.avisos });
          else document.getElementById('tplAvisos').innerHTML = '';
          toast(r.message || 'Guardada');
          cargar();
        } catch(e){
          // Familia SISTEMA: bloqueo duro. Se explica por qué, y NO se guarda nada.
          pintarRevision({ bloquea:true, motivo:e.message, avisos:[] });
          toast(e.message || 'No se pudo guardar','err');
        }
      }

      async function volverAlOriginal(){
        if (!confirm('¿Volver a la plantilla original de Bamburu? Se pierde tu texto.')) return;
        try {
          const r = await api('DELETE','/api/erp/settings/email-templates/'+TPL.tipo+'/'+TPL.tono);
          document.getElementById('tplSubject').value = r.subject;
          document.getElementById('tplEditor').innerHTML = r.html;
          document.getElementById('tplHtml').value = r.html;
          document.getElementById('tplAvisos').innerHTML = '';
          toast(r.message || 'Restaurada');
          cargar();
        } catch(e){ toast(e.message,'err'); }
      }
      cargar();
      </script>`;
    return c.html(adminLayout('Plantillas de email', content, 'settings', csrf, c));
  });

  // ── PANTALLA: Situación fiscal ─────────────────────────────────────────────
  // El dueño DECLARA en lenguaje llano qué presenta (sin ver números de modelo si no quiere). De aquí
  // deriva DISA los vencimientos fiscales (calendario-fiscal.js). En blanco = no se recuerda nada: por
  // eso el aviso mientras `configured_at` sea NULL. El caso ambiguo (módulos, recargo de equivalencia,
  // otro régimen) NO se deriva: se marca "situación especial" y se anota, para no INVENTAR un modelo.
  // ── AJUSTES → AVISOS Y CORREOS ────────────────────────────────────────────────────────────────
  // SIN `requirePerm`, a propósito (ver el porqué largo en la API): el bloque de arriba es la
  // bandeja de entrada de quien mira, no una configuración del negocio. El de abajo sí lo es, y solo
  // se pinta para quien tiene `company.read`. Una pantalla, dos audiencias, cada una con lo suyo.
  views.get('/avisos', c => {
    const csrf = c.get('session')?.csrfToken || '';
    const verNegocio = can(c, 'company.read');
    const puedeEditar = can(c, 'company.update');
    const content = `
      <div class="ph"><h2>Avisos y correos</h2>
        <a class="btn btn-secondary" href="/admin/settings"><i class="ti ti-arrow-left"></i> Volver a Ajustes</a>
      </div>

      <div class="card" style="margin-bottom:1rem"><div class="card-body">
        <h3 style="margin:0 0 .2rem;font-size:1.05rem">Lo que Bamburu te cuenta a ti</h3>
        <p style="color:var(--muted);font-size:.87rem;margin:0 0 1rem">
          Tu resumen por correo, a tu manera. Es <strong>tuyo</strong>: lo que cambies aquí no afecta a nadie más
          del negocio, y solo se te cuenta lo que tú puedes ver en pantalla.
          <span id="avMiEmail"></span>
        </p>

        <label class="switch-row" style="display:flex;align-items:center;gap:.6rem;margin-bottom:1rem">
          <input type="checkbox" id="avActivo">
          <span><strong>Recibir el resumen por correo</strong></span>
        </label>

        <div id="avDetalle">
          <div class="av-grid">
            <div class="form-group">
              <label class="form-label" for="avFrecuencia">Cada cuánto</label>
              <select class="form-control" id="avFrecuencia">
                <option value="diaria">Cada día</option>
                <option value="semanal">Una vez por semana</option>
              </select>
            </div>
            <div class="form-group" id="avDiaBox" style="display:none">
              <label class="form-label" for="avDia">Qué día</label>
              <select class="form-control" id="avDia"></select>
            </div>
            <div class="form-group">
              <label class="form-label" for="avHora">A qué hora</label>
              <select class="form-control" id="avHora"></select>
            </div>
          </div>

          <div style="margin-top:.4rem">
            <div class="form-label">Qué quieres que lleve</div>
            <div id="avLineas" class="av-lineas"><p style="color:var(--muted)">Cargando…</p></div>
          </div>

          <div class="av-previa" id="avPrevia"></div>
        </div>

        <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-primary" id="avGuardar">Guardar</button>
        </div>
        <p style="color:var(--muted);font-size:.8rem;margin:.8rem 0 0">
          Si un día no hay nada que contar, <strong>no se envía nada</strong>. Ni un correo diciendo que no hay avisos.
        </p>
      </div></div>

      ${verNegocio ? `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 .2rem;font-size:1.05rem">Lo que Bamburu envía a tus clientes</h3>
        <p style="color:var(--muted);font-size:.87rem;margin:0 0 1rem">
          Los correos que salen de tu negocio hacia fuera. Aquí se encienden y se apagan;
          el <strong>texto</strong> de cada uno se cambia en <a href="/admin/settings/plantillas">Plantillas de email</a>.
          ${puedeEditar ? '' : '<br><strong>Solo lectura:</strong> necesitas permiso de administración de Ajustes para cambiarlos.'}
        </p>
        <div id="avCorreos"><p style="color:var(--muted)">Cargando…</p></div>
      </div></div>` : ''}

      <style>
        .av-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.8rem}
        .av-lineas{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.4rem .9rem;margin-top:.4rem}
        .av-lineas label{display:flex;align-items:center;gap:.5rem;font-size:.9rem;cursor:pointer}
        .av-previa{margin-top:1rem;padding:.8rem 1rem;border:1px dashed var(--border2);border-radius:10px;background:var(--bg);font-size:.88rem}
        .av-previa h4{margin:0 0 .4rem;font-size:.8rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
        .av-previa ul{margin:.2rem 0 0;padding-left:1.1rem}
        .av-previa li{margin:0 0 .3rem}
        .av-correo{border:1px solid var(--border2);border-radius:12px;padding:.9rem 1rem;margin-bottom:.6rem;background:var(--card)}
        .av-correo .top{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap}
        .av-correo h4{margin:0 0 .15rem;font-size:.95rem}
        .av-correo .quien{color:var(--muted);font-size:.83rem}
        .av-correo .acciones{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
        .av-bloqueo{margin-top:.5rem;font-size:.82rem;color:#b45309;background:rgba(180,83,9,.08);border-radius:8px;padding:.4rem .6rem}
        .av-apagado{opacity:.62}
        .av-etiqueta{font-size:.7rem;font-weight:600;padding:.1rem .45rem;border-radius:5px}
        .av-auto{color:#047857;background:rgba(16,185,129,.14)}
        .av-boton{color:#1d4ed8;background:rgba(37,99,235,.12)}
        @media (max-width:620px){ .av-correo .top{flex-direction:column} }
      </style>
      <script>
      (function(){
        const HORAS = Array.from({length:24},(_,h)=>h);
        let LINEAS = [], PREF = null;

        function pintarPref(d){
          PREF = d.pref; LINEAS = d.lineas;
          document.getElementById('avActivo').checked = !!d.pref.activo;
          document.getElementById('avFrecuencia').value = d.pref.frecuencia;
          const dia = document.getElementById('avDia');
          dia.innerHTML = d.dias.map(x=>'<option value="'+x.n+'">'+escHtml(x.label)+'</option>').join('');
          dia.value = String(d.pref.dia_semana);
          const hora = document.getElementById('avHora');
          hora.innerHTML = HORAS.map(h=>'<option value="'+h+'">'+String(h).padStart(2,'0')+':00</option>').join('');
          hora.value = String(d.pref.hora);
          document.getElementById('avMiEmail').innerHTML = d.email
            ? 'Te llega a <strong>'+escHtml(d.email)+'</strong>.' : '';
          document.getElementById('avLineas').innerHTML = d.lineas.length
            ? d.lineas.map(l=>'<label><input type="checkbox" data-linea="'+escHtml(l.id)+'"'+(l.marcada?' checked':'')+'> '+escHtml(l.label)+'</label>').join('')
            : '<p style="color:var(--muted)">No tienes permiso para ver ninguna de las fuentes de aviso, así que no hay nada que enviarte.</p>';
          sincronizar();
        }

        // El día solo tiene sentido si es semanal, y el detalle entero solo si lo quiere recibir.
        function sincronizar(){
          const activo = document.getElementById('avActivo').checked;
          document.getElementById('avDetalle').style.opacity = activo ? '1' : '.5';
          document.getElementById('avDetalle').style.pointerEvents = activo ? '' : 'none';
          document.getElementById('avDiaBox').style.display =
            document.getElementById('avFrecuencia').value === 'semanal' ? '' : 'none';
        }

        async function pintarPrevia(){
          const box = document.getElementById('avPrevia');
          try {
            const p = await api('GET','/api/erp/settings/avisos/mi-parte');
            if (!p.n) {
              box.innerHTML = '<h4>Tu parte de hoy</h4><p style="margin:0;color:var(--muted)">'
                + 'Hoy no hay nada que contarte, así que <strong>hoy no te llegaría ningún correo</strong>.</p>';
              return;
            }
            box.innerHTML = '<h4>Tu parte de hoy</h4><ul>'
              + p.frases.map(f=>'<li>'+escHtml(f.texto)+'</li>').join('') + '</ul>';
          } catch(e){ box.innerHTML = ''; }
        }

        async function guardar(){
          const fuentes = Array.prototype.slice.call(document.querySelectorAll('[data-linea]'))
            .filter(x=>x.checked).map(x=>x.getAttribute('data-linea'));
          try {
            await api('PUT','/api/erp/settings/avisos/mias',{
              activo: document.getElementById('avActivo').checked,
              frecuencia: document.getElementById('avFrecuencia').value,
              dia_semana: Number(document.getElementById('avDia').value),
              hora: Number(document.getElementById('avHora').value),
              fuentes,
            });
            toast('Guardado ✓');
            pintarPrevia();
          } catch(e){ toast(e.message,'err'); }
        }

        function pintarCorreos(d){
          const box = document.getElementById('avCorreos');
          if (!box) return;
          const etiqueta = x => x.clase === 'automatico'
            ? '<span class="av-etiqueta av-auto">automático</span>'
            : '<span class="av-etiqueta av-boton">lo mandas tú</span>';
          let h = d.correos.map(x =>
            '<div class="av-correo'+(x.activo?'':' av-apagado')+'">'
              + '<div class="top"><div>'
                + '<h4>'+escHtml(x.label)+' '+etiqueta(x)+'</h4>'
                + '<div class="quien">'+escHtml(x.quien)+'</div>'
              + '</div><div class="acciones">'
                + '<button class="btn btn-secondary btn-sm" data-prueba="'+escHtml(x.tipo)+'">Mándame una prueba a mí</button>'
                + '<label class="switch-row" style="display:flex;align-items:center;gap:.4rem">'
                  + '<input type="checkbox" data-correo="'+escHtml(x.tipo)+'"'+(x.activo?' checked':'')
                  + ((!d.puedeEditar || x.bloqueo) ? ' disabled' : '')+'>'
                  + '<span>'+(x.activo?'Encendido':'Apagado')+'</span>'
                + '</label>'
              + '</div></div>'
              + (x.bloqueo ? '<div class="av-bloqueo">🔒 '+escHtml(x.bloqueo)+'</div>' : '')
            + '</div>').join('');
          if (d.sinInterruptor && d.sinInterruptor.length) {
            h += '<p style="color:var(--muted);font-size:.83rem;margin:.9rem 0 .3rem">'
               + 'Estos no se pueden apagar, y es a propósito:</p>';
            h += d.sinInterruptor.map(x =>
              '<div class="av-correo"><h4>'+escHtml(x.label)+'</h4>'
              + '<div class="quien">'+escHtml(x.porque)+'</div></div>').join('');
          }
          box.innerHTML = h;
        }

        async function cambiarCorreo(tipo, activo, el){
          try {
            await api('PUT','/api/erp/settings/avisos/correos/'+encodeURIComponent(tipo),{activo});
            toast(activo ? 'Encendido ✓' : 'Apagado ✓');
            cargarCorreos();
          } catch(e){ el.checked = !activo; toast(e.message,'err'); }
        }

        async function mandarPrueba(tipo, btn){
          const antes = btn.textContent;
          btn.disabled = true; btn.textContent = 'Enviando…';
          try {
            const r = await api('POST','/api/erp/settings/avisos/correos/'+encodeURIComponent(tipo)+'/prueba',{});
            toast('Prueba enviada a ' + r.to);
          } catch(e){ toast(e.message,'err'); }
          btn.disabled = false; btn.textContent = antes;
        }

        async function cargarCorreos(){
          if (!document.getElementById('avCorreos')) return;
          try { pintarCorreos(await api('GET','/api/erp/settings/avisos/correos')); }
          catch(e){ document.getElementById('avCorreos').innerHTML = '<p style="color:var(--muted)">'+escHtml(e.message)+'</p>'; }
        }

        // Un solo enganche por delegación: las tarjetas de correo se repintan enteras cada vez que
        // se toca un interruptor, así que enganchar botón por botón dejaría botones muertos tras el
        // primer clic (la lección de C4b-1, que costó dos gates).
        document.addEventListener('click', function(ev){
          const p = ev.target.closest && ev.target.closest('[data-prueba]');
          if (p) { mandarPrueba(p.getAttribute('data-prueba'), p); return; }
          if (ev.target && ev.target.id === 'avGuardar') guardar();
        });
        document.addEventListener('change', function(ev){
          const t = ev.target;
          if (!t) return;
          if (t.id === 'avActivo' || t.id === 'avFrecuencia') sincronizar();
          if (t.hasAttribute && t.hasAttribute('data-correo')) cambiarCorreo(t.getAttribute('data-correo'), t.checked, t);
        });

        (async function(){
          try { pintarPref(await api('GET','/api/erp/settings/avisos/mias')); }
          catch(e){ toast(e.message,'err'); }
          pintarPrevia();
          cargarCorreos();
        })();
      })();
      </script>`;
    return c.html(adminLayout('Avisos y correos', content, 'settings', csrf, c));
  });

  views.get('/situacion-fiscal', requirePerm('company.read'), c => {
    const csrf = c.get('session')?.csrfToken || '';
    const puedeEditar = can(c, 'company.update');
    const dis = puedeEditar ? '' : 'disabled';
    const content = `
      <div class="ph"><h2>Situación fiscal</h2></div>
      <div class="card" style="max-width:720px">
        <div class="card-body">
          <p style="color:var(--text2);font-size:13px;margin:0 0 1rem">
            Dime qué presentas a Hacienda y DISA te recordará cada modelo <strong>antes</strong> de que
            venza —en «Propuestas de DISA»—, con la fecha aproximada del plazo. <strong>Bamburu nunca
            presenta nada a la AEAT:</strong> te lo deja preparado para que lo revises y lo presentes tú.
          </p>
          <div id="fpWarn"></div>

          <label class="fp-check"><input type="checkbox" id="fIva" ${dis}>
            <span><strong>Facturo con IVA</strong><small>Te recordaré el <b>IVA trimestral</b> (modelo 303) y su <b>resumen anual</b> (390).</small></span></label>

          <label class="fp-check"><input type="checkbox" id="fIrpf" ${dis}>
            <span><strong>Tributo el IRPF en estimación directa</strong><small>Te recordaré el <b>pago fraccionado de IRPF trimestral</b> (modelo 130).</small></span></label>

          <label class="fp-check"><input type="checkbox" id="fRetTrab" ${dis}>
            <span><strong>Tengo empleados o pago a profesionales con retención</strong><small>Te recordaré las <b>retenciones de trabajo</b> (modelo 111 trimestral) y su <b>resumen anual</b> (190). Aún no calculo su importe: te aviso de la fecha.</small></span></label>

          <label class="fp-check"><input type="checkbox" id="fRetAlq" ${dis}>
            <span><strong>Pago el alquiler de un local con retención</strong><small>Te recordaré las <b>retenciones de alquiler</b> (modelo 115 trimestral) y su <b>resumen anual</b> (180). Aún no calculo su importe: te aviso de la fecha.</small></span></label>

          <label class="fp-check"><input type="checkbox" id="fEsp" ${dis}>
            <span><strong>Estoy en un régimen especial</strong> (módulos, recargo de equivalencia, otro)<small>No lo doy por supuesto ni invento un modelo: apúntalo abajo y lo tendré en cuenta cuando construyamos tu caso.</small></span></label>

          <div class="form-group" id="fEspBox" style="display:none;margin-top:.4rem">
            <label class="form-label">¿Cuál es tu caso?</label>
            <textarea class="form-control" id="fNota" rows="3" ${dis} placeholder="Ej.: estoy en módulos; recargo de equivalencia; etc."></textarea>
          </div>

          <div class="fp-summary" id="fpResumen"></div>

          ${puedeEditar
            ? `<button class="btn btn-primary" onclick="guardar()" style="margin-top:1rem">Guardar</button>`
            : `<p style="color:var(--text2);font-size:13px;margin-top:1rem">No tienes permiso para cambiar la situación fiscal (requiere «Configuración de empresa»). Puedes verla.</p>`}
        </div>
      </div>
      <style>
        .fp-check{display:flex;gap:.6rem;align-items:flex-start;padding:.7rem;border:1px solid var(--border);border-radius:8px;margin-bottom:.6rem;cursor:pointer}
        .fp-check input{margin-top:.25rem;flex:0 0 auto}
        .fp-check span{display:flex;flex-direction:column;gap:.15rem}
        .fp-check small{color:var(--text2);font-size:12px;line-height:1.35}
        .fp-summary{margin-top:1rem;padding:.7rem .9rem;border-radius:8px;background:var(--bg3);font-size:13px;color:var(--text2);line-height:1.4}
      </style>
      <script>
      const $fp = id => document.getElementById(id);
      function pintarResumen(){
        const m = [];
        if ($fp('fIva').checked) m.push('IVA (303) y su resumen anual (390)');
        if ($fp('fIrpf').checked) m.push('IRPF, pago fraccionado (130)');
        if ($fp('fRetTrab').checked) m.push('retenciones de trabajo (111) y su resumen anual (190)');
        if ($fp('fRetAlq').checked) m.push('retenciones de alquiler (115) y su resumen anual (180)');
        $fp('fEspBox').style.display = $fp('fEsp').checked ? '' : 'none';
        // Solo ILUSTRATIVO: lo que DISA propone de verdad lo decide el servidor (calendario-fiscal.js).
        $fp('fpResumen').innerHTML = m.length
          ? '<strong>Con esto, te recordaré:</strong> ' + m.join(' · ') + '.'
          : 'Ahora mismo no me has dicho que presentes nada, así que <strong>no te recordaré ningún modelo</strong>. Marca lo que te toque.';
      }
      ['fIva','fIrpf','fRetTrab','fRetAlq','fEsp'].forEach(id => $fp(id).addEventListener('change', pintarResumen));
      api('GET','/api/erp/settings/fiscal-profile').then(d=>{
        $fp('fIva').checked = !!d.presenta_iva;
        $fp('fIrpf').checked = !!d.presenta_irpf_directa;
        $fp('fRetTrab').checked = !!d.tiene_retenciones_trabajo;
        $fp('fRetAlq').checked = !!d.tiene_retenciones_alquiler;
        $fp('fEsp').checked = !!d.situacion_especial;
        $fp('fNota').value = d.no_cubierto || '';
        if (!d.configured_at) $fp('fpWarn').innerHTML = '<div class="card" style="border-color:#f59e0b;margin-bottom:1rem"><div class="card-body" style="color:#b45309;font-size:13px">Aún no has declarado tu situación fiscal, así que <strong>DISA no te está recordando ningún vencimiento</strong>. Marca lo que presentas y guarda.</div></div>';
        pintarResumen();
      });
      async function guardar(){
        try{
          await api('PUT','/api/erp/settings/fiscal-profile',{
            presenta_iva:$fp('fIva').checked, presenta_irpf_directa:$fp('fIrpf').checked,
            tiene_retenciones_trabajo:$fp('fRetTrab').checked, tiene_retenciones_alquiler:$fp('fRetAlq').checked,
            situacion_especial:$fp('fEsp').checked, no_cubierto:$fp('fNota').value
          });
          toast('Guardado ✓'); $fp('fpWarn').innerHTML='';
        }catch(e){ toast(e.message||'Error','err'); }
      }
      </script>`;
    return c.html(adminLayout('Situación fiscal', content, 'settings', csrf, c));
  });

  storeViews.get('/', requirePerm('store_settings.read'), c => {
    const csrfToken = c.get('session')?.csrfToken || '';
    const hasCustom = !!db.prepare('SELECT homepage_sections FROM store_settings WHERE id=1').get()?.homepage_sections;
    const content = `
<style>
.sb-page{display:flex;flex-direction:column;height:calc(100vh - 52px);margin:-1.5rem;overflow:hidden}
.sb-topbar{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0}
.sb-name-input{background:none;border:none;border-bottom:1px solid var(--border);color:var(--text);font-size:15px;font-weight:500;padding:3px 6px;outline:none;width:210px;font-family:inherit}
.sb-name-input:focus{border-bottom-color:var(--teal)}
.sb-topbar-r{margin-left:auto;display:flex;align-items:center;gap:8px}
.sb-view-btn{background:none;border:1px solid var(--border);color:var(--text2);padding:6px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;font-family:inherit;transition:all .15s}
.sb-view-btn:hover{border-color:var(--border2);color:var(--text)}
.sb-publish-btn{background:var(--teal);color:var(--bg2);border:none;padding:7px 20px;border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:opacity .15s}
.sb-publish-btn:hover{opacity:.85}
.sb-body{display:flex;flex:1;overflow:hidden}
.sb-left{width:400px;min-width:380px;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--bg2);overflow:hidden}
.sb-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.sb-tab{flex:1;padding:10px 4px;font-size:11px;font-weight:500;color:var(--text3);border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;font-family:inherit;transition:all .15s}
.sb-tab.active{color:var(--teal);border-bottom-color:var(--teal)}
.sb-tab:hover:not(.active){color:var(--text2)}
.sb-panel{flex:1;overflow-y:auto;display:none;flex-direction:column;min-height:0}
.sb-panel.active{display:flex}
.sb-right{flex:1;display:flex;flex-direction:column;background:var(--bg2)}
.sb-preview-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--bg3);flex-shrink:0}
.sb-dev-btns{display:flex;gap:3px}
.sb-dev-btn{display:flex;align-items:center;gap:4px;background:none;border:1px solid transparent;color:var(--text3);padding:4px 10px;border-radius:5px;font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s}
.sb-dev-btn.active{background:rgba(58,65,80,.12);border-color:var(--teal);color:var(--teal)}
.sb-iframe-wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:12px}
#sbIframe{border:none;background:var(--bg2);box-shadow:0 8px 40px rgba(0,0,0,.5);transition:all .3s}
#sbIframe.desktop{width:100%;height:100%;border-radius:3px}
#sbIframe.mobile{width:375px;height:667px;border:10px solid var(--bg3);border-radius:32px}
/* DISA chat */
.sb-chat-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0}
.sb-bubble{max-width:85%;padding:9px 13px;border-radius:12px;font-size:13px;line-height:1.55;word-break:break-word}
.sb-bubble.user{background:linear-gradient(135deg,var(--accent),var(--accent-d));color:var(--bg2);align-self:flex-end;border-radius:12px 12px 3px 12px}
.sb-bubble.assistant{background:var(--bg2);border:1px solid var(--border);color:var(--text);align-self:flex-start;border-radius:12px 12px 12px 3px}
.sb-style-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-self:flex-start}
.sb-style-chip{background:rgba(58,65,80,0.1);border:1px solid rgba(58,65,80,0.3);color:var(--accent);padding:5px 14px;border-radius:20px;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s}
.sb-style-chip:hover{background:rgba(58,65,80,.22)}
.sb-chat-foot{flex-shrink:0;padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:7px}
#sbChatIn{flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px;font-family:inherit;outline:none;height:36px}
#sbChatIn:focus{border-color:var(--teal)}
.sb-send-btn{width:36px;height:36px;background:var(--teal);border:none;border-radius:8px;color:var(--bg2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sb-typing{display:flex;gap:4px;padding:6px 4px;align-self:flex-start}
.sb-typing span{width:6px;height:6px;border-radius:50%;background:var(--text2);animation:sbdot 1.2s infinite}
.sb-typing span:nth-child(2){animation-delay:.2s}
.sb-typing span:nth-child(3){animation-delay:.4s}
@keyframes sbdot{0%,60%,100%{opacity:.25;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}
/* Templates */
.sb-tpl-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px}
.sb-tpl-card{background:var(--bg3);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;transition:all .15s;position:relative}
.sb-tpl-card:hover{border-color:var(--teal);background:rgba(58,65,80,.04)}
.sb-tpl-card.active{border-color:var(--teal);box-shadow:0 0 0 1px var(--teal)}
.sb-tpl-badge{position:absolute;top:7px;right:7px;background:var(--teal);color:var(--bg2);font-size:9px;font-weight:500;padding:2px 6px;border-radius:8px}
.sb-tpl-mock{width:100%;height:80px;overflow:hidden}
.sb-tpl-info{padding:7px 9px}
.sb-tpl-name{font-size:12px;font-weight:500;color:var(--text);margin-bottom:1px}
.sb-tpl-desc{font-size:10px;color:var(--text3)}
/* Blocks */
.sb-blk-wrap{display:flex;flex-direction:column;flex:1;overflow:hidden}
.sb-blk-lib{padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.sb-blk-label{font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:7px}
.sb-blk-chips{display:flex;flex-wrap:wrap;gap:5px}
.sb-blk-chip{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--text2);cursor:pointer;font-family:inherit;transition:all .15s}
.sb-blk-chip:hover{background:rgba(58,65,80,.1);border-color:rgba(58,65,80,.3);color:var(--teal)}
.sb-sec-list-wrap{flex:1;overflow-y:auto;padding:8px 10px;min-height:0}
.sb-sec-row{display:flex;align-items:center;gap:7px;padding:7px 9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;margin-bottom:4px;cursor:default;transition:all .15s;user-select:none}
.sb-sec-row:hover{background:var(--border);border-color:var(--border2)}
.sb-sec-row.selected{border-color:var(--teal);background:rgba(58,65,80,.08)}
.sb-handle{cursor:grab;color:var(--text3);font-size:15px;line-height:1;padding:0 1px}
.sb-sec-label{flex:1;font-size:12px;font-weight:500;color:var(--text2)}
.sb-sec-btns{display:flex;gap:2px}
.sb-sec-btn{background:none;border:none;cursor:pointer;padding:3px 4px;border-radius:4px;color:var(--text3);font-size:12px;font-family:inherit;transition:color .12s;line-height:1}
.sb-sec-btn.edit:hover{color:var(--teal)}
.sb-sec-btn.del:hover{color:var(--danger)}
.sb-editor-wrap{flex-shrink:0;max-height:260px;overflow-y:auto;border-top:1px solid var(--border);padding:10px 12px}
.sb-editor-empty{color:var(--text3);font-size:12px;text-align:center;padding:18px 0}
/* pulse dot */
.sb-live-dot{width:7px;height:7px;border-radius:50%;background:var(--teal);display:inline-block;animation:sbdot 2s infinite}
</style>

<div class="sb-page">
<div class="sb-topbar">
  <span style="font-size:16px">🏪</span>
  <input id="sbStoreName" class="sb-name-input" placeholder="Nombre de tu tienda" oninput="sbState.settings.store_name=this.value">
  <div class="sb-topbar-r">
    <!-- D1 — tienda pública apagada: enlace neutralizado (/store da 404). El resto del constructor es D2. -->
    <span class="sb-view-btn" style="opacity:.5;cursor:not-allowed" title="La tienda pública está desactivada (D1)">Tienda desactivada</span>
    <button class="sb-publish-btn" onclick="sbPublish()">Publicar cambios</button>
  </div>
</div>
<div class="sb-body">
  <!-- LEFT -->
  <div class="sb-left">
    <div class="sb-tabs">
      <button class="sb-tab active" onclick="sbTab('disa',this)">✦ DISA construye</button>
      <button class="sb-tab" onclick="sbTab('templates',this)">Plantillas</button>
      <button class="sb-tab" onclick="sbTab('blocks',this)">Constructor</button>
    </div>

    <!-- TAB 1: DISA -->
    <div class="sb-panel active" id="sbp-disa">
      <div class="sb-chat-msgs" id="sbMsgs"></div>
      <div class="sb-chat-foot">
        <input id="sbChatIn" placeholder="Pídele algo a DISA..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sbSend()}">
        <button class="sb-send-btn" onclick="sbSend()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>

    <!-- TAB 2: TEMPLATES -->
    <div class="sb-panel" id="sbp-templates">
      <div class="sb-tpl-grid" id="sbTplGrid"></div>
    </div>

    <!-- TAB 3: BLOCKS -->
    <div class="sb-panel" id="sbp-blocks">
      <div class="sb-blk-wrap">
        <div class="sb-blk-lib">
          <div class="sb-blk-label">Librería — click para añadir</div>
          <div class="sb-blk-chips">
            <button class="sb-blk-chip" onclick="sbAddSec('hero')">👋 Hero</button>
            <button class="sb-blk-chip" onclick="sbAddSec('featured_products')">📦 Productos</button>
            <button class="sb-blk-chip" onclick="sbAddSec('features')">⭐ Features</button>
            <button class="sb-blk-chip" onclick="sbAddSec('testimonials')">💬 Testimonios</button>
            <button class="sb-blk-chip" onclick="sbAddSec('newsletter')">✉️ Newsletter</button>
          </div>
        </div>
        <div class="sb-blk-label" style="padding:8px 12px 2px;margin-bottom:0">Secciones activas</div>
        <div class="sb-sec-list-wrap" id="sbSecList"></div>
        <div class="sb-editor-wrap" id="sbEditor"><div class="sb-editor-empty">Selecciona una sección para editarla</div></div>
      </div>
    </div>
  </div>

  <!-- RIGHT: PREVIEW -->
  <div class="sb-right">
    <div class="sb-preview-bar">
      <span style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:6px">
        <span class="sb-live-dot"></span>Vista previa
      </span>
      <div class="sb-dev-btns">
        <button class="sb-dev-btn active" onclick="sbDev('desktop',this)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>Escritorio
        </button>
        <button class="sb-dev-btn" onclick="sbDev('mobile',this)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>Móvil
        </button>
      </div>
    </div>
    <div class="sb-iframe-wrap">
      <iframe id="sbIframe" class="desktop"></iframe>
    </div>
  </div>
</div>
</div>

<script src="/public/vendor/sortablejs/Sortable.min.js"></script>
<script>
const CSRF = ${JSON.stringify(csrfToken)};
const HAS_CUSTOM = ${hasCustom ? 'true' : 'false'};

const SEC_META = {
  hero:{ label:'Hero / Banner', icon:'👋' },
  featured_products:{ label:'Productos Destacados', icon:'📦' },
  features:{ label:'Features', icon:'⭐' },
  testimonials:{ label:'Testimonios', icon:'💬' },
  newsletter:{ label:'Newsletter', icon:'✉️' }
};

const DEF_SECS = [
  {id:'hero',type:'hero',active:true,settings:{title:'Calidad en cada detalle',subtitle:'Descubre nuestra colección exclusiva.',btn_text:'Ver catálogo',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
  {id:'fp',type:'featured_products',active:true,settings:{title:'Productos Destacados',subtitle:'Nuestra selección especial',limit:8}},
  {id:'feat',type:'features',active:true,settings:{title:'Por qué elegirnos',subtitle:'',items:[{icon:'🚚',title:'Envío Express',desc:'24/48h con seguimiento.'},{icon:'🛡️',title:'Pago Seguro',desc:'SSL de nivel bancario.'},{icon:'🔄',title:'Devoluciones',desc:'30 días garantizados.'}]}},
  {id:'testi',type:'testimonials',active:true,settings:{title:'Clientes Satisfechos',subtitle:'',items:[{name:'Sofía M.',rating:5,comment:'¡Superó mis expectativas!'},{name:'Alejandro S.',rating:5,comment:'Envío rapidísimo.'},{name:'Laura B.',rating:4,comment:'Calidad premium.'}]}},
  {id:'nl',type:'newsletter',active:true,settings:{title:'Únete a nuestro Club',subtitle:'10% de descuento en tu primera compra.',btn_text:'Suscribirme'}}
];

const TMPLS = [
  {id:'minimal_light',name:'Minimal Light',desc:'Limpio, escandinavo',theme:'minimal_light',color:'#10b981',pop:true,
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="var(--bg)"/><rect width="200" height="18" fill="#fff"/><rect x="8" y="5" width="36" height="8" rx="2" fill="#0f172a"/><rect x="155" y="5" width="36" height="8" rx="3" fill="#10b981"/><rect x="40" y="26" width="120" height="10" rx="2" fill="#0f172a"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#94a3b8"/><rect x="70" y="50" width="60" height="9" rx="4" fill="#10b981"/><rect x="8" y="66" width="56" height="10" rx="3" fill="#f1f5f9"/><rect x="72" y="66" width="56" height="10" rx="3" fill="#f1f5f9"/><rect x="136" y="66" width="56" height="10" rx="3" fill="#f1f5f9"/></svg>'},
  {id:'minimal_dark',name:'Minimal Dark',desc:'Oscuro, elegante, premium',theme:'minimal_dark',color:'#10b981',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#0f172a"/><rect width="200" height="18" fill="#1e293b"/><rect x="8" y="5" width="36" height="8" rx="2" fill="var(--bg)"/><rect x="155" y="5" width="36" height="8" rx="3" fill="#10b981"/><rect x="40" y="26" width="120" height="10" rx="2" fill="var(--bg)"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#475569"/><rect x="70" y="50" width="60" height="9" rx="4" fill="#10b981"/><rect x="8" y="66" width="56" height="10" rx="3" fill="#1e293b"/><rect x="72" y="66" width="56" height="10" rx="3" fill="#1e293b"/><rect x="136" y="66" width="56" height="10" rx="3" fill="#1e293b"/></svg>'},
  {id:'nordic_forest',name:'Nordic Forest',desc:'Natural, orgánico',theme:'nordic_forest',color:'#1b4d3e',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#f4f3ef"/><rect width="200" height="18" fill="#f4f3ef" stroke="#d4cfc4" stroke-width="1"/><rect x="8" y="5" width="36" height="8" rx="1" fill="#1c2e24"/><rect x="155" y="5" width="36" height="8" rx="1" fill="#1b4d3e"/><rect x="40" y="26" width="120" height="10" rx="1" fill="#1c2e24"/><rect x="55" y="40" width="90" height="5" rx="0" fill="#6b7280"/><rect x="70" y="50" width="60" height="9" rx="1" fill="#1b4d3e"/><rect x="8" y="66" width="56" height="10" rx="1" fill="#e8e6e0"/><rect x="72" y="66" width="56" height="10" rx="1" fill="#e8e6e0"/><rect x="136" y="66" width="56" height="10" rx="1" fill="#e8e6e0"/></svg>'},
  {id:'bold_tech',name:'Bold Tech',desc:'Brutalismo digital',theme:'bold_tech',color:'#000000',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#fff"/><rect width="200" height="18" fill="#fff" stroke="#000" stroke-width="2"/><rect x="8" y="5" width="36" height="8" fill="#000"/><rect x="155" y="5" width="36" height="8" fill="#ffff00" stroke="#000" stroke-width="1"/><rect x="40" y="26" width="120" height="12" fill="#000"/><rect x="70" y="50" width="60" height="10" fill="#ffff00" stroke="#000" stroke-width="2"/><rect x="8" y="66" width="56" height="10" fill="#fff" stroke="#000" stroke-width="2"/><rect x="72" y="66" width="56" height="10" fill="#fff" stroke="#000" stroke-width="2"/><rect x="136" y="66" width="56" height="10" fill="#fff" stroke="#000" stroke-width="2"/></svg>'},
  {id:'vintage_warm',name:'Vintage Warm',desc:'Retro, artesanal, cálido',theme:'vintage_warm',color:'#c84b31',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#faf6f0"/><rect width="200" height="18" fill="#faf6f0" stroke="#e8d5b7" stroke-width="1"/><rect x="8" y="5" width="36" height="8" rx="1" fill="#5c3d2e"/><rect x="155" y="5" width="36" height="8" rx="2" fill="#c84b31"/><rect x="40" y="26" width="120" height="10" rx="1" fill="#5c3d2e"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#9e8060"/><rect x="70" y="50" width="60" height="9" rx="2" fill="#c84b31"/><rect x="8" y="66" width="56" height="10" rx="2" fill="#f0e8d8"/><rect x="72" y="66" width="56" height="10" rx="2" fill="#f0e8d8"/><rect x="136" y="66" width="56" height="10" rx="2" fill="#f0e8d8"/></svg>'},
  {id:'boutique_premium',name:'Boutique Premium',desc:'Rosa, lujo, moda',theme:'minimal_light',color:'#ec4899',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#fff0f7"/><rect width="200" height="18" fill="#fff"/><rect x="8" y="5" width="36" height="8" rx="2" fill="#831843"/><rect x="155" y="5" width="36" height="8" rx="3" fill="#ec4899"/><rect x="40" y="26" width="120" height="10" rx="2" fill="#831843"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#f9a8d4"/><rect x="70" y="50" width="60" height="9" rx="4" fill="#ec4899"/><rect x="8" y="66" width="56" height="10" rx="3" fill="#fce7f3"/><rect x="72" y="66" width="56" height="10" rx="3" fill="#fce7f3"/><rect x="136" y="66" width="56" height="10" rx="3" fill="#fce7f3"/></svg>'}
];

const TMPL_SECS = {
  minimal_light: null,
  minimal_dark: null,
  nordic_forest: [
    {id:'hero',type:'hero',active:true,settings:{title:'Hecho con amor y naturaleza',subtitle:'Productos artesanales de origen sostenible.',btn_text:'Explorar',btn_link:'/store/catalog',align:'left',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'Selección Natural',subtitle:'Productos cuidadosamente elegidos',limit:6}},
    {id:'feat',type:'features',active:true,settings:{title:'Nuestros valores',subtitle:'',items:[{icon:'🌿',title:'Sostenible',desc:'Materiales de origen responsable.'},{icon:'🤝',title:'Artesanal',desc:'Hecho a mano con dedicación.'},{icon:'♻️',title:'Eco',desc:'Packaging 100% reciclable.'}]}},
    {id:'testi',type:'testimonials',active:true,settings:{title:'Familias que confían',subtitle:'',items:[{name:'Ana G.',rating:5,comment:'Productos increíbles.'},{name:'Carlos R.',rating:5,comment:'Calidad inigualable.'},{name:'María L.',rating:5,comment:'Mi tienda favorita.'}]}}
  ],
  bold_tech: [
    {id:'hero',type:'hero',active:true,settings:{title:'TECNOLOGÍA SIN LÍMITES',subtitle:'Los productos más avanzados del mercado.',btn_text:'COMPRAR AHORA',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'TOP PRODUCTOS',subtitle:'Lo mejor de lo mejor',limit:8}},
    {id:'feat',type:'features',active:true,settings:{title:'POR QUÉ NOSOTROS',subtitle:'',items:[{icon:'⚡',title:'VELOCIDAD',desc:'Envío express garantizado.'},{icon:'🔒',title:'SEGURIDAD',desc:'Pago 100% protegido.'},{icon:'🏆',title:'CALIDAD',desc:'Solo las mejores marcas.'}]}},
    {id:'nl',type:'newsletter',active:true,settings:{title:'CLUB PREMIUM',subtitle:'Acceso anticipado y ofertas exclusivas.',btn_text:'REGISTRARME'}}
  ],
  vintage_warm: [
    {id:'hero',type:'hero',active:true,settings:{title:'Tradición y calidez en cada pieza',subtitle:'Artesanía con historia, diseño con alma.',btn_text:'Descubrir',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'Piezas seleccionadas',subtitle:'Con cariño, para ti',limit:6}},
    {id:'testi',type:'testimonials',active:true,settings:{title:'Lo que dicen nuestros clientes',subtitle:'',items:[{name:'Elena M.',rating:5,comment:'Regresé inmediatamente a comprar más.'},{name:'José A.',rating:5,comment:'Calidad única.'},{name:'Pilar G.',rating:5,comment:'El mejor regalo que he hecho.'}]}},
    {id:'nl',type:'newsletter',active:true,settings:{title:'Recibe novedades con encanto',subtitle:'Sé el primero en conocer nuestras colecciones.',btn_text:'Suscribirme'}}
  ],
  boutique_premium: [
    {id:'hero',type:'hero',active:true,settings:{title:'Donde el estilo es protagonista',subtitle:'Moda exclusiva y accesorios de diseño para ti.',btn_text:'Ver colección',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'Colección Exclusiva',subtitle:'Piezas únicas seleccionadas',limit:8}},
    {id:'feat',type:'features',active:true,settings:{title:'La experiencia Boutique',subtitle:'',items:[{icon:'👗',title:'Edición limitada',desc:'Piezas únicas y exclusivas.'},{icon:'🎁',title:'Packaging premium',desc:'Presentación de lujo.'},{icon:'💌',title:'Personal shopper',desc:'Asesoramiento personalizado.'}]}},
    {id:'testi',type:'testimonials',active:true,settings:{title:'Nuestras clientas',subtitle:'',items:[{name:'Valentina C.',rating:5,comment:'Calidad de lujo a precio justo.'},{name:'Sofía R.',rating:5,comment:'Me siento especial con cada compra.'},{name:'Isabella M.',rating:5,comment:'Mi boutique de referencia.'}]}},
    {id:'nl',type:'newsletter',active:true,settings:{title:'Club Boutique Premium',subtitle:'Acceso exclusivo a lanzamientos y descuentos VIP.',btn_text:'Unirme al club'}}
  ]
};

const sbState = { settings:{ store_name:'',tagline:'',logo_url:'',banner_url:'',primary_color:'#10b981',announcement:'',facebook_url:'',instagram_url:'',twitter_url:'',terms_html:'',privacy_html:'',returns_html:'',seo_title:'',seo_description:'',theme:'minimal_light' }, sections:[], sel:null };
let sbPrevTimer = null;
let sbHistory = [];
let sbBusy = false;

// ── Init ─────────────────────────────────────────────────────────────
async function sbInit() {
  try {
    const r = await fetch('/api/erp/settings/store', { headers: {'x-csrf-token': CSRF} });
    const d = await r.json();
    Object.assign(sbState.settings, {
      store_name:d.store_name||'', tagline:d.tagline||'', logo_url:d.logo_url||'', banner_url:d.banner_url||'',
      primary_color:d.primary_color||'#10b981', announcement:d.announcement||'',
      facebook_url:d.facebook_url||'', instagram_url:d.instagram_url||'', twitter_url:d.twitter_url||'',
      terms_html:d.terms_html||'', privacy_html:d.privacy_html||'', returns_html:d.returns_html||'',
      seo_title:d.seo_title||'', seo_description:d.seo_description||'', theme:d.theme||'minimal_light'
    });
    try { sbState.sections = d.homepage_sections ? JSON.parse(d.homepage_sections) : deepCopy(DEF_SECS); }
    catch { sbState.sections = deepCopy(DEF_SECS); }
    document.getElementById('sbStoreName').value = sbState.settings.store_name;
    sbRenderTpls();
    sbRenderSecList();
    sbPreview();
    if (!HAS_CUSTOM) setTimeout(function() { sbAddMsg('assistant', '¡Hola! Soy DISA, tu constructora de tiendas 🏪 ¿Qué tipo de productos vendes?'); }, 500);
  } catch(e) { console.error('[SB]', e); }
}

function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }
function esc(v) { return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Tabs ──────────────────────────────────────────────────────────────
function sbTab(t, btn) {
  document.querySelectorAll('.sb-tab').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.sb-panel').forEach(function(p){ p.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('sbp-' + t).classList.add('active');
}

// ── Preview ───────────────────────────────────────────────────────────
function sbPreview() {
  // D1 — tienda pública apagada: /store da 404, así que NO se carga la previsualización en vivo.
  // (El constructor de tienda es D2; aquí solo se neutraliza el resto muerto que apuntaba a /store.)
  var ifr = document.getElementById('sbIframe');
  if (ifr) { ifr.removeAttribute('src'); ifr.srcdoc = '<div style="font-family:system-ui;padding:2rem;color:var(--text2)">Previsualización no disponible: la tienda pública está desactivada (D1).</div>'; }
}
function sbTrigger() { clearTimeout(sbPrevTimer); sbPrevTimer = setTimeout(sbPreview, 400); }
function sbDev(d, btn) {
  document.querySelectorAll('.sb-dev-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('sbIframe').className = d === 'mobile' ? 'mobile' : 'desktop';
}

// ── Publish ───────────────────────────────────────────────────────────
async function sbPublish() {
  var btn = document.querySelector('.sb-publish-btn');
  var orig = btn.textContent;
  btn.textContent = 'Guardando...'; btn.disabled = true;
  try {
    var s = sbState.settings;
    await fetch('/api/erp/settings/store', {
      method: 'PUT',
      headers: {'Content-Type':'application/json','x-csrf-token':CSRF},
      body: JSON.stringify({
        store_name: document.getElementById('sbStoreName').value || s.store_name,
        tagline:s.tagline, logo_url:s.logo_url, banner_url:s.banner_url,
        primary_color:s.primary_color, announcement:s.announcement,
        facebook_url:s.facebook_url, instagram_url:s.instagram_url, twitter_url:s.twitter_url,
        terms_html:s.terms_html, privacy_html:s.privacy_html, returns_html:s.returns_html,
        seo_title:s.seo_title, seo_description:s.seo_description,
        theme:s.theme, homepage_sections:JSON.stringify(sbState.sections)
      })
    });
    btn.textContent = '✓ Publicado';
    setTimeout(function(){ btn.textContent = orig; btn.disabled = false; sbPreview(); }, 2000);
  } catch(e) {
    btn.textContent = 'Error';
    setTimeout(function(){ btn.textContent = orig; btn.disabled = false; }, 2000);
  }
}

// ── Templates ─────────────────────────────────────────────────────────
function sbRenderTpls() {
  var grid = document.getElementById('sbTplGrid');
  if (!grid) return;
  grid.innerHTML = TMPLS.map(function(t) {
    var active = (sbState.settings.theme === t.theme && sbState.settings.primary_color === t.color) ? ' active' : '';
    var badge = t.pop ? '<span class="sb-tpl-badge">★ Popular</span>' : '';
    return '<div class="sb-tpl-card' + active + '" onclick="sbApplyTpl(\'' + t.id + '\')">'
      + badge + '<div class="sb-tpl-mock">' + t.svg + '</div>'
      + '<div class="sb-tpl-info"><div class="sb-tpl-name">' + t.name + '</div><div class="sb-tpl-desc">' + t.desc + '</div></div></div>';
  }).join('');
}

function sbApplyTpl(id) {
  var t = TMPLS.find(function(x){ return x.id === id; });
  if (!t) return;
  sbState.settings.theme = t.theme;
  sbState.settings.primary_color = t.color;
  var secs = TMPL_SECS[id];
  sbState.sections = secs ? deepCopy(secs) : deepCopy(DEF_SECS);
  sbRenderTpls(); sbRenderSecList(); sbPreview();
  if (typeof toast === 'function') toast('Plantilla "' + t.name + '" aplicada — recuerda publicar');
}

// ── Blocks ────────────────────────────────────────────────────────────
var SEC_DEFAULTS = {
  hero:{title:'Título aquí',subtitle:'Subtítulo.',btn_text:'Ver más',btn_link:'/store/catalog',align:'center',use_banner_bg:false},
  featured_products:{title:'Productos Destacados',subtitle:'',limit:8},
  features:{title:'Nuestras ventajas',subtitle:'',items:[{icon:'⭐',title:'Ventaja 1',desc:'Descripción.'}]},
  testimonials:{title:'Testimonios',subtitle:'',items:[{name:'Cliente',rating:5,comment:'Excelente.'}]},
  newsletter:{title:'Suscríbete',subtitle:'Recibe novedades.',btn_text:'Suscribirme'}
};

function sbAddSec(type) {
  if (sbState.sections.find(function(s){ return s.type === type; })) {
    if (typeof toast === 'function') toast('Ya existe una sección ' + type, 'err'); return;
  }
  sbState.sections.push({id:type+'_'+Date.now(),type:type,active:true,settings:deepCopy(SEC_DEFAULTS[type]||{})});
  sbState.sel = sbState.sections.length - 1;
  sbRenderSecList(); sbRenderEditor(); sbTrigger();
  var el = document.getElementById('sbSecList'); if (el) el.scrollTop = el.scrollHeight;
}

function sbRemoveSec(i) {
  sbState.sections.splice(i, 1);
  if (sbState.sel === i) sbState.sel = null;
  else if (sbState.sel > i) sbState.sel--;
  sbRenderSecList(); sbRenderEditor(); sbTrigger();
}

function sbSelSec(i) {
  sbState.sel = i; sbRenderSecList(); sbRenderEditor();
  document.getElementById('sbEditor').scrollIntoView({behavior:'smooth',block:'nearest'});
}

function sbRenderSecList() {
  var el = document.getElementById('sbSecList');
  if (!el) return;
  if (!sbState.sections.length) {
    el.innerHTML = '<div style="padding:14px;font-size:11px;color:var(--text3);text-align:center">Sin secciones — añade bloques arriba</div>'; return;
  }
  el.innerHTML = sbState.sections.map(function(s, i) {
    var m = SEC_META[s.type] || {label:s.type, icon:'⚙️'};
    return '<div class="sb-sec-row' + (sbState.sel === i ? ' selected' : '') + '" id="sbsr-' + i + '">'
      + '<span class="sb-handle">≡</span>'
      + '<span class="sb-sec-label">' + m.icon + ' ' + m.label + '</span>'
      + '<div class="sb-sec-btns">'
      + '<button class="sb-sec-btn edit" onclick="sbSelSec(' + i + ')" title="Editar">✏</button>'
      + '<button class="sb-sec-btn del" onclick="sbRemoveSec(' + i + ')" title="Eliminar">✕</button>'
      + '</div></div>';
  }).join('');
  if (window.Sortable && !el._sb) {
    el._sb = new Sortable(el, {
      handle:'.sb-handle', animation:150,
      onEnd:function(e) {
        var m = sbState.sections.splice(e.oldIndex,1)[0];
        sbState.sections.splice(e.newIndex,0,m);
        if (sbState.sel === e.oldIndex) sbState.sel = e.newIndex;
        sbRenderSecList(); sbTrigger();
      }
    });
  }
}

function sbSetF(i, k, v) { if (!sbState.sections[i]) return; sbState.sections[i].settings[k] = v; sbTrigger(); }
function sbSetItem(si, ii, k, v) {
  if (!sbState.sections[si]) return;
  if (!sbState.sections[si].settings.items) sbState.sections[si].settings.items = [];
  if (!sbState.sections[si].settings.items[ii]) sbState.sections[si].settings.items[ii] = {};
  sbState.sections[si].settings.items[ii][k] = v;
  if (k === 'comment') sbState.sections[si].settings.items[ii].quote = v;
  sbTrigger();
}

function sbRenderEditor() {
  var el = document.getElementById('sbEditor'); if (!el) return;
  var i = sbState.sel;
  if (i === null || i === undefined || !sbState.sections[i]) {
    el.innerHTML = '<div class="sb-editor-empty">Selecciona una sección para editarla</div>'; return;
  }
  var sec = sbState.sections[i];
  var m = SEC_META[sec.type] || {label:sec.type,icon:'⚙️'};
  var h = '<div style="margin-bottom:8px;font-size:11px;font-weight:500;color:var(--teal)">' + m.icon + ' ' + m.label + '</div>';
  function fi(label, key, val, type) {
    type = type || 'text';
    return '<div style="margin-bottom:6px"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:2px">' + label + '</label>'
      + '<input class="form-control" style="font-size:12px;padding:5px 8px" type="' + type + '" value="' + esc(val) + '" oninput="sbSetF(' + i + ',\'' + key + '\',this.value)"></div>';
  }
  function ta(label, key, val) {
    return '<div style="margin-bottom:6px"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:2px">' + label + '</label>'
      + '<textarea class="form-control" style="font-size:12px;padding:5px 8px;min-height:52px" oninput="sbSetF(' + i + ',\'' + key + '\',this.value)">' + esc(val) + '</textarea></div>';
  }
  function sl(label, key, val, opts) {
    var os = opts.map(function(o){ return '<option value="' + o.v + '"' + (String(val) === String(o.v) ? ' selected' : '') + '>' + o.l + '</option>'; }).join('');
    return '<div style="margin-bottom:6px"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:2px">' + label + '</label>'
      + '<select class="form-control" style="font-size:12px;padding:5px 8px" onchange="sbSetF(' + i + ',\'' + key + '\',this.value)">' + os + '</select></div>';
  }
  var s = sec.settings;
  if (sec.type === 'hero') {
    h += fi('Título','title',s.title) + ta('Subtítulo','subtitle',s.subtitle)
       + fi('Texto botón','btn_text',s.btn_text) + fi('Enlace botón','btn_link',s.btn_link)
       + sl('Alineación','align',s.align,[{v:'left',l:'Izquierda'},{v:'center',l:'Centro'},{v:'right',l:'Derecha'}]);
  } else if (sec.type === 'featured_products') {
    h += fi('Título','title',s.title) + fi('Subtítulo','subtitle',s.subtitle)
       + sl('Límite de productos','limit',String(s.limit||8),[{v:'4',l:'4 productos'},{v:'6',l:'6 productos'},{v:'8',l:'8 productos'},{v:'12',l:'12 productos'}]);
  } else if (sec.type === 'features') {
    h += fi('Título','title',s.title);
    (s.items||[]).forEach(function(item,j) {
      h += '<div style="border:1px solid var(--border);border-radius:5px;padding:6px;margin-bottom:5px">'
        + '<div style="display:flex;gap:5px;margin-bottom:4px">'
        + '<div style="flex:0 0 40px"><label style="font-size:9px;color:var(--text3)">Icono</label><input class="form-control" style="font-size:12px;padding:3px;text-align:center" value="' + esc(item.icon) + '" oninput="sbSetItem(' + i + ',' + j + ',\'icon\',this.value)"></div>'
        + '<div style="flex:1"><label style="font-size:9px;color:var(--text3)">Título</label><input class="form-control" style="font-size:12px;padding:3px" value="' + esc(item.title) + '" oninput="sbSetItem(' + i + ',' + j + ',\'title\',this.value)"></div>'
        + '</div>'
        + '<input class="form-control" style="font-size:12px;padding:3px" placeholder="Descripción" value="' + esc(item.desc) + '" oninput="sbSetItem(' + i + ',' + j + ',\'desc\',this.value)">'
        + '</div>';
    });
  } else if (sec.type === 'testimonials') {
    h += fi('Título','title',s.title);
    (s.items||[]).forEach(function(item,j) {
      var stars = [5,4,3,2,1].map(function(n){ return '<option value="' + n + '"' + (item.rating===n?' selected':'') + '>' + n + '⭐</option>'; }).join('');
      h += '<div style="border:1px solid var(--border);border-radius:5px;padding:6px;margin-bottom:5px">'
        + '<div style="display:flex;gap:5px;margin-bottom:4px">'
        + '<div style="flex:1"><label style="font-size:9px;color:var(--text3)">Nombre</label><input class="form-control" style="font-size:12px;padding:3px" value="' + esc(item.name) + '" oninput="sbSetItem(' + i + ',' + j + ',\'name\',this.value)"></div>'
        + '<div style="flex:0 0 68px"><label style="font-size:9px;color:var(--text3)">Estrellas</label><select class="form-control" style="font-size:12px;padding:3px" onchange="sbSetItem(' + i + ',' + j + ',\'rating\',parseInt(this.value))">' + stars + '</select></div>'
        + '</div>'
        + '<textarea class="form-control" style="font-size:12px;padding:3px;min-height:40px" oninput="sbSetItem(' + i + ',' + j + ',\'comment\',this.value)">' + esc(item.comment||item.quote) + '</textarea>'
        + '</div>';
    });
  } else if (sec.type === 'newsletter') {
    h += fi('Título','title',s.title) + ta('Subtítulo','subtitle',s.subtitle) + fi('Texto botón','btn_text',s.btn_text);
  }
  el.innerHTML = h;
}

// ── DISA Chat ─────────────────────────────────────────────────────────
function sbAddMsg(role, text) {
  var msgs = document.getElementById('sbMsgs'); if (!msgs) return;
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;align-items:' + (role==='user'?'flex-end':'flex-start');
  var b = document.createElement('div');
  b.className = 'sb-bubble ' + role;
  b.textContent = text;
  row.appendChild(b); msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function sbAddStyleChips() {
  var msgs = document.getElementById('sbMsgs'); if (!msgs) return;
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start';
  var chips = document.createElement('div');
  chips.className = 'sb-style-chips';
  ['Natural','Moderno','Elegante','Minimalista','Artesanal'].forEach(function(s) {
    var btn = document.createElement('button');
    btn.className = 'sb-style-chip'; btn.textContent = s;
    btn.onclick = function() {
      chips.querySelectorAll('.sb-style-chip').forEach(function(b){ b.disabled = true; });
      sbSendText(s);
    };
    chips.appendChild(btn);
  });
  row.appendChild(chips); msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sbSend() {
  var input = document.getElementById('sbChatIn');
  var msg = input.value.trim(); if (!msg || sbBusy) return;
  input.value = ''; sbSendText(msg);
}

async function sbSendText(msg) {
  if (sbBusy) return;
  sbAddMsg('user', msg);
  sbHistory.push({role:'user',content:msg});
  sbBusy = true;
  var msgs = document.getElementById('sbMsgs');
  var typing = document.createElement('div');
  typing.className = 'sb-typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  if (msgs) { msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight; }
  try {
    var s = sbState.settings;
    var r = await fetch('/api/disa/store-message', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-csrf-token':CSRF},
      body: JSON.stringify({message:msg,history:sbHistory.slice(-8),store_state:{store_name:s.store_name,theme:s.theme,primary_color:s.primary_color,sections:sbState.sections}})
    });
    var data = await r.json();
    typing.remove(); sbBusy = false;
    var reply = data.reply || 'Sin respuesta.';
    sbAddMsg('assistant', reply);
    sbHistory.push({role:'assistant',content:reply});
    if (reply.toLowerCase().indexOf('estilo') !== -1 || reply.toLowerCase().indexOf('prefer') !== -1) sbAddStyleChips();
    if (data.action) sbApplyAction(data.action);
  } catch(e) { typing.remove(); sbBusy = false; sbAddMsg('assistant','Error al conectar. Inténtalo de nuevo.'); }
}

function sbApplyAction(action) {
  var t = action.type, p = action.params || {};
  if (t === 'update_store_theme' && p.theme) { sbState.settings.theme = p.theme; sbRenderTpls(); }
  else if (t === 'update_store_color' && p.primary_color) { sbState.settings.primary_color = p.primary_color; sbRenderTpls(); }
  else if (t === 'update_store_text' && p.field && p.value !== undefined) {
    sbState.settings[p.field] = p.value;
    if (p.field === 'store_name') { var inp = document.getElementById('sbStoreName'); if (inp) inp.value = p.value; }
  }
  else if (t === 'add_section' && p.type) { sbAddSec(p.type); return; }
  else if (t === 'remove_section' && p.type) {
    var idx = sbState.sections.findIndex(function(s){ return s.type === p.type; });
    if (idx >= 0) { sbRemoveSec(idx); return; }
  }
  else if (t === 'update_section' && p.type && p.settings) {
    var sec = sbState.sections.find(function(s){ return s.type === p.type; });
    if (sec) Object.assign(sec.settings, p.settings);
  }
  else if (t === 'apply_template' && p.template) { sbApplyTpl(p.template); return; }
  else if (t === 'reorder_sections' && Array.isArray(p.order)) {
    var ns = p.order.map(function(i){ return sbState.sections[i]; }).filter(Boolean);
    if (ns.length) sbState.sections = ns;
  }
  sbRenderSecList(); sbRenderEditor(); sbPreview();
}

// ── Boot ──────────────────────────────────────────────────────────────
sbInit();
</script>`;
    return c.html(adminLayout('Constructor de Tienda', content, 'store-settings', csrfToken, c));
  });

  return { api, views, storeViews };
}
