// config.js — Carga la configuración. Ni una ruta, ni un umbral, ni un plazo en el código.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorOrquestador, CLASES } from './errores.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const DIR_ORQUESTADOR = path.resolve(AQUI, '..');
export const RAIZ_POR_DEFECTO = path.resolve(DIR_ORQUESTADOR, '..');

const FICHERO = path.join(DIR_ORQUESTADOR, 'orquestador.config.json');

function fusionar(base, encima) {
  if (!encima || typeof encima !== 'object' || Array.isArray(encima)) return encima ?? base;
  const fuera = { ...base };
  for (const [k, v] of Object.entries(encima)) {
    fuera[k] = (k in base) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? fusionar(base[k], v) : v;
  }
  return fuera;
}

/**
 * Orden de precedencia, de menos a más: fichero → fichero de sobreescritura → entorno.
 * El entorno gana porque es lo que usa systemd y las pruebas, y tiene que poder mandar
 * sin editar un fichero versionado.
 */
export function cargarConfig({ raiz = null, sobreescritura = null, entorno = process.env } = {}) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(FICHERO, 'utf8'));
  } catch (e) {
    throw new ErrorOrquestador(CLASES.CONFIGURACION, `no pude leer ${FICHERO}: ${e.message}`);
  }
  delete cfg.$comentario;

  if (entorno.ORQUESTADOR_CONFIG) {
    try { cfg = fusionar(cfg, JSON.parse(fs.readFileSync(entorno.ORQUESTADOR_CONFIG, 'utf8'))); }
    catch (e) { throw new ErrorOrquestador(CLASES.CONFIGURACION, `ORQUESTADOR_CONFIG ilegible: ${e.message}`); }
  }
  if (sobreescritura) cfg = fusionar(cfg, sobreescritura);

  // Sobreescrituras puntuales por entorno, para systemd y pruebas.
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  const porEntorno = limpiar({
    repo: limpiar({ raiz: raiz || entorno.ORQUESTADOR_RAIZ, tablero: entorno.ORQUESTADOR_TABLERO }),
    cli: limpiar({ binario: entorno.ORQUESTADOR_CLAUDE_BIN, modelo: entorno.ORQUESTADOR_MODELO,
                   timeoutMs: num(entorno.ORQUESTADOR_TIMEOUT_MS) }),
    cuota: limpiar({ minimoParaCicloPct: num(entorno.ORQUESTADOR_MIN_CICLO_PCT),
                     margenReservadoPct: num(entorno.ORQUESTADOR_MARGEN_PCT),
                     esperaSinCuotaMs: num(entorno.ORQUESTADOR_ESPERA_CUOTA_MS) }),
    ciclo: limpiar({ intervaloVueltaMs: num(entorno.ORQUESTADOR_INTERVALO_MS) }),
    subida: limpiar({ activa: booleano(entorno.ORQUESTADOR_SUBIR) }),
    vigia: limpiar({ activo: booleano(entorno.ORQUESTADOR_VIGIA),
                     intervaloParteMs: num(entorno.ORQUESTADOR_PARTE_MS) }),
  });
  cfg = fusionar(cfg, porEntorno);

  cfg.repo.raiz = path.resolve(cfg.repo.raiz || RAIZ_POR_DEFECTO);
  cfg.rutasAbs = {};
  for (const [k, v] of Object.entries(cfg.rutas)) cfg.rutasAbs[k] = path.resolve(cfg.repo.raiz, v);
  cfg.rolesAbs = {};
  for (const [k, v] of Object.entries(cfg.roles)) cfg.rolesAbs[k] = path.resolve(RAIZ_POR_DEFECTO, v);
  cfg.tableroAbs = path.resolve(cfg.repo.raiz, cfg.repo.tablero);

  validar(cfg);
  return cfg;
}

function limpiar(o) {
  if (o === undefined) return undefined;
  const fuera = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) fuera[k] = v;
  return Object.keys(fuera).length ? fuera : undefined;
}

function booleano(v) {
  if (v === undefined || v === '') return undefined;
  return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(String(v).toLowerCase());
}

/** Se valida al cargar, no al usar: un umbral absurdo tiene que reventar en el arranque. */
function validar(cfg) {
  const fallos = [];
  const c = cfg.cuota;
  const pct = (n, v) => { if (!Number.isFinite(v) || v < 0 || v > 100) fallos.push(`cuota.${n} debe estar entre 0 y 100, y es «${v}»`); };
  pct('minimoParaCicloPct', c.minimoParaCicloPct);
  pct('margenReservadoPct', c.margenReservadoPct);
  pct('minimoSemanalPct', c.minimoSemanalPct);
  // ⚙️ `>=`, NO `>` (1 sep 2026). Con `>` el peor caso pasaba en silencio: 90 + 10 = 100 exactos
  // significa «hace falta que la ventana esté ENTERA libre», o sea que no arranca nunca — y la
  // función existe justo para que «un umbral absurdo reviente en el arranque». Se descubrió porque
  // yo mismo colé un 90 por entorno para provocar un rato muerto, y el daemon lo aceptó sin
  // pestañear y se quedó parado con 43 tareas delante. Un umbral que garantiza el bloqueo es el
  // umbral más absurdo de todos, y era el único que no se comprobaba.
  if (c.minimoParaCicloPct + c.margenReservadoPct >= 100) {
    fallos.push(`cuota.minimoParaCicloPct (${c.minimoParaCicloPct}) + margenReservadoPct (${c.margenReservadoPct}) suma ${c.minimoParaCicloPct + c.margenReservadoPct}: haría falta la ventana entera libre y NO ARRANCARÍA NUNCA`);
  }
  if (cfg.ciclo.maxIntentosRevision < 1) fallos.push('ciclo.maxIntentosRevision tiene que ser 1 o más');
  if (cfg.ciclo.maxReplanteos < 0) fallos.push('ciclo.maxReplanteos no puede ser negativo');
  if (cfg.cli.timeoutMs < 1000) fallos.push('cli.timeoutMs es absurdamente corto');
  for (const [papel, ruta] of Object.entries(cfg.rolesAbs)) {
    if (!fs.existsSync(ruta)) fallos.push(`falta el fichero del papel «${papel}»: ${ruta}`);
  }
  if (fallos.length) {
    throw new ErrorOrquestador(CLASES.CONFIGURACION, `configuración inválida:\n  · ${fallos.join('\n  · ')}`);
  }
}
