// =============================================================================
// flashscoreClient.ts
// -----------------------------------------------------------------------------
// Fetch HTTP hacia los feeds no oficiales de Flashscore (PLAN.md sección 2)
// con soporte de peticiones condicionales (ETag / If-None-Match, PLAN.md
// sección 6.3: el feed está detrás de una caché Varnish de ~8-15s, pedir
// más rápido devuelve la misma copia). El token x-fsign se pasa por
// parámetro — quien llama lo lee del secret FLASHSCORE_FSIGN, nunca
// hardcodeado acá.
// =============================================================================

const FEED_BASE = 'https://2.flashscore.ninja/2/x/feed'
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'

export interface FeedFetchResult {
  body: string
  etag: string | null
  notModified: boolean
}

function feedHeaders(fsign: string, ifNoneMatch?: string | null): HeadersInit {
  const h: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Referer: 'https://www.flashscore.es/',
    'x-fsign': fsign,
  }
  if (ifNoneMatch) h['If-None-Match'] = ifNoneMatch
  return h
}

export type FeedPrefix = 'dc' | 'df_st' | 'df_su'

/** GET a un feed de Flashscore para un match_id, con ETag condicional opcional. */
export async function fetchFeed(
  matchId: string,
  prefix: FeedPrefix,
  fsign: string,
  etag?: string | null,
): Promise<FeedFetchResult> {
  const url = `${FEED_BASE}/${prefix}_1_${matchId}`
  const res = await fetch(url, { headers: feedHeaders(fsign, etag) })

  if (res.status === 304) {
    return { body: '', etag: etag ?? null, notModified: true }
  }
  if (!res.ok) {
    throw new Error(`Flashscore feed ${prefix} respondió ${res.status} para mid=${matchId}`)
  }
  const body = await res.text()
  return { body, etag: res.headers.get('etag'), notModified: false }
}

/** Extrae el mid (?mid=...) de una URL de partido de Flashscore. */
export function extractMatchId(url: string): string {
  try {
    const u = new URL(url)
    const mid = u.searchParams.get('mid')
    if (mid) return mid
  } catch {
    // URL inválida para el parser nativo: cae al regex de abajo como red de seguridad.
  }
  const m = /[?&#]mid=([A-Za-z0-9]+)/.exec(url)
  if (m) return m[1]
  throw new Error('No se encontró el "mid" (match ID) en la URL de Flashscore (tiene que incluir "?mid=").')
}

export interface MatchMeta {
  homeTeam: string | null
  awayTeam: string | null
  competition: string | null
}

/**
 * Nombres de equipos y competición desde la meta de la página (og:title/
 * og:description) — se pide UNA sola vez al agregar el partido, nunca en
 * cada poll (PLAN.md sección 6.3: "Meta se descarga una sola vez").
 */
export async function fetchMeta(url: string): Promise<MatchMeta> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return { homeTeam: null, awayTeam: null, competition: null }
    const html = await res.text()
    const ogTitle = /og:title"\s+content="([^"]+)"/.exec(html)?.[1]?.trim() ?? null
    const ogDesc = /og:description"\s+content="([^"]+)"/.exec(html)?.[1]?.trim() ?? null
    let homeTeam: string | null = null
    let awayTeam: string | null = null
    if (ogTitle && ogTitle.includes(' - ')) {
      const [h, a] = ogTitle.split(' - ')
      homeTeam = h.trim()
      awayTeam = a.trim()
    }
    return { homeTeam, awayTeam, competition: ogDesc }
  } catch {
    return { homeTeam: null, awayTeam: null, competition: null }
  }
}
