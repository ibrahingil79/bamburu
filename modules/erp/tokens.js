// ── LOS TOKENS DE LA APLICACIÓN (color, tipo, espaciado) ─────────────────────────────────────────
// Movidos aquí desde `modules/erp/layout.js` el 31 ago 2026, SIN tocar una línea. El motivo no es
// de orden: `core/auth.js` necesita la página de error de `pagina-error.js` para el 403 de
// `requirePerm`, y `layout.js` cierra un ciclo con `core/auth.js` por nueve rutas. Este fichero es
// HOJA a propósito — NO IMPORTA NADA, y no puede empezar a hacerlo — para que ese ciclo no pueda
// volver por aquí. `layout.js` lo reexporta, así que ningún importador de antes cambia de ruta.

export const ROOT_TOKENS = `
    :root{
      /* Tokens EXACTOS de la dirección UX del 2026-07-06 (DISEÑO.md §0-bis + §2).
         FUENTE ÚNICA de color/tipo/espaciado de la app. Cambiar aquí = toda la app.
         SUSTITUCIÓN 1 (chrome claro) y SUSTITUCIÓN 2 (acento azul) aplicadas aquí. */
      --bg:        #F5F6F8;   /* fondo de aplicación (claro) */
      --bg2:       #FFFFFF;   /* superficies / tarjetas / chrome / paneles */
      --bg3:       #F1F3F5;   /* subsuperficie: search, hover, sutil */
      --card:      #FFFFFF;   /* alias de superficie de panel (= --bg2). Lo usan los paneles de
                                 sugerencias del buscador de línea (var(--card,#1e1e1e)); sin definir
                                 caían en el fallback oscuro #1e1e1e → nombre ilegible. */
      --border:    #EEEFF2;   /* separadores (DISEÑO §2.4) */
      --border2:   #E4E6EA;   /* bordes (DISEÑO §2.4) */
      --border-disa: #D6DCE4; /* borde de la tarjeta de DISA (DISEÑO §2.2) */
      --text:      #14161B;   /* texto principal (DISEÑO §2.3) */
      --text2:     #5C616B;   /* texto secundario (DISEÑO §2.3) */
      --text3:     #8A8F99;   /* texto tenue (DISEÑO §2.3) */
      --body-tx:   #3A3F48;   /* texto cuerpo (entre principal y secundario) */
      --accent:    #2F6BFF;   /* AZUL — acción principal y enlaces (DISEÑO §2.2, SUSTITUCIÓN 2) */
      --accent-d:  #2456D6;   /* azul fuerte / hover / activo */
      --accent-soft:#E4EDFF;  /* fondo azul claro: item activo / avisos de DISA / chips */
      /* Acento morado SEMÁNTICO (IRPF/retención + stock reservado). No es acento de marca: es el
         tercer acento de dato que ya usaban documentos e inventario (U1, 2026-07-05). */
      --accent-purple: #9333EA;  --accent-purple-s: #F0EBFB;
      --grp:       #8A8F99;   /* título de grupo de menú (= texto tenue) */
      --muted:     #5C616B;   /* alias heredado (= secundario) */
      --p:         #2F6BFF;   /* alias heredado (= acento azul) */
      /* Alias de compatibilidad: el código heredado usa var(--teal*) → ahora ES el azul de marca */
      --teal:      #2F6BFF;
      --teal-d:    #2456D6;
      --teal-soft: rgba(47,107,255,0.10);
      --teal-glow: rgba(47,107,255,0.20);
      /* Estados — chips (DISEÑO §2.5). fondo (-s) / texto */
      --danger:    #C0392B;  --danger-s:  #FBE3E3;   /* Vencida */
      --warn:      #8A5B00;  --warn-s:    #FBEED0;   /* Pendiente */
      --ok:        #157F3B;  --ok-s:      #E4F6EA;   /* Pagada */
      --info:      #2451C7;  --info-s:    #E4EDFF;   /* Enviada (azul) */
      /* Chrome CLARO (barra superior + menú lateral). Dirección UX 2026-07-06 (SUSTITUCIÓN 1):
         sidebar y superficies claras; el azul es el acento del item activo, no el fondo. */
      --chrome:        #FFFFFF;   /* fondo del chrome (rail + topbar) — BLANCO */
      --chrome-tx:     #5C616B;   /* texto de menú inactivo */
      --chrome-tx-on:  #2F6BFF;   /* texto/icono de menú activo (azul) */
      --chrome-ic:     #8A8F99;   /* icono de menú inactivo */
      --chrome-grp:    #8A8F99;   /* título de grupo de menú */
      --chrome-active: #E4EDFF;   /* fondo del item activo (azul claro) */
      --chrome-div:    #EEEFF2;   /* divisor / borde del chrome */
      --brand:         #2F6BFF;   /* marca (sparkles) — azul */
      --sw:        62px;
      --sw-exp:    176px;
      --radius:    9px;
      --radius-lg: 12px;
      /* ── Escala de ESPACIADO (U1). Fuente única; valores calcados de los ya usados para que
         aplicarla sea 1:1 (no recoloca nada). El espaciado inline estructural por-vista se
         conserva mientras no haya un paso equivalente. ── */
      --space-1:  .25rem;   /* 4px  */
      --space-2:  .5rem;    /* 8px  */
      --space-3:  .75rem;   /* 12px */
      --space-4:  1rem;     /* 16px */
      --space-5:  1.25rem;  /* 20px */
      --space-6:  1.5rem;   /* 24px */
      /* ── Escala de TIPOGRAFÍA (U1). Inter en body; tamaños/pesos calcados de los usados. ── */
      --fs-xs:    .72rem;   --fs-sm:  .82rem;   --fs-md:  .88rem;
      --fs-base:  14px;     --fs-lg:  1.05rem;  --fs-xl:  1.7rem;
      --fw-normal: 400;     --fw-medium: 500;   --fw-semibold: 600;
    }`;
