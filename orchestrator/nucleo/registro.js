// registro.js — Escribe a la vez en pantalla y en fichero. Nunca tumba nada si falla.
import fs from 'node:fs';
import path from 'node:path';
import { tapar } from './secretos.js';

export function crearRegistro({ dirLogs, nombre = 'orquestador.log', aPantalla = true }) {
  const ruta = path.join(dirLogs, nombre);
  let vivo = true;
  try { fs.mkdirSync(dirLogs, { recursive: true }); fs.appendFileSync(ruta, '', 'utf8'); }
  catch { vivo = false; }

  const escribir = (nivel, textoCrudo, adornoCrudo) => {
    // Todo pasa por el tapador antes de existir en ningún sitio. Un secreto que llega al
    // fichero ya no se puede quitar del disco de nadie.
    const texto = tapar(textoCrudo);
    const adorno = tapar(adornoCrudo);
    if (vivo) {
      try { fs.appendFileSync(ruta, `${new Date().toISOString()} [${nivel}] ${texto}\n`, 'utf8'); }
      catch { vivo = false; }   // si el disco falla, el registro deja de escribir pero el ciclo sigue
    }
    if (aPantalla) process.stdout.write(adorno + '\n');
  };

  return {
    ruta,
    info:    (t) => escribir('INFO', t, `    ${t}`),
    detalle: (t) => escribir('INFO', t, t),
    paso:    (p, t) => escribir('PASO', `${p} — ${t}`, `\n▸ ${p} — ${t}`),
    exito:   (t) => escribir('  OK', t, `    ✅ ${t}`),
    aviso:   (t) => escribir('AVIS', t, `    ⚠️  ${t}`),
    error:   (t) => escribir(' ERR', t, `    ❌ ${t}`),
    titulo:  (t) => escribir('INFO', t, `\n${'═'.repeat(78)}\n${t}\n${'═'.repeat(78)}`),
  };
}
