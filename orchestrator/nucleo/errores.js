// errores.js — La taxonomía. «Sin saldo», «el modelo no contestó», «los permisos fallaron»
// y «el disco está lleno» son cuatro cosas distintas y se tratan distinto.
//
// Cada clase lleva `reintentable` y `esperaCuota` porque son las dos preguntas que el ciclo
// necesita responder, y responderlas mirando el texto del mensaje es cómo se cuelan los bugs.

export const CLASES = Object.freeze({
  CUOTA_AGOTADA: 'CUOTA_AGOTADA',
  CUOTA_INSUFICIENTE: 'CUOTA_INSUFICIENTE',
  MODELO_SIN_RESPUESTA: 'MODELO_SIN_RESPUESTA',
  PERMISOS_DENEGADOS: 'PERMISOS_DENEGADOS',
  TIEMPO_AGOTADO: 'TIEMPO_AGOTADO',
  SALIDA_INVALIDA: 'SALIDA_INVALIDA',
  LLAMADA_CORTADA: 'LLAMADA_CORTADA',
  DISCO: 'DISCO',
  GIT: 'GIT',
  RED: 'RED',
  CONFIGURACION: 'CONFIGURACION',
  DESCONOCIDO: 'DESCONOCIDO',
});

const RASGOS = {
  [CLASES.CUOTA_AGOTADA]:        { reintentable: true,  esperaCuota: true,  humano: 'la cuenta se quedó sin cuota' },
  [CLASES.CUOTA_INSUFICIENTE]:   { reintentable: true,  esperaCuota: true,  humano: 'no queda cuota suficiente para el ciclo entero' },
  [CLASES.MODELO_SIN_RESPUESTA]: { reintentable: true,  esperaCuota: false, humano: 'el modelo no devolvió nada' },
  [CLASES.PERMISOS_DENEGADOS]:   { reintentable: true,  esperaCuota: false, humano: 'faltaron permisos para una herramienta' },
  [CLASES.TIEMPO_AGOTADO]:       { reintentable: true,  esperaCuota: false, humano: 'la llamada tardó más del plazo' },
  [CLASES.SALIDA_INVALIDA]:      { reintentable: true,  esperaCuota: false, humano: 'la salida no tenía la forma esperada' },
  // LA CORTAMOS NOSOTROS, y por eso no es culpa de nadie. Se separa de SALIDA_INVALIDA porque
  // el ciclo la trata distinto: NO cuenta como fallo técnico del papel (1 sep 2026). Al
  // verificar la parada se vio que un `systemctl restart` dejaba «Fallo técnico 1 de 3» a
  // nombre del arquitecto: tres reinicios seguidos habrían apartado la tarea sin que nada
  // fallara. Es el mismo criterio que la cuota: no falló el trabajo, se lo quitamos de las manos.
  [CLASES.LLAMADA_CORTADA]:      { reintentable: true,  esperaCuota: false, humano: 'la cortamos nosotros al parar' },
  [CLASES.DISCO]:                { reintentable: false, esperaCuota: false, humano: 'problema de disco' },
  [CLASES.GIT]:                  { reintentable: true,  esperaCuota: false, humano: 'git falló' },
  [CLASES.RED]:                  { reintentable: true,  esperaCuota: false, humano: 'problema de red' },
  [CLASES.CONFIGURACION]:        { reintentable: false, esperaCuota: false, humano: 'problema de configuración' },
  // Desconocido espera como si fuera cuota: lo dice el encargo, y es la postura prudente.
  // Un error que no sabemos leer NO se declara definitivo.
  [CLASES.DESCONOCIDO]:          { reintentable: true,  esperaCuota: true,  humano: 'un fallo que no sé clasificar' },
};

export class ErrorOrquestador extends Error {
  constructor(clase, mensaje, detalle = {}) {
    super(mensaje);
    this.name = 'ErrorOrquestador';
    this.clase = CLASES[clase] ? clase : CLASES.DESCONOCIDO;
    this.detalle = detalle;
    const r = RASGOS[this.clase];
    this.reintentable = r.reintentable;
    this.esperaCuota = r.esperaCuota;
    this.humano = r.humano;
  }
  aJSON() {
    return { clase: this.clase, mensaje: this.message, humano: this.humano,
             reintentable: this.reintentable, esperaCuota: this.esperaCuota, detalle: this.detalle };
  }
}

export const rasgos = (clase) => RASGOS[clase] || RASGOS[CLASES.DESCONOCIDO];

/** Errores del sistema de ficheros que sí sabemos leer. */
export function claseDesdeErrno(e) {
  switch (e?.code) {
    case 'ENOSPC': case 'EDQUOT': case 'EROFS': return CLASES.DISCO;
    case 'EACCES': case 'EPERM':                return CLASES.CONFIGURACION;
    case 'ENOENT':                              return CLASES.CONFIGURACION;
    case 'ENOTFOUND': case 'ECONNREFUSED':
    case 'ETIMEDOUT': case 'ECONNRESET':        return CLASES.RED;
    default:                                    return CLASES.DESCONOCIDO;
  }
}
