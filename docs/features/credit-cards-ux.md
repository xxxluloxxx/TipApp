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

### 2.0 Header con selector de mes integrado (rediseño de esta iteración)

**Reemplaza por completo** el header estático original (`ArrowLeft` + `<h1>
Tarjetas de crédito</h1>` + `Settings`) y la fila de `Select` de mes que se
había agregado debajo como control aparte (implementación funcional pero sin
pasar por diseño — el Product Owner la sintió "desconectada", una fila de
formulario suelta debajo de un header que no la esperaba). El mecanismo de
datos **no cambia en nada** (mismo `filters.month`/`monthOptions`/`v-model`,
mismo componente `Select` de shadcn-vue) — esto es 100% un cambio de
presentación del mismo control, integrado en la barra superior en vez de
vivir en una fila propia.

**Referencia adoptada de "GastoCard"** (sección 11 la vuelve a citar): el mes
vive en el header mismo, como texto + chevron pequeño, sin caja ni borde de
campo de formulario — se descarta explícitamente de esa referencia el ícono
de notificaciones contiguo (no aplica, TipApp no tiene notificaciones).

**Decisión de jerarquía**: el mes pasa a ser el texto grande (protagonista,
mismo tamaño/peso que tenía el `<h1>` antes), y **"Tarjetas de crédito" baja
a un eyebrow chico encima, no se remueve** — sigue siendo la única pista de
"en qué sección estoy" para alguien que entra directo a `/tarjetas` (por
ejemplo, desde un ítem de drawer que resalta la ruta activa, pero sin mirar
el drawer en ese momento); quitarlo del todo ahorra una línea pero le cuesta
orientación al usuario por nada, y el layout de dos líneas (eyebrow chico +
dato grande) ya es un patrón conocido de la propia app (mismo espíritu que
"Hola, {nombre}" de Inicio) — no hace falta inventar nada nuevo.

```html
<header class="flex items-center gap-2 border-b border-border px-4 py-3 sm:gap-3 sm:px-6 sm:py-4 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>

  <div class="min-w-0 flex-1">
    <p id="cards-dashboard-eyebrow" class="truncate text-xs font-medium text-muted-foreground">
      Tarjetas de crédito
    </p>

    <Select v-model="filters.month">
      <SelectTrigger
        aria-describedby="cards-dashboard-eyebrow"
        class="!h-11 !w-fit !max-w-full !gap-1.5 !border-0 !bg-transparent !py-0 !pl-2 !pr-2 !shadow-none -ml-2 rounded-md text-xl font-semibold tracking-tight text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
      >
        <SelectValue class="truncate" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in monthOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>

  <Button variant="ghost" size="icon" aria-label="Gestionar tarjetas y personas" @click="router.push({ name: 'manage-cards' })">
    <Settings class="size-5" />
  </Button>
</header>
```

Notas de implementación (para que `vue-frontend-expert` no tenga que
adivinar ni redescubrir esto por prueba y error):

1. **Sin componente nuevo, sin ícono nuevo a importar.** Sigue siendo el
   mismo `<Select>`/`<SelectTrigger>`/`<SelectValue>`/`<SelectContent>`/
   `<SelectItem>` de `@/components/ui/select` que ya se usa en
   `CardTransactionsView.vue`, con el mismo `v-model="filters.month"` y el
   mismo `monthOptions` ya implementado (sección 1.5). El chevron **no se
   agrega a mano**: `SelectTrigger.vue` ya renderiza su propio
   `ChevronDownIcon` (`@lucide/vue`, `size-4`, `text-muted-foreground`)
   después del slot — con el trigger en `w-fit` queda pegado al texto del
   mes ("Julio 2026 ⌄"), igual que en la referencia. No hay que tocar
   `src/components/ui/select/SelectTrigger.vue` para nada de esto.
2. **Por qué las clases de override llevan `!` (important)**: el trigger
   base de shadcn-vue trae `data-[size=default]:h-9` (una variante con
   atributo, que en CSS tiene *más* especificidad que una clase suelta como
   `h-11`) y, en modo oscuro, `dark:bg-input/30`/`dark:hover:bg-input/50`
   (el relleno tipo "campo" que acá se quiere eliminar). Pasar `h-11
   border-0 bg-transparent shadow-none py-0` a secas **no garantiza** ganarle
   a esas reglas por especificidad/orden de cascada — con `!` (que Tailwind
   compila a `!important`) queda forzado sin ambigüedad, sin importar cómo
   evolucione el componente base a futuro. Ya existe indicio de este mismo
   problema sin resolver en el código actual: el `Select` de mes de
   `CardTransactionsView.vue` (sección 3.1) usa `h-11` a secas — vale la
   pena que `vue-frontend-expert` verifique con las devtools si ese trigger
   realmente mide 44px de alto o quedó en 36px por este mismo motivo, como
   chequeo rápido no bloqueante mientras toca este archivo (no es parte del
   alcance de este rediseño: ese `Select` de `CardTransactionsView.vue` sigue
   sin cambios de presentación, ver sección 3.1 y el punto 10 de
   accesibilidad más abajo).
3. **`-ml-2` + `pl-2`**: técnica estándar para que el *hit area*/fondo de
   hover del botón tenga aire horizontal (mismo padding que cualquier botón
   `ghost` de la app) sin que el texto del mes se corra visualmente a la
   derecha del eyebrow "Tarjetas de crédito" (que no tiene padding propio) —
   el margen negativo cancela el padding agregado, así ambas líneas quedan
   alineadas al mismo borde izquierdo.
4. **`data-[state=open]:bg-accent`**: mientras el `SelectContent` está
   abierto, el trigger queda con el mismo fondo `accent` que en hover/press —
   refuerza que sigue siendo un control interactivo incluso con el menú ya
   desplegado (Reka UI ya expone `data-state="open"/"closed"` de fábrica en
   `SelectTrigger`, no hay que cablear nada nuevo).
5. **`truncate` en `SelectValue` + `!max-w-full` en el trigger**: red de
   seguridad para el nombre de mes más largo en español ("Septiembre 2026",
   el peor caso de los 12) en un viewport angosto (320px) con los dos
   botones de ícono a los costados — en la inmensa mayoría de anchos no
   entra en juego, pero evita que un mes largo empuje el layout o desborde
   el header en el dispositivo más chico soportado.
6. **El resto de la vista no cambia**: la `<div v-if="hasCards">` con la fila
   `Select` de mes que existía debajo del header (`flex gap-2 overflow-x-auto
   px-4 py-3 ...`) **se elimina** — el filtro de mes vive ahora únicamente en
   el header. Todo lo demás (hero de total, dona, ranking de tarjetas,
   estados de carga/vacío/error) sigue igual, sección 2.1 en adelante.

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

**Sin cambios respecto al rediseño de la sección 2.0.** El header con el mes
integrado (texto grande + chevron, sin caja) es específico del dashboard
(`/tarjetas`), que solo filtra por mes y es la puerta de entrada a la
sección — acá en cambio hay **tres** filtros combinables (mes + tarjeta +
persona) en una fila horizontal, y ahí el `Select` tradicional (con borde,
trigger tipo campo) es justamente lo correcto: comunica "esto es un
selector entre varios controles equivalentes", no "el título de la
pantalla". No se toca esta fila ni su presentación.

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

**Rediseño de esta iteración** (pedido explícito del Product Owner, referencia
visual: mockup de tarjeta "JEP" verde de otra app — mismo criterio de la
sección 11, se adopta la *estructura* visual, no la marca). Alcance acotado a
**este archivo únicamente**: `CardDetailView.vue`. Ningún otro dato deja de
medirse — `cardMonthTotal`, `limitProgress`, `personDonutSlices`,
`averageExpense`, `maxExpense` y el array `monthExpenses` siguen siendo
exactamente los mismos computeds/queries de la sección 4.1-4.4 previa a esta
iteración, solo cambia cómo se presentan. Confirmación explícita de impacto:
**`CardsDashboardView.vue`, `CardTransactionsView.vue`, `ManageCardsView.vue` y
`src/lib/charts.ts` no se tocan** — todo lo que este rediseño reusa
(`readableTextColor`, `withAlpha`, `COLOR_SWATCHES`, `formatExpenseDateHeading`,
`CategoryDonutChart`, el componente `Badge` ya instalado en Fase 1) ya existe
tal cual hoy, sin necesidad de extender ni modificar ningún helper compartido.

Header: se simplifica a solo `ArrowLeft` (vuelve a `/tarjetas`) **sin** el
`<h1>` de nombre que tenía antes — el nombre + últimos 4 dígitos de la tarjeta
pasan a vivir en el mini-visual del hero (sección 4.1.2), y repetirlo también
en el header sería redundante apenas se hace scroll un pixel. La ruta de
vuelta no cambia.

### 4.1 Hero: color propio de la tarjeta, mini-visual, monto y progreso

#### 4.1.1 Fondo del hero: tinte suave, no color sólido pleno — decisión con números

La referencia usa un verde sólido pleno de fondo con texto blanco encima. Se
evaluó reproducirlo literal (`backgroundColor: card.color` a opacidad 100% +
`readableTextColor(card.color)` para el texto) y **se descartó**: se corrió la
misma fórmula de contraste WCAG que ya usa `readableTextColor` (luminancia
relativa + ratio) contra los 10 hex de `COLOR_SWATCHES` (sección 6.2, la
paleta real y completa de `credit_cards.color`), y **4 de los 10 no alcanzan
ni el umbral relajado de "texto grande" (3:1)** con su mejor opción de texto
(blanco o `#111827`): Naranja `#f97316` (2.80:1), Celeste `#06b6d4` (2.43:1),
Verde azulado `#14b8a6` (2.49:1), Verde `#22c55e` (2.28:1). Otros 3 pasan el
umbral de texto grande pero no el de texto normal 4.5:1 (Azul 3.68:1, Rojo
3.76:1, Rosa 3.53:1). Solo Amarillo (9.25:1), Gris (4.83:1) y, por poco,
Violeta (4.23:1) pasarían holgado. Como el usuario elige el color de su
tarjeta libremente entre los 10 swatches (no hay forma de excluir opciones "de
riesgo" sin contradecir `credit-cards-ux.md` sección 6.2, que ya fija esa
paleta como cerrada), **un fondo sólido pleno no puede garantizarse legible
para el 100% de los casos reales** — violaría el principio de a11y ya vigente
en todo el proyecto (`design-system.md` sección 5, "contraste AA verificado").

**Decisión**: el `Card` del hero usa el mismo patrón de tinte que ya
está shippeado en `CardsDashboardView.vue` para las filas de "Tus tarjetas"
(sección 2.3) — `:style="{ backgroundColor: withAlpha(card.color, 0.16) }"`
sobre la superficie neutra del `Card`, **sin tocar ningún color de texto**:
`CardDescription`/`CardTitle`/el párrafo de disclaimer se quedan en sus tokens
normales (`text-muted-foreground`/foreground por defecto de `Card`). Esto no
es una concesión visual menor: es la razón por la que la solución es segura
sin cálculo adicional por swatch — un tinte al 16% de opacidad sobre el fondo
neutro del tema apenas corre la luminancia de esa superficie, así que el
contraste ya verificado de los tokens de texto del design system contra
`bg-card` se mantiene, en los dos temas, sin excepción y sin overrides de
color de texto por elemento. `readableTextColor(card.color)` se reserva
**únicamente** para el ícono dentro del chip sólido del mini-visual (sección
4.1.2, superficie pequeña y ya con precedente shippeado, ver nota de alcance
ahí) — nunca para texto de párrafo/título.

Se prioriza "sigue siendo un componente TipApp reconocible, con toque de color
de marca de la tarjeta" por sobre "réplica exacta del bloque sólido de la
referencia" — mismo criterio que ya aplicó esta feature en otros puntos (p.
ej. sección 11, "se adopta el patrón, no el pixel exacto").

#### 4.1.2 Mini-visual de la tarjeta (ícono + nombre + últimos 4 dígitos)

Arriba a la izquierda del hero, como en la referencia — mismo tratamiento
exacto de chip que ya usa `CardsDashboardView.vue` (sección 2.3: chip
`size-10` `rounded-lg` con `backgroundColor: card.color` sólido +
`CreditCardIcon` coloreado vía `readableTextColor(card.color)`), sin
inventar un ícono ni un tamaño nuevo — la única diferencia es que ahora convive
con un fondo tinted en vez de neutro, lo cual no cambia nada del chip en sí
(sigue siendo su propio recuadro sólido, con su propio contraste ya evaluado
en la iteración de tarjetas original).

```html
<Card :style="{ backgroundColor: withAlpha(card.color, 0.16) }">
  <CardHeader class="gap-4">
    <div class="flex items-center gap-3">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg"
        :style="{ backgroundColor: card.color ?? 'hsl(var(--muted))' }"
      >
        <CreditCardIcon class="size-4.5" :style="{ color: readableTextColor(card.color) }" />
      </span>
      <div class="flex min-w-0 flex-col">
        <p class="truncate text-sm font-semibold">{{ card.name }}</p>
        <p class="truncate text-xs text-muted-foreground">•••• {{ card.lastFourDigits }}</p>
      </div>
    </div>

    <div>
      <CardDescription>Total en {{ monthLabel }}</CardDescription>
      <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
        <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(cardMonthTotal) }}
      </CardTitle>
    </div>
  </CardHeader>

  <div v-if="card.suggested_monthly_limit" class="flex flex-col gap-1.5 px-6 pb-6">
    <div class="h-2 overflow-hidden rounded-full bg-muted">
      <div
        class="h-full rounded-full transition-[width]"
        :class="limitBarColorClass"
        :style="{ width: `${Math.min(limitProgress, 100)}%` }"
      />
    </div>
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>Límite mensual (sugerido): ${{ formatAmount(cardMonthTotal) }} / ${{ formatAmount(card.suggested_monthly_limit) }}</span>
      <span>{{ limitAvailableLabel }}</span>
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

Enmascarado de dígitos con el mismo criterio ya vigente (sección 10, punto 8):
`"•••• {4 dígitos}"` es texto real, no solo un ícono — un lector de pantalla
lo anuncia completo.

#### 4.1.3 "% del total del mes" — se omite, decisión consciente

La referencia muestra un `%` del total general junto al monto de la tarjeta.
Hoy esta vista **no trae** ese dato: `monthExpenses` (sección 4.4) está
filtrado por `card_id = :id`, mientras que el total general de todas las
tarjetas del mes solo lo calcula `CardsDashboardView.vue` a partir de *su
propio* fetch sin filtro de tarjeta. Mostrarlo acá exigiría una tercera query
(`cardExpensesStore.fetchByDateRange` del mismo mes, sin `cardId`) sumada a las
2 que esta vista ya dispara en paralelo (`Promise.all` de sección 4, mes +
recientes) — **se decide no agregarla**, por tres motivos concretos:

1. El hero ya comunica el número más accionable para "estoy mirando el
   detalle de una tarjeta puntual": cuánto gasté en *esta* tarjeta este mes,
   en pesos. El `%` del total general es un dato de *comparación entre
   tarjetas*, que es exactamente la pregunta que ya resuelve el dashboard
   (`CardsDashboardView.vue` sección 2.3, `card.percentLabel`) — duplicarlo
   acá no agrega una decisión nueva que el usuario pueda tomar desde el
   detalle.
2. Una tercera query solo para un dato secundario en una pantalla que ya
   prioriza velocidad de carga (ver sección 1.4, "por qué no traer todo") no
   se justifica por fidelidad visual pura a la referencia.
3. Es reversible sin costo de migración de datos si a futuro se decide que sí
   vale la pena: no requiere ningún cambio de esquema, solo agregar la query
   client-side.

Si una futura iteración lo pide explícitamente, la ruta de menor esfuerzo es
que `CardsDashboardView.vue` calcule y **cachee** el total general del mes
vigente en un store (no en el detalle) y que `CardDetailView.vue` lo lea de
ahí si ya está en memoria — evita la query duplicada en la mayoría de las
navegaciones reales (usuario entra por el dashboard antes de tocar una
tarjeta).

`limitAvailableLabel` es un computed **nuevo**, 100% derivado de
`limitProgress` ya existente (sin ningún dato ni query nueva):

```ts
const limitAvailableLabel = computed(() => {
  if (limitProgress.value <= 100) return `${Math.round(100 - limitProgress.value)}% disponible`
  return `Superado por ${Math.round(limitProgress.value - 100)}%`
})
```

#### 4.1.4 Barra de progreso + copy del límite: reformateado, disclaimer intacto

- Copy nuevo: `"Límite mensual (sugerido): $usado / $límite"` (antes
  `"Límite mensual sugerido: $Y"` sin mostrar el usado en esa misma línea —
  el usado ya estaba arriba en el hero, pero repetirlo acá al lado del límite
  deja la comparación "gasté esto de esto otro" en un solo golpe de vista, más
  cerca de la referencia) + `limitAvailableLabel` (`"Z% disponible"` o, si se
  superó, `"Superado por Z%"` en vez de un `%` negativo sin explicar qué
  significa un número bajo cero).
- **El párrafo de disclaimer se mantiene literal, sin acortar** ("Este límite
  es solo una referencia que vos definiste, no un límite real de tu tarjeta ni
  de tu banco."). Fue una decisión de a11y/confianza tomada en la iteración
  original de Tarjetas para evitar que un usuario confunda esta barra con un
  límite de crédito real del banco — nada de este rediseño cambia esa
  realidad (`suggested_monthly_limit` sigue siendo 100% definido por el
  usuario, sin ninguna validación bancaria detrás), así que la garantía sigue
  haciendo exactamente la misma falta que antes. Acortarlo ahorraría una línea
  de espacio vertical, pero el riesgo de que se lea como "límite real" ya se
  evaluó una vez y no hay ningún dato nuevo que justifique reabrir esa
  decisión — se prioriza consistencia de confianza sobre densidad visual.
- `limitProgress`/`limitBarColorClass` (color semántico de la barra:
  `bg-primary`/`bg-warning`/`bg-destructive`) **no cambian** — siguen siendo
  los mismos computeds ya validados en la iteración original, con la barra
  visualmente cappeada a 100% de ancho aunque el número real supere eso.
- Si `suggested_monthly_limit` es `null`: mismo comportamiento que antes (sin
  barra, invitación de una línea a "Definir uno").

### 4.2 Dona de gasto por persona (dentro de esta tarjeta) — sin cambios

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

### 4.3 "Movimientos recientes" + "Ver todos" — nuevo layout de fila (fecha + avatar de persona)

Sigue siendo, sin cambios de datos: últimos 5 `card_expenses` de esta
tarjeta, **sin** filtrar por mes vigente (a propósito: "recientes" es una
noción de actualidad, no de mes calendario — si el usuario no gastó nada este
mes pero sí la semana pasada del mes anterior, sigue siendo información
"reciente" relevante). Misma query dedicada de siempre:
`.eq('card_id', id).order('expense_date', {ascending:false}).order('created_at', {ascending:false}).limit(5)`
— el `limit(5)` sigue seguro porque el propósito es literalmente "los últimos
5" (mismo argumento que sección 1.2).

**Lo que cambia es el layout de cada fila**, para incorporar los dos datos que
pide la referencia y que hoy faltan (fecha corta y un ícono líder) sin
inventar nada nuevo: la fecha ya existe en `expense.expenseDate` y ya hay un
formatter listo (`formatExpenseDateHeading`, el mismo que usa la sección 3.2
para las filas de `CardTransactionsView` — "Hoy"/"Ayer"/`"20 de abril"`, sin
necesidad de un formato corto adicional tipo "20 abr." que obligaría a escribir
una función nueva en `src/lib/date.ts` solo por fidelidad cosmética). El
ícono líder **es el avatar de persona**, no un ícono decorativo nuevo sin
precedente: mismo patrón exacto que "Top personas" del dashboard (sección
2.4) — círculo `size-9` con `background: person.color` + `User` vía
`readableTextColor(person.color)`, o círculo `bg-muted` + `User` en
`text-muted-foreground` si el gasto no tiene persona asignada. Se sube de
`size-6` (usado en la barra de ranking, donde conviven con una barra de
progreso angosta) a `size-9` porque acá el avatar es el elemento líder de la
fila, no un ítem secundario de una lista de ranking — necesita más presencia
visual para funcionar como "miniatura" al estilo de la referencia.

Con 4 datos por fila ahora (avatar, descripción, persona, fecha, monto, más
el badge opcional de cuota — 6 en total), una sola línea ya no alcanza sin
truncar agresivamente. Layout de **2 líneas** dentro de la fila, con la
jerarquía "qué fue" antes que "quién/cuándo" (igual que el resto de la app: la
descripción es siempre el dato principal de una fila de gasto, nunca la
persona ni la fecha):

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
  <div class="flex flex-col">
    <template v-for="(expense, idx) in recentExpenses" :key="expense.id">
      <Separator v-if="idx > 0" />
      <div class="flex items-start gap-3 px-4 py-3">
        <span
          v-if="expense.person?.color"
          class="flex size-9 shrink-0 items-center justify-center rounded-full"
          :style="{ background: expense.person.color }"
        >
          <User class="size-4" :style="{ color: readableTextColor(expense.person.color) }" />
        </span>
        <span v-else class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <User class="size-4 text-muted-foreground" />
        </span>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-start justify-between gap-2">
            <p class="truncate text-sm font-medium">{{ expense.description || card.name }}</p>
            <p class="shrink-0 text-sm font-semibold tabular-nums">${{ formatAmount(expense.amount) }}</p>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="truncate text-xs text-muted-foreground">
              {{ expense.person?.name ?? 'Sin persona asignada' }} · {{ formatExpenseDateHeading(expense.expenseDate) }}
            </span>
            <Badge
              v-if="expense.installmentTotal"
              variant="secondary"
              class="shrink-0 px-1.5 py-0 text-[10px] tabular-nums"
            >
              {{ expense.installmentNumber }}/{{ expense.installmentTotal }}
            </Badge>
          </div>
        </div>
      </div>
    </template>
  </div>
</Card>
```

- **Badge de cuotas, ahora un `Badge` real** (ya instalado desde Fase 1, sin
  agregar nada) en vez del texto plano `"N/M"` que usaba el layout anterior —
  se ubica al final de la 2ª línea (junto a persona+fecha), nunca compitiendo
  con el monto de la 1ª línea, que sigue siendo el dato más prominente de la
  fila.
- Sigue **sin** menú `⋮` (solo lectura, mismo criterio que "Transacciones
  recientes" de Inicio) — el avatar no es un control, es puramente
  informativo, así que no aplica ningún mínimo táctil sobre él (no es un
  target independiente; la fila entera no navega a ningún lado en este
  listado, igual que antes).
- Nota de a11y heredada, no nueva de esta iteración: el mismo patrón de
  avatar-con-ícono-sobre-color-sólido ya existe hoy en "Top personas"
  (sección 2.4) sin haber sido señalado como bloqueante — se reusa tal cual
  acá por consistencia, no se introduce un problema nuevo. Si a futuro se
  decide reforzar el contraste de ese ícono (p. ej. agregando un borde de 1px
  o un halo), debería resolverse una sola vez para los dos consumidores
  (dashboard + detalle), no de forma aislada en esta vista.

`CardTransactionsView` lee `route.query.cardId` en `onMounted` y preselecciona
ese filtro de tarjeta (mismo patrón de query param ya usado para `?new=1` en
`dashboard-redesign-ux.md` sección 3.4) — **sin cambios**, ese comportamiento
no depende del layout de fila.

### 4.4 Resumen de la tarjeta (cantidad, promedio, mayor gasto) — tinte leve para cerrar el "marco de color" del detalle

Derivado **sin queries adicionales**, del mismo array ya traído para el
hero del mes (sección 4.1) — eficiencia deliberada, un solo query sirve
para 4 números (total, cantidad, promedio, máximo). Los 3 números en sí **no
cambian**.

Se agrega un tinte del color de la tarjeta, más sutil que el del hero (`0.08`
de opacidad en vez de `0.16`), en vez de dejar esta `Card` neutra/blanca:

```html
<Card :style="{ backgroundColor: withAlpha(card.color, 0.08) }">
  <CardHeader><CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resumen del mes</CardTitle></CardHeader>
  <div class="grid grid-cols-3 gap-2 px-6 pb-6 text-center">
    <div><p class="text-lg font-semibold tabular-nums">{{ monthExpenses.length }}</p><p class="text-xs text-muted-foreground">Transacciones</p></div>
    <div><p class="text-lg font-semibold tabular-nums">${{ formatAmount(averageExpense) }}</p><p class="text-xs text-muted-foreground">Promedio</p></div>
    <div><p class="text-lg font-semibold tabular-nums">${{ formatAmount(maxExpense) }}</p><p class="text-xs text-muted-foreground">Mayor gasto</p></div>
  </div>
</Card>
```

- **Justificación de por qué sí vale la pena** (a diferencia de dejarlo
  neutro, que también era una opción válida): en la referencia, el color de
  la tarjeta "enmarca" toda la pantalla de detalle, no solo el hero — sin
  ningún tinte acá, esta `Card` quedaría como un bloque blanco/neutro
  encajonado entre dos elementos de color (hero arriba, nada abajo salvo los
  botones de acción), rompiendo esa sensación de "esta pantalla completa es
  sobre *esta* tarjeta". El costo de agregarlo es mínimo: es el mismo
  `withAlpha` ya usado en el hero, solo con un segundo valor de opacidad, sin
  ningún cálculo ni helper nuevo.
- **Por qué un alpha más bajo que el hero, no el mismo**: mantiene la
  jerarquía visual correcta — el hero es la afirmación de color más fuerte de
  la pantalla (es, literalmente, el dato principal), el resumen es
  información secundaria de apoyo. Iguales opacidades harían que ambos
  bloques compitan por la misma atención.
- Mismo argumento de la sección 4.1.1 sobre por qué esto es seguro sin
  verificar contraste por swatch: a esta opacidad, el texto sigue en sus
  tokens normales (`text-muted-foreground` para las etiquetas, foreground por
  defecto para los números) sin ningún override de color.
- La dona (4.2) y las acciones (4.5) se quedan neutras, sin tinte — no forman
  parte del pedido explícito del Product Owner y no hay una razón de
  jerarquía tan clara para tocarlas (la dona ya usa color por persona en sus
  propios slices; teñir su `Card` contenedora competiría visualmente con esos
  colores).

`averageExpense = cardMonthTotal / monthExpenses.length` (con guard
`monthExpenses.length === 0` → mostrar `$0,00`, no `NaN`).

### 4.5 Acciones: "Editar tarjeta" / "+ Nuevo gasto" — sin cambios

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
   `limitAvailableLabel` en texto (sección 4.1.4); barra de "Top personas"
   siempre con nombre + `%` en texto (sección 2.4); persona sin color propio
   nunca queda "sin ningún indicador" (ícono `User` en el swatch neutro,
   sección 6.3, y en el avatar de "Movimientos recientes" del detalle,
   sección 4.3).
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
10. **Selector de mes del header (sección 2.0) reconocible como interactivo
    sin caja/borde**: no depende solo del chevron (que además cambia de
    color/fondo, no solo de forma) — `hover:bg-accent`/
    `data-[state=open]:bg-accent` dan un fondo perceptible al pasar el mouse
    o al abrir el listado (mismo token `accent` que ya usan los ítems del
    drawer y las filas de `DebtsDashboardView.vue`), y
    `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
    da foco visible por teclado, igual que cualquier otro control de la app
    — nunca solo "el texto es clickeable porque sí". Altura forzada a `44px`
    (`!h-11`) para cumplir el mínimo táctil aunque el contenido de texto
    solo mida ~28px de alto a `text-xl`. `aria-describedby` conecta el
    trigger con el eyebrow "Tarjetas de crédito" para que un lector de
    pantalla anuncie el contexto de sección además del mes seleccionado.
11. **Fondo de color como tinte, nunca como color sólido pleno detrás de
    texto** (rediseño de `CardDetailView.vue`, sección 4.1.1): se verificó con
    la misma fórmula de contraste WCAG que usa `readableTextColor` que un
    fondo sólido pleno de `card.color` no garantiza AA para el 100% de los 10
    swatches de `COLOR_SWATCHES` (4 no llegan ni al umbral relajado de texto
    grande, 3 más no llegan al de texto normal) — por eso el hero y el
    resumen del mes usan `withAlpha(card.color, 0.16 / 0.08)` sobre la
    superficie neutra, dejando el texto en sus tokens normales
    (`text-muted-foreground`/foreground), nunca en `readableTextColor` sobre
    esos fondos. `readableTextColor` se sigue usando, sin cambios, solo para
    íconos sobre chips/avatares de color sólido pequeños (mini-visual de
    tarjeta, avatar de persona) — superficie no textual, con precedente ya
    shippeado en `CardsDashboardView.vue` antes de esta iteración.

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
  alcance, no hay sistema de notificaciones). Aclaración de esta iteración
  (rediseño del selector de mes, sección 2.0): sí se adopta de esa misma
  referencia el patrón de "mes + chevron integrado en el header, sin caja de
  formulario" — lo que se descarta es únicamente el ícono de notificaciones
  contiguo a ese selector, no el patrón de header en sí.
- **Barra de búsqueda (ícono lupa)** y el control **"Ordenar por: Tarjeta"**
  del listado de transacciones — no forman parte del encargo (que pide
  específicamente filtros de mes/tarjeta/persona y agrupado por tarjeta, sin
  mencionar búsqueda ni un criterio de orden alternativo); se excluyen para
  no ampliar el alcance sin pedido explícito. Si a futuro se necesitan,
  agregarlos es una extensión incremental simple sobre esta base.
- **Avatar/foto de persona** — ya decidido explícitamente por el Product
  Owner (sección 6.3): solo nombre + color opcional, sin Storage.
- **Fondo sólido pleno del color de la tarjeta en el hero de detalle**
  (referencia "JEP" verde, rediseño de esta iteración, sección 4.1.1) — no
  pasa el umbral de contraste WCAG para 4 de los 10 swatches reales de
  `COLOR_SWATCHES`; se adopta el tinte de color (16%/8% de opacidad), no el
  bloque sólido pleno.
- **"% del total del mes" junto al monto del hero de detalle** (sección
  4.1.3) — se difiere de forma consciente, no por ser inviable sino porque
  exigiría una tercera query en una vista que ya prioriza carga rápida, y el
  dato de comparación entre tarjetas ya vive en el dashboard
  (`CardsDashboardView.vue` sección 2.3).

---

## 12. Fechas de corte y pago (`statement_cutoff_day` / `payment_due_day`)

Sección nueva, pedido explícito del Product Owner (sin captura de referencia
esta vez, texto literal): "Las tarjetas de crédito tienen una fecha de corte
y una de pago, eso también quiero que se guarde por cada tarjeta y que se
muestre en las vistas, los lugares más importantes o donde sí debería ir."
Dato de modelo ya fijado por `supabase-backend-expert` en paralelo:
`credit_cards.statement_cutoff_day`/`payment_due_day`, ambas `int` 1-31,
**nullable**, **puramente informativas** (sin cálculo server-side ni cron).
Este documento no rediscute ese modelo, solo especifica UX/frontend sobre él.

### 12.0 Por qué esto NO es un segundo `fixed_expenses.payment_day`

El precedente de estilo más cercano en el proyecto es
`fixed_expenses.payment_day` (`FixedExpenseStatusBadge.vue`/
`fixedExpenses.ts`), que también deriva un estado "Vencido" 100%
client-side comparando un día del mes contra hoy. **Se descarta reusar esa
semántica de "Vencido" acá, a propósito**: `fixed_expenses` tiene una
instancia mensual real con estado `pending`/`paid` — "Vencido" ahí significa
"pendiente Y ya pasó el día", un hecho verificable porque el sistema sabe si
se pagó o no. `statement_cutoff_day`/`payment_due_day` de una tarjeta **no
tienen ningún instance/ledger asociado** (son solo dos enteros sueltos en
`credit_cards`, sin tabla hija) — el sistema no tiene forma de saber si el
usuario ya pagó su resumen este mes o no. Mostrar "Vencido" acá sería
**inventar un estado que no se puede verificar**, el mismo tipo de riesgo
que ya evitó este documento al no reproducir el fondo sólido pleno sin
contraste garantizado (sección 4.1.1) o el `%` del total sin query real
(sección 4.1.3): no se afirma un dato que no se puede respaldar.

**En su lugar**, ambas fechas se tratan siempre como "próxima ocurrencia"
(la próxima vez que ese día del mes ocurre, incluyendo hoy mismo, nunca una
fecha pasada) — un dato que sí es 100% derivable sin necesitar tracking de
pago. Se agrega un tono de urgencia (no "vencido") únicamente sobre el **día
de pago** cuando falta muy poco (hoy/mañana/≤3 días) — ver 12.4 — porque es
el dato con consecuencia real si se ignora (mora/intereses), a diferencia
del día de corte, que es un hecho de calendario neutro (cuándo cierra el
resumen), no algo que el usuario pueda "llegar tarde" a cumplir.

### 12.1 Decisión 1 — dato crudo vs. calculado: **híbrido, según el contexto**

No alcanza con elegir uno solo — cada contexto de la app le hace una
pregunta distinta al usuario:

- **Listas de gestión/comparación** (gestión de tarjetas, ranking del
  dashboard): la pregunta es "¿qué tarjeta es cuál/cómo la configuré?" — ahí
  el dato **crudo** ("Corte: día 15") es más rápido de escanear en una fila
  entre varias, y no exige hacer ningún cálculo mental de fecha.
- **Detalle de una tarjeta puntual** (`CardDetailView`): la pregunta es "¿qué
  tengo que hacer con *esta* tarjeta y cuándo?" — ahí sí vale la pena la
  fecha **calculada** ("15 de agosto · en 12 días"), porque es exactamente el
  tipo de dato accionable que le importa a alguien mirando una tarjeta en
  particular (el propio encargo lo remarca: "cuánto falta" es relevante para
  un usuario de tarjetas de crédito).

Se crean **4 funciones puras nuevas en `src/lib/date.ts`** (sin cambios a
las ya existentes) para soportar el cálculo, siguiendo el mismo criterio de
"función pura, sin dependencias de Pinia" que ya usa todo ese archivo:

```ts
/** Último día del mes calendario de `reference` (para clampear un día de mes
 * en meses cortos, ej. día 31 en febrero). Mismo criterio ya usado por
 * `lastDayOfMonth`/`effectiveDueDay` de `src/stores/fixedExpenses.ts` —
 * **duplicada acá a propósito, no importada desde ese store**: `date.ts` es
 * una capa compartida sin dependencias de Pinia, y esas dos funciones son
 * privadas del módulo `fixedExpenses.ts` (no exportadas), así que no hay
 * nada que importar sin tocar ese store ya shippeado. Si a futuro un tercer
 * consumidor necesita esto mismo, ahí sí vale la pena que `fixedExpenses.ts`
 * pase a importar esta versión de `date.ts` en vez de mantener la suya — no
 * se hace ahora, fuera de alcance de este encargo. */
export function lastDayOfMonth(reference: Date): number {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate()
}

/**
 * Próxima ocurrencia real de un "día del mes" (1-31) a partir de `reference`
 * — **siempre hoy o en el futuro, nunca una fecha pasada**.
 *
 * Casos borde (todos verificados a mano con fechas de calendario reales):
 * - **El día ya pasó este mes** (ej. hoy 20, día pedido 15): devuelve el 15
 *   del **mes siguiente**.
 * - **El día es HOY**: devuelve HOY, no salta al mes que viene — a
 *   propósito, para poder mostrar "Hoy" en vez de saltarse de largo un
 *   vencimiento real de hoy mismo (ver 12.4, el caso más urgente posible).
 * - **Mes más corto que el día pedido** (ej. día 31 en un febrero de 28/29
 *   días): se clampea a `lastDayOfMonth` tanto para decidir si "ya pasó" en
 *   el mes actual como para el resultado del mes siguiente — mismo criterio
 *   exacto que `effectiveDueDay` de `fixedExpenses.ts`.
 */
export function nextMonthlyOccurrence(day: number, reference: Date = new Date()): Date {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const thisMonthDay = Math.min(day, lastDayOfMonth(today))
  const thisMonthOccurrence = new Date(today.getFullYear(), today.getMonth(), thisMonthDay)
  if (thisMonthOccurrence.getTime() >= today.getTime()) return thisMonthOccurrence

  const nextMonthRef = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  const nextMonthDay = Math.min(day, lastDayOfMonth(nextMonthRef))
  return new Date(nextMonthRef.getFullYear(), nextMonthRef.getMonth(), nextMonthDay)
}

/** Días de diferencia (siempre `>= 0` cuando `date` viene de
 * `nextMonthlyOccurrence`), ambos normalizados a medianoche local. */
export function daysUntil(date: Date, reference: Date = new Date()): number {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

/** Etiqueta corta de "cuánto falta": `0` → `"Hoy"`, `1` → `"Mañana"`, resto
 * → `"En N días"`. Asume `days >= 0` (siempre cierto viniendo de
 * `nextMonthlyOccurrence` + `daysUntil`, nunca se le pasa un negativo). */
export function formatDaysUntilLabel(days: number): string {
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  return `En ${days} días`
}

/** Fecha corta con mes abreviado, sin año (ej. `"15 ago"`). **No reusa**
 * `formatDateChip` (que ya existe en este archivo) porque esa función recibe
 * un `date` crudo de Postgres (`string` `"YYYY-MM-DD"`), mientras que acá el
 * insumo ya es un `Date` calculado por `nextMonthlyOccurrence` — mismo
 * array `MONTHS_ES` reusado, sin duplicar la lista de meses. */
export function formatShortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_ES[date.getMonth()]?.slice(0, 3) ?? ''}`
}
```

### 12.2 Decisión 2 — dónde mostrarlo

**A. `ManageCardsView.vue` (sección 6.2, fila de "Tus tarjetas") — dato
crudo, mismo patrón exacto que "Límite: $X" ya shippeado.** Es la pantalla
de metadata/gestión de la tarjeta (ya muestra color, últimos 4 dígitos y
límite sugerido en esa misma línea), el lugar más natural para un dato de
configuración crudo. Extensión trivial del `<p>` ya existente
(`src/views/ManageCardsView.vue`, la línea que ya compone `•••• {digits} ·
Límite: $X`):

```html
<p class="truncate text-xs text-muted-foreground">
  •••• {{ card.last_four_digits }}
  <span v-if="card.suggested_monthly_limit"> · Límite: ${{ formatAmount(card.suggested_monthly_limit) }}</span>
  <span v-if="card.statement_cutoff_day"> · Corte: día {{ card.statement_cutoff_day }}</span>
  <span v-if="card.payment_due_day"> · Pago: día {{ card.payment_due_day }}</span>
</p>
```

Cada segmento es independiente (`v-if` propio) — con solo uno de los dos
cargado, se muestra únicamente ese; con ninguno, no se agrega nada a la
línea (mismo criterio ya usado para `suggested_monthly_limit` en esa misma
línea, sección 12.3 de este documento vuelve sobre el caso "nada cargado").

**B. `CardsDashboardView.vue` (sección 2.3, ranking "Tus tarjetas") — sin
dato crudo, solo un badge de urgencia condicional.** Se decide **no**
agregar "Corte: día X / Pago: día Y" a esta lista: es una vista de
*comparación de gasto entre tarjetas* (swatch + nombre + total + % del
total), agregar dos datos de calendario más la volvería más difícil de
escanear de un vistazo sin aportar a la pregunta que esa fila ya responde
bien. En cambio, **si el pago está a 3 días o menos**, se agrega un `Badge`
chico (mismo componente ya instalado, mismo patrón `variant="outline"` +
ícono que `FixedExpenseStatusBadge.vue`) debajo del nombre/últimos 4 dígitos
— justificado porque el dashboard es la puerta de entrada de la sección, y
"tu tarjeta X vence mañana" es exactamente el tipo de alerta que amerita
aparecer en el primer vistazo, no solo si el usuario entra al detalle de esa
tarjeta puntual. Si faltan más de 3 días (o no hay `payment_due_day`
cargado), no se muestra nada — no se fuerza el dato cuando no es urgente.

```html
<div class="flex min-w-0 flex-1 flex-col gap-0.5">
  <p class="truncate text-sm font-medium">{{ card.name }}</p>
  <p class="text-xs text-muted-foreground">•••• {{ card.lastFourDigits }}</p>
  <Badge
    v-if="card.paymentUrgency"
    variant="outline"
    class="w-fit gap-1 text-[10px]"
    :class="card.paymentUrgency.colorClass"
  >
    <component :is="card.paymentUrgency.icon" class="size-3" />
    {{ card.paymentUrgency.label }}
  </Badge>
</div>
```

`cardsRanking` (computed ya existente en `CardsDashboardView.vue`, sección
2.3) agrega un campo nuevo `paymentUrgency` por tarjeta:

```ts
import { AlertCircle, Clock } from '@lucide/vue'
import { daysUntil, formatDaysUntilLabel, nextMonthlyOccurrence } from '@/lib/date'

// Distinto de `formatDaysUntilLabel` (12.1): esa función da "Hoy"/"Mañana"/
// "En N días" a secas, pensada para un contexto que YA tiene un título
// ("Próximo pago") encima (sección 12.2.C). Acá el badge vive solo, sin
// ningún encabezado que le dé contexto de "esto es sobre el pago" — por
// eso arma su propio label autodescriptivo ("Pago vence hoy"), a propósito
// no delegado a `formatDaysUntilLabel`.
function buildPaymentUrgency(paymentDueDay: number) {
  const days = daysUntil(nextMonthlyOccurrence(paymentDueDay))
  if (days > 3) return null
  const label = days === 0 ? 'Pago vence hoy' : days === 1 ? 'Pago vence mañana' : `Pago vence en ${days} días`
  return {
    label,
    colorClass: days === 0 ? 'text-destructive' : 'text-warning',
    icon: days === 0 ? AlertCircle : Clock,
  }
}

// dentro del `.map()` ya existente de `cardsRanking`:
paymentUrgency: card.payment_due_day ? buildPaymentUrgency(card.payment_due_day) : null,
```

`AlertCircle`/`Clock` ya se usan en el proyecto (`FixedExpenseStatusBadge.vue`,
`MatchFormSheet.vue`) — mismo paquete `@lucide/vue`, nada que instalar.
`text-warning`/`text-destructive` son tokens ya vigentes (`CouponCard.vue`,
`LoanDebtorFormSheet.vue`, `limitBarColorClass` de esta misma feature) — sin
inventar color nuevo.

**C. `CardDetailView.vue` — fecha calculada, `Card` nueva propia (sección
4.1.5, entre el hero de 4.1 y la dona de personas de 4.2).** Se descarta
meterlo dentro del hero (ya carga chip+nombre+total+barra de límite, sección
4.1 completa) o dentro de la grilla "Resumen del mes" (sección 4.4: esa
grilla es sobre estadísticas de gasto del mes —transacciones/promedio/mayor
gasto—, corte y pago son metadata de la tarjeta en sí, un eje de información
distinto que no debería mezclarse ahí). En cambio, una `Card` nueva y chica,
inmediatamente después del hero, con el mismo tratamiento de tinte de color
ya usado en "Resumen del mes" (sección 4.4: `withAlpha(card.color, 0.08)`,
la opacidad "secundaria" de la escala ya establecida en 4.1.1/4.4) — refuerza
que sigue siendo información de *esta* tarjeta sin competir visualmente con
el hero:

```html
<!-- Sección 12.2.C (nueva): entre el hero (4.1) y la dona de personas (4.2) -->
<Card v-if="card.statement_cutoff_day || card.payment_due_day" :style="{ backgroundColor: withAlpha(card.color, 0.08) }">
  <CardHeader>
    <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Fechas de corte y pago
    </CardTitle>
  </CardHeader>
  <div class="grid gap-3 px-6 pb-6" :class="card.statement_cutoff_day && card.payment_due_day ? 'grid-cols-2' : 'grid-cols-1'">
    <div v-if="card.statement_cutoff_day" class="flex flex-col gap-0.5">
      <p class="text-xs text-muted-foreground">Próximo corte</p>
      <p class="text-sm font-semibold tabular-nums">{{ nextCutoffLabel }}</p>
      <p class="text-xs text-muted-foreground">{{ nextCutoffDaysLabel }}</p>
    </div>
    <div v-if="card.payment_due_day" class="flex flex-col gap-0.5">
      <p class="text-xs text-muted-foreground">Próximo pago</p>
      <p class="text-sm font-semibold tabular-nums">{{ nextPaymentLabel }}</p>
      <p class="flex items-center gap-1 text-xs font-medium" :class="paymentUrgencyClass">
        <component :is="paymentUrgencyIcon" v-if="paymentUrgencyIcon" class="size-3" />
        {{ nextPaymentDaysLabel }}
      </p>
    </div>
  </div>
</Card>
<p v-else class="text-xs text-muted-foreground">
  No definiste las fechas de corte ni de pago de esta tarjeta.
  <button type="button" class="font-medium text-primary underline-offset-2 hover:underline" @click="openEditCard">
    Definirlas
  </button>
</p>
```

Computeds nuevos en `CardDetailView.vue` (sin queries nuevas — 100% derivado
de `card.statement_cutoff_day`/`card.payment_due_day`, ya en memoria vía
`creditCardsStore`):

```ts
import { AlertCircle, Clock } from '@lucide/vue'
import { daysUntil, formatDaysUntilLabel, formatShortDate, nextMonthlyOccurrence } from '@/lib/date'

const nextCutoffDate = computed(() => (card.value.statement_cutoff_day ? nextMonthlyOccurrence(card.value.statement_cutoff_day) : null))
const nextCutoffLabel = computed(() => (nextCutoffDate.value ? formatShortDate(nextCutoffDate.value) : ''))
const nextCutoffDaysLabel = computed(() => (nextCutoffDate.value ? formatDaysUntilLabel(daysUntil(nextCutoffDate.value)) : ''))

const nextPaymentDate = computed(() => (card.value.payment_due_day ? nextMonthlyOccurrence(card.value.payment_due_day) : null))
const nextPaymentLabel = computed(() => (nextPaymentDate.value ? formatShortDate(nextPaymentDate.value) : ''))
const nextPaymentDays = computed(() => (nextPaymentDate.value ? daysUntil(nextPaymentDate.value) : null))
const nextPaymentDaysLabel = computed(() => (nextPaymentDays.value !== null ? formatDaysUntilLabel(nextPaymentDays.value) : ''))

// Sección 12.4: urgencia SOLO sobre el pago, nunca sobre el corte (12.0).
const paymentUrgencyClass = computed(() => {
  if (nextPaymentDays.value === 0) return 'text-destructive'
  if (nextPaymentDays.value !== null && nextPaymentDays.value <= 3) return 'text-warning'
  return 'text-muted-foreground'
})
const paymentUrgencyIcon = computed(() => {
  if (nextPaymentDays.value === 0) return AlertCircle
  if (nextPaymentDays.value !== null && nextPaymentDays.value <= 3) return Clock
  return null
})
```

`openEditCard` ya existe en `CardDetailView.vue` (abre `CardFormSheet` en
modo edición, sección 4.5) — se reusa tal cual para el link "Definirlas",
mismo mecanismo que "Definir uno" del límite mensual (sección 4.1).

### 12.3 Decisión 4 — caso "no cargado" (ambos campos opcionales)

Regla única, aplicada consistente en los 3 lugares de 12.2: **se omite el
dato específico que falta, nunca un placeholder tipo "Sin definir" suelto**
— mismo criterio ya usado para `suggested_monthly_limit` en la fila de
gestión (sección 6.2, "(si tiene) Límite: $X").

- **Gestión (A)**: cada segmento (`Corte`/`Pago`) tiene su propio `v-if`
  independiente — con uno solo cargado, se muestra únicamente ese; con
  ninguno, la línea de metadata simplemente no crece.
- **Dashboard (B)**: sin `payment_due_day`, o con `payment_due_day` a más de
  3 días, no se renderiza ningún badge — silencio total, no hay "próximo
  pago: sin definir" en una lista pensada para comparar gasto, no para
  invitar a completar datos.
- **Detalle (C)**: acá sí se agrega una única excepción con affordance
  explícita, mismo criterio que la barra de límite mensual (sección 4.1,
  `v-else` con "Definir uno"): si **ninguno de los dos** campos está
  cargado, la `Card` entera no se renderiza y se reemplaza por una línea
  invitando a completarlos ("No definiste las fechas... Definirlas" →
  abre `CardFormSheet`). Si se cargó **solo uno** de los dos, la `Card` sí se
  renderiza pero con una sola columna (`grid-cols-1` en vez de `grid-cols-2`,
  ver el `:class` condicional del snippet de 12.2.C) — no es equivalente a
  "nada cargado" (hay un dato real que mostrar), así que no amerita la
  invitación a completar, solo se omite la columna vacía.

### 12.4 Decisión 5 — codificación redundante en la urgencia del pago

Mismo criterio CVD del resto del proyecto (nunca color solo): tanto el badge
del dashboard (12.2.B) como la línea del detalle (12.2.C) combinan **ícono +
texto + color**, nunca color aislado — el texto (`"Pago vence hoy"`/`"Hoy"`)
ya es autosuficiente por sí solo sin necesitar leer el color, el ícono
(`AlertCircle` a 0 días, `Clock` a 1-3 días) y el color (`text-destructive`/
`text-warning`) son refuerzo visual adicional, no la única señal. Se usan
los 2 tokens semánticos que ya tiene la barra de límite de esta misma
feature (`limitBarColorClass`, sección 4.1.4: `bg-primary`/`bg-warning`/
`bg-destructive`) en vez de inventar una escala nueva — coherencia con el
resto de la pantalla de detalle.

**Umbral elegido: `<= 3` días para el tono de advertencia, `0` días para el
tono crítico.** Ningún umbral intermedio adicional (ej. "esta semana" a 7
días) — se prioriza simplicidad: un usuario de tarjeta de crédito ya sabe en
qué día del mes vence su pago (es información que definió él mismo al crear
la tarjeta), la urgencia visual es un recordatorio de último momento, no un
calendario completo. El **día de corte nunca lleva urgencia** (12.0): es un
hecho de calendario, no una obligación que se pueda "atrasar".

### 12.5 Decisión 3 — formulario (`CardFormSheet.vue`, sección 6.2): input numérico libre, no `Select`

Los 2 campos van **inmediatamente después de "Límite mensual sugerido"**
(sección 6.2), mismo patrón visual `Label` + `Input` + texto de ayuda que el
resto del Sheet:

```html
<!-- Día de corte -->
<div class="flex flex-col gap-1.5">
  <Label for="tarjeta-corte">Día de corte (opcional)</Label>
  <Input
    id="tarjeta-corte"
    v-model="form.statementCutoffDay"
    inputmode="numeric"
    type="text"
    placeholder="Ej. 15"
    class="text-base tabular-nums"
    :disabled="isSaving"
    :aria-invalid="!!errors.statementCutoffDay"
  />
  <p v-if="errors.statementCutoffDay" class="text-xs text-destructive">{{ errors.statementCutoffDay }}</p>
  <p class="text-xs text-muted-foreground">Día del mes en que cierra el resumen de esta tarjeta.</p>
</div>

<!-- Día de pago -->
<div class="flex flex-col gap-1.5">
  <Label for="tarjeta-pago">Día de pago (opcional)</Label>
  <Input
    id="tarjeta-pago"
    v-model="form.paymentDueDay"
    inputmode="numeric"
    type="text"
    placeholder="Ej. 25"
    class="text-base tabular-nums"
    :disabled="isSaving"
    :aria-invalid="!!errors.paymentDueDay"
  />
  <p v-if="errors.paymentDueDay" class="text-xs text-destructive">{{ errors.paymentDueDay }}</p>
  <p class="text-xs text-muted-foreground">Día límite para pagar el resumen antes del vencimiento.</p>
</div>
```

**Por qué `Input` numérico libre y no un `Select` de 1 a 31**: precedente
directo ya shippeado para el mismo tipo de dato exacto ("día del mes, sin
fecha calculada") — `fixed_expenses.payment_day` en
`FixedExpenseFormSheet.vue` usa exactamente este patrón (`Input
inputmode="numeric" type="text"` + validación inline), no un `Select`. Un
`Select` de 31 ítems exigiría scrollear una lista larga en mobile por un
dato que se tipea más rápido con el teclado numérico (`inputmode="numeric"`
ya invoca el teclado numérico en iOS/Android) sin ninguna ganancia real de
guía — a diferencia de un campo con opciones ambiguas o de texto libre
propenso a error de formato (ahí sí un `Select` reduce error), acá el rango
válido es obvio (1-31) y la validación inline ya cubre el caso de error.
Reusar el patrón exacto de un componente hermano en el mismo proyecto pesa
más que introducir una variante nueva sin motivo funcional.

**Validación** (mismo criterio que `parsePaymentDay` de
`FixedExpenseFormSheet.vue`, adaptado a "opcional" — la única diferencia
real con ese precedente es que acá un campo vacío es válido, no un error):

```ts
type OptionalDayResult = { value: number | null } | { error: true }

function parseOptionalDayOfMonth(raw: string): OptionalDayResult {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null }
  if (!/^\d+$/.test(trimmed)) return { error: true }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < 1 || value > 31) return { error: true }
  return { value }
}
```

- Error inline (`errors.statementCutoffDay`/`errors.paymentDueDay`, mismo
  copy que `FixedExpenseFormSheet.vue`): `"Ingresá un día entre 1 y 31."` —
  solo se muestra si el campo **no** está vacío y falla el parseo; un campo
  vacío nunca dispara error (es el estado válido "no cargado").
- **Sin validación cruzada entre los dos campos** (ej. "el pago debe ser
  después del corte") — decisión explícita, no un olvido: en la práctica
  real de una tarjeta de crédito el día de pago casi siempre cae en el *mes
  siguiente* al corte (ej. corte día 20, pago día 5 del mes que viene), así
  que "pago > corte" como número crudo de 1-31 sería una regla **incorrecta**
  la mayoría de las veces, no solo innecesaria. No hay ninguna relación
  válida y verificable entre ambos números sueltos sin saber además cuántos
  días de gracia da el banco (dato que esta feature no captura ni necesita).
- **Guardado: 100% optimista**, mismo criterio ya establecido para el resto
  de `CardFormSheet` (sección 6.2: sin índice único server-only conocido
  sobre estos 2 campos) — no cambia el veredicto ya fijado ahí, estos 2
  campos no introducen ningún caso de conflicto server-only nuevo.

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
10. **Rediseño de esta iteración, acotado a `CardDetailView.vue` (sección
    4)**: reemplaza por completo el markup de las secciones 4.1, 4.3 y 4.4
    (hero con tinte de color propio + mini-visual, movimientos recientes con
    avatar de persona + fecha + `Badge` de cuota, resumen del mes con tinte
    leve). **No requiere ningún componente nuevo ni cambio en `colors.ts`/
    `charts.ts`/`date.ts`** — reusa tal cual `withAlpha`/`readableTextColor`
    (ya existentes), `formatExpenseDateHeading` (ya existente, sección 3.2),
    `CategoryDonutChart` (sección 4.2, sin cambios) y el componente `Badge`
    (ya instalado desde Fase 1, sección 3 del design system). Único código
    nuevo en el propio archivo: el computed `limitAvailableLabel` (sección
    4.1.3), derivado 100% de `limitProgress` ya existente, sin query nueva.
    **No afecta** `CardsDashboardView.vue`, `CardTransactionsView.vue` ni
    `ManageCardsView.vue` — ninguno de los tres se toca. Se decidió
    explícitamente **no** agregar el "% del total del mes" de la referencia
    (sección 4.1.3) por el costo de una tercera query en esta vista, y se
    descartó el fondo sólido pleno de la referencia por no pasar el umbral de
    contraste WCAG en 4 de los 10 swatches de `COLOR_SWATCHES` (sección
    4.1.1, con los números de contraste documentados ahí) — a favor de un
    tinte del 16%/8% de opacidad (hero/resumen) sobre la superficie neutra,
    sin overrides de color de texto.
11. **Fechas de corte y pago, sección 12 (nueva)**: `credit_cards` suma
    `statement_cutoff_day`/`payment_due_day` (nullable, 1-31, sin cálculo
    server-side). **4 funciones nuevas en `src/lib/date.ts`**
    (`lastDayOfMonth`, `nextMonthlyOccurrence`, `daysUntil`,
    `formatDaysUntilLabel`, más `formatShortDate` — 5 en total, ver 12.1) para
    calcular "próxima ocurrencia" de un día del mes, sin depender de ninguna
    tabla de instancias (a diferencia de `fixed_expenses.payment_day`, este
    dato nunca deriva un estado "Vencido" — ver 12.0, no hay forma de
    verificar si el usuario ya pagó su resumen). Tres puntos de
    implementación: (a) `ManageCardsView.vue` sección 6.2 — 2 `<span v-if>`
    nuevos con el dato crudo, mismo patrón que `Límite: $X`; (b)
    `CardsDashboardView.vue` sección 2.3 — campo `paymentUrgency` nuevo en el
    computed `cardsRanking` ya existente + `Badge` condicional (solo si el
    pago vence en ≤3 días); (c) `CardDetailView.vue` — `Card` nueva entera
    (sección 12.2.C, entre el hero de 4.1 y la dona de 4.2) con fecha
    calculada + "en N días", más el estado "nada cargado" con affordance
    "Definirlas" (mismo criterio que "Definir uno" del límite, sección 4.1).
    `CardFormSheet.vue` (sección 6.2/12.5): 2 campos nuevos `Input` numéricos
    libres (no `Select`, mismo patrón que `fixed_expenses.payment_day` en
    `FixedExpenseFormSheet.vue`) inmediatamente después de "Límite mensual
    sugerido", validación opcional (vacío = válido), sin validación cruzada
    entre ambos campos (12.5 explica por qué esa regla sería incorrecta, no
    solo innecesaria), guardado 100% optimista (sin cambio de veredicto sobre
    `CardFormSheet`). Sin componente `ui/` nuevo — reusa `Input`/`Label`/
    `Badge` ya instalados. `AlertCircle`/`Clock` de `@lucide/vue` (ya
    confirmados en el paquete, usados en `FixedExpenseStatusBadge.vue`/
    `MatchFormSheet.vue`) y los tokens `text-warning`/`text-destructive` (ya
    vigentes) cubren la codificación redundante ícono+texto+color de la
    urgencia (12.4) — nada nuevo que instalar ni definir en el tema.
