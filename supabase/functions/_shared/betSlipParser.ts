// =============================================================================
// betSlipParser.ts
// -----------------------------------------------------------------------------
// Puerto 1:1 a TypeScript de BetSlipParser.kt
// (/home/lulo/Proyectos/Propios/FottStat/android/app/src/main/java/com/fottstat/domain/BetSlipParser.kt,
// domain PURO y testeado en el proyecto original, verificado con OCR real
// de un cupón Betano: 5/5 legs correctos, ver PLAN.md sección 5). Recibe la
// lista NEUTRA de OcrLine (texto + bounding box) que produce el motor OCR
// (ver ocr-betslip/index.ts) y la reconstruye en un BetSlip: equipos,
// marcador, minuto, cuota y las selecciones — emparejando cada línea "pick"
// con la línea "mercado" inmediatamente debajo, usando posición espacial
// (columna izquierda/derecha por X, orden por Y), agnóstico de la fuente
// exacta de OCR usada.
// =============================================================================

import { isMarketLine, isPickLine, mapMarket, type MarketType } from './marketMapper.ts'

export interface OcrLine {
  text: string
  left: number
  right: number
  top: number
  bottom: number
}

export interface ParsedLeg {
  pick: string
  market: string
  marketType: MarketType
  value: number | null
  threshold: number | null
  raw: string
}

export interface BetSlip {
  teams: [string, string] | null
  scoreHome: number | null
  scoreAway: number | null
  minute: number | null
  totalOdds: number | null
  legs: ParsedLeg[]
}

// Palabras de cabecera/pie que NO son equipos ni legs (branding, totales, impuestos...).
const NOISE = [
  'betano', 'bet builder', 'simple', 'cash out', 'pronóstico', 'pronostico',
  'impuesto', 'sri', 'ganancias', 'potenciales', 'combinada', 'múltiple', 'multiple',
]

const DECIMAL = /^\$?\s*\d+[.,]\d+$/ // cuota "2.30", "$1,06"
const INTEGER = /^\d{1,3}$/ // marcador / valor de córner
const MINUTE = /^(\d{1,3})\s*[’'`]$/ // "86'"
// Un ícono suelto que el OCR mete como token de 1 carácter al inicio de la
// línea (viñeta/escudo/bandera). Se quita SOLO si el primer token es un
// único carácter (los nombres reales tienen >1).
const LEADING_GLYPH = /^(\S)\s+(.+)$/
const LEG_BAND = 40 // tolerancia vertical para asociar el valor de contexto al pick

/** Quita el glifo-icono inicial que el OCR añade delante de picks/equipos/minuto. */
export function stripLeadingGlyph(text: string): string {
  const t = text.trim()
  const m = LEADING_GLYPH.exec(t)
  if (!m) return t
  return m[1].length === 1 ? m[2].trim() : t
}

function numberOf(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(text)
  if (!m) return null
  const v = Number(m[1].replace(',', '.'))
  return Number.isNaN(v) ? null : v
}

function isNumericLike(text: string): boolean {
  const t = text.trim()
  return DECIMAL.test(t) || INTEGER.test(t) || MINUTE.test(t)
}

/** Quita íconos/escudos sueltos y espacios sobrantes de un nombre de equipo. */
function cleanTeam(text: string): string {
  return text.trim().replace(/^[·•\-\s]+|[·•\-\s]+$/g, '')
}

interface Line extends OcrLine {
  centerX: number
  centerY: number
}

/**
 * Estrategia robusta y agnóstica de fuente: se ordena TODO por Y (orden
 * vertical real) y se usa la coordenada X para separar la columna izquierda
 * (equipos/picks/mercados) de la derecha (cuota/minuto/marcador/valores). El
 * emparejamiento pick<->mercado es "el siguiente mercado por debajo de este
 * pick y por encima del siguiente pick".
 */
export function parseBetSlip(raw: OcrLine[]): BetSlip {
  const stripped = raw.map((l) => ({ ...l, text: stripLeadingGlyph(l.text) }))
  const lines: Line[] = stripped.map((l) => ({
    ...l,
    centerX: (l.left + l.right) / 2,
    centerY: (l.top + l.bottom) / 2,
  }))
  const clean = lines.filter((l) => l.text.trim().length > 0).sort((a, b) => a.centerY - b.centerY)
  if (clean.length === 0) {
    return { teams: null, scoreHome: null, scoreAway: null, minute: null, totalOdds: null, legs: [] }
  }

  const minLeft = Math.min(...clean.map((l) => l.left))
  const maxRight = Math.max(...clean.map((l) => l.right))
  const rightThreshold = minLeft + (maxRight - minLeft) * 0.55
  const isRight = (l: Line) => l.centerX > rightThreshold
  const isNoise = (l: Line) => NOISE.some((n) => l.text.toLowerCase().includes(n))

  // 1) Cuota total: primer decimal de la COLUMNA DERECHA.
  const totalOddsLine = clean.find((l) => isRight(l) && DECIMAL.test(l.text.trim()))
  const totalOdds = totalOddsLine ? numberOf(totalOddsLine.text) : null

  // 2) Minuto: línea "NN'".
  let minute: number | null = null
  for (const l of clean) {
    const m = MINUTE.exec(l.text.trim())
    if (m) {
      minute = Number(m[1])
      break
    }
  }

  // 3) Picks/mercados en la COLUMNA IZQUIERDA (para no confundir un dígito
  //    del marcador "1" con el pick de resultado "1").
  const pickLines = clean.filter((l) => !isRight(l) && !isNoise(l) && isPickLine(l.text)).sort((a, b) => a.centerY - b.centerY)
  const marketLines = clean.filter((l) => !isRight(l) && !isNoise(l) && isMarketLine(l.text)).sort((a, b) => a.centerY - b.centerY)

  const firstPickY = pickLines[0]?.centerY ?? Number.MAX_SAFE_INTEGER

  // 4) Equipos: líneas "con nombre" por encima del primer pick. Tomamos las
  //    DOS más cercanas al primer pick (justo encima).
  const nameCandidates = clean
    .filter(
      (l) =>
        l.centerY < firstPickY && !isRight(l) && !isNoise(l) &&
        !isNumericLike(l.text) && !isPickLine(l.text) && !isMarketLine(l.text) &&
        /[a-zA-Z]/.test(l.text),
    )
    .sort((a, b) => a.centerY - b.centerY)
  const teams: [string, string] | null =
    nameCandidates.length >= 2
      ? (() => {
          const two = nameCandidates.slice(-2)
          return [cleanTeam(two[0].text), cleanTeam(two[1].text)] as [string, string]
        })()
      : null

  // 5) Marcador: dígitos enteros en la COLUMNA DERECHA por encima del
  //    primer pick (excluye la cuota decimal y el minuto).
  const scoreDigits = clean
    .filter((l) => l.centerY < firstPickY && isRight(l) && INTEGER.test(l.text.trim()) && !MINUTE.test(l.text))
    .sort((a, b) => a.centerY - b.centerY)
  const scoreHome = scoreDigits[0] ? Number(scoreDigits[0].text.trim()) : null
  const scoreAway = scoreDigits[1] ? Number(scoreDigits[1].text.trim()) : null

  // 6) Legs: por cada pick, su mercado es el primer marketLine por debajo y
  //    por encima del siguiente pick. El valor de contexto (córners "10")
  //    es un entero en la columna derecha dentro de la franja Y del leg.
  const legs: ParsedLeg[] = []
  pickLines.forEach((pick, i) => {
    const nextPickY = pickLines[i + 1]?.centerY ?? Number.MAX_SAFE_INTEGER
    const market = marketLines.find((m) => m.centerY > pick.centerY && m.centerY < nextPickY)
    const marketText = market?.text ?? ''

    const m = mapMarket(pick.text, marketText)

    const contextLine = clean.find(
      (l) => isRight(l) && l.centerY >= pick.centerY - LEG_BAND && l.centerY < nextPickY && INTEGER.test(l.text.trim()),
    )
    const contextValue = contextLine ? Number(contextLine.text.trim()) : null

    legs.push({
      pick: m.pick,
      market: m.market,
      marketType: m.marketType,
      value: contextValue,
      threshold: m.threshold,
      raw: [pick.text.trim(), marketText.trim()].filter((s) => s.length > 0).join(' · '),
    })
  })

  return { teams, scoreHome, scoreAway, minute, totalOdds, legs }
}
