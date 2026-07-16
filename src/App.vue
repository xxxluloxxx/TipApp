<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { Toaster } from '@/components/ui/sonner'

const authStore = useAuthStore()

onMounted(() => {
  void authStore.initialize()
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
