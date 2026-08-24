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
import { chmodSync, statSync, readdirSync } from 'fs';
import { join } from 'path';

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

// ── Y LAS QUE NADIE ABRE NUNCA ────────────────────────────────────────────────────────────────
// 24 ago 2026. Lo de arriba cura la BD de un negocio CUANDO SE ABRE. Pero `data/tenants/desarrollo.db`
// llevaba meses en 0644 y no se curaba: **no tiene fila en control.db**, así que el middleware no la
// abre jamás. Y lo mismo pasaba con las COPIAS de seguridad de `data/copias-limpieza/`, que nacen de
// un `cp` con el umask de quien lo ejecute — tres de ellas, la BD entera del negocio de desarrollo,
// en 0644 dentro de un directorio 0775.
//
// El directorio `data/` está en 0700 y hoy tapa las dos cosas, pero eso es SUERTE, no diseño: el día
// que alguien afloje ese directorio quedan al aire y nadie lo nota. Y una copia de seguridad es tan
// tuya como el original: contiene los mismos clientes, las mismas facturas y los mismos NIF.
//
// Por eso el barrido de curación deja de mirar «los negocios registrados» y mira EL ÁRBOL: todo
// fichero de base de datos que haya bajo `data/`, esté registrado o no, sea copia o no. Se llama al
// arrancar el servicio: idempotente, sin sudo, y sin depender del umask de nadie.
export function restringirArbol(dirRaiz) {
  let tocados = 0;
  const esBd = n => /\.db(-wal|-shm)?$/.test(n);
  const recorrer = d => {
    let entradas;
    try { entradas = readdirSync(d, { withFileTypes: true }); } catch { return; }
    // Un directorio SOLO se cierra si guarda bases de datos. El caché de mapas y los adjuntos no son
    // asunto de esta pieza: apretarlos «por si acaso» es tocar 157 directorios para arreglar 4
    // ficheros, y una pieza de seguridad que hace de más se acaba desactivando entera.
    if (entradas.some(e => e.isFile() && esBd(e.name))) {
      try { const m = statSync(d).mode & 0o777; if (m & 0o077) { chmodSync(d, 0o700); tocados++; } } catch (_) {}
    }
    for (const e of entradas) {
      const p = join(d, e.name);
      if (e.isDirectory()) { recorrer(p); continue; }
      if (!esBd(e.name)) continue;
      try { const m = statSync(p).mode & 0o777; if (m & 0o077) { chmodSync(p, PRIVADO); tocados++; } } catch (_) {}
    }
  };
  recorrer(dirRaiz);
  return tocados;
}
