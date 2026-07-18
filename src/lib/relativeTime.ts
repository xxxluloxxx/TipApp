// Tiempo relativo corto tipo "hace 18 s" / "hace 3 min" (live-matches-ux.md
// sección 1.5). No existe hoy nada así en `src/lib/date.ts` (todos sus
// helpers son de fecha de calendario, no de duración transcurrida) — de ahí
// este módulo chico y aparte. Se recalcula con un ticker en cliente (mismo
// `now` que el reloj del partido) para que el "Actualizado hace Ns" avance
// solo entre polls.

/**
 * Devuelve la parte "hace Ns/Nm/Nh/Nd" (sin el prefijo "Actualizado", que lo
 * pone la vista). `now` es inyectable para que un ticker reactivo lo mueva.
 */
export function relativeTimeShort(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'hace un momento'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'hace un momento'

  const diffSec = Math.max(0, Math.floor((now - then) / 1000))
  if (diffSec < 5) return 'recién'
  if (diffSec < 60) return `hace ${diffSec} s`

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `hace ${diffHours} h`

  const diffDays = Math.floor(diffHours / 24)
  return `hace ${diffDays} d`
}
