/** Normaliza para comparación insensible a mayúsculas/diacríticos — mismo
 * criterio ya usado server-side por la Edge Function `search-matches`
 * (live-matches-ux.md sección 5.1), ahora también en cliente. Primer
 * precedente de normalización de texto en el frontend
 * (transactions-filters-ux.md sección 3.3). */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
