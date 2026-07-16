# TipApp — UX de Tarjetas de crédito (v1)

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, Sheet inferior, a11y), `docs/features/nav-drawer-ux.md` (estructura
del drawer, patrón de fila `<nav>`, `aria-current`), `docs/features/
dashboard-redesign-ux.md` (rediseño de Inicio, `TrendAreaChart`/
`CategoryDonutChart`, helper `src/lib/charts.ts`, patrón de barra "Por mes" de
Estadísticas) y `docs/features/categories-mvp-ux.md` (ruta dedicada vs. Sheet
para pantallas de gestión, conteo dedicado para deshabilitar borrado, paleta
fija de 10 swatches). No se repite esa justificación acá, solo se referencia
y se indica explícitamente qué se reusa tal cual y qué es nuevo.

Contexto de dominio (ya decidido por el Product Owner, no se rediscute acá):
"tarjeta de crédito" es un recurso propio del usuario, igual que `categories`/
`expenses`. "Persona" es solo una etiqueta/nombre libre (sin login, sin
invitación, sin settlement) para llevar registro de quién usó la tarjeta. Todo
vive bajo el mismo `user_id` dueño, con RLS scoped a ese usuario. El backend
está armando en paralelo tres tablas: `credit_cards`, `card_people`,
`card_expenses` — este documento asume nombres de columna plausibles y
consistentes con el resto del esquema (`snake_case`, mismo patrón que
`categories`/`expenses`) solo a título ilustrativo; **confirmar los nombres
exactos con `supabase-backend-expert`** antes de tipar el store, sin bloquear
el diseño de UX que sigue.

La referencia visual (mockup de otra app, "GastoCard") se usa **únicamente**
para los 4 flujos funcionales que muestra (resumen/dashboard, transacciones
por tarjeta, detalle de tarjeta, alta de gasto) — ver sección 11 para el
detalle completo de qué NO se adopta de ahí (branding, logo, badges de
marketing, promesas de PWA/offline).

---

## 1. Estrategia de datos: por qué esta feature NO reproduce el problema de `MAX_EXPENSES`

Esta es la decisión más importante del documento porque condiciona el diseño
de las cuatro pantallas siguientes — léase antes de las secciones 2-6.

### 1.1 El problema ya documentado (recapitulación mínima)

`expenses.ts` trae "los 200 gastos más recientes" (`order desc + limit(200)`,
**sin filtro de fecha**) porque nació como un listado all-time sin filtros.
Esto obligó a `dashboard-redesign-ux.md` (sección 1) a inventar
`isMonthSafeToShow()`: una heurística para saber, a posteriori, si un mes
calendario cayó completo dentro de esa ventana de 200 filas o quedó truncado.
Es una solución correcta pero es un parche sobre un diseño de query que nació
sin filtros — no es el patrón a copiar.

### 1.2 Decisión para `card_expenses`: filtrar por rango de fecha en el servidor, no traer "los últimos N"

**Ninguna vista de esta feature carga "todos los `card_expenses` del
usuario" en memoria.** Cada vista pide exactamente los datos que necesita,
acotados por un rango de fecha explícito (`gte`/`lt` sobre `expense_date`)
resuelto en el servidor (Postgres), no por un `LIMIT` que confía en que "lo
que importa está entre los primeros N":

- **Dashboard (sección 2)**: dos queries independientes, una por
  `gte(inicio_mes_actual).lt(inicio_mes_siguiente)` y otra por
  `gte(inicio_mes_anterior).lt(inicio_mes_actual)`. Cada una trae
  únicamente las filas de *ese* mes — la agregación (por tarjeta, por
  persona, total) se hace en cliente (`reduce`) sobre ese resultado ya
  acotado, nunca sobre "todo lo cargado hasta ahora".
- **Transacciones por tarjeta (sección 3)**: una query por combinación de
  filtros vigentes (mes + tarjeta + persona), siempre con el filtro de mes
  como `gte`/`lt` obligatorio (ver 3.1) — nunca "traer todo y filtrar en
  cliente".
- **Detalle de tarjeta (sección 4)**: una query acotada a
  `card_id = :id` + rango del mes vigente para el total/progreso/resumen, y
  una query aparte, pequeña y explícita (`order desc, limit(5)`, sin filtro
  de mes) para "movimientos recientes" — un `limit` acá es seguro porque el
  propósito declarado literalmente es "los últimos 5", no "todos los que
  entren".

**Consecuencia directa y deseada: no hace falta ningún equivalente de
`isMonthSafeToShow()` para `card_expenses`.** La comparación "mes vigente vs.
mes anterior" del dashboard (sección 2.2) es **siempre** segura de calcular,
sin importar cuántos `card_expenses` acumuló el usuario en toda su historia,
porque cada mes se pide con su propio rango de fecha explícito al servidor —
nunca se infiere "¿llegó a estar completo dentro de una ventana de N filas?".
Esta es una mejora deliberada sobre el patrón de `expenses.ts`, no una
casualidad: como la feature nace hoy (sin deuda arrastrada de un query
original sin filtros), se diseña bien desde el principio.

El único caso en que el delta "vs. mes anterior" se omite (mismo criterio de
"no inventar el número" que ya usa `dashboard-redesign-ux.md` sección 2.2) es
cuando el total del mes anterior da `0` — ahí un porcentaje de variación no
tiene un valor matemático significativo (división por cero / "infinito%"), no
porque el dato sea inseguro.

### 1.3 Conteos dedicados para el guard de borrado (mismo patrón que `categories.ts`)

Para deshabilitar de antemano "Eliminar" en una tarjeta o persona con gastos
asociados (sección 6), se replica **exactamente** el mecanismo que ya usa
`src/stores/categories.ts` (`fetchExpenseCounts`): un único query agregado
embebido de PostgREST por recurso, **all-time** (sin filtro de mes — el
borrado debe seguir bloqueado aunque el gasto asociado sea viejo):

```ts
// Conteo de card_expenses por tarjeta propia (análogo a categories.ts)
supabase.from('credit_cards').select('id, card_expenses(count)').eq('user_id', userId)

// Conteo de card_expenses por persona propia
supabase.from('card_people').select('id, card_expenses(count)').eq('user_id', userId)
```

Se cargan junto con el listado de `/tarjetas/gestionar` (sección 6), no bajo
demanda al abrir el menú de una fila — mismo criterio que categorías: el
estado deshabilitado ya es correcto desde el primer render.

### 1.4 ¿Alcanza con agregación 100% client-side, o hace falta una query específica por vista?

Respuesta explícita: **híbrido, con la regla clara de arriba** — el filtro de
rango de fecha (y `card_id`/`person_id` cuando aplique) siempre se resuelve
en el servidor; la agregación (sumar por tarjeta, por persona, calcular
promedio/máximo) siempre se resuelve en cliente, sobre el resultado ya
acotado por esa query. No se necesita una función/vista de Postgres dedicada
para esta iteración: el volumen esperado de `card_expenses` de **un mes** de
**un usuario personal** (no cientos de tarjetas ni miles de movimientos
mensuales) es chico de sobra para agregarlo en JS sin costo perceptible —
mismo criterio de escala ya aceptado hoy para `monthTotal` en `expenses.ts`.
Como red de seguridad (no como mecanismo de corrección, la corrección ya la
da el filtro de fecha), cada query de listado agrega un `.limit(1000)`
defensivo — si alguna vez se golpea ese límite, es una señal para revisar el
supuesto de escala, no una forma válida de truncar silenciosamente un mes.

### 1.5 Consecuencia para el selector de mes (adelanto de sección 3)

Como cada mes se pide con su propio rango de fecha explícito, el selector de
mes de "Transacciones por tarjeta" **no depende de ninguna lista precargada**
para saber qué meses "son seguros de mostrar" (a diferencia de "Por mes" de
Estadísticas, que sí necesita `isMonthSafeToShow` porque deriva de la lista
ya cargada de `expenses.ts`). Se puede generar la lista de opciones del
selector con matemática de fechas pura (p. ej. los últimos 12 meses desde
hoy) sin tocar ningún store — ver sección 3.2.

---

## 2. Resumen/Dashboard (`/tarjetas`)

Header de pantalla igual al patrón ya establecido para las demás secciones
del drawer (`ArrowLeft` + título, vuelve a `/`):

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="text-xl font-semibold">Tarjetas de crédito</h1>
</header>
```

### 2.1 "Total del mes" con variación vs. mes anterior

Mismo layout visual que la tarjeta hero de Inicio (`dashboard-redesign-ux.md`
sección 2.2), sin el sparkline (acá no se pide tendencia diaria, solo el
número + delta):

```html
<Card>
  <CardHeader>
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-col gap-1">
        <CardDescription>Total de tarjetas en {{ monthLabel }}</CardDescription>
        <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
          <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(monthTotal) }}
        </CardTitle>
      </div>

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
</Card>
```

- `monthTotal`/`prevMonthTotal`: cada uno viene de su propia query acotada
  por rango de fecha (sección 1.2) — **siempre** calculables, sin heurística
  de "es seguro comparar". `monthDelta` es `null` únicamente si
  `prevMonthTotal === 0` (sección 1.2, no inventar división por cero).
- Mismo criterio semántico de color que Inicio: gastar más que el mes pasado
  es la mala noticia (`destructive` + `ArrowUp`), gastar menos es la buena
  (`success` + `ArrowDown`) — nunca color solo, siempre ícono + texto.

### 2.2 Dona de distribución: por tarjeta (no por mes) — justificación

**Decisión: la dona del dashboard distribuye el total del mes **por
tarjeta**, no por mes.**

Justificación (dos motivos, uno de diseño de información y uno práctico):

1. **Una dona representa "partes de un todo en un instante", no una serie
   temporal.** El header de esta misma tarjeta ya dice "Total de tarjetas en
   {mes}" — es un corte de un único mes. Una dona "por mes" mezclaría
   períodos de tiempo distintos como si fueran partes simultáneas de un
   mismo todo, lo cual es conceptualmente el uso equivocado de esa forma de
   gráfico (una serie temporal se lee mejor como barras u línea de
   tendencia — exactamente el patrón que ya existe para eso en "Por mes" de
   Estadísticas, sección 4.3 de `dashboard-redesign-ux.md`). "Por tarjeta"
   sí es una partición real de un único total en un único instante: encaja
   con la forma.
2. **Refuerzo visual + textual sin inventar una segunda fuente de
   verdad**: la dona por tarjeta muestra exactamente la misma partición que
   ya se lista textualmente debajo (sección 2.3, "Lista de tarjetas") — mismo
   patrón ya usado en Inicio (dona de categorías + lista de "Transacciones
   recientes" no son la misma cosa, pero la dona de categorías sí duplica a
   propósito la información de la leyenda adyacente, sección 2.3 de
   `dashboard-redesign-ux.md`: la dona es refuerzo visual, el texto es la
   fuente accesible).

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Distribución por tarjeta</CardTitle>
  </CardHeader>
  <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-center">
    <CategoryDonutChart :slices="cardDonutSlices" class="size-32 shrink-0" />
    <!-- leyenda: mismo <ul> de dashboard-redesign-ux.md sección 2.3, ver sección 9 de este doc -->
  </div>
</Card>
```

Si el mes vigente no tiene ningún `card_expense`: toda la sección de
distribución (dona + lista de tarjetas + top personas) no se muestra — ver
estado vacío general, sección 2.5.

### 2.3 Lista de tarjetas propias (total + % del total general)

`Card` con una fila por tarjeta del usuario, ordenadas desc por monto del mes:

```html
<div class="flex flex-col">
  <template v-for="(card, idx) in cardsRanking" :key="card.id">
    <Separator v-if="idx > 0" />
    <button
      type="button"
      class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      @click="router.push({ name: 'card-detail', params: { id: card.id } })"
    >
      <span class="size-8 shrink-0 rounded-full" :style="{ background: card.color }" />
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="truncate text-sm font-medium">{{ card.name }}</p>
        <p class="text-xs text-muted-foreground">•••• {{ card.lastFourDigits }}</p>
      </div>
      <div class="flex flex-col items-end gap-0.5">
        <p class="text-sm font-semibold tabular-nums">${{ formatAmount(card.monthTotal) }}</p>
        <p class="text-xs text-muted-foreground">{{ card.percentLabel }} del total</p>
      </div>
    </button>
  </template>
</div>
```

- Fila entera clickeable (`min-h-11`, foco visible) → navega al detalle de
  esa tarjeta (sección 4). No hace falta menú "⋮" acá: editar/eliminar
  tarjeta vive en la gestión dedicada (sección 6), esta lista es de
  navegación/resumen, no de gestión — mismo criterio que "Transacciones
  recientes" de Inicio (solo lectura, sección 2.4 de
  `dashboard-redesign-ux.md`).
- Tarjetas sin gasto este mes también aparecen, con `$0,00` / `0% del total`
  — mismo criterio que la referencia (Discover/Mastercard en $0 igual
  listadas), para que el usuario vea el panorama completo de todas sus
  tarjetas, no solo las que tuvieron movimiento.

### 2.4 Ranking "Top personas" (barra horizontal)

Mismo patrón visual que la barra "Por mes" de Estadísticas (sección 4.3 de
`dashboard-redesign-ux.md`: barra plana `bg-primary` en `<div>` con `width`
porcentual, sin SVG), adaptado a personas en vez de meses:

```html
<div class="flex flex-col gap-3">
  <div v-for="p in peopleRanking" :key="p.id" class="flex items-center gap-3">
    <span class="w-20 shrink-0 truncate text-xs text-muted-foreground">{{ p.name }}</span>
    <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
      <div class="h-full rounded-full bg-primary" :style="{ width: `${p.percentOfMax}%` }" />
    </div>
    <span class="w-14 shrink-0 text-right text-xs font-medium tabular-nums">{{ p.percentLabel }}</span>
  </div>
</div>
```

- `p.percentOfMax`: ancho de la barra relativo a la persona con más gasto
  (mismo criterio de escala visual que "Por mes"), **no** relativo al total
  — así la diferencia entre personas se percibe mejor cuando una domina
  ampliamente (ver reference: Paul muy por delante del resto).
- `p.percentLabel`: texto mostrado a la derecha, ese sí **porcentaje del
  total del mes** (`amount / monthTotal * 100`, redondeado) — es el número
  que el usuario realmente quiere leer ("¿qué % del gasto de tarjetas es
  mío/de esta persona?"), coherente con los `%` que ya se muestran en la
  dona/lista de tarjetas.
- **"Sin persona asignada"**: los `card_expenses` sin `person_id` (persona es
  opcional en el alta, sección 5) se agrupan en una fila sintética "Sin
  persona asignada", con la misma barra pero en `bg-muted-foreground` en vez
  de `bg-primary` — mismo criterio que el slice "Otros" de la dona de
  categorías (sintético, color neutro, nunca se inventa un color de
  identidad para "nadie").
- Sin cap artificial de "top 5": se espera un puñado de personas por usuario
  (familiares/allegados), no una lista larga — se listan todas las que
  tuvieron gasto ese mes, ordenadas desc. Si a futuro esto creciera mucho,
  ahí sí recortar con un "+N más" — no se construye ahora (mismo criterio de
  "no over-engineer" ya usado en el resto del proyecto).

### 2.5 Estados de carga/vacío/error

- **Carga**: `Skeleton` en las 4 secciones (total+delta, dona+lista de
  tarjetas, top personas) — mismo criterio que Inicio.
- **Error**: mismo bloque `AlertCircle` + "No pudimos cargar tus tarjetas" +
  `Reintentar` que ya usa el resto de la app.
- **Vacío, sin ninguna tarjeta creada todavía**: reemplaza todo el contenido
  bajo el header por un bloque centrado (ícono `CreditCard` `size-12
  text-muted-foreground`, título "Todavía no agregaste ninguna tarjeta",
  subtexto "Agregá tu primera tarjeta para empezar a registrar sus gastos.",
  botón `Agregar tarjeta` → `router.push({ name: 'manage-cards' })`) — el
  alta de tarjeta vive en la gestión dedicada (sección 6), no hay atajo de
  Sheet directo desde acá (mismo criterio de "un único punto de entrada" ya
  usado en categorías, sección 4 de `categories-mvp-ux.md`).
- **Vacío, con tarjetas pero sin gasto este mes**: se muestra igual la lista
  de tarjetas (todas en $0, sección 2.3) pero se ocultan dona y top personas
  (no hay nada que partir/rankear con total `0`) — en su lugar, un texto
  simple `Todavía no registraste gastos de tarjeta este mes.` debajo de la
  lista.

---

## 3. Transacciones por tarjeta (`/tarjetas/transacciones`)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/tarjetas/transacciones` | `card-transactions` | `{ requiresAuth: true }` | `CardTransactionsView` |

Header igual al patrón de segundo nivel, título "Transacciones de tarjetas"
(se distingue a propósito de "Transacciones" a secas, que es la ruta de
gastos personales — evita ambigüedad en el drawer/breadcrumbs mentales del
usuario entre ambos historiales).

### 3.1 Filtros: mes / tarjeta / persona

Fila de filtros (`flex gap-2 overflow-x-auto px-4 py-3` para que no rompan
layout en mobile angosto), tres `Select` de shadcn-vue (ya instalado, sin
componente nuevo):

```html
<div class="flex gap-2 overflow-x-auto px-4 py-3 sm:px-6 lg:px-8">
  <Select v-model="filters.month">...</Select>       <!-- opciones: últimos 12 meses -->
  <Select v-model="filters.cardId">...</Select>       <!-- "Todas las tarjetas" + una por tarjeta -->
  <Select v-model="filters.personId">...</Select>     <!-- "Todas las personas" + una por persona -->
</div>
```

- **Mes**: filtro **obligatorio** (siempre hay un mes seleccionado, default
  el mes calendario vigente) — a diferencia de tarjeta/persona, que sí
  admiten "Todas". Justificación: el filtro de mes es lo que le da al query
  su rango de fecha (`gte`/`lt`, sección 1.2) — sin un mes elegido no hay
  forma de acotar la consulta sin volver a caer en "traer todo". Opciones
  del `Select`: los últimos 12 meses desde hoy, generados con matemática de
  fechas pura (`Array.from({length: 12})` restando meses a `new Date()`),
  **sin depender de ningún dato ya cargado** (ver sección 1.5) — el usuario
  puede navegar a cualquiera de esos 12 meses aunque nunca se haya
  precargado nada de esa ventana.
- **Tarjeta**: "Todas las tarjetas" (default) o una específica — opciones
  desde `creditCardsStore.cards` (ya en memoria, lista corta).
- **Persona**: "Todas las personas" (default) o una específica, más una
  opción fija "Sin persona asignada" al final de la lista (para filtrar
  justamente los gastos sin persona) — opciones desde
  `cardPeopleStore.people`.
- Cualquier cambio de filtro dispara una nueva query acotada (sección 1.2),
  reemplazando el resultado anterior — no hay "cargar más"/paginación en
  esta iteración (mismo alcance que el resto de listados de la app).

### 3.2 Agrupado por tarjeta

Dentro del rango de fecha + persona ya filtrados, agrupar por tarjeta
(respetando el filtro de tarjeta si no es "Todas"):

```html
<Card v-for="group in groupedByCard" :key="group.card.id">
  <CardHeader class="flex-row items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <span class="size-6 shrink-0 rounded-full" :style="{ background: group.card.color }" />
      <CardTitle class="text-sm font-semibold">{{ group.card.name }} (•••• {{ group.card.lastFourDigits }})</CardTitle>
    </div>
    <span class="text-sm font-semibold tabular-nums">${{ formatAmount(group.total) }}</span>
  </CardHeader>

  <p v-if="group.expenses.length === 0" class="px-6 pb-4 text-sm text-muted-foreground">
    Sin transacciones
  </p>
  <div v-else class="flex flex-col">
    <template v-for="(expense, idx) in group.expenses" :key="expense.id">
      <Separator v-if="idx > 0" />
      <div class="flex items-center gap-3 px-4 py-3">
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="truncate text-sm font-medium">{{ expense.description || group.card.name }}</p>
          <p class="truncate text-xs text-muted-foreground">
            {{ expense.person?.name ?? 'Sin persona asignada' }}
            <span v-if="expense.totalInstallments"> · {{ expense.currentInstallment }}/{{ expense.totalInstallments }}</span>
          </p>
        </div>
        <div class="flex flex-col items-end gap-0.5">
          <p class="text-sm font-semibold tabular-nums">${{ formatAmount(expense.amount) }}</p>
          <p class="text-xs text-muted-foreground">{{ formatExpenseDateHeading(expense.expenseDate) }}</p>
        </div>
        <DropdownMenu><!-- Editar/Eliminar, mismo patrón que gastos --></DropdownMenu>
      </div>
    </template>
  </div>
</Card>
```

- **Todas las tarjetas del usuario aparecen como grupo**, incluso sin
  transacciones en el filtro vigente (`Sin transacciones`, mismo criterio
  que la referencia) — salvo que el filtro de tarjeta esté fijado a una
  específica, en cuyo caso solo se renderiza ese único grupo.
- Cuotas: si `totalInstallments` está presente, se muestra `{actual}/{total}`
  como metadato secundario (mismo lugar donde hoy va la categoría en gastos
  personales) — nunca como el dato principal de la fila.

### 3.3 Total general al pie

`Card` simple al final de la lista (no fija/flotante — ver justificación
abajo):

```html
<Card class="mt-2">
  <div class="flex items-center justify-between px-6 py-4">
    <span class="text-sm font-medium">Total ({{ filters.monthLabel }})</span>
    <span class="text-lg font-bold tabular-nums">${{ formatAmount(grandTotal) }}</span>
  </div>
</Card>
```

Se decide **no** replicar la barra fija/flotante de la referencia (`Total del
mes: $757,48` pegado al fondo de la pantalla): esta app ya reserva esa franja
inferior para el FAB de "agregar" (mismo patrón que `TransactionsView.vue`
personal) — apilar una barra de total fija además del FAB competiría por el
mismo espacio en mobile angosto. Un total al pie de la lista (scrolleable,
no fijo) comunica lo mismo sin ese conflicto de layout.

FAB "+" (`Plus`, mismo estilo que `TransactionsView.vue`: `size-14
rounded-full shadow-[var(--shadow-elevated)]`, respeta
`env(safe-area-inset-bottom)`) abre el Sheet de alta (sección 5), sin
preseleccionar tarjeta/persona salvo que el filtro vigente tenga una
específica (en ese caso, preseleccionarla como conveniencia — el usuario ya
mostró intención de estar mirando esa tarjeta/persona).

### 3.4 Estados de carga/vacío/error

Mismo lenguaje visual que el resto de listados: `Skeleton` de 3 `Card` de
grupo durante la carga; `AlertCircle` + "No pudimos cargar las
transacciones" + `Reintentar` en error; si el usuario no tiene ninguna
tarjeta creada todavía, esta vista redirige a la gestión (`router.replace({
name: 'manage-cards' })`) en vez de mostrar filtros vacíos sin sentido — no
hay nada que filtrar sin al menos una tarjeta.

---

## 4. Detalle de una tarjeta (`/tarjetas/:id`)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/tarjetas/:id` | `card-detail` | `{ requiresAuth: true }` | `CardDetailView` |

Header: `ArrowLeft` (vuelve a `/tarjetas`, no a Home — es un nivel más
adentro de la sección Tarjetas) + nombre de la tarjeta.

### 4.1 Hero: total del mes + progreso contra el límite sugerido

```html
<Card>
  <CardHeader>
    <CardDescription>Total en {{ monthLabel }}</CardDescription>
    <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
      <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(cardMonthTotal) }}
    </CardTitle>
  </CardHeader>

  <div v-if="card.monthlyLimitSuggested" class="flex flex-col gap-1.5 px-6 pb-6">
    <div class="h-2 overflow-hidden rounded-full bg-muted">
      <div
        class="h-full rounded-full transition-[width]"
        :class="limitBarColorClass"
        :style="{ width: `${Math.min(limitProgress, 100)}%` }"
      />
    </div>
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>Límite mensual sugerido: ${{ formatAmount(card.monthlyLimitSuggested) }}</span>
      <span>{{ limitProgressLabel }}</span>
    </div>
    <p class="text-xs text-muted-foreground">
      Este límite es solo una referencia que vos definiste, no un límite real de tu tarjeta ni de tu banco.
    </p>
  </div>
  <p v-else class="px-6 pb-6 text-xs text-muted-foreground">
    No definiste un límite mensual sugerido para esta tarjeta.
    <button type="button" class="font-medium text-primary underline-offset-2 hover:underline" @click="openEditCard">Definir uno</button>
  </p>
</Card>
```

- **Copy explícito de "informativo, no un límite duro"** en texto plano
  (no solo en un tooltip que dependa de hover — no hay hover fiable en
  touch) — cumple el pedido del encargo de que quede clarísimo.
- `limitProgress = (cardMonthTotal / card.monthlyLimitSuggested) * 100`,
  visualmente cappeado a 100% en el ancho de la barra (aunque el número real
  pueda superar 100%, mostrado en `limitProgressLabel`, p. ej. `"113%
  usado"`).
- Color de la barra (mismo criterio semántico que `design-system.md` ya
  anticipa para presupuestos): `bg-primary` si `<80%`, `bg-warning` si
  `80-100%`, `bg-destructive` si `>100%` — **siempre acompañado del texto**
  `limitProgressLabel` (p. ej. `"39% usado"` / `"113% usado"`), nunca solo
  color, y con el copy de "es informativo" ya puesto al pie para que superar
  el 100% no se lea como una alarma real.
- Si `monthlyLimitSuggested` es `null`: no se muestra ninguna barra (no hay
  contra qué progresar) — en su lugar, una invitación de una línea a
  definirlo desde "Editar tarjeta".

### 4.2 Dona de gasto por persona (dentro de esta tarjeta)

Mismo componente reusado, ahora con `card_expenses` filtrados a
`card_id = :id` + mes vigente, agrupados por persona (incluyendo "Sin
persona asignada" como slice sintético, mismo criterio que la sección 2.4):

```html
<Card>
  <CardHeader><CardTitle class="text-base font-semibold">Gastos por persona</CardTitle></CardHeader>
  <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row">
    <CategoryDonutChart :slices="personDonutSlices" class="size-32 shrink-0" />
    <!-- leyenda de texto, mismo patrón que sección 2.3 de dashboard-redesign-ux.md -->
  </div>
</Card>
```

### 4.3 "Movimientos recientes" + "Ver todos"

Últimos 5 `card_expenses` de esta tarjeta, **sin** filtrar por mes vigente
(a propósito: "recientes" es una noción de actualidad, no de mes calendario
— si el usuario no gastó nada este mes pero sí la semana pasada del mes
anterior, sigue siendo información "reciente" relevante). Query dedicada:
`.eq('card_id', id).order('expense_date', {ascending:false}).order('created_at', {ascending:false}).limit(5)`
— el `limit(5)` acá es seguro porque el propósito es literalmente "los
últimos 5", no una lista que se pretenda completa (mismo argumento que
sección 1.2).

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Movimientos recientes</CardTitle>
    <CardAction>
      <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'card-transactions', query: { cardId: card.id } })">
        Ver todos
      </Button>
    </CardAction>
  </CardHeader>
  <!-- filas, mismo layout de fila que sección 3.2, sin menú ⋮ (solo lectura, mismo criterio que "Transacciones recientes" de Inicio) -->
</Card>
```

`CardTransactionsView` lee `route.query.cardId` en `onMounted` y preselecciona
ese filtro de tarjeta (mismo patrón de query param ya usado para `?new=1` en
`dashboard-redesign-ux.md` sección 3.4).

### 4.4 Resumen de la tarjeta (cantidad, promedio, mayor gasto)

Derivado **sin queries adicionales**, del mismo array ya traído para el
hero del mes (sección 4.1) — eficiencia deliberada, un solo query sirve
para 4 números (total, cantidad, promedio, máximo):

```html
<Card>
  <CardHeader><CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resumen del mes</CardTitle></CardHeader>
  <div class="grid grid-cols-3 gap-2 px-6 pb-6 text-center">
    <div><p class="text-lg font-semibold tabular-nums">{{ monthExpenses.length }}</p><p class="text-xs text-muted-foreground">Transacciones</p></div>
    <div><p class="text-lg font-semibold tabular-nums">${{ formatAmount(averageExpense) }}</p><p class="text-xs text-muted-foreground">Promedio</p></div>
    <div><p class="text-lg font-semibold tabular-nums">${{ formatAmount(maxExpense) }}</p><p class="text-xs text-muted-foreground">Mayor gasto</p></div>
  </div>
</Card>
```

`averageExpense = cardMonthTotal / monthExpenses.length` (con guard
`monthExpenses.length === 0` → mostrar `$0,00`, no `NaN`).

### 4.5 Acciones: "Editar tarjeta" / "+ Nuevo gasto"

Fila fija al pie del contenido (no flotante — este es un detalle de
pantalla completa, no necesita FAB):

```html
<div class="flex gap-3 px-4 pb-6 sm:px-6 lg:px-8">
  <Button variant="outline" class="flex-1" @click="openEditCardSheet">Editar tarjeta</Button>
  <Button class="flex-1" @click="openNewExpenseSheet">
    <Plus class="size-4" /> Nuevo gasto
  </Button>
</div>
```

- "Editar tarjeta" abre `CardFormSheet` en modo edición (mismo Sheet de la
  gestión, sección 6.1) — no hace falta una segunda pantalla de edición, es
  el mismo formulario.
- "+ Nuevo gasto" abre `CardExpenseFormSheet` (sección 5) con esta tarjeta
  preseleccionada.

---

## 5. Alta/edición de gasto de tarjeta — Sheet (no ruta dedicada)

**Decisión: `Sheet` inferior (`side="bottom"`), mismo criterio ya usado para
el alta de gasto personal (`ExpenseFormSheet.vue`), no una ruta.**
Justificación: es un formulario puntual de una sola tarea (cargar/editar
**un** movimiento), de uso frecuente (potencialmente más frecuente que el
alta de categoría, ya que se espera repetir varias veces por semana/mes) —
exactamente lo opuesto de "gestión de baja frecuencia" que sí justificó ruta
dedicada para categorías/tarjetas/personas (secciones 6). Se abre desde tres
puntos de entrada: FAB de "Transacciones por tarjeta" (sección 3.3), botón
"+ Nuevo gasto" del detalle de tarjeta (sección 4.5), y — si se decide en
frontend — un FAB propio en el Dashboard (opcional, no bloqueante).

Mismo patrón estructural que `ExpenseFormSheet.vue`: `SheetContent
side="bottom"`, `SheetHeader`/`SheetTitle`/`SheetDescription`, body
`gap-4 px-4`, `SheetFooter` con un único botón ancho completo.

### 5.1 Campos

1. **Tarjeta** (`Select`, requerido): opciones = `creditCardsStore.cards`
   (`"{nombre} •••• {últimos4}"`). Preseleccionada si el Sheet se abrió desde
   un contexto con tarjeta ya fijada (detalle de tarjeta, o filtro vigente de
   "Transacciones por tarjeta"), pero siempre editable.
2. **Persona** (`Select`, opcional): primera opción `"Sin persona asignada"`
   (valor `null`), luego `cardPeopleStore.people`. Sin persona preseleccionada
   por default (mismo criterio de "forzar elección consciente" que
   categorías/gastos, salvo que acá la opción "sin persona" es
   explícitamente válida y no un estado de error — no es un campo requerido).
3. **Descripción** (`Input`, opcional, `maxlength` generoso): si queda vacía,
   la fila de listado usa el nombre de la tarjeta como fallback (mismo
   criterio que `expenseTitle()` de gastos personales, sección 3.1 de
   `expenses-mvp-ux.md`).
4. **Fecha** (`<input type="date">` nativo): mismo criterio que
   `design-system.md` sección 4 (nota de fecha) — no `Calendar`+`Popover`.
5. **Valor** (`Input type="number"`, requerido, `> 0`): misma validación que
   el monto de gasto personal.
6. **Toggle "Cuotas"** (opcional) — ver sección 5.2, semántica de `Switch`.
7. **Notas** (opcional, multilínea) — ver sección 5.3, componente `Textarea`.
8. Botón footer: `Guardar gasto` (alta) / `Guardar cambios` (edición), mismo
   estado de loading (`disabled` + `Loader2` + `Guardando…`) que el resto de
   formularios del proyecto.

### 5.2 Toggle de cuotas — componente nuevo: `Switch`

**No hay ningún binario real hoy en el inventario de componentes** (Fase 1
de `design-system.md` no incluye `Switch`; el único control de 3 estados que
sí se evaluó, en `theme-toggle-ux.md`, se descartó explícitamente a favor de
un segmented control porque el dato modelaba 3 estados, no 2 — un caso
distinto al de acá). "¿Este gasto tiene cuotas o no?" **sí** es un binario
real (no hay un tercer estado "cuotas del sistema" ni nada análogo) — es el
primer caso genuino de "on/off" del proyecto. Se instala el componente
`Switch` de shadcn-vue (`npx shadcn-vue add switch`), siguiendo el mismo
patrón `cva`/`data-slot` que el resto de `src/components/ui/` (mismo
criterio ya usado para agregar `Alert` cuando hizo falta, ver
`expenses-mvp-ux.md`).

```html
<div class="flex items-center justify-between gap-3">
  <Label for="cuotas-toggle">Cuotas</Label>
  <Switch id="cuotas-toggle" v-model:checked="hasInstallments" />
</div>

<div v-if="hasInstallments" class="flex items-end gap-2">
  <div class="flex flex-1 flex-col gap-1.5">
    <Label for="cuota-actual">Cuota actual</Label>
    <Input id="cuota-actual" type="number" min="1" v-model.number="currentInstallment" />
  </div>
  <span class="pb-2.5 text-sm text-muted-foreground">de</span>
  <div class="flex flex-1 flex-col gap-1.5">
    <Label for="cuotas-totales">Cuotas totales</Label>
    <Input id="cuotas-totales" type="number" min="1" v-model.number="totalInstallments" />
  </div>
</div>
```

- Semántica correcta (punto explícito de a11y del encargo): `Switch` de
  Reka UI ya expone `role="switch"` + `aria-checked` de fábrica — no se
  reimplementa a mano como los botones planos del segmented control de tema
  (acá sí conviene el primitivo, justamente porque es un binario genuino,
  a diferencia del caso de 3 estados).
- Al desactivar el toggle: los dos campos se ocultan y sus valores se
  descartan (persistidos como `null`/`null`), no quedan "fantasma" en un
  estado oculto que después se guarde por error.
- Validación si está activo: `currentInstallment >= 1`,
  `totalInstallments >= 1`, `currentInstallment <= totalInstallments` —
  error inline debajo del par de inputs si se viola (`Cuota actual`, `Cuota 3
  de 2` no tiene sentido).
- Revelado de los campos: aparecen inmediatamente debajo del switch en el
  orden natural del DOM (sin `aria-live` dedicado) — un lector de pantalla
  que siga tabulando los encuentra en su posición natural, mismo criterio de
  "no over-engineer el manejo de foco" ya aplicado en `nav-drawer-ux.md`.

### 5.3 Notas — componente nuevo: `Textarea`

Tampoco existe hoy `Textarea` en el inventario (Fase 1 solo cubría `Input`
de una línea, suficiente para monto/descripción/nombre). "Notas" es
explícitamente un campo libre y potencialmente multilínea ("Concierto en el
Movistar Arena" en la referencia, pero podría ser más largo) — se instala
`Textarea` de shadcn-vue (`npx shadcn-vue add textarea`), mismo criterio de
"agregar solo cuando hace falta" ya aplicado a `Switch` arriba y, en su
momento, a `Alert`.

```html
<div class="flex flex-col gap-1.5">
  <Label for="notas-gasto">Notas (opcional)</Label>
  <Textarea id="notas-gasto" rows="2" maxlength="280" placeholder="Ej. Concierto en el Movistar Arena" />
</div>
```

### 5.4 Guardado: 100% optimista (a diferencia de categorías)

**No aplica la excepción "no optimista" que sí usa `CategoryFormSheet`**
(sección 3.4 de `categories-mvp-ux.md`). Esa excepción existía únicamente
porque categorías tiene un índice único de nombre con conflicto real
server-only. `card_expenses` no tiene ninguna restricción de unicidad
conocida (ningún campo de esta tabla se presta a colisión de nombre) — todas
sus validaciones (monto > 0, tarjeta seleccionada, coherencia de cuotas) son
100% verificables en cliente antes del roundtrip. Por lo tanto, se sigue el
patrón de `ExpenseFormSheet.vue`: **cerrar el Sheet de inmediato + insertar
optimista en el store**, confirmar/hacer rollback en segundo plano con
toast + acción "Reintentar" (mismo mecanismo exacto que gastos personales,
sección 3.8 de `expenses-mvp-ux.md`).

Nota para `supabase-backend-expert`: si en el futuro se agrega alguna
restricción server-only sobre `card_expenses` (poco probable dado el
esquema descripto), reevaluar esta decisión con el mismo criterio que
`categories-mvp-ux.md` sección 3.4 documenta para ese caso.

---

## 6. Gestión de tarjetas y de personas (`/tarjetas/gestionar`)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/tarjetas/gestionar` | `manage-cards` | `{ requiresAuth: true }` | `ManageCardsView` |

### 6.1 Decisión: una única ruta dedicada, con dos secciones (no dos rutas, no un Sheet)

**Ruta dedicada, no Sheet/modal** — mismo criterio exacto que
`categories-mvp-ux.md` sección 1: es gestión (listar + crear + editar +
borrar), no un formulario puntual; es de baja frecuencia de uso (una tarjeta
o persona se crea una vez y rara vez se edita, a diferencia de cargar un
gasto de tarjeta que sí es frecuente, sección 5); mezclar esta gestión con el
`CardExpenseFormSheet` (que ya es un Sheet, sección 5) en un Sheet-sobre-Sheet
tiene el mismo problema de apilado de focus traps ya documentado en
categorías.

**Una única ruta para ambas entidades (tarjetas + personas), no dos rutas
separadas** — a diferencia de "Transacciones"/"Categorías" (dominios grandes
e independientes que sí ameritan cada uno su propia ruta), tarjetas y
personas son dos listas cortas y de gestión igual de infrecuente que viven
naturalmente juntas en una sola pantalla de "configuración de tarjetas". Se
replica el patrón **ya usado por `CategoriesView`**: dos secciones en `Card`
separados dentro de la misma pantalla ("Categorías predeterminadas"/"Mis
categorías" ahí; "Tus tarjetas"/"Personas" acá) — mismo nivel de granularidad,
sin necesidad de introducir un componente `Tabs` (todavía no instalado,
`design-system.md` lo deja para cuando exista la pantalla de presupuestos) ni
duplicar navegación para dos listas chicas.

Header: `ArrowLeft` (vuelve a `/tarjetas`, no a Home — es un nivel más
adentro de la sección Tarjetas, mismo criterio que el detalle de tarjeta) +
"Tarjetas y personas".

### 6.2 Sección "Tus tarjetas"

Mismo layout de lista agrupada que `CategoriesView` sección 2.2 (Card +
`Separator` entre filas, encabezado de sección con botón "+" a la derecha):

- Fila: swatch `size-8 rounded-full` (color de la tarjeta) + nombre + `••••
  {últimos4}` como metadato + (si tiene) `Límite: $X` en `text-xs
  text-muted-foreground` + contador de uso (`Sin gastos` / `{n} gastos`,
  mismo criterio que categorías) + menú `⋮` (`Editar`/`Eliminar`,
  `Eliminar` deshabilitado si el conteo es ≥1, mismo mecanismo de la sección
  1.3).
- Estado vacío de la sección: ícono `CreditCard`, texto "Todavía no
  agregaste ninguna tarjeta.", botón `Nueva tarjeta`.

**`CardFormSheet`** (alta/edición), mismo patrón de Sheet que
`CategoryFormSheet`:
- **Nombre** (`Input`, requerido).
- **Últimos 4 dígitos** (`Input`, `maxlength="4"`, solo dígitos, requerido) —
  se muestra enmascarado como `•••• {valor}` en cualquier listado, nunca el
  número completo de tarjeta (esta tabla no guarda el número completo, solo
  4 dígitos informativos, así que no hay dato sensible real que enmascarar
  más allá de esto).
- **Color** (grid fijo de 10 swatches, mismos hex ya sembrados en
  `categories.color`, requerido) — reuso literal de la paleta y el patrón de
  `categories-mvp-ux.md` sección 3.3 (mismo criterio: reusar antes que
  inventar, separación perceptual ya validada informalmente al reusar los
  mismos 10 hex).
- **Límite mensual sugerido** (`Input type="number"`, opcional): helper text
  debajo, `text-xs text-muted-foreground`: "Es solo una referencia para vos,
  no afecta el límite real de tu tarjeta." — mismo copy de honestidad que la
  barra de progreso del detalle (sección 4.1).
- **Guardado: 100% optimista** (a diferencia de `CategoryFormSheet`) — el
  encargo no describe ningún índice único sobre `credit_cards.name`, así que
  no hay conflicto server-only conocido en el camino feliz; se sigue el
  patrón de `ExpenseFormSheet`/`CardExpenseFormSheet` (cierre inmediato +
  optimista + rollback con toast). Si `supabase-backend-expert` decide
  agregar una restricción de unicidad más adelante, migrar este Sheet al
  patrón no-optimista de `CategoryFormSheet` (sección 3.4 de
  `categories-mvp-ux.md`) en ese momento, no antes.
- **Borrado**: optimista con rollback, `AlertDialog` de confirmación (`¿Eliminar
  "{nombre}"?` / `Esta acción no se puede deshacer.`), deshabilitado de
  antemano si tiene `card_expenses` asociados — mecanismo idéntico a
  categorías (sección 1.3 de este documento).

### 6.3 Sección "Personas"

Mismo layout que 6.2, con dos diferencias puntuales (ya decididas por el
Product Owner, no se rediscuten):

- **Sin campo de foto/avatar** (evita meter Supabase Storage en el alcance).
- **Color opcional** (a diferencia del color de tarjeta, que es requerido):
  el grid de 10 swatches incluye la posibilidad de no elegir ninguno. Si no
  se elige color: la fila y cualquier lugar donde se muestre esta persona
  (dona de personas, ranking del dashboard, filas de transacciones) usa un
  swatch neutro (`bg-muted` + ícono `User` chico dentro, en vez de un punto
  de color) — nunca queda "sin ningún indicador visual", solo sin color de
  identidad propio. El swatch picker en el Sheet agrega una opción extra al
  final del grid, "Sin color" (`size-11 rounded-full border border-dashed
  border-border flex items-center justify-center`, con el mismo ícono
  `User` adentro y `aria-label="Sin color"`), para que "no elegir color" sea
  una elección explícita y no simplemente dejar el formulario a medio
  completar.
- **Nombre** (`Input`, requerido) — mismo patrón de validación básica
  (no vacío tras `trim()`) que el nombre de categoría, sin el chequeo de
  duplicado (no hay ningún problema de ambigüedad conocido si dos personas
  comparten nombre — a diferencia de categorías, donde el nombre aparece
  dentro de un `Select` compartido con las categorías default; acá las
  personas siempre aparecen en listas propias del usuario, sin mezclarse
  con nada "del sistema").
- **Borrado**: mismo mecanismo que tarjetas (sección 1.3), deshabilitado de
  antemano si tiene `card_expenses` asociados.

---

## 7. Navegación: nuevo ítem "Tarjetas de crédito" en el drawer

Ícono confirmado en el paquete ya instalado:
`node_modules/@lucide/vue/dist/esm/icons/credit-card.mjs`, reexportado como
`CreditCard` (también `CreditCardIcon`/`LucideCreditCard`) en
`@lucide/vue@1.24.0` — no requiere instalar nada, mismo criterio ya usado
para confirmar `ArrowLeftRight`/`ChartPie`/`FileText`/`Settings` en
`dashboard-redesign-ux.md` sección 6.1.

**Posición: 3º lugar, entre "Transacciones" y "Categorías"** (el `<nav>` pasa
de 6 a 7 ítems):

| Orden | Label | Ícono | `route.name` |
|---|---|---|---|
| 1 | Inicio | `Home` | `home` |
| 2 | Transacciones | `ArrowLeftRight` | `transactions` |
| **3** | **Tarjetas de crédito** | **`CreditCard`** | **`cards`** |
| 4 | Categorías | `Tag` | `categories` |
| 5 | Estadísticas | `ChartPie` | `statistics` |
| 6 | Reportes | `FileText` | `reports` |
| 7 | Ajustes | `Settings` | `settings` |

Justificación del orden: "Tarjetas de crédito" es, igual que
"Transacciones", un **dominio de datos de movimientos de dinero** (lista un
historial de gasto real, con su propio dashboard/detalle/alta) — pertenece
al mismo bloque mental que Inicio/Transacciones, antes que "Categorías"
(que es metadata de clasificación para los gastos personales, no un
historial de movimientos en sí mismo) y muy antes que
Estadísticas/Reportes/Ajustes (análisis y configuración, no carga de datos
nueva). Ubicarlo inmediatamente después de "Transacciones" refleja que ambas
son, desde la perspectiva del usuario, "mis dos historiales de gasto" (el
personal y el de tarjetas), uno al lado del otro.

Fila de nav: mismo markup/clases exactas ya establecidas (`flex min-h-11
items-center gap-3 rounded-md px-3 text-sm font-medium`, estado activo vía
`route.name === 'cards'`, `aria-current="page"` cuando corresponda) — no se
repite el markup completo acá, ver `nav-drawer-ux.md` sección 1 y
`dashboard-redesign-ux.md` sección 6.1 para el patrón exacto a copiar.

---

## 8. Rutas — resumen completo

```ts
{ path: '/tarjetas', name: 'cards', component: () => import('@/views/CardsDashboardView.vue'), meta: { requiresAuth: true } },
{ path: '/tarjetas/transacciones', name: 'card-transactions', component: () => import('@/views/CardTransactionsView.vue'), meta: { requiresAuth: true } },
{ path: '/tarjetas/gestionar', name: 'manage-cards', component: () => import('@/views/ManageCardsView.vue'), meta: { requiresAuth: true } },
{ path: '/tarjetas/:id', name: 'card-detail', component: () => import('@/views/CardDetailView.vue'), meta: { requiresAuth: true } },
```

Se agregan a `src/router/index.ts` junto a las rutas ya existentes, mismo
`meta.requiresAuth` y mismo lazy import por ruta ya usado hoy. Nota de
orden: declarar `/tarjetas/gestionar` y `/tarjetas/transacciones` **antes**
de `/tarjetas/:id` en el array de rutas (Vue Router resuelve por orden de
declaración cuando hay solapamiento de segmento; aunque `gestionar`/
`transacciones` no colisionan literalmente con el patrón `:id` de forma
ambigua para vue-router 4, es la práctica defensiva estándar — poner las
rutas literales antes que la dinámica del mismo prefijo).

---

## 9. Reuso de componentes de gráfico — confirmación explícita

**`CategoryDonutChart.vue` y `buildDonutSlices()` sirven tal cual, sin
ninguna extensión.** Se verificó la firma actual en `src/lib/charts.ts`:

```ts
export interface CategoryTotal { id: string, name: string, color: string | null, amount: number }
export interface DonutSlice { id: string, name: string, color: string | null, amount: number, percentLabel: string, folded?: {...}[] }
export function buildDonutSlices(categoryTotals: CategoryTotal[], maxSlices = 5): DonutSlice[]
```

Pese al nombre (`CategoryTotal`), la forma del tipo **ya es genérica** — no
tiene ningún campo específico de categorías (no pide `icon`, no asume nada
del dominio "categoría"). Alcanza con mapear tarjetas o personas a esa misma
forma antes de pasarlas:

```ts
const cardTotals: CategoryTotal[] = cards.map(c => ({ id: c.id, name: c.name, color: c.color, amount: c.monthTotal }))
const cardDonutSlices = buildDonutSlices(cardTotals, 5)
```

No hace falta renombrar el tipo ni tocar `charts.ts` para esta feature —
queda como una mejora cosmética opcional para otra sesión (renombrar
`CategoryTotal` a algo más neutral como `AmountTotal`, ya que ahora tiene 3
consumidores de dominios distintos: categorías, tarjetas, personas) —
deuda anotada, no bloqueante.

**`TrendAreaChart.vue` no se usa en esta iteración** (el encargo no pide
ninguna tendencia diaria/mensual para tarjetas, solo el delta puntual de la
sección 2.1) — queda disponible para una futura iteración si se pidiera
"tendencia de gasto de tarjeta a lo largo del año", sin cambios necesarios
en el componente para ese caso futuro.

**La barra horizontal de "Por mes" (Estadísticas) no está extraída como
componente reusable** — es markup inline dentro de `StatisticsView.vue`. La
barra de "Top personas" (sección 2.4) replica el mismo patrón de clases
Tailwind **inline en `CardsDashboardView.vue`**, sin tocar
`StatisticsView.vue` ni crear un componente compartido nuevo — mismo
criterio de "no tocar vistas existentes que no hace falta tocar" ya aplicado
en iteraciones previas (`dashboard-redesign-ux.md` resumen, punto 7: "No
tocar `CategoriesView.vue`"). Extraer un `RankingBarList.vue` compartido es
una refactorización razonable para una futura sesión, una vez que exista un
tercer consumidor del mismo patrón — no se hace ahora.

---

## 10. Accesibilidad

Se reafirman los lineamientos ya vigentes de `design-system.md` sección 5,
con las particularidades nuevas de esta feature:

1. **Color nunca como único indicador**: delta vs. mes anterior (ícono +
   texto, sección 2.1); leyenda de ambas donas en texto real (sección 2.2,
   4.2); barra de progreso del límite sugerido siempre con
   `limitProgressLabel` en texto (sección 4.1); barra de "Top personas"
   siempre con nombre + `%` en texto (sección 2.4); persona sin color propio
   nunca queda "sin ningún indicador" (ícono `User` en el swatch neutro,
   sección 6.3).
2. **`aria-current="page"`** en el nuevo ítem del drawer, mismo mecanismo ya
   vigente (sección 7).
3. **Mínimo táctil 44×44px**: filas clickeables de la lista de tarjetas
   (`min-h-11`), swatches de color (`size-11` en los Sheets de tarjeta/
   persona, igual que categorías), botones de menú `⋮` (`h-11 w-11`),
   botones "Editar tarjeta"/"+ Nuevo gasto" del detalle (`Button` default ya
   cumple `h-11` por el ajuste global del proyecto).
4. **Foco visible**: mismo patrón `focus-visible:ring-2
   focus-visible:ring-ring focus-visible:ring-offset-2` en toda fila/botón/
   swatch nuevo, sin excepciones.
5. **Toggle de cuotas con semántica correcta**: `Switch` de Reka UI
   (`role="switch"`, `aria-checked` de fábrica) con `<Label for="...">`
   asociado — no un botón plano con `aria-pressed` simulando un switch
   (sección 5.2). Es, a propósito, distinto del segmented control de tema
   (`radiogroup`/`radio`): acá el dato es binario real, no de 3 estados.
6. **Confirmación antes de destruir**: borrado de tarjeta/persona pasa por
   `AlertDialog`, igual que gasto/categoría — nunca directo desde el tap en
   "Eliminar" del menú `⋮`.
7. **Labels asociados, no placeholder-only**: todo campo nuevo (últimos 4
   dígitos, límite mensual sugerido, cuota actual/total, notas) lleva
   `<Label for="...">` persistente — ninguno depende solo de un
   `placeholder` como referencia.
8. **Enmascarado de últimos 4 dígitos**: en cualquier `Select`/lista que
   muestre una tarjeta, el texto visible ya incluye `"{nombre} •••• {4
   dígitos}"` como texto real (no solo un ícono) — un lector de pantalla
   anuncia la cadena completa sin ambigüedad.
9. **`prefers-reduced-motion`**: heredado de Sheet/AlertDialog/Switch (Reka
   UI), sin configuración adicional — misma cobertura que el resto del
   proyecto.

---

## 11. Qué NO se adopta de la referencia ("GastoCard")

Explícitamente descartado, no se construye nada de esto:

- **Nombre/marca "GastoCard"**, su logo (ícono de tarjeta en cuadrado
  redondeado azul oscuro) y su tagline "Control inteligente de tus gastos".
  La marca sigue siendo **TipApp** en toda la app.
- **Los 4 badges superiores** ("Instalable", "Funciona sin conexión",
  "Sincroniza tus datos", "100% Seguro") — ninguno aplica hoy: TipApp no
  tiene PWA (manifest/service worker) implementada todavía (ver "Próximos
  pasos" de `CLAUDE.md`), así que no se promete ni instalabilidad ni
  funcionamiento offline ni sincronización — sería publicidad falsa del
  estado actual del producto.
- **El footer de 4 bullets de marketing** ("Visión clara", "Organizado",
  "Control total", "Siempre contigo") — copy promocional genérico, no
  aporta especificación funcional.
- **Indicador "Última sincronización: Hoy 10:42 a.m." + ícono de refresh**
  en el pie del sidebar de la referencia — implica sincronización
  offline-first que TipApp no tiene; no se construye ningún indicador de
  sincronización.
- **Campana de notificaciones** del header de la referencia — mismo
  criterio de exclusión ya aplicado en `dashboard-redesign-ux.md` (fuera de
  alcance, no hay sistema de notificaciones).
- **Barra de búsqueda (ícono lupa)** y el control **"Ordenar por: Tarjeta"**
  del listado de transacciones — no forman parte del encargo (que pide
  específicamente filtros de mes/tarjeta/persona y agrupado por tarjeta, sin
  mencionar búsqueda ni un criterio de orden alternativo); se excluyen para
  no ampliar el alcance sin pedido explícito. Si a futuro se necesitan,
  agregarlos es una extensión incremental simple sobre esta base.
- **Avatar/foto de persona** — ya decidido explícitamente por el Product
  Owner (sección 6.3): solo nombre + color opcional, sin Storage.

---

## Resumen accionable para `vue-frontend-expert`

1. **Componentes shadcn-vue nuevos a instalar** (ninguno existía en
   `src/components/ui/` antes de esta feature): `Switch`
   (`npx shadcn-vue add switch`, toggle de cuotas, sección 5.2) y `Textarea`
   (`npx shadcn-vue add textarea`, campo Notas, sección 5.3). Ambos siguen
   el mismo patrón `cva`/`cn`/`data-slot` que el resto de
   `src/components/ui/` (mismo criterio ya usado para agregar `Alert` en una
   iteración previa).
2. **Stores nuevos** (mismo patrón de un store por recurso ya usado por
   `categories.ts`/`expenses.ts`):
   - `src/stores/creditCards.ts`: CRUD de `credit_cards` + conteo dedicado
     de `card_expenses` por tarjeta (embed de PostgREST, sección 1.3),
     mismo patrón no-optimista/optimista que `categories.ts` (alta/edición
     optimista acá, ver sección 6.2 sobre por qué difiere de categorías).
   - `src/stores/cardPeople.ts`: mismo patrón, para `card_people`.
   - `src/stores/cardExpenses.ts`: **no** mantiene una lista maestra
     completa en memoria (a diferencia de `expenses.ts`) — expone funciones
     de fetch parametrizadas por filtro (mes obligatorio + tarjeta/persona
     opcionales, sección 1.2/3.1) que cada vista invoca con sus filtros
     vigentes; CRUD optimista de `card_expenses` (alta/edición/borrado,
     sección 5.4), importando `creditCards.ts`/`cardPeople.ts` en una sola
     dirección (mismo patrón de dependencia unidireccional que
     `expenses.ts` → `categories.ts`) para resolver los objetos completos de
     tarjeta/persona en las inserciones optimistas.
3. **Vistas nuevas**: `CardsDashboardView.vue` (sección 2),
   `CardTransactionsView.vue` (sección 3), `CardDetailView.vue` (sección 4),
   `ManageCardsView.vue` (sección 6, dos secciones: tarjetas + personas).
4. **Componentes nuevos**: `CardExpenseFormSheet.vue` (sección 5),
   `CardFormSheet.vue` (sección 6.2), `CardPersonFormSheet.vue` (sección 6.3).
5. **Router**: 4 rutas nuevas bajo `/tarjetas` (sección 8), declarando las
   literales (`/tarjetas/transacciones`, `/tarjetas/gestionar`) antes que la
   dinámica (`/tarjetas/:id`).
6. **Drawer** (`HomeView.vue`): nuevo ítem "Tarjetas de crédito" (`CreditCard`
   de `@lucide/vue`, ya confirmado en el paquete, sin instalar nada) en 3ª
   posición del `<nav>` (pasa de 6 a 7 ítems, sección 7).
7. **`src/lib/charts.ts`: sin cambios.** `buildDonutSlices`/
   `CategoryDonutChart` ya son genéricos y se reusan tal cual mapeando
   tarjetas/personas a la forma `{ id, name, color, amount }` (sección 9).
   `TrendAreaChart` no se usa en esta iteración.
8. **Punto más importante de todo el documento (sección 1)**: ninguna query
   de `card_expenses` reproduce el patrón "traer los últimos N sin filtro de
   fecha" de `expenses.ts`. Todo fetch de listado/agregación va acotado por
   `gte`/`lt` de `expense_date` (mes obligatorio en filtros, sección 3.1) o
   es una consulta explícitamente chica con propósito declarado (`limit(5)`
   de "recientes", sección 4.3). El único `limit` "grande" (1000) es una red
   de seguridad defensiva, no el mecanismo de corrección. El guard de
   borrado de tarjeta/persona usa el mismo conteo dedicado embebido que ya
   usa `categories.ts` (sección 1.3), esta vez all-time (sin filtro de mes).
9. Pendiente para otra sesión (no bloqueante): confirmar con
   `supabase-backend-expert` los nombres exactos de columna de las 3 tablas
   nuevas (este documento asumió nombres plausibles en `snake_case`); si se
   agrega algún índice único sobre `credit_cards.name` a futuro, migrar
   `CardFormSheet` al patrón no-optimista de `CategoryFormSheet` (sección
   6.2); considerar renombrar `CategoryTotal`/`CategoryDonutChart` en
   `charts.ts` a un nombre más neutral ahora que tienen 3 consumidores de
   dominios distintos (sección 9).
