// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROMOCIONES, BONOS Y DESCUENTOS — la pantalla y su API · punto 11, 23 ago 2026
//
// LO QUE SE REHACE Y POR QUÉ. La pantalla vieja (`/admin/discounts`) se retiró en el encargo de
// cupones **por estar muerta**: era de la tienda, con códigos para un carrito, y no tocaba ni una
// factura. La función no sobraba — lo que sobraba era aquella pantalla. Esto es lo que un autónomo
// usa de verdad: un descuento fijo por cliente, promociones con fecha, y bonos prepagados.
//
// EL CANDADO. Todo cuelga de `invoices.edit` para lo que ESCRIBE y de `invoices.read` para lo que
// LEE: un descuento cambia lo que se factura, así que quien no puede tocar facturas tampoco puede
// inventar una promoción del 90 %. No se crea ningún permiso nuevo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { escHtml } from '../../../core/escape.js';
import { safeError } from '../../../core/errors.js';
import { logActivity } from '../../../core/auth.js';
import { ENTITY } from '../../../core/activity-entities.js';
import {
  listarPromociones, getPromocion, guardarPromocion, archivarPromocion, promocionVigente,
  bonosDe, crearBono, consumirBono, deshacerConsumo, consumosDe, proponer,
} from '../descuentos.js';

const eur = (n, sym) => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;

export function createDescuentosRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const sym = () => (db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get() || {}).currency_symbol || '€';

  // ── API ──────────────────────────────────────────────────────────────────────────────────────
  // PROPONER es de LECTURA aunque vaya por POST (lleva las líneas del documento en el cuerpo). No
  // escribe nada: por eso pide `invoices.read` y no `invoices.edit`.
  api.post('/proponer', requirePerm('invoices.read'), async c => {
    try {
      const b = await c.req.json().catch(() => ({}));
      const r = proponer(db, { clientId: b.client_id || null, lineas: b.lineas || [], codigo: b.codigo || '' });
      // Los bonos NO son un descuento y no se mezclan con ellos: se avisan aparte, porque consumir
      // un bono no rebaja la factura — la evita.
      const bonos = b.client_id ? bonosDe(db, b.client_id, { soloVivos: true }) : [];
      const conCodigo = listarPromociones(db, { soloActivas: true }).some(p => p.codigo && promocionVigente(p));
      return c.json({ ...r, bonos: bonos.map(x => ({ id: x.id, nombre: x.nombre, quedan: x.quedan })),
                      codigos_disponibles: conCodigo });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.get('/promociones', requirePerm('invoices.read'), c => c.json(listarPromociones(db)));
  api.post('/promociones', requirePerm('invoices.edit'), async c => {
    try {
      const b = await c.req.json();
      const r = guardarPromocion(db, b);
      logActivity(db, c.get('session'), b.id ? 'Editó promoción' : 'Creó promoción', ENTITY.PROMOCION, r.id, String(b.nombre || ''));
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.delete('/promociones/:id', requirePerm('invoices.edit'), c => {
    try {
      const r = archivarPromocion(db, Number(c.req.param('id')));
      logActivity(db, c.get('session'), 'Apagó promoción', ENTITY.PROMOCION, r.id, '');
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.get('/bonos/:clientId', requirePerm('invoices.read'), c =>
    c.json(bonosDe(db, Number(c.req.param('clientId')))));
  api.post('/bonos', requirePerm('invoices.edit'), async c => {
    try {
      const b = await c.req.json();
      const r = crearBono(db, b);
      logActivity(db, c.get('session'), 'Creó bono', ENTITY.BONO, r.id, String(b.nombre || ''));
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/bonos/:id/consumir', requirePerm('invoices.edit'), async c => {
    try {
      const b = await c.req.json().catch(() => ({}));
      const r = consumirBono(db, Number(c.req.param('id')), { ...b, user_id: c.get('session')?.userId || null });
      logActivity(db, c.get('session'), 'Usó un bono', ENTITY.BONO, r.id, 'consumo de ' + (b.sesiones || 1) + ' sesión(es)');
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.delete('/consumos/:id', requirePerm('invoices.edit'), c => {
    try { return c.json(deshacerConsumo(db, Number(c.req.param('id')))); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.get('/bonos/:id/consumos', requirePerm('invoices.read'), c =>
    c.json(consumosDe(db, Number(c.req.param('id')))));

  // ── LA PANTALLA ──────────────────────────────────────────────────────────────────────────────
  views.get('/', requirePerm('invoices.read'), c => {
    const csrf = c.get('session')?.csrfToken || '';
    const s = sym();
    const proms = listarPromociones(db);
    const cats = db.prepare('SELECT id, name FROM categories ORDER BY name').all();
    const prods = db.prepare("SELECT id, name FROM products WHERE status='active' ORDER BY name LIMIT 500").all();
    const bonos = db.prepare(
      `SELECT b.*, c.name AS cliente FROM bonos b JOIN clients c ON c.id=b.client_id
        ORDER BY b.activo DESC, b.id DESC LIMIT 200`).all();
    const hoy = new Date().toISOString().slice(0, 10);

    const filaProm = p => {
      const viva = promocionVigente(p, hoy);
      const cuando = [p.desde ? 'desde ' + p.desde : '', p.hasta ? 'hasta ' + p.hasta : ''].filter(Boolean).join(' ') || 'sin límite de fechas';
      const donde = p.alcance === 'todo' ? 'todo'
        : (p.alcance === 'categoria' ? 'categoría ' + escHtml((cats.find(x => x.id === p.categoria_id) || {}).name || '?')
                                     : 'producto ' + escHtml((prods.find(x => x.id === p.product_id) || {}).name || '?'));
      return `<tr>
        <td><strong>${escHtml(p.nombre)}</strong>${p.codigo ? `<div style="font-size:.72rem;color:var(--text3)">código <code>${escHtml(p.codigo)}</code></div>` : ''}</td>
        <td>${p.tipo === 'porcentaje' ? p.valor + ' %' : escHtml(eur(p.valor, s))}</td>
        <td style="font-size:.8rem;color:var(--text2)">${escHtml(cuando)}</td>
        <td style="font-size:.8rem;color:var(--text2)">${donde}</td>
        <td style="font-size:.8rem">${p.usos}${p.usos_max != null ? ' de ' + p.usos_max : ''}</td>
        <td>${p.activa ? (viva ? '<span class="badge b-ok">vigente</span>' : '<span class="badge b-warn">activa, fuera de fecha</span>')
                       : '<span class="badge">apagada</span>'}</td>
        <td class="r"><button class="btn btn-secondary btn-sm" data-edit="${p.id}">Editar</button>
          ${p.activa ? `<button class="btn btn-secondary btn-sm" data-off="${p.id}">Apagar</button>` : ''}</td></tr>`;
    };
    const filaBono = b => {
      const quedan = Math.max(0, b.sesiones - b.usadas);
      const cad = b.caduca && hoy > String(b.caduca);
      return `<tr>
        <td><strong>${escHtml(b.nombre)}</strong><div style="font-size:.72rem;color:var(--text3)">${escHtml(b.cliente)}</div></td>
        <td>${b.usadas} de ${b.sesiones}${quedan ? '' : ' · agotado'}</td>
        <td>${escHtml(eur(b.importe, s))}</td>
        <td style="font-size:.8rem;color:var(--text2)">${b.caduca ? (cad ? 'caducó el ' + escHtml(b.caduca) : 'caduca el ' + escHtml(b.caduca)) : 'sin caducidad'}</td>
        <td class="r">${(b.activo && quedan > 0 && !cad)
          ? `<button class="btn btn-sm" data-usar="${b.id}">Usar una sesión</button>` : ''}
          <button class="btn btn-secondary btn-sm" data-hist="${b.id}">Historial</button></td></tr>`;
    };

    const content = `
      <div class="ph"><h2>Descuentos, promociones y bonos</h2>
        <div style="display:flex;gap:.5rem"><button class="btn" id="btnNuevaProm">Nueva promoción</button>
          <button class="btn btn-secondary" id="btnNuevoBono">Nuevo bono</button></div></div>
      <div class="alert" style="margin-bottom:1rem">Un descuento se añade a la factura <strong>como una
        línea</strong>, con su nombre y su motivo: el cliente ve qué le has descontado, y el IVA baja en
        proporción. Nada se aplica solo — al hacer una factura, pulsa <strong>«Descuentos…»</strong> y
        eliges. El <strong>descuento fijo de un cliente</strong> se pone en su ficha.</div>

      <div class="card bf-caja" style="margin-bottom:1rem">
        <h3 style="margin-top:0">Promociones</h3>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:.6rem">Una regla con fecha. Las que
          llevan <strong>código</strong> solo se aplican si lo escribes al facturar.</div>
        <div class="table-wrap"><table><thead><tr><th>Promoción</th><th>Descuento</th><th>Cuándo</th>
          <th>Sobre qué</th><th>Usos</th><th>Estado</th><th></th></tr></thead>
          <tbody id="tProms">${proms.map(filaProm).join('') || '<tr><td colspan="7" style="color:var(--text3);padding:1.2rem;text-align:center">Todavía no hay promociones. Las tres que había de la tienda vieja están aquí, apagadas: enciéndelas si te sirven.</td></tr>'}</tbody>
        </table></div>
      </div>

      <div class="card bf-caja">
        <h3 style="margin-top:0">Bonos</h3>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:.6rem">Un talonario prepagado.
          <strong>Se vende con una factura normal</strong> (ahí está el ingreso) y <strong>consumirlo no
          emite factura</strong>: solo baja el contador y queda apuntado quién y cuándo.</div>
        <div class="table-wrap"><table><thead><tr><th>Bono</th><th>Usadas</th><th>Pagó</th>
          <th>Caducidad</th><th></th></tr></thead>
          <tbody id="tBonos">${bonos.map(filaBono).join('') || '<tr><td colspan="5" style="color:var(--text3);padding:1.2rem;text-align:center">Ningún bono todavía.</td></tr>'}</tbody>
        </table></div>
      </div>
      <script>
      const CSRF=${JSON.stringify(csrf)}, SYM=${JSON.stringify(s)};
      const CATS=${JSON.stringify(cats)}, PRODS=${JSON.stringify(prods.slice(0, 300))};
      async function api(m,u,b){ const r=await fetch(u,{method:m,headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined});
        let d=null; try{ d=await r.json(); }catch(e){} if(!r.ok||(d&&d.error)) throw new Error(window.cleanErrMsg((d&&d.error)||'')); return d; }
      const PROMS=${JSON.stringify(proms)};

      async function editarProm(p){
        p = p || {};
        const v = await window.pedirDatos({ titulo: p.id ? 'Editar promoción' : 'Nueva promoción',
          aceptar: p.id ? 'Guardar' : 'Crear',
          campos:[
            { id:'nombre', etiqueta:'Nombre', valor:p.nombre||'', marcador:'Descuento de verano' },
            { id:'tipo', tipo:'lista', etiqueta:'Tipo', valor:p.tipo||'porcentaje',
              opciones:[{v:'porcentaje',t:'Un porcentaje'},{v:'importe',t:'Un importe fijo'}] },
            { id:'valor', tipo:'numero', etiqueta:'Cuánto', valor:p.valor||'', ayuda:'Si es porcentaje, del 1 al 100.' },
            { id:'codigo', etiqueta:'Código (opcional)', valor:p.codigo||'',
              ayuda:'Si lo pones, la promoción solo se aplica escribiéndolo al facturar.' },
            { id:'desde', etiqueta:'Desde (opcional)', valor:p.desde||'', marcador:'2026-09-01' },
            { id:'hasta', etiqueta:'Hasta (opcional)', valor:p.hasta||'', marcador:'2026-09-30' },
            { id:'minimo', tipo:'numero', etiqueta:'Base mínima del documento', valor:p.minimo||0,
              ayuda:'0 = sin mínimo.' },
            { id:'alcance', tipo:'lista', etiqueta:'Sobre qué', valor:p.alcance||'todo',
              opciones:[{v:'todo',t:'Todo el documento'},{v:'categoria',t:'Una categoría'},{v:'producto',t:'Un producto'}] },
            { id:'categoria_id', tipo:'lista', etiqueta:'Categoría', valor:p.categoria_id||'',
              opciones:[{v:'',t:'—'}].concat(CATS.map(x=>({v:x.id,t:x.name}))) },
            { id:'product_id', tipo:'lista', etiqueta:'Producto', valor:p.product_id||'',
              opciones:[{v:'',t:'—'}].concat(PRODS.map(x=>({v:x.id,t:x.name}))) },
            { id:'usos_max', tipo:'numero', etiqueta:'Máximo de usos (opcional)', valor:p.usos_max==null?'':p.usos_max },
            { id:'activa', tipo:'casilla', etiqueta:'Encendida', valor: p.id ? !!p.activa : true },
          ],
          validar: v2 => {
            if(!String(v2.nombre||'').trim()) return { campo:'nombre', mensaje:'Ponle un nombre.' };
            const n=Number(v2.valor); if(!(n>0)) return { campo:'valor', mensaje:'Tiene que ser mayor que cero.' };
            if(v2.tipo==='porcentaje' && n>100) return { campo:'valor', mensaje:'Un porcentaje no puede pasar de 100.' };
            if(v2.alcance==='categoria' && !v2.categoria_id) return { campo:'categoria_id', mensaje:'Elige la categoría.' };
            if(v2.alcance==='producto' && !v2.product_id) return { campo:'product_id', mensaje:'Elige el producto.' };
            if(v2.desde && v2.hasta && v2.hasta < v2.desde) return { campo:'hasta', mensaje:'Es anterior a la de inicio.' };
            return null;
          },
          alAceptar: async v2 => { await api('POST','/api/erp/descuentos/promociones', { ...v2, id: p.id || null,
            valor:Number(v2.valor), minimo:Number(v2.minimo)||0,
            categoria_id: v2.categoria_id||null, product_id: v2.product_id||null,
            usos_max: v2.usos_max===''?null:Number(v2.usos_max), activa: v2.activa?1:0 }); },
        });
        if (v) location.reload();
      }
      async function nuevoBono(){
        const v = await window.pedirDatos({ titulo:'Nuevo bono', aceptar:'Crear el bono',
          texto:'Crea el talonario. La FACTURA de venta se hace aparte, como cualquier otra: aquí solo se apunta el bono y lo que pagó.',
          campos:[
            { id:'cliente', etiqueta:'Cliente (nombre exacto o parte)', marcador:'Taxis Ríos' },
            { id:'nombre', etiqueta:'Nombre del bono', marcador:'Bono 10 sesiones' },
            { id:'sesiones', tipo:'numero', etiqueta:'¿Cuántas sesiones trae?', valor:10 },
            { id:'importe', tipo:'numero', etiqueta:'¿Cuánto ha pagado?', valor:0 },
            { id:'caduca', etiqueta:'Caduca el (opcional)', marcador:'2027-08-23' },
          ],
          validar: v2 => {
            if(!String(v2.cliente||'').trim()) return { campo:'cliente', mensaje:'Dime de qué cliente es.' };
            if(!String(v2.nombre||'').trim()) return { campo:'nombre', mensaje:'Ponle un nombre.' };
            if(!(Number(v2.sesiones)>0)) return { campo:'sesiones', mensaje:'Al menos una sesión.' };
            return null;
          },
          alAceptar: async v2 => {
            const cl = await api('GET','/api/erp/clients?q='+encodeURIComponent(String(v2.cliente).trim()));
            const lista = Array.isArray(cl)?cl:(cl.clients||cl.rows||[]);
            if(!lista.length) throw new Error('No encuentro ningún cliente que se llame así.');
            if(lista.length>1 && !lista.some(x=>String(x.name).toLowerCase()===String(v2.cliente).trim().toLowerCase()))
              throw new Error('Hay '+lista.length+' clientes que encajan. Escribe el nombre completo.');
            const cli = lista.find(x=>String(x.name).toLowerCase()===String(v2.cliente).trim().toLowerCase()) || lista[0];
            await api('POST','/api/erp/descuentos/bonos', { client_id: cli.id, nombre:String(v2.nombre).trim(),
              sesiones:Number(v2.sesiones), importe:Number(v2.importe)||0, caduca: String(v2.caduca||'').trim()||null });
          },
        });
        if (v) location.reload();
      }
      async function usarBono(id){
        const si = await window.confirmarEnPagina({ titulo:'Usar una sesión del bono',
          texto:'Baja el contador y queda apuntado con la fecha de hoy. NO emite factura: el ingreso se declaró al venderlo.',
          aceptar:'Sí, usar una' });
        if(!si) return;
        try{ const r=await api('POST','/api/erp/descuentos/bonos/'+id+'/consumir',{sesiones:1});
          toast('Hecho. Le quedan '+r.quedan+' sesión(es)'); setTimeout(()=>location.reload(),700); }
        catch(e){ toast(e.message,'err'); }
      }
      async function verHistorial(id){
        let h=[]; try{ h=await api('GET','/api/erp/descuentos/bonos/'+id+'/consumos'); }catch(e){ toast(e.message,'err'); return; }
        await window.confirmarEnPagina({ titulo:'Historial del bono',
          texto: h.length ? h.map(x=>x.fecha+' · '+x.sesiones+' sesión(es)'+(x.nota?' · '+x.nota:'')).join('   |   ')
                          : 'Todavía no se ha usado ninguna sesión.',
          aceptar:'Cerrar', cancelar:'Cerrar' });
      }
      window.addEventListener('DOMContentLoaded',()=>{
        document.getElementById('btnNuevaProm').onclick=()=>editarProm(null);
        document.getElementById('btnNuevoBono').onclick=nuevoBono;
        document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editarProm(PROMS.find(p=>p.id===Number(b.dataset.edit))));
        document.querySelectorAll('[data-off]').forEach(b=>b.onclick=async()=>{
          const si=await window.confirmarEnPagina({titulo:'Apagar la promoción',
            texto:'Deja de aplicarse. No se borra: su histórico de usos se conserva y se puede volver a encender.',
            aceptar:'Sí, apagarla'});
          if(!si) return;
          try{ await api('DELETE','/api/erp/descuentos/promociones/'+b.dataset.off); toast('Apagada'); setTimeout(()=>location.reload(),600); }
          catch(e){ toast(e.message,'err'); }
        });
        document.querySelectorAll('[data-usar]').forEach(b=>b.onclick=()=>usarBono(b.dataset.usar));
        document.querySelectorAll('[data-hist]').forEach(b=>b.onclick=()=>verHistorial(b.dataset.hist));
      });
      </script>`;
    return c.html(adminLayout('Descuentos y promociones', content, 'descuentos', csrf, c));
  });

  return { api, views };
}
