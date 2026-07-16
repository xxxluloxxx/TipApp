<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { useAuthStore } from '@/stores/auth'
import { Toaster } from '@/components/ui/sonner'

const authStore = useAuthStore()

onMounted(() => {
  void authStore.initialize()
})

// El registro por defecto (registerSW.js autoinyectado) solo llama a
// `register()`: el nuevo service worker activa en segundo plano
// (skipWaiting + clientsClaim, ya configurados en vite.config.ts), pero la
// pestaña ya abierta se queda corriendo el JS viejo hasta que recarga. Con
// `registerType: 'autoUpdate'` la intención es que el usuario nunca tenga
// que forzar el cierre de la app instalada para ver cambios — por eso acá se
// recarga automáticamente en cuanto hay una versión nueva lista.
const { needRefresh, updateServiceWorker } = useRegisterSW()
watch(needRefresh, (value) => {
  if (value) void updateServiceWorker(true)
})
</script>

<template>
  <!-- Splash mínimo mientras se resuelve la sesión al refrescar (sección 4.3
       de expenses-mvp-ux.md): sin `router-view` montado todavía, para evitar
       el "flash" de login/home incorrecto. -->
  <div
    v-if="authStore.status === 'pending'"
    class="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-foreground"
  >
    <h1 class="text-2xl font-bold">
      TipApp
    </h1>
  </div>

  <template v-else>
    <RouterView />
    <Toaster rich-colors />
  </template>
</template>
