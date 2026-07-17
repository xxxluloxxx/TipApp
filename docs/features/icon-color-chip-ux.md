# TipApp — Chip de ícono coloreado: Cuentas y Tarjetas (v1)

Documento corto de especificación/decisión para `vue-frontend-expert`. Registra
el tratamiento visual "color solo en el ícono" (encargo del Product Owner,
referencia: mockup "WalletVie", variante derecha/dark) aplicado de forma
consistente a **Cuentas** (`HomeView.vue` sección "Mis cuentas",
`AccountsView.vue`) y **Tarjetas de crédito** (`CardsDashboardView.vue`
sección "Tus tarjetas", `CardTransactionsView.vue` headers de grupo por
tarjeta). Da por sentado `docs/design-system.md` (tokens, radios, a11y),
`docs/features/accounts-income-ux.md` sección 4 (paleta
`ACCOUNT_COLOR_SWATCHES`) y `docs/features/credit-cards-ux.md` (paleta
`COLOR_SWATCHES`, secciones 2.3/3.2 con el markup anterior de fondo sólido).

Motivo del cambio: Cuentas y Tarjetas son, desde la perspectiva del usuario,
"las dos fuentes de dónde sale la plata" en el dashboard — el Product Owner
pidió que luzcan visualmente consistentes entre sí. Tarjetas venía de un
pedido explícito **anterior** (fondo de fila completo con `card.color` +
`readableTextColor`), documentado en `credit-cards-ux.md` con otra referencia
visual; ese estilo queda reemplazado por el de esta sesión. La paleta de
color en sí (`ACCOUNT_COLOR_SWATCHES` de 8 tonos jewel-tone vs. `COLOR_SWATCHES`
de 10 tonos escala Tailwind-500) **no cambia** — son dos paletas distintas,
cada una con su propia justificación ya documentada, y esta tarea no las
unifica. Lo que se unifica es el tratamiento visual del chip.

---

## 1. Tratamiento visual final (aplica a Cuentas y Tarjetas por igual)

| Propiedad | Valor | Justificación |
|---|---|---|
| Forma | Cuadrado con esquinas redondeadas (`rounded-lg`, el radio base del tema, 10px) | La referencia del Product Owner (variante derecha/dark) usa un chip cuadrado, no circular — se adopta literalmente en vez de mantener el círculo (`rounded-full`) que Cuentas ya tenía. `rounded-lg` (no `rounded-xl`) para reusar el mismo radio base que el resto de `Card`/superficies del sistema de diseño, no un radio nuevo solo para este chip. |
| Tamaño | `size-10` (40px) en filas de listado; `size-8` (32px) en el header de grupo de `CardTransactionsView.vue`, más chico por ser un encabezado denso de fila, no una fila en sí | 40px da presencia visual suficiente para un chip de fondo sólido (a diferencia de un wash sutil, un color sólido "compite" más por atención — necesita algo más de superficie que los `size-9` anteriores para no verse un cuadradito perdido). 32px en el header de grupo respeta la densidad ya existente de esa fila (`px-4 py-3`, ícono `size-4` antes del chip). |
| Fondo del chip | **Color sólido** de la cuenta/tarjeta (`resolveAccountColor(...)` en Cuentas, `card.color` en Tarjetas), no wash semitransparente | Ver sección 2 — el wash al 15% que Cuentas ya tenía se evalúa y se descarta a favor de sólido, para igualar el "vivo" de la referencia y quedar consistente con Tarjetas (que nunca tuvo wash). |
| Color del ícono | `readableTextColor(color)` — blanco (`#ffffff`) o casi negro (`#111827`) según el hex, **nunca hardcodeado a blanco** | Ver sección 2.2 — `COLOR_SWATCHES` (tarjetas) incluye tonos claros (amarillo, celeste, rosa) donde un ícono blanco fijo fallaría contraste. Reusar `readableTextColor` (ya existente en `src/lib/colors.ts`, ya probado en `design-system.md` para los badges de categoría) resuelve esto automáticamente sin lógica nueva. |
| Resto de la fila | Fondo neutro (`card`/`background` normal, `hover:bg-accent`) | El color **no** vuelve a ocupar toda la fila/header — ese es exactamente el patrón que se está reemplazando en Tarjetas. |
| Ícono en sí | Cuentas: `ACCOUNT_ICONS`/`resolveAccountIcon` (ya existente, 6 íconos Lucide por cuenta). Tarjetas: `CreditCardIcon` genérico (`CreditCard` de `@lucide/vue`), **sin ícono por tarjeta** | Confirmado explícitamente: no se inventa un set de íconos nuevo para tarjetas — nadie lo pidió, y hoy no hay ningún campo en `credit_cards` que module qué ícono usar por tarjeta (a diferencia de `accounts.icon`, que sí existe). El chip de tarjeta distingue por color, no por forma de ícono. |

### 1.1 Markup de referencia (Cuentas, ya reflejado en el código)

```html
<span
  class="flex size-10 shrink-0 items-center justify-center rounded-lg"
  :style="{ backgroundColor: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
>
  <component
    :is="resolveAccountIcon(account.icon)"
    class="size-5"
    :style="{ color: readableTextColor(resolveAccountColor(account.color ?? '#6b7280', isDarkNow)) }"
  />
</span>
```

### 1.2 Markup de referencia (Tarjetas — lista "Tus tarjetas", `CardsDashboardView.vue`)

```html
<span
  class="flex size-10 shrink-0 items-center justify-center rounded-lg"
  :style="{ backgroundColor: card.color ?? 'hsl(var(--muted))' }"
>
  <CreditCardIcon class="size-4.5" :style="{ color: readableTextColor(card.color) }" />
</span>
```

### 1.3 Markup de referencia (Tarjetas — header de grupo, `CardTransactionsView.vue`)

```html
<span
  class="flex size-8 shrink-0 items-center justify-center rounded-lg"
  :style="{ backgroundColor: group.card.color ?? 'hsl(var(--muted))' }"
>
  <CreditCardIcon class="size-4" :style="{ color: readableTextColor(group.card.color) }" />
</span>
```

---

## 2. Veredicto sobre Cuentas: AJUSTAR (no mantener tal cual)

El estado anterior (círculo `size-9`, `withAlpha(account.color, 0.15)` de
fondo + ícono en `resolveAccountColor` sólido encima) ya cumplía el principio
de "color solo en el ícono, no en toda la fila" — eso estaba bien y no era el
problema. Pero comparado con la referencia (chip sólido, cuadrado, ícono
blanco) quedaba **apagado**, por dos motivos concretos:

### 2.1 Forma: círculo → cuadrado redondeado

La referencia del Product Owner usa explícitamente un chip cuadrado. Mantener
el círculo hubiera dejado a Cuentas visualmente distinta tanto de la
referencia como de la nueva Tarjetas (que nunca tuvo tratamiento circular) —
rompía la consistencia pedida. Se cambia a `rounded-lg` en ambas pantallas.

### 2.2 Wash 15% + ícono sólido → color sólido + ícono con contraste calculado

Un wash al 15% de opacidad sobre un fondo de card ya casi blanco (light mode)
produce un tinte muy sutil — casi imperceptible como "color de identidad" a
primera vista, especialmente con la paleta `ACCOUNT_COLOR_SWATCHES` (jewel
tones deliberadamente profundos, no vívidos: sección 4.1 de
`accounts-income-ux.md`). El resultado percibido es más parecido a "un
recuadro gris con un ícono de color" que a "un chip de color". Comparado con
la variante derecha de la referencia (chip 100% sólido, alto contraste), el
wash se lee objetivamente más lavado/apagado.

**Cambio**: fondo del chip pasa a ser el color sólido de la cuenta
(`resolveAccountColor`), con el ícono en el color que mejor contraste dé
(`readableTextColor`, blanco para 7 de los 8 jewel-tones — el único límite es
que ninguno de los 8 hex de `ACCOUNT_COLOR_SWATCHES` es lo bastante claro
como para necesitar ícono oscuro, así que en la práctica el ícono de cuenta
va blanco en el 100% de los casos, pero se sigue calculando en vez de
hardcodear, por honestidad de código y por si algún día se agrega un swatch
más claro).

### 2.3 Tamaño: `size-9` (36px) → `size-10` (40px)

`size-9` alcanzaba para un wash sutil (que no necesita "pelear" por
atención), pero un chip de color sólido se beneficia de un poco más de
superficie para leerse como una forma con peso propio, no un cuadradito
perdido al lado del nombre — mismo criterio que llevó a agrandar el chip en
4px. Cambio de bajo costo (no afecta el mínimo táctil de 44×44px porque el
chip no es en sí el elemento tocable: en `AccountsView.vue` el tap target es
la fila completa `min-h-11`+; en la tile de "Mis cuentas" de Inicio, el
`button` completo ya mide sobradamente 44px de alto).

### 2.4 Qué NO cambia en Cuentas

- La paleta `ACCOUNT_COLOR_SWATCHES` (8 jewel-tones + variante `darkHex`) se
  mantiene intacta — el chequeo de contraste de esta sesión (sección 3) la
  valida como apta para ícono blanco encima, sin necesitar recalibrar ningún
  hex.
- El bloque de "Transacciones recientes" en `HomeView.vue` (íconos de
  categoría e ingreso/cuenta dentro de esa lista mixta, `withAlpha(..., 0.12)`
  + borde) **no se toca** — es un patrón distinto, comparte tratamiento con
  los badges de categoría en esa misma lista (que tampoco son parte de este
  encargo), y cambiarlo ahí introduciría una inconsistencia nueva entre
  categoría/cuenta dentro de la misma fila mixta. Fuera de alcance explícito.
- El swatch circular chico (`size-6 rounded-full`) de "Top personas" en
  `CardsDashboardView.vue` tampoco se toca — es un avatar de persona, no un
  chip de "de dónde sale la plata"; círculo es la convención correcta para
  avatares, no hay pedido de cambiarlo.

---

## 3. Verificación de contraste del ícono (por qué `readableTextColor`, no blanco fijo)

`readableTextColor` (ya existente, `src/lib/colors.ts`) calcula luminancia
relativa WCAG del hex de fondo y devuelve `#ffffff` o `#111827`, lo que mejor
contraste dé — exactamente el mismo helper que ya resolvía el texto sobre el
fondo completo de tarjeta antes de este cambio, reusado ahora para el ícono
sobre el chip en vez de reinventar una regla nueva.

- **Cuentas** (`ACCOUNT_COLOR_SWATCHES`, 8 hex): los 8 tonos "claros" y los 8
  `darkHex` dan luminancia por debajo del umbral (`0.42`) en todos los casos
  verificados — el ícono va **blanco** en la práctica totalidad de cuentas,
  con buen contraste (paleta calibrada deliberadamente profunda, sección 4.1
  de `accounts-income-ux.md`).
- **Tarjetas** (`COLOR_SWATCHES`, 10 hex, escala Tailwind-500): acá sí importa
  el cálculo dinámico. `design-system.md` sección 1 ya señala que los slots
  "amarillo" (`#eab308`), "celeste" (`#06b6d4`) y "rosa" (`#ec4899`) tienen
  contraste bajo contra blanco — para esos tres, `readableTextColor` devuelve
  **texto oscuro** (`#111827`), no blanco. Si se hubiera hardcodeado "ícono
  blanco" (lectura literal de la referencia, que solo muestra tonos oscuros
  de fondo), una tarjeta amarilla/celeste/rosa habría quedado con un ícono
  blanco casi invisible — el mismo problema que el sistema de diseño ya
  identificó y resolvió una vez para el texto de categorías, ahora extendido
  al ícono del chip sin duplicar la regla.

---

## 4. Before / after conceptual

**Antes (Cuentas)**: círculo tenue, wash de color al 15% + ícono de color
sólido encima — el color "vive" en el ícono, pero se percibe débil por el
wash de fondo casi imperceptible.

**Antes (Tarjetas)**: toda la fila/header pintada del color de la tarjeta
(`background: card.color`), texto blanco/oscuro según contraste — vívido,
pero exactamente el patrón que la referencia actual del Product Owner
descarta (variantes izquierda/centro de "WalletVie"), y además desalineado
con la nota ya escrita en `design-system.md` sección 1 sobre que
`COLOR_SWATCHES` está pensado para un wash del 12%, no para fondo sólido de
fila completa.

**Después (ambas)**: fila/header con fondo neutro de card normal, el color
vive únicamente en un chip cuadrado de 40px (32px en el header de grupo de
transacciones), fondo sólido del color de la cuenta/tarjeta, ícono con
contraste calculado — mismo tratamiento exacto en las dos pantallas.

---

## 5. `CardDetailView.vue` — confirmado sin tratamiento de color, sugerencia opcional

Confirmado: `CardDetailView.vue` no tenía (ni tiene ahora) ningún fondo
coloreado — no había nada que romper ahí, no se tocó el archivo.

**Sugerencia opcional, no implementada** (el Product Owner no la pidió,
queda anotada para una futura sesión si se decide agregarla): el header de
`CardDetailView.vue` hoy es texto plano —

```html
<h1 class="text-xl font-semibold">{{ card?.name ?? 'Tarjeta' }}</h1>
```

— sin ningún indicador visual del color de la tarjeta. Un lugar razonable
para el mismo chip (`size-10 rounded-lg`, color sólido + ícono
`CreditCardIcon` con `readableTextColor`) sería inmediatamente a la
izquierda de `{{ card.name }}` en ese `<h1>`, reforzando "esta es la tarjeta
X, identificada por este color" apenas se entra al detalle — mismo criterio
que ya aplican `AccountsView.vue`/`CardsDashboardView.vue`. No es
imprescindible (el usuario ya sabe en qué tarjeta está por haber tocado esa
fila para llegar acá) pero cierra el círculo de consistencia visual si en el
futuro se quiere pulir esta pantalla.

---

## 6. Fuera de alcance explícito de esta sesión

- No se tocan las paletas (`ACCOUNT_COLOR_SWATCHES`, `COLOR_SWATCHES`) ni se
  unifican entre sí — decisión ya fundamentada en `accounts-income-ux.md`
  sección 4.4, no reabierta acá.
- No se agrega ningún ícono por tarjeta — `credit_cards` no tiene una columna
  de ícono hoy; `CreditCardIcon` genérico se mantiene para toda tarjeta.
- No se toca el chip de "Top personas" (avatar circular) ni el bloque
  "Transacciones recientes" de `HomeView.vue` — tratamientos distintos, fuera
  del encargo (sección 2.4).
- No se implementa la sugerencia de `CardDetailView.vue` (sección 5) — queda
  como nota para una futura sesión.

---

## 7. Archivos tocados

- `src/views/HomeView.vue` — chip de "Mis cuentas" (círculo→cuadrado, wash→
  sólido, `size-9`→`size-10`), import de `readableTextColor`.
- `src/views/AccountsView.vue` — mismo cambio en la fila de listado
  `/cuentas`, más el `Skeleton` de carga (`rounded-full`→`rounded-lg`,
  `size-9`→`size-10`) para que no cambie de forma entre loading y contenido
  real.
- `src/views/CardsDashboardView.vue` — fila de "Tus tarjetas": fondo de fila
  completo → chip de ícono (`size-10 rounded-lg`), se agrega `border
  border-border` a cada fila (antes el color de fondo ya daba separación
  visual entre filas; sin él, hace falta un borde sutil para que seis filas
  seguidas no se vean "pegadas").
- `src/views/CardTransactionsView.vue` — header de grupo por tarjeta: fondo
  completo → chip de ícono (`size-8 rounded-lg`) + `border-b border-border`
  en el header (mismo motivo: sin el fondo de color, hace falta una línea
  para separar el header del primer movimiento del grupo).
- `docs/features/icon-color-chip-ux.md` (este archivo, nuevo).

`npm run build` (`vue-tsc --build` + `vite build`) verificado sin errores
tras estos cambios.
