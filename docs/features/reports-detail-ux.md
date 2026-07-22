# TipApp — Reportes ampliados: Resumen, Detalle del mes, Comparación mensual

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, a11y), `docs/features/nav-drawer-ux.md` (patrón de header/drawer,
sin botón "Volver") y `docs/features/dashboard-redesign-ux.md` (decisión de
gráficos SVG a mano, sección 0 — no se repite esa justificación, solo se
referencia y se indica qué cambia).

**Restricción dura del Product Owner**: `src/views/ReportsView.vue` **no se
toca**. Todo lo de este documento vive en 3 pantallas/rutas **nuevas**,
enlazadas desde `/reportes` agregando un único bloque de navegación nuevo a
ese archivo (sección 2) — nada del contenido/lógica existente de
`ReportsView.vue` se modifica ni se extrae.

Alcance: 3 de las 4 pantallas de una referencia mostrada por el PO (mockup de
otra app, con su propio bottom-nav de 5 tabs que **no aplica** a TipApp — acá
el único patrón de navegación sigue siendo el drawer lateral, sin bottom
tabs). La 4ª pantalla de la referencia ("Generar reporte") queda **fuera de
alcance explícito**, no se diseña nada de eso acá.

---

## 0. Contrato de datos (recibido de `supabase-backend-expert`, definitivo)

No se re-discute — se documenta acá para que este doc sea autocontenido y
para justificar, con criterio de UX/producto (no solo "porque el backend lo
dijo"), las decisiones que a primera vista podrían parecer limitaciones.

1. **Alcance de los totales generales** (tiles, gráfico de 6 meses, dona de
   categoría de la Pantalla 1) = idéntico al `/reportes` actual: **solo
   `expenses`/`incomes`**. `card_expenses` (dominio de tarjeta) **nunca** se
   mezcla en esos totales — mismo criterio que ya aplica hoy en
   `ReportsView.vue` (`expenseTotal`/`incomeTotal` sobre `expenses`/`incomes`
   puros) y que documenta `CLAUDE.md` para el resto de la app: cada dominio
   contable se mide con sus propias tablas, nunca se suman fuentes distintas
   en un mismo total salvo que el propio dato lo pida (ver punto 5).
2. **Vista nueva `public.monthly_expense_income_totals`**: siempre 6 filas
   (`month_start`, `expense_total`, `income_total`), los **últimos 6 meses
   calendario reales terminando en el mes actual** — **no** parametrizada por
   el selector de mes de la Pantalla 1 (ver sección 3.3, es importante que el
   frontend no intente re-consultarla al cambiar el selector).
3. **Todo lo demás** sale de queries directas a Supabase acotadas por rango
   de fecha (`gte`/`lt` sobre la columna de fecha correspondiente), mismo
   patrón que ya usa `loadReport()` en `ReportsView.vue` — **sin vistas SQL
   nuevas** más allá de la del punto 2.
4. **"Por tarjeta" / "Métodos de pago" (Pantalla 2)** usan `card_expenses`
   (dominio de tarjeta, columnas `card_id`, `person_id`, `amount`,
   `expense_date` — confirmado en `supabase/migrations/
   20260716142014_card_expenses_init.sql`). `card_expenses` **no tiene
   `category_id`** — los gastos de tarjeta no se categorizan, por eso no hay
   forma de cruzar "por tarjeta" con categoría.
5. **"Por persona" (Pantalla 2)** usa `card_people` vía
   `card_expenses.person_id` — **no** `debt_people` (son entidades separadas,
   ya documentado en `CLAUDE.md`). Bucket **"Sin persona asignada"** para
   `person_id null`, con la key sintética `'none'` — mismo patrón, mismo
   texto literal, ya implementado en `src/views/CardsDashboardView.vue`
   (`peopleRanking`, línea ~206) y `src/views/CardDetailView.vue`
   (`personDonutSlices`, línea ~190). Reusar el texto y la key tal cual, no
   inventar una variante.
6. **`accounts` no tiene columna de tipo** (`cash`/`bank`/etc. — confirmado,
   columnas reales: `id, user_id, name, color, icon, initial_balance,
   sort_order, transfer_commission`). Por eso "Métodos de pago" (sección 4.5)
   es un donut de **solo 2 categorías**, Tarjeta vs. Cuenta, no un desglose
   más fino.

### 0.1 Por qué el donut de 2 categorías es la decisión de UX correcta (no solo la única posible)

Podría parecer una limitación a disimular, pero es la opción más honesta:
inventar un desglose más fino (efectivo/banco/transferencia) adivinando por
el `icon`/`name` libre de cada cuenta (`categories.color`/`accounts.icon` son
texto libre sin check en BD, ver `CLAUDE.md`) le daría al usuario una
precisión que el dato real no respalda — exactamente el tipo de "número
inventado" que el resto de la app evita a propósito (mismo criterio que
`isMonthSafeToShow`/`expenseDelta` en `dashboard-redesign-ux.md`: si no se
puede calcular con certeza, no se muestra, no se aproxima). El binario
Tarjeta/Cuenta es el único corte que el esquema garantiza sin ambigüedad, y
sigue siendo información útil ("¿cuánto de lo que gasté este mes pasó por
tarjeta vs. salió directo de una cuenta?").

### 0.2 Por qué "Sin persona asignada" se muestra como bucket explícito, no se oculta

Mismo principio: un gasto de tarjeta sin persona asignada **es** gasto real
del mes — excluirlo del desglose "Por persona" porque no tiene metadata
opcional asignada escondería plata real del total, rompiendo la garantía de
que "la suma de las partes = el total" que el usuario espera de cualquier
desglose. Mostrar el bucket con nombre explícito (no un hueco silencioso) ya
es el patrón validado en Tarjetas — se reusa tal cual acá para no introducir
un segundo criterio.

---

## 1. Rutas nuevas

| Path | Nombre | Meta | Vista | Título de `AppHeader` |
|---|---|---|---|---|
| `/reportes/resumen` | `reports-summary` | `{ requiresAuth: true }` | `ReportsSummaryView.vue` | "Resumen del mes" |
| `/reportes/detalle-mes` | `reports-detail` | `{ requiresAuth: true }` | `ReportsMonthDetailView.vue` | "Detalle del mes" |
| `/reportes/comparacion` | `reports-comparison` | `{ requiresAuth: true }` | `ReportsComparisonView.vue` | "Comparación mensual" |

Sin colisión con `/reportes` (prefijo compartido, rutas hijas normales, mismo
patrón ya usado por `/tarjetas/transacciones`, `/deudas/personas`,
`/gastos-fijos/comparacion`) ni con `/gastos-fijos/comparacion` (prefijo
distinto — son features distintas, "Comparación mensual" de acá es del
reporte general expenses/incomes, no de gastos fijos; no reusar ningún
componente de `FixedExpensesComparisonView.vue`, son conceptualmente
distintos: esa pantalla compara 3 meses **consecutivos** alrededor de un
pivote, esta compara **2 meses cualesquiera** elegidos por el usuario — ver
sección 5).

Registrar en `src/router/index.ts` junto a la ruta `reports` existente, mismo
`meta.requiresAuth`, mismo lazy import por ruta:

```ts
{ path: '/reportes/resumen', name: 'reports-summary', component: () => import('@/views/ReportsSummaryView.vue'), meta: { requiresAuth: true } },
{ path: '/reportes/detalle-mes', name: 'reports-detail', component: () => import('@/views/ReportsMonthDetailView.vue'), meta: { requiresAuth: true } },
{ path: '/reportes/comparacion', name: 'reports-comparison', component: () => import('@/views/ReportsComparisonView.vue'), meta: { requiresAuth: true } },
```

**Sin cambios en el drawer** (`NavigationDrawer.vue`): estas 3 pantallas son
rutas hijas de "Reportes", mismo criterio ya vigente para
`/tarjetas/gestionar`, `/deudas/personas`, `/gastos-fijos/comparacion` — ninguna
de esas está en el `<nav>` de 6 ítems, solo su padre. Se llega a las 3
pantallas nuevas exclusivamente desde `/reportes` (sección 2).

---

## 2. Navegación desde `/reportes` (el único cambio permitido en `ReportsView.vue`)

**Patrón elegido: una `Card` nueva de "Más reportes" con 3 filas tipo
lista de navegación** (icono + título + descripción corta + `ChevronRight`),
no tabs ni botones sueltos — es el mismo lenguaje visual que ya usa el
`<nav>` del drawer (`min-h-11`, `hover:bg-accent`, foco visible) aplicado
dentro de una Card, coherente con que estas 3 pantallas son "más reporte",
no una acción de comando.

**Dónde insertarla**: como una `<section>` propia, **inmediatamente después**
de la sección del selector de mes (línea ~438-494 de `ReportsView.vue` hoy) y
**antes** de los 4 bloques condicionales (`isInitialLoading` /  `loadError` /
`!hasMonthlyActivity` / `v-else` con los datos). Esto es deliberado: la
navegación hacia las 3 pantallas nuevas **no depende de que el mes
seleccionado tenga actividad ni de que la carga haya terminado** — un
usuario con un mes vacío en `/reportes` igual puede querer ir a comparar dos
meses distintos en "Comparación mensual". Ponerla siempre visible, fuera del
`v-if`/`v-else` de estado, evita que quede escondida detrás de un error o de
un estado vacío.

Markup (agregar tal cual, sin tocar nada de lo que ya existe arriba/abajo):

```html
<section class="flex flex-col gap-3">
  <Card>
    <CardHeader>
      <CardTitle class="text-base font-semibold">Más reportes</CardTitle>
    </CardHeader>
    <nav class="flex flex-col gap-1 px-3 pb-3">
      <RouterLink
        v-for="item in moreReportsLinks"
        :key="item.to.name"
        :to="item.to"
        class="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <component :is="item.icon" class="size-4.5" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate font-medium">{{ item.label }}</span>
          <span class="truncate text-xs text-muted-foreground">{{ item.description }}</span>
        </span>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
      </RouterLink>
    </nav>
  </Card>
</section>
```

```ts
const moreReportsLinks = [
  { to: { name: 'reports-summary' }, icon: LayoutDashboard, label: 'Resumen ampliado', description: 'Tiles, tendencia de 6 meses y hallazgos' },
  { to: { name: 'reports-detail' }, icon: Layers, label: 'Detalle del mes', description: 'Por tarjeta, por persona y métodos de pago' },
  { to: { name: 'reports-comparison' }, icon: GitCompareArrows, label: 'Comparación mensual', description: 'Compará dos meses cualquiera' },
]
```

Iconos nuevos a importar de `@lucide/vue` (verificados presentes en
`node_modules/@lucide/vue/dist/esm/icons/`, no requieren instalar nada):
`LayoutDashboard`, `Layers`, `GitCompareArrows`, `ChevronRight`.

Esta es la única edición a `ReportsView.vue`: un `<section>` nuevo + el
array `moreReportsLinks` + los 4 imports de ícono + `RouterLink` (ya
disponible globalmente vía `vue-router`). Cero líneas existentes tocadas.

---

## 3. Pantalla 1 — `/reportes/resumen` ("Resumen del mes")

Dashboard más rico, standalone — **no reemplaza** `/reportes`, es una vista
adicional con más detalle. Header: `<AppHeader title="Resumen del mes" />`.

### 3.1 Selector de mes (propio, independiente de `/reportes`)

Mismo componente/patrón exacto que ya usa `ReportsView.vue` (`Select` con
`monthOptions` de los últimos 12 meses, badge "Actual"/"Mes en curso" debajo)
— **reusar el mismo markup tal cual** (no es candidato a extracción a un
componente compartido en este documento: `ReportsView.vue` no se toca, así
que extraer un componente implicaría modificarlo; se acepta la duplicación
del Select entre las 4 pantallas de Reportes como costo directo de la
restricción del PO, igual que ya se decide para "Insights", sección 3.6).
Estado local propio: `selectedMonth` arranca en el mes actual.

### 3.2 4 tiles con variación vs. mes anterior

Grid `grid-cols-2 gap-3` (2×2 en mobile, se mantiene en `sm:` — 4 números
cortos no necesitan una fila de 4), cada tile en su propia `Card` chica:

```html
<div class="grid grid-cols-2 gap-3">
  <Card v-for="tile in summaryTiles" :key="tile.id">
    <div class="flex flex-col gap-1 p-4">
      <p class="text-xs text-muted-foreground">{{ tile.label }}</p>
      <p class="text-lg font-semibold tabular-nums" :class="tile.valueClass">{{ tile.valueLabel }}</p>
      <span v-if="tile.delta" class="flex items-center gap-1 text-xs font-medium" :class="tile.delta.colorClass">
        <component :is="tile.delta.direction === 'up' ? ArrowUp : ArrowDown" class="size-3" />
        {{ tile.delta.label }}
      </span>
    </div>
  </Card>
</div>
```

4 tiles: **Total gastado**, **Total ingresos**, **Balance**, **Ahorro**
(`savingsRate` = `netTotal / incomeTotal * 100`, mismo cálculo que
`ReportsView.vue`, `null`/`—` si `incomeTotal <= 0`).

**Semántica de color del delta — no es la misma para las 4** (regla nueva de
este documento, extiende el criterio de `expenseDelta` de
`dashboard-redesign-ux.md` sección 2.2 a las 4 métricas):

| Tile | Sube = | Baja = |
|---|---|---|
| Total gastado | `text-destructive` (gastaste más, malo) | `text-success` |
| Total ingresos | `text-success` (ganaste más, bueno) | `text-destructive` |
| Balance | `text-success` | `text-destructive` |
| Ahorro | `text-success` | `text-destructive` |

Siempre ícono de dirección (`ArrowUp`/`ArrowDown`) + texto (`"12% vs. mes
anterior"` o, cuando no aplica %, el delta absoluto — ver abajo), nunca
color solo — mismo criterio de a11y de todo el proyecto.

**Cuándo se omite el % y se muestra solo el delta absoluto**: mismo criterio
ya usado por `expenseDelta`/`buildVariation` en el proyecto (`ReportsView.vue`
sección de "Resultado del mes"; `FixedExpensesComparisonView.vue`
`buildVariation`) — si el mes anterior no tiene una base > 0 para ese
concepto (p. ej. `incomeTotal` anterior = 0, o `savingsRate` anterior no
calculable), un % sería una división por cero o un número engañoso: se
muestra el **delta absoluto** en su lugar (`+$12.000` o, para Ahorro
específicamente, **puntos porcentuales** `+5 pp` — nunca "% de un %", que es
matemáticamente confuso). Si ni el delta absoluto es calculable (falta el
mes anterior por completo, no hay dato), **se omite el badge entero** — no
se inventa un `0%` ni un placeholder, mismo principio "no inventar" de
`isMonthSafeToShow`.

### 3.3 Gráfico de barras "Ingresos vs. gastos" (últimos 6 meses)

Fuente: `public.monthly_expense_income_totals` (sección 0, punto 2) —
**consulta única al montar la vista, no depende de `selectedMonth`**. Es un
widget de tendencia global de los últimos 6 meses reales, igual que "Por mes"
de `StatisticsView.vue` no depende de ningún selector — cambiar el mes
seleccionado arriba (que sí re-dispara tiles/dona/top gastos/insights) **no**
vuelve a pedir esta vista.

**Componente nuevo: `MonthlyBarChart.vue`** (sección 6.1) — 2 series
agrupadas (ingreso/gasto) por mes, SVG a mano, mismo motivo que el resto de
gráficos del proyecto (sección 0 de `dashboard-redesign-ux.md`: el tema
cambia gratis con variables CSS, sin librería nueva).

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Ingresos vs. gastos</CardTitle>
    <CardDescription>Últimos 6 meses</CardDescription>
  </CardHeader>
  <MonthlyBarChart
    :points="monthlyTotals"
    class="px-6 pb-4"
    height="140"
    aria-label="Ingresos y gastos mensuales de los últimos 6 meses"
  />
</Card>
```

### 3.4 Dona "Gastos por categoría" (top 6, con leyenda)

**Reusar tal cual** `CategoryDonutChart.vue` + `buildDonutSlices()` de
`src/lib/charts.ts` (`maxSlices = 5` default → 5 individuales + "Otros" = 6
arcos totales, coincide exactamente con el pedido "top 6"). Datos: gastos
del `selectedMonth` agrupados por categoría (misma query que ya arma
`summarizeCategories` en `ReportsView.vue`, replicada acá — ver nota de
duplicación en sección 3.6). Layout idéntico al de "Resumen por categoría"
de `HomeView.vue` (dona + lista de leyenda con nombre/monto/%, sección 2.3 de
`dashboard-redesign-ux.md`) — no reinventar el layout.

### 3.5 "Top gastos"

Lista corta (**top 5**) de los gastos individuales más grandes del mes
seleccionado, mismo layout visual que "Transacciones recientes" de
`HomeView.vue` (swatch de categoría con `withAlpha`, descripción o nombre de
categoría como fallback, monto a la derecha, fecha corta debajo) — filas
**no clickeables** (es un vistazo, no un lugar para editar/eliminar, mismo
criterio que "Transacciones recientes").

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Top gastos</CardTitle>
    <CardAction>
      <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'transactions' })">
        Ver todos
      </Button>
    </CardAction>
  </CardHeader>
  <!-- 5 filas, mismo markup que "Transacciones recientes" de HomeView -->
</Card>
```

**Nota sobre "Ver todos"**: `TransactionsView.vue` hoy **no** soporta ningún
query param de filtro por mes (verificado — solo lee `?new=1`). Agregarle
filtrado por mes es una expansión de alcance de otra pantalla, no pedida acá:
"Ver todos" navega a `/transacciones` **sin filtrar**, mismo criterio ya
usado por "Ver todas" de `HomeView.vue`. Documentado como limitación
conocida, no bloqueante — si a futuro se agrega filtro por mes a
Transacciones, este link puede empezar a pasar `?month=...` sin rediseñar
nada de acá.

### 3.6 "Insights del mes"

**Reusa la lógica exacta** de `buildInsights()` (mayor categoría, día con
más gasto, cuenta más usada, categoría que más subió) — mismo layout de
`<dl>` que la card "Hallazgos" ya existente en `/reportes` (`ReportsView.vue`
línea ~677-695), mismo copy, mismo orden, mismo tope de 4 insights.

**Cómo se resuelve la restricción "no tocar `ReportsView.vue`"**: como
`buildInsights`, `summarizeCategories`, `summarizeAccounts` y
`shortDateLabel` son funciones privadas de `ReportsView.vue` (no exportadas),
y extraerlas a un helper compartido implicaría editar ese archivo (aunque
sea solo para agregar un `export`), la única forma de cumplir la restricción
dura del PO es **duplicar esa lógica 1:1** en un módulo nuevo
`src/lib/reportInsights.ts`, usado únicamente por `ReportsSummaryView.vue`.
Esto es **duplicación intencional y documentada**, no un descuido: la
alternativa (tocar `ReportsView.vue` para exportar 4 funciones) viola una
restricción explícita del Product Owner ("para que no la mate"), así que se
prioriza la restricción sobre el principio general de no-duplicar. Si en el
futuro el PO habilita tocar `ReportsView.vue`, ahí sí conviene una
refactorización que unifique ambos módulos — no se hace preventivamente acá.

Datos que necesita este cálculo en esta pantalla (subconjunto de lo que ya
pide `ReportsView.vue.loadReport()`, sin lo que Pantalla 1 no usa —
`debt_balances`/`loans_summary` no hacen falta acá, esta pantalla no muestra
deudas/préstamos):
- `expenses` del mes actual y anterior (`amount, expense_date, account_id,
  category:categories(id,name,color)`).
- `incomes` del mes actual (`amount, income_date, account_id`).
- `accounts` (`id, name`) + `account_transfers` y `debt_movements` del mes
  actual — solo para poder calcular "cuenta más usada" (mismo
  `summarizeAccounts()` replicado, sin los campos que no aporta a ese único
  insight).

### 3.7 Estados de carga/vacío/error

Mismo patrón exacto que `ReportsView.vue` (Skeleton en tiles/gráfico/dona
mientras carga; `AlertCircle` + "Reintentar" en error; estado vacío honesto
"Sin movimientos en {mes}" + CTA "Agregar transacción" si es el mes actual)
— no reinventar copy ni componentes, calcar la estructura de
`isInitialLoading`/`loadError`/`!hasMonthlyActivity` ya usada ahí.

---

## 4. Pantalla 2 — `/reportes/detalle-mes` ("Detalle del mes")

Header: `<AppHeader title="Detalle del mes" />`. Selector de mes propio
(idéntico patrón, sección 3.1), estado local independiente de las otras 2
pantallas nuevas.

### 4.1 Alcance de datos por sección (recap explícito, para que no haya ambigüedad)

| Sección | Fuente | Motivo |
|---|---|---|
| Por tarjeta | `card_expenses` agrupado por `card_id` | Dominio de tarjeta, sección 0 punto 4 |
| Por persona | `card_expenses` agrupado por `person_id` | Dominio de tarjeta, sección 0 punto 5 |
| Métodos de pago | `card_expenses` (total) vs. `expenses` (total) | Único corte que el esquema garantiza, sección 0.1 |
| Mayores gastos | `expenses` (individual, categorizado) | Mismo dominio que Pantalla 1 y `/reportes` — es "el mismo pool de gastos", visto desde otro ángulo (detalle vs. resumen) |
| Resumen de transacciones | `expenses` agrupado por categoría | Mismo dominio que "Gastos por categoría" de `/reportes`, con el agregado de cantidad de transacciones |

**Por qué "Mayores gastos" (acá) y "Top gastos" (Pantalla 1) pueden mostrar
la misma fuente sin ser un error de diseño**: no es una casualidad ni una
redundancia a corregir — es el mismo precedente que ya usa la app entre
"Transacciones recientes" de Inicio (5 filas, vistazo) y el listado completo
de `/transacciones` (todo, editable): un widget corto en una pantalla de
"panorama" (Pantalla 1) y un widget más profundo en la pantalla de "detalle"
(Pantalla 2, **top 10** en vez de top 5, sin necesidad de link "Ver todos"
porque esta pantalla ya es la vista profunda) conviven sin problema.

### 4.2 "Por tarjeta"

Lista con barra de progreso, **mismo componente visual** que `peopleRanking`
de `CardsDashboardView.vue` (fila: swatch de color + nombre + barra +
porcentaje) aplicado acá a tarjetas en vez de personas — no es necesario un
componente nuevo, es el mismo patrón de "ranking con barra" ya validado:

```html
<div v-for="card in cardRanking" :key="card.id" class="flex items-center gap-3">
  <span class="flex size-6 shrink-0 items-center justify-center rounded-full" :style="{ background: card.color ?? 'hsl(var(--muted))' }">
    <CreditCardIcon class="size-3.5" :style="{ color: readableTextColor(card.color) }" />
  </span>
  <span class="w-20 shrink-0 truncate text-xs text-muted-foreground">{{ card.name }}</span>
  <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
    <div class="h-full rounded-full" :style="{ width: `${card.percentOfMax}%`, background: card.color ?? 'hsl(var(--muted-foreground))' }" />
  </div>
  <span class="w-14 shrink-0 text-right text-xs font-medium tabular-nums">{{ card.percentLabel }}</span>
</div>
```

Datos: `card_expenses` del mes agrupados por `card_id`, cruzado con
`credit_cards` (`name`, `color`) para el label — mismo cálculo que
`cardsRanking` de `CardsDashboardView.vue` (línea ~173), sin el badge de
`paymentUrgency` (esto es un reporte histórico del mes, no un recordatorio
de pago próximo — ese concepto no aplica acá).

### 4.3 "Por persona"

**Reusar el patrón exacto** de `peopleRanking` de `CardsDashboardView.vue`
(línea ~206), sin cambios de comportamiento: bucket `'Sin persona asignada'`
con key sintética `'none'`, sin color propio (usa `muted-foreground`), mismo
markup de fila ya transcripto en la sección 4.2 pero con ícono `User` en vez
de `CreditCardIcon` (igual que ya hace esa pantalla).

### 4.4 "Mayores gastos"

Top **10** gastos individuales del mes (`expenses`, con `category` y
`description`), mismo layout de fila que "Top gastos" de Pantalla 1
(sección 3.5) — sin "Ver todos" (esta pantalla ya es la vista de detalle).

### 4.5 "Métodos de pago"

Dona de **2 slices fijos**, "Tarjeta" (suma de `card_expenses.amount` del
mes) vs. "Cuenta" (suma de `expenses.amount` del mes) — **reusar**
`CategoryDonutChart.vue` con 2 slices (`buildDonutSlices` no hace falta acá,
son siempre exactamente 2 categorías fijas, no hay plegado a "Otros"):

```ts
const paymentMethodSlices = computed<DonutSlice[]>(() => {
  const total = cardExpensesTotal.value + accountExpensesTotal.value
  if (total === 0) return []
  return [
    { id: 'card', name: 'Tarjeta', color: 'hsl(var(--primary))', amount: cardExpensesTotal.value, percentLabel: `${Math.round(cardExpensesTotal.value / total * 100)}%` },
    { id: 'account', name: 'Cuenta', color: 'hsl(var(--muted-foreground))', amount: accountExpensesTotal.value, percentLabel: `${Math.round(accountExpensesTotal.value / total * 100)}%` },
  ]
})
```

Colores fijos (no vienen de `categories.color`/`credit_cards.color` — son
agregados sintéticos, no una categoría ni tarjeta real): `primary` para
Tarjeta (color de marca, refuerza que es "la app hablando de tarjetas en
general"), `muted-foreground` para Cuenta (neutro). Leyenda en texto al lado
(nombre + monto + %), mismo criterio de a11y que toda dona del proyecto — el
color nunca es el único indicador.

### 4.6 "Resumen de transacciones"

**Decisión de layout: card-list, no `<table>` real** — mismo principio ya
documentado en `docs/design-system.md` sección 4 ("Justificación: Card-list
en vez de Table"): 4 columnas (categoría, cantidad, monto, %) en una tabla
HTML real fuerzan scroll horizontal o compresión ilegible en 360-390px de
ancho. Se arma como una extensión directa del patrón `grid-cols-[1fr_auto_
auto]` que ya usa "Gastos por categoría" en `ReportsView.vue` (línea ~603),
agregando una cuarta columna angosta para la cantidad:

```html
<div v-for="row in transactionsSummary" :key="row.categoryId" class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-sm">
  <div class="flex min-w-0 items-center gap-2">
    <span class="size-2.5 shrink-0 rounded-full" :style="{ background: row.color ?? 'hsl(var(--muted-foreground))' }" />
    <span class="truncate font-medium">{{ row.categoryName }}</span>
  </div>
  <span class="w-8 text-right text-xs text-muted-foreground tabular-nums">{{ row.count }}</span>
  <span class="tabular-nums">${{ formatAmount(row.amount) }}</span>
  <span class="w-10 text-right text-xs text-muted-foreground">{{ row.percentLabel }}</span>
</div>
```

Encabezado de columnas explícito arriba de la lista (`text-xs
text-muted-foreground uppercase`, fila `Categoría / Cant. / Monto / %`) para
que las 4 columnas se entiendan sin necesidad de una tabla real — mismo
criterio de "toda la info accesible ya es texto real", nada depende de
posición visual sola. Ordenado por monto desc, igual que "Gastos por
categoría" ya hace.

### 4.7 Estados de carga/vacío/error

Mismo patrón que Pantalla 1 (sección 3.7) — Skeleton por sección mientras
carga, `AlertCircle`+"Reintentar" en error, mensaje vacío honesto si el mes
no tiene ningún `expense`/`card_expense`.

---

## 5. Pantalla 3 — `/reportes/comparacion` ("Comparación mensual")

Header: `<AppHeader title="Comparación mensual" />`. **No confundir con**
`/gastos-fijos/comparacion` (`FixedExpensesComparisonView.vue`): esa pantalla
compara 3 meses **consecutivos** alrededor de un pivote navegable con
flechas, y solo de **gastos fijos**. Esta pantalla compara **2 meses
cualesquiera**, elegidos independientemente por el usuario, del reporte
general (`expenses`/`incomes`) — geometrías de selección distintas, no
comparten componente.

### 5.1 Selector de 2 meses (Mes A / Mes B)

Dos `Select` independientes, mismas `monthOptions` (últimos 12 meses) que ya
usa `ReportsView.vue`, en una `Card` con un separador visual central:

```html
<Card>
  <div class="flex flex-col items-center gap-3 p-4 sm:flex-row sm:justify-center">
    <div class="w-full max-w-56 sm:w-56">
      <p class="text-xs font-medium text-muted-foreground">Mes A</p>
      <Select v-model="monthA"> <!-- mismo Select/SelectTrigger que ReportsView --> </Select>
    </div>
    <ArrowLeftRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div class="w-full max-w-56 sm:w-56">
      <p class="text-xs font-medium text-muted-foreground">Mes B</p>
      <Select v-model="monthB"> <!-- ídem --> </Select>
    </div>
  </div>
</Card>
```

- Default: `monthA` = mes anterior al actual, `monthB` = mes actual (la
  comparación más probable al entrar). El usuario puede elegir cualquier
  combinación, incluso `monthA === monthB` (en ese caso, todas las
  variaciones de abajo dan `0%`/`flat` — no es un estado de error, es un
  resultado válido, se muestra tal cual sin mensaje especial).
- `aria-label="Meses a comparar"` en el contenedor, o `SelectTrigger`
  individuales ya llevan su label visible (`<p>` de arriba) asociado por
  posición — si se quiere asociación formal, usar `id`/`aria-labelledby`
  igual que el patrón ya usado en el selector de `ReportsView.vue`
  (`aria-describedby="reports-period-label"`).

### 5.2 4 tiles de variación (A → B)

Mismo layout de grid 2×2 que Pantalla 1 (sección 3.2), pero acá el "delta"
es entre los 2 meses elegidos, no "vs. mes anterior". Reusa
**exactamente** la función `buildVariation()` ya implementada en
`FixedExpensesComparisonView.vue` (`direction: 'up'|'down'|'flat'|null`,
`percent: null` si el mes base es 0, `amountDelta`) — mismo criterio "no
inventar" ya validado ahí, se replica (no se importa, es una función privada
de ese archivo — mismo argumento de duplicación aceptada que la sección 3.6,
pero en este caso el archivo fuente sí podría tocarse a futuro sin romper
ninguna restricción del PO; se deja como duplicación por ahora para no
ampliar el alcance de esta entrega, con nota para una futura extracción a
`src/lib/`).

4 métricas: **Gastos totales**, **Ingresos totales**, **Balance**, **Ahorro**.
Mismas reglas de color por métrica que la tabla de la sección 3.2 (gastos:
sube=`destructive`; ingresos/balance/ahorro: sube=`success`).

**Caso especial — tile "Ahorro"**: `savingsRate` ya es un porcentaje (p.ej.
20% → 25%). La variación no debe calcularse como "% de cambio de un %"
(matemáticamente válido pero confuso de leer, "aumentó 25%" podría
malinterpretarse como que el ahorro pasó a ser del 45%). Se muestra en su
lugar la **diferencia en puntos porcentuales**: `+5 pp` / `-5 pp`
(`savingsRateB - savingsRateA`), con el mismo ícono de dirección + color. Si
cualquiera de los 2 meses no tiene `savingsRate` calculable (`incomeTotal
<= 0` en ese mes), se omite el tile completo (no un `—`, se omite, mismo
criterio "no inventar").

### 5.3 Tabla "Comparación por categoría"

**Decisión de layout: card-list de 2 líneas por fila, no tabla de 5
columnas** — igual que en la sección 4.6, una tabla real con 5 columnas
(categoría, monto A, monto B, Δ$, Δ%) no cabe legible en 360-390px. Se
adapta a 2 líneas por categoría: línea principal (nombre + badge de
variación con ícono+%, mismo componente visual que el badge de
`expenseDelta` de `ReportsView.vue`) y línea secundaria muted con los 2
montos crudos:

```html
<div v-for="row in categoryComparison" :key="row.categoryId" class="flex flex-col gap-1 rounded-lg border border-border p-3">
  <div class="flex items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-2">
      <span class="size-2.5 shrink-0 rounded-full" :style="{ background: row.color ?? 'hsl(var(--muted-foreground))' }" />
      <span class="truncate text-sm font-medium">{{ row.categoryName }}</span>
    </div>
    <Badge v-if="row.percent !== null" variant="secondary" :class="row.direction === 'up' ? 'text-destructive' : 'text-success'">
      <component :is="row.direction === 'up' ? ArrowUp : ArrowDown" class="size-3" />
      {{ row.percent }}%
    </Badge>
    <Badge v-else-if="row.direction === 'up'" variant="secondary" class="text-destructive">Nuevo</Badge>
  </div>
  <p class="text-xs tabular-nums text-muted-foreground">
    Mes A: ${{ formatAmount(row.amountA) }} · Mes B: ${{ formatAmount(row.amountB) }}
  </p>
</div>
```

- **Universo de categorías**: unión de categorías con gasto `> 0` en A **o**
  en B (no la intersección — si una categoría solo tuvo gasto en uno de los
  2 meses, igual debe aparecer, con el lado faltante en `$0`).
- **Orden**: por magnitud de variación absoluta (`|amountDelta|`) descendente
  — las categorías que más se movieron (para bien o para mal) arriba, mismo
  criterio de "mostrar lo interesante primero" que ya usa "Categoría que más
  subió" en Hallazgos.
- **Caso "Nuevo"** (badge sin `%`): cuando `amountA === 0` y `amountB > 0`,
  un porcentaje de variación no es calculable (división por cero) — se
  muestra el badge `Nuevo` en vez de un `%`, con el mismo tono `destructive`
  (gasto que antes no existía es, en el marco de "gastar más es la mala
  noticia", información equivalente a un aumento). Caso simétrico
  (`amountB === 0`, categoría que desapareció): badge `Ya no aparece`, tono
  `success` (dejaste de gastar en eso).

### 5.4 Gráfico de barras "Variación de gastos por categoría (%)"

**Componente nuevo, no SVG: `CategoryVariationBars.vue`** (sección 6.2) —
barras divergentes ancladas al centro (positivo hacia la derecha en
`destructive`, negativo hacia la izquierda en `success`), construidas con
`<div>`s de ancho porcentual, **mismo enfoque ya usado** por las barras de
"Por mes" de `StatisticsView.vue` y por `peopleRanking`/`cardsRanking` de
Tarjetas — no hace falta SVG para esto, es el mismo patrón "barra = `width`
%" ya validado en 3 lugares del proyecto, solo que ahora ancladas al centro
en vez de al borde izquierdo.

**Filtro de datos**: solo categorías con `percent !== null` (sección 5.3) —
una categoría "Nueva" (sin base en A) no tiene un `%` que graficar en una
barra proporcional (sería una barra "infinita"); esas categorías **se
excluyen de este gráfico específico** pero siguen apareciendo en la tabla de
arriba con su badge "Nuevo"/"Ya no aparece" — la tabla es la fuente de
verdad completa, el gráfico es un resumen visual de lo que sí se puede
graficar proporcionalmente. Anotar esto en el componente para que no se
interprete como un bug ("¿por qué esta categoría no está en el gráfico pero
sí en la tabla de arriba?").

### 5.5 Estados de carga/vacío/error

Mismo patrón que las otras 2 pantallas. Caso adicional propio de esta
pantalla: si **ninguno** de los 2 meses elegidos tiene actividad, mensaje
vacío "Ninguno de los 2 meses tiene movimientos para comparar." en vez del
copy genérico de "sin movimientos en {mes}" (que asume un solo mes).

---

## 6. Componentes de gráfico nuevos

Ambos van en `src/components/charts/` (carpeta ya existente), presentacionales
(reciben props ya calculados, no llaman a stores/Supabase) — mismo contrato
que `TrendAreaChart.vue`/`CategoryDonutChart.vue`/`DualTrendChart.vue`. Los
helpers de agregación (armar los puntos/filas desde datos crudos) van en
`src/lib/charts.ts` (extendiendo el archivo ya existente, no uno nuevo —
mismo criterio de "un solo lugar para lógica de gráficos" que ya sigue el
proyecto) salvo `reportInsights.ts` (sección 3.6, caso especial por la
restricción de no tocar `ReportsView.vue`).

### 6.1 `MonthlyBarChart.vue` (Pantalla 1, sección 3.3)

**Decisión: componente SVG nuevo, hermano de `DualTrendChart.vue`, no una
generalización de un componente existente.** Mismo argumento que ya usa
`debts-ux.md` para justificar por qué `DualTrendChart` es hermano de
`TrendAreaChart` y no una extensión: la geometría es fundamentalmente
distinta (barras agrupadas por categoría discreta — 6 meses — vs. una curva
continua), forzar un único componente con un prop `variant="bar"|"line"`
metería condicionales de geometría (paths vs. rects) en el mismo archivo sin
ganar nada a cambio. `chart.js` sigue descartado por el mismo motivo de
`dashboard-redesign-ux.md` sección 0 (canvas no repinta solo con el cambio
de tema).

```ts
export interface MonthlyBarPoint {
  /** Etiqueta corta de mes, ej. "Ene", "Feb" — ya formateada (mismo
   * contrato que DualTrendPoint.label). */
  label: string
  income: number
  expense: number
}
defineProps<{
  points: MonthlyBarPoint[]  // longitud fija 6, orden ascendente
  height?: number             // default 140 (más alto que TrendAreaChart:
                               // hay 2 barras + leyenda, necesita más aire)
  ariaLabel: string
}>()
```

Geometría (`viewBox="0 0 100 32"`, `preserveAspectRatio="none"`, mismo
esqueleto que `DualTrendChart`):
- 6 "slots" de mes, ancho `100/6 ≈ 16.67` cada uno. Dentro de cada slot, 2
  `<rect>` (ingreso primero, gasto segundo), separados por un gap chico
  (~10% del ancho del slot), centrados dentro del slot.
- Altura de cada barra: `(valor / maxAmount) * (32 - 4)` (mismo margen
  superior `TOP_MARGIN=4` que el resto de gráficos), ancladas a `y=32`
  (línea base).
- `maxAmount` = máximo entre **ambas** series de los 6 meses (mismo
  principio que `DualTrendChart`: una escala compartida, no una por serie,
  para que se puedan comparar visualmente ingreso vs. gasto del mismo mes).
- Colores: ingreso `hsl(var(--success))`, gasto `hsl(var(--destructive))` —
  **mismos colores que ya usa el signo del monto en toda la app** (`design-
  system.md`, "gasto = destructive, ingreso = success"), no una paleta nueva.
- `rx="1"` en los `<rect>` (esquinas levemente redondeadas, consistente con
  `--radius` del sistema, sin exagerar en un elemento tan chico).
- Fila de eje Y arriba (`"Hasta $X"`, mismo patrón que `TrendAreaChart`
  `showAxis`) + 6 etiquetas de mes debajo del SVG (fila HTML aparte, mismo
  motivo que `axisLabels` de `TrendAreaChart`: texto nativo dentro de un SVG
  con `preserveAspectRatio="none"` sale deformado).
- **Leyenda** (a diferencia de `TrendAreaChart`, acá sí hace falta: 2 series
  sin leyenda no se distinguen solo por posición): fila HTML debajo del eje
  X, 2 items `<span class="size-2.5 rounded-full" :style="background:
  ..."/><span>Ingresos</span>` / `Gastos`, mismo criterio de a11y "color
  nunca solo" ya aplicado en cualquier leyenda de dona del proyecto.
- `<svg role="img" :aria-label="ariaLabel">` — a diferencia de la dona
  (`aria-hidden`), acá el SVG **sí** lleva `aria-label` porque, a diferencia
  de "Ingresos vs gastos" que además tiene los 4 tiles arriba con los
  números exactos del mes seleccionado, este gráfico de 6 meses es la
  **única** superficie que muestra esos 5 meses anteriores — no hay tabla
  equivalente en texto en esta pantalla. Un `aria-label` descriptivo
  (`"Ingresos y gastos de los últimos 6 meses"`) es el mínimo aceptable;
  no hace falta una tabla oculta adicional para esta iteración.

Helper en `src/lib/charts.ts`: `buildMonthlyBarPoints(rows:
{month_start: string, expense_total: number, income_total: number}[]):
MonthlyBarPoint[]` — mapea las 6 filas de `monthly_expense_income_totals`
(ya vienen ordenadas por mes, verificar `order by month_start asc` en la
vista) a `{ label: MONTHS_ES_SHORT[...], income, expense }`, reusando la
constante `MONTHS_ES_SHORT` ya exportada por `charts.ts`.

### 6.2 `CategoryVariationBars.vue` (Pantalla 3, sección 5.4)

**Decisión: no SVG.** Es un caso de "barra de magnitud" (como "Por mes" de
`StatisticsView.vue` o los rankings de Tarjetas), no una curva ni una
composición de múltiples paths — no hay razón para pagar la complejidad de
un `viewBox`/`vector-effect` cuando `<div>` + `width` en porcentaje ya
resuelve el mismo resultado visual con menos código, mismo criterio que ya
aplica el proyecto en esos otros 3 lugares.

```ts
export interface CategoryVariationRow {
  id: string
  name: string
  percent: number       // siempre positivo, la dirección va en `direction`
  direction: 'up' | 'down'
}
defineProps<{ rows: CategoryVariationRow[] }>()  // ya filtradas (sin `null`, sección 5.4)
```

Geometría: pista central (`bg-muted`, `h-2 rounded-full`) con una línea fina
en el centro (`bg-border`, `w-px`, posición `left-1/2`) marcando el 0%. Cada
barra ocupa como máximo **la mitad** de la pista (desde el centro hacia un
lado), escalada contra el máximo `|percent|` del conjunto (mismo patrón
`percentOfMax` ya usado en "Por mes"/rankings — evita que una sola categoría
con +400% aplaste visualmente a las demás si se escalara contra un tope
fijo):

```html
<div v-for="row in scaledRows" :key="row.id" class="flex items-center gap-2">
  <span class="w-24 shrink-0 truncate text-xs text-muted-foreground">{{ row.name }}</span>
  <div class="relative h-2 flex-1 rounded-full bg-muted">
    <div class="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
    <div
      class="absolute inset-y-0 rounded-full"
      :class="row.direction === 'up' ? 'left-1/2 bg-destructive' : 'right-1/2 bg-success'"
      :style="{ width: `${row.barWidthPercent}%` }"
    />
  </div>
  <span class="flex w-16 shrink-0 items-center justify-end gap-0.5 text-xs font-medium tabular-nums" :class="row.direction === 'up' ? 'text-destructive' : 'text-success'">
    <component :is="row.direction === 'up' ? ArrowUp : ArrowDown" class="size-3" />
    {{ Math.round(row.percent) }}%
  </span>
</div>
```

`barWidthPercent` = `(percent / maxAbsPercent) * 50` (mitad de la pista es
el 100% relativo del set) — cálculo en un `computed` dentro del componente
(recibe `rows` ya con `percent`/`direction`, deriva `barWidthPercent`
internamente, no le pidas a la vista que lo precalcule). Mismo criterio de
a11y de siempre: color + ícono + texto, nunca la barra sola.

---

## 7. Estados de carga/vacío/error — patrón general (las 3 pantallas)

Calcado de `ReportsView.vue` (no reinventar):

- **Carga**: `Skeleton` con tamaño aproximado al contenido final, agrupado
  por sección (una `Card` de Skeletons por bloque real de la pantalla), sin
  spinner bloqueante.
- **Error**: `AlertCircle` (`text-destructive`, `size-12`) + título corto +
  descripción + `Button variant="outline"` con `RotateCcw` + "Reintentar",
  mismo copy de tono ("No pudimos cargar...", "Revisá tu conexión e intentá
  de nuevo.").
- **Vacío**: `FileText`/`Inbox` (`text-muted-foreground`, `size-12`) +
  mensaje honesto específico del contexto (no un genérico "no hay datos") +
  CTA solo cuando tiene sentido (p. ej. "Agregar transacción" si el mes
  vacío es el mes actual — no mostrar ese CTA para un mes pasado, no se
  puede "agregar" retroactivamente algo que ya cerró desde la perspectiva
  del reporte, aunque técnicamente el formulario permita fecha pasada; mismo
  criterio ya usado por `ReportsView.vue` con `v-if="isCurrentMonth"`).

---

## 8. Accesibilidad — puntos específicos de este documento

(Además de todo lo ya cubierto por `design-system.md` — contraste, foco
visible, `text-base` en inputs, confirmación antes de destruir no aplica acá
porque no hay acciones destructivas en estas 3 pantallas de solo lectura.)

1. **Deltas de los 4 tiles (Pantallas 1 y 3)**: ícono de dirección + texto +
   color, nunca color solo — igual que `expenseDelta` ya establecido.
2. **`MonthlyBarChart`**: `role="img"` + `aria-label` descriptivo (a
   diferencia de las donas, que son `aria-hidden` porque su info ya está en
   texto adyacente — acá no hay una tabla de texto equivalente en la misma
   pantalla, ver justificación completa en 6.1).
3. **`CategoryVariationBars`**: la barra es puramente decorativa/redundante
   con el texto (nombre + ícono + `%` a los costados ya son texto real) —
   no necesita `role`/`aria-label` propio, mismo criterio que las barras de
   "Por mes" de `StatisticsView.vue`.
4. **Badges "Nuevo"/"Ya no aparece"** (sección 5.3): texto explícito, no solo
   color — cumple la regla general sin necesitar nada adicional.
5. **2 `Select` de la Pantalla 3**: cada uno con su `<p>` de label visible
   arriba (`Mes A`/`Mes B`), asociado por posición/`aria-describedby` igual
   que el patrón ya usado en `ReportsView.vue` — nunca placeholder-only.
6. **Área táctil**: filas de `moreReportsLinks` (sección 2) `min-h-11`,
   mismo criterio que cualquier fila de navegación del proyecto.
7. **Tablas-como-card-list** (secciones 4.6 y 5.3): encabezado de columnas
   visible en texto (`text-xs uppercase text-muted-foreground`) para que la
   estructura tabular se entienda sin depender de alineación visual sola —
   un lector de pantalla igual navega cada fila como texto secuencial
   (`categoría, cantidad, monto, %`), que ya es coherente sin necesitar
   `role="table"`/`role="row"` (se evita esa complejidad de ARIA, no aporta
   nada sobre una lista de `<div>`s con buen orden de lectura).

---

## 9. Resumen accionable para `vue-frontend-expert`

1. **Router**: agregar `reports-summary` (`/reportes/resumen`),
   `reports-detail` (`/reportes/detalle-mes`), `reports-comparison`
   (`/reportes/comparacion`) a `src/router/index.ts` (sección 1). Sin
   cambios en `NavigationDrawer.vue`.
2. **`ReportsView.vue`**: **una única edición permitida** — agregar el
   `<section>` "Más reportes" (sección 2) entre el selector de mes y los
   bloques condicionales de estado, más el array `moreReportsLinks` y 4
   imports de ícono nuevos (`LayoutDashboard`, `Layers`, `GitCompareArrows`,
   `ChevronRight`). Nada más de ese archivo se toca.
3. **3 vistas nuevas**: `ReportsSummaryView.vue` (sección 3),
   `ReportsMonthDetailView.vue` (sección 4), `ReportsComparisonView.vue`
   (sección 5) — cada una con su propio selector de mes (o 2, en
   Comparación) y su propio `onMounted`/`watch` de carga, mismo patrón
   independiente que ya usa cada vista de la app (sin prefetch compartido).
4. **2 componentes de gráfico nuevos** en `src/components/charts/`:
   `MonthlyBarChart.vue` (SVG, hermano de `DualTrendChart`, sección 6.1) y
   `CategoryVariationBars.vue` (`<div>`s, no SVG, sección 6.2). **Sin
   dependencias nuevas** — mismo criterio de `dashboard-redesign-ux.md`
   sección 0.
5. **`src/lib/charts.ts`**: agregar `buildMonthlyBarPoints()` (sección 6.1).
   Reusar `buildDonutSlices`, `MONTHS_ES_SHORT`, `CategoryDonutChart`,
   `CategoryTotal`/`DonutSlice` tal cual ya existen — son domain-agnostic
   (el nombre "Category" es histórico, ya se reusan hoy para tarjetas/
   personas en `CardsDashboardView.vue`, y acá se reusan también para
   Tarjeta/Cuenta de "Métodos de pago").
6. **`src/lib/reportInsights.ts`** (nuevo, solo para `ReportsSummaryView`):
   duplicación intencional y documentada de `buildInsights`/
   `summarizeCategories`/`summarizeAccounts`/`shortDateLabel` de
   `ReportsView.vue` — justificada en sección 3.6 por la restricción dura de
   no tocar ese archivo. No exportar nada de `ReportsView.vue`.
7. **Reusar sin cambios**: patrón del `Select` de mes de `ReportsView.vue`
   (duplicado en las 3 pantallas nuevas, mismo argumento de la restricción),
   `peopleRanking`/`cardsRanking` de `CardsDashboardView.vue` como
   referencia de estilo para "Por tarjeta"/"Por persona" (sección 4.2-4.3),
   `buildVariation()` de `FixedExpensesComparisonView.vue` para los tiles de
   Comparación (sección 5.2, con el caso especial de "Ahorro" en puntos
   porcentuales).
8. **Estados de carga/vacío/error**: mismo patrón visual de `ReportsView.vue`
   en las 3 pantallas nuevas (sección 7) — Skeleton por sección, `AlertCircle`
   + Reintentar, vacío honesto con CTA condicional.
9. **Fuera de alcance, explícito**: la 4ª pantalla de la referencia del PO
   ("Generar reporte") no se diseña ni se menciona más allá de esta
   exclusión. `npm run build` limpio antes de cerrar, mismo estándar del
   resto del proyecto.
