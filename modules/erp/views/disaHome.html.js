export function disaHomeHtml({ userName, alertCount, alertState, kpis }) {
  const sym = kpis?.sym || '€';

  // Fecha de hoy en español (presentación; server-side, no toca datos del tenant).
  const _now = new Date();
  const _dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const _meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const _h = _now.getHours();
  const _saludo = _h < 6 ? 'Hola' : _h < 13 ? 'Buenos días' : _h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const fechaHoy = `${_dias[_now.getDay()]}, ${_now.getDate()} de ${_meses[_now.getMonth()]}`;

  // Texto proactivo de DISA, derivado de los avisos reales que ya calcula el motor.
  const disaProactivo = (alertState !== 'apagado' && alertCount > 0)
    ? `Tienes ${alertCount} ${alertCount === 1 ? 'aviso que pide' : 'avisos que piden'} tu atención (vencimientos de proveedor y stock bajo). ¿Quieres que te los enseñe y preparemos los pagos?`
    : `Todo en orden por ahora. ¿En qué quieres trabajar hoy en tu negocio? Puedo crear facturas, registrar gastos o darte un resumen.`;

  return `
    <style>
      .disa-home {
        min-height: calc(100vh - 60px);
        display: flex;
        flex-direction: column;
        margin: -1.5rem;
        position: relative;
      }

      /* Badge alertas (esquina superior derecha) */
      .disa-alerts-badge {
        position: absolute;
        top: 12px;
        right: 20px;
        background: var(--danger-s);
        color: var(--danger);
        font-size: 11px;
        padding: 5px 11px;
        border-radius: 20px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        border: 1px solid var(--border2);
        font-family: inherit;
        z-index: 5;
        transition: background 0.15s;
      }
      .disa-alerts-badge .adot { width: 5px; height: 5px; background: var(--danger); border-radius: 50%; }
      .disa-alerts-badge.visto {
        background: var(--bg3);
        color: var(--text2);
        border-color: var(--border);
      }
      .disa-alerts-badge.visto .adot { background: var(--text2); }

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
        border: 0.5px solid #D6DCE4;
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
      }
      .disa-row + .disa-row { border-top: 0.5px solid #F3F4F6; }
      .disa-row:hover { background: var(--bg3); }
      .disa-row-label { color: var(--body-tx); display: flex; align-items: center; gap: 9px; }
      .disa-row-label i { font-size: 16px; color: var(--text3); }
      .disa-pill { font-size: 11px; font-weight: 500; padding: 2px 9px; border-radius: 20px; }
      .disa-pill.vencida { background: var(--danger-s); color: var(--danger); }
      .disa-pill.porvencer { background: var(--warn-s); color: var(--warn); }
      .disa-pill.aldia { background: var(--accent-soft); color: var(--accent-d); }

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
        background: var(--accent); color: #fff; border-bottom-right-radius: 4px;
      }
      .disa-msg.assistant .disa-msg-bubble {
        background: #FFFFFF; border: 1px solid var(--border2); color: var(--text); border-top-left-radius: 4px;
      }
      .disa-msg-avatar {
        width: 28px; height: 28px;
        background: linear-gradient(135deg,var(--accent),var(--accent-d));
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-weight: 500; color: #fff; font-size: 11px;
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
        border: none; color: #fff;
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

      /* ── Artifacts ── */
      .disa-artifact {
        background: #FFFFFF;
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
      .disa-artifact-link:hover { background: #E2E7EE; }

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
      .disa-list-btn.primary { background: var(--accent); color: #fff; }
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

      ${alertState !== 'apagado' && alertCount > 0 ? `
        <button class="disa-alerts-badge${alertState === 'visto' ? ' visto' : ''}" id="dh-alerts-badge" onclick="disaShowAlerts()">
          <span class="adot"></span>
          ${alertState === 'visto' ? 'Avisos' : (alertCount + ' ' + (alertCount === 1 ? 'alerta' : 'alertas'))}
        </button>
      ` : ''}

      <!-- Stage -->
      <div class="disa-stage" id="dh-stage">

        <!-- Hero: saludo + DISA + cifras + lista (estado inicial) -->
        <div class="disa-hero" id="dh-hero">
          <h3 class="disa-greeting">${_saludo}, ${userName}</h3>
          <p class="disa-question">${fechaHoy} · esto es lo que pide tu atención hoy</p>

          <div class="disa-card-main">
            <div class="disa-card-icon"><i class="ti ti-sparkles"></i></div>
            <div>
              <p class="disa-card-title">DISA</p>
              <p class="disa-card-text">${disaProactivo}</p>
            </div>
          </div>

          <div class="disa-figs">
            <div class="disa-fig">
              <p class="disa-fig-label"><i class="ti ti-arrow-down-left" style="color:var(--accent)"></i>Ventas del mes</p>
              <p class="disa-fig-value">${sym}${kpis?.ventas ?? 0}</p>
            </div>
            <div class="disa-fig">
              <p class="disa-fig-label"><i class="ti ti-receipt" style="color:#BA7517"></i>Pedidos</p>
              <p class="disa-fig-value">${kpis?.pedidos ?? 0}</p>
            </div>
            <div class="disa-fig">
              <p class="disa-fig-label"><i class="ti ti-clock-hour-4" style="color:var(--text2)"></i>Pendientes</p>
              <p class="disa-fig-value">${kpis?.pendiente ?? 0}</p>
            </div>
            <div class="disa-fig">
              <p class="disa-fig-label"><i class="ti ti-alert-triangle" style="color:#DC2626"></i>Avisos</p>
              <p class="disa-fig-value">${alertState !== 'apagado' ? (alertCount ?? 0) : 0}</p>
            </div>
          </div>

          ${alertState !== 'apagado' && alertCount > 0 ? `
          <div class="disa-rows">
            <button class="disa-row" type="button" onclick="disaShowAlerts()">
              <span class="disa-row-label"><i class="ti ti-bell"></i>${alertCount} ${alertCount === 1 ? 'aviso pendiente' : 'avisos pendientes'}</span>
              <span class="disa-pill ${alertState === 'visto' ? 'aldia' : 'vencida'}">${alertState === 'visto' ? 'Visto' : 'Requiere atención'}</span>
            </button>
            <button class="disa-row" type="button" onclick="disaQuickSend('¿Qué requiere mi atención?')">
              <span class="disa-row-label"><i class="ti ti-list-check"></i>Ver detalle y preparar pagos</span>
              <span class="disa-pill porvencer">Por revisar</span>
            </button>
          </div>
          ` : ''}
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
          <button class="disa-card" onclick="disaQuickSend('¿Qué requiere mi atención?')">
            <div class="disa-card-head">
              <i class="ti ti-alert-triangle"></i>
              <div class="disa-card-title">¿Qué requiere mi atención?</div>
            </div>
            <div class="disa-card-desc">Stock bajo, clientes, oportunidades</div>
          </button>
          <button class="disa-card" onclick="disaQuickSend('Crea un producto nuevo')">
            <div class="disa-card-head">
              <i class="ti ti-plus"></i>
              <div class="disa-card-title">Crear nuevo producto</div>
            </div>
            <div class="disa-card-desc">Te guío paso a paso</div>
          </button>
          <button class="disa-card" onclick="disaQuickSend('Construir mi tienda web')">
            <div class="disa-card-head">
              <i class="ti ti-world"></i>
              <div class="disa-card-title">Construir mi tienda web</div>
            </div>
            <div class="disa-card-desc">Catálogo + checkout en minutos</div>
          </button>
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

      // Pulsar el badge (Paso d · resumen-primero): NO lanza una pregunta abierta a DISA. Pide
      // al motor de avisos un RESUMEN DE CONTEOS (determinista, sin modelo, sin ofrecer acciones)
      // y de paso marca los avisos como VISTOS (el badge pasa a gris). El DETALLE solo si el dueño
      // lo pide luego escribiendo ("enséñame los vencimientos") — esa sí es conversación normal.
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
          // El badge pasa a "visto" (gris) en cuanto se abre: el rojo vuelve solo si aparece algo nuevo.
          const badge = document.getElementById('dh-alerts-badge');
          if (badge) { badge.classList.add('visto'); badge.textContent = ''; const d = document.createElement('span'); d.className = 'adot'; badge.appendChild(d); badge.appendChild(document.createTextNode(' Avisos')); }
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
            + c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</button>';
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
      // La HOME (/admin) es el DASHBOARD del molde 1 (saludo + cifras + tarjeta DISA + lista +
      // input): aterriza SIEMPRE en el hero, no en el chat. La conversación a pantalla completa
      // vive en /admin/disa (DISEÑO.md §3.2). Por eso ya NO se auto-restaura el hilo aquí; al
      // escribir en el input, la home abre el chat en línea (disaSubmitHome). dhLoadActiveThread()
      // se conserva por si /admin/disa lo reutiliza, pero la home no lo invoca al cargar.
    </script>

    <div id="dh-chips-modal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center">
      <div style="background:#FFFFFF;border: 1px solid var(--border2);border-radius:12px;padding:24px;width:360px;max-width:90vw">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div style="color:var(--text);font-weight:500;font-size:14px">Accesos rápidos</div>
          <button onclick="document.getElementById('dh-chips-modal').style.display='none'" style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:18px;line-height:1;padding:0">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
          <input id="dh-chip-0" placeholder="Chip 1" style="background:#FFFFFF;border:1px solid var(--border2);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;width:100%;box-sizing:border-box">
          <input id="dh-chip-1" placeholder="Chip 2" style="background:#FFFFFF;border:1px solid var(--border2);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;width:100%;box-sizing:border-box">
          <input id="dh-chip-2" placeholder="Chip 3" style="background:#FFFFFF;border:1px solid var(--border2);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;width:100%;box-sizing:border-box">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('dh-chips-modal').style.display='none'" style="padding:7px 14px;border:1px solid var(--border2);border-radius:7px;background:none;color:var(--text2);cursor:pointer;font-size:13px;font-family:inherit">Cancelar</button>
          <button onclick="disaSaveChips()" style="padding:7px 14px;background:var(--accent);border:none;border-radius:7px;color:#fff;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit">Guardar</button>
        </div>
      </div>
    </div>
  `;
}
