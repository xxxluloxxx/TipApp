<script setup lang="ts">
import NavigationDrawer from '@/components/NavigationDrawer.vue'

// Header único de la app (altura fija `py-1.5`, misma que el dashboard —
// ver design-system.md, "Header + navegación"). El primer elemento es
// siempre el botón `Menu` que abre el drawer (NavigationDrawer): reemplaza al
// botón "Volver" (`ArrowLeft`) que antes tenía cada pantalla, de modo que el
// drawer sea accesible desde cualquier vista autenticada.
//
// - `title`: título simple → `<h1>`. Para casos con un título custom (p. ej.
//   el `Select` de mes de Tarjetas) usar el slot por defecto en su lugar.
// - slot `actions`: contenido a la derecha (botón, menú, spacer, etc.).

defineProps<{
  title?: string
}>()
</script>

<template>
  <header class="flex items-center gap-3 border-b border-border px-4 py-1.5 sm:px-6 lg:px-8">
    <NavigationDrawer />

    <slot>
      <h1 class="flex-1 truncate text-xl font-semibold">
        {{ title }}
      </h1>
    </slot>

    <slot name="actions" />
  </header>
</template>
