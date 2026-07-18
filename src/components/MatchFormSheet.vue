<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Camera, CircleX, Loader2, X } from '@lucide/vue'
import { createWorker, type Worker } from 'tesseract.js'
import { toast } from 'vue-sonner'
import { useLiveMatchesStore, type IncomingLeg } from '@/stores/liveMatches'
import { betSlipFromOcrBlocks, type RecognizedBlock } from '@/lib/betSlipOcr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// Alta de partido — Sheet "wizard" de 3 pasos (live-matches-ux.md sección 5),
// primer Sheet multi-paso del proyecto. `step: 'form' | 'processing' |
// 'review'`. NO optimista (sección 1.8): tanto el OCR como el alta atómica
// necesitan resolverse antes de que exista ninguna fila / de mostrar el review.
//
// El OCR del cupón corre 100% en el navegador con Tesseract.js (createWorker →
// recognize → terminate), NO en una Edge Function: Tesseract.js no funciona en
// el runtime Deno de Supabase (Worker.prototype.constructor ausente) pero sí
// en el browser, que es su entorno soportado. El parseo del texto a legs vive
// en `src/lib/betSlipParser.ts`/`marketMapper.ts` (TypeScript puro) y el
// adaptador del resultado en `src/lib/betSlipOcr.ts`.

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const liveMatchesStore = useLiveMatchesStore()

type Step = 'form' | 'processing' | 'review'

// Leg extraído del OCR client-side (con `tempId` local para la lista de review).
interface ExtractedLeg extends IncomingLeg {
  tempId: string
}

const step = ref<Step>('form')
const isSubmitting = ref(false)

const form = reactive({
  url: '',
  photoFile: null as File | null,
  photoPreviewUrl: null as string | null,
  extractedLegs: [] as ExtractedLeg[],
})

const errors = reactive<{ url?: string }>({})

const fileInputRef = ref<HTMLInputElement | null>(null)
const urlInputRef = ref<{ $el?: HTMLElement } | null>(null)

// Web Worker de Tesseract.js activo mientras corre el OCR. Se termina siempre
// (éxito, error o cierre/cancelación del Sheet) para no dejarlo vivo en memoria
// — ver `terminateOcrWorker` (requisito 5 del encargo del OCR client-side).
let ocrWorker: Worker | null = null

async function terminateOcrWorker() {
  if (!ocrWorker) return
  const worker = ocrWorker
  ocrWorker = null
  try {
    await worker.terminate()
  } catch {
    // El worker ya podría estar terminado; no hay nada útil que hacer acá.
  }
}

function revokePreview() {
  if (form.photoPreviewUrl) {
    URL.revokeObjectURL(form.photoPreviewUrl)
    form.photoPreviewUrl = null
  }
}

function resetForm() {
  step.value = 'form'
  isSubmitting.value = false
  errors.url = undefined
  form.url = ''
  clearPhoto()
  form.extractedLegs = []
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetForm()
  } else {
    revokePreview()
    // Si el Sheet se cierra con un OCR en vuelo, no dejamos el worker vivo.
    void terminateOcrWorker()
  }
})

// Red de seguridad: si el componente se desmonta (cambio de ruta, etc.) con un
// OCR en curso, terminamos el worker igual.
onBeforeUnmount(() => {
  void terminateOcrWorker()
})

/** Espejo client-side de `extractMatchId` del backend (sección 5.1): busca el
 * `mid` en `searchParams` y, como red de seguridad, con el mismo regex que el
 * servidor. Solo feedback inmediato — el backend es la barrera real. */
function extractMid(url: string): string | null {
  try {
    const parsed = new URL(url)
    const mid = parsed.searchParams.get('mid')
    if (mid) return mid
  } catch {
    // URL inválida para el parser nativo: cae al regex de abajo.
  }
  const match = /[?&#]mid=([A-Za-z0-9]+)/.exec(url)
  return match ? match[1]! : null
}

function focusUrl() {
  urlInputRef.value?.$el?.focus()
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  revokePreview()
  form.photoFile = file
  form.photoPreviewUrl = URL.createObjectURL(file)
  // Tesseract.js acepta el `File` directamente en `recognize`, así que no hace
  // falta convertir a base64 (a diferencia del viejo Edge Function, que recibía
  // la imagen en base64 por el body JSON).
  // Permite volver a elegir el mismo archivo si el usuario lo quita y reintenta.
  input.value = ''
}

function clearPhoto() {
  revokePreview()
  form.photoFile = null
}

function validateUrl(): boolean {
  errors.url = undefined
  const url = form.url.trim()
  if (!url) {
    errors.url = 'Pegá el link del partido.'
    focusUrl()
    return false
  }

  const mid = extractMid(url)
  if (!mid) {
    errors.url = 'El link no parece ser de un partido de Flashscore (tiene que incluir "?mid=" en la URL).'
    focusUrl()
    return false
  }

  // Duplicado detectable en cliente (sección 5.1): chequeo barato contra la
  // lista ya en memoria, evita un viaje al servidor.
  const alreadyFollowed = liveMatchesStore.matches.some(match => match.flashscore_mid === mid)
  if (alreadyFollowed) {
    errors.url = 'Ya estás siguiendo este partido.'
    focusUrl()
    return false
  }

  return true
}

async function handleSubmitStep1() {
  if (isSubmitting.value) return
  if (!validateUrl()) return

  if (form.photoFile) {
    // Paso 2: OCR client-side con Tesseract.js (sección 5.2). El cupón está en
    // español → modelo `spa`. El worker se termina siempre en el `finally`.
    step.value = 'processing'
    try {
      ocrWorker = await createWorker('spa')
      const { data } = await ocrWorker.recognize(form.photoFile)
      const result = betSlipFromOcrBlocks(data.blocks as RecognizedBlock[] | null)
      form.extractedLegs = result.legs
      // Sección 5.3/5.4: se llega al review aunque `extractedLegs` esté vacío
      // (el usuario puede continuar sin cupón).
      step.value = 'review'
    } catch (ocrError) {
      // Falla real del motor OCR (distinto de "no encontró legs"): vuelve al
      // paso 1 conservando la foto para reintentar (sección 5.2).
      console.error('OCR del cupón (Tesseract.js) falló', ocrError)
      step.value = 'form'
      toast.error('No pudimos leer la foto. Probá de nuevo o seguí sin cupón.')
    } finally {
      await terminateOcrWorker()
    }
    return
  }

  // Alta sin foto (sección 5.1): directo, sin paso de review.
  await confirmMatch()
}

function discardLeg(tempId: string) {
  form.extractedLegs = form.extractedLegs.filter(leg => leg.tempId !== tempId)
}

function retakePhoto() {
  // Sección 5.3: vuelve al paso 1 con el campo de foto vacío (no reintenta la
  // misma imagen).
  clearPhoto()
  form.extractedLegs = []
  step.value = 'form'
}

async function confirmMatch() {
  if (isSubmitting.value) return
  isSubmitting.value = true
  try {
    const legs: IncomingLeg[] = form.extractedLegs.map(({ tempId: _tempId, ...leg }) => leg)
    const result = await liveMatchesStore.addMatch({ url: form.url.trim(), legs })

    if ('errorCode' in result) {
      if (result.errorCode === 'duplicate_match') {
        // Volvemos al paso 1 para mostrar el mensaje en el campo (sección 5.1).
        step.value = 'form'
        errors.url = 'Ya estás siguiendo este partido.'
        focusUrl()
        return
      }
      toast.error('No pudimos agregar el partido. Revisá tu conexión e intentá de nuevo.')
      return
    }

    toast.success('¡Listo! Ya estamos siguiendo este partido.')
    emit('update:open', false)
  } finally {
    isSubmitting.value = false
  }
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

// Secciones 5.2/5.5: mientras hay un roundtrip en vuelo (OCR o alta), el
// Sheet no se cierra por tap-fuera / Escape / swipe.
const isBlocking = () => isSubmitting.value || step.value === 'processing'
function preventCloseWhileBusy(event: Event) {
  if (isBlocking()) event.preventDefault()
}
</script>

<template>
  <Sheet :open="props.open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      :show-close-button="!isBlocking()"
      @escape-key-down="preventCloseWhileBusy"
      @interact-outside="preventCloseWhileBusy"
    >
      <!-- Paso 1: URL + foto opcional (sección 5.1) -->
      <template v-if="step === 'form'">
        <SheetHeader>
          <SheetTitle>Nuevo partido</SheetTitle>
          <SheetDescription>
            Pegá el link de un partido de Flashscore para empezar a seguirlo.
          </SheetDescription>
        </SheetHeader>

        <form id="match-form" class="flex flex-col gap-4 px-4" novalidate @submit.prevent="handleSubmitStep1">
          <div class="flex flex-col gap-1.5">
            <Label for="match-url">Link del partido</Label>
            <Input
              id="match-url"
              ref="urlInputRef"
              v-model="form.url"
              type="url"
              inputmode="url"
              placeholder="https://www.flashscore.com.ar/partido/..."
              :disabled="isSubmitting"
              :aria-invalid="!!errors.url"
            />
            <p v-if="errors.url" class="text-xs text-destructive">
              {{ errors.url }}
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label>Foto del cupón (opcional)</Label>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="sr-only"
              @change="onFileSelected"
            >

            <div v-if="!form.photoPreviewUrl">
              <Button type="button" variant="outline" class="w-full" :disabled="isSubmitting" @click="fileInputRef?.click()">
                <Camera class="size-4" />
                Subir foto del cupón
              </Button>
              <p class="mt-1 text-xs text-muted-foreground">
                Leemos las selecciones automáticamente. Podés revisarlas antes de confirmar.
              </p>
            </div>

            <div v-else class="relative overflow-hidden rounded-lg border border-border">
              <img :src="form.photoPreviewUrl" alt="Vista previa del cupón subido" class="max-h-48 w-full bg-muted object-contain">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                class="absolute right-2 top-2 size-9"
                aria-label="Quitar foto"
                :disabled="isSubmitting"
                @click="clearPhoto"
              >
                <X class="size-4" />
              </Button>
            </div>
          </div>
        </form>

        <SheetFooter class="flex-row gap-2">
          <Button type="button" variant="outline" class="flex-1" :disabled="isSubmitting" @click="emit('update:open', false)">
            Cancelar
          </Button>
          <Button type="submit" form="match-form" class="flex-1" :disabled="isSubmitting">
            <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
            {{ isSubmitting ? 'Guardando…' : (form.photoFile ? 'Continuar' : 'Agregar partido') }}
          </Button>
        </SheetFooter>
      </template>

      <!-- Paso 2: leyendo el cupón (sección 5.2) -->
      <template v-else-if="step === 'processing'">
        <SheetHeader>
          <SheetTitle>Leyendo el cupón…</SheetTitle>
        </SheetHeader>
        <div class="flex flex-col items-center gap-4 px-4 py-10">
          <Loader2 class="size-10 animate-spin text-primary" />
          <p class="text-center text-sm text-muted-foreground">
            Esto puede tardar unos segundos. No cierres esta ventana.
          </p>
        </div>
      </template>

      <!-- Paso 3: review de legs extraídos (sección 5.3/5.4) -->
      <template v-else>
        <SheetHeader>
          <SheetTitle>Revisá las selecciones</SheetTitle>
          <SheetDescription>
            Leímos esto automáticamente y puede tener errores. Sacá las que no correspondan.
          </SheetDescription>
        </SheetHeader>

        <div class="flex flex-col gap-2 px-4">
          <div
            v-for="leg in form.extractedLegs"
            :key="leg.tempId"
            class="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
          >
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="truncate text-sm font-medium">
                {{ leg.selectionLabel }}
              </p>
              <p class="truncate text-xs text-muted-foreground">
                {{ leg.marketLabel }}
              </p>
            </div>
            <Badge v-if="leg.marketType === 'unknown'" variant="outline" class="shrink-0 text-[10px]">
              No monitoreable
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-9 shrink-0"
              :aria-label="`Quitar '${leg.selectionLabel}'`"
              :disabled="isSubmitting"
              @click="discardLeg(leg.tempId)"
            >
              <CircleX class="size-4 text-muted-foreground" />
            </Button>
          </div>

          <p v-if="form.extractedLegs.length === 0" class="py-6 text-center text-sm text-muted-foreground">
            No encontramos selecciones en la foto.
          </p>
        </div>

        <SheetFooter class="flex-row gap-2">
          <Button type="button" variant="outline" class="flex-1" :disabled="isSubmitting" @click="retakePhoto">
            Probar con otra foto
          </Button>
          <Button type="button" class="flex-1" :disabled="isSubmitting" @click="confirmMatch">
            <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
            {{ form.extractedLegs.length > 0 ? 'Agregar partido' : 'Continuar sin cupón' }}
          </Button>
        </SheetFooter>
      </template>
    </SheetContent>
  </Sheet>
</template>
