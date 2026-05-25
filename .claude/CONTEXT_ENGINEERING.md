# Context Engineering — Bamburu

## REGLAS DE ORO

1. **Lee session.json** al inicio de cada sesión nueva
2. **Plan Mode** para cualquier sprint o tarea > 3 pasos
3. **Stop Hook** antes de marcar una tarea como DONE
4. **Compacta** si llevas > 15 tool calls en la sesión
5. **Actualiza session.json** tras completar cada tarea

## ESTRUCTURA DEL PROYECTO

- `modules/erp/` — Panel de administración
- `modules/store/` — Tienda pública
- `modules/disa/` — Agente IA (DISA)
- `core/` — Auth, CSRF, validación, TOTP, Resend
- `data/` — Bases de datos SQLite por tenant

## CONVENCIONES

- Hono.js: `c.req`, `c.get('session')`, `c.html()`, `c.redirect()`
- SQLite: better-sqlite3 síncrono (no await en queries)
- Auth: `admin_users` en cada tenant DB (no en control.db)
- Migraciones: lazy, via `runMigrations(db)` en tenant-middleware
- Emails: Resend SDK → `{ data, error }` — NO lanza excepciones
- Node.js: `/usr/local/bin/node-bamburu` v22.22.3 (NVM del usuario bamburu)

## FLUJO DE SPRINT

1. Lee `session.json` → contexto actual
2. Entra en Plan Mode → diseño
3. Implementa → prueba → documenta
4. Actualiza `TAREAS.md` y `MAPA_FUNCIONAL.md`
5. Actualiza `session.json`

## ERRORES CONOCIDOS Y SOLUCIONES

| Error | Causa | Fix |
|-------|-------|-----|
| better-sqlite3 version mismatch | npm del sistema usa Node v10 | `sudo bash -c "source /home/bamburu/.nvm/nvm.sh && PYTHON=/usr/bin/python3.11 npm rebuild better-sqlite3"` |
| Resend no lanza errores | SDK retorna `{ data, error }` | Destructurar y checkear `error` |
| Columnas 2FA faltantes en tenants | Lazy migration | `curl -H "Host: {slug}.bamburu.com" http://localhost:3000/admin/login` |
| reset-password "Negocio no encontrado" | Host hardcodeado | `c.req.header('host')` para construir URL |
