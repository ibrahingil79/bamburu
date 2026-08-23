import { renderEmail, TONO_UNICO } from '../email-templates.js';
import { Hono } from 'hono';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { verify as verifyTOTP } from '../../../core/totp.js';
import { hashPassword, verifyPassword, createAdminSession, destroyAdminSession, adminAuth, destroyAllAdminSessionsForUser,
         listUnusedAdminRecoveryCodes, consumeAdminRecoveryCode, countUnusedAdminRecoveryCodes, logActivity } from '../../../core/auth.js';
import { buscarCodigo } from '../../../core/recovery-codes.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { rateLimit, getClientIp, throttlePorFallos, registrarFallo, limpiarFallos } from '../../../core/rate-limit.js';
import { recordSecurityEvent } from '../../../core/control-db.js';
import { validate } from '../../../core/validate.js';
import { loginSchema, forgotSchema } from '../schemas.js';
import { ROOT_TOKENS } from '../layout.js';
import { destroyTenantSession, createTenantSession } from '../../../core/control-db.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// Tokens temporales para el segundo paso de login (5 min TTL). El almacén del ALTA del 2FA
// (pendingTOTPStore) ya no vive aquí: se fue con las rutas huérfanas (C5-bis). El del alta está en
// perfil.js, que es donde se activa el 2FA.
const pending2FAStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending2FAStore) if (now - v.created > 5 * 60 * 1000) pending2FAStore.delete(k);
}, 60000);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'admin-login',
  message: 'Demasiados intentos de login. Espera 15 minutos.',
});

// C6/B4 — freno por CUENTA, encadenado al de IP de arriba. El de IP no ve a un atacante que rota
// IPs; este cuenta los fallos de ESA cuenta vengan de donde vengan. Ralentiza, nunca rechaza: ver el
// porqué en core/rate-limit.js. 5 fallos gratis, luego +2 s por fallo hasta un techo de 10 s.
const LOGIN_CUENTA = 'admin-login-cuenta';
const loginThrottleCuenta = throttlePorFallos({
  windowMs: 15 * 60 * 1000,
  after: 5,
  stepMs: 2000,
  maxMs: 10_000,
  keyPrefix: LOGIN_CUENTA,
  keyFn: (c) => c.get('validated')?.email?.trim().toLowerCase() || null,
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
    ${error ? '<div class="error">Código incorrecto o ya usado. Intenta de nuevo.</div>' : ''}
    <form method="POST" action="/admin/verify-2fa">
      <input type="hidden" name="pending" value="${pending}">
      <div class="field">
        <label>Código de la app (o uno de rescate)</label>
        <input type="text" name="code" inputmode="text"
               maxlength="20"
               autofocus required placeholder="000000"
               autocomplete="one-time-code">
      </div>
      <button type="submit" class="btn">Verificar</button>
    </form>
    <p class="back" style="margin-top:14px;line-height:1.5">¿Perdiste el móvil? Escribe aquí uno de los
    <strong style="color:var(--text2)">códigos de rescate</strong> que guardaste al activar la verificación.</p>
    <p class="back"><a href="/admin/login">← Cancelar</a></p>
  </div>
</body>
</html>`;
}

// ── B12 · RETIRADO el 23 ago 2026 (noche, punto 8) ─────────────────────────────────────────────
// AQUÍ VIVÍA `ensureAdminRole()`, que en CADA login escribía una fila en `user_roles`… que no lee
// nadie. Los permisos de este producto se aplican SOLO con `user_permissions`; `roles`,
// `role_permissions` y `user_roles` estaban sembradas y muertas desde siempre.
//
// SE RETIRA, no se cablea, y el motivo es de fondo: cablearlas sería REDISEÑAR el modelo de
// permisos —pasar de permisos por persona a permisos por rol—, que es una decisión de producto del
// dueño y una tarea entera, no la limpieza de una noche. Y dejarlas es peor que quitarlas: un
// esquema con `roles` y `role_permissions` **parece** un sistema de permisos, así que el día que
// alguien le dé el rol «Admin» a un empleado creerá que le ha concedido algo. No le concede nada.
// Un control de seguridad de mentira es peor que no tenerlo.
//
// LAS TABLAS NO SE DESTRUYEN: la migración las renombra a `*_archived` (regla permanente del
// proyecto). Lo que se va es la ESCRITURA en el camino vivo — que además ocurría en cada login.
// `permissions` y `user_permissions` NO se tocan: son las que mandan de verdad.

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

// Cierra TODAS las sesiones de un usuario: las de esta BD y su espejo en control.db (el vínculo
// cookie→negocio). Los tokens se leen ANTES de borrarlos — después no habría con qué limpiar el
// espejo. Gemelo del de users.js (C5/M5): el mismo trabajo, ahora también desde el reset.
function revocarSesiones(db, userId) {
  const tokens = db.prepare('SELECT token FROM admin_sessions WHERE user_id=?').all(userId).map(r => r.token);
  destroyAllAdminSessionsForUser(db, userId);
  for (const t of tokens) { try { destroyTenantSession(t); } catch (_) {} }
  return tokens.length;
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

  // El orden manda: loginLimiter frena por IP · validate deja el email normalizado en `validated` ·
  // loginThrottleCuenta lo lee de ahí para frenar por CUENTA. Los dos, porque cada uno tapa lo que
  // el otro no ve: el de IP, el barrido desde un sitio; el de cuenta, el asedio a UNA persona desde
  // mil sitios.
  r.post('/login', loginLimiter, validate(loginSchema), loginThrottleCuenta, async c => {
    const form = c.get('validated');
    const email = (form.email || '').trim().toLowerCase();
    const password = form.password || '';
    const attempts = Number(c.req.query('attempts') || 0) + 1;
    const slug = c.get('tenant')?.slug;
    // C6/B4 — el fallo se apunta con el email TECLEADO, exista la cuenta o no. Si solo se apuntaran
    // los de cuentas reales, la espera diría cuáles existen: el freno sería el chivato. Ese email es
    // una clave EN MEMORIA que se olvida sola; no se persiste en ningún sitio.
    //
    // C5-ter/T2 — al evento de vigilancia NO va el email. Iba, y era la contradicción de todo el Eje
    // C: en C6 cerramos que nadie pudiera sonsacar "¿existe este email?" por HTTP… y la tabla lo
    // guardaba en claro, con la lista de los que se probaron y cuáles existían. Minimización de
    // datos: si el evento es de una cuenta CONOCIDA se guarda la referencia que ya usa el resto del
    // sistema (su id); si es un email desconocido, no se guarda el email — solo que alguien probó
    // una cuenta que no existe, que es la señal útil (alguien barriendo) sin el dato personal.
    // No se hashea: nada correlaciona por aquí (el detail solo se PINTA en el panel de Seguridad,
    // y securityCounts agrupa por `type`), así que un hash sería mecanismo nuevo sin nadie que lo use.
    const fallar = (user = null) => {
      registrarFallo(LOGIN_CUENTA, email, slug || 'global');
      recordSecurityEvent('login_failed', getClientIp(c), slug,
        user ? `usuario #${user.id}` : 'cuenta desconocida');
      return c.redirect(`/admin/login?error=1&attempts=${attempts}`);
    };
    const user = db.prepare(
      'SELECT id, password_hash, totp_enabled, totp_secret, must_change_password FROM admin_users WHERE email=? AND active=1'
    ).get(email);
    if (!user) return fallar();
    const result = await verifyPassword(password, user.password_hash);
    if (!result.valid) return fallar(user);
    if (result.needsRehash) {
      db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(await hashPassword(password), user.id);
    }
    // Contraseña correcta: el historial de fallos se borra. Quien demuestra que es él no arrastra
    // los intentos de nadie — es lo que impide que esto se convierta en un bloqueo de facto.
    limpiarFallos(LOGIN_CUENTA, email, slug || 'global');

    // C3/M7 + C5-ter/T2 (Eje C): el email NO se registra en NINGÚN sitio del login — ni en este log
    // ni en la tabla de eventos (ver `fallar`, arriba). Tampoco el estado del 2FA: diría qué cuentas
    // lo tienen. Solo un id interno para depurar, sin dato identificable ni de seguridad.
    //
    // Este comentario decía lo mismo desde C3/M7 y era FALSO como regla: valía para esta línea, pero
    // quince más arriba el email sí iba a la tabla. Un comentario que enuncia una regla que el propio
    // fichero incumple es peor que no tener comentario: deja tranquilo a quien lo lee. Ahora es cierto.
    console.log('[Login] ok userId:', user.id);

    // Si tiene 2FA activo, mostrar formulario TOTP
    if (user.totp_enabled === 1 && user.totp_secret) {
      const pending = randomBytes(20).toString('base64url');
      pending2FAStore.set(pending, { userId: user.id, created: Date.now() });
      return c.html(totpVerifyPage(pending));
    }

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

    const user = db.prepare('SELECT id, name, totp_secret, active FROM admin_users WHERE id=?').get(entry.userId);
    if (!user || !user.active || !user.totp_secret) {
      return c.redirect('/admin/login?error=1');
    }

    // C5-bis — el mismo campo acepta el código de la app Y uno de rescate. Quien llega aquí sin móvil
    // no tiene que encontrar otro botón: escribe lo que tiene y entra.
    //
    // Primero el TOTP (el caso normal): un código correcto no debería pagar diez bcrypt de rescate por
    // el camino. Espejo del superadmin (modules/superadmin/index.js).
    let entra = verifyTOTP(code, user.totp_secret);
    let porRescate = false;
    if (!entra) {
      const fila = await buscarCodigo(code, listUnusedAdminRecoveryCodes(db, user.id));
      // El código se quema AQUÍ, y solo si de verdad estaba sin usar: consumeAdminRecoveryCode
      // devuelve false si otra petición lo gastó primero. Un mismo papel no abre dos veces.
      if (fila && consumeAdminRecoveryCode(db, fila.id)) { entra = true; porRescate = true; }
    }
    if (!entra) {
      recordSecurityEvent('login_2fa_failed', getClientIp(c), c.get('tenant')?.slug, '');
      return c.html(totpVerifyPage(pending, true), 400);
    }

    if (porRescate) {
      // Que se gaste un código de rescate es NOTICIA para el dueño: o perdió el móvil, o alguien está
      // entrando con un papel suyo. Va a SU Actividad (que es donde mira) y al panel de seguridad de
      // la plataforma. El código NUNCA se registra: sería publicar la llave que se acaba de usar.
      const quedan = countUnusedAdminRecoveryCodes(db, user.id);
      logActivity(db, { userId: user.id, userName: user.name },
        'Entró con un código de rescate (sin la app de autenticación)', ENTITY.ADMIN_USER, user.id,
        `Quedan ${quedan} códigos de rescate sin usar`);
      recordSecurityEvent('login_2fa_rescate', getClientIp(c), c.get('tenant')?.slug, `quedan ${quedan}`);
      console.warn(`[Login] Entrada con CÓDIGO DE RESCATE. userId: ${user.id}. Quedan ${quedan}.`);
    }

    pending2FAStore.delete(pending);
    const sessionToken = createAdminSession(db, entry.userId);
    bindTenantSession(c, db, sessionToken, entry.userId);
    const headers = new Headers({ Location: '/admin' });
    headers.append('Set-Cookie', `asess=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
    headers.append('Set-Cookie', `btenant=; Path=/; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  });

  // ── 2FA del dueño: RETIRADO de aquí. Vive en /admin/perfil ─────
  //
  // C5-bis. Estas tres rutas (setup-2fa / confirm-2fa / disable-2fa) quedaron HUÉRFANAS en U8, que
  // consolidó el 2FA en el Perfil: no las enlaza ninguna pantalla, pero seguían montadas y
  // funcionando. `security.js` ya lo dejó anotado como pendiente del Eje C — con dos motivos, y hoy
  // se le suma el tercero, que es el que obliga:
  //   1. Se montan ANTES del middleware CSRF (routes/index.js: `app.route('/admin', authRoutes)` va
  //      antes de `admin.use('*', csrf)`), así que sus formularios no llevaban `_csrf`.
  //   2. Duplicaban el 2FA: dos pantallas escribiendo las mismas columnas. Justo lo que U8 deshizo.
  //   3. ACTIVABAN EL 2FA SIN CÓDIGOS DE RESCATE. Con C5-bis eso es una puerta trasera al bloqueo
  //      que esta tarea cierra: quien activara por aquí y perdiera el móvil se quedaba fuera para
  //      siempre — el mismo agujero, por detrás.
  //
  // Se retiran con 302, no con 404: mismo patrón que U8 usó con /admin/security ("un 302 no rompe a
  // nadie; un 404 sí"). Puede haber marcadores viejos. Lo que NO hacen ya es activar ni desactivar
  // nada: el 2FA del dueño tiene UNA sola puerta, y es la que entrega códigos de rescate.
  r.get('/setup-2fa', c => c.redirect('/admin/perfil'));
  r.post('/setup-2fa', c => c.redirect('/admin/perfil'));
  r.post('/confirm-2fa', c => c.redirect('/admin/perfil'));
  r.post('/disable-2fa', c => c.redirect('/admin/perfil'));


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
               placeholder="Mínimo 10 caracteres" required minlength="10">
      </div>
      <div class="field">
        <label for="password2">Confirmar contraseña</label>
        <input type="password" id="password2" name="password2"
               placeholder="Repite la contraseña" required minlength="10">
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

    // C6/B3 — 10, igual que el cambio propio (changeOwnPassword, core/auth.js). Antes esta puerta
    // pedía 8 y la otra 10: la misma cuenta con dos listones según por dónde entraras, y el más bajo
    // era justo el de la vía que se usa SIN saber la contraseña actual. Un mínimo es el más flojo de
    // sus caminos, no el más estricto.
    if (!password || password.length < 10) {
      return c.html('<p style="color:var(--danger)">La contraseña debe tener mínimo 10 caracteres.</p>', 400);
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

      const userId = resetToken.admin_user_id;
      const hash = await hashPassword(password);
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, userId);
      db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?').run(token);

      // C6/B3 — El reset EXPULSA. Sin esto, resetear la contraseña no echaba a nadie: quien ya
      // estuviera dentro seguía dentro hasta 24 h, con la contraseña vieja ya cambiada. Y ese es el
      // escenario para el que existe este botón — "creo que alguien ha entrado en mi cuenta". El
      // sistema prometía cerrar la puerta y solo cambiaba la llave, dejando al intruso ya dentro.
      //
      // Dos cosas, y las dos hacen falta:
      //   · Los DEMÁS tokens de reset pendientes se queman. Si alguien pidió enlaces a tu correo
      //     antes que tú, seguirían valiendo para volver a cambiarla después de este cambio.
      //   · Las sesiones abiertas, fuera —incluidas las de otros dispositivos—. Es deliberado que
      //     caiga también la tuya: quien resetea no tiene sesión (viene del correo), y si la tuviera,
      //     volver a entrar cuesta un login y es el precio correcto por echar a un intruso.
      db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE admin_user_id = ? AND used = 0').run(userId);
      revocarSesiones(db, userId);

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
