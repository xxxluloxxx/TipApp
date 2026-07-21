<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChartLine,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from '@lucide/vue'
import { readableTextColor, resolveAccountColor, withAlpha } from '@/lib/colors'
import { resolveAccountIcon } from '@/lib/accountIcons'
import { formatAmount } from '@/lib/currency'
import { addMonths, formatDateOnly, monthNameOnly, startOfMonth } from '@/lib/date'
import { supabase } from '@/lib/supabase'
import { useAccountsStore, type Account } from '@/stores/accounts'
import AppHeader from '@/components/AppHeader.vue'
import AccountFormSheet from '@/components/AccountFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// Sección 6.1/6.2 + rediseño de la sección 13 de accounts-income-ux.md: única
// ruta dedicada `/cuentas` (listado + punto de entrada del Sheet de alta/
// edición), ahora con hero de "Saldo total" (13.1), chevron/color de saldo por
// fila (13.2) y modo "Ordenar" con botones ↑/↓ (13.3).

const route = useRoute()
const router = useRouter()
const accountsStore = useAccountsStore()

const isDarkNow = ref(document.documentElement.classList.contains('dark'))

const isInitialLoading = ref(true)
const loadError = ref(false)

// Neto de movimientos (ingresos - gastos) del mes en curso, acotado por fecha
// contra la tabla real (nunca una lista global capada, sección 13.1.3) — base
// del indicador de variación del hero. `null` = sin señal confiable (fetch
// falló) → el hero se muestra sin delta, nunca con un número inventado.
const monthNet = ref<number | null>(null)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  const monthStartKey = formatDateOnly(startOfMonth(new Date()))
  try {
    const [accountsOk, balancesOk, countsOk, expensesRes, incomesRes] = await Promise.all([
      accountsStore.fetchAccounts(),
      accountsStore.fetchBalances(),
      accountsStore.fetchUsageCounts(),
      // Sección 13.1.3: transferencias entre cuentas propias son suma-cero a
      // nivel agregado, así que NO hace falta consultar `account_transfers`
      // para este total — alcanza con `expenses`/`incomes` (la comisión de una
      // transferencia ya es una fila real de `expenses`, se cuenta sin trato
      // especial). Ambas queries acotadas por fecha (`gte`), seguras sin
      // `isMonthSafeToShow`.
      supabase.from('expenses').select('amount').gte('expense_date', monthStartKey),
      supabase.from('incomes').select('amount').gte('income_date', monthStartKey),
    ])
    if (!accountsOk || !balancesOk || !countsOk) loadError.value = true
    if (expensesRes.error || incomesRes.error) {
      monthNet.value = null
    } else {
      monthNet.value
        = (incomesRes.data ?? []).reduce((sum, i) => sum + i.amount, 0)
          - (expensesRes.data ?? []).reduce((sum, e) => sum + e.amount, 0)
    }
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(async () => {
  await loadAll()
  // Sección 6.2: soporte de `?new=1`, llegada desde la tile "Agregar cuenta"
  // de Inicio (sección 2.3) — mismo patrón que `?new=1` de Transacciones.
  if (route.query.new === '1') openAddSheet()
})

// Sección 13.1.3: el "saldo de arranque" del mes se deriva de dos números ya
// seguros (el total agregado de servidor, siempre correcto, menos el neto de
// movimientos del mes acotado por fecha) — nunca sumando historial completo.
const startOfMonthBalance = computed(() => accountsStore.totalBalance - (monthNet.value ?? 0))

const previousMonthName = computed(() => monthNameOnly(addMonths(startOfMonth(new Date()), -1)))

// Indicador de variación del hero (sección 13.1.3): más saldo = bueno
// (`up`/success), menos = malo (`down`/destructive), deliberadamente opuesto a
// "Total del mes" (stock vs. flujo). Caso borde `startOfMonthBalance === 0`:
// se muestra el monto con signo en vez de dividir por cero (nunca `Infinity%`).
const totalBalanceDelta = computed(() => {
  if (monthNet.value === null) return null
  const delta = accountsStore.totalBalance - startOfMonthBalance.value
  if (delta === 0) return null
  const direction: 'up' | 'down' = delta >= 0 ? 'up' : 'down'

  if (startOfMonthBalance.value === 0) {
    const sign = delta >= 0 ? '+' : '-'
    return { direction, label: `${sign}$${formatAmount(Math.abs(delta))}` }
  }
  const pct = (delta / Math.abs(startOfMonthBalance.value)) * 100
  const sign = pct >= 0 ? '+' : ''
  return { direction, label: `${sign}${pct.toFixed(0)}%` }
})

function usageLabel(accountId: string): string {
  const count = accountsStore.countFor(accountId)
  if (count === 0) return 'Sin movimientos'
  return count === 1 ? '1 movimiento' : `${count} movimientos`
}

// Sección 6.4: dos guards, no uno — nunca la última cuenta (incluso sin
// movimientos), y nunca una cuenta con movimientos asociados.
function canDelete(accountId: string): boolean {
  if (accountsStore.accounts.length <= 1) return false
  return accountsStore.countFor(accountId) === 0
}

// Sección 13.2.2: color del saldo de fila — combinado, no reemplazo total.
// `text-destructive` (por clase) cuando es negativo, color de la cuenta
// (por `style`) cuando es `>= 0` — la señal de alerta de un descubierto nunca
// se pierde a manos del color decorativo de la cuenta.
function balanceColorStyle(account: Account): string | undefined {
  const balance = accountsStore.balanceFor(account.id)
  if (balance < 0) return undefined
  return resolveAccountColor(account.color ?? '#6b7280', isDarkNow.value)
}

// Sección 13.3.2: "Ordenar" es un modo dentro de la misma vista, no una ruta
// nueva. El botón alterna su texto/ícono a "Listo" mientras está activo.
const isOrderingMode = ref(false)
function toggleOrderingMode() {
  isOrderingMode.value = !isOrderingMode.value
}

function moveAccount(index: number, direction: -1 | 1) {
  accountsStore.moveAccount(index, direction)
}

// Estado del Sheet de alta/edición.
const isSheetOpen = ref(false)
const editingAccount = ref<Account | null>(null)

function openAddSheet() {
  editingAccount.value = null
  isSheetOpen.value = true
}
function openEditSheet(account: Account) {
  editingAccount.value = account
  isSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Cuentas" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tus cuentas
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="i in 3" :key="i">
              <Separator v-if="i > 1" />
              <div class="flex items-center gap-3 px-4 py-3">
                <Skeleton class="size-10 rounded-lg" />
                <div class="flex flex-1 flex-col gap-1.5">
                  <Skeleton class="h-4 w-32" />
                  <Skeleton class="h-3 w-20" />
                </div>
                <Skeleton class="h-4 w-16" />
              </div>
            </template>
          </div>
        </Card>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus cuentas
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadAll">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else>
        <!-- Hero "Saldo total" (sección 13.1): se oculta si el usuario no
             tiene ninguna cuenta (no hay saldo que mostrar). -->
        <Card v-if="accountsStore.accounts.length > 0">
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

            <!-- Ícono decorativo (sección 13.1.4): NO es un botón, no navega. -->
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10"
              aria-hidden="true"
            >
              <ChartLine class="size-4 text-primary" />
            </span>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader class="flex-row items-center justify-between gap-2">
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tus cuentas
            </CardTitle>
            <CardAction class="flex items-center gap-1">
              <!-- Sección 13.3.2: "Ordenar" ↔ "Listo", oculto con <= 1 cuenta
                   (no hay orden posible que cambiar). -->
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
              <!-- "Nueva cuenta" se oculta por completo durante el modo
                   "Ordenar" (sección 13.3.2). -->
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

          <!-- Estado vacío (sección 6.2): salvaguarda defensiva, no debería
               ocurrir en la práctica (la cuenta "General" se crea sola). -->
          <div v-if="accountsStore.accounts.length === 0" class="flex flex-col items-center gap-2 px-4 py-8">
            <Wallet class="size-8 text-muted-foreground" />
            <p class="text-center text-sm font-medium">
              Todavía no tenés ninguna cuenta.
            </p>
            <Button variant="outline" @click="openAddSheet">
              <Plus class="size-4" />
              Nueva cuenta
            </Button>
          </div>

          <!-- Modo normal: fila navegable con saldo + chevron + menú ⋮. -->
          <div v-else-if="!isOrderingMode" class="flex flex-col">
            <template v-for="(account, idx) in accountsStore.accounts" :key="account.id">
              <Separator v-if="idx > 0" />
              <div
                class="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
                role="button"
                tabindex="0"
                :aria-label="`Ver detalle de ${account.name}`"
                @click="router.push({ name: 'account-detail', params: { id: account.id } })"
                @keydown.enter="router.push({ name: 'account-detail', params: { id: account.id } })"
              >
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-lg"
                  :style="{ backgroundColor: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
                >
                  <component
                    :is="resolveAccountIcon(account.icon)"
                    class="size-4.5"
                    :style="{ color: readableTextColor(resolveAccountColor(account.color ?? '#6b7280', isDarkNow)) }"
                  />
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ account.name }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ usageLabel(account.id) }}
                  </p>
                </div>
                <div class="flex flex-col items-end gap-0.5">
                  <p
                    class="text-sm font-semibold tabular-nums"
                    :class="accountsStore.balanceFor(account.id) < 0 ? 'text-destructive' : undefined"
                    :style="accountsStore.balanceFor(account.id) < 0 ? undefined : { color: balanceColorStyle(account) }"
                  >
                    {{ accountsStore.balanceFor(account.id) < 0 ? '-' : '' }}${{ formatAmount(Math.abs(accountsStore.balanceFor(account.id))) }}
                  </p>
                </div>
                <!-- Chevron: afordancia visual de fila clickeable (sección
                     13.2.1), `aria-hidden` — la acción ya la anuncia el
                     `aria-label` de la fila. -->
                <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" :aria-label="`Opciones de ${account.name}`" @click.stop>
                      <EllipsisVertical class="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEditSheet(account)">
                      <Pencil class="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem
                          variant="destructive"
                          :disabled="!canDelete(account.id)"
                          @select="(e: Event) => e.preventDefault()"
                        >
                          <Trash2 class="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar "{{ account.name }}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="accountsStore.deleteAccount(account.id)">
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </template>
          </div>

          <!-- Modo "Ordenar" (sección 13.3.3): sin navegación, sin menú ⋮, sin
               saldo/subtítulo — solo ícono + nombre + botones ↑/↓. -->
          <div v-else class="flex flex-col">
            <template v-for="(account, idx) in accountsStore.accounts" :key="account.id">
              <Separator v-if="idx > 0" />
              <div
                class="flex items-center gap-3 px-4 py-3"
                :style="{ backgroundColor: withAlpha(resolveAccountColor(account.color ?? '#6b7280', isDarkNow), 0.16) }"
              >
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-lg"
                  :style="{ backgroundColor: resolveAccountColor(account.color ?? '#6b7280', isDarkNow) }"
                >
                  <component
                    :is="resolveAccountIcon(account.icon)"
                    class="size-4.5"
                    :style="{ color: readableTextColor(resolveAccountColor(account.color ?? '#6b7280', isDarkNow)) }"
                  />
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ account.name }}
                  </p>
                </div>

                <div class="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    :aria-label="`Subir ${account.name}`"
                    :disabled="idx === 0 || accountsStore.isReordering"
                    @click="moveAccount(idx, -1)"
                  >
                    <ChevronUp class="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    :aria-label="`Bajar ${account.name}`"
                    :disabled="idx === accountsStore.accounts.length - 1 || accountsStore.isReordering"
                    @click="moveAccount(idx, 1)"
                  >
                    <ChevronDown class="size-4" />
                  </Button>
                </div>
              </div>
            </template>
          </div>
        </Card>
      </template>
    </main>

    <AccountFormSheet v-model:open="isSheetOpen" :account="editingAccount" />
  </div>
</template>
