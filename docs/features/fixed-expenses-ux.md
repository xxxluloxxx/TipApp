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

Sin colisión de segmentos, no requiere ningún orden especial en el array de
rutas.

### 2.1 Pantallas 2 y 3 del mockup ("Comparación mensual", "Análisis y tendencias") — diferidas a Fase 2, no recortadas ahora

Se evaluó incluir una versión recortada de alguna de las dos en v1 y se
descarta, con el mismo criterio de fases ya usado dos veces en el proyecto
(Cuentas Fase 1 → Deudas Fase 2 completando el mismo dominio; Tarjetas
completo de una vez porque su alcance era chico desde el principio). Acá el
foco explícito del encargo es "el dashboard: resumen del mes, lista con
estado, marcar pagado, alta" — meter una versión mini de "Comparación
mensual" (3 columnas de mes) o "Análisis y tendencias" (barras+dona+top+
insights) en esta misma iteración diluiría ese foco sin que el Product
Owner lo haya pedido. Además, **una vez que exista más de 1-2 meses de
historial real** (cosa que hoy no existe, es una feature nueva) esas dos
pantallas se vuelven mucho más fáciles de diseñar bien, con datos reales
para calibrar qué información es genuinamente útil vs. ruido — diseñarlas
ahora, sin ningún historial para probarlas, sería adivinar.

**Candidata de nombre para cuando se aborde esa fase**: `/gastos-fijos/
analisis` (ruta 2 de 2), mismo patrón de "dashboard + análisis" que otras
features. No se reserva ningún hueco en el código de esta iteración para
eso — se diseña cuando se encargue, no antes.

---

## 3. `/gastos-fijos` — Dashboard

Header igual al patrón ya establecido:

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="text-xl font-semibold">Gastos fijos</h1>
</header>
```

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
