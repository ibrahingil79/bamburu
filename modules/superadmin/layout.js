// Shell del panel de superadmin (sala de máquinas de la plataforma). Tema oscuro propio,
// NO reutiliza el adminLayout de los negocios (es otra capa). Solo lo usa /superadmin.
import { escHtml } from '../../core/escape.js';

// Zonas del panel. `ready:false` = se construye en un bloque siguiente (se muestra gris).
const ZONES = [
  { key: 'negocios',   href: '/superadmin/negocios',   label: 'Negocios',   icon: '🏢', ready: true  },
  { key: 'salud',      href: '/superadmin/salud',      label: 'Salud',      icon: '🩺', ready: true  },
  { key: 'seguridad',  href: '/superadmin/seguridad',  label: 'Seguridad',  icon: '🛡️', ready: true  },
  { key: 'integridad', href: '/superadmin/integridad', label: 'Integridad', icon: '🔗', ready: true  },
  { key: 'errores',    href: '/superadmin/errores',    label: 'Errores',    icon: '⚠️', ready: true  },
  { key: 'backups',    href: '/superadmin/backups',    label: 'Copias',     icon: '💾', ready: true  },
  { key: 'avance',     href: '/superadmin/avance',     label: 'Avance',     icon: '📊', ready: true  },
];

export function saLayout(title, content, active = '', sa = {}, csrf = '') {
  const nav = ZONES.map(z => {
    const on = z.key === active;
    if (!z.ready) return `<span class="sa-nav-item sa-soon" title="Próximo bloque">${z.icon} ${z.label} <small>pronto</small></span>`;
    return `<a class="sa-nav-item${on ? ' on' : ''}" href="${z.href}">${z.icon} ${z.label}</a>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)} · Superadmin Bamburu</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#070B14;color:#e2e8f0;min-height:100vh}
.sa-top{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:#0B1024;border-bottom:1px solid rgba(255,255,255,.07)}
.sa-brand{font-weight:800;letter-spacing:-.02em}.sa-brand span{color:#f59e0b}
.sa-who{font-size:13px;color:#94a3b8;display:flex;gap:14px;align-items:center}
.sa-who a{color:#94a3b8;text-decoration:none}.sa-who a:hover{color:#fff}
.sa-wrap{display:flex;min-height:calc(100vh - 53px)}
.sa-side{width:210px;flex-shrink:0;background:#0B1024;border-right:1px solid rgba(255,255,255,.07);padding:14px 10px;display:flex;flex-direction:column;gap:4px}
.sa-nav-item{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:9px;font-size:14px;color:#cbd5e1;text-decoration:none}
.sa-nav-item:hover{background:rgba(255,255,255,.05)}
.sa-nav-item.on{background:#f59e0b;color:#070B14;font-weight:700}
.sa-soon{color:#475569;cursor:default}.sa-soon small{font-size:10px;opacity:.7}
.sa-main{flex:1;padding:28px 32px;max-width:1200px}
h1{font-size:22px;margin-bottom:4px}.sa-sub{color:#94a3b8;font-size:13px;margin-bottom:22px}
.card{background:#0D1229;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:20px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
th{color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700}
.b-green{background:rgba(16,185,129,.15);color:#34d399}.b-red{background:rgba(239,68,68,.15);color:#f87171}
.b-amber{background:rgba(245,158,11,.15);color:#fbbf24}.b-gray{background:rgba(148,163,184,.15);color:#cbd5e1}
.btn{padding:7px 13px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#e2e8f0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.btn:hover{background:rgba(255,255,255,.09)}.btn-amber{background:#f59e0b;color:#070B14;border-color:#f59e0b}
.btn-red{background:rgba(239,68,68,.12);color:#f87171;border-color:rgba(239,68,68,.3)}
input,select{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;font-family:inherit}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:50}
.modal{background:#0D1229;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:24px;max-width:440px;width:90%}
.modal h3{margin-bottom:14px}.modal label{display:block;font-size:12px;color:#94a3b8;margin:12px 0 5px}
.modal input,.modal select,.modal textarea{width:100%}
</style></head><body>
<div class="sa-top">
  <div class="sa-brand">Bam<span>buru</span> · Superadmin</div>
  <div class="sa-who"><span>${escHtml(sa.email || '')}</span>
    <a href="/superadmin/change-password">Cambiar contraseña</a>
    <a href="#" onclick="saLogout();return false">Salir</a></div>
</div>
<div class="sa-wrap">
  <nav class="sa-side">${nav}</nav>
  <main class="sa-main">${content}</main>
</div>
<div class="modal-bg" id="modalBg"><div class="modal" id="modalBox"></div></div>
<script>
  window.SA_CSRF = ${JSON.stringify(csrf)};
  async function saApi(method, url, body){
    const r = await fetch(url, { method, headers:{ 'Content-Type':'application/json','x-csrf-token':window.SA_CSRF }, body: body?JSON.stringify(body):undefined });
    let d=null; try{ d=await r.json(); }catch(_){}
    if(!r.ok) throw new Error((d&&d.error)||('Error '+r.status));
    return d;
  }
  async function saLogout(){ try{ await saApi('POST','/superadmin/logout'); }catch(_){} location.href='/superadmin/login'; }
  // Escapa texto para meterlo en el HTML de un modal. Hace falta AUNQUE el dato ya viniera escapado
  // en un data-*: al leerlo con dataset.x el navegador lo DEVUELVE DECODIFICADO, y concatenarlo aquí
  // lo reinyecta como HTML. El escape del atributo protege el atributo, no este segundo viaje.
  function saEsc(s){
    if(s==null)return'';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function saOpenModal(html){ document.getElementById('modalBox').innerHTML=html; document.getElementById('modalBg').style.display='flex'; }
  function saCloseModal(){ document.getElementById('modalBg').style.display='none'; }
  document.getElementById('modalBg').addEventListener('click',e=>{ if(e.target.id==='modalBg') saCloseModal(); });
</script>
</body></html>`;
}
