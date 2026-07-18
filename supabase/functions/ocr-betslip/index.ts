// =============================================================================
// ocr-betslip
// -----------------------------------------------------------------------------
// OCR del cupón de apuestas: recibe la foto en base64, corre reconocimiento
// de texto con bounding boxes por línea, agrupa con betSlipParser.ts
// (puerto de BetSlipParser.kt/MarketMapper.kt de FottStat) y devuelve el
// preview de legs SIN escribir nada en la base — el usuario todavía puede
// descartar legs antes de confirmar (docs/features/live-matches-ux.md
// sección 5.3). Autenticada con el JWT del usuario que llama (no hace falta
// service_role, esta función no escribe nada).
//
// Motor OCR: Tesseract.js (WASM), gratis/offline, evaluado como alternativa
// a un servicio de visión de pago según lo pedía el encargo.
//
// CAVEAT CONFIRMADO EMPÍRICAMENTE (deuda técnica real, no hipotética — ver
// resumen final de esta iteración, supabase-backend-expert): Tesseract.js
// NO funciona en el runtime de Edge Functions de Supabase. Se desplegó
// (bundle de 8.5 MB, sin error de build) y se probó contra una imagen
// sintética real: falla en tiempo de ejecución con
// "Not implemented: Worker.prototype.constructor" — Tesseract.js v5
// necesita spawnear un Web Worker internamente (createWorker), y el sandbox
// Deno de Edge Functions no implementa esa API. No es un problema de
// timeout/memoria/cold start: es una API ausente, no hay workaround simple
// sin reescribir tesseract.js-core a mano contra el wasm de bajo nivel.
//
// Implementación mínima viable adoptada (con permiso explícito del encargo
// para no bloquear el resto de la feature por esto): la función NUNCA
// devuelve un error duro al frontend por esta causa — si el OCR real falla,
// se responde igual con `legs: []` (200 OK), que el frontend ya sabe
// interpretar como "no encontramos selecciones en la foto" (docs/features/
// live-matches-ux.md sección 5.4), dejando al usuario continuar sin cupón
// sin romper el flujo. El código de recognizeLines()/parseBetSlip queda
// completo y listo para cuando se swapee el motor OCR real (API de visión
// externa, ej. Google Cloud Vision o similar con capa gratuita — pendiente
// de decisión del Product Owner, requiere una API key nueva que no existía
// en este encargo).
// =============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'
// @ts-ignore -- tesseract.js no trae tipos oficiales resueltos para el runtime npm: de Deno.
import Tesseract from 'npm:tesseract.js@5.1.1'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'
import { parseBetSlip, type OcrLine } from '../_shared/betSlipParser.ts'

interface RequestBody {
  imageBase64?: string
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
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'invalid_session' }, 401)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  if (!body.imageBase64) {
    return json({ error: 'missing_image' }, 400)
  }

  try {
    const lines = await recognizeLines(body.imageBase64)
    const slip = parseBetSlip(lines)
    const legs = slip.legs.map((leg, idx) => ({
      tempId: `${Date.now()}-${idx}`,
      selectionLabel: leg.pick,
      marketLabel: leg.market,
      marketType: leg.marketType,
      threshold: leg.threshold,
      selector: null,
      rawText: leg.raw,
    }))
    return json({
      teams: slip.teams,
      scoreHome: slip.scoreHome,
      scoreAway: slip.scoreAway,
      minute: slip.minute,
      legs,
    })
  } catch (e) {
    // Ver caveat arriba: hoy esto SIEMPRE cae acá (Tesseract.js no corre en
    // este runtime). Degradamos con 200 + legs:[] en vez de un 502 duro
    // para que el frontend siga el camino ya especificado de "no
    // encontramos selecciones" (sección 5.4 del doc de UX) en vez de un
    // camino de error de red (sección 5.2) — es el flujo correcto para una
    // falla sistemática del motor, no una falla puntual de una foto.
    console.error('ocr-betslip: el motor OCR falló (ver caveat de Tesseract.js/Worker en el runtime de Edge Functions)', e)
    return json({ teams: null, scoreHome: null, scoreAway: null, minute: null, legs: [], ocrEngineAvailable: false })
  }
})

async function recognizeLines(imageBase64: string): Promise<OcrLine[]> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
  const { data } = await Tesseract.recognize(dataUrl, 'spa', { logger: () => {} })
  const lines = (data?.lines ?? []) as Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>
  return lines.map((l) => ({
    text: l.text,
    left: l.bbox.x0,
    right: l.bbox.x1,
    top: l.bbox.y0,
    bottom: l.bbox.y1,
  }))
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
