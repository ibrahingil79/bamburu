// vigilante.js — Cuánta cuota queda. Con caché, porque preguntarlo también gasta.
import { invocar } from '../ejecucion/cli.js';
import { interpretarUsage } from './usage.js';

/**
 * La consulta de /usage es en sí misma una llamada al modelo, así que se cachea. Sin caché,
 * un daemon que da vueltas cada minuto gastaría en preguntar más que en trabajar.
 *
 * `reloj` se inyecta para que las pruebas no dependan del tiempo real.
 */
export class Vigilante {
  constructor({ config, reloj = () => Date.now(), invocador = invocar }) {
    this.config = config;
    this.reloj = reloj;
    this.invocador = invocador;
    this.cache = null;
  }

  olvidar() { this.cache = null; }

  /** Fuerza el estado (lo usa el ciclo cuando una llamada muere por cuota: ya lo sabemos). */
  marcarSinCuota(motivo) {
    this.cache = {
      ts: this.reloj(),
      valor: { fiable: true, sesionPct: 100, semanaPct: null, reinicioSesion: null,
               motivo: `lo dijo una llamada que murió: ${motivo}`, fuente: 'llamada' },
    };
  }

  async consultar({ forzar = false, cwd } = {}) {
    const edad = this.cache ? this.reloj() - this.cache.ts : Infinity;
    if (!forzar && this.cache && edad < this.config.cuota.cacheMs) {
      return { ...this.cache.valor, edadMs: edad, deCache: true };
    }

    // /usage se pide desde un directorio neutro y SIN herramientas: es una lectura, no
    // necesita tocar nada, y desde el repo consumiría el triple por cargar CLAUDE.md.
    const r = await this.invocador({
      prompt: '/usage',
      herramientas: [],
      cwd: cwd || directorioNeutro(),
      config: { ...this.config, cli: { ...this.config.cli, timeoutMs: this.config.cuota.timeoutConsultaMs } },
    });

    let valor;
    if (!r.ok) {
      // Si la propia consulta muere por cuota, eso YA es la respuesta.
      valor = r.error?.esperaCuota
        ? { fiable: true, sesionPct: 100, semanaPct: null, reinicioSesion: null,
            motivo: `la consulta murió por cuota: ${r.error.message}`, fuente: 'fallo' }
        : { fiable: false, sesionPct: null, semanaPct: null, reinicioSesion: null,
            motivo: `no pude consultar /usage: ${r.error?.message || 'sin detalle'}`, fuente: 'fallo' };
    } else {
      valor = { ...interpretarUsage(r.texto), fuente: 'usage' };
    }

    this.cache = { ts: this.reloj(), valor };
    return { ...valor, edadMs: 0, deCache: false };
  }
}

/**
 * Directorio neutro para no arrastrar el CLAUDE.md del repo en una simple consulta.
 * Está medido: desde `~/bamburu` la misma llamada consume ~3x.
 */
function directorioNeutro() {
  return process.env.TMPDIR || '/tmp';
}
