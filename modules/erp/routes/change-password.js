import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { changeOwnPassword } from '../../../core/auth.js';
import { escHtml } from '../../../core/escape.js';
import { validate } from '../../../core/validate.js';
import { changePwdSchema } from '../schemas.js';

export function createChangePasswordRoutes(db) {
  const r = new Hono();

  // PANTALLA-CERROJO del cambio obligatorio de contraseña. core/auth.js redirige aquí (y solo
  // permite esta ruta y /admin/logout) mientras must_change_password=1. NO está en el menú: el
  // cambio voluntario vive en /admin/perfil. Por eso, si alguien llega aquí sin cerrojo, lo
  // mandamos al Perfil en vez de enseñarle un segundo formulario de contraseña.
  // La lógica de cambio es la compartida (core/auth.js → changeOwnPassword).
  r.get('/', c => {
    const session = c.get('session');
    const err = c.req.query('error');
    const csrfToken = session?.csrfToken || '';

    const user = db.prepare('SELECT must_change_password FROM admin_users WHERE id=?')
      .get(session.userId) || {};
    if (user.must_change_password !== 1) return c.redirect('/admin/perfil');

    const content = `
      <div class="page-header"><h1>Cambiar contraseña</h1></div>
      <div class="card" style="max-width:460px;padding:2rem">
        <div style="background:var(--warn-s);border:1px solid var(--warn);border-radius:8px;padding:.9rem 1.1rem;margin-bottom:1.5rem;color:var(--warn);font-size:.9rem">
          <strong>Por seguridad, debes cambiar tu contraseña antes de continuar.</strong>
        </div>
        ${err ? `<div style="background:var(--danger-s);border:1px solid var(--danger);border-radius:8px;padding:.75rem 1rem;margin-bottom:1.2rem;color:var(--danger);font-size:.85rem">${escHtml(decodeURIComponent(err))}</div>` : ''}
        <form method="POST" action="/admin/change-password">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <div style="margin-bottom:1rem">
            <label style="display:block;font-size:.82rem;font-weight:500;margin-bottom:.3rem;color:var(--text)">Contraseña actual</label>
            <input type="password" name="current_password" required style="width:100%;padding:.6rem .8rem;border:1px solid var(--border);border-radius:6px;font-size:.9rem">
          </div>
          <div style="margin-bottom:1rem">
            <label style="display:block;font-size:.82rem;font-weight:500;margin-bottom:.3rem;color:var(--text)">Nueva contraseña <span style="font-weight:400;color:var(--text2)">(mínimo 10 caracteres)</span></label>
            <input type="password" name="new_password" required minlength="10" style="width:100%;padding:.6rem .8rem;border:1px solid var(--border);border-radius:6px;font-size:.9rem">
          </div>
          <div style="margin-bottom:1.5rem">
            <label style="display:block;font-size:.82rem;font-weight:500;margin-bottom:.3rem;color:var(--text)">Confirmar nueva contraseña</label>
            <input type="password" name="confirm_password" required style="width:100%;padding:.6rem .8rem;border:1px solid var(--border);border-radius:6px;font-size:.9rem">
          </div>
          <button type="submit" style="padding:.65rem 1.4rem;background:var(--accent);color:var(--bg2);border:none;border-radius:6px;font-size:.9rem;font-weight:500;cursor:pointer">Cambiar contraseña</button>
        </form>
      </div>`;
    return c.html(adminLayout('Cambiar contraseña', content, '', csrfToken, c));
  });

  r.post('/', validate(changePwdSchema), async c => {
    const session = c.get('session');
    const form = c.get('validated');
    const current = form.current_password || '';
    const nuevo = form.new_password || '';
    const confirm = form.confirm_password || '';

    const fail = (msg) => c.redirect(`/admin/change-password?error=${encodeURIComponent(msg)}`);

    // Servicio compartido con /admin/perfil (core/auth.js): bcrypt, cierre de las demás
    // sesiones y registro en Actividad. Aquí solo decidimos a dónde va el usuario después.
    const res = await changeOwnPassword(db, session, { current, nuevo, confirm });
    if (!res.ok) return fail(res.error);

    // Salida del cerrojo. Si el usuario ya tiene 2FA, al Inicio; si no, al Perfil, que es donde
    // ahora vive el 2FA (antes empujaba a /admin/security, hoy un simple redirect al Perfil).
    if (!res.forced) {
      return c.redirect('/admin/perfil?msg=' + encodeURIComponent('Contraseña cambiada correctamente.'));
    }
    const user2fa = db.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').get(session.userId);
    if (user2fa?.totp_enabled) {
      return c.redirect('/admin');
    }
    return c.redirect('/admin/perfil?msg=' + encodeURIComponent('Contraseña cambiada. Te recomendamos activar la verificación en dos pasos.'));
  });

  return r;
}
