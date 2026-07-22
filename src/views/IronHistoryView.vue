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
import { dayNavigatorLabel, formatCigaretteCount, sumCigaretteUnits } from '@/lib/iron'
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
// tab Historial de /deudas). Edición/eliminación de la hora de un entero vía
// menú "⋮"; cierre inline de una mitad pendiente. Las mitades no llevan menú
// (sección 5.3: "sin menú en mitades" — si el usuario se equivocó, borra y
// vuelve a registrar).

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
}
interface MitadMismoDiaItem {
  type: 'mitad_completa_mismo_dia'
  id: string
  sortTime: string
  firstTime: string
  secondTime: string
}
interface MitadOtroDiaItem {
  type: 'mitad_completa_otro_dia'
  id: string
  sortTime: string
  time: string
  isFirstHalf: boolean
  otherDayLabel: string
}
type DayItem = PackItem | EnteroItem | SimpleMitadItem | MitadMismoDiaItem | MitadOtroDiaItem

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
      items.push({ type: 'mitad_pendiente', id: c.id, sortTime: c.smoked_time, time: c.smoked_time })
      continue
    }
    if (c.status === 'descartada') {
      items.push({ type: 'mitad_descartada', id: c.id, sortTime: c.smoked_time, time: c.smoked_time })
      continue
    }
    // status === 'completo'
    const isFirstHalf = !c.closes_cigarette_id
    const partner = isFirstHalf
      ? closerByParent.get(c.id)
      : (c.closes_cigarette_id ? refById.get(c.closes_cigarette_id) : undefined)

    if (partner && partner.smoked_date === selectedDate.value) {
      // Ambas mitades el mismo día: fila fusionada, emitida una sola vez (al
      // procesar la PRIMERA mitad; se saltea la segunda).
      if (isFirstHalf) {
        const [firstTime, secondTime] = [c.smoked_time, partner.smoked_time].sort()
        items.push({
          type: 'mitad_completa_mismo_dia',
          id: c.id,
          sortTime: firstTime!,
          firstTime: firstTime!,
          secondTime: secondTime!,
        })
      }
      continue
    }

    // La otra parte cayó otro día (o falta): fila propia con referencia cruzada.
    items.push({
      type: 'mitad_completa_otro_dia',
      id: c.id,
      sortTime: c.smoked_time,
      time: c.smoked_time,
      isFirstHalf,
      otherDayLabel: partner ? dayNavigatorLabel(partner.smoked_date) : '',
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

// --- Cigarrillo entero: editar hora ----------------------------------------
const isEditCigaretteSheetOpen = ref(false)
const editingCigaretteId = ref<string | null>(null)
const editForm = ref({ date: todayDateInputValue(), time: '' })
const isSavingCigarette = ref(false)
function openEditCigaretteSheet(cigarette: IronCigarette) {
  editingCigaretteId.value = cigarette.id
  editForm.value = { date: cigarette.smoked_date, time: formatTimeShort(cigarette.smoked_time) }
  isEditCigaretteSheetOpen.value = true
}
async function saveCigaretteTime() {
  if (!editingCigaretteId.value || !editForm.value.date || !editForm.value.time) return
  if (isFutureDate(editForm.value.date)) return
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
          </div>

          <!-- Mitad completa: ambas partes el mismo día (fila fusionada) -->
          <div v-else-if="item.type === 'mitad_completa_mismo_dia'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Cigarette class="size-4 text-muted-foreground" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                1 cigarrillo (en 2 partes)
              </p>
              <p class="text-xs text-muted-foreground">
                {{ formatTimeShort(item.firstTime) }} y {{ formatTimeShort(item.secondTime) }}
              </p>
            </div>
          </div>

          <!-- Mitad completa: la otra parte fue otro día -->
          <div v-else-if="item.type === 'mitad_completa_otro_dia'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Cigarette class="size-4 text-muted-foreground" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <p class="text-sm font-medium">
                {{ item.isFirstHalf ? 'Media' : 'Segunda mitad' }}
              </p>
              <p class="truncate text-xs text-muted-foreground">
                {{ formatTimeShort(item.time) }}
                <span v-if="item.otherDayLabel">
                  · {{ item.isFirstHalf ? 'cerrada el' : 'empezada el' }} {{ item.otherDayLabel }}
                </span>
              </p>
            </div>
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
        <SheetFooter>
          <Button type="submit" form="edit-cigarette-form" class="h-11 w-full" :disabled="isSavingCigarette">
            <Loader2 v-if="isSavingCigarette" class="size-4 animate-spin" />
            {{ isSavingCigarette ? 'Guardando…' : 'Guardar cambios' }}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <AlertDialog v-model:open="isDeleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este cigarrillo?</AlertDialogTitle>
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
  </div>
</template>
