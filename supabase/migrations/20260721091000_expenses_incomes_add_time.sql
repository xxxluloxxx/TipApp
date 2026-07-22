-- =============================================================================
-- expenses_incomes_add_time
-- -----------------------------------------------------------------------------
-- Campo de hora opcional para Gastos e Ingresos, pedido por el Product Owner
-- para poder registrar a qué hora del día ocurrió un movimiento. Alcance
-- deliberadamente acotado: NO toca account_transfers/debt_movements (fuera
-- de este encargo), y NO reemplaza ni tipa distinto expenses.expense_date/
-- incomes.income_date — esas columnas `date` puras siguen siendo la fuente
-- de verdad de todo lo que ya depende de ellas (filtros de rango por fecha,
-- agrupación por día, las heurísticas de "mes seguro de mostrar" de
-- src/lib/charts.ts, saldo corrido en account_balances, etc.). Un cambio de
-- tipo ahí tendría blast radius grande sobre lógica ya en producción; una
-- columna nueva, opcional y sin ningún consumidor server-side (ninguna
-- vista/función la lee) es aditiva y de riesgo cero.
--
-- Ambas tablas ganan la misma columna (mismo criterio ya usado para otros
-- pares "gemelos" del esquema, ej. expense_date/income_date): una sola
-- migración cubre las dos porque es el mismo concern exacto aplicado a las
-- dos mitades de un mismo par gasto/ingreso, no dos concerns distintos.
--
-- Sin backfill: NULL para todas las filas existentes (no hay hora real que
-- inventarles) y sin default para las filas nuevas (el frontend decide si
-- pide la hora o la deja sin completar).
--
-- account_balances/debt_balances y cualquier otra vista que haga
-- `select expenses.*`/`select incomes.*` simplemente pasan esta columna
-- nueva a través sin romper nada: ninguna de esas vistas depende de la lista
-- fija de columnas de expenses/incomes (usan agregados sobre `amount`, no
-- proyectan filas completas), así que no requieren ningún cambio.
-- =============================================================================

alter table public.expenses
  add column expense_time time null;

comment on column public.expenses.expense_time is 'Hora opcional del gasto (sin zona horaria), puramente informativa. NULL = sin hora registrada. No reemplaza expense_date (sigue siendo `date` puro y la única fuente de verdad para filtros/agrupación/saldo); ningún cálculo del backend depende de esta columna.';

alter table public.incomes
  add column income_time time null;

comment on column public.incomes.income_time is 'Hora opcional del ingreso (sin zona horaria), puramente informativa. NULL = sin hora registrada. No reemplaza income_date (sigue siendo `date` puro y la única fuente de verdad para filtros/agrupación/saldo); ningún cálculo del backend depende de esta columna.';
