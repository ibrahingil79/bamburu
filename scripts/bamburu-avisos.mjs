#!/usr/bin/env node
//
// bamburu-avisos.mjs — el RESUMEN por correo. Un parte del negocio, por persona, a la hora que cada
// una haya elegido.
//
// QUÉ ERA Y QUÉ ES. Era una tarea DIARIA a las 8:00 que mandaba UN correo por negocio a
// `company_config.email` con el recuento de avisos ("233 avisos que requieren tu atención"). Tres
// problemas, y los tres se cierran aquí:
//   · No se podía apagar, ni mover de hora, ni recortar. Ahora cada persona manda sobre lo suyo
//     (avisos_pref_usuario) y puede dejar de recibirlo desde el pie del propio correo.
//   · No filtraba por permisos. Iba al correo del NEGOCIO, así que el recuento incluía lo que quien
//     lo leyera no podía ver en pantalla. Ahora va POR PERSONA y se calcula con las mismas fuentes
//     permitidas que usa la campana (`fuentesDe`, en avisos.js: una sola tabla de permisos).
//   · Contaba un montón, no contaba el negocio. Ahora lleva el parte del día en frases, con enlace
//     directo a cada cosa (parte-diario.js).
//
// Y el destinatario cambia por una razón medida, no estética: `admin_users.email` es la identidad de
// login y existe en el 100 % de los usuarios, mientras que `company_config.email` estaba VACÍO en 6
// de los 7 negocios (17 ago 2026) — o sea, el correo diario solo podía llegar a uno. Se manda a la
// dirección personal; el correo del negocio queda como respaldo SOLO del dueño, y se reporta cuando
// se usa.
//
// EL TEMPORIZADOR ES HORARIO, no un planificador nuevo. En cada pasada se mira a quién le toca
// (`leToca`): su día, y su hora YA CUMPLIDA. Lo segundo importa — con `Persistent=true`, un servidor
// apagado varias horas provoca UNA pasada de recuperación, no una por hora perdida; con "hora
// exacta" se quedaba fuera todo el que tuviera una hora intermedia.
//
// LA REGLA INNEGOCIABLE: si no hay nada que contar, NO SE ENVÍA. Ni un "no tienes avisos". Pero sí
// queda constancia de que se evaluó (`resumen_envios`, con enviado=0 y su motivo): antes, un día sin
// avisos y un día en que el cron no llegó a correr se veían exactamente igual desde fuera.
//
// IDEMPOTENTE por (fecha, persona): dos pasadas seguidas a la misma hora dan UN correo.
//
//   node scripts/bamburu-avisos.mjs               # la pasada de esta hora, todos los negocios
//   node scripts/bamburu-avisos.mjs --dry-run     # calcula y reporta, NO envía ni registra
//   AVISOS_HORA=9 node scripts/bamburu-avisos.mjs # fuerza la hora (pruebas y gates)
//   AVISOS_DB=data/tenants/x.db node scripts/bamburu-avisos.mjs   # un solo negocio (pruebas)
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { avisosEmail, hoyLocal, fuentesDe, puedeDe, permisosDeUsuario } from '../modules/erp/avisos.js';
import { parteDelDia, parteHtml, parteTexto } from '../modules/erp/parte-diario.js';
import { getPref, leToca, horaLocal, yaRegistrado, registrar } from '../modules/erp/avisos-preferencias.js';
import { sendEmail } from '../core/mailer.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.argv.includes('--dry-run');
const TODAY = hoyLocal();                       // fecha local del negocio (Europe/Madrid)
const HORA = process.env.AVISOS_HORA !== undefined ? Number(process.env.AVISOS_HORA) : horaLocal();
const log = (...a) => console.log('[bamburu-avisos]', ...a);

function tenantDbs() {
  if (process.env.AVISOS_DB) return [process.env.AVISOS_DB];
  return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f));
}

const baseUrlDe = slug => {
  const dom = process.env.PUBLIC_BASE_DOMAIN;
  return dom && slug ? `https://${slug}.${dom}` : '';
};

async function processTenant(path) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  const r = { slug, enviados: 0, evaluados: 0, sinNada: 0, apagados: 0, noToca: 0, sinEmail: 0, errores: 0, respaldo: [] };
  try {
    runMigrations(db);   // idempotente: garantiza el esquema (el script no pasa por el middleware)

    // Los borradores de recurrentes vencidos se generan ANTES de calcular, para que el parte del día
    // ya los cuente. Idempotente (igual que antes de este cambio).
    try { (await import('../modules/erp/recurrentes.js')).generateDueOccurrences(db, TODAY); } catch { /* tenant sin esquema aún */ }

    const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const sym = company.currency_symbol || '€';
    const baseUrl = baseUrlDe(slug);
    const ajustesUrl = (baseUrl || '') + '/admin/settings/avisos';

    const usuarios = db.prepare('SELECT id, name, email, role FROM admin_users WHERE active=1 ORDER BY id').all();

    for (const u of usuarios) {
      const pref = getPref(db, u.id);
      const toca = leToca(pref, { hora: HORA, fecha: TODAY });

      if (!toca.toca) {
        // Apagado o "aún no es su hora": no se registra nada. Registrar el "no toca" de las 00:00
        // marcaría el día como resuelto y le robaría el correo de las 8:00 a esa misma persona.
        if (toca.motivo === 'apagado') r.apagados++; else r.noToca++;
        continue;
      }

      // IDEMPOTENCIA: ya evaluado hoy (enviado o no) → esta persona está resuelta para hoy.
      if (yaRegistrado(db, TODAY, u.id) && !DRY) { continue; }

      // El parte, con SUS permisos y SUS fuentes marcadas. `puedeDe`/`fuentesDe` son las mismas
      // funciones que resuelven la campana: aquí no se decide nada sobre permisos, se pregunta.
      const { role, perms } = permisosDeUsuario(db, u.id);
      const puede = puedeDe({ role, perms });
      let parte;
      try {
        parte = parteDelDia(db, { hoy: TODAY, puede, elegidas: pref.fuentes, sym });
      } catch (e) {
        r.errores++; log(slug + '/' + u.email + ': fallo al calcular el parte: ' + e.message);
        continue;
      }
      r.evaluados++;

      // LA REGLA INNEGOCIABLE. Nada que contar → no sale correo. Pero queda constancia.
      if (!parte.n) {
        r.sinNada++;
        if (!DRY) registrar(db, { fecha: TODAY, userId: u.id, enviado: 0, motivo: 'sin_nada_que_contar', lineas: 0 });
        continue;
      }

      // Destinatario: SU dirección. Sin ella, y solo si es el dueño, se cae al correo del negocio.
      let destino = (u.email || '').trim();
      let porRespaldo = false;
      if (!destino && u.role === 'owner' && company.email) { destino = company.email; porRespaldo = true; }
      if (!destino) {
        r.sinEmail++;
        if (!DRY) registrar(db, { fecha: TODAY, userId: u.id, enviado: 0, motivo: 'sin_email', lineas: parte.n });
        log(slug + ': ' + (u.name || u.id) + ' no tiene dirección de correo → no se le envía');
        continue;
      }
      if (porRespaldo) r.respaldo.push((u.name || u.id) + ' → ' + destino);

      const tpl = avisosEmail({
        avisos: parte.avisos, company, db,
        parteHtml: parteHtml(parte.frases, baseUrl),
        titular: parte.titular,
        ajustesUrl,
      });

      if (DRY) {
        log(slug + '/' + destino + ': [dry-run] ' + parte.n + ' línea(s) · "' + tpl.subject + '"');
        parte.frases.forEach(f => log('    · ' + f.texto));
        continue;
      }

      const payload = {
        from: 'Bamburu <noreply@bamburu.com>',
        to: destino,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text || (parteTexto(parte.frases) + '\n\nCambiar o dejar de recibir estos avisos: ' + ajustesUrl),
        ...(company.email ? { replyTo: company.email } : {}),
      };
      const { data, error } = await sendEmail(payload);
      if (error) {
        r.errores++;
        log(slug + '/' + destino + ': ERROR al enviar: ' + (error.message || JSON.stringify(error)));
        registrar(db, { fecha: TODAY, userId: u.id, enviado: 0, motivo: 'error', lineas: parte.n });
        continue;
      }
      registrar(db, { fecha: TODAY, userId: u.id, enviado: 1, motivo: 'enviado', lineas: parte.n });
      r.enviados++;
      log(slug + ': enviado a ' + destino + ' · ' + parte.n + ' línea(s) · id ' + (data && data.id));
    }

    // La marca DEL NEGOCIO se conserva tal cual estaba: `daily_alert_log` sigue siendo la fila por
    // día del tenant. No se amplía ni se recrea (su clave primaria es `fecha`, y ampliarla habría
    // sido destruir la tabla); la idempotencia por persona vive en `resumen_envios`.
    if (!DRY && r.enviados) {
      db.prepare('INSERT OR REPLACE INTO daily_alert_log (fecha, canal, avisos) VALUES (?,?,?)')
        .run(TODAY, 'email', r.enviados);
    }
    return r;
  } finally {
    db.close();
  }
}

let enviados = 0, sinNada = 0, fallos = 0;
const respaldos = [];
for (const path of tenantDbs()) {
  try {
    const r = await processTenant(path);
    enviados += r.enviados; sinNada += r.sinNada; fallos += r.errores;
    if (r.respaldo.length) respaldos.push(r.slug + ': ' + r.respaldo.join(', '));
    if (r.evaluados) log(r.slug + ': ' + r.evaluados + ' evaluado(s) · ' + r.enviados + ' enviado(s) · ' + r.sinNada + ' sin nada que contar');
  } catch (e) {
    fallos++;
    log(basename(path) + ': EXCEPCIÓN: ' + e.message);
  }
}
log('Resumen ' + TODAY + ' ' + String(HORA).padStart(2, '0') + ':00 · enviados=' + enviados
    + ', sin nada que contar=' + sinNada + ', fallos=' + fallos + (DRY ? ' (dry-run)' : ''));
// Se reporta, como pedía el encargo: quién ha recibido su parte en el correo del NEGOCIO por no
// tener dirección propia. Si esta lista deja de estar vacía, hay una ficha de usuario que arreglar.
if (respaldos.length) log('AL CORREO DEL NEGOCIO (el dueño no tiene dirección propia): ' + respaldos.join(' · '));
process.exit(fallos ? 1 : 0);
