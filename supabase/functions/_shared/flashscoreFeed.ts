// =============================================================================
// flashscoreFeed.ts
// -----------------------------------------------------------------------------
// Puerto 1:1 a TypeScript del parseo del feed de texto plano de Flashscore
// ya validado empíricamente contra partidos reales por el proyecto original
// FottStat: /home/lulo/Proyectos/Propios/FottStat/fottstat.py (parse_records/
// parse_stats/parse_detail/parse_incidents) + el algoritmo de minuto real y
// marcador por parte confirmados en PLAN.md secciones 2 y 5 (NO se usa el
// algoritmo viejo de fottstat.py::parse_detail, que trataba DB como minuto —
// desactualizado, ver PLAN.md).
//
// Este módulo NO reinventa el parseo, lo traduce literal. No hace ningún
// fetch de red (eso vive en flashscoreClient.ts) — solo recibe el texto
// crudo de cada feed y devuelve estructuras tipadas.
// =============================================================================

const REC_SEP = '~'
const FLD_SEP = '¬'
const KV_SEP = '÷'

export type FeedRecord = Record<string, string>

/** Un registro por '~', separado en pares clave/valor por '¬'/'÷'. Idéntico a parse_records de fottstat.py. */
export function parseRecords(text: string): FeedRecord[] {
  const out: FeedRecord[] = []
  for (const rawRecord of text.split(REC_SEP)) {
    const record = rawRecord.trim()
    if (!record) continue
    const fields: FeedRecord = {}
    for (const chunk of record.split(FLD_SEP)) {
      const idx = chunk.indexOf(KV_SEP)
      if (idx === -1) continue
      const k = chunk.slice(0, idx)
      const v = chunk.slice(idx + KV_SEP.length)
      fields[k] = v
    }
    if (Object.keys(fields).length > 0) out.push(fields)
  }
  return out
}

/** '4' -> 4, '56%' -> 56, '94% (49/52)' -> 94, '0.00' -> 0. null si no aplica. Idéntico a num() de fottstat.py. */
export function num(raw: string | undefined | null): number | null {
  if (raw == null) return null
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(raw)
  if (!m) return null
  return Number(m[1])
}

const STAT_ID_CORNERS = '16'
const STAT_ID_SHOTS_ON_TARGET = '13'
const STAT_ID_CLEAR_CHANCES = '459'

export interface ParsedStats {
  cornersHome: number | null
  cornersAway: number | null
  shotsOnTargetHome: number | null
  shotsOnTargetAway: number | null
  clearChancesHome: number | null
  clearChancesAway: number | null
}

/**
 * Del feed df_st, SOLO periodo "Match" (acumulado del partido, no por
 * tiempo). Idéntico a parse_stats de fottstat.py, acotado a las 3 stats de
 * interés del encargo (córners id 16, remates a puerta id 13, ocasiones
 * claras id 459 — ids estables e independientes del idioma, confirmados en
 * PLAN.md sección 2).
 */
export function parseStats(text: string): ParsedStats {
  const byId: Record<string, { home?: string; away?: string }> = {}
  let period: string | null = null
  for (const f of parseRecords(text)) {
    if ('SE' in f) period = f['SE']
    if (period !== 'Match') continue
    if ('SD' in f) byId[f['SD']] = { home: f['SH'], away: f['SI'] }
  }
  const get = (id: string) => byId[id] ?? {}
  return {
    cornersHome: num(get(STAT_ID_CORNERS).home),
    cornersAway: num(get(STAT_ID_CORNERS).away),
    shotsOnTargetHome: num(get(STAT_ID_SHOTS_ON_TARGET).home),
    shotsOnTargetAway: num(get(STAT_ID_SHOTS_ON_TARGET).away),
    clearChancesHome: num(get(STAT_ID_CLEAR_CHANCES).home),
    clearChancesAway: num(get(STAT_ID_CLEAR_CHANCES).away),
  }
}

export interface ParsedDetail {
  statusId: string | null // DA: 1=no empezado, 2=en juego, 3=finalizado (NO distingue descanso)
  stageCode: number | null // DB: 1/12/38/13/3 — el que SÍ distingue descanso, ver PLAN.md sección 5
  stageAnchorEpoch: number | null // DD: ancla epoch del cronómetro de la parte ACTUAL
  scheduledKickoffEpoch: number | null // DC: hora programada de inicio (NO usar para el minuto, se desvía)
  scoreHome: number | null // DE
  scoreAway: number | null // DF
}

/**
 * Del feed dc: estado/etapa/reloj/marcador. A diferencia del
 * fottstat.py::parse_detail original (que usaba DB como "minute",
 * desactualizado según PLAN.md sección 5), acá se exponen los 3 campos
 * crudos del reloj tal cual (stageCode/stageAnchorEpoch/scheduledKickoffEpoch)
 * sin calcular ningún string de minuto ya formateado — ese cálculo vive en
 * el cliente (docs/features/live-matches-ux.md sección 1.4), el backend
 * solo expone el dato crudo.
 */
export function parseDetail(text: string): ParsedDetail {
  const recs = parseRecords(text)
  const f = recs[0] ?? {}
  return {
    statusId: f['DA'] ?? null,
    stageCode: num(f['DB']),
    stageAnchorEpoch: num(f['DD']),
    scheduledKickoffEpoch: num(f['DC']),
    scoreHome: num(f['DE']),
    scoreAway: num(f['DF']),
  }
}

const CARD_YELLOW = new Set(['Yellow Card'])
const CARD_RED = new Set(['Red Card', 'Second Yellow Card'])

const TYPE_MAP: Record<string, string> = {
  Goal: 'goal',
  Penalty: 'penalty',
  'Own goal': 'own_goal',
  'Penalty Awarded': 'penalty_awarded',
  'Penalty missed': 'penalty_missed',
  'Yellow Card': 'yellow_card',
  'Red Card': 'red_card',
  'Second Yellow Card': 'second_yellow_card',
  'Substitution - In': 'substitution_in',
  'Substitution - Out': 'substitution_out',
  Assistance: 'assistance',
  'Not on pitch': 'not_on_pitch',
}

export interface FeedIncident {
  type: string
  rawType: string | null
  team: 'home' | 'away' | null
  minuteLabel: string | null
  player: string | null
  period: string | null
  description: string | null
  score: [number, number] | null
}

export interface ParsedIncidents {
  events: FeedIncident[]
  yellowHome: number
  yellowAway: number
  redHome: number
  redAway: number
  firstHalfHome: number
  firstHalfAway: number
}

/**
 * Del feed df_su: incidencias completas (goles/tarjetas/cambios), agrupadas
 * por periodo con un registro-cabecera propio (AC+IG+IH) al inicio de cada
 * bloque. Puerto 1:1 de parse_incidents de fottstat.py, MÁS la extracción
 * de firstHalfHome/firstHalfAway desde la cabecera "AC÷1st Half" (PLAN.md
 * sección 5 "Marcador POR PARTE") — fuente AUTORITATIVA para el mercado
 * "ambos marcan 1ª parte": absorbe penaltis/goles en propia/descuento, NUNCA
 * se deriva contando registros IK÷Goal a mano (subestima).
 *
 * Gol en propia (Own goal): IA trae el equipo del jugador que se lo mete,
 * pero el gol se acredita al RIVAL — acá `team` del evento ya viene
 * INVERTIDO (el equipo que se benefició), consistente con el copy del
 * frontend ("(en contra)" atribuido al que se benefició, docs/features/
 * live-matches-ux.md sección 4.3). Los conteos de tarjetas NO se ven
 * afectados por esta inversión (solo aplica a goles).
 */
export function parseIncidents(text: string): ParsedIncidents {
  const events: FeedIncident[] = []
  let yellowHome = 0
  let yellowAway = 0
  let redHome = 0
  let redAway = 0
  let firstHalfHome = 0
  let firstHalfAway = 0
  let period: string | null = null

  for (const rawRecord of text.split(REC_SEP)) {
    const record = rawRecord.trim()
    if (!record) continue

    const pairs: [string, string][] = []
    for (const chunk of record.split(FLD_SEP)) {
      const idx = chunk.indexOf(KV_SEP)
      if (idx === -1) continue
      pairs.push([chunk.slice(0, idx), chunk.slice(idx + KV_SEP.length)])
    }
    if (pairs.length === 0) continue

    const last: FeedRecord = {} // último valor gana por clave (mismo criterio que dict(pairs) en Python)
    for (const [k, v] of pairs) last[k] = v

    if ('AC' in last && !('III' in last)) {
      // cabecera de periodo
      period = last['AC']
      if (period === '1st Half') {
        firstHalfHome = num(last['IG']) ?? 0
        firstHalfAway = num(last['IH']) ?? 0
      }
      continue
    }
    if (!('III' in last)) continue // registros de meta/tv, no incidencias

    const first: FeedRecord = {} // primera aparición de cada clave (sub-eventos: Gol+Asistencia, Cambio Sale+Entra)
    for (const [k, v] of pairs) if (!(k in first)) first[k] = v

    const ik = first['IK'] ?? null
    const ia = first['IA'] ?? null
    const side: 'home' | 'away' | null = ia === '1' ? 'home' : ia === '2' ? 'away' : null

    const isOwnGoal = ik === 'Own goal'
    const attributedSide: 'home' | 'away' | null = isOwnGoal
      ? side === 'home'
        ? 'away'
        : side === 'away'
          ? 'home'
          : null
      : side

    let score: [number, number] | null = null
    if ('INX' in last && 'IOX' in last) {
      const h = num(last['INX'])
      const a = num(last['IOX'])
      if (h != null && a != null) score = [h, a]
    }

    events.push({
      type: (ik && TYPE_MAP[ik]) ?? 'other',
      rawType: ik,
      team: attributedSide,
      minuteLabel: first['IB'] ?? null,
      player: first['IF'] ?? null,
      period,
      description: first['ICT'] || null,
      score,
    })

    if (!side) continue
    if (ik && CARD_YELLOW.has(ik)) {
      if (side === 'home') yellowHome++
      else yellowAway++
    } else if (ik && CARD_RED.has(ik)) {
      if (side === 'home') redHome++
      else redAway++
    }
  }

  return { events, yellowHome, yellowAway, redHome, redAway, firstHalfHome, firstHalfAway }
}

export function epochToIso(epoch: number | null): string | null {
  if (epoch == null) return null
  return new Date(epoch * 1000).toISOString()
}
