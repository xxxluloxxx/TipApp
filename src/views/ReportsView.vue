<script setup lang="ts">
import { FileText } from '@lucide/vue'
import AppHeader from '@/components/AppHeader.vue'

// Sección 8 de dashboard-redesign-ux.md: estado "Próximamente" simple y
// honesto, sin ningún control falso (sin selector de rango, sin botón
// "Generar", sin mención de formatos de exportación).
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Reportes" />

    <main class="mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-4 py-6 text-center sm:px-6 lg:px-8" style="min-height: 60vh">
      <FileText class="size-12 text-muted-foreground" />
      <h2 class="text-lg font-semibold">
        Reportes
      </h2>
      <p class="max-w-xs text-sm text-muted-foreground">
        Todavía estamos construyendo esta sección. Pronto vas a poder generar
        reportes de tus gastos.
      </p>
    </main>
  </div>
</template>
