# U1 — Diagnóstico de tokens (SOLO LECTURA)

> Eje A · UX · tarea **U1** (Sistema visual coherente). Diagnóstico previo a migrar, hecho el
> 2026-07-05 sobre el checkout productivo **`/home/ubuntu/bamburu`** (el servicio `bamburu.service`
> corre desde aquí, user `ubuntu`; la ruta `/home/ibrahin/bamburu` de CLAUDE.md ya **no existe**).
> Método: grep de hex/inline/`var(--…)` sobre `modules/erp/**`, `modules/portal/**`, `modules/disa/**`.
> No cambia nada: solo mide y decide el plan. `modules/store/**` queda **excluido** (Capa 2 congelada).

## 0. Resumen en una línea
La **capa de tokens ya existe y está casi cerrada** (`modules/erp/layout.js` `:root`, ~40 tokens que
coinciden con DISEÑO.md §2). El trabajo real de U1 es **migración**: ~**700 hex** y **cientos de
estilos inline** repartidos por las vistas, más **3 superficies con shell propio** (login, portal,
widget DISA) que no consumen los tokens. Antes de migrar hay que (a) tapar 1 fuga de token y (b)
decidir 5 familias de color que hoy no tienen token.

---

## 1. Capa de tokens: estado actual

**Definidos en `layout.js` `:root`** (fuente única de la app admin): `--bg --bg2 --bg3 --card
--border --border2 --text --text2 --text3 --body-tx --accent --accent-d --accent-soft --grp --muted
--p --teal --teal-d --teal-soft --teal-glow --danger --danger-s --warn --warn-s --ok --ok-s --chrome
--chrome-tx --chrome-tx-on --chrome-ic --chrome-grp --chrome-active --chrome-div --brand --sw --sw-exp
--radius --radius-lg`.

Cotejo con DISEÑO.md §2: **coinciden** (superficies `--bg2/--bg3/--card`, estados `--danger/--warn/--ok`
con sus `-s`, chrome grafito `#20242F`, acento slate `#334155`, cero teal). `--card` ya está definido
(#FFFFFF), así que el viejo fallback oscuro `var(--card,#1e1e1e)` ya nunca dispara.

### 1.1 Fugas / defectos de la capa (a tapar en el paso "cerrar tokens")
| # | Problema | Dónde | Acción |
|---|---|---|---|
| T-1 | **`--input-bg` usado pero NO definido** → cae al fallback silencioso `#F3F4F6` | `routes/security.js:58` | Definir `--input-bg` (o remapear el uso a `--bg3`). Es la única fuga real. |
| T-2 | Comentario de provenance desactualizado: dice `mockup-aprobado.html` | `layout.js:230` | DISEÑO.md §2 dice que la fuente de verdad es `sistema-visual-aprobado.html`. Corregir el comentario (cosmético). |
| T-3 | Fallbacks muertos `var(--ok,#127a3a)`, `var(--danger,#c00)`, `var(--warn,#b58100)`, `var(--bg2,#f6f6f8)` | varias vistas | Los tokens existen → el fallback nunca dispara, pero es hex hardcodeado que cuenta para el criterio "0 hex". Limpiar el 2º argumento al migrar. |

**Ningún otro token usado queda sin definir.** Salvo `--input-bg`, no hay fallback silencioso.

---

## 2. Dónde están los hex (mapa por archivo)

Total hex medidos (normalizado, sin contar el `:root` de `layout.js` como "hardcode"):

| Superficie | Archivos con más hex |
|---|---|
| **Admin — vistas** | `settings 85` · `pedidos 79` · `purchase-orders 55` · `quotes 51` · `orders 38` · `albaranes 29` · `contabilidad 20` · `mostrador 19` · `invoices 14` · `verifactu-envio 13` · `conciliacion 8` · `security 6` · `inventory 6` · `analytics 5` · resto (recurrentes, pagos, supplier-*, purchases*, stock-*, clients, users…) 1–5 c/u |
| **Admin — views/** | `disaHome 16` · `stock-modal 7` · `cobro-modal 5` · `pago-modal 3` · `line-search 1` |
| **Login/2FA (shell propio, sin tokens)** | `routes/auth.js 140` (5 páginas `<!DOCTYPE>` con `<style>` propio, sin `:root`) |
| **Portal cliente (shell propio)** | `portal/index.js 15` · `portal/admin.js 8` · `portal/portal.js 4` |
| **DISA** | `disa/index.js 17` · `disa/widget.js 10` (widget con `<style>` propio) |
| **layout.js** | 106 hex, de los cuales ~40 son la **definición de tokens** (legítimos) + el resto son componentes (badges `.b-blue/.b-purple`, botones, modales, accessDenied) con hex que sí conviene tokenizar |

**Estilos inline `style="…"`** (color/tipografía/espaciado mezclados), top: `contabilidad 126` ·
`purchase-orders 106` · `orders 99` · `invoices 90` · `pedidos 89` · `quotes 79` · `cobro-modal 74` ·
`supplier-invoices 70` · `purchases-capture 70` · `products 61` · `pago-modal 55` · `albaranes 52` …

---

## 3. Los hex por familia (esto decide el plan)

### Bucket A — **duplican un token existente** → reemplazo mecánico, MISMO color (sin decisión)
| hex (≈veces) | Token destino |
|---|---|
| `#fff` / `#ffffff` (72) | `--bg2` / `--card` |
| `#6b7280` (38) | `--text2` / `--muted` |
| `#334155` (36) | `--accent` |
| `#f5f6f8` (29) | `--bg` |
| `#1a1d21` (23) | `--text` |
| `#1e293b` (20) | `--accent-d` |
| `#eceef1` (19) | `--border` |
| `#9097a1` (19) | `--text3` |
| `#a32d2d` (12) | `--danger` |
| `#e4e6ea` (8) | `--border2` |
| `#2e7d55` (6) | `--ok` |
| `#fee2e2` (4) · `#faeeda` (2) · `#f1f3f5` (3) · `#374151` | `--danger-s` · `--warn-s` · `--bg3` · `--body-tx` |

Esto es ~el 40 % de los hex y **no requiere ninguna decisión**: se cambian por su `var(--…)`.

### Bucket B — **cercanos a un token pero NO idénticos** → normalizar = recolor mínimo (decisión leve)
| hex (≈veces) | Vecino | Nota |
|---|---|---|
| `#64748b` (**71**) slate-500 | `--text2 #6B7280` | El hex **más repetido de toda la app**. Gris-azulado de texto/iconos secundarios. |
| `#f1f5f9` (25) slate-100 | `--bg3 #F1F3F5` | Casi idéntico. |
| `#e2e8f0` (22) slate-200 | `--border2 #E4E6EA` | Borde. |
| `#f3f4f6` (16) gray-100 | `--bg3` | Sub-superficie. |
| `#92400e` (11) amber-800 | `--warn #854F0B` | Texto de aviso. |
| `#94a3b8` (3) · `#0f172a` (3) | `--text3` · `--text`/`--accent-d` | slate-400 / slate-900. |

### Bucket C — **colores nuevos sin token** → requieren decisión (crear token o mapear)
| Familia | hex (≈veces) | Uso probable | Opciones |
|---|---|---|---|
| **Verde vivo** | `#10b981` (19), `#15803d` (9), `#166534` (7), `#bbf7d0`, `#6ee7b7`, `#f0fdf4` | estados "cobrada / al día / positivo" | Plegar todo a `--ok/--ok-s` (verde sobrio de DISEÑO §2.5) → recolor visible pero coherente. |
| **Rojo** | `#ef4444` (10), `#b91c1c` (8), `#fca5a5`, `#f3c6bf` | error/peligro/borrado | Plegar a `--danger/--danger-s`; el icono peligro `#DC2626` de DISEÑO §2.5 puede ser un token nuevo `--danger-ic`. |
| **Ámbar** | `#d97706` (3), `#b45309`, `#fcd34d`, `#fde68a` | avisos | Plegar a `--warn/--warn-s`; icono ámbar `#BA7517` (DISEÑO) → posible `--warn-ic`. |
| **Info azul** | `#e0f2fe`, `#bae6fd`, `#075985`, `#0369a1` | cajas informativas | Ya existe `.b-blue` (#E8EEFB/#2F5BBF). Crear `--info/--info-s` o reusar `.b-blue`. |
| **Morado / rosa** | `#9333ea` (13), `#e879f9` (4), `#ec4899` (3), `#fce7f3`, `#f0ebfb` | ¿DISA/IA? ¿chips de categoría? | **Necesita intención.** DISEÑO no define morado. ¿Es acento de IA intencional o hay que plegarlo a slate/`.b-purple`? |
| **Cálidos (portal)** | `#c84b31`, `#1b4d3e`, `#e8e6e0`, `#f4f3ef`, `#faf6f0` | look propio del portal | El portal tiene estética separada (audit §2). Decisión de alcance (ver §4). |

---

## 4. Decisiones de alcance abiertas (para Ibrahin)

1. **Familias verde/rojo/ámbar (Bucket C)** — ¿plegar a los tokens de estado existentes
   (`--ok/--danger/--warn` + `-s`), aceptando un recolor mínimo hacia el patrón oro, o
   añadir tokens nuevos para conservar los tonos actuales exactos?
2. **`#64748b` slate-500 (71×)** — ¿plegar a `--text2`, o crear un token propio
   (p. ej. `--text2b`) para no mover ningún píxel?
3. **Morado/rosa** — ¿es acento intencional de DISA/IA (se tokeniza como `--ia`) o se pliega
   a slate/gris?
4. **Login/2FA (`auth.js`, 140 hex, shell propio)** — U1 dice "TODA la app". ¿Entra el login
   en esta tanda (darle un `:root` con los tokens o compartir el de layout)?
5. **Portal de cliente (shell propio, estética cálida separada)** — el objetivo U1 dice
   "admin + portal". ¿Migrar el portal a los tokens del admin (unificar marca) o solo
   tokenizar internamente su paleta cálida propia (sin unificar look)? Es la decisión de
   mayor impacto visual de cara al cliente final.

---

## 5. Plan propuesto (tras tu OK)

1. **Cerrar tokens**: tapar T-1 (`--input-bg`), corregir T-2 (comentario), y añadir los tokens
   que decidas en §4 (estados-icono, info, ia…). Fuente única = `layout.js :root` (+ el `:root`
   espejo de `printableShell` y, si entra, del login/portal).
2. **Migrar por uso** (verificando cada pantalla en navegador con los `verify-*-browser.mjs`):
   Facturas → Cobros → Contabilidad → Conciliación → Recurrentes → Verifactu → Compras
   (purchase-orders, supplier-invoices, pagos, purchases, capture, supplier-returns) →
   Ventas (quotes, pedidos, albaranes, mostrador, clients) → Inventario/Catálogo →
   modales (cobro/pago/stock) → disaHome/DISA → (login/portal según §4).
3. **Regresión 0 por tanda**: `verify-*-browser.mjs` (rutas relativas, `127.0.0.1:3000`, sirven
   contra el server vivo) + un gate CSS que confirme "0 hex/inline de color en la vista migrada".
   Los `gate-*.mjs` con ruta fija `/home/ibrahin/…` están **rotos por entorno** (deuda técnica ya
   anotada en TABLERO) — no dependeré de esos.

## 5.bis RESULTADO — tanda ADMIN (2026-07-05)

Decisiones aplicadas (Ibrahin): estados verde/rojo/ámbar → **plegados a `--ok/--danger/--warn`**;
slate-500 `#64748b` → **`--text2`**; morado → **token `--accent-purple`** (IRPF/reservado, NO "ia");
azul-info → **token `--info` + componente `.alert-info`**; alcance → **admin primero, login+portal al final**.

**Capa de tokens cerrada** en `layout.js :root`: `--input-bg` (fuga) remapeado a `--bg3`; comentario de
provenance corregido; **añadidos** `--accent-purple/-s`, `--info/-s`, `--border-disa`, escala
`--space-1..6`, escala `--fs-*`/`--fw-*` (calcadas de los valores usados → aplicarlas es 1:1).

**Criterio de hecho — color en el UI de las vistas admin: 0 hex a mano.** Verificado por censo
(`grep`). Lo que **queda** (con motivo, permitido por el criterio):

| Remanente | Nº | Dónde | Por qué se queda |
|---|---|---|---|
| Datos del **selector de tema/color de tienda** | 73 hex | `settings.js` (SVG de preview + `color:'#…'`) + `disa/index.js` (2: color de marca por defecto y ejemplo de prompt) | **Capa 2 congelada**. Son DATOS (color de tienda que se guarda en BD y pinta el escaparate), no UI del admin. Tocarlos corrompería la config. Decisión explícita: dejar fuera. |
| Colores de serie **Chart.js** | 4 hex | `analytics.js` (`borderColor`/`backgroundColor`) | Chart.js pinta sobre **canvas**; `var(--token)` no se resuelve ahí. Además Analítica es D4 (Informes, en espera Pilar 4). |
| `color:red` | 4 | `auth.js` (login) | Superficie **login**, tanda final de U1 (aún no migrada). |
| Slate translúcido `rgba(58,65,80,α)` | 26 | DISA (`widget.js`, `index.js`), `settings.js`, `users.js` | Sistema de acento translúcido con ~8 alfas distintos; **no son hex** y no hay token de alfa equivalente. Plegar recolorearía la opacidad (rompe "se ven igual"); crear 8 tokens de alfa contradice "no crear tokens nuevos". Se anota para U1b si se quiere. |

**Estilos inline:** los `style="…"` de color/tipo dejan de llevar valores a mano — ahora consumen
`var(--token)`. No se elimina el atributo `style` (eso sería recolocación estructural, fuera de "dar
consistencia"); el objetivo era **token como fuente única**, cumplido. El espaciado inline estructural
se conserva (no hay recolor); las escalas `--space-*/--fs-*` quedan definidas como fuente única.

**Regresión 0 (tanda admin)** — verify contra el servidor vivo:
`conciliacion 12/0` · `recurrentes 15/0` · `verifactu-t1 18/0` · `invoice-over-stock 5/0` ·
`pedidos-browser 13/0` · `mostrador-browser 11/0` · `quotes-browser 8/1` (**= baseline**; el 1 fallo
—enlace inverso "Convertido a factura"— ya fallaba en árbol limpio, ajeno a CSS). `albaranes-browser`
cuelga **también sin mis cambios** (estado de datos pre-existente: exige `PED-0006` prístino) → no es
regresión. Boot limpio en cada reinicio (valida sintaxis de todos los módulos).

## 6. Nota para U2–U6 (encontrado, NO se toca aquí)
- Estados vacíos desiguales, errores `c.text()` crudos, tablas anchas sin scroll → ya inventariado
  en `auditoria-ux.md`, es U2/U3/U5. Aquí solo estilo.
- `gate-*.mjs` con ruta `/home/ibrahin/…` inexistente → deuda técnica de tests (TABLERO §Deuda).
