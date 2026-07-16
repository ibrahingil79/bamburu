// C6/B9 — las BD de negocio nacen PRIVADAS, y se quedan privadas.
//
// EL FALLO. `new Database(ruta)` crea el fichero con lo que diga el umask del proceso. El del
// servicio es 0002, y quien creó dos de las BD tenía 0022 → nacieron 0644, legibles por cualquier
// usuario de la máquina. El directorio padre está en 0700 y hoy tapa el agujero, pero eso es
// suerte: el día que alguien afloje el directorio, esas dos BD quedan al aire y nadie lo notará.
//
// POR QUÉ CHMOD Y NO UMASK. Un umask correcto solo protege a quien lo tenga puesto: depende del
// proceso, del turno, de quién ejecute el script. Es la clase de arreglo que se deshace solo. Un
// chmod explícito al crear no depende de nada del entorno y no necesita sudo ni tocar systemd.
//
// LOS -wal Y -shm TAMBIÉN. El informe solo señalaba los `.db`, pero el WAL lleva las escrituras
// recientes: es tan legible —y tan tuyo— como la BD. Proteger solo el `.db` sería dejar la puerta
// cerrada y la ventana abierta. SQLite les da los permisos del fichero principal, así que naciendo
// bien el `.db` nacen bien ellos; se pasan igual por si vienen de antes.
import { chmodSync, statSync } from 'fs';

const PRIVADO = 0o600;

// Solo actúa si hay bits de grupo/otros (0o077). Así es idempotente y no genera ruido en los
// ficheros que ya están bien.
function apretar(ruta) {
  try {
    const modo = statSync(ruta).mode & 0o777;
    if (modo & 0o077) chmodSync(ruta, PRIVADO);
  } catch (_) { /* no existe (p. ej. el -wal antes del primer write): nada que apretar */ }
}

export function restringirBd(rutaAbs) {
  apretar(rutaAbs);
  apretar(rutaAbs + '-wal');
  apretar(rutaAbs + '-shm');
}
