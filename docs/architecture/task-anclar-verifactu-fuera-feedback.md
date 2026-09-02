# Feedback — Anclar la cadena de VERI*FACTU fuera del servidor

- **taskId:** `anclar-verifactu-fuera`
- **intento:** 1
- **veredicto:** ❌ RECHAZADO

## Qué hay que corregir

- [CRITERIO-INCUMPLIDO] Borrar el anclaje más viejo sale VERDE por el botón: el arreglo se aplicó a la mitad del `if` — **Dónde:** `modules/erp/verifactu-anclaje.js:430-431` ```js let raizAnteriorEsperada = limite && ventana.length ? (ventana[0].raiz_anterior || '') : ''; let secuenciaEsperada    = limite && ventana.length ? ventana[0].secuencia          : 1; ``` **Qué pasa:** la condición para relajar el arranque de la cadena es **`limite`**, no «hay algo fuera de
- [SIN-PRUEBAS] Los cinco bloques que miden las pantallas nunca se han ejecutado, y dos de sus aserciones están garantizadas en rojo — **Dónde:** `scripts/verify-verifactu-anclaje.mjs:403` y `:568` **Qué pasa:** mi pasada del gate reproduce exactamente la del programador — `RESULTADO: 110 ✓ · 0 ✗ · 5 ⚠ NO VERIFICADO`, `EXIT=1`. Los cinco ⚠ son los bloques [1b], [2b], [6b], [11] y el final de superadmin: los únicos que tocan una pantalla servida, y los únicos que miden los criterios 4, la segunda mitad del 5 y el 8. Que no se hayan podido correr sin `sudo` está previsto por el plano y no es culpa

El texto completo del revisor está en `task-anclar-verifactu-fuera-review.md`.
