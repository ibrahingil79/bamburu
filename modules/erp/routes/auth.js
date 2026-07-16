import { renderEmail, TONO_UNICO } from '../email-templates.js';
import { Hono } from 'hono';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { generateSecret, verify as verifyTOTP, keyuri } from '../../../core/totp.js';
import QRCode from 'qrcode';
import { hashPassword, verifyPassword, createAdminSession, destroyAdminSession, adminAuth } from '../../../core/auth.js';
import { rateLimit, getClientIp } from '../../../core/rate-limit.js';
import { recordSecurityEvent } from '../../../core/control-db.js';
import { validate } from '../../../core/validate.js';
import { loginSchema, forgotSchema } from '../schemas.js';
import { ROOT_TOKENS } from '../layout.js';
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

// C5/M6 — el freno de "he olvidado mi contraseña". Van los DOS, y por eso son dos:
//   · por IP    — que nadie barra la lista de emails desde un sitio para ver cuáles existen.
//   · por email — que nadie inunde el buzón de UNA persona repartiendo la petición entre muchas IPs.
// Solo el de IP frenaría lo primero pero no lo segundo. Cupos bajos a propósito: pedir el enlace es
// algo que se hace una vez, no tres seguidas; 3/15 min por email sobra para el uso honesto.
const forgotIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'admin-forgot-ip',
  message: 'Demasiadas peticiones de recuperación. Espera 15 minutos.',
});
const forgotEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyPrefix: 'admin-forgot-email',
  // El email sale de `validated` (lo dejó ahí validate(forgotSchema), que corre justo antes): así se
  // limita por la cuenta ya normalizada en minúsculas y no se vuelve a leer el cuerpo.
  keyFn: (c) => c.get('validated')?.email?.trim().toLowerCase() || null,
  message: 'Demasiadas peticiones de recuperación. Espera 15 minutos.',
});

function totpVerifyPage(pending, error = false) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Verificar 2FA — Bamburu</title>
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10)}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:var(--accent)}
    h1{font-size:20px;font-weight:500;color:var(--text);margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:var(--text2);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input{width:100%;padding:16px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--text);font-size:28px;font-family:monospace;letter-spacing:0.2em;text-align:center;outline:none;transition:all 0.2s}
    input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,65,80,0.15)}
    .btn{width:100%;padding:14px;background:var(--accent);color:var(--bg2);border:none;border-radius:12px;font-size:15px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(58,65,80,0.35)}
    .error{background:var(--danger-s);border:1px solid rgba(166,69,63,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--danger);margin-bottom:20px}
    .back{text-align:center;font-size:13px;color:var(--text2);margin-top:16px}
    .back a{color:var(--text2);text-decoration:none}
    .back a:hover{color:var(--accent)}
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

// Crea el token de reseteo y manda el correo. Corre FUERA de la respuesta (ver POST /forgot-password):
// quien la llama no la espera, así que aquí no se decide nada de lo que ve el usuario — solo se hace
// el trabajo y se registra lo que falle. Recibe todo ya resuelto (db, host) en vez de leerlo del
// contexto: para cuando esto corre, la petición ya se respondió y `c` no es sitio de donde fiarse.
async function enviarEnlaceReseteo(db, { host, user, email }) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO password_reset_tokens (admin_user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(user.id, token, expiresAt);

  const resetLink = `https://${host}/admin/reset-password?token=${token}`;

  // NUNCA se registra el enlace: lleva el token de reseteo, y un token en un log es un token
  // filtrado — cualquiera con acceso a los registros podría entrar en la cuenta de otro. Misma
  // lección que la clave de Anthropic en el log de sudo (11-jul-2026): un secreto no va a un log.
  console.log('[Resend] Enviando email de recuperación (destinatario oculto)');

  // El TEXTO sale del catálogo de plantillas (editable en Ajustes). {{enlace}} es su ELEMENTO
  // CRÍTICO: Ajustes NO deja guardar esta plantilla sin él — un "recupera tu contraseña" sin
  // enlace deja a una persona fuera de su cuenta, y nadie se entera hasta que pasa.
  const tpl = renderEmail(db, 'recuperar_password', TONO_UNICO, { nombre: user.name, enlace: resetLink });
  const { data, error: resendError } = await resend.emails.send({
    from: 'Bamburu <noreply@bamburu.com>',
    to: email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });

  // Resend devuelve { data, error } — no lanza. Si falla, se ve AQUÍ, en el servidor.
  if (resendError) throw new Error('Resend: ' + JSON.stringify(resendError));
  console.log('[Resend] Email enviado OK, id:', data?.id);
}

export function createAuthRoutes(db) {
  const r = new Hono();

  r.get('/login', c => {
    const err = c.req.query('error');
    const attempts = Number(c.req.query('attempts') || 0);
    const warnBlock = attempts >= 3
      ? '<p style="font-size:12px;color:var(--danger);margin-top:6px">Después de 5 intentos fallidos tu acceso se bloqueará temporalmente.</p>'
      : '';
    return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Iniciar sesión — Bamburu</title>
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10)}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:var(--accent)}
    h1{font-size:20px;font-weight:500;color:var(--text);margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:var(--text2);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px;position:relative}
    input{width:100%;padding:13px 16px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--text);font-size:15px;font-family:inherit;outline:none;transition:all 0.2s}
    input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,65,80,0.15)}
    input[type=password]{padding-right:80px}
    .toggle{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text2);font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;padding:4px 6px}
    .toggle:hover{color:var(--accent)}
    .btn{width:100%;padding:14px;background:var(--accent);color:var(--bg2);border:none;border-radius:12px;font-size:15px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(58,65,80,0.35)}
    .btn:active{transform:none}
    .error{background:var(--danger-s);border:1px solid rgba(166,69,63,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--danger);margin-bottom:20px;line-height:1.5}
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
    <p style="text-align:center;font-size:13px;color:var(--text2);margin-top:16px">
      <a href="/admin/forgot-password" style="color:var(--text2);text-decoration:none" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text2)'">¿Olvidaste tu contraseña?</a>
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

    // C3/M7 (Eje C): NO se registra el email ni el estado de 2FA (PII + reconocimiento de qué cuentas
    // tienen 2FA). Solo un id interno para depurar, sin dato identificable ni de seguridad.
    console.log('[Login] ok userId:', user.id);

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
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
    .card{width:100%;max-width:480px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10)}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:var(--accent)}
    h1{font-size:20px;font-weight:500;color:var(--text);margin-bottom:8px;text-align:center}
    .sub{font-size:14px;color:var(--text2);text-align:center;margin-bottom:24px}
    .qr-box{text-align:center;margin:20px 0;padding:16px;background:var(--bg2);border-radius:12px;display:inline-block;width:100%}
    .secret-box{background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:10px 14px;font-family:monospace;font-size:13px;color:var(--text2);word-break:break-all;text-align:center;margin-bottom:20px}
    label{display:block;font-size:12px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input[type=text]{width:100%;padding:13px 16px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--text);font-size:18px;font-family:monospace;letter-spacing:0.15em;text-align:center;outline:none;transition:all 0.2s}
    input[type=text]:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,65,80,0.15)}
    .btn{width:100%;padding:14px;background:var(--accent);color:var(--bg2);border:none;border-radius:12px;font-size:15px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(58,65,80,0.35)}
    .btn-danger{background:linear-gradient(135deg,var(--danger),var(--danger))}
    .btn-danger:hover{box-shadow:0 8px 30px rgba(239,68,68,0.35)}
    .error{background:var(--danger-s);border:1px solid rgba(166,69,63,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--danger);margin-bottom:20px}
    .ok{background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--ok-s);margin-bottom:20px}
    .back{text-align:center;font-size:13px;color:var(--text2);margin-top:16px}
    .back a{color:var(--accent);text-decoration:none}
    .divider{border:none;border-top:1px solid var(--border);margin:24px 0}
    p.hint{font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.5}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500}
    .badge-on{background:rgba(16,185,129,0.15);color:var(--ok-s);border:1px solid rgba(16,185,129,0.3)}
    .badge-off{background:var(--accent-soft);color:var(--text2);border:1px solid var(--border2)}
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
    <p class="hint">Escanea este código QR con <strong style="color:var(--text)">Google Authenticator</strong>, <strong style="color:var(--text)">Authy</strong> o cualquier app TOTP:</p>
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
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10);text-align:center}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px}
    .logo span{color:var(--accent)}
    .icon{font-size:48px;margin-bottom:16px}
    p{color:var(--text2);font-size:14px;line-height:1.6;margin-bottom:16px}
    .ok{color:var(--ok-s);font-weight:500;font-size:18px;margin-bottom:8px}
    a{color:var(--accent);text-decoration:none;font-size:14px;font-weight:500}
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
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10)}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:var(--accent)}
    h1{font-size:20px;font-weight:500;color:var(--text);margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:var(--text2);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input{width:100%;padding:13px 16px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--text);font-size:15px;font-family:inherit;outline:none;transition:all 0.2s}
    input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,65,80,0.15)}
    .btn{width:100%;padding:14px;background:var(--accent);color:var(--bg2);border:none;border-radius:12px;font-size:15px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(58,65,80,0.35)}
    .back{text-align:center;font-size:13px;color:var(--text2);margin-top:16px}
    .back a{color:var(--text2);text-decoration:none}
    .back a:hover{color:var(--accent)}
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

  r.post('/forgot-password', forgotIpLimiter, validate(forgotSchema), forgotEmailLimiter, async c => {
    const email = (c.get('validated').email || '').trim().toLowerCase();

    const user = db.prepare(
      'SELECT id, name FROM admin_users WHERE email = ? AND active = 1'
    ).get(email);

    // Respuesta genérica para no revelar si el email existe
    const successHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Email enviado — Bamburu</title>
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10);text-align:center}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px}
    .logo span{color:var(--accent)}
    p{color:var(--text2);font-size:14px;line-height:1.6;margin-bottom:12px}
    .ok{color:var(--ok);font-weight:500;font-size:15px}
    a{color:var(--accent);text-decoration:none;font-size:13px}
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

    // C5/M6 — la respuesta es LA MISMA, y tarda LO MISMO, exista o no la cuenta.
    //
    // El texto ya era idéntico, pero el reloj cantaba: un email desconocido volvía al instante y uno
    // conocido esperaba al INSERT y a Resend (cientos de ms). Esa diferencia, sola, era un buscador
    // de cuentas registradas — sin leer la respuesta, cronometrándola. Y encima, si Resend fallaba
    // salía un 500 que SOLO podía verse con un email que existe: el error era la confirmación.
    //
    // Por eso el trabajo real no se espera: se lanza y se responde. Ningún fallo del envío cambia lo
    // que ve quien pregunta; se registra en el servidor, que es donde hay que verlo. Contrapartida
    // aceptada: si el envío falla, el usuario no se entera en la pantalla — hace lo mismo que haría
    // si el correo se perdiera en el camino, volver a pedirlo. Lo que NO puede pasar es que el fallo
    // le diga a un desconocido cuáles de sus 10.000 emails son clientes de Bamburu.
    if (user) {
      const host = c.req.header('host') || 'bamburu.com';
      // setImmediate, y NO llamar y no esperar. Parece lo mismo y no lo es: el cuerpo de una función
      // async corre SÍNCRONO hasta su primer await, y ahí dentro el INSERT del token y renderEmail
      // son de better-sqlite3, o sea síncronos. Sin esto, el trabajo se hacía igual antes de
      // responder y el reloj seguía cantando: medido, 6,8 ms con cuenta real contra 0,7 ms sin ella
      // —10× y sin solapamiento—, o sea que UNA medición bastaba para saber si el email existe. Con
      // setImmediate la respuesta sale primero y el trabajo cae después: 1,0× y ramas indistinguibles.
      setImmediate(() => {
        enviarEnlaceReseteo(db, { host, user, email })
          .catch(err => console.error('[Auth] Error enviando email de recuperación:', err));
      });
    }
    return c.html(successHtml);
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
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10)}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px;text-align:center}
    .logo span{color:var(--accent)}
    h1{font-size:20px;font-weight:500;color:var(--text);margin-bottom:6px;text-align:center}
    .sub{font-size:14px;color:var(--text2);text-align:center;margin-bottom:28px}
    label{display:block;font-size:12px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px}
    .field{margin-bottom:20px}
    input{width:100%;padding:13px 16px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;color:var(--text);font-size:15px;font-family:inherit;outline:none;transition:all 0.2s}
    input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,65,80,0.15)}
    .btn{width:100%;padding:14px;background:var(--accent);color:var(--bg2);border:none;border-radius:12px;font-size:15px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.2s;margin-top:4px}
    .btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(58,65,80,0.35)}
    .error{background:var(--danger-s);border:1px solid rgba(166,69,63,0.2);border-radius:12px;padding:12px 16px;font-size:13px;color:var(--danger);margin-bottom:20px}
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
      return c.html('<p style="color:var(--danger)">La contraseña debe tener mínimo 8 caracteres.</p>', 400);
    }
    if (password !== password2) {
      return c.html('<p style="color:var(--danger)">Las contraseñas no coinciden.</p>', 400);
    }

    try {
      const resetToken = db.prepare(`
        SELECT admin_user_id, expires_at FROM password_reset_tokens
        WHERE token = ? AND used = 0
      `).get(token);

      if (!resetToken) {
        return c.html('<p style="color:var(--danger)">Token inválido o ya utilizado.</p>', 400);
      }

      if (new Date(resetToken.expires_at) < new Date()) {
        return c.html('<p style="color:var(--danger)">Token expirado. <a href="/admin/forgot-password">Solicita uno nuevo</a>.</p>', 400);
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
  <style>${ROOT_TOKENS}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{width:100%;max-width:400px;padding:40px 36px;background:var(--bg2);border:1px solid var(--border);border-radius:24px;box-shadow:0 16px 44px rgba(16,24,40,.10);text-align:center}
    .logo{font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.03em;margin-bottom:28px}
    .logo span{color:var(--accent)}
    p{color:var(--text2);font-size:14px;line-height:1.6;margin-bottom:16px}
    .ok{color:var(--ok);font-weight:500;font-size:16px}
    a{color:var(--accent);text-decoration:none;font-size:14px;font-weight:500}
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
      return c.html('<p style="color:var(--danger)">Error al cambiar la contraseña. Intenta más tarde.</p>', 500);
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
