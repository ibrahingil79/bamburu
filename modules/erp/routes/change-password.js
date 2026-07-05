import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { hashPassword, verifyPassword, logActivity, destroyAllAdminSessionsForUser } from '../../../core/auth.js';
import { escHtml } from '../../../core/escape.js';
import { validate } from '../../../core/validate.js';
import { changePwdSchema } from '../schemas.js';

export function createChangePasswordRoutes(db) {
  const r = new Hono();

  r.get('/', c => {
    const err = c.req.query('error');
    const csrfToken = c.get('session')?.csrfToken || '';
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

    if (!current || !nuevo || !confirm) return fail('Todos los campos son obligatorios.');
    if (nuevo.length < 10) return fail('La nueva contraseña debe tener al menos 10 caracteres.');
    if (nuevo !== confirm) return fail('Las contraseñas nuevas no coinciden.');
    if (nuevo === current) return fail('La nueva contraseña debe ser diferente a la actual.');

    const user = db.prepare('SELECT * FROM admin_users WHERE id=?').get(session.userId);
    if (!user) return fail('Usuario no encontrado.');
    const result = await verifyPassword(current, user.password_hash);
    if (!result.valid) return fail('La contraseña actual es incorrecta.');

    const newHash = await hashPassword(nuevo);
    db.prepare('UPDATE admin_users SET password_hash=?, must_change_password=0 WHERE id=?').run(newHash, session.userId);
    logActivity(db, session, 'password_change', 'Cambio de contraseña obligatorio completado');
    const currentToken = session.token;
    destroyAllAdminSessionsForUser(db, session.userId, currentToken);

    const user2fa = db.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').get(session.userId);
    if (user2fa?.totp_enabled) {
      return c.redirect('/admin');
    }
    return c.redirect('/admin/security?tab=2fa&msg=' + encodeURIComponent('Contraseña cambiada. Te recomendamos activar el doble factor de autenticación.'));
  });

  return r;
}
