# TipApp — Rediseño de Inicio + navegación de 6 secciones (Dashboard v1)

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, a11y), `docs/features/nav-drawer-ux.md` (Sheet lateral, patrón de
fila de `<nav>`, `aria-current`) y `docs/features/theme-toggle-ux.md`
(segmented control de tema, ya implementado dentro del drawer) —no se repite
esa justificación acá, solo se referencia y se indica explícitamente qué
cambia de cada uno.

Contexto: hoy `HomeView.vue` hace de todo (hero de total del mes + listado
completo de gastos agrupado por día + FAB + Sheet de alta/edición) y el
drawer de navegación solo tiene 2 destinos (Inicio/Categorías) más el
selector de tema y "Cerrar sesión". Esta iteración separa "panorama" (Inicio)
de "gestión del historial completo" (Transacciones, ruta nueva) y agrega
Estadísticas/Reportes/Ajustes como secciones de primer nivel, con nav de 6
ítems.

**Fuera de alcance, explícito (no se diseña nada de esto)**: campana de
notificaciones, cualquier tarjeta/CTA de upsell o plan "premium",
funcionalidad real de generación de reportes, cambios de esquema de
Supabase. La marca sigue siendo **TipApp** (el `<h1>` del header actual) — no
se introduce ningún nombre/logo nuevo tipo "Mis Gastos" (ese nombre solo
existía en la imagen de referencia de un producto distinto, usada acá
únicamamente como inspiración de layout).

---

## 0. Decisión de librería de gráficos

**Decisión: no se instala ninguna librería nueva. Los dos gráficos (línea de
tendencia y dona de categorías) se implementan a mano con SVG inline**, en dos
componentes nuevos y chicos bajo `src/components/charts/`.

### 0.1 Opciones consideradas

| Opción | Bundle extra (gzip aprox.) | A favor | En contra para este caso |
|---|---|---|---|
| **`chart.js` + `vue-chartjs`** | ~60-70KB (chart.js) + ~5KB (wrapper) | Wrapper Vue 3 oficial-ish, maduro, tooltips/leyenda/animaciones de fábrica, tree-shakeable por tipo de chart (`LineController`, `ArcElement`, etc.) | Renderiza en `<canvas>`: **no repinta solo** cuando cambia la clase `.dark` del `<html>` — hay que releer las variables CSS y volver a setear los colores del dataset (o destruir/recrear el chart) a mano en un watcher del tema. Choca directo con el criterio de `theme-toggle-ux.md` de aplicación de tema **instantánea y optimista**: agregaría un cable nuevo específico solo para que el gráfico seq entere del cambio de tema. Para 2 gráficos simples (línea de ≤31 puntos, dona de ≤6 arcos) es sobredimensionado. |
| **Apex Charts / otras "todo incluido"** | 300KB+ | Muchas features | Mismo problema de canvas/SVG-propietario + tema, más pesado aún, nada de esto lo necesita TipApp hoy. |
| **SVG a mano (elegida)** | 0KB | Colores vía `hsl(var(--primary))`/hex literal de `categories.color` directo en atributos SVG → **el tema cambia gratis** al tocar la clase `.dark` del documento, sin ningún watcher ni re-render imperativo (mismo mecanismo por el que ya funciona el resto de la UI). Sin dependencia nueva que mantener/actualizar. Control total del tamaño/spacing en mobile. | Sin tooltip/leyenda "de fábrica" — hay que construirlos (ver sección 0.3, alcance acotado a propósito). Si en el futuro se necesitan gráficos más complejos (multi-serie superpuesta, zoom, rangos), ahí sí conviene revisar esta decisión e instalar `chart.js`. |

### 0.2 Por qué alcanza con SVG a mano acá

Los dos gráficos de esta iteración son deliberadamente simples:
- **Línea de tendencia**: una sola serie, ≤31 puntos (días del mes en curso).
- **Dona de categorías**: ≤6 arcos visibles (se explica el tope en la sección
  3.2 más abajo).

Ninguno necesita zoom, múltiples series superpuestas, ni un motor de
animación — es exactamente el tipo de gráfico "chico y acotado" donde el
costo de una librería (bundle + fricción de tema) supera el ahorro de tiempo
de implementación. Si Estadísticas creciera a futuro (comparativas
multi-categoría superpuestas, rangos custom con zoom), ese es el punto donde
reevaluar e instalar `chart.js` + `vue-chartjs` — no antes.

### 0.3 Alcance de interactividad (a propósito acotado)

Sin tooltip/hover en esta iteración. Justificación: en ambos gráficos, **el
valor exacto ya está visible sin interacción** — el total hero ya muestra el
número grande, y la leyenda de la dona ya lista nombre/monto/% en texto plano
(sección 3.3). Ningún dato queda "atrapado" detrás de un hover que en mobile
ni siquiera existe como gesto primario. Es una interacción "linda de tener"
a futuro (tap para resaltar un punto/arco), no un bloqueante — se anota como
mejora incremental, no se construye ahora.

### 0.4 Nota sobre la paleta de categorías (hallazgo, no bloqueante)

Se corrió el validador de paletas categóricas (`scripts/validate_palette.js`
de la skill de dataviz) contra los 10 hex reales sembrados en
`categories.color` (`supabase/migrations/20260716142006_categories_init.sql`):
`#f97316,#3b82f6,#8b5cf6,#eab308,#ef4444,#06b6d4,#ec4899,#14b8a6,#22c55e,#6b7280`.
Resultado: **falla** el chequeo de separación CVD entre el par adyacente
Vivienda `#8b5cf6` (morado) ↔ Transporte `#3b82f6` (azul) (ΔE 3.8 para
deuteranopía, muy por debajo del piso de 8), y el gris de "Otros" `#6b7280`
sale marcado como "demasiado neutro" (esperado y correcto: es intencional,
`design-system.md` ya documenta que la categoría "Otros" debe leerse gris,
no es un bug). También hay valores fuera de la banda de luminosidad ideal y
contraste bajo contra fondo claro en un par de hex (`#eab308` amarillo
principalmente).

Esto es un dato real del **backend** (columna `categories.color`), no algo
que este documento pueda arreglar sin tocar el esquema — fuera de alcance
explícito de esta iteración. La dona y el badge de categoría ya mitigan el
caso concreto (morado/azul indistinguibles para daltonismo) por diseño, sin
depender de arreglar el hex:

- La leyenda de la dona siempre es texto (nombre + monto + %), nunca un
  chip de color solo — igual que ya exige `design-system.md` para los badges.
  Si dos arcos adyacentes se confunden por color, el nombre en texto al lado
  sigue distinguiéndolos.
- Cada arco de la dona lleva un espaciado (gap) contra el color de fondo de
  la Card entre segmento y segmento (sección 3.2), lo que ayuda a separar
  visualmente dos arcos de tono parecido aunque no ayude al daltonismo en sí.

**Recomendación para una futura iteración** (no se hace acá): pasar los 10
hex reales por `validate_palette.js` con `supabase-backend-expert` y
`ui-ux-designer` juntos, y considerar una migración que reemplace los hex que
fallan por una paleta categórica validada — mismo criterio de "deuda técnica
anotada, no resuelta ahora" que ya usa el resto de `CLAUDE.md`.

---

## 1. Qué datos son seguros de graficar (el límite de `MAX_EXPENSES = 200`)

Esto condiciona el diseño de los tres bloques con datos históricos (tendencia
de Inicio, tendencia de Estadísticas, comparación "vs. mes anterior", y
"por mes" de Estadísticas) — léase antes de las secciones siguientes.

`expenses.ts` trae los gastos con `.order('expense_date', {ascending:false})
.order('created_at', {ascending:false}).limit(200)` — es decir, **los 200
gastos más recientes**, sin paginación ni conteo total. Esto da una garantía
concreta y otra que NO se puede dar:

- **Lo que sí se puede graficar con seguridad, siempre**: el **mes calendario
  en curso**. Al venir ordenado por fecha descendente, el mes actual es
  literalmente lo primero que entra al array — solo quedaría trunco si el
  usuario ya registró **más de 200 gastos en lo que va del mes actual**, un
  caso extremo para un tracker personal (y el mismo supuesto que ya asume hoy,
  implícitamente, el `monthTotal` existente — no es un riesgo nuevo que
  introduzca este documento).
- **Lo que NO se puede graficar/comparar a ciegas**: un mes anterior completo,
  o una serie de varios meses hacia atrás. Si el usuario acumuló más de 200
  gastos en total, los registros más viejos de los 200 cargados pueden
  corresponder a **mitad de un mes**, no al mes completo — mostrar eso como
  "el gasto de junio" sería literalmente falso (no solo incompleto), no un
  simple "faltan datos".

### 1.1 Regla exacta para saber si un mes es seguro

Sea `oldestLoadedDate` la fecha (`expense_date`) del gasto **más viejo** en
`expensesStore.expenses` (el último del array, ya que viene ordenado desc).
Un mes calendario `M` es **seguro de mostrar completo** si y solo si:

```
oldestLoadedDate <= primerDíaDe(M)
```

Por qué funciona: el query trae "los N más recientes", así que cualquier
gasto con fecha `>= oldestLoadedDate` está garantizado presente en el array
(nada se descarta por arriba de ese corte, sección 2.3 de
`expenses-mvp-ux.md`). Si el primer día del mes `M` ya es `>= oldestLoadedDate`,
entonces **todo** el mes `M` (y todos los meses posteriores) están
garantizados completos — no hace falta ninguna query nueva a Supabase, se
calcula 100% en el cliente con los datos ya cargados.

Esto da, de una sola pasada:
- **¿Es seguro "vs. mes anterior" en Inicio?** Sí, si
  `oldestLoadedDate <= primerDíaDe(mesAnterior)`. Si no, **se omite la
  comparación por completo** (no se muestra un `0%` ni un placeholder — no
  se inventa un número, sección 2.2).
- **¿Cuántos meses hacia atrás puede mostrar el bloque "Por mes" de
  Estadísticas?** Todos los meses `M` que cumplan la regla de arriba,
  empezando por el mes actual hacia atrás, hasta el primero que falle
  (sección 4.3).

Poner esta función una sola vez (p. ej. `src/lib/charts.ts`,
`isMonthSafeToShow(monthStart: Date, oldestLoadedDate: Date): boolean`) y
reusarla en Inicio y Estadísticas — no reimplementarla en cada vista.

---

## 2. Inicio (`/`, `HomeView.vue`) — rediseño

Se mantiene como la ruta raíz (`name: 'home'`) y **la única pantalla con el
trigger del drawer** (hamburguesa), igual que hoy — ver nota de alcance en
sección 6.

### 2.1 Saludo

Nuevo bloque arriba del contenido, debajo del header:

```html
<div class="flex flex-col gap-1">
  <h2 class="text-xl font-semibold">Hola, {{ greetingName }}</h2>
  <p class="text-sm text-muted-foreground">Este es el resumen de tus gastos.</p>
</div>
```

- `greetingName` es un computed **nuevo**, distinto de `accountLabel` (que
  sigue existiendo tal cual para el drawer, sección 6). Usar el nombre
  completo o el email entero como saludo ("Hola, claude6@bayteq.com") se ve
  mal — se toma:
  - Si hay `profile?.display_name`: la primera palabra
    (`display_name.trim().split(/\s+/)[0]`).
  - Si no: la parte del email antes de `@`
    (`user.email.split('@')[0]`).
  - Fallback final `''` (no debería pasar autenticado, mismo criterio ya
    usado en `accountLabel`).
- **Sin emoji** en el copy (a diferencia de la imagen de referencia). El
  resto de la app no usa emoji en texto de UI (los emoji de `categories.icon`
  son datos, no copy autoral) — mantener el tono "serio sin ser frío" que ya
  pide `design-system.md` para una app de finanzas.
- Sin variante "buenos días/tardes/noches": agrega una rama de lógica más
  sin que el encargo la pida — mantenerlo simple.

### 2.2 Tarjeta "Total del mes" con tendencia

Reemplaza la `Card` actual (líneas ~322-329 de `HomeView.vue` hoy). Nueva
estructura:

```html
<Card>
  <CardHeader>
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-col gap-1">
        <CardDescription>Total de {{ monthLabel }}</CardDescription>
        <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
          <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(expensesStore.monthTotal) }}
        </CardTitle>
      </div>

      <!-- Solo si isPreviousMonthSafe -->
      <span
        v-if="monthDelta !== null"
        class="mt-1 flex shrink-0 items-center gap-1 text-xs font-medium"
        :class="monthDelta.direction === 'up' ? 'text-destructive' : 'text-success'"
      >
        <component :is="monthDelta.direction === 'up' ? ArrowUp : ArrowDown" class="size-3.5" />
        {{ monthDelta.percentLabel }} vs. mes anterior
      </span>
    </div>
  </CardHeader>

  <TrendAreaChart
    :points="cumulativeDailyPoints"
    class="px-6 pb-4"
    height="72"
    :aria-label="`Gasto acumulado de ${monthLabel}, día a día`"
  />
</Card>
```

- **`monthDelta`**: `null` si `!isPreviousMonthSafe` (sección 1.1) — en ese
  caso, **no se muestra nada** en su lugar, ni un placeholder ni un `—`. Si es
  seguro, se calcula `((monthTotal - prevMonthTotal) / prevMonthTotal) * 100`
  (si `prevMonthTotal === 0`, tratar también como no calculable — división
  por cero — y omitir el badge, mismo criterio de "no inventar").
- **Semántica de color del delta**: en una app de *gastos*, gastar **más**
  que el mes pasado es la mala noticia, así que `direction === 'up'` usa
  `text-destructive` (con ícono `ArrowUp`) y `'down'` usa `text-success` (con
  `ArrowDown`). Nunca color solo: siempre acompañado del ícono de dirección y
  el texto "vs. mes anterior" — cumple la regla general de a11y de
  `design-system.md`. Esto no contradice la regla "no pintar de rojo cada
  monto" (esa regla es sobre el número del gasto en sí, sección 1 de
  `design-system.md`) — acá es un único indicador derivado de comparación,
  igual de acotado que el uso ya previsto de `success`/`warning`/`destructive`
  para estados de presupuesto.
- **`cumulativeDailyPoints`**: serie **acumulada** (suma corrida) del gasto
  del mes en curso, día a día, desde el día 1 hasta hoy. Se elige acumulada
  (no el gasto discreto de cada día) a propósito: termina exactamente en
  `monthTotal`, reforzando visualmente el número grande de arriba, y da una
  curva prolija en vez de dientes de sierra en los días sin gasto. Ver
  `TrendAreaChart` en sección 5.
- Tamaño compacto (`height="72"`, sin ejes ni grilla) — es un
  *sparkline* de tarjeta, no un gráfico analítico completo (ese rol lo cumple
  Estadísticas, sección 4).

### 2.3 "Resumen por categoría" (dona)

Nueva `Card` entre la tarjeta de total y "Transacciones recientes":

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Resumen por categoría</CardTitle>
    <CardAction>
      <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'statistics' })">
        Ver más
      </Button>
    </CardAction>
  </CardHeader>

  <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-center">
    <CategoryDonutChart :slices="donutSlices" class="size-32 shrink-0" />

    <ul class="flex w-full flex-col gap-2">
      <li v-for="slice in donutSlices" :key="slice.id" class="flex items-center gap-2 text-sm">
        <span class="size-2.5 shrink-0 rounded-full" :style="{ background: slice.color ?? 'hsl(var(--muted-foreground))' }" />
        <span class="flex-1 truncate font-medium">{{ slice.name }}</span>
        <span class="tabular-nums">${{ formatAmount(slice.amount) }}</span>
        <span class="w-10 text-right text-xs text-muted-foreground">{{ slice.percentLabel }}</span>
      </li>
    </ul>
  </div>
</Card>
```

- Datos: gasto del **mes en curso** agrupado por categoría (siempre seguro,
  sección 1). Se calcula con un `computed` sobre `expensesStore.expenses`
  filtrado a `expense_date` del mes actual, agrupado por `category_id`,
  usando `buildDonutSlices(...)` (helper nuevo, sección 3.2).
- Si el mes no tiene gastos todavía: la `Card` completa no se muestra (mismo
  criterio que el estado vacío general de Inicio, sección 2.6).
- "Ver más" navega a `/estadisticas` (sección 4), donde vive el detalle
  completo (todas las categorías, no solo el tope de 5+Otros de acá). No
  pedido explícitamente por el encargo, pero es consistente con el patrón
  "Ver todas" ya pedido para transacciones (sección 2.4) y ayuda a
  descubrir la sección nueva — si se prefiere no agregarlo, se puede omitir
  sin romper nada más de este documento.

### 2.4 "Transacciones recientes"

Nueva `Card`, reemplaza la sección completa de listado agrupado que hoy vive
en `HomeView` (esa lista se muda a `TransactionsView`, sección 3):

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Transacciones recientes</CardTitle>
    <CardAction>
      <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'transactions' })">
        Ver todas
      </Button>
    </CardAction>
  </CardHeader>

  <div class="flex flex-col">
    <template v-for="(expense, idx) in recentExpenses" :key="expense.id">
      <Separator v-if="idx > 0" />
      <div class="flex items-center gap-3 px-6 py-3">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full border"
          :style="{ backgroundColor: withAlpha(expense.category.color, 0.12), borderColor: expense.category.color ?? undefined }"
        >
          <span v-if="expense.category.icon" class="text-sm leading-none">{{ expense.category.icon }}</span>
        </span>
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="truncate text-sm font-medium">{{ expenseTitle(expense) }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ expense.category.name }}</p>
        </div>
        <div class="flex flex-col items-end gap-0.5">
          <p class="text-sm font-semibold tabular-nums">${{ formatAmount(expense.amount) }}</p>
          <p class="text-xs text-muted-foreground">{{ formatExpenseDateHeading(expense.expense_date) }}</p>
        </div>
      </div>
    </template>
  </div>
</Card>
```

- `recentExpenses`: los primeros **5** elementos de `expensesStore.expenses`
  (ya vienen ordenados `expense_date desc, created_at desc` — no hace falta
  ordenar de nuevo). 5 alcanza para "un vistazo" sin scroll largo, y con la
  lista completa a un tap de distancia ("Ver todas") no hace falta mostrar
  más acá.
- Filas **no clickeables individualmente** y **sin menú "⋮"**: esta es una
  vista de solo lectura (el vistazo del dashboard), no reemplaza a
  Transacciones para editar/eliminar — evita duplicar la superficie de
  edición en dos lugares. Solo "Ver todas" navega.
- Fecha: se reusa **tal cual** `formatExpenseDateHeading` (ya da "Hoy"/
  "Ayer"/"12 de julio" — no hace falta ninguna lógica de fecha relativa
  nueva).
- Ícono: mismo patrón de swatch ya usado en `CategoriesView.vue`
  (`withAlpha` + emoji de `category.icon`), un poco más chico (`size-9`) que
  el de esa pantalla porque acá conviven con más contenido por fila.
- Si `expensesStore.expenses.length === 0`: toda la sección (dona +
  transacciones recientes) no se muestra — ver estado vacío general,
  sección 2.6.

### 2.5 Qué se mueve fuera de `HomeView.vue`

Se **elimina** de `HomeView.vue` (se traslada tal cual a
`TransactionsView.vue`, sección 3):
- El `computed groupedExpenses` y el `<section>` que lo renderiza (líneas
  ~331-402 de hoy).
- El FAB fijo "Agregar gasto" (líneas ~406-415).
- `ExpenseFormSheet` + `isSheetOpen`/`editingExpense`/`openAddSheet`/
  `openEditSheet` (el Sheet de alta/edición ya no vive en Inicio).
- El estado vacío actual ("Todavía no registraste ningún gasto" +
  botón "Agregar tu primer gasto") — se muda también, ver sección 2.6 para
  qué lo reemplaza en Inicio.

Se **mantiene** en `HomeView.vue` (sigue siendo dueño de su propio fetch,
igual que hoy): la llamada a `categoriesStore.fetchCategories()` +
`expensesStore.fetchAll()` en `onMounted` — Inicio sigue necesitando esos
datos para el hero/dona/recientes, aunque ya no renderice el listado
completo.

### 2.6 Estados de carga/vacío/error

- **Carga**: `Skeleton` en las 3 tarjetas nuevas (total+tendencia, dona,
  recientes), mismo criterio ya usado hoy (rectángulos de tamaño
  aproximado al contenido final, sin spinner bloqueante).
- **Error** (`expensesStore.error` o falla de categorías): mismo bloque
  `AlertCircle` + "No pudimos cargar tus gastos" + botón "Reintentar" que ya
  existe hoy — sin cambios de copy.
- **Vacío** (usuario sin ningún gasto todavía, `expensesStore.expenses.length
  === 0`): se **mantiene** el mismo mensaje/CTA que hoy vivía en `HomeView`
  ("Todavía no registraste ningún gasto" + botón "Agregar tu primer gasto"),
  pero el botón ahora navega a `/transacciones` y abre el Sheet de alta ahí
  (`router.push({ name: 'transactions', query: { new: '1' } })`, con
  `TransactionsView` mirando ese query param en `onMounted` para abrir el
  Sheet automáticamente — mismo patrón ya usado para `?redirect=` en el
  guard de rutas, sección 4.2 de `expenses-mvp-ux.md`). Justificación: el
  formulario de alta ya no vive en Inicio (sección 2.5), así que "Agregar tu
  primer gasto" tiene que llevar a donde el Sheet sí existe.

---

## 3. Transacciones (`/transacciones`, nueva)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/transacciones` | `transactions` | `{ requiresAuth: true }` | `TransactionsView` |

### 3.1 Qué se mueve literalmente desde `HomeView.vue`

Movido **tal cual**, sin cambios de comportamiento:
- El `computed groupedExpenses` (agrupación por encabezado de fecha) y el
  `<section>` que lo renderiza — mismas `Card`, mismo `Badge` de categoría,
  mismo layout de monto alineado a la derecha.
- El `DropdownMenu` "⋮" por fila con "Editar"/"Eliminar", y el `AlertDialog`
  de confirmación de borrado — sin cambios de copy ni de comportamiento.
- El FAB fijo "Agregar gasto" (`Plus`, `size-14`, `rounded-full`,
  `shadow-[var(--shadow-elevated)]`, respetando `env(safe-area-inset-bottom)`).
- `ExpenseFormSheet` + estado (`isSheetOpen`, `editingExpense`,
  `openAddSheet`, `openEditSheet`).
- Los 3 estados (`isInitialLoading`/Skeleton, `loadError`/Alert, lista
  vacía/`Receipt`) — mismo copy, mismos componentes.
- `expenseTitle()` (descripción o nombre de categoría como fallback).

`TransactionsView` hace su **propio** `onMounted(loadAll)` llamando a
`categoriesStore.fetchCategories()` + `expensesStore.fetchAll()` — igual
que `CategoriesView` ya hace su propio fetch independiente hoy (no hay
"prefetch" compartido entre vistas; si el usuario entra directo por deep
link, esta vista igual carga sus datos).

### 3.2 Qué NO se mueve (se queda en Inicio, ya rediseñado en sección 2)

El hero de "Total del mes" (ahora con tendencia) no se duplica acá — esta
pantalla es específicamente el historial completo, no repite el resumen.

### 3.3 Header de `/transacciones`

Mismo patrón ya establecido por `CategoriesView` (pantalla de "segundo
nivel", sin trigger de drawer):

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="text-xl font-semibold">Transacciones</h1>
</header>
```

### 3.4 Soporte de `?new=1` (alta desde el estado vacío de Inicio)

```ts
onMounted(async () => {
  await loadAll()
  if (route.query.new === '1') openAddSheet()
})
```

Después de abrir el Sheet, no hace falta limpiar el query param (no rompe
nada si queda en la URL; si se prefiere prolijidad, `router.replace({ name:
'transactions' })` después de abrir el Sheet — opcional, no bloqueante).

---

## 4. Estadísticas (`/estadisticas`, nueva)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/estadisticas` | `statistics` | `{ requiresAuth: true }` | `StatisticsView` |

Header igual al de Transacciones/Categorías (`ArrowLeft` + "Estadísticas").
Contenido: **más detalle** sobre lo mismo que ya vive en Inicio, sin
inventar métricas que `expenses`/`categories` no puedan calcular hoy.

### 4.1 "Por categoría" (dona completa)

Mismo `CategoryDonutChart` que Inicio, pero acá:
- La **leyenda no se recorta** a 5+Otros para el texto: se listan todas las
  categorías con gasto > 0 en el mes (el arco visual del donut sigue
  respetando el tope de 6, sección 5.2 — más de ~6-7 arcos de colores que
  "significan algo" se vuelven indistinguibles, es una regla dura de
  legibilidad, no una limitación de esta app). La fila de "Otros" del donut
  lleva un `<details>` nativo (sin componente nuevo) que expande el detalle
  de qué categorías quedaron agrupadas ahí:

```html
<li class="flex flex-col gap-1 text-sm">
  <div class="flex items-center gap-2">
    <span class="size-2.5 shrink-0 rounded-full bg-muted-foreground" />
    <span class="flex-1 font-medium">Otros</span>
    <span class="tabular-nums">${{ formatAmount(otrosSlice.amount) }}</span>
    <span class="w-10 text-right text-xs text-muted-foreground">{{ otrosSlice.percentLabel }}</span>
  </div>
  <details class="pl-4.5 text-xs text-muted-foreground">
    <summary class="cursor-pointer select-none">Ver detalle</summary>
    <ul class="mt-1 flex flex-col gap-0.5">
      <li v-for="c in otrosSlice.folded" :key="c.id" class="flex justify-between gap-2">
        <span class="truncate">{{ c.name }}</span>
        <span class="tabular-nums">${{ formatAmount(c.amount) }}</span>
      </li>
    </ul>
  </details>
</li>
```

### 4.2 "Tendencia diaria"

Mismo componente `TrendAreaChart` que Inicio, pero con datos **distintos** a
propósito (para que Estadísticas no sea un simple duplicado de Inicio): acá
se grafica el **gasto discreto de cada día** (no acumulado), para que se
note en qué días gastó más/menos — un trabajo analítico distinto al de la
tarjeta hero de Inicio (que muestra la curva acumulada para reforzar el
total). Tamaño más grande (`height="160"`), con línea base (hairline,
`stroke-border`) y 3 etiquetas de eje X (primer día, mitad, último día
cargado) — sigue sin grilla de fondo ni un valor por punto (serían ~30
números apilados, ilegible; ver sección 5.1).

### 4.3 "Por mes"

Bloque nuevo, exclusivo de Estadísticas (no vive en Inicio). Barras simples
en `<div>` con `width` porcentual (no hace falta SVG para esto — es
literalmente una barra por mes, comparando magnitud, mismo color plano
`bg-primary` para todas, sin rampa de color por antigüedad):

```html
<div class="flex flex-col gap-3">
  <div v-for="m in safeMonths" :key="m.key" class="flex items-center gap-3">
    <span class="w-20 shrink-0 text-xs text-muted-foreground">{{ m.label }}</span>
    <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
      <div class="h-full rounded-full bg-primary" :style="{ width: `${m.percentOfMax}%` }" />
    </div>
    <span class="w-16 shrink-0 text-right text-xs font-medium tabular-nums">${{ formatAmount(m.total) }}</span>
  </div>
</div>
```

- `safeMonths`: meses calendario, del más reciente hacia atrás, que cumplan
  `isMonthSafeToShow` (sección 1.1) — se corta apenas el primero falla, no
  se muestra un mes parcial etiquetado como si fuera completo.
- Si `safeMonths.length < 2`: **no tiene sentido una "tendencia" de un solo
  punto** — se oculta el gráfico de barras y se muestra en su lugar un texto
  simple: *"Todavía no hay suficiente historial para mostrar la tendencia
  mensual."* (mismo criterio de estado vacío honesto que el resto de la app,
  no una sección en blanco sin explicación).
- Barras planas (`bg-primary`, sin rampa de color): un mes no tiene "más o
  menos identidad" que otro, es una sola serie ordenada en el tiempo — usar
  una rampa de opacidad/lightness por antigüedad sería una decoración sin
  información nueva.

---

## 5. Los dos componentes de gráfico

Ambos van en `src/components/charts/` (carpeta nueva). Presentacionales:
reciben datos ya finales por props, no llaman a ningún store — el cálculo/
agregación vive en las vistas (Inicio/Estadísticas) o en helpers puros de
`src/lib/charts.ts` (nuevo), para poder reusar exactamente la misma lógica
de agregación en ambas pantallas sin duplicarla.

### 5.1 `TrendAreaChart.vue`

Props:
```ts
interface TrendPoint { date: string, amount: number }
defineProps<{
  points: TrendPoint[]  // orden ascendente por fecha, ya con huecos rellenados a 0
  height?: number        // default 64
  ariaLabel: string
}>()
```

Implementación (SVG, coordenadas relativas — se estira solo, sin JS de
resize):
- `viewBox="0 0 100 32"`, `preserveAspectRatio="none"`, `width="100%"` y
  `height` real fijado por CSS (prop `height` en px).
- `x` de cada punto = `index / (points.length - 1) * 100`; `y` = `32 -
  (amount / max) * 28` (4 unidades de margen arriba para que el punto más
  alto no toque el borde).
- Línea: `<path :d="linePath" fill="none" stroke="hsl(var(--primary))"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  vector-effect="non-scaling-stroke" />` — el `vector-effect` es clave:
  sin él, el trazo se distorsiona porque el `viewBox` no es 1:1 con los
  píxeles reales del contenedor.
- Relleno de área (~10% opacidad, nunca un bloque sólido): mismo `path`
  cerrado contra la base (`y=32`), `fill="hsl(var(--primary))"
  fill-opacity="0.1" stroke="none"`.
- Punto final: `<circle>` en el último punto, con un anillo del color de la
  superficie (`stroke="hsl(var(--card))" stroke-width="2"
  vector-effect="non-scaling-stroke"`) por encima, para que se distinga
  aunque la línea termine ahí mismo — el radio se calibra para que el
  diámetro real ronde 8px en el ancho típico de una Card en mobile
  (~320-380px); ajustar a ojo en implementación, no es un valor mágico
  exacto.
- Sin grilla ni ejes en la variante compacta de Inicio. En la variante de
  Estadísticas (`height="160"`): agregar una única línea base horizontal
  (`stroke="hsl(var(--border))" stroke-width="1"
  vector-effect="non-scaling-stroke"`, sin dashed — nunca punteada, ver
  regla de `design-system.md`/skill de dataviz) y 3 `<text>` de eje X
  (primer punto, punto medio, último punto), `class="fill-muted-foreground
  text-[10px]"`.
- **Sin animación de entrada** en v1 (renderizado estático) — mismo criterio
  de "no over-engineer" ya usado en `nav-drawer-ux.md` para el manejo de
  foco. Si a futuro se agrega, respetar `prefers-reduced-motion` igual que
  la transición de tema (sección 4 de `theme-toggle-ux.md`).
- `<svg role="img" :aria-label="ariaLabel">` — un solo texto descriptivo
  (p. ej. "Gasto acumulado de julio 2026, día a día, terminando en $45.230")
  alcanza porque es una serie única (no hace falta leyenda, sección 5 de
  `marks-and-anatomy.md`: "un solo color no necesita caja de leyenda, el
  título ya dice qué se grafica").

### 5.2 `CategoryDonutChart.vue`

Props:
```ts
interface DonutSlice {
  id: string
  name: string
  color: string | null  // null = "Otros" sintético, se pinta con muted-foreground
  amount: number
  percentLabel: string  // "38%", ya formateado
  folded?: { id: string, name: string, amount: number }[]  // solo la fila "Otros"
}
defineProps<{ slices: DonutSlice[] }>()
```

- El armado de `slices` (agrupar por categoría, ordenar desc por monto,
  plegar todo después del top N en un slice sintético "Otros") vive en un
  helper puro `buildDonutSlices(categoryTotals, maxSlices = 5)` en
  `src/lib/charts.ts` — **no** dentro del componente, para que Inicio
  (`maxSlices = 5`, sin `folded` detallado) y Estadísticas (mismo tope
  visual de arcos, pero conservando `folded` para el `<details>` de la
  sección 4.1) reusen exactamente la misma lógica de plegado sin
  duplicarla. Si ya existe una categoría real llamada "Otros" (la default
  sembrada) y además hay que plegar categorías custom sobrantes, sus montos
  se suman en el mismo slice sintético (no se muestran dos filas "Otros").
- Anillo (no relleno sólido), técnica de `stroke-dasharray` sobre un
  `<circle>` por slice, `viewBox="0 0 100 100"`, radio `40`, `stroke-width
  18`, `transform="rotate(-90 50 50)"` para arrancar arriba:
  - Circunferencia `C = 2 * Math.PI * 40`.
  - Un círculo de fondo pintado `stroke="hsl(var(--card))"` (o el color de
    fondo real de la Card que lo contiene) **debajo** de todos los slices —
    es lo que se ve en el espacio entre arcos.
  - Por slice: `strokeDasharray = "{largo - gap} {C - largo + gap}"`,
    `strokeDashoffset` acumulado (suma de los largos de los slices previos),
    con `gap` chico (~1.5-2% de `C`) para que el círculo de fondo se asome
    entre segmento y segmento — **este es el "espaciado entre marcas"
    pedido por la guía de dataviz en vez de dibujar un borde alrededor de
    cada arco** (un borde agrega tinta que no es dato; el hueco sí separa).
  - `stroke-linecap="butt"` (no `round`): con `round` los extremos de cada
    arco se redondean hacia afuera del hueco y arruinan el efecto de
    separación prolija.
- Sin texto en el centro de la dona en v1 (el total ya se ve arriba, en el
  hero de Inicio, o en la leyenda de al lado en Estadísticas) — mantenerlo
  simple; agregar un total centrado es una mejora incremental fácil si se
  quiere después.
- `<svg aria-hidden="true" focusable="false">`: **toda** la información
  accesible (nombre, monto, %) ya vive en la lista HTML de la leyenda que
  acompaña al componente (secciones 2.3 y 4.1), que es texto real y
  perfectamente accesible por sí sola — repetir lo mismo en un
  `aria-label` gigante sobre el SVG sería redundante. Esto cumple la regla
  de "identidad nunca solo por color": acá directamente no hay ninguna
  información que dependa del SVG para un lector de pantalla.

---

## 6. Navegación: drawer de 6 ítems (y por qué no hay sidebar persistente)

### 6.1 `<nav>` ampliado

Mismo patrón exacto ya establecido en `nav-drawer-ux.md` (fila
`min-h-11`, estado activo vía `route.name` + `aria-current="page"`,
`hover:bg-accent`) — se agregan 4 filas nuevas, mismo orden que pide el
encargo:

| Orden | Label | Ícono (`@lucide/vue`) | `route.name` |
|---|---|---|---|
| 1 | Inicio | `Home` (ya en uso) | `home` |
| 2 | Transacciones | `ArrowLeftRight` (nuevo import) | `transactions` |
| 3 | Categorías | `Tag` (ya en uso) | `categories` |
| 4 | Estadísticas | `ChartPie` (nuevo import) | `statistics` |
| 5 | Reportes | `FileText` (nuevo import) | `reports` |
| 6 | Ajustes | `Settings` (nuevo import) | `settings` |

Los 4 íconos nuevos (`ArrowLeftRight`, `ChartPie`, `FileText`, `Settings`)
ya existen en `@lucide/vue@1.24.0` (verificado en
`node_modules/@lucide/vue/dist/esm/icons/`) — no hace falta instalar nada.
`ArrowLeftRight` (dos flechas opuestas) en vez de reusar `Receipt` (que ya
significa "un gasto" en el estado vacío de Transacciones/Inicio) evita que
un mismo ícono tenga dos significados distintos dentro de la misma app.

### 6.2 El selector de tema **sale** del drawer

Se **elimina** del drawer el bloque completo de `theme-toggle-ux.md` sección
3 (el `<div class="border-t ... p-3">` con el `radiogroup` de Claro/Oscuro/
Sistema, hoy entre `</nav>` y `<SheetFooter>` en `HomeView.vue`) — se mueve
tal cual (mismo markup, mismo `authStore.themePreference`/
`authStore.selectTheme`) a `SettingsView.vue` (sección 7). El drawer queda:
identidad → `<nav>` de 6 ítems → `SheetFooter` con "Cerrar sesión" (sin
cambios en el footer).

**Decisión: no queda ningún acceso directo al tema en el drawer.** "Ajustes"
pasa a ser el único lugar. Justificación (siguiendo la sugerencia del
encargo): con 6 ítems de navegación ya llenando el `<nav>`, agregar el
bloque de tema *además* como séptima fila haría el drawer notablemente más
largo que antes (nav-drawer-ux.md ya daba por buena la altura completa del
panel con solo 2 ítems + tema); tener el control en dos lugares (drawer +
Ajustes) obliga a mantener el mismo `radiogroup` sincronizado en dos
sitios sin ninguna ganancia real — "Ajustes" ya es, por convención de
prácticamente cualquier app, el lugar esperado para preferencias de
apariencia. Un único lugar es más simple de mantener y no le cuesta nada al
usuario (Ajustes queda a un tap de distancia, igual que cualquier otro
ítem del drawer).

### 6.3 Por qué NO hay sidebar persistente en `lg:`

Se **descarta** para esta iteración. Razón concreta: hoy **no existe un
layout compartido** entre vistas autenticadas — cada vista (`HomeView`,
`CategoriesView`, y las 4 nuevas) arma su propio `<div class="min-h-screen">`
+ su propio `<header>` de punta a punta; el `Sheet` del drawer vive adentro
de `HomeView.vue` únicamente. Agregar un `<aside>` persistente en `lg:`
"simple" en los términos que pide el encargo requeriría una de dos cosas,
ninguna trivial:

1. Duplicar el mismo bloque de `<aside class="hidden lg:flex ...">` dentro
   de las **6** vistas — alto riesgo de que la lista de ítems, el estado
   activo o un ajuste de estilo futuro queden desincronizados entre copias
   (exactamente el tipo de deuda que el resto del proyecto evita a
   propósito, p. ej. `categories.ts` separado de `expenses.ts` para no
   duplicar estado).
2. Extraer recién ahora un `AppShell.vue` que envuelva `<router-view>` con
   header + sidebar compartido y cada vista le pase su título/acciones por
   slot — esto es un **cambio de arquitectura de routing/vistas**, no un
   ajuste de layout: toca las 6 vistas a la vez y el guard de rutas. Es
   exactamente el "retrabajo grande" que el encargo pide evitar si no es
   simple.

Se recomienda `AppShell.vue` como una refactorización propia, chica y
aislada, para una iteración futura (candidata natural una vez que el
número de secciones se estabilice) — no algo para forzar ad hoc dentro de
esta entrega. El `Sheet` lateral sigue siendo el único patrón de navegación
en todos los anchos de pantalla (funciona igual de bien en tablet/desktop
como overlay, no está roto — simplemente no es "persistente").

---

## 7. Ajustes (`/ajustes`, nueva)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/ajustes` | `settings` | `{ requiresAuth: true }` | `SettingsView` |

Header igual al de Transacciones/Categorías/Estadísticas (`ArrowLeft` +
"Ajustes"). Contenido: **el mismo bloque de tema, movido tal cual** desde el
drawer (markup exacto de la sección 3 de `theme-toggle-ux.md` —
`role="radiogroup"`, 3 botones `Sun`/`Moon`/`Monitor`, mismas clases de
estado seleccionado, mismo `authStore.selectTheme`), envuelto en una `Card`
para que se vea como contenido de pantalla completa en vez de un bloque
angosto de 240px pensado para un drawer:

```html
<main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
  <Card>
    <CardHeader>
      <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Apariencia
      </CardTitle>
    </CardHeader>

    <div class="flex items-center gap-3 px-4 pb-4">
      <SunMoon class="size-5 shrink-0 text-muted-foreground" />
      <span id="theme-label" class="flex-1 text-sm font-medium">Tema</span>
      <div role="radiogroup" aria-labelledby="theme-label" class="flex gap-1 rounded-md bg-muted p-1">
        <!-- 3 botones Sun/Moon/Monitor, markup idéntico a theme-toggle-ux.md sección 3 -->
      </div>
    </div>
  </Card>
</main>
```

Mismo criterio de "Card con `CardTitle` en mayúsculas chicas como encabezado
de sección" ya usado en `CategoriesView.vue` — reusar el patrón visual
existente en vez de inventar uno nuevo para una pantalla de ajustes.

Estructura pensada para crecer: si en el futuro se agregan más preferencias
(moneda, formato de fecha, notificaciones si algún día se implementan de
verdad), se suman como `Card`s adicionales debajo — no hace falta rediseñar
nada de esto.

**"Cerrar sesión" no se mueve.** Sigue viviendo únicamente en el
`SheetFooter` del drawer, sin cambios — el encargo solo pidió mover el
selector de tema; mover también logout no fue pedido y se deja fuera para
no ampliar el alcance de esta iteración sin necesidad (si se quiere a
futuro, agregarlo como acción adicional en `SettingsView` es sencillo, pero
es una decisión de producto aparte).

---

## 8. Reportes (`/reportes`, nueva)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/reportes` | `reports` | `{ requiresAuth: true }` | `ReportsView` |

Header igual al resto de pantallas de segundo nivel. Contenido: estado
"Próximamente" simple y honesto, mismo lenguaje visual que los demás estados
vacíos de la app (ícono grande + título + descripción corta, sin ningún
control falso):

```html
<main class="mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-4 py-6 text-center sm:px-6 lg:px-8" style="min-height: 60vh">
  <FileText class="size-12 text-muted-foreground" />
  <h2 class="text-lg font-semibold">Reportes</h2>
  <p class="max-w-xs text-sm text-muted-foreground">
    Todavía estamos construyendo esta sección. Pronto vas a poder generar
    reportes de tus gastos.
  </p>
</main>
```

Nada de selector de rango de fechas, ni botón "Generar", ni mención de
formatos de exportación — cualquiera de esas cosas insinuaría una
funcionalidad que no existe.

---

## 9. Router — resumen de rutas nuevas

```ts
{ path: '/transacciones', name: 'transactions', component: () => import('@/views/TransactionsView.vue'), meta: { requiresAuth: true } },
{ path: '/estadisticas', name: 'statistics', component: () => import('@/views/StatisticsView.vue'), meta: { requiresAuth: true } },
{ path: '/reportes', name: 'reports', component: () => import('@/views/ReportsView.vue'), meta: { requiresAuth: true } },
{ path: '/ajustes', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { requiresAuth: true } },
```

Se agregan a `src/router/index.ts` junto a las rutas ya existentes
(`login`, `register`, `home`, `categories`) — mismo `meta.requiresAuth`,
mismo lazy import por ruta ya usado hoy (bonus: como cada vista pesa su
propio chunk, el SVG de los gráficos nuevos solo se descarga cuando se
visita Inicio o Estadísticas, no en el chunk de login/registro).

---

## 10. Accesibilidad — puntos nuevos no cubiertos ya por los docs base

1. **Delta "vs. mes anterior"** (sección 2.2): color + ícono de dirección +
   texto, nunca solo color — ya detallado ahí.
2. **Gráficos como `aria-hidden`**: válido únicamente porque, en ambos
   casos, la misma información ya existe como texto real adyacente (leyenda
   de la dona; el hero number para la tendencia). Si algún gráfico futuro
   mostrara un dato que *no* está en texto en ningún otro lado, ahí sí
   necesitaría su propio `aria-label` descriptivo o una tabla equivalente.
3. **`<details>`/`<summary>` de "Ver detalle" de Otros** (sección 4.1): son
   elementos nativos, ya accesibles por teclado y lector de pantalla sin
   ningún atributo ARIA adicional — no envolver en un componente propio.
4. **Botones "Ver todas"/"Ver más"** (`variant="link"`): heredan el foco
   visible y el área táctil de `Button` — verificar que `size="sm"` con
   `h-auto p-0` no baje el alto por debajo de lo razonable para un link de
   texto (los links de texto no están sujetos a la regla de 44px de los
   botones, mismo criterio ya implícito en el resto del proyecto para
   enlaces inline).
5. **Barras de "Por mes"** (sección 4.3): cada fila ya es texto real (label
   del mes + monto) a los costados de la barra — la barra en sí es
   decorativa/redundante con el número, no necesita `role`/`aria-label`
   propio.

---

## Resumen accionable para `vue-frontend-expert`

1. **Sin dependencias nuevas.** Gráficos a mano en SVG, `src/components/
   charts/TrendAreaChart.vue` y `CategoryDonutChart.vue` (sección 5). Nuevo
   helper puro `src/lib/charts.ts`: `isMonthSafeToShow`, `buildDonutSlices`,
   `buildCumulativeDailySeries`, `buildDailySeries` (secciones 1.1, 2.2, 4.2,
   5.2).
2. **Router**: agregar `transactions`/`statistics`/`reports`/`settings`
   (sección 9) a `src/router/index.ts`.
3. **Vistas nuevas**: `TransactionsView.vue` (mueve tal cual el listado+FAB+
   Sheet+menú de `HomeView.vue`, sección 3), `StatisticsView.vue` (sección
   4), `ReportsView.vue` (sección 8, sin lógica), `SettingsView.vue` (mueve
   el bloque de tema desde el drawer, sección 7).
4. **`HomeView.vue`**: saludo nuevo (`greetingName`, sección 2.1), hero de
   total con tendencia + delta condicional (sección 2.2), dona de categoría
   del mes (sección 2.3), transacciones recientes de solo lectura (sección
   2.4) con "Ver todas"/`?new=1` hacia Transacciones. Se **elimina** de acá
   el listado agrupado completo, el FAB y el Sheet de alta (sección 2.5).
5. **Drawer** (`HomeView.vue`, dentro del `Sheet` ya existente): `<nav>`
   ampliado a 6 ítems (sección 6.1, con los 4 íconos nuevos ya confirmados
   en `@lucide/vue`), **se quita** el bloque de tema del drawer (se movió a
   Ajustes, sección 6.2). "Cerrar sesión" no cambia.
6. **Sin sidebar persistente `lg:`** en esta iteración — justificado en
   sección 6.3 (no hay `AppShell` compartido hoy; introducirlo es el
   "retrabajo grande" que el encargo pide evitar si no es simple).
7. **No tocar** `CategoriesView.vue` ni `CategoryFormSheet.vue` — solo se
   agrega su ítem al `<nav>` del drawer (ya existía, ruta sin cambios).
8. Pendiente para otra sesión (no bloqueante): correr
   `validate_palette.js` sobre los 10 hex de `categories.color` con
   `supabase-backend-expert` y decidir si vale la pena una migración de
   colores (sección 0.4) — hallazgo de esta sesión, no arreglado acá.
