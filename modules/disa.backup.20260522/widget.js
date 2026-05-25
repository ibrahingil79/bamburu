export function getDisaWidget() {
  return `
<style>
#bam-disa-toggle{position:fixed;bottom:24px;right:24px;display:flex;align-items:center;gap:8px;padding:10px 18px;background:linear-gradient(135deg,#14B8A6,#0F766E);border:none;border-radius:99px;color:#fff;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;z-index:9998;box-shadow:0 4px 24px rgba(20,184,166,0.35);transition:all .2s}
#bam-disa-toggle:hover{box-shadow:0 6px 32px rgba(20,184,166,0.5);transform:translateY(-2px)}
#bam-disa-toggle svg{width:16px;height:16px;flex-shrink:0}
#bam-disa-panel{position:fixed;bottom:80px;right:24px;width:340px;height:520px;background:#0D1220;border:1px solid rgba(255,255,255,0.09);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,0.6);z-index:9998;display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;overflow:hidden;transition:opacity .2s}
#bam-disa-head{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;background:rgba(20,184,166,0.06)}
.bam-disa-hinfo{display:flex;align-items:center;gap:10px}
.bam-disa-avatar{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#14B8A6,#0F766E);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex-shrink:0}
.bam-disa-htext{line-height:1.3}
.bam-disa-hname{font-size:13px;font-weight:700;color:#fff}
.bam-disa-hstatus{font-size:10px;color:rgba(255,255,255,0.4);display:flex;align-items:center;gap:4px}
.bam-disa-dot{width:5px;height:5px;border-radius:50%;background:#4ADE80;box-shadow:0 0 5px rgba(74,222,128,0.6)}
#bam-disa-close{background:rgba(255,255,255,0.07);border:none;color:rgba(255,255,255,0.5);width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
#bam-disa-close:hover{background:rgba(255,255,255,0.12);color:#fff}
#bam-disa-agents{flex-shrink:0;display:flex;align-items:center;gap:5px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.02);flex-wrap:wrap;min-height:42px}
#bam-disa-agents-label{font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);letter-spacing:0.08em;margin-right:2px;flex-shrink:0}
.bam-agent-tab{border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:4px 9px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:all .15s;white-space:nowrap;flex-shrink:0}
.bam-agent-tab.active{background:#0D9488;border-color:#0D9488;color:#fff}
.bam-agent-tab:not(.active){background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.55)}
.bam-agent-tab:not(.active):hover{background:rgba(255,255,255,0.09);color:rgba(255,255,255,0.85)}
#bam-disa-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.08) transparent}
#bam-disa-empty{text-align:center;padding:28px 16px;color:rgba(255,255,255,0.3)}
#bam-disa-empty-icon{font-size:28px;margin-bottom:8px;color:#14B8A6}
#bam-disa-empty-text{font-size:12px;line-height:1.6}
#bam-disa-typing{display:none}
.bam-disa-dots{display:inline-flex;gap:4px;align-items:center;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.07);padding:9px 13px;border-radius:12px;border-bottom-left-radius:3px}
.bam-disa-dots span{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,0.3);animation:bamDot 1.4s infinite}
.bam-disa-dots span:nth-child(2){animation-delay:.2s}
.bam-disa-dots span:nth-child(3){animation-delay:.4s}
@keyframes bamDot{0%,60%,100%{opacity:.25;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}
#bam-disa-foot{padding:10px;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0;display:flex;gap:8px;background:#0D1220}
#bam-disa-input{flex:1;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;resize:none;max-height:60px;min-height:36px;outline:none;transition:border-color .15s,box-shadow .15s;color:#f1f5f9;background:rgba(255,255,255,0.04);line-height:1.4}
#bam-disa-input::placeholder{color:rgba(255,255,255,0.25)}
#bam-disa-input:focus{border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15)}
#bam-disa-btn{background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;border-radius:10px;width:36px;height:36px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;align-self:flex-end}
#bam-disa-btn:hover{box-shadow:0 4px 16px rgba(20,184,166,0.4)}
#bam-disa-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
#bam-disa-btn svg{width:16px;height:16px}
</style>

<div id="bam-disa-panel">
  <div id="bam-disa-head">
    <div class="bam-disa-hinfo">
      <div class="bam-disa-avatar">✦</div>
      <div class="bam-disa-htext">
        <div class="bam-disa-hname" id="bam-disa-agent-name">DISA</div>
        <div class="bam-disa-hstatus"><span class="bam-disa-dot"></span>Asistente IA</div>
      </div>
    </div>
    <button id="bam-disa-close" aria-label="Cerrar">×</button>
  </div>
  <div id="bam-disa-agents">
    <span id="bam-disa-agents-label">AGENTE:</span>
  </div>
  <div id="bam-disa-msgs">
    <div id="bam-disa-empty">
      <div id="bam-disa-empty-icon">✦</div>
      <div id="bam-disa-empty-text">Hola, soy DISA.<br>¿En qué te ayudo hoy?</div>
    </div>
    <div id="bam-disa-typing"><div class="bam-disa-dots"><span></span><span></span><span></span></div></div>
  </div>
  <div id="bam-disa-foot">
    <textarea id="bam-disa-input" placeholder="Pregunta algo..." rows="1"></textarea>
    <button id="bam-disa-btn" aria-label="Enviar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
    </button>
  </div>
</div>

<button id="bam-disa-toggle" aria-label="Abrir DISA">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  DISA
</button>

<script>
(function(){
  var panel   = document.getElementById('bam-disa-panel');
  var toggle  = document.getElementById('bam-disa-toggle');
  var msgs    = document.getElementById('bam-disa-msgs');
  var typing  = document.getElementById('bam-disa-typing');
  var input   = document.getElementById('bam-disa-input');
  var btn     = document.getElementById('bam-disa-btn');
  var closeEl = document.getElementById('bam-disa-close');
  var agentBar = document.getElementById('bam-disa-agents');
  var agentNameEl = document.getElementById('bam-disa-agent-name');

  if (!panel || !toggle || !msgs || !typing || !input || !btn || !closeEl) return;

  var widgetAgentId = 1;

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function addMsg(role, text) {
    var empty = document.getElementById('bam-disa-empty');
    if (empty) empty.remove();

    var wrap   = document.createElement('div');
    var bubble = document.createElement('div');
    wrap.style.cssText = 'display:flex;justify-content:' + (role === 'user' ? 'flex-end' : 'flex-start');

    var baseStyle = 'max-width:88%;padding:9px 13px;border-radius:13px;font-size:13px;line-height:1.55;word-break:break-word;';
    if (role === 'user') {
      bubble.style.cssText = baseStyle + 'background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border-bottom-right-radius:3px';
    } else if (role === 'system') {
      bubble.style.cssText = baseStyle + 'background:rgba(20,184,166,0.1);color:#5EEAD4;border-left:2px solid #14B8A6;border-radius:10px;padding-left:12px';
    } else {
      bubble.style.cssText = baseStyle + 'background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85);border:1px solid rgba(255,255,255,0.08);border-bottom-left-radius:3px';
    }

    bubble.innerHTML = escHtml(text).replace(/\\n/g, '<br>');
    wrap.appendChild(bubble);
    msgs.insertBefore(wrap, typing);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setActiveTab(agentId) {
    document.querySelectorAll('.bam-agent-tab').forEach(function(t) {
      t.classList.toggle('active', parseInt(t.dataset.agentId) === agentId);
    });
  }

  function selectAgent(agentId, agentName) {
    widgetAgentId = agentId;
    setActiveTab(agentId);
    if (agentNameEl) agentNameEl.textContent = agentName || 'DISA';
    var csrf = window.CSRF_TOKEN || '';
    fetch('/api/disa/select-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ agent_id: agentId })
    }).catch(function(){});
    addMsg('system', 'Agente: ' + (agentName || 'DISA'));
  }

  function loadAgents() {
    var csrf = window.CSRF_TOKEN || '';
    fetch('/api/disa/agents', { headers: { 'x-csrf-token': csrf } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.agents || data.agents.length < 2) return;
        widgetAgentId = data.current_agent_id || 1;
        data.agents.forEach(function(a) {
          var tab = document.createElement('button');
          tab.className = 'bam-agent-tab' + (a.id === widgetAgentId ? ' active' : '');
          tab.dataset.agentId = a.id;
          var shortName = a.name.replace(/^DISA\s*/i, '');
          tab.innerHTML = '<span>' + escHtml(a.icon) + '</span><span>' + escHtml(shortName) + '</span>';
          tab.addEventListener('click', function() { selectAgent(a.id, a.name); });
          agentBar.appendChild(tab);
        });
        var activeAgent = data.agents.find(function(a) { return a.id === widgetAgentId; });
        if (activeAgent && agentNameEl) agentNameEl.textContent = activeAgent.name;
      })
      .catch(function(){});
  }

  async function doSend() {
    var msg = input.value.trim();
    if (!msg) return;

    addMsg('user', msg);
    input.value = '';
    input.style.height = 'auto';
    typing.style.display = 'block';
    msgs.scrollTop = msgs.scrollHeight;
    btn.disabled = true;

    var csrf = window.CSRF_TOKEN || '';
    var page = (window.location.pathname.split('/').pop() || '').replace(/[^a-z0-9_-]/gi, '');

    try {
      var res  = await fetch('/api/disa/message', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, 'x-current-page': page },
        body:    JSON.stringify({ message: msg, agent_id: widgetAgentId })
      });
      var data = await res.json();
      typing.style.display = 'none';
      btn.disabled = false;
      if (res.ok && data.reply) {
        addMsg('assistant', data.reply);
        if (data.action_executed) addMsg('system', 'Accion ejecutada correctamente.');
      } else {
        addMsg('assistant', data.error || 'Error al conectar con DISA.');
      }
    } catch (err) {
      typing.style.display = 'none';
      btn.disabled = false;
      addMsg('assistant', 'Error de red. Comprueba tu conexion.');
    }
  }

  input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 60) + 'px';
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  btn.addEventListener('click', function() { doSend(); });
  closeEl.addEventListener('click', function() {
    panel.style.display = 'none';
    toggle.style.display = 'flex';
  });
  toggle.addEventListener('click', function() {
    panel.style.display = 'flex';
    toggle.style.display = 'none';
    input.focus();
  });

  loadAgents();
})();
</script>
`;
}
