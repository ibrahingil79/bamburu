// Prefijos telefónicos internacionales (E.164) para el selector de teléfono del Perfil.
// Lista de datos pura: sin lógica, sin dependencias. España primero por ser el mercado del
// producto (CANON: autónomos de España); el resto en orden alfabético por nombre.
//
// `code` es el prefijo que se guarda en admin_users.pais_telefono. NO es único: varios países
// comparten prefijo (+1 EEUU/Canadá, +7 Rusia/Kazajistán). Por eso las <option> se identifican
// por `iso`, y el prefijo es solo el valor que viaja a la BD.

export const PAISES_TELEFONO = [
  { iso: 'ES', code: '+34',  nombre: 'España' },

  { iso: 'DE', code: '+49',  nombre: 'Alemania' },
  { iso: 'AD', code: '+376', nombre: 'Andorra' },
  { iso: 'AR', code: '+54',  nombre: 'Argentina' },
  { iso: 'AT', code: '+43',  nombre: 'Austria' },
  { iso: 'BE', code: '+32',  nombre: 'Bélgica' },
  { iso: 'BO', code: '+591', nombre: 'Bolivia' },
  { iso: 'BR', code: '+55',  nombre: 'Brasil' },
  { iso: 'BG', code: '+359', nombre: 'Bulgaria' },
  { iso: 'CA', code: '+1',   nombre: 'Canadá' },
  { iso: 'CL', code: '+56',  nombre: 'Chile' },
  { iso: 'CN', code: '+86',  nombre: 'China' },
  { iso: 'CO', code: '+57',  nombre: 'Colombia' },
  { iso: 'KR', code: '+82',  nombre: 'Corea del Sur' },
  { iso: 'CR', code: '+506', nombre: 'Costa Rica' },
  { iso: 'HR', code: '+385', nombre: 'Croacia' },
  { iso: 'CU', code: '+53',  nombre: 'Cuba' },
  { iso: 'DK', code: '+45',  nombre: 'Dinamarca' },
  { iso: 'EC', code: '+593', nombre: 'Ecuador' },
  { iso: 'SV', code: '+503', nombre: 'El Salvador' },
  { iso: 'AE', code: '+971', nombre: 'Emiratos Árabes Unidos' },
  { iso: 'SK', code: '+421', nombre: 'Eslovaquia' },
  { iso: 'SI', code: '+386', nombre: 'Eslovenia' },
  { iso: 'US', code: '+1',   nombre: 'Estados Unidos' },
  { iso: 'EE', code: '+372', nombre: 'Estonia' },
  { iso: 'PH', code: '+63',  nombre: 'Filipinas' },
  { iso: 'FI', code: '+358', nombre: 'Finlandia' },
  { iso: 'FR', code: '+33',  nombre: 'Francia' },
  { iso: 'GR', code: '+30',  nombre: 'Grecia' },
  { iso: 'GT', code: '+502', nombre: 'Guatemala' },
  { iso: 'GQ', code: '+240', nombre: 'Guinea Ecuatorial' },
  { iso: 'HN', code: '+504', nombre: 'Honduras' },
  { iso: 'HU', code: '+36',  nombre: 'Hungría' },
  { iso: 'IN', code: '+91',  nombre: 'India' },
  { iso: 'ID', code: '+62',  nombre: 'Indonesia' },
  { iso: 'IE', code: '+353', nombre: 'Irlanda' },
  { iso: 'IS', code: '+354', nombre: 'Islandia' },
  { iso: 'IL', code: '+972', nombre: 'Israel' },
  { iso: 'IT', code: '+39',  nombre: 'Italia' },
  { iso: 'JP', code: '+81',  nombre: 'Japón' },
  { iso: 'LV', code: '+371', nombre: 'Letonia' },
  { iso: 'LT', code: '+370', nombre: 'Lituania' },
  { iso: 'LU', code: '+352', nombre: 'Luxemburgo' },
  { iso: 'MY', code: '+60',  nombre: 'Malasia' },
  { iso: 'MT', code: '+356', nombre: 'Malta' },
  { iso: 'MA', code: '+212', nombre: 'Marruecos' },
  { iso: 'MX', code: '+52',  nombre: 'México' },
  { iso: 'MC', code: '+377', nombre: 'Mónaco' },
  { iso: 'NI', code: '+505', nombre: 'Nicaragua' },
  { iso: 'NO', code: '+47',  nombre: 'Noruega' },
  { iso: 'NZ', code: '+64',  nombre: 'Nueva Zelanda' },
  { iso: 'NL', code: '+31',  nombre: 'Países Bajos' },
  { iso: 'PA', code: '+507', nombre: 'Panamá' },
  { iso: 'PY', code: '+595', nombre: 'Paraguay' },
  { iso: 'PE', code: '+51',  nombre: 'Perú' },
  { iso: 'PL', code: '+48',  nombre: 'Polonia' },
  { iso: 'PT', code: '+351', nombre: 'Portugal' },
  { iso: 'GB', code: '+44',  nombre: 'Reino Unido' },
  { iso: 'CZ', code: '+420', nombre: 'República Checa' },
  { iso: 'DO', code: '+1809', nombre: 'República Dominicana' },
  { iso: 'RO', code: '+40',  nombre: 'Rumanía' },
  { iso: 'RU', code: '+7',   nombre: 'Rusia' },
  { iso: 'RS', code: '+381', nombre: 'Serbia' },
  { iso: 'SG', code: '+65',  nombre: 'Singapur' },
  { iso: 'ZA', code: '+27',  nombre: 'Sudáfrica' },
  { iso: 'SE', code: '+46',  nombre: 'Suecia' },
  { iso: 'CH', code: '+41',  nombre: 'Suiza' },
  { iso: 'TH', code: '+66',  nombre: 'Tailandia' },
  { iso: 'TR', code: '+90',  nombre: 'Turquía' },
  { iso: 'UA', code: '+380', nombre: 'Ucrania' },
  { iso: 'UY', code: '+598', nombre: 'Uruguay' },
  { iso: 'VE', code: '+58',  nombre: 'Venezuela' },
];

// Prefijos admitidos al guardar. Set para validar en O(1) sin recorrer la lista.
export const PREFIJOS_VALIDOS = new Set(PAISES_TELEFONO.map(p => p.code));

// ── Idiomas ───────────────────────────────────────────────────────────────────
// El <select> GUARDA la preferencia en admin_users.idioma. Hoy NO traduce nada: la interfaz
// está en español. El motor de traducción real (i18n) es una tarea futura aparte, anotada en
// TABLERO.md. Mientras no exista, la pantalla avisa al usuario de que su elección se guarda
// pero todavía no cambia los textos — prometer menos que cumplir, nunca al revés.
export const IDIOMAS = [
  { code: 'es', nombre: 'Español' },
  { code: 'en', nombre: 'Inglés' },
  { code: 'fr', nombre: 'Francés' },
  { code: 'de', nombre: 'Alemán' },
  { code: 'it', nombre: 'Italiano' },
  { code: 'pt', nombre: 'Portugués' },
  { code: 'ca', nombre: 'Catalán' },
  { code: 'gl', nombre: 'Gallego' },
  { code: 'eu', nombre: 'Euskera' },
];

export const IDIOMAS_VALIDOS = new Set(IDIOMAS.map(i => i.code));
