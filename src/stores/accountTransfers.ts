import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import { useAccountsStore } from '@/stores/accounts'
import { useExpensesStore } from '@/stores/expenses'
import type { Tables } from '@/types/database.types'

export type AccountTransfer = Tables<'account_transfers'>

export interface TransferPayload {
  fromAccountId: string
  toAccountId: string
  /** Monto transferido, siempre `> 0` (account-transfers-ux.md sección 4.6). */
  amount: number
  /** Comisión bancaria, `>= 0` (una comisión en $0 es válida — sección 1.2:
   * en ese caso el backend no crea ninguna fila de `expenses`). */
  commissionAmount: number
  transferDate: string
  description: string | null
}

// Mismo límite defensivo que `expenses.ts` (`MAX_EXPENSES`): el listado de
// transferencias puede crecer sin techo con el tiempo (sección 1.4), a
// diferencia de `debt_balances` (cardinalidad chica). Sin paginación en esta
// iteración, mismo pendiente que `expenses.ts`.
const MAX_TRANSFERS = 200

function sortTransfersDesc(list: AccountTransfer[]): AccountTransfer[] {
  return [...list].sort((a, b) => {
    if (a.transfer_date !== b.transfer_date) {
      return a.transfer_date < b.transfer_date ? 1 : -1
    }
    return a.created_at < b.created_at ? 1 : -1
  })
}

/**
 * Store de transferencias entre cuentas (account-transfers-ux.md). Sigue el
 * mismo principio "tonto" que `liveMatches.ts`/`debtsStore`: no deriva estado
 * ni saldos en cliente. Las tres operaciones (crear/editar/borrar) son **NO
 * optimistas** (sección 4.3): cada una depende de un resultado atómico
 * server-side (RPC que ajusta las dos cuentas + opcionalmente crea/actualiza/
 * borra el gasto de comisión). Tras confirmar, se refrescan los caches
 * derivados (`account_balances` y la lista de `expenses`) — mismo criterio de
 * "aplicar el resultado confirmado del servidor" ya usado por
 * `debtsStore.createDebt`, con un refetch completo en vez de un ajuste de
 * delta manual (elegido por simplicidad: son operaciones infrecuentes y no
 * optimistas, no hay ninguna sensación de "vivo" que preservar durante el
 * roundtrip — ver reporte).
 *
 * `update_account_transfer` es la ÚNICA edición del proyecto que NO preserva
 * el `id`: internamente borra y recrea, devolviendo un id nuevo. Por eso el
 * refetch de la lista (que reemplaza la fila vieja por la nueva) es lo más
 * simple y robusto — con `:key="transfer.id"` en el `v-for`, Vue re-renderiza
 * esa fila como nueva sin ningún estado colgando del id viejo.
 */
export const useAccountTransfersStore = defineStore('accountTransfers', () => {
  const transfers = ref<AccountTransfer[]>([])

  const hasTransfers = computed(() => transfers.value.length > 0)

  /**
   * `Set<string>` con los `expenses.id` que provienen de la comisión de una
   * transferencia. No existe `expenses.account_transfer_id` (decisión de
   * backend, ver reporte): se deriva del lado del cliente desde
   * `account_transfers.expense_id`, exactamente el mismo patrón que
   * `linkedLiveMatchIds` en `liveMatches.ts`. `TransactionsView` lo usa para
   * marcar esas filas y evitar su edición/borrado directo (sección 6.3).
   */
  const linkedExpenseIds = computed(
    () => new Set(
      transfers.value
        .map(transfer => transfer.expense_id)
        .filter((id): id is string => !!id),
    ),
  )

  function transferById(id: string): AccountTransfer | undefined {
    return transfers.value.find(transfer => transfer.id === id)
  }

  /** Trae las transferencias más recientes (sección 1.4), acotadas a
   * `MAX_TRANSFERS` y ordenadas por `transfer_date desc`. */
  async function fetchAll(): Promise<boolean> {
    const { data, error } = await supabase
      .from('account_transfers')
      .select('*')
      .order('transfer_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(MAX_TRANSFERS)

    if (error) {
      console.error('[accountTransfers] No se pudieron cargar las transferencias', error)
      return false
    }

    transfers.value = sortTransfersDesc((data ?? []) as AccountTransfer[])
    return true
  }

  /**
   * Refresca los caches derivados tras una mutación confirmada: la propia
   * lista de transferencias, los saldos de cuenta (`account_balances`, ya
   * ajustados server-side para las dos cuentas involucradas) y la lista de
   * `expenses` (la comisión puede haberse creado/actualizado/borrado). Se
   * refetchea `expenses` siempre —aunque la comisión sea $0— porque una
   * edición pudo, por ejemplo, borrar un gasto de comisión que antes existía:
   * determinar "qué cambió" requeriría conocer el estado viejo, y un refetch
   * completo (una query chica acotada a 200) es más simple y a prueba de
   * errores para una operación no optimista e infrecuente.
   */
  async function refreshDerivedCaches(): Promise<void> {
    await Promise.all([
      fetchAll(),
      useAccountsStore().fetchBalances(),
      useExpensesStore().fetchAll(),
    ])
  }

  /** Alta de transferencia (sección 4.3): NO optimista, vía el RPC atómico
   * `create_account_transfer`. Devuelve el `id` nuevo o un discriminante de
   * error para que el Sheet decida la rama de UI (mismo estilo que
   * `debtsStore.createDebt`). */
  async function createTransfer(payload: TransferPayload): Promise<{ id: string } | { error: true }> {
    const { data, error } = await supabase.rpc('create_account_transfer', {
      p_from_account_id: payload.fromAccountId,
      p_to_account_id: payload.toAccountId,
      p_amount: payload.amount,
      p_commission_amount: payload.commissionAmount,
      p_transfer_date: payload.transferDate,
      p_description: payload.description ?? undefined,
    })

    if (error || !data) {
      console.error('[accountTransfers] No se pudo crear la transferencia', error)
      return { error: true }
    }

    await refreshDerivedCaches()
    return { id: data }
  }

  /** Edición de transferencia (sección 4.3): NO optimista, vía el RPC atómico
   * `update_account_transfer`. OJO: este RPC NO preserva el `id` — borra y
   * recrea, devolviendo el id NUEVO. El refetch de `refreshDerivedCaches`
   * reemplaza la fila vieja por la nueva; el id nuevo se devuelve por si el
   * llamador venía guardando el viejo en algún estado local. */
  async function updateTransfer(id: string, payload: TransferPayload): Promise<{ id: string } | { error: true }> {
    const { data, error } = await supabase.rpc('update_account_transfer', {
      p_transfer_id: id,
      p_from_account_id: payload.fromAccountId,
      p_to_account_id: payload.toAccountId,
      p_amount: payload.amount,
      p_commission_amount: payload.commissionAmount,
      p_transfer_date: payload.transferDate,
      // La columna `description` es nullable, pero el tipo generado del RPC la
      // declara `string` (no `string | null`) — el cast preserva el `null` en
      // runtime para poder limpiar la descripción en una edición.
      p_description: (payload.description ?? null) as string,
    })

    if (error || !data) {
      console.error('[accountTransfers] No se pudo actualizar la transferencia', error)
      return { error: true }
    }

    await refreshDerivedCaches()
    return { id: data }
  }

  /** Borrado de transferencia (sección 3.3/4.3): NO optimista, vía el RPC
   * atómico `delete_account_transfer` (revierte el movimiento entre las dos
   * cuentas y borra el gasto de comisión asociado, si existía). El store
   * resuelve el toast; devuelve un booleano para que el `AlertDialog` cierre
   * y salga del estado "Eliminando…". */
  async function deleteTransfer(id: string): Promise<boolean> {
    const { error } = await supabase.rpc('delete_account_transfer', { p_transfer_id: id })

    if (error) {
      console.error('[accountTransfers] No se pudo eliminar la transferencia', error)
      toast.error('No se pudo eliminar la transferencia', {
        description: 'Revisá tu conexión e intentá de nuevo.',
      })
      return false
    }

    await refreshDerivedCaches()
    toast.success('Transferencia eliminada')
    return true
  }

  return {
    transfers,
    hasTransfers,
    linkedExpenseIds,
    transferById,
    fetchAll,
    createTransfer,
    updateTransfer,
    deleteTransfer,
  }
})
