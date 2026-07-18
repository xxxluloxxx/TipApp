// Reloj de partido en vivo (live-matches-ux.md sección 1.4). Port 1:1 del
// pseudocódigo de esa sección / MatchClock.kt de FottStat, con una
// diferencia deliberada de unidades: el pseudocódigo del doc asume que
// `stage_anchor_ts` es un epoch en segundos y divide `(now - anchor) / 60`.
// En el esquema real `stage_anchor_ts` es un `timestamptz` (ISO string) y el
// backend lo expone tal cual — se convierte con `new Date(...).getTime()`
// (milisegundos) y `now` también es `Date.now()` (ms), así que el minuto
// transcurrido se calcula sobre milisegundos (`/ 60000`). El resto de la
// lógica (etapas, `45+`/`90+`) es idéntica al doc.
//
// Códigos de etapa (`stage_code`, sección 1.4): 1 = no empezado, 12 = 1ª
// parte, 38 = descanso, 13 = 2ª parte, 3 = finalizado.

/** ¿El reloj está corriendo? (sección 3.4: `isLive`). Solo `12`/`13`. */
export function isLiveStage(stageCode: number | null | undefined): boolean {
  return stageCode === 12 || stageCode === 13
}

/** Formatea un ISO string a hora local `HH:MM` (`es-AR`). Reusado por la card
 * del reloj (`matchClockLabel`) y por el buscador de partidos del alta
 * (`MatchFormSheet.vue`, live-matches-ux.md sección 5.1.2) — mismo criterio de
 * formato horario, sin duplicar lógica. */
export function formatKickoffTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Label del reloj/etapa que se muestra en la card y el hero (secciones
 * 3.4/4.1). Recalculable cada segundo en cliente sin tocar la red: mientras
 * `stage_code` sea 12/13, el minuto "corre" solo entre polls (sección 1.4).
 */
export function matchClockLabel(
  stageCode: number | null | undefined,
  stageAnchorTs: string | null | undefined,
  scheduledKickoffTs: string | null | undefined,
  now: number,
): string {
  if (stageCode === null || stageCode === undefined) return '—'
  if (stageCode === 1) {
    return scheduledKickoffTs ? `Empieza ${formatKickoffTime(scheduledKickoffTs)}` : 'Por empezar'
  }
  if (stageCode === 38) return 'Descanso'
  if (stageCode === 3) return 'Finalizado'

  if (!stageAnchorTs) return '—' // dato inconsistente, red de seguridad (sección 1.4)
  const anchorMs = new Date(stageAnchorTs).getTime()
  if (Number.isNaN(anchorMs)) return '—'

  const elapsed = Math.max(0, Math.floor((now - anchorMs) / 60000))
  if (stageCode === 12) return elapsed > 45 ? '45+' : `${elapsed + 1}'`
  if (stageCode === 13) {
    const minute = 45 + elapsed + 1
    return minute > 90 ? '90+' : `${minute}'`
  }
  return '—'
}
