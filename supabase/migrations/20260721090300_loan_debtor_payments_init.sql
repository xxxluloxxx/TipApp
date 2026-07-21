-- =============================================================================
-- loan_debtor_payments_init
-- -----------------------------------------------------------------------------
-- Ledger de pagos recibidos de un loan_debtor puntual (mismo espíritu que
-- debt_movements, pero de una sola dirección -- acá solo se registran
-- cobros, nunca "ampliaciones" de lo que debe la persona; si el usuario
-- necesita corregir amount_owed, edita loan_debtors.amount_owed
-- directamente, no agrega un movimiento negativo). El saldo pendiente de
-- cada loan_debtor SIEMPRE se deriva agregando esta tabla (ver vista
-- loan_debtor_progress), nunca se cachea/resume en cliente.
--
-- Sin columna updated_at (a diferencia de debt_movements, que sí la tiene):
-- el encargo no la pidió y, a diferencia de debt_movements (que soporta
-- edición de monto/fecha desde el detalle de una deuda), no hay todavía un
-- flujo de "editar un pago ya cargado" previsto para esta feature -- RLS
-- igual permite update/delete si a futuro se decide agregar esa corrección,
-- simplemente no queda un timestamp de "última edición" hasta que se agregue
-- la columna en ese momento.
--
-- Sin FK a accounts ni a expenses/incomes -- por diseño (ver comentario
-- extendido en 20260721090000_loans_init.sql): registrar un cobro de
-- préstamo NUNCA genera efecto de caja visible en el resto de la app.
-- =============================================================================

create table public.loan_debtor_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  loan_debtor_id uuid not null references public.loan_debtors (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_date date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

comment on table public.loan_debtor_payments is 'Ledger de pagos recibidos de un loan_debtor puntual. remaining = loan_debtors.amount_owed - sum(loan_debtor_payments.amount) -- ver vista loan_debtor_progress, nunca se suma en el cliente. loan_debtor_id ON DELETE CASCADE: un pago no tiene sentido de existir sin su loan_debtor (mismo criterio que debt_movements respecto de debts).';
comment on column public.loan_debtor_payments.payment_date is 'Fecha del pago (default hoy en UTC, mismo patrón que expense_date/movement_date/transfer_date en el resto del esquema). Independiente de created_at: permite cargar pagos retroactivos.';

-- Refuerza a nivel de datos que loan_debtor_id pertenezca al mismo usuario
-- dueño del pago (mismo patrón acotado a insert/update de la FK que
-- loan_installments_validate_owner).
create function public.loan_debtor_payments_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.loan_debtors d
    where d.id = new.loan_debtor_id and d.user_id = new.user_id
  ) then
    raise exception 'loan_debtor_id % no pertenece al usuario %', new.loan_debtor_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger loan_debtor_payments_validate_owner_trigger
before insert or update of loan_debtor_id, user_id on public.loan_debtor_payments
for each row
execute function public.loan_debtor_payments_validate_owner();

create index loan_debtor_payments_user_id_idx on public.loan_debtor_payments (user_id);
create index loan_debtor_payments_loan_debtor_id_idx on public.loan_debtor_payments (loan_debtor_id);
