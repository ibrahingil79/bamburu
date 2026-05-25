export function getDisaWidget() {
  return `
<style>
#disaFab{position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;border:none;cursor:pointer;z-index:99999;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;box-shadow:0 4px 24px rgba(20,184,166,0.45);font-family:inherit}
#disaModal{display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;pointer-events:none}
#disaModal.open{display:block}
#disaBox{background:#0D1220;border:1px solid rgba(255,255,255,0.09);border-radius:16px;box-shadow:0 20px 70px rgba(0,0,0,0.75);display:flex;flex-direction:column;width:400px;height:500px;min-height:300px;max-height:80vh;resize:both;overflow:auto;min-width:320px;min-height:300px;cursor:default;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:all}
#disaBox .dp-head{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;align-items:center;gap:10px;cursor:move;flex-shrink:0;background:rgba(255,255,255,0.015)}
#disaBox .dp-avatar{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#14B8A6,#0F766E);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;flex-shrink:0}
#disaBox .dp-name{font-size:13px;font-weight:700;color:#F1F5F9}
#disaBox .dp-status{display:flex;align-items:center;gap:4px;font-size:10px;color:rgba(255,255,255,0.4)}
#disaBox .dp-dot{width:5px;height:5px;border-radius:50%;background:#4ADE80}
#disaBox .dp-close{margin-left:auto;background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.4);padding:5px;border-radius:7px;font-size:16px;color:#fff}
#dpMsgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:80px}
.dp-row{display:flex;flex-direction:column}
.dp-row-user{align-items:flex-end}
.dp-row-assistant{align-items:flex-start}
.dp-msg{font-size:13px;line-height:1.55;padding:9px 12px;border-radius:12px;max-width:88%;word-break:break-word}
.dp-msg-user{background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff}
.dp-msg-assistant{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.07);color:#e2e8f0}
#disaInputWrap{flex-shrink:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,0.07);display:flex;gap:7px}
#dpInput{flex:1;border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:8px 12px;font-size:13px;resize:none;height:36px;outline:none;color:#F1F5F9;background:rgba(255,255,255,0.04);font-family:inherit}
#dpInput::placeholder{color:rgba(255,255,255,0.25)}
#dpInput:focus{border-color:#14B8A6}
#dpSendBtn{width:36px;height:36px;border:none;border-radius:9px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
</style>

<button id="disaFab" onclick="disaOpen()">D</button>

<div id="disaModal">
  <div id="disaBox">
    <div class="dp-head" id="disaDragHandle">
      <div class="dp-avatar">D</div>
      <div><div class="dp-name">DISA</div><div class="dp-status"><span class="dp-dot"></span>Asistente IA</div></div>
      <button class="dp-close" onclick="disaClose()">✕</button>
    </div>
    <div id="dpMsgs">
      <div style="text-align:center;padding:40px 16px;color:rgba(255,255,255,0.3);font-size:12px">Hola, soy DISA. ¿En qué te ayudo?</div>
    </div>
    <div id="disaInputWrap">
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

  window.disaOpen = function(){
    document.getElementById('disaModal').classList.add('open');
    document.getElementById('dpInput').focus();
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
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:JSON.stringify({message:msg})
      });
      var d=await r.json();
      dpAppend('assistant', d.reply||'Sin respuesta');
    }catch(e){
      dpAppend('assistant','Error al conectar con DISA');
    }
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
