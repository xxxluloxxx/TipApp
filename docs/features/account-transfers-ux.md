# TipApp — UX de Transferencias entre Cuentas con Comisión Bancaria

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, Sheet inferior, a11y, **sección 6 "Header + navegación"**),
`docs/features/accounts-income-ux.md` (paleta `ACCOUNT_COLOR_SWATCHES`,
estructura actual de `AccountFormSheet.vue`, estrategia de datos de
`account_balances`) y `docs/features/debts-ux.md` (precedente directo de
copy para "esto ajusta un saldo pero no aparece como gasto/ingreso", y el
criterio "ni 1 ni 4 rutas" para calibrar cuántas rutas amerita una feature
nueva). No se repite esa justificación acá, solo se referencia.

**Nota sobre una inconsistencia detectada entre docs, resuelta a favor del
más nuevo**: los snippets de header (`<header>` + botón `ArrowLeft`
"Volver") que aparecen en `accounts-income-ux.md`/`debts-ux.md` quedaron
desactualizados — `design-system.md` sección 6 (posterior a esos dos docs)
documenta que la app extrajo `AppHeader.vue`/`NavigationDrawer.vue` como
patrón único de encabezado, con una **regla dura**: ninguna vista
autenticada lleva botón "Volver", la navegación es siempre por el drawer
(botón `Menu`). Confirmado además contra el código real
(`src/components/AppHeader.vue`, `src/components/NavigationDrawer.vue`,
`src/views/TransactionsView.vue`) — las vistas ya implementadas usan
`<AppHeader title="..." />`, no un `<header>` a mano. Este documento usa
**ese** patrón vigente, no el de los snippets viejos de Cuentas/Deudas.

Contexto de producto (ya decidido por el Product Owner, no se rediscute
acá): el usuario transfiere dinero entre dos cuentas propias. Al guardar
hay **dos efectos distintos**: (1) el monto transferido mueve saldo de
origen a destino (vía `account_balances`, nunca una fila visible en
Transacciones); (2) la comisión bancaria de esa transferencia se resta
ADEMÁS de la cuenta de origen y **sí** genera un gasto real, visible en
Transacciones/Estadísticas/dona, bajo una categoría default nueva
"Comisiones bancarias". Cada cuenta tiene un `transfer_commission`
configurable que actúa como sugerido/default al armar una transferencia
nueva, editable por transferencia puntual.

---

## 1. Estrategia de datos

### 1.1 El monto transferido: por qué NO aparece en Transacciones — confirmado, con un argumento más fuerte que el de Deudas

El Product Owner dejó esto explícitamente abierto para reevaluar, no
cerrado. Tras pensarlo: **se confirma la no-visibilidad**, con la misma
conclusión que ya validó Deudas pero un argumento **más fuerte**, no
idéntico — vale la pena explicitarlo en vez de copiar el razonamiento de
Deudas sin más.

**El argumento de Deudas** ("la plata sigue siendo tuya, solo cambia de
lugar") es cierto pero tiene una grieta real en ese caso: cuando prestás
plata, el dinero *sí* sale del control directo del usuario (queda en manos
de un tercero) — la justificación depende de una ficción contable
razonable ("sigue siendo tuyo porque te lo deben"), no de un hecho
literal.

**En una transferencia entre cuentas propias, no hace falta ninguna
ficción contable**: el dinero nunca deja el patrimonio del usuario ni por
un instante, ni conceptual ni literalmente — sigue siendo 100% suyo, en
una cuenta que también es 100% suya. No es "básicamente lo mismo que un
gasto/ingreso, con una excepción documentada" (como sí lo es un préstamo,
que al menos *podría* razonablemente modelarse como un gasto si no fuera
por el argumento de "sigue siendo tuyo"): es, directamente, **la misma
plata contada dos veces** si apareciera como un gasto en origen y un
ingreso en destino — inflaría artificialmente el "Total del mes" (hero de
Inicio) y la dona de categorías sin que haya ocurrido ningún gasto ni
ingreso real. Mostrarlo en Transacciones no sería "más transparente", sería
**incorrecto** en el sentido más literal: el usuario no gastó ni ganó nada,
movió un número de un lado a otro de su propio balance total.

**Alternativa evaluada y descartada — trazabilidad "a dónde fue esa
plata"**: a diferencia de Deudas (donde el vínculo a cuenta es un campo
opcional dentro de otra entidad, sin ninguna pantalla propia si se quita
ese vínculo), acá la trazabilidad **ya está resuelta por diseño**: el
listado dedicado `/transferencias` (sección 3) **es** el registro completo
de "a dónde fue esa plata" — cada transferencia queda ahí, con origen,
destino, monto, comisión y fecha, indefinidamente. No hace falta duplicarla
en Transacciones para no perder trazabilidad, porque nunca se pierde: vive
en su propio lugar, con más detalle del que tendría una fila genérica de
gasto/ingreso (que no podría representar "de qué cuenta A a cuenta B" con
el layout ya establecido de una fila de Transacciones). Esta es la
diferencia estructural con Deudas que vale la pena remarcar: si el
Product Owner quisiera reabrir esto, la pregunta correcta no es "¿la
transferencia queda visible en algún lado?" (ya lo está, en
`/transferencias`) sino "¿debería estar TAMBIÉN mezclada en Transacciones,
con el riesgo de doble conteo del punto anterior?" — y la respuesta a esa
segunda pregunta es no, salvo que el Product Owner decida explícitamente
que quiere aceptar ese riesgo de doble conteo a cambio de una única lista
unificada (rediseño de modelo de datos real, no un ajuste de UI; no se
toma esa decisión acá).

**Consecuencia para el backend** (ya asumida en paralelo, confirmada acá):
el monto principal de la transferencia no genera ninguna fila en
`expenses`/`incomes` — solo ajusta `account_balances` de las dos cuentas
involucradas, igual mecanismo que ya usa el vínculo a cuenta de
`debt_movements`.

### 1.2 La comisión: SÍ es un gasto real, con un matiz importante que no tiene precedente en Deudas

A diferencia del monto transferido, la comisión bancaria es dinero que
**sale de verdad** del patrimonio del usuario (se lo queda el banco) — es,
sin ninguna ficción contable, un gasto real. Se modela como una fila
normal de `expenses`, categoría default nueva "Comisiones bancarias"
(sección 6), visible en Transacciones/Estadísticas/dona exactamente igual
que cualquier otro gasto.

**Matiz sin precedente en Deudas — comisión en $0 no crea ninguna fila**:
`expenses.amount` tiene `check (amount > 0)` en el esquema ya existente
(`CLAUDE.md`, sección de backend de la feature de gastos original) — un
gasto de $0 no es representable ni tiene sentido como fila. Muchas
transferencias entre cuentas propias del mismo usuario (p. ej. billetera
virtual → banco del mismo usuario) no tienen ninguna comisión real. **Si
la comisión de una transferencia puntual es $0, no se crea ninguna fila en
`expenses`** — la transferencia igual se guarda completa en
`account_transfers` (sección 1.3) con `commission_amount = 0`, pero sin
ningún gasto vinculado. Esto es una consecuencia directa de una
restricción de esquema ya existente, no una decisión de UX nueva — se
documenta acá para que `supabase-backend-expert` no intente forzar una
fila de $0 y para que `vue-frontend-expert` no asuma que siempre hay un
gasto vinculado (la fila de listado de la sección 3.5 debe ocultar la
línea de comisión cuando `commission_amount === 0`, no mostrar "$0").

### 1.3 Modelo de datos ilustrativo (a confirmar con `supabase-backend-expert`, no es la migración final)

```sql
-- Ilustrativo — nombres de tabla/columna plausibles, no la migración final.
create table public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid not null references public.accounts (id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  commission_amount numeric(12,2) not null default 0 check (commission_amount >= 0),
  -- NULL si commission_amount = 0 (sección 1.2) — no todo transfer tiene un gasto vinculado.
  commission_expense_id uuid references public.expenses (id) on delete set null,
  transfer_date date not null default current_date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_transfers_different_accounts check (from_account_id <> to_account_id)
);
```

Y en `accounts`:

```sql
alter table public.accounts
  add column transfer_commission numeric(12,2) not null default 0 check (transfer_commission >= 0);
```

Y en `expenses` (para poder distinguir "gasto generado por una
transferencia" de "gasto manual del usuario en la misma categoría" —
sección 6.3 explica por qué hace falta):

```sql
alter table public.expenses
  add column account_transfer_id uuid references public.account_transfers (id) on delete set null;
```

Se recomienda (no se impone) una **función RPC atómica** para crear una
transferencia, mismo patrón ya usado por `create_debt`
(`security invoker`): inserta `account_transfers` + ajusta las dos cuentas
+ crea la fila de `expenses` de la comisión (solo si `commission_amount >
0`) en una sola transacción — igual motivo que justificó el RPC de Deudas
(sección 2.2): el frontend no puede insertar optimistamente sin ya tener
el resultado atómico completo. Edición/borrado de una transferencia
existente necesitan el mismo tratamiento atómico (sección 4.3) — reversar
los deltas viejos de ambas cuentas y la fila de comisión vieja (crear/
actualizar/borrar según corresponda), aplicar los nuevos. Esto **no** es
una decisión de UX, es una nota para que backend calibre la complejidad
real del RPC de edición antes de comprometerse — no bloquea el resto de
este documento.

### 1.4 Seguridad de datos para el listado de `/transferencias`

Mismo criterio ya establecido para `expenses`/`card_expenses`: el listado
completo de `account_transfers` de un usuario **puede** crecer sin límite
realista con el tiempo (cada transferencia es un evento nuevo, igual
perfil que un gasto) — a diferencia de `debt_balances` (sección 1.2 de
`debts-ux.md`, seguro de traer completo porque es "N hilos", cardinalidad
chica por diseño). Acá el perfil es el de `expenses.ts`
(`fetchAll`/`MAX_EXPENSES`), no el de `debtsStore.fetchBalances()`.

**Consecuencia**: `accountTransfersStore.fetchAll()` trae, igual que
`expensesStore`, las transferencias más recientes con un límite explícito
(`order('transfer_date', { ascending: false }).limit(200)` — mismo valor
`MAX_EXPENSES` que ya usa `expenses.ts`, por consistencia, no por ningún
cálculo nuevo). Si a futuro esto se vuelve insuficiente para un usuario de
uso muy intenso, es el mismo problema (y la misma solución futura,
paginación real) que ya está pendiente para `expenses.ts` — no se resuelve
acá de forma distinta.

**El stat opcional "Comisiones pagadas este mes"** (sección 3.2, propuesta
no obligatoria) sí necesita ser explícitamente seguro: se resuelve con una
query **acotada por fecha** contra `expenses` (`category_id =
<id de "Comisiones bancarias">`, `gte(inicio_mes).lt(inicio_mes_siguiente)`),
nunca derivada de `accountTransfersStore.transfers` (que puede estar
recortada a 200 y no representar "todo el mes" con certeza) — mismo
criterio que "Resumen rápido" de `debts-ux.md` sección 1.3/3.7.

---

## 2. Cuántas rutas amerita la feature

Mismo ejercicio de calibración ya hecho para Cuentas (1 ruta), Tarjetas (4
rutas) y Deudas (2, luego 3). **Decisión: 1 sola ruta,
`/transferencias`** — dashboard/listado/alta todo en la misma pantalla,
sin ruta de detalle.

### 2.1 Por qué no hace falta una 2ª ruta de detalle (a diferencia de Deudas)

La razón por la que Deudas necesitó una 2ª ruta (`/deudas/:id`) fue muy
puntual: **un hilo de deuda es un contenedor de N movimientos** (abonos,
ampliaciones) que se acumulan en el tiempo — hace falta un lugar para ver/
editar/borrar esos movimientos individuales dentro de su hilo. **Una
transferencia no tiene esa estructura**: es un evento atómico único (se
crea una vez, con sus 6 campos fijos — origen, destino, monto, comisión,
fecha, descripción) que no acumula nada después de creado. No hay ningún
"ledger" que navegar dentro de una transferencia puntual — hay, como
mucho, que editar o borrar esa transferencia entera, exactamente el mismo
perfil de operación que editar/borrar un gasto o un ingreso (que tampoco
tienen ruta de detalle propia, se gestionan con un menú `⋮` sobre la
misma fila de `TransactionsView`).

En otras palabras: una transferencia se parece, en granularidad, a **un
gasto** (evento atómico, edita/borra desde su propia fila), no a **un
hilo de deuda** (contenedor con historial). Por eso la ruta única
`/transferencias` sigue el mismo patrón de `TransactionsView.vue`
(listado agrupado por fecha + FAB + Sheet de alta/edición + menú `⋮`
Editar/Eliminar por fila), no el de `DebtsDashboardView`/`DebtDetailView`.

### 2.2 Por qué no hace falta una ruta de gestión aparte (a diferencia de Tarjetas/Deudas)

Tarjetas y Deudas necesitaron una ruta de gestión propia
(`/tarjetas/gestionar`, `/deudas/personas`) porque ambas introducían una
**entidad secundaria nueva** (personas) sin pantalla propia. Transferencias
no introduce ninguna entidad nueva de ese tipo: las cuentas ya se
gestionan en `/cuentas` (sección 5 agrega un campo ahí, no una pantalla
nueva) y no hay ningún concepto de "persona"/contraparte externa — ambas
puntas de una transferencia son cuentas del propio usuario, ya
gestionadas.

```ts
{ path: '/transferencias', name: 'account-transfers', component: () => import('@/views/AccountTransfersView.vue'), meta: { requiresAuth: true } },
```

Sin colisión de segmento literal-vs-dinámico (no hay ninguna ruta
`/transferencias/:id`) — no hace falta ningún orden especial en el array
de rutas.

---

## 3. `/transferencias` — Vista

```html
<AppHeader title="Transferencias" />
```

Nada de botón "Volver" (sección 6 de `design-system.md`) — el drawer ya
incluido en `AppHeader` es la única navegación hacia atrás.

### 3.1 Guard de entrada: hacen falta al menos 2 cuentas

Una transferencia no es posible con 0 o 1 cuenta — a diferencia del guard
ya existente de Cuentas ("nunca borrar la última cuenta", que protege que
siempre exista al menos 1), acá el piso funcional es **2**. Esto no es un
guard de borrado (no se está borrando nada acá) sino un guard de **acceso
a la feature completa**:

- Si `accountsStore.accounts.length < 2`: la vista muestra un estado
  vacío distinto del "sin transferencias" (sección 3.6) — nunca el FAB de
  "Nueva transferencia" en este caso, para no llevar a un Sheet que de
  entrada no puede completarse.
- Si `accountsStore.accounts.length >= 2`: FAB visible siempre (aunque el
  usuario todavía no tenga ninguna transferencia — mismo criterio que el
  resto de la app, el FAB no depende de tener datos previos).

### 3.2 "Comisiones pagadas este mes" (opcional, recomendado, no bloqueante)

```html
<Card v-if="commissionsThisMonth > 0">
  <CardHeader>
    <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Comisiones pagadas · {{ monthLabel }}
    </CardTitle>
  </CardHeader>
  <div class="px-4 pb-4 sm:px-6 sm:pb-6">
    <p class="text-2xl font-bold tabular-nums tracking-tight">${{ formatAmount(commissionsThisMonth) }}</p>
    <p class="text-xs text-muted-foreground">{{ transfersWithCommissionCount }} transferencia{{ transfersWithCommissionCount === 1 ? '' : 's' }} con comisión</p>
  </div>
</Card>
```

- Fuente: query acotada por mes contra `expenses` filtrada por la
  categoría "Comisiones bancarias" (sección 1.4) — **nunca** sumando
  `accountTransfersStore.transfers` (recortado a 200, sección 1.4).
- **Se oculta la Card completa si `commissionsThisMonth === 0`** (mismo
  criterio que "Evolución de saldos" en Deudas cuando no hay datos, y que
  "Resumen por categoría" en Estadísticas cuando el mes no tiene gasto) —
  no tiene sentido mostrar un "$0" destacado como si fuera un dato
  relevante.
- Marcado como **opcional**: si `vue-frontend-expert`/Product Owner
  prefieren no incluirlo en esta primera pasada, el resto del documento
  (secciones 3.3 en adelante) no depende de esta Card — es un agregado de
  valor bajo costo, no un requisito duro del encargo.

### 3.3 Listado de transferencias — mismo patrón que `TransactionsView.vue`

Agrupado por encabezado de fecha (`formatExpenseDateHeading`, ya existente
en `src/lib/date.ts`), orden desc — reuso literal del patrón ya
implementado, no uno nuevo:

```html
<section class="flex flex-col gap-3">
  <template v-for="(group, idx) in groupedTransfers" :key="`${group.heading}-${idx}`">
    <Separator v-if="idx > 0" />
    <span class="text-xs font-medium text-muted-foreground">{{ group.heading }}</span>

    <Card
      v-for="transfer in group.items"
      :key="transfer.id"
      class="p-4 sm:p-6"
      :class="{ 'opacity-70': transfer._pending }"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-2">
          <div class="flex items-center gap-2 text-sm">
            <span class="flex items-center gap-1.5 truncate font-medium">
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{ backgroundColor: resolveAccountColor(transfer.fromAccount.color, isDarkNow) }"
              />
              {{ transfer.fromAccount.name }}
            </span>
            <ArrowRightLeft class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="flex items-center gap-1.5 truncate font-medium">
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{ backgroundColor: resolveAccountColor(transfer.toAccount.color, isDarkNow) }"
              />
              {{ transfer.toAccount.name }}
            </span>
          </div>
          <p v-if="transfer.description" class="truncate text-xs text-muted-foreground">
            {{ transfer.description }}
          </p>
          <p v-if="transfer.commissionAmount > 0" class="flex items-center gap-1 text-xs text-muted-foreground">
            Comisión: ${{ formatAmount(transfer.commissionAmount) }}
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <p class="text-sm font-semibold tabular-nums">${{ formatAmount(transfer.amount) }}</p>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" aria-label="Más acciones">
                <EllipsisVertical class="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="openEditSheet(transfer)">
                <Pencil class="size-4" /> Editar
              </DropdownMenuItem>
              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <DropdownMenuItem @select.prevent>
                    <Trash2 class="size-4" /> Eliminar
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar esta transferencia?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se va a revertir el movimiento entre "{{ transfer.fromAccount.name }}" y
                      "{{ transfer.toAccount.name }}"<span v-if="transfer.commissionAmount > 0">, y se va a eliminar el gasto de comisión asociado</span>.
                      Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction @click="accountTransfersStore.deleteTransfer(transfer.id)">Eliminar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  </template>
</section>
```

- **Sin guard de borrado de ningún tipo** (mismo criterio que "Editar/
  eliminar la deuda completa" de `debts-ux.md` sección 6.5): una
  transferencia no es referenciada por ningún otro recurso — su gasto de
  comisión vinculado se borra en cascada como parte de la misma operación
  (sección 4.3), no es un "uso externo" que bloquee el borrado.
- **Ícono `ArrowRightLeft` entre las dos cuentas** (mismo ícono elegido
  para el drawer, sección 7 — refuerzo visual de identidad de la
  feature, no una casualidad).
- Línea de comisión condicional (`v-if="transfer.commissionAmount > 0"`,
  sección 1.2) — nunca "$0" mostrado como si fuera dato real.

### 3.4 Estado de carga

Mismo bloque `Skeleton` que `TransactionsView.vue` (4 `Card` con dos
`Skeleton` apilados + uno a la derecha) — reuso literal, sin variación.

### 3.5 Estado de error

Mismo bloque `AlertCircle` + "No pudimos cargar tus transferencias" +
botón "Reintentar" — mismo patrón que el resto de la app.

### 3.6 Estados vacíos — dos variantes distintas (guard de cuentas vs. sin datos)

**Variante A — menos de 2 cuentas** (sección 3.1):

```html
<div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
  <ArrowRightLeft class="size-12 text-muted-foreground" />
  <h2 class="text-lg font-semibold">Necesitás al menos 2 cuentas</h2>
  <p class="max-w-xs text-center text-sm text-muted-foreground">
    Para transferir plata entre cuentas, primero necesitás tener dos o más creadas.
  </p>
  <Button @click="router.push({ name: 'accounts', query: { new: '1' } })">
    Crear otra cuenta
  </Button>
</div>
```

**Variante B — 2+ cuentas, todavía sin ninguna transferencia**:

```html
<div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
  <ArrowRightLeft class="size-12 text-muted-foreground" />
  <h2 class="text-lg font-semibold">Todavía no hiciste ninguna transferencia</h2>
  <p class="max-w-xs text-center text-sm text-muted-foreground">
    Mové plata entre tus cuentas cuando lo necesites, con o sin comisión.
  </p>
  <Button @click="openAddSheet">
    Nueva transferencia
  </Button>
</div>
```

### 3.7 FAB "Nueva transferencia"

Mismo patrón exacto que el resto de listados con alta frecuente
(`size-14 rounded-full shadow-[var(--shadow-elevated)]`,
`pb-[env(safe-area-inset-bottom)]`) — oculto por completo si
`accountsStore.accounts.length < 2` (sección 3.1, variante A ya cubre la
llamada a la acción en ese caso, un FAB duplicado sería redundante y
además llevaría a un Sheet que no puede completarse).

---

## 4. Sheet "Nueva transferencia" — `AccountTransferFormSheet.vue`

Mismo patrón estructural que el resto de Sheets (`Sheet side="bottom"`,
`SheetHeader`/`SheetTitle`, body `gap-4 px-4`, footer con botón ancho
completo) — plantilla más cercana a `DebtFormSheet.vue` (ya implementado)
que a `AccountFormSheet.vue`, por tener selects dependientes entre sí.

### 4.1 Campos y su orden

1. **Cuenta de origen** (`Select`, requerido, sin default preseleccionado
   — fuerza elección consciente, mismo criterio que "Dirección" en
   Deudas: es el campo más importante del formulario).
2. **Cuenta de destino** (`Select`, requerido, excluye la cuenta de
   origen ya elegida — sección 4.2).
3. **Monto** (`Input type="number"`, requerido, `> 0`).
4. **Comisión** (`Input`, opcional, default sugerido desde
   `fromAccount.transfer_commission` — sección 4.4).
5. **Fecha** (`<input type="date">` nativo, mismo criterio de siempre, no
   futura).
6. **Descripción** (`Input`, opcional, `maxlength="200"`).
7. Botón footer: `Guardar transferencia` con estado de loading.

### 4.2 Cuenta de destino: excluye el origen, y qué pasa si el origen cambia después

```html
<div class="flex flex-col gap-1.5">
  <Label for="cuenta-origen">Cuenta de origen</Label>
  <Select v-model="form.fromAccountId" :disabled="isSaving" @update:model-value="onOriginChange">
    <SelectTrigger id="cuenta-origen" class="h-11 w-full" :aria-invalid="!!errors.fromAccountId">
      <SelectValue placeholder="Elegí la cuenta de origen" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
        {{ account.name }}
      </SelectItem>
    </SelectContent>
  </Select>
  <p v-if="errors.fromAccountId" class="text-xs text-destructive">{{ errors.fromAccountId }}</p>
</div>

<div class="flex flex-col gap-1.5">
  <Label for="cuenta-destino">Cuenta de destino</Label>
  <Select v-model="form.toAccountId" :disabled="isSaving || !form.fromAccountId">
    <SelectTrigger id="cuenta-destino" class="h-11 w-full" :aria-invalid="!!errors.toAccountId">
      <SelectValue :placeholder="form.fromAccountId ? 'Elegí la cuenta de destino' : 'Elegí primero la cuenta de origen'" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="account in destinationOptions" :key="account.id" :value="account.id">
        {{ account.name }}
      </SelectItem>
    </SelectContent>
  </Select>
  <p v-if="errors.toAccountId" class="text-xs text-destructive">{{ errors.toAccountId }}</p>
</div>
```

Reglas de comportamiento:

- **`destinationOptions`**: `accountsStore.accounts` filtrado excluyendo
  `form.fromAccountId` — se recalcula automáticamente cada vez que cambia
  el origen (computed reactivo, no un snapshot tomado una vez al abrir el
  Sheet).
- **Destino deshabilitado hasta elegir origen** (`:disabled="!form.fromAccountId"`,
  con placeholder que lo explica: "Elegí primero la cuenta de origen") —
  refuerza el orden de decisión sin necesitar validación de submit para
  comunicarlo; no es un patrón nuevo inventado para esta feature, es la
  aplicación directa de "no fuerces al usuario a adivinar el orden
  correcto" con el mecanismo más simple disponible (`disabled` + copy en
  el placeholder).
- **Si el usuario cambia el origen y el destino ya elegido queda igual al
  nuevo origen**: se limpia `form.toAccountId` a `null` en
  `onOriginChange` (silencioso, sin toast ni mensaje de error — es
  exactamente el comportamiento esperable de "esa cuenta ya no es una
  opción válida de destino", reforzado porque `destinationOptions` ya no
  la incluye, así que el `Select` de destino queda visualmente vacío/con
  el placeholder, no roto ni mostrando una opción inválida).
- **Auto-selección cuando solo queda una opción de destino posible**: si
  tras elegir origen `destinationOptions.length === 1` (el usuario tiene
  exactamente 2 cuentas en total), se preselecciona esa única opción
  automáticamente — no hay ninguna decisión real que tomar, y forzar un
  segundo tap sobre un `Select` con una sola fila sería fricción sin
  beneficio (a diferencia del origen, donde sí puede haber más de una
  opción real entre la cual elegir). Si el usuario tiene 3+ cuentas,
  destino queda sin preseleccionar (fuerza elección consciente, igual que
  origen).

### 4.3 Guardado: NO optimista — mismo motivo estructural que Deudas, con un motivo adicional propio

**Decisión: alta, edición y borrado de una transferencia NO son
optimistas** — el Sheet permanece abierto en estado `Guardando…` hasta que
el servidor confirma. Esto cubre las **tres** operaciones (a diferencia de
Deudas, donde solo el alta de la cabecera era la excepción no-optimista y
los movimientos sueltos sí eran optimistas — sección 7.2 de
`debts-ux.md`).

Motivos, dos capas:

1. **Mismo motivo que el alta de deuda** (`debts-ux.md` sección 5.2): es
   una operación atómica de escritura múltiple vía RPC (dos cuentas +
   opcionalmente un gasto de comisión, sección 1.3) — el cliente no puede
   fabricar de antemano el resultado con confianza.
2. **Motivo adicional, propio de esta feature, que no tiene Deudas**: acá
   **editar o borrar** una transferencia existente es **también**
   multi-efecto (hay que reversar los deltas de las DOS cuentas viejas y
   la fila de comisión vieja —que puede no existir si era $0, sección
   1.2— antes de aplicar los nuevos), a diferencia de un `debt_movement`
   suelto (que solo toca un balance y es un único insert/update/delete,
   por eso Deudas sí lo trata como optimista, sección 7.2 de
   `debts-ux.md`). El perfil de complejidad de **editar/borrar una
   transferencia** es más parecido al de **crear el hilo completo de una
   deuda** (múltiples escrituras dependientes entre sí) que al de "abonar
   un movimiento sobre un hilo ya existente" — por eso acá las tres
   operaciones son no-optimistas, no solo la creación.

Consecuencia práctica de UX: el `AlertDialog` de borrado de la sección
3.3 y el submit de este Sheet dejan sus botones de confirmación en estado
de carga (`Loader2` + texto "Eliminando…"/"Guardando…") hasta la
respuesta real del servidor — nunca cierran optimistamente de antemano.
Tras confirmar, el store refresca `accountsStore.fetchBalances()` (cambio
en dos cuentas) y, si corresponde, inserta/actualiza/quita la fila de
comisión en el cache local de `expensesStore` con el dato que devuelva el
RPC — mismo patrón de "aplicar el resultado confirmado del servidor
directamente al cache local, sin re-fetch completo de página" ya usado
tras `debtsStore.createDebt`.

### 4.4 Comisión: prefill desde la cuenta de origen, recalculado al cambiar de origen, pero sin pisar una edición manual

```html
<div class="flex flex-col gap-1.5">
  <Label for="comision-transferencia">
    Comisión <span class="font-normal text-muted-foreground">(opcional)</span>
  </Label>
  <div class="flex items-center gap-1.5">
    <span class="text-sm text-muted-foreground">$</span>
    <Input
      id="comision-transferencia"
      v-model="form.commission"
      inputmode="decimal"
      type="text"
      placeholder="0"
      :disabled="isSaving"
      :aria-invalid="!!errors.commission"
      @input="commissionTouched = true"
    />
  </div>
  <p class="text-xs text-muted-foreground">
    A diferencia del monto de arriba, la comisión <strong class="font-medium text-foreground">sí es un gasto real</strong> —
    se descuenta de la cuenta de origen y vas a verla en Transacciones, Estadísticas y la categoría "Comisiones bancarias".
  </p>
  <p v-if="errors.commission" class="text-xs text-destructive">{{ errors.commission }}</p>
</div>
```

Lógica de sincronización (`onOriginChange`, mismo handler de la sección
4.2):

```ts
// Ilustrativo — AccountTransferFormSheet.vue
const commissionTouched = ref(false) // se resetea a false en resetForm()

function onOriginChange(accountId: string) {
  // Sección 4.2: limpiar destino si quedó igual al nuevo origen.
  if (form.toAccountId === accountId) form.toAccountId = null

  // Sección 4.4: el sugerido de la cuenta recién elegida SOLO pisa el campo
  // si el usuario todavía no lo editó a mano en esta sesión del formulario
  // — evita descartar silenciosamente un valor que el usuario ya ajustó
  // conscientemente, sin dejar de dar el valor por defecto útil en el caso
  // común (usuario que todavía no tocó el campo).
  if (!commissionTouched.value) {
    const account = accountsStore.accounts.find(a => a.id === accountId)
    form.commission = String(account?.transfer_commission ?? 0)
  }
}
```

- **En modo edición**: el campo Comisión se precarga con el valor
  **guardado de esa transferencia puntual** (`transfer.commissionAmount`),
  nunca recalculado desde el `transfer_commission` actual de la cuenta
  (que pudo haber cambiado desde que se creó esta transferencia) — mismo
  criterio que "Saldo inicial" de una cuenta ya existente
  (`accounts-income-ux.md` sección 6.3: editar no reinterpreta un dato ya
  guardado contra un default que cambió después). `commissionTouched` 
  arranca en `true` en modo edición (no en `false` como en alta) para que
  cambiar el origen durante una edición no pise silenciosamente el valor
  ya guardado — si el usuario quiere el sugerido de la nueva cuenta, lo
  escribe a mano.
- **Validación**: numérico, `>= 0` (a diferencia del Monto transferido,
  que es `> 0` — una comisión en $0 es válida y esperada, sección 1.2).
  Vacío se interpreta como `0`, igual que "Saldo inicial" de cuentas.

### 4.5 El copy de los dos efectos — dónde va cada mensaje

A diferencia de Deudas (un solo párrafo, un solo comportamiento a
explicar), acá hay **dos comportamientos distintos** que el usuario podría
confundir entre sí si se explican en un solo bloque de texto — se separan
en dos lugares, cada uno pegado al campo que describe, siguiendo el pedido
explícito del encargo de "marcar la diferencia con claridad, no asumir que
el usuario ya intuye la distinción":

1. **Bajo el campo Monto** (el que NO aparece como movimiento):

```html
<p class="text-xs text-muted-foreground">
  Movemos este monto de tu cuenta de origen a la de destino — este movimiento
  <strong class="font-medium text-foreground">no va a aparecer como gasto ni ingreso</strong>
  en tus listados, solo acá en Transferencias.
</p>
```

2. **Bajo el campo Comisión** (el que SÍ aparece, sección 4.4 ya lo
   incluye arriba) — repetido acá por completitud, es el mismo texto.

Mismas decisiones de estilo que ya justificó `debts-ux.md` sección 5.3 (no
reabiertas, solo confirmadas para este caso): texto siempre visible, no
condicional a haber tipeado un valor; la parte contraintuitiva en negrita
dentro del párrafo (`font-medium text-foreground`), sin color semántico
(`warning` sobredramatizaría algo que funciona exactamente como se
explica); sin `Alert` dedicado, el patrón ya establecido de helper text
`text-xs text-muted-foreground` alcanza.

### 4.6 Validación completa (resumen)

| Campo | Regla |
|---|---|
| Cuenta de origen | Requerido |
| Cuenta de destino | Requerido, distinto de origen (reforzado por `destinationOptions`, sección 4.2 — no hace falta un mensaje de error para este caso porque la UI ya lo impide de antemano) |
| Monto | Requerido, numérico, `> 0` |
| Comisión | Opcional, numérico, `>= 0`, default `0` si vacío |
| Fecha | Requerido, no futura (`isFutureDate`, ya existente en `src/lib/date.ts`) |
| Descripción | Opcional, `maxlength="200"` |

---

## 5. Campo nuevo en `AccountFormSheet.vue` — comisión sugerida por cuenta

### 5.1 Dónde va: último campo, después de "Saldo inicial"

`AccountFormSheet.vue` ya tiene, en este orden: Nombre → Color → Ícono →
Saldo inicial (`accounts-income-ux.md` sección 6.3, confirmado contra el
código real de `src/components/AccountFormSheet.vue`). El campo nuevo va
**al final**, después de "Saldo inicial" — mismo criterio de ordenar por
"identidad de la cuenta primero, configuración financiera después" ya
usado para ubicar "Saldo inicial" al final en su momento; "Comisión de
transferencia sugerida" es, en ese mismo eje, un dato de configuración
todavía más secundario que el saldo inicial (una cuenta se usa
plenamente sin nunca configurar esto, a diferencia del saldo inicial que
sí afecta el número de saldo mostrado desde el día uno).

```html
<div class="flex flex-col gap-1.5">
  <Label for="comision-sugerida">
    Comisión de transferencia sugerida <span class="font-normal text-muted-foreground">(opcional)</span>
  </Label>
  <div class="flex items-center gap-1.5">
    <span class="text-sm text-muted-foreground">$</span>
    <Input
      id="comision-sugerida"
      v-model="form.transferCommission"
      inputmode="decimal"
      type="text"
      placeholder="0"
      :disabled="isSaving"
      :aria-invalid="!!errors.transferCommission"
    />
  </div>
  <p class="text-xs text-muted-foreground">
    Se usa como monto sugerido cada vez que transferís plata DESDE esta cuenta hacia otra —
    vas a poder cambiarlo en cada transferencia puntual.
  </p>
  <p v-if="errors.transferCommission" class="text-xs text-destructive">{{ errors.transferCommission }}</p>
</div>
```

- **Validación**: numérico, `>= 0` (nunca negativo, a diferencia de "Saldo
  inicial" que sí admite negativo) — una comisión no puede ser un valor
  negativo con sentido real. Vacío se interpreta como `0`.
- **Solo aplica cuando la cuenta es el ORIGEN de una transferencia** (el
  copy lo aclara explícitamente con "DESDE esta cuenta" en mayúsculas
  discretas) — evita la confusión de que el usuario piense que también
  afecta transferencias donde esta cuenta es el destino, algo que no
  tiene sentido de dominio (la comisión bancaria la cobra el banco de
  origen del envío, no el de recepción).
- **Guardado**: mismo patrón 100% optimista ya establecido para
  `AccountFormSheet.vue` (`accounts-income-ux.md` sección 6.3) — este
  campo nuevo no introduce ningún conflicto server-only, se agrega a la
  misma mutación optimista existente sin cambiar su naturaleza.

---

## 6. Categoría default nueva — "Comisiones bancarias"

### 6.1 Seed sugerido

Mismo patrón de las 10 categorías default ya sembradas
(`20260716142006_categories_init.sql`, `user_id null`, `icon` emoji,
`color` hex literal):

```sql
-- Ilustrativo — a incorporar en una migración nueva de
-- supabase-backend-expert, no se edita la migración original ya aplicada.
insert into public.categories (name, icon, color) values
  ('Comisiones bancarias', '🏦', '#475569');
```

- **Ícono**: `🏦` (edificio de banco) — no colisiona semánticamente con
  ninguno de los 10 emojis ya sembrados, y comunica "esto es
  administrativo/bancario", distinto del resto (comida, transporte, etc.)
  que son categorías de consumo discrecional.
- **Color**: `#475569` (un gris azulado, "slate", deliberadamente más
  apagado que los 10 tonos vívidos ya sembrados) — la elección de un tono
  más neutro es intencional: esta categoría representa un gasto
  administrativo/automático (generado por el sistema al transferir), no
  una elección discrecional del usuario como el resto — un tono más
  serio/apagado refuerza esa diferencia de naturaleza sin necesitar
  ningún tratamiento visual especial fuera del color en sí. **Nota
  honesta, mismo criterio de transparencia que ya usó
  `accounts-income-ux.md` sección 4.2 para su propia paleta**: este hex
  no fue corrido todavía contra `validate_palette.js` de la skill de
  dataviz junto a los 10 colores ya sembrados (el hallazgo ya conocido y
  documentado de Vivienda/Transporte, sección 0.4 de
  `dashboard-redesign-ux.md`, es evidencia de que la paleta de categorías
  actual no está 100% validada). Se recomienda a `supabase-backend-expert`/
  `ui-ux-designer` correr esa validación en conjunto con los 10 hex
  existentes antes de aplicar la migración — no bloquea el resto de este
  documento, es la misma deuda técnica ya reconocida para la paleta de
  categorías, extendida a un 11º valor.
- La dona de categorías (`CategoryDonutChart`) y cualquier listado que ya
  itere `categoriesStore.categories` recibe esta categoría nueva **sin
  ningún cambio de código** — es una fila más en la misma tabla, el
  frontend ya está genéricamente preparado para N categorías.

### 6.2 La categoría es seleccionable manualmente también, sin restricción

"Comisiones bancarias" es una categoría default como cualquier otra —
nada le impide al usuario elegirla a mano al cargar un gasto manual sin
relación con ninguna transferencia (p. ej. un cargo de mantenimiento de
cuenta que el banco cobra sin que medie una transferencia). Esto es
correcto y esperado, no un caso a bloquear — el único comportamiento
especial (sección 6.3) aplica a la fila puntual **generada
automáticamente** por una transferencia, identificada por
`expenses.account_transfer_id`, no a la categoría en sí.

### 6.3 Gasto de comisión generado automáticamente: visible pero con edición restringida — punto para reconciliar con backend

Esto excede lo que pidió explícitamente el encargo, pero surge
directamente de la estrategia de datos de la sección 1 y vale la pena
dejarlo explícito en vez de descubrirlo tarde en implementación —
**se documenta como recomendación, no como requisito cerrado**, siguiendo
el mismo criterio que el punto 1 del encargo pidió para el supuesto de
no-visibilidad: no rediseñar el modelo yo mismo, dejarlo para que el
Product Owner reconcilie con backend si corresponde.

**El problema**: si el gasto de comisión generado por una transferencia
es una fila de `expenses` idéntica a cualquier otra, nada impide que el
usuario la edite o la borre directamente desde `/transacciones` — pero
esa fila está atada a `account_transfers.commission_amount` (sección 1.3).
Si se edita/borra desde Transacciones sin que la transferencia dueña se
entere, quedan desincronizadas: el listado de `/transferencias` seguiría
mostrando una comisión que ya no coincide con el gasto real (o que ya no
existe).

**Recomendación (no impuesta)**: en `TransactionsView.vue`, las filas
donde `expense.account_transfer_id` no es `null` muestran un badge
pequeño ("Vinculado a una transferencia", con el mismo ícono
`ArrowRightLeft` de la sección 7) y su menú `⋮` **no ofrece Editar/
Eliminar directo** — en su lugar, un único ítem "Ver transferencia" que
navega a `/transferencias` (sin resaltado puntual de cuál fila, dado que
no hay ruta de detalle, sección 2). Editar o borrar la comisión real se
hace exclusivamente desde el Sheet/menú de la transferencia dueña
(sección 4.3), que ya maneja el efecto combinado de forma atómica. Mismo
espíritu que el badge de cuenta vinculada de `debt_movements`
(`debts-ux.md` sección 6.2: "no dejarlo invisible una vez guardado"),
aplicado acá también a restringir la edición, no solo a mostrar el
vínculo.

**Alternativa más simple, si el Product Owner prefiere no tocar
`TransactionsView.vue` en esta iteración**: dejar la fila de comisión
100% editable/borrable desde Transacciones como cualquier otro gasto,
aceptando la posible desincronización con `/transferencias` como
limitación conocida (documentada, no silenciosa) — de las dos, la primera
opción es la recomendada por consistencia de datos, pero la segunda es
significativamente más barata de implementar y no bloquea el resto de
esta feature. Se deja explícitamente a criterio del Product Owner cuál
de las dos priorizar, con la recomendación técnica ya sentada.

---

## 7. Ítem nuevo del drawer

### 7.1 Ícono elegido: `ArrowRightLeft`, no `Repeat`/`Shuffle`

Confirmado en `node_modules/@lucide/vue/dist/esm/icons/` que
`arrow-right-left.mjs` existe como archivo **distinto** de
`arrow-left-right.mjs` (ya en uso por "Transacciones") — no son alias del
mismo ícono. Visualmente, `ArrowLeftRight` es una única flecha con puntas
en ambos extremos (↔, "va y viene" genérico); `ArrowRightLeft` son dos
flechas apiladas apuntando en direcciones opuestas (⇄, el ícono clásico de
"swap/intercambio" que ya usan la mayoría de apps bancarias/fintech para
"transferir entre cuentas") — suficientemente distinto en composición
visual como para no confundirse a un vistazo rápido con el ícono ya
asignado a Transacciones, y semánticamente más preciso ("intercambiar
entre dos cosas puntuales" vs. "ida y vuelta genérica").

Se descartaron los otros candidatos sugeridos:

- **`Repeat`**: comunica "repetición/ciclo recurrente" — semánticamente
  más cercano a "Gastos fijos" (que ya usa `CalendarSync`, un concepto de
  recurrencia) que a "mover dinero entre dos cuentas puntuales". Usarlo
  acá arriesgaría confusión cruzada con esa otra sección.
- **`Shuffle`**: asociado casi universalmente a "aleatorizar/mezclar"
  (audio, listas) — no transmite "mover algo específico de un lugar
  conocido a otro lugar conocido", que es exactamente lo opuesto a
  aleatorio.

### 7.2 Posición: 5ª de 12 (entre Cuentas y Deudas)

Orden actual confirmado contra `src/components/NavigationDrawer.vue` (11
ítems): Inicio, Transacciones, Tarjetas de crédito, Cuentas, Deudas,
Gastos fijos, Partidos en vivo, Categorías, Estadísticas, Reportes,
Ajustes.

**Transferencias se inserta entre Cuentas y Deudas** (posición 5, todo lo
demás corre un lugar):

1. Inicio
2. Transacciones
3. Tarjetas de crédito
4. Cuentas
5. **Transferencias** ← nuevo
6. Deudas
7. Gastos fijos
8. Partidos en vivo
9. Categorías
10. Estadísticas
11. Reportes
12. Ajustes

Justificación: dentro del bloque ya establecido de "dominios de
movimientos de dinero" (Transacciones/Tarjetas/Cuentas/Deudas/Gastos
fijos), Transferencias es, de las cinco, la que tiene el vínculo más
directo y exclusivo con **Cuentas** — no tiene sentido conceptual sin
que existan cuentas (opera exclusivamente sobre ellas, sección 1),
mientras que Deudas involucra una entidad externa (contrapartes) y
Gastos fijos es un concepto de recurrencia/plantilla, ambos un paso más
alejados de "las cuentas en sí". Ubicarla inmediatamente después de
Cuentas agrupa "gestionar mis cuentas" (Cuentas) junto con "mover plata
entre ellas" (Transferencias) antes de pasar a conceptos que involucran a
terceros (Deudas) o recurrencia (Gastos fijos) — mismo criterio de
agrupar por relación conceptual más cercana ya usado para justificar el
orden interno de ese bloque en iteraciones anteriores.

```ts
type NavRouteName =
  | 'home'
  | 'transactions'
  | 'cards'
  | 'accounts'
  | 'account-transfers' // nuevo
  | 'debts'
  | 'fixed-expenses'
  | 'matches'
  | 'categories'
  | 'statistics'
  | 'reports'
  | 'settings'
```

```html
<!-- Insertar entre el botón de 'accounts' y el de 'debts' en NavigationDrawer.vue -->
<button
  type="button"
  class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :class="isActive('account-transfers') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
  :aria-current="isActive('account-transfers') ? 'page' : undefined"
  @click="navigateFromDrawer('account-transfers')"
>
  <ArrowRightLeft class="size-5 shrink-0" />
  Transferencias
</button>
```

`ArrowRightLeft` se agrega al import de `@lucide/vue` en
`NavigationDrawer.vue`, junto al resto de íconos ya importados.

---

## 8. Resumen de estados del contenedor (checklist)

| Estado | Contenido |
|---|---|
| Carga | `Skeleton` × 4, mismo bloque que `TransactionsView.vue` |
| Error | `AlertCircle` + "No pudimos cargar tus transferencias" + Reintentar |
| Vacío — menos de 2 cuentas | Sección 3.6 variante A, sin FAB |
| Vacío — sin transferencias | Sección 3.6 variante B, con FAB/botón |
| Con datos | Listado agrupado por fecha (sección 3.3) + Card opcional de comisiones del mes (sección 3.2) + FAB |

---

## Resumen para `vue-frontend-expert`

1. Ruta nueva `/transferencias` (`name: 'account-transfers'`), sin ruta de
   detalle (sección 2).
2. Vista `AccountTransfersView.vue`: `AppHeader title="Transferencias"`
   (nunca un `<header>` con "Volver" — sección 6 de `design-system.md`),
   guard de "al menos 2 cuentas" (sección 3.1), Card opcional de
   comisiones del mes (sección 3.2, prescindible), listado agrupado por
   fecha (sección 3.3) calcado del patrón de `TransactionsView.vue`, FAB
   condicional (sección 3.7).
3. Componente nuevo `AccountTransferFormSheet.vue`: origen/destino con
   exclusión mutua y auto-limpieza (sección 4.2), comisión con prefill
   "inteligente" que respeta ediciones manuales (sección 4.4), guardado
   NO optimista en las tres operaciones (sección 4.3), copy de los dos
   efectos en dos bloques separados (sección 4.5).
4. Campo nuevo en `AccountFormSheet.vue`: "Comisión de transferencia
   sugerida" al final del formulario (sección 5), 100% optimista como el
   resto del Sheet.
5. Ícono nuevo del drawer `ArrowRightLeft` en posición 5 de 12, entre
   Cuentas y Deudas (sección 7).
6. **Puntos a reconciliar con `supabase-backend-expert`/Product Owner
   antes o durante la implementación** (no bloquean el diseño, pero sí
   afectan el esquema):
   - Modelo ilustrativo de `account_transfers`/`accounts.transfer_commission`/
     `expenses.account_transfer_id` (sección 1.3) — nombres/columnas a
     confirmar.
   - RPC atómico recomendado para crear/editar/borrar una transferencia
     (secciones 1.3 y 4.3), con la complejidad extra de editar (reversar
     deltas viejos de dos cuentas + fila de comisión que puede no
     existir).
   - Seed de la categoría "Comisiones bancarias" (sección 6.1) — el color
     `#475569` propuesto no fue validado todavía con `validate_palette.js`
     contra los 10 hex ya sembrados.
   - Si se restringe o no la edición directa de la fila de comisión desde
     `/transacciones` (sección 6.3) — recomendación dada, decisión final
     pendiente del Product Owner.
