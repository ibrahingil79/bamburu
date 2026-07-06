import { getDisaWidget } from '../disa/widget.js';

export const ROOT_TOKENS = `
    :root{
      /* Tokens EXACTOS de la dirección UX del 2026-07-06 (DISEÑO.md §0-bis + §2).
         FUENTE ÚNICA de color/tipo/espaciado de la app. Cambiar aquí = toda la app.
         SUSTITUCIÓN 1 (chrome claro) y SUSTITUCIÓN 2 (acento azul) aplicadas aquí. */
      --bg:        #F5F6F8;   /* fondo de aplicación (claro) */
      --bg2:       #FFFFFF;   /* superficies / tarjetas / chrome / paneles */
      --bg3:       #F1F3F5;   /* subsuperficie: search, hover, sutil */
      --card:      #FFFFFF;   /* alias de superficie de panel (= --bg2). Lo usan los paneles de
                                 sugerencias del buscador de línea (var(--card,#1e1e1e)); sin definir
                                 caían en el fallback oscuro #1e1e1e → nombre ilegible. */
      --border:    #EEEFF2;   /* separadores (DISEÑO §2.4) */
      --border2:   #E4E6EA;   /* bordes (DISEÑO §2.4) */
      --border-disa: #D6DCE4; /* borde de la tarjeta de DISA (DISEÑO §2.2) */
      --text:      #14161B;   /* texto principal (DISEÑO §2.3) */
      --text2:     #5C616B;   /* texto secundario (DISEÑO §2.3) */
      --text3:     #8A8F99;   /* texto tenue (DISEÑO §2.3) */
      --body-tx:   #3A3F48;   /* texto cuerpo (entre principal y secundario) */
      --accent:    #2F6BFF;   /* AZUL — acción principal y enlaces (DISEÑO §2.2, SUSTITUCIÓN 2) */
      --accent-d:  #2456D6;   /* azul fuerte / hover / activo */
      --accent-soft:#E4EDFF;  /* fondo azul claro: item activo / avisos de DISA / chips */
      /* Acento morado SEMÁNTICO (IRPF/retención + stock reservado). No es acento de marca: es el
         tercer acento de dato que ya usaban documentos e inventario (U1, 2026-07-05). */
      --accent-purple: #9333EA;  --accent-purple-s: #F0EBFB;
      --grp:       #8A8F99;   /* título de grupo de menú (= texto tenue) */
      --muted:     #5C616B;   /* alias heredado (= secundario) */
      --p:         #2F6BFF;   /* alias heredado (= acento azul) */
      /* Alias de compatibilidad: el código heredado usa var(--teal*) → ahora ES el azul de marca */
      --teal:      #2F6BFF;
      --teal-d:    #2456D6;
      --teal-soft: rgba(47,107,255,0.10);
      --teal-glow: rgba(47,107,255,0.20);
      /* Estados — chips (DISEÑO §2.5). fondo (-s) / texto */
      --danger:    #C0392B;  --danger-s:  #FBE3E3;   /* Vencida */
      --warn:      #8A5B00;  --warn-s:    #FBEED0;   /* Pendiente */
      --ok:        #157F3B;  --ok-s:      #E4F6EA;   /* Pagada */
      --info:      #2451C7;  --info-s:    #E4EDFF;   /* Enviada (azul) */
      /* Chrome CLARO (barra superior + menú lateral). Dirección UX 2026-07-06 (SUSTITUCIÓN 1):
         sidebar y superficies claras; el azul es el acento del item activo, no el fondo. */
      --chrome:        #FFFFFF;   /* fondo del chrome (rail + topbar) — BLANCO */
      --chrome-tx:     #5C616B;   /* texto de menú inactivo */
      --chrome-tx-on:  #2F6BFF;   /* texto/icono de menú activo (azul) */
      --chrome-ic:     #8A8F99;   /* icono de menú inactivo */
      --chrome-grp:    #8A8F99;   /* título de grupo de menú */
      --chrome-active: #E4EDFF;   /* fondo del item activo (azul claro) */
      --chrome-div:    #EEEFF2;   /* divisor / borde del chrome */
      --brand:         #2F6BFF;   /* marca (sparkles) — azul */
      --sw:        62px;
      --sw-exp:    176px;
      --radius:    9px;
      --radius-lg: 12px;
      /* ── Escala de ESPACIADO (U1). Fuente única; valores calcados de los ya usados para que
         aplicarla sea 1:1 (no recoloca nada). El espaciado inline estructural por-vista se
         conserva mientras no haya un paso equivalente. ── */
      --space-1:  .25rem;   /* 4px  */
      --space-2:  .5rem;    /* 8px  */
      --space-3:  .75rem;   /* 12px */
      --space-4:  1rem;     /* 16px */
      --space-5:  1.25rem;  /* 20px */
      --space-6:  1.5rem;   /* 24px */
      /* ── Escala de TIPOGRAFÍA (U1). Inter en body; tamaños/pesos calcados de los usados. ── */
      --fs-xs:    .72rem;   --fs-sm:  .82rem;   --fs-md:  .88rem;
      --fs-base:  14px;     --fs-lg:  1.05rem;  --fs-xl:  1.7rem;
      --fw-normal: 400;     --fw-medium: 500;   --fw-semibold: 600;
    }`;


export function csrfField(token) {
  return `<input type="hidden" name="_csrf" value="${token}">`;
}

// Banda de DISA (DISEÑO §6) para vistas SERVER-rendered: aviso calmado con tinte azul y UN solo
// enlace de acción. `text` debe venir ya escapado por quien llama. Espejo de window.disaBand.
export function disaBand(text, href = '', cta = 'Revisar') {
  return `<div class="disa-band"><span class="db-ic"><i class="ti ti-sparkles"></i></span>`
    + `<span class="db-tx">${text}</span>`
    + (href ? `<a class="db-cta" href="${href}">${cta} →</a>` : '')
    + `</div>`;
}

// Menú "···" (DISEÑO §6) para vistas SERVER-rendered: acciones secundarias de una fila.
// items = [{label, href?, onclick?, danger?, target?}]. Espejo de window.rowMenu.
export function rowMenu(items = []) {
  const body = items.map(it => {
    const cls = 'rmenu-item' + (it.danger ? ' danger' : '');
    if (it.href) return `<a href="${it.href}" class="${cls}"${it.target ? ` target="${it.target}"` : ''}>${it.label}</a>`;
    return `<button type="button" class="${cls}" onclick="closeRowMenus();${it.onclick || ''}">${it.label}</button>`;
  }).join('');
  return `<span class="rmenu"><button type="button" class="rmenu-btn" onclick="toggleRowMenu(this)" aria-label="Más acciones" title="Más acciones">⋯</button><div class="rmenu-pop">${body}</div></span>`;
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
    recurrentes:      'recurrentes.read',
    'verifactu-envio': 'invoices.read',
    conciliacion:     'conciliacion.read',
    cobros:           'invoices.read',
    portal:           'invoices.read',
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

  // ── MENÚ LEAN de UNA sola capa (DISEÑO.md §3, dirección UX 2026-07-06) ──────────────
  // EXACTAMENTE 5 entradas, sin sub-enlaces ni grupos: Inicio · Facturas · Gastos · Clientes ·
  // Contabilidad. Todo lo demás (Presupuestos, Recurrentes, TPV, Compras, Proveedores,
  // Inventario, Catálogo, Pedidos, Cobros, Conciliación, Verifactu-envío…) DEJA de estar en el
  // menú y queda accesible SOLO por URL — las rutas siguen montadas, no se borra nada.
  //   · Presupuestos/Recurrentes viven dentro de Facturas · Conciliación dentro de Gastos/cobros
  //     y la empuja DISA · Impuestos/modelos/libros/P&G dentro de Contabilidad · Analítica no es
  //     menú: la responde DISA desde Inicio (§3.2).
  // "Gastos" → /admin/supplier-invoices (Facturas recibidas = el libro de "Compras y gastos").
  //   Es el destino más representativo del gasto hoy; si el dueño prefiere Compra directa
  //   (/admin/purchases), es un solo cambio de href aquí.
  // DISA NO es entrada del menú: ES la home (Inicio = /admin), §4.
  const nav = [
    { section: 'principal', bare: true, items: [
      { href: '/admin', label: 'Inicio', key: 'dashboard', icon: 'ti-home' },
      { href: '/admin/invoices', label: 'Facturas', key: 'invoices', icon: 'ti-file-invoice' },
      { href: '/admin/supplier-invoices', label: 'Gastos', key: 'supplier-invoices', icon: 'ti-receipt' },
      { href: '/admin/clients', label: 'Clientes', key: 'clients', icon: 'ti-users' },
      { href: '/admin/contabilidad', label: 'Contabilidad', key: 'contabilidad', icon: 'ti-book' },
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
  <!-- Tipografía DEL SISTEMA (DISEÑO §2.6): sin fuentes cargadas de internet. -->
  <!-- Iconos Tabler AUTO-HOSPEDADOS (DISEÑO §2.7 — prohibido depender de iconos de internet).
       CSS + webfont servidos desde /public/vendor/tabler (self-host); cero llamadas a CDN. -->
  <link rel="stylesheet" href="/public/vendor/tabler/tabler-icons.min.css">
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
      const styles={ok:'background:#E4F6EA;border:1px solid #CDE8D8;color:#157F3B',err:'background:#FBE3E3;border:1px solid #F0CFCC;color:#C0392B',warn:'background:#FBEED0;border:1px solid #EBDDB7;color:#8A5B00'};
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
    // ── Patrón por pantalla (DISEÑO §6) — helpers compartidos ──
    // Banda de DISA: aviso calmado con UN enlace de acción ("Revisar →"). text ya viene escapado.
    window.disaBand=function(text,href,cta){
      return '<div class="disa-band"><span class="db-ic"><i class="ti ti-sparkles"></i></span>'
        +'<span class="db-tx">'+text+'</span>'
        +(href?'<a class="db-cta" href="'+href+'">'+(cta||'Revisar')+' →</a>':'')+'</div>';
    };
    // Menú "···": acciones secundarias de una fila. items=[{label, href?, onclick?, danger?, target?}].
    window.rowMenu=function(items){
      var body=(items||[]).map(function(it){
        var cls='rmenu-item'+(it.danger?' danger':'');
        if(it.href) return '<a href="'+it.href+'" class="'+cls+'"'+(it.target?' target="'+it.target+'"':'')+'>'+it.label+'</a>';
        return '<button type="button" class="'+cls+'" onclick="closeRowMenus();'+(it.onclick||'')+'">'+it.label+'</button>';
      }).join('');
      return '<span class="rmenu"><button type="button" class="rmenu-btn" onclick="toggleRowMenu(this)" aria-label="Más acciones" title="Más acciones">⋯</button><div class="rmenu-pop">'+body+'</div></span>';
    };
    window.closeRowMenus=function(){document.querySelectorAll('.rmenu-pop.open').forEach(function(p){p.classList.remove('open');});};
    window.toggleRowMenu=function(btn){
      var pop=btn.nextElementSibling, isOpen=pop.classList.contains('open');
      window.closeRowMenus();
      if(isOpen) return;
      var r=btn.getBoundingClientRect();
      pop.classList.add('open');
      var pw=pop.offsetWidth;
      pop.style.top=(r.bottom+4)+'px';
      pop.style.left=Math.max(8,r.right-pw)+'px';
    };
    document.addEventListener('click',function(e){if(!e.target.closest('.rmenu'))window.closeRowMenus();});
    window.addEventListener('scroll',function(){window.closeRowMenus();},true);
    document.addEventListener('keydown',function(e){if(e.key==='Escape')window.closeRowMenus();});
  </script>
  <style>
${ROOT_TOKENS}

    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;min-height:100vh;font-size:14px;-webkit-font-smoothing:antialiased}

    /* ── Sidebar CLARO (dirección UX 2026-07-06): colapsable a iconos · se despliega al hover ── */
    .sidebar{width:var(--sw);background:var(--chrome);border-right:1px solid var(--chrome-div);position:fixed;top:0;left:0;height:100vh;overflow-x:hidden;overflow-y:auto;z-index:100;display:flex;flex-direction:column;transition:width .18s ease}
    .sidebar:hover{width:var(--sw-exp);box-shadow:6px 0 24px rgba(16,24,40,.18)}
    .sidebar::-webkit-scrollbar{width:6px}
    .sidebar::-webkit-scrollbar-thumb{background:rgba(0,0,0,.12);border-radius:6px}
    .sb-brand{display:flex;align-items:center;justify-content:center;height:50px;flex-shrink:0;color:var(--brand);font-size:21px;line-height:1}
    .sidebar:hover .sb-brand{justify-content:flex-start;padding-left:1.05rem}
    .sb-nav{flex:1;padding:.4rem .55rem .6rem;overflow-y:auto;overflow-x:hidden}
    .nav-section{margin-bottom:.1rem}
    .nav-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--chrome-grp);padding:.7rem .55rem .3rem;white-space:nowrap;opacity:0;transition:opacity .15s}
    .sidebar:hover .nav-title{opacity:1}
    .nav-item{display:flex;align-items:center;justify-content:center;gap:0;padding:.5rem .57rem;margin:1px 0;border-radius:9px;color:var(--chrome-tx);text-decoration:none;font-size:13px;font-weight:400;white-space:nowrap;transition:background .15s,color .15s}
    .sidebar:hover .nav-item{justify-content:flex-start;gap:9px}
    .nav-item:hover{background:var(--bg3);color:var(--chrome-tx-on)}
    .nav-item.active{background:var(--chrome-active);color:var(--chrome-tx-on);font-weight:500}
    .nav-item i.ti,.nav-item svg{flex-shrink:0;width:18px;height:18px;font-size:18px;line-height:1;color:var(--chrome-ic)}
    .nav-item:hover i.ti,.nav-item:hover svg,.nav-item.active i.ti,.nav-item.active svg{color:var(--chrome-tx-on)}
    .nav-item>span{width:0;opacity:0;overflow:hidden;transition:opacity .15s}
    .sidebar:hover .nav-item>span{width:auto;opacity:1}
    .nav-item-disabled{color:var(--chrome-ic);cursor:default;opacity:.5}
    .nav-item-disabled:hover{background:none;color:var(--chrome-ic)}
    .nav-pending{margin-left:auto;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);border:.5px solid var(--border2);border-radius:7px;padding:1px 5px}

    /* ── Topbar CLARO (dirección UX 2026-07-06): buscador · campana · avatar ── */
    .wrap{margin-left:var(--sw);flex:1;display:flex;flex-direction:column;min-height:100vh}
    .topbar{background:var(--chrome);border-bottom:1px solid var(--chrome-div);padding:.6rem 1.1rem;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:50}
    .tb-search{flex:1;max-width:430px;display:flex;align-items:center;gap:8px;background:var(--bg3);border:.5px solid var(--border2);border-radius:9px;padding:7px 12px;color:var(--text3);font-size:13px;cursor:text}
    .tb-search i.ti{font-size:16px}
    .tb-search:focus-within{border-color:var(--accent);background:#fff}
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
    .b-blue{background:#E4EDFF;color:#2451C7}
    .b-purple{background:#F0EBFB;color:#6D4DC0}
    .b-gray{background:#ECEDF0;color:#565A62}
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
    .alert-info{background:var(--info-s);color:var(--info);border:1px solid #BAE6FD}

    /* ── Patrón por pantalla (DISEÑO §6) ─────────────────────────────────────────────
       Banda de DISA: aviso CALMADO con tinte azul claro y UN solo enlace de acción
       (nunca un grupo de botones). Menú "···": recoge las acciones secundarias de fila. */
    .disa-band{display:flex;align-items:center;gap:12px;background:var(--accent-soft);border:1px solid #CFE0FF;border-radius:var(--radius-lg);padding:11px 15px;margin-bottom:1.25rem;font-size:.86rem;color:var(--text)}
    .disa-band .db-ic{color:var(--accent);font-size:18px;flex-shrink:0;display:flex;line-height:1}
    .disa-band .db-tx{flex:1;min-width:0}
    .disa-band .db-cta{color:var(--accent);font-weight:600;text-decoration:none;white-space:nowrap;font-size:.85rem;flex-shrink:0}
    .disa-band .db-cta:hover{text-decoration:underline}
    .rmenu{position:relative;display:inline-block}
    .rmenu-btn{background:none;border:1px solid var(--border2);border-radius:8px;cursor:pointer;color:var(--text2);font-size:1rem;line-height:1;padding:.2rem .5rem;font-family:inherit;transition:background .12s,border-color .12s}
    .rmenu-btn:hover{background:var(--bg3);border-color:var(--text3);color:var(--text)}
    .rmenu-pop{position:fixed;min-width:172px;background:#fff;border:1px solid var(--border2);border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.12);padding:6px;display:none;z-index:300}
    .rmenu-pop.open{display:block}
    .rmenu-item{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;font-size:.82rem;color:var(--body-tx);text-decoration:none;cursor:pointer;white-space:nowrap;background:none;border:none;width:100%;text-align:left;font-family:inherit}
    .rmenu-item:hover{background:var(--bg3)}
    .rmenu-item.danger{color:var(--danger)}
    .rmenu-item.danger:hover{background:var(--danger-s)}

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
// `paper` que ya construye cada vista); aquí solo se le da el envoltorio: fuente del sistema,
// las variables de color y los estilos .docpaper/.doc-* + badge/alert que la factura usa por
// clase (presupuesto/pedido/albarán usan estilos en línea y no dependen de esto, pero quedan
// dentro del mismo lienzo .docpaper). @page A4 para que el PDF cuadre el tamaño.
export function printableShell(bodyHtml, { title = 'Documento' } = {}) {
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<title>${String(title).replace(/</g, '&lt;')}</title>
<style>
  /* Tipografía DEL SISTEMA (DISEÑO §2.6): sin fuentes cargadas de internet. */
  :root{
    --bg:#F5F6F8;--bg2:#FFFFFF;--bg3:#F1F3F5;--border:#EEEFF2;--border2:#E4E6EA;
    --text:#14161B;--text2:#5C616B;--text3:#8A8F99;--teal:#2F6BFF;--radius:9px;
    --danger:#C0392B;--danger-s:#FBE3E3;--warn:#8A5B00;--warn-s:#FBEED0;--ok:#157F3B;--ok-s:#E4F6EA;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  @page{size:A4;margin:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;background:#fff;color:var(--text);font-size:13px;-webkit-font-smoothing:antialiased}
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
