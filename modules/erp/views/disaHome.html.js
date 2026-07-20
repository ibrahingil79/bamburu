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
          ${onboarding ? '' : `<div class="disa-figs">
            <div class="disa-fig">
              <p class="disa-fig-label"><i class="ti ti-arrow-down-left" style="color:var(--accent)"></i>Ventas del mes</p>
              <p class="disa-fig-value">${kpis?.verVentas ? sym + (kpis?.ventas ?? 0) : '—'}</p>
            </div>
            <div class="disa-fig">
              <p class="disa-fig-label"><i class="ti ti-receipt" style="color:var(--warn)"></i>Pedidos</p>
              <p class="disa-fig-value">${kpis?.verPedidos ? (kpis?.pedidos ?? 0) : '—'}</p>
            </div>
            <div class="disa-fig">
              <p class="disa-fig-label"><i class="ti ti-clock-hour-4" style="color:var(--text2)"></i>Pendientes</p>
              <p class="disa-fig-value">${kpis?.verPedidos ? (kpis?.pendiente ?? 0) : '—'}</p>
            </div>
            <a class="disa-fig disa-fig-link" href="/admin/avisos" title="Ver y resolver tus avisos">
              <p class="disa-fig-label"><i class="ti ti-alert-triangle" style="color:var(--danger)"></i>Avisos</p>
              <p class="disa-fig-value">${alertState !== 'apagado' ? (alertCount ?? 0) : 0}</p>
            </a>
          </div>

          ${alertState !== 'apagado' && alertCount > 0 ? `
          <div class="disa-rows">
            <a class="disa-row" href="/admin/avisos">
              <span class="disa-row-label"><i class="ti ti-bell"></i>${alertCount} ${alertCount === 1 ? 'aviso pendiente' : 'avisos pendientes'} · resolverlos</span>
              <span class="disa-pill ${alertState === 'visto' ? 'aldia' : 'vencida'}">${alertState === 'visto' ? 'Visto' : 'Requiere atención'}</span>
            </a>
          </div>
          ` : ''}`}

          <!-- PIEZA 5 (Dónde te espera): asoman los avisos del vigía más importantes; se rellena por fetch. -->
          <div id="dhVigia" class="dh-vigia" style="display:none"></div>
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

      // ── PIEZA 5 · "Dónde te espera": asoma en el Inicio los avisos del vigía MÁS IMPORTANTES (top 5),
      // cada uno con su prioridad, y enlaza a la lista completa en /admin/vigia. Hereda permisos: si el
      // usuario no tiene analytics.read (o no ve ningún área), la API filtra y el bloque no se muestra.
      // Es lo MISMO que /admin/vigia (misma fuente, mismo orden) — no puede discrepar.
      (async function dhVigiaAvisos(){
        const box = document.getElementById('dhVigia');
        if (!box) return;
        try {
          const r = await fetch('/api/erp/vigia/avisos?top=5', { headers: { 'x-csrf-token': dhGetCsrf() } });
          if (!r.ok) return;                       // 403 (sin analytics.read) u otro → el bloque no asoma
          const d = await r.json();
          const avisos = (d && d.avisos) || [];
          if (!avisos.length) return;              // nada que asome (sin avisos en las áreas que ve)
          const esc = window.escHtml || function(s){ return s == null ? '' : String(s); };
          const colores = { alta: ['var(--danger-s)','var(--danger)'], media: ['var(--warn-s)','var(--warn)'], baja: ['var(--bg3)','var(--text3)'] };
          const pill = function(p){
            if (!p) return '';
            const c = colores[p.grupo] || colores.media;
            return '<span class="dh-vigia-pill" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(p.etiqueta) + '</span>';
          };
          box.innerHTML =
            '<div class="dh-vigia-head"><i class="ti ti-radar"></i>Vigía de DISA · lo más importante</div>'
            + avisos.map(function(a){
                return '<a class="dh-vigia-row" href="/admin/vigia">'
                  + '<span class="dh-vigia-tx">' + esc(a.encabezado || a.quePasa || '') + '</span>'
                  + pill(a.prioridad) + '</a>';
              }).join('')
            + '<a class="dh-vigia-more" href="/admin/vigia">Ver todos en el Vigía →</a>';
          box.style.display = '';
        } catch (e) { /* silencioso, como el resto de la home */ }
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
