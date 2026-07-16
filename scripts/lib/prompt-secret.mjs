// Lee un secreto por teclado SIN que aparezca en ningún sitio.
//
// NACE DE C6/B7. Los scripts de ops GENERABAN la contraseña y la IMPRIMÍAN. Eso la deja en tres
// sitios que nadie limpia: el scrollback de la terminal, lo que capture stdout (journald si se corre
// bajo systemd, un `tee`, un CI) y la sesión de quien mire por encima del hombro. Es el mismo
// anti-patrón que ya nos costó dos incidentes — un secreto no se imprime, igual que no va a un log.
//
// La salida no es "imprimirlo mejor": es NO GENERARLO. Lo teclea quien ejecuta, que es quien se lo
// va a dar a su dueño de todas formas. Así no existe fuera de su cabeza y de la BD (hasheado).
//
// El eco se apaga con el patrón estándar de readline: se pinta la PREGUNTA y a partir de ahí se
// silencia la salida, así que las teclas no dejan rastro en pantalla.
import readline from 'readline';

export function pedirSecreto(pregunta) {
  return new Promise((resolve, reject) => {
    // Sin terminal interactiva no hay a quién preguntar. Se ABORTA en vez de caer a generar-e-imprimir:
    // un script de credenciales que se degrada solo cuando lo capturan es justo el fallo que evitamos.
    if (!process.stdin.isTTY) {
      reject(new Error(
        'Este script pide la contraseña por teclado y no hay terminal interactiva.\n' +
        '   Ejecútalo directamente en una consola (no por tubería, ni con la salida capturada, ni bajo systemd).'
      ));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.silenciado = false;
    rl._writeToOutput = function (s) { if (!rl.silenciado) rl.output.write(s); };
    rl.question(pregunta, (valor) => {
      rl.close();
      process.stdout.write('\n');   // el Enter tampoco se vio: lo ponemos nosotros
      resolve(valor);
    });
    rl.silenciado = true;   // después de question(): la pregunta se ve, lo tecleado no
  });
}

// Pide el secreto dos veces y comprueba que coinciden y que cumple el mínimo. Devuelve el valor o
// termina el proceso con un mensaje claro: quien está reseteando una cuenta no quiere una traza.
export async function pedirContrasenyaNueva(etiqueta, minimo = 10) {
  const a = await pedirSecreto(`   ${etiqueta}: `);
  if (a.length < minimo) {
    console.error(`\n❌ Demasiado corta: mínimo ${minimo} caracteres. No se ha tocado nada.\n`);
    process.exit(1);
  }
  const b = await pedirSecreto('   Repítela: ');
  if (a !== b) {
    console.error('\n❌ No coinciden. No se ha tocado nada.\n');
    process.exit(1);
  }
  return a;
}
