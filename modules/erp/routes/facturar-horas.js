// FACTURAR HORAS — Escalera · paso 7 (servicios profesionales) · PIEZA 3.
// Lleva las entradas de tiempo FACTURABLES de un proyecto a una factura REAL. NO hay camino nuevo de
// emisión: se reutiliza `createInvoice` del motor de facturas (correlativo + hash Verifactu + asiento +
// cola T2). Aquí solo se decide QUÉ líneas van y a QUIÉN se factura.
//   · Cliente = el del PROYECTO (si el proyecto no tiene cliente → 400: "asigna un cliente al proyecto").
//   · Una línea por (tarea + tarifa): entradas con la MISMA descripción y MISMA tarifa se agrupan; la
//     cantidad son las horas sumadas y el precio unitario es la tarifa/hora.
//   · IVA por defecto = el de la empresa (company_config.tax_rate, 21 si no hay); IRPF opcional (0 por
//     defecto, solo aplica en ES, lo aplica el propio motor).
//   · Una entrada facturada queda enlazada (time_entries.invoice_id). "Facturada" se deriva EN VIVO: si la
//     factura se anula, la entrada vuelve a estar disponible SOLA (sin tocar el motor de anulación).
// Permiso: invoices.create en TODAS las rutas, incluida la vista (lección M2). NO va por propiedad: quien
// puede facturar factura las horas del equipo. `time_entries` sigue FUERA de WRITABLE_TABLES.
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { escHtml } from '../../../core/escape.js';
import { facturarHorasSchema } from '../schemas.js';
import { createInvoice } from './invoices.js';
import { ENTITY } from '../../../core/activity-entities.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const horasDe = seg => Math.round((Number(seg) || 0) / 3600 * 100) / 100;   // horas con 2 decimales (lo que va en la línea)

// Tarifa efectiva de una entrada: la de la PERSONA, y la del PROYECTO de respaldo (igual que en tiempo.js).
const tarifaEfectiva = row => (row.user_tarifa != null ? row.user_tarifa : (row.proy_tarifa != null ? row.proy_tarifa : null));

function parseCon(schema, input) {
  const res = schema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos inválidos'); e.status = 400; throw e;
  }
  return res.data;
}
function ivaEmpresa(db) {
  const cfg = db.prepare('SELECT tax_rate FROM company_config WHERE id=1').get();
  return cfg && cfg.tax_rate != null ? Number(cfg.tax_rate) : 21;
}
export function getProyectoParaFacturar(db, id) {
  return db.prepare(
    `SELECT p.id, p.codigo, p.nombre, p.cliente_id, p.active, c.name AS cliente_nombre
       FROM proyectos p LEFT JOIN clients c ON c.id=p.cliente_id WHERE p.id=?`).get(id);
}

// Entradas de tiempo aún facturables de un proyecto: facturable=1, finalizada (duracion NOT NULL), viva
// (active=1) y NO facturada (sin factura emitida enlazada). Rango de fechas opcional. Con importe en vivo.
export function facturables(db, { proyecto_id, desde = '', hasta = '' }) {
  const cond = [];
  const args = [proyecto_id];
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) { cond.push('AND te.fecha>=?'); args.push(desde); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) { cond.push('AND te.fecha<=?'); args.push(hasta); }
  const rows = db.prepare(
    `SELECT te.id, te.descripcion, te.fecha, te.duracion_seg, te.user_id, te.invoice_id,
            u.name AS user_nombre, u.tarifa_hora AS user_tarifa, p.tarifa_hora AS proy_tarifa,
            inv.status AS invoice_status
       FROM time_entries te
       JOIN proyectos p ON p.id=te.proyecto_id
       JOIN admin_users u ON u.id=te.user_id
       LEFT JOIN invoices inv ON inv.id=te.invoice_id
      WHERE te.proyecto_id=? AND te.active=1 AND te.facturable=1 AND te.duracion_seg IS NOT NULL
        AND NOT (te.invoice_id IS NOT NULL AND inv.status='emitida')
        ${cond.join(' ')}
      ORDER BY te.fecha, te.id`).all(...args);
  return rows.map(row => {
    const tarifa = tarifaEfectiva(row);
    const horas = horasDe(row.duracion_seg);
    return {
      id: row.id, descripcion: row.descripcion || '', fecha: row.fecha, duracion_seg: row.duracion_seg,
      user_id: row.user_id, user_nombre: row.user_nombre,
      tarifa_efectiva: tarifa, sin_tarifa: tarifa == null, horas,
      importe: tarifa == null ? null : r2(horas * tarifa),   // por línea de entrada; el importe REAL se redondea por grupo
    };
  });
}

// Agrupa entradas en líneas de factura: clave = (descripción normalizada + tarifa). Cantidad = horas
// sumadas (2 dec), precio = tarifa/hora, IVA = el de la empresa. Devuelve las líneas listas para el motor.
function agrupar(entradas, iva, nombreProy) {
  const grupos = new Map();
  for (const e of entradas) {
    const desc = (e.descripcion || '').trim();
    const key = desc.toLowerCase() + '|' + e.tarifa_efectiva;
    if (!grupos.has(key)) grupos.set(key, { descripcion: desc, tarifa: e.tarifa_efectiva, seg: 0, ids: [] });
    const g = grupos.get(key); g.seg += e.duracion_seg || 0; g.ids.push(e.id);
  }
  return [...grupos.values()].map(g => {
    const horas = horasDe(g.seg);
    const description = g.descripcion || ('Servicios profesionales — ' + nombreProy);
    return {
      description, quantity: horas, unit_price: r2(g.tarifa), tax_rate: iva,
      base: r2(horas * g.tarifa), ids: g.ids,   // base = misma aritmética que usará createInvoice (cuadra al céntimo)
    };
  });
}

// Vista previa: proyecto + entradas facturables + líneas agrupadas + totales. Sin escribir nada.
export function previewFacturaHoras(db, { proyecto_id, desde = '', hasta = '' }) {
  const proy = getProyectoParaFacturar(db, proyecto_id);
  if (!proy) { const e = new Error('Proyecto no encontrado'); e.status = 404; throw e; }
  const iva = ivaEmpresa(db);
  const entradas = facturables(db, { proyecto_id, desde, hasta });
  const lineas = agrupar(entradas.filter(e => !e.sin_tarifa), iva, proy.nombre);
  const subtotal = r2(lineas.reduce((s, l) => s + l.base, 0));
  const totalIva = r2(lineas.reduce((s, l) => s + l.base * l.tax_rate / 100, 0));
  return {
    proyecto: { id: proy.id, codigo: proy.codigo, nombre: proy.nombre, cliente_id: proy.cliente_id, cliente_nombre: proy.cliente_nombre, activo: !!proy.active },
    iva_defecto: iva, entradas, lineas,
    resumen: {
      n_entradas: entradas.length, n_sin_tarifa: entradas.filter(e => e.sin_tarifa).length,
      subtotal, total_iva: totalIva, total: r2(subtotal + totalIva),
    },
  };
}

// EMISIÓN: valida, agrupa, crea la factura con el motor y marca las entradas — todo en UNA transacción
// (si algo falla, ni factura ni marcas). Devuelve { invoice_id, invoice_number, n_entradas, ... }.
export function facturarHoras(db, input) {
  const d = parseCon(facturarHorasSchema, input);
  const proy = getProyectoParaFacturar(db, d.proyecto_id);
  if (!proy) { const e = new Error('Proyecto no encontrado'); e.status = 404; throw e; }
  if (!proy.cliente_id) { const e = new Error('Asigna un cliente al proyecto antes de facturar sus horas'); e.status = 400; throw e; }
  const iva = d.tax_rate != null ? d.tax_rate : ivaEmpresa(db);
  const ids = [...new Set(d.entry_ids)];

  const emitir = db.transaction(() => {
    // Cargar las entradas pedidas CON candado de estado, dentro de la transacción (evita doble facturación
    // por carrera): cada una debe ser del proyecto, viva, facturable, finalizada y NO ya facturada.
    const rows = ids.map(id => db.prepare(
      `SELECT te.id, te.descripcion, te.duracion_seg, te.facturable, te.active, te.proyecto_id, te.invoice_id,
              u.tarifa_hora AS user_tarifa, p.tarifa_hora AS proy_tarifa, inv.status AS invoice_status
         FROM time_entries te
         JOIN proyectos p ON p.id=te.proyecto_id
         JOIN admin_users u ON u.id=te.user_id
         LEFT JOIN invoices inv ON inv.id=te.invoice_id
        WHERE te.id=?`).get(id));
    for (let i = 0; i < ids.length; i++) {
      const row = rows[i];
      if (!row) { const e = new Error('Entrada ' + ids[i] + ' no encontrada'); e.status = 404; throw e; }
      if (row.proyecto_id !== proy.id) { const e = new Error('La entrada ' + ids[i] + ' no es de este proyecto'); e.status = 400; throw e; }
      if (!row.active || !row.facturable || row.duracion_seg == null) { const e = new Error('La entrada ' + ids[i] + ' no es facturable'); e.status = 400; throw e; }
      if (row.invoice_id && row.invoice_status === 'emitida') { const e = new Error('La entrada ' + ids[i] + ' ya está facturada'); e.status = 409; throw e; }
      if (tarifaEfectiva(row) == null) { const e = new Error('La entrada ' + ids[i] + ' no tiene tarifa: no se puede facturar'); e.status = 400; throw e; }
    }
    const entradas = rows.map(row => ({
      id: row.id, descripcion: row.descripcion || '', duracion_seg: row.duracion_seg, tarifa_efectiva: tarifaEfectiva(row),
    }));
    const lineas = agrupar(entradas, iva, proy.nombre);
    if (!lineas.length) { const e = new Error('No hay nada que facturar'); e.status = 400; throw e; }

    const inv = createInvoice(db, {
      client_id: proy.cliente_id,
      lines: lineas.map(l => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate })),
      issue_date: d.issue_date || undefined,
      irpf_rate: d.irpf_rate || 0,
      notes: 'Horas del proyecto ' + (proy.codigo ? proy.codigo + ' · ' : '') + proy.nombre,
    });
    // PIEZA 4 — auto-etiqueta la factura a SU proyecto (rentabilidad sin trabajo manual; reasignable después).
    db.prepare('UPDATE invoices SET project_id=? WHERE id=?').run(proy.id, inv.id);
    const marcar = db.prepare('UPDATE time_entries SET invoice_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    for (const id of ids) marcar.run(inv.id, id);
    return { invoice_id: inv.id, invoice_number: inv.invoice_number, n_entradas: ids.length, n_lineas: lineas.length };
  });
  return emitir();
}

export function createFacturarHorasRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API ──────────────────────────────────────────────────────────────────────
  api.get('/preview', requirePerm('invoices.create'), c => {
    try {
      const proyecto_id = Number(c.req.query('proyecto_id'));
      if (!Number.isInteger(proyecto_id) || proyecto_id <= 0) return c.json({ error: 'Falta el proyecto' }, 400);
      return c.json(previewFacturaHoras(db, { proyecto_id, desde: c.req.query('desde') || '', hasta: c.req.query('hasta') || '' }));
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/', requirePerm('invoices.create'), validate(facturarHorasSchema), c => {
    try {
      const r = facturarHoras(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Facturó horas', ENTITY.INVOICE, r.invoice_id, r.invoice_number + ' · ' + r.n_entradas + ' entradas');
      return c.json({ ...r, message: 'Factura ' + r.invoice_number + ' creada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── VISTA (server-rendered, con candado invoices.create) ─────────────────────
  views.get('/', requirePerm('invoices.create'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const iva = ivaEmpresa(db);
    // Solo proyectos ACTIVOS y con cliente (sin cliente no se puede facturar; se avisa en la propia opción).
    const proyectos = db.prepare(
      `SELECT p.id, p.codigo, p.nombre, p.cliente_id, c.name AS cliente_nombre
         FROM proyectos p LEFT JOIN clients c ON c.id=p.cliente_id
        WHERE p.active=1 ORDER BY p.nombre`).all();
    const proyOptions = proyectos.map(p => {
      const sinCliente = !p.cliente_id;
      return '<option value="' + p.id + '"' + (sinCliente ? ' data-sincliente="1"' : '') + '>'
        + escHtml((p.codigo ? p.codigo + ' · ' : '') + p.nombre + (sinCliente ? '  (sin cliente)' : ' — ' + (p.cliente_nombre || ''))) + '</option>';
    }).join('');

    const content = `
      <div class="ph"><h2>Facturar horas</h2></div>

      <div class="card" style="margin-bottom:1rem"><div class="card-body">
        <div style="display:flex;gap:.6rem;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="flex:2;min-width:240px;margin:0"><label class="form-label">Proyecto *</label>
            <select class="form-control" id="fhProyecto" onchange="fhCargar()">
              <option value="">— Elige un proyecto —</option>${proyOptions || ''}
            </select></div>
          <div class="form-group" style="margin:0"><label class="form-label">Desde</label><input class="form-control" id="fhDesde" type="date" onchange="fhCargar()"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Hasta</label><input class="form-control" id="fhHasta" type="date" onchange="fhCargar()"></div>
        </div>
        <div id="fhAvisoCliente" class="alert" style="display:none;margin:.75rem 0 0;background:var(--danger-soft,rgba(220,50,50,.12));color:var(--danger,#b23)">
          Este proyecto no tiene cliente asignado. <a href="/admin/proyectos" style="color:inherit;font-weight:600;text-decoration:underline">Asígnalo en Proyectos</a> antes de facturar sus horas.
        </div>
      </div></div>

      <div id="fhBody"><div class="card"><div class="card-body" style="color:var(--muted)">Elige un proyecto para ver sus horas facturables.</div></div></div>

      <script>
      const FH_SYM=${JSON.stringify(sym)}, FH_IVA=${JSON.stringify(iva)};
      const eur=v=>FH_SYM+Number(v||0).toFixed(2);
      const fmtDur=s=>{ s=Math.max(0,Math.round(s||0)); const m=Math.floor((s%3600)/60); return Math.floor(s/3600)+'h '+(m<10?'0':'')+m+'m'; };
      let FH_DATA=null;

      async function fhCargar(){
        const pid=document.getElementById('fhProyecto').value;
        const body=document.getElementById('fhBody');
        const opt=document.getElementById('fhProyecto').selectedOptions[0];
        const sinCliente = opt && opt.getAttribute('data-sincliente')==='1';
        document.getElementById('fhAvisoCliente').style.display = sinCliente ? 'block' : 'none';
        if(!pid){ body.innerHTML='<div class="card"><div class="card-body" style="color:var(--muted)">Elige un proyecto para ver sus horas facturables.</div></div>'; FH_DATA=null; return; }
        body.innerHTML='<div class="card"><div class="card-body" style="color:var(--muted)">Cargando…</div></div>';
        const qs=new URLSearchParams({proyecto_id:pid});
        const d1=document.getElementById('fhDesde').value, d2=document.getElementById('fhHasta').value;
        if(d1) qs.set('desde',d1); if(d2) qs.set('hasta',d2);
        try{ FH_DATA=await api('GET','/api/erp/facturar-horas/preview?'+qs.toString()); }catch(e){ body.innerHTML='<div class="card"><div class="card-body" style="color:var(--danger,#b23)">'+escHtml(e.message)+'</div></div>'; return; }
        fhRender();
      }
      function fhSel(){ return [...document.querySelectorAll('.fhChk:checked')].map(x=>parseInt(x.value)); }
      function fhRender(){
        const d=FH_DATA; const body=document.getElementById('fhBody');
        const ent=d.entradas||[];
        if(!ent.length){ body.innerHTML='<div class="card"><div class="card-body" style="color:var(--muted)">No hay horas facturables en este proyecto'+((document.getElementById('fhDesde').value||document.getElementById('fhHasta').value)?' en ese rango':'')+'. (Ya facturadas o no facturables no aparecen.)</div></div>'; return; }
        const filas=ent.map(e=>{
          const dis=e.sin_tarifa;
          return '<tr'+(dis?' style="opacity:.55"':'')+'><td>'+(dis?'<span title="Sin tarifa: pon la tarifa/hora de la persona en Usuarios">—</span>':'<input type="checkbox" class="fhChk" value="'+e.id+'" checked onchange="fhRecalc()">')+'</td>'
            +'<td style="color:var(--muted);font-size:.8rem">'+escHtml(e.fecha)+'</td><td>'+escHtml(e.user_nombre||'')+'</td>'
            +'<td>'+escHtml(e.descripcion||'—')+'</td><td style="white-space:nowrap">'+fmtDur(e.duracion_seg)+'</td>'
            +'<td style="white-space:nowrap">'+(dis?'<span style="color:var(--danger,#b23)">sin tarifa</span>':eur(e.tarifa_efectiva)+'/h')+'</td>'
            +'<td style="white-space:nowrap">'+(dis?'—':eur(e.importe))+'</td></tr>';
        }).join('');
        body.innerHTML=
          '<div class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Horas facturables</h3></div>'
          +'<div class="table-wrap"><table><thead><tr><th style="width:2rem"><input type="checkbox" id="fhAll" checked onchange="fhToggleAll(this.checked)"></th><th>Fecha</th><th>Persona</th><th>Descripción</th><th>Duración</th><th>Tarifa</th><th>Importe</th></tr></thead><tbody>'+filas+'</tbody></table></div>'
          +(d.resumen.n_sin_tarifa?'<div class="card-body" style="color:var(--muted);font-size:.85rem">'+d.resumen.n_sin_tarifa+' entrada(s) sin tarifa no se pueden facturar (ponles tarifa en Usuarios).</div>':'')
          +'</div>'
          +'<div class="card"><div class="card-head"><h3>Vista previa de la factura</h3></div><div class="card-body">'
          +'<div style="display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1rem">'
          +'<div class="form-group" style="margin:0"><label class="form-label">Fecha de emisión</label><input class="form-control" id="fhIssue" type="date"></div>'
          +'<div class="form-group" style="margin:0"><label class="form-label">IVA %</label><input class="form-control" id="fhIva" type="number" min="0" max="100" step="0.01" value="'+FH_IVA+'" onchange="fhRecalc()" style="width:6rem"></div>'
          +'<div class="form-group" style="margin:0"><label class="form-label">IRPF %</label><input class="form-control" id="fhIrpf" type="number" min="0" max="60" step="0.01" value="0" onchange="fhRecalc()" style="width:6rem"></div>'
          +'</div>'
          +'<div id="fhPreview"></div>'
          +'<div style="display:flex;justify-content:flex-end;margin-top:1rem"><button class="btn btn-primary" id="fhBtn" onclick="fhEmitir()">Generar factura</button></div>'
          +'</div></div>';
        fhRecalc();
      }
      function fhToggleAll(on){ document.querySelectorAll('.fhChk').forEach(x=>x.checked=on); fhRecalc(); }
      // Reagrupa EN EL NAVEGADOR con la misma regla del servidor (tarea+tarifa) para la vista previa. La
      // verdad la emite el servidor; esto es solo el reflejo de lo que se va a crear.
      function fhRecalc(){
        const sel=new Set(fhSel());
        const iva=parseFloat(document.getElementById('fhIva').value)||0;
        const irpf=parseFloat(document.getElementById('fhIrpf').value)||0;
        const ent=(FH_DATA.entradas||[]).filter(e=>!e.sin_tarifa && sel.has(e.id));
        const grupos=new Map();
        for(const e of ent){ const desc=(e.descripcion||'').trim(); const key=desc.toLowerCase()+'|'+e.tarifa_efectiva;
          if(!grupos.has(key)) grupos.set(key,{descripcion:desc,tarifa:e.tarifa_efectiva,seg:0}); grupos.get(key).seg+=e.duracion_seg||0; }
        const r2=n=>Math.round(n*100)/100;
        const lineas=[...grupos.values()].map(g=>{ const horas=r2(g.seg/3600); return {descripcion:g.descripcion||'Servicios profesionales',horas,tarifa:g.tarifa,base:r2(horas*g.tarifa)}; });
        let subtotal=0; for(const l of lineas) subtotal+=l.base; subtotal=r2(subtotal);
        const totalIva=r2(subtotal*iva/100), totalIrpf=r2(subtotal*irpf/100);
        const total=r2(subtotal+totalIva-totalIrpf);
        const prev=document.getElementById('fhPreview');
        const btn=document.getElementById('fhBtn');
        if(!lineas.length){ prev.innerHTML='<div style="color:var(--muted)">Selecciona al menos una entrada con tarifa.</div>'; if(btn) btn.disabled=true; return; }
        if(btn) btn.disabled=false;
        prev.innerHTML='<div class="table-wrap"><table><thead><tr><th>Concepto</th><th>Horas</th><th>Precio/h</th><th>Base</th></tr></thead><tbody>'
          +lineas.map(l=>'<tr><td>'+escHtml(l.descripcion)+'</td><td style="white-space:nowrap">'+l.horas.toFixed(2)+' h</td><td style="white-space:nowrap">'+eur(l.tarifa)+'</td><td style="white-space:nowrap">'+eur(l.base)+'</td></tr>').join('')
          +'</tbody></table></div>'
          +'<div style="margin-top:.75rem;text-align:right;line-height:1.8">'
          +'Base imponible: <strong>'+eur(subtotal)+'</strong><br>'
          +'IVA ('+iva+'%): <strong>'+eur(totalIva)+'</strong>'
          +(irpf>0?'<br>IRPF (−'+irpf+'%): <strong>−'+eur(totalIrpf)+'</strong>':'')
          +'<br><span style="font-size:1.1rem">Total: <strong>'+eur(total)+'</strong></span></div>';
      }
      async function fhEmitir(){
        const sel=fhSel();
        if(!sel.length){ toast('Selecciona al menos una entrada','err'); return; }
        if(!await window.confirmarEnPagina({titulo:'Facturar estas horas',texto:'Se creará una factura REAL con '+sel.length+' entrada(s). Esas entradas quedarán bloqueadas.',aceptar:'Sí, facturar'})) return;
        const btn=document.getElementById('fhBtn'); if(btn) btn.disabled=true;
        const body={
          proyecto_id:parseInt(document.getElementById('fhProyecto').value),
          entry_ids:sel,
          issue_date:document.getElementById('fhIssue').value||'',
          tax_rate:parseFloat(document.getElementById('fhIva').value)||0,
          irpf_rate:parseFloat(document.getElementById('fhIrpf').value)||0,
        };
        try{ const d=await api('POST','/api/erp/facturar-horas',body); toast(d.message||'Factura creada'); location.href='/admin/invoices/'+d.invoice_id; }
        catch(e){ toast(e.message,'err'); if(btn) btn.disabled=false; }
      }
      </script>`;
    return c.html(adminLayout('Facturar horas', content, 'facturar-horas', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
