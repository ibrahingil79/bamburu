import { adminLayout } from '../../erp/layout.js';

export function disaDedicadoHtml({ agent, conversations, session, csrf }) {
  const messagesHtml = conversations.length === 0
    ? `<div style="text-align:center;padding:48px 24px;color:var(--text3)">
        <div style="font-size:48px;margin-bottom:16px">${agent.icon}</div>
        <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">
          Hola, soy ${agent.name.split(' ').pop()}
        </div>
        <div style="font-size:13px;max-width:320px;margin:0 auto;line-height:1.5">
          ${agent.specialization}. Pregúntame lo que necesites.
        </div>
      </div>`
    : conversations.map(conv => `
        <div style="display:flex;justify-content:${conv.role === 'user' ? 'flex-end' : 'flex-start'}">
          <div style="max-width:75%;padding:12px 16px;border-radius:14px;font-size:14px;line-height:1.6;
            ${conv.role === 'user'
              ? 'background:var(--teal);color:white;border-bottom-right-radius:4px'
              : 'background:var(--bg3);color:var(--text);border-bottom-left-radius:4px'}">
            ${String(conv.content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
          </div>
        </div>
      `).join('');

  const body = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 120px)">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-shrink:0">
        <div style="display:flex;align-items:center;gap:12px">
          <a href="/admin/asistentes" class="btn btn-secondary btn-sm">← Atrás</a>
          <div>
            <span style="font-size:20px">${agent.icon}</span>
            <span style="font-size:15px;font-weight:700;margin-left:8px">${agent.name}</span>
          </div>
        </div>
        <span style="font-size:12px;color:var(--text3)">${agent.specialization}</span>
      </div>

      <div id="disa-messages" style="
        flex:1;
        overflow-y:auto;
        padding:4px;
        display:flex;
        flex-direction:column;
        gap:12px;
        background:var(--bg);
        border:1px solid var(--border);
        border-radius:12px;
        padding:16px;
      ">
        ${messagesHtml}
        <div id="typing-indicator" style="display:none">
          <div style="background:var(--bg3);padding:12px 16px;border-radius:14px;border-bottom-left-radius:4px;
                      display:inline-flex;gap:4px;align-items:center">
            <span style="width:6px;height:6px;border-radius:50%;background:var(--text3);animation:tdot 1.4s infinite"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--text3);animation:tdot 1.4s infinite 0.2s"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--text3);animation:tdot 1.4s infinite 0.4s"></span>
          </div>
        </div>
      </div>

      <div style="flex-shrink:0;padding-top:16px;border-top:1px solid var(--border);margin-top:16px;display:flex;gap:10px">
        <textarea id="disa-input" rows="2" placeholder="Pregunta algo..."
          style="flex:1;padding:12px 16px;border:1px solid var(--border2);border-radius:12px;
                 font-size:14px;font-family:inherit;resize:none;outline:none;
                 background:rgba(255,255,255,0.04);color:var(--text);transition:border-color 150ms"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();disaDedSend()}"
          onfocus="this.style.borderColor='var(--teal)'"
          onblur="this.style.borderColor='var(--border2)'"></textarea>
        <button onclick="disaDedSend()"
          style="background:var(--teal);color:white;border:none;border-radius:12px;padding:0 20px;
                 font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;align-self:stretch">
          Enviar
        </button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">
        Shift+Enter para nueva línea · Enter para enviar
      </div>
    </div>

    <style>
      @keyframes tdot {
        0%,60%,100% { opacity:0.25;transform:scale(0.8) }
        30% { opacity:1;transform:scale(1.1) }
      }
    </style>

    <script>
      const AGENT_ID = ${agent.id};
      const CSRF_TOKEN = ${JSON.stringify(csrf)};

      async function disaDedSend() {
        const input = document.getElementById('disa-input');
        const message = input.value.trim();
        if (!message) return;
        input.value = '';

        const messagesDiv = document.getElementById('disa-messages');
        addMsg('user', message);
        showTyping(true);

        try {
          const res = await fetch('/api/disa/message', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': CSRF_TOKEN
            },
            body: JSON.stringify({ message, agent_id: AGENT_ID })
          });
          const data = await res.json();
          showTyping(false);
          if (res.ok) {
            addMsg('assistant', data.reply);
          } else {
            addMsg('assistant', data.error || 'Lo siento, ha ocurrido un error.');
          }
        } catch (err) {
          showTyping(false);
          addMsg('assistant', 'Error de conexión. Inténtalo de nuevo.');
        }
      }

      function addMsg(role, content) {
        const area = document.getElementById('disa-messages');
        const emptyState = area.querySelector('[style*="text-align:center"]');
        if (emptyState) emptyState.remove();
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;justify-content:' + (role === 'user' ? 'flex-end' : 'flex-start');
        const escaped = String(content).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        div.innerHTML = '<div style="max-width:75%;padding:12px 16px;border-radius:14px;font-size:14px;line-height:1.6;'
          + (role === 'user'
            ? 'background:#0D9488;color:white;border-bottom-right-radius:4px'
            : 'background:#111827;color:#F1F5F9;border-bottom-left-radius:4px')
          + '">' + escaped.replace(/\\n/g,'<br>') + '</div>';
        const indicator = document.getElementById('typing-indicator');
        area.insertBefore(div, indicator);
        area.scrollTop = area.scrollHeight;
      }

      function showTyping(show) {
        const t = document.getElementById('typing-indicator');
        t.style.display = show ? 'block' : 'none';
        if (show) document.getElementById('disa-messages').scrollTop = 9999;
      }

      window.addEventListener('load', () => {
        const area = document.getElementById('disa-messages');
        area.scrollTop = area.scrollHeight;
      });
    </script>
  `;

  return adminLayout(agent.name, body, 'disa', csrf, session?.role || '');
}
