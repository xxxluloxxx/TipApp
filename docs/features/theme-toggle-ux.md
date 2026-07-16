# TipApp — Selector de tema (claro/oscuro/sistema) en el drawer de navegación

Documento de especificación para `vue-frontend-expert`. Agrega un control de
tema **dentro del drawer de navegación ya existente** (ver
`docs/features/nav-drawer-ux.md`, implementado en `HomeView.vue`) — **no** se
crea una pantalla de Ajustes separada, eso queda fuera de alcance de esta
iteración.

Da por sentado todo lo ya resuelto en `docs/design-system.md` (tokens,
espaciado, a11y) y en `nav-drawer-ux.md` (estructura del drawer, patrón de
filas `min-h-11`). No repite esa justificación acá.

**No es responsabilidad de este documento**: la persistencia en
`profiles.theme_preference` (`'light' | 'dark' | 'system'`, default
`'system'`) ya la está migrando otro agente en paralelo. Tampoco especifica
el mecanismo interno de aplicar la clase `.dark` al DOM ni el listener de
`matchMedia` para el valor `'system'` — eso es implementación de
`vue-frontend-expert`. Este documento cubre **qué control se ve, cómo se
comporta y cómo se siente**.

---

## 0. Decisión: segmented control de 3 estados, no switch binario

**Se descarta el switch binario claro/oscuro** (aunque Reka UI/shadcn-vue
tienen el bloque `switch` estándar disponible para instalar) **a favor de un
segmented control de 3 opciones: Claro / Oscuro / Sistema**, con semántica de
`radiogroup`.

Justificación:

1. **El dato ya modela 3 estados reales, no 2.** `theme_preference` tiene
   `'system'` como default, no como un caso de borde — es probable que sea el
   valor más común (usuarios que nunca tocan el control). Un switch binario
   fuerza una de dos malas soluciones: (a) no exponer "sistema" en absoluto
   en la UI aunque el dato lo soporte, perdiendo una preferencia real y muy
   valorada (elegir que la app seudo-siga el tema del SO, típicamente para
   comodidad visual según hora del día), o (b) esconderla detrás de un gesto
   no descubrible (long-press, tercer tap cíclico) — ambas peores que
   simplemente mostrar las 3 opciones.
2. **Un switch "on/off" mentiría sobre el estado real.** Si la preferencia es
   `'system'` y el SO está en modo oscuro en ese momento, un switch binario
   se mostraría "activado" (oscuro) — pero eso no es lo mismo que el usuario
   habiendo elegido explícitamente "oscuro". Si luego el SO cambia a modo
   claro, el switch saltaría a "desactivado" sin que el usuario haya tocado
   nada, lo cual es confuso: un switch comunica una elección binaria
   explícita del usuario, no un estado derivado que puede cambiar solo.
   Un segmented control no tiene ese problema: el segmento "Sistema"
   queda marcado como seleccionado independientemente de si el tema
   *efectivo* en este momento es claro u oscuro.
3. **Hay espacio de sobra** (confirmado en `nav-drawer-ux.md` sección 5: el
   drawer con 2 ítems de nav + logout ya deja espacio en blanco intencional,
   sin necesidad de "ahorrar" una fila). No hay ninguna presión de espacio
   que justifique comprimir a 2 opciones.
4. **Patrón ya validado y reconocible**: selector de 3 vías Claro/Oscuro/
   Sistema es el patrón estándar en iOS, macOS, GitHub, VS Code, Notion,
   Linear, etc. — no hay curva de aprendizaje, el usuario ya sabe qué hace
   antes de tocarlo.
5. **Mapeo 1:1 con el dato persistido**: las 3 opciones del control son
   exactamente los 3 valores de `theme_preference`, sin traducción con
   pérdida en ningún sentido. Si en el futuro se decidiera simplificar a un
   switch, ahí sí habría que decidir qué hacer con `'system'` — pero hoy no
   hay ninguna razón para pagar ese costo.

**No se necesita instalar/crear ningún componente nuevo.** El control se
resuelve con markup inline en `HomeView.vue` (tres `<button>` planos con
clases de Tailwind), exactamente el mismo criterio ya usado para los ítems de
`<nav>` del drawer (que tampoco son un componente `ui/` abstraído, son
botones planos con clases condicionales — ver `nav-drawer-ux.md` sección 1).
No hace falta el bloque `Switch` de shadcn-vue (se descartó en el punto
anterior) ni un `ToggleGroup` de Reka UI: para 3 botones fijos, sin
necesidad de reordenamiento ni de soporte multi-selección, un `radiogroup`
manual es más simple de razonar y de auditar en a11y que integrar un
primitivo genérico para un caso de uso tan acotado.

---

## 1. Íconos

De `@lucide/vue` (agregar a los imports ya existentes en `HomeView.vue`):

- **Ícono de la fila (label "Tema")**: `SunMoon` — representa "tema" de forma
  genérica (ni claro ni oscuro específicamente), coherente con el resto de
  íconos de fila del drawer (`Home`, `Tag`, `LogOut`, todos genéricos de su
  concepto).
- **Segmento Claro**: `Sun`.
- **Segmento Oscuro**: `Moon`.
- **Segmento Sistema**: `Monitor` — ícono de pantalla/dispositivo, vínculo
  semántico directo con "usa la configuración de tu dispositivo", el mismo
  criterio que usan la mayoría de apps para el segmento "sistema"/"auto".

Ninguno requiere instalar paquete nuevo (mismo paquete `@lucide/vue` ya en
uso).

---

## 2. Ubicación exacta dentro del drawer

Entre el `<nav>` (Inicio/Categorías) y el `SheetFooter` (Cerrar sesión), como
bloque propio — **no** dentro del `<nav>` existente. Justificación: `<nav>`
es el landmark de navegación real (destinos de ruta, con `aria-current`); el
selector de tema no navega a ningún lado, es un control de preferencia. Meterlo
dentro del mismo `<nav>` sería semánticamente incorrecto para lectores de
pantalla (anunciarían un control de ajuste como si fuera un destino de
navegación más).

El bloque nuevo lleva `border-t border-border` propio (mismo criterio ya
usado en el resto del componente: cada bloque nuevo separa con su propio
borde en el lado que corresponde, sin duplicar contra un borde ya existente
del bloque vecino — acá no hay duplicación porque nav y footer no tienen
borde en los lados que tocan este bloque).

Esto no rompe el layout de "espacio flexible" de `nav-drawer-ux.md` sección
3: el bloque de tema es contenido real (no relleno), simplemente consume una
porción del espacio en blanco que hoy queda entre nav y footer; el
`SheetFooter` sigue con `mt-auto` sin cambios.

---

## 3. Markup exacto

```html
<!-- Entre </nav> y <SheetFooter> -->
<div class="border-t border-border p-3">
  <div id="theme-label" class="flex min-h-11 items-center gap-3 px-3 text-sm font-medium text-foreground">
    <SunMoon class="size-5 shrink-0" />
    Tema
  </div>

  <div
    role="radiogroup"
    aria-labelledby="theme-label"
    class="flex gap-1 rounded-md bg-muted p-1"
  >
    <button
      type="button"
      role="radio"
      :aria-checked="themePreference === 'light'"
      aria-label="Claro"
      class="flex min-h-11 flex-1 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="themePreference === 'light' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
      @click="selectTheme('light')"
    >
      <Sun class="size-4 shrink-0" />
    </button>

    <button
      type="button"
      role="radio"
      :aria-checked="themePreference === 'dark'"
      aria-label="Oscuro"
      class="flex min-h-11 flex-1 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="themePreference === 'dark' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
      @click="selectTheme('dark')"
    >
      <Moon class="size-4 shrink-0" />
    </button>

    <button
      type="button"
      role="radio"
      :aria-checked="themePreference === 'system'"
      aria-label="Sistema"
      class="flex min-h-11 flex-1 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="themePreference === 'system' ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'"
      @click="selectTheme('system')"
    >
      <Monitor class="size-4 shrink-0" />
    </button>
  </div>
</div>
```

Notas sobre este markup:

- **`role="radiogroup"` + `role="radio"` + `aria-checked`**, no
  `aria-pressed`. `aria-pressed` es semántica de "toggle button"
  independiente (varios podrían estar `true` a la vez); acá hay selección
  mutuamente excluyente entre 3 opciones — el patrón ARIA correcto es
  `radiogroup`/`radio` (ver sección 5).
- **`aria-labelledby="theme-label"`** en vez de repetir `aria-label="Tema"`
  en el `radiogroup`: reusa el texto visible ya existente en vez de
  duplicar el string (mismo criterio de no repetir información ya usado en
  `nav-drawer-ux.md` para el `SheetTitle`).
- **Íconos sin texto visible dentro de cada segmento** (`aria-label` cubre
  el nombre accesible). Es el mismo criterio ya vigente en este archivo para
  el trigger `Menu` (`aria-label="Abrir menú"`, sin texto) y el botón "⋮" de
  cada gasto (`aria-label="Más acciones para este gasto"`) — íconos
  ampliamente reconocibles (sol/luna/monitor) no necesitan reforzarse con
  texto, y agregar texto rompería el ancho disponible en un drawer de
  `w-3/4` en mobile angosto (ver cálculo en sección 5).
- **Estado seleccionado indicado por fondo + elevación** (`bg-background` +
  `shadow-[var(--shadow-card)]`), no por color de ícono. Cumple la regla
  "color nunca como único indicador" — acá ni siquiera hay cambio de color
  de ícono entre estados, el indicador es la "píldora" de fondo elevada,
  perceptible sin depender de distinguir tonos.
- **`flex-1`** en cada botón: los 3 segmentos se reparten el ancho disponible
  en partes iguales, sin importar el ancho del drawer (`w-3/4` mobile /
  `sm:max-w-sm`) — ver cálculo de mínimo táctil en sección 5.

---

## 4. Comportamiento de aplicación inmediata (optimista)

1. **Al tocar cualquier segmento, el tema visual cambia al instante** — no
   se espera ninguna respuesta del servidor para reflejar el cambio. La
   escritura a `profiles.theme_preference` ocurre en paralelo, en segundo
   plano.
2. **Transición sutil, no un corte duro**: agregar una transición corta
   (~150-200ms, `ease`) sobre `background-color`/`color` a nivel global
   (`html`/`body`) para que el cambio de paleta completo (fondos, texto,
   cards) se sienta como un cruce suave en vez de un parpadeo — sin que esto
   retrase la interacción (la clase `.dark` se aplica en el mismo tick del
   click, la transición es puramente visual sobre esa misma aplicación
   instantánea). Ejemplo a agregar en `src/assets/main.css`:
   ```css
   html {
     transition: background-color 0.2s ease, color 0.2s ease;
   }
   @media (prefers-reduced-motion: reduce) {
     html {
       transition: none;
     }
   }
   ```
   Respeta `prefers-reduced-motion` explícitamente (regla ya vigente en
   `docs/design-system.md` sección 5, punto 8) — con esa preferencia
   activada, el cambio es instantáneo sin transición, no solo "más corto".
3. **La píldora de selección dentro del segmented control** también usa
   `transition-colors` (ya incluido en la clase del botón en sección 3) para
   que el cambio de segmento activo se sienta parejo con el resto del
   cambio de tema — sin animación de "deslizamiento" de la píldora (no hace
   falta, sería una animación decorativa que no comunica nada adicional; ver
   criterio de "no over-engineer" ya usado en `nav-drawer-ux.md` para el
   manejo de foco).
4. **Prevención de flash al recargar la página (FOUC)**: fuera del alcance
   visual estricto de este documento, pero se deja anotado porque es
   relevante para que la "aplicación inmediata" se sienta consistente
   también entre sesiones, no solo dentro de la misma sesión: cachear la
   última preferencia aplicada en `localStorage` y aplicarla lo antes
   posible en el arranque (antes del primer paint, si es viable), para no
   mostrar el tema equivocado un instante mientras se resuelve el perfil de
   Supabase. `vue-frontend-expert` decide la técnica concreta (script
   inline en `index.html`, o aceptar un flash mínimo si no es viable en el
   setup de Vite actual) — esto es una recomendación de UX, no un
   bloqueante de esta iteración.

---

## 5. Manejo de error de persistencia

**Decisión: si falla el guardado en el servidor, el tema visual elegido NO
se revierte automáticamente.** Solo se informa el fallo vía toast, con
acción "Reintentar" — mismo patrón visual/copy ya establecido en
`src/stores/expenses.ts` (`toast.error(...)` con `action: { label:
'Reintentar', onClick: ... }`).

Justificación de **por qué no** replicar el rollback automático que sí usan
gastos/categorías:

- Revertir un gasto que falló al guardar deshace un dato que el usuario
  pensaba que ya existía — es correcto que desaparezca si no se guardó.
- Revertir el **tema visual completo de la pantalla** de forma automática,
  sin que el usuario haya tocado nada, es una experiencia disruptiva: la
  pantalla cambiaría de color sola, sin acción del usuario, potencialmente
  varios segundos después del tap original (cuando ya está mirando otra
  cosa del drawer). Es más confuso que útil, y roza la misma preocupación
  de `prefers-reduced-motion` (cambios de color abruptos e inesperados).
- El tema elegido igual queda aplicado y funcionando en este dispositivo
  gracias al cacheo en `localStorage` de la sección 4 punto 4 — lo único
  que se pierde si falla el guardado remoto es la sincronización a otros
  dispositivos/sesiones futuras, que es una degradación aceptable y
  comunicable en el copy del toast, no un motivo para deshacer la elección
  visual inmediata.

Copy sugerido (mismo tono informal "vos" ya usado en el resto de la app):

```
toast.error('No pudimos guardar tu preferencia de tema', {
  description: 'Se aplicó igual en este dispositivo, pero podría no verse así en otra sesión.',
  action: {
    label: 'Reintentar',
    onClick: () => /* reintentar solo el guardado remoto, el tema visual no cambia */,
  },
})
```

El `radiogroup` **sí** debe reflejar en todo momento la preferencia
localmente aplicada (no la última confirmada por el servidor) — igual que
el tema visual, el segmento marcado no rebota ni parpadea mientras se
reintenta el guardado en segundo plano.

---

## 6. Accesibilidad

1. **Semántica de selección única**: `role="radiogroup"` en el contenedor +
   `role="radio"` y `aria-checked` en cada botón (no `aria-pressed`, ver
   justificación en sección 3). Esto le da al lector de pantalla el modelo
   correcto ("elegí una de 3 opciones", con navegación por flechas si el
   usuario está sobre lectores que implementan el patrón nativo de
   radiogroup vía teclado — comportamiento estándar del rol, no hace falta
   implementarlo a mano más allá de exponer el rol/estado correctamente).
2. **Nombre accesible de cada opción**: `aria-label` en cada botón ("Claro"/
   "Oscuro"/"Sistema") ya que no hay texto visible dentro del botón (íconos
   solos, ver sección 3).
3. **Nombre accesible del grupo**: `aria-labelledby="theme-label"` apuntando
   a la fila de label "Tema" ya visible arriba (no se repite el texto).
4. **Mínimo táctil 44×44px**: cada segmento usa `min-h-11` (44px de alto) y
   `flex-1` (ancho repartido). Cálculo de peor caso: en el viewport angosto
   soportado más chico (~320px CSS width), el drawer mide `w-3/4` ⇒ 240px;
   restando el padding del bloque (`p-3` = 24px) y el padding interno del
   contenedor `bg-muted` (`p-1` = 8px) y los 2 `gap-1` entre botones (8px),
   quedan ~200px repartidos en 3 ⇒ ~66px de ancho por segmento — muy por
   encima del mínimo de 44px en ambos ejes, incluso en el dispositivo más
   angosto realista.
5. **Foco visible**: mismo patrón ya usado en todo el proyecto
   (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
   focus-visible:ring-offset-2`) en cada uno de los 3 botones.
6. **Color nunca como único indicador**: ya cubierto en sección 3 — el
   segmento activo se distingue por fondo + elevación (píldora), no por tono
   de color del ícono; adicionalmente cada segmento ya tiene un ícono
   distinto entre sí en todo momento (no dependen de estar "activos" para
   distinguirse unos de otros).
7. **`prefers-reduced-motion`**: cubierto en sección 4 — la transición de
   color global se anula, el cambio queda instantáneo sin animación.
8. **No confundir con el toggle de tema del sistema operativo**: este
   control no tiene ningún requisito de accesibilidad especial más allá de
   los ya listados; no reemplaza ni interactúa con ajustes de accesibilidad
   del SO (alto contraste, etc.), que quedan fuera de alcance.

---

## 7. Nota de arquitectura (no vinculante, para orientar — no prescribe código)

Sugerencia de alto nivel para que `vue-frontend-expert` decida los detalles:
el estado `themePreference` probablemente conviene vivir junto al resto del
estado de sesión/perfil (`src/stores/auth.ts`, que ya expone `profile` desde
`profiles`), ya que `theme_preference` es una columna más de esa misma tabla
— no necesita un store nuevo dedicado solo para esto. La función
`selectTheme(value)` referenciada en el markup de la sección 3 sería un
método de ese store (o un composable que lo envuelva), responsable de: (a)
aplicar la clase `.dark`/tema en el DOM de inmediato, (b) cachear en
`localStorage`, y (c) disparar el `update` a Supabase con el mismo patrón de
toast de error que ya usa `expenses.ts`. Esto es una orientación, no una
instrucción cerrada — `vue-frontend-expert` puede resolverlo distinto si
encuentra una mejor ubicación dentro de la arquitectura actual del proyecto.

---

## Resumen para `vue-frontend-expert`

1. **No instalar ningún componente nuevo** (se descartó `Switch` y
   `ToggleGroup`, ver sección 0). Todo es markup inline en `HomeView.vue`,
   mismo criterio que los ítems de `<nav>` ya existentes.
2. Imports nuevos en `@lucide/vue`: `SunMoon`, `Sun`, `Moon`, `Monitor`
   (agregar a la lista ya existente).
3. Insertar el bloque de la sección 3 entre `</nav>` y `<SheetFooter>` en el
   `SheetContent` del drawer (`HomeView.vue`), con `border-t border-border`
   propio.
4. Estado `themePreference` (`'light' | 'dark' | 'system'`) y función
   `selectTheme(value)` — ubicación sugerida en `src/stores/auth.ts` (ver
   sección 7), no vinculante.
5. Al ejecutar `selectTheme`: aplicar el tema al DOM al instante (optimista,
   sin esperar servidor), cachear en `localStorage` para evitar flash en el
   próximo arranque (sección 4.4), y persistir en `profiles.theme_preference`
   en segundo plano.
6. Si falla la persistencia remota: **no revertir el tema visual ni el
   segmento marcado** — solo `toast.error(...)` con acción "Reintentar",
   mismo patrón que `src/stores/expenses.ts` (ver copy sugerido en sección
   5).
7. Agregar la transición global de color con soporte de
   `prefers-reduced-motion` en `src/assets/main.css` (sección 4, punto 2).
8. Markup exacto de los 3 botones (`role="radio"`, `aria-checked`,
   `aria-label`, clases de estado seleccionado/no seleccionado) — sección 3,
   copiar tal cual.
9. No crear ninguna pantalla de Ajustes ni ningún ítem nuevo de navegación —
   el control vive únicamente dentro del drawer ya existente.
