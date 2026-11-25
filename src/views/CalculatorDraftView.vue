<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertCircle, ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2 } from '@lucide/vue'
import AppHeader from '@/components/AppHeader.vue'
import CalcEntrySheet from '@/components/CalcEntrySheet.vue'
import CalcNameSheet from '@/components/CalcNameSheet.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatAmount } from '@/lib/currency'
import { useCalcDraftsStore, type CalcEntry, type CalcEntryKind } from '@/stores/calcDrafts'

const route = useRoute()
const router = useRouter()
const store = useCalcDraftsStore()

const draftId = computed(() => String(route.params.id))
const isLoading = ref(true)
const loadError = ref(false)
const entryOpen = ref(false)
const editingEntry = ref<CalcEntry | null>(null)
const renameOpen = ref(false)
const deleteOpen = ref(false)
const entryToDelete = ref<CalcEntry | null>(null)

const draftName = ref('Cálculo')

// Totales de la pantalla: derivados de los movimientos ya cargados de ESTE
// borrador (acotado por borrador; la lista de borradores usa la vista SQL).
const incomeTotal = computed(() => store.entries.filter(e => e.kind === 'income').reduce((s, e) => s + Number(e.amount), 0))
const expenseTotal = computed(() => store.entries.filter(e => e.kind === 'expense').reduce((s, e) => s + Number(e.amount), 0))
const total = computed(() => Math.round((incomeTotal.value - expenseTotal.value) * 100) / 100)

async function loadAll() {
  loadError.value = false
  isLoading.value = true
  try {
    const [draftsOk, entriesOk] = await Promise.all([store.fetchDrafts(), store.fetchEntries(draftId.value)])
    const summary = store.summaryOf(draftId.value)
    if (!draftsOk || !entriesOk || !summary) {
      loadError.value = true
      return
    }
    draftName.value = summary.name ?? 'Cálculo'
  } finally {
    isLoading.value = false
  }
}
onMounted(loadAll)

function openNew() {
  editingEntry.value = null
  entryOpen.value = true
}
function openEdit(entry: CalcEntry) {
  editingEntry.value = entry
  entryOpen.value = true
}

async function saveEntry(payload: { kind: CalcEntryKind, description: string, amount: number }) {
  const ok = editingEntry.value
    ? await store.updateEntry(draftId.value, editingEntry.value.id, payload)
    : await store.addEntry(draftId.value, payload)
  if (ok) entryOpen.value = false
  else entryOpen.value = true
}

async function rename(name: string) {
  if (await store.renameDraft(draftId.value, name)) draftName.value = name
  renameOpen.value = false
}

async function confirmDeleteEntry() {
  const entry = entryToDelete.value
  entryToDelete.value = null
  if (entry) await store.deleteEntry(draftId.value, entry.id)
}

async function confirmDeleteDraft() {
  deleteOpen.value = false
  if (await store.deleteDraft(draftId.value)) void router.replace({ name: 'calculator' })
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${formatAmount(Math.abs(n))}`
</script>

<template>
  <div class="min-h-svh bg-background">
    <AppHeader :title="draftName">
      <template #actions>
        <Button variant="ghost" size="icon" class="size-11" aria-label="Renombrar" @click="renameOpen = true"><Pencil class="size-5" /></Button>
        <Button variant="ghost" size="icon" class="size-11" aria-label="Eliminar borrador" @click="deleteOpen = true"><Trash2 class="size-5" /></Button>
      </template>
    </AppHeader>

    <main class="mx-auto flex max-w-md flex-col gap-4 px-4 py-6 pb-28 sm:px-6 lg:px-8">
      <template v-if="isLoading">
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-40 w-full" />
      </template>

      <div v-else-if="loadError" class="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle class="size-10 text-destructive" />
        <p class="font-medium">No pudimos cargar este cálculo</p>
        <Button variant="outline" @click="loadAll"><RotateCcw class="size-4" /> Reintentar</Button>
      </div>

      <template v-else>
        <Card class="gap-3 p-4">
          <div class="text-center">
            <p class="text-sm text-muted-foreground">Total</p>
            <p class="text-4xl font-bold tabular-nums" :class="total < 0 ? 'text-destructive' : 'text-success'">{{ money(total) }}</p>
          </div>
          <Separator />
          <div class="grid grid-cols-2 gap-3">
            <div class="flex items-center gap-2">
              <span class="flex size-9 items-center justify-center rounded-full bg-success/10 text-success"><ArrowUp class="size-4" /></span>
              <div>
                <p class="text-xs text-muted-foreground">Ingresos</p>
                <p class="font-semibold tabular-nums text-success">${{ formatAmount(incomeTotal) }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive"><ArrowDown class="size-4" /></span>
              <div>
                <p class="text-xs text-muted-foreground">Gastos</p>
                <p class="font-semibold tabular-nums text-destructive">${{ formatAmount(expenseTotal) }}</p>
              </div>
            </div>
          </div>
        </Card>

        <h3 class="text-lg font-semibold">Movimientos ({{ store.entries.length }})</h3>

        <p v-if="store.entries.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          Agrega tu primer movimiento para empezar a calcular.
        </p>

        <Card v-else class="gap-0 p-0">
          <template v-for="(entry, idx) in store.entries" :key="entry.id">
            <Separator v-if="idx > 0" />
            <div class="flex items-center">
              <button
                type="button"
                class="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="openEdit(entry)"
              >
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-full"
                  :class="entry.kind === 'income' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'"
                >
                  <ArrowUp v-if="entry.kind === 'income'" class="size-4" />
                  <ArrowDown v-else class="size-4" />
                </span>
                <p class="min-w-0 flex-1 truncate text-sm font-medium">
                  {{ entry.description || (entry.kind === 'income' ? 'Ingreso' : 'Gasto') }}
                </p>
                <p class="shrink-0 font-semibold tabular-nums" :class="entry.kind === 'income' ? 'text-success' : 'text-destructive'">
                  {{ entry.kind === 'income' ? '' : '-' }}${{ formatAmount(Number(entry.amount)) }}
                </p>
              </button>
              <Button variant="ghost" size="icon" class="size-11 shrink-0" aria-label="Eliminar movimiento" @click="entryToDelete = entry">
                <Trash2 class="size-4" />
              </Button>
            </div>
          </template>
        </Card>
      </template>
    </main>

    <div v-if="!isLoading && !loadError" class="fixed inset-x-0 z-20 px-4" style="bottom: calc(3.5rem + env(safe-area-inset-bottom) + 0.75rem)">
      <Button class="mx-auto flex h-11 w-full max-w-md shadow-lg" @click="openNew"><Plus class="size-5" /> Agregar movimiento</Button>
    </div>

    <CalcEntrySheet v-model:open="entryOpen" :entry="editingEntry" @submit="saveEntry" />
    <CalcNameSheet v-model:open="renameOpen" title="Renombrar" :initial-name="draftName" submit-label="Guardar" @submit="rename" />

    <AlertDialog :open="!!entryToDelete" @update:open="(v: boolean) => { if (!v) entryToDelete = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
          <AlertDialogDescription>Se quita del cálculo.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction @click="confirmDeleteEntry">Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar "{{ draftName }}"?</AlertDialogTitle>
          <AlertDialogDescription>Se borra el borrador con todos sus movimientos.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction @click="confirmDeleteDraft">Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
