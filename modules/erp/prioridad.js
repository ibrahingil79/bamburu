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

export const GRUPOS = {
  alta:  { etiqueta: 'Alta',  rank: 0, detectores: ['deuda_vencida', 'pago_vence_pronto', 'desvio_plan'] },
  media: { etiqueta: 'Media', rank: 1, detectores: ['caida_facturacion', 'caida_margen'] },
  baja:  { etiqueta: 'Baja',  rank: 2, detectores: ['cliente_dormido'] },
};

const GRUPO_DE = {};
for (const [k, g] of Object.entries(GRUPOS)) for (const d of g.detectores) GRUPO_DE[d] = k;

// Grupo de un detector. Si un detector nuevo no estuviera mapeado, cae en 'media' (nunca se pierde ni
// se sube de rango sin querer): se ve, pero no adelanta a lo urgente conocido.
export function grupoDe(detector) { return GRUPO_DE[detector] || 'media'; }

// avisos → avisos ORDENADOS, cada uno con `prioridad: { grupo, etiqueta, rank }`. No muta la entrada.
export function priorizar(avisos) {
  return (avisos || [])
    .map((a, i) => ({ a, i, g: grupoDe(a.detector) }))
    .sort((x, y) => {
      const r = GRUPOS[x.g].rank - GRUPOS[y.g].rank;
      if (r) return r;                                  // 1) grupo
      const mx = x.a.moneda ? 1 : 0, my = y.a.moneda ? 1 : 0;
      if (mx !== my) return my - mx;                    // 2a) los que tienen € van primero
      const cx = Number(x.a.cifra) || 0, cy = Number(y.a.cifra) || 0;
      if (cx !== cy) return cy - cx;                    // 2b) por importe/urgencia, de mayor a menor
      return x.i - y.i;                                 // 3) desempate estable
    })
    .map(({ a, g }) => ({ ...a, prioridad: { grupo: g, etiqueta: GRUPOS[g].etiqueta, rank: GRUPOS[g].rank } }));
}
