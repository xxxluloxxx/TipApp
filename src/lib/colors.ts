/**
 * docs/design-system.md sección 1 exige que el texto sobre un badge de
 * categoría sea siempre legible, incluso para los slots de color con bajo
 * contraste contra blanco (aqua/amarillo/magenta). En vez de hardcodear qué
 * categorías son "problemáticas" (el frontend no conoce el slot, solo el hex
 * ya asignado por el backend en `categories.color`), se calcula el contraste
 * en runtime contra blanco y negro (luminancia relativa WCAG) y se elige el
 * texto que mejor contrasta. Decisión no explicitada 1:1 en el doc, pero es
 * la forma más robusta de cumplir la regla "nunca solo color / siempre
 * texto legible" para cualquier hex que llegue de la base de datos.
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!match) return null
  return [Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16), Number.parseInt(match[3]!, 16)]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Devuelve `#ffffff` o `#111827` (casi negro), lo que mejor contraste dé
 * contra el color de fondo recibido. Si el hex es inválido o falta, no fija
 * color (hereda el `foreground` normal). */
export function readableTextColor(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined
  const rgb = hexToRgb(hex)
  if (!rgb) return undefined
  const luminance = relativeLuminance(rgb)
  return luminance > 0.42 ? '#111827' : '#ffffff'
}

/**
 * `rgba(...)` con opacidad para el fondo del swatch de categoría (sección
 * 2.1 de categories-mvp-ux.md: "fondo = `color` al ~12% de opacidad, borde
 * `1px solid color`"). Se calcula en runtime en vez de usar clases de
 * Tailwind con opacidad (`bg-[color]/12`) porque el hex viene de datos, no
 * de una clase estática conocida en build time.
 */
export function withAlpha(hex: string | null | undefined, alpha: number): string | undefined {
  if (!hex) return undefined
  const rgb = hexToRgb(hex)
  if (!rgb) return undefined
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

/**
 * Conversión RGB (0-255) → HSL, componente interno de `hexToHslTriple`. No se
 * expone porque ningún consumidor necesita los tres números por separado —
 * siempre se quiere el string final listo para una variable CSS (ver esa
 * función). Redondeado a 1 decimal: mismo nivel de precisión que los tokens
 * ya escritos a mano en `main.css` (p. ej. `221.2 83.2% 53.3%`), para que un
 * acento elegido por el usuario no se note "distinto" en formato de los
 * colores de fábrica.
 */
function rgbToHsl([r, g, b]: [number, number, number]): { h: number; s: number; l: number } {
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255
  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  const l = (max + min) / 2

  if (max === min) {
    // Gris puro (r === g === b): sin matiz ni saturación posibles.
    return { h: 0, s: 0, l: round1(l * 100) }
  }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rNorm:
      h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
      break
    case gNorm:
      h = (bNorm - rNorm) / d + 2
      break
    default:
      h = (rNorm - gNorm) / d + 4
  }

  return { h: round1(h * 60), s: round1(s * 100), l: round1(l * 100) }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Convierte un hex (`#rrggbb`) a la tripleta HSL cruda `"H S% L%"`, SIN el
 * wrapper `hsl(...)` — el formato exacto que ya usan las variables de tema en
 * `main.css` (p. ej. `--primary: 221.2 83.2% 53.3%;`), para que un color de
 * acento elegido en runtime pueda escribirse en esa misma variable vía
 * `style.setProperty` sin que el resto del CSS (que hace `hsl(var(--primary))`
 * en el `@theme`) tenga que cambiar. Reusa `hexToRgb` en vez de reparsear el
 * hex, mismo criterio que el resto de este archivo (`readableTextColor`,
 * `withAlpha`).
 *
 * `minLightness` es opcional y existe por un solo motivo: el color de
 * acento también puede reflejarse en `--ring` (anillo de foco), pero en modo
 * oscuro el `--ring` fijo del proyecto (`217.2 91.2% 65%` en `main.css`) NO
 * comparte el lightness de `--primary` (que se queda en 53.3%) — es más claro
 * a propósito para seguir siendo visible contra fondo oscuro. Pasar
 * `{ minLightness: 65 }` replica esa misma relación para cualquier acento
 * elegido, sin necesidad de que el llamador reimplemente la conversión.
 */
export function hexToHslTriple(hex: string, options?: { minLightness?: number }): string | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const { h, s, l } = rgbToHsl(rgb)
  const lightness = options?.minLightness !== undefined ? Math.max(l, options.minLightness) : l
  return `${h} ${s}% ${lightness}%`
}

/**
 * Grid fijo de 10 swatches (sección 3.3 de categories-mvp-ux.md): mismos hex
 * ya sembrados en `categories.color`. `CategoryFormSheet.vue` mantiene su
 * propia copia local (no se tocó ese archivo, fuera de alcance de esta
 * iteración); esta exportación es la reusada tal cual por `CardFormSheet.vue`
 * y `CardPersonFormSheet.vue` (credit-cards-ux.md sección 6.2/6.3, "reusar
 * literalmente los mismos hex/patrón") para no triplicar el literal.
 */
export const COLOR_SWATCHES = [
  { hex: '#f97316', label: 'Naranja' },
  { hex: '#3b82f6', label: 'Azul' },
  { hex: '#8b5cf6', label: 'Violeta' },
  { hex: '#eab308', label: 'Amarillo' },
  { hex: '#ef4444', label: 'Rojo' },
  { hex: '#06b6d4', label: 'Celeste' },
  { hex: '#ec4899', label: 'Rosa' },
  { hex: '#14b8a6', label: 'Verde azulado' },
  { hex: '#22c55e', label: 'Verde' },
  { hex: '#6b7280', label: 'Gris' },
] as const
