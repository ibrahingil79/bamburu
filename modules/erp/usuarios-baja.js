// ════════════════════════════════════════════════════════════════════════════════════════════════
// DAR DE BAJA A ALGUIEN DEL EQUIPO — borrar o archivar, y por qué
//
// LA MISMA REGLA QUE CLIENTES Y PRODUCTOS, que es la del proyecto entero: lo que no ha dejado rastro
// se BORRA; lo que sí lo ha dejado se ARCHIVA. Nunca se destruye el rastro para poder borrar la
// ficha — un apunte de auditoría, una cita atendida o unas horas fichadas son hechos del negocio, y
// no se reescriben hacia atrás porque alguien se vaya.
//
// LO QUE HABÍA ANTES (medido el 24 ago 2026, pulsando el botón en un navegador con sesión de dueño):
// el botón «Eliminar» existía y hacía `DELETE FROM admin_users` a pelo. Con un empleado SIN ningún
// permiso funcionaba; **con un solo permiso devolvía HTTP 500 «Ha ocurrido un error, inténtalo de
// nuevo» y el usuario seguía ahí**, porque `user_permissions` tiene clave ajena y nadie la soltaba.
// Como cualquier empleado útil tiene permisos, en la práctica NO SE PODÍA BORRAR NINGUNO, y el aviso
// que daba la pantalla no decía nada de nada.
//
// LAS DOS LISTAS DE ABAJO SON LA DECISIÓN, y están separadas a propósito:
//   · HUELLA — si hay una sola fila aquí, la persona se ARCHIVA. Es rastro del negocio.
//   · SUYO   — cosas de su cuenta y de su configuración. Se sueltan al borrar, y solo entonces.
// Una tabla que no esté en ninguna de las dos NO cuenta como huella: por eso la de huella se escribe
// mirando el esquema, y la comprobación exige que siga cubriendo lo que importa.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Rastro del NEGOCIO. Cada entrada lleva el nombre en cristiano con el que se le explica al dueño.
export const HUELLA = [
  ['activity_logs',        'user_id',        'apuntes en el registro de actividad'],
  ['citas',                'user_id',        'citas atendidas'],
  ['citas',                'created_by',     'citas creadas'],
  ['time_entries',         'user_id',        'horas registradas'],
  ['fichajes',             'user_id',        'fichajes de entrada y salida'],
  ['crm_tareas',           'user_id',        'tareas comerciales'],
  ['crm_tareas',           'created_by',     'tareas comerciales creadas'],
  ['proyectos',            'responsable_id', 'proyectos de los que es responsable'],
  ['client_notes',         'user_id',        'notas en fichas de cliente'],
  ['client_contacts',      'user_id',        'contactos registrados con clientes'],
  ['importaciones',        'user_id',        'importaciones de datos'],
  ['migracion_peticiones', 'user_id',        'peticiones de migración'],
  ['bono_consumos',        'user_id',        'consumos de bono'],
  ['analytics_panels',     'user_id',        'informes guardados'],
  ['analytics_medidas',    'user_id',        'medidas propias'],
  ['financial_targets',    'user_id',        'objetivos fijados'],
];

// Cosas de SU cuenta: se sueltan al borrar. No son rastro del negocio, son ajustes de la persona.
export const SUYO = [
  ['user_permissions',           'admin_user_id'],
  ['admin_sessions',             'user_id'],
  ['password_reset_tokens',      'admin_user_id'],
  ['admin_recovery_codes',       'admin_user_id'],
  ['avisos_pref_usuario',        'admin_user_id'],
  ['resumen_envios',             'admin_user_id'],
  ['alert_seen_user',            'user_id'],
  ['disa_quick_chips',           'user_id'],
  ['disa_conversation_threads',  'user_id'],
  ['horario_tramos',             'user_id'],
  ['horario_excepciones',        'user_id'],
  ['agenda_bloqueos',            'user_id'],
  ['service_providers',          'user_id'],
  ['cita_pub_personas',          'user_id'],
  ['user_roles_archived',        'admin_user_id'],
];

const cuenta = (db, tabla, col, id) => {
  try { return db.prepare(`SELECT COUNT(*) n FROM ${tabla} WHERE ${col}=?`).get(id).n; }
  catch { return 0; }   // tabla que este negocio todavía no tiene: no cuenta
};

// Qué rastro ha dejado esta persona, con su nombre en cristiano y su número. Es lo que la pantalla
// enseña ANTES de que el dueño pulse: nada de un error seco después.
export function huellaDe(db, userId) {
  const partes = [];
  for (const [tabla, col, nombre] of HUELLA) {
    const n = cuenta(db, tabla, col, userId);
    if (n) partes.push({ tabla, col, nombre, n });
  }
  return partes;
}

// LA DECISIÓN, en un solo sitio, para que la pantalla y la API no puedan discrepar.
// Devuelve qué va a pasar, por qué, y con qué palabras contárselo al dueño.
export function decidirBaja(db, userId) {
  const u = db.prepare('SELECT id, name, email, role, active FROM admin_users WHERE id=?').get(userId);
  if (!u) return { existe: false };

  const huella = huellaDe(db, userId);
  const accion = huella.length ? 'archivar' : 'borrar';
  const total = huella.reduce((s, h) => s + h.n, 0);

  // Las palabras las pone el motor, no la pantalla: si mañana cambia la regla, cambia el texto con
  // ella y no se quedan contando cosas distintas.
  const titulo = accion === 'borrar' ? 'Borrar a ' + (u.name || 'esta persona') : 'Archivar a ' + (u.name || 'esta persona');
  const texto = accion === 'borrar'
    ? 'No ha hecho nada en el negocio: ni una factura, ni una cita, ni un apunte. Se BORRA del todo, '
      + 'con sus permisos y sus ajustes. Esto no se puede deshacer.'
    : 'Tiene rastro en el negocio (' + huella.map(h => h.n + ' ' + h.nombre).join(', ') + '), así que '
      + 'NO se borra: se ARCHIVA. Pierde el acceso ahora mismo, desaparece de las listas y de los '
      + 'desplegables, y todo lo que hizo se queda intacto. Puedes recuperarla cuando quieras.';
  const aceptar = accion === 'borrar' ? 'Sí, borrarla' : 'Sí, archivarla';

  return { existe: true, usuario: { id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active },
           accion, huella, total, titulo, texto, aceptar };
}

// Ejecuta la baja. `revocarSesiones` lo inyecta quien llama (vive en las rutas, con el espejo de
// sesiones del panel de control): así este módulo no arrastra media aplicación detrás.
export function ejecutarBaja(db, userId, { revocarSesiones } = {}) {
  const d = decidirBaja(db, userId);
  if (!d.existe) return { ok: false, error: 'Usuario no encontrado', status: 404 };

  if (d.accion === 'archivar') {
    db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(userId);
    // LA SESIÓN CAE EN SU SIGUIENTE CLIC, igual que al desactivar. Archivar a alguien y dejarle la
    // sesión viva sería quitarle el acceso solo de boquilla.
    if (revocarSesiones) revocarSesiones(db, userId);
    return { ok: true, accion: 'archivar', mensaje: 'Archivada. Pierde el acceso y su rastro se queda.', huella: d.huella };
  }

  // BORRAR: primero lo suyo, después la persona. En una transacción: media baja es peor que ninguna.
  const hacer = db.transaction(() => {
    for (const [tabla, col] of SUYO) {
      try { db.prepare(`DELETE FROM ${tabla} WHERE ${col}=?`).run(userId); } catch { /* tabla ausente */ }
    }
    db.prepare('DELETE FROM admin_users WHERE id=?').run(userId);
  });
  if (revocarSesiones) revocarSesiones(db, userId);   // antes de soltar las filas, para leer sus tokens
  hacer();
  return { ok: true, accion: 'borrar', mensaje: 'Borrada del todo.', huella: [] };
}
