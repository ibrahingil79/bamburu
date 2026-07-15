// CALENDARIO FISCAL — el "cuándo" de las declaraciones. Lógica PURA (no toca la BD): dado el perfil
// fiscal de un tenant (qué presenta) y una fecha, dice qué modelos vencen pronto y cuándo, en llano.
//
// Bamburu PREPARA, NUNCA presenta (CANON §0-ter). Este módulo solo AVISA de la fecha; presentar es
// del dueño, en la sede de la AEAT.
//
// LAS FECHAS SON APROXIMADAS, A PROPÓSITO. Los plazos de la AEAT se mueven cada año: un 20 que cae en
// sábado corre al lunes siguiente, y hay años con festivos de por medio. Por eso NUNCA se presenta la
// fecha como dato legal inamovible — se da la fecha NOMINAL del plazo con un margen, y cada propuesta
// lleva la línea de seguridad `NOTA_AEAT` ("confirma la fecha exacta en la sede de la AEAT"). Preferir
// una regla en código a una tabla de fechas a mano: una tabla se queda vieja en silencio; una regla
// que se sabe aproximada, no engaña.

// Días entre dos fechas YYYY-MM-DD (a - b), en UTC. Mismo cálculo que propuestas.js/cobros.js/pagos.js.
const diasEntre = (a, b) => Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

// Margen de disparo (días naturales ANTES del fin de plazo nominal) y gracia posterior. Se avisa
// cuando faltan `MARGEN` días o menos; la gracia mantiene el aviso vivo unos días PASADA la fecha
// nominal, porque el plazo real suele correrse HACIA DELANTE (fin de semana/festivo) y no queremos
// dejar de recordar justo antes del vencimiento de verdad.
export const MARGEN_DIAS = 10;
export const GRACIA_DIAS = 3;

// La línea de seguridad que acompaña SIEMPRE a la fecha. La fecha es orientativa; la de verdad, la AEAT.
export const NOTA_AEAT = 'Fecha aproximada: confirma el día exacto en la sede electrónica de la AEAT (puede variar por fines de semana o festivos).';
// Informativa: domiciliar el pago cierra unos días antes del fin de plazo. Solo texto, sin lógica aparte.
export const NOTA_DOMICILIACION = 'Si domicilias el pago, el plazo para domiciliar suele cerrarse unos 5 días antes del fin del plazo.';

// EL CATÁLOGO de modelos que este calendario conoce, con su nombre EN LLANO (nada de "presenta el
// 303": "IVA"), su periodicidad y si hoy sabemos calcular su importe. 303 y 130 lo tienen (motor de
// contabilidad, Pieza 4); el resto AÚN no —se avisa de la fecha, nunca se inventa una cifra.
export const MODELOS = {
  '303': { nombre: 'IVA',                                            periodicidad: 'trimestral', tieneImporte: true  },
  '130': { nombre: 'IRPF (pago fraccionado)',                        periodicidad: 'trimestral', tieneImporte: true  },
  '111': { nombre: 'Retenciones de trabajadores y profesionales',    periodicidad: 'trimestral', tieneImporte: false },
  '115': { nombre: 'Retenciones de alquiler',                        periodicidad: 'trimestral', tieneImporte: false },
  '390': { nombre: 'Resumen anual de IVA',                           periodicidad: 'anual',      tieneImporte: false },
  '190': { nombre: 'Resumen anual de retenciones (trabajo)',         periodicidad: 'anual',      tieneImporte: false },
  '180': { nombre: 'Resumen anual de retenciones (alquiler)',        periodicidad: 'anual',      tieneImporte: false },
};

// QUÉ MODELOS PRESENTA ESTE TENANT, derivados de lo que DECLARÓ en su ficha (fiscal_profile). Esta es
// la ÚNICA fuente de verdad del "qué": nunca se asume 303+130 para todos. Un flag apagado = ese modelo
// no se propone (ni aunque haya actividad que lo alimentaría). `situacion_especial` NO deriva nada por
// su cuenta: es justo el caso ambiguo (módulos, recargo de equivalencia, otro régimen) que no se asume.
export function modelosDeclarados(profile) {
  if (!profile) return [];
  const m = [];
  if (profile.presenta_iva)               m.push('303', '390');
  if (profile.presenta_irpf_directa)      m.push('130');
  if (profile.tiene_retenciones_trabajo)  m.push('111', '190');
  if (profile.tiene_retenciones_alquiler) m.push('115', '180');
  return m;
}

// Trimestre → número (1..4) o null si es anual.
export function trimestreDe(period) {
  const m = /^([1-4])T$/.exec(String(period || ''));
  return m ? Number(m[1]) : null;
}

// FECHA NOMINAL de fin de plazo para (modelo, año, periodo). Aproximada (ver cabecera).
//   · Trimestral 1T/2T/3T: día 20 del mes siguiente al cierre del trimestre.
//   · Trimestral 4T: enero del año siguiente — el 30 para 303/130, el 20 para 111/115.
//   · Anual: enero del año siguiente — 390 el 30; 190/180 el 31.
export function vencimientoNominal(model, year, period) {
  const info = MODELOS[model];
  if (!info) return null;
  if (info.periodicidad === 'anual') {
    return model === '390' ? `${year + 1}-01-30` : `${year + 1}-01-31`;
  }
  const q = trimestreDe(period);
  if (q === 1) return `${year}-04-20`;
  if (q === 2) return `${year}-07-20`;
  if (q === 3) return `${year}-10-20`;
  if (q === 4) return (model === '303' || model === '130') ? `${year + 1}-01-30` : `${year + 1}-01-20`;
  return null;
}

// Ordinal en llano para el trimestre.
const ORDINAL = { 1: '1er', 2: '2º', 3: '3er', 4: '4º' };

// Etiqueta EN LLANO de un vencimiento: "IVA del 2º trimestre de 2026", "Resumen anual de IVA de 2026".
// El dueño no ve el número de modelo si no quiere; ve qué es y de cuándo.
export function etiquetaVencimiento(model, year, period) {
  const info = MODELOS[model];
  const nombre = info ? info.nombre : ('Modelo ' + model);
  if (!info || info.periodicidad === 'anual') return `${nombre} de ${year}`;
  const q = trimestreDe(period);
  return `${nombre} del ${ORDINAL[q] || (q + 'º')} trimestre de ${year}`;
}

// LOS VENCIMIENTOS PRÓXIMOS de este tenant: para cada modelo que declara, los periodos cuyo fin de
// plazo cae dentro de la ventana de disparo [hoy−gracia, hoy+margen]. Devuelve, ordenado por cercanía:
//   { model, year, period, deadline (YYYY-MM-DD), dias (deadline−hoy) }
//
// Se generan los periodos candidatos alrededor de `today` (los cuatro trimestres del año en curso +
// el 4T del año anterior, cuyo plazo cae en enero; y los anuales del año anterior y el actual) y se
// filtra por la ventana. La idempotencia REAL (no proponer dos veces el mismo periodo) la garantiza
// el índice único de disa_proposals, no este filtro: aquí solo se decide QUÉ está "próximo".
export function vencimientosProximos(profile, today, opts = {}) {
  const margen = opts.margen != null ? opts.margen : MARGEN_DIAS;
  const gracia = opts.gracia != null ? opts.gracia : GRACIA_DIAS;
  const y = Number(String(today).slice(0, 4));
  const out = [];

  for (const model of modelosDeclarados(profile)) {
    const info = MODELOS[model];
    if (info.periodicidad === 'trimestral') {
      const cands = [
        { year: y - 1, period: '4T' },   // su plazo cae en enero de este año
        { year: y, period: '1T' }, { year: y, period: '2T' }, { year: y, period: '3T' }, { year: y, period: '4T' },
      ];
      for (const { year, period } of cands) out.push({ model, year, period, deadline: vencimientoNominal(model, year, period) });
    } else {
      for (const year of [y - 1, y]) out.push({ model, year, period: 'anual', deadline: vencimientoNominal(model, year, 'anual') });
    }
  }

  return out
    .map(v => ({ ...v, dias: diasEntre(v.deadline, today) }))
    .filter(v => v.dias <= margen && v.dias >= -gracia)
    .sort((a, b) => a.dias - b.dias);
}
