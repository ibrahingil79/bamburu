// vigilante.js — Cuánta cuota queda. Con caché, porque preguntarlo también gasta.
import { invocar } from '../ejecucion/cli.js';
import { interpretarUsage } from './usage.js';
import { escribirAtomico } from '../nucleo/almacen.js';

/**
 * La consulta de /usage es en sí misma una llamada al modelo, así que se cachea. Sin caché,
 * un daemon que da vueltas cada minuto gastaría en preguntar más que en trabajar.
 *
 * `reloj` se inyecta para que las pruebas no dependan del tiempo real.
 */
export class Vigilante {
  constructor({ config, reloj = () => Date.now(), invocador = invocar, ruta = null }) {
    this.config = config;
    this.reloj = reloj;
    this.invocador = invocador;
    // Dónde se deja por escrito la última lectura. Con `null` no se escribe (las pruebas).
    this.ruta = ruta;
    this.cache = null;
    // Las consultas de /usage en vuelo, para poder cortarlas.
    //
    // ⚙️ ESTO LO DESTAPÓ LA PRUEBA NUEVA DE LA PARADA (1 sep 2026), y no estaba en el encargo:
    // preguntar `/usage` ES una llamada al modelo, con su propio plazo de 3 minutos
    // (`cuota.timeoutConsultaMs`), y NADIE podía cortarla. Un SIGTERM que llegara mientras el
    // daemon preguntaba por la cuota colgaba hasta 3 min igual que uno durante un análisis —
    // el mismo agujero de la avería 3, en la otra puerta. Se arregla en el mismo sitio o no se
    // arregla: quien pueda estar en vuelo tiene que tener manija.
    this.cancelables = new Set();
  }

  /** Corta las consultas de cuota en vuelo. La usa la parada del daemon. */
  cancelarTodo() {
    for (const c of this.cancelables) { try { c(); } catch { /* ya estaba muerta */ } }
    this.cancelables.clear();
  }

  olvidar() { this.cache = null; }

  /**
   * Deja la última lectura EN DISCO.
   *
   * ⚙️ POR QUÉ EXISTE (1 sep 2026, avería 2). Ese día el orquestador creía que quedaba un 12 %
   * y la pantalla de Ibrahin marcaba 0 % usado, y para descubrirlo hubo que matar el daemon:
   * el número que el daemon manejaba solo salía en líneas sueltas del registro y en el parte de
   * cada tres horas. `orq estado` no lo enseñaba. Ahora sí, con su antigüedad, y contrastarlo
   * con `/usage` es mirar dos cosas seguidas en vez de una autopsia.
   *
   * Se escribe la LECTURA DEL DAEMON, no una nueva: lo que hay que poder contrastar es lo que
   * él cree, no lo que creería si se lo preguntáramos otra vez.
   */
  anotar(valor) {
    if (!this.ruta) return;
    try { escribirAtomico(this.ruta, JSON.stringify({ ...valor, leidoEn: new Date(this.reloj()).toISOString() }, null, 2)); }
    catch { /* no poder anotarlo no puede tumbar una consulta de cuota */ }
  }

  /**
   * Fuerza el estado (lo usa el ciclo cuando una llamada muere por cuota: ya lo sabemos).
   *
   * ⚙️ SE CONSERVA LA HORA DEL REINICIO (1 sep 2026, avería 2). Antes esto la ponía a `null` y
   * el daemon perdía lo único que le permitía despertarse a tiempo, justo en el momento en que
   * más falta le hacía: cuando acababa de quedarse sin cuota a mitad de una tarea. Que una
   * llamada muera no invalida la hora de reinicio que `/usage` dio hace cinco minutos: lo que
   * cambia es el porcentaje, no el calendario.
   */
  marcarSinCuota(motivo) {
    const antes = this.cache?.valor;
    this.cache = {
      ts: this.reloj(),
      valor: { fiable: true, sesionPct: 100, semanaPct: antes?.semanaPct ?? null,
               reinicioSesion: antes?.reinicioSesion ?? null,
               reinicioSemana: antes?.reinicioSemana ?? null,
               reinicioSesionMs: antes?.reinicioSesionMs ?? null,
               reinicioSemanaMs: antes?.reinicioSemanaMs ?? null,
               motivo: `lo dijo una llamada que murió: ${motivo}`, fuente: 'llamada' },
    };
    this.anotar(this.cache.valor);
  }

  async consultar({ forzar = false, cwd } = {}) {
    const edad = this.cache ? this.reloj() - this.cache.ts : Infinity;
    if (!forzar && this.cache && edad < this.config.cuota.cacheMs) {
      return { ...this.cache.valor, edadMs: edad, deCache: true };
    }

    // /usage se pide desde un directorio neutro y SIN herramientas: es una lectura, no
    // necesita tocar nada, y desde el repo consumiría el triple por cargar CLAUDE.md.
    let miCancelador = null;
    const r = await this.invocador({
      prompt: '/usage',
      herramientas: [],
      cwd: cwd || directorioNeutro(),
      config: { ...this.config, cli: { ...this.config.cli, timeoutMs: this.config.cuota.timeoutConsultaMs } },
      alSalir: (cancelar) => { miCancelador = cancelar; this.cancelables.add(cancelar); },
    }).finally(() => { if (miCancelador) this.cancelables.delete(miCancelador); });

    let valor;
    const antes = this.cache?.valor;
    // Mismo motivo que en `marcarSinCuota`: si ya sabíamos a qué hora se reinicia, un fallo de
    // la consulta no lo desmiente. Se arrastra para no quedarse a ciegas y sondeando a lo bruto.
    const horasSabidas = {
      reinicioSesion: antes?.reinicioSesion ?? null, reinicioSemana: antes?.reinicioSemana ?? null,
      reinicioSesionMs: antes?.reinicioSesionMs ?? null, reinicioSemanaMs: antes?.reinicioSemanaMs ?? null,
    };
    if (!r.ok) {
      // Si la propia consulta muere por cuota, eso YA es la respuesta.
      valor = r.error?.esperaCuota
        ? { fiable: true, sesionPct: 100, semanaPct: antes?.semanaPct ?? null, ...horasSabidas,
            motivo: `la consulta murió por cuota: ${r.error.message}`, fuente: 'fallo' }
        : { fiable: false, sesionPct: null, semanaPct: null, ...horasSabidas,
            motivo: `no pude consultar /usage: ${r.error?.message || 'sin detalle'}`, fuente: 'fallo' };
    } else {
      valor = { ...interpretarUsage(r.texto, this.reloj()), fuente: 'usage' };
    }

    this.cache = { ts: this.reloj(), valor };
    this.anotar(valor);
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
