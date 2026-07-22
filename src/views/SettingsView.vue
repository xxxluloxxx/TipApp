<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Ban, BellOff, BellRing, Check, ChevronRight, Goal, Monitor, Moon, Palette, Smartphone, Sun, SunMoon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { COLOR_SWATCHES, readableTextColor } from '@/lib/colors'
import { useAuthStore } from '@/stores/auth'
import { usePushNotificationsStore } from '@/stores/pushNotifications'
import AppHeader from '@/components/AppHeader.vue'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// Sección 7 de dashboard-redesign-ux.md: el selector de tema se muda tal
// cual desde el drawer (theme-toggle-ux.md sección 3) a esta pantalla nueva,
// envuelto en una Card. "Cerrar sesión" no se mueve, sigue en el drawer.
// live-matches-ux.md sección 6.3: se agrega el toggle de notificaciones —
// primer uso de `Switch` como preferencia de cuenta global.

const router = useRouter()
const authStore = useAuthStore()
const pushStore = usePushNotificationsStore()

onMounted(() => {
  void pushStore.refresh()
})

async function onToggleNotifications(value: boolean) {
  if (value) {
    const result = await pushStore.enable()
    if (result.ok) {
      toast.success('Notificaciones activadas')
    } else if (result.reason === 'error' || result.reason === 'no_key') {
      toast.error('No pudimos activar las notificaciones. Intentá de nuevo.')
    }
    // 'denied'/'unsupported': el Switch queda apagado solo (isEnabled es
    // reactivo) y el texto de ayuda explica el motivo; sin toast redundante.
    return
  }

  const ok = await pushStore.disable()
  if (ok) {
    toast('Notificaciones desactivadas')
  } else {
    toast.error('No pudimos desactivar las notificaciones. Intentá de nuevo.')
  }
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Ajustes" />

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

      <!-- live-matches-ux.md sección 6.3: notificaciones de partidos en vivo -->
      <Card>
        <CardHeader>
          <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Notificaciones
          </CardTitle>
        </CardHeader>

        <div class="flex items-center gap-3 px-4 pb-4">
          <BellRing v-if="pushStore.isEnabled" class="size-5 shrink-0 text-muted-foreground" />
          <BellOff v-else class="size-5 shrink-0 text-muted-foreground" />
          <div class="flex-1">
            <Label for="notifications-toggle">Avisos de partidos en vivo</Label>
            <p class="text-xs text-muted-foreground">
              {{ pushStore.statusLabel }}
            </p>
          </div>
          <Switch
            id="notifications-toggle"
            :model-value="pushStore.isEnabled"
            :disabled="pushStore.permission === 'denied' || !pushStore.supported || pushStore.isBusy"
            @update:model-value="onToggleNotifications"
          />
        </div>

        <!-- Único acceso a Partidos en vivo: se quitó del drawer a propósito
             (feature de utilidad no financiera) y queda escondido acá. -->
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-3 border-t border-border px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          @click="router.push({ name: 'matches' })"
        >
          <Goal class="size-5 shrink-0 text-muted-foreground" />
          <span class="flex-1 text-sm font-medium">Partidos en vivo</span>
          <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </button>

        <p v-if="pushStore.permission === 'denied'" class="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Bloqueaste las notificaciones para TipApp en tu navegador. Para activarlas, cambiá el permiso desde la configuración del sitio en tu navegador.
        </p>
        <p v-else-if="!pushStore.supported" class="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <Smartphone class="mt-0.5 size-3.5 shrink-0" />
          <span v-if="pushStore.isIOS">
            En iPhone o iPad, las notificaciones solo funcionan si instalás TipApp en la pantalla de inicio (Compartir → Agregar a pantalla de inicio).
          </span>
          <span v-else>
            Tu navegador no admite notificaciones. Probá desde Chrome o Safari actualizados.
          </span>
        </p>
      </Card>
    </main>
  </div>
</template>
