// ════════════════════════════════════════════════════════════════════════════════════════════════
// MIGRACIÓN ASISTIDA — el destino real del paso «trae tus datos del programa anterior»
//
// LA REGLA QUE MANDA AQUÍ: **no se insinúa un importador automático que no existe.** Es la misma que
// se aplicó con WhatsApp en la ficha de cliente. La migración la hace **el equipo de Bamburu, a mano
// y gratis**, y la pantalla lo dice con esas palabras. Prometer una automatización que no está es
// peor que no ofrecer nada: el dueño deja de buscar la solución que sí tiene y se queda esperando.
//
// QUÉ HACE AL ENVIAR, en este orden:
//   1. Guarda la petición en `migracion_peticiones` (tabla aditiva, FUERA de WRITABLE_TABLES).
//   2. Manda un correo al equipo con el fichero adjunto, si lo hubo.
//   3. Acusa recibo EN PANTALLA y por correo al usuario, diciendo qué pasa ahora y en cuánto.
//
// EL REGISTRO SE GUARDA AUNQUE EL CORREO FALLE. Un envío que no sale no puede tirar por la borda lo
// que el dueño acaba de escribir: queda apuntado, `email_ok` dice que no salió, y la pantalla lo
// dice sin disimular en vez de fingir que todo fue bien.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { escHtml } from '../../../core/escape.js';
import { saveAttachment } from '../attachments.js';
import { sendEmail } from '../../../core/mailer.js';
import { exigirCorreoActivo } from '../avisos-preferencias.js';

const MAX_BYTES = 12 * 1024 * 1024;                 // 12 MB, el mismo tope que la captura de facturas
// A DÓNDE VA LA PETICIÓN. Por orden: lo que diga el negocio en `settings`, lo que diga el entorno
// de la instalación, y si no, el buzón de Bamburu. El primer escalón existe para que un gate pueda
// apuntar al buzón sumidero de Resend y probar el envío DE VERDAD sin mandarle correo a una persona
// — probar el envío contra un buzón real sería spam, y no probarlo sería no verificar nada.
// EL BUZÓN DEL EQUIPO. Estaba puesto en `hola@bamburu.com` y **esa dirección REBOTA**: el dominio
// bamburu.com está verificado en Resend para ENVIAR, con la recepción DESACTIVADA, así que no hay
// buzón detrás. Medido el 24 ago 2026 mandando una sonda: Resend acepta el correo (por eso
// `email_ok` decía 1) y el estado final es `bounced`. O sea: la petición salía, nadie la recibía
// y el registro decía que había ido bien.
// Se pone la dirección que SÍ recibe —la misma que ya usan los avisos de copia de seguridad— y
// se deja configurable por `settings.migracion_buzon` o por la variable de entorno.
// CONFIRMADA POR IBRAHIN el 24 ago 2026: `ibrahingil@gmail.com` es la buena. Comprobado que
// además LLEGA, no solo que Resend la acepte: el envío de las 10:32 figura como `delivered`
// (`hola@bamburu.com` figuraba como `bounced`, que es de donde salió todo esto).
const BUZON_POR_DEFECTO = process.env.BAMBURU_MIGRACIONES_EMAIL || 'ibrahingil@gmail.com';
function buzonDe(db) {
  try {
    const v = db.prepare("SELECT value FROM settings WHERE key='migracion_buzon'").get()?.value;
    return (v && String(v).includes('@')) ? String(v) : BUZON_POR_DEFECTO;
  } catch { return BUZON_POR_DEFECTO; }
}

export const ORIGENES = {
  holded: 'Holded',
  quipu:  'Quipu',
  excel:  'Excel o CSV',
  otro:   'Otro programa',
};
export const COSAS = {
  clientes:    'Clientes',
  productos:   'Productos y servicios',
  facturas:    'Facturas',
  proveedores: 'Proveedores',
};

export function createMigracionRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  const empresa = () => db.prepare('SELECT company_name, email FROM company_config WHERE id=1').get() || {};

  // ── PEDIR LA MIGRACIÓN ────────────────────────────────────────────────────────────────────────
  // `company.update` porque es una decisión sobre los datos del negocio entero, no del usuario.
  api.post('/', requirePerm('company.update'),
    bodyLimit({ maxSize: MAX_BYTES, onError: c => c.json({ error: 'El archivo supera el máximo de 12 MB. Mándalo en varias partes o escríbenos y lo vemos.' }, 413) }),
    async c => {
      try {
        const body = await c.req.parseBody();
        const origen = String(body.origen || '').trim();
        if (!ORIGENES[origen]) return c.json({ error: 'Dinos de qué programa vienes.' }, 400);
        const origenOtro = String(body.origen_otro || '').trim().slice(0, 120);
        if (origen === 'otro' && !origenOtro) return c.json({ error: 'Escribe de qué programa vienes.' }, 400);
        const quiere = String(body.quiere || '').split(',').map(x => x.trim()).filter(x => COSAS[x]);
        if (!quiere.length) return c.json({ error: 'Marca al menos una cosa que quieras traer.' }, 400);
        const comentario = String(body.comentario || '').trim().slice(0, 4000);

        // El fichero es OPCIONAL: mucha gente pide la migración antes de saber cómo exportar.
        let adjunto = null;
        const file = body.fichero;
        if (file && typeof file !== 'string') {
          const buffer = Buffer.from(await file.arrayBuffer());
          if (buffer.length > MAX_BYTES) return c.json({ error: 'El archivo supera el máximo de 12 MB.' }, 413);
          if (buffer.length) adjunto = { nombre: String(file.name || 'datos').slice(0, 160), buffer };
        }

        const s = c.get('session') || {};
        const emp = empresa();
        // EL FICHERO SE GUARDA ANTES DE MANDAR NADA. Antes solo se anotaba su nombre y el binario
        // viajaba únicamente dentro del correo: con el buzón del equipo rebotando, el fichero del
        // cliente se perdía. Ahora queda en el almacén de adjuntos del negocio, y el correo pasa a
        // ser una comodidad, no el único sitio donde existe.
        let adjuntoId = null;
        if (adjunto) {
          try {
            const guardado = saveAttachment(db, c.get('tenant'), {
              buffer: adjunto.buffer, originalName: adjunto.nombre,
              mime: adjunto.mime || 'application/octet-stream', kind: 'migracion',
              ext: (adjunto.nombre.split('.').pop() || 'bin').toLowerCase().slice(0, 8),
            });
            adjuntoId = guardado.id;
          } catch (e) { /* si no se puede guardar, la petición sigue: el correo aún puede llevarlo */ }
        }

        const info = db.prepare(
          `INSERT INTO migracion_peticiones (origen,origen_otro,quiere,comentario,fichero,fichero_bytes,user_id,user_name,attachment_id)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(origen, origenOtro, quiere.join(','), comentario,
              adjunto ? adjunto.nombre : null, adjunto ? adjunto.buffer.length : null,
              s.userId || null, s.userName || '', adjuntoId);
        const id = info.lastInsertRowid;
        if (adjuntoId) {
          try { db.prepare("UPDATE attachments SET entity_type='migracion_peticion', entity_id=? WHERE id=?").run(id, adjuntoId); } catch {}
        }

        // ── El correo al equipo, con el fichero si lo hay ─────────────────────────────────────────
        const deDonde = origen === 'otro' ? origenOtro : ORIGENES[origen];
        const lista = quiere.map(k => COSAS[k]).join(', ');
        let emailOk = false, motivoFallo = null;
        try {
          const r = await sendEmail({
            from: 'Bamburu <noreply@bamburu.com>',
            to: buzonDe(db),
            replyTo: emp.email || undefined,
            subject: 'Migración pedida · ' + (emp.company_name || 'negocio') + ' · desde ' + deDonde,
            text: [
              'Negocio: ' + (emp.company_name || '—'),
              'Pide: ' + (s.userName || '—') + (emp.email ? ' <' + emp.email + '>' : ''),
              'Viene de: ' + deDonde,
              'Quiere traer: ' + lista,
              'Fichero: ' + (adjunto ? adjunto.nombre + ' (' + adjunto.buffer.length + ' bytes)' : 'no adjuntó'),
              '',
              comentario || '(sin comentario)',
              '',
              'Petición #' + id,
            ].join('\n'),
            ...(adjunto ? { attachments: [{ filename: adjunto.nombre, content: adjunto.buffer.toString('base64') }] } : {}),
          });
          emailOk = !r?.error;
          if (r?.error) motivoFallo = 'el correo al equipo no salió';
        } catch { motivoFallo = 'el correo al equipo no salió'; }
        db.prepare('UPDATE migracion_peticiones SET email_ok=? WHERE id=?').run(emailOk ? 1 : 0, id);

        // ── El acuse al usuario ───────────────────────────────────────────────────────────────────
        // Pasa por el MISMO portero de preferencias que los demás envíos (`exigirCorreoActivo`), que
        // es lo que pide el encargo. Hoy lo deja pasar siempre porque un acuse de algo que el propio
        // usuario acaba de pedir es TRANSACCIONAL y esos no se apagan — igual que la factura que
        // pides o el correo de recuperar contraseña. Si mañana alguien lo hace conmutable, este
        // envío obedece sin tocar nada, que es justo el motivo de llamar al portero y no saltárselo.
        let acuseOk = false;
        if (emp.email) {
          try {
            exigirCorreoActivo(db, 'migracion_acuse');
            const r2 = await sendEmail({
              from: 'Bamburu <noreply@bamburu.com>', to: emp.email,
              subject: 'Hemos recibido tus datos para la migración',
              text: [
                'Hola' + (s.userName ? ' ' + s.userName : '') + ',',
                '',
                'Tenemos tu petición para traer tus datos desde ' + deDonde + ': ' + lista + '.',
                adjunto ? 'Nos ha llegado tu fichero «' + adjunto.nombre + '».'
                        : 'Cuando tengas el fichero, respóndenos a este correo y lo adjuntas.',
                '',
                'QUÉ PASA AHORA: lo revisa una persona del equipo de Bamburu y te escribimos en 1-2 días',
                'laborables para decirte qué hemos podido traer y qué falta. La migración la hacemos',
                'nosotros y es gratis: tú no tienes que teclear nada.',
                '',
                'Mientras tanto puedes seguir usando Bamburu con normalidad. Nada de lo que hagas ahora',
                'se pierde al migrar.',
              ].join('\n'),
            });
            acuseOk = !r2?.error;
          } catch { /* apagado o sin correo: el acuse de pantalla ya se dio */ }
        }

        return c.json({ ok: true, id, email_equipo: emailOk, acuse: acuseOk,
                        aviso: motivoFallo, con_fichero: !!adjunto });
      } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
    });

  // Lo pedido hasta ahora (para que el dueño vea que no se perdió).
  api.get('/', requirePerm('company.read'), c => {
    try {
      return c.json(db.prepare(
        `SELECT id, origen, origen_otro, quiere, fichero, estado, email_ok, created_at
           FROM migracion_peticiones WHERE active=1 ORDER BY id DESC LIMIT 20`).all());
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── LA PANTALLA ───────────────────────────────────────────────────────────────────────────────
  views.get('/', requirePerm('company.read'), c => {
    const puedeEnviar = can(c, 'company.update');
    const content = `
    <style>
      .mg-wrap{max-width:720px}
      .mg-caja{background:var(--bg2);border:1px solid var(--border2);border-radius:14px;padding:1.2rem 1.3rem;margin-bottom:1rem}
      .mg-caja h3{margin:0 0 .3rem;font-size:1rem}
      .mg-caja p{margin:0 0 .9rem;color:var(--text2);font-size:.86rem;line-height:1.5}
      .mg-ops{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem}
      .mg-op{display:flex;flex-direction:column;gap:.1rem;text-align:left;font-family:inherit;cursor:pointer;min-width:0;
        border:2px solid var(--border2);background:var(--bg2);border-radius:12px;padding:.7rem .85rem}
      .mg-op[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
      .mg-op .n{font-weight:700;font-size:.9rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mg-op[aria-pressed="true"] .n{color:var(--accent)}
      .mg-nota{font-size:.8rem;color:var(--text2);background:var(--bg3);border-radius:10px;padding:.7rem .85rem;line-height:1.5}
      .mg-drop{border:2px dashed var(--border2);border-radius:12px;padding:1rem;text-align:center;color:var(--text2);font-size:.85rem}
      .mg-drop.tiene{border-color:var(--accent);color:var(--accent)}
      @media(max-width:520px){ .mg-caja{padding:.9rem} }
    </style>
    <div class="ph"><div>
      <div style="font-size:.75rem;color:var(--text3)"><a href="/admin" style="color:inherit">Inicio</a> ›</div>
      <h2 style="margin:0">Trae tus datos</h2>
    </div></div>

    <div class="mg-wrap">
      <div class="mg-caja">
        <h3>La migración la hacemos nosotros, y es gratis</h3>
        <p>No hay que teclear nada. Dinos de dónde vienes y qué quieres traer;
           <strong>lo pasa una persona del equipo de Bamburu</strong> y te escribimos en 1-2 días
           laborables. Mientras tanto sigues usando Bamburu con normalidad: nada de lo que hagas
           ahora se pierde al migrar. <strong>Las facturas solo se traen por aquí.</strong></p>
        <div class="mg-nota">Si todavía no tienes el fichero, pídelo igual: te decimos cómo sacarlo
          de tu programa y nos lo mandas después.</div>
      </div>

      <!-- ── EL IMPORTADOR DE CSV, AL LADO DE LA ASISTIDA Y NO ENCIMA (ficha H · H3) ──────────
           La asistida NO se retira ni se degrada: sigue siendo la de arriba, la que se ofrece
           primero y la ÚNICA para facturas. Esto es la segunda vía, para quien prefiere hacerlo él
           y solo trae clientes o productos. Las dos puertas conviven en la misma pantalla porque
           esconder una detrás de la otra sería elegir por el dueño. -->
      <div class="mg-caja" style="border-color:var(--accent)">
        <h3>¿Prefieres hacerlo tú ahora mismo?</h3>
        <p>Si lo que traes son <strong>clientes</strong> o <strong>productos</strong> y ya tienes el
           CSV, puedes importarlos tú en un minuto: te enseño qué columna va a qué campo y qué filas
           fallan <strong>antes</strong> de guardar nada. <strong>Las facturas no</strong> — esas las
           pasamos nosotros, por lo de arriba.</p>
        <a class="btn btn-secondary" href="/admin/migracion/importar"><i class="ti ti-table-import"></i> Importar un CSV yo mismo</a>
      </div>

      <div class="mg-caja">
        <h3>¿De qué programa vienes?</h3>
        <div class="mg-ops" id="mgOrigen"></div>
        <div id="mgOtroCaja" style="display:none;margin-top:.7rem">
          <input class="form-control" id="mgOtro" maxlength="120" placeholder="¿Cuál?">
        </div>
      </div>

      <div class="mg-caja">
        <h3>¿Qué quieres traer?</h3>
        <p>Marca lo que necesites. Puedes marcar varias.</p>
        <div class="mg-ops" id="mgQuiere"></div>
      </div>

      <div class="mg-caja">
        <h3>Tu fichero (si ya lo tienes)</h3>
        <p>Una exportación en Excel, CSV o ZIP. Hasta 12 MB. <strong>Es opcional.</strong></p>
        <label class="mg-drop" id="mgDrop" for="mgFichero">
          <i class="ti ti-file-upload"></i> <span id="mgDropTxt">Elige un fichero…</span>
        </label>
        <input type="file" id="mgFichero" style="display:none">
      </div>

      <div class="mg-caja">
        <h3>¿Algo más que debamos saber?</h3>
        <textarea class="form-control" id="mgComentario" rows="3" maxlength="4000"
          placeholder="Ej.: solo quiero los clientes activos; las facturas de 2024 en adelante…"></textarea>
        <div style="margin-top:.8rem;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="mgEnviar"${puedeEnviar ? '' : ' disabled title="Necesitas permiso para cambiar los datos de la empresa"'}>Pedir la migración</button>
          <span style="font-size:.8rem;color:var(--text3)">No se envía nada hasta que pulses.</span>
        </div>
      </div>

      <div id="mgHecho"></div>
      <div class="mg-caja" id="mgPrevias" style="display:none">
        <h3>Lo que ya has pedido</h3>
        <div id="mgLista"></div>
      </div>
    </div>

    <script nonce="${c.get('cspNonce')}">
    (function(){
      var ORIGENES = ${JSON.stringify(ORIGENES)}, COSAS = ${JSON.stringify(COSAS)};
      var origen = null, quiere = {};
      function pinta(){
        document.getElementById('mgOrigen').innerHTML = Object.keys(ORIGENES).map(function(k){
          return '<button type="button" class="mg-op" data-origen="'+k+'" aria-pressed="'+(origen===k)+'">'
            + '<span class="n">'+escHtml(ORIGENES[k])+'</span></button>'; }).join('');
        document.getElementById('mgQuiere').innerHTML = Object.keys(COSAS).map(function(k){
          return '<button type="button" class="mg-op" data-quiere="'+k+'" aria-pressed="'+(!!quiere[k])+'">'
            + '<span class="n">'+escHtml(COSAS[k])+'</span></button>'; }).join('');
        document.getElementById('mgOtroCaja').style.display = origen==='otro' ? '' : 'none';
      }
      pinta();
      document.addEventListener('click', function(e){
        var o = e.target.closest('[data-origen]'), q = e.target.closest('[data-quiere]');
        if (o) { origen = o.getAttribute('data-origen'); pinta(); return; }
        if (q) { var k = q.getAttribute('data-quiere'); quiere[k] = !quiere[k]; pinta(); return; }
      });
      document.getElementById('mgFichero').addEventListener('change', function(){
        var f = this.files && this.files[0];
        document.getElementById('mgDropTxt').textContent = f ? f.name : 'Elige un fichero…';
        document.getElementById('mgDrop').classList.toggle('tiene', !!f);
      });
      document.getElementById('mgEnviar').addEventListener('click', function(){
        if (!origen) { toast('Dinos de qué programa vienes','err'); return; }
        var marcadas = Object.keys(quiere).filter(function(k){ return quiere[k]; });
        if (!marcadas.length) { toast('Marca al menos una cosa que quieras traer','err'); return; }
        var fd = new FormData();
        fd.append('origen', origen);
        fd.append('origen_otro', document.getElementById('mgOtro').value || '');
        fd.append('quiere', marcadas.join(','));
        fd.append('comentario', document.getElementById('mgComentario').value || '');
        var f = document.getElementById('mgFichero').files[0];
        if (f) fd.append('fichero', f);
        var btn = this; btn.disabled = true; btn.textContent = 'Enviando…';
        fetch('/api/erp/migracion', { method:'POST', headers:{'x-csrf-token': window.CSRF_TOKEN}, body: fd })
          .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||r.status); return j; }); })
          .then(function(j){
            document.getElementById('mgHecho').innerHTML =
              '<div class="mg-caja" style="border-color:var(--ok)"><h3 style="color:var(--ok)">Recibido</h3>'
              + '<p>Tu petición ha quedado apuntada' + (j.con_fichero ? ' con tu fichero' : '') + '. '
              + '<strong>La revisa una persona del equipo</strong> y te escribimos en 1-2 días laborables.'
              + (j.acuse ? ' Te hemos mandado un correo con esto mismo.' : '')
              + '</p>'
              + (j.aviso ? '<div class="mg-nota">Ojo: ' + escHtml(j.aviso) + ', así que escríbenos a hola@bamburu.com para que no se quede parado. Tu petición sí está guardada.</div>' : '')
              + '</div>';
            btn.textContent = 'Pedido'; cargar();
            document.getElementById('mgHecho').scrollIntoView({block:'center', behavior:'smooth'});
          })
          .catch(function(e){ btn.disabled = false; btn.textContent = 'Pedir la migración'; toast(e.message,'err'); });
      });
      function cargar(){
        fetch('/api/erp/migracion').then(function(r){ return r.json(); }).then(function(xs){
          if (!Array.isArray(xs) || !xs.length) return;
          document.getElementById('mgPrevias').style.display = '';
          document.getElementById('mgLista').innerHTML = xs.map(function(x){
            var de = x.origen === 'otro' ? x.origen_otro : (ORIGENES[x.origen] || x.origen);
            var est = { pedida:'Pedida', en_curso:'En curso', hecha:'Hecha' }[x.estado] || x.estado;
            return '<div style="display:flex;gap:.6rem;padding:.45rem 0;border-bottom:1px solid var(--border);align-items:baseline">'
              + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem">'
              + escHtml(de) + ' · ' + escHtml(String(x.quiere||'').split(',').map(function(k){ return COSAS[k]||k; }).join(', '))
              + (x.fichero ? ' · ' + escHtml(x.fichero) : '') + '</span>'
              + '<span class="badge b-gray">' + escHtml(est) + '</span>'
              + '<span style="color:var(--text3);font-size:.75rem;white-space:nowrap">' + escHtml(String(x.created_at||'').slice(0,10)) + '</span></div>';
          }).join('');
        }).catch(function(){});
      }
      cargar();
    })();
    </script>`;
    return c.html(adminLayout('Trae tus datos', content, 'settings', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
