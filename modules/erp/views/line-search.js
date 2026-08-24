// Componente compartido: buscador de catálogo en la LÍNEA de un documento.
//
// Un único campo por línea que busca en el catálogo completo (físico/digital/
// servicio). Al elegir una sugerencia se delega en `applyLinePick(row, product)`,
// que cada documento (factura, pedido…) implementa para rellenar SUS campos
// (precio, IVA por banda, variante, product_id oculto…). Así factura y pedido
// usan el MISMO buscador y no hay dos formas distintas de añadir una línea.
//
// La página que lo use debe tener en scope: `catalog` (array de productos
// activos), `SYM` (símbolo de moneda), `escHtml` (global de layout.js) y una
// función `applyLinePick(row, product)`.

// Celda <td> con el input de búsqueda + el contenedor de sugerencias.
// `extraInner` permite a cada documento añadir campos ocultos dentro de la misma
// celda (p. ej. product_id / variante en el pedido) sin duplicar el markup.
export function lineSearchCellHtml(extraInner = '') {
  return '<td style="position:relative">' +
    '<input type="text" class="form-control line-desc" autocomplete="off" placeholder="Buscar en el catálogo o escribir libremente" oninput="onDescInput(this)" onfocus="onDescInput(this)" onblur="hideSuggest(this)">' +
    '<div class="line-suggest" style="display:none;position:absolute;z-index:30;left:0;right:0;top:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;max-height:240px;overflow:auto;box-shadow:0 6px 16px rgba(0,0,0,.25)"></div>' +
    extraInner +
  '</td>';
}

// JS (string) con las 3 funciones del buscador. Se inyecta tal cual dentro del
// <script> de la página. `pickProduct` localiza el producto y delega el relleno
// en `applyLinePick(row, product)` definido por la página.
export function lineSearchScript() {
  return `
      // ── Buscador de línea compartido (factura/pedido) ─────────────────
      // Al teclear, ofrece coincidencias del catálogo completo (nombre o SKU).
      function onDescInput(input){
        const box = input.parentElement.querySelector('.line-suggest');
        const q = input.value.trim().toLowerCase();
        if (!q) { box.style.display='none'; box.innerHTML=''; return; }
        const matches = catalog.filter(p =>
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.sku && p.sku.toLowerCase().includes(q))
        ).slice(0, 8);
        if (!matches.length) { box.style.display='none'; box.innerHTML=''; return; }
        box.innerHTML = matches.map(p =>
          '<div class="suggest-item" style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid var(--border)" ' +
          'onmousedown="event.preventDefault();pickProduct(this,'+p.id+')">' +
            '<strong>'+escHtml(p.name)+'</strong>' +
            (p.sku ? ' <span style="color:var(--muted);font-size:.8rem">['+escHtml(p.sku)+']</span>' : '') +
            ' <span style="float:right;color:var(--muted)">'+dineroEs(p.price||0, SYM)+'</span>' +
          '</div>'
        ).join('');
        box.style.display='';
      }

      // Al elegir un producto: la página rellena sus campos vía applyLinePick.
      function pickProduct(el, id){
        const p = catalog.find(x => x.id === id);
        if (!p) return;
        const row = el.closest('tr');
        applyLinePick(row, p);
        const box = row.querySelector('.line-suggest');
        if (box) { box.style.display='none'; box.innerHTML=''; }
      }

      // Oculta las sugerencias al salir del campo (con retardo para permitir el click).
      function hideSuggest(input){
        const box = input.parentElement.querySelector('.line-suggest');
        setTimeout(function(){ box.style.display='none'; }, 150);
      }
  `;
}
