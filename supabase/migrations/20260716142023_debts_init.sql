-- =============================================================================
-- debts_init
-- -----------------------------------------------------------------------------
-- Cabecera/hilo de una deuda o préstamo entre el usuario y una "persona"
-- (public.card_people, reusada como registro general de contrapartes — ver
-- comentario en debts.person_id, no se crea una tabla nueva de personas). Una
-- deuda NO es un monto fijo como un gasto: es un saldo corriente por
-- contraparte+dirección. El saldo real se calcula agregando su historial de
-- debt_movements (20260716142024_debt_movements_init.sql) vía la vista
-- debt_balances (20260716142026) — nunca se guarda ni se suma en el cliente.
-- =============================================================================

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null references public.card_people (id) on delete restrict,
  direction text not null check (direction in ('lent', 'borrowed')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.debts is 'Cabecera de una deuda/préstamo entre el usuario y una persona (public.card_people). El saldo corriente vive en debt_movements/debt_balances, no acá.';
comment on column public.debts.person_id is 'FK a public.card_people, reusada como registro general de "Personas" (misma pantalla /tarjetas/gestionar, sin crear un segundo sistema de contrapartes). A diferencia de card_expenses.person_id (opcional), acá es NOT NULL: una deuda siempre tiene contraparte. on delete restrict: la UI de borrado de una persona debe sumar el conteo de debts al conteo de card_expenses que ya usa.';
comment on column public.debts.direction is 'Dirección de la deuda: ''lent'' = "yo presté" = esta persona ME debe a mí. ''borrowed'' = "me prestaron" = YO le debo a esta persona. Determina el signo del impacto en el saldo de cuenta cuando un debt_movement está vinculado a una account_id (ver comment on view public.account_balances).';
comment on column public.debts.description is 'Label corto opcional del hilo de deuda (ej. "Préstamo personal", "Viaje a Cancún"). No obligatorio.';

create trigger debts_set_updated_at
before update on public.debts
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que person_id pertenezca al mismo usuario dueño
-- de la deuda (mismo patrón que card_expenses_validate_owner /
-- incomes_validate_account).
create function public.debts_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.card_people p
    where p.id = new.person_id and p.user_id = new.user_id
  ) then
    raise exception 'person_id % no pertenece al usuario %', new.person_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger debts_validate_owner_trigger
before insert or update of person_id, user_id on public.debts
for each row
execute function public.debts_validate_owner();

create index debts_user_id_idx on public.debts (user_id);
create index debts_person_id_idx on public.debts (person_id);
