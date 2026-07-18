// Formato es-AR (separador de miles "."), sin decimales salvo que el monto
// realmente los tenga. No está 100% especificado en el doc de UX (los
// ejemplos de copy no muestran centavos), es la interpretación razonable
// más simple dado que `expenses.amount` es `numeric`.
const amountFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatAmount(amount: number): string {
  return amountFormatter.format(amount)
}

/** Formatea una cuota (odds) de apuesta: decimal plano con 2 posiciones, SIN
 * símbolo de moneda (no es dinero, es un multiplicador — live-coupons-ux.md
 * §6.3). `null`/`undefined` → "—" (cuota total no disponible cuando falta la
 * cuota de algún leg). */
export function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return '—'
  return odds.toFixed(2)
}
