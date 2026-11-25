<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Calculator, EllipsisVertical, Pencil, Plus, RotateCcw, Trash2 } from '@lucide/vue'
import AppHeader from '@/components/AppHeader.vue'
import CalcNameSheet from '@/components/CalcNameSheet.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatAmount } from '@/lib/currency'
import { formatDateChip } from '@/lib/date'
import { useCalcDraftsStore, type CalcDraftSummary } from '@/stores/calcDrafts'

// Calculadora de movimientos: lista de borradores para hacer cuentas.
const router = useRouter()
const store = useCalcDraftsStore()

const isLoading = ref(true)
const loadError = ref(false)
const newOpen = ref(false)
const renaming = ref<CalcDraftSummary | null>(null)
const renameOpen = ref(false)
const toDelete = ref<CalcDraftSummary | null>(null)

async function loadAll() {
  loadError.value = false
  isLoading.value = true
  try {
    if (!(await store.fetchDrafts())) loadError.value = true
  } finally {
    isLoading.value = false
  }
}
onMounted(loadAll)

const num = (v: number | null) => Number(v ?? 0)

function defaultName(): string {
  return `Cálculo ${formatDateChip(new Date().toISOString().slice(0, 10))}`
}

async function createDraft(name: string) {
  const id = await store.createDraft(name)
  newOpen.value = false
  if (id) void router.push({ name: 'calculator-draft', params: { id } })
}

function openRename(draft: CalcDraftSummary) {
  renaming.value = draft
  renameOpen.value = true
}

async function rename(name: string) {
  if (renaming.value?.draft_id) await store.renameDraft(renaming.value.draft_id, name)
  renameOpen.value = false
}

async function confirmDelete() {
  const draft = toDelete.value
  toDelete.value = null
  if (draft?.draft_id) await store.deleteDraft(draft.draft_id)
}
</script>

<template>
  <div class="min-h-svh bg-background">
    <AppHeader title="Calculadora" />

    <main class="mx-auto flex max-w-md flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <Card class="flex-row items-center gap-4 p-4">
        <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Calculator class="size-6" />
        </span>
        <div class="min-w-0">
          <h2 class="font-semibold">Calculadora de movimientos</h2>
          <p class="text-sm text-muted-foreground">Simula ingresos y gastos, guarda borradores y retómalos cuando lo necesites.</p>
        </div>
      </Card>

      <Button class="h-11 w-full" @click="newOpen = true"><Plus class="size-5" /> Nuevo cálculo</Button>

      <h3 class="text-lg font-semibold">Mis borradores</h3>

      <template v-if="isLoading">
        <Card v-for="i in 3" :key="i" class="p-4"><Skeleton class="h-10 w-full" /></Card>
      </template>

      <div v-else-if="loadError" class="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle class="size-10 text-destructive" />
        <p class="font-medium">No pudimos cargar tus borradores</p>
        <Button variant="outline" @click="loadAll"><RotateCcw class="size-4" /> Reintentar</Button>
      </div>

      <p v-else-if="store.drafts.length === 0" class="py-10 text-center text-sm text-muted-foreground">
        Todavía no tienes borradores. Crea tu primer cálculo.
      </p>

      <template v-else>
        <Card v-for="draft in store.drafts" :key="draft.draft_id!" class="flex-row items-center gap-1 p-0">
          <button
            type="button"
            class="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="router.push({ name: 'calculator-draft', params: { id: draft.draft_id! } })"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ draft.name }}</p>
              <p class="text-xs text-muted-foreground">
                {{ formatDateChip(String(draft.updated_at).slice(0, 10)) }} · {{ num(draft.entries_count) }}
                {{ num(draft.entries_count) === 1 ? 'movimiento' : 'movimientos' }}
              </p>
            </div>
            <p class="shrink-0 font-semibold tabular-nums" :class="num(draft.total) < 0 ? 'text-destructive' : 'text-success'">
              {{ num(draft.total) < 0 ? '-' : '' }}${{ formatAmount(Math.abs(num(draft.total))) }}
            </p>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" class="mr-1 size-11" aria-label="Más acciones">
                <EllipsisVertical class="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @select="openRename(draft)"><Pencil class="size-4" /> Renombrar</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" @select="toDelete = draft"><Trash2 class="size-4" /> Eliminar</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Card>
      </template>
    </main>

    <CalcNameSheet v-model:open="newOpen" title="Nuevo cálculo" :initial-name="defaultName()" submit-label="Crear" @submit="createDraft" />
    <CalcNameSheet v-model:open="renameOpen" title="Renombrar" :initial-name="renaming?.name ?? ''" submit-label="Guardar" @submit="rename" />

    <AlertDialog :open="!!toDelete" @update:open="(v: boolean) => { if (!v) toDelete = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar "{{ toDelete?.name }}"?</AlertDialogTitle>
          <AlertDialogDescription>Se borra el borrador con todos sus movimientos. Esta acción no se puede deshacer.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction @click="confirmDelete">Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
