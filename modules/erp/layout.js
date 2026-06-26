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

  // Banner de SOLO LECTURA: el negocio fue suspendido por impago (suspended_admin) desde el
  // panel de superadmin. Entra y ve sus datos, pero el guard bloquea cualquier escritura.
  const readOnly = !!c?.get?.('tenantReadOnly');
  const _noteRaw = c?.get?.('tenant')?.suspend_note || '';
  const _note = _noteRaw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const roBanner = readOnly
    ? `<div style="background:#7c2d12;color:#fed7aa;padding:11px 18px;font-size:13px;font-weight:500;text-align:center">⚠️ Tu cuenta está en <strong>SOLO LECTURA</strong> por regularizar. Puedes ver tus datos y facturas, pero no crear ni modificar nada hasta reactivarla.${_note ? ' · ' + _note : ''}</div>`
    : '';

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
    'supplier-returns': 'purchases.read',
    'stock-transfers': 'inventory.read',
    discounts:        'discounts.read',
    quotes:           'quotes.read',
    pedidos:          'pedidos.read',
    albaranes:        'albaranes.read',
    mostrador:        'invoices.create',
    invoices:         'invoices.read',
    cobros:           'invoices.read',
    pagos:            'purchases.read',
    'supplier-invoices': 'purchases.read',
    inventory:        'inventory.read',
    warehouses:       'inventory.read',
    suppliers:        'suppliers.read',
    purchases:        'purchases.read',
    'purchase-orders': 'purchases.read',
    clients:          'clients.read',
    'client-groups':  'clients.read',
    analytics:        'analytics.read',
    disa:             null,
    users:            'admin.manage_users',
    settings:         'admin.settings',
    security:         'admin.settings',
    'change-password': null,
    'purchases-capture': 'purchases.create',
  };

  const roleFilters = {
    users:            r => r === 'owner' || r === 'admin',
    settings:         r => r === 'owner',
    'store-settings': r => r === 'owner' || r === 'admin',
    security:         r => r === 'owner' || r === 'admin',
  };

  // ── MENÚ REORDENADO según DISEÑO.md §3 (PIEZA 2 — solo navegación) ──────────────
  // Agrupado por el CICLO DEL NEGOCIO: Ventas (con Clientes/Grupos), Compras (con
  // Proveedores), Inventario, Catálogo. DISA fija arriba e Inicio justo debajo. Sin
  // etiquetas de zona. Solo cambia DÓNDE aparece cada enlace; ninguna ruta se crea/renombra.
  // Colapso/hover + avatar + DISA destacada + quitar logo son capa visual (CSS/JS) → 2º paso.
  // Desenlazados (rutas SIGUEN montadas): orders (Pedidos viejos), discounts (Descuentos),
  // analytics (Analítica) → D4, en espera del Pilar 4. tags/store-settings ya estaban
  // ocultos (D2). Cuenta queda en el lateral de forma provisional hasta tener el avatar.
  // Iconos = Tabler (ti-*), como el mockup. DISA NO es entrada del menú: es la home (/admin).
  const nav = [
    { section: 'Inicio', bare: true, items: [
      { href: '/admin', label: 'Inicio', key: 'dashboard', icon: 'ti-home' },
    ]},
    { section: 'Ventas', items: [
      { href: '/admin/quotes', label: 'Presupuestos', key: 'quotes', icon: 'ti-file-text' },
      { href: '/admin/pedidos', label: 'Pedidos', key: 'pedidos', icon: 'ti-clipboard-list' },
      { href: '/admin/albaranes', label: 'Albaranes', key: 'albaranes', icon: 'ti-truck-delivery' },
      { href: '/admin/invoices', label: 'Facturas', key: 'invoices', icon: 'ti-file-invoice' },
      { href: '/admin/cobros', label: 'Cobros', key: 'cobros', icon: 'ti-cash' },
      { href: '/admin/mostrador', label: 'TPV', key: 'mostrador', icon: 'ti-cash-register' },
      { href: '/admin/clients', label: 'Clientes', key: 'clients', icon: 'ti-users' },
      { href: '/admin/clients/groups', label: 'Grupos', key: 'client-groups', icon: 'ti-users-group' },
      { label: 'CRM', key: 'crm', disabled: true, icon: 'ti-address-book' },
    ]},
    { section: 'Compras', items: [
      { href: '/admin/purchase-orders', label: 'Órdenes de compra', key: 'purchase-orders', icon: 'ti-clipboard-list' },
      { href: '/admin/purchases', label: 'Compra directa', key: 'purchases', icon: 'ti-shopping-cart' },
      { href: '/admin/supplier-invoices', label: 'Facturas recibidas', key: 'supplier-invoices', icon: 'ti-file-dollar' },
      { href: '/admin/pagos', label: 'Pagos a proveedores', key: 'pagos', icon: 'ti-cash' },
      { href: '/admin/supplier-returns', label: 'Devoluciones', key: 'supplier-returns', icon: 'ti-arrow-back-up' },
      { href: '/admin/purchases/capture', label: 'Captura de factura', key: 'purchases-capture', icon: 'ti-camera' },
      { href: '/admin/suppliers', label: 'Proveedores', key: 'suppliers', icon: 'ti-building-store' },
    ]},
    { section: 'Contabilidad', items: [
      { href: '/admin/contabilidad', label: 'Libros registro', key: 'contabilidad', icon: 'ti-book' },
    ]},
    { section: 'Inventario', items: [
      { href: '/admin/inventory', label: 'Stock', key: 'inventory', icon: 'ti-building-warehouse' },
      { href: '/admin/warehouses', label: 'Almacenes', key: 'warehouses', icon: 'ti-buildings' },
      { href: '/admin/stock-transfers', label: 'Traslados', key: 'stock-transfers', icon: 'ti-transfer' },
    ]},
    { section: 'Catálogo', items: [
      { href: '/admin/products', label: 'Productos', key: 'products', icon: 'ti-box' },
      { href: '/admin/categories', label: 'Categorías', key: 'categories', icon: 'ti-category' },
      // OCULTO del menú (e-commerce, D2). Ruta /admin/tags sigue montada (no se enlaza).
    ]},
  ];

  // ── Barra de Cuenta (desplegable del avatar, mockup): items reales + Documentación + salir ──
  const accountItems = [
    { href: '/admin/change-password', label: 'Mi cuenta', key: 'change-password', icon: 'ti-user' },
    { href: '/admin/settings', label: 'Ajustes', key: 'settings', icon: 'ti-settings' },
    { href: '/admin/settings/company', label: 'Datos del negocio', key: 'settings', icon: 'ti-building' },
    { href: '/admin/users', label: 'Usuarios', key: 'users', icon: 'ti-user-cog' },
    { href: '/admin/security', label: 'Seguridad', key: 'security', icon: 'ti-shield-lock' },
    { href: '/admin/activity', label: 'Actividad', key: 'activity', icon: 'ti-history' },
  ];

  const hasCustomPerms = !isAdmin && !isOwner && perms.length > 0;
  const navFilter = i => {
    if (roleFilters[i.key] && !roleFilters[i.key](role)) return false;
    if (hasCustomPerms) { const req = navPerms[i.key]; if (req != null && !perms.includes(req)) return false; }
    return true;
  };
  const filteredNav = nav.map(s => ({ ...s, items: s.items.filter(navFilter) })).filter(s => s.items.length > 0);

  const navHTML = filteredNav.map(s => `
    <div class="nav-section">
      ${s.bare ? '' : `<div class="nav-title">${s.section}</div>`}
      ${s.items.map(i => i.disabled
        ? `<span class="nav-item nav-item-disabled" title="Pendiente — aún no disponible"><i class="ti ${i.icon}"></i><span>${i.label}</span><span class="nav-pending">pendiente</span></span>`
        : `<a href="${i.href}" class="nav-item${active === i.key ? ' active' : ''}"><i class="ti ${i.icon}"></i><span>${i.label}</span></a>`
      ).join('')}
    </div>`).join('');

  // ── Avatar + barra de Cuenta (mockup): cabecera + items gateados + Documentación + salir ──
  const acctVisible = accountItems.filter(navFilter);
  const userName = session.userName || 'Cuenta';
  const escName = String(userName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const initial = (String(userName).trim().charAt(0) || 'U').toUpperCase();
  const roleLabel = isOwner ? 'Propietario' : role === 'admin' ? 'Administrador' : role === 'employee' ? 'Empleado' : 'Usuario';
  const acctMenuHTML =
    `<div class="acct-mh"><span class="acct-avatar">${initial}</span><div><div class="acct-mh-n">${escName}</div><div class="acct-mh-e">${roleLabel}</div></div></div>`
    + acctVisible.map(i => `<a href="${i.href}" class="acct-item"><i class="ti ${i.icon}"></i><span>${i.label}</span></a>`).join('')
    + `<div class="acct-sep"></div>`
    + `<a href="/docs" target="_blank" class="acct-item"><i class="ti ti-file-text"></i><span>Documentación</span></a>`
    + `<div class="acct-sep"></div>`
    + `<a href="/admin/logout" class="acct-item danger"><i class="ti ti-logout"></i><span>Cerrar sesión</span></a>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title} — Bamburu</title>
  <meta name="csrf-token" content="${csrfToken}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css">
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
      const styles={ok:'background:#E8F5EE;border:1px solid #CDE8D8;color:#2E7D55',err:'background:#FBEDEC;border:1px solid #F0CFCC;color:#A6453F',warn:'background:#FAF2E2;border:1px solid #EBDDB7;color:#8A6018'};
      t.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;padding:.75rem 1.1rem;border-radius:12px;font-size:.85rem;font-weight:500;z-index:9999;box-shadow:0 12px 36px rgba(16,24,40,.16);max-width:300px';
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
      /* Tokens EXACTOS de docs/diseno/mockup-aprobado.html. Cambiar aquí = toda la app. Cero teal. */
      --bg:        #F5F6F8;   /* fondo de aplicación */
      --bg2:       #FFFFFF;   /* superficies / tarjetas / chrome / paneles */
      --bg3:       #F1F3F5;   /* subsuperficie: search, hover, sutil */
      --card:      #FFFFFF;   /* alias de superficie de panel (= --bg2). Lo usan los paneles de
                                 sugerencias del buscador de línea (var(--card,#1e1e1e)); sin definir
                                 caían en el fallback oscuro #1e1e1e → nombre ilegible. */
      --border:    #ECEEF1;   /* hairline interno */
      --border2:   #E4E6EA;   /* borde exterior */
      --text:      #1A1D21;   /* texto principal */
      --text2:     #6B7280;   /* texto secundario */
      --text3:     #9097A1;   /* texto terciario / etiquetas */
      --body-tx:   #374151;   /* texto cuerpo */
      --accent:    #334155;   /* slate (acento de marca) */
      --accent-d:  #1E293B;   /* slate fuerte / activo */
      --accent-soft:#EDF0F4;  /* fondo activo / chips */
      --grp:       #A0A6B0;   /* título de grupo de menú */
      --muted:     #6B7280;   /* alias heredado (= secundario) */
      --p:         #334155;   /* alias heredado (= acento) */
      /* Alias de compatibilidad: el código heredado usa var(--teal*) → ahora ES slate */
      --teal:      #334155;
      --teal-d:    #1E293B;
      --teal-soft: rgba(51,65,85,0.10);
      --teal-glow: rgba(51,65,85,0.16);
      /* Estados (píldoras del mockup) */
      --danger:    #A32D2D;  --danger-s:  #FEE2E2;
      --warn:      #854F0B;  --warn-s:    #FAEEDA;
      --ok:        #2E7D55;  --ok-s:      #E8F5EE;
      /* Chrome GRAFITO AZUL OSCURO (barra superior + menú lateral). Patrón oro aprobado por
         Ibrahin 22-jun-2026: docs/diseno/sistema-visual-aprobado.html. Valores EXACTOS. */
      --chrome:        #20242F;   /* fondo del chrome (rail + topbar) */
      --chrome-tx:     #9AA3B3;   /* texto de menú inactivo */
      --chrome-tx-on:  #FFFFFF;   /* texto de menú activo */
      --chrome-ic:     #727B8C;   /* icono de menú inactivo */
      --chrome-grp:    #5B6475;   /* título de grupo de menú */
      --chrome-active: rgba(255,255,255,.10);  /* fondo del item activo */
      --chrome-div:    rgba(255,255,255,.07);   /* divisor sobre el chrome */
      --brand:         #FFFFFF;   /* marca (sparkles) sobre el chrome */
      --sw:        62px;
      --sw-exp:    176px;
      --radius:    9px;
      --radius-lg: 12px;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;min-height:100vh;font-size:14px;-webkit-font-smoothing:antialiased}

    /* ── Sidebar GRAFITO OSCURO (patrón oro): colapsable a iconos · se despliega al hover ── */
    .sidebar{width:var(--sw);background:var(--chrome);border-right:1px solid var(--chrome-div);position:fixed;top:0;left:0;height:100vh;overflow-x:hidden;overflow-y:auto;z-index:100;display:flex;flex-direction:column;transition:width .18s ease}
    .sidebar:hover{width:var(--sw-exp);box-shadow:6px 0 24px rgba(16,24,40,.18)}
    .sidebar::-webkit-scrollbar{width:6px}
    .sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:6px}
    .sb-brand{display:flex;align-items:center;justify-content:center;height:50px;flex-shrink:0;color:var(--brand);font-size:21px;line-height:1}
    .sidebar:hover .sb-brand{justify-content:flex-start;padding-left:1.05rem}
    .sb-nav{flex:1;padding:.4rem .55rem .6rem;overflow-y:auto;overflow-x:hidden}
    .nav-section{margin-bottom:.1rem}
    .nav-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--chrome-grp);padding:.7rem .55rem .3rem;white-space:nowrap;opacity:0;transition:opacity .15s}
    .sidebar:hover .nav-title{opacity:1}
    .nav-item{display:flex;align-items:center;justify-content:center;gap:0;padding:.5rem .57rem;margin:1px 0;border-radius:9px;color:var(--chrome-tx);text-decoration:none;font-size:13px;font-weight:400;white-space:nowrap;transition:background .15s,color .15s}
    .sidebar:hover .nav-item{justify-content:flex-start;gap:9px}
    .nav-item:hover{background:rgba(255,255,255,.06);color:var(--chrome-tx-on)}
    .nav-item.active{background:var(--chrome-active);color:var(--chrome-tx-on);font-weight:500}
    .nav-item i.ti,.nav-item svg{flex-shrink:0;width:18px;height:18px;font-size:18px;line-height:1;color:var(--chrome-ic)}
    .nav-item:hover i.ti,.nav-item:hover svg,.nav-item.active i.ti,.nav-item.active svg{color:var(--chrome-tx-on)}
    .nav-item>span{width:0;opacity:0;overflow:hidden;transition:opacity .15s}
    .sidebar:hover .nav-item>span{width:auto;opacity:1}
    .nav-item-disabled{color:var(--chrome-ic);cursor:default;opacity:.5}
    .nav-item-disabled:hover{background:none;color:var(--chrome-ic)}
    .nav-pending{margin-left:auto;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:rgba(255,255,255,.4);border:.5px solid rgba(255,255,255,.15);border-radius:7px;padding:1px 5px}

    /* ── Topbar GRAFITO OSCURO (patrón oro): buscador · campana · avatar ── */
    .wrap{margin-left:var(--sw);flex:1;display:flex;flex-direction:column;min-height:100vh}
    .topbar{background:var(--chrome);border-bottom:1px solid var(--chrome-div);padding:.6rem 1.1rem;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:50}
    .tb-search{flex:1;max-width:430px;display:flex;align-items:center;gap:8px;background:var(--chrome-div);border:.5px solid transparent;border-radius:9px;padding:7px 12px;color:#8A92A1;font-size:13px;cursor:text}
    .tb-search i.ti{font-size:16px}
    .tb-search:focus-within{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.12)}
    .tb-bell{color:var(--chrome-tx);font-size:18px;position:relative;display:flex;margin-left:auto;cursor:pointer}
    .tb-bell .dot{position:absolute;top:-1px;right:-1px;width:7px;height:7px;border-radius:50%;background:#DC2626;border:1.5px solid var(--chrome)}
    .topbar-title{font-weight:500;font-size:.85rem;color:var(--text2)}
    .content{flex:1;padding:20px 22px}
    /* ── Avatar + desplegable (mockup) ── */
    .acct{position:relative;flex-shrink:0}
    .acct-btn{display:flex;align-items:center;background:none;border:none;cursor:pointer;padding:0;border-radius:50%;font-family:inherit}
    .acct-avatar{width:31px;height:31px;border-radius:50%;background:#3A4357;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}
    .acct-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:212px;background:#fff;border:1px solid var(--border2);border-radius:12px;box-shadow:0 6px 20px rgba(16,24,40,0.10);padding:7px;display:none;z-index:120}
    .acct-menu.open{display:block}
    .acct-mh{display:flex;align-items:center;gap:9px;padding:7px 8px 9px;border-bottom:.5px solid #F0F1F3;margin-bottom:5px}
    .acct-mh .acct-avatar{box-shadow:none}
    .acct-mh-n{font-size:13px;font-weight:500;line-height:1.2;color:var(--text)}
    .acct-mh-e{font-size:11px;color:var(--text3)}
    .acct-item{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;color:var(--body-tx);text-decoration:none;font-size:13px;font-weight:400;transition:background .12s}
    .acct-item:hover{background:var(--bg3)}
    .acct-item i.ti,.acct-item svg{flex-shrink:0;font-size:16px;width:16px;height:16px;color:var(--text3)}
    .acct-item.danger{color:var(--danger)}
    .acct-item.danger i.ti,.acct-item.danger svg{color:var(--danger)}
    .acct-item.danger:hover{background:var(--danger-s)}
    .acct-sep{height:.5px;background:#F0F1F3;margin:5px 2px}
    /* ── Visor de documentos (DISEÑO §5): documento a la izquierda + panel a la derecha ── */
    .docwrap{display:flex;gap:20px;align-items:flex-start}
    .docpaper{flex:1;min-width:0;background:#FFFFFF;border:1px solid var(--border2);border-radius:13px;padding:34px 38px;box-shadow:0 1px 3px rgba(16,24,40,.05);color:var(--text);font-size:13px}
    .docpaper h1{font-size:22px;font-weight:500;margin:0 0 4px;color:var(--text)}
    .docpaper .doc-sub{color:var(--text2);font-size:12px;margin-bottom:26px}
    .docpaper .doc-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:26px}
    .docpaper .doc-label{font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:500;letter-spacing:.04em;margin-bottom:4px}
    .docpaper table{width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px}
    .docpaper thead th{background:var(--bg3);padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);font-weight:500;border-bottom:1px solid var(--border)}
    .docpaper tbody td{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text)}
    .docpaper .doc-totals{margin-left:auto;width:300px}
    .docpaper .doc-totals td:first-child{color:var(--text2)}
    .docpaper .doc-totals td:last-child{text-align:right;font-weight:500}
    .docpaper .doc-totals tr.grand td{font-size:15px;border-top:1px solid var(--text);padding-top:10px;color:var(--text)}
    .docpaper .doc-hash{margin-top:26px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--text2);word-break:break-all}
    .docpanel{width:300px;flex-shrink:0;position:sticky;top:80px;display:flex;flex-direction:column;gap:14px}
    .docpanel .card-body{padding:16px}
    .docpanel .dp-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;font-size:.84rem}
    .docpanel .dp-row .k{color:var(--text2)}
    .docpanel .dp-row .v{color:var(--text);font-weight:500;text-align:right}
    .docpanel .dp-actions{display:flex;flex-direction:column;gap:8px}
    .docpanel .dp-actions .btn{justify-content:center;width:100%}
    @media(max-width:980px){.docwrap{flex-direction:column}.docpanel{width:100%;position:static}}
    @media print{
      .sidebar,.topbar,.docpanel,#disaFab,#disaPanel,.disa-fab{display:none!important}
      .wrap{margin-left:0!important}.content{padding:0!important}
      .docwrap{display:block}
      .docpaper{border:none;box-shadow:none;border-radius:0;padding:0;max-width:820px;margin:auto}
      body{background:#fff!important}
    }

    /* ── Cards ── */
    .card{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg)}
    .card-head{padding:.875rem 1.25rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
    .card-head h3{font-size:.88rem;font-weight:500;color:var(--text)}
    .card-body{padding:1.25rem}
    .kpi{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:1.25rem;transition:border-color .2s}
    .kpi:hover{border-color:var(--border2)}
    .kpi-label{font-size:.72rem;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:.06em}
    .kpi-val{font-size:1.7rem;font-weight:500;margin:.3rem 0 .15rem;color:var(--text)}
    .kpi-sub{font-size:.75rem;color:var(--text3)}

    /* ── Grid ── */
    .grid{display:grid;gap:1rem}
    .g2{grid-template-columns:repeat(2,1fr)}
    .g3{grid-template-columns:repeat(3,1fr)}
    .g4{grid-template-columns:repeat(4,1fr)}
    .ga{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}

    /* ── Buttons ── */
    .btn{display:inline-flex;align-items:center;gap:.35rem;padding:.42rem .9rem;border-radius:8px;font-size:.82rem;font-weight:500;cursor:pointer;border:none;text-decoration:none;transition:all .15s;line-height:1.4;font-family:inherit}
    .btn-primary{background:var(--teal);color:#fff}
    .btn-primary:hover{background:var(--teal-d);box-shadow:0 4px 16px var(--teal-glow);transform:translateY(-1px)}
    .btn-secondary{background:#FFFFFF;color:#3F4A5C;border:1px solid var(--border2)}
    .btn-secondary:hover{background:#F1F4F8;color:var(--text)}
    .btn-danger{background:var(--danger-s);color:var(--danger);border:1px solid #F0CFCC}
    .btn-danger:hover{background:#F6DAD7}
    .btn-warning{background:var(--warn-s);color:var(--warn);border:1px solid #EBDDB7}
    .btn-sm{padding:.26rem .6rem;font-size:.76rem}

    /* ── Tables ── */
    .table-wrap{overflow-x:auto}
    table{width:100%;border-collapse:collapse;font-size:.84rem}
    thead th{background:var(--bg3);color:var(--text3);font-size:.7rem;font-weight:500;text-transform:uppercase;letter-spacing:.07em;padding:.6rem 1rem;text-align:left;border-bottom:1px solid var(--border)}
    tbody td{padding:.7rem 1rem;border-bottom:1px solid var(--border);color:var(--text2)}
    tbody tr:hover td{background:#F6F8FB;color:var(--text)}
    tbody tr:last-child td{border-bottom:none}

    /* ── Forms ── */
    .form-group{margin-bottom:.85rem}
    .form-label{display:block;font-size:.79rem;font-weight:500;margin-bottom:.3rem;color:var(--text2)}
    .form-control{width:100%;padding:.5rem .75rem;border:1px solid var(--border2);border-radius:var(--radius);font-size:.85rem;color:var(--text);background:#FFFFFF;font-family:inherit;transition:border-color .15s,box-shadow .15s;outline:none}
    .form-control:focus{border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-soft)}
    .form-control::placeholder{color:var(--text3)}
    textarea.form-control{resize:vertical;min-height:80px}
    .form-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem}
    select.form-control option{background:#FFFFFF;color:#23262C}

    /* ── Badges ── */
    .badge{display:inline-flex;align-items:center;padding:.18rem .55rem;border-radius:99px;font-size:.69rem;font-weight:500}
    .b-green{background:var(--ok-s);color:var(--ok)}
    .b-yellow{background:var(--warn-s);color:var(--warn)}
    .b-red{background:var(--danger-s);color:var(--danger)}
    .b-blue{background:#E8EEFB;color:#2F5BBF}
    .b-purple{background:#F0EBFB;color:#6D4DC0}
    .b-gray{background:#EFF1F4;color:#3F4A5C}
    .b-teal{background:#ECEEF1;color:#3A4150}

    /* ── Modals ── */
    .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px)}
    .modal-overlay.open{display:flex}
    .modal{background:var(--bg2);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.6)}
    .modal-head{padding:1.1rem 1.4rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
    .modal-head h3{font-size:.92rem;font-weight:500}
    .modal-body{padding:1.4rem}
    .modal-foot{padding:.9rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:.6rem}
    .modal-close{background:none;border:none;cursor:pointer;color:var(--text3);font-size:1.2rem;padding:.2rem;transition:color .15s}
    .modal-close:hover{color:var(--text)}

    /* ── Alerts ── */
    .alert{padding:.75rem 1rem;border-radius:var(--radius);margin-bottom:1rem;font-size:.84rem}
    .alert-warn{background:var(--warn-s);color:var(--warn);border:1px solid #EBDDB7}
    .alert-err{background:var(--danger-s);color:var(--danger);border:1px solid #F0CFCC}
    .alert-ok{background:var(--ok-s);color:var(--ok);border:1px solid #CDE8D8}

    /* ── Misc ── */
    .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem}
    .ph h2{font-size:1.05rem;font-weight:500}
    .search{padding:.45rem .75rem;border:1px solid var(--border2);border-radius:var(--radius);font-size:.84rem;background:#FFFFFF;color:var(--text);font-family:inherit;outline:none;min-width:200px;transition:border-color .15s}
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
      .acct-meta{display:none}
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
    <a href="/admin" class="sb-brand" title="Bamburu"><i class="ti ti-sparkles"></i></a>
    <nav class="sb-nav">${navHTML}</nav>
  </aside>
  <div class="wrap">
    <div class="topbar">
      <div class="tb-search"><i class="ti ti-search"></i><span>Buscar cliente, factura, producto…</span></div>
      <div class="tb-bell"><i class="ti ti-bell"></i><span class="dot"></span></div>
      <div class="acct">
        <button class="acct-btn" id="acctBtn" type="button" aria-haspopup="true" aria-expanded="false" onclick="toggleAcct(event)" title="${escName}">
          <span class="acct-avatar">${initial}</span>
        </button>
        <div class="acct-menu" id="acctMenu">${acctMenuHTML}</div>
      </div>
    </div>
    <main class="content">${roBanner}${content}</main>
  </div>
  <script>
    document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.classList.remove('open')});
    function toggleAcct(e){e.stopPropagation();var m=document.getElementById('acctMenu'),b=document.getElementById('acctBtn');var open=m.classList.toggle('open');b.setAttribute('aria-expanded',open?'true':'false');}
    document.addEventListener('click',function(e){var m=document.getElementById('acctMenu');if(m&&m.classList.contains('open')&&!e.target.closest('.acct')){m.classList.remove('open');var b=document.getElementById('acctBtn');if(b)b.setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('acctMenu');if(m&&m.classList.contains('open')){m.classList.remove('open');var b=document.getElementById('acctBtn');if(b)b.setAttribute('aria-expanded','false');}}});
  </script>
  

${hideDisaSidebar ? '' : getDisaWidget()}
  <div id="accessDeniedModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:99999;align-items:center;justify-content:center">
    <div style="background:#FFFFFF;border:1px solid #EDEFF2;border-radius:13px;padding:32px;text-align:center;max-width:380px;box-shadow:0 30px 80px rgba(16,24,40,.18)">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A6453F" stroke-width="2" style="margin-bottom:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <h3 style="color:#23262C;margin:0 0 8px">Acceso no permitido</h3>
      <p style="color:#828B9B;font-size:13px;margin:0 0 20px">No tienes permisos para realizar esta acción.</p>
      <button onclick="document.getElementById('accessDeniedModal').style.display='none'" style="background:#3A4150;border:none;color:#fff;padding:8px 24px;border-radius:9px;cursor:pointer;font-weight:500">Entendido</button>
    </div>
  </div>
</body>
</html>`;
}

// Visor de documentos compartido (DISEÑO §5): documento a la izquierda + panel de datos/
// acciones a la derecha. Se pasa como `content` a adminLayout(). `paper` = el documento
// (solo lectura); `panel` = tarjetas con estado, datos clave y acciones. La impresión/PDF
// (window.print) muestra solo `.docpaper` vía @media print del layout.
export function docShell(paper, panel) {
  return `<div class="docwrap"><div class="docpaper">${paper}</div><aside class="docpanel">${panel || ''}</aside></div>`;
}

// printableShell(bodyHtml, { title }) — HTML STANDALONE del documento imprimible, para:
//   · generar el PDF (core/pdf.js renderPdfFromHtml) y
//   · enviarlo como cuerpo/base de email,
// con la MISMA maquetación que la pantalla. Reutiliza el cuerpo del documento TAL CUAL (el
// `paper` que ya construye cada vista); aquí solo se le da el envoltorio: fuente Inter (web),
// las variables de color y los estilos .docpaper/.doc-* + badge/alert que la factura usa por
// clase (presupuesto/pedido/albarán usan estilos en línea y no dependen de esto, pero quedan
// dentro del mismo lienzo .docpaper). @page A4 para que el PDF cuadre el tamaño.
export function printableShell(bodyHtml, { title = 'Documento' } = {}) {
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<title>${String(title).replace(/</g, '&lt;')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#F5F6F8;--bg2:#FFFFFF;--bg3:#F1F3F5;--border:#ECEEF1;--border2:#E4E6EA;
    --text:#1A1D21;--text2:#6B7280;--text3:#9097A1;--teal:#334155;--radius:9px;
    --danger:#A32D2D;--danger-s:#FEE2E2;--warn:#854F0B;--warn-s:#FAEEDA;--ok:#2E7D55;--ok-s:#E8F5EE;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  @page{size:A4;margin:0}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#fff;color:var(--text);font-size:13px;-webkit-font-smoothing:antialiased}
  .docpaper{max-width:820px;margin:auto;padding:6mm 4mm;color:var(--text);font-size:13px}
  .docpaper h1{font-size:22px;font-weight:500;margin:0 0 4px;color:var(--text)}
  .docpaper .doc-sub{color:var(--text2);font-size:12px;margin-bottom:26px}
  .docpaper .doc-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:26px}
  .docpaper .doc-label{font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:500;letter-spacing:.04em;margin-bottom:4px}
  .docpaper table{width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px}
  .docpaper thead th{background:var(--bg3);padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);font-weight:500;border-bottom:1px solid var(--border)}
  .docpaper tbody td{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text)}
  .docpaper .doc-totals{margin-left:auto;width:300px}
  .docpaper .doc-totals td:first-child{color:var(--text2)}
  .docpaper .doc-totals td:last-child{text-align:right;font-weight:500}
  .docpaper .doc-totals tr.grand td{font-size:15px;border-top:1px solid var(--text);padding-top:10px;color:var(--text)}
  .docpaper .doc-hash{margin-top:26px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--text2);word-break:break-all}
  .badge{display:inline-flex;align-items:center;padding:.18rem .55rem;border-radius:99px;font-size:.69rem;font-weight:500}
  .b-green{background:var(--ok-s);color:var(--ok)}.b-yellow{background:var(--warn-s);color:var(--warn)}
  .b-red{background:var(--danger-s);color:var(--danger)}.b-gray{background:#EFF1F4;color:#3F4A5C}.b-teal{background:#ECEEF1;color:#3A4150}
  .alert{padding:.75rem 1rem;border-radius:var(--radius);margin-bottom:1rem;font-size:.84rem}
  .alert-warn{background:var(--warn-s);color:var(--warn);border:1px solid #EBDDB7}
  .alert-err{background:var(--danger-s);color:var(--danger);border:1px solid #F0CFCC}
  .alert-ok{background:var(--ok-s);color:var(--ok);border:1px solid #CDE8D8}
</style></head>
<body><div class="docpaper">${bodyHtml}</div></body></html>`;
}
