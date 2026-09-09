// LA MARCA CON LA QUE SE RECONOCE LO QUE DEJA UN GATE — punto único, para que
// `limpiar-restos-de-gates.mjs` y `verify-residuo-de-pruebas.mjs` (el censo del barrido,
// tarea `barrera-permisos-contamina-el-barrido`, 9 sep 2026) hablen del MISMO patrón. Antes vivía
// duplicado a mano en el limpiador; una marca nueva que alguien añadiera ahí no la vería el
// censo, y sería el mismo error que ya costó caro una vez (los nombres con carga, 5 sep 2026).
//
// Deliberadamente NO incluye «prueba» a secas: hay datos sembrados legítimos que lo llevan.

export const MARCA_SQL = (col) => `(${col} LIKE 'GATE%' OR ${col} LIKE '%(gate %' OR ${col} LIKE '%(gate)%'
  OR ${col} LIKE 'ZZ %' OR ${col} LIKE 'ZZ-%' OR ${col} LIKE 'GD2-%' OR ${col} LIKE '%gate %'
  OR ${col} LIKE 'gate-%' OR ${MARCA_CARGA(col)})`;

// LOS NOMBRES CON CARGA (5 sep 2026) — restos de gates de XSS que no llevan «GATE» ni «ZZ»
// delante: se reconocen por lo que son, un nombre que trae marcado o un `javascript:` dentro.
export function MARCA_CARGA(col) {
  return `(${col} LIKE '%<script%' OR ${col} LIKE '%onerror=%' OR ${col} LIKE '%onload=%'
    OR ${col} LIKE '%<img %' OR ${col} LIKE '%<svg%' OR ${col} LIKE '%javascript:%')`;
}

export const MARCA_USU = "(name LIKE 'GATE%' OR name LIKE 'Gate %' OR name LIKE 'ZZ %' OR email LIKE '%gate%' OR email LIKE 'zz-%' OR email LIKE 'gas-%')";

// Un SLUG de negocio (no un nombre): los negocios `EMPIEZAN_DE_CERO` que crean los gates llevan
// SIEMPRE uno de estos prefijos (ver `scripts/lib/gate-fixtures.mjs` → `RID()`, y los `slug`
// que arman los propios gates: `gate-360-<rid>`, `gate-c5bis-<rid>`, `__gate_<rid>_no_existe`…).
// Un negocio REAL nunca nace con este prefijo.
export const esSlugDeGate = (slug) => /^(gate-|__gate_)/i.test(String(slug || ''));
