# TipApp — UX de Cuentas + Ingresos (Fase 1 de 2)

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, Sheet inferior, a11y), `docs/features/dashboard-redesign-ux.md`
(estructura actual de `HomeView.vue`, `TrendAreaChart`/`CategoryDonutChart`,
helper `src/lib/charts.ts`, `isMonthSafeToShow`) y `docs/features/
credit-cards-ux.md` (patrón completo de gestión de un recurso propio: ruta
dedicada vs. Sheet, conteo dedicado para guard de borrado, paleta fija de
swatches, Sheet con guardado optimista vs. no optimista). No se repite esa
justificación acá, solo se referencia y se indica explícitamente qué se reusa
tal cual y qué es nuevo.

Contexto de producto (ya decidido por el Product Owner, no se rediscute acá):
esta es la **Fase 1** de dos. Fase 1 agrega **Cuentas** como capa organizativa
de los movimientos de dinero: cada gasto y cada ingreso pertenece a una
cuenta, y el saldo de una cuenta es un acumulado **all-time** (ingresos menos
gastos de esa cuenta), no un corte mensual. Fase 2 ("Deudas/Préstamos") es un
encargo aparte, futuro — no se diseña acá, pero se deja un acceso rápido
"Deudas" ya ubicado en el layout, deshabilitado/placeholder, nunca roto ni
404 (sección 9).

La referencia visual ("WalletVie", mockup de otra app) se usa **únicamente**
para los flujos/layout que muestra (saldo total, grid de cuentas, accesos
rápidos, resumen del mes) — se adapta, no se copia literal: marca/logo siguen
siendo TipApp, sin ningún branding de "WalletVie". Igual criterio de exclusión
ya aplicado en `credit-cards-ux.md` sección 11 (sin badges de marketing, sin
indicador de "última sincronización", sin campana de notificaciones).

---

## 1. Estrategia de datos: por qué el saldo de una cuenta NO puede salir de `expensesStore.expenses`

Esta es la decisión más importante del documento, en el mismo sentido en que
`credit-cards-ux.md` sección 1 lo fue para tarjetas — léase antes que
cualquier otra sección, porque condiciona qué puede renderizar el frontend
con seguridad.

### 1.1 El problema, en términos concretos

El saldo de una cuenta es, por definición del Product Owner, un acumulado
**all-time**: `saldo = saldo_inicial + Σ(incomes.amount) - Σ(expenses.amount)`
de **toda la historia** de esa cuenta, no de un mes. `expensesStore.expenses`
trae, como ya documentó `dashboard-redesign-ux.md` sección 1, **los 200
gastos más recientes** (`order desc, limit(200)`, sin filtro de fecha) — una
ventana que ya hoy puede no alcanzar a cubrir "todo lo que gastó el usuario
en su vida" para una cuenta con uso intenso. Sumar `expensesStore.expenses`
filtrado por `account_id` para calcular un saldo **subestimaría** el gasto
real apenas el usuario supere 200 gastos totales, y el error crece
silenciosamente con el tiempo — exactamente el tipo de bug "no es un dato
incompleto, es un dato falso" que `credit-cards-ux.md` sección 1.1 ya
identificó para el caso de meses históricos.

### 1.2 Decisión: el saldo se calcula en el servidor, nunca sumando una lista capada en cliente

**Ninguna pantalla de esta feature calcula un saldo de cuenta sumando un
array ya cargado en el store de gastos/ingresos.** El saldo (por cuenta, y el
"saldo total" que suma todas las cuentas) se pide como un **agregado ya
resuelto por Postgres**, mismo criterio que llevó a `credit-cards-ux.md`
sección 1.2 a decidir queries acotadas por rango de fecha en vez de "traer
todo y sumar en cliente" — acá el equivalente es "agregar en el servidor",
porque no hay ningún rango de fecha que acotar (el saldo es explícitamente
all-time, no admite una ventana).

Se recomienda a `supabase-backend-expert` una **vista de Postgres**
(`account_balances` o similar, nombre ilustrativo a confirmar) con una fila
por cuenta:

```sql
-- Ilustrativo, no es la migración final — confirmar con supabase-backend-expert
select
  a.id as account_id,
  a.user_id,
  a.initial_balance
    + coalesce(sum(i.amount), 0)
    - coalesce(sum(e.amount), 0) as balance
from accounts a
left join incomes i on i.account_id = a.id
left join expenses e on e.account_id = a.id
group by a.id;
```

El frontend hace una única query (`select * from account_balances where
user_id = :userId`) al cargar Inicio o `/cuentas`, y usa ese número
directamente — nunca lo deriva de `expensesStore.expenses`/una futura lista
de ingresos capada. Si por alguna razón de esta sesión no se llega a
implementar la vista, la alternativa aceptable (no la ideal) es una función
RPC de Postgres que haga el mismo `SUM` agregado bajo demanda — lo que
**no** es aceptable es resolverlo con un `.select('amount')` sin límite ni
agregación traído entero al cliente para sumarlo ahí (mismo argumento de
"no reinventar el problema de `MAX_EXPENSES`" que ya cerró esta discusión
para tarjetas).

### 1.3 Consecuencia para "Total del mes" (el hero ya existente)

Como el hero de Inicio (`Total del mes`, sección 2) **no cambia de
significado** (ver sección 2 — decisión explícita de no convertirlo en
"saldo total"), su fuente de datos tampoco cambia: sigue siendo
`expensesStore.expenses` filtrado al mes en curso, con el mismo
`isMonthSafeToShow`/delta condicional ya implementado. Esta sección 1 aplica
específicamente al **saldo de cuenta** (nuevo), no al total de gasto
mensual (ya existente y sin tocar).

### 1.4 Conteo dedicado para el guard de borrado (mismo patrón que categorías/tarjetas)

Mismo mecanismo ya establecido dos veces en el proyecto
(`categories.ts`/`fetchExpenseCounts`, `creditCards.ts`/`cardPeople.ts`
sección 1.3 de `credit-cards-ux.md`): un query agregado embebido de
PostgREST, all-time, cargado junto con la lista de `/cuentas` (sección 6),
no bajo demanda:

```ts
supabase.from('accounts')
  .select('id, expenses(count), incomes(count)')
  .eq('user_id', userId)
```

`Eliminar` queda deshabilitado de antemano si `expenses.count + incomes.count
> 0` para esa cuenta — calculado al cargar la pantalla, igual que
categorías/tarjetas. Sección 6.4 agrega una **segunda regla de guard**,
propia de cuentas, que no tiene equivalente en categorías/tarjetas: no se
puede borrar la única cuenta que le queda al usuario, incluso si esa cuenta
tiene cero movimientos (ver sección 6.4).

---

## 2. Decisión de arquitectura de información: el hero de Inicio NO se convierte en "saldo total"

Pregunta del encargo: ¿el grid de "Mis cuentas" reemplaza al hero actual de
"Total del mes"? ¿conviven? ¿el hero pasa a ser "saldo total"?

**Decisión: conviven. El hero "Total del mes" (gasto del mes, con tendencia
acumulada y delta vs. mes anterior) se mantiene exactamente como está hoy,
sin cambiar su significado.** Se agrega una sección nueva "Mis cuentas"
inmediatamente debajo, con un "Saldo total" propio (compacto, sin gráfico de
tendencia) dentro de esa misma sección — no como hero que reemplaza al
actual.

### 2.1 Por qué no conviene fusionar ambos conceptos en un solo hero

1. **Son dos preguntas distintas, con dos naturalezas de dato distintas.**
   "Total del mes" responde una pregunta de **flujo**: "¿cuánto gasté este
   mes, y estoy gastando más o menos que el mes pasado?". "Saldo total"
   responde una pregunta de **stock**: "¿cuánta plata tengo ahora mismo,
   repartida en mis cuentas?". Convertir el hero en saldo total perdería la
   respuesta a la primera pregunta (la que la app entera — dashboard,
   estadísticas, categorías — ya está construida para responder), a cambio
   de ganar la segunda. No hace falta elegir: son complementarias, no
   sustitutas, y el layout tiene lugar para ambas sin apretujar información.

2. **La tendencia/delta actual pierde sentido matemático si el hero pasa a
   ser saldo.** Hoy `cumulativeDailyPoints` es gasto acumulado del mes
   (arranca en 0, termina en `monthTotal`) y `monthDelta` compara
   `monthTotal` vs. el mes anterior — una comparación de flujo contra flujo,
   coherente. Si el hero pasara a ser "saldo total", el punto de partida del
   mes ya **no es cero** (es el saldo que traía de meses anteriores), así
   que la serie diaria dejaría de "reforzar visualmente el número grande de
   arriba" (que es exactamed la razón de ser de la serie acumulada, sección
   2.2 de `dashboard-redesign-ux.md`) y pasaría a ser una curva de
   variación neta del mes con un baseline no-cero — un componente distinto,
   no una reutilización trivial de `TrendAreaChart` (ver nota en sección 3.5
   sobre por qué no se resuelve ese caso ahora). Y el semáforo de color
   (`destructive` si sube, `success` si baja, sección 2.2 de
   `dashboard-redesign-ux.md`) literalmente se **invertiría**: gastar más
   que el mes pasado es malo (hero actual), pero tener más saldo que el mes
   pasado es bueno (hero hipotético) — cambiar esa semántica en un
   componente ya construido y ya coherente en toda la app es un costo real,
   no cosmético.

3. **TipApp v1 sigue siendo, ante todo, un tracker de gastos — Cuentas es
   una capa organizativa nueva, no un reemplazo del producto.** El
   `CLAUDE.md` del proyecto describe TipApp como "control de gastos
   personales", y toda la superficie ya construida (categorías, dona de
   categoría, estadísticas, presupuestos previstos) orbita alrededor de
   "cuánto gasté". Cuentas resuelve una pregunta real y valiosa ("¿de dónde
   sale la plata, y cuánto me queda?") pero es un complemento — no hay
   pedido explícito del Product Owner de reconvertir TipApp en una app de
   patrimonio neto. Mantener el hero como está es la lectura más fiel al
   alcance pedido.

### 2.2 Qué se agrega, y en qué orden exacto en `HomeView.vue`

Orden final de secciones en el `<main>` de Inicio (las que dicen "sin
cambios" son exactamente las de `dashboard-redesign-ux.md`, no se tocan):

1. Saludo — sin cambios.
2. **Total del mes** (hero, tendencia + delta) — sin cambios (sección 2.1).
3. **Mis cuentas** — NUEVO (sección 2.3).
4. **Accesos rápidos** (Saldo / Pagos / Deudas) — NUEVO (sección 9).
5. **Resumen por categoría** (dona) — sin cambios.
6. **Transacciones recientes** — cambia de fuente de datos (ahora mezcla
   gastos e ingresos, sección 7.5), el layout/Card se mantiene.

Justificación del orden: "Mis cuentas" va inmediatamente después del hero
porque, tras saber "cuánto gasté este mes", la pregunta natural siguiente es
"¿en qué cuentas está repartida mi plata" — más prioritario que el detalle
por categoría (que sigue siendo related pero un nivel más analítico/
secundario). Los accesos rápidos van pegados a Cuentas porque los tres
(Saldo/Pagos/Deudas) son acciones **sobre** cuentas/finanzas generales, no
sobre categorías — agruparlos con Cuentas es más coherente que dejarlos
sueltos entre la dona y las transacciones recientes.

### 2.3 "Mis cuentas" — Card nueva

```html
<Card>
  <CardHeader>
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-col gap-0.5">
        <CardTitle class="text-base font-semibold">Mis cuentas</CardTitle>
        <CardDescription>
          Saldo total: <span class="font-semibold tabular-nums text-foreground">${{ formatAmount(totalBalance) }}</span>
        </CardDescription>
      </div>
      <CardAction>
        <Button variant="link" size="sm" class="h-auto p-0" @click="router.push({ name: 'accounts' })">
          Ver todas
        </Button>
      </CardAction>
    </div>
  </CardHeader>

  <div class="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
    <button
      v-for="account in topAccounts"
      :key="account.id"
      type="button"
      class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      disabled
      aria-disabled="true"
    >
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-full"
        :style="{ backgroundColor: withAlpha(account.color, 0.15) }"
      >
        <component :is="ACCOUNT_ICONS[account.icon]" class="size-5" :style="{ color: account.color }" />
      </span>
      <div class="flex flex-col gap-0.5">
        <p class="truncate text-sm font-medium">{{ account.name }}</p>
        <p
          class="text-sm font-semibold tabular-nums"
          :class="account.balance < 0 ? 'text-destructive' : 'text-foreground'"
        >
          {{ account.balance < 0 ? '-' : '' }}${{ formatAmount(Math.abs(account.balance)) }}
        </p>
      </div>
    </button>

    <button
      type="button"
      class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      @click="router.push({ name: 'accounts', query: { new: '1' } })"
    >
      <Plus class="size-5" />
      Agregar cuenta
    </button>
  </div>
</Card>
```

Notas de implementación:

- **`topAccounts`**: hasta **5** cuentas, ordenadas desc por `balance` (mismo
  criterio de "las más significativas primero" ya usado en `cardsRanking` de
  `credit-cards-ux.md` sección 2.3) + siempre la tile "Agregar cuenta" al
  final (grid `grid-cols-2`, así que 5 cuentas + 1 tile de alta da 3 filas
  completas). "Ver todas" navega a `/cuentas` (sección 6) siempre, sin
  importar si el usuario tiene 5 cuentas o menos — mismo criterio ya usado
  para "Ver todas" de Transacciones recientes en `dashboard-redesign-ux.md`.
- **Tiles de cuenta NO son clickeables a un detalle** (a propósito:
  `disabled`/`aria-disabled="true"`, sin navegación) — mismo criterio ya
  aplicado a "Transacciones recientes" (`dashboard-redesign-ux.md` sección
  2.4: "vista de solo lectura, esta no reemplaza a la gestión"). No se
  construye un `AccountDetailView` (historial de movimientos por cuenta,
  análogo a `CardDetailView.vue`) en esta iteración — no fue pedido
  explícitamente, y agregarlo es exactamente el tipo de superficie nueva
  (filtros, dona por persona, resumen, edición desde el detalle) que
  `credit-cards-ux.md` sí necesitó pero que acá ampliaría el alcance sin
  pedido. Candidata natural para una futura sesión si el Product Owner lo
  pide — se deja la puerta abierta (la tile ya tiene la forma visual lista
  para volverse clickeable el día que exista destino).
- **`totalBalance`**: viene de la agregación de servidor (sección 1.2), suma
  de `balance` de todas las cuentas del usuario — no se sub-computa sumando
  `topAccounts` (que puede estar recortado a 5).
- **Saldo negativo**: `text-destructive` + signo `-` explícito antes del
  monto (el signo es el indicador primario, el color es refuerzo — nunca
  color solo, mismo criterio que el resto de la app). Saldo en 0 o positivo:
  color de texto normal (`text-foreground`), sin ningún tratamiento
  especial — no se pinta de verde un saldo simplemente por ser positivo (ya
  es el estado esperado, pintarlo introduciría ruido visual constante,
  mismo argumento que "no pintar de rojo cada gasto" en `design-system.md`).
- **Ícono**: `ACCOUNT_ICONS` es un mapa `{ [iconKey]: Component }` de los 6
  íconos de la sección 5, coloreado con `account.color` vía `style` (los
  íconos de Lucide heredan `currentColor`, así que fijar `color` en el
  `style` alcanza, sin necesitar una clase Tailwind dinámica por hex).
- **Estado vacío de la sección** (usuario sin ninguna cuenta — no debería
  pasar nunca en la práctica, ver sección 6.5 sobre la cuenta "General"
  automática, pero se contempla como salvaguarda defensiva): se muestra
  igual la tile "Agregar cuenta" sola, sin cuentas a su lado, sin ningún
  mensaje adicional — el propio grid ya comunica "no hay nada, agregá algo".

---

## 3. Mejora de `TrendAreaChart.vue`

Pedido explícito: mejorar el gráfico que queda **antes de las cuentas**
(justo el hero de "Total del mes" de la sección 2, que se mantiene en su
lugar) — confirma que la sección 2.2 ubicó bien el orden de secciones. Sigue
siendo **SVG a mano, sin ninguna librería nueva** (la decisión de
`dashboard-redesign-ux.md` sección 0 no se reabre).

### 3.1 Qué cambia

Dos mejoras, ambas de bajo costo de implementación y cero dependencias
nuevas:

1. **Curva suavizada** en vez de segmentos rectos (`M`/`L` puro).
2. **Relleno de gradiente** (fade de opacidad hacia abajo) en vez del
   relleno plano actual (`fill-opacity="0.1"` constante).

Todo lo demás del componente (`viewBox`, `preserveAspectRatio="none"`,
`vector-effect="non-scaling-stroke"`, círculo de punto final, línea base +
etiquetas de eje en la variante `showAxis`, sin animación de entrada, sin
tooltip) **no cambia** — sigue siendo válido tal cual lo documentó
`dashboard-redesign-ux.md` sección 5.1.

### 3.2 Curva suavizada: técnica de "punto medio" con `Q` (sin librería de spline)

Técnica liviana y bien conocida para suavizar una polilínea sin ninguna
librería de matemática de curvas: en vez de conectar cada punto con una
línea recta (`L`), se conecta con una curva cuadrática (`Q`) cuyo punto de
control es el propio dato y cuyo punto final es el **punto medio** entre ese
dato y el siguiente. El resultado redondea cada vértice sin nunca
"overshootear" más allá de los dos puntos que promedia (a diferencia de un
Catmull-Rom completo, que si puede overshoot) — más simple de razonar y de
implementar, y numéricamente seguro dentro del `viewBox` existente sin tocar
`TOP_MARGIN`:

```ts
// Reemplaza el `linePath` actual (sección 5.1 de dashboard-redesign-ux.md).
// Técnica de "midpoint smoothing": en vez de una línea recta hasta cada
// punto, una curva cuadrática cuyo control es el dato real y cuyo destino
// es el punto medio hacia el siguiente dato — redondea cada vértice sin
// overshoot (el punto de control real acota la curva entre ambos puntos).
const linePath = computed(() => {
  const pts = coords.value
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`

  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!
    const curr = pts[i]!
    const midX = (prev.x + curr.x) / 2
    const midY = (prev.y + curr.y) / 2
    d += ` Q${prev.x},${prev.y} ${midX},${midY}`
  }
  const last = pts[pts.length - 1]!
  d += ` L${last.x},${last.y}` // cierra el último tramo hasta el dato real
  return d
})
```

`areaPath` se recalcula con el mismo `linePath` suavizado en vez del
`M...L...` recto, cerrando contra la base igual que hoy:

```ts
const areaPath = computed(() => {
  const pts = coords.value
  if (pts.length === 0) return ''
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  // Reusa la misma curva de linePath (sin el "M" inicial) para que el área
  // rellenada siga exactamente el mismo trazo suavizado que la línea.
  const curve = linePath.value.replace(/^M[^Q]+/, '') // quita el "M x,y " inicial
  return `M${first.x},${VIEW_HEIGHT} L${first.x},${first.y} ${curve} L${last.x},${VIEW_HEIGHT} Z`
})
```

(Nota de implementación: el `.replace` de arriba es una forma rápida de
reusar el string ya armado; si `vue-frontend-expert` prefiere más
legibilidad, es igual de válido factorizar un helper `buildSmoothPath(coords):
string` que devuelva solo los comandos `Q.../L...` sin el `M` inicial, y que
tanto `linePath` como `areaPath` lo llamen anteponiendo su propio `M` — más
prolijo que el regex, mismo resultado.)

### 3.3 Relleno de gradiente en vez de opacidad plana

```html
<defs>
  <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="hsl(var(--primary))" stop-opacity="0.28" />
    <stop offset="100%" stop-color="hsl(var(--primary))" stop-opacity="0" />
  </linearGradient>
</defs>
<path :d="areaPath" :fill="`url(#${gradientId})`" stroke="none" />
```

- `stop-color="hsl(var(--primary))"` — igual que hoy, el color sigue
  viniendo de la variable CSS del tema: el gradiente **cambia gratis** con
  `.dark` en el `<html>`, sin ningún watcher ni recálculo imperativo, mismo
  argumento por el que se descartó `chart.js` en `dashboard-redesign-ux.md`
  sección 0.
- Opacidad `0.28 → 0` (en vez de la constante `0.1` actual): un gradiente que
  se desvanece necesita un pico más alto que un relleno plano para que se
  note el efecto cerca de la línea, sin ensuciar la parte baja del área
  (que ya llega a `0`). 0.28 es un valor de partida razonable — ajustar a
  ojo en implementación si se ve muy tenue/muy cargado, no es un número
  mágico exacto.
- **`gradientId` único por instancia**: como el `id` de un `<linearGradient>`
  debe ser único en el documento (dos SVG con el mismo `id="fill"` en la
  misma página pisan la referencia), se genera con `useId()` de Vue (`vue@
  ^3.5.38` ya instalado, confirma disponibilidad):

  ```ts
  import { useId } from 'vue'
  const gradientId = `trend-gradient-${useId()}`
  ```

  Hoy `TrendAreaChart` nunca se monta dos veces simultáneamente en la misma
  vista (un hero en Inicio, uno de tendencia diaria en Estadísticas, nunca
  ambos en pantalla a la vez porque son rutas distintas), así que esto no
  corrige un bug existente — es una salvaguarda barata para que el
  componente siga siendo seguro de reusar si a futuro alguna vista
  necesitara dos instancias lado a lado (p. ej. comparar dos cuentas).

### 3.4 Qué NO cambia (explícito, para no sobre-interpretar el pedido)

- Sin tooltip, sin hover, sin leyenda — mismo alcance acotado de
  `dashboard-redesign-ux.md` sección 0.3, no reabierto acá.
- Sin animación de entrada — mismo criterio de "no over-engineer" ya
  aplicado en el resto del proyecto.
- El punto final (`<circle>`) se mantiene igual, ahora apoyado sobre la
  curva suavizada en vez de la recta — sigue marcando visualmente dónde
  termina la serie.

### 3.5 Por qué esto no habilita todavía un gráfico de "saldo"

Como se decidió en la sección 2.1, el hero de Inicio sigue siendo gasto
mensual, no saldo — así que `TrendAreaChart` no necesita (y esta iteración
no agrega) soporte para un baseline distinto de cero en el relleno de área.
Si a futuro se quisiera graficar la evolución del saldo de una cuenta
(`AccountDetailView`, sección 2.3, fuera de alcance hoy), el componente
necesitaría una prop `baseline?: number` para anclar el área en un valor
que no sea `VIEW_HEIGHT` (cero) — no se resuelve en esta iteración, queda
anotado para cuando exista esa pantalla.

---

## 4. Paleta de color de cuentas

### 4.1 Criterio pedido y por qué `COLOR_SWATCHES` no sirve tal cual

El Product Owner pidió un tono "acorde a la aplicación, no muy llamativo
pero tampoco muy bajo" — ni el pastel/vívido de la referencia visual externa,
ni los 10 tonos ya usados por `COLOR_SWATCHES` (`src/lib/colors.ts`,
compartidos hoy por categorías/tarjetas/personas). Se calibró una paleta
**nueva**, de 8 colores, en un registro más profundo/"jewel tone" —
suficientemente saturada para tener presencia propia (a diferencia de un
pastel lavado), pero sin llegar a los tonos casi neón de
`COLOR_SWATCHES` (que son, literalmente, la escala 500 de Tailwind:
`#f97316`, `#3b82f6`, `#ef4444`, etc. — vívidos por diseño, pensados para un
wash de 12% de opacidad detrás de un badge de texto, no para leerse como
color "serio" de una cuenta bancaria).

### 4.2 Validación con la skill de dataviz (`validate_palette.js`)

Mismo criterio de rigor que ya usó `dashboard-redesign-ux.md` sección 0.4
para auditar la paleta de categorías existente (que, dicho sea de paso, hoy
**falla** ese chequeo en un par de pares — deuda anotada, no de esta
sesión). Para la paleta nueva de cuentas se corrió el validador contra los
8 hex elegidos, en el orden final (el orden importa: el chequeo de
separación CVD solo compara pares **adyacentes** del array, así que el orden
se ajustó para separar los dos pares que resultaban más parecidos entre sí
para daltonismo protán):

```
node validate_palette.js "#b45309,#1d4ed8,#be123c,#7e22ce,#86198f,#0891b2,#047857,#4d7c0f" --mode light
→ ALL CHECKS PASS (lightness band, chroma floor, CVD separation, contraste vs. superficie)

node validate_palette.js "#df670b,#426de6,#ea1f51,#9947e1,#b321bf,#099fc3,#06a87a,#609b13" --mode dark --surface "#0b111e"
→ ALL CHECKS PASS (un WARN en el par ciruela↔violeta, ΔE 11.4 — dentro de la
  banda 8–12 que el propio validador considera legal siempre que haya
  codificación secundaria, y acá siempre la hay: nombre de cuenta en texto
  real al lado del swatch, nunca solo color, regla ya vigente en todo el
  proyecto)
```

Nota honesta: esto deja a la paleta de cuentas en **mejor estado
documentado** que la paleta de categorías actual (que sí falla checks reales
sin variante por tema, sección 0.4 de `dashboard-redesign-ux.md`) — no
porque cuentas sea más importante, sino porque se calibra desde cero
ahora, con la herramienta ya disponible en el repo, y tiene sentido usarla.

### 4.3 Por qué hacen falta variantes light/dark (a diferencia de `COLOR_SWATCHES`)

`COLOR_SWATCHES` es un único array de hex, sin variante por tema — funciona
porque, en la práctica, sus 10 tonos (escala 500 de Tailwind, ya bastante
claros/saturados) se leen razonablemente bien tanto en fondo claro como en
fondo oscuro cuando se usan como wash de 12% + borde. La paleta nueva de
cuentas, al ser deliberadamente **más profunda** (jewel tone, no escala 500),
no tiene esa suerte: probado el mismo set de 8 hex "modo claro" contra el
fondo oscuro real de TipApp, **3 de los 8 caen por debajo de contraste 3:1**
y uno queda fuera de la banda de luminosidad aceptable para modo oscuro
(`#86198f`, ciruela, demasiado oscuro) — un problema real si esos colores se
usan para el ícono/swatch sólido de una cuenta en dark mode, no un
tecnicismo del validador.

**Decisión: cada swatch de cuenta tiene un hex "claro" (el que se guarda en
la base) y un hex "oscuro" (solo de presentación, nunca se persiste), y el
frontend elige cuál pintar según el tema activo.** Esto no es un patrón
inventado de cero para esta feature: `src/lib/colors.ts` ya tiene
`hexToHslTriple(hex, { minLightness })`, usado por el selector de color de
acento (en curso en otra sesión, **no tocar esa lógica**) para el mismo
problema — un color elegido en runtime necesita una variante más clara en
modo oscuro para seguir siendo legible contra un fondo casi negro. La
paleta de cuentas es un caso más simple (son 8 valores fijos de un grid, no
un color libre), así que no hace falta repetir la conversión HSL en
runtime — alcanza con una **tabla estática** `{ hex, darkHex, label }`.

```ts
// src/lib/colors.ts — nueva exportación, NO modifica ninguna función
// existente (hexToRgb/withAlpha/readableTextColor/hexToHslTriple siguen
// intactas; esta paleta es de cuentas, separada de COLOR_SWATCHES).
export const ACCOUNT_COLOR_SWATCHES = [
  { hex: '#b45309', darkHex: '#df670b', label: 'Dorado' },
  { hex: '#1d4ed8', darkHex: '#426de6', label: 'Azul' },
  { hex: '#be123c', darkHex: '#ea1f51', label: 'Granate' },
  { hex: '#7e22ce', darkHex: '#9947e1', label: 'Violeta' },
  { hex: '#86198f', darkHex: '#b321bf', label: 'Ciruela' },
  { hex: '#0891b2', darkHex: '#099fc3', label: 'Cian' },
  { hex: '#047857', darkHex: '#06a87a', label: 'Esmeralda' },
  { hex: '#4d7c0f', darkHex: '#609b13', label: 'Oliva' },
] as const

/** Resuelve el hex a pintar según el tema activo. `hex` es siempre el valor
 * guardado en `accounts.color` (el "claro"); si no matchea ningún swatch
 * conocido (dato legado/manual), se devuelve tal cual sin intentar oscurecer
 * nada — mismo criterio defensivo que el resto de este archivo. */
export function resolveAccountColor(hex: string, isDark: boolean): string {
  if (!isDark) return hex
  const swatch = ACCOUNT_COLOR_SWATCHES.find(s => s.hex === hex)
  return swatch?.darkHex ?? hex
}
```

`isDark` se resuelve igual que ya lo hace el selector de acento:
`document.documentElement.classList.contains('dark')` (`src/stores/auth.ts`
línea ~130) — no se inventa una segunda forma de detectarlo.

### 4.4 Trade-off evaluado: ¿ampliar `COLOR_SWATCHES` o paleta separada?

**Decisión: paleta separada (`ACCOUNT_COLOR_SWATCHES`), no se toca
`COLOR_SWATCHES`.** Motivos:

1. **Fragmentar vs. diluir**: `COLOR_SWATCHES` ya tiene 3 consumidores en
   producción (`CategoryFormSheet`, `CardFormSheet`, `CardPersonFormSheet`).
   Agregar 8 tonos nuevos y más profundos a ese mismo array cambiaría —sin
   que nadie lo haya pedido— el grid de color que ya ven esas 3 pantallas
   (una mezcla de 10 tonos vívidos + 8 jewel-tone en un mismo grid se vería
   incoherente, y algunos serían más difíciles de distinguir entre sí que
   los 10 originales, ya validados informalmente por reuso). Es un cambio
   visual no solicitado en pantallas ya shippeadas.
2. **Necesitan variantes de tema distintas** (sección 4.3) — `COLOR_SWATCHES`
   hoy es un array plano sin esa noción; agregarle `darkHex` a los 10
   existentes es un cambio de forma de dato que ningún consumidor actual
   pide ni necesita (sus 10 tonos ya funcionan razonablemente en ambos
   temas, según el criterio original del design system).
3. **Los tonos ya sirven para dominios distintos** (categoría, tarjeta,
   persona) que **no necesitan** distinguirse entre sí — una tarjeta y una
   categoría nunca se muestran una al lado de la otra compitiendo por
   distinguibilidad. Una cuenta sí conviene que se vea visualmente distinta
   de una tarjeta de crédito en el mismo dashboard (ambas son "de dónde sale
   la plata") — tener un registro de color deliberadamente distinto (más
   profundo) ayuda, no solo estéticamente sino como señal de "esto es una
   cosa distinta a una tarjeta".

Costo de esta decisión: un segundo array de swatches para mantener a futuro.
Aceptable — es exactamente el mismo costo que ya se pagó al introducir
`COLOR_SWATCHES` una vez, y evita el riesgo mayor (cambiar pantallas ya
shippeadas sin pedido).

---

## 5. Set de íconos de cuenta

### 5.1 Selección final (los 6 candidatos del Product Owner, confirmados en `@lucide/vue`)

Verificado en `node_modules/@lucide/vue/dist/esm/icons/` (mismo método ya
usado para confirmar íconos en `dashboard-redesign-ux.md`/
`credit-cards-ux.md`) — los 6 existen, ninguno requiere instalar nada:

| Ícono | Archivo confirmado | Label (grid/aria-label) | Uso sugerido |
|---|---|---|---|
| `Wallet` | `wallet.mjs` | "Billetera" | Efectivo / cuenta de uso diario (default de "General", sección 6.5) |
| `PiggyBank` | `piggy-bank.mjs` | "Ahorros" | Cuenta de ahorro |
| `Landmark` | `landmark.mjs` | "Banco" | Cuenta bancaria |
| `Building2` | `building-2.mjs` | "Negocio" | Cuenta de un emprendimiento/negocio propio |
| `ShieldCheck` | `shield-check.mjs` | "Protegida" | Fondo de emergencia / reserva |
| `Banknote` | `banknote.mjs` | "Efectivo" | Plata en mano, distinto de "Billetera" (cuenta genérica) |

No se agregan íconos extra a los 6 sugeridos: son suficientes para cubrir
los casos de uso reales de un tracker personal (efectivo, ahorro, banco,
negocio, reserva) sin sobrecargar un grid de selección — mismo criterio de
"set chico y fijo" ya aplicado a los 10 swatches de color y a los 6-7 ítems
del drawer.

### 5.2 Patrón de selector: grid, mismo criterio que el selector de color

Mismo patrón visual que el grid de color de `CardFormSheet.vue`/
`CategoryFormSheet.vue` (`role="group"` + `aria-labelledby`, botones
`size-11`, estado seleccionado con anillo), adaptado a íconos en vez de
color sólido:

```html
<div class="flex flex-col gap-1.5">
  <Label id="icono-cuenta-label">Ícono</Label>
  <div id="icono-cuenta" role="group" aria-labelledby="icono-cuenta-label" class="flex flex-wrap gap-3">
    <button
      v-for="item in ACCOUNT_ICON_OPTIONS"
      :key="item.key"
      type="button"
      class="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="{ 'ring-2 ring-offset-2 ring-ring': form.icon === item.key }"
      :aria-pressed="form.icon === item.key"
      :aria-label="item.label"
      :disabled="isSaving"
      @click="form.icon = item.key"
    >
      <component
        :is="item.component"
        class="size-5"
        :style="{ color: form.color ? resolveAccountColor(form.color, isDarkNow) : undefined }"
      />
    </button>
  </div>
</div>
```

- `ACCOUNT_ICON_OPTIONS`: array `{ key: 'wallet' | 'piggy-bank' | 'landmark'
  | 'building-2' | 'shield-check' | 'banknote', component: Component,
  label: string }[]` — vive junto a `ACCOUNT_COLOR_SWATCHES` (mismo módulo o
  uno nuevo `src/lib/accountIcons.ts`, a criterio de `vue-frontend-expert`;
  no es una decisión de UX, es organización de archivo).
- **Orden recomendado en el formulario: Nombre → Color → Ícono.** Al llegar
  al selector de ícono, `form.color` ya está elegido, así que el ícono se
  previsualiza directamente en el color final de la cuenta (detalle de
  pulido, no imprescindible pero barato de implementar con el patrón de
  arriba — si `form.color` todavía es `null` porque el usuario saltea el
  orden con Tab, el ícono cae al color por defecto heredado, `text-
  foreground` vía la ausencia de `style`, sin romper nada).
- `form.icon` **default `'wallet'`** al abrir el Sheet en modo alta (a
  diferencia de `form.color`, que si se deja requerido y sin default,
  fuerza elección consciente — ver sección 6.2 sobre por qué el ícono sí
  puede tener un default razonable y el color no).

---

## 6. Flujo de alta/edición/borrado de cuenta

### 6.1 Ruta dedicada, no Sheet — una única ruta (a diferencia de tarjetas)

Mismo criterio ya usado dos veces: gestión de baja frecuencia → ruta
dedicada, no Sheet-modal para el listado (`categories-mvp-ux.md` sección 1,
`credit-cards-ux.md` sección 6.1). **Cuentas es una única entidad** (a
diferencia de tarjetas, que tuvo que modelar tarjetas + personas juntas) y,
a diferencia de tarjetas, **no tiene un dashboard/detalle propio en esta
iteración** (sección 2.3 ya explicó por qué no se construye
`AccountDetailView`) — así que la complejidad de ruteo real es mucho más
parecida a **Categorías** que a Tarjetas: una sola ruta `/cuentas`
(`name: 'accounts'`) que sirve de listado + punto de entrada del Sheet de
alta/edición, igual que `/categorias`.

```ts
{ path: '/cuentas', name: 'accounts', component: () => import('@/views/AccountsView.vue'), meta: { requiresAuth: true } },
```

### 6.2 `AccountsView.vue` — listado

Mismo layout que `CategoriesView.vue` (sin el split "predeterminadas/mías"
de categorías — **todas** las cuentas son del usuario, no hay concepto de
cuenta "del sistema"):

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="text-xl font-semibold">Cuentas</h1>
</header>

<main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
  <Card>
    <CardHeader class="flex-row items-center justify-between gap-2">
      <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tus cuentas
      </CardTitle>
      <CardAction>
        <Button variant="ghost" size="icon" aria-label="Nueva cuenta" @click="openAddSheet">
          <Plus class="size-5" />
        </Button>
      </CardAction>
    </CardHeader>

    <div class="flex flex-col">
      <template v-for="(account, idx) in accountsStore.accounts" :key="account.id">
        <Separator v-if="idx > 0" />
        <div class="flex items-center gap-3 px-4 py-3">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full"
            :style="{ backgroundColor: withAlpha(account.color, 0.15) }"
          >
            <component :is="ACCOUNT_ICONS[account.icon]" class="size-4.5" :style="{ color: resolveAccountColor(account.color, isDark) }" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col">
            <p class="truncate text-sm font-medium">{{ account.name }}</p>
            <p class="text-xs text-muted-foreground">{{ usageLabel(account.id) }}</p>
          </div>
          <div class="flex flex-col items-end gap-0.5">
            <p class="text-sm font-semibold tabular-nums" :class="account.balance < 0 ? 'text-destructive' : 'text-foreground'">
              {{ account.balance < 0 ? '-' : '' }}${{ formatAmount(Math.abs(account.balance)) }}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" aria-label="Más acciones">
                <EllipsisVertical class="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="openEditSheet(account)">
                <Pencil class="size-4" /> Editar
              </DropdownMenuItem>
              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <DropdownMenuItem :disabled="!canDelete(account.id)" @select.prevent>
                    <Trash2 class="size-4" /> Eliminar
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar "{{ account.name }}"?</AlertDialogTitle>
                    <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction @click="accountsStore.deleteAccount(account.id)">Eliminar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </template>
    </div>
  </Card>
</main>
```

- `usageLabel(accountId)`: `"Sin movimientos"` / `"{n} movimientos"`, suma de
  `expenses.count + incomes.count` del conteo dedicado (sección 1.4) — mismo
  copy/patrón que `usageLabel` de `CategoriesView.vue`, adaptado a "gastos"
  → "movimientos" porque ahora incluye ambos tipos.
- **Orden de la lista**: `created_at` asc (orden de creación, cuenta más
  vieja primero) — a diferencia del grid de Inicio (sección 2.3, que ordena
  por saldo desc porque ahí importa "las más relevantes primero" en un
  espacio recortado a 5). Acá se lista todo sin recorte, así que conviene un
  orden estable/predecible en vez de uno que salte cada vez que cambia un
  saldo.
- Estado vacío de la sección: no debería ocurrir en la práctica (la cuenta
  "General" se crea automáticamente al registrarse, sección 6.5), pero si
  ocurriera (dato legado, cuenta "General" borrada manualmente en la base
  antes de que exista el guard — no debería pasar vía UI): ícono `Wallet`,
  "Todavía no tenés ninguna cuenta.", botón "Nueva cuenta".
- Soporta `?new=1` (llegada desde la tile "Agregar cuenta" de Inicio, sección
  2.3): `onMounted` revisa `route.query.new === '1'` y llama `openAddSheet()`
  — mismo patrón exacto que `?new=1` de Transacciones (`dashboard-redesign-
  ux.md` sección 3.4).

### 6.3 `AccountFormSheet.vue` — alta/edición

Mismo patrón estructural que `CardFormSheet.vue` (`Sheet side="bottom"`,
`SheetHeader`/`SheetTitle`, body `gap-4 px-4`, footer con un botón ancho
completo):

1. **Nombre** (`Input`, requerido, `maxlength="40"`) — validación básica de
   no-vacío tras `trim()`, sin chequeo de duplicado (mismo argumento que
   "Personas" en `credit-cards-ux.md` sección 6.3: las cuentas de un usuario
   nunca se mezclan con una lista compartida "del sistema", así que no hay
   ambigüedad real si dos cuentas comparten nombre).
2. **Color** (grid de 8 swatches de `ACCOUNT_COLOR_SWATCHES`, sección 4,
   **requerido** — mismo criterio que tarjetas, no que personas: una cuenta
   siempre necesita identidad visual propia, no hay equivalente al caso
   "sin persona asignada" de tarjetas).
3. **Ícono** (grid de 6 opciones, sección 5, con default `'wallet'`
   preseleccionado en modo alta — no fuerza elección consciente como el
   color, porque un ícono "equivocado" es un costo cosmético bajo, mientras
   que un color sin elegir dejaría la cuenta sin identidad visual en toda la
   app; en modo edición, precarga el ícono guardado).
4. **Saldo inicial** (`Input type="number"`, opcional, default `0`, admite
   negativo): helper text `"Monto que esta cuenta ya tenía antes de empezar
   a usarla en TipApp. Dejalo en blanco si arranca en $0."` A diferencia del
   monto de un gasto/ingreso (que debe ser `> 0`), el saldo inicial admite
   cualquier valor real (positivo, negativo o cero) — una cuenta puede
   arrancar en descubierto. **Nota para `supabase-backend-expert`**: nombre
   de columna ilustrativo `accounts.initial_balance numeric not null default
   0`, a confirmar.

```html
<form id="account-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
  <div class="flex flex-col gap-1.5">
    <Label for="nombre-cuenta">Nombre</Label>
    <Input id="nombre-cuenta" v-model="form.name" placeholder="Ej. Efectivo" maxlength="40" :disabled="isSaving" :aria-invalid="!!errors.name" />
    <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
  </div>

  <!-- grid de color, sección 4 -->
  <!-- grid de ícono, sección 5.2 -->

  <div class="flex flex-col gap-1.5">
    <Label for="saldo-inicial">Saldo inicial <span class="font-normal text-muted-foreground">(opcional)</span></Label>
    <div class="flex items-center gap-1.5">
      <span class="text-sm text-muted-foreground">$</span>
      <Input id="saldo-inicial" v-model="form.initialBalance" inputmode="decimal" type="text" placeholder="0" :disabled="isSaving" :aria-invalid="!!errors.initialBalance" />
    </div>
    <p class="text-xs text-muted-foreground">
      Monto que esta cuenta ya tenía antes de empezar a usarla en TipApp. Dejalo en blanco si arranca en $0.
    </p>
    <p v-if="errors.initialBalance" class="text-xs text-destructive">{{ errors.initialBalance }}</p>
  </div>
</form>
```

**Guardado: 100% optimista**, mismo criterio y misma justificación que
`CardFormSheet.vue` (`credit-cards-ux.md` sección 6.2): no hay ningún índice
único conocido sobre `accounts.name`, así que no hay conflicto server-only
en el camino feliz — cerrar el Sheet de inmediato + insertar optimista +
rollback con toast si falla. Si a futuro se agrega una restricción de
unicidad, migrar al patrón no-optimista de `CategoryFormSheet` en ese
momento (mismo aviso ya dejado para tarjetas).

**Edición de "Saldo inicial" en una cuenta existente**: editable sin
restricciones especiales — recalcula el saldo mostrado de inmediato (es un
simple sumando de la vista de agregación, sección 1.2). No hay historial de
auditoría de este campo en v1 (si el usuario lo cambia dos veces, no queda
registro de los valores anteriores) — simplicidad aceptada, mismo nivel que
el resto de la app en esta etapa.

### 6.4 Borrado: dos guards, no uno

Además del guard por conteo de uso (sección 1.4, igual a categorías/
tarjetas), cuentas necesita una **segunda regla, nueva**: no se puede borrar
la única cuenta que le queda al usuario, incluso si tiene cero movimientos
— porque todo gasto/ingreso necesita una cuenta a la cual pertenecer
(`account_id` es `NOT NULL`, sección 1 y sección 12), así que un usuario sin
ninguna cuenta quedaría bloqueado para registrar cualquier movimiento nuevo.

```ts
function canDelete(accountId: string): boolean {
  if (accountsStore.accounts.length <= 1) return false // regla nueva: nunca la última
  return accountsStore.countFor(accountId) === 0 // regla ya conocida: sin uso
}
```

El botón "Eliminar" del menú `⋮` queda deshabilitado de antemano por
cualquiera de las dos razones — no hace falta (ni conviene) diferenciar el
copy de por qué está deshabilitado con un tooltip: el estado disabled + el
resto de cuentas visibles en la misma lista ya comunican suficiente
contexto, mismo criterio de "no over-engineer" ya aplicado en el resto del
proyecto para estados disabled sin texto explicativo adicional (p. ej. el
botón "Eliminar" de categorías con gastos asociados).

### 6.5 Cuenta "General" automática al registrarse

Para que ningún usuario quede nunca sin ninguna cuenta (necesaria para el
guard de la sección 6.4 y para que el selector de cuenta del formulario de
gasto/ingreso, sección 8, nunca esté vacío), se necesita crear
automáticamente una cuenta **"General"** (ícono `Wallet`, color = primer
swatch de `ACCOUNT_COLOR_SWATCHES`, `initial_balance = 0`) para cada usuario
nuevo. **Nota para `supabase-backend-expert`**: el proyecto ya tiene
exactamente este patrón resuelto para `profiles` — el trigger
`handle_new_user()` en `supabase/migrations/20260716142005_profiles_init.sql`
crea el profile automáticamente al insertarse una fila en `auth.users`;
extender ese mismo trigger (o agregar uno adicional sobre el mismo evento)
para además insertar la cuenta "General" es la forma más directa de
garantizar esto sin depender de que el frontend recuerde hacerlo en cada
flujo de registro.

Consecuencia de migración (a coordinar con `supabase-backend-expert`, fuera
de esta especificación de UX pero con impacto directo en la experiencia): al
agregar `expenses.account_id`/`incomes.account_id` como `NOT NULL`, los
gastos **ya existentes** de usuarios reales (el proyecto Supabase remoto ya
tiene datos de prueba, según `CLAUDE.md`) necesitan backfill hacia la cuenta
"General" de cada usuario **antes** de poder aplicar el `NOT NULL` — mismo
orden de operaciones que cualquier migración de columna obligatoria sobre
una tabla con filas existentes. No se ofrece una pantalla de "reasignación
masiva de cuenta" en v1 (mismo criterio ya aplicado a categorías: reasignar
la cuenta de un gasto puntual se hace editándolo individualmente desde el
Sheet de alta/edición, sección 7 — no hay una herramienta de bulk-reasignar,
fuera de alcance).

---

## 7. Flujo de alta de ingreso

### 7.1 Decisión: extender `ExpenseFormSheet.vue` (renombrado a `TransactionFormSheet.vue`), no un Sheet nuevo

**Se extiende el Sheet existente con un selector de tipo Gasto/Ingreso, en
vez de crear un `IncomeFormSheet.vue` separado.**

#### Por qué reusar (pros)

- `incomes` es, por decisión explícita del Product Owner, **simétrica a
  `expenses` salvo por la categoría** — mismo monto, misma cuenta, misma
  fecha, misma descripción opcional. Un Sheet nuevo duplicaría el ~80% del
  formulario (input de monto con parseo de coma/punto, `<input type=date>`
  nativo, descripción, el patrón completo de guardado optimista con cierre
  inmediato + toast de confirmación/rollback) por la sola diferencia de un
  campo.
- Mismo criterio de "no duplicar estado/lógica" ya aplicado varias veces en
  el proyecto (`categories.ts` separado de `expenses.ts` pero sin duplicar
  el store de categorías; `cardExpenses.ts` reusando `creditCards.ts`/
  `cardPeople.ts` en una sola dirección).
- Un único punto de entrada (un solo FAB, un solo Sheet) es más simple de
  mantener y de descubrir que dos FABs o un menú de "¿qué querés agregar?"
  previo al Sheet.

#### Por qué no sería tan simple (contras, y por qué no pesan tanto)

- El Sheet extendido tiene un campo condicional (Categoría, solo si
  "Gasto") — más ramas de validación que antes. Mitigado: es exactamente el
  mismo patrón ya resuelto en `CardExpenseFormSheet.vue` con el toggle de
  "Cuotas" (`credit-cards-ux.md` sección 5.2: un campo que revela/oculta
  otros campos condicionalmente) — no es una técnica nueva para este
  proyecto.
- El nombre `ExpenseFormSheet` deja de ser preciso una vez que también crea
  ingresos. **Se resuelve renombrando el archivo a
  `TransactionFormSheet.vue`** — un componente llamado "gasto" que también
  emite altas de "ingreso" sería confuso para cualquiera que lo lea después,
  more que el costo de actualizar los 1-2 puntos donde se importa hoy
  (`TransactionsView.vue`, que es el único lugar que lo abre tras el
  rediseño de `dashboard-redesign-ux.md` sección 2.5).

### 7.2 ¿Ingresos categorizados? No, en esta iteración

El Product Owner dejó la puerta abierta ("evaluá vos si tiene sentido").
**Decisión: no.** Motivos:

1. Las 10 categorías default (`Comida`, `Transporte`, `Ocio`, ...) están
   diseñadas para clasificar **gasto**, no origen de ingreso (`Salario`,
   `Freelance`, `Venta`, `Reembolso` son conceptos distintos, no un subset
   de las mismas 10). Categorizar ingresos con sentido real necesitaría un
   set de categorías **paralelo**, con su propio modelo de datos — cambio de
   esquema no pedido.
2. El Product Owner explícitamente definió `incomes` como "simétrica a
   `expenses` pero sin categoría" como punto de partida — tratarlo como
   pregunta abierta invita a evaluar, no a expandir el modelo de datos sin
   pedido explícito (`CLAUDE.md` ya insiste varias veces en "no ampliar el
   alcance sin pedido explícito").
3. Mantiene el formulario de ingreso más simple que el de gasto (un campo
   menos), coherente con que un ingreso es, para la mayoría de usuarios
   personales, un evento mucho menos frecuente y menos necesitado de
   desglose fino que el gasto diario.

Queda anotado como posible mejora de una futura fase (un set de categorías
de ingreso tipo Salario/Freelance/Otro), no se construye ahora.

### 7.3 Campos del Sheet extendido

```html
<SheetHeader>
  <SheetTitle>{{ sheetTitle }}</SheetTitle>
  <SheetDescription v-if="!isEditing">Completá los datos del movimiento.</SheetDescription>
</SheetHeader>

<form id="transaction-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
  <!-- 1. Tipo: Gasto / Ingreso -->
  <div class="flex flex-col gap-1.5">
    <Label id="tipo-transaccion-label">Tipo</Label>
    <div role="radiogroup" aria-labelledby="tipo-transaccion-label" class="flex gap-1 rounded-md bg-muted p-1">
      <button
        type="button"
        role="radio"
        :aria-checked="form.type === 'expense'"
        class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :class="form.type === 'expense' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        :disabled="isEditing || isSaving"
        @click="form.type = 'expense'"
      >
        Gasto
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="form.type === 'income'"
        class="flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :class="form.type === 'income' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        :disabled="isEditing || isSaving"
        @click="form.type = 'income'"
      >
        Ingreso
      </button>
    </div>
  </div>

  <!-- 2. Monto — sin cambios respecto a ExpenseFormSheet actual -->
  <!-- 3. Cuenta — nuevo, ver sección 8 -->
  <!-- 4. Categoría — solo si form.type === 'expense' -->
  <div v-if="form.type === 'expense'" class="flex flex-col gap-1.5">
    <!-- Select de categoría, igual que hoy -->
  </div>
  <!-- 5. Fecha — sin cambios -->
  <!-- 6. Descripción — sin cambios -->
</form>
```

- **El toggle Tipo se deshabilita en modo edición** (`:disabled="isEditing"`)
  — cambiar un gasto ya guardado a ingreso (o viceversa) no es una operación
  bien definida (¿qué pasa con la categoría ya asignada? ¿con el signo del
  monto en reportes ya calculados?) — mismo criterio de "no construir un
  caso border no pedido": si el usuario se equivocó de tipo, borra y crea de
  nuevo con el tipo correcto, más simple y más seguro que una migración de
  tipo in-place.
- **Default del toggle en modo alta: "Gasto"** — sigue siendo la operación
  más frecuente por lejos para un tracker de gastos personales; "Ingreso"
  es un tap de distancia, no una carga adicional real.
- Al cambiar a "Ingreso", el campo Categoría se oculta y su valor se
  descarta (no queda "fantasma" guardado por error) — mismo criterio ya
  aplicado al toggle de Cuotas en `CardExpenseFormSheet.vue`.
- Validación: el orden fijo ya existente (monto → categoría → fecha) se
  ajusta a (monto → cuenta → categoría *si aplica* → fecha), mismo criterio
  de "mostrar y enfocar solo el primer error encontrado".
- **Guardado: sigue 100% optimista**, sin cambios de política — ninguno de
  los campos nuevos (tipo, cuenta) introduce una restricción server-only
  conocida.
- Título del Sheet: `sheetTitle` computed — `"Editar gasto"` / `"Editar
  ingreso"` / `"Nuevo gasto"` / `"Nuevo ingreso"` según `isEditing` +
  `form.type` (en vez del texto fijo "Nuevo gasto"/"Editar gasto" actual).

### 7.4 Consecuencia directa: `incomesStore.ts` nuevo (mención, no diseño de store)

Se necesita un store `src/stores/incomes.ts`, mismo patrón que
`expenses.ts` (CRUD optimista) pero **sin** `monthTotal` ni ningún cómputo
de mes (el hero de Inicio no lee de acá, sección 2.1) — solo la lista +
CRUD, y (sección 1) sin reproducir el patrón `MAX_EXPENSES` de forma que
alguna pantalla futura confíe en él para un cálculo all-time. Detalle de
implementación del store es responsabilidad de `vue-frontend-expert`, se
menciona acá porque su existencia es una consecuencia directa de esta
decisión de UX, no una novedad de la sección 8 de este documento (que es la
que sí toca en más detalle "Transacciones recientes").

### 7.5 Consecuencia en las listas: gasto e ingreso conviven, con indicador de signo

Tanto "Transacciones recientes" de Inicio (`dashboard-redesign-ux.md`
sección 2.4) como el listado completo de `/transacciones`
(`dashboard-redesign-ux.md` sección 3) pasan a mezclar filas de gasto e
ingreso, ordenadas por fecha desc igual que hoy. Cada fila necesita un
indicador de tipo — **no solo color** (regla de a11y de siempre):

```html
<div class="flex items-center gap-3 px-6 py-3">
  <span
    class="flex size-9 shrink-0 items-center justify-center rounded-full border"
    :style="rowSwatchStyle(item)"
  >
    <component :is="rowIcon(item)" class="size-4" />
  </span>
  <div class="flex min-w-0 flex-1 flex-col">
    <p class="truncate text-sm font-medium">{{ rowTitle(item) }}</p>
    <p class="truncate text-xs text-muted-foreground">{{ rowSubtitle(item) }}</p>
  </div>
  <div class="flex flex-col items-end gap-0.5">
    <p class="text-sm font-semibold tabular-nums" :class="item.type === 'income' ? 'text-success' : 'text-foreground'">
      {{ item.type === 'income' ? '+' : '' }}${{ formatAmount(item.amount) }}
    </p>
    <p class="text-xs text-muted-foreground">{{ formatExpenseDateHeading(item.date) }}</p>
  </div>
</div>
```

- **Ingreso**: signo `+` explícito + `text-success` (el signo es el
  indicador primario, el color refuerza — nunca color solo). **Gasto**: sin
  signo, color de texto normal — se mantiene la regla ya vigente de "no
  pintar de rojo cada gasto" (`design-system.md` sección 1): el gasto sigue
  siendo el caso base/esperado, no una alarma.
- `rowIcon(item)`: un ícono de dirección simple (`ArrowDownCircle` para
  ingreso, ninguno o el ícono/emoji de categoría para gasto, igual que hoy)
  — detalle menor, no crítico; lo importante a11y-mente es el signo + color
  en el monto, que ya es texto real.
- `rowSubtitle`: para gasto, el nombre de categoría (igual que hoy); para
  ingreso, el nombre de la cuenta (no hay categoría que mostrar) — ej.
  "Efectivo" en vez de "Comida".
- Filas de "Transacciones recientes" en Inicio siguen **sin** menú `⋮` (solo
  lectura, igual que hoy); filas de `/transacciones` conservan su menú
  `⋮` con Editar/Eliminar, abriendo `TransactionFormSheet` con `form.type`
  precargado según el ítem.

---

## 8. Selector de cuenta en el formulario de gasto/ingreso

### 8.1 Campo nuevo, ubicado justo después de Monto

```html
<div class="flex flex-col gap-1.5">
  <Label for="cuenta">Cuenta</Label>
  <Select v-model="form.accountId" :disabled="isSaving">
    <SelectTrigger id="cuenta" class="h-11 w-full" :aria-invalid="!!errors.account">
      <SelectValue placeholder="Seleccioná una cuenta" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
        <span class="size-2.5 rounded-full" :style="{ background: resolveAccountColor(account.color, isDarkNow) }" />
        {{ account.name }}
      </SelectItem>
    </SelectContent>
  </Select>
  <p v-if="errors.account" class="text-xs text-destructive">{{ errors.account }}</p>
</div>
```

Ubicación: **segundo campo, justo después de Monto, antes de Categoría** —
no al final del formulario como un campo secundario. Justificación: a
diferencia de Descripción (opcional, de bajo costo si se omite), Cuenta es
**tan obligatoria como Monto y Categoría** (todo movimiento pertenece a una
cuenta, sección 1) — dejarla al final del formulario la trataría
visualmente como un detalle menor, cuando en realidad es una dimensión tan
fundamental como Categoría a partir de esta iteración. Ponerla temprano
también ayuda a que el usuario forme el hábito de elegir conscientemente en
vez de dejarla en lo que sea que haya quedado seleccionado por default.

### 8.2 Valor por default: la cuenta del movimiento más reciente, no siempre "General"

Pregunta del encargo: ¿tiene un default? ¿"General"? ¿la última usada?

**Decisión: la cuenta del gasto/ingreso más reciente ya registrado por el
usuario (cualquiera de los dos tipos, el que tenga `created_at` más
reciente); si todavía no registró ningún movimiento, cae a la cuenta
"General".**

```ts
function defaultAccountId(): string | null {
  const lastExpense = expensesStore.expenses[0] // ya viene ordenado desc
  const lastIncome = incomesStore.incomes[0]
  const mostRecent = [lastExpense, lastIncome]
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

  if (mostRecent) return mostRecent.account_id

  const general = accountsStore.accounts.find(a => a.name === 'General')
  return general?.id ?? accountsStore.accounts[0]?.id ?? null
}
```

Por qué esta opción y no las otras dos:

- **No siempre "General"**: para un usuario que en la práctica registra casi
  todo contra una cuenta distinta de "General" (p. ej. "Efectivo", su cuenta
  real de uso diario), forzarlo a reseleccionar manualmente esa cuenta en
  **cada** alta sería fricción pura sin ningún beneficio — a diferencia de
  Categoría, donde forzar elección consciente tiene un motivo real (muchas
  categorías posibles, error de categorización sí distorsiona reportes).
  Acá hay pocas cuentas típicamente, y la de uso más frecuente es un patrón
  detectable sin pedirle nada nuevo al usuario.
- **No "última usada" como preferencia persistida aparte** (p. ej. en
  `localStorage`): no hace falta ningún estado nuevo — "la cuenta del
  movimiento más reciente" ya está disponible gratis en los stores que ya
  se cargan (`expensesStore`/`incomesStore`), sin tocar backend ni agregar
  una tabla/columna de preferencias de usuario. Es, en la práctica, el mismo
  resultado que "recordar la última cuenta usada", solo que derivado de un
  dato que ya existe en vez de un estado nuevo a mantener.
- El usuario **siempre puede cambiarlo** en el `Select` antes de guardar —
  esto es un default de conveniencia, no una restricción.
- Validación: `form.accountId` requerido igual que `form.categoryId` — si
  por algún motivo `defaultAccountId()` devuelve `null` (caso extremo, sin
  ninguna cuenta — no debería pasar, sección 6.5), el `Select` queda vacío
  con el placeholder y el usuario debe elegir explícitamente (con el error
  de validación ya existente si intenta guardar sin elegir).

---

## 9. Accesos rápidos: Saldo / Pagos / Deudas

Fila de 3 botones entre "Mis cuentas" y "Resumen por categoría" (sección
2.2), inspirada en el layout de la referencia pero implementando **solo lo
que tiene sentido hoy**:

```html
<div class="flex gap-2">
  <Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" @click="router.push({ name: 'accounts' })">
    <Scale class="size-5" />
    <span class="text-xs font-medium">Saldo</span>
  </Button>

  <Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" disabled aria-disabled="true">
    <CircleDollarSign class="size-5" />
    <span class="text-xs font-medium">Pagos</span>
    <span class="text-[10px] text-muted-foreground">Próximamente</span>
  </Button>

  <Button variant="outline" class="flex h-auto flex-1 flex-col gap-1 py-3" disabled aria-disabled="true">
    <HandCoins class="size-5" />
    <span class="text-xs font-medium">Deudas</span>
    <span class="text-[10px] text-muted-foreground">Próximamente</span>
  </Button>
</div>
```

- **"Saldo"** (único funcional): navega a `/cuentas` (sección 6) — mismo
  destino que "Ver todas" de la sección "Mis cuentas". No se construye una
  pantalla nueva solo para este botón: `/cuentas` ya muestra el saldo de
  cada cuenta en detalle, así que reusar el destino es la opción honesta
  (el botón no promete nada que la pantalla de destino no cumpla) y evita
  una ruta redundante.
- **"Pagos"**: sin concepto equivalente en TipApp hoy (no hay pagos
  recurrentes/recordatorios) — deshabilitado, copy "Próximamente" explícito
  bajo el label (nunca solo el estado `disabled` como único indicador,
  mismo criterio de a11y de siempre). No es Fase 2 (Deudas), es simplemente
  una funcionalidad no definida todavía — mismo tratamiento honesto que
  `ReportsView.vue` ya usa para "Reportes" (`dashboard-redesign-ux.md`
  sección 8): sin controles falsos, sin fecha de entrega prometida.
- **"Deudas"**: Fase 2, explícitamente fuera de alcance de este documento —
  deshabilitado, "Próximamente", **nunca roto ni 404** (no tiene `@click`,
  no navega a ninguna ruta inexistente). Mismo ícono/tratamiento que
  "Pagos" a nivel de implementación (ambos disabled), pero conceptualmente
  distinto: "Deudas" ya tiene un encargo futuro real (mencionado
  explícitamente por el Product Owner), "Pagos" no tiene ningún plan
  confirmado todavía — esta distinción no cambia el markup, pero
  `vue-frontend-expert` no debería "adelantar" ninguna lógica de Deudas acá
  (ni una ruta placeholder `/deudas` que redirija a un "Próximamente"): el
  botón deshabilitado ya cumple el requisito de "nunca 404" sin necesitar
  una ruta nueva.
- Iconos: `Scale` (balance/saldo, ya confirmado en `@lucide/vue`),
  `CircleDollarSign` (pago genérico, confirmado), `HandCoins` (deuda/dinero
  que cambia de mano, confirmado) — ningún ícono se reusa de los 6 de la
  sección 5 (evita que un usuario asocie por error un acceso rápido con un
  ícono de cuenta específica).

---

## 10. Navegación: nuevo ítem "Cuentas" en el drawer

Ícono confirmado en el paquete ya instalado:
`node_modules/@lucide/vue/dist/esm/icons/wallet.mjs` (`Wallet`) — no
requiere instalar nada, mismo método ya usado para confirmar el resto de
íconos del drawer.

**Posición: 4º lugar, entre "Tarjetas de crédito" y "Categorías"** (el
`<nav>` pasa de 7 a 8 ítems):

| Orden | Label | Ícono | `route.name` |
|---|---|---|---|
| 1 | Inicio | `Home` | `home` |
| 2 | Transacciones | `ArrowLeftRight` | `transactions` |
| 3 | Tarjetas de crédito | `CreditCard` | `cards` |
| **4** | **Cuentas** | **`Wallet`** | **`accounts`** |
| 5 | Categorías | `Tag` | `categories` |
| 6 | Estadísticas | `ChartPie` | `statistics` |
| 7 | Reportes | `FileText` | `reports` |
| 8 | Ajustes | `Settings` | `settings` |

Justificación del orden: mismo criterio ya usado para ubicar "Tarjetas de
crédito" en `credit-cards-ux.md` sección 7 — Cuentas es, igual que
Transacciones y Tarjetas, un **dominio de datos de movimientos de dinero**
(en este caso, literalmente la dimensión que organiza a los otros dos), no
metadata de clasificación como Categorías. Va inmediatamente después de
Tarjetas porque completa el bloque mental "de dónde sale/entra mi plata"
(Transacciones, Tarjetas, Cuentas) antes de pasar a Categorías (metadata) y
luego a Estadísticas/Reportes/Ajustes (análisis y configuración).

Nota sobre el ícono `Wallet` también usado como opción del selector de la
sección 5.1: es el mismo glifo en dos contextos distintos (ícono de
navegación del drawer vs. una de las 6 opciones de ícono de cuenta) — se
acepta el solapamiento porque no genera confusión real (ubicaciones de UI
completamente distintas, ningún usuario asocia "el ícono del drawer" con
"el ícono de una cuenta puntual"); es el mismo tipo de reuso ya aceptado
implícitamente en el resto del proyecto (p. ej. `Tag` sirve tanto de ícono
de nav como de concepto general de "etiqueta" en otros lugares).

Fila de nav: mismo markup/clases exactas ya establecidas (`flex min-h-11
items-center gap-3 rounded-md px-3 text-sm font-medium`, estado activo vía
`route.name === 'accounts'`, `aria-current="page"` cuando corresponda) — no
se repite el markup completo acá, ver `dashboard-redesign-ux.md` sección
6.1 para el patrón exacto a copiar.

---

## 11. Accesibilidad

Se reafirman los lineamientos vigentes de `design-system.md` sección 5, con
las particularidades nuevas de esta feature:

1. **Color nunca como único indicador**: saldo negativo (signo `-` + color,
   sección 2.3/6.2), ingreso vs. gasto (signo `+`/ninguno + color, sección
   7.5), swatch de cuenta siempre acompañado del nombre en texto real
   (nunca solo el círculo de color), accesos rápidos deshabilitados con
   copy "Próximamente" explícito (nunca solo `disabled` sin texto, sección
   9).
2. **`aria-current="page"`** en el nuevo ítem del drawer, mismo mecanismo ya
   vigente (sección 10).
3. **Mínimo táctil 44×44px**: swatches de color/ícono en `AccountFormSheet`
   (`size-11`, igual que categorías/tarjetas), filas clickeables de
   `AccountsView` (`min-h-11` implícito por el padding `py-3` + contenido),
   botones de menú `⋮` (`h-11 w-11`), botones del toggle Gasto/Ingreso y de
   los accesos rápidos (`Button` con `py-3` ya supera 44px de alto).
4. **Foco visible**: mismo patrón `focus-visible:ring-2
   focus-visible:ring-ring focus-visible:ring-offset-2` en todo elemento
   interactivo nuevo, sin excepciones — incluidas las tiles no-clickeables
   de "Mis cuentas" (sección 2.3, que llevan `aria-disabled` pero mantienen
   la clase de foco por consistencia visual, aunque no reciban foco real al
   estar `disabled`).
5. **Toggle Gasto/Ingreso con semántica de `radiogroup`**: dos botones
   `role="radio"` + `aria-checked` dentro de un `role="radiogroup"` con
   label asociado (`aria-labelledby`) — mismo patrón exacto ya usado por el
   segmented control de tema (`theme-toggle-ux.md` sección 3): un dato de
   2-3 estados mutuamente excluyentes es un `radiogroup`, no un `Switch`
   binario (ese patrón se reserva para toggles verdaderamente on/off, como
   "Cuotas" en `CardExpenseFormSheet.vue`).
6. **Confirmación antes de destruir**: borrado de cuenta pasa por
   `AlertDialog`, igual que gasto/categoría/tarjeta — nunca directo desde el
   tap en "Eliminar" del menú `⋮`.
7. **Labels asociados, no placeholder-only**: "Saldo inicial", el
   `radiogroup` de Tipo, y el `Select` de Cuenta llevan `<Label>`/
   `aria-labelledby` persistente — ninguno depende solo de un `placeholder`.
8. **`prefers-reduced-motion`**: heredado de Sheet/AlertDialog/Select (Reka
   UI), sin configuración adicional — misma cobertura que el resto del
   proyecto. El gradiente nuevo de `TrendAreaChart` (sección 3.3) es
   estático (sin animación de aparición), así que no interactúa con esta
   regla.
9. **`aria-disabled="true"` en tiles/botones no funcionales**: tanto las
   tiles de cuenta en el grid de Inicio (sección 2.3, deliberadamente no
   clickeables) como los accesos rápidos "Pagos"/"Deudas" (sección 9) usan
   `disabled` (nativo, en el caso de `<button>`/`Button`) + `aria-disabled`
   explícito — nunca un elemento que parezca interactivo (cursor pointer,
   hover) pero no haga nada al activarlo, lo cual sería confuso para
   cualquier usuario, no solo de lector de pantalla.

---

## 12. Rutas — resumen

```ts
{ path: '/cuentas', name: 'accounts', component: () => import('@/views/AccountsView.vue'), meta: { requiresAuth: true } },
```

Una única ruta nueva (a diferencia de las 4 de `credit-cards-ux.md`) —
justificado en sección 6.1: Cuentas es una entidad única, sin
dashboard/detalle propio en esta iteración. Se agrega a
`src/router/index.ts` junto a las rutas ya existentes, mismo
`meta.requiresAuth` y mismo lazy import por ruta ya usado hoy.

---

## Resumen accionable para `vue-frontend-expert`

1. **`src/lib/colors.ts`**: agregar `ACCOUNT_COLOR_SWATCHES` (8 pares
   hex/darkHex, sección 4.3) y `resolveAccountColor(hex, isDark)` como
   **exportaciones nuevas** — no modificar ninguna función existente
   (`hexToRgb`/`withAlpha`/`readableTextColor`/`hexToHslTriple`/
   `COLOR_SWATCHES` quedan intactas; el selector de color de acento en curso
   en otra sesión no se toca).
2. **Set de íconos** (sección 5): `Wallet`, `PiggyBank`, `Landmark`,
   `Building2`, `ShieldCheck`, `Banknote` de `@lucide/vue` (ya confirmados
   en el paquete instalado, nada que instalar) — nuevo archivo sugerido
   `src/lib/accountIcons.ts` con el mapa `key → componente` + labels.
3. **`TrendAreaChart.vue`** (sección 3): agregar curva suavizada
   (`Q`/midpoint smoothing, sección 3.2) y relleno de gradiente
   (`<linearGradient>` con `useId()` para el `id` único, sección 3.3) — sin
   nuevas props, sin cambiar el contrato existente (`points`/`height`/
   `ariaLabel`/`showAxis` siguen igual).
4. **Stores nuevos**:
   - `src/stores/accounts.ts`: CRUD de `accounts` (100% optimista, sección
     6.3), conteo dedicado `expenses(count) + incomes(count)` por cuenta
     (sección 1.4), lectura de saldo desde la agregación de servidor
     (sección 1.2 — **nunca** sumando `expensesStore.expenses`).
   - `src/stores/incomes.ts`: mismo patrón que `expenses.ts` pero sin
     `monthTotal` (sección 7.4).
5. **`ExpenseFormSheet.vue` → renombrar a `TransactionFormSheet.vue`**
   (sección 7.1): agregar el toggle Gasto/Ingreso (`radiogroup`, sección
   7.3), el `Select` de Cuenta (sección 8, con el default de "última cuenta
   usada" de sección 8.2), ocultar Categoría condicionalmente cuando
   `type === 'income'`. Actualizar el único import existente
   (`TransactionsView.vue`).
6. **Vista nueva**: `AccountsView.vue` (sección 6.2) + `AccountFormSheet.vue`
   (sección 6.3, alta/edición) — mismo patrón que `CategoriesView.vue`/
   `CategoryFormSheet.vue`, sin split "predeterminadas/mías" (todas las
   cuentas son del usuario).
7. **`HomeView.vue`**: agregar "Mis cuentas" (grid + saldo total, sección
   2.3) y "Accesos rápidos" (sección 9) entre el hero existente y la dona
   de categorías (sección 2.2) — **no tocar** el hero "Total del mes" (sigue
   gasto mensual, sin cambios de significado, sección 2.1). Adaptar
   "Transacciones recientes" para mezclar gasto/ingreso con indicador de
   signo (sección 7.5).
8. **Drawer** (`HomeView.vue`): nuevo ítem "Cuentas" (`Wallet`) en 4ª
   posición del `<nav>` (pasa de 7 a 8 ítems, sección 10).
9. **Router**: 1 ruta nueva, `/cuentas` (sección 12).
10. **Pendiente para `supabase-backend-expert`** (no bloqueante para
    empezar el frontend de las partes que no dependen de esto, pero sí
    bloqueante para el saldo real):
    - Confirmar nombres de columna de `accounts`
      (`name`/`icon`/`color`/`initial_balance`) e `incomes` (espejo de
      `expenses` sin `category_id`), y agregar `expenses.account_id`/
      `incomes.account_id` (`NOT NULL`, FK a `accounts`, `on delete
      restrict` — mismo patrón que `expenses.category_id`).
    - Vista/función agregada `account_balances` (o equivalente) para el
      saldo all-time (sección 1.2) — **no** se acepta un cómputo client-side
      sobre listas capadas como solución final.
    - Extender `handle_new_user()` (o trigger paralelo) para crear la cuenta
      "General" automática de cada usuario nuevo (sección 6.5).
    - Backfill de `account_id` para gastos ya existentes del proyecto
      Supabase remoto real, **antes** de aplicar el `NOT NULL` (sección
      6.5) — orden de migración, no solo el DDL.
11. **Fuera de alcance explícito de esta iteración** (anotado, no
    bloqueante): `AccountDetailView` (historial de movimientos por cuenta,
    análogo a `CardDetailView.vue`, sección 2.3); categorías de ingreso
    (sección 7.2); ruta/pantalla real para "Pagos" (sección 9); todo lo de
    Fase 2 (Deudas/Préstamos) — el acceso rápido "Deudas" queda
    deshabilitado y sin ruta, listo para activarse el día que exista esa
    especificación.

---

## 13. Rediseño visual de `/cuentas` (referencia "Wallet") + orden manual de cuentas

**Nota de vigencia, léase primero**: esta sección se agrega mucho después de
las 12 anteriores, sobre el estado **actual** del código, no sobre el de la
Fase 1 original. Dos decisiones de esta sección 13 quedaron ya
**superadas por documentos posteriores** que el lector debe conocer antes de
seguir:

- `docs/features/account-detail-ux.md` ya construyó `AccountDetailView.vue`
  (`/cuentas/:id`) — la sección 2.3 de este mismo documento (que decía "no se
  construye" ese detalle) está desactualizada en ese punto exacto, y
  `AccountsView.vue` **ya navega** a esa ruta al tocar una fila (no es una
  propuesta nueva de esta sección, es el estado real del código verificado
  contra `src/router/index.ts` y `src/views/AccountsView.vue` antes de
  escribir esto).
- `docs/features/account-transfers-ux.md` sección 6.6 ya **reemplazó** la
  regla de color de monto de gasto real ("no pintar de rojo cada gasto")
  por `text-destructive` para todo gasto real en listados de
  transacciones. Esa regla es sobre **filas de transacción** (Inicio/
  Transacciones), un componente distinto de la fila de **cuenta** que
  rediseña esta sección — no hay conflicto, pero el lector no debe
  confundir ambas superficies.

Con eso aclarado: el Product Owner mostró una captura de otra app ("Wallet")
y pidió replicar su **contenido y estilo visual** (no su navegación ni su
marca — mismo criterio de exclusión ya aplicado en todo TipApp, ver
`credit-cards-ux.md` sección 11 y el encabezado de este mismo documento).
Se agregan, además, dos piezas de contenido/funcionalidad reales: un hero de
"Saldo total" (que hoy `/cuentas` no tiene — el que ya existe con ese nombre
vive en `HomeView.vue`, sección 2.3, y es una cosa distinta, ver 13.1.1) y
orden manual de cuentas.

Explícitamente **no reabierto** (ya decidido por el Product Owner, fuera de
esta sección): sin badge "Activa"/"Inactiva" (no existe ese campo en el
modelo), sin "Ocultar saldos", sin ninguna tarjeta promocional/upsell al
final del listado (TipApp no tiene upsells, criterio ya establecido en
`dashboard-redesign-ux.md`).

### 13.1 Hero "Saldo total" en `/cuentas`

#### 13.1.1 Por qué esto NO es el mismo hero de "Mis cuentas" en Inicio

`HomeView.vue` ya muestra un "Saldo total" (sección 2.3 de este documento)
pero es un `CardDescription` chico, subordinado al grid de hasta 5 tiles —
no es un hero, no tiene indicador de variación ni gráfico. La captura de
referencia pide un hero de verdad **en la parte de arriba de `/cuentas`**
(hoy esa pantalla no tiene ningún hero: `AccountsView.vue` va directo del
`AppHeader` a la Card "Tus cuentas", ver el archivo actual). Es una pieza
nueva, propia de esta pantalla — no se toca `HomeView.vue` en esta sección.

#### 13.1.2 Layout — mismo lenguaje visual que el hero ya existente de Inicio, no uno nuevo

**Decisión: `Card` plana (`bg-card`, borde), no una card con fondo de color
sólido/degradado como en la captura de referencia.** La referencia usa un
fondo azul intenso de marca para este hero; TipApp no lo replica porque
rompería la consistencia visual ya establecida por **todos** los demás
heroes/resúmenes de la app (`Total del mes` de Inicio, las cards resumen de
`DebtsDashboardView`, el total de `CardsDashboardView`) — ninguno usa un
fondo de color sólido, todos son `Card` neutra con el monto en
`text-foreground` y color reservado para acentos puntuales (ícono, delta).
Introducir acá la única card "de color" de toda la app sería inconsistente
sin que el Product Owner lo haya pedido explícitamente (pidió el contenido/
layout de la referencia, no literalmente su paleta) — mismo criterio de
"replicar contenido, no marca" ya aplicado al resto de la feature.

```html
<Card>
  <CardHeader class="flex-row items-start justify-between gap-2">
    <div class="flex flex-col gap-1">
      <CardDescription class="text-xs font-medium uppercase tracking-wide">
        Saldo total
      </CardDescription>
      <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
        <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(accountsStore.totalBalance) }}
      </CardTitle>
      <div
        v-if="totalBalanceDelta"
        class="flex items-center gap-1 text-sm font-medium"
        :class="totalBalanceDelta.direction === 'up' ? 'text-success' : 'text-destructive'"
      >
        <component :is="totalBalanceDelta.direction === 'up' ? ArrowUp : ArrowDown" class="size-3.5" />
        {{ totalBalanceDelta.label }} vs. {{ previousMonthName }}
      </div>
    </div>

    <!-- Ícono decorativo, sección 13.1.4: NO es un botón, no navega a
         ningún lado. -->
    <span
      class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10"
      aria-hidden="true"
    >
      <ChartLine class="size-4 text-primary" />
    </span>
  </CardHeader>
</Card>
```

Ubicación: primer elemento de `<main>` en `AccountsView.vue`, antes de la
Card "Tus cuentas" (que sigue exactamente igual salvo por el control
"Ordenar" nuevo, sección 13.3, y el chevron/color de fila, sección 13.2).

- **Monto**: mismo tratamiento tipográfico exacto que el hero de "Total del
  mes" de Inicio (`design-system.md` sección 2, "Cómo destacar montos de
  dinero") — `text-3xl sm:text-4xl font-bold tabular-nums tracking-tight`,
  símbolo `$` en `text-sm font-normal text-muted-foreground`. Fuente:
  `accountsStore.totalBalance` (ya existe, computed sobre `balances`,
  sección 1.2 — no se recalcula nada nuevo para el monto en sí).
- **`CardDescription` como label chico**: "Saldo total" en mayúsculas,
  mismo patrón ya usado para "Tus cuentas" (`text-xs font-medium uppercase
  tracking-wide text-muted-foreground`) — nótese que acá se omite
  `text-muted-foreground` explícito en el snippet porque `CardDescription`
  ya aplica ese color por defecto (mismo componente, mismo comportamiento
  que en el resto del proyecto).
- **Ícono decorativo**: círculo `bg-primary/10` con `ChartLine` en
  `text-primary` — "círculo de acento" del pedido se resuelve con el token
  `primary` (que en TipApp **es** el color de acento configurable por el
  usuario, `docs/features/accent-color-ux.md`), no con un hex nuevo.
  Confirmado en `node_modules/@lucide/vue/dist/esm/icons/chart-line.mjs`
  (mismo método de verificación que el resto de los documentos del
  proyecto).

#### 13.1.3 La variación ("12% vs. junio") — cálculo, sin RPC nueva, con un caso borde aceptado

Mismo principio general ya usado dos veces en el proyecto para evitar sumar
historial completo (`debts-ux.md` sección 1.4, `account-detail-ux.md`
sección 6.1): el "saldo de arranque" de la ventana se deriva de dos números
ya seguros — el agregado de servidor sin límite de fecha
(`accountsStore.totalBalance`, siempre correcto) y el neto de movimientos
**acotados por fecha** (nunca una lista global capada).

**Insight clave que simplifica esto respecto al precedente de una sola
cuenta**: acá el total suma **todas** las cuentas del usuario, y una
transferencia entre dos cuentas propias (`account-transfers-ux.md` sección
1) es, por definición, un movimiento de suma cero a nivel agregado — sale
de una cuenta del usuario, entra a otra cuenta del mismo usuario. **No hace
falta ninguna query a `account_transfers` para este cálculo**: alcanza con
`expenses`/`incomes`, mismo criterio de "no pedir al servidor más de lo que
hace falta" ya establecido en el resto del proyecto. (La comisión de una
transferencia sí impacta, correctamente, porque ya es una fila real de
`expenses` — sección 6 de `account-transfers-ux.md` — que la query de gastos
ya trae sin tratamiento especial.)

```ts
// AccountsView.vue — junto a loadAll(), un tercer fetch acotado por fecha
// (no una lista global capada), mismo criterio que el resto de la feature.
const monthStartDate = startOfMonth(new Date())
const monthStartKey = formatDateOnly(monthStartDate)

const [expensesRes, incomesRes] = await Promise.all([
  supabase.from('expenses').select('amount').gte('expense_date', monthStartKey),
  supabase.from('incomes').select('amount').gte('income_date', monthStartKey),
])

const monthNet =
  (incomesRes.data ?? []).reduce((sum, i) => sum + i.amount, 0) -
  (expensesRes.data ?? []).reduce((sum, e) => sum + e.amount, 0)

const startOfMonthBalance = accountsStore.totalBalance - monthNet
```

```ts
// Delta expuesto a la plantilla — mismo vocabulario/íconos que el delta ya
// existente de "vs. mes anterior" en el hero de Inicio (ArrowUp/ArrowDown +
// success/destructive), y mismo tratamiento del caso borde "arranque en $0"
// ya resuelto en account-detail-ux.md sección 6.3 para el saldo de UNA
// cuenta (acá es el mismo problema, a nivel del total).
const totalBalanceDelta = computed(() => {
  const delta = accountsStore.totalBalance - startOfMonthBalance.value
  if (delta === 0) return null // sin cambio real, no forzar un "0%"/"+$0"
  const direction: 'up' | 'down' = delta >= 0 ? 'up' : 'down'

  if (startOfMonthBalance.value === 0) {
    const sign = delta >= 0 ? '+' : '-'
    return { direction, label: `${sign}$${formatAmount(Math.abs(delta))}` }
  }
  const pct = (delta / Math.abs(startOfMonthBalance.value)) * 100
  const sign = pct >= 0 ? '+' : ''
  return { direction, label: `${sign}${pct.toFixed(0)}%` }
})
```

- **Más saldo = bueno** (`success` si sube, `destructive` si baja) — misma
  semántica ya fijada para saldo de cuenta en la sección 2.3 de este
  documento y reconfirmada en `account-detail-ux.md` sección 6.3,
  deliberadamente **opuesta** a la de "Total del mes" (donde gastar más es
  `destructive`): no es una inconsistencia, son preguntas distintas (stock
  vs. flujo, ya justificado en la sección 2 de este documento).
- **Caso borde — `startOfMonthBalance === 0`**: mismo tratamiento ya
  aceptado en `account-detail-ux.md` sección 6.3 para una cuenta individual
  (dividir por cero no es informativo) — se muestra el monto con signo en
  vez de un porcentaje, nunca `Infinity%`/`NaN%`.
- **Caso borde conocido y aceptado, sin resolver** (documentado, no un
  olvido): si el usuario crea una cuenta **nueva dentro del mes en curso**
  con un `initial_balance` distinto de cero, ese monto no queda registrado
  como un "movimiento con fecha" — la fórmula de arriba lo cuenta como si ya
  hubiera estado ahí desde antes del mes, subestimando levemente el
  porcentaje de crecimiento real de ese mes. Se acepta sin resolver por el
  mismo criterio ya usado para el sobrepago de deudas
  (`debts-ux.md` sección "Deudas/Préstamos... backend"): es un caso de
  probabilidad baja (`initial_balance` casi siempre es `0`, sección 6.3 de
  este documento) y de impacto acotado (un pequeño error de magnitud en un
  indicador secundario, no un dato mostrado como si fuera exacto donde
  importa — el saldo total en sí, arriba, sigue siendo exacto siempre). Si
  a futuro se quiere corregir, la solución exacta existe (excluir del
  `monthNet` a las cuentas con `created_at >= inicio de mes` y restar,
  además, su saldo actual completo de `startOfMonthBalance`) pero no se
  justifica el costo de implementarla ahora.
- **Por qué es seguro sin `isMonthSafeToShow`**: a diferencia de
  `expensesStore.monthTotal` (que sí necesita esa heurística porque deriva
  de una lista capada, `dashboard-redesign-ux.md` sección 1), acá las dos
  queries de arriba están acotadas por fecha (`gte`) contra la tabla real,
  nunca contra `expensesStore.expenses`/`incomesStore.incomes` — mismo
  argumento de seguridad de datos ya usado en toda esta feature (sección 1)
  y en `account-detail-ux.md` sección 6.1.
- **`previousMonthName`**: nombre del mes anterior en minúscula, sin año
  (`"junio"`, no `"junio 2026"` — la referencia visual no lleva año).
  `src/lib/date.ts` no expone hoy un helper así (`currentMonthLabel` incluye
  el año, y `MONTHS_ES` es privado) — agregar un helper chico
  `monthNameOnly(date: Date): string` (o exportar `MONTHS_ES` si
  `vue-frontend-expert` prefiere resolverlo en el componente) es una
  decisión de implementación menor, no de diseño.
- Si el usuario no tiene ninguna cuenta (estado vacío ya cubierto en sección
  6.2), el hero completo se oculta (no hay "saldo total" que mostrar de
  cero cuentas) — mismo criterio que ocultar secciones enteras sin datos ya
  aplicado en el resto del proyecto (p. ej. el gráfico de "Últimos 30 días"
  de `account-detail-ux.md` sección 6.3 con un solo punto).

#### 13.1.4 El ícono decorativo no es clickeable, a propósito

La captura de referencia lo muestra como un adorno visual, sin indicar a
dónde navega. **Se implementa como puramente decorativo**
(`<span aria-hidden="true">`, no un `<button>`): un elemento que *parece*
interactivo (círculo con ícono, mismo lenguaje visual que un botón real de
la app) pero no responde a un tap sería exactamente el antipatrón que
`design-system.md` sección 5 prohíbe ("nunca un elemento que parezca
interactivo pero no haga nada al activarlo"). Si a futuro el Product Owner
quiere que navegue a `/estadisticas` (destino más obvio para un ícono de
gráfico), es un cambio de una línea — pero no se inventa ese destino sin
pedido explícito.

---

### 13.2 Fila de cuenta rediseñada: chevron + color de saldo

#### 13.2.1 Chevron — afordancia visual, no una función nueva

Se agrega `ChevronRight` (`size-4 text-muted-foreground shrink-0`) al final
de cada fila de `AccountsView.vue`, antes del botón de menú `⋮` (o después,
ver nota de layout abajo). **No es una inconsistencia agregar esto ahora**:
como quedó confirmado leyendo `src/router/index.ts` y `src/views/
AccountsView.vue` antes de escribir esta sección, `/cuentas/:id`
(`account-detail`) **ya existe y ya está enrutado** — la fila completa ya
navega ahí al tocarla (`account-detail-ux.md` sección 1.3, ya implementado).
El chevron no es una promesa a futuro: es la afordancia visual que hoy le
falta a una fila que **ya es clickeable**, cerrando exactamente el hueco que
el encargo pedía confirmar antes de resolver solo.

Layout de la fila (orden de derecha a izquierda: saldo → chevron → menú
`⋮`, para que el chevron quede pegado al bloque de contenido de la fila y
el menú `⋮` — una acción secundaria, distinta de "ver detalle" — quede
separado al extremo, mismo criterio ya usado en `credit-cards-ux.md` para
separar "navegar" de "acciones de gestión"):

```html
<div class="flex flex-col items-end gap-0.5">
  <p class="text-sm font-semibold tabular-nums" :class="balanceColorClass(account)">
    {{ ...saldo... }}
  </p>
</div>
<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
<DropdownMenu>...</DropdownMenu>
```

- `aria-hidden="true"`: el chevron es puramente decorativo — la fila ya
  tiene `aria-label="Ver detalle de {name}"` (código actual, sin cambios),
  que ya comunica la acción a un lector de pantalla; el chevron no debe
  anunciarse una segunda vez.
- No se toca el mecanismo de `@click.stop` en el trigger del menú `⋮`
  (`account-detail-ux.md` sección 1.3) — el chevron es puramente visual, sin
  ningún listener propio.

#### 13.2.2 Color del saldo de fila — decisión: combinado, no reemplazo total

**Pregunta del encargo**: ¿el color de cuenta reemplaza por completo la
semántica `destructive` en negativo, o se combina?

**Decisión: se combina — color de cuenta cuando el saldo es `>= 0`,
`text-destructive` cuando es negativo (la semántica de alerta nunca se
pierde).**

```ts
function balanceColorStyle(account: Account): string | undefined {
  const balance = accountsStore.balanceFor(account.id)
  if (balance < 0) return undefined // cae a `text-destructive` por clase, ver abajo
  return resolveAccountColor(account.color ?? '#6b7280', isDarkNow.value)
}
```

```html
<p
  class="text-sm font-semibold tabular-nums"
  :class="accountsStore.balanceFor(account.id) < 0 ? 'text-destructive' : undefined"
  :style="accountsStore.balanceFor(account.id) < 0 ? undefined : { color: balanceColorStyle(account) }"
>
  {{ accountsStore.balanceFor(account.id) < 0 ? '-' : '' }}${{ formatAmount(Math.abs(accountsStore.balanceFor(account.id))) }}
</p>
```

**Por qué no el reemplazo total** (color de cuenta siempre, incluso en
negativo, como en la captura de referencia — que no muestra ningún saldo
negativo, así que no resuelve el dilema por sí sola):

1. **Es la única señal de alerta real que le queda a esta fila.** A
   diferencia del monto de una transacción (que ya tiene el signo `$`/`+$`
   como indicador primario, `account-transfers-ux.md` sección 6.6), el
   saldo de una cuenta **ya** usa el signo `-` como indicador primario
   (sección 6.2 de este documento) — pero `design-system.md` sección 5
   ("color nunca como único indicador") es una regla sobre **no depender
   solo de color**, no una prohibición de reforzar con color cuando hay una
   alerta real que comunicar. Un saldo negativo (cuenta en descubierto) es,
   objetivamente, un estado más urgente que "esta cuenta es violeta" — dejar
   que el color categórico de la cuenta lo enmascare sería perder
   información real a cambio de nada (la identidad de la cuenta ya está
   comunicada por el ícono + nombre + el fondo teñido de toda la fila, no
   depende del color del monto para eso).
2. **No hay precedente de "romper" `destructive` por un color decorativo en
   ningún otro lugar de la app.** Categorías, tarjetas y personas tienen
   swatches de color propios y **nunca** se usan para pintar un monto en
   negativo — el color de swatch siempre queda relegado al ícono/badge,
   nunca compite con la semántica de alerta de un monto. Cambiar ese
   criterio solo para Cuentas, sin que el resto de la app lo replique,
   introduciría una inconsistencia real (dos filas de dinero en pantallas
   distintas, incluso en la misma sesión, con reglas de color diferentes
   para "negativo").
3. **Costo de implementación bajo, beneficio de consistencia alto**: la
   combinación (`destructive` si negativo, color de cuenta si no) es
   literalmente el mismo condicional que ya existe hoy
   (`balance < 0 ? 'text-destructive' : 'text-foreground'`), solo
   reemplazando el `else` (`text-foreground`) por el color resuelto de la
   cuenta — no una reescritura, un cambio de una rama.

Aplica en los **tres** lugares que hoy muestran saldo de cuenta con la regla
`destructive`/`foreground`: la fila de `AccountsView.vue` (sección 6.2 de
este documento), el nuevo hero de `AccountDetailView.vue` si aplica (fuera
de alcance de esta sección — `account-detail-ux.md` ya fija su propio color
para el saldo de ESA cuenta puntual, no se reabre acá) y las tiles de "Mis
cuentas" de `HomeView.vue` (sección 2.3 de este documento, que **ya**
documentaba el mismo condicional `destructive`/`foreground` — se actualiza
igual, por consistencia, aunque el encargo de esta sesión solo pidió
`/cuentas`).

---

### 13.3 Orden manual de cuentas ("Ordenar")

#### 13.3.1 Mecanismo elegido: botones ↑/↓ por fila, no drag nativo

**Decisión: botones `ChevronUp`/`ChevronDown` por fila (mover una posición
arriba/abajo por tap), no un drag reorder con Pointer Events.**

Motivos, en orden de peso:

1. **Conflicto de gesto real en mobile**: un drag vertical para reordenar
   compite literalmente con el gesto de **scroll** de la propia página — la
   lista de cuentas vive dentro de un `<main>` que scrollea, no dentro de un
   contenedor de altura fija. Resolverlo bien requiere suprimir el scroll de
   la página mientras el dedo sostiene una fila (`touch-action: none` en el
   elemento arrastrado, pero **no** en el resto del scroll del documento),
   detectar cuándo un touch es "quiero arrastrar esta fila" vs. "quiero
   seguir scrolleando la página" (normalmente con un umbral de tiempo/
   distancia antes de "armar" el drag), y in mid-drag, auto-scrollear si el
   usuario arrastra cerca del borde superior/inferior de la ventana visible
   — three problemas reales de UX que ninguna combinación simple de
   Pointer Events nativos resuelve con poco código sin conseguir casos
   borde raros (el drag se "pega", la página scrollea sola de golpe, un tap
   corto se interpreta como el inicio de un drag).
2. **Accesibilidad de teclado/lector de pantalla gratis**: un botón
   `ChevronUp`/`ChevronDown` es, por construcción, operable con
   teclado/switch access sin ningún trabajo adicional (foco + Enter, mismo
   patrón que cualquier otro botón del proyecto) y anunciable por lector de
   pantalla con un `aria-label` simple ("Subir Efectivo", "Bajar
   Procredito"). Un drag reorder necesita, para llegar al mismo nivel de
   accesibilidad, una alternativa de teclado completa **además** del drag
   (típicamente las mismas flechas ↑/↓ que esta decisión ya provee como
   único mecanismo) — implementar ambas rutas para terminar dependiendo
   igual de la alternativa de teclado es esfuerzo duplicado sin beneficio
   neto real para el caso de uso (reordenar una lista corta de cuentas, no
   una lista larga de cientos de ítems donde el costo de "N taps" sí
   importaría).
3. **Cero dependencias, exactamente lo pedido**: sin librería de
   drag-and-drop (descartado explícitamente por el encargo si se puede
   evitar) y sin necesidad de manejar eventos `pointerdown`/`pointermove`/
   `pointercancel` con su propia máquina de estados — es la opción de menor
   superficie de bug para una lista que, en la práctica, va a tener pocas
   cuentas (típicamente menos de 10, ver sección 6.5 sobre la cuenta
   "General" — no es una lista larga que se beneficie de la velocidad de un
   drag directo).
4. **Confiabilidad ya verificada como criterio explícito del encargo**: el
   encargo pide "lo más simple y confiable en mobile/touch" — un botón con
   área táctil de 44×44px (ya el estándar de toda la app,
   `design-system.md` sección 5) es, por definición, 100% confiable en
   touch (no hay ambigüedad de gesto posible); un drag siempre tiene una
   tasa de error de reconocimiento de gesto mayor a cero, sin importar cuán
   bien implementado esté.

Se evaluó y se descarta el drag nativo con Pointer Events **para esta
iteración** — no por ser imposible, sino porque el costo de implementarlo
bien (los 3 problemas del punto 1) no se justifica frente a una lista corta
donde botones ↑/↓ ya dan una experiencia sólida. Si a futuro la lista de
cuentas creciera mucho (no es el patrón de uso esperado de un tracker
personal) o el Product Owner pidiera explícitamente la sensación táctil de
un drag, es una mejora incremental sobre este mismo modelo de datos
(`sort_order`), no un cambio de arquitectura.

#### 13.3.2 Entrada/salida del modo: toggle en el mismo botón, sin ruta/vista nueva

**"Ordenar" es un modo dentro de la misma `AccountsView.vue`, no una
pantalla separada.** El botón "Ordenar" del header de "Tus cuentas" alterna
su propio texto/ícono a "Listo" mientras el modo está activo — mismo
criterio ya usado en el resto del proyecto para alternar estados sin
navegar (p. ej. el toggle Gasto/Ingreso de `TransactionFormSheet.vue`,
sección 7.3: cambiar de estado in-place cuando no hay necesidad real de una
ruta nueva).

```html
<CardHeader class="flex-row items-center justify-between gap-2">
  <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
    Tus cuentas
  </CardTitle>
  <CardAction class="flex items-center gap-1">
    <Button
      v-if="accountsStore.accounts.length > 1"
      variant="ghost"
      size="sm"
      class="h-11 gap-1.5 px-2 text-sm font-medium"
      :aria-pressed="isOrderingMode"
      @click="toggleOrderingMode"
    >
      <component :is="isOrderingMode ? Check : ArrowUpDown" class="size-4" />
      {{ isOrderingMode ? 'Listo' : 'Ordenar' }}
    </Button>
    <Button
      v-if="!isOrderingMode"
      variant="ghost"
      size="icon"
      aria-label="Nueva cuenta"
      @click="openAddSheet"
    >
      <Plus class="size-5" />
    </Button>
  </CardAction>
</CardHeader>
```

- **El botón "Ordenar" se oculta directamente si `accounts.length <= 1`**
  (no solo se deshabilita): con 0 o 1 cuenta no existe ningún orden posible
  que cambiar — mismo criterio de "no ofrecer una acción sin efecto posible"
  ya usado en el guard de borrado de la sección 6.4 (aunque ahí se
  deshabilita en vez de ocultar, porque ahí sigue siendo relevante comunicar
  "no podés borrar esta" fila por fila; acá el control es único y de
  encabezado, ocultarlo es más limpio que un botón deshabilitado sin ningún
  efecto posible ni siquiera en potencia).
- **"Nueva cuenta" (`+`) se oculta por completo mientras `isOrderingMode`
  es `true`** (no solo se deshabilita): agregar una cuenta nueva en medio de
  una sesión de reordenamiento es una acción no relacionada que además
  complica el modelo mental ("¿la cuenta que acabo de crear entra en el
  medio del orden que estoy armando, o al final?" — sección 13.3.5 ya
  resuelve eso para el caso general, pero mezclarlo con una sesión de
  reordenamiento activa es una complejidad de UX innecesaria que se evita
  simplemente no permitiendo ambas cosas a la vez).
- **Qué más cambia en el resto de `/cuentas` mientras `isOrderingMode` es
  `true`**: el hero de "Saldo total" (sección 13.1) y el propio header de
  página (`AppHeader`) **no cambian** — siguen dando contexto de qué se está
  reordenando y permiten seguir navegando por el drawer sin restricción. La
  única superficie que cambia es la lista de filas en sí (sección 13.3.3).

#### 13.3.3 La fila durante "Ordenar": deja de navegar, deja de tener menú `⋮`, gana ↑/↓

```html
<div
  v-for="(account, idx) in accountsStore.accounts"
  :key="account.id"
  class="flex items-center gap-3 px-4 py-3"
  :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
>
  <span class="flex size-10 shrink-0 items-center justify-center rounded-lg" :style="{ backgroundColor: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }">
    <component :is="resolveAccountIcon(account.icon)" class="size-4.5" :style="{ color: readableTextColor(resolveAccountColor(account.color ?? '#6b7280', isDarkNow)) }" />
  </span>
  <div class="flex min-w-0 flex-1 flex-col">
    <p class="truncate text-sm font-medium">{{ account.name }}</p>
  </div>

  <div class="flex items-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      class="size-9"
      :aria-label="`Subir ${account.name}`"
      :disabled="idx === 0 || isReordering"
      @click="moveAccount(idx, -1)"
    >
      <ChevronUp class="size-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="size-9"
      :aria-label="`Bajar ${account.name}`"
      :disabled="idx === accountsStore.accounts.length - 1 || isReordering"
      @click="moveAccount(idx, 1)"
    >
      <ChevronDown class="size-4" />
    </Button>
  </div>
</div>
```

- **Sin navegación, sin menú `⋮`**: el `role="button"`/`@click`/
  `@keydown.enter` de navegación a `/cuentas/:id` (sección 13.2.1) y el
  `DropdownMenu` de Editar/Eliminar se **omiten por completo** mientras
  `isOrderingMode` es `true` — no tiene sentido navegar a un detalle ni
  editar/borrar en medio de una sesión de reordenamiento, y dejar cualquiera
  de los dos activo competiría por el mismo espacio de toque que los
  botones ↑/↓ nuevos.
- **Se muestra menos contenido por fila a propósito** (sin
  `usageLabel`/subtítulo, sin saldo): durante "Ordenar" lo único relevante
  es "cuál cuenta es cuál" (ícono + nombre alcanza, igual que ya alcanza en
  el selector de cuenta de `TransactionFormSheet.vue`, sección 8) — mostrar
  menos reduce el ruido visual de una tarea que ya requiere concentración
  (tocar el botón correcto repetidamente). El saldo/uso siguen disponibles
  con un tap en "Listo" para salir del modo.
- **Botones deshabilitados en los extremos** (`idx === 0` para ↑,
  `idx === length - 1` para ↓): comunica el límite de la lista sin
  necesitar texto adicional — mismo criterio de "disabled nativo + visible"
  ya aceptado en el resto del proyecto (sección 6.4 de este documento) en
  vez de ocultar el botón (ocultarlo desplazaría el resto de los controles
  de la fila, un salto de layout que un `disabled` evita).
- **`isReordering` global deshabilita TODOS los botones ↑/↓ mientras hay una
  persistencia en curso** (sección 13.3.4) — evita que dos taps rápidos en
  filas distintas disparen swaps superpuestos que podrían pisarse entre sí
  si la segunda petición llega al servidor antes que la primera. Es una
  limitación aceptada (el usuario no puede encadenar movimientos
  instantáneamente uno tras otro sin esperar), pero es la forma más simple
  de eliminar una clase entera de bug de carrera sin necesitar una cola de
  operaciones.

#### 13.3.4 Guardado: optimista en cada movimiento, sin botón "Guardar" explícito

**Decisión: cada tap en ↑/↓ persiste de inmediato (optimista + rollback),
no hay un botón "Guardar" al final de la sesión de "Ordenar".**

Es el mismo patrón que **ya** usa el 100% de `accounts.ts` (alta, edición,
borrado, sección 6.3/6.4 de este documento) — introducir acá el único flujo
de la pantalla con un paso de confirmación explícito ("Guardar") sería
inconsistente con el resto del store, y además más arriesgado en la
práctica: si el usuario reordena 5 cuentas y cierra la pestaña/pierde
conexión antes de tocar un hipotético botón "Guardar", los 5 movimientos se
perderían igual — persistiendo en cada paso, como mucho se pierde el último
movimiento en vuelo si algo falla, nunca la sesión completa.

```ts
// src/stores/accounts.ts — función nueva, mismo patrón optimista con
// rollback que addAccount/updateAccount/deleteAccount.
function moveAccount(index: number, direction: -1 | 1): void {
  const list = sortedAccounts.value // orden actual por sort_order
  const otherIndex = index + direction
  if (otherIndex < 0 || otherIndex >= list.length) return

  const a = list[index]!
  const b = list[otherIndex]!
  const previousOrderA = a.sort_order
  const previousOrderB = b.sort_order

  // Optimista: swap de sort_order en el estado local — sortedAccounts ya
  // refleja el nuevo orden en el próximo render, sin esperar al servidor.
  replaceById(a.id, { ...a, sort_order: previousOrderB })
  replaceById(b.id, { ...b, sort_order: previousOrderA })

  isReordering.value = true
  const persist = async (): Promise<void> => {
    const [resA, resB] = await Promise.all([
      supabase.from('accounts').update({ sort_order: previousOrderB }).eq('id', a.id),
      supabase.from('accounts').update({ sort_order: previousOrderA }).eq('id', b.id),
    ])

    isReordering.value = false

    if (resA.error || resB.error) {
      // Rollback: vuelve a los valores previos, ambos a la vez.
      replaceById(a.id, { ...a, sort_order: previousOrderA })
      replaceById(b.id, { ...b, sort_order: previousOrderB })
      toast.error('No se pudo guardar el nuevo orden', {
        description: 'Revisá tu conexión e intentá de nuevo.',
        action: { label: 'Reintentar', onClick: () => moveAccount(index, direction) },
      })
    }
  }

  void persist()
}
```

- **Feedback de error**: mismo patrón exacto que el resto de `accounts.ts`
  — `toast.error` con `description` + acción "Reintentar", **y** rollback
  visual inmediato (las dos filas vuelven a su posición anterior apenas
  falla, no se quedan "a mitad de camino" mostrando un orden que el servidor
  nunca confirmó). No hay ningún otro indicador de error adicional (sin
  ícono rojo persistente en la fila, sin bloquear el resto de la pantalla)
  — mismo nivel de feedback ya aceptado para cualquier otra mutación
  optimista del proyecto.
- **Sin toast de éxito** (a diferencia de `addAccount`/`updateAccount`, que
  sí muestran "Cuenta creada"/"Cambios guardados"): un `toast.success` en
  **cada** tap de ↑/↓ sería ruido — el usuario ya ve el resultado
  inmediato (la fila se movió) sin necesitar una confirmación de texto
  adicional por cada paso; mismo criterio de "no confirmar lo que ya es
  visualmente obvio" que el proyecto no había necesitado enunciar antes
  porque no había una acción tan repetitiva como esta.
- **Por qué swap de a pares, no reescribir todos los `sort_order` de la
  lista en cada tap**: mover una cuenta una posición solo requiere
  intercambiar su valor con el de la cuenta adyacente — reescribir toda la
  lista en cada tap sería trabajo (y payload de red) proporcional a N
  cuentas por cada movimiento de una sola posición, sin ningún beneficio
  real.

#### 13.3.5 Cuenta nueva: siempre al final, nunca en medio de un orden ya armado

Una cuenta recién creada (Sheet de alta, sección 6.3) recibe el
`sort_order` **más alto** existente + 1 (va al final de la lista) — nunca
se inserta en una posición intermedia ni se le asigna `0`/el más bajo (que
la pondría primera, desplazando silenciosamente el orden que el usuario ya
armó a mano). Nota para `supabase-backend-expert`/`vue-frontend-expert`
(fuera de esta especificación de diseño, se deja como contrato esperado):
puede resolverse con un `default` calculado en un trigger de Postgres o
enviando el valor ya calculado (`Math.max(...accounts.map(a => a.sort_order)) + 1`)
desde `addAccount` — cualquiera de las dos formas cumple el contrato, la
decisión de dónde vive el cálculo es de implementación, no de UX.

#### 13.3.6 Nota para `supabase-backend-expert`: columna `sort_order` (ilustrativo)

No es una migración final (responsabilidad del siguiente agente), pero se
deja el contrato exacto que este diseño asume:

```sql
-- Ilustrativo, no es la migración final.
alter table accounts add column sort_order integer not null default 0;
```

- **`fetchAccounts()` pasa a ordenar por `sort_order asc, created_at asc`**
  (el segundo criterio como desempate estable si dos filas comparten
  `sort_order` — no debería pasar en operación normal, pero es un desempate
  barato de dejar puesto). Reemplaza al `sortedAccounts` actual de
  `accounts.ts` (hoy ordena solo por `created_at asc`, sección 6.2 de este
  documento) — ese computed pasa a ordenar por `sort_order` en vez de
  `created_at`.
- **Backfill para cuentas ya existentes**: asignar `sort_order` secuencial
  por `created_at asc` (0, 1, 2, ...) por usuario, para que el orden
  percibido **no cambie** para ningún usuario ya existente el día que esto
  se despliegue — mismo criterio de "no reordenar silenciosamente algo que
  el usuario ya veía en un orden dado" ya aplicado en otros backfills del
  proyecto (p. ej. `debts.person_id`, `CLAUDE.md` "Deudas/Préstamos... 3
  migraciones nuevas").
- **El grid de "Mis cuentas" en `HomeView.vue` (sección 2.3) NO usa
  `sort_order`** — sigue ordenando por `balance desc` (las cuentas más
  relevantes primero en un espacio recortado a 5, motivo ya documentado en
  esa sección). `sort_order` gobierna exclusivamente el listado completo de
  `/cuentas` — no se propaga a ningún otro lugar de la app en esta
  iteración.

---

### 13.4 Accesibilidad — particularidades nuevas de esta sección

Se reafirman los lineamientos ya vigentes (sección 11 de este documento),
con lo específico de esta sección 13:

1. **El ícono decorativo del hero (13.1.4) es `aria-hidden`, nunca un
   elemento que parezca interactivo sin serlo.**
2. **El chevron de fila (13.2.1) es `aria-hidden`** — la afordancia real ya
   la comunica el `aria-label="Ver detalle de {name}"` existente de la
   fila.
3. **Botones ↑/↓ con `aria-label` específico por cuenta** ("Subir
   Efectivo"/"Bajar Procredito", nunca un genérico "Subir"/"Bajar" sin
   nombre — indispensable para que un lector de pantalla distinga qué fila
   se está moviendo sin depender de la posición visual).
4. **Botones ↑/↓ en los extremos usan `disabled` nativo** (nunca ocultos ni
   solo con opacidad reducida sin el atributo real) — mismo criterio de
   a11y de siempre, ya aplicado en el guard de borrado (sección 6.4).
5. **Mínimo táctil 44×44px también en ↑/↓**: `size-9` (36px) en el ejemplo
   de 13.3.3 es el tamaño del **ícono**, no del botón — el `Button
   size="icon"` que lo envuelve ya garantiza el mínimo de `h-11 w-11`
   (44px) por el mismo ajuste global de `design-system.md` sección 4
   (Botones ajustados a `h-11`/`size-11`), sin necesitar ninguna clase
   adicional.
6. **El botón "Ordenar"/"Listo" nunca depende solo de su texto para
   comunicar el estado**: cambia también de ícono (`ArrowUpDown` ↔ `Check`)
   y lleva `aria-pressed` — mismo principio de "nunca un solo indicador"
   aplicado a un control de modo, no solo a color.

---

## Resumen accionable — adenda de la sección 13

1. **`AccountsView.vue`**: agregar el hero "Saldo total" (13.1) antes de la
   Card "Tus cuentas"; agregar el chevron de fila (13.2.1); cambiar el color
   del saldo de fila a la combinación color-de-cuenta/`destructive` (13.2.2);
   agregar el botón "Ordenar"/"Listo" al header de la Card (13.3.2) y el modo
   de reordenamiento de la lista (13.3.3).
2. **`HomeView.vue`**: replicar el mismo cambio de color de saldo (13.2.2)
   en las tiles de "Mis cuentas" (sección 2.3), por consistencia — no pedido
   explícitamente por este encargo puntual, pero se deja anotado para no
   dejar dos reglas de color distintas conviviendo en la misma sesión de
   usuario.
3. **`src/stores/accounts.ts`**: función nueva `moveAccount(index, direction)`
   (13.3.4), `sort_order` incorporado al tipo `Account` (ya vendrá de
   `database.types.ts` regenerado una vez exista la columna),
   `sortedAccounts` pasa a ordenar por `sort_order asc, created_at asc` en
   vez de solo `created_at asc` (13.3.6). `addAccount` calcula/envía el
   `sort_order` de cola (13.3.5).
4. **`src/lib/date.ts`**: agregar `monthNameOnly(date): string` (o exportar
   `MONTHS_ES`) para el copy "vs. {mes}" del hero (13.1.3) — detalle de
   implementación, no de diseño.
5. **Pendiente para `supabase-backend-expert`** (13.3.6): columna
   `accounts.sort_order integer not null default 0`, backfill secuencial por
   `created_at asc` para no reordenar cuentas ya existentes, y decidir dónde
   vive el cálculo de "cola" para altas nuevas (trigger vs. payload del
   insert).
6. **Fuera de alcance explícito de esta sección**: drag-and-drop real
   (13.3.1, evaluado y descartado con justificación); que el ícono
   decorativo del hero navegue a algún lado (13.1.4); corregir el caso
   borde de `initial_balance` en cuentas nuevas creadas dentro del mes en
   curso (13.1.3, aceptado tal cual).
