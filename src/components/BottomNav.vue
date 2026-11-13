<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftRight, Home, Wallet } from '@lucide/vue'

// Barra inferior fija con los 3 destinos más usados. Convive con el drawer
// lateral (que sigue teniendo todas las secciones). Solo en rutas con sesión.

const route = useRoute()
const router = useRouter()

const visible = computed(() => !!route.meta.requiresAuth)

const items = [
  { name: 'home', label: 'Inicio', icon: Home, matches: ['home'] },
  { name: 'transactions', label: 'Transacciones', icon: ArrowLeftRight, matches: ['transactions'] },
  { name: 'accounts', label: 'Cuentas', icon: Wallet, matches: ['accounts', 'account-detail'] },
]

function isActive(matches: string[]): boolean {
  return matches.includes(String(route.name))
}

function go(name: string) {
  if (route.name !== name) void router.push({ name })
}
</script>

<template>
  <template v-if="visible">
    <!-- Espaciador: evita que la barra tape el final del contenido. -->
    <div aria-hidden="true" style="height: calc(3.5rem + env(safe-area-inset-bottom))" />
    <nav
      aria-label="Navegación principal"
      class="fixed inset-x-0 bottom-0 z-30 border-b-0 border-t border-border bg-background"
      style="padding-bottom: env(safe-area-inset-bottom)"
    >
      <ul class="mx-auto flex h-14 max-w-md items-stretch">
        <li v-for="item in items" :key="item.name" class="flex-1">
          <button
            type="button"
            class="flex size-full min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="isActive(item.matches) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
            :aria-current="isActive(item.matches) ? 'page' : undefined"
            @click="go(item.name)"
          >
            <component :is="item.icon" class="size-5" />
            {{ item.label }}
          </button>
        </li>
      </ul>
    </nav>
  </template>
</template>
