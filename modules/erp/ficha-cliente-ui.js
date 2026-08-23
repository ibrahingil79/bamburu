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

// ── F · LOS FICHEROS DEL MAPA ───────────────────────────────────────────────────────────────────
// Leaflet 1.9.4, CONGELADO en `public/vendor/leaflet/` y servido desde 'self'. Nunca desde un CDN:
// esa puerta se cerró en C4b-2 (las cuatro librerías que venían de jsdelivr se cargaban sin
// `integrity`, así que la CSP confiaba a ciegas en un dominio ajeno). Se declara aquí, en el mismo
// fichero que la ficha, porque las DOS pantallas que la pintan —la lista de clientes y la ficha
// completa— tienen que cargar exactamente lo mismo: dos listas parecidas acaban divergiendo.
export function mapaAssetsHTML() {
  return '<link rel="stylesheet" href="/public/vendor/leaflet/leaflet.css">'
       + '<script src="/public/vendor/leaflet/leaflet.js"><' + '/script>';
}

// ── LOS ESTILOS ─────────────────────────────────────────────────────────────────────────────────
export function fichaClienteCSS() {
  return `
    /* ── B2 · EL AIRE DE LAS CAJAS ───────────────────────────────────────────────────────────────
       En Bamburu .card NO lleva padding: vive en .card-body. La ficha escribía el contenido
       directamente dentro de .card, así que TODO su texto tocaba el borde — 17 sitios medidos con
       padding 0. Esto se lo devuelve a las cajas de la ficha sin tocar .card global (que la usan
       cuarenta pantallas más y no es asunto de esta tarea). Se marca con .bf-caja. */
    /* .bf-caja también vive ahora en layout.js, por lo mismo. */

    /* LAS TARJETAS DE CIFRA YA NO SE DEFINEN AQUÍ. Nacieron en esta pantalla el 19 ago 2026 y el
       23 ago (ficha I1) subieron al estilo global de layout.js, que es donde debe vivir un
       componente que usan seis pantallas. Aquí NO queda ni una regla suya: dos copias de un
       componente son dos componentes, y a la segunda semana ya no se parecen. */

    /* C2 · Los datos del cliente. Jerarquía por PESO y ESPACIO, no por marcos (CANON, estilo iOS):
       no llevan caja propia, se apoyan en el aire de la que los contiene. */
    .bf-datos{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem 1.25rem;margin-bottom:1rem}
    .bf-datos>div{min-width:0;display:flex;flex-direction:column;gap:.1rem}
    .bf-datos .k{font-size:.68rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3)}
    .bf-datos .v,.bf-datos .s{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-datos .v{font-size:.88rem;color:var(--text)}
    .bf-datos .s{font-size:.72rem;color:var(--text3)}

    /* D5 · El registro de contactos. Lo AUTOMÁTICO se distingue a simple vista: un correo que mandó
       la máquina no es señal de que el cliente esté vivo, y quien lee la lista tiene que verlo sin
       tener que fijarse. */
    .bf-reg{display:flex;flex-direction:column}
    .bf-reg .ev{display:flex;gap:.7rem;padding:.6rem 0;border-bottom:1px solid var(--border);min-width:0;align-items:flex-start}
    .bf-reg .ev:last-child{border-bottom:none}
    .bf-reg .ev>i.ti{color:var(--text3);margin-top:.15rem;flex-shrink:0}
    .bf-reg .ev.auto>i.ti{color:var(--text3);opacity:.55}
    .bf-reg .cuerpo{flex:1;min-width:0}
    .bf-reg .t{font-size:.87rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-reg .d{font-size:.76rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bf-reg .f{font-size:.74rem;color:var(--text3);white-space:nowrap;text-align:right}
    .bf-auto{display:inline-block;font-size:.64rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;
      background:var(--bg3);color:var(--text3);border-radius:999px;padding:.1rem .45rem;margin-left:.35rem}
    .bf-visita{display:inline-block;font-size:.64rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;
      background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:.1rem .45rem;margin-left:.35rem}
    .bf-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin-bottom:.6rem}
    .bf-form label{display:block;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:.2rem}

    /* C4 · el selector de periodo, DENTRO de la tarjeta abierta. */
    .bf-per{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.8rem}
    .bf-per button{appearance:none;border:1px solid var(--border2);background:var(--bg2);color:var(--text2);
      font-family:inherit;font-size:.78rem;padding:.3rem .7rem;border-radius:999px;cursor:pointer}
    .bf-per button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:600}

    /* Chips de contador. Siguen visibles a 0, en gris: un 0 es información. */
    .bf-chips{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
    .bf-chips a{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--border2);border-radius:999px;
      padding:.35rem .7rem;text-decoration:none;color:var(--text2);background:var(--bg2);font-size:.8rem;max-width:100%}
    .bf-chips a:hover{border-color:var(--accent);color:var(--accent)}
    .bf-chips a .n{font-weight:700;color:var(--text)}
    .bf-chips a.cero,.bf-chips a.cero .n{color:var(--text3)}
    .bf-mas{appearance:none;border:1px dashed var(--border2);background:transparent;color:var(--text3);
      font-family:inherit;font-size:.8rem;padding:.35rem .7rem;border-radius:999px;cursor:pointer}
    .bf-mas:hover{border-color:var(--accent);color:var(--accent)}

    /* DISA recomienda: UNA caja por familia, con la decisión y sus botones. */
    .bf-rec{border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0;
      padding:.7rem .9rem;margin-bottom:.6rem;min-width:0}
    .bf-rec .q{font-size:.87rem;color:var(--text);line-height:1.45}
    .bf-rec .r{font-size:.87rem;color:var(--text);font-weight:600;margin-top:.2rem}
    .bf-rec .acts{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.55rem}
    .bf-rec .porque{margin-top:.45rem;font-size:.76rem;color:var(--text2)}
    .bf-rec .porque summary{cursor:pointer;color:var(--accent)}
    .bf-rec .porque ul{margin:.35rem 0 0 1rem;padding:0;min-width:0;max-width:100%}
    /* Los documentos de detrás llevan el nombre del cliente dentro, así que son largos por
       naturaleza: se recortan como todo lo demás en vez de salirse de la caja del aviso. */
    .bf-rec .porque li{margin-bottom:.15rem;min-width:0;max-width:100%;overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap}
    .bf-rec{min-width:0}

    /* Ranking "Qué te compra" */
    .bf-rank{display:flex;flex-direction:column}
    .bf-rank .fila{display:flex;align-items:baseline;gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--border);min-width:0}
    .bf-rank .fila:last-child{border-bottom:none}
    .bf-rank .nom{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem}
    .bf-rank .ud{color:var(--text3);font-size:.76rem;white-space:nowrap}
    .bf-rank .im{font-weight:600;white-space:nowrap;font-size:.86rem}

    /* Listas de detalle (las capas). Cualquier cosa ancha, a su propio scroll. */
    /* Una tabla ancha tiene que hacer scroll DENTRO de su caja, no salirse por el borde. Sin
       width:max-content en la tabla, las celdas desbordaban sin ensanchar la tabla y el contenedor
       nunca llegaba a tener scroll: medido, 44 px de celdas fuera de la caja a 390 px. */
    .bf-scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}
    .bf-scroll>table{width:max-content;min-width:100%}
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
    }
    /* Los cortes de .bf-cards para pantalla estrecha también son del componente y viven en
       layout.js. Aquí había OTROS (640 y 400 px) que pisaban a los globales solo en esta pantalla:
       un componente con dos juegos de cortes es un componente que se ve distinto según dónde. */
  `;
}

// ── EL COMPORTAMIENTO ───────────────────────────────────────────────────────────────────────────
// `sym` es el símbolo de moneda del negocio; `base` es la dirección de la lista a la que volver.
export function fichaClienteJS({ sym = '€' } = {}) {
  // String.raw a propósito: sin él, el motor se come los escapes de los regex (\s, \*) y al
  // navegador le llega un regex distinto del escrito. Es lo que ya hace JS_AGENDA en citas.js.
  return String.raw`
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
      var na = o.na ? ' na' : (o.tono ? ' ' + o.tono : '');
      var pulsable = !!o.clave;
      return '<button type="button" class="bf-card"'
        + (pulsable ? ' data-tarjeta="'+esc(o.clave)+'"' : ' disabled')
        + ' aria-label="'+esc(o.k)+': '+esc(o.vTxt||o.v)+'">'
        + '<span class="bf-k" title="'+esc(o.k)+'">'+esc(o.k)+'</span>'
        + '<span class="bf-v'+na+'" title="'+esc(o.vTxt||o.v)+'">'+esc(o.v)+'</span>'
        + (o.s ? '<span class="bf-s" title="'+esc(o.sTxt||o.s)+'">'+esc(o.s)+'</span>' : '')
        + (pulsable ? '<i class="ti '+(o.periodo?'ti-adjustments-horizontal':'ti-chevron-right')+' bf-go" aria-hidden="true"></i>' : '')
        + '</button>';
    }

    // ── C1 · LAS OCHO TARJETAS, EN ORDEN DE URGENCIA ─────────────────────────────────────────────
    // Primero lo que exige una decisión hoy, luego lo que describe, y al final lo que sitúa en el
    // tiempo. «Cliente desde» ya no está: no pide ninguna acción, así que baja a los datos del
    // cliente (C2) — no se pierde, cambia de sitio.
    //
    // Cada subtítulo es CORTO a propósito (C6): la frase larga vive en el detalle, no en una caja
    // estrecha. Y donde no hay dato, se dice QUÉ FALTA — nunca un 0 fingido.
    function tarjetasHTML(D){
      var c = D.cabecera || {}, out = [];
      var mm = c.margen_modo || 'venta';
      if (c.deuda) {
        // Rojo SOLO si debe de verdad: un «0,00 €» en rojo asustaría por nada.
        out.push(tarjeta({ clave:'deuda', k:'Te debe', v: eur(c.deuda.total),
          tono: c.deuda.total > 0 ? 'debe' : null,
          s: c.deuda.total>0 ? (c.deuda.oldest ? ('la más antigua: '+c.deuda.oldest.invoice_number) : 'pendiente')
                             : 'no te debe nada' }));
      }
      if (c.gasto) {
        // La tarjeta se pinta SIEMPRE que el usuario pueda ver dinero: sin datos dice «—» y qué
        // falta (C6). Esconderla dejaba la fila de tarjetas con un hueco según el cliente.
        // Y EL PORCENTAJE NUNCA VA DESNUDO (I3): el subtítulo dice sobre qué se divide, aquí mismo.
        var t = c.margen ? (mm==='coste' ? c.margen.pctCoste : c.margen.pctVenta) : null;
        var suf = mm==='coste' ? 'sobre lo que te costó' : 'sobre lo que cobras';
        var euros = c.margen ? c.margen.euros : null;
        out.push(tarjeta({ clave:'margen', k:'Margen que deja',
          v: euros==null ? '—' : eur(euros), na: euros==null,
          // Verde si gana, rojo si pierde. Un margen negativo tiene que saltar a la cara.
          tono: euros == null ? null : (euros < 0 ? 'pierde' : 'gana'),
          s: t==null ? (c.gasto.facturas ? 'sin coste conocido' : 'todavía no le has facturado') : (pct(t)+' '+suf),
          sTxt: t==null ? 'Sin coste apuntado no se puede saber el margen. No es 0: es que no se sabe.' : (pct(t)+' '+suf) }));
      }
      if (c.gasto) {
        out.push(tarjeta({ clave:'gasto', k:'Gasto total', v: eur(c.gasto.total),
          s: c.gasto.facturas+' facturas · sin IVA' }));
        // C4 · la tarjeta configurable. El TÍTULO cambia con la elección, no solo la cifra.
        out.push(tarjeta({ clave:'periodo', k: (c.periodo && c.periodo.titulo) || 'Últimos 12 meses',
          v: eur(c.gasto.periodo),
          s: (c.gasto.facturas_periodo||0)+' documentos · sin IVA', periodo: true }));
        out.push(tarjeta({ clave:'ticket', k:'Ticket medio',
          v: c.ticket_medio==null ? '—' : eur(c.ticket_medio), na: c.ticket_medio==null,
          s: c.ticket_medio==null ? 'todavía sin facturas' : 'por factura' }));
      }
      out.push(tarjeta({ clave:'ultima', k:'Última vez que vino',
        v: c.ultima ? c.ultima.fecha : '—', na: !c.ultima,
        s: c.ultima ? (c.ultima.dias===0 ? 'hoy' : 'hace '+c.ultima.dias+' días') : 'todavía no ha venido' }));
      // D5 · la segunda fecha. Es OTRA cosa que la de arriba, y por eso hay dos tarjetas.
      out.push(tarjeta({ clave:'contacto', k:'Último contacto',
        v: c.contacto ? c.contacto.fecha.slice(0,10) : '—', na: !c.contacto,
        s: c.contacto
            ? (c.contacto.etiqueta + (c.contacto.es_automatico ? ' · automático' : '') + ' · hace '+c.contacto.dias+' días')
            : 'nada apuntado todavía',
        sTxt: c.contacto && c.contacto.es_automatico
            ? 'Lo mandó Bamburu solo: no cuenta como que el cliente haya aparecido' : null }));
      if (c.ritmo) {
        out.push(tarjeta({ clave:'ritmo', k:'Cada cuánto viene',
          v: c.ritmo.ritmo_dias ? ('cada '+c.ritmo.ritmo_dias+' días') : '—', na: !c.ritmo.ritmo_dias,
          s: c.ritmo.ritmo_dias ? (c.ritmo.visitas+' visitas')
             : (c.ritmo.falta ? ('faltan '+c.ritmo.falta+' visitas') : 'aún no ha venido'),
          sTxt: c.ritmo.motivo || null }));
      }
      return '<div class="bf-cards">'+out.join('')+'</div>';
    }

    // ── C2 · LOS DATOS DEL CLIENTE, CON «CLIENTE DESDE» DENTRO ───────────────────────────────────
    // Aquí van los datos de identidad: los que no piden acción. «Cliente desde» baja aquí desde las
    // tarjetas — sigue siendo su primer documento real, y sigue diciendo la fecha de alta al lado.
    function datosHTML(D){
      var f = D.fijos || {}, c = D.cabecera || {}, cli = D.cliente || {};
      var filas = [
        ['Código', cli.client_code || '—'],
        ['NIF', f.fiscal_id || '—'],
        ['Teléfono', f.phone || '—'],
        ['Email', f.email || '—'],
        ['Cliente desde', c.desde && c.desde.fecha ? c.desde.fecha : ((c.desde && c.desde.nota) || '—'),
          c.desde && c.desde.alta ? 'de alta desde '+c.desde.alta : ''],
      ];
      return '<div class="bf-datos">'+filas.map(function(r){
        return '<div><span class="k">'+esc(r[0])+'</span><span class="v" title="'+esc(r[1])+'">'+esc(r[1])+'</span>'
          + (r[2] ? '<span class="s" title="'+esc(r[2])+'">'+esc(r[2])+'</span>' : '')+'</div>';
      }).join('')+'</div>';
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

    // ── F · LOS CHIPS ────────────────────────────────────────────────────────────────────────────
    // Se ocultan por lo que el negocio USA, nunca por valer 0: a la asesoría con cero proyectos hay
    // que enseñárselos, porque son su trabajo y ese 0 le dice que puede empezar.
    // Y NADA SE ELIMINA (R6): lo oculto sale en «Más opciones» y se enciende de un clic.
    function chipsHTML(cont, extra){
      if (!cont || !cont.length) return '';
      var ext = new Set(extra || []);
      var vivos = cont.filter(function(x){ return !x.oculto || ext.has(x.key); });
      var dormidos = cont.filter(function(x){ return x.oculto && !ext.has(x.key); });
      var h = '<div class="bf-chips">'+vivos.map(function(x){
        return '<a class="'+(x.n===0?'cero':'')+'" href="'+esc(x.href)+'"><i class="ti '+esc(x.icon)+'"></i> '
          + esc(x.etiqueta)+' <span class="n">'+x.n+'</span></a>';
      }).join('');
      if (dormidos.length) {
        h += '<button type="button" class="bf-mas" data-mas-chips="1" '
          + 'title="'+esc(dormidos.map(function(x){ return x.etiqueta+': '+(x.porque||''); }).join(' · '))+'">'
          + '<i class="ti ti-dots"></i> Más opciones</button>';
      }
      h += '</div>';
      if (dormidos.length) {
        h += '<div id="bfMasChips" style="display:none" class="bf-nota">'
          + dormidos.map(function(x){
              return '<div style="display:flex;align-items:center;gap:.5rem;justify-content:space-between;padding:.25rem 0;flex-wrap:wrap">'
                + '<span><strong>'+esc(x.etiqueta)+'</strong> — '+esc(x.porque||'no se usa en este negocio')+'</span>'
                + '<button type="button" class="btn btn-secondary btn-sm" data-chip-on="'+esc(x.key)+'">Enseñarlo igualmente</button></div>';
            }).join('')
          + '</div>';
      }
      return h;
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

    // ── D5 · EL REGISTRO DE CONTACTOS ────────────────────────────────────────────────────────────
    // Lo AUTOMÁTICO va marcado a simple vista, y las VISITAS también: son las dos cosas que hay que
    // poder distinguir de un vistazo, porque de esa distinción depende que el aviso de cliente
    // dormido siga significando algo.
    // Convierte los **así** del texto del servidor en negrita, sin regex.
    function negrita(txt){
      var partes = String(txt||'').split('**');
      return partes.map(function(p,i){ return i%2 ? '<strong>'+esc(p)+'</strong>' : esc(p); }).join('');
    }

    function registroHTML(d){
      var h = '';
      if (d.resumen) h += '<div class="bf-resumen">'+esc(d.resumen)+'</div>';
      // Sin regex a propósito: dentro de una plantilla del servidor, el \\* de /\\*\\*.../ se lo come el
      // motor y al navegador le llega /**(.+?)**/ — que lee como comentario de bloque. Partir por
      // '**' hace lo mismo y no se puede romper por un escape.
      if (d.nota) h += '<div class="bf-nota">'+negrita(d.nota)+'</div>';
      // Filtro por tipo. Solo salen los tipos que ESE cliente tiene: un filtro con opciones vacías
      // es ruido que promete cosas que no están.
      if ((d.tipos||[]).length > 1) {
        h += '<div class="bf-per" data-filtro-tipo>'
          + '<button type="button" data-tipo="" aria-pressed="true">Todo</button>'
          + d.tipos.map(function(t){ return '<button type="button" data-tipo="'+esc(t)+'" aria-pressed="false">'
              + esc((d.catalogo&&d.catalogo[t]&&d.catalogo[t].etiqueta)||t)+'</button>'; }).join('')
          + '</div>';
      }
      if (d.puede_apuntar) {
        h += '<div style="margin-bottom:.8rem"><button type="button" class="btn btn-secondary btn-sm" data-apuntar="1">'
          + '<i class="ti ti-plus"></i> Apuntar contacto</button></div><div id="bfApuntar"></div>';
      }
      if (!(d.eventos||[]).length) return h + '<div class="bf-vacio">'+esc(d.vacio||'Nada todavía.')+'</div>';
      h += '<div class="bf-reg">'+d.eventos.map(function(e){
        var tit = e.href ? '<a href="'+esc(e.href)+'" target="_blank" rel="noopener">'+esc(e.resultado||e.etiqueta)+'</a>'
                         : esc(e.resultado||e.etiqueta);
        var marcas = (e.es_automatico ? '<span class="bf-auto" title="Lo mandó Bamburu solo: no cuenta como que el cliente haya aparecido">automático</span>' : '')
                   + (e.es_visita && !d.soloVisitas ? '<span class="bf-visita" title="Cuenta como que vino">visita</span>' : '');
        var abajo = [e.etiqueta, e.quien && e.quien !== '—' ? e.quien : '', 
                     e.hueco_dias!=null ? (e.hueco_dias+' días después de la anterior') : ''].filter(Boolean).join(' · ');
        return '<div class="ev'+(e.es_automatico?' auto':'')+'"><i class="ti '+esc(e.icon||'ti-point')+'"></i>'
          + '<div class="cuerpo"><div class="t" title="'+esc(e.resultado||e.etiqueta)+'">'+tit+marcas+'</div>'
          + (abajo ? '<div class="d" title="'+esc(abajo)+'">'+esc(abajo)+'</div>' : '')+'</div>'
          + '<span class="f">'+esc(String(e.fecha||'').slice(0,16))+'</span></div>';
      }).join('')+'</div>';
      return h;
    }

    // D3 · APUNTAR A MANO, EN DOS CLICS. Y la verdad sobre WhatsApp dicha en pantalla: no está
    // conectado a Bamburu, así que esto lo apunta una persona. No se finge una integración.
    function apuntarHTML(catalogo){
      var manuales = Object.keys(catalogo||{}).filter(function(k){ return catalogo[k].manual; });
      return '<div class="bf-nota" style="background:var(--bg2);border:1px solid var(--border2)">'
        + '<div class="bf-form">'
        +   '<div><label>Qué fue</label><select class="form-control" id="bfcTipo">'
        +     manuales.map(function(k){ return '<option value="'+esc(k)+'">'+esc(catalogo[k].etiqueta)+'</option>'; }).join('')
        +   '</select></div>'
        +   '<div><label>Dirección</label><select class="form-control" id="bfcDir">'
        +     '<option value="saliente">Yo le escribí o llamé</option><option value="entrante">Me contactó él</option>'
        +   '</select></div>'
        + '</div>'
        + '<div><label style="display:block;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:.2rem">Qué pasó (opcional)</label>'
        +   '<input class="form-control" id="bfcRes" maxlength="500" placeholder="Ej.: dice que paga la semana que viene"></div>'
        + '<div id="bfcAviso" style="font-size:.74rem;color:var(--text2);margin-top:.45rem"></div>'
        + '<div style="margin-top:.6rem;display:flex;gap:.5rem">'
        +   '<button type="button" class="btn btn-primary btn-sm" data-apuntar-ok="1">Apuntar</button>'
        +   '<button type="button" class="btn btn-secondary btn-sm" data-apuntar-no="1">Cancelar</button>'
        + '</div></div>';
    }

    // C4 · el selector de periodo, dentro de la tarjeta.
    function periodoHTML(actual){
      var ops = [['m3','3 meses'],['m6','6 meses'],['m12','12 meses'],['anio','Este año'],['libre','Fechas propias']];
      return '<div class="bf-per" data-periodo>'+ops.map(function(o){
        return '<button type="button" data-per="'+o[0]+'" aria-pressed="'+(actual===o[0]?'true':'false')+'">'+esc(o[1])+'</button>';
      }).join('')+'</div>'
      + '<div id="bfPerLibre" style="display:'+(actual==='libre'?'flex':'none')+';gap:.5rem;margin-bottom:.8rem;flex-wrap:wrap">'
      +   '<input type="date" class="form-control" id="bfPerD" style="max-width:170px">'
      +   '<input type="date" class="form-control" id="bfPerH" style="max-width:170px">'
      +   '<button type="button" class="btn btn-secondary btn-sm" data-per-libre="1">Aplicar</button></div>';
    }

    // ── F · DÓNDE ESTÁ — el mapa y el enlace de ruta ──────────────────────────────────────────
    // VIVE AQUÍ, en el componente compartido, y no dentro de una pantalla: lo pintan TRES sitios —la
    // página del cliente, la ficha completa y el resumen de la ventana flotante—, y tres copias de
    // esto acabarían discrepando el día que alguien toque una. Misma regla que las tarjetas.
    //
    // LAS TRES REGLAS DEL ENCARGO SE DECIDEN AQUÍ:
    //  · Sin punto del que fiarse no se pinta NADA: ni hueco, ni mapa vacío, ni "sin datos".
    //  · El punto llega YA RESUELTO del servidor —se resolvió el día que se guardó el cliente—, así
    //    que abrir una ficha no le pregunta nada a nadie: las teselas también son nuestras.
    //  · Si Leaflet no cargó, tampoco se pinta. Mejor la ficha de siempre que una caja rota.
    var MAPAS = {};
    var ICONO = null;

    // EL ENLACE ABRE LA APLICACIÓN DE MAPAS DEL TELÉFONO, que no es lo mismo que abrir un mapa:
    //  · Android      -> esquema geo:, el estándar del sistema; el móvil ofrece las apps que tenga.
    //  · iPhone/iPad  -> el enlace universal de Apple, que iOS abre DIRECTAMENTE en su app de Mapas
    //                    (el esquema maps:// lo bloquean algunos navegadores; este no).
    //  · Escritorio   -> OpenStreetMap, que es de donde sale el mapa.
    // Esto NO reabre la decisión del proveedor: el mapa lo dibuja OpenStreetMap y punto. Aquí solo
    // se le pasa el punto al teléfono para que lo abra con lo que su dueño tenga instalado.
    function enlaceRuta(lat, lon, nombre){
      var d = lat + ',' + lon;
      var ua = navigator.userAgent || '';
      if (/iPad|iPhone|iPod/i.test(ua)) return 'https://maps.apple.com/?daddr=' + d + '&dirflg=d';
      if (/Android/i.test(ua)) return 'geo:' + d + '?q=' + d + '(' + encodeURIComponent(nombre || '') + ')';
      return 'https://www.openstreetmap.org/directions?route=;' + d;
    }

    // El parametro caja es el id del hueco que reserva cada pantalla; chico lo deja en tamaño de
    // resumen, que es como entra en la ventana flotante. Devuelve si ha pintado algo.
    function pintaMapa(caja, D, opts){
      var box = document.getElementById(caja);
      if (!box) return false;
      // Repintar (tras un cobro, o al volver de una capa) rehace el HTML de la caja. El mapa anterior
      // hay que CERRARLO: si no, se queda escuchando el redimensionado de la ventana para siempre.
      if (MAPAS[caja]) { try { MAPAS[caja].remove(); } catch(e){} delete MAPAS[caja]; }
      var m = D && D.mapa;
      var hay = !!m && isFinite(m.lat) && isFinite(m.lon) && typeof L !== 'undefined';
      if (!hay) { box.innerHTML = ''; box.style.display = 'none'; return false; }
      var chico = !!(opts && opts.chico);
      var nombre = (D.cliente && D.cliente.name) || '';
      // TODO lo que viene del cliente pasa por esc — el nombre y la dirección los escribe una
      // persona, y en esta casa hay clientes con carga XSS en el nombre desde el primer día.
      box.innerHTML = (chico ? '<div class="bf-h">Dónde está</div>' : '<h4>Dónde está</h4>')
        + '<div class="bf-mapa' + (chico ? ' chico' : '') + '" id="' + caja + 'Lienzo"></div>'
        + '<div class="bf-mapa-pie">'
        +   '<span class="dir" title="' + esc(m.direccion || '') + '">' + esc(m.direccion || '') + '</span>'
        +   '<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="'
        +     esc(enlaceRuta(m.lat, m.lon, nombre)) + '">Cómo llegar</a>'
        + '</div>';
      box.style.display = '';
      // Icono con las rutas ESCRITAS. Leaflet, si no se le dan, las adivina mirando de dónde vino su
      // propio CSS — y esa adivinanza falla en cuanto los ficheros no están donde él espera.
      if (!ICONO) ICONO = L.icon({
        iconUrl: '/public/vendor/leaflet/images/marker-icon.png',
        iconRetinaUrl: '/public/vendor/leaflet/images/marker-icon-2x.png',
        shadowUrl: '/public/vendor/leaflet/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], shadowSize: [41, 41], shadowAnchor: [12, 41]
      });
      try {
        // scrollWheelZoom apagado: bajar por la ficha con la rueda no puede acabar haciendo zoom en
        // un mapa por el que pasabas. Los botones + y - siguen ahí para quien quiera acercarse.
        var mapa = L.map(caja + 'Lienzo', { scrollWheelZoom: false, attributionControl: true,
                                            zoomControl: !chico });
        mapa.attributionControl.setPrefix(false);
        // Las teselas salen de NUESTRA ruta, no de openstreetmap.org (ver routes/mapa.js). La
        // atribución es obligatoria por la licencia de los datos (ODbL) y por eso se queda.
        L.tileLayer('/api/erp/mapa/tesela/{z}/{x}/{y}', { minZoom: 3, maxZoom: 19,
          attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(mapa);
        mapa.setView([m.lat, m.lon], chico ? 16 : 17);
        L.marker([m.lat, m.lon], { icon: ICONO, title: nombre, keyboard: false }).addTo(mapa);
        MAPAS[caja] = mapa;
        // La ventana flotante entra ANIMADA: en el instante de crear el mapa su caja todavía puede
        // medir otra cosa, y Leaflet se queda con la medida de ese momento. Esto la vuelve a tomar.
        setTimeout(function(){ try { mapa.invalidateSize(); } catch(e){} }, 80);
        return true;
      } catch(e) { box.innerHTML = ''; box.style.display = 'none'; return false; }
    }

    window.BF = {
      eur: eur, pct: pct, esc: esc, num: num,
      tarjeta: tarjeta, tarjetasHTML: tarjetasHTML, datosHTML: datosHTML, recomiendaHTML: recomiendaHTML,
      chipsHTML: chipsHTML, queCompraHTML: queCompraHTML, margenHTML: margenHTML, listaHTML: listaHTML,
      registroHTML: registroHTML, apuntarHTML: apuntarHTML, periodoHTML: periodoHTML,
      pintaMapa: pintaMapa, enlaceRuta: enlaceRuta,
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
  return String.raw`
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
    // El token CSRF va SIEMPRE en lo que no es GET. Sin él, el servidor devuelve 403 y el botón
    // parece no hacer nada: el endpoint responde, pero rechaza. Me ha mordido dos veces en esta
    // tarea (el paso del alta y el selector de periodo), así que aquí queda dentro del helper.
    function api(m, u, b){
      var h = { 'Content-Type':'application/json' };
      if (['GET','HEAD'].indexOf(m.toUpperCase()) === -1) h['x-csrf-token'] = window.CSRF_TOKEN;
      return fetch(u, { method:m, headers:h, body: b?JSON.stringify(b):undefined })
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
        // A3 — «Ver ficha completa» ABRE UNA CAPA, no una página. Navegando por la app nunca se sale
        // de la ventana; la página entera existe solo para cuando alguien recarga la dirección.
        // Sigue siendo un <a> con href de verdad para que se pueda abrir en pestaña nueva con el
        // botón central o con Ctrl+clic — el clic normal se queda en la ventana.
        + '<div class="bf-win-foot" id="bfFoot"><a class="btn btn-secondary btn-sm" id="bfFull" href="#" data-tarjeta="completa">Ver ficha completa →</a></div>'
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
      // B1.1 · la cabecera compacta: quién es, en una línea. C2 mete aquí «Cliente desde», que salió
      // de las tarjetas porque no pide ninguna acción — es identidad, como el NIF o el teléfono.
      var f = D.fijos || {}, cab = D.cabecera || {};
      var desde = cab.desde && cab.desde.fecha ? 'cliente desde ' + cab.desde.fecha
                : (cab.desde && cab.desde.nota ? cab.desde.nota.toLowerCase() : '');
      var datos = [c.client_code, f.fiscal_id, f.phone, f.email, desde].filter(Boolean).join(' · ');
      $('#bfSub', o).textContent = datos;
      $('#bfAtras', o).style.display = 'none';
      $('#bfFoot', o).style.display = '';
      var html = '';
      html += BF.recomiendaHTML(D.recomienda);
      html += BF.tarjetasHTML(D);
      html += BF.chipsHTML(D.contadores, D.chips_extra);
      // F (23 ago 2026) — EL MAPA EN EL RESUMEN, por encargo de Ibrahin. Reabre a propósito el
      // "y nada más" de B1: la primera pantalla del cliente es esta, y ahí es donde hay que ver
      // dónde está. Va DESPUÉS de lo que exige una decisión (la recomendación de DISA y las cifras)
      // y ANTES de lo comercial, porque es identidad — como el NIF o el teléfono. En cuadro CHICO:
      // el resumen sigue siendo un resumen. Nace oculto; si no hay punto, se queda vacío y a cero.
      html += '<div id="bfWinMapa" style="display:none"></div>';
      if (D.compra && D.compra.length) {
        html += '<div class="bf-h">Qué te compra</div>' + BF.queCompraHTML(D.compra, 5);
      }
      $('#bfBody', o).innerHTML = html;
      BF.pintaMapa('bfWinMapa', D, { chico: true });   // el MISMO painter que la página: uno solo
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
    var TITULOS = { deuda:'Te debe', margen:'Margen que deja', gasto:'Gasto total',
                    periodo:'En el periodo elegido', ticket:'Ticket medio',
                    ultima:'Última vez que vino', contacto:'Último contacto', ritmo:'Cada cuánto viene',
                    compra:'Qué te compra', completa:'Ficha completa' };

    // Pinta una capa SIN tocar el historial. Lo llama popstate (que ya está donde toca) y
    // abrirTarjeta (que empuja antes).
    function pintaTarjeta(clave){
      var id = ID || window.BF_CLIENTE_ID;
      if (!id) return;
      if (clave === 'compra') {
        capa('compra', 'Qué te compra', BF.queCompraHTML((D && D.compra) || window.BF_COMPRA || [], 0));
        return;
      }
      // A3 · LA FICHA COMPLETA, DENTRO DE LA VENTANA. El mismo contenido que la página entera,
      // pintado por el MISMO código (BFFull): si algún día divergen, será porque alguien escribió
      // una segunda copia, y aquí no hay dónde ponerla.
      if (clave === 'completa') {
        capa('completa', 'Ficha completa', '<div id="bfFullCaja"><div class="skel skel-block" style="height:6rem"></div></div>');
        if (window.BFFull) window.BFFull.pintar(document.getElementById('bfFullCaja'), id, D);
        return;
      }
      capa(clave, TITULOS[clave] || 'Detalle', '<div class="skel skel-block" style="height:5rem"></div>');
      api('GET','/api/erp/clients/'+id+'/360/tarjeta/'+clave).then(function(d){
        if (capaActual !== clave) return;          // el usuario ya se ha ido a otro sitio
        if (d.catalogo) ultimoCatalogo = d.catalogo;
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
      // D5 · las tres tarjetas de tiempo abren EL REGISTRO, no una lista de facturas.
      if (d.registro) return BF.registroHTML(d);
      var h = '';
      // C4 · el selector de periodo va DENTRO de la tarjeta abierta, arriba del todo: es lo primero
      // que se toca al entrar, y desde ahí se ve cambiar la lista.
      if (d.periodo && d.clave === 'periodo') h += BF.periodoHTML(d.periodo.clave);
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

    // Catálogo de tipos de la última capa de registro pintada (lo trae el servidor: la pantalla no
    // tiene la lista escrita a mano, ni la coletilla de WhatsApp).
    var ultimoCatalogo = null;

    function avisoTipo(){
      var sel = document.getElementById('bfcTipo'), av = document.getElementById('bfcAviso');
      if (!sel || !av || !ultimoCatalogo) return;
      var t = ultimoCatalogo[sel.value];
      av.textContent = (t && t.aviso) || '';
    }

    function guardarPeriodo(p){
      api('PUT', '/api/erp/clients/periodo-ficha', p).then(function(){
        pintaTarjeta('periodo');                      // la capa, con la lista nueva
        if (window.BFRecarga) window.BFRecarga();      // y el resumen, con el título nuevo
      }).catch(function(x){ if (window.toast) toast(x.message, 'err'); });
    }

    function filtrarRegistro(tipo){
      var id = ID || window.BF_CLIENTE_ID; if (!id) return;
      var solo = capaActual !== 'contacto';
      api('GET', '/api/erp/clients/' + id + '/contactos?visitas=' + (solo ? 1 : 0) + '&tipo=' + encodeURIComponent(tipo || ''))
        .then(function(r){
          var caja = document.querySelector('#bfBody .bf-reg, #f360capaBody .bf-reg');
          var d = { eventos: r.eventos, tipos: [], catalogo: r.catalogo, soloVisitas: solo, puede_apuntar: false, vacio: 'Nada de ese tipo.' };
          var nuevo = BF.registroHTML(d);
          if (caja) caja.outerHTML = nuevo.replace(/^[\s\S]*?(<div class="bf-reg">)/, '$1') || nuevo;
        }).catch(function(){});
    }

    // ── UN SOLO ESCUCHADOR PARA TODO ──────────────────────────────────────────────────────────────
    // Delegado, en el documento: el HTML se repinta constantemente y enganchar listeners a cada
    // boton repintado es como se pierden los clics. Ademas evita el onclick inline dentro de un
    // template del servidor, que es donde se cuelan las comillas escapadas que revientan la página.
    document.addEventListener('click', function(e){
      // La lista TIENE que llevar todos los atributos que el escuchador maneja abajo: si falta uno,
      // ese botón deja de responder en silencio y no hay error que lo delate. Le pasó al selector de
      // periodo: el endpoint respondía 200 y el botón no llamaba a nadie.
      var t = e.target.closest('[data-tarjeta],[data-rec],[data-cobro],[data-gestion],[data-cuenta],'
        + '[data-per],[data-per-libre],[data-apuntar],[data-apuntar-ok],[data-apuntar-no],'
        + '[data-tipo],[data-mas-chips],[data-chip-on]');
      if (!t) return;
      var id = ID || window.BF_CLIENTE_ID;
      if (t.hasAttribute('data-tarjeta')) { e.preventDefault(); abrirTarjeta(t.getAttribute('data-tarjeta')); return; }
      if (t.hasAttribute('data-cobro'))   { e.preventDefault(); if (window.openCobros) window.openCobros(+t.getAttribute('data-cobro')); return; }
      if (t.hasAttribute('data-gestion')) { e.preventDefault(); if (window.openGestion) window.openGestion(+t.getAttribute('data-gestion')); return; }
      if (t.hasAttribute('data-cuenta'))  { e.preventDefault(); if (window.openGestionCuenta) window.openGestionCuenta(+t.getAttribute('data-cuenta')); return; }
      // ── C4 · CAMBIAR EL PERIODO ────────────────────────────────────────────────────────────────
      // Se guarda al instante y se repinta la capa Y el resumen: la tarjeta de fuera tiene que
      // enseñar ya el título nuevo, o el usuario no sabría si le ha hecho caso.
      if (t.hasAttribute('data-per')) {
        e.preventDefault();
        var per = t.getAttribute('data-per');
        if (per === 'libre') {
          var lib = document.getElementById('bfPerLibre'); if (lib) lib.style.display = 'flex';
          var ps = t.parentElement.querySelectorAll('[data-per]');
          for (var i = 0; i < ps.length; i++) ps[i].setAttribute('aria-pressed', ps[i] === t ? 'true' : 'false');
          return;
        }
        guardarPeriodo({ clave: per });
        return;
      }
      if (t.hasAttribute('data-per-libre')) {
        e.preventDefault();
        var d1 = document.getElementById('bfPerD'), d2 = document.getElementById('bfPerH');
        if (!d1 || !d2 || !d1.value || !d2.value) { if (window.toast) toast('Pon las dos fechas','err'); return; }
        guardarPeriodo({ clave: 'libre', desde: d1.value, hasta: d2.value });
        return;
      }

      // ── D3 · APUNTAR UN CONTACTO A MANO ────────────────────────────────────────────────────────
      if (t.hasAttribute('data-apuntar')) {
        e.preventDefault();
        var caja = document.getElementById('bfApuntar'); if (!caja) return;
        caja.innerHTML = BF.apuntarHTML(ultimoCatalogo);
        avisoTipo();
        var sel = document.getElementById('bfcTipo'); if (sel) sel.addEventListener('change', avisoTipo);
        return;
      }
      if (t.hasAttribute('data-apuntar-no')) { e.preventDefault(); var cx = document.getElementById('bfApuntar'); if (cx) cx.innerHTML = ''; return; }
      if (t.hasAttribute('data-apuntar-ok')) {
        e.preventDefault();
        api('POST', '/api/erp/clients/' + id + '/contactos', {
          tipo: document.getElementById('bfcTipo').value,
          direccion: document.getElementById('bfcDir').value,
          resultado: document.getElementById('bfcRes').value,
        }).then(function(){
          if (window.toast) toast('Apuntado');
          pintaTarjeta(capaActual);          // se repinta la capa donde estaba, no se le echa de ella
          if (window.BFRecarga) window.BFRecarga();
        }).catch(function(x){ if (window.toast) toast(x.message, 'err'); });
        return;
      }
      if (t.hasAttribute('data-tipo')) {     // filtro del registro
        e.preventDefault();
        var hs = t.parentElement.querySelectorAll('[data-tipo]');
        for (var j = 0; j < hs.length; j++) hs[j].setAttribute('aria-pressed', hs[j] === t ? 'true' : 'false');
        filtrarRegistro(t.getAttribute('data-tipo'));
        return;
      }

      // ── F2 · ENSEÑAR UN CHIP QUE EL OFICIO NO TRAE ─────────────────────────────────────────────
      if (t.hasAttribute('data-mas-chips')) {
        e.preventDefault();
        var m = document.getElementById('bfMasChips');
        if (m) m.style.display = m.style.display === 'none' ? '' : 'none';
        return;
      }
      if (t.hasAttribute('data-chip-on')) {
        e.preventDefault();
        api('PUT', '/api/erp/clients/chips-ficha', { key: t.getAttribute('data-chip-on'), encender: true })
          .then(function(){ if (window.BFRecarga) window.BFRecarga(); else location.reload(); })
          .catch(function(x){ if (window.toast) toast(x.message, 'err'); });
        return;
      }

      if (t.hasAttribute('data-rec')) {
        e.preventDefault();
        var tipo = t.getAttribute('data-rec');
        if (tipo === 'disa')     { preguntarDisa(t.getAttribute('data-fam')); return; }
        if (tipo === 'cuenta')   { abrirTarjeta('deuda'); return; }
        if (tipo === 'historia') { location.href = '/admin/clients/' + id + '#historia'; return; }
        if (tipo === 'citas')    { location.href = '/admin/citas?cliente=' + ID; return; }
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

    // Un punto ÚNICO para repintar el resumen desde cualquier sitio (guardar un periodo, apuntar un
    // contacto, encender un chip). Lo define cada montaje según lo que tenga a mano.
    window.BFRecarga = function(){
      var id = ID || window.BF_CLIENTE_ID; if (!id) return;
      api('GET','/api/erp/clients/'+id+'/360').then(function(d){
        D = d;
        if (MONTAJE === 'ventana') { if (capaActual === 'resumen') pintaResumen(); }
        else if (typeof window.BFPintaPagina === 'function') window.BFPintaPagina(d);
      }).catch(function(){});
    };

    window.BFWin = { abrir: abrir, cerrar: cerrar, capa: capa, abrirTarjeta: abrirTarjeta,
                     resumen: function(){ capa('resumen'); },
                     datos: function(){ return D; }, setDatos: function(d){ D = d; } };
  })();
  `;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA FICHA COMPLETA — UN SOLO renderizador para la capa de la ventana y para la página entera
//
// POR QUÉ ESTO EXISTE. «Ver ficha completa» sacaba al usuario de la ventana y lo mandaba a otra
// página; se perdía el sitio, el filtro y la lista, y volver era un viaje. Ahora abre EN LA MISMA
// ventana, en capa, con su flecha de volver — y la página entera queda solo para cuando alguien
// recarga la dirección o la comparte, que es justo cuando sí quieres una página.
//
// Para que las dos superficies no puedan divergir NUNCA, las dos llaman a `BFFull.pintar(caja, id)`.
// No hay una segunda copia del HTML en ninguna parte: si algún día hay que arreglar la tabla de
// facturas, se arregla aquí y queda arreglada en los dos sitios.
//
// EL AIRE (B2): cada caja lleva `.bf-caja`, porque `.card` de Bamburu NO tiene padding —vive en
// `.card-body`— y la ficha escribía dentro de `.card` a pelo. Ese era el «texto pegado al borde».
export function fichaCompletaJS() {
  return String.raw`
  (function(){
    var TIPO_LBL = { documento:'Documentos', cobro:'Cobros', cita:'Citas', oportunidad:'Oportunidades',
                     actividad:'Actividad', proyecto:'Proyectos', tiempo:'Horas', aviso:'Avisos', nota:'Notas' };
    function api(m, u, b){
      var o = { method:m, headers:{'Content-Type':'application/json'} };
      if (!['GET','HEAD'].includes(m)) o.headers['x-csrf-token'] = window.CSRF_TOKEN;
      if (b) o.body = JSON.stringify(b);
      return fetch(u, o).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||r.status); return j; }); });
    }

    // El armazón. Los ids llevan el prefijo de la caja para que la capa y la página puedan convivir
    // en el mismo documento sin pisarse los identificadores.
    function armazon(pfx){
      return '<div class="' + 'bf-full">'
        // F — DÓNDE ESTÁ. Nace VACÍO y oculto, y solo lo llena pintaMapa si hay un punto del que
        // fiarse. Vacío y con display:none no deja hueco: .bf-full es un flex y un hijo oculto no
        // cuenta para el gap. Es la diferencia entre "no se pinta" y "se pinta un sitio en blanco".
        + '<div class="card bf-caja" id="'+pfx+'mapaBox" style="display:none"></div>'
        + '<div class="card bf-caja" id="'+pfx+'hist"><h4>Su historia</h4>'
        +   '<div class="bf-per" id="'+pfx+'tabs"></div><div id="'+pfx+'tl">Cargando…</div>'
        +   '<div style="text-align:center;padding:.6rem"><button type="button" class="btn btn-secondary btn-sm" id="'+pfx+'mas" style="display:none">Ver más</button></div>'
        + '</div>'
        + '<div class="bf-full-2">'
        +   '<div class="card bf-caja"><h4>Qué te compra</h4><div id="'+pfx+'compra">Cargando…</div></div>'
        +   '<div class="card bf-caja"><h4>Notas</h4><div id="'+pfx+'notaFija"></div>'
        +     '<textarea class="form-control" id="'+pfx+'nueva" rows="2" maxlength="4000" placeholder="Escribe una nota…"></textarea>'
        +     '<button type="button" class="btn btn-primary btn-sm" style="margin-top:.4rem" id="'+pfx+'addNota">Añadir nota</button>'
        +     '<div id="'+pfx+'notas" style="margin-top:.75rem"></div></div>'
        + '</div>'
        + '<div class="card bf-caja" id="'+pfx+'facBox" style="display:none"><h4>Todas sus facturas</h4><div id="'+pfx+'fac"></div></div>'
        + '</div>';
    }

    // D es lo que la ventana YA ha cargado. Si viene, no se vuelve a pedir /360: era la petición
    // más cara de la pantalla y se estaba pagando dos veces seguidas para pintar lo mismo.
    function pintar(caja, id, D){
      if (!caja) return;
      var pfx = 'bff' + id + '_';
      caja.innerHTML = armazon(pfx);
      var $ = function(x){ return document.getElementById(pfx + x); };
      var TIPO = '', DESDE = 0;

      // ── Su historia ──────────────────────────────────────────────────────────────────────────
      function tabs(tipos){
        $('tabs').innerHTML = '<button type="button" data-tl="" aria-pressed="'+(TIPO===''?'true':'false')+'">Todo</button>'
          + (tipos||[]).map(function(t){ return '<button type="button" data-tl="'+BF.esc(t)+'" aria-pressed="'+(TIPO===t?'true':'false')+'">'+BF.esc(TIPO_LBL[t]||t)+'</button>'; }).join('');
      }
      function cargarTl(){
        api('GET','/api/erp/clients/'+id+'/360/timeline?tipo='+encodeURIComponent(TIPO)+'&desde='+DESDE+'&cuantos=25').then(function(r){
          tabs(r.tipos);
          var box = $('tl');
          if (DESDE === 0) box.innerHTML = '';
          if (DESDE === 0 && !r.eventos.length) {
            box.innerHTML = '<div class="bf-vacio">Aquí no hay nada todavía'+(TIPO?' de ese tipo':'')+'. En cuanto le factures, le des cita o le escribas una nota, aparecerá aquí.</div>';
          } else {
            box.innerHTML += r.eventos.map(function(e){
              var f = String(e.ts||'').slice(0,10);
              var t = e.href ? '<a href="'+BF.esc(e.href)+'" target="_blank" rel="noopener">'+BF.esc(e.title)+'</a>' : BF.esc(e.title);
              return '<div class="bf-reg"><div class="ev"><i class="ti '+BF.esc(e.icon||'ti-point')+'"></i>'
                + '<div class="cuerpo"><div class="t" title="'+BF.esc(e.title)+'">'+t+'</div>'
                + (e.detail?'<div class="d" title="'+BF.esc(e.detail)+'">'+BF.esc(e.detail)+'</div>':'')+'</div>'
                + '<span class="f">'+BF.esc(f)+'</span></div></div>';
            }).join('');
          }
          DESDE += r.eventos.length;
          $('mas').style.display = r.hay_mas ? '' : 'none';
        }).catch(function(){});
      }
      $('tabs').addEventListener('click', function(ev){
        var b = ev.target.closest('button[data-tl]'); if(!b) return;
        TIPO = b.getAttribute('data-tl'); DESDE = 0; $('tl').innerHTML = ''; cargarTl();
      });
      $('mas').addEventListener('click', cargarTl);

      // ── Notas ────────────────────────────────────────────────────────────────────────────────
      function cargarNotas(){
        api('GET','/api/erp/clients/'+id+'/notas').then(function(ns){
          $('notas').innerHTML = ns.length ? ns.map(function(n){
            return '<div class="bf-nota" style="background:var(--bg2);border:1px solid var(--border2)">'
              + '<div style="white-space:pre-wrap;font-size:.86rem">'+BF.esc(n.texto)+'</div>'
              + '<div style="font-size:.72rem;color:var(--text3);margin-top:.3rem">'+BF.esc(n.user_name||'—')+' · '
              + BF.esc(String(n.created_at||'').slice(0,16).replace('T',' '))+(n.updated_at?' · editada':'')
              + ' <a href="#" data-nedit="'+n.id+'">editar</a> · <a href="#" data-ndel="'+n.id+'">quitar</a></div></div>';
          }).join('') : '<div class="bf-vacio">Sin notas todavía.</div>';
        }).catch(function(){});
      }
      $('addNota').addEventListener('click', function(){
        var t = $('nueva').value.trim(); if(!t){ if(window.toast) toast('Escribe algo','err'); return; }
        api('POST','/api/erp/clients/'+id+'/notas',{texto:t}).then(function(){
          $('nueva').value=''; if(window.toast) toast('Nota guardada'); cargarNotas(); DESDE=0; cargarTl();
        }).catch(function(e){ if(window.toast) toast(e.message,'err'); });
      });
      $('notas').addEventListener('click', function(ev){
        var e = ev.target.closest('a[data-nedit]'), d = ev.target.closest('a[data-ndel]');
        if (e) { ev.preventDefault();
          var actual = e.closest('.bf-nota').firstChild.textContent;
          var t = prompt('Editar la nota:', actual); if (t==null) return;
          api('PUT','/api/erp/clients/'+id+'/notas/'+e.getAttribute('data-nedit'),{texto:t})
            .then(function(){ cargarNotas(); DESDE=0; cargarTl(); }).catch(function(x){ if(window.toast) toast(x.message,'err'); });
        } else if (d) { ev.preventDefault();
          if (!confirm('¿Quitar esta nota?')) return;
          api('DELETE','/api/erp/clients/'+id+'/notas/'+d.getAttribute('data-ndel'))
            .then(function(){ cargarNotas(); DESDE=0; cargarTl(); }).catch(function(x){ if(window.toast) toast(x.message,'err'); });
        }
      });

      // ── Qué te compra y la nota fija ─────────────────────────────────────────────────────────
      function pintaDe(D){
        BF.pintaMapa(pfx + 'mapaBox', D);   // F — dónde está el cliente (y nada, si no se sabe)
        $('notaFija').innerHTML = D.cliente && D.cliente.notes
          ? '<div class="alert alert-ok" style="margin-bottom:.6rem">'+BF.esc(D.cliente.notes)+'</div>' : '';
        $('compra').innerHTML = D.compra == null ? '<div class="bf-vacio">—</div>'
          : (D.compra.length ? BF.queCompraHTML(D.compra, 0)
             : '<div class="bf-vacio">Todavía no te ha comprado nada en los últimos 12 meses.</div>');
      }
      if (D) pintaDe(D);
      else api('GET','/api/erp/clients/'+id+'/360').then(pintaDe).catch(function(){});

      api('GET','/api/erp/clients/'+id+'/invoices').then(function(deb){
        var badge={pendiente:'b-yellow',parcial:'b-blue',cobrada:'b-green',vencida:'b-red',abono:'b-gray'};
        var label={pendiente:'Pendiente',parcial:'Cobrada en parte',cobrada:'Cobrada',vencida:'Vencida',abono:'Abono'};
        $('facBox').style.display = '';
        var filas = (deb.invoices||[]).map(function(f){
          var est = !f.counts
            ? '<span class="badge b-gray" title="No computa como deuda (anulada o rectificada por sustitución)">no computa</span>'
            : '<span class="badge '+(badge[f.estado]||'')+'">'+(label[f.estado]||f.estado)+(f.estado==='vencida'&&f.dias_vencida?' '+f.dias_vencida+'d':'')+'</span>';
          var acc = (f.cobrable && Number(f.pendiente)>0.0049)
            ? '<button type="button" class="btn btn-primary btn-sm" data-cobro="'+f.id+'">Registrar cobro</button> '
              + '<button type="button" class="btn btn-secondary btn-sm" data-gestion="'+f.id+'">Gestionar</button>' : '';
          return '<tr><td><a href="/admin/invoices/'+f.id+'" target="_blank" rel="noopener">'+BF.esc(f.invoice_number)+'</a></td>'
            + '<td style="color:var(--text3);font-size:.8rem;white-space:nowrap">'+BF.esc(f.due_date||f.issue_date||'-')+'</td>'
            + '<td style="white-space:nowrap">'+BF.eur(f.total)+'</td>'
            + '<td style="white-space:nowrap">'+(f.counts?BF.eur(f.pendiente):'—')+'</td>'
            + '<td>'+est+'</td><td style="text-align:right;white-space:nowrap">'+acc+'</td></tr>';
        }).join('');
        $('fac').innerHTML = filas
          ? '<div class="bf-scroll"><table><thead><tr><th>Factura</th><th>Vence</th><th>Total</th><th>Pendiente</th><th>Cobro</th><th></th></tr></thead><tbody>'+filas+'</tbody></table></div>'
          : '<div class="bf-vacio">Este cliente aún no tiene facturas.</div>';
      }).catch(function(){});

      cargarTl(); cargarNotas();
    }

    window.BFFull = { pintar: pintar };
  })();
  `;
}

export function fichaCompletaCSS() {
  return `
    .bf-full{display:flex;flex-direction:column;gap:1rem}
    .bf-full .card{min-width:0}
    .bf-full-2{display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:start}
    .bf-full-2>.card{min-width:0}
    @media(max-width:900px){ .bf-full-2{grid-template-columns:1fr} }
    /* ── F · DÓNDE ESTÁ ──────────────────────────────────────────────────────────────────────────
       El position:relative con z-index:0 NO es adorno: crea un contexto de apilado propio y encierra
       dentro los z-index de Leaflet (sus controles van a 1000), que si no se le suben por encima
       a la cabecera del panel. El alto es fijo a propósito — un mapa sin alto se pinta de 0 px. */
    .bf-mapa{height:220px;border-radius:12px;overflow:hidden;position:relative;z-index:0;
      border:1px solid var(--border2);background:var(--bg2)}
    /* En el resumen de la ventana el mapa es un CUADRO PEQUEÑO: enseña dónde está sin comerse la
       pantalla, que es lo que sigue haciendo de esa vista un resumen. */
    .bf-mapa.chico{height:150px}
    @media(max-width:520px){ .bf-mapa.chico{height:130px} }
    .bf-mapa .leaflet-container{font:inherit;background:var(--bg2)}
    .bf-mapa-pie{display:flex;align-items:center;justify-content:space-between;gap:.75rem;
      margin-top:.6rem;min-width:0}
    /* La dirección se recorta con puntos suspensivos, como las tres líneas de la tarjeta (D1): un
       texto largo no puede estirar la caja ni empujar al botón fuera del borde. */
    .bf-mapa-pie .dir{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      font-size:.82rem;color:var(--text2)}
    .bf-mapa-pie .btn{flex:none}
    @media(max-width:520px){ .bf-mapa{height:180px} }

    /* Dentro de la ventana la ficha completa no lleva marcos dobles: la ventana ya es el marco. */
    .bf-win-body .bf-full .card{border:none;background:transparent;padding:0}
    .bf-win-body .bf-full{gap:1.5rem}
    .bf-win-body .bf-full-2{gap:1.5rem;grid-template-columns:1fr}
  `;
}
