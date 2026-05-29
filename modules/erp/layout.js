import { getDisaWidget } from '../disa/widget.js';

export function csrfField(token) {
  return `<input type="hidden" name="_csrf" value="${token}">`;
}

export function can(c, perm) {
  if (c.get('isOwner')) return true;
  if (c.get('isAdmin')) return true;
  const perms = c.get('userPerms') || [];
  return perms.includes(perm);
}

export function adminLayout(title, content, active = '', csrfToken = '', c = null, hideDisaSidebar = false) {
  const session = c?.get?.('session') || {};
  const role = session.role || '';
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin' || isOwner;
  const perms = c?.get?.('userPerms') || [];

  // Nav permission map: key → required perm (null = always visible to all logged-in users)
  const navPerms = {
    dashboard:        null,
    activity:         'activity.read',
    products:         'products.read',
    categories:       'categories.read',
    tags:             'tags.read',
    orders:           'orders.read',
    pos:              'orders.create',
    'store-settings': null,
    refunds:          'orders.edit',
    discounts:        'discounts.read',
    invoices:         'invoices.read',
    inventory:        'inventory.read',
    suppliers:        'suppliers.read',
    purchases:        'purchases.read',
    clients:          'clients.read',
    'client-groups':  'clients.read',
    analytics:        'analytics.read',
    disa:             null,
    users:            'admin.manage_users',
    settings:         'admin.settings',
    security:         'admin.settings',
  };

  const roleFilters = {
    users:            r => r === 'owner' || r === 'admin',
    settings:         r => r === 'owner',
    'store-settings': r => r === 'owner' || r === 'admin',
    security:         r => r === 'owner' || r === 'admin',
  };

  const nav = [
    { section: 'General', items: [
      { href: '/admin', label: 'Dashboard', key: 'dashboard', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' },
      { href: '/admin/activity', label: 'Actividad', key: 'activity', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    ]},
    { section: 'Catálogo', items: [
      { href: '/admin/products', label: 'Productos', key: 'products', icon: '<path d="M20 7l-8-4-8 4M20 7l-8 4M20 7v10l-8 4M12 11v10M12 11L4 7M4 7v10l8 4"/>' },
      { href: '/admin/categories', label: 'Categorías', key: 'categories', icon: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>' },
      // OCULTO del menú (e-commerce, tienda online). Ruta /admin/tags sigue montada:
      // { href: '/admin/tags', label: 'Etiquetas', key: 'tags', icon: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>' },
    ]},
    // OCULTOS del menú (no borrados — rutas siguen montadas): 'pos' (Punto de Venta),
    // 'store-settings' (Tienda Online). [El módulo 'services' de A3 se eliminó en P3:
    // los servicios son ahora productos de tipo 'servicio'.]
    { section: 'Ventas', items: [
      { href: '/admin/orders', label: 'Pedidos', key: 'orders', icon: '<path d="M9 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-4"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/>' },
      { label: 'Albaranes', key: 'albaranes', disabled: true, icon: '<path d="M9 2h6a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>' },
      { href: '/admin/invoices', label: 'Facturas', key: 'invoices', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
    ]},
    { section: 'Clientes', items: [
      { href: '/admin/clients', label: 'Clientes', key: 'clients', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
      { href: '/admin/clients/groups', label: 'Grupos', key: 'client-groups', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
      { label: 'CRM', key: 'crm', disabled: true, icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="10" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>' },
    ]},
    { section: 'Inventario', items: [
      { href: '/admin/purchases', label: 'Compras', key: 'purchases', icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
      { href: '/admin/inventory', label: 'Stock', key: 'inventory', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },
      { href: '/admin/suppliers', label: 'Proveedores', key: 'suppliers', icon: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>' },
      { href: '/admin/orders/refunds', label: 'Devoluciones', key: 'refunds', icon: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>' },
      { href: '/admin/discounts', label: 'Descuentos', key: 'discounts', icon: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>' },
    ]},
    { section: 'Analítica', items: [
      { href: '/admin/analytics', label: 'Analítica', key: 'analytics', icon: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>' },
    ]},
    { section: 'DISA', items: [
      { href: '/admin/disa', label: 'Asistente IA', key: 'disa', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/>' },
    ]},
    { section: 'Sistema', items: [
      { href: '/admin/settings', label: 'Empresa', key: 'settings', icon: '<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/>' },
      { href: '/admin/users', label: 'Usuarios Admin', key: 'users', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>' },
      { href: '/admin/security', label: 'Seguridad', key: 'security', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    ]},
  ];

  const hasCustomPerms = !isAdmin && !isOwner && perms.length > 0;
  const filteredNav = nav.map(s => ({
    ...s,
    items: s.items.filter(i => {
      if (roleFilters[i.key] && !roleFilters[i.key](role)) return false;
      if (hasCustomPerms) {
        const req = navPerms[i.key];
        if (req != null) {
          if (!perms.includes(req)) return false;
        }
      }
      return true;
    }),
  })).filter(s => s.items.length > 0);

  const navHTML = filteredNav.map(s => `
    <div class="nav-section">
      <div class="nav-title">${s.section}</div>
      ${s.items.map(i => i.disabled
        ? `<span class="nav-item nav-item-disabled" title="Pendiente — aún no disponible"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.icon}</svg><span>${i.label}</span><span class="nav-pending">pendiente</span></span>`
        : `<a href="${i.href}" class="nav-item${active === i.key ? ' active' : ''}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.icon}</svg><span>${i.label}</span></a>`
      ).join('')}
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title} — Bamburu</title>
  <meta name="csrf-token" content="${csrfToken}">
  <script>
    window.CSRF_TOKEN="${csrfToken}";
    window.USER_PERMS=${JSON.stringify(perms)};
    window.USER_IS_OWNER=${isOwner};
    window.USER_IS_ADMIN=${isAdmin};
    window.canDo=function(p){if(window.USER_IS_OWNER||window.USER_IS_ADMIN)return true;return window.USER_PERMS.includes(p);};
  </script>
  <script>
    function openModal(id){document.getElementById(id).classList.add('open')}
    function closeModal(id){document.getElementById(id).classList.remove('open')}
    function toast(msg,type='ok'){
      const t=document.createElement('div');
      const styles={ok:'background:rgba(20,184,166,0.15);border:1px solid rgba(20,184,166,0.3);color:#5EEAD4',err:'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#FCA5A5',warn:'background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);color:#FCD34D'};
      t.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;padding:.75rem 1.1rem;border-radius:12px;font-size:.85rem;font-weight:500;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.5);max-width:300px;backdrop-filter:blur(12px)';
      Object.assign(t.style, {});
      t.setAttribute('style', t.style.cssText + ';' + (styles[type]||styles.ok));
      t.textContent=msg;
      document.body.appendChild(t);
      requestAnimationFrame(()=>requestAnimationFrame(()=>t.style.opacity='1'));
      setTimeout(()=>t.remove(),3200);
    }
    function switchTab(group,key){
      document.querySelectorAll('[data-tab-group="'+group+'"]').forEach(el=>{el.classList.toggle('active',el.dataset.tabKey===key)});
      document.querySelectorAll('[data-pane-group="'+group+'"]').forEach(el=>{el.classList.toggle('active',el.dataset.paneKey===key)});
    }
    async function api(method,url,body){
      const opts={method,headers:{'Content-Type':'application/json'}};
      if(!['GET','HEAD'].includes(method.toUpperCase()))opts.headers['x-csrf-token']=window.CSRF_TOKEN;
      if(body)opts.body=JSON.stringify(body);
      const r=await fetch(url,opts);
      if(r.status===403&&method!=='GET'){if(typeof showAccessDenied==='function')showAccessDenied();throw new Error('Acceso no permitido');}
      if(r.status===403)throw new Error('Acceso no permitido');
      const d=await r.json();
      if(d.error)throw new Error(d.error);
      return d;
    }
    window.escHtml=function(s){
      if(s==null)return'';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    };
    window.showAccessDenied=function(){
      var m=document.getElementById('accessDeniedModal');
      if(m)m.style.display='flex';
    };
  </script>
  <style>
    :root{
      --bg:        #070B14;
      --bg2:       #0D1220;
      --bg3:       #111827;
      --border:    rgba(255,255,255,0.07);
      --border2:   rgba(255,255,255,0.12);
      --text:      #F1F5F9;
      --text2:     rgba(255,255,255,0.65);
      --text3:     rgba(255,255,255,0.4);
      --teal:      #14B8A6;
      --teal-d:    #0F766E;
      --teal-soft: rgba(20,184,166,0.12);
      --teal-glow: rgba(20,184,166,0.25);
      --danger:    #EF4444;
      --danger-s:  rgba(239,68,68,0.12);
      --warn:      #F59E0B;
      --warn-s:    rgba(245,158,11,0.12);
      --ok:        #10B981;
      --ok-s:      rgba(16,185,129,0.12);
      --sw:        240px;
      --radius:    10px;
      --radius-lg: 14px;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;min-height:100vh;font-size:14px}

    /* ── Sidebar ── */
    .sidebar{width:var(--sw);background:var(--bg2);border-right:1px solid var(--border);position:fixed;top:0;left:0;height:100vh;overflow-y:auto;z-index:100;display:flex;flex-direction:column}
    .sb-head{padding:1.25rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:center}
    .sb-logo{font-size:1.3rem;font-weight:800;color:#fff;letter-spacing:-.03em;text-decoration:none}
    .sb-logo span{color:var(--teal)}
    .sb-nav{flex:1;padding:.5rem 0;overflow-y:auto}
    .nav-section{margin-bottom:.15rem}
    .nav-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);padding:.6rem 1rem .2rem}
    .nav-item{display:flex;align-items:center;gap:8px;padding:.45rem 1rem;color:var(--text2);text-decoration:none;font-size:.83rem;border-left:2px solid transparent;transition:all .15s}
    .nav-item:hover{background:rgba(255,255,255,0.04);color:var(--text)}
    .nav-item.active{background:var(--teal-soft);color:var(--teal);border-left-color:var(--teal);font-weight:600}
    .nav-item svg{flex-shrink:0;opacity:.75}
    .nav-item:hover svg,.nav-item.active svg{opacity:1}
    .nav-item-disabled{color:var(--text3);cursor:default;opacity:.55}
    .nav-item-disabled:hover{background:none;color:var(--text3)}
    .nav-pending{margin-left:auto;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);border:1px solid var(--border);border-radius:6px;padding:1px 5px}
    .sb-foot{padding:.875rem 1rem;border-top:1px solid var(--border)}
    .sb-foot a{display:flex;align-items:center;gap:8px;color:var(--text3);text-decoration:none;font-size:.8rem;transition:color .15s}
    .sb-foot a:hover{color:var(--teal)}
    .sb-foot a svg{flex-shrink:0;opacity:.75}
    .sb-foot a:hover svg{opacity:1}

    /* ── Layout ── */
    .wrap{margin-left:var(--sw);flex:1;display:flex;flex-direction:column;min-height:100vh}
    .topbar{background:var(--bg2);border-bottom:1px solid var(--border);padding:.75rem 1.5rem;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:50}
    .topbar-title{font-weight:600;font-size:.9rem;color:var(--text)}
    .content{flex:1;padding:1.5rem}

    /* ── Cards ── */
    .card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg)}
    .card-head{padding:.875rem 1.25rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
    .card-head h3{font-size:.88rem;font-weight:600;color:var(--text)}
    .card-body{padding:1.25rem}
    .kpi{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.25rem;transition:border-color .2s}
    .kpi:hover{border-color:var(--border2)}
    .kpi-label{font-size:.72rem;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.06em}
    .kpi-val{font-size:1.7rem;font-weight:700;margin:.3rem 0 .15rem;color:var(--text)}
    .kpi-sub{font-size:.75rem;color:var(--text3)}

    /* ── Grid ── */
    .grid{display:grid;gap:1rem}
    .g2{grid-template-columns:repeat(2,1fr)}
    .g3{grid-template-columns:repeat(3,1fr)}
    .g4{grid-template-columns:repeat(4,1fr)}
    .ga{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}

    /* ── Buttons ── */
    .btn{display:inline-flex;align-items:center;gap:.35rem;padding:.42rem .9rem;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:all .15s;line-height:1.4;font-family:inherit}
    .btn-primary{background:linear-gradient(135deg,var(--teal),var(--teal-d));color:#fff}
    .btn-primary:hover{box-shadow:0 4px 20px var(--teal-glow);transform:translateY(-1px)}
    .btn-secondary{background:rgba(255,255,255,0.05);color:var(--text2);border:1px solid var(--border2)}
    .btn-secondary:hover{background:rgba(255,255,255,0.09);color:var(--text)}
    .btn-danger{background:var(--danger-s);color:#FCA5A5;border:1px solid rgba(239,68,68,0.2)}
    .btn-danger:hover{background:rgba(239,68,68,0.2)}
    .btn-warning{background:var(--warn-s);color:#FCD34D;border:1px solid rgba(245,158,11,0.2)}
    .btn-sm{padding:.26rem .6rem;font-size:.76rem}

    /* ── Tables ── */
    .table-wrap{overflow-x:auto}
    table{width:100%;border-collapse:collapse;font-size:.84rem}
    thead th{background:var(--bg3);color:var(--text3);font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;padding:.6rem 1rem;text-align:left;border-bottom:1px solid var(--border)}
    tbody td{padding:.7rem 1rem;border-bottom:1px solid var(--border);color:var(--text2)}
    tbody tr:hover td{background:rgba(255,255,255,0.02);color:var(--text)}
    tbody tr:last-child td{border-bottom:none}

    /* ── Forms ── */
    .form-group{margin-bottom:.85rem}
    .form-label{display:block;font-size:.79rem;font-weight:600;margin-bottom:.3rem;color:var(--text2)}
    .form-control{width:100%;padding:.5rem .75rem;border:1px solid var(--border2);border-radius:var(--radius);font-size:.85rem;color:var(--text);background:rgba(255,255,255,0.04);font-family:inherit;transition:border-color .15s,box-shadow .15s;outline:none}
    .form-control:focus{border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-soft)}
    .form-control::placeholder{color:var(--text3)}
    textarea.form-control{resize:vertical;min-height:80px}
    .form-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem}
    select.form-control option{background:#1e293b;color:var(--text)}

    /* ── Badges ── */
    .badge{display:inline-flex;align-items:center;padding:.18rem .55rem;border-radius:99px;font-size:.69rem;font-weight:600}
    .b-green{background:rgba(16,185,129,0.15);color:#6EE7B7}
    .b-yellow{background:rgba(245,158,11,0.15);color:#FCD34D}
    .b-red{background:rgba(239,68,68,0.15);color:#FCA5A5}
    .b-blue{background:rgba(59,130,246,0.15);color:#93C5FD}
    .b-purple{background:rgba(139,92,246,0.15);color:#C4B5FD}
    .b-gray{background:rgba(255,255,255,0.07);color:var(--text2)}
    .b-teal{background:rgba(20,184,166,0.15);color:#5EEAD4}

    /* ── Modals ── */
    .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px)}
    .modal-overlay.open{display:flex}
    .modal{background:var(--bg2);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.6)}
    .modal-head{padding:1.1rem 1.4rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
    .modal-head h3{font-size:.92rem;font-weight:600}
    .modal-body{padding:1.4rem}
    .modal-foot{padding:.9rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:.6rem}
    .modal-close{background:none;border:none;cursor:pointer;color:var(--text3);font-size:1.2rem;padding:.2rem;transition:color .15s}
    .modal-close:hover{color:var(--text)}

    /* ── Alerts ── */
    .alert{padding:.75rem 1rem;border-radius:var(--radius);margin-bottom:1rem;font-size:.84rem}
    .alert-warn{background:var(--warn-s);color:#FCD34D;border:1px solid rgba(245,158,11,0.25)}
    .alert-err{background:var(--danger-s);color:#FCA5A5;border:1px solid rgba(239,68,68,0.25)}
    .alert-ok{background:var(--ok-s);color:#6EE7B7;border:1px solid rgba(16,185,129,0.25)}

    /* ── Misc ── */
    .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem}
    .ph h2{font-size:1.05rem;font-weight:700}
    .search{padding:.45rem .75rem;border:1px solid var(--border2);border-radius:var(--radius);font-size:.84rem;background:rgba(255,255,255,0.04);color:var(--text);font-family:inherit;outline:none;min-width:200px;transition:border-color .15s}
    .search:focus{border-color:var(--teal)}
    .search::placeholder{color:var(--text3)}
    img.thumb{width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}
    .tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:1.25rem;gap:0}
    .tab{padding:.55rem .9rem;cursor:pointer;font-size:.83rem;font-weight:500;color:var(--text3);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
    .tab:hover{color:var(--text2)}
    .tab.active{color:var(--teal);border-bottom-color:var(--teal)}
    .tab-pane{display:none}.tab-pane.active{display:block}
    .stars{color:#F59E0B}
    @media(max-width:768px){
      .sidebar{transform:translateX(-100%)}
      .wrap{margin-left:0}
      #disaFab{bottom:16px;right:16px}
      #disaPanel{width:calc(100vw - 24px);right:12px;bottom:80px}
      .g4{grid-template-columns:repeat(2,1fr)}
      .g3{grid-template-columns:repeat(2,1fr)}
      .g2{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
  <aside class="sidebar">
    <div class="sb-head">
      <a href="/admin" class="sb-logo">Bam<span>buru</span></a>
    </div>
    <nav class="sb-nav">${navHTML}</nav>
    <div class="sb-foot">
      <a href="/docs" target="_blank"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><span>Documentación</span></a>
      <a href="/admin/logout"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Cerrar sesión</span></a>
    </div>
  </aside>
  <div class="wrap">
    <div class="topbar">
      <span class="topbar-title">${title}</span>
    </div>
    <main class="content">${content}</main>
  </div>
  <script>
    document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.classList.remove('open')});
  </script>
  

${hideDisaSidebar ? '' : getDisaWidget()}
  <div id="accessDeniedModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:99999;align-items:center;justify-content:center">
    <div style="background:#0f1420;border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:32px;text-align:center;max-width:380px">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="margin-bottom:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <h3 style="color:#fff;margin:0 0 8px">Acceso no permitido</h3>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 20px">No tienes permisos para realizar esta acción.</p>
      <button onclick="document.getElementById('accessDeniedModal').style.display='none'" style="background:#0D9488;border:none;color:#fff;padding:8px 24px;border-radius:6px;cursor:pointer;font-weight:600">Entendido</button>
    </div>
  </div>
</body>
</html>`;
}
