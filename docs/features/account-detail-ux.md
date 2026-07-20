# TipApp — UX de Detalle de Cuenta (`AccountDetailView`)

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, Sheet inferior, a11y, **sección 6 "Header + navegación"** —
`AppHeader.vue`/`NavigationDrawer.vue` como único patrón, regla dura de "no
botón Volver"), `docs/features/accounts-income-ux.md` (paleta
`ACCOUNT_COLOR_SWATCHES`, estructura de `AccountFormSheet.vue`, estrategia de
datos de `account_balances`, `accountsStore`) y `docs/features/debts-ux.md`
sección 1.4 (precedente directo del algoritmo de "saldo de arranque sin sumar
historial completo", reusado acá con adaptaciones — ver sección 6).
`docs/features/account-transfers-ux.md` sección 6.4 aporta los estilos ya
resueltos de fila `transfer-out`/`transfer-in` que esta vista reutiliza tal
cual. No se repite esa justificación acá, solo se referencia.

**Este documento reemplaza puntualmente una decisión de
`accounts-income-ux.md`**: su sección 2.3 decía *"Tiles de cuenta NO son
clickeables a un detalle [...] no se construye un `AccountDetailView` [...]
Candidata natural para una futura sesión si el Product Owner lo pide"*. Esta
sesión es esa futura sesión — el Product Owner pidió explícitamente
`AccountDetailView`, inspirado en 2 capturas descriptas de otra app
("Wallet"). Esta sección de `accounts-income-ux.md` (y las notas equivalentes
en `debts-ux.md` sección 2 y `fixed-expenses-ux.md` sección 2.3, que la citan
como precedente de "por qué Cuentas no necesita ruta de detalle") queda
**desactualizada por este documento**, no se reescribe línea por línea en
esos archivos históricos.

Contexto de modelo de datos (confirmado contra el esquema real, no
ilustrativo): `accounts(id, user_id, name, color, icon, initial_balance,
transfer_commission, created_at, updated_at)` — **sin ninguna columna de
"tipo de cuenta"**. Vista `account_balances(account_id, user_id, name,
balance)` ya resuelve el saldo all-time server-side. `expenses.account_id`,
`incomes.account_id`, `account_transfers.from_account_id`/`to_account_id`
son los tres orígenes de movimiento de una cuenta.

---

## 1. Ruta y puntos de entrada

### 1.1 Ruta nueva `/cuentas/:id`

```ts
{ path: '/cuentas/:id', name: 'account-detail', component: () => import('@/views/AccountDetailView.vue'), meta: { requiresAuth: true } },
```

Sin colisión de segmento literal-vs-dinámico (`/cuentas` ya es la única ruta
literal bajo ese prefijo, sección 6.1 de `accounts-income-ux.md`) — no hace
falta ningún orden especial de declaración en el array de rutas, mismo
criterio que `/transferencias` (`account-transfers-ux.md` sección 2.2).

### 1.2 Entrada desde `HomeView.vue` — "Mis cuentas" deja de ser de solo lectura

`accounts-income-ux.md` sección 2.3 decidió que las tiles de "Mis cuentas"
fueran `disabled`/`aria-disabled="true"` porque no había ningún destino. Con
`AccountDetailView` ya existiendo, esa razón desaparece — se revierte
puntualmente:

```html
<!-- Antes (src/views/HomeView.vue, línea ~371) -->
<button
  v-for="account in topAccounts"
  :key="account.id"
  type="button"
  class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
  disabled
  aria-disabled="true"
>

<!-- Después -->
<button
  v-for="account in topAccounts"
  :key="account.id"
  type="button"
  class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
  @click="router.push({ name: 'account-detail', params: { id: account.id } })"
>
```

Se quita `disabled`/`aria-disabled` (la tile vuelve a ser un botón real,
enfocable y anunciado como tal por lectores de pantalla) y se agrega la
navegación. Nada más de la tile cambia (mismo layout, mismo contenido).

### 1.3 Entrada desde `AccountsView.vue` (`/cuentas`) — fila navega, menú no

Hoy cada fila es un `<div>` estático que solo contiene, al final, un
`DropdownMenu` de "Editar"/"Eliminar" (`src/views/AccountsView.vue`, líneas
170-239) — no hay ningún manejador de click en la fila misma. Se agrega
navegación a la fila **completa** (mismo patrón ya usado por `cardsRanking`
de `credit-cards-ux.md` y la lista de hilos de `debts-ux.md` sección 3.5: fila
clickeable, sin menú `⋮` competitivo — salvo que acá **sí** hay un menú
`⋮` en la misma fila, porque `/cuentas` es explícitamente la pantalla de
*gestión* de cuentas, no un panorama de solo lectura).

**Solución al doble-disparo fila-vs-menú**: el criterio estándar de la
plataforma — el botón que abre el `DropdownMenu` corta la propagación del
evento de click antes de que llegue al contenedor de la fila, para que abrir
el menú nunca dispare también la navegación:

```html
<!-- src/views/AccountsView.vue -->
<div
  class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent"
  :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
  role="button"
  tabindex="0"
  :aria-label="`Ver detalle de ${account.name}`"
  @click="router.push({ name: 'account-detail', params: { id: account.id } })"
  @keydown.enter="router.push({ name: 'account-detail', params: { id: account.id } })"
>
  <!-- ...ícono + nombre + saldo sin cambios... -->

  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        :aria-label="`Opciones de ${account.name}`"
        @click.stop
      >
        <EllipsisVertical class="size-5" />
      </Button>
    </DropdownMenuTrigger>
    <!-- ...contenido del menú sin cambios... -->
  </DropdownMenu>
</div>
```

- **`@click.stop` en el `DropdownMenuTrigger`** (no en el `DropdownMenu`
  raíz ni en el `DropdownMenuContent`): el modificador de Vue detiene la
  propagación del evento nativo de click en el punto exacto donde nace —
  el botón que el usuario realmente tocó — antes de que burbujee hasta el
  `@click` del contenedor de la fila. El menú se abre normalmente (Reka UI
  maneja el toggle en su propio handler, que corre antes de que el evento
  siga subiendo), la fila nunca se entera de ese click.
- El `AlertDialog`/`DropdownMenuContent` se renderizan en un
  [Portal](https://www.radix-vue.com/) fuera del árbol DOM de la fila (mismo
  mecanismo que ya usa Reka UI para el resto de los `DropdownMenu` del
  proyecto) — los clicks dentro de "Editar"/"Eliminar"/el `AlertDialog` de
  confirmación **nunca llegan** al listener de la fila en absoluto, no
  hace falta ningún `.stop` adicional ahí.
- `role="button"`/`tabindex="0"`/`@keydown.enter` en el contenedor: como
  deja de ser un elemento puramente decorativo (ahora navega), necesita
  ser accesible por teclado igual que cualquier otro control interactivo
  del proyecto — mismo criterio de a11y de siempre (foco visible ya lo
  hereda de `hover:bg-accent` + el estilo de foco global de botones, pero
  se agrega explícitamente si `vue-frontend-expert` nota que el `<div>` no
  hereda el anillo de foco de un `<button>` real, puede envolver el
  contenido en un `<button type="button" class="w-full text-left">` en
  vez de un `<div role="button">` — cualquiera de las dos formas es
  aceptable, la semántica es lo que importa, no la etiqueta exacta).

---

## 2. El subtítulo de "tipo de cuenta" — decisión: se omite por completo

La referencia visual de la app "Wallet" muestra un subtítulo de tipo
("Efectivo", "Banco", etc.) debajo del nombre de la cuenta en el header.
**El modelo de `accounts` no tiene ningún campo de tipo** (confirmado arriba)
— inventar uno implicaría una migración de backend no pedida, o inferir un
"tipo" a partir del `icon` elegido (`Wallet`/`PiggyBank`/`Landmark`/
`Building2`/`ShieldCheck`/`Banknote`, sección 5 de `accounts-income-ux.md`),
lo cual es frágil: el ícono es una elección puramente estética del usuario
(nada impide elegir `Landmark` para una cuenta de efectivo), tratarlo como
si fuera un dato semántico de clasificación real sería inventar significado
donde no lo hay.

**Decisión: se omite la línea de subtítulo.** El header queda con
ícono + nombre únicamente (sección 3). Es la opción más simple de las
sugeridas por el encargo, y la correcta: no hay ningún dato real que
mostrar ahí sin inventarlo, y agregar un subtítulo falso ("Cuenta") en
las 100% de las tiles no aportaría información — es preferible que el
espacio quede simplemente sin usar antes que rellenarlo con un dato vacío
de contenido.

---

## 3. Header

```html
<AppHeader>
  <template #default>
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg"
        :style="{ backgroundColor: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
      >
        <component
          :is="resolveAccountIcon(account.icon)"
          class="size-5"
          :style="{ color: readableTextColor(resolveAccountColor(account.color ?? '#6b7280', isDarkNow)) }"
        />
      </span>
      <h1 class="truncate text-xl font-semibold">{{ account.name }}</h1>
    </div>
  </template>

  <template #actions>
    <Button variant="ghost" size="icon" aria-label="Editar cuenta" @click="openEditSheet">
      <Pencil class="size-5" />
    </Button>
  </template>
</AppHeader>
```

- Se usa el **slot por defecto** de `AppHeader` (no el prop `title`) porque
  el título de esta pantalla no es texto plano — lleva el ícono/color de la
  cuenta al lado del nombre, mismo criterio documentado en
  `design-system.md` sección 6 ("Para un título custom [...] usar el slot
  por defecto"). El botón de menú (`NavigationDrawer`) sigue siendo el
  primer elemento del header, gratis, sin que este documento lo repita.
- **Sin botón "Volver"** — regla dura del proyecto, la única forma de salir
  de esta pantalla es el drawer.
- `openEditSheet` abre `AccountFormSheet.vue` **sin ningún cambio** en ese
  componente, pasándole `:account="account"` — es exactamente el mismo
  Sheet que ya usa `AccountsView.vue` en modo edición, reusado tal cual
  (mismo componente, mismo store `accountsStore.updateAccount`).

---

## 4. "HOY" + saldo actual + ajuste

```html
<Card>
  <div class="flex flex-col gap-1 px-6 py-5">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hoy</p>
    <div class="flex items-center gap-2">
      <p
        class="text-3xl font-bold tabular-nums tracking-tight"
        :class="currentBalance < 0 ? 'text-destructive' : 'text-foreground'"
      >
        {{ currentBalance < 0 ? '-' : '' }}${{ formatAmount(Math.abs(currentBalance)) }}
      </p>
      <Button variant="ghost" size="icon" aria-label="Ajustar saldo" @click="isAdjustSheetOpen = true">
        <Pencil class="size-4 text-muted-foreground" />
      </Button>
    </div>
  </div>
</Card>
```

`currentBalance = accountsStore.balanceFor(accountId)` — mismo computed ya
usado por `AccountsView.vue`/`HomeView.vue`, nunca recalculado a mano en
esta vista (sección 1.2 de `accounts-income-ux.md`, no se reabre acá).

---

## 5. Ajuste de saldo — `AccountBalanceAdjustmentSheet.vue` (componente nuevo)

### 5.1 Por qué un `Sheet` con `radiogroup`, no un `Dialog` nuevo ni una segunda pantalla

La referencia visual describe un "modal con 2 opciones". Se resuelve con el
**mismo vocabulario ya establecido del proyecto** (`Sheet` inferior +
`radiogroup` de 2 botones planos) en vez de instalar un componente `Dialog`
nuevo — el proyecto no tiene `Dialog` instalado hoy (`ls
src/components/ui/`: solo `alert-dialog`, `sheet`, no `dialog`), y las dos
opciones no son "paneles de contenido" independientes en el sentido de
`Tabs` (sección 3.4 de `debts-ux.md`): comparten exactamente **el mismo
campo** ("¿cuál es el saldo correcto hoy?"), solo difieren en **qué pasa al
guardar** y en el texto de ayuda que se muestra debajo. Es, por
definición, el caso de uso que el proyecto ya resolvió con `radiogroup`
(el toggle Gasto/Ingreso de `TransactionFormSheet.vue`, "Dirección" en
`DebtFormSheet.vue`): un valor de formulario mutuamente excluyente, resuelto
recién al enviar — no dos vistas de contenido que coexisten.

### 5.2 Campos y layout

```html
<Sheet :open="isOpen" @update:open="handleOpenChange">
  <SheetContent side="bottom">
    <SheetHeader>
      <SheetTitle>Ajustar saldo</SheetTitle>
      <SheetDescription>
        Saldo actual: <span class="font-medium text-foreground">${{ formatAmount(currentBalance) }}</span>
      </SheetDescription>
    </SheetHeader>

    <form id="balance-adjustment-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="onSubmit">
      <!-- 1. Tipo de ajuste -->
      <div class="flex flex-col gap-1.5">
        <Label id="tipo-ajuste-label">¿Cómo querés ajustarlo?</Label>
        <div role="radiogroup" aria-labelledby="tipo-ajuste-label" class="flex flex-col gap-2">
          <button
            type="button"
            role="radio"
            :aria-checked="form.mode === 'record'"
            class="flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            :class="form.mode === 'record' ? 'border-primary bg-primary/5' : 'border-border'"
            :disabled="isSaving"
            @click="form.mode = 'record'"
          >
            <span class="text-sm font-medium">Ajustar mediante registro</span>
            <span class="text-xs text-muted-foreground">
              Creamos un gasto o ingreso por la diferencia, fechado hoy. Se guarda en tu historial.
            </span>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="form.mode === 'initial'"
            class="flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            :class="form.mode === 'initial' ? 'border-primary bg-primary/5' : 'border-border'"
            :disabled="isSaving"
            @click="form.mode = 'initial'"
          >
            <span class="text-sm font-medium">Cambiar saldo inicial</span>
            <span class="text-xs text-muted-foreground">
              Corregimos el saldo inicial de la cuenta. No se crea ningún movimiento nuevo.
            </span>
          </button>
        </div>
      </div>

      <!-- 2. Nuevo saldo -->
      <div class="flex flex-col gap-1.5">
        <Label for="nuevo-saldo">Saldo deseado</Label>
        <div class="flex items-center gap-1.5">
          <span class="text-sm text-muted-foreground">$</span>
          <Input
            id="nuevo-saldo"
            ref="desiredBalanceInputRef"
            v-model="form.desiredBalance"
            inputmode="decimal"
            type="text"
            placeholder="0"
            class="text-lg font-semibold tabular-nums"
            :disabled="isSaving"
            :aria-invalid="!!errors.desiredBalance"
          />
        </div>
        <p v-if="errors.desiredBalance" class="text-xs text-destructive">{{ errors.desiredBalance }}</p>
        <p v-else-if="diff !== null" class="text-xs" :class="diffTextClass">
          {{ diffLabel }}
        </p>
      </div>
    </form>

    <SheetFooter>
      <Button type="submit" form="balance-adjustment-form" class="w-full" :disabled="isSaving || diff === 0">
        <Loader2 v-if="isSaving" class="size-4 animate-spin" />
        {{ isSaving ? 'Guardando…' : 'Guardar ajuste' }}
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

- **Default de `form.mode`**: `'record'` ("Ajustar mediante registro") — es
  la opción que preserva historial, la esperable como default en una app
  que en toda otra pantalla prioriza no perder trazabilidad (mismo espíritu
  que "el vínculo a cuenta de una deuda deja rastro visible", `debts-ux.md`
  sección 6.2).
- **`form.desiredBalance` precargado con el saldo actual** al abrir el
  Sheet (no vacío) — el usuario típicamente solo necesita corregir un
  dígito, no reescribir el número completo desde cero.
- **Admite negativo** (`/^-?\d+(?:\.\d+)?$/`, mismo regex que "Saldo
  inicial" de `AccountFormSheet.vue`) — una cuenta puede legítimamente
  tener saldo negativo (descubierto), el saldo deseado también debe poder
  serlo.
- **`diffLabel`/`diffTextClass`** (helper de vista previa, se recalcula en
  cada tecleo):

```ts
const diff = computed<number | null>(() => {
  const desired = parseSignedAmount(form.desiredBalance) // null si inválido
  if (desired === null) return null
  return roundCurrency(desired - currentBalance.value)
})

const diffLabel = computed(() => {
  if (diff.value === null) return ''
  if (diff.value === 0) return 'Este ya es el saldo actual — no hay nada para ajustar.'
  const sign = diff.value > 0 ? '+' : '-'
  return `Diferencia: ${sign}$${formatAmount(Math.abs(diff.value))}`
})

const diffTextClass = computed(() => {
  if (diff.value === null || diff.value === 0) return 'text-muted-foreground'
  return diff.value > 0 ? 'text-success' : 'text-destructive'
})
```

### 5.3 Fórmulas exactas de guardado

**Ambas opciones reusan mutaciones ya existentes y ya optimistas** — no
hace falta ninguna RPC nueva ni ningún endpoint atómico, a diferencia de
Deudas/Transferencias (que sí necesitaron RPC porque combinan 2+ escrituras
dependientes). Acá cada opción es, literalmente, **una única llamada** a un
store que el proyecto ya tiene:

**Opción 1 — "Ajustar mediante registro"**: `diff = saldo_deseado −
saldo_actual` (ya calculado en 5.2).

- Si `diff < 0` (saldo deseado MENOR al actual): crear un **gasto**
  — `expensesStore.addExpense({ amount: Math.abs(diff), categoryId:
  adjustmentCategoryId, accountId, description: null, expenseDate:
  todayDateInputValue() })`.
- Si `diff > 0` (saldo deseado MAYOR al actual): crear un **ingreso**
  — `incomesStore.addIncome({ amount: diff, accountId, description: null,
  incomeDate: todayDateInputValue() })` (sin categoría — `incomes` no tiene
  ese campo, confirmado en el modelo de datos del encargo).
- **100% optimista**: `addExpense`/`addIncome` ya son optimistas
  (`expenses-mvp-ux.md`/`accounts-income-ux.md`), y ya ajustan
  `accountsStore.balances` vía `adjustBalance` como cualquier otro
  gasto/ingreso — el Sheet no necesita ningún ajuste de saldo adicional
  por su cuenta, viene gratis de reusar el store tal cual.
- No lleva descripción propia (`description: null`) — la categoría "Ajuste
  de saldo" (sección 5.4) ya es suficientemente explicativa en el listado
  de movimientos, no hace falta un texto libre redundante tipo "Ajuste de
  saldo" repetido.

**Opción 2 — "Cambiar saldo inicial"**:

```
nuevo_initial_balance = initial_balance_actual + (saldo_deseado − saldo_actual_de_account_balances)
                       = initial_balance_actual + diff
```

Exacta porque `account_balances.balance` es lineal en `accounts
.initial_balance` con coeficiente 1 (confirmado en el encargo): sumarle `X`
a `initial_balance` sube `balance` en exactamente `X`, sin ningún caso
especial de redondeo ni de signo — la misma fórmula vale sin importar si
`diff` es positivo o negativo.

- Se llama a `accountsStore.updateAccount(accountId, payload)` — el store
  **requiere el payload completo** (`AccountPayload`: `name`, `color`,
  `icon`, `initialBalance`, `transferCommission`, confirmado contra
  `src/stores/accounts.ts`), así que el Sheet arma el payload completo
  spreadeando la cuenta ya cargada y sobrescribiendo solo
  `initialBalance`:

```ts
function submitInitialBalanceMode() {
  const payload: AccountPayload = {
    name: account.value.name,
    color: account.value.color ?? '',
    icon: account.value.icon ?? DEFAULT_ACCOUNT_ICON,
    initialBalance: account.value.initial_balance + diff.value!,
    transferCommission: account.value.transfer_commission,
  }
  accountsStore.updateAccount(account.value.id, payload)
}
```

- **100% optimista** — mismo motivo que `AccountFormSheet.vue`
  (`accounts-income-ux.md` sección 6.3): `updateAccount` ya es optimista y
  ya recalcula `balances[id]` sumando el mismo `balanceDelta` (visible en
  `src/stores/accounts.ts` línea 274, `payload.initialBalance -
  previous.initial_balance`) — es exactamente el mecanismo que esta
  fórmula necesita, sin escribir ningún ajuste nuevo.
- **No crea ningún movimiento** — a diferencia de la opción 1, no hay fila
  nueva en `expenses`/`incomes`, el ledger de movimientos de la sección 7
  no cambia con esta opción (correcto: el usuario dijo explícitamente que
  no quiere dejar rastro de movimiento, solo corregir el punto de partida).

### 5.4 Guard: saldo deseado igual al actual (`diff === 0`)

**Decisión: botón "Guardar ajuste" deshabilitado** (`:disabled="isSaving ||
diff === 0"`, ya en el snippet de 5.2) + texto informativo debajo del campo
("Este ya es el saldo actual — no hay nada para ajustar.", `text-muted-
foreground`, sección 5.2) — **no** un toast. Mismo criterio que el resto de
guards de "no hay nada que hacer" del proyecto (p. ej. `canDelete` de
`AccountsView.vue`: deshabilitar de antemano, no dejar que el usuario
dispare la acción y enterarse recién después por un mensaje). Un toast acá
sería ruido: no es un error del servidor, es simplemente que no hay ninguna
operación que ejecutar — deshabilitar el botón lo comunica sin necesidad de
una notificación aparte. Aplica igual para las dos opciones del
`radiogroup` (el guard depende solo de `diff`, no de `form.mode`).

### 5.5 Qué pasa si la categoría "Ajuste de saldo" todavía no está cargada

`AccountDetailView.onMounted` llama `categoriesStore.fetchCategories()`
junto con el resto de las queries de la vista (sección 8.1, mismo
`Promise.all` que ya usa `AccountsView.vue`/`DebtDetailView.vue`) — para
cuando el usuario puede interactuar con la pantalla (termina el estado de
carga), las categorías **ya están** en memoria, incluida "Ajuste de saldo"
(es una fila más de `categoriesStore.defaultCategories`, sin necesitar
ningún fetch dedicado — mismo mecanismo que ya recibe "Comisiones
bancarias" sin cambios de código, `account-transfers-ux.md` sección 6.1).

**Defensa explícita de todos modos** (no debería pasar, pero se especifica
para no dejarlo implícito): `AccountBalanceAdjustmentSheet.vue` resuelve
`adjustmentCategoryId` con un `computed`:

```ts
const adjustmentCategoryId = computed(
  () => categoriesStore.defaultCategories.find(c => c.name === 'Ajuste de saldo')?.id ?? null,
)
```

Si `adjustmentCategoryId.value` es `null` en el momento de guardar (caso
extremo: la categoría no se sembró todavía en este entorno, o el fetch
falló silenciosamente) y `form.mode === 'record'` con `diff < 0` (el único
camino que la necesita — un ingreso no la usa, y la opción "Cambiar saldo
inicial" tampoco): se bloquea el submit con `errors.desiredBalance =
'No pudimos preparar el ajuste. Recargá la página e intentá de nuevo.'` en
vez de dejar que `expensesStore.addExpense` falle más abajo con un
`categoryId` vacío — mismo criterio de "fallar temprano con un mensaje
claro" que el resto de validaciones de este Sheet.

### 5.6 Categoría default nueva — "Ajuste de saldo"

Mismo patrón exacto que "Comisiones bancarias"
(`supabase/migrations/20260720090900_categories_bank_commissions.sql`,
`user_id null`, `icon` emoji de texto plano — **no** un nombre de ícono
lucide, `categories.icon` se consume en todo el frontend como emoji directo,
sección de esa migración ya lo documenta y no se reabre acá):

```sql
-- Ilustrativo — a incorporar en una migración nueva de
-- supabase-backend-expert, mismo patrón exacto que
-- 20260720090900_categories_bank_commissions.sql.
insert into public.categories (name, icon, color) values
  ('Ajuste de saldo', '⚖️', '#92400e');
```

- **Nombre**: "Ajuste de saldo" — coincide exactamente con el string que
  `adjustmentCategoryId` busca en 5.5 (`c.name === 'Ajuste de saldo'`);
  si `supabase-backend-expert` cambia el texto exacto, debe avisar para
  actualizar esa comparación en el frontend.
- **Ícono**: `⚖️` (balanza) — no colisiona con ninguno de los 11 emojis ya
  sembrados (🍽️🚗🏠💡💊📚🎬👕💰📦🏦) y comunica "corrección/balance" sin
  ambigüedad, distinto de 🏦 (que ya significa específicamente "comisión
  bancaria").
- **Color candidato**: `#92400e` (amber-800, un marrón cálido oscuro) —
  ninguna de las 11 categorías/colores ya sembrados usa un marrón, así que
  no debería colisionar de entrada; se eligió deliberadamente un tono
  **distinto** de los dos grises ya en uso (`#6b7280` "Otros", `#6366f1`
  "Comisiones bancarias" tras su fix) para no repetir el error ya
  documentado en `20260720091500_categories_bank_commissions_color_fix.sql`
  (agregar un segundo gris de baja croma que colisiona con el primero).
  **Mismo caveat honesto que esa migración dejó explícito para su propio
  color**: este hex **no fue corrido todavía** contra
  `scripts/validate_palette.js` (skill de dataviz) junto con los 11 hex
  existentes. Se recomienda a `supabase-backend-expert`/`ui-ux-designer`
  correr esa validación (en light y dark, superficie `#fcfcfb`/`#1a1a19`)
  antes de aplicar la migración, y ajustar el hex en una migración de fix
  si falla — exactamente el mismo camino de dos pasos que ya se siguió
  para "Comisiones bancarias". No bloquea el resto de este documento.
- La dona de categorías y cualquier listado que itere
  `categoriesStore.categories` recibe esta fila **sin ningún cambio de
  código** — mismo argumento ya usado para "Comisiones bancarias".
- **Seleccionable manualmente también, sin restricción** — mismo criterio
  que "Comisiones bancarias" (`account-transfers-ux.md` sección 6.2): nada
  le impide al usuario elegir "Ajuste de saldo" a mano al cargar un gasto
  común sin pasar por este Sheet. No hay ningún comportamiento especial
  atado a la categoría en sí (a diferencia de la comisión, que sí liga un
  `expense_id` real desde `account_transfers` — acá el gasto/ingreso creado
  por el ajuste es una fila normal, sin ningún vínculo especial que
  restrinja su edición/borrado posterior desde `/transacciones`).

---

## 6. "Últimos 30 días" + gráfico de evolución

### 6.1 Algoritmo — mismo precedente que `buildDebtBalanceEvolution`, adaptado a 1 cuenta y granularidad diaria

Mismo principio exacto que `debts-ux.md` sección 1.4/`buildDebtBalanceEvolution`
(`src/lib/charts.ts`): el saldo "de arranque" de la ventana se deriva **sin**
sumar historial completo, a partir de dos números ya seguros — uno agregado
server-side sin límite de fecha (`account_balances.balance`, siempre
correcto), el otro acotado por rango de fecha (movimientos de los últimos 30
días de **esta** cuenta). La diferencia con Deudas es de granularidad (día a
día, no mes a mes) y de fuente (3 tipos de movimiento — gasto, ingreso,
transferencia — en vez de 1 solo tipo con signo ya resuelto).

```ts
// Nuevo helper en src/lib/charts.ts — buildAccountBalanceEvolution
export interface AccountMovementInput {
  date: string // expense_date / income_date / transfer_date, 'YYYY-MM-DD'
  /** Ya resuelto con signo desde el punto de vista de ESTA cuenta:
   *  gasto → negativo, ingreso → positivo, transferencia saliente →
   *  negativo, transferencia entrante → positivo. La vista arma este
   *  signo al mapear sus 3 queries (sección 6.1.2), este helper no conoce
   *  la forma real de expense/income/transfer. */
  signedAmount: number
}

export function buildAccountBalanceEvolution(
  currentBalance: number,
  windowMovements: AccountMovementInput[],
  windowStart: Date,
  reference: Date = new Date(),
): TrendPoint[] {
  const netInWindow = windowMovements.reduce((sum, m) => sum + m.signedAmount, 0)
  let running = currentBalance - netInWindow // saldo al inicio de la ventana

  const days: TrendPoint[] = []
  const cursor = new Date(windowStart)
  while (cursor.getTime() <= reference.getTime()) {
    const key = dayKeyFrom(cursor) // 'YYYY-MM-DD', mismo formato que dayKey() ya existente
    const dayTotal = windowMovements
      .filter(m => m.date === key)
      .reduce((sum, m) => sum + m.signedAmount, 0)
    running += dayTotal
    days.push({ date: key, amount: running })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}
```

- `currentBalance`: `accountsStore.balanceFor(accountId)` (ya cargado en la
  sección 4, no se vuelve a pedir).
- `windowMovements`: se arman en la vista (no en el helper, que se mantiene
  sin dependencias de store, mismo criterio que el resto de `charts.ts`) a
  partir de **3 queries acotadas por fecha**, cada una filtrada por esta
  cuenta puntual:

```ts
// AccountDetailView.vue — sección 6.1.2, dentro de loadAll()
const windowStart = accountCreatedAfterWindowStart
  ? parseDateOnly(account.value.created_at) // sección 6.3, cuenta joven
  : subDays(reference, 30)

const [expensesRes, incomesRes, transfersRes] = await Promise.all([
  supabase.from('expenses').select('amount, expense_date')
    .eq('account_id', accountId).gte('expense_date', dayKeyFrom(windowStart)),
  supabase.from('incomes').select('amount, income_date')
    .eq('account_id', accountId).gte('income_date', dayKeyFrom(windowStart)),
  supabase.from('account_transfers').select('amount, transfer_date, from_account_id, to_account_id')
    .or(`from_account_id.eq.${accountId},to_account_id.eq.${accountId}`)
    .gte('transfer_date', dayKeyFrom(windowStart)),
])

const windowMovements: AccountMovementInput[] = [
  ...expensesRes.data!.map(e => ({ date: e.expense_date, signedAmount: -e.amount })),
  ...incomesRes.data!.map(i => ({ date: i.income_date, signedAmount: i.amount })),
  ...transfersRes.data!.map(t => ({
    date: t.transfer_date,
    signedAmount: t.from_account_id === accountId ? -t.amount : t.amount,
  })),
]
```

- **Por qué 3 queries acotadas por fecha y NO filtrar las listas globales
  ya cargadas de `expensesStore`/`incomesStore`/`accountTransfersStore`**:
  esas listas están capadas a `MAX_EXPENSES`/`MAX_INCOMES`/`MAX_TRANSFERS`
  (200, todas globales del usuario, no por cuenta) — para una cuenta de
  bajo uso en un usuario con mucha actividad en **otras** cuentas, sus
  movimientos de los últimos 30 días podrían no estar entre los 200 más
  recientes del usuario y quedar filtrados a una lista vacía, mostrando un
  gráfico plano incorrecto sin ningún aviso. El mismo perfil de riesgo que
  ya evita `isMonthSafeToShow` para meses, aplicado acá a "por cuenta" en
  vez de "por mes" — la solución es la misma que ya usa `CardDetailView`
  (`credit-cards-ux.md`, `fetchByDateRange` scoped por tarjeta): pedir al
  servidor exactamente lo que hace falta, acotado por cuenta y por fecha,
  nunca derivarlo de una lista global ya recortada.
- El transfer con comisión no se cuenta dos veces: la comisión ya es una
  fila de `expenses` (con `account_id` = la cuenta de origen de esa
  transferencia) que la primera query ya trae — sumar además
  `t.amount` de esa misma transferencia en la tercera query es correcto,
  son dos efectos de caja distintos y separados (sección 1 de
  `account-transfers-ux.md`), no una duplicación.

### 6.2 Gráfico — se reusa `TrendAreaChart.vue` tal cual, sin componente nuevo

A diferencia de "Evolución de saldos" de Deudas (que sí necesitó
`DualTrendChart.vue`, un componente hermano nuevo, por tener 2 series con
color fijo propio — `debts-ux.md` sección 3.8), acá hay **una sola serie**
con un único significado ("el saldo de esta cuenta") — el contrato exacto
para el que `TrendAreaChart.vue` ya está diseñado (`points: {date,
amount}[]`, color fijo `hsl(var(--primary))`, sin necesidad de normalizar
contra una segunda serie). Se reusa **sin ninguna modificación**:

```html
<Card>
  <CardHeader>
    <div class="flex items-center justify-between gap-2">
      <div class="flex flex-col gap-0.5">
        <CardTitle class="text-base font-semibold">Últimos 30 días</CardTitle>
      </div>
      <div class="flex items-center gap-1" :class="deltaTextClass">
        <component :is="deltaDirection === 'up' ? ArrowUp : ArrowDown" class="size-3.5" />
        <span class="text-sm font-semibold tabular-nums">{{ deltaPercentLabel }}</span>
      </div>
    </div>
  </CardHeader>
  <div class="px-4 pb-6 sm:px-6">
    <TrendAreaChart
      :points="balanceEvolutionPoints"
      :height="80"
      show-axis
      :ariaLabel="`Evolución del saldo de ${account.name}, últimos 30 días`"
    />
  </div>
</Card>
```

- `show-axis` (ya soportado por el componente, `dashboard-redesign-ux.md`
  sección 4.2): dibuja línea base + 3 etiquetas de eje X (inicio/medio/fin
  de la ventana) — reusado tal cual, sin ninguna prop nueva.
- Mismo criterio de "sin tooltip/hover" ya establecido para todos los
  gráficos SVG del proyecto: el dato exacto (variación %, sección 6.3) ya
  está en texto plano al lado, no hace falta interacción para leerlo.

### 6.3 Variación % — cálculo, íconos y 2 casos borde

```ts
const startBalance = computed(() => balanceEvolutionPoints.value[0]?.amount ?? currentBalance.value)
const deltaAmount = computed(() => currentBalance.value - startBalance.value)

const deltaPercentLabel = computed(() => {
  // Caso borde 1 (sección siguiente): saldo de arranque en $0, división
  // indefinida — se muestra solo el monto con signo, sin porcentaje.
  if (startBalance.value === 0) {
    const sign = deltaAmount.value >= 0 ? '+' : '-'
    return `${sign}$${formatAmount(Math.abs(deltaAmount.value))}`
  }
  const pct = (deltaAmount.value / Math.abs(startBalance.value)) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
})

const deltaDirection = computed<'up' | 'down'>(() => (deltaAmount.value >= 0 ? 'up' : 'down'))
const deltaTextClass = computed(() => (deltaAmount.value >= 0 ? 'text-success' : 'text-destructive'))
```

- **Nunca solo color** (regla dura del proyecto): ícono `ArrowUp`/`ArrowDown`
  — deliberadamente los mismos íconos ya usados por `monthDelta` de
  `HomeView.vue` para "vs. mes anterior" (no `ArrowUpRight`/`ArrowDownRight`,
  reservados en `debts-ux.md` sección 3.2 para un significado distinto,
  "qué card es cada una" — acá el significado es el mismo que `monthDelta`:
  una tendencia subiendo/bajando en el tiempo, mismo vocabulario) + signo
  `+`/`-` explícito antes del número, más el color de refuerzo
  (`success`/`destructive` — "más saldo = bueno" ya es la semántica
  establecida para saldo de cuenta, `accounts-income-ux.md` sección 2.3,
  distinta a propósito de "no pintar de rojo cada gasto").
- **Caso borde 1 — saldo de arranque en \$0** (cuenta que hace 30 días
  estaba exactamente en cero): un porcentaje sobre una base 0 es
  matemáticamente indefinido (división por cero) o, en el mejor caso,
  siempre "∞%"/"-∞%", ninguno de los dos es información útil. **Se
  omite el símbolo `%` en este caso** y se muestra únicamente el monto con
  signo (`+$500`, sin "%") — el ícono y el color de dirección siguen
  aplicando normalmente, solo cambia el formato del número.
- **Caso borde 2 — cuenta más joven que 30 días**: `windowStart` (sección
  6.1.2) se **recorta** a `account.created_at` en vez de "hoy − 30" cuando
  la cuenta se creó hace menos de 30 días — nunca se dibuja una línea plana
  imaginaria antes de que la cuenta existiera. Consecuencia: el gráfico
  tiene menos de 30 puntos, y `startBalance` (el primer punto real de la
  serie) coincide exactamente con el `initial_balance` de esa cuenta en su
  día de creación — la variación % queda correcta igual, simplemente sobre
  una ventana más corta que 30 días (no hace falta ningún cálculo especial
  adicional, `deltaAmount`/`deltaPercentLabel` ya son genéricos respecto de
  cuántos días cubre la serie).
- Si `balanceEvolutionPoints` tiene un único punto (cuenta creada **hoy
  mismo**, sin ningún movimiento todavía): se oculta la Card completa del
  gráfico (nada que graficar con un solo punto, mismo criterio que
  "Evolución de saldos" de Deudas cuando no hay datos, `debts-ux.md`
  sección 3.8) — la sección 4 (saldo actual) sigue mostrándose normalmente,
  esta es la única sección que se oculta.

---

## 7. Movimientos recientes

### 7.1 Estrategia de datos — fetch propio acotado por cuenta, no un filtro sobre las listas globales

Mismo argumento ya sentado en 6.1: las listas globales de
`expensesStore`/`incomesStore`/`accountTransfersStore` están capadas a 200
del usuario completo, no de esta cuenta — filtrarlas en cliente puede
mostrar "sin movimientos recientes" para una cuenta que sí los tiene, si el
usuario tiene más actividad reciente en otras cuentas. Se agregan 3 métodos
nuevos a los stores existentes, mismo patrón exacto que
`cardExpensesStore.fetchRecentForCard(cardId, limit = 5)`
(`credit-cards-ux.md` sección 4.3, ya implementado):

```ts
// src/stores/expenses.ts — método nuevo, mismo patrón que fetchRecentForCard
async function fetchRecentForAccount(accountId: string, limit = 10): Promise<ExpenseWithCategory[] | null> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, category:categories(*)')
    .eq('account_id', accountId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[expenses] No se pudieron cargar los movimientos recientes de la cuenta', error)
    return null
  }
  return (data ?? []) as unknown as ExpenseWithCategory[]
}
```

Métodos hermanos `incomesStore.fetchRecentForAccount(accountId, limit)` y
`accountTransfersStore.fetchRecentForAccount(accountId, limit)` (esta
última con `.or(\`from_account_id.eq.${accountId},to_account_id.eq.${accountId}\`)`
en vez de `.eq('account_id', ...)`), mismo `limit` compartido entre las 3
(sección 7.3).

### 7.2 Merge — nueva función hermana de `buildTransactionItems`, sin tocar la existente

`src/lib/transactionItems.ts` ya sabe mezclar gasto+ingreso+transferencia
(sección de contexto arriba) pero genera **siempre las 2** variantes
sintéticas por transferencia (`transfer-out` y `transfer-in`, una por cada
punta) — correcto para `TransactionsView`/`HomeView`, que muestran ambas
puntas de cualquier transferencia del usuario. Acá **una cuenta puntual
solo participa de un lado** de cada transferencia que la involucra, así que
hace falta un filtro adicional después del merge — **se agrega una función
nueva, no se modifica `buildTransactionItems`** (sigue sirviendo tal cual a
sus 2 consumidores actuales):

```ts
// src/lib/transactionItems.ts — función nueva, agregada al final del archivo
/**
 * Igual que `buildTransactionItems`, pero acotado a los ítems donde
 * `accountId` participa de verdad — filtra las 2 variantes sintéticas de
 * transferencia a la que corresponde según de qué lado está esta cuenta
 * (nunca las 2 juntas: si esta cuenta es el origen, solo `transfer-out`; si
 * es el destino, solo `transfer-in`). Usado por `AccountDetailView.vue`
 * (docs/features/account-detail-ux.md sección 7.2) sobre listas YA
 * acotadas por cuenta (fetchRecentForAccount de cada store, sección 7.1),
 * no sobre las listas globales.
 */
export function buildAccountTransactionItems(
  expenses: ExpenseWithCategory[],
  incomes: IncomeWithAccount[],
  transfers: AccountTransfer[],
  accountId: string,
): TransactionItem[] {
  return buildTransactionItems(expenses, incomes, transfers).filter(item => {
    if (item.kind === 'transfer-out') return item.data.from_account_id === accountId
    if (item.kind === 'transfer-in') return item.data.to_account_id === accountId
    return true
  })
}
```

Reusa la apariencia/badges/copy ya resueltos en `account-transfers-ux.md`
sección 6.4 **sin ningún cambio**: mismo ícono `ArrowRightLeft`, mismo
`text-destructive`/`text-success` según `transfer-out`/`transfer-in`, mismo
título "Transferencia a {{ cuenta destino }}" / "Transferencia desde
{{ cuenta origen }}" — la única diferencia respecto de `TransactionsView`
es la fuente de datos (acotada por cuenta, sección 7.1) y el filtro de
arriba, no el tratamiento visual.

### 7.3 "Mostrar más" — re-fetch con límite incremental, no scroll infinito

Mismo espíritu de simplicidad que el resto de listas "recientes" del
proyecto (ninguna implementa cursor/paginación real todavía, sección 1.4 de
`account-transfers-ux.md` lo deja como pendiente futuro para las listas
globales): "Mostrar más" **vuelve a llamar** a los 3 `fetchRecentForAccount`
con un `limit` más alto, no acumula páginas ni usa `range()`:

```ts
const PAGE_SIZE = 10
const currentLimit = ref(PAGE_SIZE)
const hasMore = ref(true) // se baja a false cuando una recarga trae menos de currentLimit en total

async function loadMovements() {
  const [expensesRes, incomesRes, transfersRes] = await Promise.all([
    expensesStore.fetchRecentForAccount(accountId.value, currentLimit.value),
    incomesStore.fetchRecentForAccount(accountId.value, currentLimit.value),
    accountTransfersStore.fetchRecentForAccount(accountId.value, currentLimit.value),
  ])
  if (expensesRes === null || incomesRes === null || transfersRes === null) {
    loadError.value = true
    return
  }
  recentExpenses.value = expensesRes
  recentIncomes.value = incomesRes
  recentTransfers.value = transfersRes

  const totalFetched = expensesRes.length + incomesRes.length + transfersRes.length
  // Si ninguna de las 3 queries llegó a su propio tope, no puede haber más
  // para traer — heurística simple (no exacta si las 3 casualmente calzan
  // justo, pero el peor caso es un botón "Mostrar más" que trae 0 filas
  // nuevas una vez, sin ningún dato incorrecto mostrado).
  hasMore.value = expensesRes.length === currentLimit.value
    || incomesRes.length === currentLimit.value
    || transfersRes.length === currentLimit.value
}

function showMore() {
  currentLimit.value += PAGE_SIZE
  loadMovements()
}
```

- **Botón "Mostrar más"** (`variant="outline"`, ancho completo, debajo del
  listado) visible solo si `hasMore.value` — se oculta solo, no queda un
  botón muerto que no trae nada nuevo al tocarlo.
- Estado de carga del botón mismo (`Loader2` + "Cargando…") mientras
  `loadMovements()` está en vuelo, igual criterio que cualquier botón
  async del proyecto.
- Este mecanismo es deliberadamente el más simple posible (re-pedir con un
  límite mayor, no acumular offsets) — con `limit` creciendo de a 10 el
  costo de "traer de nuevo lo que ya se tenía" es despreciable para el
  volumen esperado de una sola cuenta.

### 7.4 Render

Mismo patrón de fila que `TransactionsView.vue` (Card + separador +
`DropdownMenu` de Editar/Eliminar por fila para `expense`/`income`; para
`transfer-out`/`transfer-in`, sin menú — se editan/borran solo desde
`/transferencias`, mismo criterio ya resuelto en `account-transfers-ux.md`
sección 6.3/6.4) — no se reproduce el markup completo acá, es una copia
directa del bloque ya implementado en `TransactionsView.vue`, iterando
sobre `buildAccountTransactionItems(...)` en vez de la lista global.

### 7.5 FAB "+" — abre `TransactionFormSheet.vue` preseleccionando esta cuenta

**Alcance**: el FAB de esta pantalla cubre gasto/ingreso (`TransactionFormSheet`),
**no** transferencias — crear una transferencia sigue siendo exclusivo de
`/transferencias` (decisión de alcance, no un olvido: el pedido original
dice "agregar movimiento contra esta cuenta", que `TransactionFormSheet`
ya cubre completo para los 2 tipos más frecuentes; una transferencia
siempre involucra una **segunda** cuenta con su propio selector — sección
4.1 de `account-transfers-ux.md` — así que forzarla en un FAB de una sola
cuenta agregaría un flujo distinto al del resto del Sheet sin que el
encargo lo haya pedido).

**Preselección de cuenta — nueva prop opcional, no un query param**:

```ts
// src/components/TransactionFormSheet.vue — prop nueva, sin romper los 2
// call-sites existentes (HomeView.vue, TransactionsView.vue no la pasan,
// sigue funcionando exactamente igual para ellos).
const props = defineProps<{
  open: boolean
  transaction?: /* ...sin cambios... */ | null
  /** accounts-detail-ux.md sección 7.5: cuenta a preseleccionar en modo
   * alta (AccountDetailView). Ignorado en modo edición (`transaction` ya
   * trae su propia `account_id`). Es solo un DEFAULT, no bloquea el
   * `Select` de Cuenta — el usuario puede seguir cambiándola. */
  presetAccountId?: string | null
}>()
```

```ts
// resetForm() — único cambio real de este archivo
function resetForm() {
  // ...
  } else {
    form.type = 'expense'
    form.amount = ''
    form.accountId = props.presetAccountId ?? defaultAccountId() // ANTES: defaultAccountId()
    form.categoryId = ''
    form.date = todayDateInputValue()
    form.description = ''
  }
}
```

Se eligió una **prop** (no un query param de ruta) porque este Sheet nunca
tuvo ruta propia — vive montado dentro de la vista que lo abre
(`v-model:open`), exactamente como ya recibe `transaction` — agregar
`presetAccountId` sigue el mismo mecanismo de comunicación ya establecido,
sin inventar un segundo canal (query param) para un caso que la prop
resuelve igual de bien y más simple.

```html
<!-- AccountDetailView.vue -->
<TransactionFormSheet v-model:open="isTransactionSheetOpen" :preset-account-id="accountId" />
```

Tras guardar, el Sheet cierra optimista como siempre; `AccountDetailView`
no necesita ningún manejo especial adicional — el gasto/ingreso nuevo
aparece en "Movimientos recientes" recién en el próximo `loadMovements()`
(no hay lista maestra reactiva compartida acá, a diferencia de
`TransactionsView`/`HomeView`, sección 7.1 ya explica por qué esta vista
tiene su propio fetch acotado). **Se dispara un `loadMovements()` +
refresco de saldo/gráfico inmediatamente después de que el Sheet emite el
guardado** (mismo patrón ya usado por otras vistas tras una mutación
optimista de un store ajeno):

```ts
function onTransactionSheetClose(open: boolean) {
  isTransactionSheetOpen.value = open
  if (!open) {
    loadMovements()
    // El saldo (sección 4) y el gráfico (sección 6) ya se actualizan solos
    // — ambos leen accountsStore.balanceFor(accountId), que expensesStore/
    // incomesStore ya ajustan optimistamente vía adjustBalance. Solo hace
    // falta re-derivar balanceEvolutionPoints con el movimiento nuevo
    // incluido en la ventana de 30 días — se re-ejecuta la misma carga de
    // sección 6.1.2 (barata: 3 queries acotadas por fecha y por cuenta).
  }
}
```

---

## 8. Estados de carga/vacío/error

### 8.1 `onMounted` — todo lo que la pantalla necesita, en un solo `Promise.all`

```ts
async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [accountsOk, balancesOk, categoriesOk] = await Promise.all([
      accountsStore.fetchAccounts(),
      accountsStore.fetchBalances(),
      categoriesStore.fetchCategories(), // sección 5.5
    ])
    if (!accountsOk || !balancesOk || !categoriesOk || !account.value) {
      loadError.value = true
      return
    }
    await Promise.all([loadBalanceEvolution(), loadMovements()]) // secciones 6.1.2, 7.3
  } finally {
    isInitialLoading.value = false
  }
}
```

`!account.value` (la cuenta del `:id` de la ruta no existe / no es del
usuario — deep-link inválido o cuenta ya borrada) se trata como error,
mismo criterio que `DebtDetailView.vue`/`CardDetailView.vue` (`debt.value`
faltante ya es parte de su condición de `loadError`).

### 8.2 Carga

`Skeleton` en las 4 secciones (header ya resuelto por `AppHeader`, no
necesita skeleton propio) — saldo actual, gráfico, listado de movimientos —
mismo criterio que el resto de la app.

### 8.3 Error

Mismo bloque `AlertCircle` + "No pudimos cargar esta cuenta" + botón
"Reintentar" (`loadAll`) — mismo patrón que `DebtDetailView.vue`/
`AccountsView.vue`.

### 8.4 Vacío de "Movimientos recientes"

Si `buildAccountTransactionItems(...)` da una lista vacía (cuenta recién
creada, sin ningún movimiento todavía): mensaje inline corto,
`text-sm text-muted-foreground text-center py-8`, `"Todavía no hay
movimientos en esta cuenta."` — el FAB "+" sigue visible (es la acción que
resuelve ese estado vacío), sin ningún botón duplicado dentro del bloque
vacío (a diferencia de otras pantallas donde el vacío total reemplaza el
FAB por un botón centrado — acá el resto de la pantalla, saldo/gráfico, ya
tiene contenido real, no es un vacío de pantalla completa).

---

## 9. Router — resumen

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/cuentas/:id` | `account-detail` | `{ requiresAuth: true }` | `AccountDetailView` |

---

## 10. Checklist de impacto en código existente — para `vue-frontend-expert`

- **Nuevo** `src/views/AccountDetailView.vue` (sección 1-8 completas).
- **Nuevo** `src/components/AccountBalanceAdjustmentSheet.vue` (sección 5).
- `src/router/index.ts`: ruta `account-detail` (sección 9).
- `src/views/HomeView.vue`: tiles de "Mis cuentas" dejan de ser `disabled`,
  agregan `@click` de navegación (sección 1.2) — **sin ningún otro cambio**
  en esa sección.
- `src/views/AccountsView.vue`: la fila de cada cuenta pasa de `<div>`
  estático a clickeable con `@click.stop` en el trigger del menú (sección
  1.3) — el contenido interno de la fila y el `DropdownMenu` no cambian.
- `src/components/TransactionFormSheet.vue`: prop nueva opcional
  `presetAccountId` (sección 7.5), un único cambio de una línea en
  `resetForm()` — **retrocompatible**, los 2 call-sites existentes
  (`HomeView.vue`, `TransactionsView.vue`) no la pasan y siguen usando
  `defaultAccountId()` exactamente como hoy.
- `src/stores/expenses.ts`, `src/stores/incomes.ts`,
  `src/stores/accountTransfers.ts`: método nuevo `fetchRecentForAccount`
  en cada uno (sección 7.1), mismo patrón que
  `cardExpensesStore.fetchRecentForCard` — no toca ninguna función
  existente de esos 3 stores.
- `src/lib/transactionItems.ts`: función nueva `buildAccountTransactionItems`
  (sección 7.2), agregada al final del archivo — `buildTransactionItems`
  no se modifica.
- `src/lib/charts.ts`: función nueva `buildAccountBalanceEvolution` +
  tipo `AccountMovementInput` (sección 6.1) — no toca
  `buildDebtBalanceEvolution` ni ningún otro export existente.
- **Backend** (`supabase-backend-expert`): migración nueva con la
  categoría default "Ajuste de saldo" (sección 5.6) — mismo patrón que
  `20260720090900_categories_bank_commissions.sql`, sin tocar ninguna
  migración ya aplicada. Ningún cambio de esquema más allá de este seed:
  no hace falta ninguna columna, vista ni función nueva (sección "Qué NO
  hace falta" del encargo, confirmada: ambas rutas de ajuste de saldo
  reusan mutaciones ya existentes, sección 5.3).

---

## 11. Qué NO cambia / fuera de alcance de este documento

- **Sin RPC nueva, sin vista nueva de "historial de saldo por día"** — el
  cálculo client-side de la sección 6.1 ya es seguro (mismo argumento ya
  aceptado para Deudas, `debts-ux.md` sección 1.4).
- **Sin componente `Dialog` nuevo** — la sección 5 reusa `Sheet` +
  `radiogroup`, vocabulario ya establecido.
- **Sin componente de gráfico nuevo** — `TrendAreaChart.vue` se reusa tal
  cual (sección 6.2), a diferencia de Deudas.
- **Sin crear transferencias desde el FAB de esta pantalla** — alcance
  deliberado (sección 7.5), sigue siendo exclusivo de `/transferencias`.
- **`AccountFormSheet.vue` no cambia** — el botón de editar del header
  (sección 3) lo reusa exactamente como ya lo usa `AccountsView.vue`.
- **No se agrega ningún campo de "tipo de cuenta" al esquema** — decisión
  explícita de la sección 2, no un pendiente.
