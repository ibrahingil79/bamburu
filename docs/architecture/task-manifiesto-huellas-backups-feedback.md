# Feedback — Manifiesto de huellas del histórico de copias

- **taskId:** `manifiesto-huellas-backups`
- **intento:** 3
- **veredicto:** ❌ RECHAZADO

## Qué hay que corregir

- [NIVEL-INSUFICIENTE] «El destino cambió y el histórico se quedó atrás» sale por la misma boca que «alguien borró tus copias» — y el README promete lo contrario — **Dónde:** `scripts/lib/manifiesto-copias.mjs:379-384` (`mismoMundoQueRegistro`), `:491-498` (la rama `!actual`) y `deploy/systemd/README.md:156-163`. **Qué pasa.** `mismoMundoQueRegistro()` responde «mismo mundo» comparando `modo` y, solo en cifrado, `destino.base`. Cuando esa respuesta es *sí* pero el objeto ya no está donde dice su registro, `destinoDe()` devuelve `null` y el objeto cae en la rama de ausencia (`:491`), que solo sab

El texto completo del revisor está en `task-manifiesto-huellas-backups-review.md`.
