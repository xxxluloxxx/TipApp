import { Banknote, Building2, Landmark, PiggyBank, ShieldCheck, Wallet } from '@lucide/vue'
import type { Component } from 'vue'

/**
 * Set fijo de 6 íconos de cuenta (accounts-income-ux.md sección 5.1), todos
 * ya confirmados existentes en `@lucide/vue` (nada que instalar). `key` es
 * el valor persistido en `accounts.icon` (columna `text` libre, sin `check`
 * en BD — el frontend es quien restringe el set real).
 */
export const ACCOUNT_ICON_OPTIONS = [
  { key: 'wallet', component: Wallet, label: 'Billetera' },
  { key: 'piggy-bank', component: PiggyBank, label: 'Ahorros' },
  { key: 'landmark', component: Landmark, label: 'Banco' },
  { key: 'building-2', component: Building2, label: 'Negocio' },
  { key: 'shield-check', component: ShieldCheck, label: 'Protegida' },
  { key: 'banknote', component: Banknote, label: 'Efectivo' },
] as const

export type AccountIconKey = (typeof ACCOUNT_ICON_OPTIONS)[number]['key']

/** Mapa `key -> componente` para resolver directamente en templates
 * (`ACCOUNT_ICONS[account.icon]`), sección 2.3/6.2 del doc. Si el valor
 * guardado no matchea ninguna key conocida (dato legado/manual), el llamador
 * debe caer a un ícono por defecto — ver `resolveAccountIcon`. */
export const ACCOUNT_ICONS: Record<AccountIconKey, Component> = ACCOUNT_ICON_OPTIONS.reduce(
  (acc, item) => {
    acc[item.key] = item.component
    return acc
  },
  {} as Record<AccountIconKey, Component>,
)

export const DEFAULT_ACCOUNT_ICON: AccountIconKey = 'wallet'

/** Resuelve el ícono a renderizar para un `accounts.icon` potencialmente
 * `null`/legado, cayendo siempre a `Wallet` en vez de dejar el slot vacío. */
export function resolveAccountIcon(icon: string | null | undefined): Component {
  if (icon && icon in ACCOUNT_ICONS) return ACCOUNT_ICONS[icon as AccountIconKey]
  return ACCOUNT_ICONS[DEFAULT_ACCOUNT_ICON]
}
