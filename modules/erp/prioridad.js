// ════════════════════════════════════════════════════════════════════════════
// DÓNDE TE ESPERA — priorización de avisos. Escalera · paso 5 (DISA predictiva) · PIEZA 5.
//
// QUÉ HACE: ordena los avisos que ya produjeron el vigía (PIEZA 1), la voz (PIEZA 2) y el dibujo
// (PIEZA 3), el de más impacto arriba, y le pone a cada uno su grupo de prioridad. NO inventa nada, no
// toca la detección ni las cifras: solo reordena y etiqueta lo que ya existe. Función pura, solo lectura.
//
// GRUPOS (fijos, del encargo):
//   · ALTA  — deuda vencida · pago próximo (vence ya) · desvío del plan.
//   · MEDIA — caída de facturación · caída de margen.
//   · BAJA  — cliente que se duerme.
//
// REGLA DE ORDEN EXACTA (la que implementa `priorizar`):
//   1) Por GRUPO: alta (0) → media (1) → baja (2).
//   2) Dentro del grupo: primero los que tienen IMPORTE en € (`moneda`), ordenados por ese importe de
//      MAYOR a MENOR; después los que no lo tienen (p. ej. cliente dormido, cuya `cifra` son días), por
//      URGENCIA (esos días) de mayor a menor. En la práctica cada grupo es homogéneo (alta/media todo €,
//      baja todo días), así que esto equivale a "por `cifra` de mayor a menor".
//   3) Desempate ESTABLE: se conserva el orden de entrada (el que ya daba el vigía dentro de su detector,
//      p. ej. pagos por vencimiento más próximo, deudas por antigüedad).

// PELDAÑO 8 · PIEZA 3 — los cuatro de AGENDA entran aquí:
//   · `hueco_perdido` en ALTA porque es dinero de mañana y CADUCA: pasado ese día, el hueco ya no se
//     puede llenar. Lo que caduca manda sobre lo que espera.
//   · los otros tres en MEDIA: son reales, pero un cliente que no vuelve sigue ahí mañana.
export const GRUPOS = {
  alta:  { etiqueta: 'Alta',  rank: 0, detectores: ['deuda_vencida', 'pago_vence_pronto', 'desvio_plan', 'hueco_perdido'] },
  media: { etiqueta: 'Media', rank: 1, detectores: ['caida_facturacion', 'caida_margen', 'fuera_de_ritmo', 'sin_proxima_cita', 'ausencias'] },
  baja:  { etiqueta: 'Baja',  rank: 2, detectores: ['cliente_dormido'] },
};

// LOS QUE SE ORDENAN POR PROXIMIDAD, no por tamaño. Los avisos de agenda NO llevan importe en euros
// (un hueco libre no vale un número hasta que alguien lo llena), así que ordenarlos por su `cifra`
// —horas libres, días sin venir— pondría arriba el día más vacío en vez del más cercano, y el aviso
// del hueco de dentro de tres días adelantaría al de mañana. Para estos manda la FECHA, ascendente:
// lo que antes ocurre, antes se atiende. Es la misma idea que ya usa `pago_vence_pronto` dentro de su
// detector (lo que antes vence, arriba), subida un nivel para que valga entre detectores.
export const POR_PROXIMIDAD = new Set(['hueco_perdido', 'fuera_de_ritmo', 'sin_proxima_cita', 'ausencias']);

const GRUPO_DE = {};
for (const [k, g] of Object.entries(GRUPOS)) for (const d of g.detectores) GRUPO_DE[d] = k;

// Grupo de un detector. Si un detector nuevo no estuviera mapeado, cae en 'media' (nunca se pierde ni
// se sube de rango sin querer): se ve, pero no adelanta a lo urgente conocido.
export function grupoDe(detector) { return GRUPO_DE[detector] || 'media'; }

const DIA = 86400000;
// Distancia EN DÍAS entre la fecha del aviso y hoy, en valor absoluto. Sirve igual para lo que está
// por venir (un hueco de mañana) que para lo que ya pasó (una visita de hace tres días): en los dos
// casos "más próximo" es lo que está más cerca de hoy. Sin `hoy` o sin fecha, devuelve null y el
// orden cae al criterio de siempre (nunca revienta ni reordena a ciegas).
function distanciaDias(fecha, hoy) {
  if (!fecha || !hoy) return null;
  const f = Date.parse(String(fecha).slice(0, 10) + 'T00:00:00Z');
  const h = Date.parse(String(hoy).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(f) || !Number.isFinite(h)) return null;
  return Math.abs(Math.round((f - h) / DIA));
}

// avisos → avisos ORDENADOS, cada uno con `prioridad: { grupo, etiqueta, rank }`. No muta la entrada.
// `hoy` (ISO) es opcional y solo lo usan los avisos de agenda, para ordenarse por proximidad.
export function priorizar(avisos, hoy = null) {
  const nivel = a => (a.moneda ? 0 : (POR_PROXIMIDAD.has(a.detector) ? 1 : 2));
  return (avisos || [])
    .map((a, i) => ({ a, i, g: grupoDe(a.detector) }))
    .sort((x, y) => {
      const r = GRUPOS[x.g].rank - GRUPOS[y.g].rank;
      if (r) return r;                                  // 1) grupo
      // 2) dentro del grupo, tres niveles: primero lo que tiene IMPORTE, después lo de AGENDA (que no
      //    lo tiene y se ordena por cercanía), y al final el resto.
      const nx = nivel(x.a), ny = nivel(y.a);
      if (nx !== ny) return nx - ny;
      if (nx === 1) {                                   // 2b) agenda: lo más próximo a hoy, arriba
        const dx = distanciaDias(x.a.fecha, hoy), dy = distanciaDias(y.a.fecha, hoy);
        if (dx != null && dy != null && dx !== dy) return dx - dy;
        if (dx == null && dy == null) { /* sin hoy: cae al criterio de cifra, abajo */ }
        else if (dx == null || dy == null) return dx == null ? 1 : -1;
      }
      const cx = Number(x.a.cifra) || 0, cy = Number(y.a.cifra) || 0;
      if (cx !== cy) return cy - cx;                    // 2c) por importe/urgencia, de mayor a menor
      return x.i - y.i;                                 // 3) desempate estable
    })
    .map(({ a, g }) => ({ ...a, prioridad: { grupo: g, etiqueta: GRUPOS[g].etiqueta, rank: GRUPOS[g].rank } }));
}
