/* ════════════════════════════════════════════════════════════════════════════
 * GRÁFICO DEL CONSTRUCTOR — render compartido. Escalera · paso 5 · PIEZA 3 (el dibujo).
 *
 * Este es EL render del constructor de analíticas alojado UNA sola vez, para reutilizarlo sin
 * duplicar el motor. Es la MISMA config de Chart.js que "Construye tu gráfico" (analytics.js ·
 * dibujar()): mismos tipos (barras/líneas/tarta), mismos colores, MISMO trato de los null (un hueco,
 * no un 0), mismo formateo €/% en tooltip y ejes. No hay motor de dibujo nuevo: Chart.js es el mismo
 * (mismo vendor local) y los datos vienen del MISMO endpoint /api/erp/analytics/constructor/cruzar.
 *
 * Uso: GraficoConstructor.dibujarCruce(canvas, { filas, medida, meta, grafico }, { sym, prev }).
 *   · filas  — las filas que devolvió `cruzar` (cada una { clave, [medida]: valor|null }).
 *   · medida — la clave de la medida a pintar (p. ej. 'base', 'beneficio', 'pendiente').
 *   · meta   — { etiqueta, dinero, pct } de esa medida (del catálogo del constructor).
 *   · grafico— 'barras' | 'lineas' | 'tarta' (tabla se resuelve fuera).
 *   · sym    — símbolo de moneda; prev — instancia previa de Chart a destruir (si la hay).
 * Devuelve la instancia de Chart creada (para poder destruirla luego). */
(function () {
  var PALETA = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];

  function dibujarCruce(canvas, datos, opts) {
    opts = opts || {};
    var sym = opts.sym || '';
    var filas = (datos && datos.filas) || [];
    var medida = datos && datos.medida;
    var meta = (datos && datos.meta) || {};
    var grafico = datos && datos.grafico;
    if (opts.prev) { try { opts.prev.destroy(); } catch (e) {} }

    var eur = function (v) { return sym + Number(v).toFixed(2); };
    // MISMO formateo que el constructor: null es "—" (no un 0), dinero con símbolo, pct con un decimal.
    var fmt = function (v) { return v == null ? '—' : (meta.dinero ? eur(v) : (meta.pct ? Number(v).toFixed(1) + '%' : Number(v))); };

    var tipo = grafico === 'lineas' ? 'line' : grafico === 'tarta' ? 'pie' : 'bar';
    var valores = filas.map(function (f) { return f[medida]; });   // los null NO se convierten en 0
    return new Chart(canvas.getContext('2d'), {
      type: tipo,
      data: {
        labels: filas.map(function (f) { return String(f.clave).substring(0, 22); }),
        datasets: [{
          label: meta.etiqueta || medida,
          data: valores,
          backgroundColor: tipo === 'pie' ? PALETA : 'rgba(14,165,233,.6)',
          borderColor: tipo === 'pie' ? '#0b1220' : '#0ea5e9',
          borderWidth: 1,
          borderRadius: tipo === 'bar' ? 4 : 0,
          tension: tipo === 'line' ? 0.25 : 0,
          spanGaps: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: tipo === 'pie' },
          tooltip: { callbacks: { label: function (x) { return ' ' + fmt(x.parsed.y != null ? x.parsed.y : x.parsed); } } }
        },
        scales: tipo === 'pie' ? {} : {
          y: { beginAtZero: true, ticks: { callback: function (v) { return meta.dinero ? sym + v : (meta.pct ? v + '%' : v); } } }
        }
      }
    });
  }

  window.GraficoConstructor = { PALETA: PALETA, dibujarCruce: dibujarCruce };
})();
