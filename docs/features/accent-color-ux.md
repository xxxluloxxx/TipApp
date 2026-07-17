# TipApp — Selector de color de acento en Ajustes (card "Apariencia")

Documento de especificación para `vue-frontend-expert`. Agrega un selector de
**color de acento** dentro de la card "Apariencia" que ya existe en
`/ajustes` (`src/views/SettingsView.vue`), debajo de la fila de Tema — **no**
se crea ninguna card ni pantalla nueva.

Da por sentado todo lo ya resuelto en `docs/design-system.md` (tokens,
espaciado, a11y), `docs/features/theme-toggle-ux.md` (patrón de fila
label+control dentro de "Apariencia", aplicación optimista, copy de toast de
error) y `docs/features/dashboard-redesign-ux.md` sección 7 (por qué "Ajustes"
es una `Card` de página completa y no un bloque de drawer). No repite esa
justificación acá, solo la referencia.

**No es responsabilidad de este documento** (ya decidido a nivel técnico,
fuera de mi alcance como `ui-ux-designer` opinar si SÍ o si NO):
- Que el color elegido reemplace `--primary`/`--primary-foreground` en tiempo
  real, afectando toda la app (botones primarios, FAB, focus ring, etc.).
- Que `null` signifique "usar el azul de fábrica" (`--primary: 221.2 83.2%
  53.3%`, hex aprox. `#2563eb`).
- El mecanismo interno de conversión hex → HSL para escribir la variable CSS,
  ni la persistencia en `profiles.accent_color` — eso es implementación de
  `vue-frontend-expert` (ver nota de arquitectura, sección 7).

Este documento cubre **qué se ve, cómo se separa visualmente del control de
Tema, y cómo se siente** (aplicación, error, a11y).

---

## 0. Decisión: reusar el grid de swatches circulares ya existente, sin componente nuevo

**Se reusa tal cual el patrón visual de swatch circular `size-11` ya
implementado en `CategoryFormSheet.vue`** (y ya reusado, vía import de
`COLOR_SWATCHES`, en `CardFormSheet.vue`/`CardPersonFormSheet.vue`) — no se
diseña un layout nuevo, no se instala ningún componente de color picker.

Justificación:

1. **Es exactamente el mismo problema de UI ya resuelto tres veces**: "elegir
   uno de N colores fijos de una paleta, con feedback visual claro de cuál
   está elegido". No hay ninguna necesidad nueva (rueda de color, input hex
   libre, degradado) que justifique un patrón distinto — la paleta sigue
   siendo fija, fuera de alcance un color picker libre (ver encargo).
2. **Import directo de `COLOR_SWATCHES` desde `src/lib/colors.ts`, no
   duplicar el literal.** A diferencia de `CategoryFormSheet.vue` (que sigue
   con su propia copia local del array — deuda ya existente, no se toca acá),
   este caso nuevo debe seguir el patrón ya migrado en
   `CardFormSheet.vue`/`CardPersonFormSheet.vue`, que sí importan
   `COLOR_SWATCHES` de `lib/colors.ts` en vez de repetir el literal. Es
   explícito acá para que `vue-frontend-expert` no repita por inercia la
   duplicación del archivo más viejo (`CategoryFormSheet.vue`) solo porque
   fue el primero en usarse como referencia.
3. **Consistencia perceptiva entre pantallas**: el usuario ya vio y usó este
   mismo control (mismos 10 colores, mismo tamaño, mismo check de
   seleccionado) al crear una categoría o una tarjeta. Reconocerlo acá reduce
   la carga cognitiva a cero — no hay nada nuevo que aprender.

**Lo que sí es distinto acá** (y se especifica en detalle más abajo): la
selección **no es obligatoria** como en categorías/tarjetas (siempre hay un
color guardado ahí) — acá existe un estado real de "sin color custom, usar el
de fábrica" que necesita su propia representación en el grid (sección 3).

---

## 1. Ícono

De `@lucide/vue` (agregar a los imports ya existentes en `SettingsView.vue`,
junto a `Monitor`, `Moon`, `Sun`, `SunMoon`):

- **Ícono de la fila (label "Color de acento")**: `Palette` — representa
  "color"/paleta de forma genérica, mismo criterio ya usado para `SunMoon`
  en la fila de Tema (ícono de concepto, no de un valor específico).
- **Swatch "Predeterminado"**: `Ban` (círculo con barra diagonal) — ver
  justificación completa en sección 3. Ya cubierto por `@lucide/vue`, no
  hace falta instalar nada.
- **Check de seleccionado**: `Check`, mismo ícono ya usado en
  `CategoryFormSheet.vue` para el swatch activo.

---

## 2. Ubicación exacta dentro de la card "Apariencia"

**Bloque nuevo con `border-t border-border` propio, debajo de la fila de
Tema, dentro de la misma `Card`** — no un `Separator` component, no una
segunda `Card`.

Justificación, mismo criterio ya fijado en `theme-toggle-ux.md` sección 2
para el bloque de tema dentro del drawer ("cada bloque nuevo separa con su
propio borde en el lado que corresponde, sin duplicar contra el vecino"):

- La fila de Tema (`<div class="flex items-center gap-3 px-4 pb-4">`) ya
  tiene su propio espaciado inferior (`pb-4`) y ningún borde — no hace falta
  tocarla.
- El bloque de Color de acento es el que agrega el borde superior
  (`border-t border-border`), exactamente como el bloque de tema lo hizo
  contra el `<nav>` en el drawer. No hay duplicación porque ninguno de los
  dos vecinos (fila de Tema arriba, cierre de `Card` abajo) aporta un borde
  en el lado que toca este bloque nuevo.
- **Por qué no `Separator`** (el componente shadcn-vue ya instalado, usado
  hoy entre filas de una lista de igual jerarquía — p. ej. transacciones
  recientes en `dashboard-redesign-ux.md` sección 2.4): acá no son dos ítems
  repetidos de una lista, son dos **sub-secciones distintas** dentro de la
  misma card ("Tema" y "Color de acento"), el mismo tipo de relación que ya
  resolvió `border-t` en el drawer (bloque de tema vs. `<nav>`/footer). Usar
  `border-t border-border` en vez de `<Separator />` es la opción ya
  validada en el proyecto para este caso exacto (bloque nuevo vs. bloque
  vecino dentro del mismo contenedor), y evita introducir un segundo patrón
  visual para el mismo propósito (una sola forma de "separar sub-bloques
  dentro de una card" en todo el proyecto).

Markup del bloque contenedor (ver sección 4 para el contenido completo):

```html
<div class="border-t border-border px-4 py-4">
  <!-- fila de label + grid de swatches -->
</div>
```

Se inserta como hermano siguiente del `<div class="flex items-center gap-3
px-4 pb-4">` de Tema, ambos dentro de la misma `Card`, después de su
`CardHeader`.

---

## 3. Representación del estado "color de fábrica" (`null`)

**Decisión: swatch explícito de "Predeterminado", primero en el grid, antes
de los 10 colores de `COLOR_SWATCHES`.** No se deja "ningún swatch marcado"
como única señal de ese estado.

### 3.1 Por qué un swatch explícito y no "ninguno marcado"

- **Descubribilidad de la reversión**: si el usuario ya eligió, por ejemplo,
  Violeta, y más adelante quiere "volver a como estaba antes", un grid donde
  ningún swatch tiene indicador de qué tocar para deshacer obliga a adivinar
  (¿tocar de nuevo el mismo swatch para deseleccionar? ¿existe esa
  interacción?). Un swatch dedicado y visible responde la pregunta sin
  ambigüedad: "tocá acá para volver al color de fábrica".
- **Riesgo real de confusión de color si se mostrara el azul de fábrica
  como swatch "normal"**: el azul de fábrica (`hsl(221.2 83.2% 53.3%)` ≈
  `#2563eb`) es visualmente muy parecido al swatch "Azul" ya existente en
  `COLOR_SWATCHES` (`#3b82f6`) — son dos azules distintos pero casi
  indistinguibles a simple vista, especialmente en una pantalla chica de
  mobile. Si "Predeterminado" se pintara con el hex real de fábrica, quedaría
  un swatch casi idéntico al de "Azul" al lado, generando la pregunta "¿por
  qué hay dos azules casi iguales acá?" — confuso incluso para quien no
  tiene ninguna dificultad de percepción de color.
- **Solución**: el swatch "Predeterminado" **no se pinta con el hex real de
  fábrica**. Se renderiza como un círculo del mismo tamaño (`size-11`) con
  fondo transparente, borde punteado (`border-2 border-dashed
  border-muted-foreground/50`) y el ícono `Ban` (círculo con barra
  diagonal, "sin color custom") en `text-muted-foreground` — el mismo
  lenguaje visual que "no fill" en herramientas de diseño (Figma, etc.),
  instantáneamente legible como "ninguno/reset" sin depender de reconocer un
  hex específico. Cuando está seleccionado, el `Ban` se reemplaza por
  `Check` (mismo criterio que los demás swatches), igual que ellos con
  anillo de foco/selección (`ring-2 ring-offset-2 ring-ring`).

### 3.2 Por qué no aplica el mismo criterio "obligatorio" de categorías

En `CategoryFormSheet.vue` no existe un estado `null` porque toda categoría
**necesita** un color para ser identificable en badges/listas — no hay
"categoría sin color". Acá, en cambio, `accent_color = null` es un estado de
producto real y esperado (la mayoría de usuarios probablemente nunca toque
este control, igual que la mayoría probablemente deja `theme_preference` en
`'system'`) — no es un caso de borde a esconder, es el default. Por eso la
paleta de categorías no necesita (ni debería) un swatch "Predeterminado", y
la de acento sí.

### 3.3 Posición en el grid

Primero, antes de los 10 swatches de `COLOR_SWATCHES` — mismo criterio ya
usado en la mayoría de selectores "Ninguno/Automático" (aparece primero, como
punto de partida neutro antes de las opciones concretas), y evita que quede
"escondido" al final de una fila que puede wrappear a 2-3 líneas en mobile.

---

## 4. Markup exacto

```html
<!-- Dentro de la Card "Apariencia", después del bloque de Tema -->
<div class="border-t border-border px-4 py-4">
  <div class="flex items-center gap-3">
    <Palette class="size-5 shrink-0 text-muted-foreground" />
    <span id="accent-color-label" class="text-sm font-medium">Color de acento</span>
  </div>

  <div
    id="accent-color"
    role="group"
    aria-labelledby="accent-color-label"
    class="mt-3 flex flex-wrap gap-3 pl-8"
  >
    <button
      type="button"
      class="relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/50 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="{ 'ring-2 ring-offset-2 ring-ring border-solid': authStore.accentColor === null }"
      :aria-pressed="authStore.accentColor === null"
      aria-label="Predeterminado"
      @click="authStore.selectAccentColor(null)"
    >
      <component :is="authStore.accentColor === null ? Check : Ban" class="size-5 text-muted-foreground" />
    </button>

    <button
      v-for="swatch in COLOR_SWATCHES"
      :key="swatch.hex"
      type="button"
      class="relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="{ 'ring-2 ring-offset-2 ring-ring': authStore.accentColor === swatch.hex }"
      :style="{ background: swatch.hex }"
      :aria-pressed="authStore.accentColor === swatch.hex"
      :aria-label="swatch.label"
      @click="authStore.selectAccentColor(swatch.hex)"
    >
      <Check v-if="authStore.accentColor === swatch.hex" class="size-5" :style="{ color: readableTextColor(swatch.hex) }" />
    </button>
  </div>
</div>
```

Notas sobre este markup:

- **`import { COLOR_SWATCHES, readableTextColor } from '@/lib/colors'`** —
  no duplicar el array (ver sección 0, punto 2).
- **`import { Ban, Check, Palette } from '@lucide/vue'`** — `Check` puede ya
  estar importado en `SettingsView.vue` si se reusa en otro lado; si no,
  agregarlo.
- **`pl-8` en el grid**: alinea el primer swatch justo debajo del texto del
  label (no del ícono), replicando el ancho de `Palette` (`size-5` = 20px) +
  `gap-3` (12px) = 32px = `pl-8`. Mismo criterio visual ya usado para alinear
  contenido secundario debajo de una fila con ícono en otras partes de la
  app (p. ej. detalle plegado de "Otros" en `dashboard-redesign-ux.md`
  sección 4.1, `pl-4.5`).
- **`border-solid` agregado condicionalmente al swatch "Predeterminado"
  cuando está seleccionado**: al aplicar el `ring` de selección, mantener el
  borde punteado se ve inconsistente con el resto (que no tienen borde
  propio, solo el `ring`) — al pasar a sólido +ring queda visualmente igual
  de "activo" que los demás swatches seleccionados.
- **`authStore.accentColor` y `authStore.selectAccentColor(value)`**: nombres
  sugeridos, análogos 1:1 a `authStore.themePreference` /
  `authStore.selectTheme(value)` ya existentes (ver nota de arquitectura,
  sección 7) — no vinculante si `vue-frontend-expert` encuentra mejor
  ubicación.

---

## 5. Aplicación optimista + manejo de error

Mismo mecanismo ya usado para tema (`theme-toggle-ux.md` sección 4-5), sin
cambios de diseño: aplica al instante en el DOM (afecta `--primary`/
`--primary-foreground` en toda la app), persiste en segundo plano en
`profiles.accent_color`, y **si falla el guardado remoto no se revierte el
color visual ni el swatch marcado** — solo se informa con un toast con
acción "Reintentar".

Copy exacto (mismo tono informal "vos", mismo patrón de
`persistThemePreference` en `src/stores/auth.ts`):

```ts
toast.error('No pudimos guardar tu color de acento', {
  description: 'Se aplicó igual en este dispositivo, pero podría no verse así en otra sesión.',
  action: {
    label: 'Reintentar',
    onClick: () => {
      void persistAccentColor(value)
    },
  },
})
```

El grid **sí** debe reflejar en todo momento el color localmente aplicado
(no el último confirmado por el servidor) — igual que el `radiogroup` de
tema, el swatch marcado no rebota ni parpadea mientras se reintenta el
guardado en segundo plano.

---

## 6. Accesibilidad

1. **Nombre accesible de cada swatch**: heredado de `swatch.label` de
   `COLOR_SWATCHES` (ya usado tal cual en `aria-label`), y `"Predeterminado"`
   para el swatch nuevo.
2. **Semántica de selección: `role="group"` + `aria-pressed`, no
   `radiogroup`/`aria-checked`.** Mismo criterio que `CategoryFormSheet.vue`,
   y **el mismo razonamiento aplica acá sin diferencia**: ambos son grids de
   swatches de una paleta fija con selección única mediante botones
   independientes (no un control compacto de pocas opciones tipo segmented
   control). El caso que sí justificó `radiogroup`/`aria-checked` en
   `theme-toggle-ux.md` es distinto: un control de 3 opciones fijas,
   dispuestas linealmente, que imita el patrón nativo de "elegí una de
   pocas opciones excluyentes" (con navegación por flechas esperable, como
   en iOS/macOS/GitHub). Un grid de 11 swatches que puede wrappear a varias
   filas no es ese patrón — es una grilla de botones tipo "elegí tu
   favorito de esta paleta", exactamente el mismo caso ya resuelto (y
   accesible en producción) por `CategoryFormSheet.vue`. Reusar
   `role="group"`/`aria-pressed` acá es consistencia, no una concesión.
3. **Nombre accesible del grupo**: `aria-labelledby="accent-color-label"`
   apuntando al label visible "Color de acento" (no se repite el string en
   un `aria-label` separado), mismo criterio ya usado para
   `aria-labelledby="theme-label"` en la fila de Tema.
4. **Foco visible**: mismo patrón ya usado en todo el proyecto
   (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
   focus-visible:ring-offset-2`) en los 11 botones.
5. **Mínimo táctil 44×44px**: `size-11` en los 11 swatches, igual que
   `CategoryFormSheet.vue` — ya cumplido sin cálculo adicional (a diferencia
   del segmented control de tema, acá no hay compresión de ancho por
   `flex-1`: cada swatch mantiene su tamaño fijo y el grid simplemente
   wrappea).
6. **Color nunca como único indicador**: el swatch seleccionado siempre
   lleva, además del `ring` de foco/selección, un ícono superpuesto (`Check`
   sobre el color elegido, `Check`/`Ban` sobre "Predeterminado") — mismo
   criterio ya vigente para categorías/tarjetas, no se relaja acá.
7. **`prefers-reduced-motion`**: no aplica ninguna animación nueva en este
   control (sin transición de "deslizamiento" ni fade en el cambio de
   swatch activo, mismo criterio de "no over-engineer" ya usado para el
   segmented control de tema) — la única transición de color relevante
   (`html { transition: background-color, color }`) ya existe y ya respeta
   `prefers-reduced-motion` desde `theme-toggle-ux.md` sección 4; si el
   cambio de `--primary` se aplica por la misma vía de recalculo de
   variables CSS, hereda ese comportamiento sin trabajo adicional.

---

## 7. Nota de arquitectura (no vinculante, para orientar — no prescribe código)

Sugerencia de alto nivel, análoga 1:1 a la ya usada para tema
(`theme-toggle-ux.md` sección 7): el estado `accentColor` probablemente
conviene vivir junto a `themePreference` en `src/stores/auth.ts` (mismo
store, misma tabla `profiles`, mismo ciclo de vida optimista), con una
función `selectAccentColor(value: string | null)` responsable de: (a)
convertir el hex a la tripleta HSL que usan las variables CSS del tema
(`--primary`/`--primary-foreground` se leen como `H S% L%` sin `hsl()`
envolvente, ver `src/assets/main.css`) y aplicarla al DOM de inmediato, (b)
cachear en `localStorage` (mismo mecanismo que `THEME_STORAGE_KEY`, para
evitar flash del color de fábrica en el próximo arranque mientras se
resuelve el perfil remoto — mismo problema y misma solución que ya resolvió
`theme-toggle-ux.md` sección 4 punto 4), y (c) disparar el `update` a
`profiles.accent_color` en segundo plano con el mismo patrón de toast de
error que `persistThemePreference`. También hace falta decidir el color de
`--primary-foreground` para cada acento elegido (texto legible sobre ese
color en botones primarios) — `readableTextColor` de `src/lib/colors.ts` ya
resuelve exactamente ese cálculo de contraste y puede reusarse tal cual para
elegir entre el foreground claro/oscuro del tema en vez de solo `#ffffff`/
`#111827` sueltos, si `vue-frontend-expert` lo considera necesario. Esto es
una orientación, no una instrucción cerrada.

---

## Resumen para `vue-frontend-expert`

1. **No instalar ningún componente nuevo.** Reusar el patrón de swatch
   circular `size-11` ya existente, importando `COLOR_SWATCHES` y
   `readableTextColor` de `@/lib/colors` (no duplicar el literal — ver
   sección 0).
2. Imports nuevos en `@lucide/vue` para `SettingsView.vue`: `Ban`, `Check`,
   `Palette` (agregar a los ya existentes `Monitor`, `Moon`, `Sun`,
   `SunMoon`).
3. Insertar el bloque de la sección 4 dentro de la `Card` "Apariencia",
   como hermano siguiente del bloque de Tema, con `border-t border-border`
   propio (sección 2) — no usar `<Separator />`, no crear una segunda
   `Card`.
4. El primer swatch del grid es "Predeterminado" (`Ban`/`Check`, borde
   punteado, sin hex de fondo real — sección 3), antes de los 10 swatches de
   `COLOR_SWATCHES`.
5. Semántica `role="group"` + `aria-pressed` por botón (no `radiogroup`),
   `aria-labelledby="accent-color-label"` en el contenedor — mismo criterio
   que `CategoryFormSheet.vue`, justificado en sección 6.
6. Estado `accentColor` (`string | null`) y función `selectAccentColor(value)`
   — ubicación sugerida `src/stores/auth.ts`, análoga a
   `themePreference`/`selectTheme` (sección 7), no vinculante.
7. Al ejecutar `selectAccentColor`: aplicar el color al DOM al instante
   (optimista, conversión hex→HSL sobre `--primary`/`--primary-foreground`),
   cachear en `localStorage` para evitar flash en el próximo arranque, y
   persistir en `profiles.accent_color` en segundo plano.
8. Si falla la persistencia remota: **no revertir el color visual ni el
   swatch marcado** — solo `toast.error(...)` con acción "Reintentar", copy
   exacto en sección 5.
9. No tocar el selector de Tema existente, no agregar un color picker libre,
   no crear ninguna pantalla ni card nueva — todo vive dentro de la card
   "Apariencia" ya existente en `SettingsView.vue`.
