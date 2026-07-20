<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  AlertCircle,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
} from '@lucide/vue'
import { withAlpha } from '@/lib/colors'
import { useCategoriesStore, type Category } from '@/stores/categories'
import AppHeader from '@/components/AppHeader.vue'
import CategoryFormSheet from '@/components/CategoryFormSheet.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

const categoriesStore = useCategoriesStore()

const isInitialLoading = ref(true)
const loadError = ref(false)

// Sección 6: categorías + conteo de uso se cargan juntos, y si cualquiera
// de las dos partes falla se trata como falla de carga de toda la pantalla
// (no hay un estado degradado de "categorías sí, conteos no").
async function loadAll() {
  loadError.value = false
  isInitialLoading.value = true
  try {
    const [categoriesOk, countsOk] = await Promise.all([
      categoriesStore.fetchCategories(),
      categoriesStore.fetchExpenseCounts(),
    ])
    if (!categoriesOk || !countsOk) loadError.value = true
  } finally {
    isInitialLoading.value = false
  }
}

onMounted(loadAll)

function usageLabel(categoryId: string): string {
  const count = categoriesStore.countFor(categoryId)
  if (count === 0) return 'Sin gastos'
  return count === 1 ? '1 gasto' : `${count} gastos`
}

// Estado del Sheet de alta/edición.
const isSheetOpen = ref(false)
const editingCategory = ref<Category | null>(null)

function openAddSheet() {
  editingCategory.value = null
  isSheetOpen.value = true
}
function openEditSheet(category: Category) {
  editingCategory.value = category
  isSheetOpen.value = true
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader title="Categorías" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <!-- Estado de carga (sección 7.1) -->
      <template v-if="isInitialLoading">
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Categorías predeterminadas
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="i in 4" :key="i">
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
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mis categorías
            </CardTitle>
          </CardHeader>
          <div class="flex flex-col">
            <template v-for="i in 2" :key="i">
              <Separator v-if="i > 1" />
              <div class="flex items-center gap-3 px-4 py-3">
                <Skeleton class="size-8 rounded-full" />
                <Skeleton class="h-4 w-32" />
                <div class="ml-auto flex items-center gap-2">
                  <Skeleton class="h-3 w-16" />
                  <Skeleton class="size-11 rounded-md" />
                </div>
              </div>
            </template>
          </div>
        </Card>
      </template>

      <!-- Estado de error (sección 7.2) -->
      <template v-else-if="loadError">
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle class="size-12 text-destructive" />
          <h2 class="text-lg font-semibold">
            No pudimos cargar tus categorías
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
        <!-- Sección 2.1: Categorías predeterminadas -->
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Categorías predeterminadas
            </CardTitle>
            <CardDescription class="text-xs normal-case text-muted-foreground">
              No se pueden editar ni eliminar.
            </CardDescription>
          </CardHeader>

          <div class="flex flex-col">
            <template v-for="(category, idx) in categoriesStore.defaultCategories" :key="category.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3">
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-full border"
                  :style="{
                    backgroundColor: withAlpha(category.color, 0.12),
                    borderColor: category.color ?? undefined,
                  }"
                >
                  <span v-if="category.icon" class="text-base leading-none">{{ category.icon }}</span>
                </span>
                <p class="flex-1 truncate text-sm font-medium">
                  {{ category.name }}
                </p>
              </div>
            </template>
          </div>
        </Card>

        <!-- Sección 2.2/2.3: Mis categorías -->
        <Card>
          <CardHeader>
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mis categorías
            </CardTitle>
            <CardAction v-if="categoriesStore.customCategories.length">
              <Button variant="outline" @click="openAddSheet">
                <Plus class="size-4" />
                Nueva categoría
              </Button>
            </CardAction>
          </CardHeader>

          <!-- Sección 2.2 -->
          <div v-if="categoriesStore.customCategories.length" class="flex flex-col">
            <template v-for="(category, idx) in categoriesStore.customCategories" :key="category.id">
              <Separator v-if="idx > 0" />
              <div class="flex items-center gap-3 px-4 py-3">
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-full border"
                  :style="{
                    backgroundColor: withAlpha(category.color, 0.12),
                    borderColor: category.color ?? undefined,
                  }"
                >
                  <span class="size-2.5 rounded-full" :style="{ background: category.color ?? undefined }" />
                </span>
                <p class="flex-1 truncate text-sm font-medium">
                  {{ category.name }}
                </p>
                <span class="text-xs text-muted-foreground">{{ usageLabel(category.id) }}</span>

                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" :aria-label="`Opciones de ${category.name}`">
                      <EllipsisVertical class="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEditSheet(category)">
                      <Pencil class="size-4" />
                      Editar
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger as-child>
                        <DropdownMenuItem
                          variant="destructive"
                          :disabled="categoriesStore.countFor(category.id) >= 1"
                          @select="(e: Event) => e.preventDefault()"
                        >
                          <Trash2 class="size-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar "{{ category.name }}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction @click="categoriesStore.deleteCategory(category.id)">
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

          <!-- Sección 2.3: estado vacío -->
          <div v-else class="flex flex-col items-center gap-2 px-4 py-8">
            <Tag class="size-8 text-muted-foreground" />
            <p class="text-center text-sm font-medium">
              Todavía no creaste categorías propias.
            </p>
            <p class="mx-auto max-w-[220px] text-center text-xs text-muted-foreground">
              Creá una para organizar tus gastos como quieras.
            </p>
            <Button variant="outline" @click="openAddSheet">
              <Plus class="size-4" />
              Nueva categoría
            </Button>
          </div>
        </Card>
      </template>
    </main>

    <CategoryFormSheet v-model:open="isSheetOpen" :category="editingCategory" />
  </div>
</template>
