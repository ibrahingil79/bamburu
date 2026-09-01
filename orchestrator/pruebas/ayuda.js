// ayuda.js — Utilidades de las pruebas. Un repo de usar y tirar por prueba.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cargarConfig } from '../nucleo/config.js';

export function repoTemporal({ tablero = TABLERO_BLOQUE } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-prueba-'));
  const git = (...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' });
  git('init', '-q', '-b', 'master');
  git('config', 'user.email', 'prueba@local');
  git('config', 'user.name', 'Prueba');
  git('config', 'commit.gpgsign', 'false');
  // ⚙️ EL REPO DE PRUEBA IGNORA LO MISMO QUE EL DE VERDAD (1 sep 2026). Sin esto, el estado del
  // propio daemon (`.orquestador/`) y sus registros quedaban VERSIONADOS aquí y no allí, y un
  // `git checkout` fallaba en la prueba por un motivo que en producción no existe. Un repo de
  // usar y tirar que no se parece al de verdad miente en las dos direcciones.
  fs.writeFileSync(path.join(raiz, '.gitignore'), '.orquestador/\nlogs/\ndata/\nnode_modules/\n', 'utf8');
  fs.writeFileSync(path.join(raiz, 'TABLERO.md'), tablero, 'utf8');
  fs.writeFileSync(path.join(raiz, 'semilla.txt'), 'semilla\n', 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'semilla');
  return raiz;
}

export function limpiar(raiz) {
  try { fs.rmSync(raiz, { recursive: true, force: true }); } catch { /* da igual */ }
}

export function configDe(raiz, encima = {}) {
  return cargarConfig({ raiz, sobreescritura: { subida: { activa: false }, vigia: { activo: false }, ...encima }, entorno: {} });
}

export const TABLERO_BLOQUE = `# Tablero de pruebas

## SIGUIENTE TAREA — Sumar dos numeros

- **id:** sumar-dos-numeros
- **estado:** pendiente

Hace falta una funcion que sume dos numeros y valide sus entradas.

**Criterios de aceptación**

- [ ] Existe una funcion suma que devuelve la suma de dos numeros
- [ ] Con una entrada que no sea numero lanza un error claro
- [ ] Hay una prueba que ejercita los dos casos
`;

export const TABLERO_VACIO = `# Tablero de pruebas\n\nNada que hacer.\n`;

/** Un registro que no imprime, para que las pruebas no ensucien la salida. */
export const registroMudo = () => ({
  ruta: '(mudo)', info() {}, detalle() {}, paso() {}, exito() {}, aviso() {}, error() {}, titulo() {},
});

/** Un vigilante falso: dice lo que le mandes, sin gastar cuota. */
export function vigilanteFalso(valor = { fiable: true, sesionPct: 10, semanaPct: 5, reinicioSesion: 'luego' }) {
  return {
    valor,
    async consultar() { return this.valor; },
    marcarSinCuota(m) { this.valor = { fiable: true, sesionPct: 100, semanaPct: 5, motivo: m }; },
    olvidar() {},
  };
}

/** Un invocador falso: devuelve guiones preparados en vez de llamar al modelo. */
export function invocadorFalso(guion) {
  const llamadas = [];
  const fn = async (opciones) => {
    llamadas.push(opciones);
    const paso = guion.shift();
    if (!paso) throw new Error('el guion de la prueba se quedó sin pasos');
    if (typeof paso === 'function') return paso(opciones, llamadas);
    return paso;
  };
  fn.llamadas = llamadas;
  return fn;
}

export const respuestaOk = (texto = 'hecho') => ({ ok: true, texto, json: { result: texto }, ms: 1, cuotaSospechosa: false });
