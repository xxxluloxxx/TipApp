// =============================================================================
// countryNames.ts
// -----------------------------------------------------------------------------
// El feed de listado de partidos de Flashscore (`_shared/flashscoreClient.ts`,
// `fetchDayFeed`) siempre devuelve nombres de selecciones/países en inglés
// ("England", "Germany", "Brazil"...) — se probó pasando distintos valores de
// idioma en la URL (`en`/`es`/`es-ar`/`pt`/`ar`) contra el feed real y ninguno
// cambia el idioma de los nombres, así que no es un parámetro de idioma
// real/funcional, no tiene sentido intentar "pedir el feed en español".
//
// El OCR client-side de un cupón (`betSlipOcr.ts`) corre con el modelo `spa`
// (Tesseract) sobre fotos de apps de apuestas en español, así que un partido
// de selecciones extrae nombres en español ("Inglaterra", "Alemania"...) que
// nunca van a matchear contra el feed en inglés. Este diccionario traduce los
// nombres de país más comunes en fútbol (selecciones que suelen aparecer en
// cupones reales) para reintentar la búsqueda si falla el nombre tal cual lo
// leyó el OCR — ver `autoResolveGroup` en `MatchFormSheet.vue`.
//
// No es exhaustivo de todos los países del mundo a propósito: cubre las
// selecciones más habituales en cupones de apuestas (Sudamérica, Europa,
// algunas de Norteamérica/África/Asia con presencia mundialista recurrente).
// Nombres de clubes (Real Madrid, Boca Juniors, etc.) NUNCA se traducen — no
// están en este diccionario, así que `translateCountryEsToEn` los devuelve
// intactos.
// =============================================================================

const ES_TO_EN: Record<string, string> = {
  'alemania': 'Germany',
  'inglaterra': 'England',
  'espana': 'Spain',
  'francia': 'France',
  'italia': 'Italy',
  'portugal': 'Portugal',
  'brasil': 'Brazil',
  'paises bajos': 'Netherlands',
  'holanda': 'Netherlands',
  'belgica': 'Belgium',
  'croacia': 'Croatia',
  'marruecos': 'Morocco',
  'japon': 'Japan',
  'corea del sur': 'South Korea',
  'estados unidos': 'USA',
  'gales': 'Wales',
  'escocia': 'Scotland',
  'irlanda': 'Ireland',
  'irlanda del norte': 'Northern Ireland',
  'suiza': 'Switzerland',
  'polonia': 'Poland',
  'republica checa': 'Czech Republic',
  'dinamarca': 'Denmark',
  'suecia': 'Sweden',
  'noruega': 'Norway',
  'finlandia': 'Finland',
  'rusia': 'Russia',
  'ucrania': 'Ukraine',
  'turquia': 'Turkey',
  'grecia': 'Greece',
  'rumania': 'Romania',
  'hungria': 'Hungary',
  'egipto': 'Egypt',
  'camerun': 'Cameroon',
  'tunez': 'Tunisia',
  'argelia': 'Algeria',
  'arabia saudita': 'Saudi Arabia',
  'catar': 'Qatar',
  'iran': 'Iran',
  'nueva zelanda': 'New Zealand',
  'canada': 'Canada',
  'panama': 'Panama',
  'peru': 'Peru',
}

/** Quita acentos/diacríticos y normaliza a minúsculas para el lookup. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Traduce un nombre de país/selección de español a inglés si está en el
 * diccionario. Devuelve el nombre ORIGINAL sin tocar si no es un país
 * conocido (nombres de club nunca se traducen) — así el resultado siempre es
 * seguro de usar como fallback de búsqueda.
 */
export function translateCountryEsToEn(name: string): string {
  const key = normalize(name)
  return ES_TO_EN[key] ?? name
}
