// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA FICHA DE CLIENTE — componente compartido (ventana flotante + tarjetas + capas)
//
// UN SOLO SITIO donde se define cómo es una tarjeta y cómo se comporta la ventana. La ventana
// flotante de la lista y la página entera del cliente incluyen ESTO, no dos copias parecidas: si una
// tarjeta se arregla, se arregla en las dos, y no puede volver a pasar que el modal corte el texto y
// la página no.
//
// ── POR QUÉ EL TEXTO NO SE PUEDE SALIR (D1) ──────────────────────────────────────────────────────
// El fallo anterior no era "alto fijo" —no había ninguno—: era una rejilla de columnas de 150 px
// donde una frase de 60 caracteres necesitaba cuatro líneas, y estiraba las ocho tarjetas a 120 px.
// Y en la ventana, una tabla de siete columnas 24 px más ancha que su caja, que cortaba el botón
// "Gestionar" por el borde. Las tres reglas que lo impiden por construcción:
//
//   1. Las tres líneas de la tarjeta son `white-space:nowrap` + `text-overflow:ellipsis`, con el
//      valor completo en `title`. Un texto largo no crece: se corta con puntos suspensivos.
//   2. La rejilla es `grid` con `align-items:stretch` (el defecto): todas las tarjetas de una fila
//      miden lo mismo SIN que nadie fije un alto. Alto automático, alturas iguales.
//   3. Todo lo ancho (tablas) va dentro de `.bf-scroll{overflow-x:auto}` y `min-width:0` en los
//      flex/grid que lo contienen — sin `min-width:0` un hijo de flex se niega a encoger y desborda
//      a su padre por debajo, que es exactamente lo que hacía la tabla de facturas.
//
// ── LA VENTANA (A) ───────────────────────────────────────────────────────────────────────────────
// Tiene dirección propia (`pushState` a /admin/clients/<id>): se copia, se comparte y al recargar
// abre la página entera. Atrás cierra y devuelve a la lista con su filtro y su página, porque la
// entrada anterior del historial ES la lista con su query.
//
// Se navega EN CAPAS, no en ventanas apiladas: resumen → detalle → volver. `capa()` sustituye el
// contenido; nunca hay dos overlays vivos a la vez. Es una invariante que el gate comprueba contando
// `.bf-win-overlay.open` en el DOM.
//
// En móvil es hoja inferior arrastrable (A4): mismo HTML, otra caja.

// ── LOS ESTILOS ─────────────────────────────────────────────────────────────────────────────────
export function fichaClienteCSS() {
  return `
    /* Tarjetas — el componente único. Alto automático, alturas iguales, texto que jamás se sale. */
    .bf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.6rem;margin-bottom:1rem}
    .bf-card{display:flex;flex-direction:column;gap:.15rem;text-align:left;width:100%;min-width:0;
      background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:.7rem .85rem;
      font-family:inherit;cursor:pointer;position:relative;transition:border-color .15s,box-shadow .15s}
    .bf-card:hover,.bf-card:focus-visible{border-color:var(--accent);box-shadow:0 2px 10px rgba(47,107,255,.12);outline:none}
    .bf-card[disabled]{cursor:default}
    .bf-card[disabled]:hover{border-color:var(--border2);box-shadow:none}
    .bf-card>span{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-k{font-size:.68rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);padding-right:.9rem}
    .bf-v{font-size:1.12rem;font-weight:700;letter-spacing:-.01em;color:var(--text)}
    .bf-v.na{font-size:1rem;color:var(--text3);font-weight:600}
    .bf-s{font-size:.72rem;color:var(--text2)}
    .bf-go{position:absolute;top:.6rem;right:.6rem;color:var(--text3);font-size:.8rem}
    .bf-card:hover .bf-go{color:var(--accent)}

    /* Chips de contador. Siguen visibles a 0, en gris: un 0 es información. */
    .bf-chips{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
    .bf-chips a{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--border2);border-radius:999px;
      padding:.35rem .7rem;text-decoration:none;color:var(--text2);background:var(--bg2);font-size:.8rem;max-width:100%}
    .bf-chips a:hover{border-color:var(--accent);color:var(--accent)}
    .bf-chips a .n{font-weight:700;color:var(--text)}
    .bf-chips a.cero,.bf-chips a.cero .n{color:var(--text3)}

    /* DISA recomienda: UNA caja por familia, con la decisión y sus botones. */
    .bf-rec{border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0;
      padding:.7rem .9rem;margin-bottom:.6rem}
    .bf-rec .q{font-size:.87rem;color:var(--text);line-height:1.45}
    .bf-rec .r{font-size:.87rem;color:var(--text);font-weight:600;margin-top:.2rem}
    .bf-rec .acts{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.55rem}
    .bf-rec .porque{margin-top:.45rem;font-size:.76rem;color:var(--text2)}
    .bf-rec .porque summary{cursor:pointer;color:var(--accent)}
    .bf-rec .porque ul{margin:.35rem 0 0 1rem;padding:0}
    .bf-rec .porque li{margin-bottom:.15rem}

    /* Ranking "Qué te compra" */
    .bf-rank{display:flex;flex-direction:column}
    .bf-rank .fila{display:flex;align-items:baseline;gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--border);min-width:0}
    .bf-rank .fila:last-child{border-bottom:none}
    .bf-rank .nom{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem}
    .bf-rank .ud{color:var(--text3);font-size:.76rem;white-space:nowrap}
    .bf-rank .im{font-weight:600;white-space:nowrap;font-size:.86rem}

    /* Listas de detalle (las capas). Cualquier cosa ancha, a su propio scroll. */
    .bf-scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}
    .bf-list{display:flex;flex-direction:column}
    .bf-li{display:flex;align-items:baseline;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--border);min-width:0}
    .bf-li:last-child{border-bottom:none}
    .bf-li .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem}
    .bf-li .f{color:var(--text3);font-size:.75rem;white-space:nowrap}
    .bf-li .im{font-weight:600;white-space:nowrap;font-size:.86rem;text-align:right}
    .bf-nota{font-size:.78rem;color:var(--text2);background:var(--bg3);border-radius:8px;padding:.55rem .7rem;margin-bottom:.75rem;line-height:1.45}
    .bf-resumen{font-size:.9rem;font-weight:600;margin-bottom:.6rem}
    .bf-vacio{font-size:.85rem;color:var(--text2);padding:.6rem 0}
    .bf-h{font-size:.8rem;font-weight:600;color:var(--text2);margin:1rem 0 .35rem}

    /* Desglose de margen: SIEMPRE las dos cifras (G3). */
    .bf-mg{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.6rem;margin-bottom:.75rem}
    .bf-mg>div{border:1px solid var(--border2);border-radius:10px;padding:.6rem .75rem;min-width:0}
    .bf-mg .p{font-size:1.25rem;font-weight:700;letter-spacing:-.01em}
    .bf-mg .p.titular{color:var(--accent)}
    .bf-mg .e{font-size:.72rem;color:var(--text2);margin-top:.1rem}
    .bf-mg .tag{font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:600}

    /* ── LA VENTANA FLOTANTE ── */
    .bf-win-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:220;
      align-items:center;justify-content:center;padding:1.25rem;backdrop-filter:blur(4px)}
    .bf-win-overlay.open{display:flex}
    .bf-win{background:var(--bg2);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:720px;
      max-height:88vh;display:flex;flex-direction:column;min-width:0;box-shadow:0 30px 80px rgba(0,0,0,.35)}
    .bf-win-head{display:flex;align-items:center;gap:.5rem;padding:.9rem 1.1rem;border-bottom:1px solid var(--border);min-width:0}
    .bf-win-head .tit{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.95rem;font-weight:600}
    .bf-win-head .sub{font-size:.74rem;color:var(--text3);font-weight:400;margin-top:.1rem;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-icon{background:none;border:none;cursor:pointer;color:var(--text3);font-size:1.1rem;padding:.25rem .35rem;
      border-radius:8px;line-height:1;font-family:inherit}
    .bf-icon:hover{color:var(--text);background:var(--bg3)}
    .bf-win-body{padding:1.1rem;overflow-y:auto;overflow-x:hidden;min-width:0;flex:1}
    .bf-win-foot{padding:.75rem 1.1rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:.5rem}
    .bf-grab{display:none}

    @media(max-width:640px){
      .bf-win-overlay{padding:0;align-items:flex-end}
      .bf-win{max-width:100%;max-height:94vh;border-radius:18px 18px 0 0;transition:transform .18s ease-out}
      .bf-win.arrastrando{transition:none}
      .bf-grab{display:block;width:40px;height:4px;border-radius:99px;background:var(--border2);
        margin:.5rem auto .1rem;flex:none}
      .bf-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    @media(max-width:400px){ .bf-cards{grid-template-columns:1fr} }
  `;
}

// ── EL COMPORTAMIENTO ───────────────────────────────────────────────────────────────────────────
// `sym` es el símbolo de moneda del negocio; `base` es la dirección de la lista a la que volver.
export function fichaClienteJS({ sym = '€' } = {}) {
  return `
  (function(){
    var SYM = ${JSON.stringify(sym)};
    // Mismo formato que el servidor (margen.js): español de verdad, con punto de millar SIEMPRE.
    // Un "€4018.00" en una ficha española no es un detalle: es la señal de que el número lo escribió
    // alguien que no estaba mirando la pantalla.
    function num(n, d){ return Number(n).toLocaleString('es-ES',
      { minimumFractionDigits:d, maximumFractionDigits:d, useGrouping:'always' }); }
    function eur(n){ return (n==null||n==='') ? '—' : num(n,2)+' '+SYM; }
    function pct(n){ return n==null ? '—' : num(n,1)+' %'; }
    function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

    // ── LA TARJETA ────────────────────────────────────────────────────────────────────────────────
    // Tres líneas, las tres recortadas con puntos suspensivos y con el valor entero en \`title\`.
    // \`clave\` la hace pulsable; sin clave sale inerte (y sin flecha), no rota.
    function tarjeta(o){
      var na = o.na ? ' na' : '';
      var pulsable = !!o.clave;
      return '<button type="button" class="bf-card"'
        + (pulsable ? ' data-tarjeta="'+esc(o.clave)+'"' : ' disabled')
        + ' aria-label="'+esc(o.k)+': '+esc(o.vTxt||o.v)+'">'
        + '<span class="bf-k" title="'+esc(o.k)+'">'+esc(o.k)+'</span>'
        + '<span class="bf-v'+na+'" title="'+esc(o.vTxt||o.v)+'">'+esc(o.v)+'</span>'
        + (o.s ? '<span class="bf-s" title="'+esc(o.sTxt||o.s)+'">'+esc(o.s)+'</span>' : '')
        + (pulsable ? '<i class="ti ti-chevron-right bf-go" aria-hidden="true"></i>' : '')
        + '</button>';
    }

    // Las OCHO tarjetas, en el orden de siempre. Cada subtítulo es CORTO a propósito (D4): la frase
    // larga vive en el detalle, no en una caja de 190 px.
    function tarjetasHTML(D){
      var c = D.cabecera || {}, out = [];
      var mm = c.margen_modo || 'venta';
      out.push(tarjeta({ clave:'desde', k:'Cliente desde',
        v: c.desde && c.desde.fecha ? c.desde.fecha : '—', na: !(c.desde && c.desde.fecha),
        s: c.desde && c.desde.fecha ? null : (c.desde && c.desde.nota) || 'Aún no te ha comprado' }));
      out.push(tarjeta({ clave:'ultima', k:'Última vez que vino',
        v: c.ultima ? c.ultima.fecha : '—', na: !c.ultima,
        s: c.ultima ? ('hace '+c.ultima.dias+' días') : 'Todavía no ha venido' }));
      if (c.ritmo) {
        out.push(tarjeta({ clave:'ritmo', k:'Cada cuánto viene',
          v: c.ritmo.ritmo_dias ? ('cada '+c.ritmo.ritmo_dias+' días') : '—', na: !c.ritmo.ritmo_dias,
          s: c.ritmo.ritmo_dias ? (c.ritmo.visitas+' visitas') : (c.ritmo.falta ? ('Faltan '+c.ritmo.falta+' visitas') : 'Aún no ha venido'),
          sTxt: c.ritmo.motivo || null }));
      }
      if (c.gasto) {
        out.push(tarjeta({ clave:'gasto', k:'Gasto total', v: eur(c.gasto.total),
          s: c.gasto.facturas+' facturas · sin IVA' }));
        out.push(tarjeta({ clave:'doce', k:'Últimos 12 meses', v: eur(c.gasto.doce_meses), s:'sin IVA' }));
        out.push(tarjeta({ clave:'ticket', k:'Ticket medio',
          v: c.ticket_medio==null ? '—' : eur(c.ticket_medio), na: c.ticket_medio==null,
          s: c.ticket_medio==null ? 'Todavía sin facturas' : 'por factura' }));
      }
      if (c.deuda) {
        out.push(tarjeta({ clave:'deuda', k:'Te debe', v: eur(c.deuda.total),
          s: c.deuda.total>0 ? (c.deuda.oldest ? ('la más antigua: '+c.deuda.oldest.invoice_number) : 'pendiente')
                             : 'no te debe nada' }));
      }
      if (c.margen) {
        // EL PORCENTAJE NUNCA VA DESNUDO (G3): el subtítulo dice sobre qué se divide, aquí mismo.
        var t = mm==='coste' ? c.margen.pctCoste : c.margen.pctVenta;
        var suf = mm==='coste' ? 'sobre lo que te costó' : 'sobre lo que cobras';
        out.push(tarjeta({ clave:'margen', k:'Margen que deja',
          v: c.margen.euros==null ? '—' : eur(c.margen.euros), na: c.margen.euros==null,
          s: t==null ? 'sin coste conocido' : (pct(t)+' '+suf),
          sTxt: t==null ? 'Ninguna línea suya tiene coste conocido' : (pct(t)+' '+suf) }));
      }
      return '<div class="bf-cards">'+out.join('')+'</div>';
    }

    // ── DISA RECOMIENDA (bloque C) ────────────────────────────────────────────────────────────────
    // Sin nada que recomendar no se pinta NADA. Ni un "todo en orden": el silencio ya lo dice.
    function recomiendaHTML(recs){
      if (!recs || !recs.length) return '';
      return recs.map(function(r){
        var acts = '';
        if (r.accion) acts += '<button type="button" class="btn btn-primary btn-sm" data-rec="'+esc(r.accion.tipo)+'">'+esc(r.accion.texto)+'</button>';
        acts += '<button type="button" class="btn btn-secondary btn-sm" data-rec="disa" data-fam="'+esc(r.key)+'">Preguntar a DISA cómo</button>';
        var detras = (r.detras && r.detras.length>1)
          ? '<details class="porque"><summary>Ver los '+r.detras.length+' documentos</summary><ul>'
            + r.detras.map(function(d){ return '<li>'+esc(d.titulo)+(d.cifra!=null?' · '+eur(d.cifra):'')+'</li>'; }).join('')
            + '</ul></details>' : '';
        return '<div class="bf-rec"><div class="q">'+esc(r.titulo)+(r.antiguedad?' '+esc(r.antiguedad):'')+'</div>'
          + (r.recomienda ? '<div class="r">'+esc(r.recomienda)+'</div>' : '')
          + '<div class="acts">'+acts+'</div>'+detras+'</div>';
      }).join('');
    }

    function chipsHTML(cont){
      if (!cont || !cont.length) return '';
      return '<div class="bf-chips">'+cont.map(function(x){
        // "Te debe" ya es una tarjeta: el chip de deuda desaparece para no decir lo mismo dos veces.
        if (x.key === 'deuda') return '';
        var cero = (x.n===0) ? ' cero' : '';
        return '<a class="'+cero.trim()+'" href="'+esc(x.href)+'"><i class="ti '+esc(x.icon)+'"></i> '
          + esc(x.etiqueta)+' <span class="n">'+x.n+'</span></a>';
      }).join('')+'</div>';
    }

    function queCompraHTML(compra, n){
      if (!compra || !compra.length) return '';
      var lista = n ? compra.slice(0,n) : compra;
      var html = '<div class="bf-rank">'+lista.map(function(x){
        return '<div class="fila"><span class="nom" title="'+esc(x.nombre)+'">'+esc(x.nombre)+'</span>'
          + '<span class="ud">'+x.veces+'×</span><span class="im">'+eur(x.base)+'</span></div>';
      }).join('')+'</div>';
      if (n && compra.length>n) html += '<div style="padding-top:.5rem"><button type="button" class="btn btn-secondary btn-sm" data-tarjeta="compra">Ver todos ('+compra.length+')</button></div>';
      return html;
    }

    // ── EL DESGLOSE DE MARGEN (G3) ────────────────────────────────────────────────────────────────
    // SIEMPRE los dos porcentajes, el importe en euros y lo que queda fuera. Este bloque es la
    // respuesta al fallo de 0.2: el denominador deja de ser invisible.
    function margenHTML(m, modo){
      if (!m) return '';
      var tv = modo!=='coste', out = '';
      out += '<div class="bf-mg">'
        + '<div><div class="tag">Sobre lo que cobras</div><div class="p'+(tv?' titular':'')+'">'+pct(m.pctVenta)+'</div>'
        + '<div class="e">'+eur(m.euros)+' de '+eur(m.venta)+'</div></div>'
        + '<div><div class="tag">Sobre lo que te costó</div><div class="p'+(tv?'':' titular')+'">'+pct(m.pctCoste)+'</div>'
        + '<div class="e">'+eur(m.euros)+' sobre '+eur(m.coste)+'</div></div>'
        + '<div><div class="tag">Lo que te queda</div><div class="p">'+eur(m.euros)+'</div>'
        + '<div class="e">el mismo importe en los dos</div></div>'
        + '</div>';
      out += '<div class="bf-nota">'+ (m.fuera>0
        ? 'Los dos porcentajes se calculan sobre <strong>'+eur(m.venta)+'</strong>, que es la parte con coste conocido. '
          + 'Quedan fuera <strong>'+eur(m.fuera)+'</strong> ('+pct(m.fueraPct)+' de los '+eur(m.total)+' que te compró) porque esas líneas no tienen coste apuntado.'
        : (m.hay ? 'Todo lo que te compró tiene coste conocido: los porcentajes salen sobre el total.'
                 : 'Ninguna línea suya tiene coste apuntado, así que no se puede calcular margen. No es un 0: es que no se sabe.'))
        + '</div>';
      return out;
    }

    // ── LISTAS DE DETALLE ─────────────────────────────────────────────────────────────────────────
    function listaHTML(filas, opts){
      opts = opts || {};
      if (!filas || !filas.length) return '';
      return '<div class="bf-list">'+filas.map(function(f){
        var t = f.href ? '<a href="'+esc(f.href)+'" target="_blank" rel="noopener">'+esc(f.titulo)+'</a>' : esc(f.titulo);
        var im = opts.margen
          ? (f.euros==null ? '<span style="color:var(--text3)">sin coste</span>' : eur(f.euros))
          : (f.importe==null ? '' : eur(f.importe));
        var sub = opts.margen && f.venta
          ? '<span class="f">'+eur(f.venta)+' − '+eur(f.coste)+(f.fuera>0?' · '+eur(f.fuera)+' sin coste':'')+'</span>' : '';
        return '<div class="bf-li"><span class="t" title="'+esc(f.titulo)+'">'+t
          +(f.detalle?' <span class="f">'+esc(f.detalle)+'</span>':'')+'</span>'
          + sub + '<span class="f">'+esc(f.fecha||'')+'</span><span class="im">'+im+'</span></div>';
      }).join('')+'</div>';
    }

    window.BF = {
      eur: eur, pct: pct, esc: esc, num: num,
      tarjeta: tarjeta, tarjetasHTML: tarjetasHTML, recomiendaHTML: recomiendaHTML,
      chipsHTML: chipsHTML, queCompraHTML: queCompraHTML, margenHTML: margenHTML, listaHTML: listaHTML,
    };
  })();
  `;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA VENTANA Y SUS CAPAS (bloque A) — el mismo código para el modal y para la página entera
//
// `montaje:'ventana'` (lista de clientes) crea el overlay y le da dirección propia.
// `montaje:'pagina'`  (ficha completa) usa el hueco que ya hay en la página: las mismas tarjetas
//                     abren la misma capa de detalle, sin overlay ninguno.
//
// LA INVARIANTE: NUNCA hay dos ventanas apiladas. `capa()` SUSTITUYE el contenido de la única
// ventana viva; no crea otra. El gate lo comprueba contando `.bf-win-overlay.open` en el DOM.
export function fichaVentanaJS({ montaje = 'ventana' } = {}) {
  return `
  (function(){
    var MONTAJE = ${JSON.stringify(montaje)};
    var D = null;              // los datos del cliente abierto
    var ID = null;             // su id
    var capaActual = 'resumen';
    var urlLista = null;       // a dónde volver (con su filtro y su página)
    // CUÁNTAS entradas hemos metido nosotros en el historial (0, 1 la ventana, 2 la ventana + capa).
    // Con un booleano esto estaba MAL: el atrás de la capa disparaba popstate, el manejador creía
    // que el usuario quería salir y cerraba la ventana entera. Hay que saber a qué altura estamos.
    var profundidad = 0;

    function $(s, r){ return (r||document).querySelector(s); }
    function api(m, u, b){
      return fetch(u, { method:m, headers:{'Content-Type':'application/json'},
        body: b?JSON.stringify(b):undefined })
        .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||r.status); return j; }); });
    }

    // ── EL ARMAZÓN ────────────────────────────────────────────────────────────────────────────────
    function armazon(){
      var o = document.getElementById('bfWin');
      if (o) return o;
      o = document.createElement('div');
      o.id = 'bfWin'; o.className = 'bf-win-overlay'; o.setAttribute('role','dialog'); o.setAttribute('aria-modal','true');
      o.innerHTML = '<div class="bf-win">'
        + '<div class="bf-grab" id="bfGrab"></div>'
        + '<div class="bf-win-head">'
        +   '<button type="button" class="bf-icon" id="bfAtras" style="display:none" aria-label="Volver"><i class="ti ti-arrow-left"></i></button>'
        +   '<div style="flex:1;min-width:0"><div class="tit" id="bfTit">…</div><div class="sub" id="bfSub"></div></div>'
        +   '<button type="button" class="bf-icon" id="bfCerrar" aria-label="Cerrar"><i class="ti ti-x"></i></button>'
        + '</div>'
        + '<div class="bf-win-body" id="bfBody"></div>'
        // B1.5 — el pie. Va abajo del todo porque es lo ultimo del orden que manda la ventana:
        // cabecera, DISA, tarjetas, que te compra, y la salida hacia el detalle largo.
        + '<div class="bf-win-foot" id="bfFoot"><a class="btn btn-secondary btn-sm" id="bfFull" href="#">Ver ficha completa →</a></div>'
        + '</div>';
      document.body.appendChild(o);
      // Se cierra pulsando FUERA (en el overlay, no en la ventana).
      o.addEventListener('click', function(e){ if (e.target === o) cerrar(); });
      $('#bfCerrar', o).addEventListener('click', cerrar);
      $('#bfAtras', o).addEventListener('click', volver);
      montarArrastre(o);
      return o;
    }

    // A4 — En móvil es una hoja inferior que se arrastra hacia abajo para cerrarla. Solo con dedo
    // (pointer táctil): con ratón el gesto no existe y engancharlo robaría selecciones de texto.
    function montarArrastre(o){
      var win = $('.bf-win', o), y0 = null, dy = 0;
      function empieza(e){
        if (window.innerWidth > 640 || e.pointerType === 'mouse') return;
        var b = $('#bfBody', o);
        if (b && b.scrollTop > 0) return;          // si el contenido está bajado, manda el scroll
        y0 = e.clientY; dy = 0; win.classList.add('arrastrando');
      }
      function mueve(e){
        if (y0 == null) return;
        dy = Math.max(0, e.clientY - y0);
        win.style.transform = 'translateY(' + dy + 'px)';
      }
      function suelta(){
        if (y0 == null) return;
        win.classList.remove('arrastrando');
        win.style.transform = '';
        if (dy > 110) cerrar();
        y0 = null;
      }
      win.addEventListener('pointerdown', empieza);
      win.addEventListener('pointermove', mueve);
      win.addEventListener('pointerup', suelta);
      win.addEventListener('pointercancel', suelta);
    }

    // ── ABRIR ─────────────────────────────────────────────────────────────────────────────────────
    // A2: la ventana TIENE DIRECCIÓN. Se empuja /admin/clients/<id> al historial, así que la barra
    // cambia, se puede copiar y compartir, y al recargar sale la ficha completa (esa ruta existe de
    // verdad en el servidor). Atrás vuelve a la entrada anterior — la lista CON su filtro y su
    // página, porque el listado lleva q/archivados/page en la URL.
    function abrir(id){
      if (MONTAJE !== 'ventana') return;
      ID = id;
      urlLista = location.pathname + location.search;
      var o = armazon();
      $('#bfBody', o).innerHTML = '<div class="skel skel-block" style="height:6rem"></div>';
      $('#bfTit', o).textContent = 'Cargando…';
      $('#bfSub', o).textContent = '';
      $('#bfFull', o).href = '/admin/clients/' + id;
      o.classList.add('open');
      document.body.style.overflow = 'hidden';
      try { history.pushState({ bfWin:id }, '', '/admin/clients/' + id); profundidad = 1; }
      catch(e){ profundidad = 0; }
      cargar(id);
    }

    function cargar(id){
      api('GET','/api/erp/clients/'+id+'/360').then(function(d){
        if (ID !== id) return;
        D = d;
        pintaResumen();
      }).catch(function(e){
        $('#bfBody').innerHTML = '<div class="bf-vacio">No se ha podido abrir la ficha: '+BF.esc(e.message)+'</div>';
      });
    }

    // ── B1: LA VENTANA ES EL RESUMEN, EN ESTE ORDEN Y NADA MÁS ────────────────────────────────────
    //   1 cabecera compacta · 2 lo que recomienda DISA · 3 las tarjetas · 4 qué te compra
    //   5 pie "Ver ficha completa →"
    // Lo que ya NO está aquí (la tabla larga de facturas, la historia, las notas) NO se ha borrado:
    // vive en la ficha completa, a un clic. Nada desaparece del producto (B2).
    function pintaResumen(){
      capaActual = 'resumen';
      var c = D.cliente || {};
      var o = armazon();
      $('#bfTit', o).textContent = c.name || '';
      var datos = [c.client_code, D.fijos && D.fijos.fiscal_id, D.fijos && D.fijos.phone, D.fijos && D.fijos.email]
        .filter(Boolean).join(' · ');
      $('#bfSub', o).textContent = datos;
      $('#bfAtras', o).style.display = 'none';
      $('#bfFoot', o).style.display = '';
      var html = '';
      html += BF.recomiendaHTML(D.recomienda);
      html += BF.tarjetasHTML(D);
      html += BF.chipsHTML(D.contadores);
      if (D.compra && D.compra.length) {
        html += '<div class="bf-h">Qué te compra</div>' + BF.queCompraHTML(D.compra, 5);
      }
      $('#bfBody', o).innerHTML = html;
      $('#bfBody', o).scrollTop = 0;
    }

    // ── A3: LAS CAPAS ─────────────────────────────────────────────────────────────────────────────
    // Sustituye el contenido; NO abre otra ventana. Máximo resumen → detalle → volver.
    function capa(clave, titulo, html){
      var o = armazon();
      if (clave === 'resumen') {
        if (MONTAJE === 'pagina') { pintaPaginaResumen(); return; }
        pintaResumen();
        return;
      }
      capaActual = clave;
      if (MONTAJE === 'pagina') { pintaPaginaCapa(titulo, html); return; }
      $('#bfTit', o).textContent = titulo;
      $('#bfSub', o).textContent = (D && D.cliente ? D.cliente.name : '');
      $('#bfAtras', o).style.display = '';
      $('#bfFoot', o).style.display = 'none';
      $('#bfBody', o).innerHTML = html;
      $('#bfBody', o).scrollTop = 0;
    }

    // Volver de una capa al resumen. Si la capa metió una entrada en el historial, se DESHACE esa
    // entrada y el resumen lo pinta popstate: así el atrás del navegador y esta flecha hacen
    // exactamente lo mismo, que es lo que el usuario espera.
    function volver(){
      if (MONTAJE === 'ventana' && profundidad > 1) { try { history.back(); return; } catch(e){} }
      capa('resumen');
    }

    function cerrar(){
      var o = document.getElementById('bfWin');
      if (!o || !o.classList.contains('open')) return;
      o.classList.remove('open');
      document.body.style.overflow = '';
      ID = null; D = null; capaActual = 'resumen';
      if (profundidad > 0) {
        var n = profundidad; profundidad = 0;
        // Se deshacen DE GOLPE las entradas que metimos (ventana, y capa si la había): el usuario
        // vuelve a la lista de una vez, con su filtro y su página, no capa a capa.
        try { history.go(-n); return; } catch(e){}
      }
      if (urlLista) { try { history.replaceState(null, '', urlLista); } catch(e){} }
    }

    // ── EL ATRÁS DEL NAVEGADOR MANDA ──────────────────────────────────────────────────────────────
    // Tres alturas: lista → ventana → capa. Se lee event.state en vez de adivinar, porque el mismo
    // popstate lo dispara el atrás del navegador, la flecha de la capa y el cerrar de la ventana.
    window.addEventListener('popstate', function(ev){
      var o = document.getElementById('bfWin');
      if (!o || !o.classList.contains('open')) return;
      var st = ev.state || {};
      if (st.bfWin && st.capa) {            // ha vuelto (o avanzado) a una capa
        profundidad = 2;
        pintaTarjeta(st.capa);
        return;
      }
      if (st.bfWin) {                       // ha vuelto al resumen de la ventana
        profundidad = 1;
        capa('resumen');
        return;
      }
      profundidad = 0;                      // ha salido de la ventana: a la lista
      cerrar();
    });
    // Escape cierra (A4). Si hay un detalle abierto, primero vuelve al resumen.
    document.addEventListener('keydown', function(e){
      if (e.key !== 'Escape') return;
      var o = document.getElementById('bfWin');
      if (!o || !o.classList.contains('open')) return;
      if (capaActual !== 'resumen') volver(); else cerrar();
    });

    // ── EL DETALLE DE UNA TARJETA ─────────────────────────────────────────────────────────────────
    var TITULOS = { desde:'Cliente desde', ultima:'Última vez que vino', ritmo:'Cada cuánto viene',
                    gasto:'Gasto total', doce:'Últimos 12 meses', ticket:'Ticket medio',
                    deuda:'Te debe', margen:'Margen que deja' };

    // Pinta una capa SIN tocar el historial. Lo llama popstate (que ya está donde toca) y
    // abrirTarjeta (que empuja antes).
    function pintaTarjeta(clave){
      var id = ID || window.BF_CLIENTE_ID;
      if (!id) return;
      if (clave === 'compra') {
        capa('compra', 'Qué te compra', BF.queCompraHTML((D && D.compra) || window.BF_COMPRA || [], 0));
        return;
      }
      capa(clave, TITULOS[clave] || 'Detalle', '<div class="skel skel-block" style="height:5rem"></div>');
      api('GET','/api/erp/clients/'+id+'/360/tarjeta/'+clave).then(function(d){
        if (capaActual !== clave) return;          // el usuario ya se ha ido a otro sitio
        capa(clave, TITULOS[clave] || d.titulo, detalleHTML(d));
        if (d.gestion) pintaGestionCobro(id);
      }).catch(function(e){
        capa(clave, TITULOS[clave]||'Detalle', '<div class="bf-vacio">'+BF.esc(e.message)+'</div>');
      });
    }

    // Abrir una tarjeta: primero el historial, luego pintar.
    // La capa TAMBIÉN es direccionable: /admin/clients/<id>#margen. Recargar sigue abriendo la ficha
    // completa (el servidor no ve el hash), así que A2 se cumple igual.
    function abrirTarjeta(clave){
      if (MONTAJE === 'ventana' && profundidad === 1) {
        try { history.pushState({ bfWin:ID, capa:clave }, '', '/admin/clients/'+ID+'#'+clave); profundidad = 2; } catch(e){}
      } else if (MONTAJE === 'ventana' && profundidad === 2) {
        // Ya estamos en una capa: se SUSTITUYE, no se apila. Nunca ventana sobre ventana (A3).
        try { history.replaceState({ bfWin:ID, capa:clave }, '', '/admin/clients/'+ID+'#'+clave); } catch(e){}
      }
      pintaTarjeta(clave);
    }

    function detalleHTML(d){
      var h = '';
      if (d.clave === 'margen') h += BF.margenHTML(d.margen, d.modo);
      if (d.resumen) h += '<div class="bf-resumen">'+BF.esc(d.resumen)+'</div>';
      if (d.nota) h += '<div class="bf-nota">'+BF.esc(d.nota)+'</div>';
      if (d.gestion) return h + '<div id="bfGestion"><div class="skel skel-block" style="height:5rem"></div></div>';
      if (d.vacio) return h + '<div class="bf-vacio">'+BF.esc(d.vacio)+'</div>';
      h += BF.listaHTML(d.filas, { margen: d.clave === 'margen' });
      if (d.masTitulo) h += '<div class="bf-h">'+BF.esc(d.masTitulo)+'</div>' + BF.listaHTML(d.mas, {});
      return h;
    }

    // ── D2 · "TE DEBE" ABRE LA GESTIÓN DE COBRO, NO UNA LISTA MUERTA ─────────────────────────────
    // Se reutiliza EL MISMO endpoint y LOS MISMOS botones que ya existían en la ficha (registrar
    // cobro, gestionar, gestionar cuenta): ni un clic de más y ni una regla de cobro nueva.
    function pintaGestionCobro(id){
      var caja = document.getElementById('bfGestion');
      if (!caja) return;
      api('GET','/api/erp/clients/'+id+'/invoices').then(function(deb){
        var badge = {pendiente:'b-yellow',parcial:'b-blue',cobrada:'b-green',vencida:'b-red',abono:'b-gray'};
        var label = {pendiente:'Pendiente',parcial:'Cobrada en parte',cobrada:'Cobrada',vencida:'Vencida',abono:'Abono'};
        var o = deb.oldest;
        var cab = '<div class="alert '+(Number(deb.total||0)>0?'alert-warn':'alert-ok')+'">'
          + 'Te debe <strong>'+BF.eur(deb.total)+'</strong>'
          + (o ? ' · la más antigua: <a href="/admin/invoices/'+o.invoice_id+'" target="_blank" rel="noopener">'+BF.esc(o.invoice_number)+'</a> ('+BF.eur(o.pendiente)+(o.dias_vencida>0?', '+o.dias_vencida+' días vencida':'')+')' : ' · sin deuda pendiente')
          + (Number(deb.total||0)>0.0049 ? ' <button type="button" class="btn btn-primary btn-sm" style="margin-left:.4rem" data-cuenta="'+id+'">Gestionar cuenta</button>' : '')
          + '</div>';
        var filas = (deb.invoices||[]).map(function(f){
          var est = !f.counts
            ? '<span class="badge b-gray" title="No computa como deuda (anulada o rectificada por sustitución)">no computa</span>'
            : '<span class="badge '+(badge[f.estado]||'')+'">'+(label[f.estado]||f.estado)+(f.estado==='vencida'&&f.dias_vencida?' '+f.dias_vencida+'d':'')+'</span>';
          var acc = (f.cobrable && Number(f.pendiente)>0.0049)
            ? '<button type="button" class="btn btn-primary btn-sm" data-cobro="'+f.id+'">Registrar cobro</button> '
              + '<button type="button" class="btn btn-secondary btn-sm" data-gestion="'+f.id+'">Gestionar</button>'
            : '';
          return '<tr><td><a href="/admin/invoices/'+f.id+'" target="_blank" rel="noopener">'+BF.esc(f.invoice_number)+'</a></td>'
            + '<td style="color:var(--text3);font-size:.8rem;white-space:nowrap">'+BF.esc(f.due_date||f.issue_date||'-')+'</td>'
            + '<td style="white-space:nowrap">'+BF.eur(f.total)+'</td>'
            + '<td style="white-space:nowrap">'+(f.counts?BF.eur(f.pendiente):'—')+'</td>'
            + '<td>'+est+'</td><td style="text-align:right;white-space:nowrap">'+acc+'</td></tr>';
        }).join('');
        caja.innerHTML = cab + (filas
          ? '<div class="bf-scroll"><table><thead><tr><th>Factura</th><th>Vence</th><th>Total</th><th>Pendiente</th><th>Cobro</th><th></th></tr></thead><tbody>'+filas+'</tbody></table></div>'
          : '<div class="bf-vacio">Este cliente aún no tiene facturas.</div>');
      }).catch(function(e){ caja.innerHTML = '<div class="bf-vacio">'+BF.esc(e.message)+'</div>'; });
    }

    // ── C3 · PREGUNTAR A DISA CÓMO ────────────────────────────────────────────────────────────────
    // Abre DISA con este cliente en contexto. DISA NO escribe ni envía nada: prepara y el humano
    // valida (CANON). Aquí solo se le entrega la pregunta ya escrita.
    var PREGUNTA = {
      deuda: 'Tengo una cuenta vencida con este cliente. ¿Cómo se la reclamo sin perderlo?',
      pago_pronto: '¿Cómo le recuerdo a este cliente un pago que está a punto de vencer?',
      dormido: 'Este cliente lleva tiempo sin venir. ¿Qué le escribo para recuperarlo?',
      plantones: 'Este cliente ha faltado a varias citas. ¿Cómo se lo planteo?',
      sin_cita: 'Este cliente no tiene próxima cita. ¿Cómo se la propongo?',
    };
    function preguntarDisa(fam){
      var nombre = (D && D.cliente && D.cliente.name) || window.BF_CLIENTE_NOMBRE || '';
      var q = (PREGUNTA[fam] || '¿Qué hago con este cliente?') + ' Cliente: ' + nombre + '.';
      if (typeof window.disaAbrirCon === 'function') { window.disaAbrirCon(q); return; }
      location.href = '/admin/disa?q=' + encodeURIComponent(q);
    }

    // ── UN SOLO ESCUCHADOR PARA TODO ──────────────────────────────────────────────────────────────
    // Delegado, en el documento: el HTML se repinta constantemente y enganchar listeners a cada
    // boton repintado es como se pierden los clics. Ademas evita el onclick inline dentro de un
    // template del servidor, que es donde se cuelan las comillas escapadas que revientan la página.
    document.addEventListener('click', function(e){
      var t = e.target.closest('[data-tarjeta],[data-rec],[data-cobro],[data-gestion],[data-cuenta]');
      if (!t) return;
      var id = ID || window.BF_CLIENTE_ID;
      if (t.hasAttribute('data-tarjeta')) { e.preventDefault(); abrirTarjeta(t.getAttribute('data-tarjeta')); return; }
      if (t.hasAttribute('data-cobro'))   { e.preventDefault(); if (window.openCobros) window.openCobros(+t.getAttribute('data-cobro')); return; }
      if (t.hasAttribute('data-gestion')) { e.preventDefault(); if (window.openGestion) window.openGestion(+t.getAttribute('data-gestion')); return; }
      if (t.hasAttribute('data-cuenta'))  { e.preventDefault(); if (window.openGestionCuenta) window.openGestionCuenta(+t.getAttribute('data-cuenta')); return; }
      if (t.hasAttribute('data-rec')) {
        e.preventDefault();
        var tipo = t.getAttribute('data-rec');
        if (tipo === 'disa')     { preguntarDisa(t.getAttribute('data-fam')); return; }
        if (tipo === 'cuenta')   { abrirTarjeta('deuda'); return; }
        if (tipo === 'historia') { location.href = '/admin/clients/' + id + '#historia'; return; }
        if (tipo === 'citas')    { location.href = '/admin/citas'; return; }
      }
    });

    // ── MONTAJE 'pagina': las mismas tarjetas, la misma capa, sin overlay ─────────────────────────
    function pintaPaginaResumen(){
      capaActual = 'resumen';
      var caja = document.getElementById('f360capa');
      var res  = document.getElementById('f360resumen');
      if (caja) caja.style.display = 'none';
      if (res)  res.style.display = '';
    }
    function pintaPaginaCapa(titulo, html){
      var caja = document.getElementById('f360capa');
      var res  = document.getElementById('f360resumen');
      if (!caja) return;
      caja.innerHTML = '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem">'
        + '<button type="button" class="bf-icon" id="f360atras" aria-label="Volver"><i class="ti ti-arrow-left"></i></button>'
        + '<h3 style="font-size:.95rem;margin:0">'+BF.esc(titulo||'')+'</h3></div>'
        + '<div id="f360capaBody">'+html+'</div>';
      caja.style.display = '';
      if (res) res.style.display = 'none';
      var b = document.getElementById('f360atras');
      if (b) b.addEventListener('click', function(){ capa('resumen'); });
      caja.scrollIntoView({ block:'start', behavior:'smooth' });
    }

    window.BFWin = { abrir: abrir, cerrar: cerrar, capa: capa, abrirTarjeta: abrirTarjeta,
                     resumen: function(){ capa('resumen'); },
                     datos: function(){ return D; }, setDatos: function(d){ D = d; } };
  })();
  `;
}
