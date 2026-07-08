import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { companySchema, storeSettingsSchema } from '../schemas.js';
import { getCountryConfig } from '../../../core/control-db.js';

export function createSettingsRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();
  const storeViews = new Hono();

  // ── API: COMPANY ───────────────────────────────────────────────
  api.get('/company', requirePerm('company.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM company_config WHERE id=1').get()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/company', requirePerm('company.update'), validate(companySchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE company_config SET company_name=?,fiscal_id=?,tax_rate=?,logo_url=?,address=?,phone=?,email=?,website=?,country=?,currency=?,currency_symbol=?,tax_name=?,fiscal_id_label=?,document_name=?,irpf_default=? WHERE id=1').run(d.company_name||'', d.fiscal_id||'', parseFloat(d.tax_rate)||0, d.logo_url||'', d.address||'', d.phone||'', d.email||'', d.website||'', d.country||'ES', d.currency||'EUR', d.currency_symbol||sym, d.tax_name||'IVA', d.fiscal_id_label||'NIF/CIF', d.document_name||'Factura', parseFloat(d.irpf_default)||0);
      return c.json({message:'Guardado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: STORE — D2: editor "Tienda Online" DESMONTADO. Endpoints neutralizados (404).
  // store_settings SE CONSERVA (NO se archiva): el diseño se guarda por si la tienda vuelve (Capa 2).
  // El cuerpo original queda inalcanzable debajo (return temprano), no se borra.
  api.get('/store', requirePerm('store_settings.read'), c => {
    return c.json({ error: 'Editor de tienda desmontado (D2)' }, 404);
    try { return c.json(db.prepare('SELECT * FROM store_settings WHERE id=1').get()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/store', requirePerm('store_settings.update'), validate(storeSettingsSchema), async c => {
    return c.json({ error: 'Editor de tienda desmontado (D2)' }, 404);
    try {
      const d = c.get('validated');
      db.prepare('UPDATE store_settings SET store_name=?,tagline=?,logo_url=?,banner_url=?,primary_color=?,announcement=?,facebook_url=?,instagram_url=?,twitter_url=?,terms_html=?,privacy_html=?,returns_html=?,seo_title=?,seo_description=?,theme=?,homepage_sections=? WHERE id=1').run(d.store_name||'', d.tagline||'', d.logo_url||'', d.banner_url||'', d.primary_color||'#10b981', d.announcement||'', d.facebook_url||'', d.instagram_url||'', d.twitter_url||'', d.terms_html||'', d.privacy_html||'', d.returns_html||'', d.seo_title||'', d.seo_description||'', d.theme||'minimal_light', d.homepage_sections||null);
      return c.json({message:'Guardado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── VIEW: COMPANY SETTINGS ─────────────────────────────────────
  // Aquí abajo vivía una tarjeta "Seguridad de tu cuenta" que enlazaba /admin/setup-2fa.
  // Retirada: el 2FA es seguridad PERSONAL del usuario, no configuración de la EMPRESA, y estaba
  // duplicado con /admin/security. Su único sitio es ahora /admin/perfil.
  views.get('/', requirePerm('company.read'), c => {
    const config = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const sym = config.currency_symbol || '€';
    const countryInfo = getCountryConfig(config.country || 'ES');
    const countryName = countryInfo ? countryInfo.name : (config.country || 'España');
    const content = `
      <div class="ph"><h2>Configuración Empresa</h2></div>
      <div class="card" style="max-width:700px">
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nombre de la empresa</label><input class="form-control" id="cName"></div>
            <div class="form-group"><label class="form-label">NIF / ID Fiscal</label><input class="form-control" id="cFiscal"></div>
          </div>
          <div class="form-group">
            <label class="form-label">País</label>
            <input type="text" class="form-control" value="${countryName}" disabled style="background:var(--bg3);color:var(--text2);cursor:not-allowed">
            <input type="hidden" id="countryCode" value="${config.country || 'ES'}">
            <small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">El país se configura al crear el negocio y no puede cambiarse.</small>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Moneda (código)</label><input class="form-control" id="currencyCode"></div>
            <div class="form-group"><label class="form-label">Símbolo de moneda</label><input class="form-control" id="currencySymbol" style="max-width:120px"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nombre del impuesto</label><input class="form-control" id="taxName"></div>
            <div class="form-group"><label class="form-label">Etiqueta ID fiscal</label><input class="form-control" id="fiscalIdLabel"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nombre documento fiscal</label><input class="form-control" id="documentName"></div>
            <div class="form-group"><label class="form-label">Impuesto por defecto (%)</label><input class="form-control" type="number" id="cTax" min="0" max="100" step="0.1"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Retención de IRPF por defecto (%)</label><input class="form-control" type="number" id="cIrpfDefault" min="0" max="100" step="0.1"><small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">Es tu retención como autónomo. Precarga la factura: clientes empresa/profesional la aplican; particulares, no. Puedes cambiarla en cada factura.</small></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" id="cEmail"></div>
            <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="cPhone"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Web</label><input class="form-control" id="cWeb"></div>
          </div>
          <div class="form-group"><label class="form-label">Dirección fiscal</label><input class="form-control" id="cAddr"></div>
          <div class="form-group"><label class="form-label">URL Logo empresa</label><input class="form-control" id="cLogo"></div>
          <button class="btn btn-primary" onclick="saveCompany()">Guardar cambios</button>
        </div>
      </div>


      <script>
      api('GET','/api/erp/settings/company').then(d=>{
        document.getElementById('cName').value=d.company_name||'';
        document.getElementById('cFiscal').value=d.fiscal_id||'';
        document.getElementById('currencyCode').value=d.currency||'EUR';
        document.getElementById('currencySymbol').value=d.currency_symbol||'${sym}';
        document.getElementById('taxName').value=d.tax_name||'IVA';
        document.getElementById('fiscalIdLabel').value=d.fiscal_id_label||'NIF/CIF';
        document.getElementById('documentName').value=d.document_name||'Factura';
        document.getElementById('cTax').value=d.tax_rate||21;
        document.getElementById('cIrpfDefault').value=d.irpf_default||0;
        document.getElementById('cEmail').value=d.email||'';
        document.getElementById('cPhone').value=d.phone||'';
        document.getElementById('cWeb').value=d.website||'';
        document.getElementById('cAddr').value=d.address||'';
        document.getElementById('cLogo').value=d.logo_url||'';
      });
      async function saveCompany(){
        try{await api('PUT','/api/erp/settings/company',{company_name:document.getElementById('cName').value,fiscal_id:document.getElementById('cFiscal').value,country:document.getElementById('countryCode').value,currency:document.getElementById('currencyCode').value,currency_symbol:document.getElementById('currencySymbol').value,tax_name:document.getElementById('taxName').value,fiscal_id_label:document.getElementById('fiscalIdLabel').value,document_name:document.getElementById('documentName').value,tax_rate:document.getElementById('cTax').value,irpf_default:document.getElementById('cIrpfDefault').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,website:document.getElementById('cWeb').value,address:document.getElementById('cAddr').value,logo_url:document.getElementById('cLogo').value});toast('Guardado ✓');}catch(e){toast(e.message,'err')}
      }
      </script>`;
    return c.html(adminLayout('Configuración Empresa', content, 'settings', c.get('session')?.csrfToken || '', c));
  });

  storeViews.get('/', requirePerm('store_settings.read'), c => {
    const csrfToken = c.get('session')?.csrfToken || '';
    const hasCustom = !!db.prepare('SELECT homepage_sections FROM store_settings WHERE id=1').get()?.homepage_sections;
    const content = `
<style>
.sb-page{display:flex;flex-direction:column;height:calc(100vh - 52px);margin:-1.5rem;overflow:hidden}
.sb-topbar{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0}
.sb-name-input{background:none;border:none;border-bottom:1px solid var(--border);color:var(--text);font-size:15px;font-weight:500;padding:3px 6px;outline:none;width:210px;font-family:inherit}
.sb-name-input:focus{border-bottom-color:var(--teal)}
.sb-topbar-r{margin-left:auto;display:flex;align-items:center;gap:8px}
.sb-view-btn{background:none;border:1px solid var(--border);color:var(--text2);padding:6px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;font-family:inherit;transition:all .15s}
.sb-view-btn:hover{border-color:var(--border2);color:var(--text)}
.sb-publish-btn{background:var(--teal);color:var(--bg2);border:none;padding:7px 20px;border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:opacity .15s}
.sb-publish-btn:hover{opacity:.85}
.sb-body{display:flex;flex:1;overflow:hidden}
.sb-left{width:400px;min-width:380px;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--bg2);overflow:hidden}
.sb-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.sb-tab{flex:1;padding:10px 4px;font-size:11px;font-weight:500;color:var(--text3);border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;font-family:inherit;transition:all .15s}
.sb-tab.active{color:var(--teal);border-bottom-color:var(--teal)}
.sb-tab:hover:not(.active){color:var(--text2)}
.sb-panel{flex:1;overflow-y:auto;display:none;flex-direction:column;min-height:0}
.sb-panel.active{display:flex}
.sb-right{flex:1;display:flex;flex-direction:column;background:var(--bg2)}
.sb-preview-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--bg3);flex-shrink:0}
.sb-dev-btns{display:flex;gap:3px}
.sb-dev-btn{display:flex;align-items:center;gap:4px;background:none;border:1px solid transparent;color:var(--text3);padding:4px 10px;border-radius:5px;font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s}
.sb-dev-btn.active{background:rgba(58,65,80,.12);border-color:var(--teal);color:var(--teal)}
.sb-iframe-wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:12px}
#sbIframe{border:none;background:var(--bg2);box-shadow:0 8px 40px rgba(0,0,0,.5);transition:all .3s}
#sbIframe.desktop{width:100%;height:100%;border-radius:3px}
#sbIframe.mobile{width:375px;height:667px;border:10px solid var(--bg3);border-radius:32px}
/* DISA chat */
.sb-chat-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0}
.sb-bubble{max-width:85%;padding:9px 13px;border-radius:12px;font-size:13px;line-height:1.55;word-break:break-word}
.sb-bubble.user{background:linear-gradient(135deg,var(--accent),var(--accent-d));color:var(--bg2);align-self:flex-end;border-radius:12px 12px 3px 12px}
.sb-bubble.assistant{background:var(--bg2);border:1px solid var(--border);color:var(--text);align-self:flex-start;border-radius:12px 12px 12px 3px}
.sb-style-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-self:flex-start}
.sb-style-chip{background:rgba(58,65,80,0.1);border:1px solid rgba(58,65,80,0.3);color:var(--accent);padding:5px 14px;border-radius:20px;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s}
.sb-style-chip:hover{background:rgba(58,65,80,.22)}
.sb-chat-foot{flex-shrink:0;padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:7px}
#sbChatIn{flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px;font-family:inherit;outline:none;height:36px}
#sbChatIn:focus{border-color:var(--teal)}
.sb-send-btn{width:36px;height:36px;background:var(--teal);border:none;border-radius:8px;color:var(--bg2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sb-typing{display:flex;gap:4px;padding:6px 4px;align-self:flex-start}
.sb-typing span{width:6px;height:6px;border-radius:50%;background:var(--text2);animation:sbdot 1.2s infinite}
.sb-typing span:nth-child(2){animation-delay:.2s}
.sb-typing span:nth-child(3){animation-delay:.4s}
@keyframes sbdot{0%,60%,100%{opacity:.25;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}
/* Templates */
.sb-tpl-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px}
.sb-tpl-card{background:var(--bg3);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;transition:all .15s;position:relative}
.sb-tpl-card:hover{border-color:var(--teal);background:rgba(58,65,80,.04)}
.sb-tpl-card.active{border-color:var(--teal);box-shadow:0 0 0 1px var(--teal)}
.sb-tpl-badge{position:absolute;top:7px;right:7px;background:var(--teal);color:var(--bg2);font-size:9px;font-weight:500;padding:2px 6px;border-radius:8px}
.sb-tpl-mock{width:100%;height:80px;overflow:hidden}
.sb-tpl-info{padding:7px 9px}
.sb-tpl-name{font-size:12px;font-weight:500;color:var(--text);margin-bottom:1px}
.sb-tpl-desc{font-size:10px;color:var(--text3)}
/* Blocks */
.sb-blk-wrap{display:flex;flex-direction:column;flex:1;overflow:hidden}
.sb-blk-lib{padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.sb-blk-label{font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:7px}
.sb-blk-chips{display:flex;flex-wrap:wrap;gap:5px}
.sb-blk-chip{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--text2);cursor:pointer;font-family:inherit;transition:all .15s}
.sb-blk-chip:hover{background:rgba(58,65,80,.1);border-color:rgba(58,65,80,.3);color:var(--teal)}
.sb-sec-list-wrap{flex:1;overflow-y:auto;padding:8px 10px;min-height:0}
.sb-sec-row{display:flex;align-items:center;gap:7px;padding:7px 9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;margin-bottom:4px;cursor:default;transition:all .15s;user-select:none}
.sb-sec-row:hover{background:var(--border);border-color:var(--border2)}
.sb-sec-row.selected{border-color:var(--teal);background:rgba(58,65,80,.08)}
.sb-handle{cursor:grab;color:var(--text3);font-size:15px;line-height:1;padding:0 1px}
.sb-sec-label{flex:1;font-size:12px;font-weight:500;color:var(--text2)}
.sb-sec-btns{display:flex;gap:2px}
.sb-sec-btn{background:none;border:none;cursor:pointer;padding:3px 4px;border-radius:4px;color:var(--text3);font-size:12px;font-family:inherit;transition:color .12s;line-height:1}
.sb-sec-btn.edit:hover{color:var(--teal)}
.sb-sec-btn.del:hover{color:var(--danger)}
.sb-editor-wrap{flex-shrink:0;max-height:260px;overflow-y:auto;border-top:1px solid var(--border);padding:10px 12px}
.sb-editor-empty{color:var(--text3);font-size:12px;text-align:center;padding:18px 0}
/* pulse dot */
.sb-live-dot{width:7px;height:7px;border-radius:50%;background:var(--teal);display:inline-block;animation:sbdot 2s infinite}
</style>

<div class="sb-page">
<div class="sb-topbar">
  <span style="font-size:16px">🏪</span>
  <input id="sbStoreName" class="sb-name-input" placeholder="Nombre de tu tienda" oninput="sbState.settings.store_name=this.value">
  <div class="sb-topbar-r">
    <!-- D1 — tienda pública apagada: enlace neutralizado (/store da 404). El resto del constructor es D2. -->
    <span class="sb-view-btn" style="opacity:.5;cursor:not-allowed" title="La tienda pública está desactivada (D1)">Tienda desactivada</span>
    <button class="sb-publish-btn" onclick="sbPublish()">Publicar cambios</button>
  </div>
</div>
<div class="sb-body">
  <!-- LEFT -->
  <div class="sb-left">
    <div class="sb-tabs">
      <button class="sb-tab active" onclick="sbTab('disa',this)">✦ DISA construye</button>
      <button class="sb-tab" onclick="sbTab('templates',this)">Plantillas</button>
      <button class="sb-tab" onclick="sbTab('blocks',this)">Constructor</button>
    </div>

    <!-- TAB 1: DISA -->
    <div class="sb-panel active" id="sbp-disa">
      <div class="sb-chat-msgs" id="sbMsgs"></div>
      <div class="sb-chat-foot">
        <input id="sbChatIn" placeholder="Pídele algo a DISA..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sbSend()}">
        <button class="sb-send-btn" onclick="sbSend()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>

    <!-- TAB 2: TEMPLATES -->
    <div class="sb-panel" id="sbp-templates">
      <div class="sb-tpl-grid" id="sbTplGrid"></div>
    </div>

    <!-- TAB 3: BLOCKS -->
    <div class="sb-panel" id="sbp-blocks">
      <div class="sb-blk-wrap">
        <div class="sb-blk-lib">
          <div class="sb-blk-label">Librería — click para añadir</div>
          <div class="sb-blk-chips">
            <button class="sb-blk-chip" onclick="sbAddSec('hero')">👋 Hero</button>
            <button class="sb-blk-chip" onclick="sbAddSec('featured_products')">📦 Productos</button>
            <button class="sb-blk-chip" onclick="sbAddSec('features')">⭐ Features</button>
            <button class="sb-blk-chip" onclick="sbAddSec('testimonials')">💬 Testimonios</button>
            <button class="sb-blk-chip" onclick="sbAddSec('newsletter')">✉️ Newsletter</button>
          </div>
        </div>
        <div class="sb-blk-label" style="padding:8px 12px 2px;margin-bottom:0">Secciones activas</div>
        <div class="sb-sec-list-wrap" id="sbSecList"></div>
        <div class="sb-editor-wrap" id="sbEditor"><div class="sb-editor-empty">Selecciona una sección para editarla</div></div>
      </div>
    </div>
  </div>

  <!-- RIGHT: PREVIEW -->
  <div class="sb-right">
    <div class="sb-preview-bar">
      <span style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:6px">
        <span class="sb-live-dot"></span>Vista previa
      </span>
      <div class="sb-dev-btns">
        <button class="sb-dev-btn active" onclick="sbDev('desktop',this)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>Escritorio
        </button>
        <button class="sb-dev-btn" onclick="sbDev('mobile',this)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>Móvil
        </button>
      </div>
    </div>
    <div class="sb-iframe-wrap">
      <iframe id="sbIframe" class="desktop"></iframe>
    </div>
  </div>
</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>
<script>
const CSRF = ${JSON.stringify(csrfToken)};
const HAS_CUSTOM = ${hasCustom ? 'true' : 'false'};

const SEC_META = {
  hero:{ label:'Hero / Banner', icon:'👋' },
  featured_products:{ label:'Productos Destacados', icon:'📦' },
  features:{ label:'Features', icon:'⭐' },
  testimonials:{ label:'Testimonios', icon:'💬' },
  newsletter:{ label:'Newsletter', icon:'✉️' }
};

const DEF_SECS = [
  {id:'hero',type:'hero',active:true,settings:{title:'Calidad en cada detalle',subtitle:'Descubre nuestra colección exclusiva.',btn_text:'Ver catálogo',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
  {id:'fp',type:'featured_products',active:true,settings:{title:'Productos Destacados',subtitle:'Nuestra selección especial',limit:8}},
  {id:'feat',type:'features',active:true,settings:{title:'Por qué elegirnos',subtitle:'',items:[{icon:'🚚',title:'Envío Express',desc:'24/48h con seguimiento.'},{icon:'🛡️',title:'Pago Seguro',desc:'SSL de nivel bancario.'},{icon:'🔄',title:'Devoluciones',desc:'30 días garantizados.'}]}},
  {id:'testi',type:'testimonials',active:true,settings:{title:'Clientes Satisfechos',subtitle:'',items:[{name:'Sofía M.',rating:5,comment:'¡Superó mis expectativas!'},{name:'Alejandro S.',rating:5,comment:'Envío rapidísimo.'},{name:'Laura B.',rating:4,comment:'Calidad premium.'}]}},
  {id:'nl',type:'newsletter',active:true,settings:{title:'Únete a nuestro Club',subtitle:'10% de descuento en tu primera compra.',btn_text:'Suscribirme'}}
];

const TMPLS = [
  {id:'minimal_light',name:'Minimal Light',desc:'Limpio, escandinavo',theme:'minimal_light',color:'#10b981',pop:true,
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="var(--bg)"/><rect width="200" height="18" fill="#fff"/><rect x="8" y="5" width="36" height="8" rx="2" fill="#0f172a"/><rect x="155" y="5" width="36" height="8" rx="3" fill="#10b981"/><rect x="40" y="26" width="120" height="10" rx="2" fill="#0f172a"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#94a3b8"/><rect x="70" y="50" width="60" height="9" rx="4" fill="#10b981"/><rect x="8" y="66" width="56" height="10" rx="3" fill="#f1f5f9"/><rect x="72" y="66" width="56" height="10" rx="3" fill="#f1f5f9"/><rect x="136" y="66" width="56" height="10" rx="3" fill="#f1f5f9"/></svg>'},
  {id:'minimal_dark',name:'Minimal Dark',desc:'Oscuro, elegante, premium',theme:'minimal_dark',color:'#10b981',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#0f172a"/><rect width="200" height="18" fill="#1e293b"/><rect x="8" y="5" width="36" height="8" rx="2" fill="var(--bg)"/><rect x="155" y="5" width="36" height="8" rx="3" fill="#10b981"/><rect x="40" y="26" width="120" height="10" rx="2" fill="var(--bg)"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#475569"/><rect x="70" y="50" width="60" height="9" rx="4" fill="#10b981"/><rect x="8" y="66" width="56" height="10" rx="3" fill="#1e293b"/><rect x="72" y="66" width="56" height="10" rx="3" fill="#1e293b"/><rect x="136" y="66" width="56" height="10" rx="3" fill="#1e293b"/></svg>'},
  {id:'nordic_forest',name:'Nordic Forest',desc:'Natural, orgánico',theme:'nordic_forest',color:'#1b4d3e',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#f4f3ef"/><rect width="200" height="18" fill="#f4f3ef" stroke="#d4cfc4" stroke-width="1"/><rect x="8" y="5" width="36" height="8" rx="1" fill="#1c2e24"/><rect x="155" y="5" width="36" height="8" rx="1" fill="#1b4d3e"/><rect x="40" y="26" width="120" height="10" rx="1" fill="#1c2e24"/><rect x="55" y="40" width="90" height="5" rx="0" fill="#6b7280"/><rect x="70" y="50" width="60" height="9" rx="1" fill="#1b4d3e"/><rect x="8" y="66" width="56" height="10" rx="1" fill="#e8e6e0"/><rect x="72" y="66" width="56" height="10" rx="1" fill="#e8e6e0"/><rect x="136" y="66" width="56" height="10" rx="1" fill="#e8e6e0"/></svg>'},
  {id:'bold_tech',name:'Bold Tech',desc:'Brutalismo digital',theme:'bold_tech',color:'#000000',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#fff"/><rect width="200" height="18" fill="#fff" stroke="#000" stroke-width="2"/><rect x="8" y="5" width="36" height="8" fill="#000"/><rect x="155" y="5" width="36" height="8" fill="#ffff00" stroke="#000" stroke-width="1"/><rect x="40" y="26" width="120" height="12" fill="#000"/><rect x="70" y="50" width="60" height="10" fill="#ffff00" stroke="#000" stroke-width="2"/><rect x="8" y="66" width="56" height="10" fill="#fff" stroke="#000" stroke-width="2"/><rect x="72" y="66" width="56" height="10" fill="#fff" stroke="#000" stroke-width="2"/><rect x="136" y="66" width="56" height="10" fill="#fff" stroke="#000" stroke-width="2"/></svg>'},
  {id:'vintage_warm',name:'Vintage Warm',desc:'Retro, artesanal, cálido',theme:'vintage_warm',color:'#c84b31',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#faf6f0"/><rect width="200" height="18" fill="#faf6f0" stroke="#e8d5b7" stroke-width="1"/><rect x="8" y="5" width="36" height="8" rx="1" fill="#5c3d2e"/><rect x="155" y="5" width="36" height="8" rx="2" fill="#c84b31"/><rect x="40" y="26" width="120" height="10" rx="1" fill="#5c3d2e"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#9e8060"/><rect x="70" y="50" width="60" height="9" rx="2" fill="#c84b31"/><rect x="8" y="66" width="56" height="10" rx="2" fill="#f0e8d8"/><rect x="72" y="66" width="56" height="10" rx="2" fill="#f0e8d8"/><rect x="136" y="66" width="56" height="10" rx="2" fill="#f0e8d8"/></svg>'},
  {id:'boutique_premium',name:'Boutique Premium',desc:'Rosa, lujo, moda',theme:'minimal_light',color:'#ec4899',
   svg:'<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="80" fill="#fff0f7"/><rect width="200" height="18" fill="#fff"/><rect x="8" y="5" width="36" height="8" rx="2" fill="#831843"/><rect x="155" y="5" width="36" height="8" rx="3" fill="#ec4899"/><rect x="40" y="26" width="120" height="10" rx="2" fill="#831843"/><rect x="55" y="40" width="90" height="5" rx="1" fill="#f9a8d4"/><rect x="70" y="50" width="60" height="9" rx="4" fill="#ec4899"/><rect x="8" y="66" width="56" height="10" rx="3" fill="#fce7f3"/><rect x="72" y="66" width="56" height="10" rx="3" fill="#fce7f3"/><rect x="136" y="66" width="56" height="10" rx="3" fill="#fce7f3"/></svg>'}
];

const TMPL_SECS = {
  minimal_light: null,
  minimal_dark: null,
  nordic_forest: [
    {id:'hero',type:'hero',active:true,settings:{title:'Hecho con amor y naturaleza',subtitle:'Productos artesanales de origen sostenible.',btn_text:'Explorar',btn_link:'/store/catalog',align:'left',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'Selección Natural',subtitle:'Productos cuidadosamente elegidos',limit:6}},
    {id:'feat',type:'features',active:true,settings:{title:'Nuestros valores',subtitle:'',items:[{icon:'🌿',title:'Sostenible',desc:'Materiales de origen responsable.'},{icon:'🤝',title:'Artesanal',desc:'Hecho a mano con dedicación.'},{icon:'♻️',title:'Eco',desc:'Packaging 100% reciclable.'}]}},
    {id:'testi',type:'testimonials',active:true,settings:{title:'Familias que confían',subtitle:'',items:[{name:'Ana G.',rating:5,comment:'Productos increíbles.'},{name:'Carlos R.',rating:5,comment:'Calidad inigualable.'},{name:'María L.',rating:5,comment:'Mi tienda favorita.'}]}}
  ],
  bold_tech: [
    {id:'hero',type:'hero',active:true,settings:{title:'TECNOLOGÍA SIN LÍMITES',subtitle:'Los productos más avanzados del mercado.',btn_text:'COMPRAR AHORA',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'TOP PRODUCTOS',subtitle:'Lo mejor de lo mejor',limit:8}},
    {id:'feat',type:'features',active:true,settings:{title:'POR QUÉ NOSOTROS',subtitle:'',items:[{icon:'⚡',title:'VELOCIDAD',desc:'Envío express garantizado.'},{icon:'🔒',title:'SEGURIDAD',desc:'Pago 100% protegido.'},{icon:'🏆',title:'CALIDAD',desc:'Solo las mejores marcas.'}]}},
    {id:'nl',type:'newsletter',active:true,settings:{title:'CLUB PREMIUM',subtitle:'Acceso anticipado y ofertas exclusivas.',btn_text:'REGISTRARME'}}
  ],
  vintage_warm: [
    {id:'hero',type:'hero',active:true,settings:{title:'Tradición y calidez en cada pieza',subtitle:'Artesanía con historia, diseño con alma.',btn_text:'Descubrir',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'Piezas seleccionadas',subtitle:'Con cariño, para ti',limit:6}},
    {id:'testi',type:'testimonials',active:true,settings:{title:'Lo que dicen nuestros clientes',subtitle:'',items:[{name:'Elena M.',rating:5,comment:'Regresé inmediatamente a comprar más.'},{name:'José A.',rating:5,comment:'Calidad única.'},{name:'Pilar G.',rating:5,comment:'El mejor regalo que he hecho.'}]}},
    {id:'nl',type:'newsletter',active:true,settings:{title:'Recibe novedades con encanto',subtitle:'Sé el primero en conocer nuestras colecciones.',btn_text:'Suscribirme'}}
  ],
  boutique_premium: [
    {id:'hero',type:'hero',active:true,settings:{title:'Donde el estilo es protagonista',subtitle:'Moda exclusiva y accesorios de diseño para ti.',btn_text:'Ver colección',btn_link:'/store/catalog',align:'center',use_banner_bg:false}},
    {id:'fp',type:'featured_products',active:true,settings:{title:'Colección Exclusiva',subtitle:'Piezas únicas seleccionadas',limit:8}},
    {id:'feat',type:'features',active:true,settings:{title:'La experiencia Boutique',subtitle:'',items:[{icon:'👗',title:'Edición limitada',desc:'Piezas únicas y exclusivas.'},{icon:'🎁',title:'Packaging premium',desc:'Presentación de lujo.'},{icon:'💌',title:'Personal shopper',desc:'Asesoramiento personalizado.'}]}},
    {id:'testi',type:'testimonials',active:true,settings:{title:'Nuestras clientas',subtitle:'',items:[{name:'Valentina C.',rating:5,comment:'Calidad de lujo a precio justo.'},{name:'Sofía R.',rating:5,comment:'Me siento especial con cada compra.'},{name:'Isabella M.',rating:5,comment:'Mi boutique de referencia.'}]}},
    {id:'nl',type:'newsletter',active:true,settings:{title:'Club Boutique Premium',subtitle:'Acceso exclusivo a lanzamientos y descuentos VIP.',btn_text:'Unirme al club'}}
  ]
};

const sbState = { settings:{ store_name:'',tagline:'',logo_url:'',banner_url:'',primary_color:'#10b981',announcement:'',facebook_url:'',instagram_url:'',twitter_url:'',terms_html:'',privacy_html:'',returns_html:'',seo_title:'',seo_description:'',theme:'minimal_light' }, sections:[], sel:null };
let sbPrevTimer = null;
let sbHistory = [];
let sbBusy = false;

// ── Init ─────────────────────────────────────────────────────────────
async function sbInit() {
  try {
    const r = await fetch('/api/erp/settings/store', { headers: {'x-csrf-token': CSRF} });
    const d = await r.json();
    Object.assign(sbState.settings, {
      store_name:d.store_name||'', tagline:d.tagline||'', logo_url:d.logo_url||'', banner_url:d.banner_url||'',
      primary_color:d.primary_color||'#10b981', announcement:d.announcement||'',
      facebook_url:d.facebook_url||'', instagram_url:d.instagram_url||'', twitter_url:d.twitter_url||'',
      terms_html:d.terms_html||'', privacy_html:d.privacy_html||'', returns_html:d.returns_html||'',
      seo_title:d.seo_title||'', seo_description:d.seo_description||'', theme:d.theme||'minimal_light'
    });
    try { sbState.sections = d.homepage_sections ? JSON.parse(d.homepage_sections) : deepCopy(DEF_SECS); }
    catch { sbState.sections = deepCopy(DEF_SECS); }
    document.getElementById('sbStoreName').value = sbState.settings.store_name;
    sbRenderTpls();
    sbRenderSecList();
    sbPreview();
    if (!HAS_CUSTOM) setTimeout(function() { sbAddMsg('assistant', '¡Hola! Soy DISA, tu constructora de tiendas 🏪 ¿Qué tipo de productos vendes?'); }, 500);
  } catch(e) { console.error('[SB]', e); }
}

function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }
function esc(v) { return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Tabs ──────────────────────────────────────────────────────────────
function sbTab(t, btn) {
  document.querySelectorAll('.sb-tab').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.sb-panel').forEach(function(p){ p.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('sbp-' + t).classList.add('active');
}

// ── Preview ───────────────────────────────────────────────────────────
function sbPreview() {
  // D1 — tienda pública apagada: /store da 404, así que NO se carga la previsualización en vivo.
  // (El constructor de tienda es D2; aquí solo se neutraliza el resto muerto que apuntaba a /store.)
  var ifr = document.getElementById('sbIframe');
  if (ifr) { ifr.removeAttribute('src'); ifr.srcdoc = '<div style="font-family:system-ui;padding:2rem;color:var(--text2)">Previsualización no disponible: la tienda pública está desactivada (D1).</div>'; }
}
function sbTrigger() { clearTimeout(sbPrevTimer); sbPrevTimer = setTimeout(sbPreview, 400); }
function sbDev(d, btn) {
  document.querySelectorAll('.sb-dev-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('sbIframe').className = d === 'mobile' ? 'mobile' : 'desktop';
}

// ── Publish ───────────────────────────────────────────────────────────
async function sbPublish() {
  var btn = document.querySelector('.sb-publish-btn');
  var orig = btn.textContent;
  btn.textContent = 'Guardando...'; btn.disabled = true;
  try {
    var s = sbState.settings;
    await fetch('/api/erp/settings/store', {
      method: 'PUT',
      headers: {'Content-Type':'application/json','x-csrf-token':CSRF},
      body: JSON.stringify({
        store_name: document.getElementById('sbStoreName').value || s.store_name,
        tagline:s.tagline, logo_url:s.logo_url, banner_url:s.banner_url,
        primary_color:s.primary_color, announcement:s.announcement,
        facebook_url:s.facebook_url, instagram_url:s.instagram_url, twitter_url:s.twitter_url,
        terms_html:s.terms_html, privacy_html:s.privacy_html, returns_html:s.returns_html,
        seo_title:s.seo_title, seo_description:s.seo_description,
        theme:s.theme, homepage_sections:JSON.stringify(sbState.sections)
      })
    });
    btn.textContent = '✓ Publicado';
    setTimeout(function(){ btn.textContent = orig; btn.disabled = false; sbPreview(); }, 2000);
  } catch(e) {
    btn.textContent = 'Error';
    setTimeout(function(){ btn.textContent = orig; btn.disabled = false; }, 2000);
  }
}

// ── Templates ─────────────────────────────────────────────────────────
function sbRenderTpls() {
  var grid = document.getElementById('sbTplGrid');
  if (!grid) return;
  grid.innerHTML = TMPLS.map(function(t) {
    var active = (sbState.settings.theme === t.theme && sbState.settings.primary_color === t.color) ? ' active' : '';
    var badge = t.pop ? '<span class="sb-tpl-badge">★ Popular</span>' : '';
    return '<div class="sb-tpl-card' + active + '" onclick="sbApplyTpl(\'' + t.id + '\')">'
      + badge + '<div class="sb-tpl-mock">' + t.svg + '</div>'
      + '<div class="sb-tpl-info"><div class="sb-tpl-name">' + t.name + '</div><div class="sb-tpl-desc">' + t.desc + '</div></div></div>';
  }).join('');
}

function sbApplyTpl(id) {
  var t = TMPLS.find(function(x){ return x.id === id; });
  if (!t) return;
  sbState.settings.theme = t.theme;
  sbState.settings.primary_color = t.color;
  var secs = TMPL_SECS[id];
  sbState.sections = secs ? deepCopy(secs) : deepCopy(DEF_SECS);
  sbRenderTpls(); sbRenderSecList(); sbPreview();
  if (typeof toast === 'function') toast('Plantilla "' + t.name + '" aplicada — recuerda publicar');
}

// ── Blocks ────────────────────────────────────────────────────────────
var SEC_DEFAULTS = {
  hero:{title:'Título aquí',subtitle:'Subtítulo.',btn_text:'Ver más',btn_link:'/store/catalog',align:'center',use_banner_bg:false},
  featured_products:{title:'Productos Destacados',subtitle:'',limit:8},
  features:{title:'Nuestras ventajas',subtitle:'',items:[{icon:'⭐',title:'Ventaja 1',desc:'Descripción.'}]},
  testimonials:{title:'Testimonios',subtitle:'',items:[{name:'Cliente',rating:5,comment:'Excelente.'}]},
  newsletter:{title:'Suscríbete',subtitle:'Recibe novedades.',btn_text:'Suscribirme'}
};

function sbAddSec(type) {
  if (sbState.sections.find(function(s){ return s.type === type; })) {
    if (typeof toast === 'function') toast('Ya existe una sección ' + type, 'err'); return;
  }
  sbState.sections.push({id:type+'_'+Date.now(),type:type,active:true,settings:deepCopy(SEC_DEFAULTS[type]||{})});
  sbState.sel = sbState.sections.length - 1;
  sbRenderSecList(); sbRenderEditor(); sbTrigger();
  var el = document.getElementById('sbSecList'); if (el) el.scrollTop = el.scrollHeight;
}

function sbRemoveSec(i) {
  sbState.sections.splice(i, 1);
  if (sbState.sel === i) sbState.sel = null;
  else if (sbState.sel > i) sbState.sel--;
  sbRenderSecList(); sbRenderEditor(); sbTrigger();
}

function sbSelSec(i) {
  sbState.sel = i; sbRenderSecList(); sbRenderEditor();
  document.getElementById('sbEditor').scrollIntoView({behavior:'smooth',block:'nearest'});
}

function sbRenderSecList() {
  var el = document.getElementById('sbSecList');
  if (!el) return;
  if (!sbState.sections.length) {
    el.innerHTML = '<div style="padding:14px;font-size:11px;color:var(--text3);text-align:center">Sin secciones — añade bloques arriba</div>'; return;
  }
  el.innerHTML = sbState.sections.map(function(s, i) {
    var m = SEC_META[s.type] || {label:s.type, icon:'⚙️'};
    return '<div class="sb-sec-row' + (sbState.sel === i ? ' selected' : '') + '" id="sbsr-' + i + '">'
      + '<span class="sb-handle">≡</span>'
      + '<span class="sb-sec-label">' + m.icon + ' ' + m.label + '</span>'
      + '<div class="sb-sec-btns">'
      + '<button class="sb-sec-btn edit" onclick="sbSelSec(' + i + ')" title="Editar">✏</button>'
      + '<button class="sb-sec-btn del" onclick="sbRemoveSec(' + i + ')" title="Eliminar">✕</button>'
      + '</div></div>';
  }).join('');
  if (window.Sortable && !el._sb) {
    el._sb = new Sortable(el, {
      handle:'.sb-handle', animation:150,
      onEnd:function(e) {
        var m = sbState.sections.splice(e.oldIndex,1)[0];
        sbState.sections.splice(e.newIndex,0,m);
        if (sbState.sel === e.oldIndex) sbState.sel = e.newIndex;
        sbRenderSecList(); sbTrigger();
      }
    });
  }
}

function sbSetF(i, k, v) { if (!sbState.sections[i]) return; sbState.sections[i].settings[k] = v; sbTrigger(); }
function sbSetItem(si, ii, k, v) {
  if (!sbState.sections[si]) return;
  if (!sbState.sections[si].settings.items) sbState.sections[si].settings.items = [];
  if (!sbState.sections[si].settings.items[ii]) sbState.sections[si].settings.items[ii] = {};
  sbState.sections[si].settings.items[ii][k] = v;
  if (k === 'comment') sbState.sections[si].settings.items[ii].quote = v;
  sbTrigger();
}

function sbRenderEditor() {
  var el = document.getElementById('sbEditor'); if (!el) return;
  var i = sbState.sel;
  if (i === null || i === undefined || !sbState.sections[i]) {
    el.innerHTML = '<div class="sb-editor-empty">Selecciona una sección para editarla</div>'; return;
  }
  var sec = sbState.sections[i];
  var m = SEC_META[sec.type] || {label:sec.type,icon:'⚙️'};
  var h = '<div style="margin-bottom:8px;font-size:11px;font-weight:500;color:var(--teal)">' + m.icon + ' ' + m.label + '</div>';
  function fi(label, key, val, type) {
    type = type || 'text';
    return '<div style="margin-bottom:6px"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:2px">' + label + '</label>'
      + '<input class="form-control" style="font-size:12px;padding:5px 8px" type="' + type + '" value="' + esc(val) + '" oninput="sbSetF(' + i + ',\'' + key + '\',this.value)"></div>';
  }
  function ta(label, key, val) {
    return '<div style="margin-bottom:6px"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:2px">' + label + '</label>'
      + '<textarea class="form-control" style="font-size:12px;padding:5px 8px;min-height:52px" oninput="sbSetF(' + i + ',\'' + key + '\',this.value)">' + esc(val) + '</textarea></div>';
  }
  function sl(label, key, val, opts) {
    var os = opts.map(function(o){ return '<option value="' + o.v + '"' + (String(val) === String(o.v) ? ' selected' : '') + '>' + o.l + '</option>'; }).join('');
    return '<div style="margin-bottom:6px"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:2px">' + label + '</label>'
      + '<select class="form-control" style="font-size:12px;padding:5px 8px" onchange="sbSetF(' + i + ',\'' + key + '\',this.value)">' + os + '</select></div>';
  }
  var s = sec.settings;
  if (sec.type === 'hero') {
    h += fi('Título','title',s.title) + ta('Subtítulo','subtitle',s.subtitle)
       + fi('Texto botón','btn_text',s.btn_text) + fi('Enlace botón','btn_link',s.btn_link)
       + sl('Alineación','align',s.align,[{v:'left',l:'Izquierda'},{v:'center',l:'Centro'},{v:'right',l:'Derecha'}]);
  } else if (sec.type === 'featured_products') {
    h += fi('Título','title',s.title) + fi('Subtítulo','subtitle',s.subtitle)
       + sl('Límite de productos','limit',String(s.limit||8),[{v:'4',l:'4 productos'},{v:'6',l:'6 productos'},{v:'8',l:'8 productos'},{v:'12',l:'12 productos'}]);
  } else if (sec.type === 'features') {
    h += fi('Título','title',s.title);
    (s.items||[]).forEach(function(item,j) {
      h += '<div style="border:1px solid var(--border);border-radius:5px;padding:6px;margin-bottom:5px">'
        + '<div style="display:flex;gap:5px;margin-bottom:4px">'
        + '<div style="flex:0 0 40px"><label style="font-size:9px;color:var(--text3)">Icono</label><input class="form-control" style="font-size:12px;padding:3px;text-align:center" value="' + esc(item.icon) + '" oninput="sbSetItem(' + i + ',' + j + ',\'icon\',this.value)"></div>'
        + '<div style="flex:1"><label style="font-size:9px;color:var(--text3)">Título</label><input class="form-control" style="font-size:12px;padding:3px" value="' + esc(item.title) + '" oninput="sbSetItem(' + i + ',' + j + ',\'title\',this.value)"></div>'
        + '</div>'
        + '<input class="form-control" style="font-size:12px;padding:3px" placeholder="Descripción" value="' + esc(item.desc) + '" oninput="sbSetItem(' + i + ',' + j + ',\'desc\',this.value)">'
        + '</div>';
    });
  } else if (sec.type === 'testimonials') {
    h += fi('Título','title',s.title);
    (s.items||[]).forEach(function(item,j) {
      var stars = [5,4,3,2,1].map(function(n){ return '<option value="' + n + '"' + (item.rating===n?' selected':'') + '>' + n + '⭐</option>'; }).join('');
      h += '<div style="border:1px solid var(--border);border-radius:5px;padding:6px;margin-bottom:5px">'
        + '<div style="display:flex;gap:5px;margin-bottom:4px">'
        + '<div style="flex:1"><label style="font-size:9px;color:var(--text3)">Nombre</label><input class="form-control" style="font-size:12px;padding:3px" value="' + esc(item.name) + '" oninput="sbSetItem(' + i + ',' + j + ',\'name\',this.value)"></div>'
        + '<div style="flex:0 0 68px"><label style="font-size:9px;color:var(--text3)">Estrellas</label><select class="form-control" style="font-size:12px;padding:3px" onchange="sbSetItem(' + i + ',' + j + ',\'rating\',parseInt(this.value))">' + stars + '</select></div>'
        + '</div>'
        + '<textarea class="form-control" style="font-size:12px;padding:3px;min-height:40px" oninput="sbSetItem(' + i + ',' + j + ',\'comment\',this.value)">' + esc(item.comment||item.quote) + '</textarea>'
        + '</div>';
    });
  } else if (sec.type === 'newsletter') {
    h += fi('Título','title',s.title) + ta('Subtítulo','subtitle',s.subtitle) + fi('Texto botón','btn_text',s.btn_text);
  }
  el.innerHTML = h;
}

// ── DISA Chat ─────────────────────────────────────────────────────────
function sbAddMsg(role, text) {
  var msgs = document.getElementById('sbMsgs'); if (!msgs) return;
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;align-items:' + (role==='user'?'flex-end':'flex-start');
  var b = document.createElement('div');
  b.className = 'sb-bubble ' + role;
  b.textContent = text;
  row.appendChild(b); msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function sbAddStyleChips() {
  var msgs = document.getElementById('sbMsgs'); if (!msgs) return;
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start';
  var chips = document.createElement('div');
  chips.className = 'sb-style-chips';
  ['Natural','Moderno','Elegante','Minimalista','Artesanal'].forEach(function(s) {
    var btn = document.createElement('button');
    btn.className = 'sb-style-chip'; btn.textContent = s;
    btn.onclick = function() {
      chips.querySelectorAll('.sb-style-chip').forEach(function(b){ b.disabled = true; });
      sbSendText(s);
    };
    chips.appendChild(btn);
  });
  row.appendChild(chips); msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sbSend() {
  var input = document.getElementById('sbChatIn');
  var msg = input.value.trim(); if (!msg || sbBusy) return;
  input.value = ''; sbSendText(msg);
}

async function sbSendText(msg) {
  if (sbBusy) return;
  sbAddMsg('user', msg);
  sbHistory.push({role:'user',content:msg});
  sbBusy = true;
  var msgs = document.getElementById('sbMsgs');
  var typing = document.createElement('div');
  typing.className = 'sb-typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  if (msgs) { msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight; }
  try {
    var s = sbState.settings;
    var r = await fetch('/api/disa/store-message', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-csrf-token':CSRF},
      body: JSON.stringify({message:msg,history:sbHistory.slice(-8),store_state:{store_name:s.store_name,theme:s.theme,primary_color:s.primary_color,sections:sbState.sections}})
    });
    var data = await r.json();
    typing.remove(); sbBusy = false;
    var reply = data.reply || 'Sin respuesta.';
    sbAddMsg('assistant', reply);
    sbHistory.push({role:'assistant',content:reply});
    if (reply.toLowerCase().indexOf('estilo') !== -1 || reply.toLowerCase().indexOf('prefer') !== -1) sbAddStyleChips();
    if (data.action) sbApplyAction(data.action);
  } catch(e) { typing.remove(); sbBusy = false; sbAddMsg('assistant','Error al conectar. Inténtalo de nuevo.'); }
}

function sbApplyAction(action) {
  var t = action.type, p = action.params || {};
  if (t === 'update_store_theme' && p.theme) { sbState.settings.theme = p.theme; sbRenderTpls(); }
  else if (t === 'update_store_color' && p.primary_color) { sbState.settings.primary_color = p.primary_color; sbRenderTpls(); }
  else if (t === 'update_store_text' && p.field && p.value !== undefined) {
    sbState.settings[p.field] = p.value;
    if (p.field === 'store_name') { var inp = document.getElementById('sbStoreName'); if (inp) inp.value = p.value; }
  }
  else if (t === 'add_section' && p.type) { sbAddSec(p.type); return; }
  else if (t === 'remove_section' && p.type) {
    var idx = sbState.sections.findIndex(function(s){ return s.type === p.type; });
    if (idx >= 0) { sbRemoveSec(idx); return; }
  }
  else if (t === 'update_section' && p.type && p.settings) {
    var sec = sbState.sections.find(function(s){ return s.type === p.type; });
    if (sec) Object.assign(sec.settings, p.settings);
  }
  else if (t === 'apply_template' && p.template) { sbApplyTpl(p.template); return; }
  else if (t === 'reorder_sections' && Array.isArray(p.order)) {
    var ns = p.order.map(function(i){ return sbState.sections[i]; }).filter(Boolean);
    if (ns.length) sbState.sections = ns;
  }
  sbRenderSecList(); sbRenderEditor(); sbPreview();
}

// ── Boot ──────────────────────────────────────────────────────────────
sbInit();
</script>`;
    return c.html(adminLayout('Constructor de Tienda', content, 'store-settings', csrfToken, c));
  });

  return { api, views, storeViews };
}
