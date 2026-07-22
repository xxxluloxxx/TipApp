-- =============================================================================
-- credit_cards_statement_dates
-- -----------------------------------------------------------------------------
-- Día de corte (cierre del resumen) y día de pago (vencimiento) de una
-- tarjeta de crédito, pedidos por el Product Owner. Mismo criterio exacto
-- que fixed_expenses.payment_day (20260720090000_fixed_expenses_init.sql):
-- puramente informativos, no disparan nada automáticamente — a diferencia
-- de fixed_expenses (que sí tiene un registro de pagos con estado propio,
-- fixed_expense_instances/pay_fixed_expense_instance), acá NO hace falta
-- ningún equivalente de ensure_current_fixed_expense_instances ni ninguna
-- vista/función/cron nueva. Son solo un dato de referencia de la tarjeta.
--
-- Diferencia deliberada respecto a ese precedente, decidida por el Product
-- Owner: acá los 2 campos son NULLABLE (a diferencia de payment_day, que es
-- NOT NULL) porque ya pueden existir tarjetas cargadas por el usuario real
-- sin este dato — sin backfill inventado, las filas existentes quedan con
-- NULL en ambas columnas nuevas.
--
-- Cambio 100% aditivo sobre credit_cards (20260716142012_credit_cards_init.sql):
-- no toca ninguna columna/constraint/policy existente. No requiere ninguna
-- migración de RLS nueva (las policies ya existentes de credit_cards,
-- scoped a user_id = auth.uid(), ya cubren estas 2 columnas sin cambios).
-- =============================================================================

alter table public.credit_cards
  add column statement_cutoff_day smallint null check (statement_cutoff_day between 1 and 31),
  add column payment_due_day smallint null check (payment_due_day between 1 and 31);

comment on column public.credit_cards.statement_cutoff_day is 'Día del mes (1-31) en que cierra el resumen de la tarjeta. Puramente informativo: no dispara nada automáticamente, sin cron/RPC/función asociada. NULL = sin dato cargado (tarjetas ya existentes quedan así, sin backfill inventado).';
comment on column public.credit_cards.payment_due_day is 'Día del mes (1-31) en que vence el pago del resumen de la tarjeta. Puramente informativo: no dispara nada automáticamente, sin cron/RPC/función asociada. NULL = sin dato cargado (tarjetas ya existentes quedan así, sin backfill inventado).';
