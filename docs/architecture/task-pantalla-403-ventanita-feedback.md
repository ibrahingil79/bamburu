# Feedback — La pantalla de «no tienes permiso» abre una ventanita sobre una página en blanco

- **taskId:** `pantalla-403-ventanita`
- **intento:** 1
- **veredicto:** ❌ RECHAZADO

## Qué hay que corregir

- No tengo ningún reparo de nivel. **`NIVEL-INSUFICIENTE` no aplica.** — ---
- [SIN-PRUEBAS] El gate del Bloque D no se ha ejecutado nunca, ni se ha mirado su captura — **Dónde:** `scripts/gate-403-permiso.mjs` (fichero entero) · criterios de aceptación 6, 3 y la segunda mitad del 7. **Qué pasa:** el gate se entrega **sin haberse corrido una sola vez**. `node --check` pasa y el código se lee bien, pero eso no dice si pasa: no consta que sus 20 aserciones se cumplan, ni que la siembra y la limpieza por la marca funcionen contra la BD real, ni que la neutralización de `alert`/`prompt`/ `confirm` en `evaluateOnNewDocument` devuelva 0 diálogos, ni que el enlace de salida ten

El texto completo del revisor está en `task-pantalla-403-ventanita-review.md`.
