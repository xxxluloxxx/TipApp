<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertCircle, ArrowLeft, EllipsisVertical, Pencil, Plus, RotateCcw, Trash2, Wallet } from '@lucide/vue'
import { readableTextColor, resolveAccountColor } from '@/lib/colors'
import { resolveAccountIcon } from '@/lib/accountIcons'
import { formatAmount } from '@/lib/currency'
import { useAccountsStore, type Account } from '@/stores/accounts'
import AccountFormSheet from '@/components/AccountFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card'
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

// Sección 6.1/6.2 de accounts-income-ux.md: única ruta dedicada `/cuentas`,
// mismo patrón que `CategoriesView.vue` (listado + punto de entrada del
// Sheet de alta/edición) — sin split "predeterminadas/mías": todas las
// cuentas son del usuario, no hay concepto de cuenta "del sistema".

const router = useRouter()
const route = useRoute()
const accountsStore = useAccountsStore()

const isDarkNow = ref(document.documentElement.classList.contains('dark'))

const isInitialLoading = ref(true)
const loadError = ref(false)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [accountsOk, balancesOk, countsOk] = await Promise.all([
      accountsStore.fetchAccounts(),
      accountsStore.fetchBalances(),
      accountsStore.fetchUsageCounts(),
    ])
    if (!accountsOk || !balancesOk || !countsOk) loadError.value = true
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
    <header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-xl font-semibold">
        Cuentas
      </h1>
    </header>

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

          <div v-else class="flex flex-col">
            <template v-for="(account, idx) in accountsStore.accounts" :key="account.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3">
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
                    :class="accountsStore.balanceFor(account.id) < 0 ? 'text-destructive' : 'text-foreground'"
                  >
                    {{ accountsStore.balanceFor(account.id) < 0 ? '-' : '' }}${{ formatAmount(Math.abs(accountsStore.balanceFor(account.id))) }}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" :aria-label="`Opciones de ${account.name}`">
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
        </Card>
      </template>
    </main>

    <AccountFormSheet v-model:open="isSheetOpen" :account="editingAccount" />
  </div>
</template>
