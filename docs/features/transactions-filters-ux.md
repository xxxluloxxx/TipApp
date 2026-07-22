# TipApp — UX de Filtros de Transacciones (`/transacciones`)

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, a11y) y en `src/views/TransactionsView.vue` tal como existe hoy
(feed global mezclado de gasto/ingreso/transferencia/movimiento de deuda
vinculado, sin ningún filtro, ver `src/lib/transactionItems.ts`). Precedente
directo más cercano: `src/views/CardTransactionsView.vue`
(`docs/features/credit-cards-ux.md` sección 3) — filtros de mes (obligatorio)
+ tarjeta + persona en una fila horizontal scrolleable de 3 `Select` debajo
del `AppHeader`. Este documento adapta ese patrón a un caso con **4**
filtros, dos de ellos server-side y dos client-side, con una regla nueva de
mes **no obligatorio**.

**Alcance de v1, fijado por el Product Owner, no se reabre acá**: 4 filtros
— Mes, Cuenta, Tipo de movimiento, Búsqueda por texto. **Categoría y rango de
monto quedan explícitamente fuera de v1** (ver sección 11). El contrato de
qué es server-side/client-side y la fórmula de "saldo después del
movimiento" ya están decididos por el Product Owner; este documento define
layout, copy, estados y la forma concreta de los métodos de store nuevos que
hacen falta para cumplir ese contrato (sin RPC ni vista nueva — todo con
columnas ya existentes: `account_id`, `expense_date`/`income_date`/
`transfer_date`/`movement_date`).

---

## 1. Resumen de los 4 filtros

| # | Filtro | Tipo | Default | Dispara fetch nuevo |
|---|---|---|---|---|
| 1 | Mes | server-side | **"Todos los meses"** | Sí |
| 2 | Cuenta | server-side | "Todas las cuentas" | Sí |
| 3 | Tipo de movimiento | client-side | "Todos los tipos" | No |
| 4 | Búsqueda por texto | client-side | vacío | No |

A diferencia de `CardTransactionsView` (mes obligatorio, siempre acotado a
uno), acá el default de Mes es explícitamente "Todos los meses" — preserva el
comportamiento actual de la pantalla (sin filtro) para quien nunca toca los
controles.

---

## 2. Layout — 2 filas debajo de `AppHeader`, sin `Sheet` de "Más filtros"

Se evaluó agrupar Tipo+Búsqueda en un panel separado (opción que ofrecía el
encargo) y se descarta: con solo 4 controles, de los cuales 3 ya son
`Select` chicos de ancho automático (patrón ya resuelto por
`CardTransactionsView`) y el cuarto es un `Input` que de por sí necesita todo
el ancho disponible para ser cómodo de tipear, **no hace falta ninguna
jerarquía de "filtros primarios vs. secundarios" nueva** — meter Tipo detrás
de un botón "Más filtros" agregaría un tap extra a un filtro tan frecuente
como Cuenta, sin ganar nada a cambio (no hay 6+ controles que ameriten
esconder algo). La solución: **no forzar los 4 en una sola fila** (el pedido
explícito de no apretarlos), pero tampoco esconder ninguno — se separan en 2
filas por tipo de control, ambas siempre visibles:

```html
<AppHeader title="Transacciones" />

<!-- Fila 1: los 3 Select, scrolleable horizontal — mismo patrón que
     CardTransactionsView (credit-cards-ux.md sección 3.1) -->
<div v-if="!isInitialLoading && !loadError" class="flex flex-col gap-2 px-4 py-3 sm:px-6 lg:px-8">
  <div class="flex gap-2 overflow-x-auto">
    <Select v-model="filters.month">
      <SelectTrigger class="h-11 w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="ALL_MONTHS">Todos los meses</SelectItem>
        <SelectItem v-for="option in monthOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </SelectItem>
      </SelectContent>
    </Select>

    <Select v-model="filters.accountId">
      <SelectTrigger class="h-11 w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="ALL_ACCOUNTS">Todas las cuentas</SelectItem>
        <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
          {{ account.name }}
        </SelectItem>
      </SelectContent>
    </Select>

    <Select v-model="filters.type">
      <SelectTrigger class="h-11 w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="ALL_TYPES">Todos los tipos</SelectItem>
        <SelectItem value="expense">Gastos</SelectItem>
        <SelectItem value="income">Ingresos</SelectItem>
        <SelectItem value="transfer">Transferencias</SelectItem>
        <SelectItem value="debt-linked">Deuda vinculada</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <!-- Fila 2: búsqueda, ancho completo -->
  <div class="relative">
    <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      v-model="filters.search"
      type="text"
      inputmode="search"
      placeholder="Buscar por descripción, categoría, cuenta o persona…"
      class="h-11 pl-9"
      :class="{ 'pr-9': filters.search }"
    />
    <button
      v-if="filters.search"
      type="button"
      class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Borrar búsqueda"
      @click="filters.search = ''"
    >
      <X class="size-4" />
    </button>
  </div>

  <!-- Fila 3 (condicional): indicador + limpiar, sección 2.1 -->
  <div v-if="activeFilterCount > 0" class="flex items-center justify-between">
    <span class="text-xs text-muted-foreground">
      {{ activeFilterCount }} filtro{{ activeFilterCount === 1 ? '' : 's' }} activo{{ activeFilterCount === 1 ? '' : 's' }}
    </span>
    <button
      type="button"
      class="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      @click="clearFilters"
    >
      Limpiar filtros
    </button>
  </div>
</div>
```

Por qué este orden (Selects arriba, Búsqueda debajo, indicador al final):
narrows estructurales primero (mes/cuenta/tipo — acotan "qué universo de
movimientos"), refinamiento libre después (búsqueda — acota "cuál de esos
en particular"). Mismo criterio de lectura de arriba-abajo que ya usa
`CardTransactionsView` (mes → tarjeta → persona, de lo más amplio a lo más
específico).

Iconos nuevos a importar en `TransactionsView.vue`: `Search`, `X` (ambos ya
existen en `@lucide/vue`, no requieren instalación).

### 2.1 Indicador "N filtros activos" + "Limpiar filtros"

```ts
const activeFilterCount = computed(() => {
  let n = 0
  if (filters.month !== ALL_MONTHS) n++
  if (filters.accountId !== ALL_ACCOUNTS) n++
  if (filters.type !== ALL_TYPES) n++
  if (filters.search.trim() !== '') n++
  return n
})

function clearFilters() {
  filters.month = ALL_MONTHS
  filters.accountId = ALL_ACCOUNTS
  filters.type = ALL_TYPES
  filters.search = ''
}
```

Solo se renderiza si `activeFilterCount > 0` — con los 4 defaults activos
(pantalla recién entrada) no hay nada que "limpiar", mostrar la fila igual
sería ruido permanente. `clearFilters` resetea los 4 a la vez en una sola
mutación reactiva (Vue agrupa el `watch` disparado por `month`/`accountId` en
un solo re-fetch, no dos).

---

## 3. Estrategia de datos

### 3.1 Mes + Cuenta — server-side, reemplazan el fetch global cuando alguno no está en su default

Se agrega un método nuevo por store (`expenses.ts`, `incomes.ts`,
`accountTransfers.ts`, `debts.ts`), mismo patrón que
`cardExpensesStore.fetchByDateRange` (`credit-cards-ux.md` sección 3.1) pero
con `from`/`to`/`accountId` **todos opcionales** — a diferencia de tarjetas
(mes siempre obligatorio), acá los 3 parámetros pueden faltar a la vez
(equivalente exacto al fetch global de hoy, mismo `.limit()` defensivo ya
existente):

```ts
// src/stores/expenses.ts — método nuevo, mismo SAFETY_LIMIT que fetchAll
export interface DateAccountFilter {
  from?: string // 'YYYY-MM-DD', inclusive
  to?: string   // 'YYYY-MM-DD', exclusive
  accountId?: string
}

async function fetchFiltered(filter: DateAccountFilter, limit = MAX_EXPENSES): Promise<ExpenseWithCategory[] | null> {
  let query = supabase
    .from('expenses')
    .select('*, category:categories(*)')
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filter.from) query = query.gte('expense_date', filter.from)
  if (filter.to) query = query.lt('expense_date', filter.to)
  if (filter.accountId) query = query.eq('account_id', filter.accountId)

  const { data, error } = await query
  if (error) {
    console.error('[expenses] No se pudieron cargar los movimientos filtrados', error)
    return null
  }
  return (data ?? []) as unknown as ExpenseWithCategory[]
}
```

- **`incomes.ts`**: mismo método, `income_date` en vez de `expense_date`.
- **`accountTransfers.ts`**: mismo método, `transfer_date`; el filtro de
  cuenta usa `.or(\`from_account_id.eq.${filter.accountId},to_account_id.eq.${filter.accountId}\`)`
  en vez de `.eq()` — mismo criterio ya resuelto por
  `fetchRecentForAccount` de ese store (account-detail-ux.md sección 7.1).
- **`debts.ts`**: mismo método, `movement_date`, **siempre** con
  `.not('account_id', 'is', null)` incondicional (es la definición de
  "movimiento con cuenta vinculada" que ya usa `fetchAccountLinkedMovements`,
  no algo nuevo que este filtro decida) + `.eq('account_id', ...)` opcional
  encima si `filter.accountId` viene seteado.

Cuando `filters.month === ALL_MONTHS` y `filters.accountId === ALL_ACCOUNTS`
(el estado inicial de la pantalla), los 4 `fetchFiltered({})` se comportan
**exactamente igual** que los `fetchAll()`/`fetchAccountLinkedMovements()` de
hoy (mismos límites `MAX_EXPENSES`/`MAX_INCOMES`/`MAX_TRANSFERS`/
`ACCOUNT_LINKED_MOVEMENTS_LIMIT`) — no hace falta mantener dos caminos de
código en la vista; `TransactionsView` llama siempre a `fetchFiltered`, con
argumentos vacíos quedando implícito el `undefined` de cada campo.

```ts
// TransactionsView.vue
const dateRangeForSelectedMonth = computed<{ from?: string, to?: string }>(() => {
  if (filters.month === ALL_MONTHS) return {}
  const option = monthOptions.value.find(o => o.value === filters.month)
  if (!option) return {}
  return { from: formatDateOnly(option.start), to: formatDateOnly(option.end) }
})

async function loadFilteredTransactions() {
  const range = dateRangeForSelectedMonth.value
  const accountId = filters.accountId !== ALL_ACCOUNTS ? filters.accountId : undefined

  const [expensesRes, incomesRes, transfersRes, debtRes] = await Promise.all([
    expensesStore.fetchFiltered({ ...range, accountId }),
    incomesStore.fetchFiltered({ ...range, accountId }),
    accountTransfersStore.fetchFiltered({ ...range, accountId }),
    debtsStore.fetchFiltered({ ...range, accountId }),
  ])
  // ... análogo al `loadAll` actual: null en cualquiera → loadError
}
```

`monthOptions` es el mismo `computed` que ya usa `CardTransactionsView`
(últimos 12 meses, `currentMonthLabel`), con **un ítem extra al principio**
(`{ value: ALL_MONTHS, label: 'Todos los meses' }`) que no participa del
cálculo de `start`/`end` (rama `if (filters.month === ALL_MONTHS) return {}`
ya lo contempla arriba).

### 3.2 Tipo de movimiento — client-side, sobre `mergedItems`

```ts
type TypeFilter = 'all' | 'expense' | 'income' | 'transfer' | 'debt-linked'

function matchesType(item: TransactionItem, type: TypeFilter): boolean {
  if (type === 'all') return true
  if (type === 'transfer') return item.kind === 'transfer-out' || item.kind === 'transfer-in'
  return item.kind === type
}
```

Agrupa `transfer-out`/`transfer-in` bajo un único valor "Transferencia" en el
`Select` (ver 2), tal como pide el encargo — el usuario nunca necesita saber
que son 2 variantes sintéticas internas.

### 3.3 Búsqueda por texto — client-side, mismo texto que ya renderiza cada fila

Filtra por `itemTitle(item)` (la función ya existente en
`TransactionsView.vue`, sin cambios) — es literalmente "lo que ya ves en
pantalla", ningún campo oculto nuevo. Case/diacritic-insensitive, mismo
criterio ya usado por la Edge Function `search-matches` (`live-matches-ux.md`
sección 5.1) para el buscador de partidos — primer precedente de
normalización de texto en el **frontend**, se agrega un helper chico nuevo:

```ts
// src/lib/text.ts (archivo nuevo, un solo export)
/** Normaliza para comparación insensible a mayúsculas/diacríticos — mismo
 * criterio ya usado server-side por la Edge Function `search-matches`
 * (live-matches-ux.md sección 5.1), ahora también en cliente. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
```

```ts
function matchesSearch(item: TransactionItem, query: string): boolean {
  if (!query) return true
  return normalizeSearchText(itemTitle(item)).includes(normalizeSearchText(query))
}
```

Sin debounce (confirmado por el encargo): la lista ya está en memoria tras
el fetch de Mes/Cuenta, filtrar en cada tecla es instantáneo, no hay ninguna
llamada de red que throttlear.

### 3.4 Orden de aplicación de los 4 filtros

Mes y Cuenta ya vienen aplicados por el servidor (no hay nada que hacer en
cliente para ellos, section 3.1). Sobre el resultado ya mezclado
(`buildTransactionItems`/`buildAccountTransactionItems`, ver 3.5), se
encadenan Tipo → Búsqueda:

```ts
const filteredItems = computed<TransactionItem[]>(() =>
  mergedItems.value
    .filter(item => matchesType(item, filters.type))
    .filter(item => matchesSearch(item, filters.search)),
)
```

`groupedItems` (agrupación por encabezado de fecha, sección 3.1 del código
actual) pasa a iterar `filteredItems` en vez de `mergedItems` — único cambio
en esa función.

### 3.5 Reuso de `buildAccountTransactionItems` cuando hay filtro de Cuenta

Cuando `filters.accountId !== ALL_ACCOUNTS`, las transferencias que
involucran esa cuenta ya vienen acotadas por el `.or()` de 3.1, pero
`buildTransactionItems` sigue generando **las 2 variantes sintéticas** por
cada transferencia (`transfer-out` y `transfer-in`) — mostraría la cuenta
filtrada apareciendo también como si fuera "la otra punta" de sí misma. Ya
existe la función correcta para este caso exacto:
`buildAccountTransactionItems` (`src/lib/transactionItems.ts`, escrita para
`AccountDetailView.vue`, `account-detail-ux.md` sección 7.2) — filtra a la
variante que corresponde según de qué lado participa la cuenta. Se reusa tal
cual, sin escribir una tercera función:

```ts
const mergedItems = computed<TransactionItem[]>(() => {
  if (filters.accountId !== ALL_ACCOUNTS) {
    return buildAccountTransactionItems(
      expensesStore.filteredExpenses,
      incomesStore.filteredIncomes,
      accountTransfersStore.filteredTransfers,
      filters.accountId,
      debtsStore.filteredDebtLinkedMovements,
    )
  }
  return buildTransactionItems(
    expensesStore.filteredExpenses,
    incomesStore.filteredIncomes,
    accountTransfersStore.filteredTransfers,
    debtsStore.filteredDebtLinkedMovements,
  )
})
```

(`filteredExpenses`/etc. son los 4 `ref` locales que reciben el resultado de
`fetchFiltered`, análogos a los `ref`s de hoy — no hace falta que sean
propiedad del store, pueden vivir en la vista igual que
`debtLinkedMovements` ya vive hoy como `ref` local de `TransactionsView`.)

---

## 4. Loading al cambiar Mes o Cuenta — estado intermedio liviano

Mismo criterio que `isLoadingTransactions` de `CardTransactionsView`: **no**
se repite el skeleton de carga inicial completo (ese sigue siendo para el
primer montaje de la pantalla). Se agrega un segundo booleano:

```ts
const isInitialLoading = ref(true)   // primer montaje, ya existe
const isRefetching = ref(false)      // nuevo: cambio de Mes/Cuenta

watch(() => [filters.month, filters.accountId], async () => {
  if (isInitialLoading.value) return
  isRefetching.value = true
  await loadFilteredTransactions()
  isRefetching.value = false
})
```

```html
<!-- Reemplaza el listado mientras se re-consulta, filtros y FAB siguen
     interactivos (mismo criterio que CardTransactionsView: no se bloquea
     la pantalla completa por un cambio de Select) -->
<template v-else-if="isRefetching">
  <div class="flex flex-col gap-3">
    <Card v-for="i in 3" :key="i" class="p-4 sm:p-6">
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-2">
          <Skeleton class="h-4 w-32" />
          <Skeleton class="h-5 w-20 rounded-full" />
        </div>
        <Skeleton class="h-5 w-16" />
      </div>
    </Card>
  </div>
</template>
```

3 Cards de skeleton (no 4, para diferenciar visualmente — sutil pero
consistente — del skeleton de carga inicial, mismo criterio de "más liviano"
que separa a `CardTransactionsView` en 3 vs. 2). Tipo/Búsqueda **no** entran
en este `watch` — son instantáneos sobre datos ya en memoria, no hay ningún
estado de carga que mostrar para ellos.

**Nota de implementación, no bloqueante**: igual que `CardTransactionsView`
ya acepta hoy (no es una regresión nueva de este documento), un usuario
cambiando Mes y Cuenta muy rápido en sucesión puede, en teoría, ver
resolverse una respuesta vieja después de una más nueva (sin guard de
`requestId`). Mismo riesgo ya aceptado en el precedente directo, no se
resuelve acá — si se quiere corregir, es un cambio simétrico en ambas
vistas, fuera del alcance de este encargo.

---

## 5. Estados vacíos — 2 casos a distinguir

### 5.1 "Todavía no registraste ningún movimiento" (sin cambios de copy)

Se mantiene el copy actual (`Receipt` + "Todavía no registraste ningún
movimiento" + botón "Agregá tu primer movimiento"), pero su condición de
disparo deja de ser simplemente `mergedItems.length === 0` — con filtros de
por medio, una lista vacía puede significar "no hay nada que coincida", no
"no hay nada, punto". Se resuelve con un flag que se fija **una sola vez**,
en la primera carga (que ocurre siempre con los 4 filtros en su default,
equivalente al fetch sin filtrar de hoy), y nunca se recalcula después:

```ts
// Se fija en loadAll() (primer montaje, filtros ya están en su default en
// ese momento), nunca se vuelve a tocar tras esa carga inicial.
const hasAnyMovementEver = ref<boolean | null>(null)

async function loadAll() {
  // ...fetch inicial (equivalente a fetchFiltered({}) en los 4 stores)...
  if (hasAnyMovementEver.value === null) {
    hasAnyMovementEver.value = mergedItems.value.length > 0
  }
}
```

Por qué es seguro: si el usuario literalmente no tiene ningún movimiento
(`hasAnyMovementEver === false`), **ninguna** combinación de filtros puede
hacer aparecer uno — no hace falta re-evaluar esto en cada cambio de filtro,
el resultado ya está decidido para siempre en esa sesión (hasta que se cree
el primer movimiento real, que de todos modos dispara su propio flujo
optimista y sale de este estado).

### 5.2 "Ningún movimiento coincide con estos filtros" (copy nuevo)

Se dispara cuando `hasAnyMovementEver === true` pero `filteredItems.length
=== 0` (hay datos, pero la combinación actual de filtros no matchea nada):

```html
<template v-else-if="isEmpty && hasAnyMovementEver === false">
  <!-- 5.1, sin cambios -->
</template>
<template v-else-if="isEmpty">
  <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
    <SearchX class="size-12 text-muted-foreground" />
    <h2 class="text-lg font-semibold">
      Ningún movimiento coincide con estos filtros
    </h2>
    <p class="max-w-xs text-center text-sm text-muted-foreground">
      Probá con otra combinación o limpiá los filtros para ver todo de nuevo.
    </p>
    <Button variant="outline" @click="clearFilters">
      Limpiar filtros
    </Button>
  </div>
</template>
```

(`isEmpty` pasa a leer `filteredItems.length === 0` en vez de
`mergedItems.length === 0`.) Ícono `SearchX` (nuevo import, ya disponible en
`@lucide/vue`) — deliberadamente distinto de `Receipt`, para que el usuario
reconozca de un vistazo que está en el caso "hay datos, pero los tapaste con
un filtro" y no en el caso "recién empezás a usar la app". El FAB "+" sigue
visible en ambos casos (`showMainActions`, sin cambios) — agregar un
movimiento sigue siendo una acción válida incluso con filtros activos.

---

## 6. "Saldo después de este movimiento" — omisión en mes pasado específico

Regla ya fijada por el Product Owner: se sigue mostrando sin cambios cuando
Mes es "Todos los meses" **o** el mes actual; se **omite** (sin número, no
un número incorrecto) cuando se filtra a un mes pasado específico. Precedente
directo en el propio código: `balanceSafeBoundaryDate`/`balanceAfter` ya
omiten el dato "silenciosamente" (sin badge de advertencia) cuando el ítem
es más viejo que el límite seguro de algún fetch capado — se extiende el
mismo `balanceAfter` con una condición más, evaluada primero:

```ts
const currentMonthValue = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})

// Mes pasado específico: ni "Todos los meses" ni el mes en curso.
const isPastSpecificMonth = computed(
  () => filters.month !== ALL_MONTHS && filters.month !== currentMonthValue.value,
)

function balanceAfter(item: TransactionItem): number | null {
  if (isPastSpecificMonth.value) return null
  if (balanceSafeBoundaryDate.value !== null && item.date <= balanceSafeBoundaryDate.value) return null
  return runningBalances.value.get(`${item.kind}-${item.id}`) ?? null
}
```

**Por qué es una regla distinta de `balanceSafeBoundaryDate`** (no una
extensión de esa misma lógica): `balanceSafeBoundaryDate` protege contra
"no cargué suficiente historial hacia atrás" (un problema de límite de
fetch). Filtrar a un mes pasado introduce un problema **estructural**
distinto: `computeRunningBalances` arranca desde el saldo actual de HOY
(`accountsStore.balanceFor`) y camina hacia atrás sumando/restando el
impacto de cada ítem de la lista cargada — si esa lista solo contiene
movimientos de, digamos, marzo, el acumulador nunca revierte el efecto de
abril-julio (esos movimientos no están en la lista filtrada), así que el
"saldo después" que le asignaría a cualquier fila de marzo sería en realidad
el saldo de HOY menos únicamente el neto de marzo — un número real pero que
no responde la pregunta que la columna promete ("¿cuánto quedó en la cuenta
justo después de este movimiento puntual?"). Se omite siempre para mes
pasado específico, sin excepción, independientemente de si el fetch de ese
mes llegó o no a su límite.

**Copy de la omisión**: ninguno — mismo criterio que el caso ya existente de
`balanceSafeBoundaryDate` (`v-if="balanceAfter(item) !== null"` ya oculta la
línea entera sin dejar un placeholder ni un ícono de advertencia). No hace
falta un tooltip ni un texto explicando por qué falta el número en ese caso
puntual — es consistente con que la fila de arriba (mes actual/"Todos los
meses") sí lo muestra, y el usuario ya está viendo activamente que filtró a
un mes específico (el propio `Select` de Mes ya se lo confirma).

**Nota de implementación, no bloqueante**: cuando `isPastSpecificMonth` es
`true`, `computeRunningBalances(...)` sigue ejecutándose sobre
`filteredItems` aunque su resultado nunca se use (todas las filas devuelven
`null` en `balanceAfter`) — cálculo barato (mismo `Map` de siempre, sin
llamada de red) así que no es un problema de performance real, pero
`vue-frontend-expert` puede saltearlo del todo con un `computed` condicional
si prefiere no correr trabajo innecesario.

---

## 7. ¿Tiene sentido un "Total" al pie? — decisión: no, se omite

`CardTransactionsView` muestra un total al pie del mes filtrado porque **su**
lista es una sola magnitud homogénea: gastos de tarjeta, todos con el mismo
signo, sumar tiene un significado directo ("cuánto gasté con tarjeta este
mes"). Acá el feed mezcla **4 tipos con signos y semánticas distintas**:
gasto (negativo real), ingreso (positivo real), las 2 caras de una
transferencia (que se cancelan entre sí si ambas puntas están en la lista —
`+monto` y `-monto` del mismo evento) y un movimiento de deuda (signo de la
deuda, no de la caja — sección de contexto de `transactionItems.ts`). Sumar
esos 4 signos en un solo número no responde ninguna pregunta real del
usuario: no es "cuánto gasté" (eso ya existe en `/estadisticas`), no es
"cuánto entró/salió de mi patrimonio" (una transferencia entre cuentas
propias no cambia patrimonio, un préstamo tampoco es un gasto real — mismo
argumento ya usado en `debts-ux.md`/`account-transfers-ux.md` para excluir
ambos de cualquier total agregado en cliente), y mezclar tipos con un filtro
de Tipo=Todos activo lo haría todavía más confuso al variar de significado
según qué filtros estén puestos. **Se omite el total.** Si el Product Owner
quiere en el futuro un resumen del período filtrado, la vía correcta es
mostrar 2-3 números separados por tipo (p. ej. "Gastos: $X · Ingresos: $Y"),
no una sola cifra neta — pero eso no fue pedido en este encargo y queda
fuera de alcance.

---

## 8. Componentes shadcn-vue — ninguno nuevo

`Select`, `Input`, `Card`, `Skeleton`, `Button` ya están instalados
(`ls src/components/ui/`) y ya se usan en `TransactionsView.vue`/
`CardTransactionsView.vue` con exactamente el mismo propósito que necesita
este documento. No hace falta `Popover`, `Command`/Combobox ni ningún otro
componente nuevo — se descartó explícitamente un panel de "Más filtros" en
la sección 2, que hubiera sido el único motivo para instalar algo nuevo
(p. ej. un `Sheet` anidado o un `Popover`).

---

## 9. Router — sin cambios

Sin ruta nueva, sin query params nuevos (a diferencia de `?new=1` o
`?cardId=`, los filtros de esta pantalla no se persisten en la URL en v1 —
no fue pedido por el encargo y mantiene el alcance acotado; candidato futuro
si se quiere compartir/bookmarkear una vista filtrada).

---

## 10. Checklist de impacto en código existente — para `vue-frontend-expert`

- **`src/views/TransactionsView.vue`**: agrega el estado `filters`
  (`reactive`), `activeFilterCount`, `clearFilters`, `monthOptions` (mismo
  cálculo que `CardTransactionsView` + ítem "Todos los meses"),
  `dateRangeForSelectedMonth`, `loadFilteredTransactions` (reemplaza al
  `Promise.all` de `loadAll` para los 4 fetches de datos, sección 3.1),
  `isRefetching` + su `watch` (sección 4), `matchesType`/`matchesSearch`
  (sección 3.2/3.3), `filteredItems` (sección 3.4), `hasAnyMovementEver`
  (sección 5.1), `isPastSpecificMonth` + `balanceAfter` extendido (sección
  6). Las 4 listas locales (`expensesStore.expenses`, etc.) pasan a ser
  `ref`s locales de la vista poblados por `fetchFiltered` (ya lo era
  `debtLinkedMovements`; `expenses`/`incomes`/`transfers` pasan de leer el
  `ref` del store directamente a un `ref` local nuevo — **importante**: no
  reemplazar el `ref` maestro de cada store con esto, otras vistas
  (`HomeView.vue`) siguen dependiendo de `expensesStore.expenses`/etc.
  poblados por su propio `fetchAll()` sin cambios).
- **`src/stores/expenses.ts`, `src/stores/incomes.ts`,
  `src/stores/accountTransfers.ts`, `src/stores/debts.ts`**: método nuevo
  `fetchFiltered(filter: DateAccountFilter, limit?)` en cada uno (sección
  3.1) — no toca `fetchAll`/`fetchRecentForAccount`/
  `fetchAccountLinkedMovements`/`fetchMovementsInRange` existentes, que
  siguen sirviendo a sus consumidores actuales (`HomeView.vue`,
  `AccountDetailView.vue`) sin cambios.
- **`src/lib/text.ts`** (archivo nuevo): `normalizeSearchText` (sección
  3.3).
- **`src/lib/transactionItems.ts`**: sin cambios — `buildAccountTransactionItems`
  ya existe y se reusa tal cual (sección 3.5).
- Íconos nuevos a importar en `TransactionsView.vue`: `Search`, `X`,
  `SearchX` (los 3 ya disponibles en `@lucide/vue`, confirmado contra
  `node_modules`).

---

## 11. Fuera de alcance de v1 (explícito)

- **Filtro de categoría** — no se agrega ningún `Select` de categoría. El
  concepto de "categoría" solo aplica a `expense` (ingreso/transferencia/
  deuda vinculada no tienen categoría propia), lo que lo haría un filtro
  con semántica condicional al Tipo elegido — más complejidad de la que
  amerita esta iteración, decisión del Product Owner.
- **Filtro de rango de monto** — mismo criterio, no pedido para v1.
- **Persistencia de filtros en la URL** (`?month=`/`?accountId=`/etc.) —
  sección 9, candidato futuro.
- **Total/resumen del período filtrado** — sección 7, se omite
  deliberadamente, no un olvido.
- **Debounce de búsqueda** — descartado a propósito (sección 3.3), el
  filtro corre 100% en memoria.
