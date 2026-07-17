# TipApp — UX de Deudas y Préstamos (Fase 2 de 2)

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, Sheet inferior, a11y), `docs/features/accounts-income-ux.md`
(**Fase 1** de esta misma feature — Cuentas/Ingresos ya construidos y en
producción; en particular sección 9, "Accesos rápidos", donde el botón
"Deudas" quedó deshabilitado/placeholder con ícono `HandCoins`, esperando
esta Fase 2) y `docs/features/credit-cards-ux.md` (patrón de "Personas"
sección 6.3, patrón de dashboard con dona+ranking sección 2, ruta dedicada
vs. Sheet, conteo dedicado para guard de borrado). No se repite esa
justificación acá, solo se referencia y se indica explícitamente qué se
reusa tal cual y qué es nuevo.

Contexto de dominio (ya decidido por el Product Owner, no se rediscute acá):
"deuda" es un registro personal de a quién le presté plata o quién me
prestó a mí — sin invitaciones, sin multi-usuario, sin settlement
automático entre personas reales. Las contrapartes son exactamente las
mismas `card_people` que ya gestiona `/tarjetas/gestionar` — **no hay
pantalla nueva de gestión de personas**. El backend está armando en
paralelo dos tablas nuevas, `debts` y `debt_movements`, más una vista
agregada `debt_balances` — este documento asume nombres de columna
plausibles y consistentes con el resto del esquema (`snake_case`) solo a
título ilustrativo; **confirmar los nombres exactos con
`supabase-backend-expert`** antes de tipar el store, sin bloquear el diseño
de UX que sigue.

La referencia visual ("Mis Finanzas", mockup de otra app, pantalla
"Préstamos") se usa **únicamente** para los flujos/layout que muestra
(cards resumen, tabs por dirección, lista por contraparte, resumen rápido,
saldo neto, gráfico de evolución) — se adapta, no se copia literal: marca
sigue siendo TipApp. Mismo criterio de exclusión ya aplicado en
`credit-cards-ux.md` sección 11 (ver sección 12 de este documento para el
detalle completo de qué NO se adopta).

---

## 1. Estrategia de datos

Esta es la decisión más importante del documento, en el mismo sentido en
que lo fue `credit-cards-ux.md` sección 1 y `accounts-income-ux.md`
sección 1 — léase antes que cualquier otra sección.

### 1.1 El saldo de una deuda es siempre un agregado server-side

Decisión ya tomada por el backend (recapitulada acá porque condiciona todo
el frontend): **ninguna pantalla de esta feature suma `debt_movements` en
cliente para calcular el saldo de un hilo de deuda.** El saldo
(`debt_balances.balance`, nombre ilustrativo) es un `SUM(amount)` resuelto
por Postgres:

```sql
-- Ilustrativo, no es la migración final — confirmar con supabase-backend-expert
create view debt_balances as
select
  d.id as debt_id,
  d.user_id,
  d.person_id,
  d.direction,
  coalesce(sum(m.amount), 0) as balance
from debts d
left join debt_movements m on m.debt_id = d.id
group by d.id;
```

`amount` viene con signo (positivo sube la deuda, negativo la baja, ya
decidido por el Product Owner) — el signo hace que un `SUM` simple sea
matemáticamente correcto sin ningún caso especial. Estado derivado:
`balance > 0` → "Pendiente"; `balance <= 0` → "Saldada" (un saldo negativo
por sobrepago es un caso extremo no imposible pero no distinguido con un
estado propio — se muestra como "Saldada" igual, sin alarmar por una
diferencia de centavos; no es una decisión de UX, es simplemente no
inventar un tercer estado que nadie pidió).

### 1.2 Por qué SÍ es seguro traer y sumar en cliente la lista completa de `debt_balances`, a diferencia de `expenses`/`card_expenses`

Distinción importante que no es una excepción al principio de
`credit-cards-ux.md` sección 1 / `accounts-income-ux.md` sección 1, sino una
consecuencia directa de él, aplicada a una cardinalidad distinta:

- Lo que **nunca** creció sin límite realista y por eso nunca se sumó en
  cliente en las features anteriores es la lista de **movimientos**
  (`expenses`, `card_expenses`) — un usuario activo genera decenas de esas
  filas por mes, para siempre.
- La lista de **hilos de deuda** (`debt_balances`, una fila por
  contraparte+dirección, no una fila por movimiento) tiene una cardinalidad
  totalmente distinta: está acotada por "a cuántas personas distintas le
  prestaste o te prestaron alguna vez", que para un tracker personal es un
  número chico por diseño (unas pocas a lo sumo unas decenas, nunca miles) —
  mismo argumento de escala que ya usó `credit-cards-ux.md` sección 1.4 para
  aceptar agregación 100% client-side sobre `cardsRanking`/`peopleRanking`
  (listas de tarjetas/personas, no de gastos).

**Consecuencia práctica**: el dashboard (`/deudas`) hace **una sola query**
`select * from debt_balances where user_id = :userId` al cargar, sin
paginar ni acotar por fecha, y agrega en cliente (`reduce`) sobre ese
resultado ya completo para "Total pendiente por cobrar"/"Total pendiente por
pagar"/"Saldo neto" (sección 3). Esto **no** reproduce el patrón prohibido de
`MAX_EXPENSES` porque lo que se suma acá es "N hilos" (chico, acotado por
diseño), no "N movimientos de toda la historia" (lo que sí sigue prohibido,
sección 1.3 siguiente).

### 1.3 Lo que SÍ sigue prohibido: sumar `debt_movements` sin acotar

`debt_movements`, a diferencia de `debt_balances`, es una tabla de eventos
que sí crece sin límite realista con el tiempo (cada abono/ampliación es una
fila nueva) — mismo perfil que `expenses`/`card_expenses`. Todo lo que
necesita datos de `debt_movements` en esta feature va acotado por rango de
fecha en el servidor, nunca "traer todo":

- **"Resumen rápido" del mes** (sección 3.7): query acotada
  `gte(inicio_mes).lt(inicio_mes_siguiente)`, agregación en cliente sobre
  ese resultado ya chico — mismo criterio que `credit-cards-ux.md`
  sección 1.2.
- **"Evolución de saldos"** (sección 3.8): query acotada a los últimos 12
  meses, ver derivación completa en sección 1.4 siguiente.
- **Ledger completo de un hilo** (`/deudas/:id`, sección 6.2): única
  excepción sin filtro de fecha, justificada igual que "movimientos
  recientes" de `CardDetailView` (`credit-cards-ux.md` sección 4.3): acá el
  volumen esperado **de un solo hilo** (cuántas veces alguien abona o amplía
  un préstamo puntual) es chico de sobra para traerlo completo sin costo
  perceptible. Como red de seguridad defensiva (no como mecanismo de
  corrección), la query lleva `.limit(500)` — mismo criterio que el
  `.limit(1000)` defensivo de `credit-cards-ux.md` sección 1.4.

### 1.4 La parte más delicada: derivar "Evolución de saldos" (12 meses) sin sumar el historial completo

El gráfico pide una curva **acumulada** (el saldo tal como estaba al cierre
de cada uno de los últimos 12 meses), no un total mensual aislado — mirando
la referencia, las líneas suben y bajan como un saldo real, no como barras
de "cuánto se movió ese mes". Calcular eso ingenuamente necesitaría sumar
*todo* el historial de movimientos hasta cada punto del tiempo, lo cual
violaría 1.3. Se resuelve con una derivación que reusa un número que la
pantalla **ya tiene** sin costo adicional:

```ts
// Ilustrativo — vive en debtsStore o en un helper de src/lib/charts.ts
// 1. Balance actual por dirección: suma de `debt_balances` (sección 1.2,
//    seguro porque es una lista chica de hilos, no de movimientos).
const totalLentBalanceNow = debtBalances.filter(b => b.direction === 'lent').reduce((s, b) => s + b.balance, 0)
const totalBorrowedBalanceNow = debtBalances.filter(b => b.direction === 'borrowed').reduce((s, b) => s + b.balance, 0)

// 2. Movimientos de los últimos 12 meses, query acotada por fecha (sección 1.3):
//    supabase.from('debt_movements').select('amount, movement_date, debt:debts(direction)')
//      .gte('movement_date', windowStart).lt('movement_date', nextMonthStart).limit(1000)
const netInWindowLent = windowMovements.filter(m => m.debt.direction === 'lent').reduce((s, m) => s + m.amount, 0)
const netInWindowBorrowed = windowMovements.filter(m => m.debt.direction === 'borrowed').reduce((s, m) => s + m.amount, 0)

// 3. El saldo "de arranque" (al inicio de la ventana de 12 meses) es el saldo
//    actual menos lo que se movió DENTRO de la ventana — nunca se tocó nada
//    de fuera de la ventana para calcularlo, es aritmética sobre dos números
//    ya seguros (uno agregado server-side sin límite de fecha, sección 1.2;
//    el otro acotado por fecha, sección 1.3).
const startOfWindowLent = totalLentBalanceNow - netInWindowLent
const startOfWindowBorrowed = totalBorrowedBalanceNow - netInWindowBorrowed

// 4. Recién acá se camina mes a mes, acumulando desde el arranque —
//    sobre datos que ya están 100% en memoria y acotados.
```

Este es, junto con la sección 3 de "vínculo a cuenta" (sección 5.3/7.3), el
punto que más justifica un párrafo propio en este documento: sin este paso
3, el gráfico o bien necesitaría una query nueva sin acotar ("traer todos
los movimientos desde el origen de los tiempos para saber el saldo de
arranque"), o bien tendría que pedirle a `supabase-backend-expert` una
función RPC nueva dedicada a "saldo a una fecha X" — ninguna de las dos hace
falta con esta derivación, que reusa números que la pantalla **ya calculó**
para las cards resumen (sección 3.2).

### 1.5 Conteos dedicados para guards — qué hace falta y qué no

- **Borrado de un hilo de deuda completo**: **no necesita ningún conteo
  dedicado** (a diferencia de categorías/cuentas/tarjetas/personas) —
  justificación completa en sección 6.5.
- **Borrado de una `card_people`** (en `/tarjetas/gestionar`, ya existente):
  sí necesita un ajuste. Hoy `cardPeopleStore.fetchExpenseCounts()` cuenta
  solo `card_expenses(count)` por persona (`credit-cards-ux.md` sección
  1.3). Con Deudas, una persona también puede tener `debts` asociadas —
  el guard de "Eliminar" en `ManageCardsView` debe pasar a contar
  `card_expenses(count) + debts(count)` para esa persona, no solo lo
  primero. Es un **ajuste menor a un guard ya existente**, no una pantalla
  nueva — nota para `vue-frontend-expert`, no algo que se rediseñe acá
  (ver sección 4.3).

---

## 2. Arquitectura de rutas: dashboard + detalle (2 rutas, no 1, no 4)

Mismo ejercicio de calibrar complejidad ya hecho en las dos features
anteriores: Cuentas se resolvió con **1 ruta** (`accounts-income-ux.md`
sección 6.1: entidad única, sin dashboard/detalle propio) y Tarjetas con
**4 rutas** (`credit-cards-ux.md` sección 8: dashboard + transacciones
filtradas + gestión + detalle, porque tarjetas modela dos entidades
—tarjetas y personas— con vistas propias de cada una).

**Decisión: Deudas se resuelve con 2 rutas — dashboard + detalle por hilo.**
Ni 1 ni 4:

- **No alcanza con 1 ruta** (como Cuentas): a diferencia de una cuenta
  (que es un balance simple sin ledger propio navegable — sección 2.3 de
  `accounts-income-ux.md` decidió explícitamente NO construir
  `AccountDetailView`), una deuda **sí** necesita un lugar donde ver/editar/
  borrar sus movimientos individuales (pedido explícito del encargo, punto
  1 y 6) — eso es, por definición, una segunda ruta de detalle. Meter el
  ledger completo de todos los hilos en la misma pantalla que el dashboard
  (dona/resumen/gráfico) sería una única pantalla sobrecargada, mezclando
  una vista de "panorama" con una de "gestión puntual de un hilo".
- **No hace falta llegar a 4** (como Tarjetas): acá no hay una segunda
  entidad propia que gestionar (las "personas" ya viven en
  `/tarjetas/gestionar`, punto 1 del encargo — no se duplica esa gestión) ni
  hace falta una ruta de "transacciones filtradas" aparte del dashboard: los
  filtros por dirección ya los resuelven los **tabs** dentro del propio
  dashboard (sección 3.4), y el tab "Historial" (ver referencia visual)
  cubre la necesidad de "ver movimientos recientes mezclados" sin necesitar
  una ruta ni un selector de mes/tarjeta/persona propio como sí lo justificó
  `CardTransactionsView` (que existe porque **tarjetas** tiene volumen y
  filtros cruzados de verdad — tarjeta × persona × mes; Deudas no tiene ese
  cruce, la única dimensión de filtro real es la dirección, que ya resuelven
  los tabs).

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/deudas` | `debts` | `{ requiresAuth: true }` | `DebtsDashboardView` |
| `/deudas/:id` | `debt-detail` | `{ requiresAuth: true }` | `DebtDetailView` |

Sin colisión de segmento literal-vs-dinámico (a diferencia de
`/tarjetas/gestionar` vs. `/tarjetas/:id`) — no hace falta ningún orden
especial de declaración en el array de rutas.

---

## 3. `/deudas` — Dashboard

Header igual al patrón ya establecido (`ArrowLeft` + título, vuelve a `/`):

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="text-xl font-semibold">Deudas</h1>
</header>
```

### 3.1 Orden de secciones en el `<main>`

1. Dos cards resumen: "Yo presté" / "Me prestaron" (sección 3.2).
2. Saldo neto (sección 3.3).
3. Tabs + contenido: "Yo presté" / "Me prestaron" / "Historial" (secciones
   3.4-3.6).
4. Resumen rápido del mes (sección 3.7).
5. Evolución de saldos (gráfico, sección 3.8).
6. FAB "Nueva deuda" (sección 3.9), persistente sobre todo lo anterior.

### 3.2 Cards resumen "Yo presté" / "Me prestaron"

```html
<div class="grid grid-cols-2 gap-3">
  <Card class="border-success/30 bg-success/5">
    <CardHeader class="pb-2">
      <div class="flex items-start justify-between gap-2">
        <CardDescription class="text-success">Yo presté</CardDescription>
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <ArrowUpRight class="size-4" />
        </span>
      </div>
    </CardHeader>
    <div class="px-6 pb-4">
      <p class="text-2xl font-bold tabular-nums tracking-tight">${{ formatAmount(totalLentBalance) }}</p>
      <p class="text-xs text-muted-foreground">Total pendiente por cobrar</p>
    </div>
  </Card>

  <Card class="border-destructive/30 bg-destructive/5">
    <CardHeader class="pb-2">
      <div class="flex items-start justify-between gap-2">
        <CardDescription class="text-destructive">Me prestaron</CardDescription>
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <ArrowDownRight class="size-4" />
        </span>
      </div>
    </CardHeader>
    <div class="px-6 pb-4">
      <p class="text-2xl font-bold tabular-nums tracking-tight">${{ formatAmount(totalBorrowedBalance) }}</p>
      <p class="text-xs text-muted-foreground">Total pendiente por pagar</p>
    </div>
  </Card>
</div>
```

**Por qué acá sí se usa `success`/`destructive` de forma prominente**
(parece contradecir la regla de `design-system.md` sección 1, "no pintar de
rojo cada gasto"): esa regla existe para no moralizar cada transacción
individual del día a día (un gasto no es "malo" por ser un gasto). Acá el
par verde/rojo no describe una transacción — describe una **polaridad
financiera real y binaria** (plata que me deben = a mi favor; plata que
debo = en mi contra), aplicada exactamente **una vez por pantalla** en las
dos cards resumen + el saldo neto (sección 3.3), nunca en cada fila
individual de movimiento (esas usan ícono+texto, nunca solo color — sección
3.6/6.2/11). Es el mismo nivel de restricción que ya tienen
`success`/`warning`/`destructive` para estados de presupuesto: reservados
para el resumen de alto nivel, no para el ruido de cada fila.

`ArrowUpRight`/`ArrowDownRight` (confirmados en
`node_modules/@lucide/vue/dist/esm/icons/arrow-up-right.mjs` /
`arrow-down-right.mjs`, nada que instalar) — deliberadamente **distintos**
de `ArrowUp`/`ArrowDown` que ya usa `monthDelta` en `HomeView.vue`/
`CardsDashboardView` para deltas vs. mes anterior: son conceptos distintos
(acá miden **qué card es cada una**, no una tendencia arriba/abajo) y
reusar el mismo par de íconos en un contexto semántico distinto sería
confuso.

### 3.3 Saldo neto

```html
<Card>
  <div class="flex items-center justify-between px-6 py-4">
    <div class="flex flex-col gap-0.5">
      <p class="text-sm font-medium">Saldo neto</p>
      <p class="text-xs text-muted-foreground">Lo que me deben − lo que debo</p>
    </div>
    <p
      class="text-xl font-bold tabular-nums"
      :class="netBalance >= 0 ? 'text-success' : 'text-destructive'"
    >
      {{ netBalance >= 0 ? '+' : '-' }}${{ formatAmount(Math.abs(netBalance)) }}
    </p>
  </div>
</Card>
```

`netBalance = totalLentBalance - totalBorrowedBalance` (resta de dos
números ya agregados, sección 1.2 — no se vuelve a tocar `debt_movements`
acá). Signo `+`/`-` explícito antes del monto, mismo criterio de "el signo
es el indicador primario, el color refuerza" ya usado en toda la app
(saldo de cuenta, ingreso vs. gasto).

### 3.4 Tabs — primer uso real del componente `Tabs` de shadcn-vue

**Se instala `Tabs`** (`npx shadcn-vue add tabs`) — primera vez en el
proyecto (`design-system.md` sección 4 lo dejó anotado para "Fase 2 —
cuando haya más de una sección de navegación definida", y hasta ahora
ningún encargo generó un caso genuino). Mismo criterio de "agregar un
componente nuevo solo cuando aparece el primer caso real" ya aplicado a
`Switch`/`Textarea` en `credit-cards-ux.md` sección 5.2/5.3.

**Por qué acá sí es `Tabs` y no el patrón `radiogroup` ya usado en el
proyecto** (toggle Gasto/Ingreso, toggle Tipo de dirección de la sección
5.1): la distinción ya la traza el propio proyecto sin necesidad de
inventar un criterio nuevo — un `radiogroup` de botones planos se usó
siempre para **un valor de un campo de formulario** (mutuamente excluyente,
sin contenido propio por opción, se resuelve al guardar). `Tabs` es
semánticamente distinto: **paneles de contenido** que se muestran/ocultan
completos (una lista de hilos vs. otra lista de hilos vs. un ledger mixto),
no un campo que se envía a ningún lado — es exactamente el caso de uso para
el que existe el primitivo `Tabs` de Reka UI (`role="tablist"`/`role="tab"`/
`role="tabpanel"`, navegación con flechas de teclado de fábrica), y usarlo
acá es más correcto a11y-mente que forzar un `radiogroup` a hacer de
selector de sección.

```html
<Tabs v-model="activeTab" default-value="lent">
  <TabsList class="grid w-full grid-cols-3">
    <TabsTrigger value="lent">Yo presté</TabsTrigger>
    <TabsTrigger value="borrowed">Me prestaron</TabsTrigger>
    <TabsTrigger value="history">Historial</TabsTrigger>
  </TabsList>

  <TabsContent value="lent"><!-- sección 3.5, direction='lent' --></TabsContent>
  <TabsContent value="borrowed"><!-- sección 3.5, direction='borrowed' --></TabsContent>
  <TabsContent value="history"><!-- sección 3.6 --></TabsContent>
</Tabs>
```

Default: tab "Yo presté" (`lent`) — mismo orden que la referencia y que las
dos cards resumen (sección 3.2, "Yo presté" primero). No hay persistencia
de qué tab quedó activo entre visitas (se reinicia a "Yo presté" cada vez
que se entra a `/deudas`) — mismo nivel de simplicidad ya aceptado en el
resto del proyecto para estado efímero de UI.

### 3.5 Contenido de "Yo presté" / "Me prestaron" — lista de hilos por contraparte

Mismo patrón de fila clickeable que `cardsRanking` de
`credit-cards-ux.md` sección 2.3 (toda la fila navega al detalle, sin menú
`⋮` — editar/borrar vive en el detalle, sección 6):

```html
<div class="flex flex-col">
  <template v-for="(debt, idx) in debtsForTab(activeTab)" :key="debt.id">
    <Separator v-if="idx > 0" />
    <button
      type="button"
      class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      @click="router.push({ name: 'debt-detail', params: { id: debt.id } })"
    >
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <User class="size-4 text-muted-foreground" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="truncate text-sm font-medium">{{ debt.personName }}</p>
        <p v-if="debt.description" class="truncate text-xs text-muted-foreground">{{ debt.description }}</p>
      </div>
      <div class="flex flex-col items-end gap-0.5">
        <p class="text-sm font-semibold tabular-nums">${{ formatAmount(Math.abs(debt.balance)) }}</p>
        <Badge :variant="debt.balance > 0 ? 'outline' : 'secondary'" class="text-[10px]">
          {{ debt.balance > 0 ? 'Pendiente' : 'Saldada' }}
        </Badge>
      </div>
    </button>
  </template>
</div>
```

- Ordenados: pendientes primero (`balance > 0`, desc por monto), saldadas al
  final — mismo criterio de "las más relevantes primero" que
  `cardsRanking`/`topAccounts`, pero sin ocultar las saldadas (mismo
  criterio que tarjetas en $0: "todas las tarjetas aparecen, incluso sin
  gasto este mes", `credit-cards-ux.md` sección 2.3).
- Sin avatar de foto (ya decidido para `card_people`, sección 6.3 de
  `credit-cards-ux.md`, no se reabre acá): ícono `User` genérico dentro de
  un círculo `bg-muted`, mismo tratamiento que la persona "sin color" de
  tarjetas.
- Estado "Pendiente" con `variant="outline"` (neutro, no alarmante — sigue
  siendo el estado esperado de una deuda activa) y "Saldada" con
  `variant="secondary"` (apagado, ya resuelto) — ninguno de los dos usa
  `destructive`/`success` acá: esos colores ya se gastaron en las cards
  resumen (sección 3.2) y en cada fila individual sería ruido repetido
  (mismo argumento de "no pintar de rojo cada gasto").
- Estado vacío del tab (usuario sin ningún hilo en esa dirección): mensaje
  inline corto, `text-sm text-muted-foreground text-center py-8`,
  `"Todavía no le prestaste plata a nadie."` / `"Todavía no te prestaron
  plata."` según el tab — no reemplaza toda la pantalla (las otras
  secciones, resumen rápido/gráfico, pueden seguir teniendo datos de la
  otra dirección).

### 3.6 Contenido de "Historial" — ledger reciente mixto

Últimos movimientos de **ambas direcciones**, sin filtro de mes, ordenados
desc por fecha — mismo criterio de "recientes, no completo" que
`credit-cards-ux.md` sección 4.3: `.limit(30)`, con propósito declarado
("los últimos 30 movimientos"), no una lista que pretenda ser exhaustiva
(para ver el historial completo de **un** hilo puntual, ese si es completo,
está en `/deudas/:id`, sección 6.2).

```html
<div class="flex flex-col">
  <template v-for="(mov, idx) in recentMovements" :key="mov.id">
    <Separator v-if="idx > 0" />
    <button
      type="button"
      class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      @click="router.push({ name: 'debt-detail', params: { id: mov.debtId } })"
    >
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-full"
        :class="mov.debt.direction === 'lent' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'"
      >
        <component :is="mov.debt.direction === 'lent' ? ArrowUpRight : ArrowDownRight" class="size-4" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="truncate text-sm font-medium">{{ movementVerb(mov) }} · {{ mov.personName }}</p>
        <p class="truncate text-xs text-muted-foreground">
          {{ formatExpenseDateHeading(mov.movementDate) }}
          <span v-if="mov.accountId">· <Wallet class="inline size-3" /> {{ mov.accountName }}</span>
        </p>
      </div>
      <p class="shrink-0 text-sm font-semibold tabular-nums">
        {{ mov.amount >= 0 ? '+' : '-' }}${{ formatAmount(Math.abs(mov.amount)) }}
      </p>
    </button>
  </template>
</div>
```

- `movementVerb(mov)`: texto explícito según dirección + signo — "Prestaste
  más" (`lent`, `amount > 0`), "Te devolvieron" (`lent`, `amount < 0`), "Te
  prestaron más" (`borrowed`, `amount > 0`), "Pagaste" (`borrowed`,
  `amount < 0`) — el color+ícono de la sección 3.2 se refuerza acá con texto
  real, nunca solo el ícono de dirección (regla de a11y de siempre).
- Toca la fila entera → navega al detalle del hilo dueño de ese movimiento
  (no hay edición inline desde acá — mismo criterio de "esta lista es de
  navegación/panorama, no de gestión puntual" ya usado para
  "Transacciones recientes" de Inicio y `cardsRanking`).
- Badge de cuenta vinculada (`Wallet` + nombre) igual al de la sección 6.2 —
  ver justificación completa ahí, mismo componente/patrón reusado acá.

### 3.7 Resumen rápido (mes en curso, sin selector)

```html
<Card>
  <CardHeader>
    <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Resumen rápido · {{ monthLabel }}
    </CardTitle>
  </CardHeader>
  <div class="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
    <div class="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div class="flex items-center gap-1.5 text-success">
        <ArrowUpRight class="size-4" />
        <span class="text-xs font-medium">Presté este mes</span>
      </div>
      <p class="text-lg font-semibold tabular-nums">${{ formatAmount(lentThisMonth) }}</p>
      <p class="text-xs text-muted-foreground">{{ lentMovementsCount }} movimiento{{ lentMovementsCount === 1 ? '' : 's' }}</p>
    </div>
    <div class="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div class="flex items-center gap-1.5 text-destructive">
        <ArrowDownRight class="size-4" />
        <span class="text-xs font-medium">Me prestaron este mes</span>
      </div>
      <p class="text-lg font-semibold tabular-nums">${{ formatAmount(borrowedThisMonth) }}</p>
      <p class="text-xs text-muted-foreground">{{ borrowedMovementsCount }} movimiento{{ borrowedMovementsCount === 1 ? '' : 's' }}</p>
    </div>
  </div>
</Card>
```

- `lentThisMonth`/`borrowedThisMonth`: suma de `amount` **solo cuando
  `amount > 0`** (ampliaciones/préstamos nuevos, no abonos/pagos que
  bajarían el número de forma confusa en un resumen que se llama "presté
  este mes") de la query acotada por mes de la sección 1.3.
- **Sin selector de mes** (a diferencia de la referencia, que sí tiene un
  dropdown "Este mes"): decisión deliberada por consistencia interna, no
  por limitación técnica — ningún otro resumen mensual de la app tiene
  selector propio (el hero "Total del mes" de Inicio, el dashboard de
  Tarjetas, sección 2.1 de `credit-cards-ux.md`, tampoco lo tienen). Se
  prioriza consistencia con el resto de TipApp por sobre paridad 1:1 con la
  referencia externa.
- **Copy "movimientos" en vez de "préstamos"** (a diferencia de la
  referencia, que dice "1 préstamo"): más honesto — el conteo acá incluye
  tanto préstamos nuevos como ampliaciones de hilos ya existentes, no solo
  altas nuevas; "préstamos" sobre-prometería que cada uno es un hilo nuevo.

### 3.8 Gráfico "Evolución de saldos" — `DualTrendChart.vue` (componente nuevo)

**No se extiende `TrendAreaChart.vue`.** Se define un componente nuevo,
`src/components/charts/DualTrendChart.vue`, hermano de `TrendAreaChart.vue`
(mismo criterio: SVG a mano, sin librerías nuevas, midpoint-smoothing
reusado de la técnica ya validada en `accounts-income-ux.md` sección 3.2).
Motivos concretos para no forzar la reutilización:

1. **Contrato de color distinto**: `TrendAreaChart` pinta con
   `hsl(var(--primary))` fijo (una sola serie, un solo significado posible).
   Acá hay **dos** series con semántica fija (`success` para "yo presté",
   `destructive` para "me prestaron" — misma paleta ya justificada en
   sección 3.2), no una serie genérica de "tendencia".
2. **Normalización de eje Y compartida**: las dos líneas necesitan
   compartir el mismo `maxAmount` (si no, una línea "domina" visualmente
   solo por estar en una escala distinta, engañoso para comparar) —
   `TrendAreaChart` normaliza sobre los puntos de una única serie, no está
   pensado para recibir dos.
3. **Granularidad mensual, no diaria**: `TrendAreaChart`
   (`buildCumulativeDailySeries`/`buildDailySeries`) asume un mes calendario
   de días 1..N. Acá el eje X son 12 puntos mensuales, con etiquetas de mes
   (`Ene`, `Feb`, ...), no de día.

Forzar estos tres cambios dentro de `TrendAreaChart` (props nuevas para
color, para una segunda serie, para granularidad) lo convertiría en un
componente genérico de gráficos de línea con configuración condicional —
más difícil de razonar que dos componentes chicos y de propósito único,
mismo criterio de simplicidad ya aplicado en el resto del proyecto.

```ts
// src/components/charts/DualTrendChart.vue — contrato de props
export interface DualTrendPoint {
  /** Etiqueta corta de mes, ej. "Ene", "Feb" — ya formateada, el
   * componente no conoce fechas. */
  label: string
  lent: number
  borrowed: number
}

interface Props {
  /** Orden ascendente cronológico, longitud típica 12. */
  points: DualTrendPoint[]
  height?: number
  ariaLabel: string
}
```

Estructura interna (misma técnica que `TrendAreaChart.vue`, duplicada
deliberadamente sobre dos series en vez de generalizada — ver justificación
arriba):

- `maxAmount = Math.max(0, ...points.flatMap(p => [p.lent, p.borrowed]))`
  — un único máximo compartido por ambas series, para que se dibujen en la
  misma escala vertical.
- Dos `linePath`/`areaPath` (uno por serie), cada uno con la misma técnica
  de suavizado `Q` (midpoint smoothing) ya usada en `TrendAreaChart`,
  factorizada como el mismo helper `buildSmoothCurve` (se puede importar
  desde `TrendAreaChart.vue` o duplicar en un helper compartido
  `src/lib/svgCurve.ts` — a criterio de `vue-frontend-expert`, es un detalle
  de organización de archivo, no de UX).
- Dos `<linearGradient>` con `stop-color="hsl(var(--success))"` /
  `"hsl(var(--destructive))"` respectivamente, mismo patrón de opacidad
  `0.28 → 0` que `accounts-income-ux.md` sección 3.3, con `id` único vía
  `useId()` para cada uno (dos gradientes en el mismo SVG, cada línea con el
  suyo).
- Etiquetas de eje X: mostrar `points[i].label` cada 2 meses si
  `points.length > 6` (evita amontonar 12 etiquetas en una pantalla de
  360px), todas si `points.length <= 6` — mismo espíritu que el
  `axisLabels` de `TrendAreaChart` (que ya recorta a 3 puntos: inicio,
  medio, fin) pero adaptado a que acá interesa ver la progresión mes a mes,
  no solo 3 marcas.
- Leyenda (cuadrito de color + texto, nunca solo color): fila
  `<div class="flex items-center gap-4 text-xs">` con dos `<span>` — punto
  `bg-success`/`bg-destructive` + "Yo presté"/"Me prestaron" — igual criterio
  que la leyenda de `CategoryDonutChart` (dona + texto siempre juntos).

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Evolución de saldos</CardTitle>
    <CardDescription>Últimos 12 meses</CardDescription>
  </CardHeader>
  <div class="flex flex-col gap-3 px-4 pb-6 sm:px-6">
    <div class="flex items-center gap-4 text-xs text-muted-foreground">
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success" /> Yo presté</span>
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-destructive" /> Me prestaron</span>
    </div>
    <DualTrendChart :points="balanceEvolutionPoints" :height="120" ariaLabel="Evolución del saldo prestado y recibido, últimos 12 meses" />
  </div>
</Card>
```

Si `balanceEvolutionPoints` está vacío o todos los puntos son `0` en ambas
series (usuario sin ningún movimiento en los últimos 12 meses): se oculta
la Card completa (nada que graficar) — mismo criterio que credit-cards
sección 2.5 ("si el mes vigente no tiene ningún gasto, la sección de
distribución no se muestra").

### 3.9 FAB "Nueva deuda"

Mismo patrón que el resto de listados con alta frecuente
(`TransactionsView`/`CardTransactionsView`): `size-14 rounded-full
shadow-[var(--shadow-elevated)]`, respeta
`pb-[env(safe-area-inset-bottom)]`, abre `DebtFormSheet` en modo alta
(sección 5).

```html
<button
  type="button"
  aria-label="Nueva deuda"
  class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
  style="margin-bottom: env(safe-area-inset-bottom)"
  @click="openAddDebtSheet"
>
  <Plus class="size-6" />
</button>
```

### 3.10 Estados de carga/vacío/error

- **Carga**: `Skeleton` en las 5 secciones (2 cards resumen, saldo neto,
  tabs+lista, resumen rápido, gráfico) — mismo criterio que el resto de la
  app.
- **Error**: mismo bloque `AlertCircle` + "No pudimos cargar tus deudas" +
  `Reintentar`.
- **Vacío total** (usuario sin ningún hilo de deuda creado todavía):
  reemplaza todo el contenido bajo el header por un bloque centrado (ícono
  `HandCoins` `size-12 text-muted-foreground`, "Todavía no registraste
  ningún préstamo.", subtexto "Registrá a quién le prestaste plata o quién
  te prestó a vos.", botón "Nueva deuda" → abre `DebtFormSheet` directo,
  **sin ruta intermedia** — a diferencia del vacío de Tarjetas (que navega a
  `manage-cards` porque ahí vive el alta), acá el alta vive en el propio
  dashboard vía Sheet, así que el botón del estado vacío hace exactamente lo
  mismo que el FAB).

---

## 4. Selector de contraparte — reuso de `card_people`, sin pantalla nueva

### 4.1 `Select` simple sobre `cardPeopleStore.people`

Decisión ya tomada por el Product Owner (punto 1 del encargo, no se
rediscute): el campo "Contraparte" del alta de deuda es un `Select`
estándar sobre `cardPeopleStore.people` (ya en memoria si el usuario
navegó por Tarjetas antes; si no, `debtsStore`/la vista de Deudas dispara su
propio `cardPeopleStore.fetchPeople()` al montar, mismo store, sin
duplicar estado).

```html
<div class="flex flex-col gap-1.5">
  <Label for="contraparte">Contraparte</Label>
  <Select v-model="form.personId" :disabled="isSaving">
    <SelectTrigger id="contraparte" class="h-11 w-full" :aria-invalid="!!errors.personId">
      <SelectValue placeholder="Seleccioná una persona" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="person in cardPeopleStore.people" :key="person.id" :value="person.id">
        {{ person.name }}
      </SelectItem>
    </SelectContent>
  </Select>
  <p v-if="errors.personId" class="text-xs text-destructive">{{ errors.personId }}</p>
  <Button
    variant="link"
    size="sm"
    class="h-auto w-fit p-0 text-xs"
    type="button"
    @click="goManagePeople"
  >
    <UserRoundPlus class="size-3.5" /> Agregar persona nueva
  </Button>
</div>
```

### 4.2 El atajo "Agregar persona nueva" y el trade-off que resuelve (a propósito, con criterio explícito)

El encargo deja explícitamente a criterio de este documento si conviene un
atajo para cuando "la lista está vacía o el usuario necesita agregar una
persona nueva". **Decisión: sí, un link de texto siempre visible** (no solo
cuando la lista está vacía) debajo del `Select`, que navega a
`/tarjetas/gestionar?new=person`.

```ts
function goManagePeople() {
  router.push({ name: 'manage-cards', query: { new: 'person' } })
}
```

`ManageCardsView` necesita un ajuste chico (nota para `vue-frontend-expert`,
no rediseño): además del `?new=1` que ya soporta (si existe) para abrir el
alta de tarjeta, sumar un `?new=person` que abra directamente el
`CardPersonFormSheet` al montar — mismo patrón exacto que `?new=1` ya
documentado en `dashboard-redesign-ux.md` sección 3.4 y reusado en
`accounts-income-ux.md` sección 6.2, aplicado a un valor de query distinto
para desambiguar cuál de las dos secciones de esa pantalla abrir.

**Trade-off aceptado explícitamente**: navegar a `/tarjetas/gestionar`
abandona el Sheet de alta de deuda en curso — cualquier campo ya completado
(Dirección, Contraparte antes de notar que falta la persona, Descripción)
se pierde, el usuario vuelve a `/deudas` con las manos vacías después de
crear la persona. Se acepta este costo por dos motivos:

1. **Es el mismo patrón que ya usa el resto del proyecto** cuando hace
   falta un atajo cruzado (`?new=1` desde la tile "Agregar cuenta" del
   dashboard de Inicio) — no se inventa una segunda forma de resolver
   "necesito crear un recurso relacionado a mitad de otro formulario"
   (p. ej. un mini-formulario inline de persona embebido dentro del Sheet de
   deuda, que sería una superficie nueva no pedida y complejidad real para
   un caso de uso infrecuente: la mayoría de los usuarios ya tiene sus
   personas cargadas desde que usan Tarjetas).
2. **El campo "Contraparte" es el segundo del formulario** (sección 5.1,
   justo después de "Dirección"): si el usuario necesita crear una persona
   nueva, todavía no completó Descripción/Monto/Fecha/Cuenta — la pérdida
   real de trabajo tecleado es mínima en la práctica, aunque exista en
   teoría.

### 4.3 Ajuste al guard de borrado de personas — nota para `vue-frontend-expert`

Ya anotado en sección 1.5: `cardPeopleStore.fetchExpenseCounts()` (o el
mecanismo equivalente que `ManageCardsView` use para deshabilitar
"Eliminar" en una persona) debe pasar de contar solo
`card_expenses(count)` a contar `card_expenses(count) + debts(count)`:

```ts
// Ilustrativo — ajuste al query ya existente en cardPeople.ts
supabase.from('card_people')
  .select('id, card_expenses(count), debts(count)')
  .eq('user_id', userId)
```

`Eliminar` queda deshabilitado si la suma de ambos conteos es `> 0` — misma
mecánica de guard ya vigente, un campo más en la suma. No es una pantalla
nueva ni un rediseño de `/tarjetas/gestionar`.

---

## 5. Alta de deuda nueva — `DebtFormSheet.vue`

Mismo patrón estructural que el resto de Sheets del proyecto (`Sheet
side="bottom"`, `SheetHeader`/`SheetTitle`, body `gap-4 px-4`, footer con
un botón ancho completo).

### 5.1 Campos (modo alta)

1. **Dirección** (`radiogroup`, requerido, sin default preseleccionado —
   fuerza elección consciente, mismo criterio que Categoría en gastos: es
   la decisión más importante del formulario, no conviene un default
   arbitrario):

```html
<div class="flex flex-col gap-1.5">
  <Label id="direccion-label">¿Qué tipo de préstamo es?</Label>
  <div role="radiogroup" aria-labelledby="direccion-label" class="flex gap-1 rounded-md bg-muted p-1">
    <button
      type="button" role="radio" :aria-checked="form.direction === 'lent'"
      class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="form.direction === 'lent' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
      @click="form.direction = 'lent'"
    >
      Yo le presto
    </button>
    <button
      type="button" role="radio" :aria-checked="form.direction === 'borrowed'"
      class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="form.direction === 'borrowed' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
      @click="form.direction = 'borrowed'"
    >
      Me presta
    </button>
  </div>
</div>
```

2. **Contraparte** (`Select`, requerido, sección 4).
3. **Descripción** (`Input`, opcional, `maxlength` generoso, ej. "Préstamo
   personal", "Viaje a Cancún") — mismo rol que la descripción de un gasto.
4. **Monto inicial** (`Input type="number"`, requerido, `> 0` — nunca se le
   pide al usuario un número negativo, mismo criterio que el resto de la
   app; el signo lo decide el store internamente según se explica en
   sección 7.1).
5. **Fecha** (`<input type="date">` nativo, mismo criterio que
   `design-system.md` sección 4).
6. **Cuenta** (`Select`, **opcional**, con el copy de advertencia — sección
   5.3, el punto más delicado del encargo).
7. Botón footer: `Guardar deuda` con estado de loading (`disabled` +
   `Loader2` + `Guardando…`).

### 5.2 Guardado: NO optimista (única excepción real de esta feature, justificada explícitamente)

**Decisión: el alta de una deuda nueva NO es optimista.** El Sheet
permanece abierto con el botón en estado `Guardando…` hasta que el servidor
confirma, y solo entonces se cierra + navega (o se queda, a criterio de
`vue-frontend-expert`) — no hay inserción local inmediata seguida de
rollback.

Esto se aparta del patrón por defecto del proyecto (`ExpenseFormSheet`,
`CardExpenseFormSheet`, `AccountFormSheet`, `CardFormSheet`, todos 100%
optimistas) por un motivo **distinto** al que justificó la excepción de
`CategoryFormSheet` (`categories-mvp-ux.md` sección 3.4: ahí era un
conflicto real server-only, índice único de nombre). Acá no hay ningún
índice único en juego — el motivo es de **dependencia de datos entre dos
inserts atómicos**:

1. Crear una deuda es, por diseño del backend (punto 2 del encargo), **una
   función RPC que inserta la cabecera (`debts`) y el primer movimiento
   (`debt_movements`) en una sola transacción** — no dos llamadas
   separadas del frontend. El frontend no tiene forma de "insertar
   optimistamente la cabecera" sin ya tener el resultado de la operación
   atómica completa (necesita el `debt_id` real que devuelve el RPC para
   poder, por ejemplo, navegar a `/deudas/:id` con un id que exista de
   verdad, o para que el primer movimiento optimista tenga un `debt_id`
   válido al que referenciar).
2. **El "saldo" que se mostraría en cualquier inserción optimista no es un
   dato que el cliente pueda calcular con confianza antes de la
   confirmación**: a diferencia de un gasto (`amount` es el dato final, sin
   transformación server-side) o de una cuenta (el saldo se recalcula solo
   cuando se lee, no al guardar), acá el número que el usuario ve
   inmediatamente después de guardar (el balance del hilo recién creado) es
   *literalmente* el mismo monto que el usuario tipeó como "Monto inicial"
   — así que, en la práctica, el costo de simular esto de forma optimista
   (mostrar el hilo en la lista con un id temporal, un balance que coincide
   con el monto tipeado, y hacer rollback completo si el RPC falla) es alto
   para un beneficio bajo: alta de deuda es una operación de **baja
   frecuencia** (se crea un hilo una vez por relación, después se abona/
   amplía muchas veces — eso sí es 100% optimista, sección 7.2), igual
   perfil de frecuencia que crear una categoría/cuenta/tarjeta, donde
   tampoco es catastrófico pedirle al usuario que espere el roundtrip una
   vez.

Nota para `supabase-backend-expert`: si en el futuro se decide que el RPC
puede simplificarse a "crear cabecera con saldo inicial ya como columna"
(sin depender de un primer `debt_movement`), reevaluar esta decisión con el
mismo criterio que `categories-mvp-ux.md` sección 3.4 ya documentó para su
caso — no antes.

### 5.3 El copy del vínculo a cuenta (sección más delicada del documento)

Mismo campo, mismo copy, reusado literalmente en `DebtFormSheet` (alta) y
`DebtMovementFormSheet` (abono/ampliación, sección 7.3) — se documenta acá
una sola vez y se referencia desde la otra sección.

```html
<div class="flex flex-col gap-1.5">
  <Label for="cuenta-deuda">Cuenta (opcional)</Label>
  <Select v-model="form.accountId" :disabled="isSaving">
    <SelectTrigger id="cuenta-deuda" class="h-11 w-full">
      <SelectValue placeholder="Sin cuenta" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem :value="null">Sin cuenta</SelectItem>
      <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
        {{ account.name }}
      </SelectItem>
    </SelectContent>
  </Select>
  <p class="text-xs text-muted-foreground">
    Si vinculás una cuenta, ajustamos su saldo automáticamente por la plata real que sale o entra —
    pero este movimiento <strong class="font-medium text-foreground">no va a aparecer como gasto ni
    ingreso</strong> en tus listados, solo acá en Deudas.
  </p>
</div>
```

Decisiones de copy explícitas:

1. **El texto de advertencia es siempre visible, no condicional a haber
   elegido una cuenta.** Mismo criterio que pidió el encargo: "ANTES de que
   el usuario lo use, no después, como sorpresa". Si el texto solo
   apareciera tras seleccionar una cuenta, el usuario ya habría tomado la
   decisión sin la información completa (aunque técnicamente todavía podría
   deshacerla antes de guardar) — mostrarlo siempre, incluso con "Sin
   cuenta" seleccionado, es la única forma de garantizar que la información
   llegó *antes* de la elección, no como confirmación posterior.
2. **"no va a aparecer como gasto ni ingreso" en negrita** (`font-medium
   text-foreground` dentro del párrafo `muted`) — es la parte
   contraintuitiva real (el encargo lo señala explícitamente), así que se
   destaca tipográficamente dentro de la oración en vez de quedar diluida
   en un bloque uniforme de texto secundario. No se usa un color semántico
   (`warning`) para esto: no es un estado de alerta/error, es información
   neutral que el usuario necesita para entender el comportamiento — un
   `warning` ahí sobre-dramatizaría una función que funciona exactamente
   como se explica.
3. **Sin `Alert`/ícono de advertencia dedicado**: se evaluó envolver este
   texto en un componente `Alert` (ya instalado en el proyecto,
   `expenses-mvp-ux.md`) pero se descartó — `Alert` en este proyecto se usa
   para errores/estados excepcionales (login, registro), no para texto
   explicativo de un campo de formulario. El patrón ya establecido para
   "explicar honestamente lo que hace un campo" es el helper text
   `text-xs text-muted-foreground` bajo el campo (ver "Límite mensual
   sugerido" de tarjetas, `credit-cards-ux.md` sección 4.1: "Este límite es
   solo una referencia..."; "Saldo inicial" de cuentas,
   `accounts-income-ux.md` sección 6.3) — se sigue ese mismo patrón acá por
   consistencia, no se introduce un tratamiento visual nuevo para un caso
   que el proyecto ya sabe resolver.
4. **Placeholder del `Select` es "Sin cuenta", no un placeholder vacío**:
   deja claro desde el primer render que "no vincular ninguna cuenta" es la
   opción por default y una elección tan válida como cualquier otra — nunca
   fuerza al usuario a decidir sobre este campo (a diferencia de Dirección,
   que sí es requerido).

---

## 6. Detalle de una deuda — `/deudas/:id` (`DebtDetailView.vue`)

Header: `ArrowLeft` (vuelve a `/deudas`) + nombre de la contraparte.

### 6.1 Hero: contraparte, dirección, saldo, estado

```html
<Card>
  <CardHeader>
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-col gap-1">
        <CardDescription>{{ debt.direction === 'lent' ? 'Le presté a' : 'Me prestó' }}</CardDescription>
        <CardTitle class="text-xl font-semibold">{{ debt.personName }}</CardTitle>
        <p v-if="debt.description" class="text-sm text-muted-foreground">{{ debt.description }}</p>
      </div>
      <Badge :variant="debt.balance > 0 ? 'outline' : 'secondary'">
        {{ debt.balance > 0 ? 'Pendiente' : 'Saldada' }}
      </Badge>
    </div>

    <p class="mt-4 text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
      <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(Math.abs(debt.balance)) }}
    </p>
  </CardHeader>
</Card>
```

### 6.2 Ledger de movimientos + badge de cuenta vinculada

Lista completa de `debt_movements` de este hilo (sección 1.3, sin filtro
de fecha, `.limit(500)` defensivo), orden desc por fecha:

```html
<div class="flex flex-col">
  <template v-for="(mov, idx) in movements" :key="mov.id">
    <Separator v-if="idx > 0" />
    <div class="flex items-center gap-3 px-4 py-3">
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="truncate text-sm font-medium">{{ movementVerb(debt.direction, mov.amount) }}</p>
        <p class="truncate text-xs text-muted-foreground">
          {{ formatExpenseDateHeading(mov.movementDate) }}
          <span v-if="mov.description"> · {{ mov.description }}</span>
        </p>
        <p v-if="mov.accountId" class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Wallet class="size-3" /> {{ mov.accountName }}
        </p>
      </div>
      <p class="shrink-0 text-sm font-semibold tabular-nums" :class="mov.amount >= 0 ? 'text-foreground' : 'text-muted-foreground'">
        {{ mov.amount >= 0 ? '+' : '-' }}${{ formatAmount(Math.abs(mov.amount)) }}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" aria-label="Más acciones">
            <EllipsisVertical class="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="openEditMovementSheet(mov)">
            <Pencil class="size-4" /> Editar
          </DropdownMenuItem>
          <AlertDialog>
            <AlertDialogTrigger as-child>
              <DropdownMenuItem :disabled="movements.length <= 1" @select.prevent>
                <Trash2 class="size-4" /> Eliminar
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
                <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction @click="debtsStore.deleteMovement(debt.id, mov.id)">Eliminar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </template>
</div>
```

**Badge de cuenta vinculada** (`Wallet` + nombre de cuenta, como línea de
metadato adicional bajo la fecha/descripción): responde directamente al
pedido del encargo de "no dejarlo invisible una vez guardado". Es texto
real + ícono (nunca solo el ícono), consistente con la regla de a11y de
siempre. Se muestra en **cada** movimiento vinculado, no solo el primero —
si el usuario vinculó distintas cuentas en distintos abonos de un mismo
hilo, cada fila lo indica de forma independiente y correcta.

### 6.3 Acciones: "Ampliar" / "Abonar" (copy según dirección)

```html
<div class="flex gap-3 px-4 pb-6 sm:px-6 lg:px-8">
  <Button variant="outline" class="flex-1" @click="openMovementSheet('down')">
    {{ debt.direction === 'lent' ? 'Cobrar / me devuelven' : 'Pagar / devolver' }}
  </Button>
  <Button class="flex-1" @click="openMovementSheet('up')">
    <Plus class="size-4" /> {{ debt.direction === 'lent' ? 'Prestar más' : 'Me prestan más' }}
  </Button>
</div>
```

Ambos abren `DebtMovementFormSheet` (sección 7) con el toggle
"sube"/"baja" preseleccionado según cuál botón se tocó, pero **siempre
editable dentro del Sheet** (mismo criterio de "el botón preselecciona,
nunca bloquea" ya usado en el resto del proyecto, p. ej. tarjeta
preseleccionada al abrir `CardExpenseFormSheet` desde el detalle de una
tarjeta específica).

### 6.4 Editar/eliminar un movimiento individual — guard del "último movimiento"

- **Editar**: sin restricciones, abre `DebtMovementFormSheet` en modo
  edición (sección 7) con los valores actuales precargados (incluida la
  cuenta vinculada, si tenía).
- **Eliminar**: `AlertDialog` de confirmación, igual que el resto de la app
  — **con un guard nuevo, propio de esta pantalla**: si el hilo tiene
  **un solo movimiento** (`movements.length <= 1`), la opción "Eliminar" de
  ese movimiento queda deshabilitada de antemano (mismo criterio de
  "deshabilitado sin tooltip explicativo" ya aplicado en el resto del
  proyecto para estados disabled simples). Motivo: un hilo de deuda con
  cero movimientos es un estado sin sentido (¿cuál sería su saldo? ¿su
  fecha de creación real?) — si el usuario quiere deshacer el único
  movimiento que existe, la operación correcta es borrar el hilo completo
  (sección 6.5), no dejarlo huérfano y vacío.

### 6.5 Editar/eliminar la deuda completa — sin guard de uso, a diferencia de categorías/cuentas/tarjetas

**Decisión explícita: un hilo de deuda se puede borrar siempre, sin ningún
guard de conteo.** Esto es una diferencia real respecto a
categorías/cuentas/tarjetas/personas (todas bloquean el borrado si tienen
uso asociado) — se documenta por qué el mismo patrón NO aplica acá:

- Categorías/cuentas/tarjetas/personas son **recursos de clasificación o
  identidad** que otros registros (`expenses`, `card_expenses`) referencian
  por FK — borrarlos rompería la integridad de esos otros registros
  (`on delete restrict`, ya vigente en el esquema). Bloquear el borrado
  cuando hay uso es, literalmente, evitar un error de base de datos con un
  mensaje amigable antes de que ocurra.
- Un hilo de deuda **no es referenciado por ningún otro recurso fuera de sí
  mismo** — sus `debt_movements` son hijos propios (cascada), no una
  relación externa. Borrar un hilo de deuda es, conceptualmente, borrar
  **el propio historial personal del usuario** (equivalente a borrar un
  gasto o un ingreso, que tampoco tienen guard de "no lo borres si tiene
  uso" — un gasto no es "usado" por nada más). No hay ningún otro dato de
  la app que dependa de que ese hilo siga existiendo.

Confirmación con `AlertDialog`, con el conteo de movimientos en el copy
(honestidad sobre el alcance de la cascada, no solo "no se puede
deshacer"):

```html
<AlertDialogContent>
  <AlertDialogHeader>
    <AlertDialogTitle>¿Eliminar esta deuda?</AlertDialogTitle>
    <AlertDialogDescription>
      Se van a eliminar también sus {{ movements.length }} movimiento{{ movements.length === 1 ? '' : 's' }}.
      Esta acción no se puede deshacer.
    </AlertDialogDescription>
  </AlertDialogHeader>
  <AlertDialogFooter>
    <AlertDialogCancel>Cancelar</AlertDialogCancel>
    <AlertDialogAction @click="debtsStore.deleteDebt(debt.id)">Eliminar</AlertDialogAction>
  </AlertDialogFooter>
</AlertDialogContent>
```

Al confirmar, navega de vuelta a `/deudas`.

**Editar la cabecera** (Contraparte, Descripción — **no** Dirección, ver
abajo): reusa `DebtFormSheet`, pero en **modo edición muestra únicamente
Contraparte + Descripción**, sin Monto/Fecha/Cuenta (esos campos solo
existen en el momento de creación atómica, sección 5.2 — editar la
cabecera nunca toca `debt_movements`).

**Dirección queda bloqueada en edición** (`disabled`, con el mismo criterio
que el toggle Tipo de `TransactionFormSheet` en modo edición,
`accounts-income-ux.md` sección 7.3): cambiar la dirección de un hilo con
movimientos ya cargados invertiría retroactivamente el significado de cada
signo de `debt_movements.amount` — no es una operación bien definida. Si el
usuario se equivocó de dirección al crear el hilo, borra y crea de nuevo
(mismo criterio de "no construir una migración de tipo in-place para un
caso borde", ya aceptado en el proyecto).

---

## 7. Alta/edición de movimiento — `DebtMovementFormSheet.vue`

### 7.1 Campos, con copy dependiente de la dirección del hilo

```html
<SheetHeader>
  <SheetTitle>{{ sheetTitle }}</SheetTitle>
</SheetHeader>

<form id="debt-movement-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
  <div class="flex flex-col gap-1.5">
    <Label id="tipo-movimiento-label">Tipo de movimiento</Label>
    <div role="radiogroup" aria-labelledby="tipo-movimiento-label" class="flex gap-1 rounded-md bg-muted p-1">
      <button
        type="button" role="radio" :aria-checked="form.kind === 'down'"
        class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :class="form.kind === 'down' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        @click="form.kind = 'down'"
      >
        {{ debt.direction === 'lent' ? 'Cobro / me devuelven' : 'Pago / devuelvo' }}
      </button>
      <button
        type="button" role="radio" :aria-checked="form.kind === 'up'"
        class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :class="form.kind === 'up' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        @click="form.kind = 'up'"
      >
        {{ debt.direction === 'lent' ? 'Presto más' : 'Me prestan más' }}
      </button>
    </div>
  </div>

  <!-- Monto: siempre positivo, el signo lo aplica el store al persistir -->
  <div class="flex flex-col gap-1.5">
    <Label for="monto-movimiento">Monto</Label>
    <div class="flex items-center gap-1.5">
      <span class="text-sm text-muted-foreground">$</span>
      <Input id="monto-movimiento" v-model="form.amountInput" inputmode="decimal" type="text" placeholder="0" class="text-lg font-semibold" :disabled="isSaving" />
    </div>
    <p v-if="errors.amount" class="text-xs text-destructive">{{ errors.amount }}</p>
  </div>

  <!-- Fecha: <input type="date"> nativo, mismo criterio de siempre -->
  <!-- Descripción: opcional -->
  <!-- Cuenta: mismo campo y copy exacto que sección 5.3 -->
</form>
```

- **El usuario nunca tipea un número negativo** — el toggle decide el signo
  (`form.kind === 'down' ? -amount : amount`), aplicado recién al construir
  el payload de guardado. Mismo criterio de "nunca pedirle al usuario que
  piense en signos" ya aplicado en todo el proyecto (montos de gasto/
  ingreso/saldo inicial de cuenta).
- **En modo edición**: el toggle se precarga según el signo del movimiento
  persistido (`amount >= 0 ? 'up' : 'down'`), el campo Monto se precarga con
  `Math.abs(amount)` — el usuario edita en los mismos términos "positivos +
  toggle" en los que originalmente cargó el dato, nunca ve el número crudo
  con signo.
- **Sin bloqueo de campos en edición** (a diferencia de Dirección en
  `DebtFormSheet`, sección 6.5): acá no hay ninguna razón estructural para
  impedir cambiar el tipo/monto/fecha/cuenta de un movimiento ya guardado —
  es un ledger editable línea por línea, mismo criterio que editar un gasto
  ya guardado.

### 7.2 Guardado: 100% optimista — el "delta seguro" sobre un balance ya confirmado

**Se sigue el patrón por defecto del proyecto** (a diferencia de la
excepción de la sección 5.2): insertar/editar/borrar un `debt_movement`
sobre un hilo **ya existente** es un solo insert/update/delete sin ninguna
dependencia de servidor entre dos operaciones — mismo perfil que
`card_expenses` (`credit-cards-ux.md` sección 5.4).

El único punto que merece explicación propia es **cómo se actualiza el
saldo mostrado sin volver a violar la regla de la sección 1.3** ("nunca
sumar `debt_movements` sin acotar"):

```ts
// Ilustrativo — debtsStore.ts
// `balances` es el único lugar de la app que representa "el saldo de un
// hilo" — poblado inicialmente desde `debt_balances` (sección 1.2, agregado
// server-side). Nunca se deriva sumando el array `movements` de un hilo,
// aunque sumarlo también sería seguro por su volumen chico (sección 1.3) —
// se evita a propósito tener dos fuentes de verdad del mismo número que
// puedan desincronizarse entre sí.
const balances = ref<Record<string, number>>({})

function addMovement(debtId: string, payload: MovementPayload) {
  const previousBalance = balances.value[debtId] ?? 0
  // Delta seguro: `previousBalance` ya es un número confirmado por el
  // servidor (o por una confirmación optimista previa de este mismo
  // mecanismo) — sumarle UN movimiento nuevo no es "sumar una lista sin
  // acotar", es una única operación aritmética sobre un valor ya de
  // confianza. Es el mismo principio que ya usa `expensesStore.monthTotal`
  // al reaccionar a una inserción optimista, aplicado explícitamente acá
  // porque el balance de deuda no vive en un computed reactivo simple sino
  // en un mapa poblado por agregación server-side.
  balances.value[debtId] = previousBalance + payload.amount

  // ... insertar optimista en `movements[debtId]`, persistir en Supabase,
  // y hacer rollback de AMBOS (balances.value[debtId] = previousBalance +
  // la lista de movimientos) si el insert falla — mismo mecanismo de toast
  // + acción "Reintentar" que el resto del proyecto.
}
```

Edición/borrado de un movimiento existente siguen la misma lógica de delta
(sumar la diferencia entre el valor viejo y el nuevo, o restar el valor
borrado) — nunca se vuelve a leer `debt_balances` completo tras cada
mutación optimista, solo se ajusta el número en memoria; el próximo
`fetch` real de la pantalla (p. ej. al volver a entrar a `/deudas`)
reconcilia con el valor server-side de todos modos, mismo patrón de
"optimista con reconciliación eventual" que el resto del proyecto.

### 7.3 Copy del vínculo a cuenta

Mismo campo, mismo texto, misma justificación que la sección 5.3 — no se
repite acá, se reusa el componente/markup tal cual.

---

## 8. Activar el acceso rápido "Deudas" en Inicio

`HomeView.vue` ya tiene el botón deshabilitado (`accounts-income-ux.md`
sección 9, ícono `HandCoins` ya importado). Cambio puntual:

```html
<!-- Antes -->
<Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" disabled aria-disabled="true">
  <HandCoins class="size-5" />
  <span class="text-xs font-medium">Deudas</span>
  <span class="text-[10px] text-muted-foreground">Próximamente</span>
</Button>

<!-- Después -->
<Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" @click="router.push({ name: 'debts' })">
  <HandCoins class="size-5" />
  <span class="text-xs font-medium">Deudas</span>
</Button>
```

Se quita `disabled`/`aria-disabled`/el texto "Próximamente" y se agrega el
`@click`. Navega directo a `/deudas` (no abre ningún Sheet automáticamente)
— mismo criterio que "Saldo" ya funcional (sección 9 de
`accounts-income-ux.md`), que tampoco abre nada, solo navega.

---

## 9. Navegación: nuevo ítem "Deudas" en el drawer

Ícono `HandCoins`, ya confirmado en `@lucide/vue` (usado hoy en el acceso
rápido de Inicio) — nada que instalar.

**Posición: último lugar del bloque de "dominios de datos de movimientos de
dinero"**, inmediatamente después de "Cuentas" y antes de "Categorías" (el
`<nav>` pasa de 8 a 9 ítems):

| Orden | Label | Ícono | `route.name` |
|---|---|---|---|
| 1 | Inicio | `Home` | `home` |
| 2 | Transacciones | `ArrowLeftRight` | `transactions` |
| 3 | Tarjetas de crédito | `CreditCard` | `cards` |
| 4 | Cuentas | `Wallet` | `accounts` |
| **5** | **Deudas** | **`HandCoins`** | **`debts`** |
| 6 | Categorías | `Tag` | `categories` |
| 7 | Estadísticas | `ChartPie` | `statistics` |
| 8 | Reportes | `FileText` | `reports` |
| 9 | Ajustes | `Settings` | `settings` |

Justificación del orden: mismo criterio ya usado para "Tarjetas de crédito"
(`credit-cards-ux.md` sección 7) y "Cuentas" (`accounts-income-ux.md`
sección 10) — Deudas es, igual que Transacciones/Tarjetas/Cuentas, un
**dominio de datos de movimientos de dinero** (tiene su propio historial,
dashboard, alta, detalle), no metadata de clasificación como Categorías.
Va **al final** de ese bloque (después de Cuentas, no antes) porque es,
de las cuatro, la más reciente y la de uso esperado menos frecuente para la
mayoría de usuarios (no todo el mundo presta o pide plata prestada
regularmente, a diferencia de gastar con tarjeta o registrar un gasto) —
mismo criterio de "frecuencia de uso esperada" que ya ordenó
Transacciones antes que Tarjetas (gasto personal es más universal que
tarjeta de crédito) y Tarjetas antes que Cuentas (una capa organizativa más
transversal, pero menos "acción diaria" que cargar un gasto).

Fila de nav: mismo markup/clases exactas ya establecidas — no se repite el
markup completo, ver `dashboard-redesign-ux.md` sección 6.1 para el patrón
exacto a copiar (`aria-current="page"` cuando `route.name === 'debts'`).

---

## 10. Rutas — resumen completo

```ts
{ path: '/deudas', name: 'debts', component: () => import('@/views/DebtsDashboardView.vue'), meta: { requiresAuth: true } },
{ path: '/deudas/:id', name: 'debt-detail', component: () => import('@/views/DebtDetailView.vue'), meta: { requiresAuth: true } },
```

Se agregan a `src/router/index.ts` junto a las rutas ya existentes, mismo
`meta.requiresAuth` y mismo lazy import por ruta ya usado hoy. Sin
necesidad de orden especial de declaración (sección 2).

---

## 11. Accesibilidad

Se reafirman los lineamientos vigentes de `design-system.md` sección 5, con
las particularidades nuevas de esta feature:

1. **Color nunca como único indicador**: cards resumen "Yo presté"/"Me
   prestaron" siempre con ícono + texto + label real (sección 3.2), estado
   "Pendiente"/"Saldada" como `Badge` de texto real (nunca solo un punto de
   color, sección 3.5/6.1), signo `+`/`-` explícito en saldo neto y en cada
   movimiento (sección 3.3/3.6/6.2), badge de cuenta vinculada siempre con
   ícono **y** nombre de cuenta en texto (sección 6.2), verbo explícito por
   movimiento (`movementVerb`) en vez de depender solo del color/ícono de
   dirección (sección 3.6).
2. **`aria-current="page"`** en el nuevo ítem del drawer, mismo mecanismo ya
   vigente (sección 9).
3. **Mínimo táctil 44×44px**: filas clickeables de la lista de hilos
   (`min-h-11`, sección 3.5), botones de menú `⋮` (`h-11 w-11`, sección
   6.2), FAB (`size-14`, sección 3.9), botones "Ampliar"/"Abonar" del
   detalle (`Button` default ya cumple `h-11` por el ajuste global del
   proyecto).
4. **Foco visible**: mismo patrón `focus-visible:ring-2
   focus-visible:ring-ring focus-visible:ring-offset-2` en todo elemento
   interactivo nuevo, sin excepciones.
5. **`Tabs` con semántica nativa de Reka UI**: `role="tablist"`/`role="tab"`/
   `role="tabpanel"` + navegación con flechas de teclado de fábrica
   (sección 3.4) — no se reimplementa a mano como el `radiogroup` de
   Dirección/Tipo de movimiento (esos sí son campos de formulario binarios,
   semánticamente distintos de un selector de panel de contenido, ver
   justificación completa en 3.4).
6. **Toggles de Dirección/Tipo de movimiento con semántica `radiogroup`**:
   mismo patrón exacto ya usado por Gasto/Ingreso
   (`accounts-income-ux.md` sección 11.5) — `role="radiogroup"` +
   `role="radio"` + `aria-checked`, label asociado vía `aria-labelledby`.
7. **Confirmación antes de destruir**: borrado de un movimiento y borrado de
   un hilo completo pasan por `AlertDialog`, igual que el resto de la app —
   nunca directo desde el tap en "Eliminar" (sección 6.4/6.5). El copy de
   confirmación del hilo completo incluye el conteo de movimientos afectados
   (honestidad sobre el alcance de la cascada, sección 6.5).
8. **Labels asociados, no placeholder-only**: Dirección/Tipo de movimiento
   (`aria-labelledby`), Contraparte, Monto, Fecha, Cuenta llevan
   `<Label for="...">` persistente — ninguno depende solo de un
   `placeholder`. El `Select` de Cuenta usa "Sin cuenta" como placeholder
   real y explícito, no un placeholder vacío tipo "Seleccioná..." (sección
   5.3).
9. **Texto explicativo del vínculo a cuenta siempre visible, nunca solo en
   hover/tooltip**: la advertencia de que el movimiento vinculado no
   aparece como gasto/ingreso es texto plano permanente bajo el campo
   (sección 5.3), no un tooltip que dependa de hover — no hay hover fiable
   en touch, mismo criterio ya aplicado al copy de "límite sugerido" de
   tarjetas.
10. **`prefers-reduced-motion`**: heredado de Sheet/AlertDialog/Tabs (Reka
    UI), sin configuración adicional. `DualTrendChart` (sección 3.8) es
    estático (sin animación de aparición), igual que `TrendAreaChart` —
    no interactúa con esta regla.
11. **`aria-disabled`/`disabled` explícito en el guard del último
    movimiento**: la opción "Eliminar" de un movimiento queda
    deshabilitada si es el único del hilo (sección 6.4), sin tooltip
    explicativo — mismo criterio de "no over-engineer estados disabled
    simples" ya aceptado en el resto del proyecto (p. ej. "Eliminar"
    deshabilitado en una categoría con gastos asociados).

---

## 12. Qué NO se adopta de la referencia ("Mis Finanzas")

Explícitamente descartado, no se construye nada de esto:

- **Nombre/marca "Mis Finanzas"**, su logo (ícono de billetera en cuadrado
  redondeado violeta) — la marca sigue siendo **TipApp** en toda la app,
  mismo criterio de exclusión ya aplicado en `credit-cards-ux.md` sección 11
  y `accounts-income-ux.md` (intro).
- **Campana de notificaciones** del header — mismo criterio de exclusión ya
  aplicado en `dashboard-redesign-ux.md`/`credit-cards-ux.md`: no hay
  sistema de notificaciones en TipApp.
- **Selector de mes "Este mes" con dropdown** en "Resumen rápido" — se
  reemplaza por un mes fijo (el actual, sin selector), justificado en
  sección 3.7: consistencia con el resto de resúmenes mensuales de la app,
  ninguno de los cuales tiene selector propio.
- **Barra lateral fija tipo desktop** (sidebar de navegación permanente a la
  izquierda, con "Nuevo préstamo" como botón grande al pie) — TipApp es
  mobile-first con un drawer deslizable (`Sheet side="left"`), no un
  sidebar fijo; el equivalente funcional es el drawer ya existente (sección
  9) + el FAB flotante (sección 3.9), mismo patrón que el resto de la app.
- **Avatares con iniciales de color** por persona ("JP", "MS", "AC" en
  círculos de colores distintos) — ya decidido explícitamente para
  `card_people` en `credit-cards-ux.md` sección 6.3: sin foto/avatar, sin
  Storage. Se reemplaza por el mismo ícono `User` genérico ya usado ahí para
  persona sin identidad visual propia (sección 3.5), no se introduce un
  sistema de iniciales-con-color nuevo solo para esta pantalla.
- **Botón "Ver todos (5)" con contador entre paréntesis** en la lista de
  hilos — no aplica: la lista de hilos de esta feature no tiene paginación
  ni recorte (sección 3.5 muestra todos los hilos de la dirección activa,
  no un top-N), así que no hace falta un link "ver todos" — ese patrón sí
  se usa en otras partes de TipApp (Inicio → Cuentas/Transacciones) donde
  sí hay recorte real.
- **Selector "Historial" con filtros propios de fecha/monto** (la
  referencia no los muestra explícitamente, pero es un patrón común en apps
  similares) — el tab "Historial" de esta feature es deliberadamente simple
  (últimos 30 movimientos, sin filtros, sección 3.6), no una vista de
  reportes — evita ampliar el alcance sin pedido explícito.

---

## Resumen accionable para `vue-frontend-expert`

1. **Componente shadcn-vue nuevo a instalar**: `Tabs`
   (`npx shadcn-vue add tabs`, sección 3.4) — primer uso real en el
   proyecto, sigue el mismo patrón `cva`/`cn`/`data-slot` que el resto de
   `src/components/ui/`.
2. **Store nuevo**: `src/stores/debts.ts` — CRUD de `debts`/
   `debt_movements`:
   - Alta de deuda nueva: **NO optimista** (sección 5.2), vía RPC atómico
     (nombre exacto a confirmar con `supabase-backend-expert`).
   - Alta/edición/borrado de movimiento sobre un hilo existente: **100%
     optimista** (sección 7.2), con el mecanismo de "delta sobre balance ya
     confirmado" (sección 7.2 — un único mapa `balances: Record<string,
     number>`, nunca derivado sumando `movements` ni re-fetcheando
     `debt_balances` tras cada mutación optimista).
   - Borrado de hilo completo: optimista con rollback, **sin ningún guard
     de conteo** (sección 6.5).
   - Lectura de saldos: `fetchBalances()` trae **todas** las filas de
     `debt_balances` del usuario en una sola query (seguro, lista chica de
     hilos — sección 1.2), nunca sumando `debt_movements` en cliente salvo
     dentro de rangos de fecha acotados (mes en curso, últimos 12 meses —
     sección 1.3).
3. **Vistas nuevas**: `DebtsDashboardView.vue` (sección 3),
   `DebtDetailView.vue` (sección 6).
4. **Componentes nuevos**: `DebtFormSheet.vue` (sección 5),
   `DebtMovementFormSheet.vue` (sección 7),
   `src/components/charts/DualTrendChart.vue` (sección 3.8, hermano de
   `TrendAreaChart.vue`, no una extensión de ese componente — ver
   justificación de por qué no se reusa/generaliza en sección 3.8).
5. **`src/lib/charts.ts` o un helper nuevo**: función de derivación de
   `balanceEvolutionPoints` (sección 1.4 — la lógica de "saldo de arranque
   = balance actual − neto de la ventana de 12 meses"), y agregación de
   "Resumen rápido" del mes (sección 3.7). Puede vivir en `debts.ts` mismo o
   en un helper separado — no es una decisión de UX, es organización de
   archivo.
6. **Router**: 2 rutas nuevas bajo `/deudas` (sección 10), sin necesidad de
   orden especial de declaración.
7. **`HomeView.vue`**: activar el acceso rápido "Deudas" (sección 8, quitar
   `disabled`/"Próximamente", agregar `@click`).
8. **Drawer** (`HomeView.vue`): nuevo ítem "Deudas" (`HandCoins`, ya
   confirmado en `@lucide/vue`, nada que instalar) en 5ª posición del
   `<nav>` (pasa de 8 a 9 ítems, sección 9).
9. **`src/stores/cardPeople.ts` / `ManageCardsView.vue`**: ajuste al guard
   de borrado de persona — sumar `debts(count)` al conteo existente de
   `card_expenses(count)` (sección 1.5/4.3). Ajuste chico, no rediseño.
   `ManageCardsView.vue` también necesita soportar `?new=person` en
   `onMounted` para abrir `CardPersonFormSheet` directo (sección 4.2),
   mismo patrón que `?new=1` ya usado en otras vistas.
10. **Punto más importante de todo el documento (sección 1)**: el saldo de
    un hilo de deuda **siempre** viene de `debt_balances` (agregado
    server-side), nunca de sumar `debt_movements` de ese hilo en cliente —
    excepto la única excepción documentada y justificada del "delta seguro"
    optimista (sección 7.2, aritmética sobre un valor ya confirmado, no un
    resumen desde cero). La lista completa de `debt_balances` (una fila por
    hilo, no por movimiento) sí es segura de traer y sumar entera en
    cliente por su cardinalidad chica (sección 1.2) — distinción importante
    que no es una excepción al principio general, sino su aplicación
    correcta a una tabla de cardinalidad distinta a `expenses`/
    `card_expenses`.
11. Pendiente para otra sesión (no bloqueante): confirmar con
    `supabase-backend-expert` los nombres exactos de columna de `debts`/
    `debt_movements`, la firma exacta del RPC de alta atómica (sección 5.2),
    y el nombre/forma final de la vista `debt_balances` (sección 1.1) — este
    documento asumió nombres plausibles en `snake_case` solo a título
    ilustrativo.
