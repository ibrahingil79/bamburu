export function getDisaWidget() {
  return `
<style>
#disaFab{position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-d));color:var(--bg2);border:none;cursor:pointer;z-index:99999;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:500;box-shadow:0 4px 24px rgba(58,65,80,0.45);font-family:inherit}
#disaModal{display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;pointer-events:none}
#disaModal.open{display:block}
#disaBox{background:var(--bg2);border:1px solid var(--border);border-radius:16px;box-shadow:0 20px 70px rgba(0,0,0,0.75);display:flex;flex-direction:column;width:400px;height:500px;min-height:300px;max-height:80vh;resize:both;overflow:auto;min-width:320px;min-height:300px;cursor:default;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:all}
#disaBox .dp-head{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;cursor:move;flex-shrink:0;background:var(--bg3)}
#disaBox .dp-avatar{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent-d));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:var(--bg2);flex-shrink:0}
#disaBox .dp-name{font-size:13px;font-weight:500;color:var(--text)}
#disaBox .dp-status{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text3)}
#disaBox .dp-dot{width:5px;height:5px;border-radius:50%;background:var(--ok)}
#disaBox .dp-close{margin-left:auto;background:none;border:none;cursor:pointer;color:var(--text3);padding:5px;border-radius:7px;font-size:16px;color:var(--text)}
#dpMsgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:80px}
.dp-row{display:flex;flex-direction:column}
.dp-row-user{align-items:flex-end}
.dp-row-assistant{align-items:flex-start}
.dp-msg{font-size:13px;line-height:1.55;padding:9px 12px;border-radius:12px;max-width:88%;word-break:break-word}
.dp-msg-user{background:var(--accent);color:var(--bg2)}
.dp-msg-assistant{background:var(--bg2);border:1px solid var(--border);color:var(--text)}
#disaInputWrap{flex-shrink:0;padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:7px}
#dpInput{flex:1;border:1px solid var(--border2);border-radius:9px;padding:8px 12px;font-size:13px;resize:none;height:36px;outline:none;color:var(--text);background:var(--bg2);font-family:inherit}
#dpInput::placeholder{color:var(--text3)}
#dpInput:focus{border-color:var(--accent)}
#dpSendBtn{width:36px;height:36px;border:none;border-radius:9px;background:var(--accent);color:var(--bg2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#dpAttachBtn{width:36px;height:36px;border:1px solid var(--border2);border-radius:9px;background:var(--bg2);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#dpAttachBtn:hover{border-color:var(--accent);color:var(--accent)}
</style>

<button id="disaFab" onclick="disaOpen()">D</button>

<div id="disaModal">
  <div id="disaBox">
    <div class="dp-head" id="disaDragHandle">
      <div class="dp-avatar">D</div>
      <div><div class="dp-name">DISA</div><div class="dp-status"><span class="dp-dot"></span>Asistente IA</div></div>
      <button class="dp-close" onclick="dpNewThread()" onmousedown="event.stopPropagation()" title="Nueva conversación" style="margin-left:auto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="dp-close" onclick="disaClose()" style="margin-left:0">✕</button>
    </div>
    <div id="dpMsgs">
      <div style="text-align:center;padding:40px 16px;color:var(--text3);font-size:12px">Hola, soy DISA. ¿En qué te ayudo?</div>
    </div>
    <div id="disaInputWrap">
      <button id="dpAttachBtn" onclick="document.getElementById('dpFile').click()" title="Adjuntar factura (foto o PDF)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input id="dpFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" style="display:none" onchange="dpAttach()"/>
      <input id="dpInput" placeholder="Pregunta a DISA..." onkeydown="if(event.key==='Enter'){event.preventDefault();dpSend()}"/>
      <button id="dpSendBtn" onclick="dpSend()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>
  </div>
</div>

<script>
(function(){
  var csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')||'';
  window.disaWidgetThreadId = null;
  var widgetLoaded = false;

  async function loadActiveThread() {
    try {
      var r = await fetch('/api/disa/threads', { headers: { 'x-csrf-token': csrf } });
      if (!r.ok) return;
      var threads = await r.json();
      if (!Array.isArray(threads) || !threads.length) return;
      var thread = threads[0];
      window.disaWidgetThreadId = thread.id;
      var r2 = await fetch('/api/disa/threads/' + thread.id, { headers: { 'x-csrf-token': csrf } });
      if (!r2.ok) return;
      var t = await r2.json();
      if (t.messages && t.messages.length > 0) {
        var msgs = document.getElementById('dpMsgs');
        msgs.innerHTML = '';
        t.messages.forEach(function(m) { dpAppend(m.role, m.content); });
      }
    } catch(e) { console.error('[Widget] Error cargando historial:', e); }
  }

  window.disaOpen = function(){
    document.getElementById('disaModal').classList.add('open');
    document.getElementById('dpInput').focus();
    if (!widgetLoaded) { widgetLoaded = true; loadActiveThread(); }
  };
  window.disaClose = function(){
    document.getElementById('disaModal').classList.remove('open');
  };

  // Drag
  var drag = false, ox, oy, bx, by;
  var handle = document.getElementById('disaDragHandle');
  var box = document.getElementById('disaBox');
  handle.addEventListener('mousedown', function(e){
    drag=true;
    ox=e.clientX; oy=e.clientY;
    var r=box.getBoundingClientRect(); bx=r.left; by=r.top; box.style.left=bx+'px'; box.style.top=by+'px'; box.style.right='auto'; box.style.bottom='auto'; box.style.transform='none';
    box.style.position='fixed';
    box.style.margin='0';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if(!drag) return;
    box.style.left=(bx+e.clientX-ox)+'px';
    box.style.top=(by+e.clientY-oy)+'px';
  });
  document.addEventListener('mouseup', function(){ drag=false; });

  // Click fuera cierra
  document.getElementById('disaModal').addEventListener('click', function(e){
    if(e.target===this) disaClose();
  });

  window.dpSend = async function(){
    var input=document.getElementById('dpInput');
    var msg=input.value.trim();
    if(!msg) return;
    input.value='';
    dpAppend('user', msg);
    try{
      var r=await fetch('/api/disa/message',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-csrf-token':csrf},
        body:JSON.stringify({message:msg, thread_id:window.disaWidgetThreadId||null})
      });
      var d=await r.json();
      if(d.thread_id) window.disaWidgetThreadId=d.thread_id;
      dpAppend('assistant', d.reply||'Sin respuesta');
      // Handoff a pantalla (p.ej. dictar una compra por voz): si la acción devuelve un
      // enlace, navega (mismo mecanismo que el adjunto de factura). Sin esto, DISA decia
      // "te llevo a la pantalla" pero no navegaba.
      if(d.capture_url){ setTimeout(function(){ window.location.href=d.capture_url; }, 900); }
    }catch(e){
      dpAppend('assistant','Error al conectar con DISA');
    }
  };

  // Adjuntar factura: la sube a DISA, que la lee con el extractor de C2 y devuelve un
  // enlace a la pantalla de revisión EDITABLE precargada. No se guarda nada hasta que el
  // usuario confirma allí (confirm-first). Reutiliza el mismo CSRF que el chat.
  window.dpAttach = async function(){
    var inp=document.getElementById('dpFile');
    var f=inp.files[0];
    if(!f) return;
    inp.value='';
    dpAppend('user','📄 '+f.name);
    dpAppend('assistant','Leyendo la factura… esto puede tardar unos segundos.');
    var fd=new FormData(); fd.append('file', f);
    try{
      var r=await fetch('/api/disa/attach',{ method:'POST', headers:{'x-csrf-token':csrf}, body:fd });
      var d=await r.json();
      var msgs=document.getElementById('dpMsgs');
      if(msgs.lastChild) msgs.removeChild(msgs.lastChild);   // quita el "Leyendo…"
      if(!r.ok || d.error){ dpAppend('assistant', d.error||'No pude procesar el archivo.'); return; }
      dpAppend('assistant', d.reply||'Listo.');
      if(d.capture_url){ setTimeout(function(){ window.location.href=d.capture_url; }, 900); }
    }catch(e){
      var m=document.getElementById('dpMsgs'); if(m.lastChild) m.removeChild(m.lastChild);
      dpAppend('assistant','Error al subir la factura.');
    }
  };

  // Nueva conversación: crea un hilo nuevo (mismo motor que el asistente IA) y limpia el chat.
  window.dpNewThread = async function(){
    try{
      var r=await fetch('/api/disa/threads',{ method:'POST', headers:{'Content-Type':'application/json','x-csrf-token':csrf} });
      var t=await r.json();
      window.disaWidgetThreadId = t.id || null;
    }catch(e){ window.disaWidgetThreadId=null; }
    document.getElementById('dpMsgs').innerHTML='<div style="text-align:center;padding:40px 16px;color:var(--text3);font-size:12px">Nueva conversación. ¿En qué te ayudo?</div>';
    document.getElementById('dpInput').focus();
  };

  function dpAppend(role, text){
    var msgs=document.getElementById('dpMsgs');
    var row=document.createElement('div');
    row.className='dp-row dp-row-'+role;
    var bubble=document.createElement('div');
    bubble.className='dp-msg dp-msg-'+role;
    bubble.textContent=text;
    row.appendChild(bubble);
    msgs.appendChild(row);
    msgs.scrollTop=msgs.scrollHeight;
  }
})();
</script>`;
}
