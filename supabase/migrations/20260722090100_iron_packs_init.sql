-- =============================================================================
-- iron_packs_init
-- -----------------------------------------------------------------------------
-- Compra de una cajetilla de tabaco (docs/features/iron-ux.md sección 1.5).
-- Costo puramente informativo por defecto -- NO genera expenses/incomes a
-- menos que el usuario active explícitamente el vínculo opt-in (sección 2),
-- resuelto por linked_expense_id. Sin ningún campo de "cigarrillos por
-- cajetilla" ni costo-por-cigarrillo derivado: el costo vive únicamente a
-- nivel de compra completa (fuera de alcance explícito del encargo, ver
-- encabezado del doc).
--
-- linked_expense_id on delete set null (mismo criterio exacto que
-- account_transfers.expense_id, 20260720091000): si el expense vinculado
-- desaparece por un motivo externo a Iron (ej. el usuario lo borra
-- directamente desde Transacciones), la fila de iron_packs NO desaparece --
-- simplemente pasa a mostrarse como "no vinculada" (sección 2.5 del doc).
-- =============================================================================

create table public.iron_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cost numeric(12, 2) not null check (cost > 0),
  purchased_date date not null,
  purchased_time time not null,
  linked_expense_id uuid references public.expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.iron_packs is 'Compra de una cajetilla de tabaco. cost es siempre informativo dentro de Iron; linked_expense_id (NULL por defecto) resuelve el vínculo opcional opt-in a las finanzas reales del usuario -- ver docs/features/iron-ux.md sección 2. NUNCA prorrateado por cigarrillo.';
comment on column public.iron_packs.cost is 'Costo total de la cajetilla comprada, siempre a nivel de compra completa (nunca costo-por-cigarrillo).';
comment on column public.iron_packs.purchased_date is 'Fecha real de la compra, sin ambigüedad de huso horario. NUNCA timestamptz, mismo patrón que iron_cigarettes.smoked_date/expenses.expense_date.';
comment on column public.iron_packs.purchased_time is 'Hora real de la compra. Obligatoria, mismo criterio que iron_cigarettes.smoked_time (el alta siempre parte de "ahora").';
comment on column public.iron_packs.linked_expense_id is 'FK al gasto real generado si el usuario activó el vínculo opcional (categoría default "Tabaco", ver 20260722090500). NULL = compra no vinculada (default). on delete set null: la compra sigue siendo un registro válido aunque su expense asociado deje de existir por un motivo externo a Iron.';

create trigger iron_packs_set_updated_at
before update on public.iron_packs
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que linked_expense_id (si no es NULL) pertenezca
-- al mismo user_id -- mismo patrón que account_transfers_validate_owner.
create function public.iron_packs_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if new.linked_expense_id is not null and not exists (
    select 1 from public.expenses e
    where e.id = new.linked_expense_id and e.user_id = new.user_id
  ) then
    raise exception 'linked_expense_id % no pertenece al usuario %', new.linked_expense_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger iron_packs_validate_owner_trigger
before insert or update of linked_expense_id, user_id on public.iron_packs
for each row
execute function public.iron_packs_validate_owner();

create index iron_packs_user_id_idx on public.iron_packs (user_id);
create index iron_packs_user_date_idx on public.iron_packs (user_id, purchased_date desc);
create index iron_packs_linked_expense_id_idx on public.iron_packs (linked_expense_id);
