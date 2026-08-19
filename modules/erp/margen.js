// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL MOTOR ÚNICO DE MARGEN — las dos cifras, siempre, y la base dicha en voz alta
//
// NACE DE UN FALLO PUBLICADO. Hasta hoy la plataforma enseñaba un porcentaje de margen en siete
// sitios y ninguno decía sobre qué se dividía. Peor: el número que se publicaba NO era ni "sobre la
// venta" ni "sobre el coste", era un tercero que no aparecía en pantalla. El caso real que lo
// destapó (cliente Ana Suárez Campos):
//
//     venta total ................ 4.018,00 €     ← lo que se enseñaba al lado
//     coste ...................... 1.577,00 €
//     «margen que deja» .......... 898,00 €
//     % publicado ................ 36,3 %
//     denominador de ese % ....... 2.475,19 €     ← NO SE ENSEÑABA EN NINGUNA PARTE
//
// Ni 898/4018 (22,3 %) ni 898/1577 (56,9 %) dan 36,3. El dueño no podía llegar a esa cifra con los
// números que tenía delante, y eso es lo que convierte un dato en una mentira: no que esté mal
// calculado, sino que no se pueda comprobar.
//
// ── LA BASE, Y POR QUÉ ES ESA ────────────────────────────────────────────────────────────────────
// Las dos cifras se calculan SOBRE EL MISMO CONJUNTO DE LÍNEAS: las que tienen coste conocido.
//
//     euros    = venta − coste
//     % venta  = euros / venta      («sobre lo que cobras»)
//     % coste  = euros / coste      («sobre lo que te costó»)
//
// donde `venta` es la base de las líneas CON coste, no la facturación total. Es la única pareja que
// cumple lo que el dueño espera: el importe en euros es EL MISMO en los dos modos. Si se dividiera
// entre la venta total, el numerador (un beneficio parcial) y el denominador (una venta entera)
// hablarían de conjuntos distintos y el margen saldría hundido por una venta que no participó.
//
// Lo que NO se hace es esconder la diferencia: `fuera` viaja siempre, y las pantallas están obligadas
// a decirlo. La regla de canon es corta: **ningún porcentaje de margen se enseña sin su base**.
//
// ── LO QUE ESTE MOTOR NO DECIDE ──────────────────────────────────────────────────────────────────
// No decide qué líneas tienen coste ni cuánto vale: eso ya lo resuelven `ventas-metrics.js` y
// `constructor-analitica.js`, y aquí se reciben ya sumadas. Este fichero solo hace la división, y la
// hace una sola vez para toda la plataforma.
//
// CONTABILIDAD y P&G NO PASAN POR EL AJUSTE DEL DUEÑO (R1): ahí manda «sobre la venta», elija lo que
// elija. Un resultado contable no cambia de definición porque a alguien le guste otro porcentaje.

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── LOS DOS MODOS ────────────────────────────────────────────────────────────────────────────────
// `clave` es lo que se guarda en settings. `sufijo` es lo que se pega al porcentaje EN PANTALLA:
// nunca va desnudo. `pregunta` es cómo se le ofrece al dueño en el alta (G4), con su ejemplo.
export const MODOS = {
  venta: {
    clave: 'venta',
    titulo: 'Sobre lo que cobras',
    sufijo: 'sobre lo que cobras',
    corto: 'sobre la venta',
    ejemplo: 'Gano un 28,6 %',
    ejemploPie: 'sobre lo que cobro',
    explica: 'De cada 100 € que facturas, esto es lo que te queda después de pagar lo que vendiste.',
  },
  coste: {
    clave: 'coste',
    titulo: 'Sobre lo que te costó',
    sufijo: 'sobre lo que te costó',
    corto: 'sobre el coste',
    ejemplo: 'Le meto un 40 %',
    ejemploPie: 'sobre lo que me costó',
    explica: 'Lo que le sumas al precio de compra para poner el precio de venta.',
  },
};
export const MODO_POR_DEFECTO = 'venta';
const CLAVE_MODO = 'margen_modo';
const CLAVE_ELEGIDO = 'margen_modo_elegido';   // marca que al dueño YA se le preguntó (G4)

// ── EL AJUSTE DE EMPRESA ─────────────────────────────────────────────────────────────────────────
// Ausencia = «sobre la venta». Esto NO es un detalle de implementación, es la regla R2: las empresas
// que ya existen no cambian ni un número porque se publique esta tarea. No hay migración que escriba
// nada; no hace falta, y una migración que reescribiera datos históricos estaría prohibida (R4).
export function modoDeEmpresa(db) {
  try {
    const v = db.prepare('SELECT value FROM settings WHERE key=?').get(CLAVE_MODO)?.value;
    return MODOS[v] ? v : MODO_POR_DEFECTO;
  } catch { return MODO_POR_DEFECTO; }
}

export function setModoDeEmpresa(db, modo) {
  if (!MODOS[modo]) throw new Error('Modo de margen desconocido: ' + modo);
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(CLAVE_MODO, modo);
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(CLAVE_ELEGIDO, '1');
  return modo;
}

// El dueño puede SALTAR el paso del alta (G4): saltar deja «sobre la venta» y no vuelve a preguntar.
// Saltar no escribe el modo —sigue siendo la ausencia, que ya vale `venta`—, solo apunta que se
// preguntó. Así «no contestó» y «contestó venta» quedan distinguibles si algún día importa.
export function marcarModoPreguntado(db) {
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(CLAVE_ELEGIDO, '1');
}

export function modoYaPreguntado(db) {
  try { return !!db.prepare('SELECT value FROM settings WHERE key=?').get(CLAVE_ELEGIDO)?.value; }
  catch { return false; }
}

// ── LA CUENTA ────────────────────────────────────────────────────────────────────────────────────
// Entra lo que ya sumaron los motores de ventas; sale SIEMPRE la misma forma, con las dos cifras.
//
//   venta ...... base (sin IVA) de las líneas CON coste conocido
//   coste ...... coste de esas mismas líneas
//   fuera ...... base de las líneas SIN coste conocido (no participa; se enseña aparte)
//
// `hay:false` cuando no hay ni una línea con coste: entonces los dos porcentajes son null y las
// pantallas pintan «—». Nunca 0 y nunca 100 % (R3): un 0 diría que no ganas nada y un 100 que es todo
// beneficio, y las dos cosas serían inventadas.
export function margen({ venta = 0, coste = 0, fuera = 0 } = {}) {
  const v = Number(venta) || 0, c = Number(coste) || 0, f = Number(fuera) || 0;
  const hay = v !== 0;
  const euros = hay ? r2(v - c) : null;
  return {
    hay,
    euros,
    // Sobre lo que cobras. Con `venta` a 0 no hay nada que dividir.
    pctVenta: hay ? r2((v - c) / v * 100) : null,
    // Sobre lo que te costó. Un coste de 0 EUROS no es «margen infinito»: es una división imposible,
    // y se dice con un «—» igual que la falta de dato. (Un coste registrado a 0 sí es un coste
    // conocido, por eso `hay` sigue siendo true y el % sobre la venta sale.)
    pctCoste: hay && c !== 0 ? r2((v - c) / c * 100) : null,
    venta: r2(v),
    coste: hay ? r2(c) : null,
    fuera: r2(f),
    // Cuánto de lo vendido se queda fuera del juicio. Es el número que faltaba en pantalla.
    fueraPct: (v + f) ? r2(f / (v + f) * 100) : 0,
    total: r2(v + f),
  };
}

// El titular: qué porcentaje manda en esta empresa y con qué frase se acompaña. `contable:true` lo
// fuerza a «sobre la venta» pase lo que pase — es la puerta de R1 para P&G y Contabilidad.
export function titularDe(m, modo = MODO_POR_DEFECTO, { contable = false } = {}) {
  const usa = contable ? 'venta' : (MODOS[modo] ? modo : MODO_POR_DEFECTO);
  const pct = usa === 'coste' ? m.pctCoste : m.pctVenta;
  return { modo: usa, pct, sufijo: MODOS[usa].sufijo, def: MODOS[usa] };
}

// ── CÓMO SE ESCRIBE ──────────────────────────────────────────────────────────────────────────────
// Formato español de verdad: 36,3 % — no "36.3%". `pct` a null → «—», que dice la verdad.
// `useGrouping:'always'` a propósito: por defecto el es-ES de Intl deja los números de cuatro cifras
// SIN punto de millar (1255,30) y eso descuadra visualmente una columna donde el de al lado sí lo
// lleva. En una tabla de dinero manda que todos se lean igual: 1.255,30 €.
const NUM = (n, d) => Number(n).toLocaleString('es-ES',
  { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });

export function fmtPct(pct) {
  if (pct == null) return '—';
  return NUM(pct, 1) + ' %';
}

export function fmtEur(n, sym = '€') {
  if (n == null) return '—';
  return NUM(n, 2) + ' ' + sym;
}

// LA FRASE QUE NUNCA VA DESNUDA. Todo sitio que enseñe un % de margen usa esto o pone el sufijo por
// su cuenta; el gate barre las pantallas buscando porcentajes huérfanos y cae si encuentra uno.
export function fmtMargen(m, modo = MODO_POR_DEFECTO, opts = {}) {
  const t = titularDe(m, modo, opts);
  if (t.pct == null) return '—';
  return fmtPct(t.pct) + ' ' + t.sufijo;
}

// El desglose completo, el que se enseña al abrir el detalle (G3): SIEMPRE los dos porcentajes, el
// importe en euros y la parte que queda fuera por no tener coste conocido.
export function desgloseDe(m, modo = MODO_POR_DEFECTO, sym = '€') {
  return {
    euros: m.euros, eurosTxt: fmtEur(m.euros, sym),
    venta: m.venta, ventaTxt: fmtEur(m.venta, sym),
    coste: m.coste, costeTxt: fmtEur(m.coste, sym),
    fuera: m.fuera, fueraTxt: fmtEur(m.fuera, sym), fueraPct: m.fueraPct,
    total: m.total, totalTxt: fmtEur(m.total, sym),
    modo: MODOS[modo] ? modo : MODO_POR_DEFECTO,
    sobreVenta: { pct: m.pctVenta, txt: fmtPct(m.pctVenta), sufijo: MODOS.venta.sufijo, titulo: MODOS.venta.titulo },
    sobreCoste: { pct: m.pctCoste, txt: fmtPct(m.pctCoste), sufijo: MODOS.coste.sufijo, titulo: MODOS.coste.titulo },
    // Por qué el % no sale de la venta total: la frase honesta, para pintarla tal cual.
    nota: m.fuera > 0
      ? 'Los porcentajes se calculan sobre ' + fmtEur(m.venta, sym) + ', que es la parte con coste conocido. '
        + 'Quedan fuera ' + fmtEur(m.fuera, sym) + ' (' + fmtPct(m.fueraPct) + ' de lo vendido) porque esas líneas no tienen coste.'
      : (m.hay ? 'Todo lo vendido tiene coste conocido: los porcentajes salen sobre el total.'
               : 'Ninguna línea tiene coste conocido todavía, así que no se puede calcular margen.'),
  };
}
