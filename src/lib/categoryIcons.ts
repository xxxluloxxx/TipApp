/**
 * Set curado de emojis para el selector de ícono de categorías custom
 * (sección 3.2 de docs/features/categories-mvp-ux.md). 24 emojis, todos de
 * texto plano (mismo tipo de dato que ya usa `categories.icon`), ninguno
 * repite los 12 ya sembrados en las categorías default (🍽️🚗🏠💡💊📚🎬👕
 * 💰📦🏦⚖️) — así una categoría custom nunca se confunde visualmente con una
 * default dentro del `Select` de categoría del formulario de gasto. Deportes
 * usa 🏀 (no ⚽ — pedido explícito del Product Owner tras la primera ronda).
 * Corazón (❤️) y comida chatarra (🍔) agregados a pedido del usuario.
 *
 * Se centraliza acá (en vez de una constante local en `CategoryFormSheet.vue`,
 * que la nota de la sección 3.2 dejaba a criterio del implementador) siguiendo
 * el mismo criterio que `COLOR_SWATCHES` en
 * `src/lib/colors.ts`: un set de opciones de UI vive en `src/lib` como fuente
 * única, listo para un segundo consumidor sin duplicar el literal.
 *
 * El `label` es el `aria-label` de cada botón (un lector de pantalla anunciando
 * solo el emoji no siempre comunica el concepto pretendido).
 */
export const CATEGORY_ICON_OPTIONS = [
  { emoji: '❤️', label: 'Amor' },
  { emoji: '🍔', label: 'Comida chatarra' },
  { emoji: '🐾', label: 'Mascotas' },
  { emoji: '🏀', label: 'Deportes' },
  { emoji: '💻', label: 'Tecnología' },
  { emoji: '🎁', label: 'Regalos' },
  { emoji: '✈️', label: 'Viajes' },
  { emoji: '💅', label: 'Belleza y cuidado personal' },
  { emoji: '👶', label: 'Hijos y familia' },
  { emoji: '🧾', label: 'Impuestos y trámites' },
  { emoji: '🔁', label: 'Suscripciones' },
  { emoji: '🔧', label: 'Herramientas y hogar' },
  { emoji: '🎮', label: 'Videojuegos' },
  { emoji: '🎵', label: 'Música' },
  { emoji: '📖', label: 'Libros' },
  { emoji: '☕', label: 'Café y bares' },
  { emoji: '🏋️', label: 'Gimnasio y fitness' },
  { emoji: '🛒', label: 'Supermercado' },
  { emoji: '💼', label: 'Trabajo' },
  { emoji: '🎨', label: 'Hobbies y arte' },
  { emoji: '🌱', label: 'Plantas y jardín' },
  { emoji: '🍺', label: 'Cerveza y bebidas' },
  { emoji: '⛽', label: 'Gasolina y combustible' },
  { emoji: '📶', label: 'Internet' },
] as const
