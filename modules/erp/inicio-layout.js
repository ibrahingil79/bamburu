// ════════════════════════════════════════════════════════════════════════════
// INICIO PERSONALIZABLE — resolución + persistencia de layouts. Escalera · paso 6.
//
// MODELO (opción C · híbrido): el dueño define un default DE EMPRESA y encima cada usuario retoca el
// suyo. La cascada elige el ámbito MÁS específico disponible:  usuario:<id>  >  empresa  >  fabrica.
// Nunca un lienzo en blanco: si nadie ha tocado nada, se ve el de FÁBRICA (semilla en código).
//
// POR EMPRESA (no por rol): los permisos de esta app son POR USUARIO (`user_permissions`); las tablas de
// roles con nombre existen pero NO gobiernan el acceso (ver PASO 0). Así que el default del dueño es uno
// solo, de empresa, y el filtrado por permiso se hace por usuario: un bloque de un área que un usuario
// no puede ver NO se le pinta (se omite en silencio), nunca se le cuela.
//
// PERMISOS reutilizados, no reimplementados: el permiso de área sale de `areaPerm` (constructor) y del
// mismo `can()`/`requirePerm` de las dos puertas. Los gráficos de panel se pintan re-cruzando por el
// motor del constructor (cero cifras propias). SOLO LECTURA sobre datos de negocio: esto solo guarda la
// COLOCACIÓN de bloques (config de presentación), nunca deriva ni escribe una cifra.
import { listarPaneles, areaPerm, AREAS } from './constructor-analitica.js';
import { ventasResumen, pedidosResumen } from './ventas-metrics.js';
import { estadoAvisos, hoyLocal } from './avisos.js';

// Datos de render de un panel guardado: su receta (config), la medida a pintar y el meta de esa medida
// (etiqueta/dinero/%), tomados del catálogo REAL del constructor — para que el Inicio lo pinte con SU
// motor sin recalcular nada. Se comparte entre `sanear` (lo colocado) y `bloquesDisponibles` (la paleta).
function enriquecerPanel(p) {
  const area = p.config?.area || 'ventas';
  const medida = p.config?.formula ? 'calculo' : (p.config?.medidas?.[0] || 'base');
  const m = AREAS[area]?.medidas?.[medida];
  const meta = p.config?.formula ? { etiqueta: 'Cálculo', dinero: false, pct: false }
    : (m ? { etiqueta: m.etiqueta, dinero: !!m.dinero, pct: !!m.pct } : { etiqueta: medida, dinero: false, pct: false });
  return { area, medida, meta, config: p.config, nombre: p.nombre };
}

// ── BLOQUES NATIVOS del Inicio (los que ya existían) que se pueden colocar en la rejilla ─────────
// `perm` = permiso que exige para verse (null = todos; los datos internos se filtran igual por permiso).
export const NATIVOS = {
  kpis:   { etiqueta: 'Cifras del negocio', desc: 'Ventas del mes, pedidos, pendientes y avisos.', perm: null,             icon: 'ti-layout-dashboard', w: 4, h: 1 },
  vigia:  { etiqueta: 'Vigía de DISA',      desc: 'Lo que más conviene mirar, ordenado por prioridad.', perm: 'analytics.read', icon: 'ti-radar',           w: 2, h: 2 },
  avisos: { etiqueta: 'Avisos pendientes',  desc: 'Cobros, pagos, stock y recurrentes por resolver.', perm: null,             icon: 'ti-bell',            w: 2, h: 2 },
};

// ── INICIO DE FÁBRICA — sensato y ya montado. Semilla en código (no se persiste). ───────────────
export const FABRICA = [
  { tipo: 'kpis',   refId: null, x: 0, y: 0, w: 4, h: 1 },
  { tipo: 'vigia',  refId: null, x: 0, y: 1, w: 2, h: 2 },
  { tipo: 'avisos', refId: null, x: 2, y: 1, w: 2, h: 2 },
];

// El permiso que exige un bloque: nativo → su `perm`; panel → el permiso de su área.
export function permDeBloque(b, panelesById) {
  if (b.tipo === 'panel') {
    const p = panelesById.get(b.refId);
    return p ? areaPerm(p.config?.area || 'ventas') : '__inexistente__';   // panel que no ve → cae cerrado
  }
  return NATIVOS[b.tipo]?.perm || null;
}

// ── PERSISTENCIA por ámbito ─────────────────────────────────────────────────────────────────────
export function getLayout(db, scope) {
  const row = db.prepare('SELECT blocks FROM dashboard_layouts WHERE scope=?').get(scope);
  if (!row) return null;
  try { const b = JSON.parse(row.blocks); return Array.isArray(b) ? b : null; } catch { return null; }
}
export function setLayout(db, scope, blocks, userId = null) {
  db.prepare(`INSERT INTO dashboard_layouts (scope, blocks, updated_at, updated_by) VALUES (?,?,CURRENT_TIMESTAMP,?)
              ON CONFLICT(scope) DO UPDATE SET blocks=excluded.blocks, updated_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by`)
    .run(scope, JSON.stringify(blocks), userId);
  return { ok: true };
}
export function delLayout(db, scope) {
  db.prepare('DELETE FROM dashboard_layouts WHERE scope=?').run(scope);
  return { ok: true };
}

// ── RESOLUCIÓN (cascada) — qué layout le toca a este usuario, y de qué ámbito viene ─────────────
export function resolver(db, userId) {
  const propio = getLayout(db, 'usuario:' + userId);
  if (propio) return { blocks: propio, origen: 'usuario', tieneCapaPropia: true };
  const empresa = getLayout(db, 'empresa');
  if (empresa) return { blocks: empresa, origen: 'empresa', tieneCapaPropia: false };
  return { blocks: FABRICA, origen: 'fabrica', tieneCapaPropia: false };
}

// Deja SOLO los bloques que este usuario puede ver (permiso heredado). Un panel que no ve, o un bloque
// de un área sin permiso, se OMITE (no se le cuela ni el del default del dueño). Enriquece los de panel
// con su nombre/área para que la pantalla los pinte sin volver a preguntar.
export function sanear(blocks, { puede, panelesById }) {
  const out = [];
  for (const b of (blocks || [])) {
    if (b.tipo === 'panel') {
      const p = panelesById.get(b.refId);
      if (!p) continue;                                   // panel borrado o que no ve → fuera
      if (!puede(areaPerm(p.config?.area || 'ventas'))) continue;
      const e = enriquecerPanel(p);
      out.push({ tipo: 'panel', refId: b.refId, x: b.x | 0, y: b.y | 0, w: b.w, h: b.h,
                 nombre: e.nombre, area: e.area, config: e.config, medida: e.medida, meta: e.meta });
    } else {
      const nat = NATIVOS[b.tipo];
      if (!nat) continue;                                 // bloque desconocido → fuera
      if (nat.perm && !puede(nat.perm)) continue;         // nativo sin permiso → fuera (no se cuela)
      out.push({ tipo: b.tipo, refId: null, x: b.x | 0, y: b.y | 0, w: b.w, h: b.h, etiqueta: nat.etiqueta });
    }
  }
  return out;
}

// ── PALETA — los bloques que este usuario PUEDE añadir (nativos permitidos + sus paneles visibles) ─
export function bloquesDisponibles(db, userId, puede) {
  const nativos = Object.entries(NATIVOS)
    .filter(([, n]) => !n.perm || puede(n.perm))
    .map(([tipo, n]) => ({ tipo, etiqueta: n.etiqueta, desc: n.desc, icon: n.icon, w: n.w, h: n.h }));
  const paneles = listarPaneles(db, userId)
    .filter(p => puede(areaPerm(p.config?.area || 'ventas')))
    .map(p => {
      const e = enriquecerPanel(p);
      return { tipo: 'panel', refId: p.id, etiqueta: p.nombre, area: e.area, grafico: p.config?.grafico || 'tabla',
               propio: p.propio, autor: p.autor, w: NATIVOS.vigia.w, h: NATIVOS.vigia.h,
               config: e.config, medida: e.medida, meta: e.meta };
    });
  return { nativos, paneles };
}

// ── VALIDAR/NORMALIZAR un layout entrante (antes de guardar) ────────────────────────────────────
// Recorta tamaños a la rejilla (w 1..4, h 1..4), fija el tipo válido, y limita el nº de bloques. NO
// comprueba permisos aquí (eso lo hace la ruta, que tiene el `puede` del usuario): esto solo sanea forma.
export function normalizar(blocks) {
  if (!Array.isArray(blocks)) { const e = new Error('El layout debe ser una lista de bloques'); e.status = 400; throw e; }
  const clamp = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  return blocks.slice(0, 40).map((b, i) => {
    const tipo = String(b && b.tipo || '');
    const esPanel = tipo === 'panel';
    const rid = esPanel ? Number(b.refId) : null;
    if (esPanel ? !Number.isInteger(rid) : !NATIVOS[tipo]) return null;
    return { tipo, refId: esPanel ? rid : null, x: 0, y: i, w: clamp(b.w, 1, 4, 2), h: clamp(b.h, 1, 4, 1) };
  }).filter(Boolean);
}

// ── DATOS de los bloques nativos (KPIs + avisos), filtrados por permiso — MISMA lógica que el Inicio ─
export function datosNativos(db, { puede, userId, fuentes, sym }) {
  const verVentas = puede('invoices.read'), verPedidos = puede('pedidos.read');
  let ventas = null, pedidos = null, pendiente = null;
  try { if (verVentas) ventas = Math.round(ventasResumen(db, { from: new Date().toISOString().slice(0, 7) + '-01' }).total); } catch {}
  try { if (verPedidos) { const ped = pedidosResumen(db); pedidos = ped.confirmadosMes; pendiente = ped.pendientes; } } catch {}
  let count = 0, estado = 'apagado';
  try { const est = estadoAvisos(db, hoyLocal(), userId, fuentes); count = est.count; estado = est.estado; } catch {}
  return {
    kpis: { sym, verVentas, verPedidos, ventas, pedidos, pendiente },
    avisos: { count, estado },
  };
}
