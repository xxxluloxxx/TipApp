// =============================================================================
// search-matches
// -----------------------------------------------------------------------------
// Buscador/listado de partidos en vivo o por jugar para el paso 1 del wizard
// de alta de MatchFormSheet.vue (reemplaza el copiar/pegar manual de una URL
// de Flashscore, docs/features/live-matches-ux.md sección 5). Recibe el JWT
// del usuario YA AUTENTICADO (mismo patrón exacto que add-match: sin
// service_role, la función no toca ninguna tabla propia del usuario más allá
// de validar la sesión).
//
// Pide el feed "hermano" de listado por día (f_1_<dayOffset>_3_en_1, ver
// fetchDayFeed en _shared/flashscoreClient.ts) — mismo host/headers/x-fsign
// que los feeds por-partido ya usados por add-match/poll-matches. Filtra
// SIEMPRE los partidos finalizados (status code '3') y cualquier código de
// estado que no sea explícitamente "no empezó" (1) o "en vivo" (2) — un
// allowlist en vez de un blacklist de solo "≠3", más conservador ante
// códigos de estado no vistos en el feed real (pospuesto/cancelado/etc, que
// tampoco tiene sentido mostrar en un picker de "en vivo o por jugar").
//
// Nunca reenvía el texto crudo del feed al cliente (mismo criterio que
// add-match/poll-matches con los otros feeds).
// =============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'
import { fetchDayFeed } from '../_shared/flashscoreClient.ts'
import { epochToIso, parseRecords } from '../_shared/flashscoreFeed.ts'

const MIN_DAY_OFFSET = 0
const MAX_DAY_OFFSET = 3
const UPSTREAM_TIMEOUT_MS = 8000

interface SearchMatchesBody {
  dayOffset: number
  query?: string
}

export interface SearchedMatch {
  matchId: string
  homeTeam: string
  awayTeam: string
  league: string | null
  kickoffAt: string
  status: 'upcoming' | 'live'
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'missing_authorization' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'invalid_session' }, 401)
  }

  let body: SearchMatchesBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const dayOffset = body?.dayOffset
  if (typeof dayOffset !== 'number' || !Number.isInteger(dayOffset) || dayOffset < MIN_DAY_OFFSET || dayOffset > MAX_DAY_OFFSET) {
    return json({ error: 'invalid_day_offset' }, 400)
  }

  const queryTrimmed = typeof body?.query === 'string' ? body.query.trim() : ''
  const normalizedQuery = queryTrimmed.length >= 2 ? normalize(queryTrimmed) : null

  const fsign = Deno.env.get('FLASHSCORE_FSIGN') ?? 'SW9D1eZo'

  let feedText: string
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      feedText = await fetchDayFeed(dayOffset, fsign, controller.signal)
    } finally {
      clearTimeout(timeout)
    }
  } catch (e) {
    console.error('search-matches: el feed de listado por día falló/timeout', e)
    return json({ error: 'upstream_unavailable' }, 502)
  }

  const matches: SearchedMatch[] = []
  let currentLeague: string | null = null

  for (const record of parseRecords(feedText)) {
    if ('ZA' in record) {
      currentLeague = record['ZA'] || null
      continue
    }
    if (!('AA' in record)) continue // registro de cabecera/meta que no es liga ni partido

    const statusCode = record['AB'] ?? record['CR'] ?? null
    const status: 'upcoming' | 'live' | null = statusCode === '1' ? 'upcoming' : statusCode === '2' ? 'live' : null
    if (!status) continue // filtra finalizados (3) y cualquier código no reconocido

    const matchId = record['AA']
    const homeTeam = record['CX']
    const awayTeam = record['AF']
    const kickoffAt = epochToIso(numOrNull(record['AD']))
    if (!matchId || !homeTeam || !awayTeam || !kickoffAt) continue // registro incompleto, se omite en vez de romper el listado

    if (normalizedQuery) {
      const haystack = normalize(`${homeTeam} ${awayTeam}`)
      if (!haystack.includes(normalizedQuery)) continue
    }

    matches.push({ matchId, homeTeam, awayTeam, league: currentLeague, kickoffAt, status })
  }

  return json({ matches }, 200)
})

function numOrNull(raw: string | undefined): number | null {
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
