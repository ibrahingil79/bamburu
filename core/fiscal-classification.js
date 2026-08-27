// Fuente única de verdad para la naturaleza fiscal de una línea.
// La tasa (también 0 %) es un dato distinto del tratamiento jurídico.
export const FISCAL_TREATMENTS = Object.freeze(['taxable', 'exempt', 'non_subject', 'pending']);
export const EXEMPTION_CODES = Object.freeze(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
export const NON_SUBJECT_CODES = Object.freeze(['N1', 'N2']);

export const FISCAL_LABELS = Object.freeze({
  taxable: 'Sujeta y no exenta', exempt: 'Exenta', non_subject: 'No sujeta', pending: 'Pendiente de clasificación',
  E1: 'Exenta por el artículo 20 de la Ley 37/1992', E2: 'Exenta por el artículo 21 de la Ley 37/1992',
  E3: 'Exenta por el artículo 22 de la Ley 37/1992', E4: 'Exenta por los artículos 23 y 24 de la Ley 37/1992',
  E5: 'Exenta por el artículo 25 de la Ley 37/1992', E6: 'Exenta por otras causas',
  N1: 'Operación no sujeta por los artículos 7 y 14 de la Ley 37/1992 u otras causas',
  N2: 'Operación no sujeta por reglas de localización',
});

const clean = v => v == null || String(v).trim() === '' ? null : String(v).trim().toUpperCase();

export function validateFiscalClassification(input, { allowPending = false } = {}) {
  const treatment = String(input?.fiscal_treatment || '').trim().toLowerCase() || 'pending';
  const exemptionCode = clean(input?.fiscal_exemption_code);
  const nonSubjectCode = clean(input?.fiscal_non_subject_code);
  const reverseCharge = input?.fiscal_reverse_charge === true || input?.fiscal_reverse_charge === 1 || input?.fiscal_reverse_charge === '1';
  const rate = Number(input?.tax_rate);
  if (!FISCAL_TREATMENTS.includes(treatment)) throw new Error('Clasificación fiscal desconocida');
  if (treatment === 'pending') {
    if (!allowPending) throw new Error('Falta confirmar la clasificación fiscal de una línea antes de emitir');
    return { fiscal_treatment: treatment, fiscal_exemption_code: null, fiscal_non_subject_code: null, fiscal_reverse_charge: 0, fiscal_legal_text: null, tax_rate: Number.isFinite(rate) ? rate : 0 };
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Tipo impositivo inválido');
  if (treatment === 'taxable' && (exemptionCode || nonSubjectCode)) throw new Error('Una operación sujeta no puede tener causa de exención o no sujeción');
  if (treatment === 'exempt' && !EXEMPTION_CODES.includes(exemptionCode)) throw new Error('Selecciona una causa de exención E1–E6');
  if (treatment === 'non_subject' && !NON_SUBJECT_CODES.includes(nonSubjectCode)) throw new Error('Selecciona una causa de no sujeción N1 o N2');
  if (treatment !== 'taxable' && (rate !== 0 || reverseCharge)) throw new Error('Una operación exenta o no sujeta debe tener cuota cero y no puede marcar inversión del sujeto pasivo');
  const code = treatment === 'exempt' ? exemptionCode : treatment === 'non_subject' ? nonSubjectCode : null;
  return {
    fiscal_treatment: treatment,
    fiscal_exemption_code: treatment === 'exempt' ? exemptionCode : null,
    fiscal_non_subject_code: treatment === 'non_subject' ? nonSubjectCode : null,
    fiscal_reverse_charge: treatment === 'taxable' && reverseCharge ? 1 : 0,
    fiscal_legal_text: code ? FISCAL_LABELS[code] : (reverseCharge ? 'Inversión del sujeto pasivo' : null),
    tax_rate: rate,
  };
}

export function fiscalFromProduct(product, opts = {}) {
  return validateFiscalClassification({ ...product, tax_rate: product?.tax_rate }, opts);
}

export function verifactuClassification(line) {
  const f = validateFiscalClassification(line);
  if (f.fiscal_treatment === 'exempt') return { operacionExenta: f.fiscal_exemption_code };
  if (f.fiscal_treatment === 'non_subject') return { calificacionOperacion: f.fiscal_non_subject_code };
  return { calificacionOperacion: f.fiscal_reverse_charge ? 'S2' : 'S1' };
}

export function fiscalGroupKey(line) {
  const f = validateFiscalClassification(line);
  return [f.fiscal_treatment, f.fiscal_exemption_code || '', f.fiscal_non_subject_code || '', f.fiscal_reverse_charge, f.tax_rate].join('|');
}
