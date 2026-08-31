// El token no puede acabar escrito en ningún sitio. Dos redes: por forma y por valor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tapar, pista } from '../nucleo/secretos.js';
import { cargarSecretos } from '../nucleo/entorno.js';
import { crearRegistro } from '../nucleo/registro.js';

const TOKEN = '8123456789:AAHfalsoDePruebaQueNoSirveParaNada';

test('tapa un token por su FORMA, aunque no lo conozca', () => {
  assert.equal(tapar(`error con ${TOKEN} vaya`, {}), 'error con «token tapado» vaya');
});

test('tapa un secreto por su VALOR, aunque no tenga forma de token', () => {
  const t = tapar('la clave es abc12345xyz', { ORQUESTADOR_TELEGRAM_TOKEN: 'abc12345xyz' });
  assert.match(t, /«ORQUESTADOR_TELEGRAM_TOKEN tapado»/);
  assert.ok(!t.includes('abc12345xyz'));
});

test('no tapa valores cortos: taparlos destrozaría cualquier texto', () => {
  assert.equal(tapar('dice si', { ORQUESTADOR_TELEGRAM_TOKEN: 'si' }), 'dice si');
});

test('la pista deja ver que está puesto, sin enseñarlo', () => {
  const p = pista(TOKEN);
  assert.match(p, /^8123….{2} \(\d+ caracteres\)$/);
  assert.ok(!p.includes('AAHfalso'));
});

test('el registro NO escribe el token en el fichero', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-log-'));
  const antes = process.env.ORQUESTADOR_TELEGRAM_TOKEN;
  try {
    process.env.ORQUESTADOR_TELEGRAM_TOKEN = TOKEN;
    const log = crearRegistro({ dirLogs: d, nombre: 'p.log', aPantalla: false });
    log.error(`fallo mandando con ${TOKEN}`);
    const escrito = fs.readFileSync(path.join(d, 'p.log'), 'utf8');
    assert.ok(!escrito.includes('AAHfalso'), 'el token NO puede estar en el registro');
    assert.match(escrito, /tapado/);
  } finally {
    if (antes === undefined) delete process.env.ORQUESTADOR_TELEGRAM_TOKEN;
    else process.env.ORQUESTADOR_TELEGRAM_TOKEN = antes;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('lee el fichero de secretos y respeta lo que ya venía del entorno', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-env-'));
  const f = path.join(d, 'x.env');
  fs.writeFileSync(f, `# comentario\n#ORQUESTADOR_TELEGRAM_TOKEN=comentado\nORQUESTADOR_TELEGRAM_CHAT_ID=123\nOTRA="con comillas"\n`);
  try {
    const entorno = { ORQUESTADOR_TELEGRAM_CHAT_ID: 'yaEstaba' };
    const r = cargarSecretos(f, entorno);
    assert.equal(r.legible, true);
    assert.equal(entorno.ORQUESTADOR_TELEGRAM_CHAT_ID, 'yaEstaba', 'el entorno manda sobre el fichero');
    assert.equal(entorno.OTRA, 'con comillas', 'quita las comillas');
    assert.equal(entorno.ORQUESTADOR_TELEGRAM_TOKEN, undefined, 'las líneas comentadas no cuentan');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('un fichero de secretos que no existe se dice, no revienta', () => {
  const r = cargarSecretos('/no/existe/nada.env', {});
  assert.equal(r.existe, false);
  assert.equal(r.cargadas, 0);
});
