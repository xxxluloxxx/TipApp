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

---

## 8. Revisión posterior (2026-07-17): fondo pastel de card completa (reemplaza la sección 1-4 en su premisa de "card neutra")

**Motivo**: el Product Owner comparó la sección 1 contra una referencia
visual distinta ("Mis cuentas", grid de cards con fondo pastel completo por
cuenta: verde/naranja/rosa/amarillo/celeste clarito, ícono en un tono más
saturado del mismo color adentro) y confirmó que la lectura de la sección 1
de este documento — "card blanca/neutra + el color vive solo en el chip del
ícono" — fue un error de interpretación de la referencia anterior. La
decisión correcta es la opuesta en cuanto al fondo de la fila/card: **el
fondo completo de cada card de cuenta/tarjeta debe llevar un tinte pastel
del color de la cuenta**, no quedarse blanco/neutro.

Esto **no** reintroduce el estilo descartado dos iteraciones atrás para
Tarjetas (fondo `background: card.color` a pleno + texto blanco fijo,
sección 4 "Antes (Tarjetas)"): ese era 100% opacidad con texto invertido.
Esto es un **tinte de baja opacidad** (pastel, no vívido) con texto
`text-foreground` normal, sin invertir. Son visualmente y técnicamente
distintos — no es un rollback a lo de antes, es una tercera variante.

Lo que la sección 1 acertó y **se mantiene sin cambios**: forma (`rounded-lg`
en la card, chip de ícono también `rounded-lg`), tamaños (`size-10` en filas/
tiles, `size-8` en el header de grupo de `CardTransactionsView.vue`), el chip
de ícono en sí (fondo sólido `resolveAccountColor`/`card.color`, ícono con
`readableTextColor`), y qué archivos se tocan. Lo único que cambia es que el
**contenedor exterior** (la card/fila/header, hoy sin ningún `bg-*` ni
`:style` propio — hereda `bg-card` del `<Card>` ancestro) pasa a llevar su
propio `background-color` con el tinte pastel.

### 8.1 Decisión de opacidad: 16%, misma cifra en light y en dark

`withAlpha(color, 0.16)` para el fondo completo de la card, en ambos temas.
Justificación:

- **Por qué no repetir el argumento de "12% se ve lavado" de la sección 2.2**:
  ese argumento aplicaba a un wash de fondo de **fila casi blanca** compitiendo
  visualmente con un **ícono sólido pequeño** al lado — el wash perdía contra
  el ícono y el ojo lo leía como "gris con un ícono de color". Acá el pastel
  **es** el fondo completo de la card (no compite con nada más grande), así
  que el mismo argumento no aplica: un 12-18% sobre una card entera SÍ se lee
  como "card de color" a primera vista, exactamente como en la referencia.
  16% es el punto medio del rango sugerido por el Product Owner: suficiente
  para leerse como identidad de color inequívoca sin llegar a competir en
  saturación con el chip de ícono sólido (que sigue siendo notablemente más
  intenso que la card, preservando la jerarquía "card tenue, ícono fuerte").
- **Por qué la MISMA cifra (16%) funciona en los dos temas sin necesitar un
  número distinto para dark**: `withAlpha` devuelve un `rgba(...)` que el
  navegador compone contra el fondo real detrás del elemento — no contra un
  blanco fijo. Ese fondo real es `--card` (el `<Card>` ancestro), que
  **ya es distinto por tema** (`main.css`): `0 0% 100%` (blanco puro) en
  light, `222.2 47% 8%` (navy casi negro, ≈ `rgb(11,17,30)`) en dark. El
  mismo 16% de un color vívido compuesto contra blanco da un pastel claro
  (light mode); compuesto contra navy casi negro da un tinte oscuro sutil
  (dark mode) — el propio tema resuelve el problema, no hace falta duplicar
  la constante. Verificado con aritmética real:
  - Light, Esmeralda `#047857` @16% sobre blanco → `rgb(217,235,230)`
    (verde menta pálido, igual de "pastel" que la referencia).
  - Dark, Esmeralda `darkHex` `#06a87a` @16% sobre `rgb(11,17,30)` →
    `rgb(10,41,45)` (verde azulado oscuro apenas insinuado, no compite con
    el resto de superficies oscuras del tema — exactamente el comportamiento
    "tinte sutil, no pastel brillante chocando en dark" que pedía el Product
    Owner).
- **Uso de `resolveAccountColor(hex, isDark)` como color de entrada para
  Cuentas** (no el hex crudo): reusa la calibración de tema que ya existe
  (`darkHex`, sección 4.3 de `accounts-income-ux.md`) en vez de introducir una
  segunda regla de oscurecimiento solo para el fondo. Para Tarjetas
  (`COLOR_SWATCHES`, sin variante `darkHex`) se usa `card.color` tal cual en
  ambos temas — la aritmética de arriba confirma que incluso sin calibración
  de tema, el mismo 16% compuesto contra el `--card` oscuro real ya da un
  resultado sutil y legible (ver caso límite abajo).

### 8.2 Contraste de texto (`text-foreground` normal, sin invertir)

`text-foreground` seguía siendo el texto correcto en ambos temas — no hace
falta `readableTextColor` para el nombre/monto de la card (eso sigue siendo
exclusivo del ícono sobre su chip sólido). Motivo: al 16% de opacidad, la
luminancia del fondo resultante se mantiene muy cerca de la del `--card` base
del tema (casi blanca en light, casi negra en dark) — el tinte de color
apenas mueve la luminancia relativa lo suficiente como para requerir invertir
el texto.

**Caso límite chequeado explícitamente** (el que la consigna pedía
verificar): Ciruela, el jewel-tone más oscuro/saturado de
`ACCOUNT_COLOR_SWATCHES` (`#86198f` light / `darkHex` `#b321bf` dark) —
el que más se acerca a mover la luminancia:

- Dark, `#b321bf` @16% sobre `rgb(11,17,30)` → `rgb(38,20,56)`, luminancia
  relativa WCAG ≈ 0.012. Contraste contra `--foreground` dark
  (`210 40% 98%`, blanco casi puro) ≈ **16.9:1** — muy por encima de AA
  (4.5:1) e incluso de AAA (7:1). Sin ajuste necesario.
- Light, `#86198f` @16% sobre blanco → `rgb(213,193,215)` aprox., luminancia
  alta (>0.55). Contraste contra `--foreground` light (`222.2 84% 4.9%`,
  casi negro) queda igualmente muy por encima de AA.

Conclusión: con 16% de opacidad, **ningún** hex de las dos paletas
(`ACCOUNT_COLOR_SWATCHES` de 8 ni `COLOR_SWATCHES` de 10) empuja la
luminancia del fondo lo bastante lejos del `--card` base como para
comprometer el contraste de `text-foreground` — no hace falta ninguna
excepción por swatch ni invertir texto en ningún caso.

### 8.3 Ícono: sin cambios — el chip sólido ya cumple "más saturado que la card"

La referencia muestra el ícono en un tono visiblemente más intenso que el
pastel de fondo de la card. **No hace falta introducir una segunda variable
de opacidad para el chip** (p. ej. un chip "semi-transparente pero más
oscuro que el fondo"): el chip de ícono ya definido en la sección 1
(`resolveAccountColor(hex, isDark)`/`card.color` **sólido**, 100% opacidad)
es, por construcción, más saturado que cualquier tinte al 16% del mismo hex
— la relación "card tenue / ícono fuerte" que se ve en la referencia ya
queda cubierta con el chip existente sin tocarlo. Se descarta deliberadamente
inventar una tercera variable (chip a un alpha intermedio, p. ej. 40-50%)
por simplicidad: no aporta nada que el chip sólido actual no resuelva ya, y
evita una constante más que mantener/justificar.

### 8.4 Forma/radio/tamaño: sin cambios

Confirmado que el pedido es específicamente sobre el fondo, no sobre forma
ni tamaño — `rounded-lg` en card y chip, `size-10` (filas/tiles) y `size-8`
(header de grupo) se mantienen idénticos a la sección 1. No hace falta un
contenedor nuevo para el ícono: el chip sólido ya existente sigue siendo la
única superficie propia del ícono, ahora simplemente apoyado sobre un fondo
de card que dejó de ser neutro.

### 8.5 Consistencia entre las 4 ubicaciones (incluye el header denso de `CardTransactionsView.vue`)

Mismo tratamiento en las 4 pantallas — se decidió **no** hacer una excepción
"más sutil" para el header de grupo de `CardTransactionsView.vue` (32px,
`border-b`) a pesar de ser más denso que las cards/filas de las otras tres
ubicaciones. Motivo: el pedido explícito del Product Owner en esta revisión
es justamente unificar el tratamiento (mismo error de dos referencias
distintas que motivó revertir la sección 1); introducir una variante
distinta ahí ("borde izquierdo + wash muy leve") reabriría exactamente el
tipo de inconsistencia entre pantallas que este documento ya viene
corrigiendo dos veces. El `border-b border-border` del header se mantiene
(sigue aportando separación con la primera fila de movimientos del grupo,
independientemente del fondo).

**Nota aparte, sí específica de la densidad**: el header de
`CardTransactionsView.vue` es el único de los 4 que queda dentro de un
`<Card class="overflow-hidden py-0">` ya existente — el pastel solo tiñe el
`<div>` del header (no toda la `Card`), leyéndose como una franja de color en
la parte superior de la card de movimientos. Es el comportamiento esperado
(el resto de la card, con los movimientos individuales, se mantiene neutro),
no requiere ningún ajuste adicional.

### 8.6 Interacción con estados `hover`/`active` en los elementos clickeables

Efecto colateral encontrado al revisar el markup actual: en `HomeView.vue` y
`CardsDashboardView.vue`, el contenedor exterior es un `<button>` con
`hover:bg-accent` (clase Tailwind). Un atributo `:style` inline con
`background-color` **siempre gana** contra una clase de utilidad para la
misma propiedad CSS (el estilo inline tiene mayor prioridad que cualquier
selector de clase, con o sin `:hover`) — es decir, una vez que la card tiene
`:style="{ backgroundColor: ... }"`, el `hover:bg-accent` deja de tener efecto
visual alguno.

- En `HomeView.vue` el botón ya está `disabled`/`aria-disabled="true"` hoy
  (tile de solo vista previa, sin handler de click) — el problema es
  únicamente latente, no hay regresión visible ahora mismo.
- En `CardsDashboardView.vue` el botón **sí** es clickeable
  (`@click="router.push(...)"` a `card-detail`) — ahí sí es una regresión
  real de feedback si no se corrige.

**Fix**: reemplazar `hover:bg-accent` (y el ahora-inútil `active:` si
existiera) por un filtro que opera sobre los píxeles ya renderizados en vez
de competir por la propiedad `background-color` — funciona igual sin
importar si el fondo viene de una clase o de un `:style` inline:

```
transition-colors hover:bg-accent
```
→
```
transition hover:brightness-95 active:brightness-90
```

Aplicar este cambio de clase en **ambos** botones (`HomeView.vue` y
`CardsDashboardView.vue`) por consistencia, aunque en `HomeView.vue` no haya
un bug visible hoy (evita que reaparezca si esa tile se vuelve clickeable
más adelante, ver pendiente ya anotado en el proyecto). `AccountsView.vue`
(el `<div>` de fila en `/cuentas`) y el header de
`CardTransactionsView.vue` no tienen `hover:` propio hoy — no aplica.

### 8.7 Markup de referencia final (valores ya resueltos, no placeholders)

**Cuentas — `HomeView.vue`, tile de "Mis cuentas" (reemplaza el `<button>`
completo de la sección 1.1, agrega `:style` en el contenedor y cambia la
clase de hover):**

```html
<button
  v-for="account in topAccounts"
  :key="account.id"
  type="button"
  class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
  disabled
  aria-disabled="true"
>
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
  <div class="flex flex-col gap-0.5">
    <p class="truncate text-sm font-medium text-foreground">
      {{ account.name }}
    </p>
    <p
      class="text-sm font-semibold tabular-nums"
      :class="accountsStore.balanceFor(account.id) < 0 ? 'text-destructive' : 'text-foreground'"
    >
      {{ accountsStore.balanceFor(account.id) < 0 ? '-' : '' }}${{ formatAmount(Math.abs(accountsStore.balanceFor(account.id))) }}
    </p>
  </div>
</button>
```

**Cuentas — `AccountsView.vue`, fila de `/cuentas` (agrega `:style` al
`<div>` de la sección 1.1's ecuación de fila, sin cambios de clase — no hay
`hover:` propio):**

```html
<div
  class="flex items-center gap-3 px-4 py-3"
  :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
>
  <span
    class="flex size-10 shrink-0 items-center justify-center rounded-lg"
    :style="{ backgroundColor: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
  >
    <component
      :is="resolveAccountIcon(account.icon)"
      class="size-4.5"
      :style="{ color: readableTextColor(resolveAccountColor(account.color ?? '#6b7280', isDarkNow)) }"
    />
  </span>
  <!-- resto de la fila (nombre, uso, monto, DropdownMenu) sin cambios -->
</div>
```

**Tarjetas — `CardsDashboardView.vue`, fila de "Tus tarjetas" (agrega
`:style` al `<button>`, cambia clase de hover):**

```html
<button
  v-for="card in cardsRanking"
  :key="card.id"
  type="button"
  class="flex min-h-14 w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :style="{ backgroundColor: withAlpha(card.color, 0.16) }"
  @click="router.push({ name: 'card-detail', params: { id: card.id } })"
>
  <span
    class="flex size-10 shrink-0 items-center justify-center rounded-lg"
    :style="{ backgroundColor: card.color ?? 'hsl(var(--muted))' }"
  >
    <CreditCardIcon class="size-4.5" :style="{ color: readableTextColor(card.color) }" />
  </span>
  <!-- resto de la fila (nombre, últimos 4 dígitos) sin cambios -->
</button>
```

**Tarjetas — `CardTransactionsView.vue`, header de grupo por tarjeta
(agrega `:style` al `<div>` del header, sin cambios de clase):**

```html
<div
  class="flex items-center gap-2 border-b border-border px-4 py-3"
  :style="{ backgroundColor: withAlpha(group.card.color, 0.16) }"
>
  <span
    class="flex size-8 shrink-0 items-center justify-center rounded-lg"
    :style="{ backgroundColor: group.card.color ?? 'hsl(var(--muted))' }"
  >
    <CreditCardIcon class="size-4" :style="{ color: readableTextColor(group.card.color) }" />
  </span>
  <!-- resto del header (nombre + últimos 4 dígitos) sin cambios -->
</div>
```

`withAlpha(undefined/null, ...)` ya devuelve `undefined` (guard existente en
`src/lib/colors.ts`) — si `card.color`/`group.card.color` viniera `null`, el
`:style` simplemente omite `background-color` y la card hereda el `bg-card`
neutro del ancestro, mismo comportamiento defensivo que ya tenía el chip de
ícono con su fallback `'hsl(var(--muted))'`.

### 8.8 Tabla de decisión (resumen)

| Propiedad | Valor | Nota |
|---|---|---|
| Opacidad fondo de card, light | `withAlpha(color, 0.16)` | Sobre `--card` blanco → pastel claro |
| Opacidad fondo de card, dark | `withAlpha(color, 0.16)` (misma cifra) | Sobre `--card` navy casi negro (`222.2 47% 8%`) → tinte oscuro sutil, sin número nuevo |
| Color de entrada, Cuentas | `resolveAccountColor(hex, isDark)` | Reusa `darkHex` ya calibrado, no una regla nueva |
| Color de entrada, Tarjetas | `card.color` tal cual (sin variante dark) | 16% sobre `--card` oscuro ya da resultado sutil sin calibración extra (sección 8.1) |
| Color del ícono | Sin cambios: `resolveAccountColor`/`card.color` sólido + `readableTextColor` | Chip sólido ya es "más saturado" que el pastel de fondo por construcción |
| Chip propio para el ícono | Sí, sin cambios (sección 1) | No se introduce una opacidad intermedia nueva (sección 8.3) |
| Texto de nombre/monto | `text-foreground` normal, ambos temas | Verificado con luminancia — nunca requiere invertir (sección 8.2) |
| Forma/radio/tamaño | Sin cambios (sección 1/8.4) | Pedido es sobre fondo, no forma |
| Header de grupo (`CardTransactionsView.vue`) | Mismo tratamiento, `border-b` se mantiene | Consistencia > densidad (sección 8.5) |
| `hover`/`active` en botones clickeables | `hover:bg-accent` → `hover:brightness-95 active:brightness-90` | El `:style` inline anula clases de `background-color` (sección 8.6) |

### 8.9 Archivos a tocar (actualiza la sección 7 para esta revisión)

- `src/views/HomeView.vue` — agrega `:style` de fondo pastel al `<button>` de
  cada tile de "Mis cuentas"; cambia `hover:bg-accent` →
  `hover:brightness-95 active:brightness-90`; agrega import de `withAlpha`
  desde `src/lib/colors.ts` (ya importa `resolveAccountColor`/
  `readableTextColor`).
- `src/views/AccountsView.vue` — agrega `:style` de fondo pastel al `<div>`
  de fila de `/cuentas`; agrega import de `withAlpha`.
- `src/views/CardsDashboardView.vue` — agrega `:style` de fondo pastel al
  `<button>` de "Tus tarjetas"; cambia `hover:bg-accent` →
  `hover:brightness-95 active:brightness-90`; agrega import de `withAlpha`.
- `src/views/CardTransactionsView.vue` — agrega `:style` de fondo pastel al
  `<div>` del header de grupo por tarjeta; agrega import de `withAlpha`.
- `src/lib/colors.ts` — sin cambios (`withAlpha`, `resolveAccountColor`,
  `readableTextColor` ya existen tal cual se necesitan).
- `docs/features/icon-color-chip-ux.md` (este archivo, sección 8 agregada).

No se toca `CardDetailView.vue` (sección 5 sigue vigente sin cambios: no
tiene tratamiento de color, y esta revisión no lo agrega — sigue siendo una
sugerencia opcional no implementada).
