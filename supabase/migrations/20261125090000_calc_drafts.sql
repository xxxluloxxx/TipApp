-- =============================================================================
-- calc_drafts
-- -----------------------------------------------------------------------------
-- "Calculadora de movimientos": borradores para hacer cuentas. Cada borrador
-- tiene movimientos de ingreso/gasto (descripción + monto), sin categorías, sin
-- saldo inicial y sin ningún vínculo con cuentas/expenses/incomes.
-- =============================================================================

create table public.calc_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.calc_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  draft_id uuid not null references public.calc_drafts (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  description text not null default '' check (char_length(description) <= 120),
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index calc_drafts_user_idx on public.calc_drafts (user_id, updated_at desc);
create index calc_entries_draft_idx on public.calc_entries (draft_id, created_at);

create trigger calc_drafts_set_updated_at
before update on public.calc_drafts
for each row execute function public.set_updated_at();

-- Tocar el borrador cuando cambian sus movimientos (para ordenar por reciente).
create function public.calc_entries_touch_draft()
returns trigger
language plpgsql
as $$
begin
  update public.calc_drafts set updated_at = now()
  where id = coalesce(new.draft_id, old.draft_id);
  return null;
end;
$$;

create trigger calc_entries_touch_draft_trigger
after insert or update or delete on public.calc_entries
for each row execute function public.calc_entries_touch_draft();

alter table public.calc_drafts enable row level security;
alter table public.calc_entries enable row level security;

create policy "calc_drafts_select_own" on public.calc_drafts for select to authenticated using (user_id = auth.uid());
create policy "calc_drafts_insert_own" on public.calc_drafts for insert to authenticated with check (user_id = auth.uid());
create policy "calc_drafts_update_own" on public.calc_drafts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "calc_drafts_delete_own" on public.calc_drafts for delete to authenticated using (user_id = auth.uid());

-- Un movimiento solo puede colgar de un borrador del mismo usuario.
create policy "calc_entries_select_own" on public.calc_entries for select to authenticated using (user_id = auth.uid());
create policy "calc_entries_insert_own" on public.calc_entries for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.calc_drafts d where d.id = draft_id and d.user_id = auth.uid()));
create policy "calc_entries_update_own" on public.calc_entries for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "calc_entries_delete_own" on public.calc_entries for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.calc_drafts, public.calc_entries to authenticated;

create view public.calc_draft_summary
with (security_invoker = true)
as
select
  d.id as draft_id,
  d.user_id,
  d.name,
  d.created_at,
  d.updated_at,
  coalesce(sum(e.amount) filter (where e.kind = 'income'), 0) as income_total,
  coalesce(sum(e.amount) filter (where e.kind = 'expense'), 0) as expense_total,
  coalesce(sum(case e.kind when 'income' then e.amount else -e.amount end), 0) as total,
  count(e.id) as entries_count
from public.calc_drafts d
left join public.calc_entries e on e.draft_id = d.id
group by d.id;

grant select on public.calc_draft_summary to authenticated;
notify pgrst, 'reload schema';
