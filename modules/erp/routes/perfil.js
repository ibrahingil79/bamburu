// PERFIL DE USUARIO — datos PERSONALES del usuario logueado.
//
// Es el único sitio donde el usuario gestiona lo suyo: identidad, contacto, preferencias,
// contraseña y verificación en dos pasos (2FA). Distinto de "Datos del negocio"
// (/admin/settings), que es la configuración FISCAL de la empresa.
//
// Decisiones que conviene no deshacer sin pensarlo:
//  · La contraseña NO se reimplementa aquí: usa el servicio compartido core/auth.js →
//    changeOwnPassword (bcrypt, cierre de las demás sesiones, registro en Actividad).
//    /admin/change-password sigue existiendo como PANTALLA-CERROJO del cambio obligatorio
//    (core/auth.js la exige mientras must_change_password=1). No tocar esa dependencia.
//  · El 2FA vive SOLO aquí. Antes había dos pantallas (/admin/security y /admin/setup-2fa) con
//    dos Map() de secreto pendiente. No había dos ESTADOS: ambas escribían las mismas columnas
//    (admin_users.totp_secret / totp_enabled), que es lo que lee el login. Por eso consolidar
//    fue mover UI, sin migrar datos: quien tenía 2FA activo lo sigue teniendo.
//  · `idioma` GUARDA la preferencia pero HOY NO TRADUCE NADA. El motor de i18n real es una tarea
//    futura aparte (TABLERO). La pantalla se lo dice al usuario en vez de fingir que funciona.
//  · `apellidos` nunca se deriva de `name`: partir un campo libre por el primer espacio inventa
//    apellidos falsos. Arranca vacío y lo rellena el usuario.

import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { changeOwnPassword, logActivity } from '../../../core/auth.js';
import { escHtml } from '../../../core/escape.js';
import { generateSecret, verify as verifyTOTP, keyuri } from '../../../core/totp.js';
import { saveAttachment, getAttachment, readAttachmentBuffer, ALLOWED_MIME, MAX_UPLOAD_BYTES } from '../attachments.js';
import { PAISES_TELEFONO, PREFIJOS_VALIDOS, IDIOMAS, IDIOMAS_VALIDOS } from '../paises-telefono.js';
import QRCode from 'qrcode';
import { ENTITY } from '../../../core/activity-entities.js';

// Solo imágenes para la foto de perfil (attachments.js admite además PDF, que aquí no tiene
// sentido). Fuente única del mime→ext: ALLOWED_MIME.
const FOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Marca del adjunto de foto. La ruta que sirve ficheros SOLO acepta este kind, para que no se
// pueda usar como puerta trasera a los adjuntos de facturas de proveedor.
const FOTO_KIND = 'user_photo';

// Secreto temporal mientras el usuario escanea el QR, hasta que confirma con un código válido.
// En memoria a propósito: si no confirma, no se persiste nada. Se purga a los 10 minutos.
const pendingTOTPStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingTOTPStore) if (v.created < cutoff) pendingTOTPStore.delete(k);
}, 60000);

const ROLE_LABEL = { owner: 'Propietario', admin: 'Administrador', employee: 'Empleado' };

function loadPerfil(db, userId) {
  return db.prepare(`SELECT id, name, apellidos, email, role, telefono, pais_telefono, idioma,
                            foto_url, totp_enabled
                     FROM admin_users WHERE id=?`).get(userId) || null;
}

export function createPerfilRoutes(db) {
  const views = new Hono();
  const api = new Hono();

  // ── Pantalla ────────────────────────────────────────────────────────────────
  views.get('/', async c => {
    const session = c.get('session');
    const csrfToken = session?.csrfToken || '';
    const u = loadPerfil(db, session.userId);
    if (!u) return c.redirect('/admin');

    const msg = c.req.query('msg');
    const err = c.req.query('err');

    // QR solo si el 2FA está apagado: si ya está activo no hay nada que escanear.
    let qrDataUrl = '', secret = '';
    if (!u.totp_enabled) {
      secret = generateSecret();
      qrDataUrl = await QRCode.toDataURL(keyuri(u.email, 'Bamburu', secret), { width: 180, margin: 1 });
      pendingTOTPStore.set(u.id, { secret, created: Date.now() });
    }

    const prefijo = u.pais_telefono || '+34';
    const idioma = u.idioma || 'es';
    const inicial = (String(u.name || 'U').trim().charAt(0) || 'U').toUpperCase();

    const paisOptions = PAISES_TELEFONO.map(p =>
      `<option value="${p.code}"${p.code === prefijo ? ' selected' : ''}>${escHtml(p.nombre)} (${p.code})</option>`
    ).join('');
    const idiomaOptions = IDIOMAS.map(i =>
      `<option value="${i.code}"${i.code === idioma ? ' selected' : ''}>${escHtml(i.nombre)}</option>`
    ).join('');

    const content = `
    <style>
      .pf-foto-row{display:flex;align-items:center;gap:1.25rem;margin-bottom:1.75rem}
      .pf-avatar{width:76px;height:76px;border-radius:50%;object-fit:cover;border:1px solid var(--border);background:var(--accent-soft);
        display:flex;align-items:center;justify-content:center;font-size:1.75rem;font-weight:500;color:var(--accent);flex:0 0 auto}
      .pf-foto-actions{display:flex;flex-direction:column;gap:.4rem}
      .pf-foto-hint{font-size:12px;color:var(--text2)}
      .pf-tel{display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:.75rem}
      .pf-nota{background:var(--accent-soft);border:1px solid var(--border);border-radius:8px;padding:.7rem .9rem;
        font-size:12px;color:var(--text2);margin-top:.5rem;line-height:1.5}
      .pf-alert{padding:.75rem 1rem;border-radius:8px;font-size:.85rem;margin-bottom:1.2rem}
      .pf-ok{background:var(--ok-s);border:1px solid var(--ok);color:var(--ok)}
      .pf-err{background:var(--danger-s);border:1px solid var(--danger);color:var(--danger)}
      .pf-2fa-on{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .8rem;background:var(--ok-s);border:1px solid var(--ok);color:var(--ok);border-radius:20px;font-size:.8rem;font-weight:500}
      .pf-2fa-off{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .8rem;background:var(--bg3);border:1px solid var(--border);color:var(--text3);border-radius:20px;font-size:.8rem;font-weight:500}
      .pf-qr{text-align:center;padding:1rem;background:var(--bg3);border-radius:10px;display:inline-block;margin:.75rem 0}
      .pf-secret{font-family:monospace;font-size:.78rem;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:.35rem .7rem;word-break:break-all;color:var(--text3)}
      .pf-info{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:1rem 1.2rem;margin-bottom:1.2rem}
      .pf-info h4{font-size:.85rem;font-weight:500;margin-bottom:.5rem;color:var(--text)}
      .pf-info p,.pf-info li{font-size:.82rem;color:var(--text3);line-height:1.6}
      .pf-info ol{padding-left:1.1rem;margin-top:.4rem}
      @media(max-width:640px){ .pf-tel{grid-template-columns:1fr} }
    </style>

    <div class="page-header"><h1>Perfil</h1></div>

    ${msg ? `<div class="pf-alert pf-ok" style="max-width:700px">${escHtml(decodeURIComponent(msg))}</div>` : ''}
    ${err ? `<div class="pf-alert pf-err" style="max-width:700px">${escHtml(decodeURIComponent(err))}</div>` : ''}

    <!-- ── Datos personales ─────────────────────────────────────── -->
    <div class="card" style="max-width:700px">
      <div class="card-body">
        <div class="pf-foto-row">
          <div class="pf-avatar" id="pfAvatarWrap">
            ${u.foto_url
              ? `<img src="${escHtml(u.foto_url)}" alt="Foto de perfil" class="pf-avatar" id="pfAvatarImg">`
              : `<span id="pfAvatarInicial">${escHtml(inicial)}</span>`}
          </div>
          <div class="pf-foto-actions">
            <input type="file" id="pfFoto" accept="image/jpeg,image/png,image/webp" style="display:none">
            <div style="display:flex;gap:.5rem">
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('pfFoto').click()">Cambiar foto</button>
              <button class="btn btn-secondary btn-sm" id="pfQuitarFoto" onclick="quitarFoto()" ${u.foto_url ? '' : 'style="display:none"'}>Quitar</button>
            </div>
            <span class="pf-foto-hint">JPG, PNG o WebP. Máximo 12 MB.</span>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nombre</label>
            <input class="form-control" id="pfNombre" maxlength="80" value="${escHtml(u.name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Apellidos</label>
            <input class="form-control" id="pfApellidos" maxlength="120" value="${escHtml(u.apellidos || '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-control" value="${escHtml(u.email || '')}" disabled
              style="background:var(--bg3);color:var(--text2);cursor:not-allowed">
            <small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">El email es tu acceso; lo cambia un administrador desde Usuarios.</small>
          </div>
          <div class="form-group">
            <label class="form-label">Rol</label>
            <input class="form-control" value="${escHtml(ROLE_LABEL[u.role] || 'Usuario')}" disabled
              style="background:var(--bg3);color:var(--text2);cursor:not-allowed">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Teléfono</label>
          <div class="pf-tel">
            <select class="form-control" id="pfPais">${paisOptions}</select>
            <input class="form-control" id="pfTelefono" inputmode="tel" maxlength="20"
              placeholder="600 00 00 00" value="${escHtml(u.telefono || '')}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Idioma</label>
          <select class="form-control" id="pfIdioma">${idiomaOptions}</select>
          <div class="pf-nota">
            Tu preferencia de idioma se guarda, pero la interfaz todavía se muestra en español:
            la traducción completa está en camino y llegará sin que tengas que volver aquí.
          </div>
        </div>

        <button class="btn btn-primary" onclick="guardarPerfil()">Guardar cambios</button>
      </div>
    </div>

    <!-- ── Contraseña ───────────────────────────────────────────── -->
    <div class="card" style="max-width:700px;margin-top:24px">
      <div class="card-body">
        <h3 style="font-size:16px;font-weight:500;color:var(--text);margin-bottom:4px">Contraseña</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
          Al cambiarla se cerrarán tus demás sesiones abiertas. Esta seguirá activa.
        </p>
        <form method="POST" action="/admin/perfil/password">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <div class="form-group">
            <label class="form-label">Contraseña actual</label>
            <input type="password" name="current_password" class="form-control" required autocomplete="current-password">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Nueva contraseña (mínimo 10 caracteres)</label>
              <input type="password" name="new_password" class="form-control" required minlength="10" autocomplete="new-password">
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar nueva contraseña</label>
              <input type="password" name="confirm_password" class="form-control" required minlength="10" autocomplete="new-password">
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Cambiar contraseña</button>
        </form>
      </div>
    </div>

    <!-- ── 2FA ──────────────────────────────────────────────────── -->
    <div class="card" style="max-width:700px;margin-top:24px">
      <div class="card-body">
        <h3 style="font-size:16px;font-weight:500;color:var(--text);margin-bottom:4px">Verificación en dos pasos</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
          Añade un código de 6 dígitos a tu inicio de sesión. Aunque alguien robe tu contraseña, no podrá entrar.
        </p>

        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.2rem">
          <span style="font-size:.9rem;font-weight:500;color:var(--text)">Estado:</span>
          ${u.totp_enabled ? '<span class="pf-2fa-on">● Activada</span>' : '<span class="pf-2fa-off">○ Desactivada</span>'}
        </div>

        ${u.totp_enabled ? `
          <div class="pf-info" style="border-color:var(--ok);background:var(--ok-s)">
            <h4 style="color:var(--ok)">Tu cuenta está protegida</h4>
            <p>Cada vez que inicies sesión te pediremos el código de 6 dígitos de tu app autenticadora.</p>
          </div>
          <form method="POST" action="/admin/perfil/disable-2fa"
                onsubmit="return confirm('¿Seguro que quieres desactivar la verificación en dos pasos? Tu cuenta quedará menos protegida.')">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <button type="submit" class="btn btn-danger">Desactivar</button>
          </form>
        ` : `
          <div class="pf-info">
            <h4>Cómo activarla</h4>
            <ol>
              <li>Instala <strong style="color:var(--text)">Google Authenticator</strong> o <strong style="color:var(--text)">Authy</strong> en tu móvil.</li>
              <li>Escanea el código QR con la app.</li>
              <li>Escribe el código de 6 dígitos que te muestre.</li>
            </ol>
          </div>
          <div style="text-align:center;margin-bottom:1.2rem">
            <div class="pf-qr"><img src="${qrDataUrl}" width="180" height="180" alt="Código QR para la verificación en dos pasos"></div>
            <p style="font-size:.78rem;color:var(--text2);margin-bottom:.4rem">¿No puedes escanear? Escribe esta clave en la app:</p>
            <div class="pf-secret">${escHtml(secret)}</div>
          </div>
          <form method="POST" action="/admin/perfil/confirm-2fa">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <div class="form-group" style="max-width:220px">
              <label class="form-label">Código de verificación</label>
              <input type="text" name="code" class="form-control" inputmode="numeric" pattern="[0-9 ]{6,7}"
                maxlength="7" placeholder="000 000" autocomplete="one-time-code"
                style="font-family:monospace;font-size:1.15rem;letter-spacing:.15em;text-align:center">
            </div>
            <button type="submit" class="btn btn-primary">Verificar y activar</button>
          </form>
        `}
      </div>
    </div>

    <script>
      async function guardarPerfil(){
        var btn = event.target;
        btn.disabled = true;
        try{
          await api('PUT','/api/erp/perfil',{
            name: document.getElementById('pfNombre').value.trim(),
            apellidos: document.getElementById('pfApellidos').value.trim(),
            telefono: document.getElementById('pfTelefono').value.trim(),
            pais_telefono: document.getElementById('pfPais').value,
            idioma: document.getElementById('pfIdioma').value,
          });
          toast('Guardado ✓');
        }catch(e){ toast(e.message,'err'); }
        finally{ btn.disabled = false; }
      }

      document.getElementById('pfFoto').addEventListener('change', async function(){
        var file = this.files && this.files[0];
        if(!file) return;
        var fd = new FormData();
        fd.append('foto', file);
        fd.append('_csrf', window.CSRF_TOKEN);
        try{
          var r = await fetch('/api/erp/perfil/foto',{ method:'POST', body: fd });
          var d = await r.json();
          if(!r.ok) throw new Error(d.error || 'No se pudo subir la foto.');
          var wrap = document.getElementById('pfAvatarWrap');
          wrap.innerHTML = '<img src="'+d.foto_url+'?v='+Date.now()+'" alt="Foto de perfil" class="pf-avatar">';
          document.getElementById('pfQuitarFoto').style.display = '';
          toast('Foto actualizada ✓');
        }catch(e){ toast(e.message,'err'); }
        finally{ this.value = ''; }
      });

      async function quitarFoto(){
        try{
          await api('DELETE','/api/erp/perfil/foto');
          var wrap = document.getElementById('pfAvatarWrap');
          wrap.innerHTML = '<span>' + ${JSON.stringify(inicial)} + '</span>';
          document.getElementById('pfQuitarFoto').style.display = 'none';
          toast('Foto quitada ✓');
        }catch(e){ toast(e.message,'err'); }
      }
    </script>`;

    return c.html(adminLayout('Perfil', content, 'perfil', csrfToken, c));
  });

  // ── Contraseña: reutiliza el servicio compartido, no reimplementa nada ──────
  views.post('/password', async c => {
    const session = c.get('session');
    const form = await c.req.parseBody();
    const res = await changeOwnPassword(db, session, {
      current: form.current_password || '',
      nuevo: form.new_password || '',
      confirm: form.confirm_password || '',
    });
    if (!res.ok) return c.redirect('/admin/perfil?err=' + encodeURIComponent(res.error));
    return c.redirect('/admin/perfil?msg=' + encodeURIComponent('Contraseña cambiada correctamente. Se cerraron tus demás sesiones.'));
  });

  // ── 2FA: único sitio. Escribe las mismas columnas que lee el login (auth.js) ─
  views.post('/confirm-2fa', async c => {
    const session = c.get('session');
    const form = await c.req.parseBody();
    const code = String(form.code || '').replace(/\s/g, '');

    const entry = pendingTOTPStore.get(session.userId);
    if (!entry || Date.now() - entry.created > 10 * 60 * 1000) {
      return c.redirect('/admin/perfil?err=' + encodeURIComponent('El código QR caducó. Vuelve a intentarlo.'));
    }
    if (!verifyTOTP(code, entry.secret)) {
      return c.redirect('/admin/perfil?err=' + encodeURIComponent('Código incorrecto. Comprueba que la hora de tu móvil esté sincronizada.'));
    }

    db.prepare('UPDATE admin_users SET totp_secret=?, totp_enabled=1 WHERE id=?').run(entry.secret, session.userId);
    pendingTOTPStore.delete(session.userId);
    logActivity(db, session, 'Activó la verificación en dos pasos', ENTITY.ADMIN_USER, session.userId);
    return c.redirect('/admin/perfil?msg=' + encodeURIComponent('Verificación en dos pasos activada. La próxima vez te pediremos el código.'));
  });

  views.post('/disable-2fa', c => {
    const session = c.get('session');
    db.prepare('UPDATE admin_users SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(session.userId);
    logActivity(db, session, 'Desactivó la verificación en dos pasos', ENTITY.ADMIN_USER, session.userId);
    return c.redirect('/admin/perfil?msg=' + encodeURIComponent('Verificación en dos pasos desactivada.'));
  });

  // ── API: datos personales ───────────────────────────────────────────────────
  // Sin requirePerm: cualquier usuario con sesión gestiona SU perfil, y siempre el suyo
  // (session.userId; el id nunca llega del cliente).
  api.put('/', async c => {
    try {
      const session = c.get('session');
      const d = await c.req.json();

      const name = String(d.name ?? '').trim();
      if (!name) return c.json({ error: 'El nombre no puede quedar vacío.' }, 400);
      if (name.length > 80) return c.json({ error: 'El nombre no puede pasar de 80 caracteres.' }, 400);

      // apellidos: opcional y SIEMPRE lo que escribe el usuario. Nunca se deriva de `name`.
      const apellidos = String(d.apellidos ?? '').trim();
      if (apellidos.length > 120) return c.json({ error: 'Los apellidos no pueden pasar de 120 caracteres.' }, 400);

      const telefono = String(d.telefono ?? '').trim();
      if (telefono && !/^[0-9 ()-]{4,20}$/.test(telefono)) {
        return c.json({ error: 'El teléfono solo admite números, espacios, guiones y paréntesis.' }, 400);
      }

      const pais = String(d.pais_telefono ?? '+34');
      if (!PREFIJOS_VALIDOS.has(pais)) return c.json({ error: 'Prefijo de país no válido.' }, 400);

      const idioma = String(d.idioma ?? 'es');
      if (!IDIOMAS_VALIDOS.has(idioma)) return c.json({ error: 'Idioma no válido.' }, 400);

      db.prepare(`UPDATE admin_users SET name=?, apellidos=?, telefono=?, pais_telefono=?, idioma=? WHERE id=?`)
        .run(name, apellidos, telefono, pais, idioma, session.userId);
      logActivity(db, session, 'Actualizó su perfil', ENTITY.ADMIN_USER, session.userId);

      return c.json({ ok: true, ...loadPerfil(db, session.userId) });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // ── API: foto ───────────────────────────────────────────────────────────────
  api.post('/foto', async c => {
    try {
      const session = c.get('session');
      const body = await c.req.parseBody();
      const file = body.foto;
      if (!file || typeof file === 'string') return c.json({ error: 'Elige una imagen.' }, 400);

      const mime = file.type || '';
      if (!FOTO_MIME.has(mime) || !ALLOWED_MIME[mime]) {
        return c.json({ error: 'Formato no admitido. Sube una imagen JPG, PNG o WebP.' }, 400);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (!buffer.length) return c.json({ error: 'El archivo está vacío.' }, 400);
      if (buffer.length > MAX_UPLOAD_BYTES) return c.json({ error: 'La imagen supera el máximo de 12 MB.' }, 413);

      const att = saveAttachment(db, c.get('tenant'), {
        buffer, originalName: file.name || 'foto', mime, kind: FOTO_KIND,
      });
      // La foto anterior NO se borra del disco (regla del proyecto: archivar, no destruir);
      // simplemente deja de estar referenciada.
      const foto_url = '/api/erp/perfil/foto/' + att.id;
      db.prepare('UPDATE admin_users SET foto_url=? WHERE id=?').run(foto_url, session.userId);
      logActivity(db, session, 'Cambió su foto de perfil', ENTITY.ADMIN_USER, session.userId);

      return c.json({ ok: true, foto_url });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.delete('/foto', c => {
    const session = c.get('session');
    db.prepare('UPDATE admin_users SET foto_url=NULL WHERE id=?').run(session.userId);
    logActivity(db, session, 'Quitó su foto de perfil', ENTITY.ADMIN_USER, session.userId);
    return c.json({ ok: true });
  });

  // Sirve la imagen. Requiere sesión (va bajo el grupo autenticado) y el aislamiento entre
  // negocios lo da la BD por tenant. El filtro por `kind` es lo que impide que esta ruta se use
  // para leer adjuntos de facturas de proveedor pasando otro id.
  api.get('/foto/:id', c => {
    try {
      const att = getAttachment(db, parseInt(c.req.param('id')));
      if (!att || att.kind !== FOTO_KIND) return c.json({ error: 'No encontrada' }, 404);
      const buf = readAttachmentBuffer(att);
      if (!buf) return c.json({ error: 'Archivo no disponible' }, 404);
      return new Response(buf, {
        headers: {
          'Content-Type': att.mime || 'application/octet-stream',
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  return { views, api };
}
