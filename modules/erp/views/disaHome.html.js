export function disaHomeHtml({ userName, alertCount, alertState, kpis, onboarding = null }) {
  const sym = kpis?.sym || '€';

  // Fecha de hoy en español (presentación; server-side, no toca datos del tenant).
  const _now = new Date();
  const _dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const _meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const _h = _now.getHours();
  const _saludo = _h < 6 ? 'Hola' : _h < 13 ? 'Buenos días' : _h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const fechaHoy = `${_dias[_now.getDay()]}, ${_now.getDate()} de ${_meses[_now.getMonth()]}`;

  // Texto proactivo de DISA, derivado de los avisos reales que ya calcula el motor.
  // No promete "¿quieres que te los enseñe?" (eso obligaba a pasar por el chat): señala dónde se
  // resuelven. La acción vive en /admin/avisos, no en una conversación.
  const disaProactivo = (alertState !== 'apagado' && alertCount > 0)
    ? `Tienes ${alertCount} ${alertCount === 1 ? 'aviso que pide' : 'avisos que piden'} tu atención (cobros vencidos, pagos a proveedor, stock y recurrentes). Los tienes en Avisos, cada uno con su acción al lado.`
    : `Todo en orden por ahora. ¿En qué quieres trabajar hoy en tu negocio? Puedo crear facturas, registrar gastos o darte un resumen.`;

  // ── U6 · Onboarding — primeros pasos (solo presentación; el estado llega derivado del negocio) ──
  // Cuando `onboarding` viene (dueño/admin con algún paso pendiente), el hero muestra una bienvenida
  // de DISA + el checklist de 3 pasos; cada pendiente lleva a su pantalla. Con los 3 hechos, el
  // dashboard NO pasa onboarding → el Inicio queda como el home normal (el checklist se retira solo).
  // Cada paso trae su icono, tiempo estimado y la GUÍA de DISA (qué · por qué · cómo, en su voz) +
  // la acción. Textos fijos de producto (por eso llevan <b>): no son entrada de usuario.
  const onbSteps = onboarding ? [
    { done: onboarding.companyDone, icon: 'ti-building-store', label: 'Datos de tu empresa', time: '~1 min', href: '/admin/settings', cta: 'Ir a mis datos',
      guide: `Necesito tu <b>NIF</b> y tu <b>tipo de IRPF</b> para que tus facturas salgan legales y con los importes exactos desde la primera. Añade también el <b>nombre fiscal</b>, que aparece en cada documento. Te llevo al formulario con esos campos y, en cuanto guardes, este paso se marca solo.` },
    { done: onboarding.clientDone, icon: 'ti-user-plus', label: 'Tu primer cliente', time: '~1 min', href: '/admin/clients?nuevo=1', cta: 'Crear cliente',
      guide: `Un cliente es <b>a quién le facturas</b>: su nombre y su NIF, y si quieres su email para enviarle las facturas. Con uno basta para arrancar; los demás los añades cuando los necesites. Te abro el alta directamente.` },
    { done: onboarding.invoiceDone, icon: 'ti-file-invoice', label: 'Tu primera factura', time: '~2 min', href: '/admin/invoices/new', cta: 'Emitir factura',
      guide: `Aquí nace tu <b>primer documento legal</b>. Eliges el cliente, añades una línea (concepto, importe e IVA) y emites; del resto me encargo yo: numeración, IVA/IRPF y la <b>huella Verifactu</b>. Te llevo a la factura nueva ya preparada.` },
  ] : [];
  const onbNext = onbSteps.findIndex(s => !s.done);   // primer paso pendiente = el que se despliega
  const _onbRem = onboarding ? 3 - onboarding.done : 0;
  const onbSub = onboarding
    ? (_onbRem === 1 ? 'Te queda 1 paso para emitir tu primera factura.' : `Estás a ${_onbRem} pasos de emitir tu primera factura.`)
    : '';
  const onbDisaLine = onboarding
    ? (onboarding.done === 0
        ? `¡Bienvenida, ${userName}! Soy DISA. Te llevo de la mano por cada paso y a la pantalla ya preparada — sin manuales que memorizar.`
        : `${_onbRem === 1 ? 'Un último empujón' : 'Vas muy bien'}, ${userName}: te guío en lo que falta y cuando terminemos, esto desaparece.`)
    : '';
  const _ringC = 150.8;   // circunferencia (2π·24)
  const _ringOff = (onboarding ? _ringC * (1 - onboarding.done / 3) : _ringC).toFixed(1);
  const onbStep = (s, i) => {
    const state = s.done ? 'done' : (i === onbNext ? 'now' : 'soon');
    const ico = s.done ? 'ti-check' : s.icon;
    const right = s.done ? '<span class="onb-tag">Hecho</span>' : (state === 'soon' ? `<span class="onb-time">${s.time}</span>` : '');
    const expand = state === 'now' ? `
                <div class="onb-when">Ahora · ${s.time}</div>
                <p class="onb-guide">${s.guide}</p>
                <a class="onb-cta" href="${s.href}">${s.cta} <i class="ti ti-arrow-right"></i></a>` : '';
    const tag = state === 'soon' ? 'a' : 'div';
    const attr = state === 'soon' ? ` href="${s.href}"` : '';
    return `
            <${tag} class="onb-step ${state}"${attr}>
              <span class="onb-node"><span class="onb-ic"><i class="ti ${ico}"></i></span></span>
              <div class="onb-sbody">
                <div class="onb-shead"><span class="onb-stitle">${s.label}</span>${right}</div>${expand}
              </div>
            </${tag}>`;
  };
  const onbHtml = onboarding ? `
          <div class="onb-card">
            <div class="onb-hero">
              <div class="onb-ring" role="img" aria-label="${onboarding.done} de 3 pasos completados">
                <svg viewBox="0 0 56 56" width="56" height="56"><circle class="onb-ring-bg" cx="28" cy="28" r="24"/><circle class="onb-ring-fg" cx="28" cy="28" r="24" style="stroke-dasharray:${_ringC};stroke-dashoffset:${_ringOff}"/></svg>
                <span class="onb-ring-n">${onboarding.done}<i>/3</i></span>
              </div>
              <div>
                <h3 class="onb-title">Configura tu negocio</h3>
                <p class="onb-sub">${onbSub}</p>
              </div>
            </div>
            <div class="onb-disa"><span class="onb-disa-ic"><i class="ti ti-sparkles"></i></span><span>${onbDisaLine}</span></div>
            <div class="onb-steps">${onbSteps.map((s, i) => onbStep(s, i)).join('')}</div>
          </div>` : '';

  return `
    <style>
      .disa-home {
        min-height: calc(100vh - 60px);
        display: flex;
        flex-direction: column;
        margin: -1.5rem;
        position: relative;
      }

      /* El badge flotante de alertas se retiró: la única señal del chrome es la campana del
         topbar, y en el Inicio el aviso vive en la tarjeta "Avisos" (clicable) y en su fila. */

      /* Stage central */
      .disa-stage {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 20px 22px 24px;
        width: 100%;
        max-width: 920px;
        margin: 0 auto;
        box-sizing: border-box;
      }

      /* Hero = saludo + tarjeta DISA + cifras (estado inicial; el JS lo oculta al hablar) */
      .disa-hero {
        transition: opacity 0.25s ease, max-height 0.35s ease, margin 0.3s ease;
        max-height: 640px;
        overflow: hidden;
      }
      .disa-hero.hidden {
        opacity: 0;
        max-height: 0;
        margin-bottom: 0;
        pointer-events: none;
      }

      /* Saludo */
      .disa-greeting { color: var(--text); font-size: 18px; font-weight: 600; margin: 0 0 2px; letter-spacing: -0.2px; }
      .disa-question { color: var(--text2); font-size: 13px; margin: 0 0 18px; }

      /* Tarjeta DISA (borde izquierdo acento) */
      .disa-card-main {
        background: var(--bg2);
        border: 0.5px solid var(--border-disa);
        border-left: 3px solid var(--accent);
        border-radius: 12px;
        padding: 14px 16px;
        display: flex;
        gap: 11px;
        margin-bottom: 18px;
      }
      .disa-card-icon {
        width: 34px; height: 34px;
        border-radius: 9px;
        background: var(--accent-soft);
        color: var(--accent);
        display: flex; align-items: center; justify-content: center;
        font-size: 19px;
        flex-shrink: 0;
      }
      .disa-card-icon i { font-size: 19px; }
      .disa-card-title { font-size: 13px; font-weight: 600; color: var(--accent-d); margin: 0 0 3px; }
      .disa-card-text { font-size: 13px; color: var(--body-tx); margin: 0; line-height: 1.55; }

      /* Rejilla de cifras */
      .disa-figs {
        display: grid;
        grid-template-columns: repeat(4,1fr);
        gap: 12px;
        margin-bottom: 18px;
      }
      .disa-fig {
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 12px;
        padding: 13px 14px;
      }
      /* La tarjeta de Avisos es un <a> a /admin/avisos: se ve el número y se va a resolverlo. */
      .disa-fig-link { display: block; text-decoration: none; color: inherit; transition: border-color .15s, background .15s; }
      .disa-fig-link:hover { border-color: var(--accent); background: var(--bg3); }
      .disa-fig-label { font-size: 11.5px; color: var(--text2); margin: 0 0 7px; display: flex; align-items: center; gap: 5px; }
      .disa-fig-label i { font-size: 14px; }
      .disa-fig-value { font-size: 21px; font-weight: 600; margin: 0; letter-spacing: -0.5px; color: var(--text); }

      /* Lista de avisos / accesos */
      .disa-rows {
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 12px;
        padding: 6px 4px;
        margin-bottom: 18px;
      }
      .disa-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; font-size: 13px;
        width: 100%; box-sizing: border-box;
        background: none; border: none; font-family: inherit;
        text-align: left; cursor: pointer; color: inherit;
        text-decoration: none;   /* la fila también se usa como <a> (→ /admin/avisos) */
      }
      .disa-row + .disa-row { border-top: 0.5px solid var(--bg3); }
      .disa-row:hover { background: var(--bg3); }
      .disa-row-label { color: var(--body-tx); display: flex; align-items: center; gap: 9px; }
      .disa-row-label i { font-size: 16px; color: var(--text3); }
      .disa-pill { font-size: 11px; font-weight: 500; padding: 2px 9px; border-radius: 20px; }
      .disa-pill.vencida { background: var(--danger-s); color: var(--danger); }
      .disa-pill.porvencer { background: var(--warn-s); color: var(--warn); }
      .disa-pill.aldia { background: var(--accent-soft); color: var(--accent-d); }

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

      /* Mensajes */
      .disa-messages {
        width: 100%;
        flex: 1;
        overflow-y: auto;
        padding: 12px 0 8px;
        display: none;
        flex-direction: column;
        gap: 14px;
        max-height: calc(100vh - 280px);
      }
      .disa-messages.visible { display: flex; }

      .disa-msg { display: flex; gap: 10px; max-width: 100%; }
      .disa-msg.user { justify-content: flex-end; }
      .disa-msg-bubble {
        padding: 11px 15px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.55;
        max-width: 78%;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .disa-msg.user .disa-msg-bubble {
        background: var(--accent); color: var(--bg2); border-bottom-right-radius: 4px;
      }
      .disa-msg.assistant .disa-msg-bubble {
        background: var(--bg2); border: 1px solid var(--border2); color: var(--text); border-top-left-radius: 4px;
      }
      .disa-msg-avatar {
        width: 28px; height: 28px;
        background: linear-gradient(135deg,var(--accent),var(--accent-d));
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-weight: 500; color: var(--bg2); font-size: 11px;
        flex-shrink: 0; margin-top: 2px;
      }

      /* Typing indicator */
      .disa-typing { display: flex; gap: 4px; padding: 4px 0; align-items: center; }
      .disa-typing span {
        width: 6px; height: 6px; background: var(--accent);
        border-radius: 50%; opacity: 0.4; animation: dh-typing 1.2s infinite;
      }
      .disa-typing span:nth-child(2) { animation-delay: 0.2s; }
      .disa-typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes dh-typing {
        0%,60%,100% { opacity: 0.4; transform: scale(0.85); }
        30% { opacity: 1; transform: scale(1.1); }
      }

      /* Input area */
      .disa-input-area {
        width: 100%;
        max-width: 680px;
        margin: 0 auto;
        flex-shrink: 0;
      }
      .disa-input-area.docked {
        position: sticky;
        bottom: 0;
        padding-bottom: 16px;
        padding-top: 12px;
        background: linear-gradient(to bottom, transparent 0%, var(--bg2) 35%);
      }

      /* Chips */
      .disa-chips {
        display: flex; gap: 6px; justify-content: center;
        margin-bottom: 10px; flex-wrap: wrap;
      }
      .disa-chip {
        background: var(--bg3);
        border: 1px solid var(--border2);
        color: var(--text2); font-size: 11px;
        padding: 5px 12px; border-radius: 14px;
        cursor: pointer; transition: all 0.15s; font-family: inherit;
      }
      .disa-chip:hover { background: var(--accent-soft); border-color: var(--border2); color: var(--accent-d); }

      /* Input box */
      .disa-input-box {
        display: flex; align-items: center; gap: 8px;
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 24px;
        padding: 8px 8px 8px 18px;
        box-shadow: 0 1px 3px rgba(16,24,40,0.06);
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .disa-input-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(51,65,85,0.10); }
      .disa-input {
        flex: 1; background: transparent; border: none; outline: none;
        color: var(--text); font-size: 13px; padding: 6px 0; font-family: inherit;
      }
      .disa-input::placeholder { color: var(--text2); }
      .disa-send-btn {
        background: var(--accent);
        border: none; color: var(--bg2);
        padding: 9px 11px; border-radius: 18px;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: background 0.15s, opacity 0.15s;
        flex-shrink: 0;
      }
      .disa-send-btn:hover { background: var(--accent-d); }
      .disa-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }

      .disa-disclaimer { color: var(--text2); font-size: 10px; text-align: center; margin-top: 8px; }

      /* Cards (accesos rápidos) */
      .disa-cards {
        display: grid;
        grid-template-columns: repeat(4,1fr);
        gap: 12px;
        width: 100%;
        max-width: 920px;
        margin: 18px auto 0;
        transition: opacity 0.25s ease, max-height 0.3s ease, margin 0.3s ease;
        max-height: 200px;
        overflow: hidden;
      }
      .disa-cards.hidden {
        opacity: 0; max-height: 0; margin: 0; pointer-events: none;
      }
      .disa-card {
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 12px; padding: 13px 14px;
        cursor: pointer; transition: border-color 0.15s, background 0.15s;
        text-align: left; color: inherit; font-family: inherit;
      }
      .disa-card:hover {
        background: var(--bg3);
        border-color: var(--border2);
      }
      .disa-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
      .disa-card-head i { font-size: 16px; color: var(--accent); }
      .disa-card-title { color: var(--text); font-size: 12.5px; font-weight: 600; }
      .disa-card-desc { color: var(--text2); font-size: 11px; line-height: 1.4; }

      @media (max-width: 900px) {
        .disa-cards { grid-template-columns: repeat(2,1fr); }
        .disa-figs { grid-template-columns: repeat(2,1fr); }
      }
      /* Móvil: el bloque rompe el padding del contenido con margin:-1.5rem (−24px) pero el
         padding horizontal es 22px → sobresalía 2px y desbordaba. Se cuadra al padding (−22px)
         y se aprieta un poco el stage para dar aire al compositor. Solo móvil. */
      @media (max-width: 768px) {
        .disa-home { margin-left: -22px; margin-right: -22px; }
        .disa-stage { padding-left: 16px; padding-right: 16px; }
      }

      /* ── Artifacts ── */
      .disa-artifact {
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 12px;
        padding: 14px;
        max-width: 560px;
        width: 100%;
        max-height: 400px;
        overflow-y: auto;
        margin-top: 6px;
      }
      .disa-artifact-title {
        color: var(--text2); font-size: 11px; text-transform: uppercase;
        letter-spacing: 0.8px; font-weight: 500; margin-bottom: 12px;
      }
      .disa-artifact-link {
        display: inline-flex; align-items: center; gap: 4px;
        color: var(--accent); font-size: 11px; text-decoration: none;
        margin-top: 10px; padding: 5px 10px;
        background: var(--accent-soft); border: 0.5px solid var(--border2);
        border-radius: 6px; transition: background 0.15s;
      }
      .disa-artifact-link:hover { background: var(--bg3); }

      /* kpi_dashboard */
      .disa-kpis-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(110px,1fr)); gap: 8px; margin-bottom: 10px; }
      .disa-kpi-card { background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; padding: 10px; }
      .disa-kpi-card-value { color: var(--text); font-size: 17px; font-weight: 600; line-height: 1.1; }
      .disa-kpi-card-value.positive { color: var(--accent); }
      .disa-kpi-card-value.warn { color: var(--warn); }
      .disa-kpi-card-value.danger { color: var(--danger); }
      .disa-kpi-card-label { color: var(--text2); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 3px; }
      .disa-kpi-card-delta { font-size: 10px; margin-top: 4px; font-weight: 500; }
      .disa-kpi-card-delta.positive { color: var(--ok); }
      .disa-kpi-card-delta.danger { color: var(--danger); }
      .disa-kpi-card-delta.neutral { color: var(--text2); }

      .disa-chart-bars { display: flex; align-items: flex-end; gap: 5px; height: 72px; padding: 8px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; }
      .disa-chart-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
      .disa-chart-bar { width: 100%; background: linear-gradient(180deg,var(--accent),var(--accent-d)); border-radius: 3px 3px 0 0; min-height: 2px; }
      .disa-chart-label { color: var(--text2); font-size: 9px; }

      /* action_list */
      .disa-list { display: flex; flex-direction: column; gap: 6px; }
      .disa-list-item { background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; padding: 10px; display: flex; align-items: center; gap: 10px; }
      .disa-list-item.danger { border-left: 2px solid var(--danger); }
      .disa-list-item.warn { border-left: 2px solid var(--warn); }
      .disa-list-item.positive { border-left: 2px solid var(--accent); }
      .disa-list-item-body { flex: 1; min-width: 0; }
      .disa-list-item-title { color: var(--text); font-size: 12px; font-weight: 500; }
      .disa-list-item-subtitle { color: var(--text2); font-size: 11px; margin-top: 2px; }
      .disa-list-item-meta { color: var(--text2); font-size: 10px; margin-top: 2px; }
      .disa-list-item-actions { display: flex; gap: 5px; flex-shrink: 0; }
      .disa-list-btn { border: none; font-size: 10px; padding: 4px 9px; border-radius: 5px; cursor: pointer; font-weight: 500; transition: opacity 0.15s; font-family: inherit; }
      .disa-list-btn.primary { background: var(--accent); color: var(--bg2); }
      .disa-list-btn.secondary { background: transparent; color: var(--text2); border: 1px solid var(--border2); }
      .disa-list-btn:hover { opacity: 0.8; }

      /* big_number */
      .disa-bignum { text-align: center; padding: 14px 8px; }
      .disa-bignum-value { color: var(--text); font-size: 40px; font-weight: 500; line-height: 1; letter-spacing: -1.5px; }
      .disa-bignum-value.positive { color: var(--accent); }
      .disa-bignum-value.warn { color: var(--warn); }
      .disa-bignum-value.danger { color: var(--danger); }
      .disa-bignum-label { color: var(--text2); font-size: 13px; margin-top: 6px; }
      .disa-bignum-context { color: var(--text2); font-size: 11px; margin-top: 4px; }

      /* Assistant col with artifact */
      .disa-msg-col { display: flex; flex-direction: column; gap: 6px; max-width: 82%; }
    </style>

    <div class="disa-home">


      <!-- Stage -->
      <div class="disa-stage" id="dh-stage">

        <!-- Hero: saludo + DISA + cifras + lista (estado inicial) -->
        <div class="disa-hero" id="dh-hero">
          <h3 class="disa-greeting">${_saludo}, ${userName}</h3>
          <p class="disa-question">${onboarding ? 'Vamos a dejar tu negocio a punto — tú decides, yo te acompaño.' : `${fechaHoy} · esto es lo que pide tu atención hoy`}</p>

          ${onboarding ? '' : `<div class="disa-card-main">
            <div class="disa-card-icon"><i class="ti ti-sparkles"></i></div>
            <div>
              <p class="disa-card-title">DISA</p>
              <p class="disa-card-text">${disaProactivo}</p>
            </div>
          </div>`}
${onbHtml}
          ${onboarding ? '' : `
          <!-- PASO 6 · INICIO PERSONALIZABLE: rejilla componible (paneles guardados del constructor +
               bloques nativos: cifras, avisos, vigía). Se resuelve por cascada usuario > empresa >
               fábrica; el contenido y los permisos se cargan por fetch. -->
          <div class="ig-bar">
            <span id="igScope" class="ig-scope"></span>
            <div class="ig-actions" id="igActions"></div>
          </div>
          <div id="inicioGrid" class="ig-grid"><div class="ig-empty">Cargando tu Inicio…</div></div>
          `}
        </div>

        <!-- Mensajes -->
        <div class="disa-messages" id="dh-messages"></div>

        <!-- Input -->
        <div class="disa-input-area" id="dh-input-area">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">
            <div class="disa-chips" id="dh-chips" style="margin-bottom:0"></div>
            <button onclick="disaEditChips()" title="Editar accesos rápidos"
              style="background:none;border:none;cursor:pointer;color:var(--text3);padding:3px;border-radius:4px;line-height:1;transition:color 0.15s;flex-shrink:0"
              onmouseover="this.style.color='var(--text2)'" onmouseout="this.style.color='var(--text3)'">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button onclick="dhNewThread()" title="Nueva conversación"
              style="background:none;border:none;cursor:pointer;color:var(--text3);padding:3px 8px;border-radius:6px;font-size:11px;line-height:1;display:flex;align-items:center;gap:4px;flex-shrink:0;font-family:inherit"
              onmouseover="this.style.color='var(--text2)'" onmouseout="this.style.color='var(--text3)'">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nueva
            </button>
          </div>
          <form onsubmit="event.preventDefault(); disaSubmitHome();">
            <div class="disa-input-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" id="dh-input" class="disa-input"
                placeholder="Pregunta a DISA o pídele que haga algo..."
                autocomplete="off" />
              <input type="file" id="dh-file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" style="display:none" onchange="dhAttach()" />
              <button type="button" id="dh-attach" title="Adjuntar factura (foto o PDF)"
                onclick="document.getElementById('dh-file').click()"
                style="background:none;border:none;cursor:pointer;color:var(--text2);padding:6px;display:flex;align-items:center;flex-shrink:0">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <button type="submit" class="disa-send-btn" id="dh-send">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </form>
          <div class="disa-disclaimer">DISA puede crear, editar y analizar — siempre te pide confirmación antes de actuar</div>
        </div>

        <!-- Cards -->
        <div class="disa-cards" id="dh-cards">
          <button class="disa-card" onclick="disaQuickSend('Resumen del día')">
            <div class="disa-card-head">
              <i class="ti ti-chart-line"></i>
              <div class="disa-card-title">Resumen del día</div>
            </div>
            <div class="disa-card-desc">Ventas, pedidos y métricas de hoy</div>
          </button>
          <button class="disa-card" onclick="disaShowAlerts()">
            <div class="disa-card-head">
              <i class="ti ti-alert-triangle"></i>
              <div class="disa-card-title">¿Qué requiere mi atención?</div>
            </div>
            <div class="disa-card-desc">Cobros vencidos, pagos, stock y recurrentes</div>
          </button>
          <button class="disa-card" onclick="disaQuickSend('Crea un producto nuevo')">
            <div class="disa-card-head">
              <i class="ti ti-plus"></i>
              <div class="disa-card-title">Crear nuevo producto</div>
            </div>
            <div class="disa-card-desc">Te guío paso a paso</div>
          </button>
          <!-- D3 — Tarjeta "Construir mi tienda web" OCULTA: empujaba el prompt 'Construir mi tienda web',
               que va a /api/disa/store-message → 404 (el builder de tienda está desmontado, D2). No se
               borra la idea: se vuelve a mostrar cuando la función de tienda esté construida (Capa 2).
          <button class="disa-card" onclick="disaQuickSend('Construir mi tienda web')">
            <div class="disa-card-head">
              <i class="ti ti-world"></i>
              <div class="disa-card-title">Construir mi tienda web</div>
            </div>
            <div class="disa-card-desc">Catálogo + checkout en minutos</div>
          </button>
          -->
        </div>

      </div>
    </div>

    <!-- PASO 6 · el gráfico de un panel se pinta reutilizando EL MISMO motor del constructor (Chart.js
         del mismo vendor + /constructor/cruzar). Sortable.js (ya vendido) para reordenar los bloques. -->
    <script src="/public/vendor/chartjs/chart.umd.min.js"></script>
    <script src="/public/js/grafico-constructor.js"></script>
    <script src="/public/vendor/sortablejs/Sortable.min.js"></script>
    <script>
      let dhStarted = false;
      // ARREGLO 2 — el dashboard recupera la conversación de DISA al recargar: recuerda el
      // hilo activo (como el widget) para enviar al MISMO hilo y recuperar su historial al
      // cargar. No toca el motor de hilos/guardado (que ya funciona); solo lo usa.
      let dhThreadId = null;

      function dhDock() {
        if (dhStarted) return;
        document.getElementById('dh-hero').classList.add('hidden');
        document.getElementById('dh-cards').classList.add('hidden');
        document.getElementById('dh-chips').style.display = 'none';
        document.getElementById('dh-messages').classList.add('visible');
        document.getElementById('dh-input-area').classList.add('docked');
        document.getElementById('dh-stage').style.justifyContent = 'flex-end';
        dhStarted = true;
      }

      function disaQuickSend(text) {
        document.getElementById('dh-input').value = text;
        disaSubmitHome();
      }

      // Tarjeta "¿Qué requiere mi atención?" (Paso d · resumen-primero): NO lanza una pregunta
      // abierta al modelo. Pide al motor de avisos un RESUMEN DE CONTEOS (determinista, sin
      // modelo, sin ofrecer acciones). YA NO marca nada como visto: un resumen de conteos no es
      // descartar avisos, y marcarlos borraba los "no visto" que el usuario había puesto a mano.
      // Marcar es suyo, en /admin/avisos o en el panel de la campana. Por eso este código tampoco
      // toca el punto de la campana: apagarlo a mano sería mentir sobre el estado del servidor.
      window.disaShowAlerts = async function() {
        if (!dhStarted) {
          document.getElementById('dh-hero').classList.add('hidden');
          document.getElementById('dh-cards').classList.add('hidden');
          document.getElementById('dh-chips').style.display = 'none';
          document.getElementById('dh-messages').classList.add('visible');
          document.getElementById('dh-input-area').classList.add('docked');
          document.getElementById('dh-stage').style.justifyContent = 'flex-end';
          dhStarted = true;
        }
        dhAppendMsg('user', '¿Qué requiere mi atención?');
        const typingId = dhAppendTyping();
        try {
          const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || window.CSRF_TOKEN || '';
          const res = await fetch('/api/disa/alerts/open', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf } });
          const data = await res.json();
          dhRemoveTyping(typingId);
          dhAppendMsg('assistant', data.reply || 'Ahora mismo no tienes nada pendiente.');
        } catch {
          dhRemoveTyping(typingId);
          dhAppendMsg('assistant', 'No pude cargar tus avisos. Intenta de nuevo.');
        }
      };

      // Nueva conversación: crea un hilo nuevo (mismo motor que el asistente IA) y vuelve a
      // la pantalla inicial (hero + accesos), sin mensajes.
      window.dhNewThread = async function() {
        try {
          const res = await fetch('/api/disa/threads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': dhGetCsrf() } });
          const t = await res.json();
          dhThreadId = t.id || null;
        } catch { dhThreadId = null; }
        const msgs = document.getElementById('dh-messages');
        msgs.innerHTML = '';
        msgs.classList.remove('visible');
        document.getElementById('dh-hero').classList.remove('hidden');
        document.getElementById('dh-cards').classList.remove('hidden');
        document.getElementById('dh-chips').style.display = '';
        document.getElementById('dh-input-area').classList.remove('docked');
        document.getElementById('dh-stage').style.justifyContent = '';
        dhStarted = false;
        document.getElementById('dh-input').focus();
      };

      async function disaSubmitHome() {
        const input = document.getElementById('dh-input');
        const btn = document.getElementById('dh-send');
        const msg = input.value.trim();
        if (!msg || btn.disabled) return;

        if (!dhStarted) {
          document.getElementById('dh-hero').classList.add('hidden');
          document.getElementById('dh-cards').classList.add('hidden');
          document.getElementById('dh-chips').style.display = 'none';
          document.getElementById('dh-messages').classList.add('visible');
          document.getElementById('dh-input-area').classList.add('docked');
          document.getElementById('dh-stage').style.justifyContent = 'flex-end';
          dhStarted = true;
        }

        dhAppendMsg('user', msg);
        input.value = '';
        btn.disabled = true;

        const typingId = dhAppendTyping();

        try {
          const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || window.CSRF_TOKEN || '';
          const res = await fetch('/api/disa/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
            // ARREGLO 2: manda el hilo activo para que la conversación sea UNA sola y recuperable.
            // body: JSON.stringify({ message: msg })   // (antes: sin thread_id → el dashboard no recuperaba al recargar)
            body: JSON.stringify({ message: msg, thread_id: dhThreadId })
          });
          const data = await res.json();
          dhRemoveTyping(typingId);
          if (data.thread_id) dhThreadId = data.thread_id;   // recuerda el hilo para las siguientes
          const reply = data.reply || data.response || data.message || 'Sin respuesta.';
          dhAppendMsg('assistant', reply, data.artifact || null);
          // Handoff a pantalla (p.ej. dictar una compra por voz): navega al enlace que devuelve
          // la acción (mismo mecanismo que el adjunto de factura).
          if (data.capture_url) setTimeout(() => { window.location.href = data.capture_url; }, 900);
        } catch {
          dhRemoveTyping(typingId);
          dhAppendMsg('assistant', 'Error al contactar con DISA. Intenta de nuevo.');
        } finally {
          btn.disabled = false;
          input.focus();
        }
      }

      // Adjuntar factura de proveedor: la sube a DISA (mismo endpoint que el widget), que la
      // lee con el extractor de C2 y devuelve un enlace a la pantalla de revisión EDITABLE
      // precargada. Nada se guarda hasta confirmar allí (confirm-first).
      async function dhAttach() {
        const fileInput = document.getElementById('dh-file');
        const f = fileInput.files[0];
        if (!f) return;
        fileInput.value = '';
        if (!dhStarted) {
          document.getElementById('dh-hero').classList.add('hidden');
          document.getElementById('dh-cards').classList.add('hidden');
          document.getElementById('dh-chips').style.display = 'none';
          document.getElementById('dh-messages').classList.add('visible');
          document.getElementById('dh-input-area').classList.add('docked');
          document.getElementById('dh-stage').style.justifyContent = 'flex-end';
          dhStarted = true;
        }
        dhAppendMsg('user', '📄 ' + f.name);
        const typingId = dhAppendTyping();
        try {
          const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || window.CSRF_TOKEN || '';
          const fd = new FormData(); fd.append('file', f);
          const res = await fetch('/api/disa/attach', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: fd });
          const data = await res.json();
          dhRemoveTyping(typingId);
          if (!res.ok || data.error) { dhAppendMsg('assistant', data.error || 'No pude procesar el archivo.'); return; }
          dhAppendMsg('assistant', data.reply || 'Listo.');
          if (data.capture_url) setTimeout(() => { window.location.href = data.capture_url; }, 900);
        } catch {
          dhRemoveTyping(typingId);
          dhAppendMsg('assistant', 'Error al subir la factura.');
        }
      }

      function dhAppendMsg(role, text, artifact) {
        const msgs = document.getElementById('dh-messages');
        const wrap = document.createElement('div');
        wrap.className = 'disa-msg ' + role;

        if (role === 'assistant') {
          const av = document.createElement('div');
          av.className = 'disa-msg-avatar';
          av.textContent = 'D';
          wrap.appendChild(av);

          const col = document.createElement('div');
          col.className = 'disa-msg-col';

          if (text) {
            const bubble = document.createElement('div');
            bubble.className = 'disa-msg-bubble';
            bubble.textContent = text;
            col.appendChild(bubble);
          }

          if (artifact) {
            const artNode = dhRenderArtifact(artifact);
            if (artNode) col.appendChild(artNode);
          }

          wrap.appendChild(col);
        } else {
          const bubble = document.createElement('div');
          bubble.className = 'disa-msg-bubble';
          bubble.textContent = text;
          wrap.appendChild(bubble);
        }

        msgs.appendChild(wrap);
        msgs.scrollTop = msgs.scrollHeight;
      }

      function dhRenderArtifact(artifact) {
        if (!artifact || !artifact.type) return null;
        const wrap = document.createElement('div');
        wrap.className = 'disa-artifact';
        const d = artifact.data || {};

        if (artifact.type === 'kpi_dashboard') {
          if (d.title) { const t = document.createElement('div'); t.className = 'disa-artifact-title'; t.textContent = d.title; wrap.appendChild(t); }
          if (d.kpis && d.kpis.length) {
            const grid = document.createElement('div');
            grid.className = 'disa-kpis-grid';
            d.kpis.forEach(k => {
              const card = document.createElement('div');
              card.className = 'disa-kpi-card';
              const val = document.createElement('div');
              val.className = 'disa-kpi-card-value ' + (k.tone || 'neutral');
              val.textContent = k.value;
              const lbl = document.createElement('div');
              lbl.className = 'disa-kpi-card-label';
              lbl.textContent = k.label;
              card.appendChild(val);
              card.appendChild(lbl);
              if (k.delta) {
                const delt = document.createElement('div');
                const isPos = /^\\+|↑/.test(String(k.delta));
                const isNeg = /^-|↓/.test(String(k.delta));
                delt.className = 'disa-kpi-card-delta ' + (isPos ? 'positive' : isNeg ? 'danger' : 'neutral');
                delt.textContent = k.delta;
                card.appendChild(delt);
              }
              grid.appendChild(card);
            });
            wrap.appendChild(grid);
          }
          if (d.chart && d.chart.type === 'bars' && d.chart.data && d.chart.data.length) {
            const maxV = Math.max(...d.chart.data.map(p => p.value || 0)) || 1;
            const chart = document.createElement('div');
            chart.className = 'disa-chart-bars';
            d.chart.data.forEach(p => {
              const col = document.createElement('div');
              col.className = 'disa-chart-bar-col';
              const bar = document.createElement('div');
              bar.className = 'disa-chart-bar';
              bar.style.height = Math.max(4, Math.round((p.value / maxV) * 100)) + '%';
              const lbl = document.createElement('div');
              lbl.className = 'disa-chart-label';
              lbl.textContent = p.label || '';
              col.appendChild(bar);
              col.appendChild(lbl);
              chart.appendChild(col);
            });
            wrap.appendChild(chart);
          }

        } else if (artifact.type === 'action_list') {
          if (d.title) { const t = document.createElement('div'); t.className = 'disa-artifact-title'; t.textContent = d.title; wrap.appendChild(t); }
          if (d.items && d.items.length) {
            const list = document.createElement('div');
            list.className = 'disa-list';
            d.items.forEach(item => {
              const row = document.createElement('div');
              row.className = 'disa-list-item ' + (item.tone || '');
              const body = document.createElement('div');
              body.className = 'disa-list-item-body';
              const title = document.createElement('div');
              title.className = 'disa-list-item-title';
              title.textContent = item.title || '';
              body.appendChild(title);
              if (item.subtitle) { const s = document.createElement('div'); s.className = 'disa-list-item-subtitle'; s.textContent = item.subtitle; body.appendChild(s); }
              if (item.meta) { const m = document.createElement('div'); m.className = 'disa-list-item-meta'; m.textContent = item.meta; body.appendChild(m); }
              row.appendChild(body);
              if (item.actions && item.actions.length) {
                const acts = document.createElement('div');
                acts.className = 'disa-list-item-actions';
                item.actions.forEach(a => {
                  const btn = document.createElement('button');
                  btn.className = 'disa-list-btn ' + (a.intent || 'secondary');
                  btn.textContent = a.label;
                  const act = a.action, params = a.params || {};
                  btn.onclick = () => dhArtifactAction(act, params);
                  acts.appendChild(btn);
                });
                row.appendChild(acts);
              }
              list.appendChild(row);
            });
            wrap.appendChild(list);
          }

        } else if (artifact.type === 'big_number') {
          const box = document.createElement('div');
          box.className = 'disa-bignum';
          const val = document.createElement('div');
          val.className = 'disa-bignum-value ' + (d.tone || 'neutral');
          val.textContent = d.value || '';
          box.appendChild(val);
          if (d.label) { const l = document.createElement('div'); l.className = 'disa-bignum-label'; l.textContent = d.label; box.appendChild(l); }
          if (d.context) { const ctx = document.createElement('div'); ctx.className = 'disa-bignum-context'; ctx.textContent = d.context; box.appendChild(ctx); }
          wrap.appendChild(box);
          if (d.link) wrap.appendChild(dhMakeLink(d.link));
          return wrap;
        } else {
          return null;
        }

        if (d.link) wrap.appendChild(dhMakeLink(d.link));
        return wrap;
      }

      function dhMakeLink(link) {
        if (!link || !link.url) return document.createDocumentFragment();
        const allowedExact = [
          '/admin/products','/admin/categories','/admin/tags',
          // PIEZA C — POS viejo retirado: quitados '/admin/orders', '/admin/orders/pos', '/refunds', '/draft/new'.
          '/admin/discounts','/admin/inventory','/admin/suppliers','/admin/purchases',
          '/admin/purchases/new','/admin/invoices','/admin/clients','/admin/clients/groups',
          '/admin/analytics','/admin/settings','/admin/users',
          '/admin/activity','/admin/security','/admin/disa',
          // D2 — restos e-commerce desmontados: quitados '/admin/store-settings', '/admin/newsletter',
          // '/admin/reviews', '/admin/feedback' (darían 404). '/admin/tags' SE QUEDA (función de catálogo).
        ];
        const allowedPatterns = [
          // PIEZA C — POS viejo retirado: quitados los patrones /admin/orders/:id y /admin/orders/:id/invoice.
          /^\\/admin\\/purchases\\/\\d+$/,
          /^\\/admin\\/invoices\\/\\d+$/,
        ];
        const url = link.url;
        if (!allowedExact.includes(url) && !allowedPatterns.some(re => re.test(url))) {
          console.warn('[DISA] URL bloqueada en frontend:', url);
          return document.createDocumentFragment();
        }
        const a = document.createElement('a');
        a.className = 'disa-artifact-link';
        a.href = url;
        a.textContent = (link.label || 'Ver más') + ' →';
        return a;
      }

      function dhArtifactAction(action, params) {
        const navMap = {
          view_product: p => '/admin/products/' + p.product_id,
          // PIEZA C — POS viejo retirado: 'view_order' eliminado (apuntaba a /admin/orders/:id, ahora 404).
          view_client: p => '/admin/clients/' + p.client_id,
        };
        if (navMap[action] && Object.values(params)[0]) {
          window.location.href = navMap[action](params);
          return;
        }
        // For non-nav actions, send as chat message to DISA
        const labels = {
          restock: 'Reponer stock del producto ' + (params.product_id || ''),
          order_stock: 'Pedir stock del producto ' + (params.product_id || ''),
        };
        const msg = labels[action] || (action + ' ' + JSON.stringify(params));
        document.getElementById('dh-input').value = msg;
        disaSubmitHome();
      }

      function dhAppendTyping() {
        const msgs = document.getElementById('dh-messages');
        const id = 'dh-typing-' + Date.now();
        const wrap = document.createElement('div');
        wrap.className = 'disa-msg assistant';
        wrap.id = id;
        const av = document.createElement('div');
        av.className = 'disa-msg-avatar';
        av.textContent = 'D';
        const bubble = document.createElement('div');
        bubble.className = 'disa-msg-bubble';
        bubble.innerHTML = '<div class="disa-typing"><span></span><span></span><span></span></div>';
        wrap.appendChild(av);
        wrap.appendChild(bubble);
        msgs.appendChild(wrap);
        msgs.scrollTop = msgs.scrollHeight;
        return id;
      }

      function dhRemoveTyping(id) {
        document.getElementById(id)?.remove();
      }

      document.getElementById('dh-input')?.focus();

      const DH_DEFAULT_CHIPS = ['Resumen del día', 'Top productos', 'Clientes inactivos'];

      function dhGetCsrf() {
        return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || window.CSRF_TOKEN || '';
      }

      function dhRenderChips(chips) {
        const el = document.getElementById('dh-chips');
        if (!el) return;
        el.innerHTML = chips.map(function(c) {
          return '<button class="disa-chip" onclick="disaQuickSend(' + JSON.stringify(c).replace(/"/g, '&quot;') + ')">'
            + c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') + '</button>';
        }).join('');
      }

      async function dhLoadChips() {
        try {
          const res = await fetch('/api/disa/chips', { headers: { 'x-csrf-token': dhGetCsrf() } });
          const chips = res.ok ? await res.json() : DH_DEFAULT_CHIPS;
          dhRenderChips(Array.isArray(chips) && chips.length ? chips : DH_DEFAULT_CHIPS);
        } catch { dhRenderChips(DH_DEFAULT_CHIPS); }
      }

      window.disaEditChips = async function() {
        let chips = DH_DEFAULT_CHIPS;
        try {
          const res = await fetch('/api/disa/chips', { headers: { 'x-csrf-token': dhGetCsrf() } });
          if (res.ok) { const d = await res.json(); if (Array.isArray(d) && d.length) chips = d; }
        } catch {}
        for (var i = 0; i < 3; i++) {
          var inp = document.getElementById('dh-chip-' + i);
          if (inp) inp.value = chips[i] || '';
        }
        document.getElementById('dh-chips-modal').style.display = 'flex';
      };

      window.disaSaveChips = async function() {
        var chips = [0,1,2].map(function(i){ return (document.getElementById('dh-chip-'+i)?.value||'').trim(); }).filter(Boolean);
        if (!chips.length) return;
        try {
          var res = await fetch('/api/disa/chips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': dhGetCsrf() },
            body: JSON.stringify({ chips: chips })
          });
          if (res.ok) {
            dhRenderChips(chips);
            document.getElementById('dh-chips-modal').style.display = 'none';
          }
        } catch {}
      };

      // ARREGLO 2 — al cargar el dashboard, recupera y pinta el historial del hilo activo
      // (equivalente a loadActiveThread del widget). Solo LEE los endpoints de hilos ya
      // existentes; no toca el guardado. Silencioso si falla (como el widget).
      async function dhLoadActiveThread() {
        try {
          const r = await fetch('/api/disa/threads', { headers: { 'x-csrf-token': dhGetCsrf() } });
          if (!r.ok) return;
          const threads = await r.json();
          if (!Array.isArray(threads) || !threads.length) return;
          dhThreadId = threads[0].id;
          const r2 = await fetch('/api/disa/threads/' + dhThreadId, { headers: { 'x-csrf-token': dhGetCsrf() } });
          if (!r2.ok) return;
          const t = await r2.json();
          if (t.messages && t.messages.length > 0) {
            dhDock();
            const msgs = document.getElementById('dh-messages');
            msgs.innerHTML = '';
            t.messages.forEach(function(m) { dhAppendMsg(m.role, m.content, null); });
            msgs.scrollTop = msgs.scrollHeight;
          }
        } catch (e) { /* silencioso, como el widget */ }
      }

      dhLoadChips();

      // ── PASO 6 · INICIO PERSONALIZABLE — la rejilla componible. El vigía de DISA (pieza 5), las cifras
      // y los avisos son ahora BLOQUES colocables; se suman los paneles guardados del constructor. La
      // cascada (usuario > empresa > fábrica) y los permisos los resuelve el servidor; el gráfico de un
      // panel se pinta reutilizando el MOTOR del constructor (/constructor/cruzar + Chart.js). Solo se
      // guarda la COLOCACIÓN — cero cifras propias, no puede discrepar del constructor.
      (function initInicio(){
        var grid = document.getElementById('inicioGrid');
        if (!grid) return;                                   // (en onboarding no hay rejilla)
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
          if (b.tipo === 'avisos') return pintarAvisos(body);
          if (b.tipo === 'vigia') return pintarVigia(body);
          if (b.tipo === 'panel') return pintarPanel(b, body);
          body.innerHTML = '';
        }
        function pintarKpis(body){
          var k = (IG.datos && IG.datos.kpis) || {}, av = (IG.datos && IG.datos.avisos) || {};
          function fig(icon, color, label, val){ return '<div><p class="ig-kpi-label"><i class="ti ' + icon + '" style="color:' + color + '"></i>' + label + '</p><p class="ig-kpi-value">' + val + '</p></div>'; }
          body.innerHTML = '<div class="ig-kpis">'
            + fig('ti-arrow-down-left', 'var(--accent)', 'Ventas del mes', k.verVentas ? IG_SYM + (k.ventas || 0) : '—')
            + fig('ti-receipt', 'var(--warn)', 'Pedidos', k.verPedidos ? (k.pedidos || 0) : '—')
            + fig('ti-clock-hour-4', 'var(--text2)', 'Pendientes', k.verPedidos ? (k.pendiente || 0) : '—')
            + fig('ti-alert-triangle', 'var(--danger)', 'Avisos', (av.estado && av.estado !== 'apagado') ? (av.count || 0) : 0)
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

      // La HOME (/admin) es el DASHBOARD del molde 1 (saludo + cifras + tarjeta DISA + lista +
      // input): aterriza SIEMPRE en el hero, no en el chat. La conversación a pantalla completa
      // vive en /admin/disa (DISEÑO.md §3.2). Por eso ya NO se auto-restaura el hilo aquí; al
      // escribir en el input, la home abre el chat en línea (disaSubmitHome). dhLoadActiveThread()
      // se conserva por si /admin/disa lo reutiliza, pero la home no lo invoca al cargar.
    </script>

    <div id="dh-chips-modal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center">
      <div style="background:var(--bg2);border: 1px solid var(--border2);border-radius:12px;padding:24px;width:360px;max-width:90vw">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div style="color:var(--text);font-weight:500;font-size:14px">Accesos rápidos</div>
          <button onclick="document.getElementById('dh-chips-modal').style.display='none'" style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:18px;line-height:1;padding:0">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
          <input id="dh-chip-0" placeholder="Chip 1" style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;width:100%;box-sizing:border-box">
          <input id="dh-chip-1" placeholder="Chip 2" style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;width:100%;box-sizing:border-box">
          <input id="dh-chip-2" placeholder="Chip 3" style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;width:100%;box-sizing:border-box">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('dh-chips-modal').style.display='none'" style="padding:7px 14px;border:1px solid var(--border2);border-radius:7px;background:none;color:var(--text2);cursor:pointer;font-size:13px;font-family:inherit">Cancelar</button>
          <button onclick="disaSaveChips()" style="padding:7px 14px;background:var(--accent);border:none;border-radius:7px;color:var(--bg2);cursor:pointer;font-size:13px;font-weight:500;font-family:inherit">Guardar</button>
        </div>
      </div>
    </div>
  `;
}
