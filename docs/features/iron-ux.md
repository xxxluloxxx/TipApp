# TipApp — UX de Iron (control de consumo de tabaco)

Documento de especificación funcional/UX para `supabase-backend-expert` y
`vue-frontend-expert`. Da por sentado todo lo ya resuelto en
`docs/design-system.md` (tokens, tipografía, Card-list, Sheet inferior,
`AppHeader`/`NavigationDrawer` compartidos, a11y), `docs/features/
dashboard-redesign-ux.md` (gráficos SVG a mano, `TrendAreaChart.vue`,
`src/lib/charts.ts`, criterio de "no inventar deltas sobre datos parciales"),
`docs/features/debts-ux.md` (primer uso de `Tabs`, patrón de vínculo opcional
a cuenta con copy explícito, cascada de borrado de un gasto vinculado) y
`docs/features/transaction-time-ux.md` (separación deliberada de fecha/hora
en columnas propias para evitar ambigüedad de huso horario). No se repite esa
justificación acá, solo se referencia y se indica qué se reusa tal cual y qué
es nuevo.

**Contexto de producto (recap del encargo, no se rediscute acá)**: Iron es una
feature de **utilidad personal, no financiera**, para ayudar al usuario a
dejar de fumar registrando consumo de tabaco. Convive intencionalmente con el
dominio financiero de la app, en la misma línea que "Partidos en vivo"
(`docs/features/live-matches-ux.md`) — un dominio ortogonal a las finanzas
personales que igual vive en el mismo login/drawer porque el Product Owner lo
pidió explícitamente así. El costo de una cajetilla es, **por defecto**, un
dato puramente informativo dentro de Iron — no genera `expenses`/`incomes` ni
toca `account_balances` a menos que el usuario elija explícitamente lo
contrario (sección 2).

**Fuera de alcance en v1, explícito** (para no inventar funcionalidad no
pedida, mismo criterio que el resto de los docs de features): sin
gamificación (rachas de días sin fumar, logros, badges, proyección de plata
ahorrada a futuro), sin recordatorios/notificaciones push, sin campo
"cigarrillos por cajetilla" ni costo-por-cigarrillo derivado (el costo
informativo es siempre a nivel de **compra de cajetilla**, nunca prorrateado
por cigarrillo — sección 1.5), sin reabrir manualmente una mitad ya
cerrada/descartada (si fue un error, se borra y se vuelve a registrar), sin
comparar el nombre "Iron" a marcas reales de tabaco/cigarrillos — es
simplemente el nombre de producto ya elegido por el Product Owner (se
mantiene tal cual, sección 3.2).

---

## 1. Modelo conceptual de datos (para `supabase-backend-expert`)

Mismo criterio que `debts-ux.md` sección 1: este documento asume nombres de
tabla/columna plausibles, en `snake_case`, **solo a título ilustrativo** —
confirmar los nombres exactos con `supabase-backend-expert` antes de tipar el
store, sin bloquear el diseño de UX que sigue. Lo que **sí** es una
especificación dura (no negociable, porque de esto depende el frontend
punto por punto) son las **reglas de negocio y la forma de los datos
expuestos**.

### 1.1 Fecha y hora: reusar el patrón ya resuelto por `transaction-time-ux.md`, no `timestamptz`

Cada evento de Iron necesita fecha **y** hora reales (a diferencia de
`expenses`/`incomes`, donde la hora es opcional y decorativa, acá la hora es
central: "empezada a las 14:32", navegación día a día, tendencia diaria). En
vez de modelar esto con una sola columna `timestamptz` (que arrastra
ambigüedad de huso horario al agrupar por día/semana/mes), se reusa **el
mismo patrón que el proyecto ya adoptó a propósito** para gastos/ingresos:
**dos columnas separadas**, `date` + `time`, donde la columna `date` es la
única fuente de verdad para agrupar/navegar por día, y `time` es para mostrar
la hora exacta. Ambas son **obligatorias** en Iron (a diferencia de
`expense_time`, que es opcional) porque el flujo de alta siempre parte de
"ahora" (sección 4).

- `iron_cigarettes.smoked_date date not null`, `iron_cigarettes.smoked_time
  time not null`.
- `iron_packs.purchased_date date not null`, `iron_packs.purchased_time time
  not null`.

Con esto, agrupar por día/semana/mes para historial y tendencias (secciones
5 y 6) es aritmética de `date` pura (`group by smoked_date` / `date_trunc
('week', smoked_date)` / `date_trunc('month', smoked_date)`), sin ningún
riesgo de que un evento cargado a las 23:50 "salte" de día por conversión de
huso horario — exactamente el problema que `transaction-time-ux.md` ya evitó
para gastos/ingresos.

### 1.2 `iron_cigarettes` — la unidad atómica es la **mitad**, no el cigarrillo

Decisión de modelado más importante del documento. Un cigarrillo entero se
modela como **una fila** de valor `1.0`; una mitad se modela como **una fila
de valor `0.5`**, y un cigarrillo fumado en dos mitades queda representado
por **dos filas independientes**, cada una con su propia fecha/hora real —
porque el encargo pide explícitamente que la segunda mitad "quede con su
propia fecha/hora" (pueden ser incluso de **días distintos**: media a las
23:50 de hoy, el resto mañana a las 08:00). Modelarlo como una sola fila con
"fecha de inicio/fecha de fin" rompería la agrupación por día de la sección
1.1 apenas las dos mitades caen en días distintos.

```
iron_cigarettes
  id                    uuid pk
  user_id               uuid fk -> auth.users, not null
  kind                  text not null check (kind in ('entero', 'mitad'))
  status                text not null check (status in ('completo', 'mitad_pendiente', 'descartada'))
  smoked_date           date not null
  smoked_time           time not null
  closes_cigarette_id   uuid null fk -> iron_cigarettes(id) on delete set null
  created_at            timestamptz not null default now()
```

- **`kind = 'entero'`**: siempre nace y queda en `status = 'completo'` — no
  hay estado intermedio posible para un cigarrillo entero (se registra
  post-hoc, "ya lo fumé").
- **`kind = 'mitad'`**, tres estados posibles a lo largo de su vida:
  - `mitad_pendiente`: la primera mitad ya se fumó (esta fila existe con su
    fecha/hora real), la segunda todavía no se resolvió. **Este es el
    "estado actual" que la sección 1.3 expone.**
  - `completo`: la mitad se cerró porque el usuario se fumó la otra mitad —
    en ese momento se inserta una **fila nueva**, también `kind = 'mitad'`,
    `status = 'completo'`, con su propia `smoked_date`/`smoked_time` (la
    hora real del cierre) y `closes_cigarette_id` apuntando a la fila
    original. La fila **original** también pasa de
    `mitad_pendiente` → `completo` (ver función de cierre abajo). Se
    obtienen así **dos filas** `completo`, cada una con su fecha/hora real,
    vinculadas entre sí — nunca se reescribe la fecha/hora de la primera.
  - `descartada`: el usuario decidió que no va a terminar esa mitad (se le
    apagó, la tiró, etc.) — la fila **original** pasa de `mitad_pendiente`
    a `descartada` sin crear ninguna fila nueva. Sigue contando como `0.5`
    fumado (la primera mitad sí se fumó de verdad), simplemente no queda
    "abierta" esperando una segunda parte.
- **Conteo de cigarrillos consumidos** (para resúmenes/tendencias, sección
  6): siempre `SUM(CASE WHEN kind = 'entero' THEN 1 ELSE 0.5 END)` sobre
  **todas** las filas del rango de fechas, sin importar `status` — el status
  solo determina si hay una mitad *abierta* ahora mismo (sección 1.3), nunca
  si esa mitad "cuenta" o no (una mitad descartada igual se fumó, un
  cigarrillo no deja de haber pasado por ser un registro con una fila
  `mitad_pendiente` que después se descarta).

### 1.3 Regla dura: **una sola mitad pendiente a la vez**, y su vista de "estado actual"

El encargo pide que la UI deje "claro" si hay una mitad pendiente — para que
eso sea posible sin ambigüedad, el backend debe **garantizar** (no solo
sugerir) que un usuario nunca tiene más de una fila `mitad_pendiente` viva al
mismo tiempo. Esto no es solo un guard de cliente (como el conteo de borrado
de personas de deuda, `debts-ux.md` sección 1.5) — es un invariante real que
debe sobrevivir a doble-tap, dos pestañas abiertas o carreras de red, así
que necesita啊 **constraint a nivel de base de datos** (p. ej. un índice único
parcial `unique (user_id) where kind = 'mitad' and status = 'mitad_pendiente'`,
o el chequeo equivalente dentro de la función de alta) — el mecanismo exacto
queda a criterio de `supabase-backend-expert`, pero el resultado observable
debe ser: intentar registrar una segunda mitad mientras la primera sigue
abierta devuelve un error controlado, nunca dos filas `mitad_pendiente`
simultáneas.

**Vista `iron_current_status`** (nombre ilustrativo), la pieza que el
frontend necesita para pintar el estado en tiempo real sin adivinar nada en
cliente:

```sql
-- Ilustrativo, no es la migración final.
create view iron_current_status as
select
  c.id as pending_id,
  c.user_id,
  c.smoked_date as pending_since_date,
  c.smoked_time as pending_since_time
from iron_cigarettes c
where c.kind = 'mitad' and c.status = 'mitad_pendiente';
```

El frontend hace `select * from iron_current_status where user_id = :uid` —
**0 filas** = no hay mitad pendiente, **1 fila** = sí la hay (nunca más de
una, por el invariante de arriba). No hace falta ningún otro campo derivado
acá (el "hace cuánto" se calcula en cliente con `pending_since_date`/
`pending_since_time`, mismo criterio de "cálculo trivial en cliente, no una
columna nueva" ya usado para el estado `overdue` de Gastos fijos,
`fixed-expenses-ux.md` sección 6.1).

### 1.4 Funciones/RPC necesarias sobre `iron_cigarettes`

Registrar un cigarrillo entero o iniciar una mitad son **inserts simples de
una sola tabla** — optimistas, sin necesidad de RPC (mismo criterio que
cualquier alta simple del proyecto, p. ej. `debt_people`). Solo dos
operaciones necesitan una función dedicada porque tocan **dos filas a la
vez** de forma atómica:

- **`close_pending_half(p_cigarette_id uuid)`**: valida que la fila sea del
  usuario autenticado, `kind = 'mitad'` y `status = 'mitad_pendiente'`;
  inserta la fila nueva (`kind = 'mitad'`, `status = 'completo'`,
  `smoked_date`/`smoked_time` = ahora, `closes_cigarette_id = p_cigarette_id`)
  y actualiza la fila original a `status = 'completo'`, ambas cosas en la
  misma transacción. Devuelve el id de la fila nueva.
- **`discard_pending_half(p_cigarette_id uuid)`**: misma validación, solo
  actualiza la fila original a `status = 'descartada'` (no crea fila nueva).

Ambas son **no optimistas** desde el cliente (necesita el resultado real
antes de refrescar el estado — mismo motivo que `pay_fixed_expense_instance`:
dependencia entre dos escrituras donde el cliente no puede fabricar de
antemano el id de la fila nueva), pero son operaciones **instantáneas para
el usuario** de todos modos (sección 4.4 — no hay Sheet ni formulario en el
medio, se ejecutan al toque de un botón).

### 1.5 `iron_packs` — compra de cajetilla, con vínculo opcional a `expenses`

```
iron_packs
  id                    uuid pk
  user_id               uuid fk -> auth.users, not null
  cost                  numeric not null check (cost > 0)
  purchased_date        date not null
  purchased_time        time not null
  linked_expense_id     uuid null fk -> expenses(id) on delete set null
  created_at            timestamptz not null default now()
```

`linked_expense_id` es `null` cuando la compra **no** está vinculada a las
finanzas reales del usuario (default). `on delete set null` (mismo criterio
que `account_transfers.expense_id`, sección "Decisiones clave" de
`CLAUDE.md`): si el `expense` vinculado desaparece por algún motivo externo
(p. ej. el usuario lo borra directamente desde Transacciones, sin pasar por
Iron), la fila de `iron_packs` **no** desaparece — simplemente pasa a
mostrarse como "no vinculada" (sección 2.5).

**Sin ningún campo de "cigarrillos por cajetilla" ni costo-por-cigarrillo**
(fuera de alcance, ver encabezado) — el costo vive únicamente a nivel de
compra completa, nunca prorrateado.

### 1.6 Funciones/RPC necesarias sobre `iron_packs` (ver sección 2 para el detalle completo del vínculo)

- **Compra sin vínculo**: insert simple y optimista de una sola tabla, igual
  que cualquier alta simple.
- **Compra vinculada** (`create_iron_pack_linked`, nombre ilustrativo):
  inserta el `expense` real (categoría "Tabaco", sección 2.3) y la fila de
  `iron_packs` con `linked_expense_id` ya resuelto, en una sola transacción
  — no optimista, mismo motivo que `create_debt`/`pay_fixed_expense_instance`
  (el cliente no puede fabricar de antemano el id real del `expense`).
- **Edición** (`update_iron_pack`, nombre ilustrativo): maneja los 3 casos
  posibles sin duplicar lógica en el cliente — sección 2.6.
- **Borrado** (`delete_iron_pack`, nombre ilustrativo): si `linked_expense_id`
  no es `null`, borra primero el `expense` vinculado y después la fila de
  `iron_packs`, en una sola transacción — **cascada explícita**, mismo
  criterio exacto que `delete_account_transfer`/`_account_transfer_delete`
  (`20260720091400_account_transfer_edit_delete_functions.sql`): borrar la
  compra en Iron significa "esto nunca pasó", así que el gasto real que
  generó tampoco debería seguir existiendo. Si no está vinculada, es un
  delete simple y optimista.

### 1.7 Vistas de agregación para Tendencias — **server-side, nunca sumado en cliente sobre una lista sin acotar**

Mismo principio no negociable de `CLAUDE.md` ("Estado siempre derivado en el
servidor..."): la pantalla de Tendencias (sección 6) necesita totales por
día/semana/mes. Para un usuario de uso intensivo y prolongado,
`iron_cigarettes` **sí** puede crecer sin techo realista con el tiempo (un
fumador de un paquete por día genera ~20 filas por día, para siempre — mismo
perfil de crecimiento que `expenses`), así que sumar esto en cliente sobre
"todo lo cargado" repetiría exactamente el error que el resto del proyecto
ya evita. Se necesitan vistas (o una única función parametrizada) que
agreguen **en Postgres**, devolviendo ya el total por bucket:

```sql
-- Ilustrativo — una posible forma, a criterio de supabase-backend-expert
-- (puede ser 3 vistas o 1 función con parámetro de granularidad):
create view iron_daily_totals as
select
  user_id,
  smoked_date as period_start,
  sum(case when kind = 'entero' then 1 else 0.5 end) as cigarette_count
from iron_cigarettes
group by user_id, smoked_date;

create view iron_pack_daily_totals as
select user_id, purchased_date as period_start, sum(cost) as money_spent
from iron_packs
group by user_id, purchased_date;
-- análogas agrupando por date_trunc('week', ...) / date_trunc('month', ...)
-- para las variantes semanal/mensual.
```

El frontend consulta con un filtro de fecha acotado (`gte(windowStart)`,
últimos 30 días / 12 semanas / 12 meses según la pestaña activa, sección 6) —
la vista puede devolver **todo** el historial del usuario porque el propio
query del cliente ya lo acota, mismo patrón que cualquier vista de saldo del
proyecto (`debt_balances`, `account_balances`): la vista es "correcta y
completa", quien la consume decide cuánta ventana pedir.

**Huecos**: la vista solo devuelve buckets con datos (sparse) — el cliente
rellena a `0` los días/semanas/meses sin fila, exactamente el mismo criterio
ya usado por `buildDailySeries`/`buildCumulativeDailySeries` en
`src/lib/charts.ts` (sección 6.4).

---

## 2. Decisión clave: vínculo opcional a cuenta/gasto real — **SÍ, opt-in explícito**

Esta es la decisión que el Product Owner delegó explícitamente en el
diseño. Se decide que **sí aporta valor real de producto**, con las
condiciones exactas que siguen.

### 2.1 Por qué sí (a diferencia de Partidos en vivo, y con matices respecto a Deudas)

TipApp es, en su núcleo, una app de **control de gastos**. La plata que un
usuario gasta en tabaco es un gasto real y recurrente — no es un dato de
referencia externo como el monto de un cupón de apuestas (que no es plata
que el usuario efectivamente movió desde una cuenta propia, `live-coupons-
ux.md`), y tampoco es un simple ajuste de saldo entre dos bolsillos propios
como una Deuda (`debts-ux.md` sección 1: prestar plata no genera gasto
porque sigue siendo plata del usuario). Comprar una cajetilla es
consumo real: plata que sale de una cuenta y no vuelve — exactamente el
mismo tipo de hecho económico que comprar cualquier otra cosa. Ocultarlo
por completo del panorama financiero real del usuario (Transacciones,
Estadísticas, dona de categorías, Reportes) le negaría, a quien sí quiera
verlo ahí, la posibilidad de responder honestamente "¿cuánto de mi plata se
va en cigarrillos comparado con el resto de mis gastos?" — una pregunta
legítima para alguien que está tratando de dejar de fumar y de ordenar sus
finanzas al mismo tiempo.

Al mismo tiempo, **no se fuerza** como comportamiento default: muchos
usuarios van a preferir que Iron sea un espacio aislado, sin mezclar su
progreso de "dejar de fumar" con el resto de sus números — de ahí el
opt-in explícito, nunca automático, tal como pidió el Product Owner.

### 2.2 Qué NO cambia en Iron por tener este vínculo

El vínculo es **exclusivamente sobre la compra de la cajetilla** (el costo).
**Nunca** sobre el registro de consumo (`iron_cigarettes`): fumar un
cigarrillo entero o una mitad **jamás** genera ni toca nada financiero, con
o sin vínculo activo — no habría ninguna forma sensata de que "fumar un
cigarrillo" fuera, en sí mismo, un evento de gasto (el gasto ya ocurrió
cuando se compró la cajetilla). Esto simplifica el resto del documento: las
secciones 4/5/6 sobre consumo no vuelven a mencionar el vínculo en ningún
momento.

### 2.3 Categoría: "Tabaco" — categoría default nueva, resuelta por nombre

Mismo patrón exacto ya establecido para "Comisiones bancarias"/"Ajuste de
saldo" (`CLAUDE.md`, sección "Decisiones clave"): una categoría default
nueva (`user_id null`), sembrada por una migración, **resuelta por nombre**
dentro de la función RPC (`where user_id is null and lower(name) =
lower('Tabaco')`), nunca por un id hardcodeado en el cliente.

- **Nombre**: `Tabaco`.
- **Ícono**: `🚬` (mismo criterio que el resto de categorías default, un
  emoji literal en la columna `icon`).
- **Color**: hex nuevo, no reutilizado de ninguna categoría existente —
  se sugiere `#78716c` (gris cálido, familia "stone"), deliberadamente
  apagado/neutro en vez de un tono vivo: no es una categoría que el
  producto quiera "celebrar" visualmente como Comida u Ocio, es un gasto
  que el usuario probablemente está tratando de reducir. Queda a criterio
  de `supabase-backend-expert` correr `validate_palette.js` (skill de
  dataviz) con este hex sumado a los 12 ya sembrados antes de la migración
  final, mismo procedimiento que ya se sugirió, sin resolver aún, para el
  par Vivienda/Transporte (`dashboard-redesign-ux.md` sección 0.4) — no
  bloqueante para esta entrega.
- Esta categoría **nunca se muestra** como opción en el selector de
  categoría de `TransactionFormSheet` de forma diferenciada — es una
  categoría default más, igual que "Comida"/"Ocio"/etc.; el usuario podría
  incluso re-categorizar manualmente un gasto de tabaco después, sin que
  Iron se entere ni le importe (el vínculo es de una sola vía: Iron →
  `expenses`, nunca al revés).

### 2.4 El flujo completo — alta de cajetilla con vínculo activado

En el Sheet de alta de cajetilla (`IronPackFormSheet.vue`, sección 7):

```html
<div class="flex items-center justify-between gap-3">
  <Label for="link-toggle">Vincular a mis finanzas</Label>
  <Switch id="link-toggle" v-model:checked="form.linkToExpense" />
</div>
<p class="text-xs text-muted-foreground">
  Si lo activás, esta compra también se va a registrar como un gasto real
  en Transacciones y Estadísticas.
</p>

<div v-if="form.linkToExpense" class="flex flex-col gap-4">
  <Alert>
    <Info class="size-4" />
    <AlertDescription>
      Se va a crear un gasto de ${{ formatAmount(form.cost || 0) }} en la
      categoría "Tabaco", con la cuenta que elijas abajo.
    </AlertDescription>
  </Alert>

  <div class="flex flex-col gap-1.5">
    <Label for="cuenta-iron">Cuenta</Label>
    <Select v-model="form.accountId" :disabled="isSaving">
      <SelectTrigger id="cuenta-iron" class="h-11 w-full" :aria-invalid="!!errors.account">
        <SelectValue placeholder="Seleccioná una cuenta" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="account in accountsStore.accounts" :key="account.id" :value="account.id">
          <span class="size-2.5 rounded-full" :style="{ background: resolveAccountColor(account.color, isDarkNow) }" />
          {{ account.name }}
        </SelectItem>
      </SelectContent>
    </Select>
    <p v-if="errors.account" class="text-xs text-destructive">{{ errors.account }}</p>
  </div>
</div>
```

- `Switch` **default `false`** — nunca preseleccionado, exactamente lo que
  pidió el Product Owner.
- El `Alert` con el copy explícito **siempre visible mientras el toggle está
  activo** (no en un tooltip, no colapsado) — mismo criterio que el `Alert`
  de "Marcar como pagado" de Gastos fijos (`fixed-expenses-ux.md` sección 5):
  el usuario tiene que poder leer, sin buscar, exactamente qué va a pasar
  con su plata real antes de confirmar.
- **Cuenta**: obligatoria solo si el toggle está activo. Default: la cuenta
  del movimiento más reciente del usuario (mismo helper `defaultAccountId()`
  ya definido en `accounts-income-ux.md` sección 8.2), con fallback a
  "General". **Nunca hay un estado de "sin cuentas"**: todo usuario
  autenticado tiene al menos la cuenta "General", creada automáticamente en
  el signup (`accounts_init.sql`, trigger `handle_new_user`) — no hace
  falta ningún guard ni CTA de "creá tu primera cuenta" acá.
- Al desactivar el toggle (si estaba activo): el campo Cuenta se oculta y su
  valor se descarta, mismo criterio ya establecido para el `Switch` de
  Cuotas de Tarjetas (`credit-cards-ux.md` sección 5.2) — no queda
  "fantasma" guardado por error.
- **Guardado**: no optimista (sección 1.6) — botón "Registrar cajetilla" con
  estado de carga; si falla, `toast.error("No pudimos registrar la compra")`
  + "Reintentar", el Sheet permanece abierto con los datos tipeados.

### 2.5 Qué pasa si el usuario borra la compra en Iron

**Se revierte el `expense` — cascada explícita, no queda un gasto huérfano.**
Justificación y mecanismo exacto: sección 1.6, `delete_iron_pack`. Copy del
`AlertDialog` de confirmación cuando la compra a borrar está vinculada:

```
¿Eliminar esta cajetilla?
Esto también va a borrar el gasto de ${{ formatAmount(pack.cost) }} asociado
en Transacciones. Esta acción no se puede deshacer.
```

(Si la compra **no** está vinculada, el `AlertDialog` usa el copy genérico
ya estándar del proyecto: `¿Eliminar esta cajetilla? Esta acción no se puede
deshacer.` — sin mención de ningún gasto, porque no existe ninguno.)

### 2.6 Qué pasa si el usuario edita la compra (monto, fecha/hora, o el vínculo mismo)

Tres casos, todos resueltos por la misma función `update_iron_pack` (sección
1.6) para que el cliente nunca tenga que orquestar dos llamadas
secuenciales:

1. **Vínculo sin cambios** (estaba vinculada y sigue vinculada, o no lo
   estaba y sigue sin estarlo): si estaba vinculada, además de actualizar
   `iron_packs`, actualiza en la misma transacción el `amount`/fecha/cuenta
   del `expense` ya existente (mismo `expense_id`, **nunca se recrea** — a
   diferencia de `update_account_transfer`, que sí borra y recrea por la
   asimetría monto-vs-comisión que no existe acá: acá hay un único monto,
   un único `expense`, sin ninguna razón para no preservar su id). Si no
   estaba vinculada, es un update simple de una sola tabla.
2. **Activar el vínculo en una edición** (antes no vinculada, ahora sí):
   pide la Cuenta (mismo campo, mismo default, sección 2.4) y crea el
   `expense` nuevo en la misma transacción, dejando `linked_expense_id`
   resuelto.
3. **Desactivar el vínculo en una edición** (antes vinculada, ahora no):
   borra el `expense` existente y pone `linked_expense_id = null`. Copy de
   advertencia en el Sheet, visible solo si el usuario apaga el toggle
   durante una edición:

   ```
   Si desactivás esto, el gasto de ${{ formatAmount(pack.cost) }} va a
   desaparecer de Transacciones y Estadísticas.
   ```

Caso 1 y 3 son **no optimistas** (tocan `expenses`); si la compra nunca
estuvo ni queda vinculada, la edición es un update optimista simple.

### 2.7 Beneficio colateral de este diseño: cero trabajo extra de integración

A diferencia de los movimientos de Deuda vinculados a una cuenta (que
**nunca** generan una fila real en `expenses`, y por eso `debts-ux.md`
sección 13 necesitó lógica dedicada para "mezclarlos" sintéticamente dentro
de Transacciones/Inicio), una compra de cajetilla vinculada en Iron **es**
un `expenses` real, indistinguible de cualquier otro gasto salvo por su
categoría "Tabaco". Esto significa que Transacciones, la dona de categorías,
Estadísticas y Reportes ya lo van a mostrar correctamente **sin ningún
cambio de código en esas pantallas** — ninguna de ellas necesita enterarse
de que Iron existe. Vale la pena dejarlo explícito para que
`vue-frontend-expert` no busque, por error, un punto de integración que no
hace falta.

---

## 3. Arquitectura de rutas y entrada en el drawer

### 3.1 Tres rutas — panorama, historial, tendencias

Mismo ejercicio de calibración que el resto de features (`debts-ux.md`
sección 2, `credit-cards-ux.md` sección 8): ni una sola pantalla
sobrecargada, ni más rutas de las que hacen falta. El encargo pide tres
superficies con propósitos claramente distintos — panorama con accesos
rápidos, historial navegable día a día, y tendencias por período — que
mapean 1:1 con el precedente ya establecido de separar Inicio/Transacciones/
Estadísticas en `dashboard-redesign-ux.md`. Se usa la misma separación acá,
sin inventar un criterio nuevo:

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/iron` | `iron` | `{ requiresAuth: true }` | `IronDashboardView` |
| `/iron/historial` | `iron-history` | `{ requiresAuth: true }` | `IronHistoryView` |
| `/iron/tendencias` | `iron-trends` | `{ requiresAuth: true }` | `IronTrendsView` |

Todas usan el `AppHeader` compartido (`docs/design-system.md` sección 6):
sin botón "Volver", el drawer (`Menu`) es el único mecanismo de navegación
entre secciones, igual que el resto de la app.

### 3.2 Entrada en el drawer: nombre, ícono y posición

**Nombre del ítem: "Iron"**, tal cual lo nombró el Product Owner — no se
traduce ni se reemplaza por una etiqueta descriptiva genérica tipo "Dejar de
fumar". Es un nombre de producto deliberado (evoca "voluntad de hierro"),
mismo criterio de que la marca del proyecto entero sigue siendo "TipApp"
sin que eso le impida a una sub-sección tener su propio nombre corto —
ningún otro ítem del drawer necesita esto (todos son descriptivos), pero
"Iron" es, a propósito, la excepción. Para no perder claridad semántica
pese a ser un nombre no descriptivo en español, el **header de las 3
pantallas** (no el ítem del drawer, que se mantiene compacto como el resto)
lleva un subtítulo aclaratorio la primera vez que hace falta (sección 4.1).

**Ícono**: `Cigarette` (confirmado en
`node_modules/@lucide/vue/dist/esm/icons/cigarette.mjs`) — literal y sin
ambigüedad, mismo criterio que `Goal` para "Partidos en vivo"
(`live-matches-ux.md` sección 7).

**Posición**: mismo criterio de "bloque mental" ya usado para ubicar
"Partidos en vivo" (`live-matches-ux.md` sección 7): Iron **no** es un
dominio de movimiento de dinero (posiciones 2-5 del drawer) ni de
clasificación/análisis de esos movimientos (Categorías/Estadísticas/
Reportes) ni Ajustes — es, igual que Partidos en vivo, una utilidad
personal ortogonal a las finanzas. Se suma al **mismo tercer bloque**
("utilidad, no financiero") en vez de inventar un cuarto bloque para un
único ítem nuevo, inmediatamente **después** de "Partidos en vivo" (el
ítem ya existente de ese bloque):

```
1. Inicio
2. Transacciones
3. Tarjetas de crédito
4. Cuentas
5. Transferencias
6. Deudas
7. Gastos fijos
8. Préstamos
9. Partidos en vivo   ← bloque utilidad, ya resuelto por live-matches-ux.md
10. Iron              ← nuevo, mismo bloque, inmediatamente después
11. Categorías
12. Estadísticas
13. Reportes
14. Ajustes
```

**Nota para `vue-frontend-expert`**: al momento de escribir este documento,
`src/components/NavigationDrawer.vue` **no** tiene todavía el ítem
"Partidos en vivo" wireado (tiene un comentario que dice explícitamente lo
contrario de lo que ya resolvió `live-matches-ux.md` sección 7 — parece una
discrepancia entre ese doc y el código, no algo que corresponda arreglar
acá). Insertar "Iron" **inmediatamente después de "Deudas"** si "Partidos en
vivo" todavía no está en el código al momento de implementar esta feature,
o inmediatamente después de "Partidos en vivo" si ya se agregó — en ambos
casos el resultado visual es "el bloque de utilidad no financiera va justo
después del bloque de dinero y antes de Categorías", que es lo único que
importa de esta decisión. Confirmar el estado real del drawer con
`vue-frontend-expert` antes de tocarlo.

```html
<!-- Insertar en el <nav> de NavigationDrawer.vue -->
<button
  type="button"
  class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :class="isActive('iron') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
  :aria-current="isActive('iron') ? 'page' : undefined"
  @click="navigateFromDrawer('iron')"
>
  <Cigarette class="size-5 shrink-0" />
  Iron
</button>
```

`isActive('iron')` debe devolver `true` también cuando `route.name` es
`'iron-history'`/`'iron-trends'` (las 3 rutas de la feature resaltan el
mismo ítem del drawer) — mismo criterio que cualquier sub-ruta de una
sección (p. ej. `debt-detail` resalta el mismo ítem que `debts`).

---

## 4. `/iron` — Dashboard (panorama + accesos rápidos)

### 4.1 Header

```html
<AppHeader title="Iron" />
```

Debajo del header, un subtítulo corto **solo en esta pantalla** (no se
repite en Historial/Tendencias, que ya heredan contexto de estar dentro de
la sección) que aclara el propósito para quien no conozca el nombre:

```html
<p class="px-4 pt-3 text-sm text-muted-foreground sm:px-6 lg:px-8">
  Registrá tu consumo de tabaco y seguí tu progreso.
</p>
```

### 4.2 Wireframe (mobile, ~375px)

```
┌─────────────────────────────────┐
│ ☰   Iron                        │  ← AppHeader
├─────────────────────────────────┤
│ Registrá tu consumo de tabaco y │
│ seguí tu progreso.              │
│                                  │
│ ┌─ (solo si hay mitad pendiente)│
│ │ 🕐 Tenés una mitad pendiente │
│ │    Empezada hoy a las 14:32  │
│ │           [×]  [Fumé la otra│
│ │                  mitad]      │
│ └──────────────────────────────┘│
│                                  │
│ ┌────────────┐┌────────────────┐│
│ │  🚬        ││  🚬 ½          ││
│ │ Fumé uno   ││ Fumé la mitad  ││
│ │  entero    ││                ││
│ └────────────┘└────────────────┘│
│ [ 📦 Registrar cajetilla comprada ]│
│                                  │
│ ┌─ Hoy ──────────────────────┐  │
│ │ 3,5 cigarrillos            │  │
│ └────────────────────────────┘  │
│ ┌─ Este mes ─────────────────┐  │
│ │ $ 14.500 en tabaco (compras)│  │
│ └────────────────────────────┘  │
│                                  │
│ [ Ver historial completo → ]    │
│ [ Ver tendencias → ]            │
└─────────────────────────────────┘
```

### 4.3 Banner de mitad pendiente — el estado que la sección 1.3 expone

**Es lo primero que se ve en la pantalla cuando existe**, arriba de los
accesos rápidos — no un ícono chico ni un badge escondido. Datos: `select *
from iron_current_status where user_id = :uid` al montar la vista (junto
con el resto del fetch inicial).

```html
<Card v-if="pendingHalf" class="border-warning/30 bg-warning/5">
  <div class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
    <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
      <Clock class="size-4" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col">
      <p class="text-sm font-medium">Tenés una mitad pendiente</p>
      <p class="text-xs text-muted-foreground">Empezada {{ pendingSinceLabel }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <Button
        size="icon"
        variant="ghost"
        class="h-11 w-11"
        aria-label="Descartar mitad pendiente"
        @click="discardPendingHalf"
      >
        <X class="size-4" />
      </Button>
      <Button class="h-11" @click="closePendingHalf">
        Fumé la otra mitad
      </Button>
    </div>
  </div>
</Card>
```

- Color `warning` (ámbar): no es una mala noticia (`destructive`) ni una
  buena (`success`) — es un recordatorio accionable, mismo criterio
  semántico ya definido en `design-system.md` sección 1 para este token.
  Nunca es el único indicador: el ícono `Clock` + el texto "Tenés una mitad
  pendiente" acompañan siempre al color (regla de a11y general).
- `pendingSinceLabel`: reusa el criterio de fecha relativa ya existente en
  el proyecto (`formatExpenseDateHeading`-equivalente: "hoy a las 14:32" /
  "ayer a las 22:10" / "12 de julio a las 09:00"), combinando
  `pending_since_date` + `formatTimeShort(pending_since_time)` (helper ya
  existente en `src/lib/date.ts`).
- **Botón "Descartar" con `X`**: llama a `discard_pending_half` (sección
  1.4). Sin `AlertDialog` de confirmación — no es una acción destructiva de
  datos reales (no borra ninguna fila, solo cambia un estado), y ya
  funciona con el mismo mecanismo de "Deshacer" por toast que el resto de
  las acciones rápidas de esta pantalla (sección 4.4) en vez de un modal
  bloqueante.
- **Botón "Fumé la otra mitad"**: llama a `close_pending_half`.
- Ambos botones con altura explícita `h-11` (44px) — el tamaño `default` de
  `Button` ya cumple esto, se deja explícito en el snippet porque conviven
  en una fila apretada junto al ícono de descartar.

### 4.4 Accesos rápidos — sin Sheet, un toque, con "Deshacer"

**Decisión de diseño explícita, distinta del patrón Sheet-por-defecto del
resto del proyecto**: registrar un cigarrillo entero o una mitad es, por
naturaleza, una acción de **muy alta frecuencia** (potencialmente 10-40
veces por día para un usuario real) — muy distinta en perfil de uso a dar de
alta un gasto, una deuda o una tarjeta (unas pocas veces por semana). Abrir
un Sheet, completar un formulario y confirmar en cada uno de esos toques
sería fricción real que empujaría al usuario a abandonar el registro
(exactamente lo contrario de lo que esta feature necesita para servir a su
propósito: cuantos más registros reales, más útil la tendencia). Se decide
que estas dos acciones son **de un solo toque, sin formulario**:

```html
<div class="grid grid-cols-2 gap-3">
  <button
    type="button"
    class="flex min-h-11 flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    @click="logWhole"
  >
    <Cigarette class="size-6" />
    <span class="text-sm font-medium">Fumé uno entero</span>
  </button>

  <button
    type="button"
    class="relative flex min-h-11 flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    :disabled="!!pendingHalf"
    @click="logHalf"
  >
    <span class="relative">
      <Cigarette class="size-6" />
      <span class="absolute -right-1.5 -top-1.5 rounded-full bg-muted px-1 text-[9px] font-bold leading-tight text-muted-foreground">½</span>
    </span>
    <span class="text-sm font-medium">Fumé la mitad</span>
  </button>
</div>
<p v-if="pendingHalf" class="text-center text-xs text-muted-foreground">
  Cerrá la mitad pendiente de arriba antes de empezar una nueva.
</p>

<Button variant="outline" class="h-11 w-full" @click="openPackSheet">
  <Package class="size-4" />
  Registrar cajetilla comprada
</Button>
```

- **"Fumé uno entero"**: siempre habilitado, sin relación con el estado de
  mitad pendiente (un cigarrillo entero es un evento independiente — nada
  impide fumar uno entero mientras hay una mitad guardada para después,
  sección 1.2).
- **"Fumé la mitad"**: **deshabilitado mientras ya hay una mitad
  pendiente** (regla dura de la sección 1.3: nunca dos mitades abiertas a
  la vez) — con el texto explicativo debajo del grid, nunca un botón
  deshabilitado sin explicación (mismo criterio de a11y de nunca dejar un
  control inerte sin razón visible).
- **Al tocar cualquiera de los dos**: insert optimista inmediato a
  `iron_cigarettes` (`smoked_date`/`smoked_time` = ahora, vía
  `todayDateInputValue()`/`nowTimeInputValue()` ya existentes en
  `src/lib/date.ts`) + toast con acción "Deshacer":

  ```ts
  toast('Cigarrillo registrado', {
    action: { label: 'Deshacer', onClick: () => undoLog(newRow.id) },
    duration: 5000,
  })
  // análogo para la mitad: toast('Media registrada', { action: {...} })
  ```

  Si el insert falla: rollback del estado local + `toast.error("No pudimos
  registrar esto")` con acción "Reintentar" (mismo patrón de siempre) — el
  toast de "Deshacer" y el de error nunca aparecen a la vez, son ramas
  mutuamente excluyentes del mismo intento.
- **"Deshacer" es un patrón nuevo en el proyecto** (no existía antes):
  se justifica específicamente por ser la primera acción de la app que se
  ejecuta con **cero pasos de confirmación** — el mismo espíritu de "nunca
  una acción sin red de seguridad" que en el resto del proyecto se resuelve
  con `AlertDialog` (design-system.md sección 5.7), pero un modal en cada
  toque destruiría la fricción cero que esta acción necesita. El toast con
  "Deshacer" cumple el mismo rol de red de seguridad sin bloquear la
  interacción.
- **"Registrar cajetilla comprada"**: sí abre un Sheet completo
  (`IronPackFormSheet`, sección 7) — frecuencia mucho menor (una vez cada
  varios días), con más campos y una decisión real (el vínculo a cuentas,
  sección 2) que sí amerita el patrón estándar del proyecto.

### 4.5 Resumen de hoy / este mes — sin deltas inventados

```html
<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
  <Card>
    <div class="flex flex-col gap-1 px-4 py-4 sm:px-6">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hoy</p>
      <p class="text-2xl font-bold tabular-nums tracking-tight">{{ todayCigaretteLabel }}</p>
    </div>
  </Card>
  <Card>
    <div class="flex flex-col gap-1 px-4 py-4 sm:px-6">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Este mes</p>
      <p class="text-2xl font-bold tabular-nums tracking-tight">${{ formatAmount(monthPackSpend) }}</p>
      <p class="text-xs text-muted-foreground">en compras de tabaco</p>
    </div>
  </Card>
</div>
```

- **`todayCigaretteLabel`**: `"3,5 cigarrillos"` (formato es-AR, coma
  decimal, mismo `Intl.NumberFormat` que `formatAmount`) o, en el caso
  particular de exactamente `0.5`, el copy más natural `"Medio cigarrillo"`
  en vez de `"0,5 cigarrillos"`. Singular correcto para `1`: `"1
  cigarrillo"`.
- **`monthPackSpend`**: suma de `iron_packs.cost` del mes calendario en
  curso — **siempre disponible, esté o no vinculada la compra a un gasto
  real** (sección 2.7: el costo informativo de Iron es independiente del
  vínculo opcional). Query acotada por fecha (`purchased_date` dentro del
  mes), no una suma sin límite.
- **Deliberadamente sin ningún delta "vs. ayer"/"vs. el mes pasado" en esta
  pantalla**: comparar un día o un mes **todavía en curso** contra un
  período ya cerrado es engañoso (a las 9am, "fumaste 90% menos que ayer"
  sería una falsa buena noticia solo porque el día recién empieza) —
  mismo espíritu de "nunca inventar/aproximar un número cuando el dato de
  base está incompleto" que ya aplica `isMonthSafeToShow` en
  `dashboard-redesign-ux.md` sección 1, llevado un paso más allá acá: ni
  siquiera se intenta. Las comparaciones de tendencia real viven,
  exclusivamente, en `/iron/tendencias` (sección 6), sobre períodos ya
  cerrados.
- Si el usuario no compró nunca ninguna cajetilla: la card de "Este mes" no
  desaparece, muestra `$0` (dato real, no un placeholder) — a diferencia de
  otras cards del proyecto que se ocultan en cero, acá `$0` es información
  útil por sí misma ("todavía no gastaste nada este mes en tabaco").

### 4.6 Accesos a Historial/Tendencias

```html
<div class="flex flex-col gap-2">
  <Button variant="outline" class="h-11 w-full justify-between" @click="router.push({ name: 'iron-history' })">
    Ver historial completo
    <ChevronRight class="size-4" />
  </Button>
  <Button variant="outline" class="h-11 w-full justify-between" @click="router.push({ name: 'iron-trends' })">
    Ver tendencias
    <ChevronRight class="size-4" />
  </Button>
</div>
```

### 4.7 Estados de carga/vacío/error

- **Carga**: `Skeleton` en el banner (si aplica), grid de accesos rápidos y
  las 2 cards de resumen — mismo criterio del resto de la app.
- **Error**: `AlertCircle` + `"No pudimos cargar tu información de Iron"` +
  "Reintentar".
- **Vacío** (usuario sin ningún registro todavía, `iron_cigarettes` e
  `iron_packs` ambas vacías): a diferencia de otros dashboards del
  proyecto, **los accesos rápidos siguen mostrándose igual** (son la
  interacción principal de la pantalla, no un resumen de datos existentes)
  — se agrega, debajo del subtítulo de la sección 4.1, una línea extra:
  `"Todavía no registraste nada. Empezá tocando un botón de abajo."` Las
  cards de resumen muestran `"0 cigarrillos"` / `"$0"` (datos reales, no se
  ocultan), y los botones "Ver historial completo"/"Ver tendencias" siguen
  visibles pero llevan a un estado vacío propio en esas pantallas
  (secciones 5.5/6.5).

---

## 5. `/iron/historial` — historial completo, navegable día a día

### 5.1 Header

```html
<AppHeader title="Historial" />
```

### 5.2 Navegador de día

```html
<div class="flex items-center justify-between gap-2 border-b border-border px-2 py-2 sm:px-4">
  <Button variant="ghost" size="icon" class="h-11 w-11" aria-label="Día anterior" @click="goToPreviousDay">
    <ChevronLeft class="size-5" />
  </Button>

  <button
    type="button"
    class="relative flex-1 rounded-md py-2 text-center text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    @click="openDatePicker"
  >
    {{ dayLabel }}
    <input
      ref="datePickerInput"
      type="date"
      class="absolute inset-0 opacity-0"
      :max="todayDateInputValue()"
      :value="selectedDate"
      @change="onPickDate"
    />
  </button>

  <Button variant="ghost" size="icon" class="h-11 w-11" aria-label="Día siguiente" :disabled="isViewingToday" @click="goToNextDay">
    <ChevronRight class="size-5" />
  </Button>
</div>
<Button v-if="!isViewingToday" variant="link" size="sm" class="mx-auto block h-auto p-0" @click="goToToday">
  Volver a hoy
</Button>
```

- Mismo truco de input nativo invisible superpuesto ya usado para la
  píldora de fecha de `TransactionFormSheet` (`transaction-time-ux.md`
  sección 1) — tocar el label del día abre el date picker nativo para
  saltar directo a cualquier fecha, no solo avanzar de a un día.
- `dayLabel`: `"Hoy"` / `"Ayer"` / `"12 de julio"` — reusa el mismo formato
  relativo que `formatExpenseDateHeading` ya resuelve en el resto de la
  app.
- Flecha "día siguiente" deshabilitada al llegar a hoy (nunca se navega al
  futuro, mismo criterio de "nunca fechas futuras" del resto del proyecto)
  — con `disabled`, no oculta, para que el usuario entienda que llegó al
  límite en vez de que el botón desaparezca sin explicación.
- Query del día: `iron_cigarettes`/`iron_packs` filtrados por
  `smoked_date`/`purchased_date = selectedDate`, con `.limit(200)`
  defensivo (mismo hábito preventivo del resto del proyecto, aunque un solo
  día real jamás se acerque a ese número).

### 5.3 Lista mixta del día — mismo patrón de ledger mezclado que Deudas

Un solo listado cronológico (por hora), mezclando compras de cajetilla y
consumos — mismo criterio que el tab "Historial" de `/deudas`
(`debts-ux.md` sección 3.6: eventos de distinto tipo, mismo timeline,
ordenados por hora real).

```html
<div class="flex flex-col">
  <template v-for="(item, idx) in dayItems" :key="item.id">
    <Separator v-if="idx > 0" />

    <!-- Compra de cajetilla -->
    <button
      v-if="item.type === 'pack'"
      type="button"
      class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      @click="openEditPackSheet(item)"
    >
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Package class="size-4 text-muted-foreground" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="text-sm font-medium">Cajetilla comprada</p>
        <p class="truncate text-xs text-muted-foreground">
          {{ formatTimeShort(item.time) }}
          <span v-if="item.linkedAccountName">· <Wallet class="inline size-3" /> {{ item.linkedAccountName }}</span>
        </p>
      </div>
      <p class="shrink-0 text-sm font-semibold tabular-nums">${{ formatAmount(item.cost) }}</p>
    </button>

    <!-- Cigarrillo entero -->
    <div v-else-if="item.type === 'entero'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Cigarette class="size-4 text-muted-foreground" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="text-sm font-medium">Cigarrillo entero</p>
        <p class="text-xs text-muted-foreground">{{ formatTimeShort(item.time) }}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="h-11 w-11" aria-label="Más opciones">
            <MoreVertical class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem @click="openEditCigaretteSheet(item)">Editar hora</DropdownMenuItem>
          <DropdownMenuItem class="text-destructive" @click="confirmDeleteCigarette(item)">Eliminar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Mitad pendiente (todavía abierta) -->
    <div v-else-if="item.type === 'mitad_pendiente'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
        <Clock class="size-4" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="text-sm font-medium">Media (pendiente)</p>
        <p class="text-xs text-muted-foreground">{{ formatTimeShort(item.time) }}</p>
      </div>
      <Button size="sm" class="h-11 shrink-0" @click="closePendingHalf(item.id)">Cerrar</Button>
    </div>

    <!-- Mitad descartada -->
    <div v-else-if="item.type === 'mitad_descartada'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <CigaretteOff class="size-4 text-muted-foreground" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="text-sm font-medium">Media (no terminada)</p>
        <p class="text-xs text-muted-foreground">{{ formatTimeShort(item.time) }}</p>
      </div>
    </div>

    <!-- Mitad completa: ambas partes el MISMO día -> fila fusionada -->
    <div v-else-if="item.type === 'mitad_completa_mismo_dia'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Cigarette class="size-4 text-muted-foreground" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="text-sm font-medium">1 cigarrillo (en 2 partes)</p>
        <p class="text-xs text-muted-foreground">{{ formatTimeShort(item.firstTime) }} y {{ formatTimeShort(item.secondTime) }}</p>
      </div>
    </div>

    <!-- Mitad completa: la otra parte fue OTRO día -> fila propia con referencia cruzada -->
    <div v-else-if="item.type === 'mitad_completa_otro_dia'" class="flex min-h-11 w-full items-center gap-3 px-4 py-3">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Cigarette class="size-4 text-muted-foreground" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="text-sm font-medium">{{ item.isFirstHalf ? 'Media' : 'Segunda mitad' }}</p>
        <p class="text-xs text-muted-foreground">
          {{ formatTimeShort(item.time) }} ·
          {{ item.isFirstHalf ? 'cerrada el' : 'empezada el' }} {{ item.otherDayLabel }}
        </p>
      </div>
    </div>
  </template>
</div>
```

- **Sin menú "⋮" en compras/mitades**: la compra abre directo su Sheet de
  edición al tocar la fila (misma navegación de un solo tap que
  `cardsRanking`/filas de hilo de deuda); las mitades (pendiente/descartada/
  completa) **no son editables** más allá de su hora — para simplificar,
  esta versión no ofrece edición de hora en mitades desde acá (si el
  usuario se equivocó, borra y vuelve a registrar, mismo criterio de "no
  sobre-construir" ya aplicado a otras decisiones de este documento); el
  cigarrillo **entero** sí lleva menú "⋮" con "Editar hora"/"Eliminar" por
  ser el caso más simple y frecuente de corrección.
- **Editar hora de un entero**: Sheet mínimo (`Input type="date"` + `Input
  type="time"`, `max` = hoy) — no se puede cambiar `kind` (entero ↔ mitad)
  después de creado (fuera de alcance, ver encabezado).
- **Eliminar un entero**: `AlertDialog` estándar, delete optimista simple
  (una sola tabla).
- **Eliminar la primera mitad de un par ya cerrado**: `AlertDialog` con
  copy `"¿Eliminar este registro? La segunda mitad vinculada va a quedar
  como un registro independiente."` — no se cascadea el borrado a la
  segunda mitad (`closes_cigarette_id on delete set null`, sección 1.7):
  se prioriza no borrar más datos de los que el usuario pidió explícitamente
  borrar.
- **Compra de cajetilla vinculada**: el badge `Wallet` + nombre de cuenta
  (idéntico patrón visual a `debts-ux.md` sección 3.6) marca visualmente
  que esa compra también generó un gasto real.

### 5.4 Resumen del día (cabecera del listado, si hay algo que resumir)

```html
<div v-if="dayItems.length" class="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground sm:px-6">
  <span>{{ dayCigaretteLabel }}</span>
  <span v-if="dayPackSpend > 0">${{ formatAmount(dayPackSpend) }} en compras</span>
</div>
```

### 5.5 Estados de carga/vacío/error

- **Carga**: `Skeleton` de 3-4 filas.
- **Error**: `AlertCircle` + "No pudimos cargar el historial de este día" +
  "Reintentar".
- **Vacío** (el día seleccionado no tiene ningún registro): mensaje corto
  centrado, `"Sin registros este día."` — el navegador de día sigue
  funcionando con normalidad (no bloquea seguir navegando a otros días).

---

## 6. `/iron/tendencias` — diario, semanal, mensual

### 6.1 Header y Tabs

```html
<AppHeader title="Tendencias" />

<Tabs v-model="granularity" default-value="daily">
  <TabsList class="grid w-full grid-cols-3">
    <TabsTrigger value="daily">Diario</TabsTrigger>
    <TabsTrigger value="weekly">Semanal</TabsTrigger>
    <TabsTrigger value="monthly">Mensual</TabsTrigger>
  </TabsList>

  <TabsContent value="daily"><!-- sección 6.3, ventana 30 días --></TabsContent>
  <TabsContent value="weekly"><!-- sección 6.3, ventana 12 semanas --></TabsContent>
  <TabsContent value="monthly"><!-- sección 6.3, ventana 12 meses --></TabsContent>
</Tabs>
```

Reusa `Tabs` (ya instalado desde `debts-ux.md` sección 3.4) — mismo
criterio: son 3 paneles de contenido completos (no un campo de formulario),
exactamente el caso de uso para el que existe el primitivo.

Default: **"Diario"** — es la vista más inmediatamente accionable para el
día a día de dejar de fumar (a diferencia de Deudas, donde "Yo presté" es
el default por espejar el orden de las cards resumen; acá no hay un orden
heredado de otra sección, así que se elige el más útil).

### 6.2 Contenido de cada pestaña: dos gráficos, cantidad y gasto

```html
<div class="flex flex-col gap-4">
  <Card>
    <CardHeader>
      <CardTitle class="text-base font-semibold">Cantidad de cigarrillos</CardTitle>
      <CardDescription>{{ windowLabel }}</CardDescription>
    </CardHeader>
    <div class="px-4 pb-6 sm:px-6">
      <TrendAreaChart
        :points="cigaretteCountPoints"
        :height="160"
        show-axis
        max-label-formatter="count"
        :aria-label="`Cigarrillos fumados, ${windowLabel}`"
      />
    </div>
  </Card>

  <Card v-if="hasAnyPackEver">
    <CardHeader>
      <CardTitle class="text-base font-semibold">Gasto en tabaco</CardTitle>
      <CardDescription>{{ windowLabel }} · compras de cajetilla</CardDescription>
    </CardHeader>
    <div class="px-4 pb-6 sm:px-6">
      <TrendAreaChart
        :points="packSpendPoints"
        :height="160"
        show-axis
        :aria-label="`Gasto en tabaco, ${windowLabel}`"
      />
    </div>
  </Card>
</div>
```

- **Se reusa `TrendAreaChart.vue` tal cual existe hoy** para ambos
  gráficos (no se crea un componente nuevo — a diferencia de `DualTrendChart`
  en `debts-ux.md`, acá no hace falta normalizar dos series en el mismo
  eje: son dos gráficos **separados**, cada uno de una sola serie, que es
  exactamente el contrato que `TrendAreaChart` ya soporta). Ver sección 6.4
  para las dos extensiones mínimas de props que sí hacen falta.
- **Nunca cumulativo**: a diferencia del hero de Inicio (que muestra la
  curva acumulada a propósito para reforzar el total del mes), acá el
  punto entero de la feature es ver la forma día a día/semana a semana —
  una curva acumulada solo puede subir y ocultaría si el usuario está
  bajando el consumo. Cada punto es el total **discreto** de ese bucket.
- **"Gasto en tabaco" se oculta por completo si el usuario nunca compró
  ninguna cajetilla** (`hasAnyPackEver`, un chequeo simple de "¿existe
  alguna fila en `iron_packs`?", no depende de la ventana actual) — evita
  mostrar para siempre un gráfico en cero a quien directamente no usa esa
  parte de Iron.
- Si la ventana tiene menos de 2 puntos con datos reales (usuario muy
  nuevo): se oculta el gráfico correspondiente y se muestra en su lugar
  `"Todavía no hay suficiente historial para mostrar la tendencia."` —
  mismo criterio exacto que el bloque "Por mes" de Estadísticas
  (`dashboard-redesign-ux.md` sección 4.3).
- **Sin badge de delta/porcentaje en ningún lado de esta pantalla**: el
  usuario lee la forma de la curva con sus propios ojos (subiendo/bajando)
  — mismo argumento de "no inventar comparaciones sobre datos que pueden
  estar incompletos" de la sección 4.5, extendido acá: incluso con
  ventanas ya cerradas, agregar un "-12% esta semana" es una precisión que
  el encargo no pidió y que puede sonar más autoritativa de lo que el dato
  realmente es (dos semanas de una persona fumando es una muestra chica
  para hablar de porcentajes con confianza).

### 6.3 Ventanas por pestaña

| Pestaña | Ventana | Bucket | Fuente |
|---|---|---|---|
| Diario | Últimos 30 días corridos (no atado al mes calendario) | 1 día | `iron_daily_totals`/`iron_pack_daily_totals` (sección 1.7) |
| Semanal | Últimas 12 semanas ISO (lunes a domingo) | 1 semana | análogas agrupadas por `date_trunc('week', ...)` |
| Mensual | Últimos 12 meses calendario | 1 mes | análogas agrupadas por `date_trunc('month', ...)` |

`windowLabel`: `"Últimos 30 días"` / `"Últimas 12 semanas"` / `"Últimos 12
meses"` respectivamente — texto fijo, no depende de fechas exactas
(consistente con "Últimos 12 meses" ya usado tal cual en `debts-ux.md`
sección 3.8).

### 6.4 Dos extensiones mínimas necesarias en `TrendAreaChart.vue`

A diferencia de `DualTrendChart` (que se justificó como componente
**nuevo** porque tenía 3 diferencias de comportamiento reales: color fijo
por serie, normalización compartida entre 2 series, y granularidad mensual
en vez de diaria — `debts-ux.md` sección 3.8), acá **no hace falta un
componente nuevo**: las necesidades de Iron son puramente de **formato de
etiqueta**, no de comportamiento del gráfico en sí. Se agregan dos props
opcionales, no rompen ningún consumidor existente (Inicio/Estadísticas
siguen funcionando exactamente igual sin pasarlas):

1. **Etiqueta de eje X pre-formateada por punto**: hoy
   `formatAxisLabel(dateStr)` asume `'YYYY-MM-DD'` y muestra solo el día del
   mes — funciona para Inicio/Estadísticas (siempre días de un mes) pero no
   sirve para semanas/meses. Se agrega `label?: string` opcional a cada
   punto (mismo campo que `DualTrendPoint.label` ya usa en
   `debts-ux.md`/`src/lib/charts.ts` — se reusa la misma convención, no se
   inventa una nueva). Si `points[i].label` está presente, se usa
   directamente; si no, cae al comportamiento actual (parsear `date`). Iron
   pasa `label` siempre: día del mes para "Diario" (mismo criterio que ya
   usa Estadísticas), `"Sem 28/7"` (fecha de inicio de esa semana) para
   "Semanal", `"Ene"`/`"Feb"`/... (reusando la constante `MONTHS_ES_SHORT`
   ya definida en `src/lib/charts.ts`) para "Mensual".
2. **Formato del techo del eje Y**: hoy `maxAmountLabel` es
   `"Hasta $${formatAmount(max)}"`, con el símbolo `$` hardcodeado — tiene
   sentido para dinero, no para una cantidad de cigarrillos. Se agrega una
   prop opcional `maxLabelFormatter?: (max: number) => string`, default el
   comportamiento actual (`` `Hasta $${formatAmount(max)}` ``) para no
   romper a nadie. El gráfico de "Cantidad de cigarrillos" de Iron pasa
   `(max) => \`Hasta ${formatCigaretteCount(max)}\`` (p. ej. `"Hasta 14
   cigarrillos"`); el de "Gasto en tabaco" no pasa nada (usa el default de
   `$`, es dinero real).

Ambos cambios son aditivos y opcionales — cero riesgo de regresión en los
usos ya existentes de `TrendAreaChart` (Inicio, Estadísticas, Cuentas). Se
recomienda a `vue-frontend-expert` implementarlos como parte de esta
feature en vez de forkear el componente.

### 6.5 Nuevo helper `src/lib/iron.ts`

Mismo criterio que `src/lib/charts.ts` (sin dependencias de store, recibe
datos ya cargados, sin llamar a Supabase):

- `formatCigaretteCount(count: number): string` — `"3,5 cigarrillos"` /
  `"1 cigarrillo"` / `"Medio cigarrillo"` para exactamente `0.5`.
- `buildIronTrendSeries(buckets, windowStart, windowEnd, granularity):
  TrendPoint[]` — rellena huecos a `0` dentro de la ventana pedida, mismo
  criterio que `buildDailySeries`, con el campo `label` ya resuelto según
  la granularidad (sección 6.4).
- `pendingSinceLabel(date: string, time: string, reference = new Date()):
  string` — usado en las secciones 4.3/5.3.

### 6.6 Estados de carga/vacío/error

- **Carga**: `Skeleton` de los 2 gráficos.
- **Error**: `AlertCircle` + "No pudimos cargar las tendencias" +
  "Reintentar".
- **Vacío total** (usuario sin ningún registro): mismo mensaje de "sin
  suficiente historial" de la sección 6.2, para ambos gráficos.

---

## 7. Sheet de alta/edición de cajetilla — `IronPackFormSheet.vue`

### 7.1 Campos

```html
<SheetHeader>
  <SheetTitle>{{ isEditing ? 'Editar cajetilla' : 'Registrar cajetilla comprada' }}</SheetTitle>
</SheetHeader>

<div class="flex flex-col gap-4 px-4 sm:px-6">
  <div class="flex flex-col gap-1.5">
    <Label for="costo">Costo</Label>
    <div class="relative">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input id="costo" type="number" inputmode="decimal" min="0.01" step="0.01" class="h-11 pl-7 text-lg font-semibold" v-model.number="form.cost" :aria-invalid="!!errors.cost" />
    </div>
    <p v-if="errors.cost" class="text-xs text-destructive">{{ errors.cost }}</p>
  </div>

  <div class="flex gap-3">
    <div class="flex flex-1 flex-col gap-1.5">
      <Label for="fecha-cajetilla">Fecha</Label>
      <Input id="fecha-cajetilla" type="date" class="h-11 text-base" :max="todayDateInputValue()" v-model="form.date" />
    </div>
    <div class="flex flex-1 flex-col gap-1.5">
      <Label for="hora-cajetilla">Hora</Label>
      <Input id="hora-cajetilla" type="time" class="h-11 text-base" v-model="form.time" />
    </div>
  </div>

  <!-- Switch + campos condicionales de vínculo, sección 2.4 -->
</div>

<SheetFooter>
  <Button class="h-11 w-full" :disabled="isSaving" @click="onSubmit">
    {{ isEditing ? 'Guardar cambios' : 'Registrar cajetilla' }}
  </Button>
</SheetFooter>
```

- **Default en alta**: `form.cost` vacío (sin prefill que induzca un
  número), `form.date`/`form.time` = ahora (`todayDateInputValue()`/
  `nowTimeInputValue()`, mismo hook `resetForm()` al abrir el Sheet, mismo
  criterio que `transaction-time-ux.md` sección 3), `form.linkToExpense =
  false` siempre (nunca recuerda la última elección — cada compra es una
  decisión consciente nueva, evita que el usuario vincule una compra por
  inercia sin darse cuenta).
- **Validación**: costo > 0 (mensaje `"Ingresá un costo válido"`); si
  `linkToExpense` está activo, cuenta obligatoria (`"Elegí una cuenta"`).
  Fecha nunca futura (`isFutureDate`, ya existente).
- **Abrir en modo edición**: prefill de los 4 campos con los valores reales
  de la fila, incluido `linkToExpense`/cuenta si ya estaba vinculada.

### 7.2 Guardado y borrado

Cubierto en detalle en secciones 1.6/2.4/2.5/2.6 — resumen:

| Caso | Patrón |
|---|---|
| Alta sin vínculo | Optimista, insert simple |
| Alta con vínculo | No optimista, `create_iron_pack_linked` |
| Edición sin tocar el vínculo | Optimista si nunca estuvo vinculada; no optimista (`update_iron_pack`) si sigue vinculada |
| Edición que activa/desactiva el vínculo | No optimista, `update_iron_pack` |
| Borrado sin vínculo | Optimista, delete simple |
| Borrado con vínculo | No optimista, `delete_iron_pack` (cascada al `expense`) |

---

## 8. Accesibilidad

1. **Estado de mitad pendiente nunca solo por color**: banner (sección 4.3)
   y fila de historial (sección 5.3) llevan siempre ícono `Clock` + texto
   "pendiente" además del tono `warning` — cumple la regla general de
   `design-system.md`.
2. **Botón "Fumé la mitad" deshabilitado con explicación visible** (sección
   4.4) — nunca un control inerte sin texto que explique por qué.
3. **Área táctil**: los dos accesos rápidos, el botón de cajetilla, los
   botones del banner de mitad pendiente y los controles del navegador de
   día usan `min-h-11`/`h-11 w-11` — mismo mínimo de 44px del resto del
   proyecto.
4. **Foco visible**: mismo patrón `focus-visible:ring-2 focus-visible:ring-
   ring focus-visible:ring-offset-2` en todos los controles custom nuevos
   (accesos rápidos, filas de historial, navegador de día).
5. **Confirmación antes de destruir**: borrar un cigarrillo entero o una
   cajetilla pasa por `AlertDialog` (sección 5.3/2.5) — nunca directo desde
   un tap en "Eliminar". La única excepción deliberada es "Descartar mitad
   pendiente" (sección 4.3), justificada explícitamente ahí: no borra
   ningún dato, solo cambia un estado, y ya tiene su propia red de
   seguridad vía "Deshacer".
6. **`aria-label` en los inputs nativos invisibles** del navegador de día
   (`type="date"` superpuesto, sección 5.2) y en los toggles de ícono
   (`aria-label="Día anterior"`, etc.) — mismo criterio que la píldora de
   fecha existente.
7. **Toast con acción "Deshacer"**: el `action` de `vue-sonner` ya expone
   un botón real, enfocable y anunciado por lectores de pantalla de fábrica
   — no requiere ARIA adicional.
8. **`prefers-reduced-motion`**: heredado de `Sheet`/`AlertDialog`/`Tabs`/
   `Switch`/toast (Reka UI + Sonner), sin configuración adicional — mismo
   criterio que el resto del proyecto.

---

## 9. Componentes shadcn-vue: qué se reusa, qué es nuevo

**Nada nuevo que instalar.** Todo lo que necesita esta feature ya está en el
inventario del proyecto: `Card`, `Button`, `Input`, `Label`, `Select`,
`Switch` (`credit-cards-ux.md`), `Tabs` (`debts-ux.md`), `Sheet`,
`AlertDialog`, `DropdownMenu`, `Separator`, `Badge`, `Alert`, `Skeleton`,
Sonner (toast, con su capacidad de `action` ya soportada por la librería
aunque el proyecto no la haya usado todavía).

---

## 10. Resumen accionable para `supabase-backend-expert`

1. Tabla `iron_cigarettes` (sección 1.2): unidad atómica = mitad,
   `kind`/`status`/`smoked_date`/`smoked_time`/`closes_cigarette_id` (`on
   delete set null`).
2. **Constraint dura**: máximo una fila `mitad_pendiente` por usuario a la
   vez (índice único parcial o chequeo en la función de alta) — sección
   1.3.
3. Vista `iron_current_status` (sección 1.3): expone si hay mitad pendiente
   y desde cuándo.
4. Funciones `close_pending_half`/`discard_pending_half` (sección 1.4),
   atómicas, no optimistas desde el cliente.
5. Tabla `iron_packs` (sección 1.5): `cost`/`purchased_date`/
   `purchased_time`/`linked_expense_id` (`on delete set null`).
6. Categoría default nueva **"Tabaco"** (`user_id null`, `🚬`, hex sugerido
   `#78716c` a validar con `validate_palette.js`), resuelta por nombre,
   nunca por id hardcodeado — sección 2.3.
7. Funciones `create_iron_pack_linked`/`update_iron_pack`/`delete_iron_pack`
   (secciones 1.6, 2.4-2.6): cascada explícita del `expense` vinculado al
   borrar, id del `expense` preservado al editar (a diferencia de
   `update_account_transfer`).
8. Vistas de agregación por bucket para Tendencias (sección 1.7):
   `iron_daily_totals`/`iron_pack_daily_totals` y sus análogas
   semanales/mensuales (o una función parametrizada equivalente) —
   agregación **en Postgres**, nunca sumado en cliente sobre una lista sin
   acotar.
9. Regenerar `src/types/database.types.ts` después de aplicar las
   migraciones (`npx supabase gen types typescript --project-id
   jgdenlrceubawwmknzcb > src/types/database.types.ts`).

## 11. Resumen accionable para `vue-frontend-expert`

1. **Router**: 3 rutas nuevas (`iron`, `iron-history`, `iron-trends`,
   sección 3.1).
2. **`NavigationDrawer.vue`**: ítem nuevo "Iron" (ícono `Cigarette`),
   inmediatamente después de "Deudas"/"Partidos en vivo" según el estado
   real del drawer al momento de implementar (sección 3.2) — confirmar con
   quien haya tocado el drawer más recientemente.
3. **Vistas nuevas**: `IronDashboardView.vue` (sección 4), `IronHistoryView
   .vue` (sección 5), `IronTrendsView.vue` (sección 6). Las 3 usan
   `AppHeader` compartido, sin botón "Volver".
4. **Sheet nuevo**: `IronPackFormSheet.vue` (sección 7), con el `Switch` de
   vínculo opcional y sus 3 ramas de guardado (no optimista solo cuando
   toca `expenses`).
5. **Sin Sheet para el registro de consumo**: acciones de un toque +
   `toast` con acción "Deshacer" (sección 4.4) — primer uso de este patrón
   en el proyecto, justificado por la frecuencia de uso.
6. **`TrendAreaChart.vue`**: dos props opcionales y retrocompatibles,
   `label` pre-formateado por punto y `maxLabelFormatter` (sección 6.4) —
   no se crea un componente nuevo.
7. **Helper nuevo `src/lib/iron.ts`**: `formatCigaretteCount`,
   `buildIronTrendSeries`, `pendingSinceLabel` (sección 6.5), reusando
   `MONTHS_ES_SHORT` ya existente en `src/lib/charts.ts`.
8. **Store nuevo** (nombre sugerido `src/stores/iron.ts`): fetch de
   `iron_current_status` al entrar al dashboard (para el banner de mitad
   pendiente, visible también en Historial), fetch acotado por día para
   Historial, fetch acotado por ventana para Tendencias — nunca "traer
   todo" (sección 1.7).
9. **Reusar tal cual**: `todayDateInputValue`/`nowTimeInputValue`/
   `formatTimeShort`/`isFutureDate`/`formatExpenseDateHeading`-equivalente
   de `src/lib/date.ts`, `formatAmount` de `src/lib/currency.ts`, el
   default de cuenta (`defaultAccountId()`) de `accounts-income-ux.md`
   sección 8.2.
