-- =============================================================================
-- account_balances_view
-- -----------------------------------------------------------------------------
-- Saldo all-time por cuenta (suma de incomes - suma de expenses), agregado en
-- el servidor: no escala traer todos los movimientos al cliente para sumarlos
-- ahí (mismo criterio ya aplicado a los conteos de categories/credit_cards,
-- acá con SUM en vez de COUNT).
--
-- Elegida VISTA (no función rpc) con security_invoker = true, disponible
-- desde Postgres 15 (Supabase ya corre en 15+): con security_invoker, la
-- vista se ejecuta con los permisos y el RLS del usuario que la consulta (el
-- invoker), NO del usuario que la creó (el owner/postgres, que bypassearía
-- RLS por default). Como accounts/incomes/expenses ya tienen RLS con
-- políticas "select_own" scoped a auth.uid(), la vista hereda esa
-- restricción automáticamente sin necesitar ningún filtro explícito por
-- user_id adentro de la vista: un usuario autenticado que hace
-- `select * from account_balances` solo puede ver las filas de accounts que
-- sus propias policies de RLS ya le permiten ver, y los joins a
-- incomes/expenses quedan igual de restringidos.
--
-- Se prefiere esto sobre una función rpc security definer porque no hay
-- ninguna lógica que requiera bypassear RLS (a diferencia de handle_new_user,
-- que necesita tocar auth.users): una vista invoker es más simple, no
-- depende de acordarse de filtrar manualmente por auth.uid() adentro del
-- body de una función (el error clásico de una rpc security definer mal
-- escrita), y PostgREST la expone igual que una tabla vía
-- `/rest/v1/account_balances?select=*`.
--
-- OJO con el join: incomes y expenses son ambas 1-a-muchos respecto de
-- accounts. Si se hiciera un join directo entre las 3 tablas y se agregara
-- con un solo group by, cada combinación (income, expense) de una misma
-- cuenta se multiplicaría entre sí (producto cartesiano) e inflaría ambas
-- sumas. Por eso primero se agrega cada tabla por separado en una subquery
-- (una fila por account_id) y recién después se hace el join final 1-a-1.
-- =============================================================================

create view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.name,
  coalesce(inc.total, 0) - coalesce(exp.total, 0) as balance
from public.accounts a
left join (
  select account_id, sum(amount) as total
  from public.incomes
  group by account_id
) inc on inc.account_id = a.id
left join (
  select account_id, sum(amount) as total
  from public.expenses
  group by account_id
) exp on exp.account_id = a.id;

comment on view public.account_balances is 'Saldo all-time (ingresos - gastos) por cuenta del usuario autenticado. security_invoker=true: corre con el RLS del usuario que consulta, nunca expone cuentas/movimientos de otro usuario.';

grant select on public.account_balances to authenticated;
