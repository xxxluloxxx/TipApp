// CORS compartido por las 3 Edge Functions de Partidos en vivo. Supabase no
// agrega CORS automáticamente a funciones custom (a diferencia de
// PostgREST/Storage) — cada función que puede ser llamada desde el
// navegador necesita manejar el preflight OPTIONS a mano.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}
