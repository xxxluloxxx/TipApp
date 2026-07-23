<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Cigarette,
  CigaretteOff,
  Clock,
  Loader2,
  MoreVertical,
  Package,
  RotateCcw,
  Wallet,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { formatDateOnly, formatTimeShort, isFutureDate, parseDateOnly, todayDateInputValue } from '@/lib/date'
import { formatAmount } from '@/lib/currency'
import { dayNavigatorLabel, formatCigaretteCount, pendingSinceLabel, sumCigaretteUnits } from '@/lib/iron'
import { useAccountsStore } from '@/stores/accounts'
import { useIronStore, type IronCigarette, type IronPack } from '@/stores/iron'
import AppHeader from '@/components/AppHeader.vue'
import IronPackFormSheet from '@/components/IronPackFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// iron-ux.md sección 5: historial navegable día a día, con un listado mixto
// (compras + consumos) en un solo timeline cronológico (mismo criterio que el
// tab Historial de /deudas). Edición/eliminación de la hora vía menú "⋮".
// Cierre inline de una mitad pendiente. Sección 12: todas las filas de mitad
// llevan ahora menú "⋮" (editar hora / eliminar), con reglas específicas por
// caso; las mitades completas se muestran siempre como 2 filas separadas
// (sección 12.3.3), sin fusionar cuando caen el mismo día.

const ironStore = useIronStore()
const accountsStore = useAccountsStore()

const selectedDate = ref(todayDateInputValue())
const isLoading = ref(true)
const loadError = ref(false)

const cigarettes = ref<IronCigarette[]>([])
const packs = ref<IronPack[]>([])
const partners = ref<{ id: string, smoked_date: string, smoked_time: string, closes_cigarette_id: string | null }[]>([])
const linkedExpenseAccounts = ref<Record<string, string>>({})

const datePickerInput = ref<HTMLInputElement | null>(null)

async function reload() {
  isLoading.value = true
  loadError.value = false
  const res = await ironStore.fetchDay(selectedDate.value)
  if (!res) {
    loadError.value = true
    isLoading.value = false
    return
  }
  cigarettes.value = res.cigarettes
  packs.value = res.packs
  partners.value = res.partners
  linkedExpenseAccounts.value = res.linkedExpenseAccounts
  isLoading.value = false
}

onMounted(async () => {
  await accountsStore.fetchAccounts()
  await reload()
})

const dayLabel = computed(() => dayNavigatorLabel(selectedDate.value))
const isViewingToday = computed(() => selectedDate.value === todayDateInputValue())

function goToPreviousDay() {
  const d = parseDateOnly(selectedDate.value)
  d.setDate(d.getDate() - 1)
  selectedDate.value = formatDateOnly(d)
  void reload()
}
function goToNextDay() {
  if (isViewingToday.value) return
  const d = parseDateOnly(selectedDate.value)
  d.setDate(d.getDate() + 1)
  selectedDate.value = formatDateOnly(d)
  void reload()
}
function goToToday() {
  selectedDate.value = todayDateInputValue()
  void reload()
}
function openDatePicker() {
  datePickerInput.value?.showPicker?.()
}
function onPickDate(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!value || isFutureDate(value)) return
  selectedDate.value = value
  void reload()
}

// --- Timeline mixto del día (sección 5.3) ----------------------------------

interface PackItem {
  type: 'pack'
  id: string
  sortTime: string
  time: string
  cost: number
  linkedAccountName: string | null
  pack: IronPack
}
interface EnteroItem {
  type: 'entero'
  id: string
  sortTime: string
  time: string
  cigarette: IronCigarette
}
interface SimpleMitadItem {
  type: 'mitad_pendiente' | 'mitad_descartada'
  id: string
  sortTime: string
  time: string
  cigarette: IronCigarette
}
// Sección 12.3.3: una mitad completa siempre se renderiza como su propia fila
// (nunca fusionada), sea del mismo día o de otro. Cada fila lleva la referencia
// a su pareja para el subtítulo cruzado y la validación blanda de edición.
interface MitadCompletaItem {
  type: 'mitad_completa'
  id: string
  sortTime: string
  time: string
  isFirstHalf: boolean
  sameDay: boolean
  partnerDate: string
  partnerTime: string
  partnerDayLabel: string
  cigarette: IronCigarette
}
type DayItem = PackItem | EnteroItem | SimpleMitadItem | MitadCompletaItem

function accountNameFor(pack: IronPack): string | null {
  if (!pack.linked_expense_id) return null
  const accountId = linkedExpenseAccounts.value[pack.linked_expense_id]
  if (!accountId) return null
  return accountsStore.accountById(accountId)?.name ?? null
}

const dayItems = computed<DayItem[]>(() => {
  const items: DayItem[] = []

  // Mapa id -> referencia (fecha/hora) de toda fila relevante (día + parejas),
  // y closer-por-padre para resolver mitades completas (sección 5.3).
  const refById = new Map<string, { smoked_date: string, smoked_time: string }>()
  const closerByParent = new Map<string, { smoked_date: string, smoked_time: string }>()
  const register = (row: { id: string, smoked_date: string, smoked_time: string, closes_cigarette_id: string | null }) => {
    refById.set(row.id, { smoked_date: row.smoked_date, smoked_time: row.smoked_time })
    if (row.closes_cigarette_id) {
      closerByParent.set(row.closes_cigarette_id, { smoked_date: row.smoked_date, smoked_time: row.smoked_time })
    }
  }
  for (const c of cigarettes.value) register(c)
  for (const p of partners.value) register(p)

  for (const pack of packs.value) {
    items.push({
      type: 'pack',
      id: pack.id,
      sortTime: pack.purchased_time,
      time: pack.purchased_time,
      cost: pack.cost,
      linkedAccountName: accountNameFor(pack),
      pack,
    })
  }

  for (const c of cigarettes.value) {
    if (c.kind === 'entero') {
      items.push({ type: 'entero', id: c.id, sortTime: c.smoked_time, time: c.smoked_time, cigarette: c })
      continue
    }
    // kind === 'mitad'
    if (c.status === 'mitad_pendiente') {
      items.push({ type: 'mitad_pendiente', id: c.id, sortTime: c.smoked_time, time: c.smoked_time, cigarette: c })
      continue
    }
    if (c.status === 'descartada') {
      items.push({ type: 'mitad_descartada', id: c.id, sortTime: c.smoked_time, time: c.smoked_time, cigarette: c })
      continue
    }
    // status === 'completo': sección 12.3.3 — SIEMPRE una fila propia por mitad
    // (nunca fusionada). Si la pareja cayó el mismo día, ambas están en
    // `cigarettes.value` y cada una emite su propia fila.
    const isFirstHalf = !c.closes_cigarette_id
    const partner = isFirstHalf
      ? closerByParent.get(c.id)
      : (c.closes_cigarette_id ? refById.get(c.closes_cigarette_id) : undefined)

    items.push({
      type: 'mitad_completa',
      id: c.id,
      sortTime: c.smoked_time,
      time: c.smoked_time,
      isFirstHalf,
      sameDay: !!partner && partner.smoked_date === selectedDate.value,
      partnerDate: partner?.smoked_date ?? '',
      partnerTime: partner?.smoked_time ?? '',
      partnerDayLabel: partner ? dayNavigatorLabel(partner.smoked_date) : '',
      cigarette: c,
    })
  }

  return items.sort((a, b) => a.sortTime.localeCompare(b.sortTime))
})

const dayCigaretteUnits = computed(() => sumCigaretteUnits(cigarettes.value))
const dayCigaretteLabel = computed(() => formatCigaretteCount(dayCigaretteUnits.value))
const dayPackSpend = computed(() => packs.value.reduce((sum, p) => sum + p.cost, 0))

// --- Cerrar mitad pendiente inline (sección 5.3) ---------------------------
async function onClosePendingHalf(id: string) {
  const ok = await ironStore.closePendingHalf(id)
  if (ok) await reload()
}

// --- Compra: editar (abre el Sheet) ----------------------------------------
const isPackSheetOpen = ref(false)
const editingPack = ref<IronPack | null>(null)
const editingPackLinkedAccountId = ref<string | null>(null)
function openEditPackSheet(pack: IronPack) {
  editingPack.value = pack
  editingPackLinkedAccountId.value = pack.linked_expense_id
    ? (linkedExpenseAccounts.value[pack.linked_expense_id] ?? null)
    : null
  isPackSheetOpen.value = true
}
function onPackSaved() {
  void reload()
}

// --- Editar hora (entero o cualquier mitad, sección 5.3 / 12.3.3.a-b) -------
const isEditCigaretteSheetOpen = ref(false)
const editingCigaretteId = ref<string | null>(null)
const editForm = ref({ date: todayDateInputValue(), time: '' })
const isSavingCigarette = ref(false)
// Restricción blanda cuando la fila editada es parte de un par completo
// (sección 12.3.3.a/b): no puede cruzar el horario de su pareja. `null` para
// enteros y mitades sin pareja (sin restricción).
const editPartnerBound = ref<{ date: string, time: string, isFirstHalf: boolean } | null>(null)

function openEditCigaretteSheet(
  cigarette: IronCigarette,
  bound: { date: string, time: string, isFirstHalf: boolean } | null = null,
) {
  editingCigaretteId.value = cigarette.id
  editForm.value = { date: cigarette.smoked_date, time: formatTimeShort(cigarette.smoked_time) }
  // Sin pareja resuelta (edge defensivo) no hay restricción que aplicar.
  editPartnerBound.value = bound && bound.date && bound.time ? bound : null
  isEditCigaretteSheetOpen.value = true
}

// Error de validación blanda (sección 12.3.3.a/b): comparación puramente en
// cliente contra la fecha/hora de la pareja, con el mensaje exacto del doc.
const editTimeError = computed(() => {
  const bound = editPartnerBound.value
  if (!bound || !editForm.value.date || !editForm.value.time) return ''
  const edited = `${editForm.value.date} ${editForm.value.time}`
  const partner = `${bound.date} ${formatTimeShort(bound.time)}`
  if (bound.isFirstHalf && edited > partner) {
    return `Fecha/hora no puede ser posterior a la de la segunda mitad (${pendingSinceLabel(bound.date, bound.time)}).`
  }
  if (!bound.isFirstHalf && edited < partner) {
    return `Fecha/hora no puede ser anterior a la de la primera mitad (${pendingSinceLabel(bound.date, bound.time)}).`
  }
  return ''
})

async function saveCigaretteTime() {
  if (!editingCigaretteId.value || !editForm.value.date || !editForm.value.time) return
  if (isFutureDate(editForm.value.date)) return
  if (editTimeError.value) return
  isSavingCigarette.value = true
  try {
    const ok = await ironStore.editCigaretteTime(editingCigaretteId.value, editForm.value.date, editForm.value.time)
    if (!ok) return
    toast.success('Cambios guardados')
    isEditCigaretteSheetOpen.value = false
    await reload()
  } finally {
    isSavingCigarette.value = false
  }
}

// --- Cigarrillo entero: eliminar -------------------------------------------
const isDeleteDialogOpen = ref(false)
const deletingCigaretteId = ref<string | null>(null)
const isDeletingCigarette = ref(false)
function confirmDeleteCigarette(id: string) {
  deletingCigaretteId.value = id
  isDeleteDialogOpen.value = true
}
async function onConfirmDeleteCigarette() {
  if (!deletingCigaretteId.value) return
  isDeletingCigarette.value = true
  try {
    const ok = await ironStore.deleteCigarette(deletingCigaretteId.value)
    if (!ok) return
    toast.success('Registro eliminado')
    isDeleteDialogOpen.value = false
    await reload()
  } finally {
    isDeletingCigarette.value = false
  }
}

// --- Eliminar una mitad de un par completo (sección 12.3.3.c/d) -------------
// Borrado asimétrico por rol: la mitad que CIERRA se puede eliminar (deshace el
// cierre, la original vuelve a pendiente vía RPC); la mitad ORIGINAL no (solo
// un toast informativo, nunca abre diálogo).
const isUndoCloseDialogOpen = ref(false)
const undoClosingId = ref<string | null>(null)
const isUndoingClose = ref(false)

function onDeleteHalfOfPair(item: MitadCompletaItem) {
  if (item.isFirstHalf) {
    // 12.3.3.d: la original ya fue cerrada — se bloquea el borrado directo.
    toast('Esta mitad ya fue cerrada', {
      description: 'Para deshacerla, eliminá la segunda mitad primero.',
      duration: 6000,
    })
    return
  }
  undoClosingId.value = item.id
  isUndoCloseDialogOpen.value = true
}

async function onConfirmUndoClose() {
  if (!undoClosingId.value) return
  isUndoingClose.value = true
  try {
    const result = await ironStore.undoClosePendingHalf(undoClosingId.value)
    if (result === 'ok') {
      toast.success('Cierre deshecho')
      isUndoCloseDialogOpen.value = false
      await reload()
    } else if (result === 'conflict') {
      // 12.3.3.c: el diálogo queda abierto para cancelar o reintentar luego.
      toast.error('No pudimos deshacer este cierre: ya tenés otra mitad pendiente abierta.', {
        description: 'Cerrala o descartala primero e intentá de nuevo.',
      })
    } else {
      toast.error('No pudimos eliminar este registro', {
        description: 'Revisá tu conexión e intentá de nuevo.',
        action: { label: 'Reintentar', onClick: () => void onConfirmUndoClose() },
      })
    }
  } finally {
    isUndoingClose.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Historial" />

    <main class="mx-auto flex max-w-2xl flex-col">
      <!-- Sección 5.2: navegador de día -->
      <div class="flex items-center justify-between gap-2 border-b border-border px-2 py-2 sm:px-4">
        <Button variant="ghost" size="icon" class="h-11 w-11" aria-label="Día anterior" @click="goToPreviousDay">
          <ChevronLeft class="size-5" />
        </Button>

        <button
          type="button"
          class="relative flex-1 rounded-md py-2 text-center text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          @click="openDatePicker"
        >
          {{ dayLabel }}
          <input
            ref="datePickerInput"
            type="date"
            aria-label="Elegir día"
            class="absolute inset-0 cursor-pointer text-base opacity-0"
            :max="todayDateInputValue()"
            :value="selectedDate"
            @change="onPickDate"
          >
        </button>

        <Button
          variant="ghost"
          size="icon"
          class="h-11 w-11"
          aria-label="Día siguiente"
          :disabled="isViewingToday"
          @click="goToNextDay"
        >
          <ChevronRight class="size-5" />
        </Button>
      </div>
      <Button v-if="!isViewingToday" variant="link" size="sm" class="mx-auto block h-auto p-2" @click="goToToday">
        Volver a hoy
      </Button>

      <!-- Sección 5.4: resumen del día -->
      <div
        v-if="!isLoading && !loadError && dayItems.length"
        class="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground sm:px-6"
      >
        <span>{{ dayCigaretteLabel }}</span>
        <span v-if="dayPackSpend > 0">${{ formatAmount(dayPackSpend) }} en compras</span>
      </div>

      <!-- Estado de carga -->
      <div v-if="isLoading" class="flex flex-col gap-3 p-4">
        <Skeleton v-for="n in 4" :key="n" class="h-14 w-full rounded-lg" />
      </div>

      <!-- Estado de error -->
      <div v-else-if="loadError" class="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertCircle class="size-12 text-destructive" />
        <p class="text-sm text-muted-foreground">
          No pudimos cargar el historial de este día
        </p>
        <Button variant="outline" @click="reload">
          <RotateCcw class="size-4" />
          Reintentar
        </Button>
      </div>

      <!-- Estado vacío del día -->
      <div v-else-if="!dayItems.length" class="flex min-h-[40vh] items-center justify-center px-4 text-center text-sm text-muted-foreground">
        Sin registros este día.
      </div>

      <!-- Listado mixto -->
      <div v-else class="flex flex-col">
        <template v-for="(item, idx) in dayItems" :key="item.id">
          <Separator v-if="idx > 0" />

          <!-- Compra de cajetilla -->
          <button
            v-if="item.type === 'pack'"
            type="button"
            class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            @click="openEditPackSheet(item.pack)"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Package class="size-4 text-muted-foreground" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                Cajetilla comprada
              </p>
              <p class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                {{ formatTimeShort(item.time) }}
                <span v-if="item.linkedAccountName" class="flex items-center gap-1">
                  · <Wallet class="inline size-3" /> {{ item.linkedAccountName }}
                </span>
              </p>
            </div>
            <p class="shrink-0 text-sm font-semibold tabular-nums">
              ${{ formatAmount(item.cost) }}
            </p>
          </button>

          <!-- Cigarrillo entero -->
          <div v-else-if="item.type === 'entero'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Cigarette class="size-4 text-muted-foreground" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                Cigarrillo entero
              </p>
              <p class="text-xs text-muted-foreground">
                {{ formatTimeShort(item.time) }}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="h-11 w-11" aria-label="Más opciones">
                  <MoreVertical class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @select="openEditCigaretteSheet(item.cigarette)">
                  Editar hora
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" @select="confirmDeleteCigarette(item.id)">
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <!-- Mitad pendiente -->
          <div v-else-if="item.type === 'mitad_pendiente'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
              <Clock class="size-4" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                Media (pendiente)
              </p>
              <p class="text-xs text-muted-foreground">
                {{ formatTimeShort(item.time) }}
              </p>
            </div>
            <Button size="sm" class="h-11 shrink-0" @click="onClosePendingHalf(item.id)">
              Cerrar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="h-11 w-11 shrink-0" aria-label="Más opciones">
                  <MoreVertical class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @select="openEditCigaretteSheet(item.cigarette)">
                  Editar hora
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" @select="confirmDeleteCigarette(item.id)">
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <!-- Mitad descartada -->
          <div v-else-if="item.type === 'mitad_descartada'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <CigaretteOff class="size-4 text-muted-foreground" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                Media (no terminada)
              </p>
              <p class="text-xs text-muted-foreground">
                {{ formatTimeShort(item.time) }}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="h-11 w-11" aria-label="Más opciones">
                  <MoreVertical class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @select="openEditCigaretteSheet(item.cigarette)">
                  Editar hora
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" @select="confirmDeleteCigarette(item.id)">
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <!-- Mitad completa: siempre su propia fila (sección 12.3.3) -->
          <div v-else-if="item.type === 'mitad_completa'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Cigarette class="size-4 text-muted-foreground" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                {{ item.isFirstHalf ? 'Media' : 'Segunda mitad' }}
              </p>
              <p class="truncate text-xs text-muted-foreground">
                {{ formatTimeShort(item.time) }} ·
                {{ item.isFirstHalf ? 'cerrada' : 'empezada' }}
                {{ item.sameDay ? `a las ${formatTimeShort(item.partnerTime)}` : `el ${item.partnerDayLabel}` }}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="h-11 w-11" aria-label="Más opciones">
                  <MoreVertical class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  @select="openEditCigaretteSheet(item.cigarette, { date: item.partnerDate, time: item.partnerTime, isFirstHalf: item.isFirstHalf })"
                >
                  Editar hora
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" @select="onDeleteHalfOfPair(item)">
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </template>
      </div>
    </main>

    <IronPackFormSheet
      v-model:open="isPackSheetOpen"
      :pack="editingPack"
      :linked-account-id="editingPackLinkedAccountId"
      @saved="onPackSaved"
    />

    <!-- Sección 5.3: Sheet mínimo para editar la hora de un entero -->
    <Sheet v-model:open="isEditCigaretteSheetOpen">
      <SheetContent side="bottom" :show-close-button="!isSavingCigarette">
        <SheetHeader>
          <SheetTitle>Editar hora</SheetTitle>
        </SheetHeader>
        <form id="edit-cigarette-form" class="flex gap-3 px-4" novalidate @submit.prevent="saveCigaretteTime">
          <div class="flex flex-1 flex-col gap-1.5">
            <Label for="edit-fecha">Fecha</Label>
            <Input
              id="edit-fecha"
              v-model="editForm.date"
              type="date"
              class="h-11 text-base"
              :max="todayDateInputValue()"
              :disabled="isSavingCigarette"
            />
          </div>
          <div class="flex flex-1 flex-col gap-1.5">
            <Label for="edit-hora">Hora</Label>
            <Input
              id="edit-hora"
              v-model="editForm.time"
              type="time"
              class="h-11 text-base"
              :disabled="isSavingCigarette"
            />
          </div>
        </form>
        <!-- Sección 12.3.3.a/b: validación blanda de orden temporal contra la pareja -->
        <p v-if="editTimeError" class="px-4 text-xs text-destructive">
          {{ editTimeError }}
        </p>
        <SheetFooter>
          <Button type="submit" form="edit-cigarette-form" class="h-11 w-full" :disabled="isSavingCigarette || !!editTimeError">
            <Loader2 v-if="isSavingCigarette" class="size-4 animate-spin" />
            {{ isSavingCigarette ? 'Guardando…' : 'Guardar cambios' }}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <AlertDialog v-model:open="isDeleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este registro?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isDeletingCigarette">
            Cancelar
          </AlertDialogCancel>
          <Button variant="destructive" :disabled="isDeletingCigarette" @click="onConfirmDeleteCigarette">
            <Loader2 v-if="isDeletingCigarette" class="size-4 animate-spin" />
            {{ isDeletingCigarette ? 'Eliminando…' : 'Eliminar' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Sección 12.3.3.c: eliminar la mitad que cierra un par (deshace el cierre) -->
    <AlertDialog v-model:open="isUndoCloseDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar esta mitad?</AlertDialogTitle>
          <AlertDialogDescription>
            La mitad original va a volver a quedar pendiente, como si todavía no
            la hubieras terminado. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isUndoingClose">
            Cancelar
          </AlertDialogCancel>
          <Button variant="destructive" :disabled="isUndoingClose" @click="onConfirmUndoClose">
            <Loader2 v-if="isUndoingClose" class="size-4 animate-spin" />
            {{ isUndoingClose ? 'Eliminando…' : 'Eliminar' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
