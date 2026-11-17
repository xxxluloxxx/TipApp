<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Ban, Check, ChevronRight, Cigarette, Monitor, Moon, Palette, Sun, SunMoon, User } from '@lucide/vue'
import { COLOR_SWATCHES, readableTextColor } from '@/lib/colors'
import { useAuthStore } from '@/stores/auth'
import AppHeader from '@/components/AppHeader.vue'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Sección 7 de dashboard-redesign-ux.md: el selector de tema se muda tal
// cual desde el drawer (theme-toggle-ux.md sección 3) a esta pantalla nueva,
// envuelto en una Card. "Cerrar sesión" no se mueve, sigue en el drawer.

const router = useRouter()
const authStore = useAuthStore()
// Borrador local del nombre, separado del store: el perfil carga async tras
// `initialize()`, así que se siembra vía `watch` con `immediate: true`. No se
// resincroniza mientras el input tiene foco, para no pisar lo que el usuario
// está tipeando si `profile` cambia por otro motivo (p. ej. otra sesión).
const displayNameDraft = ref('')
const displayNameFocused = ref(false)

watch(
  () => authStore.profile?.display_name,
  (value) => {
    if (displayNameFocused.value) return
    displayNameDraft.value = value ?? ''
  },
  { immediate: true },
)

function onDisplayNameBlur() {
  displayNameFocused.value = false
  const trimmed = displayNameDraft.value.trim()
  const current = authStore.profile?.display_name ?? null
  const next = trimmed || null
  if (next === current) return // sin cambios reales; blur también se dispara al navegar
  void authStore.updateDisplayName(next)
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Ajustes" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Card>
        <CardHeader>
          <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Perfil
          </CardTitle>
        </CardHeader>

        <div class="flex items-center gap-3 px-4 pb-1">
          <User class="size-5 shrink-0 text-muted-foreground" />
          <Label for="display-name" class="flex-1 text-sm font-medium">Nombre</Label>
        </div>

        <div class="px-4 pb-4 pl-[2.75rem]">
          <Input
            id="display-name"
            v-model="displayNameDraft"
            type="text"
            placeholder="Ej. Juan"
            maxlength="40"
            autocomplete="name"
            enterkeyhint="done"
            class="text-base"
            @focus="displayNameFocused = true"
            @blur="onDisplayNameBlur"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <p class="mt-1.5 text-xs text-muted-foreground">
            Así te vamos a saludar en la app. Si lo dejás vacío, usamos tu email.
          </p>
        </div>
      </Card>

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
            class="flex gap-1.5 rounded-lg bg-muted p-1.5"
          >
            <button
              type="button"
              role="radio"
              :aria-checked="authStore.themePreference === 'light'"
              aria-label="Claro"
              class="flex size-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="authStore.themePreference === 'light' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
              @click="authStore.selectTheme('light')"
            >
              <Sun class="size-5 shrink-0" />
            </button>

            <button
              type="button"
              role="radio"
              :aria-checked="authStore.themePreference === 'dark'"
              aria-label="Oscuro"
              class="flex size-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="authStore.themePreference === 'dark' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
              @click="authStore.selectTheme('dark')"
            >
              <Moon class="size-5 shrink-0" />
            </button>

            <button
              type="button"
              role="radio"
              :aria-checked="authStore.themePreference === 'system'"
              aria-label="Sistema"
              class="flex size-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              :class="authStore.themePreference === 'system' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
              @click="authStore.selectTheme('system')"
            >
              <Monitor class="size-5 shrink-0" />
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

      <!-- Iron (control de consumo de tabaco, iron-ux.md): feature de utilidad
           NO financiera, se quitó del drawer a propósito y queda accesible solo
           desde acá, en su propia card. La ruta `iron` sigue intacta. -->
      <Card>
        <CardHeader>
          <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Más
          </CardTitle>
        </CardHeader>

        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-3 border-t border-border px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          @click="router.push({ name: 'iron' })"
        >
          <Cigarette class="size-5 shrink-0 text-muted-foreground" />
          <span class="flex-1 text-sm font-medium">Iron</span>
          <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Card>
    </main>
  </div>
</template>
