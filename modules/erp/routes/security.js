import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { hashPassword, verifyPassword, destroyAllAdminSessionsForUser } from '../../../core/auth.js';
import { generateSecret, verify as verifyTOTP, keyuri } from '../../../core/totp.js';
import { validate } from '../../../core/validate.js';
import { changePwdSchema } from '../schemas.js';
import QRCode from 'qrcode';

// Secret temporal durante el setup de 2FA (keyed por userId)
const pendingTOTPStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingTOTPStore) if (v.created < cutoff) pendingTOTPStore.delete(k);
}, 60000);

export function createSecurityRoutes(db) {
  const r = new Hono();

  r.get('/', async c => {
    const session = c.get('session');
    const csrfToken = session?.csrfToken || '';
    const tab = c.req.query('tab') || 'password';
    const msg = c.req.query('msg') || '';
    const err = c.req.query('err') || '';

    const user = db.prepare(
      'SELECT email, name, totp_enabled FROM admin_users WHERE id=?'
    ).get(session.userId);

    // Generar QR si 2FA no está activo
    let qrDataUrl = '';
    let secret = '';
    if (!user.totp_enabled) {
      secret = generateSecret();
      const uri = keyuri(user.email, 'Bamburu', secret);
      qrDataUrl = await QRCode.toDataURL(uri, { width: 180, margin: 1 });
      pendingTOTPStore.set(session.userId, { secret, created: Date.now() });
    }

    const alert = msg
      ? `<div class="sec-alert sec-ok">${msg}</div>`
      : err
        ? `<div class="sec-alert sec-err">${err}</div>`
        : '';

    const content = `
    <style>
      .sec-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:1.5rem}
      .sec-tab{padding:.6rem 1.2rem;font-size:.85rem;font-weight:500;color:var(--text3);cursor:pointer;border-bottom:2px solid transparent;text-decoration:none;transition:all .15s}
      .sec-tab.active{color:var(--teal);border-bottom-color:var(--teal);font-weight:500}
      .sec-tab:hover{color:var(--text)}
      .sec-pane{display:none}.sec-pane.active{display:block}
      .sec-alert{padding:.75rem 1rem;border-radius:8px;font-size:.85rem;margin-bottom:1.2rem}
      .sec-ok{background:var(--ok-s);border:1px solid var(--ok);color:var(--ok)}
      .sec-err{background:var(--danger-s);border:1px solid var(--danger);color:var(--danger)}
      .form-row{display:grid;gap:1rem}
      .f-label{font-size:.8rem;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.35rem;display:block}
      .f-input{width:100%;padding:.6rem .8rem;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.9rem;font-family:inherit;outline:none;transition:border-color .15s}
      .f-input:focus{border-color:var(--teal)}
      .badge-2fa-on{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .8rem;background:var(--ok-s);border:1px solid var(--ok);color:var(--ok);border-radius:20px;font-size:.8rem;font-weight:500}
      .badge-2fa-off{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .8rem;background:var(--bg3);border:1px solid var(--border);color:var(--text3);border-radius:20px;font-size:.8rem;font-weight:500}
      .info-box{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:1rem 1.2rem;margin-bottom:1.4rem}
      .info-box h4{font-size:.85rem;font-weight:500;margin-bottom:.5rem;color:var(--text)}
      .info-box p,.info-box li{font-size:.82rem;color:var(--text3);line-height:1.6}
      .info-box ol{padding-left:1.1rem}
      .qr-wrap{text-align:center;padding:1rem;background:var(--bg2);border-radius:10px;display:inline-block;margin:1rem 0}
      .secret-chip{font-family:monospace;font-size:.78rem;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:.35rem .7rem;word-break:break-all;color:var(--text3)}
      /* .btn-danger se hereda del componente canónico de layout.js (fuente única) */
      .sec-divider{border:none;border-top:1px solid var(--border);margin:1.5rem 0}
    </style>

    <div class="page-header"><h1>Seguridad</h1></div>

    <div class="card" style="padding:1.5rem 2rem;max-width:600px">
      ${alert}

      <div class="sec-tabs">
        <a href="/admin/security?tab=password" class="sec-tab${tab === 'password' ? ' active' : ''}">Contraseña</a>
        <a href="/admin/security?tab=2fa"      class="sec-tab${tab === '2fa'      ? ' active' : ''}">Autenticación 2FA</a>
      </div>

      <!-- TAB: CONTRASEÑA -->
      <div class="sec-pane${tab === 'password' ? ' active' : ''}">
        <p style="font-size:.85rem;color:var(--text3);margin-bottom:1.2rem">
          Cambia tu contraseña de acceso. Necesitarás la contraseña actual para confirmarlo.
        </p>
        <form method="POST" action="/admin/security/change-password">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <div class="form-row" style="grid-template-columns:1fr;gap:.9rem">
            <div>
              <label class="f-label">Contraseña actual</label>
              <input type="password" name="current_password" class="f-input" required autocomplete="current-password">
            </div>
            <div>
              <label class="f-label">Nueva contraseña <span style="font-weight:400;text-transform:none;letter-spacing:0">(mínimo 10 caracteres)</span></label>
              <input type="password" name="new_password" class="f-input" required minlength="10" autocomplete="new-password">
            </div>
            <div>
              <label class="f-label">Confirmar nueva contraseña</label>
              <input type="password" name="confirm_password" class="f-input" required minlength="10" autocomplete="new-password">
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:1.2rem">Cambiar contraseña</button>
        </form>
      </div>

      <!-- TAB: 2FA -->
      <div class="sec-pane${tab === '2fa' ? ' active' : ''}">

        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.2rem">
          <span style="font-size:.9rem;font-weight:500;color:var(--text)">Estado:</span>
          ${user.totp_enabled
            ? '<span class="badge-2fa-on">● Activada</span>'
            : '<span class="badge-2fa-off">○ Desactivada</span>'
          }
        </div>

        ${user.totp_enabled ? `
          <div class="info-box" style="border-color:var(--ok);background:var(--ok-s)">
            <h4 style="color:var(--ok)">2FA activa en tu cuenta</h4>
            <p>Cada vez que inicies sesión se te pedirá un código de 6 dígitos de tu app autenticadora.</p>
          </div>
          <form method="POST" action="/admin/security/disable-2fa" onsubmit="return confirm('¿Seguro que quieres desactivar el doble factor? Tu cuenta quedará menos protegida.')">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <button type="submit" class="btn btn-danger">Desactivar 2FA</button>
          </form>
        ` : `
          <div class="info-box">
            <h4>¿Qué es la autenticación de dos factores?</h4>
            <p style="margin-bottom:.6rem">
              Añade una segunda capa de seguridad a tu cuenta. Además de tu contraseña,
              necesitarás un código temporal de 6 dígitos generado por tu móvil.
              Aunque alguien robe tu contraseña, no podrá entrar sin el código.
            </p>
            <ol>
              <li>Descarga <strong style="color:var(--text)">Google Authenticator</strong> o <strong style="color:var(--text)">Authy</strong> en tu móvil.</li>
              <li>Escanea el código QR de abajo con la app.</li>
              <li>Ingresa el código de 6 dígitos que aparece para verificar.</li>
            </ol>
          </div>

          <div style="text-align:center;margin-bottom:1.2rem">
            <div class="qr-wrap">
              <img src="${qrDataUrl}" width="180" height="180" alt="QR 2FA">
            </div>
            <p style="font-size:.78rem;color:var(--text3);margin-bottom:.4rem">¿No puedes escanear? Ingresa esta clave manualmente en la app:</p>
            <div class="secret-chip">${secret}</div>
          </div>

          <form method="POST" action="/admin/security/confirm-2fa">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <label class="f-label">Código de verificación (6 dígitos)</label>
            <input type="text" name="code" class="f-input"
              inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7"
              placeholder="000 000" autocomplete="one-time-code"
              style="font-family:monospace;font-size:1.2rem;letter-spacing:.15em;text-align:center;max-width:200px">
            <button type="submit" class="btn btn-primary" style="margin-top:1rem;display:block">Verificar y activar 2FA</button>
          </form>
        `}
      </div>
    </div>`;

    return c.html(adminLayout('Seguridad', content, 'security', csrfToken, c));
  });

  r.post('/change-password', validate(changePwdSchema), async c => {
    const session = c.get('session');
    const form = c.get('validated');
    const current = form.current_password || '';
    const nuevo = form.new_password || '';
    const confirm = form.confirm_password || '';

    const fail = (msg) => c.redirect(`/admin/security?tab=password&err=${encodeURIComponent(msg)}`);

    if (nuevo.length < 10) return fail('La nueva contraseña debe tener al menos 10 caracteres.');
    if (nuevo !== confirm) return fail('Las contraseñas no coinciden.');
    if (nuevo === current) return fail('La nueva contraseña debe ser diferente a la actual.');

    const user = db.prepare('SELECT * FROM admin_users WHERE id=?').get(session.userId);
    if (!user) return fail('Usuario no encontrado.');
    const result = await verifyPassword(current, user.password_hash);
    if (!result.valid) return fail('La contraseña actual es incorrecta.');

    const newHash = await hashPassword(nuevo);
    db.prepare('UPDATE admin_users SET password_hash=?, must_change_password=0 WHERE id=?')
      .run(newHash, session.userId);
    destroyAllAdminSessionsForUser(db, session.userId, session.token);

    return c.redirect('/admin/security?tab=password&msg=' + encodeURIComponent('Contraseña cambiada correctamente.'));
  });

  r.post('/confirm-2fa', async c => {
    const session = c.get('session');
    const form = await c.req.parseBody();
    const code = (form.code || '').replace(/\s/g, '');

    const entry = pendingTOTPStore.get(session.userId);
    if (!entry || Date.now() - entry.created > 10 * 60 * 1000) {
      return c.redirect('/admin/security?tab=2fa&err=' + encodeURIComponent('La sesión de configuración expiró. Vuelve a intentarlo.'));
    }

    if (!verifyTOTP(code, entry.secret)) {
      return c.redirect('/admin/security?tab=2fa&err=' + encodeURIComponent('Código incorrecto. Asegúrate de que la app esté sincronizada.'));
    }

    db.prepare('UPDATE admin_users SET totp_secret=?, totp_enabled=1 WHERE id=?')
      .run(entry.secret, session.userId);
    pendingTOTPStore.delete(session.userId);

    return c.redirect('/admin/security?tab=2fa&msg=' + encodeURIComponent('2FA activada correctamente. Ahora necesitarás tu app para iniciar sesión.'));
  });

  r.post('/disable-2fa', c => {
    const session = c.get('session');
    db.prepare('UPDATE admin_users SET totp_secret=NULL, totp_enabled=0 WHERE id=?')
      .run(session.userId);
    return c.redirect('/admin/security?tab=2fa&msg=' + encodeURIComponent('2FA desactivada. Tu cuenta ya no requiere código al iniciar sesión.'));
  });

  return r;
}
