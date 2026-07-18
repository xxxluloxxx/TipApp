<script setup lang="ts">
import { Flag, Sparkles, Target } from '@lucide/vue'
import type { LiveMatch } from '@/stores/liveMatches'

// Fila compacta de stats clave de la card (live-matches-ux.md sección 3.5).
// Las 5 stats del encargo en el orden pedido. Cada ícono lleva un
// `<span class="sr-only">` con el nombre completo antes del número (checklist
// de a11y sección 9.3) — el `title=` ayuda en desktop pero no es leído
// consistentemente en mobile. Las tarjetas amarilla/roja se pintan con un
// cuadradito `bg-warning`/`bg-destructive` (reutilización **literal** de esos
// tokens, no metafórica: es el color real de una tarjeta de fútbol, sección
// 3.5), no con un ícono.

defineProps<{
  match: LiveMatch
}>()

function n(value: number | null | undefined): number {
  return value ?? 0
}
</script>

<template>
  <div class="grid grid-cols-5 gap-2 rounded-md bg-muted/50 px-2 py-2 text-xs">
    <div class="flex flex-col items-center gap-0.5" title="Córners">
      <Flag class="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span class="font-medium tabular-nums">
        <span class="sr-only">Córners: </span>{{ n(match.corners_home) }}-{{ n(match.corners_away) }}
      </span>
    </div>

    <div class="flex flex-col items-center gap-0.5" title="Remates a puerta">
      <Target class="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span class="font-medium tabular-nums">
        <span class="sr-only">Remates a puerta: </span>{{ n(match.shots_on_target_home) }}-{{ n(match.shots_on_target_away) }}
      </span>
    </div>

    <div class="flex flex-col items-center gap-0.5" title="Ocasiones claras">
      <Sparkles class="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span class="font-medium tabular-nums">
        <span class="sr-only">Ocasiones claras: </span>{{ n(match.clear_chances_home) }}-{{ n(match.clear_chances_away) }}
      </span>
    </div>

    <div class="flex flex-col items-center gap-0.5" title="Tarjetas amarillas">
      <span class="h-3.5 w-2.5 rounded-[2px] bg-warning" aria-hidden="true" />
      <span class="font-medium tabular-nums">
        <span class="sr-only">Tarjetas amarillas: </span>{{ n(match.yellow_cards_home) }}-{{ n(match.yellow_cards_away) }}
      </span>
    </div>

    <div class="flex flex-col items-center gap-0.5" title="Tarjetas rojas">
      <span class="h-3.5 w-2.5 rounded-[2px] bg-destructive" aria-hidden="true" />
      <span class="font-medium tabular-nums">
        <span class="sr-only">Tarjetas rojas: </span>{{ n(match.red_cards_home) }}-{{ n(match.red_cards_away) }}
      </span>
    </div>
  </div>
</template>
