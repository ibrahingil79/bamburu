// entorno.js — Lee /etc/orquestador.env cuando el comando se lanza a mano.
//
// Bajo systemd lo carga la propia unit (EnvironmentFile). Pero Ibrahin lanza
// «probar-telegram» desde su terminal, y ahí no hay systemd que lo cargue: si esto no
// existiera, la comprobación diría «sin configurar» con el fichero relleno, que es la peor
// respuesta posible — la que le haría dudar de lo que acaba de escribir bien.
import fs from 'node:fs';

export const FICHERO_SECRETOS = process.env.ORQUESTADOR_ENV_FILE || '/etc/orquestador.env';

/** @returns { cargadas, existe, legible, motivo } — nunca lanza. */
export function cargarSecretos(ruta = FICHERO_SECRETOS, entorno = process.env) {
  if (!fs.existsSync(ruta)) return { cargadas: 0, existe: false, legible: false, motivo: 'no existe' };

  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); }
  catch (e) {
    return { cargadas: 0, existe: true, legible: false,
             motivo: e.code === 'EACCES' ? 'existe pero este usuario no puede leerlo' : e.message };
  }

  let cargadas = 0;
  for (const linea of texto.split('\n')) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (!m) continue;
    let valor = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    // Lo que ya viene del entorno manda: systemd y las pruebas tienen que poder sobreescribir.
    if (entorno[m[1]] === undefined && valor) { entorno[m[1]] = valor; cargadas++; }
  }
  return { cargadas, existe: true, legible: true, motivo: 'leído' };
}
