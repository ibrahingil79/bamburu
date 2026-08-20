# LAS COMPROBACIONES QUE NADIE EJECUTA — inventario completo (20 ago 2026)

> **Esto NO es una tarea: es material para que Ibrahin decida.** Ninguna de estas se ha metido en el
> barrido. Se listan porque han aparecido **dos zonas enteras invisibles en el mismo día** —la agenda
> por la mañana, la puerta pública por la tarde— y hacía falta saber si quedaban más esquinas ciegas.
> **Quedan 97.**

## Cómo se ha sacado la lista

Se comparan los ficheros `scripts/{gate,test,verify}-*.mjs` que existen **contra las dos únicas
listas que gobiernan el barrido**: los grupos de `scripts/lib/gates-mapa.mjs` (lo que se ejecuta) y
las declaraciones de `run-gates.mjs` (`EXCLUIDOS`, `ENTORNO`, `DEUDA`, `ROJOS_CONOCIDOS` — lo que se
sabe que no se ejecuta, y por qué). **Lo que no está en ninguna de las dos es invisible**: ni corre,
ni consta que no corra.

```
ficheros de comprobación en scripts/ : 182
dentro del barrido (GRUPOS)          :  78   ← eran 75; las tres de la puerta pública entraron hoy
declarados fuera, con motivo escrito :   9
INVISIBLES                           :  97
```

## Lo que más pesa para decidir: llevan meses sin tocarse

```
último commit  2026-06   44
               2026-07   47
               2026-08    6
```

**91 de las 97 llevan sin tocarse desde junio o julio.** Se escribieron para demostrar una entrega,
se corrieron ese día y nadie las ha vuelto a ejecutar. Es el cuadro exacto de `gate-oficio-pantalla`
—dos días en rojo sin que nadie se enterara— y el de `test-reserva-publica`, que llevaba desde el 18
de agosto en rojo por una cuenta de columnas desactualizada. **La pregunta no es si alguna miente,
sino cuántas.** Meterlas de golpe puede destapar decenas de rojos caducados a la vez.

## El coste, por zonas

| Zona | Nº | Con navegador |
|---|---|---|
| Capa 2 **congelada** (tienda, inventario, pedidos, presupuestos) | 25 | 7 |
| Verifactu / contabilidad / PDF / conciliación | 19 | 2 |
| DISA / voz / vigía / dibujo | 18 | 3 |
| Otras | 17 | 5 |
| Seguridad C5/C6 (2FA, rescate del dueño, cerrojo superadmin, secretos) | 11 | 3 |
| Agenda y citas | 7 | 3 |

**23 usan navegador** — son las caras: gastan cupo del freno de 600 pet./min, que es lo que hoy
limita el paralelismo a 2 a la vez. **74 no**, y esas son baratas. **3 llaman al modelo real**: esas
no van al barrido, van a `EXCLUIDOS` con su motivo, como las cuatro que ya están.

> **El coste de cada una está ESTIMADO por lo que hace el fichero, no medido.** Medirlas serían 97
> ejecuciones, y eso no estaba autorizado en el encargo que produjo esta lista.

## Las 97

| Comprobación | Coste estimado | Sobre qué negocio | Último commit |
|---|---|---|---|
| `gate-avisos-contador-vivo` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-07-10 |
| `gate-avisos-correos` | ~15-60 s · navegador (gasta cupo del freno) | trae su propio negocio | 2026-08-17 |
| `gate-c5-2fa-superadmin` | ~15-60 s · navegador (gasta cupo del freno) | BD temporal / ninguno | 2026-07-16 |
| `gate-c5bis-rescate-duenyo` | ~15-60 s · navegador (gasta cupo del freno) | trae su propio negocio | 2026-07-16 |
| `gate-c5ter-cerrojo-superadmin` | ~15-60 s · navegador (gasta cupo del freno) | BD temporal / ninguno | 2026-07-17 |
| `gate-c6-find-tenant` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `gate-coste-horas-pantalla` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-07-22 |
| `gate-dibujo-pantalla` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-07-20 |
| `gate-espera-pantalla` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-07-20 |
| `gate-inicio-pantalla` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-07-20 |
| `gate-registro-alta` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `gate-voz-pantalla` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-07-20 |
| `test-almacenes` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-14 |
| `test-almacenes-capa2` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-14 |
| `test-avisos-cita` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-27 |
| `test-c2-captura` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-10 |
| `test-c5-2fa-superadmin` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `test-c5-forgot` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `test-c5-sesiones` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `test-c5bis-rescate-duenyo` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `test-c5ter-sin-email` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-17 |
| `test-c6-acceso` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `test-c6-secretos` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-16 |
| `test-citas` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-27 |
| `test-cobros-paso2` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-08 |
| `test-cobros-paso2-1` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-08 |
| `test-codigos-internos` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-09 |
| `test-coincidencia-huecos` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-28 |
| `test-contabilidad` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-26 |
| `test-contabilidad-bienes` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-04 |
| `test-contabilidad-modelos` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-05 |
| `test-contabilidad-pyg` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-05 |
| `test-coste-horas-proyecto` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-22 |
| `test-coste-wac` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-09 |
| `test-dibujo` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
| `test-disa-captura-chat` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-15 |
| `test-disa-clientes-t5` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-10 |
| `test-disa-dictar-compra` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-15 |
| `test-disa-stock` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-15 |
| `test-enlace-cita` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-27 |
| `test-inicio` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
| `test-llm-texto-respuesta` | MODELO REAL — cuesta dinero | BD temporal / ninguno | 2026-08-15 |
| `test-neto-cero-cita` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-27 |
| `test-oficio` | ~2-10 s · lógica | trae su propio negocio | 2026-08-15 |
| `test-oficio-alta` | ~2-10 s · lógica | trae su propio negocio | 2026-08-15 |
| `test-pago-voz-avisos` | ~2-10 s · lógica | BD temporal / ninguno | 2026-08-17 |
| `test-prioridad` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
| `test-registro-alta` | ~2-10 s · lógica | trae su propio negocio | 2026-06-12 |
| `test-stock-pilar3` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-08 |
| `test-textos-citas` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-08-18 |
| `test-vigia` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
| `test-voz` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
| `verify-albaranes` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-24 |
| `verify-albaranes-browser` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-24 |
| `verify-albaranes-disa` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-24 |
| `verify-conciliacion` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-05 |
| `verify-conciliacion-gastos` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-05 |
| `verify-contabilidad-backfill` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-26 |
| `verify-contabilidad-diario-mayor` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-26 |
| `verify-contabilidad-export` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-26 |
| `verify-crm` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-09 |
| `verify-d5-create-product` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-23 |
| `verify-dibujo` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
| `verify-disa-alcance` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-25 |
| `verify-inventory-fix-browser` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-24 |
| `verify-invoice-over-stock` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-23 |
| `verify-invoice-over-stock-http` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-23 |
| `verify-llm-disa-stock` | MODELO REAL — cuesta dinero | BD temporal / ninguno | 2026-07-10 |
| `verify-llm-migracion` | MODELO REAL — cuesta dinero | BD temporal / ninguno | 2026-08-15 |
| `verify-mostrador` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-24 |
| `verify-mostrador-browser` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-24 |
| `verify-mostrador-overstock` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-25 |
| `verify-mostrador-overstock-browser` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-25 |
| `verify-over-stock-ui` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-23 |
| `verify-pdf` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-24 |
| `verify-pdf-http` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-24 |
| `verify-pedidos` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-24 |
| `verify-pedidos-browser` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-24 |
| `verify-pedidos-disa` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-24 |
| `verify-permisos-coherencia` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-25 |
| `verify-permisos-disa` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-25 |
| `verify-pieza-c` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-24 |
| `verify-portal` | ~2-10 s · lógica | negocio de desarrollo | 2026-07-05 |
| `verify-quotes` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-24 |
| `verify-quotes-browser` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-23 |
| `verify-recurrentes` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-05 |
| `verify-suggest-legible` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-23 |
| `verify-sustitutiva` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-24 |
| `verify-sustitutiva-browser` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-06-24 |
| `verify-u3-errores` | ~15-60 s · navegador (gasta cupo del freno) | negocio de desarrollo | 2026-07-07 |
| `verify-verifactu-cadena-nif` | ~2-10 s · lógica | negocio de desarrollo | 2026-07-15 |
| `verify-verifactu-cola` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-09 |
| `verify-verifactu-t1` | ~2-10 s · lógica | BD temporal / ninguno | 2026-06-23 |
| `verify-verifactu-t1-http` | ~2-10 s · lógica | negocio de desarrollo | 2026-06-23 |
| `verify-verifactu-t2` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-05 |
| `verify-vigia` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
| `verify-voz` | ~2-10 s · lógica | BD temporal / ninguno | 2026-07-20 |
