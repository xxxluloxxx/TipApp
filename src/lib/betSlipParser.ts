// =============================================================================
// betSlipParser.ts (copia client-side)
// -----------------------------------------------------------------------------
// TypeScript PURO (sin dependencias de Deno ni de red): copia de
// `supabase/functions/_shared/betSlipParser.ts` para consumir el OCR del
// cupón directamente en el navegador (Tesseract.js corre client-side, ver
// `src/lib/betSlipOcr.ts` y `MatchFormSheet.vue`). Si se toca la lógica de
// parseo, mantener ambas copias en sync (o unificar a futuro).
//
// Puerto 1:1 a TypeScript de BetSlipParser.kt
// (/home/lulo/Proyectos/Propios/FottStat/android/app/src/main/java/com/fottstat/domain/BetSlipParser.kt,
// domain PURO y testeado en el proyecto original, verificado con OCR real
// de un cupón Betano: 5/5 legs correctos, ver PLAN.md sección 5). Recibe la
// lista NEUTRA de OcrLine (texto + bounding box) que produce el motor OCR
// (ver src/lib/betSlipOcr.ts) y la reconstruye en un BetSlip: equipos,
// marcador, minuto, cuota y las selecciones — emparejando cada línea "pick"
// con la línea "mercado" inmediatamente debajo, usando posición espacial
// (columna izquierda/derecha por X, orden por Y), agnóstico de la fuente
// exacta de OCR usada.
// =============================================================================

import { extractPickToken, extractTrailingOdds, isMarketLine, isPickLine, mapMarket, type MarketType } from './marketMapper'

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
  /** Cuota individual de la predicción (rediseño cupones multi-partido). El
   * backend la usa para calcular `total_odds` como producto. `null` si el OCR
   * no la leyó. */
  odds: number | null
  raw: string
}

/** Un partido detectado en el cupón: el par de equipos (o `null` si no se
 * pudieron aislar 2 nombres) más sus predicciones. Un cupón es una lista de
 * estos grupos (antes el parser asumía UN solo partido por imagen). */
export interface BetSlipGroup {
  teams: [string, string] | null
  legs: ParsedLeg[]
}

export interface BetSlip {
  groups: BetSlipGroup[]
  /** Número/identificador del cupón leído del OCR (best-effort, p. ej.
   * "Cupón #25481"); `null` si no hay señal confiable. */
  reference: string | null
  /** Monto apostado total leído del OCR (best-effort); `null` si no se detectó
   * — el usuario lo tipea en el review. */
  stakeAmount: number | null
}

// Palabras de cabecera/pie que NO son equipos ni legs (branding, totales, impuestos...).
const NOISE = [
  'betano', 'bet builder', 'simple', 'cash out', 'pronóstico', 'pronostico',
  'impuesto', 'sri', 'ganancias', 'potenciales', 'combinada', 'múltiple', 'multiple',
  'free bet',
]
// La cabecera del tipo de apuesta + monto + cuota total ("Doble $3,00 4.40",
// "Doble $20,00 2.55"...) — a diferencia de las palabras sueltas de arriba,
// "doble"/"triple" NO se pueden meter en `NOISE` a secas: colisionarían con
// el mercado real "Doble oportunidad" (`marketKeyword`) y lo excluirían por
// error. Se detecta por ESTRUCTURA (palabra de tipo de apuesta seguida
// directo de un monto en $) en vez de por substring — un caso real de esta
// sesión donde esta línea, sin excluir, se colaba como si fuera un nombre de
// equipo y arruinaba el par real (Francia quedaba emparejado con la cabecera
// en vez de con Inglaterra).
const BET_TYPE_HEADER = /^(simple|doble|triple|combinada|m[uú]ltiple)\s*\$/i

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
  if (!m || m[1] === undefined || m[2] === undefined) return t
  return m[1].length === 1 ? m[2].trim() : t
}

function isNumericLike(text: string): boolean {
  const t = text.trim()
  return DECIMAL.test(t) || INTEGER.test(t) || MINUTE.test(t)
}

/** Quita íconos/escudos sueltos y espacios sobrantes de un nombre de equipo. */
/**
 * Limpia basura de OCR de un nombre de equipo/selección — verificado contra
 * una foto real donde una línea de nombre real venía "48 Inglaterra \"e '"
 * (ícono de bandera mal leído como "48" + artefactos de comillas sueltas al
 * final) y otra traía la fecha del recuadro de al lado pegada
 * ("—- Argentine 19/07/2026, 14:00", layout real de Betano). Sin esta
 * limpieza, `autoResolveGroup` manda ese texto crudo como query de búsqueda
 * y nunca matchea contra el nombre real del equipo en el feed.
 */
function cleanTeam(text: string): string {
  let t = text.trim().replace(/^[·•\-\s]+|[·•\-\s]+$/g, '')
  // 1) Corta todo lo que venga después de una fecha ("dd/mm[/aaaa]") u hora
  //    ("hh:mm") pegada al nombre — no es parte del nombre.
  t = t.replace(/\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?.*$/, '')
  t = t.replace(/\s*\d{1,2}:\d{2}.*$/, '')

  // 2) Quita tokens de basura (íconos mal leídos, comillas sueltas: "48",
  //    "am", "—-", "\"e", "'"...) en los extremos — corto (≤3 chars) o
  //    puramente símbolos/comillas. Nunca deja la lista vacía (si el nombre
  //    real es corto de por sí, ej. "PSG", un único token no se toca).
  const isGarbageToken = (tok: string) => tok.length <= 3 || /^["'”“`´¡!¿?.,:;·•\-]+$/.test(tok)
  let tokens = t.split(/\s+/).filter(Boolean)
  while (tokens.length > 1 && isGarbageToken(tokens[0]!)) tokens = tokens.slice(1)
  while (tokens.length > 1 && isGarbageToken(tokens[tokens.length - 1]!)) tokens = tokens.slice(0, -1)

  return tokens.join(' ').trim()
}

interface Line extends OcrLine {
  centerX: number
  centerY: number
}

// Patrones best-effort para el número de cupón y el monto apostado a nivel
// top (rediseño multi-partido). No bloqueantes: si no matchean, quedan `null`
// y el usuario los completa en el review.
const REFERENCE_LINE = /(cup[oó]n|boleto|ticket|c[oó]digo|apuesta)\s*[#nº°:]*\s*([a-z]?\d{4,})/i
const STAKE_LINE = /(apuesta|importe|apostado|stake|monto)\D{0,12}(\$?\s*\d+(?:[.,]\d+)?)/i

/** Busca best-effort el identificador del cupón ("Cupón #25481", "N° 12345").
 * Devuelve un string normalizado "Cupón #<id>" o `null`. */
function extractReference(clean: Line[]): string | null {
  for (const l of clean) {
    const m = REFERENCE_LINE.exec(l.text.trim())
    if (m && m[2]) return `Cupón #${m[2].toUpperCase()}`
  }
  return null
}

/** Busca best-effort el monto apostado total del cupón. Devuelve el número o
 * `null` — el review permite tipearlo/editarlo igual. */
function extractStakeAmount(clean: Line[]): number | null {
  for (const l of clean) {
    const m = STAKE_LINE.exec(l.text.trim())
    if (m && m[2]) {
      const v = Number(m[2].replace('$', '').replace(/\s/g, '').replace(',', '.'))
      if (!Number.isNaN(v) && v > 0) return v
    }
  }
  return null
}

/**
 * Agrupa los nombres de equipo en "pares" (un partido). En un cupón la
 * estructura por partido es [EquipoA, EquipoB, pick, mercado, pick, ...], luego
 * el siguiente partido. Los nombres vienen en corridas de 2 líneas consecutivas
 * SIN ningún pick entre ellas; la aparición de un pick cierra el par y abre el
 * bloque de predicciones. Cada corrida es un ancla de grupo con su `startY` (el
 * Y de la línea más alta del par) — los picks debajo de ese `startY` y por
 * encima del `startY` del siguiente par pertenecen a este partido.
 */
function clusterTeamPairs(
  names: Line[],
  pickYs: number[],
): { teams: [string, string] | null; startY: number }[] {
  const clusters: Line[][] = []
  let current: Line[] = []
  let lastY = Number.NEGATIVE_INFINITY
  for (const name of names) {
    const hasPickBetween = pickYs.some((y) => y > lastY && y < name.centerY)
    if (current.length > 0 && hasPickBetween) {
      clusters.push(current)
      current = []
    }
    current.push(name)
    lastY = name.centerY
  }
  if (current.length > 0) clusters.push(current)

  return clusters.map((members) => {
    // Las DOS más cercanas al bloque de picks de abajo (mismo criterio que la
    // heurística original de tomar las 2 últimas por encima del primer pick).
    const pair = members.slice(-2)
    const teams: [string, string] | null =
      pair.length >= 2 ? [cleanTeam(pair[0]!.text), cleanTeam(pair[1]!.text)] : null
    const startY = Math.min(...members.map((m) => m.centerY))
    return { teams, startY }
  })
}

/**
 * Estrategia robusta y agnóstica de fuente: se ordena TODO por Y (orden
 * vertical real) y se usa la coordenada X para separar la columna izquierda
 * (equipos/picks/mercados) de la derecha (cuota/minuto/marcador/valores). El
 * emparejamiento pick<->mercado es "el siguiente mercado por debajo de este
 * pick y por encima del siguiente pick".
 *
 * Rediseño multi-partido: detecta N pares de equipos a lo largo de la imagen
 * (no 1) y asocia cada leg al par más cercano POR ENCIMA de él, devolviendo una
 * lista de grupos (partidos) en vez de una lista plana de legs. Además captura
 * la cuota individual de cada leg y, best-effort, `reference`/`stakeAmount` del
 * cupón.
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
    return { groups: [], reference: null, stakeAmount: null }
  }

  const minLeft = Math.min(...clean.map((l) => l.left))
  const maxRight = Math.max(...clean.map((l) => l.right))
  const rightThreshold = minLeft + (maxRight - minLeft) * 0.55
  const isRight = (l: Line) => l.centerX > rightThreshold
  // Para nombres de equipo específicamente: el BORDE IZQUIERDO, no el centro.
  // Un nombre de visitante puede venir con la fecha/hora del partido pegada
  // en la MISMA línea/bounding box (ej. "Inglaterra 18/07/2026, 16:00", caso
  // real de un Bet Builder de esta sesión) — eso estira la línea hacia la
  // derecha y corre su centro más allá del umbral de columna, aunque el
  // nombre en sí arranque bien a la izquierda igual que picks/mercados. Con
  // el centro, esas líneas quedaban excluidas de `nameCandidates` por error
  // (se perdían Inglaterra/Argentina enteras). `cleanTeam` ya se encarga de
  // cortar la fecha pegada después.
  const startsLeft = (l: Line) => l.left <= rightThreshold
  const isNoise = (l: Line) => NOISE.some((n) => l.text.toLowerCase().includes(n)) || BET_TYPE_HEADER.test(l.text.trim())

  // 1) Picks/mercados en la COLUMNA IZQUIERDA (para no confundir un dígito
  //    del marcador "1" con el pick de resultado "1"). `pickToken` es el pick
  //    ya limpio (ver `extractPickToken`): en fotos reales la línea puede
  //    traer basura pegada (ícono mal leído + cuota, ej. "ES Sí 1.42"), así
  //    que se usa el token extraído (no `l.text`) para clasificar el mercado
  //    más abajo — `l.text` se conserva sin tocar para el campo `raw`.
  const pickLines = clean
    .filter((l) => !isRight(l) && !isNoise(l))
    .map((l) => ({ line: l, pickToken: extractPickToken(l.text) }))
    .filter((x): x is { line: Line; pickToken: string } => x.pickToken !== null)
    .sort((a, b) => a.line.centerY - b.line.centerY)
  const marketLines = clean.filter((l) => !isRight(l) && !isNoise(l) && isMarketLine(l.text)).sort((a, b) => a.centerY - b.centerY)

  // 2) Equipos: TODAS las líneas "con nombre" (no solo por encima del primer
  //    pick — el rediseño detecta varios partidos), agrupadas en pares.
  const nameCandidates = clean
    .filter(
      (l) =>
        startsLeft(l) && !isNoise(l) &&
        !isNumericLike(l.text) && !isPickLine(l.text) && !isMarketLine(l.text) &&
        /[a-zA-Z]/.test(l.text),
    )
    .sort((a, b) => a.centerY - b.centerY)
  const pickYs = pickLines.map((p) => p.line.centerY)
  const clusters = clusterTeamPairs(nameCandidates, pickYs).sort((a, b) => a.startY - b.startY)

  /**
   * Dos layouts reales confirmados con fotos reales de Betano, y NO se pueden
   * mezclar pick a pick (probado: intentarlo así rompía el otro layout) —
   * se detecta UNA vez para todo el cupón, mirando dónde cae el PRIMER
   * cluster respecto del PRIMER pick:
   *
   *   - "header": el (los) equipo(s) aparecen ANTES de sus N predicciones
   *     ("Bet Builder" — team1, team2, pick1, mercado1, pick2, mercado2...).
   *     El primer cluster está por encima del primer pick. Cada cluster
   *     "sigue vigente" para todos los picks siguientes hasta el próximo
   *     cluster — criterio ATRÁS puro (el cluster más cercano por encima,
   *     sin acotar por ningún pick intermedio).
   *   - "footer": el par de equipos aparece DESPUÉS de su propio pick
   *     ("Doble" simple — pick1, mercado1, team1, team2, pick2, mercado2,
   *     team1, team2...). El primer cluster está por debajo del primer pick
   *     (o no hay ningún cluster antes). Acá ATRÁS falla para el primer pick
   *     de cada partido (todavía no vio sus equipos) — criterio ADELANTE
   *     (el cluster entre este pick y el siguiente), con ATRÁS como resguardo
   *     final si ni así aparece nada.
   *
   * Ir "adelante" incondicionalmente (probar siempre esa dirección primero)
   * rompe el layout "header" en cupones de 2+ predicciones por partido: la
   * ÚLTIMA predicción de un partido queda más cerca en Y del PRÓXIMO
   * encabezado que del propio (caso real: la 3ª predicción de "Francia-
   * Inglaterra", a la altura de "Kylian Mbappe Tiros al Arco", terminaba
   * adelante robada por el cluster de "España-Argentina"). Por eso la
   * dirección se fija una sola vez para todo el cupón, no por pick.
   */
  const isHeaderLayout = clusters.length > 0 && pickLines.length > 0 && clusters[0]!.startY < pickLines[0]!.line.centerY

  function clusterIndexForPick(pickY: number, nextPickY: number): number {
    const backward = (): number => {
      let idx = -1
      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i]!.startY < pickY) idx = i
        else break
      }
      return idx
    }
    const forward = (): number => {
      for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i]!
        if (c.startY > pickY && c.startY < nextPickY) return i
      }
      return -1
    }

    if (isHeaderLayout) {
      const idx = backward()
      return idx !== -1 ? idx : forward()
    }
    const idx = forward()
    return idx !== -1 ? idx : backward()
  }

  // 3) Legs: por cada pick, su mercado es el primer marketLine por debajo y
  //    por encima del siguiente pick. El valor de contexto (córners "10")
  //    es un entero en la columna derecha dentro de la franja Y del leg. La
  //    cuota se captura de la línea cruda del pick.
  const legsByCluster = new Map<number, ParsedLeg[]>()
  pickLines.forEach((pick, i) => {
    const pickY = pick.line.centerY
    const nextPickY = pickLines[i + 1]?.line.centerY ?? Number.MAX_SAFE_INTEGER
    const market = marketLines.find((m) => m.centerY > pickY && m.centerY < nextPickY)
    const marketText = market?.text ?? ''

    const m = mapMarket(pick.pickToken, marketText)

    const contextLine = clean.find(
      (l) => isRight(l) && l.centerY >= pickY - LEG_BAND && l.centerY < nextPickY && INTEGER.test(l.text.trim()),
    )
    const contextValue = contextLine ? Number(contextLine.text.trim()) : null

    const leg: ParsedLeg = {
      pick: m.pick,
      market: m.market,
      marketType: m.marketType,
      value: contextValue,
      threshold: m.threshold,
      odds: extractTrailingOdds(pick.line.text, pick.pickToken),
      raw: [pick.line.text.trim(), marketText.trim()].filter((s) => s.length > 0).join(' · '),
    }

    const ci = clusterIndexForPick(pickY, nextPickY)
    const arr = legsByCluster.get(ci) ?? []
    arr.push(leg)
    legsByCluster.set(ci, arr)
  })

  // 4) Ensamblado de grupos en orden de lectura: primero los picks huérfanos
  //    (si los hay), luego cada par de equipos con sus legs. Grupos sin legs se
  //    descartan (par de equipos falso, sin predicciones).
  const groups: BetSlipGroup[] = []
  const orphanLegs = legsByCluster.get(-1)
  if (orphanLegs && orphanLegs.length > 0) groups.push({ teams: null, legs: orphanLegs })
  clusters.forEach((cluster, i) => {
    const legs = legsByCluster.get(i)
    if (legs && legs.length > 0) groups.push({ teams: cluster.teams, legs })
  })

  return {
    groups,
    reference: extractReference(clean),
    stakeAmount: extractStakeAmount(clean),
  }
}
