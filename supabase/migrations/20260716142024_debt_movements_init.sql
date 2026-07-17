-- =============================================================================
-- debt_movements_init
-- -----------------------------------------------------------------------------
-- Ledger de montos con signo de una deuda (debts): cada fila "sube" (amount
-- positivo, amplía el préstamo — incluye el movimiento inicial al crear la
-- deuda, ver create_debt en 20260716142028) o "baja" (amount negativo, abono
-- o pago parcial/total) el saldo de una deuda. El saldo agregado vive en la
-- vista debt_balances (20260716142026); nunca se suma en el cliente sobre
-- esta lista.
--
-- account_id es opcional: solo se completa si esa plata realmente
-- salió/entró de una cuenta real del usuario. Ese vínculo NO genera una fila
-- en expenses/incomes — ver el comentario extendido en
-- 20260716142027_account_balances_debt_impact.sql, que explica por qué y
-- cómo se refleja igual en el saldo de la cuenta.
-- =============================================================================

create table public.debt_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  debt_id uuid not null references public.debts (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete restrict,
  amount numeric(12, 2) not null check (amount <> 0),
  movement_date date not null default (now() at time zone 'utc')::date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.debt_movements is 'Ledger de montos con signo de una deuda (public.debts). El saldo de una deuda = sum(amount) de sus movimientos — ver vista debt_balances, nunca se recalcula en el cliente.';
comment on column public.debt_movements.debt_id is 'FK a debts. A diferencia del resto del esquema (que usa on delete restrict para proteger contra borrados accidentales), acá es ON DELETE CASCADE a propósito: un movimiento no tiene sentido de existir sin su deuda, y borrar la deuda completa (con todo su historial) es una operación intencional del usuario, no un guard a evitar.';
comment on column public.debt_movements.account_id is 'FK opcional a accounts: solo si esta plata realmente salió/entró de una cuenta real del usuario. ON DELETE RESTRICT, mismo criterio que expenses.account_id/incomes.account_id (no se puede borrar una cuenta con movimientos de deuda asociados). No genera fila en expenses/incomes — ver comment on view public.account_balances.';
comment on column public.debt_movements.amount is 'Signo: positivo = aumenta la deuda ("subir", incluye el monto inicial al crear la deuda). Negativo = la reduce ("bajar", abono o pago parcial/total). Nunca cero (check amount <> 0). Sin constraint que impida que el saldo agregado de la deuda quede negativo por sobrepago — decisión deliberada, ver comment on view public.debt_balances.';
comment on column public.debt_movements.movement_date is 'Fecha del movimiento (default hoy en UTC). Independiente de created_at: permite cargar movimientos retroactivos.';
comment on column public.debt_movements.description is 'Nota libre opcional del movimiento puntual (distinta del label de debts.description, que describe el hilo completo).';

create trigger debt_movements_set_updated_at
before update on public.debt_movements
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que debt_id (y account_id, si no es null)
-- pertenezcan al mismo usuario dueño del movimiento (mismo patrón que
-- card_expenses_validate_owner, que valida dos FKs en la misma función).
create function public.debt_movements_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.debts d
    where d.id = new.debt_id and d.user_id = new.user_id
  ) then
    raise exception 'debt_id % no pertenece al usuario %', new.debt_id, new.user_id;
  end if;

  if new.account_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = new.account_id and a.user_id = new.user_id
  ) then
    raise exception 'account_id % no pertenece al usuario %', new.account_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger debt_movements_validate_owner_trigger
before insert or update of debt_id, account_id, user_id on public.debt_movements
for each row
execute function public.debt_movements_validate_owner();

create index debt_movements_user_id_idx on public.debt_movements (user_id);
create index debt_movements_debt_id_idx on public.debt_movements (debt_id);
create index debt_movements_account_id_idx on public.debt_movements (account_id);
create index debt_movements_user_date_idx on public.debt_movements (user_id, movement_date desc);
