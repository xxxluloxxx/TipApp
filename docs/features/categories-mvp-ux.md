# TipApp — UX de Gestión de Categorías (v1)

Documento de especificación funcional/UX para `vue-frontend-expert`. Cubre la
pantalla de gestión de categorías propias del usuario (crear/editar/borrar) —
lo único que faltaba del ciclo de vida de categorías, ya que alta/edición/
listado de **gastos** y la selección de categoría dentro de ese flujo están
resueltos en `docs/features/expenses-mvp-ux.md`. Da por sentado todo lo ya
resuelto en `docs/design-system.md` (tokens, tipografía, Sheet inferior,
Card-list, a11y) y en `expenses-mvp-ux.md` (patrón de Dropdown Menu del
header, patrón optimista, Skeleton/Alert de carga y error) — no se repite esa
justificación acá, solo se referencia.

Componentes shadcn-vue disponibles (ya instalados, **no se instala nada
nuevo**): Button, Input, Label, Card, Select (+ `SelectGroup`/`SelectLabel`/
`SelectSeparator`), Badge, Sheet, Alert Dialog, Dropdown Menu, Separator,
Sonner (toast), Skeleton, Alert/AlertDescription/AlertTitle.

Iconos `@lucide/vue` ya en uso: `EllipsisVertical`, `Moon`, `Pencil`, `Sun`,
`Trash2`, `Plus`, `LogOut`, `User`, `Loader2`, `AlertCircle`, `Inbox`/
`Receipt`, `RotateCcw`. Para esta iteración se suman como referencia (ninguno
requiere instalar paquete nuevo, `@lucide/vue` ya está en el proyecto):
`Tag` (item de menú "Categorías" y estado vacío), `ArrowLeft` (volver en el
header de la pantalla), `Check` (marca de color seleccionado en el swatch
picker).

**Actualización de esta iteración (selector de ícono/emoji)**: no se suma
ningún ícono `@lucide/vue` nuevo para el picker de emoji en sí — los 22
valores del set curado (sección 3.2) son emojis de texto plano (mismo tipo
de dato que ya usa `categories.icon`), no componentes de librería. La única
referencia visual que sí se reusa es el patrón ya shippeado de
`ACCOUNT_ICON_OPTIONS` en `AccountFormSheet.vue` (grid `size-11 rounded-full
bg-muted` con selección marcada solo por anillo, sin `Check` superpuesto) y
el patrón "Sin color" de `CardPersonFormSheet.vue`/`DebtPersonFormSheet.vue`
(celda con `border-dashed`) — ver sección 3.2 para el detalle completo.

Aclaración sobre el esquema: todo lo que sigue asume la tabla `categories`
tal cual está descripta en el encargo (columnas `id`, `user_id`, `name`,
`icon`, `color`, `created_at`, RLS ya activo, `expenses.category_id` con
`on delete restrict`). No se pide ningún cambio de esquema.

**Nota aparte, no bloqueante**: la sección "Colores de categoría (badges)"
de `design-system.md` describe una paleta abstracta de 8 slots fijos con hex
distintos a los 10 que realmente se sembraron en `categories.color`. Ese
esquema de slots quedó superado en la práctica: hoy cada categoría (default o
custom) trae su propio hex literal en la columna `color`, no un slot rotado.
Este documento usa los hex reales sembrados, no los de esa tabla de slots.
Vale la pena que alguien actualice esa sección de `design-system.md` en una
próxima pasada para que no queden dos fuentes de verdad — fuera de alcance
acá.

---

## 1. Punto de entrada

**Decisión: nueva ruta `/categorias` (no un Sheet/modal colgado del menú del
header, ni una pestaña dentro de Home).**

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/categorias` | `categories` | `{ requiresAuth: true }` | `CategoriesView` |

Entrada: nuevo item en el `DropdownMenu` del header de `HomeView` (el mismo
que hoy solo tiene identidad + "Cerrar sesión"), con ícono `Tag`:

```
[nombre / email]           (no clickeable)
─────────────────
Categorías                 (icono Tag)   → router.push('/categorias')
─────────────────
Cerrar sesión               (icono LogOut)
```

Dos separadores, no uno: el primero aísla el bloque de identidad (no
interactivo) del resto; el segundo separa la navegación normal ("Categorías")
de la acción de salida ("Cerrar sesión"), que conceptualmente es distinta
(termina la sesión, no navega a una sección de la app).

Justificación de ruta dedicada en vez de Sheet/modal:

- Es una pantalla de **gestión** (listar + crear + editar + borrar), no un
  formulario puntual de una sola tarea como el alta de gasto — mezclar
  listado largo + múltiples acciones dentro de un Sheet que además tiene que
  convivir con **otro** Sheet de alta/edición de categoría (Sheet-sobre-Sheet)
  es mala idea: Reka UI apila focus traps y el gesto de swipe-down para
  cerrar se vuelve ambiguo (¿cierra el de arriba o el de abajo?).
- Es una pantalla de baja frecuencia de uso (se entra una vez cada tanto para
  ajustar categorías, no varias veces por día como el alta de gasto) — no
  necesita estar a un tap de distancia desde el flujo principal; vive un
  nivel más adentro, como "ajustes", igual que "Cerrar sesión" hoy vive
  detrás de un menú y no en el header directo.
- Una ruta propia es deep-linkeable y compatible con el botón atrás del
  sistema en la PWA instalada (mismo argumento ya usado para `/login` y
  `/registro` en `expenses-mvp-ux.md` sección 1.1).

### 1.1 Header de `/categorias`

Barra superior propia, distinta a la de Home (esta es una pantalla "de
segundo nivel", no la raíz):

- Izquierda: botón ícono `variant="ghost" size="icon"` con `ArrowLeft`,
  `aria-label="Volver"` → `router.push({ name: 'home' })` (navegación
  explícita a Home, no `router.back()`: si el usuario llegó acá por deep
  link directo, `back()` podría no tener a dónde volver dentro de la app).
- Centro/izquierda: `Categorías` (`text-xl font-semibold`, mismo tamaño que
  `TipApp` en el header de Home).
- No hay acción a la derecha en esta barra (la acción de crear vive dentro
  del listado, ver sección 4) — evita amontonar dos botones de ícono
  distintos (volver + agregar) en la misma franja angosta.

---

## 2. Listado de categorías

Contenedor: `px-4 sm:px-6 lg:px-8`, ancho `max-w-2xl mx-auto` (una lista de
ajustes no necesita ancho completo en pantallas grandes). Dos secciones,
cada una un `Card` que envuelve una lista de filas separadas por
`Separator` — patrón "lista agrupada" (como una pantalla de ajustes),
deliberadamente distinto del Card-por-item de la lista de gastos: acá las
filas son homogéneas y no cada una necesita su propia elevación, así que un
único contenedor con separadores internos es menos ruido visual para una
lista de ~10-15 filas cortas.

### 2.1 Sección "Categorías predeterminadas"

- Encabezado de sección (`text-xs font-medium text-muted-foreground
  uppercase tracking-wide`): `Categorías predeterminadas`
- Debajo, en la misma jerarquía de metadatos (`text-xs
  text-muted-foreground`, sin mayúsculas): `No se pueden editar ni eliminar.`
  — esta frase, no un ícono de candado por fila, es la señal de "por qué no
  hay acciones acá". Un candado repetido 10 veces sería ruido; la frase una
  sola vez a nivel de sección alcanza y es más clara para lectores de
  pantalla (se lee una vez, no 10).
- Orden: `created_at asc` (el orden de siembra), que ya coincide con el
  orden dado en el encargo (Alimentación → ... → Otros). No hace falta
  ninguna columna de orden nueva — se evita tocar el esquema.
- Cada fila (`flex items-center gap-3 px-4 py-3`):
  - Swatch `size-8 rounded-full shrink-0 flex items-center justify-center`,
    fondo = `color` al ~12% de opacidad, borde `1px solid color`. Adentro:
    el emoji de `icon` (`text-base leading-none`) si existe — las 10
    default ya tenían `icon` seedeado desde antes; ahora las categorías
    custom también pueden tener el suyo propio (ver sección 3.2, selector de
    ícono agregado en esta iteración).
  - Nombre (`text-sm font-medium flex-1 truncate`).
  - Nada más a la derecha: sin badge, sin menú, sin chevron. La ausencia de
    controles es intencional y ya está explicada por el texto de sección de
    arriba.

### 2.2 Sección "Mis categorías"

- Encabezado en la misma fila: label de sección a la izquierda + botón de
  alta a la derecha (ver sección 4) cuando la lista tiene al menos 1 item.
- Orden: alfabético (mismo criterio ya usado en el `Select` de categoría del
  formulario de gasto, sección 3.5 de `expenses-mvp-ux.md`).
- Cada fila, mismo layout que 2.1 pero con dos agregados a la derecha:
  - Contador de uso (`text-xs text-muted-foreground`, no clickeable):
    `Sin gastos` si 0, `1 gasto` / `{n} gastos` si ≥1. Este contador cumple
    doble función: informa y **explica de antemano** por qué "Eliminar" va a
    aparecer deshabilitado en esa fila (ver sección 6).
  - Botón ícono `EllipsisVertical` (`size="icon"`, `h-11 w-11`,
    `aria-label="Opciones de {nombre}"`) que abre `DropdownMenu`:
    - `Editar` (ícono `Pencil`) → siempre habilitado.
    - `Eliminar` (ícono `Trash2`) → deshabilitado (`disabled`) si el
      contador de esa fila es ≥1 (ver sección 6).
  - **Actualizado en esta iteración**: las categorías custom ahora pueden
    tener su propio `icon` (selector agregado en sección 3.2) — el swatch de
    estas filas muestra el emoji igual que las default (2.1) cuando
    `icon` no es `NULL`. Si el usuario no eligió ninguno (fallback ya
    existente, sigue vigente para las categorías creadas antes de este
    cambio o para quien guarda con "Sin ícono"), el swatch solo tiene el
    punto de color centrado (`size-2.5 rounded-full`, mismo fondo que el
    swatch), sin emoji — el mismo tratamiento que ya tenía toda categoría
    custom antes de esta iteración.

### 2.3 Estado vacío de "Mis categorías" (usuario sin categorías propias)

No es un estado vacío de pantalla completa (la sección de defaults arriba ya
llena la pantalla) — es un bloque dentro del `Card` de esta sección:

- El botón de alta del encabezado de sección **no se muestra** en este caso
  (evita duplicar el mismo CTA dos veces en la pantalla); el único botón de
  crear pasa a vivir dentro de este bloque.
- Ícono `Tag` (`size-8 text-muted-foreground`), centrado.
- Texto (`text-sm font-medium text-center`): `Todavía no creaste categorías propias.`
- Subtexto (`text-xs text-muted-foreground text-center max-w-[220px] mx-auto`):
  `Creá una para organizar tus gastos como quieras.`
- Botón (`variant="outline"`, tamaño default/`h-11`, ícono `Plus`):
  `Nueva categoría` → abre el Sheet de alta (sección 4).
- Padding del bloque: `py-8 px-4`, `flex flex-col items-center gap-2`.

---

## 3. Formulario de alta/edición (Sheet inferior)

Mismo patrón de Sheet que `ExpenseFormSheet.vue`: `SheetContent
side="bottom"`, `SheetHeader` con `SheetTitle`/`SheetDescription`, body con
`gap-4 px-4`, `SheetFooter` con un único botón ancho completo (sin botón
"Cancelar" — mismo argumento que en gastos: el propio Sheet ya tiene
affordance de cierre).

- Alta: `SheetTitle` = `Nueva categoría`, `SheetDescription` = `Elegí un
  nombre, un ícono y un color para tu categoría.` (actualizado en esta
  iteración — antes decía solo "un nombre y un color", ver sección 3.2).
- Edición: `SheetTitle` = `Editar categoría` (sin description, redundante).
- Botón footer: `Guardar categoría` (alta) / `Guardar cambios` (edición).
  Loading: `disabled` + `Loader2` girando + `Guardando…` (mismo texto para
  ambos modos, como en el Sheet de gasto).

### 3.1 Campo: Nombre

- `<Label for="nombre-categoria">Nombre</Label>`
- `<Input id="nombre-categoria" placeholder="Ej. Mascotas" maxlength="40">`
  (40 caracteres alcanza de sobra: el default más largo, "Ahorro e
  inversión", tiene 19).
- Validación, en `blur` (no en cada tecla, mismo criterio que registro):
  - Vacío (tras `trim()`): `Ingresá un nombre para la categoría.`
  - **Duplicado, case-insensitive, contra defaults + las propias custom del
    usuario (excluyéndose a sí misma en modo edición)**: `Ya existe una
    categoría con ese nombre.`

  Nota importante sobre el alcance de esta validación: el índice único de la
  base de datos, según el encargo, solo garantiza unicidad *entre* las
  defaults (algo trivial, nadie las edita) y *por usuario entre sus propias
  custom* — no impide que un usuario cree una custom llamada igual a una
  default (p. ej. otra "Alimentación"). Dejar pasar eso sería confuso: en el
  `Select` de categoría del formulario de gasto quedarían dos filas con
  literalmente el mismo texto, distinguibles solo por estar en grupos
  distintos y por un punto de color — mal escenario de "casi indistinguible"
  para un dato que el usuario elige rápido y de memoria. Por eso el frontend
  agrega esta regla de negocio **por encima** del esquema, comparando en
  cliente contra la lista completa ya cargada en memoria (defaults + custom
  propias) antes de guardar. No se pide ningún cambio de esquema para esto.

  Igual, como backstop defensivo ante una carrera real (dos pestañas
  creando el mismo nombre al mismo tiempo), si Supabase devuelve el error de
  índice único (código Postgres `23505`) al guardar, se muestra el mismo
  mensaje `Ya existe una categoría con ese nombre.` como error inline debajo
  del campo Nombre (no toast) y se refoca el input — ver 3.4.

### 3.2 Campo: Ícono (agregado en esta iteración — reemplaza la decisión de v1)

**Reemplaza por completo la decisión anterior.** La v1 de este documento
omitía el selector de ícono porque nada en el frontend consumía `icon` para
categorías custom todavía (esa nota queda obsoleta a partir de acá). Pedido
explícito del Product Owner: *"debería también poder elegir un ícono, algo
lindo, a colores, como las categorías por defecto"* — se agrega un selector
de emoji con el mismo nivel de prolijidad que el selector de Color ya
existente (grid fijo curado, no un picker nativo del SO/teclado ni un
`<Input>` de texto libre).

**Por qué un grid fijo curado y no el emoji picker nativo del SO/teclado o
un input libre**: mismo argumento ya validado para Color (sección 3.3) — un
picker abierto permitiría elegir emojis sin ninguna relación con gastos
personales, o (si fuera un `<Input>` de texto) pegar texto que no es un
emoji real, o una secuencia multi-codepoint con ZWJ que se renderice mal en
algún dispositivo. Un set curado y acotado es más rápido de elegir dentro de
un Sheet chico, más prolijo visualmente, y garantiza que todo emoji ofrecido
tenga sentido real para una categoría de gasto personal.

**Orden en el formulario: Ícono va antes que Color** (mantiene el orden de
secciones ya existente en este documento — 3.2 antes de 3.3 — sin
renumerar). No hay un motivo fuerte para invertir ese orden; elegir el
emoji primero y después el color en el que se va a apoyar es una secuencia
igual de natural que la inversa.

#### Set curado: 22 emojis + "Sin ícono" (23 celdas, layout `flex-wrap`, no grid fijo)

Deliberadamente sin repetir ninguno de los 12 emoji ya sembrados en
categorías default (🍽️ Alimentación, 🚗 Transporte, 🏠 Vivienda, 💡
Servicios, 💊 Salud, 📚 Educación, 🎬 Entretenimiento, 👕 Ropa, 💰 Ahorro e
inversión, 📦 Otros, 🏦 Comisiones bancarias, ⚖️ Ajuste de saldo) — así una
categoría custom nunca se confunde visualmente con una default dentro del
`Select` de categoría del formulario de gasto. **Ronda 2** (pedido explícito
del Product Owner tras ver la primera versión): se sumaron 🍺/⛽/📶 y se
reemplazó ⚽ por 🏀 en "Deportes":

| Emoji | Concepto (`aria-label`) |
|---|---|
| 🐾 | Mascotas |
| 🏀 | Deportes |
| 💻 | Tecnología |
| 🎁 | Regalos |
| ✈️ | Viajes |
| 💅 | Belleza y cuidado personal |
| 👶 | Hijos y familia |
| 🧾 | Impuestos y trámites |
| 🔁 | Suscripciones |
| 🔧 | Herramientas y hogar |
| 🎮 | Videojuegos |
| 🎵 | Música |
| 📖 | Libros |
| ☕ | Café y bares |
| 🏋️ | Gimnasio y fitness |
| 🛒 | Supermercado |
| 💼 | Trabajo |
| 🎨 | Hobbies y arte |
| 🌱 | Plantas y jardín |
| 🍺 | Cerveza y bebidas |
| ⛽ | Gasolina y combustible |
| 📶 | Internet |

La implementación real (`CategoryFormSheet.vue`) usa `flex flex-wrap`, no un
grid fijo de columnas — mismo patrón ya usado por el picker de color
(`COLOR_SWATCHES`), que se ajusta solo al ancho disponible. La última celda
es el botón **"Sin ícono"** — no es un emoji más, es la opción explícita de
"sin selección", ver más abajo.

#### Layout y marca de selección

Calcado del selector de Color (sección 3.3) con un matiz deliberado en cómo
se marca la selección:

- `<Label id="icono-categoria-label">Ícono <span class="font-normal
  text-muted-foreground">(opcional)</span></Label>` +
  `<div role="group" aria-labelledby="icono-categoria-label" class="flex flex-wrap gap-3">`.
- Cada celda: `<button type="button" class="relative flex size-11 shrink-0
  items-center justify-center rounded-full bg-muted outline-none
  focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :class="{ 'ring-2 ring-offset-2 ring-ring': form.icon === item.emoji }"
  :aria-pressed="form.icon === item.emoji" :aria-label="item.label">`, con
  el emoji adentro (`text-xl leading-none` — más grande que el `text-base`
  usado en la fila de la lista, sección 2.1, porque acá el emoji es el
  único contenido de una celda de 44px y necesita más presencia).
- **Selección marcada solo con anillo (`ring-2 ring-offset-2 ring-ring`) +
  `aria-pressed`, sin `Check` superpuesto** — a diferencia del swatch de
  Color, que sí usa `Check` (sección 3.3). Motivo: en el grid de Color
  todas las celdas son visualmente iguales salvo un matiz de fondo (hace
  falta un `Check` para que la selección no dependa de percibir una
  diferencia de color sutil); acá cada celda ya es visualmente única — un
  `Check` superpuesto solo taparía el propio emoji sin sumar información.
  Mismo criterio ya en producción en `AccountFormSheet.vue`
  (`ACCOUNT_ICON_OPTIONS`, grid de íconos de cuenta): anillo + `aria-pressed`
  siguen cumpliendo "nunca solo color" (es cambio de forma, no de tono, más
  el estado semántico para lectores de pantalla), sin duplicar el patrón de
  Color donde no aplica.
- **Última celda, "Sin ícono"**: mismo tratamiento que "Sin color" ya
  shippeado en `CardPersonFormSheet.vue`/`DebtPersonFormSheet.vue` (círculo
  con `border border-dashed border-border`, sin relleno de `bg-muted`) —
  pero el glifo interno es distinto a propósito: en vez de un ícono `User`
  (no aplica a una categoría), muestra el mismo punto neutro que ya usa hoy
  una fila de categoría custom sin ícono en el listado (`<span
  class="size-2.5 rounded-full bg-muted-foreground/40" />`, sección 2.2) —
  la celda "Sin ícono" es así un adelanto visual exacto de cómo se ve hoy
  una categoría sin emoji, no un glifo nuevo sin relación previa.
  `aria-label="Sin ícono"`.

#### Opcionalidad

Confirmado: el campo es 100% opcional, nunca bloquea el guardado, sin
mensaje de error posible (no existe un `errors.icon`). Con un matiz respecto
al patrón "Sin color" de `CardPersonFormSheet`/`DebtPersonFormSheet`: esos
Sheets distinguen con una bandera `hasChosenColor` el estado "todavía no
toqué nada" de "elegí explícitamente Sin color", precisamente para no dar
por seleccionado un swatch que el usuario nunca tocó **mientras el campo es
obligatorio en otro lado del mismo Sheet** (a Color de categoría, sección
3.3, si le aplica esa misma exigencia). Acá esa bandera extra no hace falta:
no hay ninguna validación que dependa de si el usuario tocó el campo o no.

- **Alta**: `form.icon` arranca en `null` → la celda "Sin ícono" aparece
  marcada por default (`aria-pressed="true"`) desde que se abre el Sheet,
  comunicando con precisión el resultado real si el usuario no toca nada
  (se guarda sin ícono, igual que hoy). No hace falta forzar un tap
  explícito en "Sin ícono" como si fuera una opción más — es, literalmente,
  el estado inicial real.
- **Edición**: si `category.icon` coincide con uno de los 22 emojis del set
  curado, se preselecciona esa celda. Si no coincide (`NULL`, o un emoji
  fuera del set — dato legado o sembrado a mano en la base), se
  preselecciona "Sin ícono" **sin bloquear el guardado** — a diferencia del
  caso análogo de Color (sección 3.3, que si exige elegir de nuevo antes de
  guardar porque Color es obligatorio), acá guardar sin tocar nada
  simplemente conserva ese estado ("sin ícono reconocido"), porque ninguna
  regla obliga a tener uno.

#### Preview conjunta (sí, combinada con Color, en vivo)

Inmediatamente debajo del campo Nombre (antes de los grids de Ícono y
Color) se agrega una fila de vista previa que refleja, en vivo, exactamente
cómo se va a ver la fila de esta categoría en el listado real (mismo swatch
de la sección 2.1/2.2 — fondo `withAlpha(color, 0.12)` + borde `1px solid
color` + emoji centrado) a medida que se elige ícono/color, en vez de que el
usuario tenga que imaginarse la combinación o esperar a guardar para verla:

```html
<div class="flex items-center gap-3 py-1">
  <div
    class="flex size-11 shrink-0 items-center justify-center rounded-full"
    :style="form.color
      ? { background: withAlpha(form.color, 0.12), border: `1px solid ${form.color}` }
      : { border: '1px dashed var(--border)' }"
  >
    <span v-if="form.icon" class="text-lg leading-none">{{ form.icon }}</span>
  </div>
  <span class="text-sm text-muted-foreground truncate">
    {{ form.name.trim() || 'Tu categoría' }}
  </span>
</div>
```

- Reusa el mismo cálculo (`withAlpha`, ya exportado en `src/lib/colors.ts`)
  que la fila real de la lista — no una versión simplificada aparte, para
  que no haya ninguna sorpresa entre "lo que vi en el formulario" y "lo que
  quedó guardado".
- Sin color elegido todavía: círculo con borde punteado y sin relleno —
  mismo lenguaje visual que las celdas "Sin color"/"Sin ícono" de sus
  propios grids, en vez de un gris sólido que se leería como "ya tiene un
  color asignado".
- Sin ícono elegido todavía: círculo vacío (sin emoji adentro) — igual que
  se ve hoy una categoría custom sin ícono en la lista real (sección 2.2),
  consistente, no un placeholder inventado.
- El texto al lado usa el nombre ya tipeado, o `Tu categoría` como
  placeholder genérico mientras el campo Nombre está vacío — nunca queda en
  blanco, para que la fila de preview no colapse a un ancho distinto y
  genere un salto visual apenas el usuario empieza a tipear.

#### Nota de implementación (no vinculante, a criterio de `vue-frontend-expert`)

El set de 22 emojis puede vivir como una constante local dentro de
`CategoryFormSheet.vue` (p. ej. `CATEGORY_ICON_OPTIONS`), siguiendo el mismo
patrón que ya usa ese archivo para `COLOR_SWATCHES` (copia local, no
importada de `src/lib/colors.ts` — ver el comentario en ese archivo que ya
documenta esta duplicación consciente). No parece haber necesidad de
centralizarlo en `colors.ts` todavía: a diferencia de `COLOR_SWATCHES`/
`ACCOUNT_COLOR_SWATCHES`, este set no tiene un segundo consumidor previsto.

### 3.3 Campo: Color

Grid de **10 swatches fijos** (uno por cada hex ya sembrado en las
categorías default: `#f97316`, `#3b82f6`, `#8b5cf6`, `#eab308`, `#ef4444`,
`#06b6d4`, `#ec4899`, `#14b8a6`, `#22c55e`, `#6b7280`), 5 columnas × 2 filas,
`gap-3`.

- `<Label id="color-categoria-label">Color</Label>` +
  `<div role="group" aria-labelledby="color-categoria-label" class="flex flex-wrap gap-3">`.
- Cada swatch: `<button type="button" class="size-11 rounded-full"
  :style="{ background: hex }" :aria-pressed="selected" :aria-label="nombreDeColor">`
  — `size-11` (44px) por la regla de mínimo táctil del design system, no
  `size-8`/`size-9` "porque se ve más prolijo".
- Nombres para `aria-label` (para que un lector de pantalla anuncie algo
  útil, no un hex): Naranja, Azul, Violeta, Amarillo, Rojo, Celeste, Rosa,
  Verde azulado, Verde, Gris.
- Selección: el swatch elegido muestra un ícono `Check` superpuesto (blanco
  u oscuro según el contraste del swatch — mismo criterio de texto
  oscuro/claro que ya define `design-system.md` para los slots de bajo
  contraste) además de `ring-2 ring-offset-2 ring-ring`. El `Check` es la
  señal principal (no depende de percibir el anillo), el anillo es refuerzo
  — cumple "nunca solo color" también acá: la selección se nota por la
  marca, no solo porque el swatch "se ve distinto".
- Requerido: si se intenta guardar sin haber tocado ningún swatch, error
  (mostrado debajo del grid, `text-sm text-destructive`):
  `Elegí un color para la categoría.`
- No hay color preseleccionado por default al crear — igual criterio que la
  categoría en el formulario de gasto (sección 3.5 de `expenses-mvp-ux.md`):
  forzar una elección consciente evita que varias categorías custom queden
  todas con "el primer color de la lista" por apuro.
- En edición: preselecciona el swatch que coincide con `category.color`. Si
  por algún motivo el valor guardado no coincide con ninguno de los 10 (dato
  legado, edición manual en la base), no preselecciona ninguno y exige elegir
  de nuevo antes de guardar — no se inventa un 11º swatch dinámico para ese
  caso raro.

Por qué swatches fijos y no `<input type="color">` nativo ni un color
picker de terceros:
- No hay ningún componente de color picker instalado y no se justifica
  instalar uno para elegir entre, en la práctica, un puñado de colores.
- Un picker de color arbitrario permitiría elegir tonos con contraste pobre
  contra el texto del Badge, o tonos casi idénticos a una categoría
  existente (con solo 10-15 categorías totales esperables, la separación
  perceptual importa) — los 10 hex ya sembrados fueron, se asume, elegidos
  con ese criterio; reutilizarlos tal cual es más seguro que dejar
  cualquier hex.
- Reutiliza lo que ya existe en el sistema (`categories.color` de las
  defaults) en vez de introducir una paleta nueva, siguiendo el criterio
  general de este rol de preferir reutilizar antes que inventar.

### 3.4 Comportamiento al guardar: por qué NO es 100% optimista como en gastos

Gastos usa "cerrar el Sheet de inmediato + insertar optimista" (sección 3.8
de `expenses-mvp-ux.md`) porque **todas** sus validaciones son 100%
verificables en cliente antes del roundtrip. Categorías casi siempre
también lo son (la validación de duplicado corre en cliente contra la lista
ya cargada, sección 3.1) — pero queda un caso residual que el cliente no
puede descartar con certeza: una carrera entre dos guardados simultáneos
(dos pestañas, o esta pantalla abierta en dos dispositivos) que ambos pasan
la validación de cliente porque, en el instante de validar, todavía no
existía el conflicto.

Decisión: el Sheet de categoría **permanece abierto durante el guardado**
(no se cierra de inmediato como en gastos) y solo se cierra cuando la
llamada a Supabase confirma éxito. Es la única diferencia deliberada con el
patrón de gastos:

1. Al tocar "Guardar categoría"/"Guardar cambios" y pasar la validación de
   cliente (3.1 + 3.3), el botón pasa a estado `Guardando…` (disabled +
   `Loader2`), los campos se deshabilitan, y el Sheet no se puede cerrar por
   tap-fuera/swipe/Escape mientras dure (mismo mecanismo que 3.7 de
   `expenses-mvp-ux.md`).
2. Si Supabase confirma: se agrega (alta) o actualiza (edición) el objeto en
   la lista local ya con el dato real devuelto por el servidor, el Sheet se
   cierra, y se muestra `toast.success('Categoría creada', { description: '"{nombre}" ya está disponible para tus gastos.' })`
   (alta) o `toast.success('Categoría actualizada')` (edición).
3. Si Supabase devuelve el conflicto de nombre duplicado (`23505`, el caso
   de carrera): el Sheet **no se cierra**, los campos se rehabilitan, se
   muestra el error inline `Ya existe una categoría con ese nombre.` debajo
   del campo Nombre (mismo mensaje que la validación de cliente) y se
   refoca ese input — no hay toast para este caso, es un error corregible
   in-place, mismo criterio que "email ya registrado" en `/registro`.
4. Si falla por cualquier otro motivo (red, error inesperado): el Sheet
   tampoco se cierra, los campos se rehabilitan, y se muestra
   `toast.error('No se pudo guardar la categoría', { description: 'Revisá tu conexión e intentá de nuevo.' })`.
   No hace falta un botón "Reintentar" en el toast acá (a diferencia de
   gastos): el formulario sigue completo en pantalla, el usuario reintenta
   tocando el mismo botón de guardar sin perder nada.

Esta excepción es acotada y explícita — no cambia el patrón optimista para
**borrado** de categoría (sección 5), que sí se mantiene optimista porque no
tiene este tipo de validación server-only en el camino feliz (el chequeo de
"tiene gastos asociados" ya se resuelve de antemano, sección 6).

---

## 4. Alta de categoría: punto de entrada del Sheet

**Decisión: un único punto de entrada, el botón "Nueva categoría" dentro de
la sección "Mis categorías" de `/categorias`** (encabezado de sección
cuando hay al menos 1 custom, o dentro del bloque de estado vacío cuando no
hay ninguna — sección 2.2/2.3). No se agrega un atajo "Crear categoría"
embebido en el `Select` de categoría del formulario de gasto.

Justificación de no embeber el atajo en el Select del gasto (opción que sí
se consideró):

- **Frecuencia esperada baja**: se espera que la mayoría de los usuarios use
  las 10 categorías default casi todo el tiempo, y cree como máximo un
  puñado de custom una sola vez (no es una acción que se repita en cada
  carga de gasto). El costo de un paso extra de navegación (Home → menú →
  Categorías → Nueva) es aceptable para una acción infrecuente; el costo de
  complejizar el flujo de alta rápida de gasto —la tarea más frecuente de
  toda la app— no lo es.
- **Complejidad de Sheet-sobre-Sheet**: el `Select` de categoría ya vive
  dentro del Sheet de alta/edición de gasto. Un "+ Crear categoría" ahí
  abriría un segundo Sheet apilado sobre el primero (o tendría que cerrar el
  del gasto, perdiendo lo ya tipeado en monto/fecha/descripción) — cualquiera
  de las dos opciones es peor que simplemente pedirle al usuario que, la
  primera vez, cree sus categorías desde `/categorias` antes de cargar el
  gasto.
- **Descubribilidad**: el nuevo item "Categorías" en el menú del header
  (sección 1) ya es un punto de entrada suficientemente visible para una
  acción de configuración infrecuente — no todas las acciones necesitan
  vivir en el camino crítico para ser descubribles.

Si en una futura iteración los datos de uso muestran que los usuarios crean
categorías custom seguido (p. ej. varias por semana), ahí sí valdría
reconsiderar un atajo embebido — no se descarta para siempre, se descarta
para v1.

---

## 5. Edición y borrado de categoría custom

- **Editar**: `DropdownMenuItem` "Editar" (sección 2.2) abre el mismo Sheet
  de la sección 3 en modo edición, precargado con `name` y `color` de la
  categoría seleccionada. Mismas validaciones (3.1, 3.3), mismo
  comportamiento de guardado no-optimista (3.4).
- **Borrar**: `DropdownMenuItem` "Eliminar" (deshabilitado si tiene gastos
  asociados, ver sección 6) abre un `AlertDialog` de confirmación — mismo
  patrón ya establecido para eliminar un gasto:
  - `AlertDialogTitle`: `¿Eliminar "{nombre}"?`
  - `AlertDialogDescription`: `Esta acción no se puede deshacer.`
  - Botones: `Cancelar` (secundario) / `Eliminar` (`variant="destructive"`).
  - Confirmado: **sí es optimista** — se remueve la fila de la lista local
    de inmediato y se cierra el diálogo, luego:
    - Si el `delete()` a Supabase confirma: `toast.success('Categoría eliminada')`.
    - Si falla (incluida la carrera rara de la sección 6): se **restaura**
      la fila en su posición (reinserción alfabética) y se muestra
      `toast.error('No se pudo eliminar la categoría', { description: 'Revisá tu conexión o si tiene gastos asociados.' })`.
      Sin acción "Reintentar" en este toast: si la causa real fue la carrera
      de "le agregaron un gasto justo ahora", reintentar el mismo delete
      volvería a fallar igual — mejor que el usuario vea la fila restaurada
      con su contador actualizado (que ya reflejaría el gasto nuevo) y decida
      con esa información.

---

## 6. Borrar categoría con gastos asociados

**Decisión: se confirma la sugerencia de bloquear el borrado desde la UI,
de forma proactiva (deshabilitando la acción) en vez de reactiva (dejar
intentar y mostrar un error después del roundtrip).** Se prefiere proactivo
por un motivo concreto de UX: un botón "Eliminar" habilitado que, al
tocarlo, abre un `AlertDialog` de confirmación que el usuario acepta, para
recién ahí enterarse de que no se puede —es una fricción de dos pasos
perdidos (abrir confirmación, tocar confirmar) para terminar en el mismo
"no se puede" que ya se sabía de antemano con un simple `count`. Deshabilitar
de entrada ahorra esos dos pasos y es igual de honesto si se acompaña de
una razón visible (el contador de la fila, sección 2.2) en vez de ser un
botón gris sin explicación.

Mecanismo:

- Al cargar `/categorias`, junto con la lista de categorías se trae un
  conteo de gastos por categoría custom del usuario (un `count(*)` agrupado
  por `category_id`, filtrado a los gastos del propio usuario — no requiere
  cambio de esquema, es una agregación simple sobre `expenses`). Este
  conteo se carga **junto con** la lista, no bajo demanda al tocar el menú
  de una fila — así el estado deshabilitado ya es correcto desde el primer
  render y no hay un parpadeo de "estaba habilitado y ahora no".
  - Si esta parte de la carga falla, se trata como falla de carga de toda
    la pantalla (sección 7) — no hay un estado degradado de "categorías sí,
    conteos no": es más simple y más seguro no ofrecer borrar nada si no se
    puede confirmar con certeza que es seguro hacerlo.
- El contador ya visible en cada fila custom (`Sin gastos` / `{n} gastos`,
  sección 2.2) es, a la vez, la información de uso y la explicación de por
  qué "Eliminar" está deshabilitado — no se agrega un segundo texto
  redundante tipo "(no se puede eliminar)" al lado del ítem del menú.
- `DropdownMenuItem` "Eliminar" recibe la prop `disabled` cuando el conteo
  de esa fila es ≥ 1. Reka UI marca el item como no interactivo
  (`aria-disabled`) y con opacidad reducida — el motivo ya fue comunicado
  como texto en la fila antes de que el usuario llegue a abrir el menú, así
  que no hace falta un mensaje adicional en el propio item deshabilitado.
- Si `count === 0`, "Eliminar" queda habilitado y sigue el flujo normal de
  la sección 5.
- Backstop defensivo (carrera: se agrega un gasto a esa categoría entre que
  se cargó el conteo y que se confirma el borrado): si igual llega un error
  `23503` (foreign key violation) desde Supabase al confirmar, no se deja
  pasar un error crudo de Postgres al usuario — se maneja igual que
  cualquier otra falla del `delete()` optimista (sección 5): se restaura la
  fila y se muestra el mismo toast de error genérico
  (`No se pudo eliminar la categoría. Revisá tu conexión o si tiene gastos asociados.`).

No se construye ningún flujo de "reasignar gastos a otra categoría antes de
borrar": coincido con el criterio de partida del encargo — sería una
feature bastante más grande (UI de selección de categoría destino + update
masivo con su propio manejo optimista/errores) para un beneficio marginal en
v1, cuando la alternativa (dejar la categoría, o borrar los gastos primero
si el usuario realmente quiere limpiarla) ya cubre el caso real de uso sin
construir nada nuevo.

---

## 7. Estados de carga y error de `/categorias`

Mismo lenguaje visual que `HomeView` (sección 2.5/2.6 de
`expenses-mvp-ux.md`).

### 7.1 Carga

Mientras se resuelve la query combinada de categorías + conteos:

- Se muestran los dos `Card` de sección (títulos "Categorías predeterminadas"
  / "Mis categorías" ya visibles, no son parte del skeleton) con filas
  `Skeleton` adentro en vez del contenido real: 4 filas skeleton en la
  sección de defaults, 2 en la de "Mis categorías" — números fijos
  arbitrarios que comunican "está cargando" sin intentar adivinar la
  cantidad real (mismo criterio que las "4 cards" del skeleton de gastos).
- Cada fila skeleton reproduce la forma de una fila real: `Skeleton
  size-8 rounded-full` (el swatch) + `Skeleton h-4 w-32` (el nombre) +, en
  la sección de custom, `Skeleton h-3 w-16` (el contador) + `Skeleton
  size-11 rounded-md` (el botón de menú).
- El botón "Nueva categoría" del encabezado de sección **no se muestra**
  durante la carga (mismo criterio que el FAB de Home: no ofrecer una
  acción que depende de saber el estado real de los datos hasta que se
  resuelva).

### 7.2 Error

Reemplaza **todo** el contenido bajo el header (ambas secciones) por un
bloque centrado, igual patrón que 2.6 de `expenses-mvp-ux.md`:

- Ícono `AlertCircle` (`size-12 text-destructive`).
- Título (`text-lg font-semibold`): `No pudimos cargar tus categorías`
- Texto (`text-sm text-muted-foreground`): `Revisá tu conexión e intentá de nuevo.`
- Botón (`variant="outline"`, ícono `RotateCcw`): `Reintentar` → reintenta
  la misma query combinada, sin recargar la página.

---

## 8. Accesibilidad

Se reafirman y aplican acá los lineamientos de `design-system.md` sección 5,
con las particularidades de esta pantalla:

1. **Mínimos táctiles 44×44px**: botón "Nueva categoría" (`h-11`, no
   `size="sm"`), botón de menú `⋮` por fila (`h-11 w-11`), swatches de
   color (`size-11`, no `size-8`/`size-9` "porque se ve más prolijo" — la
   misma advertencia textual del design system aplica literalmente acá).
2. **Nunca solo color**:
   - Default vs. custom: se distingue por agrupación con encabezados de
     texto ("Categorías predeterminadas" / "Mis categorías") + una frase
     explícita ("No se pueden editar ni eliminar."), no por un tono de fondo
     distinto entre secciones.
   - Selección de color en el swatch picker: ícono `Check` superpuesto +
     anillo de foco, no solo un cambio sutil de brillo/borde.
   - Selección de ícono en el emoji picker (sección 3.2, agregado en esta
     iteración): anillo de foco (cambio de forma, no de tono) + `aria-pressed`
     — sin `Check` superpuesto acá porque cada celda ya es visualmente única
     (un emoji distinto por botón), a diferencia del grid de Color.
   - Motivo de "Eliminar" deshabilitado: el contador de gastos en texto
     plano junto a la fila, no solo la opacidad reducida del item.
3. **Foco visible**: mismo patrón `focus-visible:ring-2 focus-visible:ring-ring
   focus-visible:ring-offset-2` en swatches, botón de menú y botón de alta.
4. **Labels asociados, no placeholder-only**: `<Label for="nombre-categoria">`
   asociado al input de nombre; el grupo de swatches usa
   `role="group"` + `aria-labelledby` apuntando a un `<Label>` visible
   ("Color"), no solo un `<span>` decorativo.
5. **Confirmación antes de destruir**: borrado de categoría pasa por
   `AlertDialog`, igual que borrado de gasto — nunca se ejecuta directo
   desde el tap en "Eliminar".
6. **Texto exacto anunciable**: los `aria-label` de cada swatch usan nombres
   de color en español (Naranja, Azul, Violeta, ...), no el hex crudo — un
   lector de pantalla anunciando "#f97316" no comunica nada útil al usuario.
7. **`prefers-reduced-motion`**: heredado de Sheet/AlertDialog (Reka UI), sin
   necesidad de configuración adicional acá.

---

## Resumen para `vue-frontend-expert`

1. Nueva ruta `/categorias` (`name: 'categories'`, `meta: { requiresAuth: true }`),
   con header propio (`ArrowLeft` + "Categorías", vuelve a `/` explícito, no
   `router.back()`). Nuevo item "Categorías" (ícono `Tag`) en el
   `DropdownMenu` del header de `HomeView`, entre el bloque de identidad y
   "Cerrar sesión", con su propio separador.
2. `CategoriesView` carga en una sola operación: categorías (defaults +
   propias) + conteo de gastos por categoría propia. Dos secciones en
   `Card` separados: "Categorías predeterminadas" (orden `created_at asc`,
   sin acciones, muestra `icon` + `color`) y "Mis categorías" (orden
   alfabético, con contador de uso, menú Editar/Eliminar, botón "Nueva
   categoría" en el encabezado o en el estado vacío de la sección).
3. Sheet de alta/edición (`CategoryFormSheet`, mismo patrón que
   `ExpenseFormSheet`): campo Nombre (validado en `blur`, duplicado
   case-insensitive contra defaults + propias, backstop del error `23505`),
   una fila de **preview en vivo** (círculo con el color+ícono elegidos,
   igual swatch que la fila real de la lista, sección 3.2), campo **Ícono**
   (agregado en esta iteración — antes se omitía en v1: grid fijo de 19
   emojis curados + celda "Sin ícono" de 44px, 5 columnas × 4 filas,
   selección marcada solo con anillo + `aria-pressed`, sin `Check`,
   **opcional**, sin bloquear guardado) y campo Color (grid fijo de 10
   swatches de 44px con los hex ya sembrados, selección marcada con `Check`,
   requerido). A diferencia del Sheet de gasto, este **no se cierra
   optimísticamente**: permanece abierto hasta que Supabase confirma, por el
   caso de conflicto de nombre server-only (ver sección 3.4 para el porqué y
   el manejo exacto de cada rama de error).
4. Borrado: `AlertDialog` de confirmación (`¿Eliminar "{nombre}"?` / `Esta
   acción no se puede deshacer.`), remoción optimista de la fila, con
   rollback + toast de error si falla. "Eliminar" queda **deshabilitado de
   antemano** (no reactivamente) cuando el conteo de gastos de esa categoría
   es ≥ 1 — sin flujo de reasignación masiva de gastos, fuera de alcance.
5. Estados de carga (Skeleton por fila, 4+2) y error (`AlertCircle` +
   `Reintentar`) siguiendo el mismo lenguaje visual que `HomeView`.
