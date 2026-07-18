# TipApp — UX de Partidos en vivo (seguimiento con notificaciones)

Documento de especificación funcional/UX para `vue-frontend-expert` y
`supabase-backend-expert`. Da por sentado todo lo ya resuelto en
`docs/design-system.md` (tokens, tipografía, Card-list, Sheet inferior,
a11y), `docs/features/nav-drawer-ux.md` (estructura del drawer — el
documento en sí quedó desactualizado en el número de ítems, pero el patrón
de fila/`aria-current`/`min-h-11` sigue vigente) y, sobre todo,
`docs/features/credit-cards-ux.md` / `docs/features/debts-ux.md` como
precedente directo de dos decisiones que se reusan tal cual acá: la
"estrategia de datos" como sección más importante del documento, y el
criterio de calibrar cuántas rutas hace falta (Tarjetas resolvió 4, Cuentas
1, Deudas 3). No se repite esa justificación de base, solo se referencia.

Contexto de dominio (funcional, no de implementación): la feature está
inspirada en un proyecto Android existente, FottStat
(`/home/lulo/Proyectos/Propios/FottStat/PLAN.md`), que ya resolvió en la
práctica varios problemas de dominio no triviales — de dónde sale el minuto
real de un partido, cómo distinguir descanso de tiempo corrido, cómo leer un
cupón de apuestas por foto y evaluar sus selecciones en vivo. Este documento
**reusa esas soluciones de dominio ya validadas** (se citan explícitamente
donde aplica) pero **no replica su arquitectura de implementación** (esa era
100% on-device en Kotlin; acá todo el polling/OCR corre server-side en
Supabase, ya decidido por el Product Owner, ver recap abajo).

## 0. Decisiones ya tomadas por el Product Owner (recap, no se rediscuten)

1. El polling del feed de Flashscore corre **server-side** (Edge Function +
   `pg_cron`), no depende del navegador abierto.
2. El OCR del cupón corre **server-side** (Edge Function), no on-device.
3. Las notificaciones son **Web Push** (browser), con la limitación conocida
   de iOS: solo funcionan con la PWA instalada a pantalla de inicio.
4. El modelo de datos guarda **solo el último snapshot** de cada partido, no
   historial completo — excepto el feed de incidencias (goles/tarjetas/
   cambios), que sí se puede mostrar completo porque Flashscore lo devuelve
   entero en cada consulta (no hay que reconstruirlo).
5. Mercados de apuestas soportados en v1 (fijo): doble oportunidad,
   resultado, over/under de goles, over/under de córners, over/under de
   tarjetas, ambos marcan, ambos marcan 1ª parte. Cualquier otro mercado se
   muestra como "no monitoreable", nunca se oculta.
6. Prioridades de notificación (fijas): gol/tarjeta = **alta**; córner/
   remate a puerta = **normal**; leg de cupón decidido = **alta**; el resto
   de stats no notifica.

---

## 1. Estrategia de datos y tiempo real

Esta es la sección más importante del documento — condiciona el diseño de
todas las pantallas siguientes, léase antes que cualquier otra sección
(mismo criterio que `credit-cards-ux.md` sección 1 / `debts-ux.md` sección
1).

### 1.1 Dos cardinalidades muy distintas conviven en esta feature

- **La lista de partidos seguidos** (`monitored_matches`, nombre
  ilustrativo — confirmar con `supabase-backend-expert`) tiene una
  cardinalidad chica y acotada por diseño: cuántos partidos está siguiendo
  **ahora mismo** un usuario, que para un tracker personal es "un puñado"
  (unos pocos a la vez, nunca miles) — mismo argumento de escala que ya
  usó `debts-ux.md` sección 1.2 para `debt_balances`. Es seguro traer la
  lista completa del usuario en una sola query y ordenar/agrupar en
  cliente, sin paginar.
- **Los legs de un cupón** (`bet_slip_legs`, ilustrativo) también son una
  lista chica y acotada: un cupón de apuestas real tiene, en la práctica,
  entre 1 y ~8 selecciones — se trae completa por partido, sin límite
  artificial.
- **Lo que si podría crecer sin límite realista con el tiempo** es la
  cantidad de partidos **finalizados** que el usuario nunca quitó de su
  lista — ver nota abierta en 1.10. No es un problema de "sumar demasiadas
  filas en cliente" (la lista sigue siendo chica en términos absolutos
  comparada con `expenses`/`card_expenses`), es un problema distinto de
  "ruido visual acumulado", tratado en la sección 3.4.

**Consecuencia práctica**: a diferencia de `expenses.ts` (`MAX_EXPENSES`)
o `card_expenses` (acotado por rango de fecha), acá **no hace falta ningún
filtro de fecha ni paginación** para la query principal del dashboard — una
sola `select * from monitored_matches where user_id = :userId`, con sus
legs embebidos o en una segunda query chica por partido visible.

### 1.2 El estado de cada partido es siempre el último snapshot server-side — nunca reconstruido en cliente

Mismo principio exacto que `debts-ux.md` sección 1.1 ("el saldo de una
deuda es siempre un agregado server-side"), aplicado acá a algo más
delicado todavía: **el frontend nunca toca el feed de Flashscore ni
reparsea nada** — ni marcador, ni minuto, ni stats, ni el estado de un leg
del cupón (ganado/perdido/pendiente). Todo eso ya viene resuelto en la fila
de `monitored_matches`/`bet_slip_legs` que trajo el Edge Function/cron. El
frontend es una capa de presentación pura sobre ese snapshot — esto no es
una limitación, es la misma garantía de integridad que ya tiene el resto de
la app (nunca confiar en el cliente para calcular un número que después hay
que comparar entre sesiones/dispositivos).

Consecuencia concreta: el motor de reglas que decide si un leg está
`won`/`lost`/`pending`/`not_monitorable` (equivalente al `BetRuleEngine` de
FottStat, sección 6.5 de `PLAN.md`) vive en el Edge Function, no en Vue. El
store del frontend (`src/stores/liveMatches.ts`, ilustrativo) es
deliberadamente "tonto": lee, muestra, dispara acciones (pausar/reanudar/
quitar/agregar) — nunca deriva un estado de partido o de leg a partir de
datos crudos.

### 1.3 Tiempo real sin pull-to-refresh: Supabase Realtime

Como el dato cambia del lado del servidor de forma asíncrona (el usuario no
dispara el cambio con una acción propia, a diferencia de agregar un gasto),
la lista de `/partidos` necesita actualizarse sola. **Se recomienda
Supabase Realtime** sobre `postgres_changes` de `monitored_matches` (y de
`bet_slip_legs` si su estado se resuelve async después del alta),
suscripto y filtrado por `user_id`:

```ts
// Ilustrativo — src/stores/liveMatches.ts
const channel = supabase
  .channel('monitored-matches-changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'monitored_matches', filter: `user_id=eq.${userId}` },
    (payload) => applyRealtimeChange(payload),
  )
  .subscribe()
```

- **Sin pull-to-refresh manual como mecanismo principal**: el usuario no
  debería tener que arrastrar la pantalla para ver un córner nuevo — eso
  contradice el propósito mismo de la feature ("me entero sin hacer nada").
- **Red de seguridad, no reemplazo**: un socket de Realtime puede
  desconectarse (la PWA se puede ir a segundo plano y el navegador puede
  congelar/matar la conexión — comportamiento normal de un service worker/
  tab en background en mobile). Al volver a foreground
  (`document.visibilitychange` → `visibilityState === 'visible'`, o el
  evento de reconexión propio del cliente de Realtime), el store dispara
  **un refetch completo de la lista** una sola vez, para resincronizar
  cualquier cambio perdido mientras estaba desconectado — después retoma la
  suscripción normal. Esto es responsabilidad de `vue-frontend-expert`, no
  hay nada que diseñar visualmente para este caso: es invisible si funciona
  bien.
- No hace falta ningún indicador de "conectado a tiempo real" en la UI —
  sería ruido para un usuario que no tiene forma de actuar sobre eso; el
  indicador que sí importa es el "Actualizado hace Ns" por partido (1.5) y
  el estado de error por partido (1.5), que reflejan la realidad del *dato*,
  no la del socket.

### 1.4 El minuto tiene que "correr" entre polls — requisito concreto para backend

Los feeds de Flashscore están detrás de una caché de ~8-15s (documentado en
`PLAN.md` sección 6.3) y el cron server-side va a pollear con un intervalo
adaptativo bastante más largo (15s a 120s, con backoff). Si el frontend
solo mostrara el minuto tal como llegó en el último poll, el número quedaría
**visiblemente congelado** varios segundos entre actualizaciones — mala
sensación de "en vivo" para el elemento más mirado de la pantalla.

**Solución adoptada de FottStat, sección 5 de `PLAN.md` ("Minuto real")**:
en vez de que el backend calcule y envíe un string de minuto ya formateado,
expone los campos crudos que permiten que el **cliente lo calcule y lo haga
tickear localmente cada segundo**, sin volver a pedir nada al servidor:

- `stage_code` (equivalente a `DB` del feed: `1`=no empezado, `12`=1ª
  parte, `38`=descanso, `13`=2ª parte, `3`=finalizado).
- `stage_anchor_ts` (equivalente a `DD`: timestamp epoch desde el que corre
  el cronómetro de la parte actual).
- `scheduled_kickoff_ts` (equivalente a `DC`: hora programada de inicio,
  solo se usa para el label "Empieza HH:MM" antes de que arranque).

```ts
// Ilustrativo — src/lib/matchClock.ts, port 1:1 de MatchClock.kt (FottStat)
function matchClockLabel(stageCode: number, stageAnchorTs: number | null, scheduledKickoffTs: number, now: number): string {
  if (stageCode === 1) return `Empieza ${formatTime(scheduledKickoffTs)}` // hora local
  if (stageCode === 38) return 'Descanso'
  if (stageCode === 3) return 'Finalizado'
  if (stageAnchorTs === null) return '—' // dato inconsistente, red de seguridad
  const elapsed = Math.floor((now - stageAnchorTs) / 60)
  if (stageCode === 12) return elapsed > 45 ? '45+' : `${elapsed + 1}'`
  if (stageCode === 13) { const m = 45 + elapsed + 1; return m > 90 ? '90+' : `${m}'` }
  return '—'
}
```

Un `setInterval`/`requestAnimationFrame` liviano (1 tick por segundo, solo
mientras `stage_code` sea `12`/`13`, es decir con el reloj corriendo)
recalcula el label sin tocar la red — el número sube solo entre polls, y el
próximo poll simplemente confirma/corrige el ancla si hubo un cambio de
etapa (descanso, 2do tiempo, final). **Requisito explícito para
`supabase-backend-expert`**: exponer estos 3 campos crudos en
`monitored_matches`, no un string de minuto ya formateado — de lo contrario
esta sección no se puede implementar y el minuto queda congelado entre
polls.

### 1.5 "Actualizado hace..." y el estado "no se pudo actualizar" por partido

El feed de Flashscore es no oficial (`PLAN.md` sección 6.3, "uso no oficial
de feeds privados... puede romperse o rotar el token") — el cron server-side
va a fallar para algún partido puntual en algún momento, es una expectativa
razonable, no un caso extremo a ignorar. Se necesita reflejarlo sin
alarmar:

- Campos ilustrativos en `monitored_matches`: `last_polled_at` (cuándo fue
  el último intento, haya fallado o no) y `last_poll_ok` (boolean, o
  `last_poll_error_at` — a definir con `supabase-backend-expert`).
- **"Actualizado hace Ns/Nm"**: texto chico (`text-xs text-muted-foreground`)
  en la esquina de cada card, derivado de `last_polled_at` con un ticker de
  texto relativo (`src/lib/relativeTime.ts`, nuevo helper chico — no existe
  hoy en el proyecto un formateador de tiempo relativo corto tipo "hace
  18s"/"hace 3 min", los helpers de `src/lib/date.ts` son todos de fecha de
  calendario, no de duración transcurrida).
- **Si `last_poll_ok === false`** (o el timestamp de error es más reciente
  que el de éxito): una nota inline chica, tono **no alarmante** —
  `warning` (ámbar), nunca `destructive` (ese color queda reservado para
  errores reales de carga de la propia app, sección 3.7):

  ```html
  <p class="flex items-center gap-1.5 text-xs text-warning">
    <TriangleAlert class="size-3.5 shrink-0" />
    No pudimos actualizar este partido. Seguimos intentando.
  </p>
  ```

  - No pausa el monitoreo automáticamente (eso lo decide el backoff del
    cron, no la UI) ni bloquea el resto de la card (marcador/stats/legs
    siguen mostrando el último dato bueno conocido, con su propio
    "Actualizado hace..." que simplemente deja de avanzar).
  - Copy explícitamente no técnico ("seguimos intentando", no "error 429"/
    "feed no disponible") — mismo tono que el resto de mensajes de error de
    la app (`"No pudimos cargar tus gastos"`, nunca un mensaje de stack
    trace).

### 1.6 Incidencias (goles/tarjetas/cambios) — se muestran completas, no se reconstruyen

A diferencia de "solo el último snapshot" para el estado del partido, el
feed de incidencias de Flashscore (`df_su` en `PLAN.md` sección 2) devuelve
**la lista completa de eventos del partido hasta el momento** en cada
consulta — no hay que ir acumulando histórico propio. El backend puede
guardar ese array tal cual dentro del mismo snapshot (`monitored_matches
.incidents jsonb`, ilustrativo — reemplazado entero en cada poll, no una
tabla aparte que crece sin límite) y el frontend lo muestra como timeline
en el detalle (sección 4.4), sin ningún query adicional ni límite/paginación
propios (la cardinalidad de "eventos de un solo partido" es chica de sobra).

### 1.7 El estado de un leg del cupón también es siempre server-side

Mismo principio que 1.2, aplicado explícitamente a los legs: `won`/`lost`/
`pending`/`not_monitorable` es un campo que ya llega calculado
(`bet_slip_legs.status`, ilustrativo) — el equivalente al `BetRuleEngine`
de FottStat corre en el Edge Function/cron, evaluando cada leg contra el
snapshot más reciente en cada poll, con "decisión temprana" (mismo criterio
de `PLAN.md` sección 6.5: un "Más de 0.5 goles" se decide `won` apenas hay 1
gol total, sin esperar a que termine el partido). El frontend nunca
recalcula esto — solo pinta `status` con su ícono/color (sección 3.5/4.5).

### 1.8 Alta con foto de cupón: único flujo no optimista de la feature

**Justificación distinta a la de `DebtFormSheet`** (que era no-optimista por
una dependencia atómica de 2 inserts vía RPC): acá la razón es que el OCR
**requiere una llamada real a un Edge Function con la imagen**, cuyo
resultado (los legs extraídos) el usuario necesita ver y poder corregir
*antes* de que exista ninguna fila en la base — no hay nada que mostrar
optimistamente todavía, literalmente no hay dato hasta que el servidor
responde. Detalle completo del flujo en la sección 5.

El alta **sin foto** (solo partido elegido de la lista de búsqueda) sí
podría ser optimista en teoría (es un insert simple), pero se decide que
**también espere confirmación del servidor** antes de cerrar el Sheet, por
consistencia de un único
comportamiento predecible para todo el formulario (con foto o sin foto, el
usuario ve el mismo tipo de botón "Guardando..." y el mismo momento de
cierre) — evita tener dos ramas de UX distintas en el mismo componente para
una diferencia que el usuario no percibe como relevante (la latencia de un
insert simple es imperceptible de por sí). Igual que con `CategoryFormSheet`
en su momento, si esto se sintiera lento en producción es un ajuste
reversible sin rediseño.

### 1.9 Guard de borrado de un partido: ninguno

Igual que borrar un hilo de deuda completo (`debts-ux.md` sección 1.5/6.5):
quitar un partido monitoreado no tiene ningún otro recurso que lo
referencie (sus legs son hijos propios, se borran en cascada) — es
equivalente a borrar un gasto propio, no un recurso de clasificación
compartido. `AlertDialog` de confirmación simple (sección 3.5), sin conteo
dedicado.

### 1.10 Nota abierta, no resuelta acá: crecimiento de "Finalizados" sin límite

A diferencia de `expenses`/`card_expenses` (que si crecen sin límite y ya
tienen su estrategia de acotar por fecha), la lista de partidos **no tiene
hoy ningún mecanismo de limpieza automática** — si el usuario nunca quita un
partido finalizado, se acumula indefinidamente. Como la cardinalidad
absoluta sigue siendo chica comparada con una tabla de movimientos (un
usuario activo sigue, optimistamente, unas pocas decenas de partidos por
temporada, no miles), esto **no es un problema de seguridad de datos** como
el de `MAX_EXPENSES` — es un problema de **ruido visual** a mediano plazo.
Se mitiga en la sección 3.4 (agrupado, finalizados al final) pero **se deja
como pregunta abierta para el Product Owner** (ver sección 10) si vale la
pena un archivado/limpieza automática a futuro (p. ej. "ocultar
finalizados de hace más de 7 días" con opción de deshacer) — no se decide
unilateralmente acá.

### 1.11 Nota nueva: la búsqueda de partidos (paso 1 del alta) no necesita ninguna heurística de seguridad de datos

A diferencia de todas las cardinalidades de arriba (que son tablas propias
de Supabase), el buscador de partidos del paso 1 del alta (sección 5.1) no
consulta ninguna tabla del usuario — es un proxy delgado sobre el feed
externo de Flashscore vía la Edge Function `search-matches`, acotado por
diseño del propio contrato: un `dayOffset` fijo (0 a 3) por llamada, nunca
"todo el feed". No hay ningún equivalente a `MAX_EXPENSES`/rango de fecha
que diseñar acá — el límite ya lo impone la forma del request, no una
convención del frontend.

---

## 2. Arquitectura de rutas: 2 rutas, mismo ejercicio de calibración que Tarjetas(4)/Cuentas(1)/Deudas(3)

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/partidos` | `matches` | `{ requiresAuth: true }` | `LiveMatchesView` |
| `/partidos/:id` | `match-detail` | `{ requiresAuth: true }` | `MatchDetailView` |

**No alcanza con 1 ruta** (como Cuentas): el encargo pide explícitamente un
timeline completo de incidencias, el detalle completo de cada leg (mercado +
umbral + estado, no solo un ícono resumen) y acciones de gestión — meter eso
en la misma pantalla que la lista de cards sobrecargaría el dashboard, mismo
argumento exacto que ya usó `debts-ux.md` sección 2 para justificar
`/deudas/:id`.

**No hace falta una 3ra ruta de gestión** (como `/tarjetas/gestionar` o
`/deudas/personas`): acá no hay una segunda entidad propia que administrar
— no hay "equipos"/"ligas"/"personas" del usuario, cada partido es
autosuficiente (se identifica por su `matchId` de Flashscore, resuelto al
elegirlo de un buscador/listado — sección 5.1 —, no por una entidad creada
de antemano). El alta vive en un Sheet accesible desde el propio
dashboard (sección 5), igual que Deudas resuelve su alta sin ruta
intermedia (`debts-ux.md` sección 3.10).

Sin colisión de segmento literal-vs-dinámico (mismo caso que la versión
original de Deudas, sección 2 de `debts-ux.md`) — no hace falta orden
especial de declaración en el array de rutas.

---

## 3. `/partidos` — Dashboard

Header simple, mismo patrón de segundo nivel que el resto de la app:

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'home' })">
    <ArrowLeft class="size-5" />
  </Button>
  <h1 class="text-xl font-semibold">Partidos en vivo</h1>
</header>
```

### 3.1 Orden de secciones en el `<main>`

1. Banner de permiso de notificaciones (condicional, sección 6.1).
2. Nota de limitación iOS (condicional, sección 6.4) — si el banner de
   notificaciones ya se mostró/descartó, esta nota puede vivir sola, más
   chica.
3. Lista de partidos, agrupada (sección 3.4).
4. FAB "Agregar partido" (sección 3.6), persistente sobre todo lo anterior.

### 3.2 Banner de notificaciones y nota iOS

Ver especificación completa en sección 6.1/6.4 — acá solo la ubicación:
`Card` chica con borde `border-primary/30 bg-primary/5` (mismo tratamiento
visual que ya usan las cards resumen de Deudas para "llamar la atención sin
usar destructive/warning", adaptado a `primary` porque esto no es ni bueno
ni malo, es una invitación neutra), colapsable/descartable con una `X` en la
esquina.

### 3.3 Por qué la lista NO usa `Tabs` para separar por estado

Se evaluó explícitamente (dado que `Tabs` ya es un componente instalado
desde Deudas, sección 3.4 de `debts-ux.md`) usar pestañas "En vivo" /
"Pausados" / "Finalizados", **y se descarta**: `Tabs` en este proyecto se
reserva para paneles de contenido genuinamente independientes que el
usuario elige mirar exclusivamente uno a la vez (ya distinguido de
`radiogroup` en `debts-ux.md` sección 3.4). Acá el caso es distinto — un
usuario mirando en vivo un partido probablemente quiere ver **todo su
panorama de un vistazo** (¿hay algo pasando ahora en cualquiera de mis
partidos?), no elegir activamente una pestaña y perder de vista el resto.
Ocultar los partidos en vivo detrás de una pestaña que no es la
seleccionada sería lo opuesto al propósito de la feature.

**Se usa, en cambio, el mismo patrón ya establecido de lista agrupada por
encabezados de sección** que `TransactionsView`/`HomeView` ya usan para
agrupar por fecha ("Hoy"/"Ayer"/fecha) — acá agrupando por estado en vez de
por fecha, mismo lenguaje visual (`<p class="px-4 pt-4 pb-2 text-xs
font-medium uppercase tracking-wide text-muted-foreground">`), sin
esconder nada, todo visible en un solo scroll:

1. **"En vivo y por empezar"** (`state IN ('scheduled', 'monitoring')` con
   partido no finalizado) — arriba, es lo más urgente.
2. **"Pausados"** — solo si hay al menos uno.
3. **"Finalizados"** — al final, siempre visible pero al fondo del scroll
   (mitigación de la nota 1.10: no se oculta, pero no compite por atención
   con lo que sí está pasando ahora).

Dentro de cada grupo, orden: partidos en vivo corriendo (`stage_code` 12/13)
primero, ordenados por el que tuvo el cambio más reciente
(`last_polled_at`/campo de "último cambio real" a confirmar con backend);
"por empezar" después, ordenados por hora de inicio más próxima.

### 3.4 Diseño de la card de partido

**Decisión de estructura, importante para a11y**: la card **no es un único
`<button>` que envuelve todo** (a diferencia de `cardsRanking`/filas de
hilos de deuda) — acá conviven dos necesidades que no pueden anidarse
válidamente en HTML: "tocar la card navega al detalle" y "hay un menú de
acciones (pausar/reanudar/quitar) dentro de la misma card". Un `<button>`
no puede contener otro `<button>` interactivo (el trigger del
`DropdownMenu`) sin romper semántica/foco. Se resuelve con la card como
contenedor **no interactivo** (`<Card>` a secas) que aloja dos zonas
interactivas **hermanas**, no anidadas: un botón que envuelve la región de
marcador/equipos/estado (navega al detalle) y, aparte, un ícono `⋮` de menú
en la esquina — mismo criterio que ya separa, en otras pantallas, "fila
clickeable de solo navegación" (`cardsRanking`) de "fila con menú, sin
navegación" (filas de `CardTransactionsView`): acá se necesitan ambas cosas
a la vez, así que se separan espacialmente en vez de forzarlas a convivir
en un único elemento interactivo.

```html
<Card class="overflow-hidden">
  <!-- Fila superior: competición + menú de acciones -->
  <div class="flex items-center justify-between gap-2 px-4 pt-3">
    <p class="truncate text-xs font-medium text-muted-foreground">
      {{ match.competition ?? 'Partido' }}
    </p>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" aria-label="Más opciones" class="-mr-2 size-9">
          <EllipsisVertical class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @select="toggleMonitoring(match)">
          <component :is="match.state === 'paused' ? Play : Pause" class="size-4" />
          {{ match.state === 'paused' ? 'Reanudar' : 'Pausar' }}
        </DropdownMenuItem>
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
              <Trash2 class="size-4" />
              Quitar partido
            </DropdownMenuItem>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Quitar "{{ match.homeTeam }} vs. {{ match.awayTeam }}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Dejamos de monitorear este partido. Si tenía un cupón asociado, también se quita. Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction @click="removeMatch(match)">Quitar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  <!-- Región clickeable: navega al detalle -->
  <button
    type="button"
    class="flex w-full flex-col gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    @click="router.push({ name: 'match-detail', params: { id: match.id } })"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <p class="truncate text-sm font-medium">{{ match.homeTeam }}</p>
        <p class="truncate text-sm font-medium">{{ match.awayTeam }}</p>
      </div>
      <div class="flex flex-col items-end gap-0.5 tabular-nums">
        <p class="text-lg font-bold">{{ match.homeScore }}</p>
        <p class="text-lg font-bold">{{ match.awayScore }}</p>
      </div>
      <div class="flex w-20 shrink-0 flex-col items-end gap-1">
        <span
          v-if="isLive(match)"
          class="flex items-center gap-1 text-sm font-semibold text-primary"
        >
          <Radio class="size-3 animate-pulse" />
          {{ clockLabel(match) }}
        </span>
        <Badge v-else variant="secondary" class="text-[10px]">{{ clockLabel(match) }}</Badge>
      </div>
    </div>

    <!-- Stats clave, sección 3.5 -->
    <MatchStatsRow :match="match" />

    <!-- Resumen de cupón, sección 3.5 -->
    <MatchLegsSummary v-if="match.legs.length > 0" :legs="match.legs" />
  </button>

  <!-- Pie: estado de actualización, sección 1.5 -->
  <div class="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
    <p class="text-xs text-muted-foreground">Actualizado {{ relativeTime(match.lastPolledAt) }}</p>
    <Badge :variant="stateBadgeVariant(match.state)" class="text-[10px]">{{ stateLabel(match.state) }}</Badge>
  </div>
  <p v-if="!match.lastPollOk" class="flex items-center gap-1.5 border-t border-border px-4 py-2 text-xs text-warning">
    <TriangleAlert class="size-3.5 shrink-0" />
    No pudimos actualizar este partido. Seguimos intentando.
  </p>
</Card>
```

Notas de la card:

- **Marcador siempre en dos líneas apiladas** (local arriba, visitante
  abajo), nunca `"2 - 1"` en una sola línea — mismo criterio que la
  referencia de FottStat (Android) y que evita ambigüedad de cuál número es
  de cuál equipo sin tener que mirar dos columnas separadas.
- **`isLive(match)`**: `true` si `stage_code` es `12` o `13` (tiempo
  corriendo). El indicador combina color (`text-primary`, **no**
  `destructive` — ver justificación en sección 8) + ícono `Radio` con
  `animate-pulse` + el minuto en texto, nunca solo el color ni solo el
  pulso (regla de a11y de siempre: nunca color como único indicador).
  `prefers-reduced-motion: reduce` debe anular `animate-pulse` (Tailwind ya
  lo respeta si se usa la utilidad estándar, no una animación custom).
- **Estados sin pulso** ("Empieza HH:MM", "Descanso", "Finalizado"):
  `Badge variant="secondary"`, texto siempre explícito (nunca solo un
  ícono de reloj).
- `stateBadgeVariant`/`stateLabel`: `monitoring` → `variant="default"`
  "Monitoreando"; `paused` → `variant="outline"` "Pausado"; `finished` →
  `variant="secondary"` "Finalizado" — el badge de estado de **monitoreo**
  (pie de la card) es un concepto distinto del badge de **minuto/etapa del
  partido** (arriba a la derecha): un partido puede estar "Finalizado" en
  cancha y "Pausado" en el monitoreo (el usuario lo pausó antes de que
  terminara) — ambos badges coexisten sin ser redundantes.

### 3.5 Sub-componentes de la card: stats y resumen de cupón

`MatchStatsRow.vue` (nuevo, chico, sin estado propio) — fila compacta de
íconos, mismo criterio de "nunca solo color" con texto tabular al lado de
cada ícono:

```html
<div class="grid grid-cols-5 gap-2 rounded-md bg-muted/50 px-2 py-2 text-xs">
  <div class="flex flex-col items-center gap-0.5" title="Córners">
    <Flag class="size-3.5 text-muted-foreground" />
    <span class="tabular-nums font-medium">{{ match.cornersHome }}-{{ match.cornersAway }}</span>
  </div>
  <div class="flex flex-col items-center gap-0.5" title="Remates a puerta">
    <Target class="size-3.5 text-muted-foreground" />
    <span class="tabular-nums font-medium">{{ match.shotsOnTargetHome }}-{{ match.shotsOnTargetAway }}</span>
  </div>
  <div class="flex flex-col items-center gap-0.5" title="Ocasiones claras">
    <Sparkles class="size-3.5 text-muted-foreground" />
    <span class="tabular-nums font-medium">{{ match.clearChancesHome }}-{{ match.clearChancesAway }}</span>
  </div>
  <div class="flex flex-col items-center gap-0.5" title="Tarjetas amarillas">
    <span class="h-3.5 w-2.5 rounded-[2px] bg-warning" aria-hidden="true" />
    <span class="tabular-nums font-medium">{{ match.yellowCardsHome }}-{{ match.yellowCardsAway }}</span>
  </div>
  <div class="flex flex-col items-center gap-0.5" title="Tarjetas rojas">
    <span class="h-3.5 w-2.5 rounded-[2px] bg-destructive" aria-hidden="true" />
    <span class="tabular-nums font-medium">{{ match.redCardsHome }}-{{ match.redCardsAway }}</span>
  </div>
</div>
```

- Las 5 stats clave del encargo, en el orden pedido. `title="..."` da un
  tooltip nativo en desktop; para mobile/lector de pantalla cada ícono va
  acompañado de un `<span class="sr-only">` con el nombre completo antes
  del número (omitido del snippet por brevedad, obligatorio en la
  implementación — ver checklist de a11y sección 9).
- **Los cuadraditos de tarjeta amarilla/roja reusan literalmente
  `warning`/`destructive`** en vez de un ícono — única reutilización
  semántica de esos tokens fuera de su uso financiero original, y está
  justificada porque acá el color **no es una metáfora** (no representa
  "cerca del límite de presupuesto"), es **el color real de una tarjeta de
  fútbol** — amarillo y rojo ya son, en el propio dominio, exactamente lo
  que esos tokens visualmente representan. Es una coincidencia feliz entre
  el vocabulario de color del design system y el vocabulario del dominio
  nuevo, no una expansión arbitraria de su significado — se documenta
  explícitamente para que quede claro que es intencional, no un descuido
  de "encontré un color que quedaba lindo".
- `Sparkles` para "ocasiones claras" — no hay un ícono futbolístico
  literal para esto en `@lucide/vue`; `Sparkles` comunica "momento
  destacado/de riesgo" sin ser engañoso (confirmado en
  `node_modules/@lucide/vue/dist/esm/icons/sparkles.mjs`).

`MatchLegsSummary.vue` (nuevo, chico) — resumen compacto de los 4 estados
posibles, solo si `match.legs.length > 0`:

```html
<div class="flex items-center gap-3 text-xs">
  <span v-if="wonCount > 0" class="flex items-center gap-1 text-success"><CircleCheck class="size-3.5" />{{ wonCount }}</span>
  <span v-if="lostCount > 0" class="flex items-center gap-1 text-destructive"><CircleX class="size-3.5" />{{ lostCount }}</span>
  <span v-if="pendingCount > 0" class="flex items-center gap-1 text-muted-foreground"><Clock class="size-3.5" />{{ pendingCount }}</span>
  <span v-if="notMonitorableCount > 0" class="flex items-center gap-1 text-muted-foreground"><CircleDashed class="size-3.5" />{{ notMonitorableCount }}</span>
  <span class="ml-auto text-muted-foreground">{{ legs.length }} selecc.</span>
</div>
```

Detalle completo de cada leg (mercado, umbral, texto original) vive
**únicamente** en el detalle (sección 4.5) — acá es un resumen de conteos,
mismo criterio de "la card es panorama, el detalle es gestión/lectura
completa" ya usado en toda la app.

### 3.6 FAB "Agregar partido"

Mismo patrón que el resto de listados con alta frecuente: `size-14
rounded-full shadow-[var(--shadow-elevated)]`, `env(safe-area-inset-bottom)`,
abre `MatchFormSheet` (sección 5).

```html
<button
  type="button"
  aria-label="Agregar partido"
  class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
  style="margin-bottom: env(safe-area-inset-bottom)"
  @click="openAddMatchSheet"
>
  <Plus class="size-6" />
</button>
```

### 3.7 Estados de carga/vacío/error

- **Carga**: 3 `Skeleton` de card (mismo alto aproximado que una card real
  con stats) mientras resuelve la query inicial.
- **Error** (falla la carga inicial de la lista, no un partido puntual —
  ver 1.5 para el caso de un partido puntual): mismo bloque de siempre,
  `AlertCircle` + "No pudimos cargar tus partidos" + `Reintentar`.
- **Vacío** (usuario sin ningún partido seguido): bloque centrado, ícono
  `Goal` `size-12 text-muted-foreground`, título "Todavía no estás
  siguiendo ningún partido.", subtexto "Buscá un partido por equipo para
  ver sus estadísticas en vivo y recibir avisos.", botón "Agregar partido"
  → abre `MatchFormSheet` directo (sin ruta intermedia, mismo criterio que
  el vacío de Deudas).

---

## 4. `/partidos/:id` — Detalle de un partido

Header simplificado, mismo criterio que `CardDetailView` (`credit-cards-ux.md`
sección 4): solo `ArrowLeft`, sin repetir el nombre del partido en el header
(vive en el hero). Se agrega un botón de enlace externo, único caso de la
app que linkea fuera de sí misma:

```html
<header class="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
  <Button variant="ghost" size="icon" aria-label="Volver" @click="router.push({ name: 'matches' })">
    <ArrowLeft class="size-5" />
  </Button>
  <span class="flex-1" />
  <a
    :href="match.flashscoreUrl"
    target="_blank"
    rel="noopener noreferrer"
    class="flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  >
    Ver en Flashscore
    <ExternalLink class="size-4" />
  </a>
</header>
```

`target="_blank"` con `rel="noopener noreferrer"` (buena práctica estándar,
no específica de este proyecto) — abre la fuente original para el usuario
que quiera ver el detalle nativo de Flashscore (video, alineaciones, etc.)
que TipApp no replica.

### 4.1 Hero: marcador grande + estado + acciones completas

Mismo contenido que la región clickeable de la card (sección 3.4) pero a
tamaño completo, sin el envoltorio `<button>` (ya se llegó acá navegando):

```html
<Card>
  <CardHeader class="gap-3">
    <p class="text-xs font-medium text-muted-foreground">{{ match.competition ?? 'Partido' }}</p>
    <div class="flex items-center justify-between gap-3">
      <div class="flex flex-1 flex-col gap-1">
        <p class="text-base font-semibold">{{ match.homeTeam }}</p>
        <p class="text-base font-semibold">{{ match.awayTeam }}</p>
      </div>
      <div class="flex flex-col items-end gap-1 tabular-nums">
        <p class="text-3xl font-bold">{{ match.homeScore }}</p>
        <p class="text-3xl font-bold">{{ match.awayScore }}</p>
      </div>
    </div>
    <div class="flex items-center justify-between">
      <span v-if="isLive(match)" class="flex items-center gap-1.5 text-base font-semibold text-primary">
        <Radio class="size-4 animate-pulse" />
        {{ clockLabel(match) }}
      </span>
      <Badge v-else variant="secondary">{{ clockLabel(match) }}</Badge>
      <Badge :variant="stateBadgeVariant(match.state)">{{ stateLabel(match.state) }}</Badge>
    </div>
  </CardHeader>

  <div class="flex gap-2 border-t border-border px-6 py-4">
    <Button variant="outline" class="flex-1" @click="toggleMonitoring(match)">
      <component :is="match.state === 'paused' ? Play : Pause" class="size-4" />
      {{ match.state === 'paused' ? 'Reanudar' : 'Pausar' }}
    </Button>
    <AlertDialog>
      <AlertDialogTrigger as-child>
        <Button variant="outline" class="flex-1 text-destructive hover:text-destructive">
          <Trash2 class="size-4" />
          Quitar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent><!-- mismo contenido que sección 3.4 --></AlertDialogContent>
    </AlertDialog>
  </div>

  <p v-if="!match.lastPollOk" class="flex items-center gap-1.5 border-t border-border px-6 py-3 text-sm text-warning">
    <TriangleAlert class="size-4 shrink-0" />
    No pudimos actualizar este partido. Seguimos intentando.
  </p>
  <p class="border-t border-border px-6 py-2 text-xs text-muted-foreground">
    Actualizado {{ relativeTime(match.lastPolledAt) }}
  </p>
</Card>
```

Acá **sí** son botones completos (no un `DropdownMenu`) porque es la
pantalla de gestión dedicada de este partido puntual — mismo criterio de
"la card resume, el detalle gestiona con controles explícitos" que ya usa
el resto de la app (p. ej. editar/borrar de una categoría vive en su propio
flujo, no detrás de un ícono chico, cuando hay espacio de sobra para
botones con texto).

### 4.2 Stats completas

Mismo `MatchStatsRow` de la sección 3.5, pero a tamaño más generoso
(`text-sm`, íconos `size-4`) dentro de su propia `Card` con título
"Estadísticas", y con el nombre completo de cada stat como texto visible al
lado del ícono (no solo `title=`, acá hay espacio de sobra):

```html
<Card>
  <CardHeader><CardTitle class="text-base font-semibold">Estadísticas</CardTitle></CardHeader>
  <div class="flex flex-col gap-3 px-6 pb-6">
    <div v-for="stat in statsRows" :key="stat.key" class="flex items-center gap-3 text-sm">
      <span class="w-8 text-right font-semibold tabular-nums">{{ stat.home }}</span>
      <div class="flex flex-1 items-center justify-center gap-1.5 text-muted-foreground">
        <component :is="stat.icon" class="size-4" />
        <span class="text-xs">{{ stat.label }}</span>
      </div>
      <span class="w-8 font-semibold tabular-nums">{{ stat.away }}</span>
    </div>
  </div>
</Card>
```

Layout "número — ícono+label — número" (equipo local a la izquierda, mismo
lado que el marcador del hero) en vez de la grilla `grid-cols-5` compacta de
la card — acá hay ancho de sobra y el layout de comparación directa
(izquierda vs. derecha) es más legible para 5 filas que para una fila
horizontal de 5 columnas.

### 4.3 Timeline de incidencias

Solo si `match.incidents.length > 0` (ver 1.6 — dato ya vino completo del
servidor, no se pide nada nuevo):

```html
<Card>
  <CardHeader><CardTitle class="text-base font-semibold">Incidencias</CardTitle></CardHeader>
  <div class="flex flex-col">
    <template v-for="(incident, idx) in match.incidents" :key="idx">
      <Separator v-if="idx > 0" />
      <div class="flex items-center gap-3 px-4 py-3">
        <span class="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-muted-foreground">{{ incident.minuteLabel }}</span>
        <component :is="incidentIcon(incident.type)" class="size-4 shrink-0" :class="incidentIconClass(incident.type)" />
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="truncate text-sm font-medium">{{ incidentLabel(incident) }}</p>
          <p v-if="incident.player" class="truncate text-xs text-muted-foreground">{{ incident.player }} · {{ incident.team === 'home' ? match.homeTeam : match.awayTeam }}</p>
        </div>
      </div>
    </template>
  </div>
</Card>
```

- `incidentIcon`/`incidentIconClass`: gol → `Goal`/`text-primary`; tarjeta
  amarilla → cuadradito `bg-warning` (mismo criterio literal de 3.5);
  tarjeta roja → cuadradito `bg-destructive`; cambio → `Repeat` (confirmar
  ícono, no crítico); gol en contra → mismo ícono de gol pero con un
  `title`/texto aclaratorio "(en contra)" en `incidentLabel`, atribuido al
  equipo que se benefició (mismo criterio de `IG`/`IH` de `PLAN.md`
  sección 2: el gol se acredita al rival, nunca al equipo del jugador que
  se lo metió).
- Orden cronológico tal como llega del backend (ya viene ordenado por
  periodo/minuto, `PLAN.md` sección 2) — el frontend no reordena.
- Si `match.incidents` está vacío pero el partido ya arrancó: no se muestra
  la Card completa (nada que listar todavía) — mismo criterio de "ocultar
  la sección entera cuando no hay nada que graficar/listar" ya usado en
  Deudas (sección 3.8 de `debts-ux.md`) y Tarjetas.

### 4.4 Legs del cupón — detalle completo

Solo si `match.legs.length > 0`. A diferencia del resumen de conteos de la
card (sección 3.5), acá se muestra **cada leg individual** con su texto
completo:

```html
<Card>
  <CardHeader><CardTitle class="text-base font-semibold">Tu cupón</CardTitle></CardHeader>
  <div class="flex flex-col">
    <template v-for="(leg, idx) in match.legs" :key="leg.id">
      <Separator v-if="idx > 0" />
      <div class="flex items-start gap-3 px-4 py-3">
        <component :is="legStatusIcon(leg.status)" class="size-5 shrink-0" :class="legStatusClass(leg.status)" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <p class="text-sm font-medium">{{ leg.selectionLabel }}</p>
          <p class="text-xs text-muted-foreground">{{ leg.marketLabel }}</p>
        </div>
        <Badge :variant="legStatusBadgeVariant(leg.status)" class="shrink-0 text-[10px]">{{ legStatusLabel(leg.status) }}</Badge>
      </div>
    </template>
  </div>
</Card>
```

- `legStatusIcon`/`legStatusClass`: `won` → `CircleCheck`/`text-success`;
  `lost` → `CircleX`/`text-destructive`; `pending` → `Clock`/
  `text-muted-foreground`; `not_monitorable` → `CircleDashed`/
  `text-muted-foreground`.
- `legStatusLabel`: "Ganado" / "Perdido" / "Pendiente" / "No monitoreable".
  `legStatusBadgeVariant`: `won`→`default` con clase de color success
  custom (o `outline` + texto `text-success`, a definir por
  `vue-frontend-expert` según qué tan fácil sea reusar `Badge` con un color
  no estándar — no es una decisión de UX crítica, ambas opciones cumplen
  "nunca solo color").
- `leg.marketLabel`/`leg.selectionLabel`: texto ya resuelto por el backend
  (p. ej. `selectionLabel = "1X"`, `marketLabel = "Doble oportunidad"`, o
  `selectionLabel = "Más de 2.5"`, `marketLabel = "Goles totales"`) — el
  frontend no arma esas strings a partir de un enum + umbral, las recibe
  ya formateadas (mismo principio de 1.7: toda la lógica de dominio vive en
  el backend). Para mercados `not_monitorable`, `marketLabel` puede ser el
  texto crudo leído por OCR tal cual (p. ej. "Total de tiros de esquina" si
  no matcheó ningún mercado conocido) — se muestra igual, nunca se oculta
  (punto 4 del encargo).
- Para "ambos marcan 1ª parte" específicamente: el copy de `marketLabel`
  debe decir explícitamente "1ª parte" (nunca solo "Ambos marcan" a secas)
  para no confundirlo con el mercado de partido completo — responsabilidad
  del backend al armar el label, anotado acá para que no se pierda en la
  implementación.

### 4.5 Estados de carga/error

- **Carga**: `Skeleton` del hero + 2 bloques (mismo criterio que el resto).
- **Error**: si falla la carga puntual de este partido (no la lista),
  mismo bloque `AlertCircle` + "No pudimos cargar este partido" +
  `Reintentar`, con un botón adicional "Volver" (`router.push({ name:
  'matches' })`) por si el error persiste y el usuario prefiere volver al
  panorama.
- Si el `id` de la ruta no corresponde a ningún partido del usuario
  (borrado desde otra sesión, o URL manipulada): mismo bloque de error, sin
  distinguir "no existe" de "no es tuyo" en el copy (mismo criterio de no
  filtrar información de existencia de recursos ajenos, aunque acá no hay
  ningún dato sensible de terceros involucrado — es simple consistencia).

---

## 5. Alta de partido — `MatchFormSheet.vue` (nuevo, primer Sheet "wizard" del proyecto)

**Primera vez que un Sheet de esta app tiene más de un paso interno** — se
declara explícitamente como patrón nuevo (mismo criterio de transparencia
que ya se usó para "primer uso de `Tabs`"/"primer toggle real con
`Switch`"). Justificación de por qué sigue siendo un Sheet y no una ruta
dedicada tipo wizard de pantalla completa: es la misma alta rápida y
puntual que el resto de "agregar X" de la app (gasto, deuda, cuenta) — el
hecho de que tenga pasos internos no cambia su naturaleza de "tarea corta,
se abre, se completa, se cierra", que es exactamente el criterio que ya
usa el proyecto para decidir Sheet vs. ruta (`categories-mvp-ux.md` sección
4: ruta dedicada es para *gestión de baja frecuencia*, no para altas
puntuales).

Estado interno: `step: 'form' | 'processing' | 'review'`.

### 5.1 Paso 1 — `step === 'form'`: buscar y elegir un partido

**Reemplaza por completo el campo de URL pegada.** El paso 1 pasa a ser un
buscador de partidos en vivo/por jugar contra la Edge Function nueva
`search-matches` (contrato ya fijado por `supabase-backend-expert`:
`{ dayOffset: 0-3, query?: string }` → `{ matches: [{ matchId, homeTeam,
awayTeam, league, kickoffAt, status: 'upcoming' | 'live' }] }`, nunca
partidos finalizados). El usuario ya no pega ni valida ningún link — elige
un partido de una lista, y ese `matchId`/`homeTeam`/`awayTeam`/`league` ya
resueltos quedan guardados en `form` para el alta final. **Primera vez que
el proyecto necesita debounce en un input de búsqueda** (no hay precedente
hoy — todos los inputs de texto existentes validan en submit o en cada
tecla sin debounce): se define **350ms**, punto medio del rango sugerido,
igual de rápido para no sentirse "trabado" que lento para no disparar una
llamada de red por cada tecla.

Estado interno nuevo de este paso (dentro del mismo `step === 'form'`, sin
agregar un `step` más): `form.selectedMatch: SearchMatch | null`. Mientras
es `null` se muestra el buscador/lista; en cuanto el usuario toca un
partido, la pantalla cambia a un resumen del partido elegido + el mismo
bloque de foto opcional que ya existía — ver 5.1.4.

**5.1.1 — Buscador + selector de día (mientras `selectedMatch === null`)**

```html
<SheetContent side="bottom">
  <SheetHeader>
    <SheetTitle>Nuevo partido</SheetTitle>
    <SheetDescription>Buscá un partido en vivo o por jugar para empezar a seguirlo.</SheetDescription>
  </SheetHeader>

  <div class="flex flex-col gap-3 px-4">
    <div class="relative">
      <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        v-model="searchQuery"
        type="search"
        inputmode="search"
        placeholder="Buscar equipo..."
        class="pl-9"
        aria-label="Buscar equipo"
      />
    </div>

    <div role="radiogroup" aria-label="Día" class="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
      <button
        v-for="option in dayOptions"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="dayOffset === option.value"
        class="flex min-h-9 items-center justify-center rounded-md px-1 py-1.5 text-center text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :class="dayOffset === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        @click="selectDay(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>

  <!-- Lista de resultados, sección 5.1.3/5.1.5 -->
  <div class="mt-1 max-h-[45vh] overflow-y-auto overscroll-contain border-t border-border" aria-live="polite">
    <!-- ... filas o estados de carga/vacío/error ... -->
  </div>

  <SheetFooter>
    <Button type="button" variant="outline" @click="closeSheet">Cancelar</Button>
  </SheetFooter>
</SheetContent>
```

- `dayOptions`: `[{ value: 0, label: 'Hoy' }, { value: 1, label: 'Mañana' },
  { value: 2, label: 'Pasado mañana' }, { value: 3, label: 'En 3 días' }]`
  — el texto envuelve naturalmente a 2 líneas dentro de cada celda angosta
  (`leading-tight text-[11px]`, sin `truncate`), no hace falta abreviar más
  el copy.
- **Selector de día: 4 botones tipo pastilla dentro de un contenedor
  `bg-muted`/`role="radiogroup"`, el mismo lenguaje visual que el segmented
  control de tema de Ajustes (`theme-toggle-ux.md`) — no `Tabs`.** Se
  evaluó explícitamente `Tabs` (ya instalado desde Deudas) y se descarta acá
  por dos motivos, distintos del motivo que ya descartó `Tabs` para el
  propio dashboard de partidos (sección 3.3, que sigue vigente sin cambios
  — ese es un caso distinto, "no ocultar nada detrás de una pestaña"):
  primero, el `TabsList` de shadcn-vue trae más peso visual (padding y
  chrome propios) del que conviene dentro de un Sheet `side="bottom"` que ya
  compite por altura con el teclado virtual abierto por el buscador; segundo,
  a diferencia de los `Tabs` de Deudas (que separan bloques de contenido con
  forma distinta — cards de resumen, historial), acá el día no cambia la
  *forma* de lo que se ve, solo filtra la misma lista por fecha — es
  conceptualmente más un filtro de una sola dimensión que un cambio de
  panel, y el segmented control ya es el patrón que el proyecto usa para
  "elegir una de N opciones chicas y ver el resultado inmediatamente al
  lado" (mismo criterio literal de Ajustes).
- Cambiar de día dispara un refetch **inmediato**, sin debounce (es un tap
  discreto, no texto tecleado) — el debounce de 350ms aplica **solo** al
  campo de búsqueda. Si `searchQuery.trim().length < 2`, se llama a
  `search-matches` sin `query` (según el contrato, el filtro de equipo
  requiere 2+ caracteres) — el frontend no espera a llegar a 2 caracteres
  para mostrar la lista completa del día, la pide igual desde el primer
  render de cada día.
- El buscador es `type="search"` (no `type="text"`), consistente con su
  propósito semántico y con la `X` nativa de limpiado que el navegador ya
  agrega a este tipo de input en mobile — sin reinventar un botón de limpiar
  propio.

**5.1.2 — Fila de partido**

Mismo lenguaje visual que la card del dashboard (sección 3.4: equipos
apilados local/visitante en dos líneas, nunca en una sola línea), pero acá
**sí puede ser un único `<button>`** — a diferencia de la card del
dashboard, no convive ningún menú de acciones dentro de la fila, es una
lista de selección pura:

```html
<button
  v-for="result in searchResults"
  :key="result.matchId"
  type="button"
  class="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
  :disabled="isAlreadyFollowed(result)"
  @click="selectMatch(result)"
>
  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    <p class="truncate text-sm font-medium">{{ result.homeTeam }}</p>
    <p class="truncate text-sm font-medium">{{ result.awayTeam }}</p>
    <p v-if="result.league" class="truncate text-xs text-muted-foreground">{{ result.league }}</p>
  </div>
  <div class="flex shrink-0 flex-col items-end gap-1">
    <span v-if="result.status === 'live'" class="flex items-center gap-1 text-sm font-semibold text-primary">
      <Radio class="size-3 animate-pulse" />
      En vivo
    </span>
    <Badge v-else variant="secondary" class="text-[10px]">{{ formatKickoffTime(result.kickoffAt) }}</Badge>
    <Badge v-if="isAlreadyFollowed(result)" variant="outline" class="text-[10px] text-muted-foreground">
      Ya lo seguís
    </Badge>
  </div>
</button>
```

- Equipos apilados igual que en toda la app, **sin marcador** (todavía no
  existe la fila en `live_matches`, no hay nada que mostrar ahí) — el
  espacio que ocuparía el marcador en la card del dashboard queda libre acá.
- `league` como subtítulo chico debajo de los equipos (no se agrupa
  visualmente la lista por liga) — mismo criterio que la sección 3.6 del
  documento ya dejó anotado ("agrupar por liga no es estrictamente
  necesario"): con `dayOffset` ya acotando la lista a un solo día, el
  volumen esperado por búsqueda es chico, un subtítulo alcanza para dar
  contexto sin la complejidad de encabezados de grupo.
- `status === 'live'` usa el mismo patrón exacto de 3.4 (`Radio` +
  `animate-pulse` + `text-primary`, nunca solo el color/pulso); `upcoming`
  muestra la hora local de kickoff (`formatKickoffTime`, `HH:MM`) en un
  `Badge variant="secondary"`, mismo tratamiento que los estados sin pulso
  de 3.4.
- `formatKickoffTime`: reusa el mismo criterio de formato horario que ya
  usa `matchClockLabel` (sección 1.4) para "Empieza HH:MM" — no un helper
  nuevo, solo formatear `kickoffAt` (ISO) a hora local `HH:MM`.

**5.1.3 — Partido ya seguido: fila deshabilitada, no falla reactivamente**

`isAlreadyFollowed(result)` chequea `liveMatchesStore.matches.some(match =>
match.flashscore_mid === result.matchId)` — mismo dato ya en memoria por la
cardinalidad chica de 1.1, sin ningún viaje extra al servidor. Se resuelve
con **fila deshabilitada de antemano + badge "Ya lo seguís"**, no tappable,
mismo criterio ya usado en el proyecto para "Eliminar" en tarjetas/personas
con gastos asociados (`credit-cards-ux.md`, deshabilitar de antemano en vez
de fallar reactivamente al confirmar): la fila baja su opacidad
(`disabled:opacity-50`), pierde el `hover:bg-accent` y el badge queda
siempre visible (nunca se oculta el partido de la lista, solo se bloquea
volver a elegirlo) — el usuario entiende de un vistazo por qué esa fila en
particular no responde al toque, sin tener que tocarla primero para
enterarse. El backend igual conserva su propia restricción de unicidad
(`user_id`+`flashscore_mid`) como red de seguridad real ante una carrera
rarísima (dos pestañas del mismo usuario, resultado de búsqueda desactualizado
por unos segundos) — si esa carrera ocurriera, el error de la RPC de alta
(5.1.5) se muestra con el mismo `toast.error` genérico que cualquier otro
fallo de guardado, sin un diseño especial para un caso que la UI ya intenta
prevenir de antemano.

**5.1.4 — Partido elegido: chip/resumen + foto opcional + confirmar**

**Se resuelve con un botón inferior fijo, no con avance directo de paso al
tocar la fila.** Tocar un partido de la lista lo *selecciona*
(`form.selectedMatch = result`) pero no dispara por sí solo el paso 2
(OCR)/alta — reemplaza el contenido de la sección 5.1.1 por un resumen del
partido elegido más el mismo bloque de foto opcional que ya existía en la
versión anterior de este paso, sin tocar su comportamiento:

```html
<SheetContent side="bottom">
  <SheetHeader>
    <SheetTitle>Nuevo partido</SheetTitle>
    <SheetDescription>Revisá el partido elegido y, si querés, sumá la foto de tu cupón.</SheetDescription>
  </SheetHeader>

  <form class="flex flex-col gap-4 px-4 pb-4" @submit.prevent="handleSubmitStep1">
    <div class="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <p class="truncate text-sm font-medium">{{ form.selectedMatch.homeTeam }}</p>
        <p class="truncate text-sm font-medium">{{ form.selectedMatch.awayTeam }}</p>
        <p v-if="form.selectedMatch.league" class="truncate text-xs text-muted-foreground">{{ form.selectedMatch.league }}</p>
      </div>
      <span v-if="form.selectedMatch.status === 'live'" class="flex items-center gap-1 text-sm font-semibold text-primary">
        <Radio class="size-3 animate-pulse" />
        En vivo
      </span>
      <Badge v-else variant="secondary" class="text-[10px]">{{ formatKickoffTime(form.selectedMatch.kickoffAt) }}</Badge>
      <Button type="button" variant="ghost" size="sm" :disabled="isSubmitting" @click="form.selectedMatch = null">
        Cambiar
      </Button>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label>Foto del cupón (opcional)</Label>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        capture="environment"
        class="sr-only"
        @change="onFileSelected"
      >

      <div v-if="!form.photoPreviewUrl">
        <Button type="button" variant="outline" class="w-full" :disabled="isSubmitting" @click="fileInputRef?.click()">
          <Camera class="size-4" />
          Subir foto del cupón
        </Button>
        <p class="mt-1 text-xs text-muted-foreground">
          Leemos las selecciones automáticamente. Podés revisarlas antes de confirmar.
        </p>
      </div>

      <div v-else class="relative overflow-hidden rounded-lg border border-border">
        <img :src="form.photoPreviewUrl" alt="Vista previa del cupón subido" class="max-h-48 w-full object-contain bg-muted">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          class="absolute right-2 top-2 size-9"
          aria-label="Quitar foto"
          :disabled="isSubmitting"
          @click="clearPhoto"
        >
          <X class="size-4" />
        </Button>
      </div>
    </div>
  </form>

  <SheetFooter>
    <Button type="button" variant="outline" :disabled="isSubmitting" @click="closeSheet">Cancelar</Button>
    <Button type="submit" :disabled="isSubmitting" @click="handleSubmitStep1">
      <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
      {{ form.photoFile ? 'Continuar' : 'Agregar partido' }}
    </Button>
  </SheetFooter>
</SheetContent>
```

- **Por qué no "tocar la fila ya dispara el avance directo de paso"**: el
  encargo pide explícitamente poder sumar la foto *después* de elegir el
  partido, no antes (tiene sentido — recién al elegir el partido queda claro
  a qué cupón corresponde la foto). Si tocar la fila avanzara directo a
  `processing`/alta, el usuario que sí quiere adjuntar foto tendría que
  cancelar y volver a abrir el Sheet, perdiendo la selección ya hecha. El
  botón inferior fijo con label condicional (idéntico al de la versión
  anterior: "Continuar" si hay foto, "Agregar partido" si no) preserva
  exactamente el comportamiento ya especificado en 5.5 más abajo, solo
  cambiando el disparador de "URL válida" a "partido elegido" — ninguna otra
  pieza del wizard (pasos 5.2/5.3, confirmación 5.5) cambia.
- **"Cambiar"** (`Button variant="ghost" size="sm"`, no un ícono `X` solo)
  vuelve a `form.selectedMatch = null`, restaurando la vista de
  5.1.1/5.1.3 — el texto plano se prefiere sobre un ícono para que quede
  inequívoco que la acción es "elegir otro partido", no "cancelar el alta"
  (ese es el propósito ya reservado del botón "Cancelar" del footer).
  `searchQuery`/`dayOffset` se conservan tal como estaban (no se resetea la
  búsqueda), para que el usuario no tenga que retipear si solo se equivocó
  de fila.
- El resto del paso (bloque de foto, notas de a11y del input oculto, el
  criterio de "label del botón cambia según haya foto o no") es **exactamente
  el mismo markup y comportamiento** que ya estaba especificado acá antes de
  este cambio — no se repite la justificación, solo se removió toda mención
  al campo de URL.

**5.1.5 — Estados de carga/vacío/error de la búsqueda**

Reemplazan el contenido del contenedor `aria-live="polite"` de 5.1.1 según
el estado de la llamada a `search-matches` para el `dayOffset`/`searchQuery`
actuales:

- **Carga** (mientras se resuelve la llamada, tras cambiar de día o al
  terminar el debounce de la búsqueda): 4 filas `Skeleton`, mismo alto
  aproximado que una fila real, mismo criterio de skeleton ya usado en el
  resto de la app.

  ```html
  <div v-for="n in 4" :key="n" class="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
    <div class="flex flex-1 flex-col gap-1.5">
      <Skeleton class="h-4 w-36" />
      <Skeleton class="h-4 w-28" />
    </div>
    <Skeleton class="h-5 w-14 rounded-full" />
  </div>
  ```

- **Vacío, con búsqueda activa** (`searchQuery.trim().length >= 2` y 0
  resultados): bloque centrado, ícono `SearchX` `size-8
  text-muted-foreground`, texto `No encontramos partidos para
  "{{ searchQuery }}" en {{ dayLabelLowercase(dayOffset) }}.` —
  `dayLabelLowercase`: "hoy" / "mañana" / "pasado mañana" / "en 3 días"
  (mismos 4 valores de `dayOptions`, en minúscula para insertarse en la
  oración).
- **Vacío, sin búsqueda** (`searchQuery` vacío/menor a 2 caracteres y 0
  resultados — no hay partidos programados ese día): mismo layout centrado
  pero ícono `CalendarX` y texto distinto, sin sonar a error: `No hay
  partidos programados para {{ dayLabelLowercase(dayOffset) }}. Probá otro
  día.`
- **Error** (falló la llamada a `search-matches` — timeout/caída del feed no
  oficial): inline dentro del propio contenedor de resultados, el Sheet
  sigue abierto — mismo tono "no alarmante" que ya usa el resto de la
  feature para fallas del feed (sección 1.5): `warning`, nunca
  `destructive`.

  ```html
  <div class="flex flex-col items-center gap-3 px-4 py-8 text-center">
    <TriangleAlert class="size-8 text-warning" />
    <p class="text-sm text-muted-foreground">
      No pudimos buscar partidos ahora mismo. Probá de nuevo en un momento.
    </p>
    <Button type="button" variant="outline" size="sm" @click="retrySearch">Reintentar</Button>
  </div>
  ```

  `retrySearch` reintenta la misma combinación `dayOffset`/`searchQuery`
  vigente, sin resetear ninguno de los dos.
- **Primer contenido genuinamente scrolleable dentro de un Sheet de esta
  app** (`max-h-[45vh] overflow-y-auto` en 5.1.1) — se anota explícitamente
  porque no hay precedente: todos los Sheets anteriores dejan crecer su
  altura con el contenido (`data-[side=bottom]:h-auto` del componente base)
  y confían en el scroll natural del documento. Acá hace falta un techo
  explícito porque la lista de resultados puede ser larga y el Sheet ya
  compite por espacio vertical con el teclado virtual abierto por el
  buscador — sin el `max-h`, una lista larga empujaría el footer/los botones
  fuera de la pantalla visible en mobile.

### 5.2 Paso 2 — `step === 'processing'`: leyendo el cupón

Solo se llega acá si `form.photoFile` existe. Reemplaza el contenido del
Sheet (no un overlay encima, el usuario no puede tocar nada mientras tanto
— tarea corta, no hace falta poder cancelar a mitad de una llamada de
OCR que va a tardar unos segundos):

```html
<SheetContent side="bottom">
  <SheetHeader>
    <SheetTitle>Leyendo el cupón...</SheetTitle>
  </SheetHeader>
  <div class="flex flex-col items-center gap-4 px-4 py-10">
    <Loader2 class="size-10 animate-spin text-primary" />
    <p class="text-center text-sm text-muted-foreground">
      Esto puede tardar unos segundos. No cierres esta ventana.
    </p>
  </div>
</SheetContent>
```

- Sin botón "Cancelar" en este paso — mismo criterio que
  `CategoryFormSheet` durante el guardado no optimista (`isSaving`
  deshabilita todo el formulario): una operación server-only en curso no se
  interrumpe a mitad de camino desde la UI.
- Si la llamada al Edge Function falla por completo (error de red, timeout,
  Edge Function caída — no "no encontró legs", eso es un caso distinto,
  sección 5.4): vuelve al paso 1 con un `toast.error('No pudimos leer la
  foto. Probá de nuevo o segui sin cupón.')`, la foto seleccionada se
  conserva (no hay que volver a elegirla) para poder reintentar con el
  mismo botón "Continuar".

### 5.3 Paso 3 — `step === 'review'`: preview de legs extraídos

```html
<SheetContent side="bottom">
  <SheetHeader>
    <SheetTitle>Revisá las selecciones</SheetTitle>
    <SheetDescription>
      Leímos esto automáticamente y puede tener errores. Sacá las que no correspondan.
    </SheetDescription>
  </SheetHeader>

  <div class="flex flex-col gap-2 px-4 pb-4">
    <div
      v-for="leg in form.extractedLegs"
      :key="leg.tempId"
      class="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
    >
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="truncate text-sm font-medium">{{ leg.selectionLabel }}</p>
        <p class="truncate text-xs text-muted-foreground">{{ leg.marketLabel }}</p>
      </div>
      <Badge v-if="leg.marketType === 'unknown'" variant="outline" class="shrink-0 text-[10px]">No monitoreable</Badge>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="size-9 shrink-0"
        :aria-label="`Quitar '${leg.selectionLabel}'`"
        @click="discardLeg(leg.tempId)"
      >
        <CircleX class="size-4 text-muted-foreground" />
      </Button>
    </div>

    <p v-if="form.extractedLegs.length === 0" class="py-6 text-center text-sm text-muted-foreground">
      No encontramos selecciones en la foto.
    </p>
  </div>

  <SheetFooter>
    <Button type="button" variant="outline" :disabled="isSubmitting" @click="retakePhoto">
      Probar con otra foto
    </Button>
    <Button type="button" :disabled="isSubmitting" @click="confirmMatch">
      <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
      {{ form.extractedLegs.length > 0 ? 'Agregar partido' : 'Continuar sin cupón' }}
    </Button>
  </SheetFooter>
</SheetContent>
```

- **Quitar un leg es sin confirmación** (`CircleX` directo, sin
  `AlertDialog`): a diferencia de "Quitar partido" (sección 3.4, borra un
  recurso real ya guardado), acá el leg **todavía no existe en la base** —
  es una lista en memoria local, descartar uno es tan reversible como
  desmarcar un checkbox (basta con volver a intentar la foto si el usuario
  se arrepiente). Pedir confirmación acá sería fricción sin ningún riesgo
  real que mitigar.
- Legs con `marketType === 'unknown'` (mercado no soportado, punto 4 del
  encargo) **se muestran igual**, con el badge "No monitoreable" ya puesto
  desde el preview — el usuario decide si igual quiere guardarlo como
  referencia (nunca se le esconde) o prefiere sacarlo.
- **Botón final cambia de label según si quedan legs o no**
  ("Agregar partido" vs. "Continuar sin cupón") — si el usuario descartó
  todos los legs (uno por uno, o porque el OCR no encontró ninguno desde el
  principio), el flujo sigue siendo válido: se guarda el partido sin cupón
  asociado, igual que el alta sin foto del paso 1.
- **"Probar con otra foto"** vuelve al paso 1 con el campo de foto vacío
  (no al paso 2 directo) — le da al usuario la chance de elegir una imagen
  distinta, no solo reintentar la misma.

### 5.4 Caso: el OCR no encontró nada (mercado completo desconocido o imagen ilegible)

Mismo paso 3, `form.extractedLegs` llega vacío desde el Edge Function
(distinto del caso 5.2 de error de red — acá la llamada funcionó, pero no
hay nada que mostrar). El mensaje central ("No encontramos selecciones en
la foto.") ya cubre este caso dentro del mismo layout de la sección 5.3, sin
necesidad de una pantalla separada — el botón final ya dice "Continuar sin
cupón" automáticamente porque la lista está vacía. Cumple el requisito
explícito del encargo ("si el OCR falla completo el usuario tiene que poder
seguir sin cupón") sin bifurcar el flujo.

### 5.5 Confirmación final y cierre

`confirmMatch()`/`handleSubmitStep1()` (paso 1 sin foto) llaman al mismo
método del store, `addMatch({ matchId, homeTeam, awayTeam, league, legs })`
— ya no `{ url, mid, legs }`, los 4 primeros campos vienen resueltos de
antemano por la selección del paso 1 (sección 5.1), no se vuelven a derivar
de ningún link — inserta la fila de
`monitored_matches` (y sus `bet_slip_legs` si hay) en una sola operación
server-side (Edge Function o función `rpc`, a definir con
`supabase-backend-expert` — misma razón que `create_debt` en Deudas: si son
2+ inserts dependientes, mejor una función atómica que 2 llamadas sueltas
del cliente). Mientras está en vuelo: botón con `Loader2` + texto
"Guardando...", resto del Sheet deshabilitado (mismo patrón exacto que
`CategoryFormSheet`/`AccountFormSheet`/`DebtPersonFormSheet`, todos ya
citados con el mismo snippet `<Loader2 v-if="isSaving" class="size-4
animate-spin" />`).

Al confirmar OK: `toast.success('¡Listo! Ya estamos siguiendo este
partido.')`, cerrar el Sheet, el partido nuevo aparece en la lista — no hay
snapshot todavía (el primer poll del cron puede tardar hasta su intervalo
base, `PLAN.md` sección 6.3, ~15-20s), así que la card del partido recién
creado debe contemplar un **estado transitorio "Buscando datos del
partido..."** (marcador/stats en blanco/skeleton parcial dentro de la
propia card, no toda la pantalla) hasta que Realtime (sección 1.3) traiga
el primer snapshot real.

### 5.6 Nota de backend: almacenamiento de la foto (ilustrativo)

La foto del cupón necesita llegar al Edge Function de OCR. Dos caminos
razonables, a decidir por `supabase-backend-expert` sin que esto bloquee el
diseño de UX: (a) subir primero a un bucket privado de Supabase Storage
(`bet-slips/{user_id}/{uuid}.jpg`, políticas RLS scoped a `auth.uid()`,
mismo criterio que el resto del esquema) y pasarle la ruta al Edge
Function, quedando la imagen persistida como evidencia del cupón; o (b)
mandar el archivo directo al Edge Function (`multipart`/base64) sin
persistir la imagen original. La sección 4.4 (detalle) no depende de cuál
se elija — no se pidió mostrar la foto original en ningún lado del
frontend, así que persistirla es una decisión 100% de backend (auditoría/
debug futuro), no de UX.

---

## 6. Notificaciones push

### 6.1 Cuándo se pide el permiso

**Banner en el dashboard** (`/partidos`, sección 3.2), mostrado la primera
vez que el usuario tiene al menos un partido siendo monitoreado y el
permiso del navegador todavía está en estado `default` (ni concedido ni
denegado):

```html
<Card class="border-primary/30 bg-primary/5">
  <div class="flex items-start gap-3 px-4 py-4">
    <BellRing class="size-5 shrink-0 text-primary" />
    <div class="flex-1">
      <p class="text-sm font-medium">Activá las notificaciones</p>
      <p class="text-sm text-muted-foreground">
        Te avisamos cuando haya un gol, una tarjeta, o se decida una selección de tu cupón.
      </p>
      <div class="mt-3 flex gap-2">
        <Button size="sm" @click="requestNotificationPermission">Activar</Button>
        <Button size="sm" variant="ghost" @click="dismissNotificationBanner">Ahora no</Button>
      </div>
    </div>
    <Button variant="ghost" size="icon" class="-mr-2 -mt-2 size-9" aria-label="Cerrar" @click="dismissNotificationBanner">
      <X class="size-4" />
    </Button>
  </div>
</Card>
```

- **No se pide automáticamente al agregar el primer partido** (sin
  interrumpir el flujo de alta con un prompt del navegador en medio) — se
  muestra el banner *después*, en el dashboard, como una invitación
  separada que el usuario puede ignorar sin fricción.
- `dismissNotificationBanner`: guarda en `localStorage` (clave
  `tipapp:notifications-banner-dismissed`, mismo criterio de cache local ya
  usado para `theme-preference`) que el usuario ya lo vio — **no vuelve a
  aparecer automáticamente** en visitas futuras, ni siquiera si sigue en
  estado `default` (respetar la decisión de "ahora no" sin insistir, mismo
  espíritu que el resto de la app nunca fuerza una acción). El toggle de
  Ajustes (sección 6.3) sigue disponible en cualquier momento para
  activarlo después.
- `requestNotificationPermission()`: llama a `Notification.requestPermission()`
  del navegador (el prompt nativo del sistema, TipApp no puede
  personalizarlo) y, si se concede, registra la suscripción Push
  (`PushManager.subscribe`) contra el backend (`push_subscriptions`,
  ilustrativo). Si el usuario deniega desde el prompt nativo: mismo
  comportamiento que "Ahora no" (banner no vuelve a aparecer, toast
  discreto **no se muestra** — el navegador ya le dio su propio feedback
  nativo de que quedó denegado, no hace falta duplicarlo).

### 6.2 Qué pasa si el usuario deniega o nunca activa

**La app sigue funcionando exactamente igual sin notificaciones** — todo lo
demás (lista de partidos, minuto en vivo, stats, legs, timeline) no depende
en nada del permiso de notificaciones, es puramente un canal de aviso
adicional. Ningún flujo queda bloqueado ni degradado. Esto no necesita
ningún tratamiento especial de UI más allá de no mostrar el banner de nuevo
(6.1) — se documenta acá para que quede explícito que es un requisito
cumplido por diseño, no una casualidad.

### 6.3 Toggle persistente en Ajustes

Se agrega una `Card` nueva en `SettingsView.vue`, siguiendo el mismo
`role`/estructura que ya tiene la sección "Apariencia" (`SunMoon`+
radiogroup, `Palette`+swatches) — **primer uso del componente `Switch`
como toggle persistente de una preferencia de cuenta** (ya está instalado,
usado hasta ahora solo dentro de `CardExpenseFormSheet` para el campo
"Cuotas" de un formulario puntual; acá es la primera vez que controla un
estado de configuración global, mismo criterio de "reusar antes de agregar"
ya aplicado en el resto del proyecto):

```html
<Card>
  <CardHeader>
    <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Notificaciones
    </CardTitle>
  </CardHeader>

  <div class="flex items-center gap-3 px-4 pb-4">
    <BellRing v-if="notificationsEnabled" class="size-5 shrink-0 text-muted-foreground" />
    <BellOff v-else class="size-5 shrink-0 text-muted-foreground" />
    <div class="flex-1">
      <Label for="notifications-toggle">Avisos de partidos en vivo</Label>
      <p class="text-xs text-muted-foreground">{{ notificationsStatusLabel }}</p>
    </div>
    <Switch
      id="notifications-toggle"
      :model-value="notificationsEnabled"
      :disabled="browserPermission === 'denied' || !isPushSupported"
      @update:model-value="onToggleNotifications"
    />
  </div>

  <p v-if="browserPermission === 'denied'" class="border-t border-border px-4 py-3 text-xs text-muted-foreground">
    Bloqueaste las notificaciones para TipApp en tu navegador. Para activarlas, cambiá el permiso desde la configuración del sitio en tu navegador.
  </p>
  <p v-else-if="!isPushSupported" class="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
    <Smartphone class="mt-0.5 size-3.5 shrink-0" />
    En iPhone o iPad, las notificaciones solo funcionan si instalás TipApp en la pantalla de inicio (Compartir → Agregar a pantalla de inicio).
  </p>
</Card>
```

- `notificationsStatusLabel`: "Activadas" (permiso `granted` + suscripción
  registrada), "Desactivadas" (permiso `default`, nunca pedido o "ahora
  no"), "Bloqueadas por el navegador" (permiso `denied`).
- **Si `browserPermission === 'denied'`**: el `Switch` queda deshabilitado
  (no hay forma de volver a pedir el permiso vía JavaScript una vez
  denegado, restricción del propio navegador, no de esta app) con el texto
  explicando cómo revertirlo manualmente — nunca un botón que prometa algo
  que no puede cumplir.
- **Si `!isPushSupported`** (ver detección en 6.4): mismo tratamiento,
  `Switch` deshabilitado, con la nota de instalación de iOS en vez del
  texto de "bloqueado" (son casos mutuamente excluyentes: si el browser ni
  siquiera soporta la API, no hay un permiso `denied` real que mostrar).
- Apagar el toggle estando `granted` (`onToggleNotifications(false)`) no
  puede "revocar" el permiso del navegador (tampoco es posible vía JS) —
  en su lugar, da de baja la suscripción Push contra el backend
  (`push_subscriptions`, se elimina/desactiva esa fila) para que el
  usuario deje de recibir avisos sin tener que tocar la configuración del
  navegador. Reactivar el toggle vuelve a suscribir sin pedir permiso de
  nuevo (ya estaba `granted`).

### 6.4 Detección de capacidad y copy de iOS — qué es viable detectar

**Lo que sí se puede detectar de forma confiable en el navegador**:

```ts
// Ilustrativo — src/lib/pushSupport.ts
const isPushSupported = 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || (navigator as unknown as { standalone?: boolean }).standalone === true // Safari iOS, propiedad no estándar
```

- `isPushSupported`: en Safari iOS **sin** instalar a pantalla de inicio,
  esto da `false` (las APIs de Push directamente no existen en ese
  contexto) — es la señal principal y confiable para decidir si mostrar el
  toggle activo o la nota de instalación.
- `isStandalone`: distingue "ya está instalada" de "corriendo en una
  pestaña normal del navegador". **No es 100% necesaria para la lógica**
  (si `isPushSupported` ya es `false`, alcanza para mostrar la nota) pero
  es útil como refuerzo: si en algún punto se quiere un mensaje más preciso
  ("ya la instalaste, activá notificaciones" vs. "instalala primero"), esta
  señal permite esa distinción. **No hay forma confiable de detectar
  "es un iPhone/iPad pero todavía no instaló"** de manera 100% robusta solo
  con feature-detection (`isPushSupported === false` también podría darse
  en un navegador desktop muy viejo) — para el copy exacto de "instalá a
  pantalla de inicio", que es una instrucción específica de iOS, se acepta
  un heurístico adicional de user-agent (`/iPad|iPhone|iPod/.test(navigator
  .userAgent)`), sabiendo que los user-agent sniffing son frágiles a largo
  plazo — si en algún momento deja de matchear correctamente (Apple cambia
  el UA string, por ejemplo), el fallback seguro es el texto genérico de
  abajo, nunca un error visible.
- **Copy final**, dos variantes según el heurístico de iOS:
  - Si `!isPushSupported && esHeurísticamenteIOS`: el texto exacto de la
    sección 6.3 ("En iPhone o iPad, las notificaciones solo funcionan
    si instalás TipApp en la pantalla de inicio...").
  - Si `!isPushSupported && !esHeurísticamenteIOS` (navegador desktop/
    Android viejo sin soporte, caso raro): texto genérico "Tu navegador no
    admite notificaciones. Probá desde Chrome o Safari actualizados." — sin
    mencionar iOS si no aplica.

### 6.5 Prioridades de notificación (recap, ya decidido por el Product Owner)

Tabla de referencia para `vue-frontend-expert`/backend, sin margen de
decisión de UX acá (ya viene fijo del encargo):

| Evento | Prioridad | Canal Web Push |
|---|---|---|
| Gol | Alta | `requireInteraction`/vibración si el navegador lo soporta |
| Tarjeta (amarilla/roja) | Alta | ídem |
| Córner | Normal | notificación silenciosa/estándar |
| Remate a puerta | Normal | ídem |
| Leg de cupón decidido (ganado/perdido) | Alta | ídem gol/tarjeta |
| Resto de stats (posesión, pases, faltas, etc.) | — | no notifica |

El texto de cada notificación (p. ej. `"⚽ Gol de {equipo} ({marcador})"`,
mismo estilo que `PLAN.md` sección 6.4) lo arma el Edge Function al momento
de enviar el Push — el frontend solo necesita manejar el click en la
notificación (`notificationclick` en el service worker) para abrir/enfocar
`/partidos/:id` del partido correspondiente, dato que debe viajar en el
payload de la notificación (`data: { matchId }`, ilustrativo). Detalle de
implementación del service worker es responsabilidad de
`vue-frontend-expert`, sin decisiones de UX pendientes más allá de "a dónde
navega al tocarla" (ya especificado acá).

---

## 7. Drawer de navegación: posición e ícono

**Ítem nuevo: "Partidos en vivo", ícono `Goal`, en la 6ª posición de 10.**

Orden completo resultante:

1. Inicio
2. Transacciones
3. Tarjetas de crédito
4. Cuentas
5. Deudas
6. **Partidos en vivo** ← nuevo
7. Categorías
8. Estadísticas
9. Reportes
10. Ajustes

**Justificación**: el criterio ya usado por el proyecto para ordenar el
drawer es agrupar por "bloque mental" (`credit-cards-ux.md`/
`accounts-income-ux.md`/`debts-ux.md`, cada uno explica por qué su ítem
entra en un bloque existente). Partidos en vivo **no encaja en ningún
bloque existente**:

- No es un dominio de **movimiento de dinero** (Transacciones/Tarjetas/
  Cuentas/Deudas, posiciones 2-5) — no registra gastos ni ingresos ni
  deudas propias; el cupón de apuestas es solo un dato de referencia que se
  monitorea, TipApp no lleva contabilidad de apuestas ganadas/perdidas en
  dinero.
- No es un dominio de **clasificación/análisis de esos movimientos**
  (Categorías/Estadísticas/Reportes, posiciones 7-9) — no analiza nada de
  `expenses`/`incomes`/`card_expenses`/`debts`, es una entidad
  completamente ajena a las finanzas personales del usuario.
- No es **Ajustes** (posición 10, configuración global).

Es, literalmente, un dominio nuevo y ortogonal a los dos bloques que ya
existen. Insertarlo *dentro* de cualquiera de los dos bloques (por ejemplo,
después de Deudas pero contándolo como "parte" del bloque de dinero, o
metido entre Categorías y Estadísticas) rompería la coherencia mental que
esos bloques ya comunican implícitamente por contigüidad. La posición que
preserva ambos bloques intactos y ubica el ítem nuevo como su propio
"tercer bloque" de una sola entrada es **inmediatamente después del último
ítem del bloque de dinero (Deudas) y antes del primer ítem del bloque de
análisis (Categorías)** — exactamente la posición 6.

No se evalúa "frecuencia de uso esperada" como criterio acá (a diferencia
de cómo se ordenó *dentro* del bloque de dinero, Tarjetas > Cuentas >
Deudas) porque no hay ningún otro ítem del mismo bloque contra el cual
compararla — es un bloque de un solo ítem, el criterio de bloque ya
resuelve la posición sin ambigüedad.

```html
<!-- Insertar después del botón "Deudas" (línea ~329 de HomeView.vue hoy), antes de "Categorías" -->
<button
  type="button"
  class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :class="isActive('matches') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
  :aria-current="isActive('matches') ? 'page' : undefined"
  @click="navigateFromDrawer('matches')"
>
  <Goal class="size-5 shrink-0" />
  Partidos en vivo
</button>
```

`Goal` confirmado en
`node_modules/@lucide/vue/dist/esm/icons/goal.mjs` (ícono literal de arco de
fútbol, sin ambigüedad con otros sentidos de la palabra "goal" en inglés
dentro de un ícono set) — mismo criterio de "confirmar el ícono existe
antes de citarlo" que ya usa `debts-ux.md` sección 3.2 para
`ArrowUpRight`/`ArrowDownRight`.

---

## 8. Paleta e iconografía — qué se reusa, qué es nuevo

**Sin paleta nueva.** Se reusan exclusivamente tokens ya existentes de
`docs/design-system.md`:

| Uso | Token | Motivo |
|---|---|---|
| Leg ganado | `success` | Mismo significado ya establecido (resultado favorable) |
| Leg perdido | `destructive` | Mismo significado ya establecido (resultado desfavorable) |
| Leg pendiente / no monitoreable | `muted-foreground` | Neutro, sin polaridad |
| Tarjeta amarilla (stat) | `warning` | Reutilización **literal**, no metafórica — ver sección 3.5 |
| Tarjeta roja (stat) | `destructive` | Ídem |
| Indicador "en vivo" | `primary` | Ver justificación abajo |
| Estado "no se pudo actualizar" | `warning` | Recuperable, no alarmante — mismo criterio que "cerca del límite de presupuesto" |
| Error de carga de página completa | `destructive` (vía `AlertCircle`) | Mismo patrón ya usado en toda la app |

**Por qué el indicador "en vivo" es `primary` y no `destructive`** (la
elección más discutible, se documenta explícitamente): muchas apps de
resultados en vivo usan rojo por convención de género visual ("LIVE" en
rojo es casi universal). Se decide **no** seguir esa convención acá porque
`destructive` en este design system tiene un significado ya cargado y
consistente en toda la app (presupuesto superado, eliminar, error) — usar
el mismo token para "este partido está corriendo ahora" (una información
neutra, ni buena ni mala) diluiría esa semántica ya establecida y podría
leerse, de reojo, como "algo anda mal con este partido". `primary` (el azul
de marca) no tiene ninguna semántica negativa cargada y ya se usa en toda
la app para "esto es interactivo/activo/actual" (botones principales,
estado de foco, mes seleccionado en Tarjetas) — es una extensión
consistente de un significado que el token ya tenía, no una redefinición.

Íconos nuevos de `@lucide/vue` a importar (todos confirmados existentes en
`node_modules/@lucide/vue/dist/esm/icons/`, ninguno requiere instalar
paquete nuevo — mismo paquete ya usado en todo el proyecto):

`Goal`, `Radio`, `Flag`, `Target`, `Sparkles`, `TriangleAlert`,
`CircleCheck`, `CircleX`, `CircleDashed`, `Clock`, `Pause`, `Play`,
`Camera`, `ImagePlus` (si se necesita un ícono distinto a `Camera` para
"cambiar foto", opcional), `X`, `ExternalLink`, `BellRing`, `BellOff`,
`Smartphone`, `EllipsisVertical` (ya en uso en otras pantallas del
proyecto, no es nuevo), `Trash2` (ídem, ya en uso).

---

## 9. Accesibilidad — checklist específico de esta feature

Además de los lineamientos generales de `design-system.md` sección 5
(contraste AA, foco visible, 44×44px, labels persistentes, confirmación
antes de destruir, `prefers-reduced-motion`), específico de esta feature:

1. **Color nunca como único indicador**, aplicado a tres casos nuevos de
   esta feature: (a) el indicador "en vivo" combina ícono `Radio` con
   `animate-pulse` + texto del minuto, nunca solo el pulso; (b) los
   cuadraditos de tarjeta amarilla/roja siempre van acompañados del número
   al lado (nunca un cuadradito solo); (c) el estado de un leg siempre
   combina ícono + `Badge` de texto, nunca solo el color del ícono.
2. **`animate-pulse` respeta `prefers-reduced-motion: reduce`** (la
   utilidad estándar de Tailwind ya lo hace vía `@media`, no se necesita
   configuración adicional, pero es responsabilidad de
   `vue-frontend-expert` no reemplazarla por una animación custom que no lo
   respete).
3. **Cada ícono de stat en `MatchStatsRow` lleva un `<span class="sr-only">`**
   con el nombre completo de la stat antes del número (p. ej. `<span
   class="sr-only">Córners: </span>4-3`), porque el ícono solo (`Flag`) no
   es suficientemente descriptivo para un lector de pantalla sin ese
   contexto textual — el `title=` HTML nativo ayuda en desktop con mouse
   pero no es leído consistentemente por todos los lectores de pantalla en
   mobile.
4. **La región clickeable de la card (sección 3.4) y el trigger del menú
   `⋮` son elementos hermanos, nunca anidados** — evita el error de
   HTML/a11y de un `<button>` interactivo dentro de otro `<button>`
   interactivo (foco y semántica ambiguos para tecnología asistiva). Ver
   justificación completa en 3.4.
5. **`aria-label` explícito en cada botón de solo ícono nuevo**: "Más
   opciones" (`⋮`), "Quitar foto" (`X` sobre la preview), "Quitar
   '{selección}'" (por cada leg descartable en el paso 3 del alta — el
   label incluye el texto de la selección para que un lector de pantalla
   distinga cuál leg se está por quitar sin depender de contexto visual de
   la lista).
6. **El input de archivo oculto (`sr-only`, no `hidden`/`display:none`)**
   sigue siendo alcanzable por teclado — ver nota completa en 5.1.
7. **El banner de notificaciones (6.1) no roba foco automáticamente al
   aparecer** — es contenido inline de la página, no un modal; el usuario
   lo encuentra en el flujo normal de lectura de la pantalla, sin
   interrumpir con un `autofocus` forzado.
8. **Prompt nativo de `Notification.requestPermission()`**: fuera del
   control de estilo/foco de TipApp (lo renderiza el navegador/SO) — no
   hay nada que diseñar ahí, solo asegurarse de que el botón "Activar" que
   lo dispara tenga su propio foco visible y `aria-label` claro antes de
   ese punto.
9. **Timeline de incidencias y lista de legs completos**: mismo patrón de
   lista con `Separator` ya usado en toda la app (orden de lectura lineal
   natural para lector de pantalla, sin tablas ni grillas complejas que
   requieran navegación 2D).
10. **Buscador de partidos (sección 5.1) — resultados debounced anunciados
    por lectores de pantalla**: el contenedor de resultados lleva
    `aria-live="polite"` (5.1.1) para que un lector de pantalla anuncie
    cuando la lista cambia tras el debounce de 350ms o un cambio de día, sin
    que el usuario tenga que navegar manualmente para descubrir que ya
    llegó una respuesta nueva. El selector de día sigue el mismo contrato
    `role="radiogroup"`/`role="radio"`/`aria-checked` ya establecido por el
    segmented control de tema de Ajustes — no se reinventa.
11. **Filas de partido ya seguido, deshabilitadas (5.1.3)**: usan el
    atributo `disabled` nativo del `<button>` (no solo una clase visual) —
    quedan automáticamente fuera del orden de tabulación y un lector de
    pantalla las anuncia como no interactivas, sin necesitar `aria-disabled`
    ni manejo manual de foco. El badge "Ya lo seguís" es texto real (no un
    ícono solo), así que la razón del bloqueo se lee igual de claro con
    lector de pantalla que a simple vista.

---

## 10. Fuera de alcance en v1 / preguntas abiertas para backend y frontend

Explícitamente **no** se diseña en este documento (mismo criterio de
honestidad ya usado en `/reportes`, "Próximamente" sin funcionalidad
fingida):

- **Historial de apuestas ganadas/perdidas en dinero real** — esta feature
  monitorea *selecciones* de un cupón, nunca registra montos apostados ni
  ganancias/pérdidas en efectivo; no hay ningún cruce con `expenses`/
  `incomes`/`accounts`. Si a futuro se pidiera ese cruce (p. ej. "cuánto
  aposté este mes"), es una feature nueva y separada, no una extensión de
  esta.
- **Notificación de resultado final "gané/perdí" agregada del cupón
  completo** (más allá de las notificaciones por leg individual ya
  especificadas en 6.5) — el encargo especifica notificaciones por leg
  decidido, no un resumen consolidado al finalizar el partido; se deja
  como posible mejora futura, no se construye ahora.
- **Elegir/editar un leg manualmente sin foto** (alta 100% manual de
  selecciones, sin depender de OCR) — el encargo describe el flujo de foto
  como el único camino para tener cupón asociado; un partido sin foto
  queda sin sección de cupón, tal como especifica el punto 2 del encargo
  ("no hace falta edición inline de texto en v1"). No se agrega un
  formulario manual de legs en esta iteración.

Preguntas abiertas, **no decididas unilateralmente por este documento**,
para resolver con `supabase-backend-expert`/Product Owner antes o durante
la implementación:

1. **Nombres reales de tablas/columnas** — este documento usa
   `monitored_matches`/`bet_slip_legs` y los campos citados en la sección 1
   como ilustrativos, mismo criterio que `debts-ux.md`/`credit-cards-ux.md`
   — confirmar antes de tipar los stores.
2. **Campos crudos del reloj (`stage_code`/`stage_anchor_ts`/
   `scheduled_kickoff_ts`, sección 1.4)** — es un requisito concreto de
   este documento, no opcional: sin esos 3 campos expuestos tal cual (no
   una etiqueta ya formateada), el minuto en vivo no puede tickear en
   cliente entre polls.
3. **Campo(s) de estado de poll (`last_polled_at`/`last_poll_ok`, sección
   1.5)** — nombre/forma exacta a definir con backend.
4. **Archivado/limpieza de partidos finalizados** (sección 1.10) — pregunta
   de producto, no resuelta acá; se deja mitigado visualmente (agrupado al
   final) pero sin mecanismo de limpieza automática en v1.
5. **Forma exacta de la función/Edge Function de alta** (sección 5.5) — un
   único endpoint atómico (partido + legs) vs. dos pasos — a definir con
   `supabase-backend-expert`, mismo criterio que `create_debt` en Deudas.
6. **Persistencia de la foto del cupón** (sección 5.6) — Storage vs. no
   persistir, decisión 100% de backend sin impacto en el frontend/UX
   documentado acá.
7. **Formato exacto de `push_subscriptions`/protocolo Web Push (VAPID,
   etc.)** — fuera del alcance de este documento de UX, es un detalle de
   implementación de `vue-frontend-expert`/`supabase-backend-expert`.
