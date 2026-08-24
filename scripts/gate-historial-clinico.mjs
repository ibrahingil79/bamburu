#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// HISTORIAL CLÍNICO · PELDAÑO 8 — pulsando de verdad, en dos negocios.
//
// Se traen DOS negocios desechables: uno de oficio SALUD y otro de TALLER. El de taller existe para
// probar lo que NO se ve, que es la mitad del encargo: en un negocio que no es de salud no aparece
// nada — ni menú, ni pestaña, ni ruta.
//
// Todo lo que este gate crea nace y muere en esos dos negocios. Son datos de salud de mentira, pero
// se tratan como los de verdad: no se escriben en el negocio de nadie.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer-core';
import { launchOpts, exigeCodigoServido } from './lib/gate-env.mjs';
import { negocioDesechable } from './lib/negocio-desechable.mjs';
import { fijarOficio } from '../modules/erp/oficios.js';
import { menuDeUsuario } from '../modules/erp/menu.js';
import { evaluateQueryAccess, QUERY_PROTECTED_TABLES } from '../modules/disa/index.js';
import { filtrarPorPermiso, SIN_PERMISO_DECLARADO } from '../core/correo-equipo.js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

exigeCodigoServido();

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };
const dormir = ms => new Promise(r => setTimeout(r, ms));
const RAIZ = '/home/ubuntu/bamburu';

const salud = await negocioDesechable('Gate HC Salud');
const taller = await negocioDesechable('Gate HC Taller');
let nav;

try {
  fijarOficio(salud.db, 'salud');
  fijarOficio(taller.db, 'taller');

  const paciente = salud.db.prepare("INSERT INTO clients (name, email, active) VALUES ('Juan Paciente', 'juan@test.local', 1)").run().lastInsertRowid;
  const dueñoTok = salud.sesion();

  // Un ADMIN sin el permiso, y una RECEPCIÓN con permisos corrientes: los dos tienen que quedarse fuera.
  const mk = (nombre, rol) => salud.db.prepare(
    "INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,'x',?,1)"
  ).run(nombre, nombre.toLowerCase().replace(/\s+/g, '') + '@test.local', rol).lastInsertRowid;
  const adminId = mk('Ana Admin', 'admin');
  const recepId = mk('Rosa Recepcion', 'employee');
  const permId = salud.db.prepare("SELECT id FROM permissions WHERE module='clients' AND action='read'").get()?.id;
  if (permId) salud.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(recepId, permId);
  const adminTok = salud.sesion(adminId);
  const recepTok = salud.sesion(recepId);

  nav = await puppeteer.launch(launchOpts());
  const abre = async (tok, host) => {
    const ctx = await nav.createBrowserContext();
    const p = await ctx.newPage();
    await p.setCookie({ name: 'asess', value: tok, domain: host, path: '/' });
    return p;
  };
  const hostS = new URL(salud.base).hostname, hostT = new URL(taller.base).hostname;

  // ── [1] UN NEGOCIO QUE NO ES DE SALUD NO VE NADA ────────────────────────────────────────────
  console.log('\n[1] EN UN TALLER NO EXISTE NADA DE ESTO');
  {
    const cliT = taller.db.prepare("INSERT INTO clients (name, active) VALUES ('Cliente Taller', 1)").run().lastInsertRowid;
    const pT = await abre(taller.sesion(), hostT);
    await pT.goto(taller.base + '/admin/clients/' + cliT, { waitUntil: 'networkidle2' });
    const txt = await pT.evaluate(() => document.body.innerText);
    ok(!/Historial clínico/i.test(txt), 'la ficha de un cliente de taller NO ofrece historial');
    const r = await pT.goto(taller.base + '/admin/historial/' + cliT, { waitUntil: 'networkidle2' });
    ok(r.status() === 404, 'forzando la dirección, /admin/historial da 404 en un taller', String(r.status()));
    const men = menuDeUsuario(taller.db, { role: 'owner', perms: [] });
    const todas = [...men.areas.flatMap(a => a.todos), ...men.config.flatMap(s => s.items), ...men.fijas, ...men.cuenta];
    ok(!todas.some(i => i.key === 'historial-accesos'), 'y no hay ninguna entrada de menú');
    await pT.close();
  }

  // ── [2] SIN CONSENTIMIENTO NO SE ESCRIBE, Y SE EXPLICA ──────────────────────────────────────
  console.log('\n[2] SIN AUTORIZACIÓN NO SE ESCRIBE');
  const pD = await abre(dueñoTok, hostS);
  await pD.goto(salud.base + '/admin/historial/' + paciente, { waitUntil: 'networkidle2' });
  let txt = await pD.evaluate(() => document.body.innerText);
  ok(/no ha autorizado/i.test(txt), 'la pantalla dice que el paciente no ha autorizado nada');
  ok(/Pídeselo/i.test(txt), '  y dice qué hacer, sin jerga legal');
  const desactivados = await pD.evaluate(() => document.querySelectorAll('form[action*="/nota"] [disabled], form[action*="/antecedentes"] [disabled]').length);
  ok(desactivados > 0, '  y los campos de escritura están cerrados', desactivados + ' campos');
  {
    const { guardarAntecedentes } = await import('../modules/erp/historial.js');
    let bloqueado = false;
    try { guardarAntecedentes(salud.db, paciente, { antecedentes: 'x' }, { userId: 1, userNombre: 'X' }); }
    catch (e) { bloqueado = /no ha autorizado|no se puede escribir/i.test(e.message); }
    ok(bloqueado, '  y el MOTOR lo impide también, no solo la pantalla (forzar la ruta no sirve)');
  }

  // ── [3] EL ADMIN SIN PERMISO NO ENTRA — la excepción del encargo ────────────────────────────
  console.log('\n[3] UN ADMINISTRADOR SIN EL PERMISO NO ENTRA');
  {
    const pA = await abre(adminTok, hostS);
    await pA.goto(salud.base + '/admin/clients/' + paciente, { waitUntil: 'networkidle2' });
    const t = await pA.evaluate(() => document.body.innerText);
    ok(!/Historial clínico/i.test(t), 'un admin sin el permiso NO ve la pestaña en la ficha');
    const r = await pA.goto(salud.base + '/admin/historial/' + paciente, { waitUntil: 'networkidle2' });
    ok(r.status() === 403, '  y forzando la dirección recibe 403', String(r.status()));
    await pA.close();
  }
  console.log('\n[4] RECEPCIÓN TAMPOCO, POR DEFECTO');
  {
    const pR = await abre(recepTok, hostS);
    const r = await pR.goto(salud.base + '/admin/historial/' + paciente, { waitUntil: 'networkidle2' });
    ok(r.status() === 403, 'recepción, con permisos corrientes, recibe 403', String(r.status()));
    const men = menuDeUsuario(salud.db, { role: 'employee', perms: ['clients.read'] });
    const todas = [...men.areas.flatMap(a => a.todos), ...men.config.flatMap(s => s.items)];
    ok(!todas.some(i => i.key === 'historial-accesos'), '  y no ve la entrada de menú');
    await pR.close();
  }

  // ── [5] CON AUTORIZACIÓN: SE ESCRIBE, Y QUEDA RASTRO ────────────────────────────────────────
  console.log('\n[5] CON AUTORIZACIÓN SE ESCRIBE — y todo deja rastro');
  await pD.goto(salud.base + '/admin/historial/' + paciente, { waitUntil: 'networkidle2' });
  await pD.evaluate(() => { const d = document.querySelector('details'); if (d) d.open = true; });
  await pD.evaluate(() => { const f = document.querySelector('form[action*="/consentimiento"]'); if (f) f.submit(); });
  await dormir(900);
  txt = await pD.evaluate(() => document.body.innerText);
  ok(/Autorización recogida/i.test(txt), 'recogida la autorización, la pantalla lo dice con su fecha y quién');

  const { guardarAntecedentes, crearNota, accesosDe, copiaParaPaciente } = await import('../modules/erp/historial.js');
  guardarAntecedentes(salud.db, paciente, { motivo_consulta: 'Lumbalgia', alergias: 'Ninguna' }, { userId: 2, userNombre: 'Dueña' });
  guardarAntecedentes(salud.db, paciente, { motivo_consulta: 'Lumbalgia crónica', alergias: 'Ninguna' }, { userId: 2, userNombre: 'Dueña' });
  const nota1 = crearNota(salud.db, paciente, { fecha: '2026-08-20', valoracion: 'Dolor lumbar 6/10',
    tratamiento: 'Terapia manual', siguiente_paso: 'Revisión en una semana',
    privado: 'SECRETO-PROFESIONAL-XYZ' }, { userId: 2, userNombre: 'Dueña' });
  ok(nota1 > 0, 'se escribe una nota de sesión con su anotación privada');

  // ── [6] CORREGIR CONSERVA LO ANTERIOR ───────────────────────────────────────────────────────
  console.log('\n[6] CORREGIR NO PISA');
  crearNota(salud.db, paciente, { fecha: '2026-08-20', valoracion: 'Dolor lumbar 4/10 (corregido)',
    corrige_nota_id: nota1 }, { userId: 2, userNombre: 'Dueña' });
  await pD.goto(salud.base + '/admin/historial/' + paciente, { waitUntil: 'networkidle2' });
  txt = await pD.evaluate(() => document.body.innerText);
  ok(/Dolor lumbar 6\/10/.test(txt) && /corregido/i.test(txt),
     'la nota corregida SIGUE VISIBLE junto a su corrección');
  ok(/se conserva/i.test(txt), '  y la pantalla dice que se conserva');
  const vers = salud.db.prepare('SELECT COUNT(*) n FROM hc_antecedentes WHERE client_id=?').get(paciente).n;
  ok(vers === 2, 'editar los antecedentes guardó una versión nueva sin pisar la anterior', vers + ' versiones');

  // ── [7] LA COPIA DEL PACIENTE NO LLEVA LO PRIVADO ───────────────────────────────────────────
  console.log('\n[7] LA COPIA DEL PACIENTE');
  await pD.goto(salud.base + '/admin/historial/' + paciente + '/copia', { waitUntil: 'networkidle2' });
  const copia = await pD.evaluate(() => document.body.innerText);
  ok(/Dolor lumbar/.test(copia), 'la copia lleva la evolución');
  ok(!/SECRETO-PROFESIONAL-XYZ/.test(copia), '  y NO lleva la anotación privada');
  ok(/no incluye las anotaciones/i.test(copia), '  y lo dice en el propio papel');
  {
    const d = copiaParaPaciente(salud.db, paciente);
    ok(!JSON.stringify(d).includes('SECRETO-PROFESIONAL-XYZ'),
       '  y el motor NI SIQUIERA LEE la columna privada (no es un filtro: no se carga)');
  }

  // ── [8] EL REGISTRO DE ACCESOS ──────────────────────────────────────────────────────────────
  console.log('\n[8] QUIÉN ABRIÓ QUÉ');
  const acc = accesosDe(salud.db, { clientId: paciente });
  ok(acc.some(a => a.accion === 'abrir'), 'abrir el historial dejó rastro');
  ok(acc.some(a => a.accion === 'exportar'), 'generar la copia dejó rastro');
  ok(acc.some(a => a.accion === 'escribir'), 'escribir dejó rastro');
  ok(!acc.some(a => (a.detalle || '').includes('SECRETO-PROFESIONAL-XYZ') || (a.detalle || '').includes('Lumbalgia')),
     '  y el registro NO guarda contenido clínico, solo qué se hizo');
  await pD.goto(salud.base + '/admin/historial/accesos', { waitUntil: 'networkidle2' });
  const reg = await pD.evaluate(() => document.body.innerText);
  ok(/abrió el historial de/i.test(reg) && /Juan Paciente/.test(reg),
     'la pantalla lo cuenta en cristiano');
  {
    // NO SE PUEDE EDITAR NI BORRAR DESDE LA APLICACIÓN: se mide sobre el código, no de palabra.
    const malos = [];
    const barrer = d => { for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { barrer(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const src = readFileSync(p, 'utf8');
      for (const l of src.split('\n')) {
        if (/^\s*(\/\/|\*)/.test(l)) continue;
        if (/(DELETE\s+FROM|UPDATE)\s+hc_accesos/i.test(l)) malos.push(p.replace(RAIZ + '/', ''));
      }
    } };
    barrer(join(RAIZ, 'modules')); barrer(join(RAIZ, 'core'));
    ok(malos.length === 0, 'no hay en toda la aplicación un UPDATE ni un DELETE contra el registro', malos.join(', ') || 'ninguno');
  }

  // ── [9] POR DÓNDE NO PUEDE SALIR ────────────────────────────────────────────────────────────
  console.log('\n[9] POR DÓNDE NO SALE');
  {
    for (const t of ['hc_consentimientos', 'hc_antecedentes', 'hc_notas', 'hc_accesos']) {
      ok(QUERY_PROTECTED_TABLES.has(t), 'DISA tiene protegida la tabla ' + t);
    }
    // Y la prueba que de verdad importa: ni el DUEÑO puede sacarlo por chat.
    const veredicto = evaluateQueryAccess('SELECT * FROM hc_notas', { isAdmin: true, allTables: ['hc_notas'], hasPerm: () => true });
    ok(typeof veredicto === 'string' && /protegida/i.test(veredicto),
       'ni el dueño puede pedírselo a DISA por chat', veredicto || '(¡pasó!)');
    // Ninguna tabla del historial en la allowlist de ESCRITURA de DISA.
    const disa = readFileSync(join(RAIZ, 'modules/disa/index.js'), 'utf8');
    const wt = disa.slice(disa.indexOf('const WRITABLE_TABLES'), disa.indexOf('const WRITABLE_TABLES') + 900);
    ok(!/hc_/.test(wt), '  y ninguna está en la lista de tablas que DISA puede escribir');
    // Ni en los listados, ni en la analítica, ni en el portal.
    for (const [f, etq] of [['modules/erp/routes/listados.js', 'los listados imprimibles'],
                            ['modules/erp/constructor-analitica.js', 'el constructor de analítica'],
                            ['modules/portal/index.js', 'el portal del cliente']]) {
      ok(!/hc_/.test(readFileSync(join(RAIZ, f), 'utf8')), 'no aparece en ' + etq);
    }
  }
  // EL CORREO: se compone un bloque con contenido clínico y se exige que la puerta lo tire.
  {
    let reventó = false;
    try { filtrarPorPermiso([{ perm: undefined, texto: 'Lumbalgia' }], () => true); }
    catch (_) { reventó = true; }
    ok(reventó, 'un bloque de correo sin permiso declarado REVIENTA (falla cerrado)');
    const bloques = [{ perm: 'historial.read', texto: 'Lumbalgia crónica de Juan' },
                     { perm: 'invoices.read', texto: 'Has facturado 1.234,56 €' }];
    const puedeEmpleado = p => p !== 'historial.read';
    const { quedan, fuera } = filtrarPorPermiso(bloques, puedeEmpleado);
    const correo = quedan.map(b => b.texto).join('\n');
    ok(fuera.some(f => f.perm === 'historial.read'),
       'la puerta APARTA el bloque del historial y dice cuál apartó', JSON.stringify(fuera));
    ok(!/Lumbalgia/.test(correo), 'el correo de quien NO tiene el permiso no lleva ni una palabra del historial');
    console.log('      ── el correo entero que le llegaría ──');
    for (const l of (correo || '(vacío)').split('\n')) console.log('      | ' + l);
  }

  // ── [10] NINGÚN BORRADO AUTOMÁTICO ──────────────────────────────────────────────────────────
  console.log('\n[10] NADIE BORRA SOLO');
  {
    const sospechas = [];
    const barrer = d => { for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { barrer(p); continue; }
      if (!/\.(js|mjs|sh)$/.test(e.name)) continue;
      const src = readFileSync(p, 'utf8');
      for (const l of src.split('\n')) {
        if (/^\s*(\/\/|#|\*)/.test(l)) continue;
        if (/DELETE\s+FROM\s+hc_(notas|antecedentes|consentimientos)/i.test(l)
            && !/borrarHistorial/.test(src.slice(Math.max(0, src.indexOf(l) - 400), src.indexOf(l)))) {
          sospechas.push(p.replace(RAIZ + '/', '') + ': ' + l.trim().slice(0, 60));
        }
      }
    } };
    barrer(join(RAIZ, 'modules')); barrer(join(RAIZ, 'core')); barrer(join(RAIZ, 'scripts'));
    ok(sospechas.length === 0, 'el único borrado del historial es el manual del dueño', sospechas.slice(0, 3).join(' · ') || 'ninguno más');
    const units = readdirSync('/etc/systemd/system').filter(f => /bamburu/.test(f));
    const conHc = units.filter(u => { try { return /hc_|historial/i.test(readFileSync('/etc/systemd/system/' + u, 'utf8')); } catch { return false; } });
    ok(conHc.length === 0, 'y ningún temporizador del sistema lo toca', conHc.join(', ') || units.length + ' unidades miradas');
  }

  await pD.close();
} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + (e.stack || ''));
} finally {
  if (nav) await nav.close().catch(() => {});
  salud.tirar(); taller.tirar();
  console.log('\n  [limpieza] los dos negocios de prueba, tirados enteros');
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
