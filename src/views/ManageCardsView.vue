<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  CreditCard as CreditCardIcon,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  User,
  Users,
} from '@lucide/vue'
import { formatAmount } from '@/lib/currency'
import { useCreditCardsStore, type CreditCard } from '@/stores/creditCards'
import { useCardPeopleStore, type CardPerson } from '@/stores/cardPeople'
import CardFormSheet from '@/components/CardFormSheet.vue'
import CardPersonFormSheet from '@/components/CardPersonFormSheet.vue'
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

// Sección 6 de credit-cards-ux.md: una única ruta con dos secciones (tarjetas
// + personas), mismo layout que CategoriesView.

const router = useRouter()
const route = useRoute()
const creditCardsStore = useCreditCardsStore()
const cardPeopleStore = useCardPeopleStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [cardsOk, cardCountsOk, peopleOk, peopleCountsOk] = await Promise.all([
      creditCardsStore.fetchCards(),
      creditCardsStore.fetchExpenseCounts(),
      cardPeopleStore.fetchPeople(),
      cardPeopleStore.fetchExpenseCounts(),
    ])
    if (!cardsOk || !cardCountsOk || !peopleOk || !peopleCountsOk) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(async () => {
  await loadAll()
  // debts-ux.md sección 4.2/4.3: soporte de `?new=person`, llegada desde el
  // atajo "Agregar persona nueva" del alta de deuda — mismo patrón que
  // `?new=1` ya usado en Transacciones/Cuentas, con un valor de query
  // distinto para desambiguar cuál de las dos secciones de esta pantalla
  // abrir (acá hay dos Sheets posibles, tarjeta o persona).
  if (route.query.new === 'person') openAddPerson()
})

function cardUsageLabel(cardId: string): string {
  const count = creditCardsStore.countFor(cardId)
  if (count === 0) return 'Sin gastos'
  return count === 1 ? '1 gasto' : `${count} gastos`
}

function personUsageLabel(personId: string): string {
  const count = cardPeopleStore.countFor(personId)
  if (count === 0) return 'Sin gastos'
  return count === 1 ? '1 gasto' : `${count} gastos`
}

// Sheet de tarjetas.
const isCardSheetOpen = ref(false)
const editingCard = ref<CreditCard | null>(null)
function openAddCard() {
  editingCard.value = null
  isCardSheetOpen.value = true
}
function openEditCard(card: CreditCard) {
  editingCard.value = card
  isCardSheetOpen.value = true
}

// Sheet de personas.
const isPersonSheetOpen = ref(false)
const editingPerson = ref<CardPerson | null>(null)
function openAddPerson() {
  editingPerson.value = null
  isPersonSheetOpen.value = true
}
function openEditPerson(person: CardPerson) {
  editingPerson.value = person
  isPersonSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border px-4 py-1.5 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'cards' })">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-xl font-semibold">
        Tarjetas y personas
      </h1>
    </header>

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Estado de carga -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-32" />
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="i in 2" :key="i">
              <Separator v-if="i > 1" />
              <div class="flex items-center gap-3 px-4 py-3">
                <Skeleton class="size-8 rounded-full" />
                <Skeleton class="h-4 w-32" />
              </div>
            </template>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton class="h-4 w-24" />
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="i in 2" :key="i">
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
            No pudimos cargar tus tarjetas y personas
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
        <!-- Sección 6.2: Tus tarjetas -->
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tus tarjetas
            </CardTitle>
            <CardAction v-if="creditCardsStore.cards.length">
              <Button variant="outline" @click="openAddCard">
                <Plus class="size-4" />
                Nueva tarjeta
              </Button>
            </CardAction>
          </CardHeader>

          <div v-if="creditCardsStore.cards.length" class="flex flex-col">
            <template v-for="(card, idx) in creditCardsStore.cards" :key="card.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3">
                <span class="size-8 shrink-0 rounded-full" :style="{ background: card.color ?? undefined }" />
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="truncate text-sm font-medium">
                    {{ card.name }}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    •••• {{ card.last_four_digits }}
                    <span v-if="card.suggested_monthly_limit"> · Límite: ${{ formatAmount(card.suggested_monthly_limit) }}</span>
                  </p>
                </div>
                <span class="text-xs text-muted-foreground">{{ cardUsageLabel(card.id) }}</span>

                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" :aria-label="`Opciones de ${card.name}`">
                      <EllipsisVertical class="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEditCard(card)">
                      <Pencil class="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem
                          variant="destructive"
                          :disabled="creditCardsStore.countFor(card.id) >= 1"
                          @select="(e: Event) => e.preventDefault()"
                        >
                          <Trash2 class="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar "{{ card.name }}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="creditCardsStore.deleteCard(card.id)">
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
            <CreditCardIcon class="size-8 text-muted-foreground" />
            <p class="text-center text-sm font-medium">
              Todavía no agregaste ninguna tarjeta.
            </p>
            <Button variant="outline" @click="openAddCard">
              <Plus class="size-4" />
              Nueva tarjeta
            </Button>
          </div>
        </Card>

        <!-- Sección 6.3: Personas -->
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Personas
            </CardTitle>
            <CardAction v-if="cardPeopleStore.people.length">
              <Button variant="outline" @click="openAddPerson">
                <Plus class="size-4" />
                Nueva persona
              </Button>
            </CardAction>
          </CardHeader>

          <div v-if="cardPeopleStore.people.length" class="flex flex-col">
            <template v-for="(person, idx) in cardPeopleStore.people" :key="person.id">
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
                <span class="text-xs text-muted-foreground">{{ personUsageLabel(person.id) }}</span>

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
                          :disabled="cardPeopleStore.countFor(person.id) >= 1"
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
                          <AlertDialogAction @click="cardPeopleStore.deletePerson(person.id)">
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

    <CardFormSheet v-model:open="isCardSheetOpen" :card="editingCard" />
    <CardPersonFormSheet v-model:open="isPersonSheetOpen" :person="editingPerson" />
  </div>
</template>
