// =============================================================================
// betSlipOcr.ts
// -----------------------------------------------------------------------------
// Adaptador PURO (sin dependencia de Tesseract.js) entre el resultado crudo
// del OCR y los legs estructurados del cupón. El OCR en sí (createWorker →
// recognize → terminate) vive en `MatchFormSheet.vue`, que es el dueño del
// ciclo de vida del Web Worker; acá solo transformamos el árbol `data.blocks`
// que devuelve Tesseract.js a la lista de legs que el store/`add-match`
// esperan.
//
// El OCR pasó de una Edge Function (Tesseract.js NO corre en el runtime Deno
// de Supabase, ver el CAVEAT del viejo `ocr-betslip/index.ts`) a correr
// client-side en el navegador, donde Tesseract.js usa Web Workers reales y
// funciona de verdad. La lógica de parseo (`betSlipParser`/`marketMapper`) se
// reusa tal cual (es TypeScript puro), solo cambia de dónde sale el texto.
// =============================================================================

import { parseBetSlip, type OcrLine } from './betSlipParser'

/** Leg extraído del cupón, con la misma forma que `IncomingLeg` del store
 * (`src/stores/liveMatches.ts`) más un `tempId` local para la lista de review
 * del Sheet. Mismo contrato exacto que devolvía el Edge Function `ocr-betslip`. */
export interface ExtractedBetSlipLeg {
  tempId: string
  marketType: string
  marketLabel: string
  selectionLabel: string
  threshold: number | null
  selector: string | null
  rawText: string | null
}

export interface BetSlipOcrResult {
  teams: [string, string] | null
  scoreHome: number | null
  scoreAway: number | null
  minute: number | null
  legs: ExtractedBetSlipLeg[]
}

// Forma mínima que consumimos del resultado de Tesseract.js (`data.blocks`).
// El árbol real trae muchísimos más campos; acá solo tocamos texto + bbox por
// línea, así el adaptador no depende del tipo completo de Tesseract.
interface RecognizedBbox {
  x0: number
  y0: number
  x1: number
  y1: number
}
interface RecognizedLine {
  text: string
  bbox: RecognizedBbox
}
interface RecognizedParagraph {
  lines?: RecognizedLine[]
}
export interface RecognizedBlock {
  paragraphs?: RecognizedParagraph[]
}

/**
 * Aplana el árbol `blocks → paragraphs → lines` a la lista neutra `OcrLine`
 * (texto + bounding box) que espera `parseBetSlip`.
 *
 * Nota importante: Tesseract.js v5 ya NO expone `data.lines`/`data.words` a
 * nivel de página (el `dump` interno solo devuelve el árbol `data.blocks`),
 * así que hay que recorrerlo para obtener las líneas con su bbox — no alcanza
 * con leer un `data.lines` plano.
 */
function flattenOcrLines(blocks: RecognizedBlock[] | null | undefined): OcrLine[] {
  const lines: OcrLine[] = []
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push({
          text: line.text,
          left: line.bbox.x0,
          right: line.bbox.x1,
          top: line.bbox.y0,
          bottom: line.bbox.y1,
        })
      }
    }
  }
  return lines
}

/**
 * Convierte el `data.blocks` de Tesseract.js en los legs del cupón. Devuelve
 * `legs: []` (sin lanzar) si no se reconoció ninguna selección — el Sheet ya
 * sabe interpretar eso como "no encontramos selecciones, continuá sin cupón"
 * (live-matches-ux.md sección 5.4). Mapeo idéntico al que hacía el Edge
 * Function `ocr-betslip` (incluido `selector: null`: el selector se resuelve
 * más adelante en el backend a partir de `marketType`/`threshold`).
 */
export function betSlipFromOcrBlocks(
  blocks: RecognizedBlock[] | null | undefined,
): BetSlipOcrResult {
  const slip = parseBetSlip(flattenOcrLines(blocks))
  return {
    teams: slip.teams,
    scoreHome: slip.scoreHome,
    scoreAway: slip.scoreAway,
    minute: slip.minute,
    legs: slip.legs.map((leg, idx) => ({
      tempId: `${Date.now()}-${idx}`,
      marketType: leg.marketType,
      marketLabel: leg.market,
      selectionLabel: leg.pick,
      threshold: leg.threshold,
      selector: null,
      rawText: leg.raw,
    })),
  }
}
