# Auditoría — Arquitectura y estándares profesionales

**Fecha:** 2026-08-31 · **Tipo:** solo lectura, medido sobre código, base de datos y servidor.
**Pregunta:** qué le falta a Bamburu para ser profesional de verdad.

## Qué está bien hecho

**Aislamiento entre negocios — de los mejores posibles.** Un fichero SQLite por negocio. No es una
columna `tenant_id` que alguien puede olvidar filtrar: separa el sistema operativo. La auditoría del
Eje C lo llamó «sólido y falla cerrado». **Salesforce tiene un aislamiento más débil**: sus miles de
organizaciones por instancia comparten tablas y se separan por `OrgID` en el `WHERE`.

**Cadena legal VERI\*FACTU.** Huella encadenada, registros inmutables, documentos históricos que no
se reescriben. Y una regla escrita que casi nadie tiene: «nunca destruir datos de un tenant;
archivar, no borrar».

**Backups (desde S6) por encima de la media del sector.** Dos copias diarias en dos cuentas,
verificación MD5 real contra el fichero subido, prueba de restore que abre cada artefacto, heartbeat
que distingue una caída de dos, dead-man's-switch externo.

**Registro de actividad inmutable de verdad.** 7.001 filas y **cero `UPDATE`/`DELETE` sobre
`activity_logs` en todo el código**.

**Superficie de dependencias mínima.** 8 paquetes de producción. `npm audit`: **0 críticas, 0 altas**
(2 moderadas).

**Disciplina de trabajo.** `TABLERO.md` con la historia razonada de cada decisión, reglas nacidas de
fallos medidos, auditoría de seguridad propia con severidades y `file:line`.

## Qué está mal o flojo

**1 · No hay roles; hay permisos sueltos por persona.** Las tablas `roles`, `role_permissions` y
`user_roles` **no existen** en la base de negocio. Hay 55 filas de `user_permissions` para 9
usuarios: una casilla por persona y permiso. Con 9 usuarios se sostiene; con 500 negocios de 5
empleados es ingobernable, y no se puede auditar «quién accede a facturación» sin recorrer usuario
por usuario. Odoo y Salesforce usan perfiles/grupos con herencia.

**2 · Las rutas no comprueban permisos de forma uniforme.** De **1.025 definiciones de ruta** en
`modules/`, **425 llevan `requirePerm` en la misma línea y 600 no**. Algunas comprobarán dentro del
handler — y ese es el problema: nadie lo sabe. Es el «Permisos Paso 1» pendiente desde el 14 jun.
Precedente real: la compra directa solo exigía sesión (detectado 10 jun en C1.a).

**3 · Datos personales en claro, en todas partes.** Bases de negocio **sin cifrar** (0 referencias a
SQLCipher). Backups **sin cifrar** (0 referencias a GPG o `rclone crypt`). Y desde S6 esas copias
están en **dos Google Drive personales**. Dentro: 203 clientes y 922 facturas reales, y la tabla
`hc_consentimientos` ya creada en cada base, que guardará **datos de salud (RGPD art. 9)**.

> **⚙️ CORRECCIÓN ANOTADA EL 1 SEP 2026 (tarea `cifrado-copias-seguridad`).** Esta auditoría está
> fechada y no se reescribe; se anota la corrección con su fecha, que es el método del repo.
> **La mitad de los backups ya no es cierta:** las copias van a un remote `rclone crypt` (contenido y
> nombres), y `scripts/bamburu-backup.sh` aborta si el destino no es cifrado.
> **La mitad de las bases en reposo sigue entera:** es otra tarea (`cifrado-en-reposo-bases`), a
> propósito después — son dos interruptores distintos.

**4 · No hay derecho al olvido ni portabilidad.** Cero código de anonimización, borrado por petición
o exportación de los datos de un cliente. No son extras: son obligaciones. Y **colisionan con la
regla de no destruir datos**, así que hay que diseñar cómo conviven — es una decisión, no
programación.

**5 · No se ve nada de lo que pasa.** Cero CI (`.github/workflows` no existe). Cero logging
estructurado (**22 `console.log` en producción**). Sin métricas ni trazas. Los 267 gates existen y se
ejecutan a mano.

**6 · La API no es una API.** 611 rutas, **sin versionado** (`/api/v1` no aparece), **sin
OpenAPI/Swagger**, `zod` en **16 sitios**.

**7 · Hallazgos de julio abiertos.** `unsafe-inline` en la CSP (8 usos) · 2 vulnerabilidades
moderadas · `NoNewPrivileges` sin activar · cookie `btenant` elige base sin autenticación cuando no
hay sesión (riesgo asumido con fecha).

## Qué necesita cambiar

**Primero — roto y barato**
1. Cifrar los backups (`rclone crypt`). Configuración, no programación. Mayor exposición actual.
2. Los cuatro temporizadores que abren en escritura cada hora → solo lectura donde solo leen.
3. Cerrar el «Permisos Paso 1»: recorrer las 600 rutas y dejar escrito qué permiso exige cada una.

**Segundo — lo que falta para ser profesional**
4. Roles heredados (patrón Odoo).
5. RGPD como función: exportar, borrar, anonimizar + política de retención, resolviendo antes la
   convivencia con la inmutabilidad fiscal.
6. Cifrado en reposo de las bases.
7. Observabilidad: logger estructurado, métricas, CI que ejecute los gates en cada push.
8. API con contrato: versionado, OpenAPI, validación en todas las entradas.
9. Ensayo de recuperación completo cronometrado, con RTO/RPO escrito.

**Tercero — Postgres.** No resuelve nada de lo anterior. Ver
`docs/rendimiento/analisis-migracion-postgres.md`. Recomendación: el último, no el primero.

## En una frase

Bamburu tiene los cimientos raros —aislamiento fuerte, cadena legal íntegra, registro inmutable,
disciplina escrita— y le faltan los acabados que se dan por supuestos: roles, cifrado, RGPD,
observabilidad y contrato de API. Migrar a Postgres ahora sería cambiar los cimientos dejando los
acabados sin poner.
