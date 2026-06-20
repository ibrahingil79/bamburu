import { Hono } from 'hono';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { generateSecret, verify as verifyTOTP, keyuri } from '../../../core/totp.js';
import QRCode from 'qrcode';
import { hashPassword, verifyPassword, createAdminSession, destroyAdminSession, adminAuth } from '../../../core/auth.js';
import { rateLimit, getClientIp } from '../../../core/rate-limit.js';
import { recordSecurityEvent } from '../../../core/control-db.js';
import { validate } from '../../../core/validate.js';
import { loginSchema } from '../schemas.js';
import { destroyTenantSession, createTenantSession } from '../../../core/control-db.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// Tokens temporales para el segundo paso de login (5 min TTL)
const pending2FAStore = new Map();
// Secrets temporales durante el setup de 2FA (keyed por userId, 10 min TTL)
const pendingTOTPStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending2FAStore) if (now - v.created > 5 * 60 * 1000) pending2FAStore.delete(k);
  for (const [k, v] of pendingTOTPStore) if (now - v.created > 10 * 60 * 1000) pendingTOTPStore.delete(k);
}, 60000);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'admin-login',
  message: 'Demasiados intentos de login. Espera 15 minutos.',
});

function totpVerifyPage(pending, error = false) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Verificar 2FA — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5)}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:#14B8A6}
    h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:rgba(255,255,255,0.45);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input{width:100%;padding:16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:28px;font-family:monospace;letter-spacing:0.2em;text-align:center;outline:none;transition:all 0.2s}
    input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    .btn{width:100%;padding:14px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(20,184,166,0.35)}
    .error{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:#FCA5A5;margin-bottom:20px}
    .back{text-align:center;font-size:13px;color:rgba(255,255,255,0.4);margin-top:16px}
    .back a{color:rgba(255,255,255,0.4);text-decoration:none}
    .back a:hover{color:#14B8A6}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <h1>Verificar identidad</h1>
    <p class="sub">Ingresa el código de tu app autenticadora</p>
    ${error ? '<div class="error">Código incorrecto o expirado. Intenta de nuevo.</div>' : ''}
    <form method="POST" action="/admin/verify-2fa">
      <input type="hidden" name="pending" value="${pending}">
      <div class="field">
        <label>Código de 6 dígitos</label>
        <input type="text" name="code" inputmode="numeric"
               pattern="[0-9 ]{6,7}" maxlength="7"
               autofocus required placeholder="000 000"
               autocomplete="one-time-code">
      </div>
      <button type="submit" class="btn">Verificar</button>
    </form>
    <p class="back"><a href="/admin/login">← Cancelar</a></p>
  </div>
</body>
</html>`;
}

function ensureAdminRole(db, userId) {
  try {
    const existing = db.prepare('SELECT 1 FROM user_roles WHERE admin_user_id=?').get(userId);
    if (existing) return;
    const adminRole = db.prepare('SELECT id FROM roles WHERE name=?').get('Admin');
    if (adminRole) {
      db.prepare('INSERT OR IGNORE INTO user_roles (admin_user_id, role_id) VALUES (?, ?)').run(userId, adminRole.id);
    }
  } catch (_) {}
}

// Registra el vínculo cookie→negocio (control.db tenant_sessions) para que el resto de la
// navegación sepa en qué negocio está aunque el host no lo identifique (desarrollo). Mismo
// mecanismo que el auto-login del alta; en producción coincide con el subdominio.
function bindTenantSession(c, db, token, userId) {
  const tenant = c.get('tenant');
  if (!tenant) return;
  const u = db.prepare('SELECT email, role FROM admin_users WHERE id=?').get(userId);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  createTenantSession({
    tenant_id: tenant.id, session_token: token,
    user_id: userId, user_email: u?.email || '', user_role: u?.role || '', expires_at: expiresAt,
  });
}

export function createAuthRoutes(db) {
  const r = new Hono();

  r.get('/login', c => {
    const err = c.req.query('error');
    const attempts = Number(c.req.query('attempts') || 0);
    const warnBlock = attempts >= 3
      ? '<p style="font-size:12px;color:#DC2626;margin-top:6px">Después de 5 intentos fallidos tu acceso se bloqueará temporalmente.</p>'
      : '';
    return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Iniciar sesión — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5)}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:#14B8A6}
    h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:rgba(255,255,255,0.45);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px;position:relative}
    input{width:100%;padding:13px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:15px;font-family:inherit;outline:none;transition:all 0.2s}
    input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    input[type=password]{padding-right:80px}
    .toggle{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,0.4);font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;padding:4px 6px}
    .toggle:hover{color:#14B8A6}
    .btn{width:100%;padding:14px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(20,184,166,0.35)}
    .btn:active{transform:none}
    .error{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:#FCA5A5;margin-bottom:20px;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <h1>Bienvenido</h1>
    <p class="sub">Accede a tu panel de gestión</p>
    ${err ? `<div class="error">Las credenciales no son correctas. Comprueba tu email y contraseña.${warnBlock}</div>` : ''}
    <form method="POST" action="/admin/login?attempts=${attempts}">
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email"
               placeholder="tu@email.com" required autofocus
               autocomplete="email">
      </div>
      <div class="field">
        <label for="password">Contraseña</label>
        <input type="password" id="password" name="password"
               placeholder="••••••••" required
               autocomplete="current-password">
        <button type="button" class="toggle" onclick="togglePw()" id="toggle-btn">Mostrar</button>
      </div>
      <button type="submit" class="btn">Entrar</button>
    </form>
    <p style="text-align:center;font-size:13px;color:rgba(255,255,255,0.4);margin-top:16px">
      <a href="/admin/forgot-password" style="color:rgba(255,255,255,0.4);text-decoration:none" onmouseover="this.style.color='#14B8A6'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">¿Olvidaste tu contraseña?</a>
    </p>
  </div>
  <script>
    function togglePw(){
      const inp=document.getElementById('password');
      const btn=document.getElementById('toggle-btn');
      inp.type=inp.type==='password'?'text':'password';
      btn.textContent=inp.type==='password'?'Mostrar':'Ocultar';
    }
  </script>
</body>
</html>`);
  });

  r.post('/login', loginLimiter, validate(loginSchema), async c => {
    const form = c.get('validated');
    const email = (form.email || '').trim().toLowerCase();
    const password = form.password || '';
    const attempts = Number(c.req.query('attempts') || 0) + 1;
    const user = db.prepare(
      'SELECT id, password_hash, totp_enabled, totp_secret, must_change_password FROM admin_users WHERE email=? AND active=1'
    ).get(email);
    if (!user) {
      recordSecurityEvent('login_failed', getClientIp(c), c.get('tenant')?.slug, email);
      return c.redirect(`/admin/login?error=1&attempts=${attempts}`);
    }
    const result = await verifyPassword(password, user.password_hash);
    if (!result.valid) {
      recordSecurityEvent('login_failed', getClientIp(c), c.get('tenant')?.slug, email);
      return c.redirect(`/admin/login?error=1&attempts=${attempts}`);
    }
    if (result.needsRehash) {
      db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(await hashPassword(password), user.id);
    }

    console.log('[Login] user:', email, '| totp_enabled:', user.totp_enabled, '| has_secret:', !!user.totp_secret);

    // Si tiene 2FA activo, mostrar formulario TOTP
    if (user.totp_enabled === 1 && user.totp_secret) {
      const pending = randomBytes(20).toString('base64url');
      pending2FAStore.set(pending, { userId: user.id, created: Date.now() });
      return c.html(totpVerifyPage(pending));
    }

    ensureAdminRole(db, user.id);
    const token = createAdminSession(db, user.id);
    bindTenantSession(c, db, token, user.id);
    const headers = new Headers({ Location: '/admin' });
    headers.append('Set-Cookie', `asess=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
    headers.append('Set-Cookie', `btenant=; Path=/; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  });

  r.post('/verify-2fa', loginLimiter, async c => {
    const form = await c.req.parseBody();
    const pending = (form.pending || '').trim();
    const code = (form.code || '').replace(/\s/g, '');

    const entry = pending2FAStore.get(pending);
    if (!entry || Date.now() - entry.created > 5 * 60 * 1000) {
      return c.redirect('/admin/login?error=expired');
    }

    const user = db.prepare('SELECT totp_secret, active FROM admin_users WHERE id=?').get(entry.userId);
    if (!user || !user.active || !user.totp_secret) {
      return c.redirect('/admin/login?error=1');
    }

    const isValid = verifyTOTP(code, user.totp_secret);
    if (!isValid) {
      return c.html(totpVerifyPage(pending, true), 400);
    }

    pending2FAStore.delete(pending);
    ensureAdminRole(db, entry.userId);
    const sessionToken = createAdminSession(db, entry.userId);
    bindTenantSession(c, db, sessionToken, entry.userId);
    const headers = new Headers({ Location: '/admin' });
    headers.append('Set-Cookie', `asess=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
    headers.append('Set-Cookie', `btenant=; Path=/; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  });

  // ── Configuración 2FA (requieren sesión activa) ────────────────

  r.get('/setup-2fa', adminAuth(db), async c => {
    const session = c.get('session');
    const user = db.prepare('SELECT email, name, totp_enabled FROM admin_users WHERE id=?').get(session.userId);
    const err = c.req.query('error');
    const disabled = c.req.query('disabled');

    const secret = generateSecret();
    const otpauthUrl = keyuri(user.email, 'Bamburu', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 200, margin: 1 });

    // Guardar secret en store temporal (keyed por userId)
    pendingTOTPStore.set(session.userId, { secret, created: Date.now() });

    return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Autenticación de Dos Factores — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
    .card{width:100%;max-width:480px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5)}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:#14B8A6}
    h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:8px;text-align:center}
    .sub{font-size:14px;color:rgba(255,255,255,0.45);text-align:center;margin-bottom:24px}
    .qr-box{text-align:center;margin:20px 0;padding:16px;background:white;border-radius:12px;display:inline-block;width:100%}
    .secret-box{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 14px;font-family:monospace;font-size:13px;color:#94a3b8;word-break:break-all;text-align:center;margin-bottom:20px}
    label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input[type=text]{width:100%;padding:13px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:18px;font-family:monospace;letter-spacing:0.15em;text-align:center;outline:none;transition:all 0.2s}
    input[type=text]:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    .btn{width:100%;padding:14px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(20,184,166,0.35)}
    .btn-danger{background:linear-gradient(135deg,#ef4444,#b91c1c)}
    .btn-danger:hover{box-shadow:0 8px 30px rgba(239,68,68,0.35)}
    .error{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:#FCA5A5;margin-bottom:20px}
    .ok{background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:#6ee7b7;margin-bottom:20px}
    .back{text-align:center;font-size:13px;color:rgba(255,255,255,0.4);margin-top:16px}
    .back a{color:#14B8A6;text-decoration:none}
    .divider{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0}
    p.hint{font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:16px;line-height:1.5}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .badge-on{background:rgba(16,185,129,0.15);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3)}
    .badge-off{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.1)}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <h1>Autenticación de dos factores</h1>
    <p class="sub">Estado: <span class="badge ${user.totp_enabled ? 'badge-on' : 'badge-off'}">${user.totp_enabled ? 'Activada' : 'Desactivada'}</span></p>

    ${disabled ? '<div class="ok">2FA desactivada correctamente.</div>' : ''}
    ${err ? '<div class="error">Código incorrecto. Intenta de nuevo.</div>' : ''}

    ${user.totp_enabled ? `
    <p class="hint">Tu cuenta ya tiene 2FA activada. Si quieres desactivarla:</p>
    <form method="POST" action="/admin/disable-2fa" onsubmit="return confirm('¿Seguro que quieres desactivar 2FA?')">
      <button type="submit" class="btn btn-danger">Desactivar 2FA</button>
    </form>
    <hr class="divider">
    <p class="hint" style="text-align:center">Para reconfigurar 2FA con un nuevo dispositivo, desactívala primero.</p>
    ` : `
    <p class="hint">Escanea este código QR con <strong style="color:#fff">Google Authenticator</strong>, <strong style="color:#fff">Authy</strong> o cualquier app TOTP:</p>
    <div class="qr-box">
      <img src="${qrDataUrl}" width="200" height="200" alt="QR 2FA">
    </div>
    <p class="hint" style="text-align:center;margin-bottom:8px">O ingresa esta clave manualmente:</p>
    <div class="secret-box">${secret}</div>
    <form method="POST" action="/admin/confirm-2fa">
      <div class="field">
        <label>Código de verificación (6 dígitos)</label>
        <input type="text" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}"
               maxlength="7" autofocus required placeholder="000 000">
      </div>
      <button type="submit" class="btn">Verificar y Activar 2FA</button>
    </form>
    `}

    <p class="back"><a href="/admin">← Volver al panel</a></p>
  </div>
</body>
</html>`);
  });

  r.post('/confirm-2fa', adminAuth(db), async c => {
    const session = c.get('session');
    const form = await c.req.parseBody();
    const code = (form.code || '').replace(/\s/g, '');

    const entry = pendingTOTPStore.get(session.userId);
    if (!entry || Date.now() - entry.created > 10 * 60 * 1000) {
      return c.redirect('/admin/setup-2fa?error=expired');
    }

    const isValid = verifyTOTP(code, entry.secret);
    if (!isValid) {
      return c.redirect('/admin/setup-2fa?error=1');
    }

    db.prepare('UPDATE admin_users SET totp_secret=?, totp_enabled=1 WHERE id=?')
      .run(entry.secret, session.userId);
    pendingTOTPStore.delete(session.userId);

    return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>2FA Activada — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5);text-align:center}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px}
    .logo span{color:#14B8A6}
    .icon{font-size:48px;margin-bottom:16px}
    p{color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;margin-bottom:16px}
    .ok{color:#6ee7b7;font-weight:700;font-size:18px;margin-bottom:8px}
    a{color:#14B8A6;text-decoration:none;font-size:14px;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <div class="icon">🔐</div>
    <p class="ok">¡2FA Activada!</p>
    <p>A partir de ahora necesitarás tu app de autenticación cada vez que inicies sesión.</p>
    <a href="/admin">Ir al panel</a>
  </div>
</body>
</html>`);
  });

  r.post('/disable-2fa', adminAuth(db), c => {
    const session = c.get('session');
    db.prepare('UPDATE admin_users SET totp_secret=NULL, totp_enabled=0 WHERE id=?')
      .run(session.userId);
    return c.redirect('/admin/setup-2fa?disabled=1');
  });

  // ── Recuperación de contraseña ─────────────────────────────────

  r.get('/forgot-password', c => {
    return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Recuperar Contraseña — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5)}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:#14B8A6}
    h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:rgba(255,255,255,0.45);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input{width:100%;padding:13px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:15px;font-family:inherit;outline:none;transition:all 0.2s}
    input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    .btn{width:100%;padding:14px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(20,184,166,0.35)}
    .back{text-align:center;font-size:13px;color:rgba(255,255,255,0.4);margin-top:16px}
    .back a{color:rgba(255,255,255,0.4);text-decoration:none}
    .back a:hover{color:#14B8A6}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <h1>Recuperar Contraseña</h1>
    <p class="sub">Te enviaremos un enlace a tu email</p>
    <form method="POST" action="/admin/forgot-password">
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email"
               placeholder="tu@email.com" required autofocus>
      </div>
      <button type="submit" class="btn">Enviar enlace</button>
    </form>
    <p class="back"><a href="/admin/login">Volver al login</a></p>
  </div>
</body>
</html>`);
  });

  r.post('/forgot-password', async c => {
    const form = await c.req.parseBody();
    const email = (form.email || '').trim().toLowerCase();

    if (!email) {
      return c.html('<p>Email requerido</p>', 400);
    }

    const user = db.prepare(
      'SELECT id, name FROM admin_users WHERE email = ? AND active = 1'
    ).get(email);

    // Respuesta genérica para no revelar si el email existe
    const successHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Email enviado — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5);text-align:center}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px}
    .logo span{color:#14B8A6}
    p{color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;margin-bottom:12px}
    .ok{color:#10b981;font-weight:600;font-size:15px}
    a{color:#14B8A6;text-decoration:none;font-size:13px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <p class="ok">Revisa tu bandeja de entrada</p>
    <p>Si el email existe en nuestra base de datos, recibirás un enlace para recuperar tu contraseña.</p>
    <a href="/admin/login">Volver al login</a>
  </div>
</body>
</html>`;

    if (!user) {
      return c.html(successHtml);
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    try {
      db.prepare(`
        INSERT INTO password_reset_tokens (admin_user_id, token, expires_at)
        VALUES (?, ?, ?)
      `).run(user.id, token, expiresAt);

      const host = c.req.header('host') || 'bamburu.com';
      const resetLink = `https://${host}/admin/reset-password?token=${token}`;

      console.log('[Resend] Enviando email a:', email);
      console.log('[Resend] API Key presente:', !!process.env.RESEND_API_KEY);
      console.log('[Resend] Reset link:', resetLink);

      const { data, error: resendError } = await resend.emails.send({
        from: 'Bamburu <noreply@bamburu.com>',
        to: email,
        subject: 'Recupera tu contraseña en Bamburu',
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px">
            <h2 style="color:#070B14;font-size:20px;margin-bottom:16px">Hola, ${user.name}</h2>
            <p style="color:#374151;font-size:15px;line-height:1.6;margin-bottom:24px">
              Hemos recibido una solicitud para recuperar tu contraseña en Bamburu.
            </p>
            <a href="${resetLink}"
               style="background:#14B8A6;color:white;padding:12px 24px;border-radius:8px;
                      text-decoration:none;display:inline-block;font-weight:600;font-size:15px">
              Recuperar Contraseña
            </a>
            <p style="color:#6b7280;font-size:13px;margin-top:24px">
              Este enlace expira en 1 hora. Si no solicitaste esto, ignora este email.
            </p>
          </div>
        `
      });

      if (resendError) {
        console.error('[Resend] Error de API:', JSON.stringify(resendError));
        return c.html('<p style="color:red">Error al enviar el email. Intenta más tarde.</p>', 500);
      }

      console.log('[Resend] Email enviado OK, id:', data?.id);
      return c.html(successHtml);
    } catch (err) {
      console.error('[Auth] Error enviando email de recuperación:', err);
      return c.html('<p style="color:red">Error al enviar el email. Intenta más tarde.</p>', 500);
    }
  });

  r.get('/reset-password', c => {
    const token = c.req.query('token');
    if (!token) return c.redirect('/admin/login');

    return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nueva Contraseña — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5)}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:#14B8A6}
    h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:rgba(255,255,255,0.45);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input{width:100%;padding:13px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:15px;font-family:inherit;outline:none;transition:all 0.2s}
    input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    .btn{width:100%;padding:14px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(20,184,166,0.35)}
    .error{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:#FCA5A5;margin-bottom:20px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <h1>Nueva Contraseña</h1>
    <p class="sub">Elige una contraseña segura</p>
    <form method="POST" action="/admin/reset-password">
      <input type="hidden" name="token" value="${token}">
      <div class="field">
        <label for="password">Nueva contraseña</label>
        <input type="password" id="password" name="password"
               placeholder="Mínimo 8 caracteres" required minlength="8">
      </div>
      <div class="field">
        <label for="password2">Confirmar contraseña</label>
        <input type="password" id="password2" name="password2"
               placeholder="Repite la contraseña" required minlength="8">
      </div>
      <button type="submit" class="btn">Cambiar Contraseña</button>
    </form>
  </div>
</body>
</html>`);
  });

  r.post('/reset-password', async c => {
    const form = await c.req.parseBody();
    const { token, password, password2 } = form;

    if (!password || password.length < 8) {
      return c.html('<p style="color:#FCA5A5">La contraseña debe tener mínimo 8 caracteres.</p>', 400);
    }
    if (password !== password2) {
      return c.html('<p style="color:#FCA5A5">Las contraseñas no coinciden.</p>', 400);
    }

    try {
      const resetToken = db.prepare(`
        SELECT admin_user_id, expires_at FROM password_reset_tokens
        WHERE token = ? AND used = 0
      `).get(token);

      if (!resetToken) {
        return c.html('<p style="color:#FCA5A5">Token inválido o ya utilizado.</p>', 400);
      }

      if (new Date(resetToken.expires_at) < new Date()) {
        return c.html('<p style="color:#FCA5A5">Token expirado. <a href="/admin/forgot-password">Solicita uno nuevo</a>.</p>', 400);
      }

      const hash = await hashPassword(password);
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
        .run(hash, resetToken.admin_user_id);
      db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?')
        .run(token);

      return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Contraseña cambiada — Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,0.5);text-align:center}
    .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:28px}
    .logo span{color:#14B8A6}
    p{color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;margin-bottom:16px}
    .ok{color:#10b981;font-weight:600;font-size:16px}
    a{color:#14B8A6;text-decoration:none;font-size:14px;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Bam<span>buru</span></div>
    <p class="ok">¡Contraseña cambiada!</p>
    <p>Tu contraseña se ha actualizado correctamente.</p>
    <a href="/admin/login">Ir al login</a>
  </div>
</body>
</html>`);
    } catch (err) {
      console.error('[Auth] Error en reset-password:', err);
      return c.html('<p style="color:#FCA5A5">Error al cambiar la contraseña. Intenta más tarde.</p>', 500);
    }
  });

  // (El auto-login tras el alta vive ahora en el APEX — index.js — y resuelve el negocio
  //  desde el token, no desde el subdominio. Aquí ya no hace falta.)

  r.get('/logout', c => {
    const cookie = c.req.header('cookie') || '';
    const match = cookie.match(/asess=([A-Za-z0-9_-]+)/);
    if (match) { destroyAdminSession(db, match[1]); destroyTenantSession(match[1]); }
    const headers = new Headers({ Location: '/admin/login' });
    headers.set('Set-Cookie', 'asess=; Path=/; Max-Age=0');
    return new Response(null, { status: 302, headers });
  });

  return r;
}
