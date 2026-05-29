// Fuente única de las BANDAS de IVA por país (P1+P2, refinamiento).
//
// El producto guarda su BANDA (code, ej. 'general') y el % se resuelve desde aquí.
// Las bandas NO están quemadas en la pantalla del producto: añadir un país = añadir
// su entrada en VAT_BANDS, sin tocar el producto. Hoy solo ES está poblado.
//
// Cada banda: { code, label, rate, example }. 'rate' es el % de IVA (0 = exento).

const VAT_BANDS = {
  ES: [
    { code: 'general',       label: 'General',          rate: 21, example: 'Bienes y servicios habituales' },
    { code: 'reducido',      label: 'Reducido',         rate: 10, example: 'Hostelería, transporte, ciertos alimentos' },
    { code: 'superreducido', label: 'Superreducido',    rate: 4,  example: 'Pan, leche, libros, medicamentos' },
    { code: 'exento',        label: 'Exento (sin IVA)', rate: 0,  example: 'Formación, sanidad, seguros' },
  ],
};

export const DEFAULT_BAND = 'general';

// Bandas del país. Si el país aún no tiene tabla propia, devuelve una sola "General"
// con el tipo por defecto (fallbackRate, normalmente el de country_configs) para no
// romper ese tenant.
export function getVatBands(country, fallbackRate = 21) {
  const code = (country || 'ES').toUpperCase();
  if (VAT_BANDS[code]) return VAT_BANDS[code];
  return [{ code: 'general', label: 'General', rate: Number(fallbackRate) || 0, example: '' }];
}

// Resuelve { band, rate } para un país + banda elegida. Si la banda no existe en ese
// país, cae a la banda por defecto (general / primera). Es la fuente de verdad del %:
// el servidor nunca confía en un número enviado por el cliente.
export function resolveVatRate(country, bandCode, fallbackRate = 21) {
  const bands = getVatBands(country, fallbackRate);
  const found = bands.find(b => b.code === bandCode);
  if (found) return { band: found.code, rate: found.rate };
  const def = bands.find(b => b.code === DEFAULT_BAND) || bands[0];
  return { band: def.code, rate: def.rate };
}
