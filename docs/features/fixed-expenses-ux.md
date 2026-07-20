# TipApp — UX de Gastos fijos / recurrentes

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, Sheet inferior, a11y) y en `docs/features/credit-cards-ux.md`
(patrón completo de gestión de un recurso propio: conteo dedicado para
guards, paleta fija, Sheet optimista vs. no optimista, dona +
`buildDonutSlices` genérico), `docs/features/accounts-income-ux.md` (patrón
de selector de Cuenta con default "la del movimiento más reciente", guard
"nunca la última") y `docs/features/debts-ux.md` (primer uso de `Tabs`, menú
`⋮` con `AlertDialog`, criterio de "sin guard de conteo cuando borrar no
destruye historial real"). No se repite esa justificación acá, solo se
referencia y se indica explícitamente qué se reusa tal cual y qué es nuevo.

Contexto de producto (ya decidido por el Product Owner, no se rediscute
acá): un **gasto fijo** es una plantilla que se repite todos los meses
(alquiler, servicios, suscripciones, cuotas). Cada mes el usuario la marca
como pagada, indicando desde qué cuenta salió la plata — **eso genera un
gasto real** en `expenses`, visible en Transacciones/Estadísticas/dona de
categorías igual que cualquier otro gasto cargado a mano. A diferencia de
Deudas (que ajusta el saldo de una cuenta sin dejar ningún rastro en
Transacciones, `debts-ux.md` sección 1 del encargo original), esta
**no es una feature silenciosa** — el copy de esta sección lo deja explícito
en el paso donde más importa (marcar como pagado, sección 5), no como una
letra chica.

La referencia visual ("Finanzia", mockup de otra app, 4 pantallas) se usa
**únicamente** para el contenido/layout que muestra — no su navegación (tenía
sidebar fija, TipApp sigue exclusivamente con el drawer `Sheet`) ni su marca.
Mismo criterio de exclusión ya aplicado en el resto de los docs de features
(ver sección 11 para el detalle completo de qué NO se adopta de la
referencia).

---

## 1. Contrato de datos (ya fijado por backend) y su impacto en el diseño

El backend está implementando en paralelo, con este contrato ya cerrado —
este documento diseña sobre él, no lo redefine:

- **`fixed_expenses`** (la plantilla): `name`, `amount`, `category_id` (FK a
  `categories`, la misma tabla de siempre — default + custom del usuario),
  `payment_day` (entero 1-31), `frequency` (`'monthly'` fijo en v1),
  `notes` opcional, `is_active` (pausar sin borrar).
- **`fixed_expense_instances`**: una fila por plantilla+mes calendario,
  `status: 'pending' | 'paid'`, vinculada a la fila real de `expenses`
  cuando se paga. **Generación perezosa**: no hay cron, se generan al entrar
  a la sección.
- Marcar como pagado pide **Cuenta (obligatorio)** + permite ajustar
  Monto/Fecha/Notas antes de confirmar (pensado para servicios variables
  como luz/gas).

### 1.1 Qué implica la generación perezosa para el estado de carga

A diferencia de cualquier otra pantalla de la app (que solo lee), entrar a
`/gastos-fijos` puede **escribir** (crear las instancias del mes si todavía
no existen) antes de poder mostrar nada. El `Skeleton` inicial de la
sección 3.9 cubre este caso sin necesidad de un estado de carga distinto —
el usuario no puede distinguir "cargando" de "generando instancias y después
cargando", y no hace falta que lo distinga: ambos casos son
indistinguibles en menos de un segundo con la cardinalidad esperada (unas
pocas decenas de plantillas activas como mucho). Si la generación tarda
más de lo esperado en la práctica, es un problema de rendimiento del
backend a resolver ahí, no una razón para inventar un tercer estado de
carga en el frontend.

### 1.2 Por qué es seguro sumar `fixed_expense_instances` del mes en cliente, sin repetir el problema de `MAX_EXPENSES`

Mismo ejercicio que ya hicieron `credit-cards-ux.md` sección 1 y
`debts-ux.md` sección 1.2/1.3: distinguir qué cardinalidad crece sin límite
(prohibido sumar en cliente sin acotar) de cuál no.

- **Lo que nunca creció sin límite real**: acá, la lista de **plantillas**
  (`fixed_expenses`) — un usuario con gastos fijos genuinamente recurrentes
  tiene, por diseño del concepto, un número chico (alquiler, 2-3 servicios,
  algunas suscripciones, quizás una cuota): unas pocas decenas en el caso
  más extremo, nunca miles. Por extensión, las **instancias de un mes dado**
  (`fixed_expense_instances` filtradas por ese mes) tienen exactamente la
  misma cardinalidad que las plantillas activas — es 1:1 por diseño del
  contrato ("una fila por plantilla+mes"). Traer "todas las plantillas del
  usuario" y "todas las instancias del mes en curso" son ambas queries
  chicas y seguras, agregables en cliente sin ningún riesgo de subestimar un
  número.
- **Lo que sí crecería sin límite si no se acota**: el **historial completo
  de instancias de todos los meses** (`fixed_expense_instances` sin filtro
  de fecha) — con años de uso, esa tabla sí acumula una fila por
  plantilla×mes transcurrido. Todo lo que necesite datos históricos (el
  "Promedio mensual" de la sección 3.3, la tendencia del hero de la sección
  3.2) va con una query acotada por rango de fecha en el servidor, nunca
  "traer todo" — mismo criterio de siempre.

**Consecuencia práctica**: `/gastos-fijos` hace, al entrar, una query de
**plantillas activas** (sin límite de fecha, es seguro por 1.2) + una query
de **instancias del mes en curso** (acotada por mes, aunque acá el acotado
es más por prolijidad conceptual que por necesidad real de escala) + una
query acotada de **instancias de los últimos 6 meses** (para el promedio,
sección 3.3, y el delta vs. mes anterior del hero, sección 3.2) — tres
queries chicas, ninguna suma el historial completo.

### 1.3 Guard de borrado de una plantilla — decisión: sin guard de conteo, con confirmación explícita de qué se pierde y qué no

El encargo deja esto a criterio de diseño. Decisión: **no hace falta un
guard de conteo que deshabilite "Eliminar"** (a diferencia de
categorías/tarjetas/personas), por el mismo argumento ya usado en
`debts-ux.md` sección 6.5 para borrar un hilo de deuda completo: **borrar
una plantilla no destruye ningún gasto real ya generado.** Los `expenses`
que ya se crearon al marcar instancias como pagadas son gastos propios del
usuario, independientes de la plantilla que los originó — igual que borrar
una categoría no borra los gastos ya cargados con ella (acá ni siquiera hay
esa referencia: el vínculo plantilla→instancia→expense no le pone ningún
`on delete restrict` en el camino a `expenses`, ver contrato sección 1).

Lo único que se pierde al borrar una plantilla es **su propio tracking
futuro**: la plantilla y las instancias del mes en curso/futuras que aún no
se pagaron. Eso sí necesita quedar clarísimo en el copy de confirmación,
para que el usuario no tema perder su historial:

```html
<AlertDialogHeader>
  <AlertDialogTitle>¿Eliminar "{{ template.name }}"?</AlertDialogTitle>
  <AlertDialogDescription>
    Se borra la plantilla y el seguimiento de este mes. Los gastos que ya
    generaste al marcarla como pagada quedan intactos en tu historial.
  </AlertDialogDescription>
</AlertDialogHeader>
```

Sin deshabilitar el ítem "Eliminar" de antemano en ningún caso — a
diferencia de categorías/tarjetas/personas, acá no hay ningún conteo que
consultar antes de decidir si se puede borrar, así que no hay nada que
calcular al cargar la pantalla para este guard en particular.

---

## 2. Arquitectura de rutas: **1 sola ruta** en v1 (`/gastos-fijos`)

Mismo ejercicio de calibración ya hecho en Cuentas (1 ruta),
Deudas (2, luego 3), Tarjetas (4). Decisión: **1 ruta**, mismo nivel que
Cuentas, por el mismo argumento central que ya usó `accounts-income-ux.md`
sección 2.3 para descartar `AccountDetailView`:

> el historial de movimientos de una cuenta ya es visible en otro lado
> (Transacciones) — no hace falta una ruta de detalle propia solo para
> volver a mostrar lo mismo.

Acá aplica con más fuerza todavía: **cada pago de un gasto fijo genera un
`expenses` real**, que ya tiene su lugar natural de detalle/historial en
`/transacciones` y `/estadisticas` (dona de categorías, tendencia). Un
"detalle de plantilla" que mostrara "todos los meses que pagaste este gasto
fijo" sería, en la práctica, un filtro de Transacciones por
descripción/categoría — información redundante con una pantalla que ya
existe, no una necesidad nueva.

- **No hace falta una 2ª ruta** (como Deudas, que sí necesita ver/editar/
  borrar movimientos individuales de un hilo — pedido explícito de ese
  encargo): acá no hay una pregunta de "¿qué contraparte tiene este saldo
  específico?" que amerite su propia pantalla; el dashboard ya muestra todo
  lo que hace falta decidir mes a mes (pagar o no, en una sola tabla).
- **No hace falta una 3ª/4ª ruta de gestión de entidad secundaria** (como
  `/tarjetas/gestionar` o `/deudas/personas`): "Persona responsable" queda
  fuera de v1 (decisión ya tomada por el Product Owner), así que no hay
  ninguna segunda entidad que gestionar en esta feature — `category_id` ya
  usa la gestión existente de `/categorias`, sin duplicar nada.

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/gastos-fijos` | `fixed-expenses` | `{ requiresAuth: true }` | `FixedExpensesView` |
| `/gastos-fijos/comparacion` | `fixed-expenses-comparison` | `{ requiresAuth: true }` | `FixedExpensesComparisonView` |

Sin colisión de segmentos, no requiere ningún orden especial en el array de
rutas: `/gastos-fijos/comparacion` es un segmento literal hijo de uno también
literal (no hay ningún `/gastos-fijos/:id` dinámico con el que pueda
confundirse un router que resuelve de arriba a abajo).

### 2.1 Pantallas 2 y 3 del mockup ("Comparación mensual", "Análisis y tendencias") — Fase 2

Se evaluó incluir una versión recortada de alguna de las dos en v1 y se
descartó en su momento, con el mismo criterio de fases ya usado dos veces en
el proyecto (Cuentas Fase 1 → Deudas Fase 2 completando el mismo dominio;
Tarjetas completo de una vez porque su alcance era chico desde el principio).
El foco explícito del encargo original era "el dashboard: resumen del mes,
lista con estado, marcar pagado, alta" — meter una versión mini de
"Comparación mensual" (3 columnas de mes) o "Análisis y tendencias"
(barras+dona+top+insights) en esa misma iteración habría diluido ese foco sin
que el Product Owner lo hubiera pedido.

**Actualización de esta iteración**: ya existe suficiente base (el dashboard
de v1 lleva usándose, y aunque el historial real todavía es corto, el
contrato de datos ya soporta leer cualquier mes calendario) para abordar la
**pantalla 2 ("Comparación mensual")** — ver sección 13 más abajo, spec
completa. La **pantalla 3 ("Análisis y tendencias": barras+dona+top+
insights) sigue diferida**, sin cambios respecto al argumento original: con
1-2 meses de historial real esa pantalla en particular (que vive de
comparar varios meses en simultáneo con más profundidad estadística) seguiría
siendo mayormente adivinar qué información es útil vs. ruido. La
"Comparación mensual" no tiene ese problema en la misma medida porque, aun
con historial corto, sigue siendo útil mostrando meses vacíos de forma
honesta (ver sección 13.3) en vez de necesitar densidad de datos para tener
sentido.

**Nombre de ruta, revisado**: la candidata original de esta sección era
`/gastos-fijos/analisis` — se descarta ese nombre para la pantalla 2 (ver
sección 13.5): "análisis" evoca más la pantalla 3, que sigue siendo la
pendiente real. La ruta implementada en esta iteración es
`/gastos-fijos/comparacion` (tabla de rutas, sección 2). Si a futuro se
aborda la pantalla 3, buscarle un nombre propio que no colisione
semánticamente con "comparación" (ej. `/gastos-fijos/tendencias`) en vez de
reusar "análisis" a ciegas.

---

## 3. `/gastos-fijos` — Dashboard

Header igual al patrón ya establecido:

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="flex-1 text-xl font-semibold">Gastos fijos</h1>
  <Button
    variant="ghost"
    size="icon"
    aria-label="Comparación mensual"
    @click="router.push({ name: 'fixed-expenses-comparison' })"
  >
    <Columns3 class="size-5" />
  </Button>
</header>
```

**Botón nuevo en el header** (`Columns3`, ver justificación completa en la
sección 13.5): único cambio a este header en esta iteración —
`<h1>` pasa a `flex-1` (mismo ajuste ya hecho en `DebtsDashboardView.vue`
cuando se agregó el botón `Settings` de su header, `debts-ux.md`) para que el
ícono nuevo quede a la derecha sin descentrar el título.

### 3.1 Orden de secciones en el `<main>`

1. 4 cards resumen, grid 2×2 (sección 3.2-3.5).
2. "Por categoría" — dona + leyenda, reusando `CategoryDonutChart` (sección
   3.6).
3. Lista de gastos fijos del mes, con estado (sección 3.7).
4. FAB "Nuevo gasto fijo" (sección 3.8), persistente sobre todo lo anterior.

### 3.2 Card 1 — "Total del mes" (con tendencia)

Mismo hero que ya usan `HomeView.vue`/`CardsDashboardView.vue`, sección
completa en 2 columnas del grid (`col-span-2`) por ser la cifra más
importante:

```html
<Card class="col-span-2">
  <CardHeader class="pb-2">
    <CardDescription>Total del mes · {{ monthLabel }}</CardDescription>
    <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
      <span class="align-top text-sm font-normal text-muted-foreground">$</span>{{ formatAmount(monthTotal) }}
    </CardTitle>
  </CardHeader>
  <div v-if="monthDelta" class="flex items-center gap-1.5 px-6 pb-4 text-sm" :class="monthDelta.direction === 'up' ? 'text-destructive' : 'text-success'">
    <component :is="monthDelta.direction === 'up' ? ArrowUp : ArrowDown" class="size-3.5" />
    <span>{{ monthDelta.percent }}% vs. mes anterior</span>
  </div>
</Card>
```

- `monthTotal` = suma de `amount` de **todas** las instancias del mes en
  curso (pagadas + pendientes) — representa "cuánto tenés comprometido en
  gastos fijos este mes", útil independientemente de si ya se pagaron o no.
  No es "solo lo ya pagado": un usuario quiere ver de entrada su compromiso
  total del mes, no un número que va creciendo a medida que paga (eso ya lo
  cuenta la card de progreso, sección 3.3).
- `monthDelta`: mismo criterio semántico ya establecido en toda la app —
  gastar más este mes en fijos que el anterior es la mala noticia
  (`destructive` + `ArrowUp`), menos es la buena (`success` + `ArrowDown`),
  nunca color solo. Comparación acotada a 2 meses (sección 1.2), sin
  heurística de `isMonthSafeToShow` porque acá **no** hay el problema que
  motivó esa heurística (`MAX_EXPENSES` sin filtro de fecha) — la query ya
  viene acotada por mes desde el servidor.

### 3.3 Card 2 — Progreso "Gastos registrados X de Y planeados"

```html
<Card>
  <CardHeader class="pb-2">
    <CardDescription>Este mes</CardDescription>
  </CardHeader>
  <div class="flex flex-col gap-2 px-6 pb-4">
    <p class="text-lg font-semibold tabular-nums">{{ paidCount }} de {{ totalCount }} pagados</p>
    <div class="h-2 overflow-hidden rounded-full bg-muted">
      <div
        class="h-full rounded-full transition-[width]"
        :class="paidCount === totalCount && totalCount > 0 ? 'bg-success' : 'bg-primary'"
        :style="{ width: `${totalCount ? (paidCount / totalCount) * 100 : 0}%` }"
      />
    </div>
  </div>
</Card>
```

**Se reusa la barra de progreso ya establecida** (`h-2 rounded-full
bg-muted` + relleno, idéntica a la barra de "límite sugerido" de
`credit-cards-ux.md` sección 4.2), **no un anillo SVG nuevo**: aunque el
mockup muestra un anillo, TipApp ya tiene un patrón hand-rolled para "avance
de un total" que resuelve el mismo problema visual sin inventar un
componente nuevo — mismo criterio de "no fragmentar el sistema visual sin
necesidad real" ya aplicado en varios docs anteriores. El color de la barra
usa `primary` mientras falta algo por pagar y pasa a `success` **solo** al
llegar al 100% — nunca `warning`/`destructive` acá: no haber pagado todavía
un gasto fijo que ni siquiera llegó a su `payment_day` no es una mala
noticia (mismo argumento de "no moralizar cada gasto" de
`design-system.md` sección 1), es simplemente el estado esperado a mitad de
mes.

### 3.4 Card 3 — Promedio mensual

```html
<Card>
  <CardHeader class="pb-2">
    <CardDescription>Promedio mensual</CardDescription>
  </CardHeader>
  <div class="px-6 pb-4">
    <p v-if="monthlyAverage !== null" class="text-lg font-semibold tabular-nums">${{ formatAmount(monthlyAverage) }}</p>
    <p v-else class="text-sm text-muted-foreground">Sin historial suficiente todavía</p>
  </div>
</Card>
```

**Definición** (el encargo pide interpretarlo, no hay un cálculo "obvio"
único): promedio del **total pagado** en cada uno de los últimos hasta 6
**meses completos** anteriores al actual (nunca incluye el mes en curso,
que todavía está a mitad de camino y distorsionaría el promedio hacia
abajo). El denominador es la cantidad real de meses con al menos 1 pago
registrado dentro de esa ventana, **no siempre 6** — un usuario con 2 meses
de historial real no debe ver su promedio diluido por 4 meses vacíos que
todavía no existen (mismo espíritu que la derivación de "saldo de arranque"
de `debts-ux.md` sección 1.4: no inventar datos donde no los hay). Si no
hay ningún mes completo con pagos (`monthlyAverage === null`, usuario
nuevo), se muestra el texto "Sin historial suficiente todavía" en vez de
`$0` — un `$0` sugeriría falsamente "no gastás nada en fijos", cuando en
realidad es "todavía no hay datos".

Query: instancias `status='paid'` de los últimos 6 meses calendario
completos, acotada por fecha (sección 1.2) — un único fetch al cargar la
pantalla, agregado en cliente sobre un resultado ya chico.

### 3.5 Card 4 — Próximos pagos (mini gráfico de barras)

```html
<Card>
  <CardHeader class="pb-2">
    <CardDescription>Próximos pagos</CardDescription>
  </CardHeader>
  <div class="flex flex-col gap-2 px-6 pb-4">
    <p class="text-lg font-semibold tabular-nums">{{ upcomingCount }} pendiente{{ upcomingCount === 1 ? '' : 's' }}</p>
    <div v-if="upcomingCount > 0" class="flex h-8 items-end gap-1" role="img" :aria-label="upcomingAriaLabel">
      <div
        v-for="item in upcomingSparkline"
        :key="item.id"
        class="w-2 rounded-sm bg-primary/60"
        :style="{ height: `${item.heightPercent}%` }"
      />
    </div>
    <p class="text-xs text-muted-foreground">{{ nextPaymentLabel }}</p>
  </div>
</Card>
```

**Interpretación** (no idéntica al mockup, adaptada a un espacio de card
angosto): mini barras, una por cada instancia **pendiente** del mes en
curso ordenada por `payment_day` ascendente (hasta 6, para no amontonar en
una card de ~150px de ancho), altura relativa al monto de cada una
(`heightPercent = amount / maxAmount * 100`) — da una lectura rápida de
"cuántos faltan y más o menos cuánto pesa cada uno", sin pretender ser un
gráfico preciso (no hay eje ni tooltip, el detalle exacto está en la lista
de la sección 3.7 debajo). `nextPaymentLabel`: texto plano con el próximo
por vencer, ej. `"Próximo: Netflix, 25/07"` — el dato concreto **siempre**
en texto, las barras son un refuerzo visual, no la única fuente de
información (mismo criterio a11y de "nunca solo el gráfico" ya aplicado a
`TrendAreaChart`/`CategoryDonutChart`). `role="img"` + `aria-label`
describiendo el conjunto (`"6 pagos pendientes este mes, entre $X y $Y"`)
en vez de accesibilidad por barra individual — mismo patrón que
`TrendAreaChart`, un lector de pantalla no necesita 6 anuncios separados
cuando el texto de abajo ya da el dato accionable (el próximo pago).

Si `upcomingCount === 0` (todo pagado o sin plantillas activas): se oculta
el mini gráfico, el texto pasa a `"¡Todo pagado este mes!"` en
`text-success` — única card de las 4 con un mensaje de éxito explícito,
justificado porque es un logro real y puntual (no un estado permanente que
ameritara verde en todo momento).

### 3.6 "Por categoría" — reuso de `CategoryDonutChart`

**Se reusa `CategoryDonutChart.vue`/`buildDonutSlices` tal cual, sin
cambios** (mismo componente ya reusado por Tarjetas para "Distribución por
tarjeta") — no se construye el "grid" que muestra el mockup. Justificación:
TipApp ya tiene un lenguaje visual establecido y consistente para "cómo se
reparte un total entre categorías" (Estadísticas, Tarjetas), y la forma
genérica que ya expone `buildDonutSlices` (`{id, name, color, amount}`)
encaja sin ningún cambio con `fixed_expenses.category_id` — construir un
grid nuevo solo para esta pantalla fragmentaría el sistema sin ninguna
ganancia real, la misma discusión que ya cerró `credit-cards-ux.md` sección
2.5 al decidir dona en vez de barras para "por tarjeta".

```html
<Card>
  <CardHeader><CardTitle class="text-base font-semibold">Por categoría</CardTitle></CardHeader>
  <div class="flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-center">
    <CategoryDonutChart :slices="categorySlices" :total="monthTotal" ariaLabel="Gastos fijos de este mes por categoría" />
    <div class="flex w-full flex-col gap-2">
      <div v-for="slice in categorySlices" :key="slice.id" class="flex items-center gap-2 text-sm">
        <span class="size-2.5 shrink-0 rounded-full" :style="{ background: slice.color }" />
        <span class="min-w-0 flex-1 truncate">{{ slice.name }}</span>
        <span class="tabular-nums text-muted-foreground">${{ formatAmount(slice.amount) }}</span>
      </div>
    </div>
  </div>
</Card>
```

`categorySlices` se arma sobre las instancias del mes (pagadas + pendientes,
mismo total que la card 1) agrupadas por `category_id` — mismo criterio de
`monthTotal` de la sección 3.2 (compromiso total del mes, no solo lo ya
pagado). Se oculta la Card completa si `monthTotal === 0` (sin plantillas
activas todavía), mismo criterio que el resto de la app.

### 3.7 Lista "Gastos fijos del mes"

**Desviación deliberada del mockup**: la referencia muestra una `<table>`
HTML con 6 columnas (Gasto/Categoría/Monto/Fecha/Próximo pago/Estado). En
mobile-first eso no reflowea bien a 360px de ancho — se adapta al patrón de
**card-list ya establecido** en toda la app (filas tipo `cardsRanking`/
movimientos de `debts-ux.md` sección 3.6), condensando las 6 columnas en 2
líneas de texto por fila + badge de estado + acción, mismo criterio que ya
usaron Tarjetas/Deudas para no replicar layouts de escritorio en una PWA
mobile-first.

```html
<Card>
  <CardHeader>
    <CardTitle class="text-base font-semibold">Gastos fijos del mes</CardTitle>
  </CardHeader>
  <div class="flex flex-col">
    <template v-for="(item, idx) in fixedExpensesRows" :key="item.templateId">
      <Separator v-if="idx > 0" />
      <div class="flex items-center gap-3 px-4 py-3" :class="{ 'opacity-60': !item.isActive }">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full"
          :style="{ background: withAlpha(item.categoryColor, 0.15) }"
        >
          <span class="size-2.5 rounded-full" :style="{ background: item.categoryColor }" />
        </span>

        <div class="flex min-w-0 flex-1 flex-col">
          <p class="truncate text-sm font-medium">{{ item.name }}</p>
          <p class="truncate text-xs text-muted-foreground">
            {{ item.categoryName }} · Día {{ item.paymentDay }}
          </p>
        </div>

        <div class="flex flex-col items-end gap-1">
          <p class="text-sm font-semibold tabular-nums">${{ formatAmount(item.amount) }}</p>
          <FixedExpenseStatusBadge :status="item.displayStatus" />
        </div>

        <Button
          v-if="item.isActive && item.status === 'pending'"
          size="sm"
          variant="outline"
          class="shrink-0"
          @click="openPaySheet(item)"
        >
          Pagar
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" aria-label="Más acciones">
              <EllipsisVertical class="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <!-- sección 7 -->
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </template>
  </div>
</Card>
```

- **Una sola lista, plantillas activas y pausadas juntas** (no una segunda
  sección aparte): las pausadas se muestran con `opacity-60` + badge
  "Pausado" en vez de Pendiente/Pagado (sección 6.4) — es el único lugar
  donde el usuario puede encontrar una plantilla pausada para reanudarla
  (vía el menú `⋮`, sección 7), así que tiene que seguir siendo visible, no
  desaparecer. Orden: activas primero (pendientes antes que pagadas, mismo
  criterio de "lo accionable primero" que `debts-ux.md` sección 3.5),
  pausadas al final.
- **Botón "Pagar" inline** (visible solo si `isActive && status ===
  'pending'`): acción primaria de esta pantalla, no escondida en el menú
  `⋮` — es la razón de ser de la pantalla mes a mes. Para filas ya pagadas
  o pausadas, no hay botón "Pagar" (ocupa su lugar el espacio del badge).
- `withAlpha`/color de categoría: mismo patrón exacto que `CategoriesView`
  (sección de referencia, `src/lib/colors.ts`, ya existente, nada nuevo que
  agregar).
- No hay navegación al tocar la fila completa (a diferencia de
  `cardsRanking`/hilos de deuda) — acá no existe una pantalla de detalle
  (sección 2), así que la fila no es clickeable como un todo; las dos
  acciones posibles (Pagar, `⋮`) son explícitas.

### 3.8 FAB "Nuevo gasto fijo"

Mismo patrón exacto que el resto de la app:

```html
<button
  type="button"
  aria-label="Nuevo gasto fijo"
  class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
  style="margin-bottom: env(safe-area-inset-bottom)"
  @click="openAddTemplateSheet"
>
  <Plus class="size-6" />
</button>
```

### 3.9 Estados de carga/vacío/error

- **Carga**: `Skeleton` en las 4 cards resumen, la card de categoría y la
  lista — mismo criterio que el resto de la app. Ver 1.1 sobre por qué no
  hace falta distinguir "generando instancias" de "cargando".
- **Error**: mismo bloque `AlertCircle` + "No pudimos cargar tus gastos
  fijos" + `Reintentar`.
- **Vacío total** (usuario sin ninguna plantilla creada): reemplaza todo el
  contenido bajo el header por un bloque centrado (ícono `CalendarSync`
  `size-12 text-muted-foreground`, "Todavía no registraste ningún gasto
  fijo.", subtexto "Cargá el alquiler, un servicio o una suscripción para
  llevar el control mes a mes.", botón "Nuevo gasto fijo" → abre
  `FixedExpenseFormSheet` directo, mismo criterio que el vacío de Deudas:
  sin ruta intermedia, el alta vive en el propio dashboard).

---

## 4. Alta/edición de plantilla — `FixedExpenseFormSheet.vue`

Mismo patrón de Sheet que `AccountFormSheet`/`CardFormSheet`/
`DebtPersonFormSheet`: `SheetHeader`/`SheetTitle`/`SheetDescription`, body
`flex flex-col gap-4 px-4`, `SheetFooter` con "Cancelar" (`variant="ghost"`)
+ botón ancho de guardar.

```html
<SheetHeader>
  <SheetTitle>{{ isEditing ? 'Editar gasto fijo' : 'Nuevo gasto fijo' }}</SheetTitle>
  <SheetDescription v-if="!isEditing">
    Se repite todos los meses. Vas a poder marcarlo como pagado cada vez que corresponda.
  </SheetDescription>
</SheetHeader>
```

### 4.1 Campos, en orden

1. **Nombre** (`Input`, requerido, `maxlength="60"`, `text-base` — piso
   mobile de siempre) — ej. "Alquiler", "Netflix".
2. **Monto** (`Input type="number" inputmode="decimal"`, requerido,
   `check > 0` ya en BD, mismo formato que el resto de montos de la app) —
   copy de ayuda: `"Podés ajustarlo cada mes al marcarlo como pagado, por si
   varía (como luz o gas)."` — anticipa la pregunta obvia de "¿y si este mes
   fue distinto?" antes de que el usuario tenga que ir a buscarla.
3. **Categoría** (`Select`, requerido, reusa `categoriesStore` — default +
   custom del usuario, mismo componente que `TransactionFormSheet`):

```html
<Select v-model="form.categoryId" :disabled="isSaving">
  <SelectTrigger id="categoria" class="h-11 w-full" :aria-invalid="!!errors.category">
    <SelectValue placeholder="Seleccioná una categoría" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem v-for="category in categoriesStore.categories" :key="category.id" :value="category.id">
      <span class="size-2.5 rounded-full" :style="{ background: category.color ?? 'var(--color-muted-foreground)' }" />
      {{ category.name }}
    </SelectItem>
  </SelectContent>
</Select>
```

4. **Día de pago** (`Input type="number" inputmode="numeric" min="1"
   max="31"`, requerido, default vacío) — se descarta un `Select` de 31
   ítems por incomodidad táctil de scrollear una lista tan larga en mobile;
   un `Input` numérico acotado (`min`/`max` + validación de cliente
   `1 ≤ n ≤ 31`) es más rápido de completar. Copy de ayuda: `"Día del mes en
   que normalmente pagás este gasto."` Nota aparte, siempre visible debajo
   del campo (no solo en error): `"Si el mes no tiene ese día (ej. 31 en
   febrero), tomamos el último día disponible."` — anticipa el caso borde
   real de un campo 1-31 aplicado a meses de distinta longitud; la regla
   exacta de qué día usar ese mes la resuelve el backend al generar la
   instancia, este texto solo evita que el usuario se pregunte qué va a
   pasar.
5. **Frecuencia**: **no editable en v1** — texto fijo no interactivo
   `"Mensual"` junto a un ícono `CalendarSync` `size-4 text-muted-foreground`,
   sin `Select` ni control alguno (el campo `frequency` del contrato ya
   viene preparado a futuro para otros valores, pero hoy el backend solo
   acepta `'monthly'` — mostrar un control que solo tiene una opción posible
   sería ruido de UI sin ninguna decisión real detrás).
6. **Notas** (`Textarea`, opcional, mismo componente ya instalado —
   `credit-cards-ux.md` sección 5.3 — reusado sin cambios).

Campo `is_active` **no aparece en este Sheet en ningún momento** (ni en
alta ni en edición) — se maneja exclusivamente desde el menú `⋮` "Pausar"/
"Reanudar" (sección 7), nunca como un checkbox más del formulario: es una
acción de estado con su propio verbo, no un dato descriptivo de la
plantilla.

### 4.2 Guardado: 100% optimista

Mismo criterio que `AccountFormSheet`/`CardFormSheet`/`DebtPersonFormSheet`:
no hay ninguna restricción de unicidad server-only conocida sobre
`fixed_expenses.name` en el contrato — sin conflicto server-only en el
camino feliz, así que no hay motivo para el patrón no-optimista de
`CategoryFormSheet`. Si a futuro se agrega una restricción así, migrar en
ese momento, no antes (mismo criterio ya repetido en el resto del
proyecto).

---

## 5. Marcar como pagado — flujo corto, no el mismo Sheet que el alta

Se abre desde el botón "Pagar" de la fila (sección 3.7) o desde el ítem
"Marcar como pagado" del menú `⋮` (sección 7, alternativa por si el usuario
ya tiene el menú abierto). **Es un Sheet distinto** de
`FixedExpenseFormSheet` (`MarkFixedExpensePaidSheet.vue`) — no una variante
del mismo formulario: los campos y el propósito son distintos (acá no se
edita la plantilla, se confirma un pago puntual de este mes).

```html
<SheetHeader>
  <SheetTitle>Marcar como pagado</SheetTitle>
  <SheetDescription>{{ instance.name }} · {{ monthLabel }}</SheetDescription>
</SheetHeader>

<Alert class="mx-4">
  <Info class="size-4" />
  <AlertDescription>
    Esto va a registrar un gasto real en Transacciones y Estadísticas, con
    la cuenta y el monto que confirmes acá.
  </AlertDescription>
</Alert>
```

**Copy explícito y siempre visible** (no solo en un tooltip ni escondido):
mismo criterio que el copy del vínculo a cuenta de `debts-ux.md` sección
5.3, pero al revés en el mensaje — ahí se avisa que **no** genera
movimiento visible, acá se avisa que **sí** genera uno, porque el
comportamiento por defecto esperado de "marcar algo como pagado" en una
sección separada del resto de la app podría hacer pensar lo contrario si no
se aclara.

### 5.1 Campos, todos prefilled desde la plantilla/instancia, todos editables

1. **Cuenta** (`Select`, **obligatorio** — la única exigencia explícita del
   encargo): mismo componente y mismo default que
   `TransactionFormSheet`/`accounts-income-ux.md` sección 8.1 — "la cuenta
   del movimiento más reciente" si existe alguna, si no la primera cuenta
   del usuario.

```html
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
```

2. **Monto** (`Input type="number"`, prefilled con `template.amount` o el
   monto ya guardado en la instancia si se está reeditando un pago) —
   editable, copy de ayuda: `"Ajustalo si este mes fue distinto (por ejemplo,
   la factura de luz)."`
3. **Fecha** (`Input type="date"`, default hoy — no `payment_day` de la
   plantilla, porque lo más común es pagar el día real en que se paga, no
   una fecha aproximada; mismo criterio que el resto de la app: nunca
   fechas futuras, `max` = hoy).
4. **Notas** (`Textarea`, opcional, prefilled con `template.notes` si
   existe, editable sin afectar la plantilla original).

### 5.2 Guardado: no optimista

**Única excepción no-optimista de esta feature**, mismo motivo exacto que
`create_debt`/`DebtFormSheet` (`debts-ux.md` sección 3, punto "Alta de deuda
nueva"): es una dependencia atómica entre dos escrituras (crear el
`expenses` real + actualizar `fixed_expense_instances.status` con el
`expense_id` resultante) — el cliente no puede insertar optimistamente sin
ya tener el `id` real que devuelve el servidor, y una mutación optimista
que se revierte acá sería más disruptiva que esperar (el usuario podría ver
el gasto "pagado" por un instante y después volver a "pendiente" si algo
falla). Se recomienda a `supabase-backend-expert`/`vue-frontend-expert`
resolverlo con una función/RPC dedicada (nombre ilustrativo
`pay_fixed_expense_instance`, análoga a `create_debt`) que haga ambas
escrituras en una transacción — evita que el frontend deje una instancia
"a medio pagar" si el segundo paso falla.

Botón de confirmación: `"Marcar como pagado"` (no genérico "Guardar" — el
verbo específico refuerza qué está por pasar), con estado de carga
(`disabled` + spinner) mientras la operación está en vuelo. Si falla:
`toast.error("No pudimos registrar el pago")` + acción "Reintentar", Sheet
permanece abierto con los datos ya tipeados (no se pierden).

---

## 6. Estados Pendiente / Pagado / Pausado — badge con ícono + texto, nunca solo color

Mismo criterio CVD ya aplicado al anillo de 4 estados de cupones
(`live-coupons-ux.md` sección 3.1): codificación **redundante**, el color
nunca es la única señal.

| Estado (`displayStatus`) | Cuándo | Ícono | Color | Texto del badge |
|---|---|---|---|---|
| `paid` | `status === 'paid'` | `CircleCheck` | `success` | "Pagado" |
| `overdue` | `status === 'pending'` **y** hoy > fecha de vencimiento del mes | `AlertCircle` | `destructive` | "Vencido" |
| `pending` | `status === 'pending'`, todavía no vencido | `Clock` | `muted-foreground` | "Pendiente" |
| `paused` | `template.is_active === false` | `PauseCircle` | `muted-foreground` | "Pausado" |

### 6.1 `overdue` es una interpretación de diseño, no un valor nuevo de backend

El contrato de backend solo define `'pending' | 'paid'` (sección 1). El
tercer estado visual "Vencido" es una **derivación 100% de cliente**
(comparar `payment_day` de este mes contra la fecha de hoy, mismo tipo de
cálculo trivial que ya hace `matchClock.ts` con el minuto de un partido) —
mismo espíritu que la app ya aplica en otros lados de "estado siempre
derivado, nunca cacheado", solo que acá la derivación vive en el frontend
en vez de una vista SQL porque no depende de ningún dato que no tenga ya
cargado. Se agrega porque distinguir "todavía no llegó el día" de "ya pasó
el día y seguís sin pagar" es información real y accionable que el
contrato tal cual (2 valores) no puede expresar por sí solo, y es
exactamente el tipo de vencimiento que esta feature existe para hacer
visible.

`overdue` usa `destructive` (a diferencia de `pending`, que usa
`muted-foreground` neutro) — acá **sí** es una mala noticia real (un pago
que se te pasó), a diferencia de "todavía no vencido" que es simplemente el
estado esperado a mitad de mes (mismo argumento de la sección 3.3).

```html
<script setup lang="ts">
// FixedExpenseStatusBadge.vue — componente nuevo, chico
import { CircleCheck, AlertCircle, Clock, PauseCircle } from '@lucide/vue'

const STATUS_CONFIG = {
  paid:    { icon: CircleCheck, class: 'text-success',           label: 'Pagado' },
  overdue: { icon: AlertCircle, class: 'text-destructive',       label: 'Vencido' },
  pending: { icon: Clock,       class: 'text-muted-foreground',  label: 'Pendiente' },
  paused:  { icon: PauseCircle, class: 'text-muted-foreground',  label: 'Pausado' },
} as const
</script>

<template>
  <Badge variant="outline" class="gap-1 text-[10px]" :class="STATUS_CONFIG[status].class">
    <component :is="STATUS_CONFIG[status].icon" class="size-3" />
    {{ STATUS_CONFIG[status].label }}
  </Badge>
</template>
```

`variant="outline"` para los 4 (mismo tratamiento neutro de fondo, el color
vive en el ícono+texto, no en el relleno del badge) — consistente con el
badge "Pendiente"/"Saldada" de `debts-ux.md` sección 3.5.

---

## 7. Menú "⋮" por fila

```html
<DropdownMenuContent align="end">
  <DropdownMenuItem v-if="item.isActive && item.status === 'pending'" @click="openPaySheet(item)">
    <CircleCheck class="size-4" /> Marcar como pagado
  </DropdownMenuItem>
  <DropdownMenuItem @click="openEditTemplateSheet(item)">
    <Pencil class="size-4" /> Editar
  </DropdownMenuItem>
  <DropdownMenuItem @click="toggleActive(item)">
    <component :is="item.isActive ? PauseCircle : PlayCircle" class="size-4" />
    {{ item.isActive ? 'Pausar' : 'Reanudar' }}
  </DropdownMenuItem>
  <AlertDialog>
    <AlertDialogTrigger as-child>
      <DropdownMenuItem variant="destructive" @select.prevent>
        <Trash2 class="size-4" /> Eliminar
      </DropdownMenuItem>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>¿Eliminar "{{ item.name }}"?</AlertDialogTitle>
        <AlertDialogDescription>
          Se borra la plantilla y el seguimiento de este mes. Los gastos que
          ya generaste al marcarla como pagada quedan intactos en tu
          historial.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancelar</AlertDialogCancel>
        <AlertDialogAction @click="deleteTemplate(item.templateId)">Eliminar</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</DropdownMenuContent>
```

- **"Marcar como pagado"** solo aparece si aplica (activo + pendiente) —
  duplicado intencional del botón "Pagar" inline de la fila (sección 3.7),
  para que también esté disponible si el usuario ya abrió el menú por otro
  motivo, mismo criterio de "más de un camino al mismo lugar cuando ambos
  son baratos de mantener" ya visto en otras partes del proyecto (el atajo
  "Agregar persona nueva" de Deudas, por ejemplo).
- **"Pausar"/"Reanudar"**: toggle directo de `is_active`, **sin**
  `AlertDialog` de confirmación (a diferencia de Eliminar) — es una acción
  completamente reversible con un solo tap adicional (volver a tocar
  "Reanudar"), no hace falta el costo de fricción de una confirmación para
  algo no destructivo. Mutación optimista simple (flip local +
  confirmación en background con rollback + toast en error, mismo
  mecanismo ya usado en toda la app para toggles).
- **"Eliminar"**: `AlertDialogItem` con `variant="destructive"` (mismo
  patrón visual que el resto de menús de la app), sin deshabilitar de
  antemano (sección 1.3 — no hay guard de conteo acá).
- Pausar una plantilla no genera ni borra ninguna instancia — simplemente
  dejará de generarse la del próximo mes calendario (comportamiento del
  backend, no de esta pantalla). La instancia del mes en curso, si ya
  existía, sigue visible tal cual estaba.

---

## 8. Ítem de drawer

**Posición 6 de 11**, ícono `CalendarSync` (confirmado en
`node_modules/@lucide/vue/dist/esm/icons/calendar-sync.mjs`, nada que
instalar). Se inserta **inmediatamente después de "Deudas"**, manteniendo
agrupados los cuatro ítems que son "dominios de movimientos de dinero"
(Transacciones/Tarjetas/Cuentas/Deudas/**Gastos fijos**) antes del primer
ítem que no pertenece a ese grupo ("Partidos en vivo", utilidad personal sin
relación con el dominio financiero — ver nota de alcance de `CLAUDE.md`).
Encaja mejor ahí que al final: es, literalmente, un generador de gastos
reales, el mismo tipo de "domain de movimiento de dinero" que sus cuatro
vecinos — ponerlo después de "Partidos en vivo" mezclaría dominios sin
motivo.

**Por qué `CalendarSync` y no `Repeat`/`CalendarClock`** (las otras dos
opciones sugeridas por el Product Owner, ambas confirmadas disponibles en
`@lucide/vue`): `Repeat` es un glifo genérico de "algo cíclico" sin ninguna
referencia temporal — ya evoca mejor "recurrencia" en abstracto que en el
contexto concreto de esta feature (una fecha de pago mensual). `CalendarClock`
comunica más "un evento con hora programada" (como un recordatorio puntual)
que "un ciclo que se repite mes a mes". `CalendarSync` combina ambas ideas
—un calendario, con una flecha de sincronización/repetición— y es el que
más se acerca visualmente al concepto real de "esto vuelve todos los
meses", sin colisionar con ningún ícono ya usado en el drawer.

Orden final del drawer (11 ítems):

1. Inicio (`Home`)
2. Transacciones (`ArrowLeftRight`)
3. Tarjetas de crédito (`CreditCard`)
4. Cuentas (`Wallet`)
5. Deudas (`HandCoins`)
6. **Gastos fijos (`CalendarSync`) — nuevo**
7. Partidos en vivo (`Goal`)
8. Categorías (`Tag`)
9. Estadísticas (`ChartPie`)
10. Reportes (`FileText`)
11. Ajustes (`Settings`)

```html
<button
  type="button"
  class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :class="isActive('fixed-expenses') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
  :aria-current="isActive('fixed-expenses') ? 'page' : undefined"
  @click="navigateFromDrawer('fixed-expenses')"
>
  <CalendarSync class="size-5 shrink-0" />
  Gastos fijos
</button>
```

Se inserta entre el botón de "Deudas" (ya existente, línea ~330 de
`HomeView.vue`) y el de "Partidos en vivo" (ya existente, línea ~341) —
único cambio estructural a `HomeView.vue` más allá del `import` del ícono y
el nuevo caso en `NavRouteName`.

---

## 9. Accesibilidad

Todo lo ya establecido en `design-system.md` aplica sin excepción — se
resaltan los puntos específicos de esta feature:

- **Inputs numéricos** (Monto, Día de pago): `text-base`/`inputmode`
  correcto (`decimal`/`numeric`) para que iOS no haga zoom automático y el
  teclado que aparece sea el más chico posible para el dato pedido.
- **Botón "Pagar" y botones de menú `⋮`**: `min-h-11`/`size-11` (44px),
  mismo mínimo táctil de siempre — la fila de la lista (sección 3.7) tiene
  varios elementos interactivos adyacentes (badge no interactivo, botón
  Pagar, botón `⋮`), cada uno necesita su propia área de toque sin
  solaparse.
- **Badge de estado** (sección 6): nunca solo color, ícono + texto siempre
  juntos — ya cubierto arriba, remarcado acá porque es el punto de a11y
  central de todo el documento.
- **`FixedExpenseStatusBadge`**: no es un elemento interactivo, no lleva
  `role`/`tabindex` propio — es información, no una acción.
- **Mini gráfico de "Próximos pagos"** (sección 3.5): `role="img"` +
  `aria-label` describiendo el conjunto, con el dato accionable (próximo
  pago) siempre disponible como texto plano al lado — mismo criterio a11y
  que el resto de los gráficos hand-rolled del proyecto.
- **`AlertDialog` de borrado de plantilla**: mismo patrón exacto ya
  auditado en el resto de la app (foco atrapado, `Escape` cierra, foco
  vuelve al trigger al cerrar) — gratis por venir de Reka UI, sin trabajo
  adicional.
- **Copy del Sheet de "Marcar como pagado"** (sección 5): el `Alert` de
  advertencia usa el componente `Alert` ya existente (`role="alert"`
  implícito de Reka UI/shadcn), no un párrafo suelto — se anuncia a
  lectores de pantalla como el resto de alerts de la app.

---

## 10. Componentes shadcn-vue a reusar / instalar

**Nada nuevo que instalar.** Todos los componentes que necesita esta
feature ya están en `src/components/ui/` desde iteraciones anteriores:
`Card`, `Badge`, `Button`, `Input`, `Label`, `Select`, `Sheet`,
`AlertDialog`, `DropdownMenu`, `Separator`, `Skeleton`, `Alert`,
`Textarea`. Componentes de proyecto nuevos a crear:

- `src/views/FixedExpensesView.vue` (ruta `/gastos-fijos`).
- `src/components/FixedExpenseFormSheet.vue` (alta/edición de plantilla,
  sección 4).
- `src/components/MarkFixedExpensePaidSheet.vue` (marcar como pagado,
  sección 5).
- `src/components/FixedExpenseStatusBadge.vue` (badge de 4 estados,
  sección 6) — suficientemente chico y reusado en más de un lugar (la
  lista y, potencialmente, "Próximos pagos" si a futuro se expande) como
  para justificar su propio archivo en vez de inline.

`CategoryDonutChart.vue` se reusa **sin cambios** (sección 3.6). Ningún otro
componente de `src/components/charts/` se toca.

---

## 11. Qué NO se adopta de la referencia visual ("Finanzia")

Mismo criterio de exclusión ya documentado en `credit-cards-ux.md` sección
11/`debts-ux.md` sección 12 — se listan las omisiones explícitas de esta
feature:

- **Sidebar fija de escritorio**: la referencia navega con un sidebar
  persistente. TipApp sigue exclusivamente con el drawer `Sheet` lateral en
  todos los anchos de pantalla (sin excepción, ver nota "No asumir todavía"
  de `CLAUDE.md`).
- **Pantallas "Comparación mensual" y "Análisis y tendencias"**: diferidas
  por completo a una fase futura (sección 2.1), no una versión recortada.
- **"Persona responsable"**: fuera de alcance de v1 (decisión ya tomada por
  el Product Owner, sin equivalente de dominio claro).
- **"Recordatorio"**: fuera de alcance de v1 (decisión ya tomada, Web Push
  ya existe en el proyecto para Partidos en Vivo pero conectarlo acá es una
  decisión de producto nueva no tomada).
- **Marca/branding/nombre "Finanzia"**: se usa únicamente el contenido
  funcional descrito arriba, cero elementos visuales/copy de marca de la
  referencia.
- **Modal centrado para "Agregar gasto fijo"**: se usa el `Sheet` inferior
  ya establecido como único patrón de formulario de alta en TipApp, no un
  modal centrado como el de la referencia.

---

## 12. Checklist de implementación para `vue-frontend-expert`

- Store nuevo `src/stores/fixedExpenses.ts`: `templates` (plantillas
  activas + pausadas, sección 1.2), `instancesThisMonth`,
  `instancesLast6Months` (para promedio, sección 3.4, y delta del hero,
  sección 3.2) — mismo patrón de separación por propósito ya usado en
  `debtsStore`/`cardExpensesStore` (nunca una lista maestra sin límite de
  fecha para lo que crece sin límite).
- `fetchOrGenerateThisMonth()` (o el nombre que se acuerde con backend): el
  único punto de entrada que dispara la generación perezosa de instancias
  al montar la vista (sección 1.1).
- `payInstance(instanceId, { accountId, amount, date, notes })`: no
  optimista (sección 5.2), ajusta el saldo cacheado de la cuenta vinculada
  vía `accountsStore.adjustBalance` **después** de la confirmación del
  servidor (no antes, a diferencia del resto de mutaciones optimistas de
  cuentas) — mismo motivo de atomicidad ya explicado.
- `toggleActive(templateId)`: optimista simple (sección 7).
- `deleteTemplate(templateId)`: optimista con rollback, sin guard de conteo
  (sección 1.3).
- `HomeView.vue`: nuevo `import CalendarSync`, nuevo botón de drawer en
  posición 6 (sección 8), nuevo valor en el tipo `NavRouteName`.
- `src/router/index.ts`: ruta `/gastos-fijos` (`fixed-expenses`).
- Confirmar con `supabase-backend-expert` el nombre exacto de la
  función/RPC de "marcar como pagado" (sección 5.2) antes de tipar la
  llamada — este documento asume una función atómica del lado servidor,
  no dos inserts sueltos desde el cliente.

---

## 13. `/gastos-fijos/comparacion` — Comparación mensual (Fase 2, pantalla 2 del mockup)

Encargo de esta iteración: diseñar la pantalla 2 del mockup original
("Comparación mensual" — 3 columnas de mes lado a lado con sus gastos fijos y
un total al pie, más dos indicadores de variación mes a mes). La pantalla 3
("Análisis y tendencias") sigue diferida (sección 2.1), no está en el
alcance de esta sección.

Antes de diseñar el layout hubo que verificar el contrato real de datos
contra las migraciones (`supabase/migrations/2026072009*.sql`) y
`src/stores/fixedExpenses.ts`, porque el resto del documento fue escrito
sobre un contrato que "puede haber evolucionado levemente" — en la práctica
sí evolucionó en un punto no trivial (ver 13.3.1). Todo lo que sigue está
verificado contra el código real, no contra la sección 1 de este documento.

### 13.1 Decisión de navegación: un único pivote, no 3 navegaciones independientes

La descripción original ("cada columna con flechas `<` `>`") es ambigua entre
dos lecturas: (a) cada columna navega sola, o (b) hay un pivote único que
corre una ventana de 3 meses consecutivos. Se adopta **(b)**: **un solo par
de flechas `<`/`>`**, ubicado una única vez arriba de las 3 columnas (no
dentro de cada `Card`), que desplaza un `pivot: Date` (normalizado al día 1
del mes) un mes hacia atrás o hacia adelante. Las 3 columnas se re-derivan
siempre del pivote: `prev = pivot - 1 mes`, `pivot` (columna central),
`next = pivot + 1 mes`.

**Por qué se descarta (a)**: si "mes anterior"/"mes actual"/"mes siguiente"
pudieran navegar cada una por su cuenta, esas tres etiquetas dejarían de
significar lo que dicen apenas el usuario tocara una sola flecha de una sola
columna — "mes anterior" ya no sería necesariamente el mes anterior al de la
columna central, sino un mes arbitrario sin relación declarada con las otras
dos. Eso rompe el único valor real de esta pantalla (comparar 3 meses
consecutivos) y multiplica por 3 la superficie de estado a sincronizar sin
ninguna ganancia — nadie pidió comparar meses no consecutivos.

```html
<div class="flex items-center justify-center gap-2 px-4 py-3">
  <Button variant="outline" size="icon" aria-label="Mes anterior" @click="shiftPivot(-1)">
    <ChevronLeft class="size-5" />
  </Button>
  <p class="min-w-40 text-center text-sm font-medium tabular-nums">{{ pivotRangeLabel }}</p>
  <Button
    variant="outline"
    size="icon"
    aria-label="Mes siguiente"
    :disabled="isNextDisabled"
    @click="shiftPivot(1)"
  >
    <ChevronRight class="size-5" />
  </Button>
</div>
```

`shiftPivot(delta)`: `pivot.value = addMonths(pivot.value, delta)` (helper
nuevo, ver 13.10) → dispara el refetch de las 3 columnas (13.4).
`pivotRangeLabel`: texto plano siempre visible con el rango completo, ej.
`"junio – agosto 2026"` (reusa `currentMonthLabel` de `src/lib/date.ts` para
cada extremo pese a su nombre — el helper solo formatea un `Date` dado, no
asume que sea "hoy") — es el equivalente textual a11y de lo que las 3
`CardDescription` de las columnas ya muestran una por una, útil como resumen
rápido sin tener que leer las 3 cards.

**Aclaración importante para no confundir posición con dato real**: el
badge "Actual" (ver 13.6) se muestra en la columna cuya `period` coincide
con el mes calendario real de **hoy**, no en la columna central por
definición. La columna central sí conserva un tratamiento visual levemente
distinto (`border-primary/40`, ver 13.6) de forma constante — es el mes que
el usuario está "enfocando" con el pivote — pero eso es una señal de
posición/foco, distinta de la señal semántica "Actual" que solo aparece
cuando corresponde de verdad. Ejemplo concreto: si hoy es julio 2026 y el
usuario navega el pivote a agosto 2026, la columna central (agosto) tiene el
borde de foco pero **no** el badge "Actual" — ese badge aparece en la columna
izquierda (julio, el mes real de hoy). Mostrar "Actual" en una columna que
no es el mes de hoy sería literalmente falso.

### 13.2 Límite hacia adelante: se deshabilita `>` en cuanto el pivote llega al mes calendario real

Decisión: la flecha "siguiente" (`>`) se deshabilita (`:disabled`, no se
oculta — mismo criterio de siempre de dar feedback de límite alcanzado en
vez de un control que desaparece) en cuanto `pivot === mes calendario real
de hoy`. El pivote **nunca puede ser un mes estrictamente posterior a hoy**.

```ts
const isNextDisabled = computed(() => pivot.value.getTime() >= startOfCurrentMonth().getTime())
```

**Por qué deshabilitar y no permitir navegar con estado vacío explícito**:
se evaluaron ambas opciones. Permitir pivotear más allá de hoy generaría,
por diseño, una pantalla **siempre completamente vacía en sus 3 columnas**
apenas el pivote superara el mes real (recordar 13.3.1: la generación
perezosa solo crea instancias para "el período que hoy es el actual" — un
mes estrictamente futuro respecto de hoy jamás tiene ninguna instancia,
sin excepción, hasta que ese mes llegue de verdad) — sería un estado sin
ninguna utilidad posible para el usuario, a diferencia de los vacíos
legítimos de 13.3 (que sí pueden tener explicación útil, "no usaste la app
ese mes"). No hay ninguna razón de producto para dejar llegar a un estado
que se sabe de antemano 100% vacío e inútil; deshabilitar el límite es
software más honesto que dejar navegar a la nada.

**Corolario, no un bug**: incluso con la flecha deshabilitada en el límite,
la columna derecha ("siguiente") de la vista por defecto (pivote = mes
actual) **siempre** muestra el estado vacío de 13.3 — el mes calendario
inmediatamente después de hoy jamás tiene instancias todavía, por el mismo
motivo de arriba. Esto es esperado, no algo a "arreglar": es la naturaleza
de una generación pereziega que nunca adelanta trabajo a futuro. El estado
vacío de esa columna en particular puede reforzar este matiz con el mismo
copy genérico de 13.3 (no hace falta un copy especial "todavía no llegó este
mes" — sería sobre-especificar un caso que el copy genérico ya cubre bien).

### 13.3 Límite hacia atrás: sin tope duro, con estado vacío por columna

**No se limita la navegación hacia atrás** con ningún tope arbitrario — la
query de cada columna ya está acotada por un único período (un mes puntual),
mismo criterio de seguridad de datos de la sección 1.2 (nunca "traer todo
el historial", siempre acotado por rango/período) — no hay ningún riesgo de
escala en dejar navegar 12, 24 o 60 meses atrás. En cambio, el problema real
hacia atrás no es de performance sino de **datos que directamente no
existen** (13.3.1) — se resuelve con un estado vacío honesto por columna, no
con un límite de navegación.

#### 13.3.1 Confirmado en la función real: CUALQUIERA de las 3 columnas puede no tener datos, no solo "mes siguiente"

Se revisó `pay_fixed_expense_instance` (`supabase/migrations/
20260720090400_pay_fixed_expense_instance_function.sql`) para confirmar el
detalle que el encargo pedía chequear. El resultado matiza la premisa
original, documentado acá con precisión para que no quede ambigüedad:

- `pay_fixed_expense_instance(p_instance_id, ...)` recibe el **id de una
  instancia que ya tiene que existir** (`select ... from
  fixed_expense_instances fei ... where fei.id = p_instance_id`, `raise
  exception` si no la encuentra) — **no inserta una fila nueva en
  `fixed_expense_instances` bajo ningún escenario**, solo hace `update` de
  `status`/`expense_id`/`paid_at` sobre la fila ya existente. Es decir: pagar
  **no fuerza la creación** de una instancia para un período que todavía no
  tiene ninguna fila.
- Lo que sí es cierto (y es la parte real de la premisa original que vale la
  pena remarcar): la función **no filtra por `period`** en absoluto — puede
  operar sobre una instancia de cualquier mes, no solo del mes calendario en
  curso. Esto importa porque la única vía de creación de instancias sigue
  siendo, sin excepción, `ensure_current_fixed_expense_instances`
  (`20260720090300`), que **solo** crea filas para
  `date_trunc('month', now())` — el período que es HOY el actual, nunca uno
  pasado ni futuro. Una instancia de un mes que ya pasó existe únicamente si
  esa función corrió **mientras ese mes todavía era el actual** (es decir,
  el usuario entró a `/gastos-fijos` en algún momento de ese mes calendario)
  — pagarla después (incluso muchos meses más tarde) es válido porque
  `pay_fixed_expense_instance` no chequea el período, pero **no crea** la
  fila si nunca existió.

**Consecuencia para esta pantalla, confirmada y no solo hipotética**: un mes
pasado real puede tener **cero** instancias si el usuario nunca abrió la
sección ese mes calendario (nadie llamó a
`ensure_current_fixed_expense_instances` en esa ventana de tiempo) — sin
ninguna excepción que lo evite. Por lo tanto, **cualquiera de las 3
columnas** (mes anterior, mes central del pivote, o mes siguiente) puede
mostrar "sin datos" en la práctica: la columna "siguiente" siempre que sea
un mes estrictamente futuro (13.2), y la columna "anterior" (o incluso la
central, si el pivote está posicionado sobre un mes en el que el usuario no
usó la app) cuando el usuario simplemente no abrió TipApp ese mes.

#### 13.3.2 Estado vacío por columna (no por pantalla completa)

```html
<div v-if="column.state === 'empty'" class="flex flex-col items-center gap-2 px-4 py-8 text-center">
  <Inbox class="size-6 text-muted-foreground" />
  <p class="text-xs text-muted-foreground">Sin datos para este mes.</p>
</div>
```

Copy elegido, corto y sin culpar al usuario (no dice "no cargaste nada" ni
sugiere una acción que no tiene sentido acá — a diferencia del vacío total de
la sección 3.9, esta pantalla no tiene un CTA de alta propio: crear una
plantilla nueva no puede retroactivamente generar instancias de un mes que
ya pasó). Ícono `Inbox` (mismo ya usado en `RegisterView.vue` para su estado
de "revisá tu email", disponible y ya usado como el ícono genérico de "acá no
hay nada" del proyecto — no hace falta uno nuevo). El total al pie de una
columna vacía tampoco se muestra (o se muestra en `text-muted-foreground`
como `"—"` en vez de `$0`, mismo criterio de honestidad de datos que
`monthlyAverage`/`previousMonthTotal` de la sección 3.4: un `$0` sugeriría
"gastaste cero ese mes", cuando la realidad es "no hay dato", son cosas
distintas).

### 13.4 Composición de cada columna: instancias del período, NUNCA plantillas

**Punto central para que `vue-frontend-expert` no cometa el error de listar
plantillas**: cada columna de un mes con datos lista exactamente las filas
de `fixed_expense_instances` cuyo `period` es el de esa columna — **no**
`fixed_expenses` filtradas por alguna condición. La diferencia importa en
los dos sentidos:

- Una plantilla que hoy está **pausada** pero tuvo una instancia pagada o
  pendiente en el mes de una columna **debe aparecer** en esa columna —
  pausar no borra su historial, y esta pantalla es historial. Filtrar por
  `is_active` (como sí hace `fixed_expense_instances_current`, sección 3.7,
  correctamente para SU propósito de "acciones de este mes") sería el error
  concreto a evitar acá.
- Una plantilla creada **después** del mes de una columna lógicamente no
  tiene ninguna instancia para ese período — no aparece, y no hay que forzar
  que aparezca "en $0" ni de ninguna otra forma.

**Monto a mostrar por fila**: mismo criterio ya fijado en el store
(`FixedExpenseRow.amount`, sección de tipos de `fixedExpenses.ts`) y en
`fixed_expenses_summary.total_amount` (sección 3.2/backend) — el monto real
pagado (`expense.amount`) si `status = 'paid'`, si no el monto de la
plantilla (`fixed_expense.amount`). Se agrega, además, un indicador de texto
chico cuando la fila **no** está pagada (`status = 'pending'` — puede pasar
en un mes ya finalizado si el usuario simplemente nunca la marcó como
pagada, no hay ningún mecanismo que fuerce a cerrar un mes): el monto de esa
fila es una **proyección** de la plantilla, no lo que realmente se pagó, y
eso debe quedar claro sin que el usuario tenga que inferirlo.

```html
<div class="flex items-center gap-2 px-4 py-2">
  <p class="min-w-0 flex-1 truncate text-xs">{{ row.name }}</p>
  <div class="flex shrink-0 flex-col items-end">
    <p class="text-xs font-medium tabular-nums">${{ formatAmount(row.amount) }}</p>
    <p v-if="row.isPending" class="text-[10px] text-muted-foreground">Pendiente</p>
  </div>
</div>
```

**Query** (extiende el patrón ya usado por `fetchPreviousMonthTotal` en
`fixedExpenses.ts`, que ya hace exactamente este join acotado por `period`
para sumar un total — acá se generaliza para traer también el nombre, no
solo la suma):

```ts
async function fetchInstancesForPeriod(period: Date): Promise<FixedExpenseHistoryRow[] | null> {
  const periodValue = formatDateOnly(startOfMonth(period))
  const { data, error } = await supabase
    .from('fixed_expense_instances')
    .select('id, status, expense:expenses(amount), fixed_expense:fixed_expenses(name, amount)')
    .eq('period', periodValue)
    .limit(RANGE_SAFETY_LIMIT)

  if (error) return null

  return (data ?? []).map(row => ({
    instanceId: row.id,
    name: row.fixed_expense.name,
    amount: row.expense?.amount ?? row.fixed_expense.amount,
    isPending: row.status !== 'paid',
  }))
}
```

No hace falta un `?? 'fallback'` para `row.fixed_expense.name`: como
`fixed_expense_instances.fixed_expense_id` es `on delete cascade` hacia
`fixed_expenses` (`20260720090100`), una fila de instancia **nunca puede
sobrevivir** a que se borre su plantilla — si la plantilla se elimina, sus
instancias se eliminan con ella en la misma operación. El embed de
PostgREST siempre viene resuelto para una fila que todavía existe.

**Caveat real, para dejar anotado (no se resuelve en este encargo)**: esa
misma cascada implica que **borrar una plantilla (sección 1.3, sin guard de
conteo) hace desaparecer también su historial de esta pantalla en
particular** — los `expenses` reales generados al pagar siguen intactos en
Transacciones/Estadísticas (eso es lo que el copy del `AlertDialog` de
borrado promete y cumple, sección 1.3), pero la fila que los vinculaba a
"tal mes de tal gasto fijo" desaparece de `fixed_expense_instances`, así que
esta pantalla de Comparación mensual deja de poder mostrar esa fila
puntual para los meses ya pasados. No es un bug de esta spec ni algo a
arreglar acá — es una consecuencia directa y ya documentada (sección 1.3)
de la decisión de borrado sin guard; se deja anotado explícitamente para que
no sorprenda a nadie que compare "lo que muestra Comparación mensual" contra
"lo que muestra Transacciones" después de borrar una plantilla vieja.

También, por la misma razón de que la vista no versiona nada: el `name` y la
categoría de una fila histórica reflejan el estado **actual** de la
plantilla (si se renombró después de ese mes, la columna muestra el nombre
nuevo) — mismo comportamiento ya heredado de `fixed_expense_instances_current`
(sección 3.7), no una inconsistencia nueva de esta pantalla.

### 13.5 Punto de entrada: botón en el header de `/gastos-fijos`, sin ítem de drawer propio

Mismo criterio ya usado por `/tarjetas/gestionar` (acceso desde
`CardsDashboardView`) y `/deudas/personas` (acceso desde `DebtsDashboardView`
+ el atajo del Sheet de alta): esta es una pantalla secundaria de una
feature que ya tiene su propio ítem de drawer (sección 8, "Gastos fijos",
posición 6) — no amerita un segundo ítem de drawer para una vista derivada
del mismo dominio. Se llega desde un botón ícono en el header de
`FixedExpensesView.vue` (sección 3, snippet ya actualizado arriba con
`Columns3`), simétrico al botón `Settings` que ya usa `DebtsDashboardView`
para llegar a `/deudas/personas`.

**Ícono**: `Columns3` (confirmado en
`node_modules/@lucide/vue/dist/esm/icons/columns-3.mjs`, nada que instalar).
Se prefiere sobre alternativas como `CalendarRange` o `ArrowLeftRight`
porque **describe literalmente el contenido de la pantalla que abre** (3
columnas lado a lado) en vez de solo "algo relacionado con fechas/comparar en
abstracto" — mismo criterio ya usado para elegir `CalendarSync` en la
sección 8 (el ícono más cercano al concepto real, no el más genérico
disponible).

`aria-label="Comparación mensual"` en el botón (sin texto visible, mismo
patrón que el resto de botones-ícono de header de la app) es suficiente
—no hace falta un tooltip nuevo, ningún otro botón-ícono de header del
proyecto lo tiene.

### 13.6 Layout completo de `/gastos-fijos/comparacion`

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'fixed-expenses' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="text-xl font-semibold">Comparación mensual</h1>
</header>

<main class="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
  <!-- Control de pivote, sección 13.1 -->
  <div class="flex items-center justify-center gap-2">
    <Button variant="outline" size="icon" aria-label="Mes anterior" @click="shiftPivot(-1)">
      <ChevronLeft class="size-5" />
    </Button>
    <p class="min-w-40 text-center text-sm font-medium tabular-nums">{{ pivotRangeLabel }}</p>
    <Button variant="outline" size="icon" aria-label="Mes siguiente" :disabled="isNextDisabled" @click="shiftPivot(1)">
      <ChevronRight class="size-5" />
    </Button>
  </div>

  <!-- 3 columnas, scroll horizontal con snap en mobile, grid fijo desde sm: -->
  <div class="grid auto-cols-[85%] grid-flow-col gap-3 overflow-x-auto snap-x snap-mandatory pb-2 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-3 sm:overflow-visible sm:pb-0">
    <Card
      v-for="column in monthColumns"
      :key="column.periodKey"
      class="shrink-0 snap-center"
      :class="column.isPivot ? 'border-primary/40' : ''"
    >
      <CardHeader class="pb-2">
        <div class="flex items-center justify-between gap-2">
          <CardDescription class="truncate capitalize">{{ column.monthLabel }}</CardDescription>
          <Badge v-if="column.isRealCurrentMonth" variant="outline" class="shrink-0 text-[10px] text-primary border-primary/50">
            Actual
          </Badge>
        </div>
      </CardHeader>

      <div v-if="column.state === 'loading'" class="flex flex-col gap-2 px-4 pb-4">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-4/5" />
        <Skeleton class="h-4 w-3/5" />
      </div>

      <div v-else-if="column.state === 'empty'" class="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <Inbox class="size-6 text-muted-foreground" />
        <p class="text-xs text-muted-foreground">Sin datos para este mes.</p>
      </div>

      <template v-else>
        <div class="flex flex-col">
          <template v-for="(row, idx) in column.rows" :key="row.instanceId">
            <Separator v-if="idx > 0" />
            <div class="flex items-center gap-2 px-4 py-2">
              <p class="min-w-0 flex-1 truncate text-xs">{{ row.name }}</p>
              <div class="flex shrink-0 flex-col items-end">
                <p class="text-xs font-medium tabular-nums">${{ formatAmount(row.amount) }}</p>
                <p v-if="row.isPending" class="text-[10px] text-muted-foreground">Pendiente</p>
              </div>
            </div>
          </template>
        </div>
        <Separator />
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-xs font-medium text-muted-foreground">Total</p>
          <p class="text-sm font-semibold tabular-nums">${{ formatAmount(column.total) }}</p>
        </div>
      </template>
    </Card>
  </div>

  <!-- Indicadores de variación, sección 13.6.1 -->
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Card v-for="v in variationIndicators" :key="v.id">
      <CardHeader class="pb-2">
        <CardDescription>{{ v.label }}</CardDescription>
      </CardHeader>
      <div class="px-6 pb-4">
        <div
          v-if="v.direction !== null"
          class="flex items-center gap-1.5"
          :class="{
            'text-destructive': v.direction === 'up',
            'text-success': v.direction === 'down',
            'text-muted-foreground': v.direction === 'flat',
          }"
        >
          <component
            :is="v.direction === 'up' ? ArrowUp : v.direction === 'down' ? ArrowDown : Minus"
            class="size-4 shrink-0"
          />
          <p class="text-sm font-medium tabular-nums">
            <span v-if="v.percent !== null">{{ v.percent }}% · </span>
            <span>{{ v.direction === 'up' ? '+' : v.direction === 'down' ? '-' : '' }}${{ formatAmount(Math.abs(v.amountDelta)) }}</span>
          </p>
        </div>
        <p v-else class="text-xs text-muted-foreground">No hay datos suficientes para comparar.</p>
      </div>
    </Card>
  </div>
</main>
```

Grid de columnas: **scroll horizontal con snap en mobile** (`auto-cols-[85%]
grid-flow-col ... overflow-x-auto snap-x`, cada columna al 85% del ancho
visible para insinuar que hay una vecina de cada lado sin que el usuario
tenga que adivinarlo) que pasa a **grid fijo de 3 columnas** desde `sm:`
(`sm:grid-cols-3 sm:overflow-visible`) — a 360px de ancho, mostrar 3 cards
completas simultáneamente con contenido legible no entra; a partir de `sm:`
(640px) sí. Es la misma filosofía mobile-first que ya usa el resto de la
app (adaptar la densidad de información al ancho real, no comprometer
legibilidad en el caso más chico) aplicada por primera vez a un scroll
horizontal con `snap` (no había precedente en el proyecto de scroll
horizontal de cards; se documenta acá como primer uso).

### 13.6.1 Los "dos indicadores de variación": qué compara cada uno

El encargo pide "dos indicadores de variación mes vs. mes anterior" sin
nombrar explícitamente qué par de meses compara cada uno — con exactamente
3 columnas visibles, la lectura natural (y la que se adopta) es **una
variación por cada par de columnas consecutivas**:

1. `"Mes actual vs. anterior"` → compara `prev.total` (mes izquierdo) contra
   `pivot.total` (mes central).
2. `"Mes siguiente vs. actual"` → compara `pivot.total` (mes central) contra
   `next.total` (mes derecho).

Mismo criterio semántico ya establecido en toda la app (nunca color solo):
gastar más = `destructive` + `ArrowUp`, gastar menos = `success` +
`ArrowDown`, **sin cambio** (`amountDelta === 0`) = `muted-foreground` +
`Minus` (ni bueno ni malo, se agrega este tercer caso porque un delta de
$0 coloreado como "mala noticia" o silenciado sin más sería engañoso en
cualquier de las dos direcciones). Si cualquiera de los dos lados de la
comparación no tiene datos (columna en estado `empty`, sección 13.3),
`direction = null` y se muestra el texto "No hay datos suficientes para
comparar" en vez de inventar una variación con un `0` de por medio — mismo
principio de honestidad de datos que `monthDelta` de la sección 3.2 y
`monthlyAverage` de la sección 3.4.

**Corolario esperado, no un defecto**: en la vista por defecto (pivote =
mes actual real), el indicador 2 ("Mes siguiente vs. actual") **va a
mostrar casi siempre "sin datos suficientes"**, porque la columna "mes
siguiente" en esa posición es, por 13.2, un mes estrictamente futuro que
nunca tiene instancias todavía. Esto deja de pasar en cuanto el usuario
navega el pivote hacia atrás (ahí "mes siguiente" pasa a ser un mes ya
transcurrido, que si tuvo uso de la app sí tiene datos) — es información
correcta reflejando el estado real, no algo a parchear.

```ts
interface Variation {
  direction: 'up' | 'down' | 'flat' | null
  percent: number | null
  amountDelta: number
}

function buildVariation(fromTotal: number | null, toTotal: number | null): Variation {
  if (fromTotal === null || toTotal === null) {
    return { direction: null, percent: null, amountDelta: 0 }
  }
  const amountDelta = toTotal - fromTotal
  if (amountDelta === 0) return { direction: 'flat', percent: 0, amountDelta: 0 }
  const percent = fromTotal > 0 ? Math.round((Math.abs(amountDelta) / fromTotal) * 1000) / 10 : null
  return { direction: amountDelta > 0 ? 'up' : 'down', percent, amountDelta }
}
```

`percent = null` cuando `fromTotal === 0` (división por cero evitada) — en
ese caso el badge solo muestra el monto (`+$X`/`-$X`), sin porcentaje; un
`0` real de mes anterior con algo nuevo el mes siguiente es, matemáticamente,
un incremento infinito/indefinido, no un número honesto de mostrar.

### 13.7 Estados de carga/vacío/error de la pantalla completa

- **Carga inicial**: cada columna entra en su propio `state = 'loading'`
  (13.6) de forma independiente — las 3 queries de columna se disparan en
  paralelo (`Promise.all`), no hace falta esperar a que las 3 resuelvan para
  pintar cada `Skeleton` individualmente (misma filosofía que el resto de la
  app: no bloquear una card por otra que tarda más).
- **Error** (alguna de las 3 queries de columna falla): la columna afectada
  muestra el mismo bloque `AlertCircle` + "No pudimos cargar este mes" +
  `Reintentar` ya usado en el resto de la app, **por columna**, no una
  pantalla de error completa — las otras 2 columnas que sí cargaron bien
  siguen mostrando su contenido normalmente, mismo criterio de granularidad
  que el estado vacío (13.3.2) en vez de tratar la pantalla como una unidad
  atómica de éxito/fracaso.
- **Vacío por columna**: sección 13.3.2 — el caso ya cubierto en detalle
  arriba, no hay un "vacío total de pantalla" distinto para esta vista (a
  diferencia del dashboard de la sección 3.9): siempre se ven los 3
  controles (flechas, 3 `Card` con su propio estado) incluso si las 3
  columnas están vacías a la vez (caso límite real: un usuario nuevo que
  recién creó su primera plantilla este mes va a ver "anterior" y
  "siguiente" vacíos, y "actual" con datos — la pantalla sigue siendo
  perfectamente legible en ese estado, no hace falta un mensaje especial de
  "no tenés suficiente historial todavía").
- Los indicadores de variación (13.6.1) no tienen un estado de carga propio
  separado: se derivan 100% en cliente de `column.total` de las 3 columnas
  ya cargadas (`buildVariation`), así que aparecen (o muestran "sin datos
  suficientes") en cuanto las columnas relevantes terminan de resolver.

### 13.8 Accesibilidad

- **Botones de pivote** (`<`/`>`): `aria-label` explícito ("Mes anterior"/
  "Mes siguiente"), `:disabled` real en el límite hacia adelante (13.2) —
  nunca solo `opacity` visual sin el atributo, para que un lector de
  pantalla anuncie el estado deshabilitado correctamente. `min-h-11`/
  `size-11` ya viene del componente `Button` `size="icon"` (sección de
  a11y global, ya cubierto de fábrica).
- **`pivotRangeLabel`**: al ser texto plano dentro de un elemento no
  interactivo, cualquier cambio de pivote lo actualiza de forma normal para
  un lector de pantalla que vuelva a leer la región (no hace falta
  `aria-live` — no es una notificación urgente, es contenido de navegación
  normal, mismo criterio que el resto de labels de la app que cambian con
  interacción del usuario).
- **Scroll horizontal con snap** (13.6): el contenedor de columnas es
  navegable con teclado (`overflow-x-auto` en un `div` sin `tabindex`
  adicional necesario porque el contenido interactivo real de cada columna
  ya es tabulable en orden — no hay controles propios del scroll que
  necesiten foco). En `sm:` y superior no hay scroll (grid fijo), sin
  ninguna consideración extra.
- **Indicadores de variación** (13.6.1): mismo criterio ya aplicado en toda
  la app, ícono + texto siempre juntos, nunca solo el color de la
  flecha/texto — confirmado en el snippet de 13.6 (`ArrowUp`/`ArrowDown`/
  `Minus` + texto de porcentaje/monto en todos los casos).
- **Filas de gasto fijo por columna** (13.4): sin ningún elemento
  interactivo (a diferencia de la lista de la sección 3.7, esta pantalla es
  de solo lectura) — no necesitan `role`/`tabindex` propios.
- **Botón de entrada** (`Columns3` en el header de `/gastos-fijos`, sección
  13.5): `aria-label="Comparación mensual"`, mismo patrón que el resto de
  botones-ícono de header ya auditados.

### 13.9 Componentes shadcn-vue a reusar / instalar

**Nada nuevo que instalar** (mismo inventario que el resto de la feature,
sección 10): `Card`, `Badge`, `Button`, `Skeleton`, `Separator`. Componente
de proyecto nuevo:

- `src/views/FixedExpensesComparisonView.vue` (ruta
  `/gastos-fijos/comparacion`, sección 2/13.5).

No hace falta ningún componente nuevo de `src/components/` — a diferencia
del dashboard principal, esta pantalla no reusa `CategoryDonutChart` (el
mockup de esta pantalla en particular no incluye una dona, esa es la
pantalla 3 diferida) ni necesita un badge de estado propio (13.4 usa un
simple `<p>` condicional "Pendiente", no amerita un componente dedicado
como `FixedExpenseStatusBadge` que sí tiene 4 estados y 2 consumidores
potenciales).

### 13.10 Checklist de implementación para `vue-frontend-expert`

- `src/router/index.ts`: ruta nueva `/gastos-fijos/comparacion`
  (`fixed-expenses-comparison`), declarada junto a `/gastos-fijos` (sección
  2 — no hay ningún segmento dinámico en este nivel con el que pueda
  colisionar el orden).
- `src/views/FixedExpensesView.vue`: agregar el botón `Columns3` al header
  (13.5, snippet en sección 3 ya actualizado) — único cambio a esta vista
  en este encargo.
- `src/views/FixedExpensesComparisonView.vue` (nuevo): layout completo de
  13.6.
- `src/stores/fixedExpenses.ts`: agregar `fetchInstancesForPeriod(period:
  Date): Promise<FixedExpenseHistoryRow[] | null>` (13.4) — **no** reusar
  `templates`/`currentInstances` existentes para esta pantalla, son listas
  con propósito distinto (plantillas activas / instancias del mes actual
  únicamente). `null` en el retorno = error de red (la vista lo distingue
  de `[]` = éxito con cero filas, mismo patrón discriminante ya usado en
  otros stores del proyecto, ej. `searchMatches`/`addMatch` de
  `liveMatches.ts`).
- Helper nuevo de fecha (`src/lib/date.ts` o inline en la vista):
  `addMonths(date, delta)`/`startOfMonth(date)` — no existen todavía en
  `date.ts`, confirmarlos antes de asumir que ya están.
- Lógica de pivote y las 3 columnas (`monthColumns` computed, `shiftPivot`,
  `isNextDisabled`) vive en `FixedExpensesComparisonView.vue` — no hace
  falta subirla al store, es estado 100% de esta pantalla (mismo criterio
  ya aplicado a otros estados de UI puramente locales del proyecto, ej. el
  `requestId` de descarte de respuestas obsoletas en `MatchFormSheet.vue`).
- `variationIndicators`/`buildVariation` (13.6.1): función pura, puede vivir
  en la propia vista o en `src/lib/charts.ts` junto a otras derivaciones
  (`buildDonutSlices`, `buildDebtBalanceEvolution`) si se prefiere
  centralizar — sin acoplarla al store, no depende de estado reactivo
  propio.
- Confirmar que `Inbox`/`Columns3`/`ChevronLeft`/`ChevronRight`/`Minus` están
  disponibles en `@lucide/vue` (ya verificado en esta sesión de diseño,
  confirmar igual al implementar por si la versión instalada cambió).
