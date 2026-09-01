// vigilante.js — Cuánta cuota queda.
import { invocar } from '../ejecucion/cli.js';
import { interpretarUsage } from './usage.js';
import { escribirAtomico } from '../nucleo/almacen.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ⚙️ PREGUNTAR LA CUOTA NO GASTA CUOTA (medido el 1 sep 2026). Aquí ponía «la consulta de
 * /usage es en sí misma una llamada al modelo, así que se cachea», y era FALSO. `/usage` es
 * una orden LOCAL del CLI: la contesta él con lo que ya tiene, sin hablar con el modelo.
 * Medido lanzándola 21 veces seguidas: `num_turns: 0`, `total_cost_usd: 0` y CERO tokens en
 * las cuatro cuentas (entrada, salida, creación y lectura de caché) en todas y cada una.
 *
 * Esa frase falsa no era un comentario desactualizado: era la premisa de la que colgaba la
 * caché, y la caché guardaba TAMBIÉN los fallos. El 1 sep a las 13:54:52 una lectura salió
 * ilegible, el «no lo sé» se quedó en la caché sus 5 minutos completos, y el orquestador se
 * plantó con un 32 % disponible — el vigía leyó `/usage` sin problema a las 13:58:25 y contestó
 * «queda 32 %» por Telegram mientras el daemon seguía diciendo que no lo sabía. La fábrica
 * estuvo parada 5 min por no saber, no por falta de presupuesto, y no le costaba nada volver
 * a preguntar.
 *
 * Lo que queda de la caché: se guarda lo que SE SABE, no lo que no se pudo leer. Un fallo no
 * es una lectura, así que no ocupa el sitio de una.
 *
 * `reloj` se inyecta para que las pruebas no dependan del tiempo real.
 */
export class Vigilante {
  constructor({ config, reloj = () => Date.now(), invocador = invocar, ruta = null, rutaLogs = null }) {
    this.config = config;
    this.reloj = reloj;
    this.invocador = invocador;
    // Dónde se deja por escrito la última lectura. Con `null` no se escribe (las pruebas).
    this.ruta = ruta;
    // Dónde se vuelca la salida cruda de una lectura ilegible. Con `null` no se vuelca.
    this.rutaLogs = rutaLogs;
    this.cache = null;
    // LA ÚLTIMA LECTURA QUE SÍ SE ENTENDIÓ, con su hora. No la pisa un fallo, y es lo único
    // que permite responder «no lo sé, pero hace 3 min quedaba de sobra» en vez de plantarse.
    this.ultimaFiable = null;
    // Se levanta al parar: corta la tanda de reintentos en seco.
    this.cancelado = false;
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
    this.cancelado = true;
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
    // ⚙️ ESTO TAMBIÉN ES LA ÚLTIMA LECTURA BUENA (1 sep 2026). Que una llamada muera por cuota
    // es saber que no queda, no dejar de saber. Si no se apuntara aquí, `ultimaFiable` seguiría
    // guardando el «quedaba de sobra» de hace un rato — y a la primera lectura ilegible que
    // viniera después, el arranque con el último valor conocido daría permiso para gastar una
    // cuota que acabamos de ver morir. El agujero se abre justo donde más caro sale.
    this.ultimaFiable = { ts: this.cache.ts, valor: this.cache.valor };
    this.anotar(this.cache.valor);
  }

  /** Una sola lectura de `/usage`, ya interpretada. Sin caché, sin reintentos, sin adornos. */
  async leerUnaVez(cwd) {
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

    const antes = this.cache?.valor;
    // Mismo motivo que en `marcarSinCuota`: si ya sabíamos a qué hora se reinicia, un fallo de
    // la consulta no lo desmiente. Se arrastra para no quedarse a ciegas y sondeando a lo bruto.
    const horasSabidas = {
      reinicioSesion: antes?.reinicioSesion ?? null, reinicioSemana: antes?.reinicioSemana ?? null,
      reinicioSesionMs: antes?.reinicioSesionMs ?? null, reinicioSemanaMs: antes?.reinicioSemanaMs ?? null,
    };

    if (r.ok) return { ...interpretarUsage(r.texto, this.reloj()), fuente: 'usage' };

    // Si la propia consulta muere por cuota, eso YA es la respuesta: no es que no se sepa.
    if (r.error?.esperaCuota) {
      return { fiable: true, sesionPct: 100, semanaPct: antes?.semanaPct ?? null, ...horasSabidas,
               motivo: `la consulta murió por cuota: ${r.error.message}`, fuente: 'fallo' };
    }
    this.guardarLaPrueba(r.error);
    return { fiable: false, sesionPct: null, semanaPct: null, ...horasSabidas,
             motivo: `no pude consultar /usage: ${r.error?.message || 'sin detalle'}`, fuente: 'fallo' };
  }

  /**
   * ⚙️ LA SALIDA ILEGIBLE SE GUARDA ENTERA (1 sep 2026). De la avería de ese día no quedó más
   * rastro que 300 caracteres recortados en `cuota.json` — el principio de un JSON— y con eso
   * no se puede decir si sobraba algo, faltaba el final o venía basura pegada. Un fallo que no
   * deja prueba se diagnostica adivinando, y adivinar es lo que este árbol tiene prohibido.
   */
  guardarLaPrueba(error) {
    const cruda = error?.detalle?.salidaCruda;
    if (!this.rutaLogs || !cruda) return;
    try {
      const sello = new Date(this.reloj()).toISOString().replace(/[:.]/g, '-');
      const destino = path.join(this.rutaLogs, `usage-ilegible-${sello}.txt`);
      fs.writeFileSync(destino,
        `# /usage ilegible — ${new Date(this.reloj()).toISOString()}\n`
        + `# ${error.message}\n# código de salida: ${error.detalle?.codigo}\n`
        + `# --- stdout tal cual (${cruda.length} caracteres) ---\n${cruda}\n`
        + `# --- stderr ---\n${error.detalle?.erroresCrudos || ''}\n`);
    } catch { /* no poder guardar la prueba no puede tumbar una lectura de cuota */ }
  }

  /**
   * Cuánta cuota queda.
   *
   * ⚙️ UN FALLO NO OCUPA EL SITIO DE UNA LECTURA, Y SE REINTENTA (1 sep 2026). Las dos reglas
   * salen de la misma avería y de la misma medición —`/usage` no gasta cuota, ver la cabecera—:
   *
   *   · **La caché guarda lo que se sabe, no lo que no se pudo leer.** Antes, un «no lo sé»
   *     entraba en la caché y valía por una lectura buena durante 5 minutos completos. Así,
   *     UNA lectura ilegible a las 13:54:52 tuvo al orquestador parado hasta las 14:00:04 con
   *     un 32 % disponible; el vigía leyó `/usage` sin despeinarse a las 13:58:25.
   *   · **Se reintenta ahí mismo.** Si la primera sale ilegible, se vuelve a preguntar hasta
   *     `cuota.reintentosLectura` veces. Cuesta unos segundos y CERO tokens, frente a dejar la
   *     fábrica quieta. El plazo es acotado a propósito: si de verdad no se puede leer, se dice
   *     que no se sabe y decide la máquina de estados — no se insiste para siempre.
   */
  async consultar({ forzar = false, cwd } = {}) {
    const c = this.config.cuota;
    const edad = this.cache ? this.reloj() - this.cache.ts : Infinity;
    // La caché solo sirve si lo guardado ES una lectura. Un fallo cacheado es la avería.
    if (!forzar && this.cache?.valor?.fiable && edad < c.cacheMs) {
      return { ...this.cache.valor, ultimaFiable: this.instantanea(), edadMs: edad, deCache: true };
    }

    const intentos = Math.max(1, c.reintentosLectura ?? 1);
    let valor = null;
    for (let i = 1; i <= intentos; i++) {
      valor = await this.leerUnaVez(cwd);
      if (valor.fiable || this.cancelado || i === intentos) break;
      await this.dormir(c.esperaEntreLecturasMs ?? 3000);
      if (this.cancelado) break;
    }

    if (valor.fiable) {
      this.cache = { ts: this.reloj(), valor };
      this.ultimaFiable = { ts: this.reloj(), valor };
    }
    // Se anota SIEMPRE, también el fallo: `orq estado` y el parte tienen que poder enseñar que
    // el daemon no la sabe. Lo que no se hace es dejarlo en la caché haciéndose pasar por una
    // lectura — anotar es contar lo que pasa, cachear es darlo por sabido.
    //
    // Y con el fallo se anota SOBRE QUÉ está decidiendo. Sin esto, `cuota.json` pasaba de tener
    // un número a tener solo un «no pude», y desde fuera era imposible distinguir «no lo sabe y
    // está parado a ciegas» de «no lo sabe pero hace 3 min quedaba de sobra y está trabajando».
    this.anotar(valor.fiable ? valor : { ...valor, ultimaFiable: this.instantanea() });
    return { ...valor, ultimaFiable: this.instantanea(), edadMs: 0, deCache: false };
  }

  /**
   * La última lectura buena, con su antigüedad YA CALCULADA.
   *
   * Va así y no con una marca de tiempo porque quien la usa es `maquina.js`, y ese fichero no
   * mira el reloj: se le entrega el tiempo hecho. El reloj de aquí es el inyectable, así que
   * una prueba puede envejecer la lectura sin esperar de verdad.
   */
  instantanea() {
    const u = this.ultimaFiable;
    if (!u) return null;
    return { sesionPct: u.valor.sesionPct, semanaPct: u.valor.semanaPct,
             reinicioSesion: u.valor.reinicioSesion ?? null, edadMs: this.reloj() - u.ts };
  }

  /** Espera cortable: si nos paran a mitad de la tanda de reintentos, no se queda colgada. */
  dormir(ms) {
    return new Promise((listo) => {
      const t = setTimeout(listo, ms);
      const cancelar = () => { clearTimeout(t); listo(); };
      this.cancelables.add(cancelar);
      setTimeout(() => this.cancelables.delete(cancelar), ms + 1);
    });
  }
}

/**
 * Directorio neutro para no arrastrar el CLAUDE.md del repo en una simple consulta.
 * Está medido: desde `~/bamburu` la misma llamada consume ~3x.
 */
function directorioNeutro() {
  return process.env.TMPDIR || '/tmp';
}
