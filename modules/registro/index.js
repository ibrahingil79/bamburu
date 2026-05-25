import { Hono } from 'hono';
import { provisionTenant } from '../../core/tenant-provisioning.js';
import { rateLimit } from '../../core/rate-limit.js';
import { autologinStore } from '../../core/autologin-store.js';
import { randomBytes } from 'crypto';

// In-memory onboarding sessions: sessionId -> { messages, created }
const onboardingSessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, s] of onboardingSessions) {
    if (s.created < cutoff) onboardingSessions.delete(id);
  }
}, 300000);

export function register(app) {

  // GET /registro — DISA onboarding chat
  app.get('/registro', (c) => {
    return c.html(onboardingHtml());
  });

  // POST /api/registro/disa — onboarding conversation
  app.post('/api/registro/disa',
    rateLimit({ windowMs: 60000, max: 15, keyPrefix: 'onboarding' }),
    async (c) => {
      let body;
      try { body = await c.req.json(); } catch {
        return c.json({ error: 'Peticion invalida.' }, 400);
      }

      const message = body?.message?.trim();
      if (!message) return c.json({ error: 'Mensaje vacio.' }, 400);

      // Session management
      let sessionId = body?.session_id || c.req.header('x-onboarding-session');
      if (!sessionId) {
        sessionId = Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
      }

      const sessionData = onboardingSessions.get(sessionId) || { messages: [], created: Date.now() };
      const history = sessionData.messages;

      // Check for confirmation of pending action
      const lastAssistant = history.slice().reverse().find(m => m.role === 'assistant');
      const pendingAction = lastAssistant?.pending_action || null;
      const isConfirming = pendingAction &&
        /^(sí|si|confirmo|adelante|ok|dale|hazlo|procede|yes|correcto|exacto)/i
        .test(message.trim());

      if (isConfirming && pendingAction?.type === 'onboard_create_tenant') {
        const p = pendingAction.params;
        try {
          const result = await provisionTenant({
            businessName: p.businessName || 'Mi Negocio',
            ownerName: p.ownerName || p.businessName || 'Propietario',
            email: p.email,
            password: p.password,
            phone: p.phone || '',
            country: p.country || 'ES'
          });

          onboardingSessions.delete(sessionId);

          const token = randomBytes(32).toString('base64url');
          autologinStore.set(token, { email: p.email, slug: result.slug, created: Date.now() });

          const autologinUrl = 'https://' + result.slug + '.bamburu.com/admin/autologin?token=' + token;
          const reply = 'Tu negocio "' + (p.businessName || 'nuevo negocio') +
            '" esta listo. En un momento te llevamos a tu panel.';

          return c.json({ reply, session_id: sessionId, redirect: autologinUrl, action_executed: true });
        } catch (err) {
          console.error('[DISA onboarding] provisionTenant error:', err.message);
          history.push({ role: 'user', content: message });
          history.push({ role: 'assistant', content: 'Lo siento, ha habido un problema al crear tu negocio. Intentalo de nuevo.' });
          sessionData.messages = history;
          onboardingSessions.set(sessionId, sessionData);
          return c.json({ reply: 'Lo siento, ha habido un problema al crear tu negocio. Intentalo de nuevo.', session_id: sessionId });
        }
      }

      // Get API key
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        try {
          const fs = await import('fs');
          const env = fs.default.readFileSync('/etc/bamburu.env', 'utf8');
          const match = env.match(/ANTHROPIC_API_KEY=(.+)/);
          if (match) apiKey = match[1].trim();
        } catch {}
      }
      if (!apiKey) {
        return c.json({ error: 'Servicio no disponible. Contacta con soporte.' }, 500);
      }

      const onboardingPrompt = [
        'Eres DISA, el asistente de bienvenida de Bamburu.',
        'El usuario acaba de llegar para registrar su negocio. Tu mision es ayudarlo de forma natural.',
        '',
        'Recoge estos datos de forma conversacional (no hagas un formulario):',
        '1. Nombre del negocio',
        '2. Tipo de negocio / sector (tienda, restaurante, fontaneria, etc.)',
        '3. Pais (por defecto Espana)',
        '4. Nombre del propietario',
        '5. Email de contacto',
        '6. Contrasena (minimo 8 caracteres)',
        '',
        'Cuando tengas TODOS los datos, presenta un resumen claro y prepara la accion:',
        '[ACCION:{"type":"onboard_create_tenant","params":{"businessName":"...","ownerName":"...","email":"...","password":"...","country":"ES","phone":""},"confirm":"Crear el negocio ..."}]',
        '',
        'Reglas importantes:',
        '- Habla en espanol, sé cercano y amable',
        '- Haz las preguntas de una en una o en grupos naturales',
        '- Si el usuario da varios datos a la vez, procesalos todos',
        '- Muestra el resumen ANTES de proponer la accion',
        '- El campo "confirm" debe ser un texto legible para el usuario',
        '- Solo un bloque [ACCION:...] por mensaje',
        '- NUNCA hagas preguntas despues de proponer la accion — espera confirmacion',
      ].join('\n');

      const recentHistory = history.slice(-12).map(m => ({ role: m.role, content: m.content }));

      let apiResponse;
      try {
        apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: onboardingPrompt,
            messages: [...recentHistory, { role: 'user', content: message }]
          })
        });
      } catch (err) {
        console.error('[DISA onboarding] API fetch error:', err.message);
        return c.json({ error: 'Error al conectar con DISA.' }, 500);
      }

      if (!apiResponse.ok) {
        const errData = await apiResponse.json().catch(() => ({}));
        console.error('[DISA onboarding] API error:', JSON.stringify(errData));
        return c.json({ error: 'Error al conectar con DISA.' }, 500);
      }

      const apiData = await apiResponse.json();
      const reply = apiData.content[0]?.text || '';

      let cleanReply = reply;
      let newPendingAction = null;

      const actionMatch = reply.match(/\[ACCION:(\{[\s\S]*?\})\]/);
      if (actionMatch) {
        try {
          newPendingAction = JSON.parse(actionMatch[1]);
          cleanReply = reply.replace(/\[ACCION:[\s\S]*?\]/, '').trim();
          cleanReply += '\n\n¿Confirmas? Responde "si" para crear tu negocio.';
        } catch {
          cleanReply = reply.replace(/\[ACCION:[\s\S]*?\]/, '').trim();
        }
      }

      history.push({ role: 'user', content: message });
      history.push({
        role: 'assistant',
        content: cleanReply,
        ...(newPendingAction ? { pending_action: newPendingAction } : {})
      });
      sessionData.messages = history;
      onboardingSessions.set(sessionId, sessionData);

      return c.json({ reply: cleanReply, session_id: sessionId });
    }
  );
}

// ── HTML del onboarding con DISA ──────────────────────────────────────────

function onboardingHtml() {
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

    <div class="redirect-banner" id="redirect-banner">
      Tu negocio está listo. <a id="redirect-link" href="#">Entra a tu panel →</a>
    </div>

    <div class="input-area">
      <textarea id="input" placeholder="Escribe aquí..." rows="1"></textarea>
      <button class="send" id="send">↑</button>
    </div>
  </div>

  <p class="ya-tienes">¿Ya tienes cuenta? <a href="/acceso">Accede desde aquí</a></p>

  <script>
    let sessionId = null;
    const msgsDiv = document.getElementById('messages');
    const typing  = document.getElementById('typing');
    const input   = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    function escHtml(s){
      return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

    async function send(){
      const msg=input.value.trim();
      if(!msg)return;
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
          addMsg('assistant',data.error||'Error interno. Intentalo de nuevo.');
          return;
        }

        if(data.session_id) sessionId=data.session_id;
        addMsg('assistant',data.reply||'');

        if(data.redirect){
          const banner=document.getElementById('redirect-banner');
          const link=document.getElementById('redirect-link');
          link.href=data.redirect;
          banner.style.display='block';
          input.disabled=true;
          sendBtn.disabled=true;
          setTimeout(()=>{window.location.href=data.redirect;},4000);
        }
      } catch(err){
        typing.classList.remove('visible');
        sendBtn.disabled=false;
        addMsg('assistant','Error de conexion. Intentalo de nuevo.');
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

    // Saludo inicial
    setTimeout(()=>{
      typing.classList.remove('visible');
      addMsg('assistant','Hola, soy DISA, tu asistente de Bamburu.\\n\\n¿Como se llama tu negocio?');
      input.focus();
    },1200);
  </script>
</body>
</html>`;
}
