import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Alert } from './Alert.vue'
export { default as AlertDescription } from './AlertDescription.vue'
export { default as AlertTitle } from './AlertTitle.vue'

// Nota: `Alert` no está en la lista de componentes ya instalados por
// docs/design-system.md (que solo lista `Alert Dialog`), pero
// docs/features/expenses-mvp-ux.md sí lo requiere explícitamente (errores
// inline de login/registro, sección 1.3/1.4). Se agrega a mano siguiendo
// exactamente la misma convención (cva + cn + data-slot) que el resto de
// src/components/ui, sin instalar ninguna dependencia nueva.
export const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground border-border',
        destructive: 'text-destructive bg-destructive/10 border-destructive/30 [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)
export type AlertVariants = VariantProps<typeof alertVariants>
