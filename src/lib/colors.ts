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
