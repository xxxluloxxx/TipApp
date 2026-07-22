-- =============================================================================
-- iron_trend_totals_functions
-- -----------------------------------------------------------------------------
-- Agregación server-side para /iron/tendencias (docs/features/iron-ux.md
-- secciones 1.7, 6.3): totales de cigarrillos fumados y de gasto en
-- cajetillas, agrupados por día/semana/mes, sobre un rango de fechas
-- acotado por el cliente. Mismo principio no negociable de CLAUDE.md
-- ("Estado siempre derivado en el servidor..."): iron_cigarettes puede
-- crecer sin techo realista con el tiempo (mismo perfil que expenses), así
-- que sumar esto en cliente sobre "todo lo cargado" repetiría el error que
-- el resto del proyecto ya evita.
--
-- Diseño elegido: 2 funciones SECURITY INVOKER parametrizadas por
-- granularidad (en vez de las 6 vistas ilustrativas del doc -- día/semana/
-- mes x cantidad/gasto -- que el propio doc deja a criterio de
-- supabase-backend-expert como alternativa "más limpia"). `language sql
-- stable`: se comportan como una vista parametrizada (sin efectos de lado,
-- sin necesitar plpgsql), expuestas vía PostgREST como cualquier función
-- rpc de solo lectura (`/rest/v1/rpc/iron_cigarette_totals`).
--
-- security invoker (no definer): igual que account_balances/debt_balances,
-- corren con el RLS de quien las llama -- el filtro explícito
-- `user_id = auth.uid()` de abajo es redundante con las policies
-- iron_cigarettes_select_own/iron_packs_select_own, pero se deja explícito
-- (defensa en profundidad + ayuda al planner) en vez de depender
-- silenciosamente solo de RLS, mismo estilo que otras funciones de este
-- proyecto que sí filtran a mano.
--
-- p_granularity fuera de ('day','week','month'): la función devuelve un
-- resultado vacío (el filtro `p_granularity in (...)` descarta todas las
-- filas) en vez de lanzar excepción -- no hay ningún efecto de lado que
-- proteger acá, y un conjunto vacío es una respuesta razonable a un
-- parámetro no reconocido para una función de solo lectura.
--
-- Contrato observable para vue-frontend-expert: cada función devuelve
-- filas SPARSE (period_start, total) -- solo buckets con datos reales,
-- ordenadas por period_start. El cliente rellena a 0 los huecos dentro de
-- la ventana pedida (buildIronTrendSeries, sección 6.5 del doc), mismo
-- criterio que buildDailySeries/buildCumulativeDailySeries en
-- src/lib/charts.ts.
-- =============================================================================

create function public.iron_cigarette_totals(
  p_granularity text,
  p_window_start date,
  p_window_end date
)
returns table (period_start date, cigarette_count numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    case p_granularity
      when 'day' then smoked_date
      when 'week' then date_trunc('week', smoked_date)::date
      when 'month' then date_trunc('month', smoked_date)::date
    end as period_start,
    sum(case when kind = 'entero' then 1 else 0.5 end) as cigarette_count
  from public.iron_cigarettes
  where user_id = auth.uid()
    and p_granularity in ('day', 'week', 'month')
    and smoked_date between p_window_start and p_window_end
  group by 1
  order by 1;
$$;

comment on function public.iron_cigarette_totals is 'Totales de cigarrillos fumados (SUM(entero=1, mitad=0.5), sin importar status -- ver comment on table iron_cigarettes) agrupados por día/semana/mes dentro de [p_window_start, p_window_end], para el usuario autenticado. Sparse: solo buckets con datos reales, el cliente rellena ceros. p_granularity in (''day'',''week'',''month''); cualquier otro valor devuelve un conjunto vacío. SECURITY INVOKER.';

grant execute on function public.iron_cigarette_totals(text, date, date) to authenticated;

create function public.iron_pack_totals(
  p_granularity text,
  p_window_start date,
  p_window_end date
)
returns table (period_start date, money_spent numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    case p_granularity
      when 'day' then purchased_date
      when 'week' then date_trunc('week', purchased_date)::date
      when 'month' then date_trunc('month', purchased_date)::date
    end as period_start,
    sum(cost) as money_spent
  from public.iron_packs
  where user_id = auth.uid()
    and p_granularity in ('day', 'week', 'month')
    and purchased_date between p_window_start and p_window_end
  group by 1
  order by 1;
$$;

comment on function public.iron_pack_totals is 'Totales de gasto en compras de cajetilla (SUM(cost), independiente de si cada compra está vinculada o no a un expense real -- ver docs/features/iron-ux.md sección 2.7) agrupados por día/semana/mes dentro de [p_window_start, p_window_end], para el usuario autenticado. Sparse: solo buckets con datos reales. p_granularity in (''day'',''week'',''month''); cualquier otro valor devuelve un conjunto vacío. SECURITY INVOKER.';

grant execute on function public.iron_pack_totals(text, date, date) to authenticated;
