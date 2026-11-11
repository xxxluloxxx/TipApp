-- Ahorro programado: durante N meses se mueve un monto fijo de una cuenta a otra.
-- Cada cuota se confirma a mano (RPC) y genera una transferencia real entre cuentas.

create table public.savings_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid not null references public.accounts (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  day_of_month integer not null check (day_of_month between 1 and 31),
  term_months integer not null check (term_months between 1 and 600),
  start_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint savings_plans_distinct_accounts check (from_account_id <> to_account_id)
);

create table public.savings_plan_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.savings_plans (id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'done')),
  transfer_id uuid references public.account_transfers (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (plan_id, installment_number)
);
create index savings_plan_installments_plan_idx on public.savings_plan_installments (plan_id, due_date);

alter table public.savings_plans enable row level security;
alter table public.savings_plan_installments enable row level security;

create policy "savings_plans_select_own" on public.savings_plans for select to authenticated using (user_id = auth.uid());
create policy "savings_plans_insert_own" on public.savings_plans for insert to authenticated with check (user_id = auth.uid());
create policy "savings_plans_update_own" on public.savings_plans for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "savings_plans_delete_own" on public.savings_plans for delete to authenticated using (user_id = auth.uid());

create policy "savings_plan_installments_select_own" on public.savings_plan_installments for select to authenticated using (user_id = auth.uid());
create policy "savings_plan_installments_insert_own" on public.savings_plan_installments for insert to authenticated with check (user_id = auth.uid());
create policy "savings_plan_installments_update_own" on public.savings_plan_installments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "savings_plan_installments_delete_own" on public.savings_plan_installments for delete to authenticated using (user_id = auth.uid());

create view public.savings_plan_progress with (security_invoker = true) as
select
  p.id as plan_id,
  count(i.*)::int as total_count,
  count(i.*) filter (where i.status = 'done')::int as done_count,
  coalesce(sum(i.amount) filter (where i.status = 'done'), 0) as saved_amount,
  coalesce(sum(i.amount), 0) as total_amount,
  min(i.due_date) filter (where i.status = 'pending') as next_due_date
from public.savings_plans p
left join public.savings_plan_installments i on i.plan_id = p.id
group by p.id;

-- Crea el plan y todas sus cuotas (una por mes, desde start_date; el día se
-- ajusta al último día de los meses cortos).
create function public.create_savings_plan(
  p_name text,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_day_of_month integer,
  p_term_months integer,
  p_start_date date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_month date;
  v_last_day integer;
  i integer;
begin
  if v_user_id is null then
    raise exception 'create_savings_plan requiere un usuario autenticado';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'La cuenta de origen y la de destino no pueden ser la misma';
  end if;

  insert into public.savings_plans (user_id, name, from_account_id, to_account_id, amount, day_of_month, term_months, start_date)
  values (v_user_id, btrim(p_name), p_from_account_id, p_to_account_id, p_amount, p_day_of_month, p_term_months, p_start_date)
  returning id into v_plan_id;

  for i in 1..p_term_months loop
    v_month := (date_trunc('month', p_start_date) + make_interval(months => i - 1))::date;
    v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::int;
    insert into public.savings_plan_installments (user_id, plan_id, installment_number, due_date, amount)
    values (v_user_id, v_plan_id, i, v_month + (least(p_day_of_month, v_last_day) - 1), p_amount);
  end loop;

  return v_plan_id;
end;
$$;
grant execute on function public.create_savings_plan(text, uuid, uuid, numeric, integer, integer, date) to authenticated;

-- Confirma una cuota: crea la transferencia real y marca la cuota como hecha.
create function public.pay_savings_installment(
  p_installment_id uuid,
  p_transfer_date date,
  p_transfer_time time default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inst public.savings_plan_installments;
  v_plan public.savings_plans;
  v_transfer_id uuid;
begin
  select * into v_inst from public.savings_plan_installments where id = p_installment_id for update;
  if not found then
    raise exception 'Cuota no encontrada';
  end if;
  if v_inst.status = 'done' then
    raise exception 'Esta cuota ya fue registrada';
  end if;
  select * into v_plan from public.savings_plans where id = v_inst.plan_id;

  v_transfer_id := public._account_transfer_insert(
    v_plan.from_account_id, v_plan.to_account_id, v_inst.amount, 0,
    p_transfer_date, 'Ahorro programado: ' || v_plan.name, p_transfer_time
  );

  update public.savings_plan_installments
  set status = 'done', transfer_id = v_transfer_id, done_at = now()
  where id = p_installment_id;

  return v_transfer_id;
end;
$$;
grant execute on function public.pay_savings_installment(uuid, date, time) to authenticated;
