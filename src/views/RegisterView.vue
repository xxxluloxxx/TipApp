<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Inbox, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
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
const confirmPassword = ref('')
const isSubmitting = ref(false)
const serverError = ref<string | null>(null)
const fieldErrors = reactive<{ email?: string, password?: string, confirm?: string }>({})

// Caso B de la sección 1.5: signUp devolvió `session: null`, requiere
// confirmación de email. Reemplaza el contenido del Card.
const awaitingEmailConfirmation = ref(false)
const registeredEmail = ref('')

const EMAIL_RE = /^\S+@\S+\.\S+$/

// Validación en `blur`, no en cada `input` (sección 1.4): estas funciones se
// enganchan al evento blur de cada campo.
function validateEmail() {
  fieldErrors.email = EMAIL_RE.test(email.value.trim()) ? undefined : 'Ingresá un email válido.'
}
function validatePassword() {
  fieldErrors.password = password.value.length >= 8
    ? undefined
    : 'La contraseña debe tener al menos 8 caracteres.'
}
function validateConfirm() {
  fieldErrors.confirm = confirmPassword.value === password.value
    ? undefined
    : 'Las contraseñas no coinciden.'
}

function mapRegisterError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  if (lower.includes('already registered') || lower.includes('already exists')) {
    return 'Ese email ya está registrado. Iniciá sesión o usá otro email.'
  }
  if (lower.includes('fetch') || lower.includes('network')) {
    return 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.'
  }
  return 'Ocurrió un error. Intentá de nuevo en unos minutos.'
}

async function onSubmit() {
  serverError.value = null
  // Se revalida todo de nuevo al reintentar submit (sección 1.4).
  validateEmail()
  validatePassword()
  validateConfirm()
  if (fieldErrors.email || fieldErrors.password || fieldErrors.confirm) return

  isSubmitting.value = true
  try {
    const trimmedEmail = email.value.trim()
    const { hasSession } = await authStore.signUp(trimmedEmail, password.value)

    if (hasSession) {
      toast.success('¡Cuenta creada!', { description: 'Bienvenido/a a TipApp.' })
      const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
      await router.push(redirect)
    } else {
      registeredEmail.value = trimmedEmail
      awaitingEmailConfirmation.value = true
    }
  } catch (err) {
    serverError.value = mapRegisterError(err)
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
          Creá tu cuenta para empezar a registrar gastos
        </p>
      </div>

      <Card class="p-4 sm:p-6">
        <template v-if="awaitingEmailConfirmation">
          <div class="flex flex-col items-center gap-3 text-center">
            <Inbox class="size-12 text-muted-foreground" />
            <h2 class="text-lg font-semibold">
              Confirmá tu email
            </h2>
            <p class="text-sm text-muted-foreground">
              Te enviamos un link de confirmación a <strong>{{ registeredEmail }}</strong>.
              Abrilo para activar tu cuenta y después iniciá sesión.
            </p>
            <Button variant="outline" class="w-full" @click="router.push('/login')">
              Ir a iniciar sesión
            </Button>
          </div>
        </template>

        <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
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
              @blur="validateEmail"
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
              autocomplete="new-password"
              required
              :disabled="isSubmitting"
              :aria-invalid="!!fieldErrors.password"
              @blur="validatePassword"
            />
            <p v-if="fieldErrors.password" class="text-xs text-destructive">
              {{ fieldErrors.password }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              Mínimo 8 caracteres.
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="confirm-password">Confirmar contraseña</Label>
            <Input
              id="confirm-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              required
              :disabled="isSubmitting"
              :aria-invalid="!!fieldErrors.confirm"
              @blur="validateConfirm"
            />
            <p v-if="fieldErrors.confirm" class="text-xs text-destructive">
              {{ fieldErrors.confirm }}
            </p>
          </div>

          <Button type="submit" class="w-full" :disabled="isSubmitting">
            <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
            {{ isSubmitting ? 'Creando cuenta…' : 'Crear cuenta' }}
          </Button>
        </form>
      </Card>

      <p v-if="!awaitingEmailConfirmation" class="mt-4 text-center text-sm text-muted-foreground">
        ¿Ya tenés cuenta?
        <RouterLink to="/login" class="text-primary underline-offset-4 hover:underline">
          Iniciá sesión
        </RouterLink>
      </p>
    </div>
  </div>
</template>
