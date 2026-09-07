import { Hono } from 'hono';
import { safeError } from '../../core/errors.js';
import { rateLimit } from '../../core/rate-limit.js';
import { autologinStore } from '../../core/autologin-store.js';
import { randomBytes } from 'crypto';
import { createTenantSvc } from '../../core/tenant-signup.js';

// ⚙️ 7 SEP 2026 (`arreglar-alta-publica`) — REESCRITO ENTERO. El alta ERA una conversación con
// DISA que iba rellenando `onboardingSessions` (nombre, sector, propietario, email) hasta marcar
// `ready`, y solo entonces `/api/registro/crear` pedía la contraseña y creaba el negocio. Al
// apagar y borrar la IA (`apagar-disa-paso-1` + `sacar-disa-paso-2-borrado`) esa conversación dejó
// de poder avanzar: nada volvía a poner `ready` a `true`, así que el alta respondía 409 siempre.
// Nadie podía darse de alta.
//
// El arreglo NO es reconstruir una conversación de mentira: es la puerta que faltaba. La pieza
// que de verdad crea el negocio — `createTenantSvc` → `provisionTenant` — nunca dependió del
// chat: valida con Zod, comprueba unicidad de email, genera el slug, siembra la base YA cifrada
// (pasa por el punto único de siempre) y registra el tenant. Estaba entera y viva; solo le faltaba
// quien le pasara los datos. Ahora se los pasa un formulario normal, sin sesión de por medio.
//
// TRES CAMPOS, decisión de producto de Ibrahin: nombre del negocio, correo, contraseña. Nada de
// NIF/dirección/datos fiscales (van en Ajustes, avisando antes de la primera factura) ni de
// oficio (se queda en 'otro' — el paso saltado de siempre — y se elige luego en Ajustes, igual
// que ya podía cambiarse tras el alta). `ownerName` lo exige el esquema y no está en los tres
// campos: se rellena con el propio nombre del negocio (cambiable después en Ajustes → Usuarios) —
// decisión de CONSTRUCCIÓN, no cambia lo que se le pide al cliente.
export function register(app) {

  // GET /registro — el formulario de alta.
  app.get('/registro', (c) => c.html(registroHtml(c.get('cspNonce'))));

  // Crea el negocio. Único endpoint del alta pública — sin sesión de conversación de por medio.
  // Freno anti-avalancha por IP, en tres ventanas (ya existía, no se toca): 10/min, 3/hora, 10/día.
  app.post('/api/registro/crear',
    rateLimit({ windowMs: 60000, max: 10, keyPrefix: 'onboarding-crear' }),
    rateLimit({ windowMs: 60 * 60 * 1000, max: 3, keyPrefix: 'registro-hora', message: 'Demasiados negocios creados desde aquí. Prueba más tarde.' }),
    rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 10, keyPrefix: 'registro-dia', message: 'Demasiados negocios creados desde aquí hoy. Prueba mañana.' }),
    async (c) => {
      let body;
      try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida.' }, 400); }

      const businessName = typeof body?.businessName === 'string' ? body.businessName.trim() : '';
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';

      let result;
      try {
        result = await createTenantSvc({
          businessName,
          ownerName: businessName,   // decisión de construcción: ver comentario de cabecera.
          email,
          password,
          oficio: '',                // paso saltado a propósito: se elige luego en Ajustes.
        });
      } catch (e) {
        return c.json({ error: safeError(e) || 'No se pudo crear el negocio.', field: e.field || null }, e.status || 400);
      }

      const token = randomBytes(32).toString('base64url');
      autologinStore.set(token, { email, slug: result.slug, created: Date.now() });

      // Redirect RELATIVO al host actual: el auto-login (apex) resuelve el negocio desde el
      // token, sin inventar subdominios. Funciona en Tailscale, localhost y en el dominio público.
      return c.json({ redirect: '/admin/autologin?token=' + token });
    }
  );
}

// ── HTML del alta ────────────────────────────────────────────────────────────
// Formulario normal. Sin chat, sin ventanitas del navegador (CLAUDE.md): los errores se
// pintan en la propia página.

function registroHtml(nonce = '') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Empieza con Bamburu</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#070B14;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
    .logo{font-size:24px;font-weight:800;letter-spacing:-.03em;margin-bottom:24px;text-align:center;color:#fff}
    .logo span{color:#14B8A6}
    .logo small{display:block;font-size:12px;font-weight:400;color:rgba(255,255,255,0.4);letter-spacing:0;margin-top:4px}
    .card{background:#0D1220;border:1px solid rgba(255,255,255,0.08);border-radius:20px;width:100%;max-width:400px;box-shadow:0 30px 80px rgba(0,0,0,0.5);padding:28px}
    .card h1{font-size:18px;color:#fff;margin-bottom:6px}
    .card p.sub{font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:22px;line-height:1.5}
    label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:6px}
    .field{margin-bottom:16px}
    input{width:100%;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:11px 14px;font-size:14px;font-family:inherit;color:#f1f5f9;background:rgba(255,255,255,0.04);outline:none;transition:border-color .15s,box-shadow .15s}
    input::placeholder{color:rgba(255,255,255,0.28)}
    input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    .pw-row{display:flex;gap:8px}
    .pw-row input{flex:1}
    .pw-toggle{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:0 14px;font-size:12px;cursor:pointer;font-family:inherit;flex-shrink:0}
    .err{color:#FCA5A5;font-size:12.5px;margin:-6px 0 14px;display:none;line-height:1.5}
    .submit-btn{background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;padding:13px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;transition:all .15s;margin-top:4px}
    .submit-btn:hover{box-shadow:0 6px 20px rgba(20,184,166,0.35);transform:translateY(-1px)}
    .submit-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none}
    .ya-tienes{color:rgba(255,255,255,0.35);font-size:13px;margin-top:20px;text-align:center}
    .ya-tienes a{color:rgba(255,255,255,0.7);font-weight:500;text-decoration:none;transition:color .15s}
    .ya-tienes a:hover{color:#14B8A6}
  </style>
</head>
<body>
  <div class="logo">
    Bam<span>buru</span>
    <small>Tu negocio, gestionado con IA</small>
  </div>

  <div class="card">
    <h1>Empieza gratis</h1>
    <p class="sub">Tres datos y tu negocio está listo. El resto (NIF, dirección, datos fiscales) lo pides cuando lo necesites, desde Ajustes.</p>

    <form id="alta-form">
      <div class="field">
        <label for="businessName">Nombre del negocio</label>
        <input id="businessName" name="businessName" type="text" placeholder="Ej. Peluquería García" autocomplete="organization" required maxlength="120">
      </div>
      <div class="field">
        <label for="email">Correo electrónico</label>
        <input id="email" name="email" type="email" placeholder="tu@correo.com" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="password">Contraseña</label>
        <div class="pw-row">
          <input id="password" name="password" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password" required minlength="8">
          <button type="button" id="pw-toggle" class="pw-toggle">Mostrar</button>
        </div>
      </div>
      <p class="err" id="form-err"></p>
      <button type="submit" class="submit-btn" id="submit-btn">Crear mi negocio</button>
    </form>

    <p class="ya-tienes">¿Ya tienes cuenta? <a href="/acceso">Accede desde aquí</a></p>
  </div>

  <script nonce="${nonce}">
    // C4b-1: sin handlers en atributos — la CSP estricta los bloquea.
    document.getElementById('pw-toggle').addEventListener('click', function(){
      const f = document.getElementById('password'), t = this;
      const show = f.type === 'password';
      f.type = show ? 'text' : 'password';
      t.textContent = show ? 'Ocultar' : 'Mostrar';
    });

    document.getElementById('alta-form').addEventListener('submit', async function(e){
      e.preventDefault();
      const err = document.getElementById('form-err');
      const btn = document.getElementById('submit-btn');
      const businessName = document.getElementById('businessName').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      err.style.display = 'none';
      if (!businessName) { err.textContent = 'Necesito el nombre de tu negocio.'; err.style.display = 'block'; return; }
      if (password.length < 8) { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; err.style.display = 'block'; return; }

      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const r = await fetch('/api/registro/crear', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessName, email, password }),
        });
        const d = await r.json();
        if (!r.ok) {
          err.textContent = d.error || 'No se pudo crear el negocio.';
          err.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Crear mi negocio';
          return;
        }
        btn.textContent = 'Listo, entrando…';
        window.location.href = d.redirect;
      } catch (e) {
        err.textContent = 'Error de conexión. Inténtalo de nuevo.';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Crear mi negocio';
      }
    });
  </script>
</body>
</html>`;
}
