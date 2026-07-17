<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowLeft, Ban, Check, Monitor, Moon, Palette, Sun, SunMoon } from '@lucide/vue'
import { COLOR_SWATCHES, readableTextColor } from '@/lib/colors'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'

// Sección 7 de dashboard-redesign-ux.md: el selector de tema se muda tal
// cual desde el drawer (theme-toggle-ux.md sección 3) a esta pantalla nueva,
// envuelto en una Card. "Cerrar sesión" no se mueve, sigue en el drawer.

const router = useRouter()
const authStore = useAuthStore()
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-xl font-semibold">
        Ajustes
      </h1>
    </header>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Card>
        <CardHeader>
          <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Apariencia
          </CardTitle>
        </CardHeader>

        <div class="flex items-center gap-3 px-4 pb-4">
          <SunMoon class="size-5 shrink-0 text-muted-foreground" />
          <span id="theme-label" class="flex-1 text-sm font-medium">Tema</span>
          <div
            role="radiogroup"
            aria-labelledby="theme-label"
            class="flex gap-1 rounded-md bg-muted p-1"
          >
            <button
              type="button"
              role="radio"
              :aria-checked="authStore.themePreference === 'light'"
              aria-label="Claro"
              class="flex min-h-11 flex-1 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="authStore.themePreference === 'light' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
              @click="authStore.selectTheme('light')"
            >
              <Sun class="size-4 shrink-0" />
            </button>

            <button
              type="button"
              role="radio"
              :aria-checked="authStore.themePreference === 'dark'"
              aria-label="Oscuro"
              class="flex min-h-11 flex-1 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="authStore.themePreference === 'dark' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
              @click="authStore.selectTheme('dark')"
            >
              <Moon class="size-4 shrink-0" />
            </button>

            <button
              type="button"
              role="radio"
              :aria-checked="authStore.themePreference === 'system'"
              aria-label="Sistema"
              class="flex min-h-11 flex-1 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="authStore.themePreference === 'system' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
              @click="authStore.selectTheme('system')"
            >
              <Monitor class="size-4 shrink-0" />
            </button>
          </div>
        </div>

        <div class="border-t border-border px-4 py-4">
          <div class="flex items-center gap-3">
            <Palette class="size-5 shrink-0 text-muted-foreground" />
            <span id="accent-color-label" class="text-sm font-medium">Color de acento</span>
          </div>

          <div
            id="accent-color"
            role="group"
            aria-labelledby="accent-color-label"
            class="mt-3 flex flex-wrap gap-3 pl-8"
          >
            <button
              type="button"
              class="relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/50 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring border-solid': authStore.accentColor === null }"
              :aria-pressed="authStore.accentColor === null"
              aria-label="Predeterminado"
              @click="authStore.selectAccentColor(null)"
            >
              <component :is="authStore.accentColor === null ? Check : Ban" class="size-5 text-muted-foreground" />
            </button>

            <button
              v-for="swatch in COLOR_SWATCHES"
              :key="swatch.hex"
              type="button"
              class="relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="{ 'ring-2 ring-offset-2 ring-ring': authStore.accentColor === swatch.hex }"
              :style="{ background: swatch.hex }"
              :aria-pressed="authStore.accentColor === swatch.hex"
              :aria-label="swatch.label"
              @click="authStore.selectAccentColor(swatch.hex)"
            >
              <Check v-if="authStore.accentColor === swatch.hex" class="size-5" :style="{ color: readableTextColor(swatch.hex) }" />
            </button>
          </div>
        </div>
      </Card>
    </main>
  </div>
</template>
