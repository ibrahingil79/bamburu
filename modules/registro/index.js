import { Hono } from 'hono';
import { safeError } from '../../core/errors.js';
import { rateLimit } from '../../core/rate-limit.js';
import { autologinStore } from '../../core/autologin-store.js';
import { randomBytes } from 'crypto';
import { callClaude, hasAnthropicKey, textFromResponse } from '../../core/llm.js';   // helper único de IA: clave + transporte centralizados
import { createTenantSvc, validateSignupDraft, emailTaken } from '../../core/tenant-signup.js';
import { OFICIOS, normalizaOficio } from '../erp/oficios.js';   // PASO 8 — los seis oficios del alta
import { checkEmailFormat } from '../../core/signup-schema.js';

// Sesiones de onboarding EN MEMORIA: sessionId -> { messages, draft, ready, created }.
// Es deliberado y suficiente: un alta dura minutos. Si el servidor se reinicia a mitad,
// el usuario simplemente reinicia el alta — no hay nada persistente que perder y la
// contraseña NUNCA se guarda aquí (viaja directa al endpoint de creación). (defecto I)
const onboardingSessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, s] of onboardingSessions) {
    if (s.created < cutoff) onboardingSessions.delete(id);
  }
}, 300000);

// Bienvenida REAL: primer mensaje del asistente, guardado en el historial del backend
// desde el inicio para que la IA "sepa" que ya saludó y continúe con naturalidad (defecto A).
const WELCOME = '¡Hola! Soy DISA, tu asistente en Bamburu. Voy a ayudarte a poner en marcha tu negocio en un momento, sin formularios: solo cuéntamelo con tus palabras.\n\nPara empezar, háblame un poco de tu negocio: ¿a qué te dedicas y cómo se llama?';

function newSession() {
  return { messages: [{ role: 'assistant', content: WELCOME }], draft: null, ready: false, created: Date.now() };
}

// Marcadores que emite la IA: [EMAIL:...] para verificar el email en cuanto lo recibe
// (antes de resumir), y [LISTO:{...}] con todos los datos (sin contraseña).
const LISTO_RE = /\[LISTO:(\{[\s\S]*?\})\]/;
const EMAIL_RE = /\[EMAIL:\s*([^\]\s]+)\s*\]/i;

function buildSystemPrompt() {
  return [
    'Eres DISA, la asistente de bienvenida de Bamburu.',
    'Acabas de saludar al usuario y le has pedido que te hable de su negocio (ese saludo ya está en la conversación; NO lo repitas).',
    '',
    'Tu objetivo es registrar su negocio de forma natural y cálida, como una conversación, NO como un formulario. Recoge estos datos, en este orden, de uno en uno o en grupos naturales según lo que el usuario te vaya contando:',
    '1. Nombre del negocio',
    '2. Sector o tipo de actividad (peluquería, fontanería, tienda, restaurante…)',
    '3. Nombre del propietario (con quién hablo)',
    '4. Email de contacto',
    '',
    'País: asume España por defecto. NO preguntes el país salvo que el usuario dé señales claras de estar en otro lugar (otra moneda, otro país, una ciudad de fuera de España…); en ese caso, confírmalo con tacto.',
    '',
    'NO pidas la contraseña: se elige después, en un campo seguro, fuera de esta conversación. No la trates aquí; como mucho, al final puedes mencionar que el último paso será elegirla.',
    '',
    'VERIFICACIÓN DEL EMAIL (muy importante):',
    '- En cuanto el usuario te dé su email, en ESE MISMO mensaje añade al final, en una línea aparte, el marcador [EMAIL:la-dirección] y dile en una frase breve que lo estás comprobando. NO resumas ni emitas [LISTO] en ese mensaje.',
    '- Recibirás el resultado como una verificación interna entre paréntesis (empieza por «verificación interna del email»). Esas notas son AUTOMÁTICAS del sistema: NUNCA las menciones, las cites ni hagas referencia a ellas; actúa según su contenido con naturalidad, como si lo hubieras comprobado tú mismo.',
    '- Si el email no es válido o ya está en uso, discúlpate con naturalidad y pide otro, y vuelve a comprobarlo con [EMAIL:...]. Solo cuando la verificación confirme que el email es válido y está libre puedes avanzar hacia el resumen.',
    '',
    'Cuando tengas los CUATRO datos y el email ya esté CONFIRMADO por el sistema:',
    '1. Presenta un RESUMEN claro y breve de lo recogido para que el usuario lo revise.',
    '2. En el MISMO mensaje, añade al final, en una línea aparte, EXACTAMENTE este marcador con los datos en JSON (sin contraseña):',
    '[LISTO:{"businessName":"...","sector":"...","ownerName":"...","email":"...","country":"ES"}]',
    '',
    'Reglas:',
    '- Habla en español, con tildes, cercana y breve.',
    '- Una sola cosa por mensaje; no abrumes.',
    '- Si el usuario da varios datos a la vez, recógelos todos (pero el email se comprueba con [EMAIL:...] ANTES de resumir).',
    '- Usa el marcador [LISTO:...] UNA sola vez, solo cuando tengas los cuatro datos y el email verificado.',
    '- Tras el resumen con [LISTO:...], no hagas más preguntas: el usuario pulsará un botón para crear su negocio y elegir su contraseña.',
  ].join('\n');
}

export function register(app) {

  // GET /registro — pantalla de onboarding (la bienvenida la trae /api/registro/init).
  app.get('/registro', (c) => c.html(onboardingHtml(c.get('cspNonce'))));

  // Arranca una sesión y devuelve la bienvenida, ya guardada en el historial del backend.
  app.post('/api/registro/init',
    rateLimit({ windowMs: 60000, max: 15, keyPrefix: 'onboarding-init' }),
    (c) => {
      const sessionId = randomBytes(16).toString('hex');   // crypto, no Math.random (defecto I)
      onboardingSessions.set(sessionId, newSession());
      // PASO 8 — los seis oficios salen de la MISMA lista que usa el ERP (modules/erp/oficios.js). Si un
      // día cambian, cambian en un sitio: aquí no hay una segunda copia de los nombres.
      const oficios = OFICIOS.map(o => ({ id: o.id, label: o.label }));
      return c.json({ session_id: sessionId, reply: WELCOME, oficios });
    }
  );

  // Conversación de onboarding. NO crea nada y NO toca la contraseña.
  app.post('/api/registro/disa',
    rateLimit({ windowMs: 60000, max: 20, keyPrefix: 'onboarding' }),
    async (c) => {
      let body;
      try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida.' }, 400); }

      const message = body?.message?.trim();
      if (!message) return c.json({ error: 'Mensaje vacío.' }, 400);

      let sessionId = body?.session_id || c.req.header('x-onboarding-session');
      let sessionData = sessionId ? onboardingSessions.get(sessionId) : null;
      if (!sessionData) {
        // Sesión perdida (reinicio/expiración): re-sembramos con la bienvenida en el historial.
        sessionId = randomBytes(16).toString('hex');
        sessionData = newSession();
        onboardingSessions.set(sessionId, sessionData);
      }
      const history = sessionData.messages;

      if (!hasAnthropicKey()) {
        return c.json({ error: 'Ahora mismo no puedo seguir con el alta. Inténtalo en unos minutos o escríbenos a soporte.' }, 500);
      }

      const recentHistory = history.slice(-14).map(m => ({ role: m.role, content: m.content }));
      const convo = [...recentHistory, { role: 'user', content: message }];

      let cleanReply = '';
      let ready = false;
      let summary = null;

      // Bucle: la IA comprueba el email EN CUANTO lo recibe (marcador [EMAIL:...]); el
      // servidor valida formato + unicidad y le devuelve el resultado para que continúe o
      // pida otro. Así el RESUMEN solo aparece con un email ya verificado — nunca se muestra
      // un resumen contradicho después por un error de email.
      let guard = 0;
      while (guard++ < 4) {
        let apiData;
        try {
          apiData = await callClaude({
            model: 'claude-sonnet-5',   // D4: DISA de onboarding en Sonnet 5 (antes 4-6), como el chat del panel
            max_tokens: 1024,
            system: buildSystemPrompt(),
            messages: convo,
          });
        } catch (err) {
          console.error('[DISA onboarding] API error:', err.message);
          return c.json({ error: 'He tenido un problema para responderte. Inténtalo de nuevo en un momento.' }, 500);
        }
        // EL TEXTO SE SACA CON textFromResponse, NUNCA CON content[0].
        // Esto tiró el alta en producción (15 ago 2026): `content[0]` dejó de ser el texto porque el
        // modelo empezó a devolver un bloque `thinking` DELANTE. `content[0].text` era undefined, la
        // respuesta salía VACÍA y con HTTP 200 — sin error en el log y sin nada en pantalla, así que
        // parecía que DISA "pensaba" sin fin. El helper filtra por `type === 'text'`: el número de
        // bloques que mande el modelo, y en qué orden, deja de importar.
        const raw = textFromResponse(apiData);

        // (a) Verificación del email: validar formato + unicidad y devolver el resultado a
        //     la IA — ANTES de cualquier resumen (corrige el "resumen y luego error").
        const em = raw.match(EMAIL_RE);
        if (em) {
          const addr = em[1].trim();
          const ackText = raw.replace(EMAIL_RE, '').trim();
          const fmt = checkEmailFormat(addr);
          let note;
          if (!fmt) {
            note = `(verificación interna del email "${addr}": el formato NO es válido. Discúlpate con naturalidad y pide al usuario que lo escriba de nuevo. No menciones esta nota. No resumas ni emitas [LISTO] todavía.)`;
          } else if (emailTaken(fmt)) {
            note = `(verificación interna del email "${fmt}": YA EXISTE una cuenta en Bamburu con ese email. Con amabilidad, dile que ese correo ya está registrado y que use otro distinto, y pídeselo. No menciones esta nota. No resumas ni emitas [LISTO] todavía.)`;
          } else {
            note = `(verificación interna del email "${fmt}": válido y libre. Continúa con naturalidad: si ya tienes el nombre del negocio, el sector y el nombre del propietario, presenta el resumen y emite [LISTO]; si falta algo, pídelo. No menciones esta nota.)`;
          }
          convo.push({ role: 'assistant', content: ackText || '(comprobando el email…)' });
          convo.push({ role: 'user', content: note });
          continue;   // re-llamada a la IA con el resultado de la verificación
        }

        // (b) Resumen final con los datos.
        const m = raw.match(LISTO_RE);
        if (m) {
          const text = raw.replace(LISTO_RE, '').trim();
          let draft = null;
          try { draft = JSON.parse(m[1]); } catch { draft = null; }
          if (draft) {
            try {
              const valid = validateSignupDraft(draft);
              sessionData.draft = valid;
              sessionData.ready = true;
              ready = true;
              cleanReply = text;
              summary = {
                businessName: valid.businessName, sector: valid.sector || '',
                ownerName: valid.ownerName, email: valid.email, country: valid.country,
              };
            } catch (e) {
              // Salvaguarda: si la IA resumió con un email inválido pese al paso (a),
              // mostramos SOLO la re-pregunta, nunca el resumen contradicho.
              sessionData.draft = null;
              sessionData.ready = false;
              cleanReply = e.message || 'Hay un dato del alta que no es válido.';
            }
          } else {
            cleanReply = text;
          }
          break;
        }

        // (c) Respuesta normal (sigue recogiendo datos).
        cleanReply = raw;
        break;
      }

      // Defensa: nunca dejar escapar marcadores al usuario.
      cleanReply = cleanReply.replace(LISTO_RE, '').replace(EMAIL_RE, '').trim();

      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: cleanReply });
      sessionData.messages = history;
      onboardingSessions.set(sessionId, sessionData);

      return c.json({ reply: cleanReply, session_id: sessionId, ready, summary });
    }
  );

  // Crea el negocio. Confirmación INEQUÍVOCA (botón en el chat) + contraseña por campo
  // seguro: la contraseña llega SOLO aquí, nunca por el chat ni la memoria (defectos E, G).
  app.post('/api/registro/crear',
    rateLimit({ windowMs: 60000, max: 10, keyPrefix: 'onboarding-crear' }),
    // Freno al registro masivo por IP (anti-avalancha): además del 10/min, tope por hora y por día.
    rateLimit({ windowMs: 60 * 60 * 1000, max: 3, keyPrefix: 'registro-hora', message: 'Demasiados negocios creados desde aquí. Prueba más tarde.' }),
    rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 10, keyPrefix: 'registro-dia', message: 'Demasiados negocios creados desde aquí hoy. Prueba mañana.' }),
    async (c) => {
      let body;
      try { body = await c.req.json(); } catch { return c.json({ error: 'Petición inválida.' }, 400); }

      const sessionId = body?.session_id;
      const password = typeof body?.password === 'string' ? body.password : '';
      const sessionData = sessionId ? onboardingSessions.get(sessionId) : null;

      if (!sessionData || !sessionData.ready || !sessionData.draft) {
        return c.json({ error: 'Aún no hemos terminado de preparar tu negocio. Vuelve al chat y completa los datos.', field: 'session' }, 409);
      }

      // PASO 8 — el oficio llega AQUÍ, del botón que se pulsó, no del texto libre de la conversación.
      // Se normaliza en el servidor: si el paso se saltó o llega cualquier otra cosa, queda 'otro'.
      const oficio = normalizaOficio(body?.oficio);

      // Revalida TODO contra el esquema (no confiamos en lo pendiente) + unicidad de email.
      let result;
      try {
        result = await createTenantSvc({ ...sessionData.draft, oficio, password });
      } catch (e) {
        return c.json({ error: safeError(e) || 'No se pudo crear el negocio.', field: e.field || null }, e.status || 400);
      }

      onboardingSessions.delete(sessionId);

      const token = randomBytes(32).toString('base64url');
      autologinStore.set(token, { email: sessionData.draft.email, slug: result.slug, created: Date.now() });

      // Redirect RELATIVO al host actual: el auto-login (apex) resuelve el negocio desde
      // el token, sin inventar subdominios. Funciona en Tailscale, localhost y, el día que
      // exista, en el dominio público (donde además sigue valiendo el login por subdominio).
      const redirect = '/admin/autologin?token=' + token;
      const reply = 'Tu negocio "' + sessionData.draft.businessName + '" ya está listo. Te llevamos a tu panel…';
      return c.json({ reply, redirect });
    }
  );
}

// ── HTML del onboarding con DISA ──────────────────────────────────────────
// (Mismo aspecto que antes; el rediseño visual llegará con el sistema de diseño.)

function onboardingHtml(nonce = '') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Empieza con Bamburu — DISA te da la bienvenida</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#070B14;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
    .logo{font-size:24px;font-weight:800;letter-spacing:-.03em;margin-bottom:20px;text-align:center;color:#fff}
    .logo span{color:#14B8A6}
    .logo small{display:block;font-size:12px;font-weight:400;color:rgba(255,255,255,0.4);letter-spacing:0;margin-top:4px}
    .card{background:#0D1220;border:1px solid rgba(255,255,255,0.08);border-radius:20px;width:100%;max-width:440px;box-shadow:0 30px 80px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;height:580px}
    .card-header{background:rgba(20,184,166,0.08);border-bottom:1px solid rgba(20,184,166,0.15);padding:16px 18px;flex-shrink:0;display:flex;align-items:center;gap:12px}
    .disa-avatar{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#14B8A6,#0F766E);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;color:#fff}
    .disa-info{flex:1}
    .disa-name{font-weight:700;font-size:14px;color:#fff}
    .disa-status{font-size:11px;color:rgba(255,255,255,0.45);display:flex;align-items:center;gap:5px;margin-top:1px}
    .status-dot{width:6px;height:6px;border-radius:50%;background:#4ADE80;box-shadow:0 0 6px rgba(74,222,128,0.6);flex-shrink:0}
    .messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent}
    .typing{display:none;align-items:center;gap:4px;padding:10px 14px;background:rgba(255,255,255,0.06);border-radius:14px;border-bottom-left-radius:4px;width:fit-content}
    .typing.visible{display:flex}
    .typing span{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.3);animation:dot 1.4s infinite}
    .typing span:nth-child(2){animation-delay:.2s}
    .typing span:nth-child(3){animation-delay:.4s}
    @keyframes dot{0%,60%,100%{opacity:.25;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}
    .input-area{padding:12px;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0;display:flex;gap:8px;background:#0D1220}
    textarea{flex:1;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 14px;font-size:13px;font-family:inherit;resize:none;max-height:80px;outline:none;transition:border-color .15s,box-shadow .15s;color:#f1f5f9;background:rgba(255,255,255,0.04)}
    textarea::placeholder{color:rgba(255,255,255,0.3)}
    textarea:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    button.send{background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:10px;width:42px;flex-shrink:0;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all .15s}
    button.send:hover{box-shadow:0 4px 16px rgba(20,184,166,0.4);transform:translateY(-1px)}
    button.send:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
    .msg-wrap{display:flex}
    .msg-wrap.user{justify-content:flex-end}
    .msg-wrap.assistant{justify-content:flex-start}
    .bubble{max-width:85%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.6}
    .bubble.user{background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border-bottom-right-radius:4px}
    .bubble.assistant{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85);border-bottom-left-radius:4px;border:1px solid rgba(255,255,255,0.07)}
    .bubble.system{background:rgba(20,184,166,0.1);color:#5EEAD4;border-left:2px solid #14B8A6;border-radius:10px;padding-left:12px}
    /* Botón de crear + panel de contraseña (mismos tokens del tema actual) */
    .action-wrap{display:flex;padding:4px 2px}
    .create-btn{background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:12px;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;transition:all .15s}
    .create-btn:hover{box-shadow:0 6px 20px rgba(20,184,166,0.35);transform:translateY(-1px)}
    .create-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none}
    /* PASO 8 — paso de oficio: seis botones, con "Otro" marcado de salida (es lo que queda si se salta) */
    .oficio-step{padding:6px 2px 2px}
    .oficio-q{font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:8px;line-height:1.5}
    .oficio-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .oficio-btn{background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.8);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:9px 10px;font-size:12px;font-family:inherit;cursor:pointer;text-align:left;transition:all .15s}
    .oficio-btn:hover{border-color:rgba(20,184,166,0.5);color:#fff}
    .oficio-btn[aria-pressed="true"]{background:rgba(20,184,166,0.15);border-color:#14B8A6;color:#5EEAD4;font-weight:700}
    .pw-panel{display:none;padding:14px;border-top:1px solid rgba(255,255,255,0.07);background:#0D1220;flex-shrink:0}
    .pw-title{font-size:13px;font-weight:700;color:#fff;margin-bottom:4px}
    .pw-help{font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:10px}
    .pw-row{display:flex;gap:8px;margin-bottom:8px}
    .pw-panel input{flex:1;width:100%;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;color:#f1f5f9;background:rgba(255,255,255,0.04);outline:none;transition:border-color .15s,box-shadow .15s}
    .pw-panel input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
    .pw-rep{margin-bottom:8px}
    .pw-toggle{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:0 12px;font-size:12px;cursor:pointer;font-family:inherit;flex-shrink:0}
    .pw-err{color:#FCA5A5;font-size:12px;margin:6px 0;display:none}
    .redirect-banner{background:rgba(20,184,166,0.1);color:#5EEAD4;padding:14px 16px;font-size:13px;text-align:center;border-top:1px solid rgba(20,184,166,0.2);flex-shrink:0;display:none}
    .redirect-banner a{color:#14B8A6;font-weight:700;text-decoration:none}
    .ya-tienes{color:rgba(255,255,255,0.35);font-size:13px;margin-top:16px;text-align:center}
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
    <div class="card-header">
      <div class="disa-avatar">✦</div>
      <div class="disa-info">
        <div class="disa-name">DISA</div>
        <div class="disa-status"><span class="status-dot"></span>Asistente de bienvenida</div>
      </div>
    </div>

    <div class="messages" id="messages">
      <div class="typing visible" id="typing">
        <span></span><span></span><span></span>
      </div>
    </div>

    <div class="pw-panel" id="pw-panel">
      <div class="pw-title">Último paso: elige tu contraseña</div>
      <div class="pw-help">Mínimo 8 caracteres. No se comparte en el chat.</div>
      <div class="pw-row">
        <input id="pw1" type="password" placeholder="Contraseña" autocomplete="new-password">
        <button type="button" id="pw-toggle" class="pw-toggle">Mostrar</button>
      </div>
      <input id="pw2" type="password" class="pw-rep" placeholder="Repite la contraseña" autocomplete="new-password">
      <p class="pw-err" id="pw-err"></p>
      <button type="button" id="pw-submit" class="create-btn">Crear mi negocio y entrar</button>
    </div>

    <div class="redirect-banner" id="redirect-banner">
      Tu negocio está listo. <a id="redirect-link" href="#">Entra a tu panel →</a>
    </div>

    <div class="input-area">
      <textarea id="input" placeholder="Escribe aquí..." rows="1"></textarea>
      <button class="send" id="send">↑</button>
    </div>
  </div>

  <p class="ya-tienes">¿Ya tienes cuenta? <a href="/acceso">Accede desde aquí</a></p>

  <script nonce="${nonce}">
    let sessionId = null, creating = false;
    // PASO 8 — los seis oficios llegan del backend (fuente única); 'otro' es lo que vale si no se pulsa.
    let OFICIOS = [], oficioElegido = 'otro';
    const msgsDiv = document.getElementById('messages');
    const typing  = document.getElementById('typing');
    const input   = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    // C4b-1: enganchados aquí, no con handlers en el HTML: la CSP estricta los bloquea y el
    // nonce solo cubre el bloque de script. Se llaman DENTRO de la función flecha a propósito:
    // togglePw y crear se asignan a window (no son declaraciones que se hoisten), así que
    // aún no existen en esta línea. Con el envoltorio, la búsqueda ocurre al pulsar y el orden
    // del script deja de importar.
    document.getElementById('pw-toggle').addEventListener('click', () => window.togglePw());
    document.getElementById('pw-submit').addEventListener('click', () => window.crear());

    function escHtml(s){
      return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function addMsg(role, text){
      const wrap=document.createElement('div');
      wrap.className='msg-wrap '+role;
      const bubble=document.createElement('div');
      bubble.className='bubble '+role;
      bubble.innerHTML=escHtml(text).replace(/\\n/g,'<br>');
      wrap.appendChild(bubble);
      msgsDiv.insertBefore(wrap,typing);
      msgsDiv.scrollTop=msgsDiv.scrollHeight;
    }

    function removeCreateBtn(){
      const w=document.getElementById('create-wrap');
      if(w) w.remove();
    }

    function removeOficioStep(){
      const w=document.getElementById('oficio-wrap');
      if(w) w.remove();
    }

    // PASO 8 — PASO EXPLÍCITO. No se adivina el oficio de lo que se haya escrito en el chat: se pulsa.
    // Sin handlers en atributos (la CSP estricta los bloquea y el nonce solo cubre este bloque).
    function showOficioStep(){
      removeOficioStep();
      if(!OFICIOS.length) return;
      const wrap=document.createElement('div');
      wrap.className='oficio-step'; wrap.id='oficio-wrap';
      const q=document.createElement('div');
      q.className='oficio-q';
      q.textContent='¿A qué se dedica tu negocio? Con esto tu agenda arranca con tus palabras y tus servicios ya cargados. Puedes cambiarlo cuando quieras.';
      wrap.appendChild(q);
      const grid=document.createElement('div');
      grid.className='oficio-grid';
      OFICIOS.forEach(function(o){
        const b=document.createElement('button');
        b.type='button'; b.className='oficio-btn';
        b.setAttribute('aria-pressed', o.id===oficioElegido ? 'true' : 'false');
        b.textContent=o.label;
        b.addEventListener('click',function(){
          oficioElegido=o.id;
          Array.prototype.forEach.call(grid.children,function(x){ x.setAttribute('aria-pressed','false'); });
          b.setAttribute('aria-pressed','true');
        });
        grid.appendChild(b);
      });
      wrap.appendChild(grid);
      msgsDiv.insertBefore(wrap,typing);
      msgsDiv.scrollTop=msgsDiv.scrollHeight;
    }

    function showCreateButton(){
      removeCreateBtn();
      const wrap=document.createElement('div');
      wrap.className='action-wrap';
      wrap.id='create-wrap';
      const btn=document.createElement('button');
      btn.className='create-btn';
      btn.id='createBtn';
      btn.textContent='Crear mi negocio';
      btn.onclick=showPasswordPanel;
      wrap.appendChild(btn);
      msgsDiv.insertBefore(wrap,typing);
      msgsDiv.scrollTop=msgsDiv.scrollHeight;
    }

    function showPasswordPanel(){
      const b=document.getElementById('createBtn'); if(b) b.disabled=true;
      document.getElementById('pw-panel').style.display='block';
      document.getElementById('pw1').focus();
      msgsDiv.scrollTop=msgsDiv.scrollHeight;
    }

    window.togglePw=function(){
      const f1=document.getElementById('pw1'), f2=document.getElementById('pw2'), t=document.getElementById('pw-toggle');
      const show=f1.type==='password';
      f1.type=f2.type=show?'text':'password';
      t.textContent=show?'Ocultar':'Mostrar';
    };

    window.crear=async function(){
      if(creating) return;
      const p1=document.getElementById('pw1').value, p2=document.getElementById('pw2').value;
      const err=document.getElementById('pw-err');
      if(p1.length<8){ err.textContent='La contraseña debe tener al menos 8 caracteres.'; err.style.display='block'; return; }
      if(p1!==p2){ err.textContent='Las contraseñas no coinciden.'; err.style.display='block'; return; }
      err.style.display='none';
      creating=true;
      const sub=document.getElementById('pw-submit'); sub.disabled=true; sub.textContent='Creando…';
      try{
        const r=await fetch('/api/registro/crear',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({session_id:sessionId,password:p1,oficio:oficioElegido})
        });
        const d=await r.json();
        if(!r.ok){
          err.textContent=d.error||'No se pudo crear el negocio.'; err.style.display='block';
          sub.disabled=false; sub.textContent='Crear mi negocio y entrar'; creating=false; return;
        }
        document.getElementById('pw-panel').style.display='none';
        addMsg('assistant', d.reply||'Tu negocio está listo.');
        if(d.redirect){
          const banner=document.getElementById('redirect-banner');
          const link=document.getElementById('redirect-link');
          link.href=d.redirect; banner.style.display='block';
          input.disabled=true; sendBtn.disabled=true;
          setTimeout(()=>{window.location.href=d.redirect;},2500);
        }
      }catch(e){
        err.textContent='Error de conexión. Inténtalo de nuevo.'; err.style.display='block';
        sub.disabled=false; sub.textContent='Crear mi negocio y entrar'; creating=false;
      }
    };

    async function send(){
      const msg=input.value.trim();
      if(!msg)return;
      removeCreateBtn();
      removeOficioStep();
      document.getElementById('pw-panel').style.display='none';
      addMsg('user',msg);
      input.value='';
      input.style.height='auto';
      typing.classList.add('visible');
      msgsDiv.scrollTop=msgsDiv.scrollHeight;
      sendBtn.disabled=true;

      try{
        const res=await fetch('/api/registro/disa',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({message:msg,session_id:sessionId})
        });
        const data=await res.json();
        typing.classList.remove('visible');
        sendBtn.disabled=false;

        if(!res.ok){
          addMsg('assistant',data.error||'Algo ha fallado por mi lado. Vuelve a intentarlo.');
          return;
        }

        if(data.session_id) sessionId=data.session_id;
        addMsg('assistant',data.reply||'');
        // El oficio se pregunta JUSTO ANTES de crear, cuando ya están los cuatro datos: así el paso no
        // interrumpe la conversación y se ve al lado del botón que lo va a usar.
        if(data.ready){ showOficioStep(); showCreateButton(); }
      } catch(err){
        typing.classList.remove('visible');
        sendBtn.disabled=false;
        addMsg('assistant','Error de conexión. Inténtalo de nuevo.');
      }
    }

    input.addEventListener('input',function(){
      this.style.height='auto';
      this.style.height=Math.min(this.scrollHeight,80)+'px';
    });
    input.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
    });
    sendBtn.addEventListener('click',send);

    // Bienvenida desde el backend (guardada en el historial). La IA "sabe" que ya saludó.
    async function initSession(){
      try{
        const r=await fetch('/api/registro/init',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        const d=await r.json();
        typing.classList.remove('visible');
        if(d.session_id) sessionId=d.session_id;
        if(Array.isArray(d.oficios)) OFICIOS=d.oficios;
        addMsg('assistant', d.reply || '¡Hola! Soy DISA, tu asistente en Bamburu.');
        input.focus();
      }catch(e){
        typing.classList.remove('visible');
        addMsg('assistant','No he podido iniciar el alta. Recarga la página, por favor.');
      }
    }
    initSession();
  </script>
</body>
</html>`;
}
