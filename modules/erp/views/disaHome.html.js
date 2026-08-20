// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL INICIO — EL CUADRO DE MANDO DEL DÍA
//
// QUÉ CAMBIA Y POR QUÉ. El Inicio era una lista de deberes con un chat encima: saludo, tarjeta de
// DISA, cuatro cifras sueltas y un compositor de conversación que ocupaba media pantalla. Ahora es
// lo que un dueño mira a primera hora: SU DÍA, SUS NÚMEROS y LO QUE CONVIENE DECIDIR.
//
// EL ORDEN, de arriba abajo, y es el orden del encargo:
//   1. HOY .................. la franja del día, la próxima cita y los eventos del calendario.
//   2. TUS NÚMEROS .......... ventas · pendiente de cobro · margen · clientes nuevos.
//   3. GRÁFICO PRINCIPAL .... ventas por día del mes, con el mes anterior detrás en gris.
//   4. TU NEGOCIO EN CIFRAS . lo que más vendes · lo que más te deja · tus mejores clientes.
//   5. OPORTUNIDADES ........ cuántas y por cuánto, con su enlace.
//   6. DISA DECIDE .......... tres líneas como mucho, con la cifra delante y su botón.
//   7. PON EN MARCHA ........ el panel de arranque, plegado en una línea (se recuerda por usuario).
//   8. TUS PANELES .......... la rejilla componible del paso 6, que sigue viva con su paleta.
//
// EL CHAT DE DISA SE VA DEL INICIO, Y SOLO DEL INICIO. Su compositor, sus mensajes, sus accesos
// rápidos y sus tarjetas de sugerencia vivían aquí y ya no. DISA sigue estando entera: en su pantalla
// (/admin/disa) y en la entrada del menú, que es a donde lleva ahora. Los endpoints que se quedan sin
// uso NO se borran — se señalan en el informe, que es otra decisión y de otro día.
//
// CERO CIFRA PROPIA. Esta pantalla no calcula nada: pide /api/erp/inicio/cuadro, que ya trae cada
// número de su motor y solo las secciones que este usuario puede ver. Lo que viene null se pinta
// «—», nunca un 0.
export function disaHomeHtml({ userName, simbolo = '€' }) {
  const sym = simbolo || '€';

  // Fecha de hoy en español (presentación; server-side, no toca datos del tenant).
  const _now = new Date();
  const _dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const _meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const _h = _now.getHours();
  const _saludo = _h < 6 ? 'Hola' : _h < 13 ? 'Buenos días' : _h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const fechaHoy = `${_dias[_now.getDay()]}, ${_now.getDate()} de ${_meses[_now.getMonth()]}`;
  const _ringC = 150.8;   // circunferencia (2π·24) — la misma del anillo de U6, que se reutiliza tal cual

  return `
    <style>
      /* ══════════════════════════════════════════════════════════════════════════════════════════
         EL CUADRO DE MANDO DEL DÍA — el Inicio deja de ser una lista de deberes.
         Todo con los tokens de la app; nada mide en píxeles fijos que no quepan en 390 px.
         ══════════════════════════════════════════════════════════════════════════════════════════ */
      .cm { max-width: 1040px; margin: 0 auto; width: 100%; box-sizing: border-box; min-width: 0; }
      .cm-hola { font-size: 18px; font-weight: 600; color: var(--text); margin: 0 0 2px; letter-spacing: -.2px; }
      .cm-fecha { font-size: 13px; color: var(--text2); margin: 0 0 16px; }
      .cm-card { background: var(--bg2); border: 1px solid var(--border2); border-radius: 14px;
        padding: 14px 16px; margin-bottom: 14px; min-width: 0; box-sizing: border-box; }
      .cm-h { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700;
        letter-spacing: .06em; text-transform: uppercase; color: var(--text3); margin: 0 0 10px; flex-wrap: wrap; }
      .cm-h i { font-size: 14px; color: var(--accent); }
      .cm-h .x { margin-left: auto; font-size: 11px; font-weight: 500; letter-spacing: 0;
        text-transform: none; color: var(--text2); }

      /* ── HOY: la franja del día ─────────────────────────────────────────────────────────────── */
      .cm-hoy-res { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 13px; color: var(--text2); margin-bottom: 10px; }
      .cm-hoy-res b { color: var(--text); font-weight: 600; }
      .cm-franja { position: relative; height: 34px; border-radius: 9px; background: var(--bg3);
        overflow: hidden; margin: 4px 0 5px; }
      .cm-fr-seg { position: absolute; top: 3px; bottom: 3px; border-radius: 5px; }
      .cm-fr-cita { background: var(--accent); }
      .cm-fr-cita.pedida { background: var(--warn); }
      .cm-fr-cita.atendida { background: var(--ok); }
      .cm-fr-cita.no_show { background: var(--danger); }
      .cm-fr-blq { background: repeating-linear-gradient(45deg, var(--text3) 0 4px, transparent 4px 8px); }
      .cm-fr-ahora { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--danger); }
      .cm-fr-esc { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--text3);
        font-variant-numeric: tabular-nums; }
      .cm-ley { display: flex; flex-wrap: wrap; gap: 3px 12px; font-size: 11px; color: var(--text3); margin-top: 6px; }
      .cm-ley span { display: inline-flex; align-items: center; gap: 5px; }
      .cm-ley i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
      .cm-prox { display: flex; align-items: center; gap: 10px; background: var(--accent-soft);
        border: 1px solid #cfe0ff; border-radius: 11px; padding: 9px 11px; margin-top: 10px;
        text-decoration: none; color: inherit; min-width: 0; }
      .cm-prox .hh { font-weight: 700; font-size: 15px; color: var(--accent-d); white-space: nowrap;
        font-variant-numeric: tabular-nums; }
      .cm-prox .tx { min-width: 0; flex: 1; }
      .cm-prox .tx b { display: block; font-size: 13px; color: var(--text); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .cm-prox .tx span { display: block; font-size: 11.5px; color: var(--text2); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .cm-ev { display: flex; gap: 9px; align-items: baseline; font-size: 12px; color: var(--text2);
        padding: 5px 0; border-top: 1px solid var(--border); min-width: 0; }
      .cm-ev .h { font-variant-numeric: tabular-nums; color: var(--text3); white-space: nowrap; }
      .cm-ev .m { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* ── TUS NÚMEROS: cuatro tarjetas grandes ───────────────────────────────────────────────── */
      .cm-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 14px; }
      .cm-num { background: var(--bg2); border: 1px solid var(--border2); border-radius: 14px;
        padding: 13px 15px; min-width: 0; display: flex; flex-direction: column; gap: 3px; box-sizing: border-box; }
      .cm-num-l { font-size: 11.5px; color: var(--text2); display: flex; align-items: center; gap: 5px; margin: 0; }
      .cm-num-l i { font-size: 14px; }
      .cm-num-v { font-size: 23px; font-weight: 700; color: var(--text); margin: 1px 0 0;
        letter-spacing: -.6px; line-height: 1.15; overflow-wrap: anywhere; }
      .cm-num-b { font-size: 11.5px; color: var(--text3); margin: 0; line-height: 1.45; overflow-wrap: anywhere; }
      .cm-cmp { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600;
        border-radius: 20px; padding: 1px 9px; align-self: flex-start; white-space: nowrap; }
      .cm-cmp.bien { background: var(--ok-s); color: var(--ok); }
      .cm-cmp.mal { background: var(--danger-s); color: var(--danger); }
      .cm-cmp.neutro { background: var(--bg3); color: var(--text2); }
      .cm-chispa { margin-top: 4px; }
      .cm-chispa svg { display: block; width: 100%; height: 26px; }

      /* ── EL GRÁFICO PRINCIPAL ───────────────────────────────────────────────────────────────── */
      .cm-graf { position: relative; height: 240px; min-width: 0; }

      /* ── TU NEGOCIO EN CIFRAS: tres listas cortas ───────────────────────────────────────────── */
      .cm-listas { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
      .cm-lista { min-width: 0; }
      .cm-lista h4 { margin: 0 0 4px; font-size: 12.5px; font-weight: 700; color: var(--text); }
      .cm-fila { display: flex; align-items: baseline; gap: 8px; padding: 6px 0; border-top: 1px solid var(--border);
        min-width: 0; font-size: 12.5px; text-decoration: none; color: inherit; }
      .cm-fila.primera { border-top: none; }
      .cm-fila .p { color: var(--text3); font-size: 11px; font-weight: 700; min-width: 1.5em; flex: none;
        font-variant-numeric: tabular-nums; }
      .cm-fila .n { flex: 1; min-width: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cm-fila .v { color: var(--text2); white-space: nowrap; font-variant-numeric: tabular-nums; }
      .cm-fila.ultimo { margin-top: 5px; border-top: 1px dashed var(--border2); }
      .cm-fila.ultimo .p { color: var(--danger); }
      .cm-pie { font-size: 11px; color: var(--text3); margin: 9px 0 0; line-height: 1.55; }

      /* ── OPORTUNIDADES ABIERTAS: una línea ──────────────────────────────────────────────────── */
      .cm-oport { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        text-decoration: none; color: inherit; min-width: 0; }
      .cm-oport .big { font-size: 16px; font-weight: 700; color: var(--text); }
      .cm-oport .cta { margin-left: auto; font-size: 12.5px; color: var(--accent); font-weight: 600; white-space: nowrap; }

      /* ── DISA DECIDE: máximo tres líneas, cifra delante y botón ─────────────────────────────── */
      .cm-dec { display: flex; align-items: center; gap: 10px; padding: 10px 0;
        border-top: 1px solid var(--border); min-width: 0; flex-wrap: wrap; }
      .cm-dec.primera { border-top: none; }
      .cm-dec .cifra { font-weight: 700; font-size: 14.5px; color: var(--text); white-space: nowrap;
        font-variant-numeric: tabular-nums; }
      .cm-dec .tx { flex: 1; min-width: 150px; font-size: 12.5px; color: var(--text2); line-height: 1.45; }
      .cm-dec .btn { font-size: 12px; font-weight: 600; color: #fff; background: var(--accent);
        border-radius: 9px; padding: 6px 13px; text-decoration: none; white-space: nowrap; }
      .cm-dec .btn:hover { background: var(--accent-d); color: #fff; }
      .cm-pill { font-size: 10px; font-weight: 700; border-radius: 20px; padding: 1px 8px; white-space: nowrap; }

      /* ── TUS PANELES: la rejilla componible del paso 6, que sigue viva ──────────────────────── */
      .cm-paneles { margin-top: 4px; }

      @media (max-width: 560px) {
        .cm-graf { height: 200px; }
        .cm-dec .btn { width: 100%; text-align: center; }
        .cm-num-v { font-size: 21px; }
        /* La barra de la rejilla se parte en dos líneas: en 390 px el rótulo y los dos botones no
           caben en una, y apretados el rótulo se leía en columna de dos letras. */
        .ig-bar { flex-wrap: wrap; }
        .ig-actions { width: 100%; }
      }

      /* PON EN MARCHA TU NEGOCIO — lo nuevo sobre el estilo de U6, que se reutiliza tal cual. */
      .onb-bloque { margin-top: 14px; }
      .onb-bloque h4 { margin: 0; font-size: .82rem; font-weight: 700; color: var(--text); letter-spacing: -.005em; }
      .onb-bsub { margin: .1rem 0 .5rem; font-size: .76rem; color: var(--text3); line-height: 1.45; }
      .onb-plegar { background: none; border: none; cursor: pointer; color: var(--text3); padding: .3rem .4rem;
        border-radius: 8px; line-height: 1; font-size: 1rem; flex: none; }
      .onb-plegar:hover { color: var(--text); background: var(--bg3); }
      /* Plegado = UNA LÍNEA, no desaparecido: sigue diciendo el progreso y se abre de un clic. */
      .onb-plegado { display: flex; align-items: center; gap: .55rem; width: 100%; cursor: pointer;
        background: var(--bg2); border: 1px solid var(--border2); border-radius: 12px;
        padding: .7rem .95rem; font-family: inherit; font-size: .86rem; color: var(--text2);
        margin-bottom: 18px; text-align: left; }
      .onb-plegado:hover { border-color: var(--accent); }
      .onb-plegado strong { color: var(--text); font-weight: 600; }
      .onb-plegado span { margin-left: auto; color: var(--text3); font-size: .8rem; white-space: nowrap; }
      .onb-plegado > i.ti:first-child { color: var(--ok); }
      .onb-extra { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border2); }
      .onb-mas { appearance: none; border: 1px dashed var(--border2); background: transparent; color: var(--text3);
        font-family: inherit; font-size: .8rem; padding: .35rem .7rem; border-radius: 999px; cursor: pointer; }
      .onb-mas:hover { border-color: var(--accent); color: var(--accent); }

      /* Bloque nativo «Hoy» de la rejilla. */
      .ig-hoy { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
      .ig-hoy-cab { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; font-size: .82rem; color: var(--text2); }
      .ig-hoy-cab strong { color: var(--text); font-size: .95rem; }
      .ig-hoy-fila { display: flex; align-items: baseline; gap: .55rem; padding: .35rem 0;
        border-bottom: 1px solid var(--border); min-width: 0; }
      .ig-hoy-fila:last-child { border-bottom: none; }
      .ig-hoy-fila .h { font-variant-numeric: tabular-nums; font-weight: 600; font-size: .82rem; white-space: nowrap; }
      .ig-hoy-fila .c { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .84rem; }
      .ig-hoy-fila .q { color: var(--text3); font-size: .75rem; white-space: nowrap; }

      /* G4 · el paso del margen. Dos opciones grandes, ninguna premarcada, y una salida. */
      .onb-mg-ej{font-size:.83rem;color:var(--text2);background:var(--bg3);border-radius:8px;padding:.5rem .65rem;margin:.5rem 0 .55rem}
      .onb-mg{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.5rem}
      .onb-mg-op{display:flex;flex-direction:column;gap:.1rem;text-align:left;font-family:inherit;cursor:pointer;
        border:2px solid var(--border2);background:var(--bg2);border-radius:10px;padding:.6rem .75rem;min-width:0}
      .onb-mg-op:hover{border-color:var(--accent)}
      .onb-mg-op .n{font-weight:700;font-size:.9rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .onb-mg-op .p{font-size:.75rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .onb-mg-pie{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-top:.55rem;font-size:.76rem;color:var(--text3)}
      .onb-saltar{background:none;border:none;padding:0;font-family:inherit;font-size:.78rem;color:var(--accent);cursor:pointer;text-decoration:underline}
      /* ── PIEZA 5 · "Dónde te espera": asoman en el Inicio los avisos del vigía más importantes. Bloque
         NUEVO (no reestructura el resto); reutiliza los tokens de la app y el patrón de la lista. ── */
      .dh-vigia { background: var(--bg2); border: 1px solid var(--border2); border-radius: 12px; padding: 6px 4px; margin-bottom: 18px; }
      .dh-vigia-head { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--text2); padding: 9px 12px 6px; }
      .dh-vigia-head i { font-size: 15px; color: var(--accent); }
      .dh-vigia-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; font-size: 12.5px; text-decoration: none; color: inherit; }
      .dh-vigia-row + .dh-vigia-row { border-top: 0.5px solid var(--bg3); }
      .dh-vigia-row:hover { background: var(--bg3); }
      .dh-vigia-tx { color: var(--body-tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dh-vigia-pill { font-size: 10px; font-weight: 700; padding: 1px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; }
      .dh-vigia-more { display: block; padding: 8px 12px; font-size: 11.5px; color: var(--accent); text-decoration: none; border-top: 0.5px solid var(--bg3); }
      .dh-vigia-more:hover { background: var(--bg3); }

      /* ── PASO 6 · INICIO PERSONALIZABLE — la rejilla componible. Reutiliza los tokens de la app. ── */
      .ig-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; min-height: 24px; }
      .ig-scope { font-size: 11.5px; color: var(--text2); }
      .ig-scope b { color: var(--text); font-weight: 600; }
      .ig-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .ig-btn { background: var(--bg2); border: 1px solid var(--border2); color: var(--text2); font-size: 11.5px; padding: 5px 11px; border-radius: 8px; cursor: pointer; font-family: inherit; transition: all .15s; }
      .ig-btn:hover { background: var(--bg3); color: var(--text); }
      .ig-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
      .ig-btn.primary:hover { background: var(--accent-d); color: #fff; }
      .ig-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; grid-auto-rows: 118px; }
      .ig-block { background: var(--bg2); border: 1px solid var(--border2); border-radius: 12px; padding: 13px 14px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
      .ig-block.w1 { grid-column: span 1; } .ig-block.w2 { grid-column: span 2; } .ig-block.w3 { grid-column: span 3; } .ig-block.w4 { grid-column: span 4; }
      .ig-block.h1 { grid-row: span 1; } .ig-block.h2 { grid-row: span 2; } .ig-block.h3 { grid-row: span 3; } .ig-block.h4 { grid-row: span 4; }
      .ig-block-head { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text2); margin-bottom: 8px; }
      .ig-block-head i { font-size: 14px; color: var(--accent); }
      .ig-block-body { flex: 1; min-height: 0; overflow: auto; }
      .ig-note, .ig-empty { color: var(--muted); font-size: 12px; padding: 6px 2px; }
      .ig-empty { text-align: center; padding: 28px 10px; }
      /* KPIs dentro de un bloque */
      .ig-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
      .ig-kpi-label { font-size: 11px; color: var(--text2); display: flex; align-items: center; gap: 5px; margin: 0 0 5px; }
      .ig-kpi-value { font-size: 20px; font-weight: 600; margin: 0; color: var(--text); letter-spacing: -.5px; }
      /* Modo edición */
      .ig-grid.editing .ig-block { border-style: dashed; border-color: var(--accent); cursor: grab; }
      .ig-block-tools { display: none; gap: 4px; margin-left: auto; }
      .ig-grid.editing .ig-block-tools { display: flex; }
      .ig-tool { background: var(--bg3); border: 1px solid var(--border2); color: var(--text2); font-size: 10px; width: 20px; height: 20px; border-radius: 5px; cursor: pointer; line-height: 1; padding: 0; font-family: inherit; }
      .ig-tool:hover { background: var(--accent-soft); color: var(--accent-d); }
      .ig-sortable-ghost { opacity: .4; }
      /* Paleta */
      .ig-palette { border: 1px dashed var(--border2); border-radius: 12px; padding: 12px; margin-bottom: 14px; background: var(--bg2); }
      .ig-palette-title { font-size: 11px; font-weight: 600; color: var(--text2); margin-bottom: 8px; }
      .ig-palette-items { display: flex; flex-wrap: wrap; gap: 6px; }
      .ig-chip { background: var(--bg3); border: 1px solid var(--border2); color: var(--text); font-size: 11.5px; padding: 6px 11px; border-radius: 8px; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 5px; }
      .ig-chip:hover { background: var(--accent-soft); border-color: var(--accent); }
      .ig-chip i { font-size: 13px; color: var(--accent); }
      @media (max-width: 900px) { .ig-grid { grid-template-columns: repeat(2, 1fr); } .ig-block.w3, .ig-block.w4 { grid-column: span 2; } }
      /* ── U6 · Onboarding — "Configura tu negocio" (nivel Stripe/Shopify): anillo de progreso +
         timeline de pasos con iconos; el paso ACTUAL desplegado con la guía de DISA + su acción;
         los hechos y los futuros plegados. Reutiliza los tokens de la app. ── */
      .onb-card { background: var(--bg2); border: 1px solid var(--border2); border-radius: 16px; padding: 20px 20px 8px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(16,24,40,.05); animation: onb-in .5s cubic-bezier(.2,.7,.3,1) both; }
      @keyframes onb-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      .onb-hero { display: flex; align-items: center; gap: 16px; }
      .onb-ring { position: relative; width: 56px; height: 56px; flex-shrink: 0; }
      .onb-ring svg { transform: rotate(-90deg); }
      .onb-ring-bg { fill: none; stroke: var(--bg3); stroke-width: 5; }
      .onb-ring-fg { fill: none; stroke: var(--accent); stroke-width: 5; stroke-linecap: round; transition: stroke-dashoffset .7s cubic-bezier(.2,.7,.3,1); }
      .onb-ring-n { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: var(--text); }
      .onb-ring-n i { font-style: normal; font-size: 10px; font-weight: 600; color: var(--text3); margin-left: 1px; }
      .onb-title { font-size: 16px; font-weight: 700; margin: 0; letter-spacing: -.2px; color: var(--text); }
      .onb-sub { font-size: 13px; color: var(--text2); margin: 3px 0 0; }
      .onb-disa { display: flex; gap: 10px; align-items: flex-start; margin: 15px 0 8px; padding: 11px 13px; background: var(--accent-soft); border: 1px solid #cfe0ff; border-radius: 11px; font-size: 12.75px; line-height: 1.5; color: var(--text); }
      .onb-disa-ic { color: var(--accent); font-size: 16px; flex-shrink: 0; display: flex; margin-top: 1px; }
      /* Timeline */
      .onb-steps { position: relative; padding: 4px 0; }
      .onb-step { position: relative; display: flex; gap: 14px; padding: 8px 0; text-decoration: none; }
      .onb-step::before { content: ''; position: absolute; left: 17px; top: 40px; bottom: -4px; width: 2px; background: var(--border2); }
      .onb-step:last-child::before { display: none; }
      .onb-node { position: relative; z-index: 1; flex-shrink: 0; }
      .onb-ic { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; background: var(--bg3); color: var(--text3); border: 3px solid var(--bg2); box-sizing: content-box; }
      .onb-step.done .onb-ic { background: var(--ok-s); color: var(--ok); }
      .onb-step.now .onb-ic { background: var(--accent); color: #fff; box-shadow: 0 4px 14px var(--teal-glow); }
      .onb-sbody { flex: 1; min-width: 0; padding-top: 8px; }
      .onb-shead { display: flex; align-items: center; gap: 10px; }
      .onb-stitle { font-size: 14px; font-weight: 600; color: var(--text); }
      .onb-step.done .onb-stitle { color: var(--text3); font-weight: 500; }
      .onb-step.soon .onb-stitle { color: var(--text2); font-weight: 500; }
      .onb-tag { flex-shrink: 0; margin-left: auto; font-size: 11px; font-weight: 600; color: var(--ok); background: var(--ok-s); padding: 2px 9px; border-radius: 10px; }
      .onb-time { flex-shrink: 0; margin-left: auto; font-size: 11.5px; color: var(--text3); }
      .onb-step.soon { cursor: pointer; }
      .onb-step.soon:hover .onb-stitle { color: var(--accent); }
      .onb-step.now { padding-bottom: 12px; }
      .onb-when { font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--accent); margin: 5px 0 7px; }
      .onb-guide { margin: 0 0 13px; font-size: 12.9px; line-height: 1.62; color: var(--text2); max-width: 58ch; }
      .onb-guide b { color: var(--text); font-weight: 600; }
      .onb-cta { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #fff; background: var(--accent); text-decoration: none; padding: 9px 17px; border-radius: 10px; box-shadow: 0 3px 12px var(--teal-glow); transition: background .15s, transform .15s, box-shadow .15s; }
      .onb-cta:hover { background: var(--accent-d); transform: translateY(-1px); box-shadow: 0 6px 18px var(--teal-glow); }
      .onb-cta i { font-size: 15px; }
      @media (prefers-reduced-motion: reduce) { .onb-card { animation: none; } .onb-ring-fg { transition: none; } .onb-cta:hover { transform: none; } }
    </style>

    <div class="cm">
      <h3 class="cm-hola">${_saludo}, ${userName}</h3>
      <p class="cm-fecha">${fechaHoy}</p>

      <!-- 1 · HOY. Sin agenda este hueco se queda vacío: el servidor no manda la sección siquiera. -->
      <div id="cmHoy"></div>
      <!-- 2 · TUS NÚMEROS -->
      <div id="cmNumeros"></div>
      <!-- 3 · EL GRÁFICO PRINCIPAL -->
      <div id="cmGrafico"></div>
      <!-- 4 · TU NEGOCIO EN CIFRAS -->
      <div id="cmCifras"></div>
      <!-- 5 · OPORTUNIDADES ABIERTAS -->
      <div id="cmOport"></div>
      <!-- 6 · DISA DECIDE. Sin nada que recomendar, no aparece. -->
      <div id="cmDecide"></div>

      <!-- 7 · PON EN MARCHA TU NEGOCIO. Se pinta en el navegador desde /api/erp/inicio/arranque;
           nace desplegado si el negocio no tiene actividad real y plegado si la tiene, y el pliegue
           se recuerda por usuario. Si no hay nada que ofrecer, no ocupa nada. -->
      <div id="onbPanel"></div>

      <!-- 8 · TUS PANELES — la rejilla componible del paso 6, intacta: cascada usuario > empresa >
           fábrica, su paleta y su modo edición. Baja al final porque el cuadro de mando manda; lo
           que cada uno se monte encima sigue estando y sigue guardándose igual. -->
      <div class="cm-paneles">
        <p class="cm-h" style="margin-bottom:8px"><i class="ti ti-layout-board"></i>Tus paneles<span class="x">lo que tú montas encima</span></p>
        <div class="ig-bar">
          <span id="igScope" class="ig-scope"></span>
          <div class="ig-actions" id="igActions"></div>
        </div>
        <div id="inicioGrid" class="ig-grid"><div class="ig-empty">Cargando tus paneles…</div></div>
      </div>
    </div>

    <!-- El gráfico principal y los de panel se pintan con el MISMO Chart.js del vendor que ya usa el
         constructor. Sortable.js (ya vendido) para reordenar los bloques de la rejilla. -->
    <script src="/public/vendor/chartjs/chart.umd.min.js"></script>
    <script src="/public/js/grafico-constructor.js"></script>
    <script src="/public/vendor/sortablejs/Sortable.min.js"></script>
    <script>
      // El token CSRF para las llamadas que MUTAN (guardar el layout, plegar el panel). Vivía en el
      // bloque del chat; se conserva aquí porque la rejilla y el panel de arranque lo usan.
      function dhGetCsrf() {
        return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || window.CSRF_TOKEN || '';
      }

      // ══════════════════════════════════════════════════════════════════════════════════════════
      // EL CUADRO DE MANDO DEL DÍA — se pinta con lo que devuelve /api/erp/inicio/cuadro
      // ══════════════════════════════════════════════════════════════════════════════════════════
      // CERO CIFRA PROPIA. Aquí no se suma, no se divide y no se compara nada: el servidor manda
      // cada número ya sacado de su motor (ventas, cobros, margen, CRM, agenda, vigía) y esto solo
      // lo escribe en español. Si un dato viene null se pinta «—», nunca un 0.
      //
      // LO QUE NO PUEDE VER ESTE USUARIO NI SIQUIERA LLEGA: el servidor no calcula las secciones
      // cuyos permisos le faltan, así que no hay nada que esconder al pintar.
      (function initCuadro(){
        var esc = window.escHtml || function(s){ return s == null ? '' : String(s); };
        var SYM = '${simbolo}';
        var D = null;

        // ── Español de verdad: 1.234,50 € y 36,3 %. Un «€1234.5» no es una cifra de esta casa. ──
        function num(n, d){
          return Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });
        }
        function eur(n){ return n == null ? '—' : num(n, 2) + ' ' + SYM; }
        function eur0(n){ return n == null ? '—' : num(n, 0) + ' ' + SYM; }
        function pct(n){ return n == null ? '—' : num(n, 1) + ' %'; }
        function ent(n){ return n == null ? '—' : num(n, 0); }
        var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        function mesLargo(k){ var p = String(k).split('-'); return (MESES[Number(p[1]) - 1] || k); }
        function fechaEs(iso){ var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
        // El vigía fecha unos avisos por DÍA (un vencimiento) y otros por MES (una caída de
        // facturación). Los dos se escriben en español, cada uno con su forma.
        // (Sin expresiones regulares a propósito: dentro de una plantilla del servidor la barra de
        // un \\d se la come la plantilla y el regex llega roto. Se mira el largo, que basta.)
        function cuando(iso){
          var s = String(iso || '');
          if (s.length === 10) return fechaEs(s);
          if (s.length === 7) return mesLargo(s) + ' de ' + s.slice(0, 4);
          return s;
        }

        // La comparación, en su chip de color. Sin comparación no hay chip de color: hay un «—» y el
        // motivo al lado, que es la verdad y no un empate inventado.
        function chip(cmp, unidad){
          if (!cmp || !cmp.hay) return '<span class="cm-cmp neutro">— sin comparación</span>';
          var f = cmp.tono === 'bien' ? 'ti-trending-up' : cmp.tono === 'mal' ? 'ti-trending-down' : 'ti-minus';
          var txt;
          // Un «— 0,00 €» se lee igual que el «—» de «no hay dato», y son cosas distintas: una es
          // «no lo sé» y la otra «lo sé, y es lo mismo». Se dice con palabras.
          if (cmp.delta === 0) txt = 'igual que el mes pasado';
          else if (cmp.puntos) txt = (cmp.delta > 0 ? '+' : '') + num(cmp.delta, 1) + ' p.p.';
          else if (cmp.pct != null) txt = (cmp.pct > 0 ? '+' : '') + num(cmp.pct, 1) + ' %';
          else txt = (cmp.delta > 0 ? '+' : '') + (unidad === 'eur' ? eur(cmp.delta) : ent(cmp.delta));
          return '<span class="cm-cmp ' + cmp.tono + '"><i class="ti ' + f + '"></i>' + esc(txt) + '</span>';
        }

        // Minigráfica: una polilínea normalizada, sin ejes ni números. No afirma una magnitud —para
        // eso están la cifra de arriba y el gráfico grande—, solo enseña la forma.
        function chispa(vals, color){
          if (!vals || vals.length < 2) return '';
          var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
          var rango = (max - min) || 1;
          var pasos = vals.length - 1;
          var pts = vals.map(function(v, i){
            var x = (i / pasos) * 100;
            var y = 24 - ((v - min) / rango) * 22;
            return x.toFixed(2) + ',' + y.toFixed(2);
          }).join(' ');
          return '<div class="cm-chispa"><svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">'
            + '<polyline fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke" points="' + pts + '"/>'
            + '</svg></div>';
        }

        function tarjeta(o){
          return '<div class="cm-num">'
            + '<p class="cm-num-l"><i class="ti ' + o.icon + '" style="color:' + o.color + '"></i>' + esc(o.label) + '</p>'
            + '<p class="cm-num-v">' + o.valor + '</p>'
            + (o.base ? '<p class="cm-num-b">' + o.base + '</p>' : '')
            + o.chip
            + (o.chispa || '')
            + '</div>';
        }

        // ── HOY ─────────────────────────────────────────────────────────────────────────────────
        // La franja: el horario abierto de fondo, las citas y los eventos encima. Los minutos son
        // los que da la agenda (agendaData) y las horas libres las que da ocupacionDia — dibujar no
        // es calcular, y aquí no se calcula nada.
        function hhmm(m){ return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
        function pintaHoy(h){
          var box = document.getElementById('cmHoy');
          if (!h) { box.innerHTML = ''; return; }
          var res = '<div class="cm-hoy-res"><span><b>' + h.n + '</b> ' + (h.n === 1 ? 'cita' : 'citas') + '</span>'
            + (h.libre_h != null ? '<span><b>' + num(h.libre_h, 1) + ' h</b> libres</span>' : '')
            + (h.pct != null ? '<span><b>' + h.pct + ' %</b> ocupado</span>' : '')
            + (h.bloqueos && h.bloqueos.length ? '<span><b>' + h.bloqueos.length + '</b> ' + (h.bloqueos.length === 1 ? 'evento' : 'eventos') + '</span>' : '')
            + '</div>';
          // SIN HORARIO PUESTO NO SE MIENTE: el motor abre de 8 a 21 por defecto, así que las horas
          // libres no significan nada todavía. Se dice y se manda a ponerlo.
          if (h.sin_horario) {
            res += '<div class="cm-pie" style="margin:0 0 8px">Todavía no has puesto tu horario, así que doy por abierto de 8 a 21 '
              + 'y las horas libres no significan nada. <a href="/admin/citas/horarios">Ponlo aquí</a>.</div>';
          }
          var franja = '';
          var tr = h.tramos || [];
          var ini = null, fin = null;
          tr.forEach(function(t){ ini = ini == null ? t.ini : Math.min(ini, t.ini); fin = fin == null ? t.fin : Math.max(fin, t.fin); });
          (h.citas || []).forEach(function(c){ ini = ini == null ? c.inicio_min : Math.min(ini, c.inicio_min); fin = fin == null ? c.fin_min : Math.max(fin, c.fin_min); });
          (h.bloqueos || []).forEach(function(b){ ini = ini == null ? b.inicio_min : Math.min(ini, b.inicio_min); fin = fin == null ? b.fin_min : Math.max(fin, b.fin_min); });
          if (ini != null && fin != null && fin > ini) {
            var span = fin - ini;
            var pos = function(a, b){
              var x = ((a - ini) / span) * 100, w = ((b - a) / span) * 100;
              return 'left:' + Math.max(0, x).toFixed(2) + '%;width:' + Math.max(0.6, Math.min(100 - x, w)).toFixed(2) + '%';
            };
            var segs = (h.citas || []).map(function(c){
              return '<span class="cm-fr-seg cm-fr-cita ' + esc(c.estado) + '" style="' + pos(c.inicio_min, c.fin_min) + '" '
                + 'title="' + esc(c.hora + '–' + c.fin + ' · ' + c.cliente) + '"></span>';
            }).join('') + (h.bloqueos || []).map(function(b){
              return '<span class="cm-fr-seg cm-fr-blq" style="' + pos(b.inicio_min, b.fin_min) + '" '
                + 'title="' + esc(b.hora + '–' + b.fin + (b.motivo ? ' · ' + b.motivo : '')) + '"></span>';
            }).join('');
            var ahora = (h.ahora != null && h.ahora >= ini && h.ahora <= fin)
              ? '<span class="cm-fr-ahora" style="left:' + (((h.ahora - ini) / span) * 100).toFixed(2) + '%" title="Ahora"></span>' : '';
            franja = '<div class="cm-franja">' + segs + ahora + '</div>'
              + '<div class="cm-fr-esc"><span>' + hhmm(ini) + '</span><span>' + hhmm(fin) + '</span></div>'
              + '<div class="cm-ley"><span><i style="background:var(--accent)"></i>Ocupado</span>'
              + '<span><i style="background:var(--bg3);border:1px solid var(--border2)"></i>Libre</span>'
              + (h.bloqueos && h.bloqueos.length ? '<span><i style="background:var(--text3)"></i>Evento del calendario</span>' : '')
              + '</div>';
          }
          var prox = '';
          if (h.proxima) {
            prox = '<a class="cm-prox" href="/admin/citas?fecha=' + esc(h.fecha) + '">'
              + '<span class="hh">' + esc(h.proxima.hora) + '</span>'
              + '<span class="tx"><b>' + esc(h.proxima.cliente) + '</b>'
              + '<span>' + esc((h.proxima.servicios || 'Cita') + ' · ' + h.proxima.persona) + '</span></span>'
              + '<i class="ti ti-chevron-right" style="color:var(--accent)"></i></a>';
          } else if (!h.citas.length) {
            prox = '<div class="cm-pie">' + (h.abre ? 'Hoy no tienes ninguna cita.' : 'Hoy no abres.')
              + ' <a href="/admin/citas">Ver la agenda</a></div>';
          } else {
            prox = '<div class="cm-pie">Ya no te queda ninguna cita por delante hoy. <a href="/admin/citas">Ver la agenda</a></div>';
          }
          var eventos = (h.bloqueos || []).map(function(b){
            return '<div class="cm-ev"><span class="h">' + esc(b.hora + '–' + b.fin) + '</span>'
              + '<span class="m">' + esc(b.motivo || 'Evento del calendario') + '</span></div>';
          }).join('');
          box.innerHTML = '<div class="cm-card">'
            + '<p class="cm-h"><i class="ti ti-calendar-event"></i>Hoy<span class="x">' + esc(fechaEs(h.fecha)) + '</span></p>'
            + res + franja + prox + eventos + '</div>';
        }

        // ── TUS NÚMEROS ─────────────────────────────────────────────────────────────────────────
        function pintaNumeros(s, per){
          var box = document.getElementById('cmNumeros'), cards = [];
          if (s.ventas) {
            cards.push(tarjeta({
              icon: 'ti-cash', color: 'var(--accent)', label: 'Ventas del mes',
              valor: eur(s.ventas.base),
              base: 'sin IVA · ' + eur(s.ventas.total) + ' facturado con IVA · ' + ent(s.ventas.facturas)
                + (s.ventas.facturas === 1 ? ' factura' : ' facturas'),
              chip: chip(s.ventas.comparacion, 'eur'),
              chispa: chispa(s.ventas.chispa, 'var(--accent)'),
            }));
          }
          if (s.cobro) {
            cards.push(tarjeta({
              icon: 'ti-clock-dollar', color: 'var(--warn)', label: 'Pendiente de cobro',
              valor: eur(s.cobro.total),
              base: ent(s.cobro.facturas) + ' facturas vivas'
                + (s.cobro.vencidas ? ' · <b style="color:var(--danger)">' + ent(s.cobro.vencidas) + ' vencidas por ' + eur(s.cobro.vencido) + '</b>' : ' · ninguna vencida'),
              chip: chip(s.cobro.comparacion, 'eur'),
              chispa: '<p class="cm-num-b">' + esc(s.cobro.porQueNoHayComparacion) + '</p>',
            }));
          }
          if (s.margen) {
            // NINGÚN PORCENTAJE DE MARGEN SIN SU BASE (CANON). El sufijo dice sobre qué se divide y
            // la línea de abajo dice sobre CUÁNTO — y cuánto queda fuera por no tener coste.
            var m = s.margen.margen || {};
            var base = 'sobre ' + eur(m.venta) + ' con coste conocido';
            if (m.fuera > 0) base += ' · quedan fuera ' + eur(m.fuera) + ' (' + pct(m.fueraPct) + ' de lo vendido) sin coste';
            else if (m.hay) base += ' · todo lo vendido tiene coste';
            cards.push(tarjeta({
              icon: 'ti-percentage', color: 'var(--ok)', label: 'Margen del mes',
              valor: (s.margen.pct == null ? '—' : pct(s.margen.pct) + ' <span style="font-size:12px;font-weight:600;color:var(--text2)">' + esc(s.margen.sufijo) + '</span>'),
              base: (s.margen.euros == null ? 'Ninguna línea tiene coste conocido todavía.' : eur(s.margen.euros) + ' · ' + base),
              chip: chip(s.margen.comparacion),
              chispa: chispa(s.margen.chispa, 'var(--ok)'),
            }));
          }
          if (s.clientes) {
            cards.push(tarjeta({
              icon: 'ti-user-plus', color: 'var(--accent-purple)', label: 'Clientes nuevos',
              valor: ent(s.clientes.nuevos),
              base: 'en ' + esc(mesLargo(per.mes))
                + (s.clientes.mesAnteriorCompleto == null ? '' : ' · ' + ent(s.clientes.mesAnteriorCompleto) + ' en ' + esc(mesLargo(per.mesAnt)) + ' completo'),
              chip: chip(s.clientes.comparacion),
              chispa: chispa(s.clientes.chispa, 'var(--accent-purple)'),
            }));
          }
          box.innerHTML = cards.length ? '<div class="cm-nums">' + cards.join('') + '</div>' : '';
        }

        // ── EL GRÁFICO PRINCIPAL ────────────────────────────────────────────────────────────────
        // Uno solo y grande: las ventas de cada día del mes, con el mes anterior detrás en gris. La
        // serie sale de ventasPorDia(), el ÚNICO motor de serie diaria que existe — y devuelve el
        // total CON IVA. Se dice en el rótulo; no se disimula ni se inventa una serie en base.
        function pintaGrafico(g, per){
          var box = document.getElementById('cmGrafico');
          if (!g || !g.actual || !g.actual.length) { box.innerHTML = ''; return; }
          box.innerHTML = '<div class="cm-card">'
            + '<p class="cm-h"><i class="ti ti-chart-bar"></i>Ventas por día<span class="x">'
            + esc(mesLargo(g.mes)) + ' · en gris, ' + esc(mesLargo(g.mesAnt)) + '</span></p>'
            + '<div class="cm-graf"><canvas id="cmGrafCanvas"></canvas></div>'
            + '<p class="cm-pie">Facturado con IVA, día a día. El titular de arriba va sin IVA porque es lo que cuadra con el informe de ventas.</p>'
            + '</div>';
          if (typeof Chart === 'undefined') return;
          var dias = Math.max(g.actual.length, g.anterior.length);
          var etiquetas = [], serieA = [], serieB = [];
          for (var i = 0; i < dias; i++) {
            etiquetas.push(String(i + 1));
            serieA.push(i < g.actual.length ? g.actual[i].total : null);
            serieB.push(i < g.anterior.length ? g.anterior[i].total : null);
          }
          new Chart(document.getElementById('cmGrafCanvas'), {
            type: 'bar',
            data: { labels: etiquetas, datasets: [
              { label: mesLargo(g.mesAnt), data: serieB, backgroundColor: 'rgba(138,143,153,.28)', borderRadius: 3, order: 2 },
              { label: mesLargo(g.mes), data: serieA, backgroundColor: '#2F6BFF', borderRadius: 3, order: 1 },
            ] },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
                tooltip: { callbacks: { label: function(ctx){ return ctx.dataset.label + ': ' + eur(ctx.parsed.y); } } } },
              scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } },
                        y: { beginAtZero: true, ticks: { font: { size: 10 }, maxTicksLimit: 7,
                             // Con un negocio sin ventas, Chart.js reparte el eje entre 0 y 1 y todos
                             // los tramos se redondeaban al mismo texto («0 €, 0 €, 1 €, 1 €…»). Se
                             // rotulan solo los enteros; los demás quedan mudos, que es la verdad.
                             callback: function(v){ return Number.isInteger(v) ? eur0(v) : ''; } } } },
            },
          });
        }

        // ── TU NEGOCIO EN CIFRAS ────────────────────────────────────────────────────────────────
        function fila(i, puesto, nombre, valor, ultimo, href){
          var cls = 'cm-fila' + (i === 0 ? ' primera' : '') + (ultimo ? ' ultimo' : '');
          var t = href ? 'a' : 'div';
          return '<' + t + ' class="' + cls + '"' + (href ? ' href="' + esc(href) + '"' : '') + '>'
            + '<span class="p">' + (ultimo ? '↓' : puesto + '.') + '</span>'
            + '<span class="n">' + esc(nombre) + '</span>'
            + '<span class="v">' + valor + '</span></' + t + '>';
        }
        function pintaCifras(s){
          var box = document.getElementById('cmCifras'), cols = [];
          if (s.productos) {
            var P = s.productos;
            var vend = P.vendidos.length
              ? P.vendidos.map(function(p, i){ return fila(i, p.puesto, p.nombre, ent(p.qty) + ' uds', p.ultimo); }).join('')
              : '<div class="cm-pie">Todavía no hay ningún producto con ' + esc(P.sueloTexto) + '.</div>';
            var rent = P.rentables.length
              ? P.rentables.map(function(p, i){
                  // El % NUNCA va desnudo: lleva su sufijo (sobre qué se divide) y su base (sobre cuánto).
                  return fila(i, p.puesto, p.nombre,
                    (p.pct == null ? '—' : pct(p.pct) + ' <span style="color:var(--text3)">' + esc(p.sufijo) + ' · sobre ' + eur(p.base) + '</span>'),
                    p.ultimo);
                }).join('')
              : '<div class="cm-pie">Todavía no hay ningún producto con coste conocido y ' + esc(P.sueloTexto) + '.</div>';
            cols.push('<div class="cm-lista"><h4>Lo que más vendes</h4>' + vend + '</div>');
            cols.push('<div class="cm-lista"><h4>Lo que más te deja</h4>' + rent + '</div>');
          }
          if (s.mejores) {
            var cl = s.mejores.clientes.length
              ? s.mejores.clientes.map(function(x, i){ return fila(i, i + 1, x.nombre, eur(x.base), false, '/admin/clients/' + x.client_id); }).join('')
              : '<div class="cm-pie">Ningún cliente ha comprado todavía este mes.</div>';
            cols.push('<div class="cm-lista"><h4>Tus mejores clientes</h4>' + cl + '</div>');
          }
          if (!cols.length) { box.innerHTML = ''; return; }
          // EL SUELO SE DICE. Un filtro que no se ve es un filtro en el que no se puede confiar.
          var pie = '';
          if (s.productos) {
            pie = '<p class="cm-pie">En los dos rankings de productos solo entran los que llevan <b>' + esc(s.productos.sueloTexto)
              + '</b>: un producto vendido una vez no es «el que peor va». '
              + (s.productos.fuera ? 'Se quedan fuera por eso <b>' + ent(s.productos.fuera) + '</b> de ' + ent(s.productos.total) + '. ' : '')
              + (s.productos.sinCosteFuera ? 'Y <b>' + ent(s.productos.sinCosteFuera) + '</b> más no entran en «lo que más te deja» porque no tienen coste conocido: sin coste no hay margen que juzgar (ni 0 % ni 100 %).' : '')
              + '</p>';
          }
          box.innerHTML = '<div class="cm-card">'
            + '<p class="cm-h"><i class="ti ti-list-numbers"></i>Tu negocio en cifras<span class="x">este mes</span></p>'
            + '<div class="cm-listas">' + cols.join('') + '</div>' + pie + '</div>';
        }

        // ── OPORTUNIDADES ABIERTAS ──────────────────────────────────────────────────────────────
        function pintaOport(o){
          var box = document.getElementById('cmOport');
          if (!o) { box.innerHTML = ''; return; }
          box.innerHTML = '<a class="cm-card cm-oport" href="' + esc(o.href) + '" style="display:flex">'
            + '<i class="ti ti-target-arrow" style="font-size:18px;color:var(--accent)"></i>'
            + '<span class="big">' + ent(o.abiertas) + ' ' + (o.abiertas === 1 ? 'oportunidad abierta' : 'oportunidades abiertas') + '</span>'
            + '<span style="color:var(--text2);font-size:13px">por ' + eur(o.importe) + '</span>'
            + '<span class="cta">Ver el embudo →</span></a>';
        }

        // ── DISA DECIDE ─────────────────────────────────────────────────────────────────────────
        // Tres líneas como mucho, con la cifra YA CALCULADA delante (la del vigía, sin recalcular) y
        // el botón que lleva a donde se resuelve. Sin nada que recomendar, el bloque NO APARECE.
        //
        // La línea se COMPONE de campos: cifra · quién · documento · cuándo. No se pinta la prosa de
        // la voz porque escribe el dinero en inglés y las fechas en ISO, y aquí manda el español.
        function pintaDecide(d){
          var box = document.getElementById('cmDecide');
          if (!d || !d.lineas || !d.lineas.length) { box.innerHTML = ''; return; }
          var col = { alta: ['var(--danger-s)', 'var(--danger)'], media: ['var(--warn-s)', 'var(--warn)'], baja: ['var(--bg3)', 'var(--text3)'] };
          box.innerHTML = '<div class="cm-card">'
            + '<p class="cm-h"><i class="ti ti-sparkles"></i>DISA decide</p>'
            + d.lineas.map(function(l, i){
                var c = col[l.prioridad] || col.media;
                var partes = [];
                if (l.quien) partes.push(esc(l.quien));
                if (l.codigo) partes.push(esc(l.codigo));
                if (l.fecha) partes.push(esc(cuando(l.fecha)));
                return '<div class="cm-dec' + (i === 0 ? ' primera' : '') + '">'
                  + '<span class="cifra">' + (l.moneda ? eur(l.cifra) : ent(l.cifra) + (l.unidad ? ' ' + esc(l.unidad) : '')) + '</span>'
                  + '<span class="cm-pill" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(l.areaEtiqueta) + '</span>'
                  + '<span class="tx"><b style="color:var(--text);font-weight:600">' + esc(l.etiqueta) + '</b>'
                  + (partes.length ? ' · ' + partes.join(' · ') : '') + '</span>'
                  + '<a class="btn" href="' + esc(l.href) + '">' + esc(l.cta) + '</a></div>';
              }).join('')
            + '</div>';
        }

        function pinta(){
          if (!D) return;
          var s = D.secciones || {};
          try { pintaHoy(s.hoy); } catch (e) {}
          try { pintaNumeros(s, D.periodo); } catch (e) {}
          try { pintaGrafico(s.grafico, D.periodo); } catch (e) {}
          try { pintaCifras(s); } catch (e) {}
          try { pintaOport(s.oportunidades); } catch (e) {}
          try { pintaDecide(s.decide); } catch (e) {}
        }

        fetch('/api/erp/inicio/cuadro', { cache: 'no-store' })
          .then(function(r){ return r.json(); })
          .then(function(d){ if (d && !d.error) { D = d; window.__cuadro = d; pinta(); } })
          .catch(function(){});
      })();

      // ── PASO 6 · INICIO PERSONALIZABLE — la rejilla componible. El vigía de DISA (pieza 5), las cifras
      // y los avisos son ahora BLOQUES colocables; se suman los paneles guardados del constructor. La
      // cascada (usuario > empresa > fábrica) y los permisos los resuelve el servidor; el gráfico de un
      // panel se pinta reutilizando el MOTOR del constructor (/constructor/cruzar + Chart.js). Solo se
      // guarda la COLOCACIÓN — cero cifras propias, no puede discrepar del constructor.
      (function initInicio(){
        var grid = document.getElementById('inicioGrid');
        if (!grid) return;
        var IG_SYM = '${sym}';
        var esc = window.escHtml || function(s){ return s == null ? '' : String(s); };
        var eur = function(v){ return IG_SYM + Number(v || 0).toFixed(2); };
        var IG = { blocks: [], datos: null, esDuenyo: false, origen: 'fabrica', tieneCapaPropia: false,
                   editing: false, scope: 'usuario', vigia: undefined, paleta: null, sortable: null, uidSeq: 0 };
        window.__IG = IG;

        function api(method, url, body){
          // no-store: tras guardar o resetear se vuelve a pedir el layout; sin esto el navegador podría
          // servir de su caché la versión anterior y no verse el cambio hasta recargar a mano.
          var opts = { method: method, cache: 'no-store', headers: { 'x-csrf-token': dhGetCsrf() } };
          if (body){ opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
          return fetch(url, opts).then(function(r){ if (!r.ok){ var e = new Error('http'); e.status = r.status; throw e; } return r.json().catch(function(){ return {}; }); });
        }
        function aviso(msg){ if (typeof window.toast === 'function') window.toast(msg); }

        function cargar(scope){
          IG.scope = scope || 'usuario';
          var q = IG.scope === 'empresa' ? '?scope=empresa' : '';
          return api('GET', '/api/erp/inicio/layout' + q).then(function(d){
            IG.blocks = d.blocks || []; IG.blocks.forEach(function(b){ b._uid = ++IG.uidSeq; });
            IG.esDuenyo = !!d.esDuenyo; IG.origen = d.origen; IG.tieneCapaPropia = !!d.tieneCapaPropia;
            if (IG.datos) return null;
            return api('GET', '/api/erp/inicio/datos').then(function(x){ IG.datos = x; }).catch(function(){ IG.datos = { kpis: {}, avisos: {} }; });
          }).then(render).catch(function(){ grid.innerHTML = '<div class="ig-empty">No he podido cargar tu Inicio.</div>'; });
        }

        function renderBar(){
          var s = document.getElementById('igScope'), a = document.getElementById('igActions');
          if (!s || !a) return;
          if (IG.editing){
            s.innerHTML = IG.scope === 'empresa' ? 'Editando el <b>Inicio de la empresa</b> · lo verán quienes no lo hayan personalizado' : 'Editando <b>tu Inicio</b>';
            var b = btn('guardar', '', 'Guardar', 'primary') + btn('cancelar', '', 'Cancelar', '');
            if (IG.scope === 'empresa') b += btn('reset', '', 'Volver al de fábrica', '');
            else if (IG.tieneCapaPropia) b += btn('reset', '', 'Volver al de mi empresa', '');
            a.innerHTML = b;
          } else {
            var nombre = IG.origen === 'usuario' ? 'Tu Inicio' : IG.origen === 'empresa' ? 'Inicio de la empresa' : 'Inicio de fábrica';
            s.innerHTML = '<b>' + esc(nombre) + '</b>';
            var b2 = btn('editar', 'usuario', 'Personalizar', '');
            if (IG.esDuenyo) b2 += btn('editar', 'empresa', 'Editar el de la empresa', '');
            a.innerHTML = b2;
          }
        }
        function btn(act, arg, label, cls){ return '<button type="button" class="ig-btn ' + (cls || '') + '" data-igact="' + act + '" data-arg="' + esc(arg) + '">' + esc(label) + '</button>'; }

        function render(){
          renderBar();
          grid.className = 'ig-grid' + (IG.editing ? ' editing' : '');
          if (!IG.blocks.length){
            grid.innerHTML = '<div class="ig-empty">Tu Inicio está vacío.' + (IG.editing ? ' Añade bloques desde la paleta de arriba.' : ' Pulsa «Personalizar» para añadir bloques.') + '</div>';
          } else {
            grid.innerHTML = IG.blocks.map(bloqueHtml).join('');
            IG.blocks.forEach(function(b){ pintar(b, grid.querySelector('[data-uid="' + b._uid + '"]')); });
          }
          if (IG.editing){ montarPaleta(); montarSortable(); } else quitarPaleta();
        }

        function bloqueHtml(b){
          var w = Math.min(4, Math.max(1, b.w || 2)), h = Math.min(4, Math.max(1, b.h || 1));
          var titulo, icon;
          if (b.tipo === 'panel'){ titulo = b.nombre || 'Panel'; icon = 'ti-chart-dots'; }
          else if (b.tipo === 'kpis'){ titulo = 'Cifras del negocio'; icon = 'ti-layout-dashboard'; }
          else if (b.tipo === 'hoy'){ titulo = 'Hoy en la agenda'; icon = 'ti-calendar-event'; }
          else if (b.tipo === 'avisos'){ titulo = 'Avisos pendientes'; icon = 'ti-bell'; }
          else if (b.tipo === 'vigia'){ titulo = 'Vigía de DISA'; icon = 'ti-radar'; }
          else { titulo = b.tipo; icon = 'ti-square'; }
          var tools = '<span class="ig-block-tools">'
            + tool(b._uid, 'w', -1, '‹') + tool(b._uid, 'w', 1, '›') + tool(b._uid, 'h', -1, '–') + tool(b._uid, 'h', 1, '+')
            + '<button class="ig-tool" data-igact="remove" data-uid="' + b._uid + '" title="Quitar">✕</button></span>';
          return '<div class="ig-block w' + w + ' h' + h + '" data-uid="' + b._uid + '">'
            + '<div class="ig-block-head"><i class="ti ' + icon + '"></i><span>' + esc(titulo) + '</span>' + tools + '</div>'
            + '<div class="ig-block-body"><div class="ig-note">…</div></div></div>';
        }
        function tool(uid, dim, d, lbl){ return '<button class="ig-tool" data-igact="resize" data-uid="' + uid + '" data-dim="' + dim + '" data-d="' + d + '" title="Tamaño">' + lbl + '</button>'; }

        function pintar(b, el){
          if (!el) return; var body = el.querySelector('.ig-block-body'); if (!body) return;
          if (b.tipo === 'kpis') return pintarKpis(body);
          if (b.tipo === 'hoy') return pintarHoy(body);
          if (b.tipo === 'avisos') return pintarAvisos(body);
          if (b.tipo === 'vigia') return pintarVigia(body);
          if (b.tipo === 'panel') return pintarPanel(b, body);
          body.innerHTML = '';
        }
        // En español: 1.234 € — no «€1234». Es la misma corrección que ya se hizo en la ficha de
        // cliente y en Informes; esta cifra se había quedado atrás.
        function eurEs(n){
          return Number(n).toLocaleString('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' }) + ' ' + IG_SYM;
        }
        function pintarKpis(body){
          var k = (IG.datos && IG.datos.kpis) || {}, av = (IG.datos && IG.datos.avisos) || {};
          function fig(icon, color, label, val){ return '<div><p class="ig-kpi-label"><i class="ti ' + icon + '" style="color:' + color + '"></i>' + label + '</p><p class="ig-kpi-value">' + val + '</p></div>'; }
          body.innerHTML = '<div class="ig-kpis">'
            + fig('ti-arrow-down-left', 'var(--accent)', 'Ventas del mes (sin IVA)', k.verVentas ? eurEs(k.ventas || 0) : '—')
            + fig('ti-receipt', 'var(--warn)', 'Pedidos', k.verPedidos ? (k.pedidos || 0) : '—')
            + fig('ti-clock-hour-4', 'var(--text2)', 'Pendientes', k.verPedidos ? (k.pendiente || 0) : '—')
            + fig('ti-alert-triangle', 'var(--danger)', 'Avisos', (av.estado && av.estado !== 'apagado') ? (av.count || 0) : 0)
            + '</div>';
        }
        // ── BLOQUE «HOY» ─────────────────────────────────────────────────────────────────────────
        // Cero cifra propia: las citas vienen de la misma función que pinta la vista día de la
        // agenda, y las horas libres de la misma que alimenta el aviso de huecos del vigía. Aquí
        // solo se ordenan y se escriben.
        function pintarHoy(body){
          var h = IG.datos && IG.datos.hoy;
          if (!h){ body.innerHTML = '<div class="ig-note">No tienes permiso para ver la agenda.</div>'; return; }
          var libre = h.libre_h == null ? null : (h.libre_h + (h.libre_h === 1 ? ' h libre' : ' h libres'));
          var cab = '<div class="ig-hoy-cab"><strong>' + h.n + (h.n === 1 ? ' cita' : ' citas') + '</strong>'
            + (libre ? '<span>· ' + esc(libre) + '</span>' : '')
            + (h.pct != null ? '<span>· ' + h.pct + '% ocupado</span>' : '') + '</div>';
          // SIN HORARIO PUESTO NO SE MIENTE: el motor abre de 8 a 21 por defecto, así que las horas
          // libres no significan nada todavía. Se dice y se manda a ponerlo.
          if (h.sin_horario) {
            cab += '<div class="ig-note" style="margin:.2rem 0 .4rem">Todavía no has puesto tu horario, así que doy por abierto de 8 a 21 y las horas libres no significan nada. '
              + '<a href="/admin/citas/horarios">Ponlo aquí</a>.</div>';
          }
          if (!h.citas.length){
            body.innerHTML = '<div class="ig-hoy">' + cab
              + '<div class="ig-note">' + (h.abre ? 'Hoy no tienes ninguna cita.' : 'Hoy no abres.') + ' <a href="/admin/citas">Ver la agenda</a></div></div>';
            return;
          }
          var LBL = { pedida:'Pedida', confirmada:'Confirmada', atendida:'Atendida', no_show:'No vino', anulada:'Anulada' };
          body.innerHTML = '<div class="ig-hoy">' + cab
            + h.citas.map(function(c){
                return '<a class="ig-hoy-fila" href="/admin/citas?fecha=' + esc(h.fecha) + '" style="text-decoration:none;color:inherit">'
                  + '<span class="h">' + esc(c.hora) + '</span>'
                  + '<span class="c" title="' + esc(c.cliente + ' · ' + c.servicios) + '">' + esc(c.cliente)
                  + (c.servicios ? ' <span class="q">' + esc(c.servicios) + '</span>' : '') + '</span>'
                  + '<span class="q">' + esc(c.persona) + '</span>'
                  + '<span class="q">' + esc(LBL[c.estado] || c.estado) + '</span></a>';
              }).join('')
            + '</div>';
        }
        function pintarAvisos(body){
          var av = (IG.datos && IG.datos.avisos) || {};
          if (!av.count || av.estado === 'apagado'){ body.innerHTML = '<div class="ig-note">Todo en orden: no hay avisos pendientes.</div>'; return; }
          var visto = av.estado === 'visto';
          body.innerHTML = '<a class="dh-vigia-row" href="/admin/avisos" style="border-radius:8px">'
            + '<span class="dh-vigia-tx">' + av.count + (av.count === 1 ? ' aviso pendiente' : ' avisos pendientes') + ' · resolverlos</span>'
            + '<span class="dh-vigia-pill" style="background:' + (visto ? 'var(--accent-soft)' : 'var(--danger-s)') + ';color:' + (visto ? 'var(--accent-d)' : 'var(--danger)') + '">' + (visto ? 'Visto' : 'Requiere atención') + '</span></a>';
        }
        function pintarVigia(body){
          function paint(avisos){
            if (!avisos || !avisos.length){ body.innerHTML = '<div class="ig-note">Nada que te avise ahora mismo.</div>'; return; }
            var col = { alta: ['var(--danger-s)', 'var(--danger)'], media: ['var(--warn-s)', 'var(--warn)'], baja: ['var(--bg3)', 'var(--text3)'] };
            body.innerHTML = avisos.map(function(a){ var c = col[a.prioridad && a.prioridad.grupo] || col.media;
              return '<a class="dh-vigia-row" href="/admin/vigia"><span class="dh-vigia-tx">' + esc(a.encabezado || a.quePasa || '') + '</span><span class="dh-vigia-pill" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(a.prioridad ? a.prioridad.etiqueta : '') + '</span></a>'; }).join('')
              + '<a class="dh-vigia-more" href="/admin/vigia">Ver todos →</a>';
          }
          if (IG.vigia !== undefined){ paint(IG.vigia); return; }
          api('GET', '/api/erp/vigia/avisos?top=5').then(function(d){ IG.vigia = (d && d.avisos) || []; paint(IG.vigia); })
            .catch(function(e){ IG.vigia = []; body.innerHTML = '<div class="ig-note">' + (e.status === 403 ? 'No puedes ver el vigía (te falta permiso).' : 'No he podido cargar el vigía.') + '</div>'; });
        }
        function pintarPanel(b, body){
          var cfg = b.config || {};
          if (cfg.modo === 'comparar'){ body.innerHTML = '<div class="ig-note">Panel comparativo: se abre en el <a href="/admin/analytics" style="color:var(--accent)">constructor</a>.</div>'; return; }
          var receta = { area: cfg.area, dimension: cfg.dimension, medidas: cfg.medidas, periodo: cfg.periodo || 'mes', filtros: cfg.filtros || null, formula: cfg.formula || null, grafico: cfg.grafico };
          api('POST', '/api/erp/analytics/constructor/cruzar', receta).then(function(d){
            var med = b.medida || (cfg.medidas && cfg.medidas[0]) || 'base', meta = b.meta || {};
            if (!d.filas || !d.filas.length){ body.innerHTML = '<div class="ig-note">Sin datos.</div>'; return; }
            if (cfg.grafico === 'tabla'){
              body.innerHTML = '<div style="overflow:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">'
                + d.filas.map(function(f){ var v = f[med]; return '<tr><td style="padding:2px 6px;color:var(--text2)">' + esc(f.clave) + '</td><td style="padding:2px 6px;text-align:right">' + (v == null ? '—' : (meta.dinero ? eur(v) : (meta.pct ? Number(v).toFixed(1) + '%' : v))) + '</td></tr>'; }).join('')
                + '</table></div>';
              return;
            }
            body.innerHTML = '<div style="position:relative;height:100%;min-height:90px"><canvas></canvas></div>';
            if (typeof GraficoConstructor !== 'undefined' && typeof Chart !== 'undefined')
              GraficoConstructor.dibujarCruce(body.querySelector('canvas'), { filas: d.filas, medida: med, meta: meta, grafico: cfg.grafico }, { sym: IG_SYM });
          }).catch(function(e){ body.innerHTML = '<div class="ig-note">' + (e.status === 403 ? 'No puedes ver este panel (te falta permiso del área).' : 'No he podido cargar este panel.') + '</div>'; });
        }

        // ── edición ──
        function porUid(uid){ for (var i = 0; i < IG.blocks.length; i++) if (String(IG.blocks[i]._uid) === String(uid)) return IG.blocks[i]; return null; }
        function resize(uid, dim, d){
          var b = porUid(uid); if (!b) return;
          var v = Math.min(4, Math.max(1, ((dim === 'w' ? b.w : b.h) || (dim === 'w' ? 2 : 1)) + d));
          if (dim === 'w') b.w = v; else b.h = v;
          var el = grid.querySelector('[data-uid="' + uid + '"]'); if (el) el.className = 'ig-block w' + Math.min(4, Math.max(1, b.w || 2)) + ' h' + Math.min(4, Math.max(1, b.h || 1));
        }
        function quitar(uid){ IG.blocks = IG.blocks.filter(function(b){ return String(b._uid) !== String(uid); }); render(); }
        function anadir(tipo, ref){
          var pal = IG.paleta || { nativos: [], paneles: [] }, meta;
          if (tipo === 'panel'){ meta = (pal.paneles || []).filter(function(p){ return String(p.refId) === String(ref); })[0]; if (!meta) return; }
          else { meta = (pal.nativos || []).filter(function(n){ return n.tipo === tipo; })[0]; if (!meta) return; }
          var b = { tipo: tipo, refId: tipo === 'panel' ? Number(ref) : null, w: meta.w || 2, h: meta.h || 2, _uid: ++IG.uidSeq };
          if (tipo === 'panel'){ b.nombre = meta.etiqueta; b.area = meta.area; b.config = meta.config; b.medida = meta.medida; b.meta = meta.meta; }
          IG.blocks.push(b); render();
        }
        function montarSortable(){
          if (IG.sortable){ try { IG.sortable.destroy(); } catch (e) {} IG.sortable = null; }
          if (typeof Sortable === 'undefined') return;
          IG.sortable = Sortable.create(grid, { animation: 150, filter: '.ig-tool', preventOnFilter: false, ghostClass: 'ig-sortable-ghost',
            onEnd: function(){ var order = [].slice.call(grid.children).map(function(el){ return el.getAttribute('data-uid'); });
              IG.blocks.sort(function(a, b){ return order.indexOf(String(a._uid)) - order.indexOf(String(b._uid)); }); } });
        }
        function montarPaleta(){
          quitarPaleta();
          function paint(pal){
            var el = document.createElement('div'); el.className = 'ig-palette'; el.id = 'igPalette';
            var items = (pal.nativos || []).map(function(n){ return chip(n.tipo, '', n.icon || 'ti-square', n.etiqueta); })
              .concat((pal.paneles || []).map(function(p){ return chip('panel', p.refId, 'ti-chart-dots', p.etiqueta + (p.propio ? '' : ' · ' + (p.autor || 'compartido'))); }));
            el.innerHTML = '<div class="ig-palette-title">Añadir un bloque</div><div class="ig-palette-items">' + (items.join('') || '<span class="ig-note">No tienes bloques disponibles para añadir.</span>') + '</div>';
            grid.parentNode.insertBefore(el, grid);
          }
          if (IG.paleta){ paint(IG.paleta); return; }
          api('GET', '/api/erp/inicio/bloques').then(function(p){ IG.paleta = p; paint(p); }).catch(function(){});
        }
        function chip(tipo, ref, icon, label){ return '<button type="button" class="ig-chip" data-igact="add" data-tipo="' + esc(tipo) + '" data-ref="' + esc(ref) + '"><i class="ti ' + icon + '"></i>' + esc(label) + '</button>'; }
        function quitarPaleta(){ var e = document.getElementById('igPalette'); if (e) e.remove(); }

        function guardar(){
          var payload = { blocks: IG.blocks.map(function(b){ return { tipo: b.tipo, refId: b.tipo === 'panel' ? b.refId : null, w: b.w, h: b.h }; }) };
          var url = IG.scope === 'empresa' ? '/api/erp/inicio/empresa' : '/api/erp/inicio/layout';
          api('PUT', url, payload).then(function(){ IG.editing = false; IG.vigia = undefined; IG.paleta = null; aviso('Inicio guardado'); cargar('usuario'); })
            .catch(function(e){ aviso(e.status === 403 ? 'No puedes colocar un panel de un área que no ves.' : 'No se pudo guardar.'); });
        }
        function resetear(){
          var url = IG.scope === 'empresa' ? '/api/erp/inicio/empresa' : '/api/erp/inicio/layout';
          api('DELETE', url).then(function(){ IG.editing = false; IG.vigia = undefined; IG.paleta = null; cargar('usuario'); })
            .catch(function(){ aviso('No se pudo restablecer.'); });
        }

        // exposición mínima (la barra/tools llaman por delegación, pero cancelar/guardar se referencian aquí)
        IG.guardar = guardar; IG.cancelar = function(){ IG.editing = false; IG.vigia = undefined; cargar('usuario'); }; IG.reset = resetear;

        // delegación de clics de la rejilla + la barra + la paleta (evita comillas dentro de onclick)
        document.addEventListener('click', function(ev){
          var t = ev.target.closest ? ev.target.closest('[data-igact]') : null; if (!t) return;
          var act = t.getAttribute('data-igact');
          if (act === 'editar'){ ev.preventDefault(); IG.editing = true; cargar(t.getAttribute('data-arg') || 'usuario'); }
          else if (act === 'guardar'){ ev.preventDefault(); guardar(); }
          else if (act === 'cancelar'){ ev.preventDefault(); IG.editing = false; cargar('usuario'); }
          else if (act === 'reset'){ ev.preventDefault(); resetear(); }
          else if (act === 'resize'){ ev.preventDefault(); resize(t.getAttribute('data-uid'), t.getAttribute('data-dim'), parseInt(t.getAttribute('data-d'), 10)); }
          else if (act === 'remove'){ ev.preventDefault(); quitar(t.getAttribute('data-uid')); }
          else if (act === 'add'){ ev.preventDefault(); anadir(t.getAttribute('data-tipo'), t.getAttribute('data-ref')); }
        });

        cargar('usuario');
      })();

      // ══════════════════════════════════════════════════════════════════════════════════════════
      // PON EN MARCHA TU NEGOCIO — el panel, pintado con lo que devuelve el servidor
      // ══════════════════════════════════════════════════════════════════════════════════════════
      // Reutiliza el anillo y el patrón de guía de U6 (.onb-*): mismo estilo, mismo lenguaje. Lo que
      // cambia es que ahora son TRES BLOQUES con título, que la lista se adapta al oficio sin perder
      // ningún paso, y que el panel se pliega en vez de desaparecer.
      //
      // NINGÚN PASO SE MARCA A MANO: no hay endpoint para hacerlo. Todo viene derivado del estado
      // real del negocio, y lo único que se guarda es si este usuario quiere el panel plegado.
      (function(){
        var caja = document.getElementById('onbPanel');
        if (!caja) return;
        var D = null, verExtra = false;
        var RC = ${_ringC};

        function paso(p, abierto){
          var estado = p.done ? 'done' : (abierto ? 'now' : 'soon');
          var ico = p.done ? 'ti-check' : p.icon;
          var der = p.done ? '<span class="onb-tag">Hecho</span>'
                  : (estado === 'soon' ? '<span class="onb-time">' + escHtml(p.time) + '</span>' : '');
          var acciones = '';
          if (estado === 'now') {
            acciones = p.margen
              ? '<div class="onb-mg-ej">Algo que te cuesta <b>100 ${simbolo}</b> y vendes por <b>140 ${simbolo}</b>.</div>'
                + '<div class="onb-mg">'
                +   '<button type="button" class="onb-mg-op" data-margen="venta"><span class="n">Gano un 28,6 %</span><span class="p">sobre lo que cobro</span></button>'
                +   '<button type="button" class="onb-mg-op" data-margen="coste"><span class="n">Le meto un 40 %</span><span class="p">sobre lo que me costó</span></button>'
                + '</div>'
                + '<div class="onb-mg-pie"><button type="button" class="onb-saltar" data-margen="saltar">Ahora no</button><span>Puedes cambiarlo cuando quieras en Ajustes.</span></div>'
              : '<a class="onb-cta" href="' + escHtml(p.href) + '">' + escHtml(p.cta) + ' <i class="ti ti-arrow-right"></i></a>';
          }
          var cuerpo = estado === 'now'
            ? '<div class="onb-when">Ahora · ' + escHtml(p.time) + '</div><p class="onb-guide">' + p.guia + '</p>' + acciones
            : '';
          // El paso del margen se contesta en el sitio, así que NUNCA es un enlace.
          var esEnlace = estado === 'soon' && !p.margen;
          var t = esEnlace ? 'a' : 'div';
          return '<' + t + ' class="onb-step ' + estado + '"' + (esEnlace ? ' href="' + escHtml(p.href) + '"' : '') + '>'
            + '<span class="onb-node"><span class="onb-ic"><i class="ti ' + escHtml(ico) + '"></i></span></span>'
            + '<div class="onb-sbody"><div class="onb-shead"><span class="onb-stitle">' + escHtml(p.label) + '</span>' + der + '</div>'
            + cuerpo + '</div></' + t + '>';
        }

        function pinta(){
          if (!D) { caja.innerHTML = ''; return; }
          if (!D.total) { caja.innerHTML = ''; return; }        // nada que ofrecer: no ocupa sitio
          var falta = D.total - D.hechos;
          if (D.plegado) {
            // PLEGADO NO ES DESAPARECIDO: queda una línea con el progreso y se abre de un clic.
            caja.innerHTML = '<button type="button" class="onb-plegado" data-onb-toggle="1">'
              + '<i class="ti ti-rosette-discount-check"></i> <strong>Pon en marcha tu negocio</strong>'
              + '<span>' + D.hechos + ' de ' + D.total + (falta ? ' · te faltan ' + falta : ' · todo hecho') + '</span>'
              + '<i class="ti ti-chevron-down"></i></button>';
            return;
          }
          var off = (RC * (1 - D.hechos / D.total)).toFixed(1);
          var linea = D.completo
            ? 'Ya está todo. Lo dejo plegado, pero puedes abrirlo cuando quieras.'
            : (D.hechos === 0
                ? 'Vamos a dejar tu negocio a punto — tú decides, yo te acompaño.'
                : (falta === 1 ? 'Te queda un último paso. Yo te lo enseño.'
                               : 'Vas muy bien: te faltan ' + falta + ' y te guío en cada uno.'));
          var abierto = false;
          var bloques = D.bloques.map(function(b){
            var pasos = b.pasos.map(function(p){
              var esAhora = !p.done && !abierto;               // solo el PRIMER pendiente se despliega
              if (esAhora) abierto = true;
              return paso(p, esAhora);
            }).join('');
            return '<div class="onb-bloque"><h4>' + escHtml(b.titulo) + '</h4>'
              + '<p class="onb-bsub">' + escHtml(b.sub) + '</p>'
              + '<div class="onb-steps">' + pasos + '</div></div>';
          }).join('');
          var extra = '';
          if (D.extra && D.extra.length) {
            extra = '<div class="onb-extra">'
              + '<button type="button" class="onb-mas" data-onb-extra="1">'
              +   '<i class="ti ti-dots"></i> Más opciones (' + D.extra.length + ')</button>'
              + (verExtra
                  ? '<div class="onb-steps" style="margin-top:.6rem">'
                    + D.extra.map(function(p){ return paso(p, false); }).join('')
                    + '<p class="onb-bsub" style="margin:.4rem 0 0">' + escHtml(D.extra[0].porque || '') + ', pero aquí los tienes.</p></div>'
                  : '')
              + '</div>';
          }
          caja.innerHTML = '<div class="onb-card">'
            + '<div class="onb-hero">'
            +   '<div class="onb-ring" role="img" aria-label="' + D.hechos + ' de ' + D.total + ' pasos completados">'
            +     '<svg viewBox="0 0 56 56" width="56" height="56"><circle class="onb-ring-bg" cx="28" cy="28" r="24"/>'
            +     '<circle class="onb-ring-fg" cx="28" cy="28" r="24" style="stroke-dasharray:' + RC + ';stroke-dashoffset:' + off + '"/></svg>'
            +     '<span class="onb-ring-n">' + D.hechos + '<i>/' + D.total + '</i></span></div>'
            +   '<div style="flex:1;min-width:0"><h3 class="onb-title">Pon en marcha tu negocio</h3>'
            +     '<p class="onb-sub">' + escHtml(linea) + '</p></div>'
            +   '<button type="button" class="onb-plegar" data-onb-toggle="1" title="Plegar"><i class="ti ti-chevron-up"></i></button>'
            + '</div>'
            + bloques + extra + '</div>';
        }

        function cargar(){
          fetch('/api/erp/inicio/arranque').then(function(r){ return r.json(); })
            .then(function(d){ if (d && !d.error) { D = d; pinta(); } })
            .catch(function(){});
        }
        window.onbRecargar = cargar;

        document.addEventListener('click', function(e){
          var t = e.target.closest('[data-onb-toggle],[data-onb-extra]');
          if (!t || !caja.contains(t)) return;
          e.preventDefault();
          if (t.hasAttribute('data-onb-extra')) { verExtra = !verExtra; pinta(); return; }
          D.plegado = !D.plegado; pinta();
          api('PUT', '/api/erp/inicio/arranque/plegado', { plegado: D.plegado }).catch(function(){});
        });

        cargar();
      })();

      // ── G4 · GUARDAR LA RESPUESTA DEL PASO DEL MARGEN ──────────────────────────────────────────
      // Las tres salidas terminan el paso: elegir A, elegir B y SALTAR. Saltar deja «sobre la venta»
      // (que es lo que vale la ausencia del ajuste) y solo apunta que ya se preguntó, para no volver
      // a preguntarlo. NUNCA bloquea el alta: si la llamada falla, se dice y el paso sigue ahí.
      document.addEventListener('click', function(ev){
        var b = ev.target.closest('[data-margen]'); if (!b) return;
        ev.preventDefault();
        var v = b.getAttribute('data-margen');
        var cuerpo = v === 'saltar' ? { saltar: true } : { modo: v };
        // Por api() y no por fetch a pelo: es el helper que pone el token CSRF. Un POST sin él
        // vuelve 403 y el paso se quedaría clavado sin que nadie supiera por qué.
        api('POST','/api/erp/settings/margen/alta', cuerpo)
          .then(function(){ if (window.onbRecargar) window.onbRecargar(); })
          .catch(function(e){ if (window.toast) toast('No se ha podido guardar: '+e.message+'. Puedes elegirlo en Ajustes.','err'); });
      });
    </script>
  `;
}
