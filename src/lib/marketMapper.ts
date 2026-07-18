// =============================================================================
// marketMapper.ts (copia client-side)
// -----------------------------------------------------------------------------
// TypeScript PURO (sin dependencias de Deno): copia de
// `supabase/functions/_shared/marketMapper.ts` para el OCR del cupón que
// ahora corre en el navegador (ver `src/lib/betSlipParser.ts`). Si se toca la
// clasificación de mercados, mantener ambas copias en sync.
//
// Puerto 1:1 a TypeScript de MarketMapper.kt
// (/home/lulo/Proyectos/Propios/FottStat/android/app/src/main/java/com/fottstat/domain/MarketMapper.kt,
// domain PURO y testeado en el proyecto original). Clasifica el texto OCR
// de un leg (línea "pick" + línea "mercado") a un market_type interno +
// pick/market ya normalizados + threshold/selector — usado por el OCR
// client-side del cupón (src/lib/betSlipParser.ts → src/lib/betSlipOcr.ts).
// =============================================================================

export type MarketType =
  | 'double_chance'
  | 'match_result'
  | 'total_goals_over'
  | 'total_goals_under'
  | 'corners_over'
  | 'corners_under'
  | 'cards_over'
  | 'cards_under'
  | 'btts'
  | 'btts_first_half'
  | 'unknown'

export interface MarketMapping {
  marketType: MarketType
  pick: string // pick normalizado para mostrar ("Más 0.5", "1X", "No"...)
  market: string // etiqueta canónica del mercado
  threshold: number | null // N.5 de Over/Under
  selector: string | null // "1X"/"X2"/"12"/"1"/"X"/"2"/"yes"/"no"
}

const NUM = /(\d+(?:[.,]\d+)?)/
// Cuota (odds) pegada al final de la línea del pick — en fotos reales
// Tesseract suele fusionar el ícono del mercado + el pick + la cuota en una
// sola línea/bounding box (ej. "ES Sí 1.42", donde "ES" es el ícono de
// pelota mal leído). Se quita ANTES de tokenizar para no confundirla con el
// threshold de un pick over/under.
const TRAILING_QUOTA = /\s+\$?\d+[.,]\d+\s*$/

type PickKind = 'double_chance' | 'match_result' | 'over_under' | 'yes_no'

/** Clasifica un token de pick YA LIMPIO (ver `extractPickToken`). */
function pickKind(text: string): PickKind | null {
  const t = text.trim()
  const low = t.toLowerCase()
  if (/^(1x|x2|12)$/i.test(t)) return 'double_chance'
  if (/^(1|x|2)$/i.test(t)) return 'match_result'
  if (
    (low.startsWith('más') || low.startsWith('mas') || low.startsWith('menos') ||
      low.startsWith('over') || low.startsWith('under') || low.startsWith('+') || low.startsWith('-')) &&
    NUM.test(t)
  ) {
    return 'over_under'
  }
  if (/^(sí|si|no|yes|sim|não|nao)$/i.test(t)) return 'yes_no'
  return null
}

/**
 * Busca un pick DENTRO de una línea OCR que puede traer basura pegada (ícono
 * mal leído como prefijo, cuota decimal como sufijo) — a diferencia del
 * `pickKind` original, que exigía que la línea completa fuera exactamente el
 * pick y fallaba en fotos reales donde el ícono/cuota quedan en el mismo
 * bounding box (ver caso real: "ES Sí 1.42" nunca matcheaba `/^sí$/`).
 * Devuelve el token limpio ("Sí", "1X", "Más 2.5"...) o `null` si la línea no
 * contiene ningún pick reconocible.
 */
function extractPickToken(text: string): string | null {
  const withoutQuota = text.trim().replace(TRAILING_QUOTA, '').trim()
  const tokens = withoutQuota.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  const yesNo = tokens.find((tok) => /^(sí|si|no|yes|sim|não|nao)$/i.test(tok))
  if (yesNo) return yesNo

  const doubleChance = tokens.find((tok) => /^(1x|x2|12)$/i.test(tok))
  if (doubleChance) return doubleChance

  const overUnderIdx = tokens.findIndex((tok) => {
    const low = tok.toLowerCase()
    return low.startsWith('más') || low.startsWith('mas') || low.startsWith('menos') ||
      low.startsWith('over') || low.startsWith('under') || low.startsWith('+') || low.startsWith('-')
  })
  if (overUnderIdx !== -1) {
    const head = tokens[overUnderIdx]!
    if (NUM.test(head)) return head
    const numTok = tokens.slice(overUnderIdx + 1).find((tok) => NUM.test(tok))
    if (numTok) return `${head} ${numTok}`
  }

  // "1"/"X"/"2" (resultado) queda estricto (solo si es el único token
  // restante) para no confundir un dígito suelto de una línea ruidosa con un
  // pick real — a diferencia de sí/no/doble oportunidad, que son palabras
  // completas y no ambiguas aunque estén mezcladas con más texto.
  if (tokens.length === 1 && /^(1|x|2)$/i.test(tokens[0]!)) return tokens[0]!

  return null
}

export function isPickLine(text: string): boolean {
  return extractPickToken(text) !== null
}

/**
 * Extrae la cuota (odds) pegada al final de una línea OCR del pick, si la hay.
 * A diferencia de `extractPickToken` (que la DESCARTA para no confundirla con
 * el threshold de un over/under), esta la DEVUELVE: la cuota es un dato de la
 * línea completa (rediseño de cupones multi-partido — `bet_slip_legs.odds`),
 * necesaria para que el backend calcule `total_odds` como producto. Se captura
 * en `parseBetSlip` desde la línea cruda del pick, antes de tokenizar. Devuelve
 * el decimal (ej. 1.42) o `null` si no hay cuota al final.
 */
export function extractTrailingOdds(text: string): number | null {
  const m = TRAILING_QUOTA.exec(text.trim())
  if (!m) return null
  const cleaned = m[0].trim().replace('$', '').replace(',', '.')
  const v = Number(cleaned)
  return Number.isNaN(v) ? null : v
}

export { extractPickToken }

export function isMarketLine(text: string): boolean {
  return marketKeyword(text) !== null
}

function isOver(pick: string): boolean {
  const low = pick.toLowerCase()
  return low.startsWith('más') || low.startsWith('mas') || low.startsWith('over') || low.startsWith('+')
}

function numberIn(text: string): number | null {
  const m = NUM.exec(text)
  if (!m || m[1] === undefined) return null
  const v = Number(m[1].replace(',', '.'))
  return Number.isNaN(v) ? null : v
}

function trimNum(n: number): string {
  return String(n)
}

function canonicalPick(pick: string, kind: PickKind | null): string {
  if (kind === 'over_under') {
    const n = numberIn(pick)
    const head = isOver(pick) ? 'Más' : 'Menos'
    return n != null ? `${head} ${trimNum(n)}` : pick
  }
  if (kind === 'yes_no') return yesNoSelector(pick) === 'yes' ? 'Sí' : 'No'
  if (kind === 'double_chance' || kind === 'match_result') return pick.toUpperCase()
  return pick
}

function dcSelector(pick: string): string {
  return pick
    .toUpperCase()
    .split('')
    .filter((c) => c === '1' || c === '2' || c === 'X')
    .join('')
}
function mrSelector(pick: string): string {
  return pick.toUpperCase().trim()
}
function yesNoSelector(pick: string): 'yes' | 'no' {
  const low = pick.trim().toLowerCase()
  return low === 'no' || low === 'não' || low === 'nao' ? 'no' : 'yes'
}

/** Clasifica la línea de "mercado". El orden importa: "ambos ... primer tiempo" antes que "ambos" a secas. */
function marketKeyword(text: string): string | null {
  const t = text.toLowerCase()
  if (t.includes('doble oportunidad') || t.includes('double chance')) return 'double_chance'
  const bothTeams = t.includes('ambos') || t.includes('both teams')
  const firstHalf =
    t.includes('primer tiempo') || t.includes('1er tiempo') || t.includes('primera parte') ||
    t.includes('1ª parte') || t.includes('first half') || t.includes('1st half')
  if (bothTeams && firstHalf) return 'btts_fh'
  if (bothTeams) return 'btts'
  if (t.includes('córner') || t.includes('corner')) return 'corners'
  if (t.includes('tarjeta') || t.includes('card')) return 'cards'
  if (t.includes('gol') || t.includes('goal')) return 'goals'
  if (
    t.includes('resultado') || t.includes('1x2') || t.includes('ganador') ||
    t.includes('match result') || t.includes('final result')
  ) {
    return 'match_result'
  }
  return null
}

/**
 * Clasifica el par (pick, market). El over/under se decide por el pick
 * ("Más"/"Menos"), y el tipo base por el mercado ("goles", "córner",
 * "tarjeta"...). Si el mercado no se reconoce -> marketType: 'unknown' (el
 * leg se crea igual y se evalúa siempre como not_monitorable). Idéntico a
 * MarketMapper.map de Kotlin.
 */
export function mapMarket(pickText: string, marketText: string): MarketMapping {
  const pick = pickText.trim()
  const kind = pickKind(pick)
  const over = isOver(pick)
  const threshold = numberIn(pick)
  const base = marketKeyword(marketText)

  switch (base) {
    case 'double_chance':
      return {
        marketType: 'double_chance',
        pick: canonicalPick(pick, kind),
        market: 'Doble oportunidad',
        threshold: null,
        selector: dcSelector(pick),
      }
    case 'match_result':
      return {
        marketType: 'match_result',
        pick: canonicalPick(pick, kind),
        market: 'Resultado',
        threshold: null,
        selector: mrSelector(pick),
      }
    case 'goals':
      return {
        marketType: over ? 'total_goals_over' : 'total_goals_under',
        pick: canonicalPick(pick, kind),
        market: 'Goles totales',
        threshold,
        selector: null,
      }
    case 'corners':
      return {
        marketType: over ? 'corners_over' : 'corners_under',
        pick: canonicalPick(pick, kind),
        market: 'Córners',
        threshold,
        selector: null,
      }
    case 'cards':
      return {
        marketType: over ? 'cards_over' : 'cards_under',
        pick: canonicalPick(pick, kind),
        market: 'Tarjetas',
        threshold,
        selector: null,
      }
    case 'btts_fh':
      return {
        marketType: 'btts_first_half',
        pick: canonicalPick(pick, kind),
        market: 'Ambos equipos anotan en el primer tiempo',
        threshold: null,
        selector: yesNoSelector(pick),
      }
    case 'btts':
      return {
        marketType: 'btts',
        pick: canonicalPick(pick, kind),
        market: 'Ambos equipos anotan',
        threshold: null,
        selector: yesNoSelector(pick),
      }
    default:
      return { marketType: 'unknown', pick, market: marketText.trim(), threshold, selector: null }
  }
}
