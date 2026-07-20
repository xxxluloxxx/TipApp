<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftRight,
  CalendarSync,
  ChartPie,
  CreditCard,
  FileText,
  Goal,
  HandCoins,
  Home,
  LogOut,
  Menu,
  Settings,
  Tag,
  Wallet,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetFooter, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

// Drawer de navegación principal, autocontenido y reusable desde cualquier
// pantalla autenticada (dashboard-redesign-ux.md, sección 6.1 + patrón de
// header único documentado en design-system.md): botón `Menu` que abre el
// Sheet lateral con perfil + nav de 11 ítems (highlight de ruta activa) +
// "Cerrar sesión". Antes vivía solo dentro de HomeView.vue; se extrajo para
// que todas las vistas lo compartan sin duplicar el markup.

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const accountLabel = computed(() => authStore.profile?.display_name || authStore.user?.email || '')
const showEmailSecondary = computed(() => !!authStore.profile?.display_name)
const avatarInitial = computed(() => accountLabel.value.charAt(0).toUpperCase() || '?')

const isDrawerOpen = ref(false)

type NavRouteName =
  | 'home'
  | 'transactions'
  | 'cards'
  | 'accounts'
  | 'debts'
  | 'fixed-expenses'
  | 'matches'
  | 'categories'
  | 'statistics'
  | 'reports'
  | 'settings'

function isActive(name: NavRouteName): boolean {
  return route.name === name
}

function navigateFromDrawer(name: NavRouteName) {
  isDrawerOpen.value = false
  if (route.name !== name) {
    router.push({ name })
  }
}

async function onLogout() {
  await authStore.signOut()
  await router.push('/login')
  toast('Sesión cerrada')
}

function logoutFromDrawer() {
  isDrawerOpen.value = false
  onLogout()
}
</script>

<template>
  <Sheet v-model:open="isDrawerOpen">
    <SheetTrigger as-child>
      <Button variant="ghost" size="icon" aria-label="Abrir menú">
        <Menu class="size-5" />
      </Button>
    </SheetTrigger>
    <SheetContent side="left" class="p-0">
      <div class="flex items-center gap-3 border-b border-border p-6 pr-14">
        <SheetTitle class="sr-only">
          Menú principal
        </SheetTitle>
        <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {{ avatarInitial }}
        </div>
        <div class="flex min-w-0 flex-col">
          <p class="truncate text-base font-semibold text-foreground">
            {{ accountLabel }}
          </p>
          <p v-if="showEmailSecondary" class="truncate text-sm text-muted-foreground">
            {{ authStore.user?.email }}
          </p>
        </div>
      </div>

      <nav class="flex flex-col gap-1 p-3">
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('home') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('home') ? 'page' : undefined"
          @click="navigateFromDrawer('home')"
        >
          <Home class="size-5 shrink-0" />
          Inicio
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('transactions') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('transactions') ? 'page' : undefined"
          @click="navigateFromDrawer('transactions')"
        >
          <ArrowLeftRight class="size-5 shrink-0" />
          Transacciones
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('cards') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('cards') ? 'page' : undefined"
          @click="navigateFromDrawer('cards')"
        >
          <CreditCard class="size-5 shrink-0" />
          Tarjetas de crédito
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('accounts') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('accounts') ? 'page' : undefined"
          @click="navigateFromDrawer('accounts')"
        >
          <Wallet class="size-5 shrink-0" />
          Cuentas
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('debts') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('debts') ? 'page' : undefined"
          @click="navigateFromDrawer('debts')"
        >
          <HandCoins class="size-5 shrink-0" />
          Deudas
        </button>
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
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('matches') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('matches') ? 'page' : undefined"
          @click="navigateFromDrawer('matches')"
        >
          <Goal class="size-5 shrink-0" />
          Partidos en vivo
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('categories') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('categories') ? 'page' : undefined"
          @click="navigateFromDrawer('categories')"
        >
          <Tag class="size-5 shrink-0" />
          Categorías
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('statistics') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('statistics') ? 'page' : undefined"
          @click="navigateFromDrawer('statistics')"
        >
          <ChartPie class="size-5 shrink-0" />
          Estadísticas
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('reports') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('reports') ? 'page' : undefined"
          @click="navigateFromDrawer('reports')"
        >
          <FileText class="size-5 shrink-0" />
          Reportes
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isActive('settings') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
          :aria-current="isActive('settings') ? 'page' : undefined"
          @click="navigateFromDrawer('settings')"
        >
          <Settings class="size-5 shrink-0" />
          Ajustes
        </button>
      </nav>

      <SheetFooter class="border-t border-border">
        <button
          type="button"
          class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          @click="logoutFromDrawer"
        >
          <LogOut class="size-5 shrink-0" />
          Cerrar sesión
        </button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
