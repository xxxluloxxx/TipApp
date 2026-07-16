<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2 } from '@lucide/vue'
import { useAuthStore } from '@/stores/auth'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const serverError = ref<string | null>(null)
const fieldErrors = reactive<{ email?: string, password?: string }>({})

const EMAIL_RE = /^\S+@\S+\.\S+$/

function validate(): boolean {
  fieldErrors.email = EMAIL_RE.test(email.value.trim()) ? undefined : 'Ingresá un email válido.'
  fieldErrors.password = password.value ? undefined : 'Ingresá tu contraseña.'
  return !fieldErrors.email && !fieldErrors.password
}

// Los mensajes literales de Supabase pueden variar levemente entre
// versiones; se mapean por coincidencia de texto conocida. No está 100%
// especificado en el doc de UX cómo distinguir cada caso a nivel de código,
// solo el copy final esperado.
function mapLoginError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  if (lower.includes('invalid login credentials')) {
    return 'Email o contraseña incorrectos.'
  }
  if (lower.includes('email not confirmed')) {
    return 'Tu cuenta todavía no fue confirmada. Revisá tu email y confirmá tu cuenta antes de iniciar sesión.'
  }
  if (lower.includes('fetch') || lower.includes('network')) {
    return 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.'
  }
  return 'Ocurrió un error. Intentá de nuevo en unos minutos.'
}

async function onSubmit() {
  serverError.value = null
  if (!validate()) return

  isSubmitting.value = true
  try {
    await authStore.signIn(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
  } catch (err) {
    serverError.value = mapLoginError(err)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="mb-6 flex flex-col items-center gap-1 text-center">
        <h1 class="text-2xl font-bold">
          TipApp
        </h1>
        <p class="text-sm text-muted-foreground">
          Iniciá sesión para ver tus gastos
        </p>
      </div>

      <Card class="p-4 sm:p-6">
        <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
          <Alert v-if="serverError" variant="destructive">
            <AlertDescription>{{ serverError }}</AlertDescription>
          </Alert>

          <div class="flex flex-col gap-1.5">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="tu@email.com"
              required
              :disabled="isSubmitting"
              :aria-invalid="!!fieldErrors.email"
            />
            <p v-if="fieldErrors.email" class="text-xs text-destructive">
              {{ fieldErrors.email }}
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="password">Contraseña</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              :disabled="isSubmitting"
              :aria-invalid="!!fieldErrors.password"
            />
            <p v-if="fieldErrors.password" class="text-xs text-destructive">
              {{ fieldErrors.password }}
            </p>
          </div>

          <Button type="submit" class="w-full" :disabled="isSubmitting">
            <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
            {{ isSubmitting ? 'Ingresando…' : 'Iniciar sesión' }}
          </Button>
        </form>
      </Card>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        ¿No tenés cuenta?
        <RouterLink to="/registro" class="text-primary underline-offset-4 hover:underline">
          Creá una
        </RouterLink>
      </p>
    </div>
  </div>
</template>
