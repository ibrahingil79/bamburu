// Países para Facturae: el XSD exige `CountryCode` en ISO 3166-1 **alpha-3** (`ESP`), y Bamburu
// guarda alpha-2 (`ES`) o texto libre. Datos puros, sin lógica de negocio.
//
// `ResidenceTypeCode` sale de aquí: "R" residente (España) · "U" residente en la UE · "E" extranjero.
// Y el NIF solo se antepone con las dos letras del país **en operaciones intracomunitarias** (es
// decir, cuando ResidenceTypeCode = "U"). Fuente: esquema oficial castellano v3.2.x, §2.1.1.3 y
// §2.2.1.3 — «precedidas de las dos letras del país en el caso de operaciones intracomunitarias».

// alpha-2 → alpha-3. UE completa + los destinos habituales de un autónomo español.
export const ALPHA2_A_ALPHA3 = {
  // Unión Europea (27)
  AT: 'AUT', BE: 'BEL', BG: 'BGR', HR: 'HRV', CY: 'CYP', CZ: 'CZE', DK: 'DNK', EE: 'EST',
  FI: 'FIN', FR: 'FRA', DE: 'DEU', GR: 'GRC', HU: 'HUN', IE: 'IRL', IT: 'ITA', LV: 'LVA',
  LT: 'LTU', LU: 'LUX', MT: 'MLT', NL: 'NLD', PL: 'POL', PT: 'PRT', RO: 'ROU', SK: 'SVK',
  SI: 'SVN', ES: 'ESP', SE: 'SWE',
  // Fuera de la UE
  AD: 'AND', AR: 'ARG', AU: 'AUS', BO: 'BOL', BR: 'BRA', CA: 'CAN', CH: 'CHE', CL: 'CHL',
  CN: 'CHN', CO: 'COL', CR: 'CRI', CU: 'CUB', DO: 'DOM', EC: 'ECU', GB: 'GBR', GQ: 'GNQ',
  GT: 'GTM', HN: 'HND', IN: 'IND', IS: 'ISL', JP: 'JPN', MA: 'MAR', MC: 'MCO', MX: 'MEX',
  NI: 'NIC', NO: 'NOR', NZ: 'NZL', PA: 'PAN', PE: 'PER', PY: 'PRY', RU: 'RUS', SV: 'SLV',
  TR: 'TUR', US: 'USA', UY: 'URY', VE: 'VEN', ZA: 'ZAF',
};

// Estados miembros de la UE (alpha-2). España aparte: es "R", no "U".
export const UE_ALPHA2 = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'SE',
]);

// Nombres que la gente escribe a mano en el campo País (hoy es texto libre).
const NOMBRES = {
  'ESPAÑA': 'ES', 'ESPANA': 'ES', 'SPAIN': 'ES',
  'FRANCIA': 'FR', 'FRANCE': 'FR', 'PORTUGAL': 'PT', 'ITALIA': 'IT', 'ITALY': 'IT',
  'ALEMANIA': 'DE', 'GERMANY': 'DE', 'REINO UNIDO': 'GB', 'ANDORRA': 'AD',
  'PAISES BAJOS': 'NL', 'PAÍSES BAJOS': 'NL', 'BELGICA': 'BE', 'BÉLGICA': 'BE',
  'MEXICO': 'MX', 'MÉXICO': 'MX', 'ARGENTINA': 'AR', 'COLOMBIA': 'CO', 'MARRUECOS': 'MA',
  'ESTADOS UNIDOS': 'US', 'EEUU': 'US', 'USA': 'US',
};

const ALPHA3_VALIDOS = new Set(Object.values(ALPHA2_A_ALPHA3));

/**
 * Normaliza lo que haya en `country` a alpha-2. Devuelve null si no se reconoce: preferimos
 * BLOQUEAR la exportación a inventarnos el país en un documento con valor legal.
 * Cadena vacía → 'ES' (CANON: el producto es de España; es el único default defendible).
 */
export function normalizarPais(valor) {
  const v = String(valor ?? '').trim().toUpperCase();
  if (!v) return 'ES';
  if (v.length === 2 && ALPHA2_A_ALPHA3[v]) return v;
  if (v.length === 3 && ALPHA3_VALIDOS.has(v)) {
    return Object.keys(ALPHA2_A_ALPHA3).find(k => ALPHA2_A_ALPHA3[k] === v) || null;
  }
  return NOMBRES[v] || null;
}

/** alpha-2 → alpha-3 para `CountryCode`. */
export function alpha3(alpha2) {
  return ALPHA2_A_ALPHA3[alpha2] || null;
}

/** ResidenceTypeCode: R residente (ES) · U residente en la UE · E extranjero. */
export function tipoResidencia(alpha2) {
  if (alpha2 === 'ES') return 'R';
  return UE_ALPHA2.has(alpha2) ? 'U' : 'E';
}
