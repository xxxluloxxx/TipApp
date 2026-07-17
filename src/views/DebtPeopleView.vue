<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  User,
  Users,
} from '@lucide/vue'
import { useDebtPeopleStore, type DebtPerson } from '@/stores/debtPeople'
import DebtPersonFormSheet from '@/components/DebtPersonFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card'
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// Sección 4.1 de debts-ux.md: ruta dedicada `/deudas/personas`, mismo layout
// que ManageCardsView pero con una sola sección (una sola entidad, no dos
// Card separadas). Alcanzable solo desde el botón Settings del header de
// Deudas y el atajo del Sheet de alta de deuda (sección 4.6, sin ítem en el
// drawer).

const router = useRouter()
const route = useRoute()
const debtPeopleStore = useDebtPeopleStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [peopleOk, countsOk] = await Promise.all([
      debtPeopleStore.fetchPeople(),
      debtPeopleStore.fetchDebtCounts(),
    ])
    if (!peopleOk || !countsOk) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(async () => {
  await loadAll()
  // Sección 4.4: soporte de `?new=1`, llegada desde el atajo "Agregar persona
  // nueva" del alta de deuda — mismo patrón que `?new=1` ya usado en
  // Cuentas/Transacciones (una sola entidad, no hace falta desambiguar).
  if (route.query.new === '1') openAddPerson()
})

function usageLabel(personId: string): string {
  const count = debtPeopleStore.countFor(personId)
  if (count === 0) return 'Sin deudas'
  return count === 1 ? '1 deuda' : `${count} deudas`
}

const isPersonSheetOpen = ref(false)
const editingPerson = ref<DebtPerson | null>(null)
function openAddPerson() {
  editingPerson.value = null
  isPersonSheetOpen.value = true
}
function openEditPerson(person: DebtPerson) {
  editingPerson.value = person
  isPersonSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-1.5 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'debts' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-xl font-semibold">
        Personas
      </h1>
    </header>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-24" />
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="i in 3" :key="i">
              <Separator v-if="i > 1" />
              <div class="flex items-center gap-3 px-4 py-3">
                <Skeleton class="size-8 rounded-full" />
                <Skeleton class="h-4 w-32" />
              </div>
            </template>
          </div>
        </Card>
      </template>

      <!-- Estado de error -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus personas
          </h2>
          <p class="text-sm text-muted-foreground">
            Revisá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" @click="loadAll">
            <RotateCcw class="size-4" />
            Reintentar
          </Button>
        </div>
      </template>

      <template v-else>
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Personas
            </CardTitle>
            <CardAction v-if="debtPeopleStore.people.length">
              <Button variant="outline" @click="openAddPerson">
                <Plus class="size-4" />
                Nueva persona
              </Button>
            </CardAction>
          </CardHeader>

          <div v-if="debtPeopleStore.people.length" class="flex flex-col">
            <template v-for="(person, idx) in debtPeopleStore.people" :key="person.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3">
                <span
                  v-if="person.color"
                  class="size-8 shrink-0 rounded-full"
                  :style="{ background: person.color }"
                />
                <span v-else class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User class="size-4 text-muted-foreground" />
                </span>
                <p class="flex-1 truncate text-sm font-medium">
                  {{ person.name }}
                </p>
                <span class="text-xs text-muted-foreground">{{ usageLabel(person.id) }}</span>

                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" :aria-label="`Opciones de ${person.name}`">
                      <EllipsisVertical class="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEditPerson(person)">
                      <Pencil class="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem
                          variant="destructive"
                          :disabled="debtPeopleStore.countFor(person.id) >= 1"
                          @select="(e: Event) => e.preventDefault()"
                        >
                          <Trash2 class="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar "{{ person.name }}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="debtPeopleStore.deletePerson(person.id)">
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </template>
          </div>

          <div v-else class="flex flex-col items-center gap-2 px-4 py-8">
            <Users class="size-8 text-muted-foreground" />
            <p class="text-center text-sm font-medium">
              Todavía no agregaste ninguna persona.
            </p>
            <Button variant="outline" @click="openAddPerson">
              <Plus class="size-4" />
              Nueva persona
            </Button>
          </div>
        </Card>
      </template>
    </main>

    <DebtPersonFormSheet v-model:open="isPersonSheetOpen" :person="editingPerson" />
  </div>
</template>
