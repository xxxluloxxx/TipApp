import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Tables } from '@/types/database.types'

export type Category = Tables<'categories'>

export interface CategoryPayload {
  name: string
  color: string
}

/** Resultado de alta/edición (sección 3.4 de categories-mvp-ux.md): no se
 * usan excepciones para el camino de error esperado (conflicto de nombre),
 * así el Sheet puede decidir en qué rama de UI caer sin un try/catch. */
export interface CategoryMutationResult {
  category?: Category
  /** Código de error Postgres (p. ej. `23505`) o `'unknown'` si no vino de
   * un `PostgrestError` (falta de sesión, etc.). Ausente si `category` está
   * presente. */
  errorCode?: string
}

/**
 * Store de categorías, separado de `stores/expenses.ts`.
 *
 * Decisión: se separa (en vez de extender `expenses.ts`) porque a partir de
 * esta iteración las categorías tienen su propio ciclo de vida completo
 * (alta/edición/borrado, conteo de uso) que no depende de nada del store de
 * gastos — y, al revés, `expenses.ts` sí necesita leer categorías (para
 * armar el objeto optimista de un gasto nuevo/editado, sección 3.8 de
 * expenses-mvp-ux.md). Mantener "categories" como dueño único de su propio
 * estado y dejar que `expenses.ts` lo consuma (import de este store) es una
 * dependencia en un solo sentido — lo inverso (que este store dependiera de
 * `expenses.ts`) sí sería circular y se evita a propósito.
 */
export const useCategoriesStore = defineStore('categories', () => {
  const categories = ref<Category[]>([])
  /** Conteo de gastos por categoría propia del usuario (sección 6 de
   * categories-mvp-ux.md), usado para deshabilitar "Eliminar" de antemano.
   * Solo tiene entradas para categorías custom; las default nunca se borran
   * así que no las necesitan. */
  const expenseCounts = ref<Record<string, number>>({})

  // Mismo criterio/limitación que en expenses.ts: no hay columna sort_order,
  // se asume el orden de siembra vía created_at asc.
  const defaultCategories = computed(() =>
    [...categories.value]
      .filter(category => category.user_id === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  )

  const customCategories = computed(() =>
    [...categories.value]
      .filter(category => category.user_id !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  )

  function categoryById(categoryId: string): Category | undefined {
    return categories.value.find(category => category.id === categoryId)
  }

  /** Conteo de uso de una categoría custom (0 si todavía no se cargó o no
   * tiene gastos). Sección 2.2/6. */
  function countFor(categoryId: string): number {
    return expenseCounts.value[categoryId] ?? 0
  }

  /** Devuelve `false` (sin lanzar) si falla, mismo criterio no-throw que el
   * resto del store de expenses: el caller decide qué hacer con el booleano
   * (HomeView lo ignora, CategoriesView lo combina con el de los conteos). */
  async function fetchCategories(): Promise<boolean> {
    const { data, error: fetchError } = await supabase
      .from('categories')
      .select('*')

    if (fetchError) {
      console.error('[categories] No se pudieron cargar las categorías', fetchError)
      return false
    }

    categories.value = data ?? []
    return true
  }

  /**
   * Conteo de gastos por categoría custom del usuario (sección 6). Se
   * resuelve con un único query agregado embebido de PostgREST
   * (`categories?select=id,expenses(count)`), que hace el `count(*)
   * GROUP BY category_id` en la base de datos en vez de traer filas de
   * `expenses` al cliente para contarlas ahí. Se prefiere esto por sobre
   * reutilizar `expenses.ts` (que trae como mucho `MAX_EXPENSES = 200`
   * gastos, sección 2.3 de expenses-mvp-ux.md): con esa lista se podría
   * subcontar en una cuenta con más de 200 gastos históricos, justo el caso
   * donde más importa que el conteo sea exacto para decidir si "Eliminar"
   * debe estar deshabilitado.
   *
   * El embed de `expenses` respeta la RLS de esa tabla (select solo de las
   * propias del usuario) automáticamente, así que no hace falta filtrar por
   * `user_id` del lado de `expenses` acá — alcanza con filtrar `categories`
   * por `user_id = auth.uid()` para no pedir conteos de las categorías
   * default (que nunca se borran y por lo tanto no los necesitan).
   *
   * Limitación conocida: PostgREST devuelve el agregado como
   * `expenses: [{ count: number }]` (un array de un elemento), una forma
   * que los tipos generados de `database.types.ts` no modelan — de ahí el
   * cast puntual de abajo, igual criterio que los `as unknown as` ya
   * existentes en `expenses.ts` para selects con embeds.
   */
  async function fetchExpenseCounts(): Promise<boolean> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) {
      expenseCounts.value = {}
      return true
    }

    const { data, error: fetchError } = await supabase
      .from('categories')
      .select('id, expenses(count)')
      .eq('user_id', userId)

    if (fetchError) {
      console.error('[categories] No se pudieron cargar los conteos de uso', fetchError)
      return false
    }

    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as unknown as Array<{ id: string, expenses: Array<{ count: number }> }>) {
      counts[row.id] = row.expenses[0]?.count ?? 0
    }
    expenseCounts.value = counts
    return true
  }

  /** Alta (sección 3.4): no optimista, el Sheet queda a cargo de decidir qué
   * mostrar según `errorCode` (conflicto `23505` vs. cualquier otro). */
  async function addCategory(payload: CategoryPayload): Promise<CategoryMutationResult> {
    const authStore = useAuthStore()
    const userId = authStore.user?.id
    if (!userId) return { errorCode: 'unknown' }

    const { data, error: insertError } = await supabase
      .from('categories')
      .insert({ name: payload.name, color: payload.color, user_id: userId })
      .select('*')
      .single()

    if (insertError || !data) {
      return { errorCode: insertError?.code ?? 'unknown' }
    }

    categories.value = [...categories.value, data]
    return { category: data }
  }

  /** Edición (sección 3.4), mismo criterio no-optimista que `addCategory`. */
  async function updateCategory(id: string, payload: CategoryPayload): Promise<CategoryMutationResult> {
    const { data, error: updateError } = await supabase
      .from('categories')
      .update({ name: payload.name, color: payload.color })
      .eq('id', id)
      .select('*')
      .single()

    if (updateError || !data) {
      return { errorCode: updateError?.code ?? 'unknown' }
    }

    const idx = categories.value.findIndex(category => category.id === id)
    if (idx !== -1) {
      const next = [...categories.value]
      next.splice(idx, 1, data)
      categories.value = next
    }
    return { category: data }
  }

  /** Borrado optimista (sección 5): a diferencia de alta/edición, sí se
   * mantiene el patrón optimista de `expenses.ts` porque no hay validación
   * server-only en el camino feliz (el chequeo de "tiene gastos asociados"
   * ya se resolvió de antemano vía `countFor`, sección 6). El backstop de la
   * carrera rara (`23503`, se agrega un gasto justo antes de confirmar el
   * borrado) se trata igual que cualquier otra falla del `delete()`. */
  function deleteCategory(id: string): void {
    const removed = categoryById(id)
    if (!removed) return

    categories.value = categories.value.filter(category => category.id !== id)

    const persist = async (): Promise<void> => {
      const { error: deleteError } = await supabase.from('categories').delete().eq('id', id)

      if (deleteError) {
        // Reinserción: el orden real lo resuelve `customCategories`
        // (computed, alfabético), así que alcanza con volver a agregarla a
        // la lista base sin preocuparse por la posición.
        categories.value = [...categories.value, removed]
        toast.error('No se pudo eliminar la categoría', {
          description: 'Revisá tu conexión o si tiene gastos asociados.',
        })
        return
      }

      toast.success('Categoría eliminada')
    }

    void persist()
  }

  return {
    categories,
    defaultCategories,
    customCategories,
    expenseCounts,
    categoryById,
    countFor,
    fetchCategories,
    fetchExpenseCounts,
    addCategory,
    updateCategory,
    deleteCategory,
  }
})
