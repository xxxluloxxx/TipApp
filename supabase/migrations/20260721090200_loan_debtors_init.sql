-- =============================================================================
-- loan_debtors_init
-- -----------------------------------------------------------------------------
-- Personas que le deben al usuario su parte de un préstamo puntual (ej. un
-- préstamo tomado a nombre del usuario pero cuya cuota en realidad la
-- terminan pagando/reembolsando otras personas). Liga un `loans` con una
-- `debt_people` ya existente -- NO se crea una tabla de personas nueva, se
-- reusa `public.debt_people` (20260717150000) SOLO para identidad
-- (nombre/color), sin ningún otro acoplamiento de dominio: un mismo
-- debt_person puede aparecer como contraparte de una `debts` clásica Y como
-- deudor de un `loans`, son usos independientes de la misma etiqueta de
-- persona.
--
-- Decisión de ON DELETE para debt_person_id (pedida explícitamente por el
-- encargo, no es un default heredado sin pensar): ON DELETE RESTRICT, mismo
-- criterio que credit_cards/card_people usan para sus FK de "persona" en
-- card_expenses -- no tiene sentido dejar un loan_debtor con una identidad
-- rota (sin nombre/color resolubles), y el proyecto ya tiene el patrón
-- establecido de "la UI deshabilita el borrado de antemano contando usos" en
-- vez de permitir borrar y perder trazabilidad (on delete set null) o
-- arrastrar en cascada un borrado no solicitado por el usuario (on delete
-- cascade borraría loan_debtors, y con ella los loan_debtor_payments ya
-- cobrados -- inaceptable, es historial real de cobros).
--
-- NOTA DE COORDINACIÓN para quien toque el guard de borrado de debt_people
-- en el frontend (hoy src/stores/debtPeople.ts, fetchDebtCounts() solo suma
-- debts(count)): a partir de esta migración, debt_people también tiene un
-- segundo consumidor real (loan_debtors) -- el guard de borrado debería
-- sumar loan_debtors(count) igual que ya se hizo (y luego se revirtió, por
-- otro motivo, para card_people) para debts(count). Sin este ajuste de
-- frontend, un intento de borrar una persona de deuda referenciada por un
-- loan_debtor fallará recién contra la restricción de BD (error 23503 sin
-- guard previo en UI) -- funcionalmente seguro, pero peor UX. No es trabajo
-- de esta migración, solo se deja documentado.
-- =============================================================================

create table public.loan_debtors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  loan_id uuid not null references public.loans (id) on delete cascade,
  debt_person_id uuid not null references public.debt_people (id) on delete restrict,
  amount_owed numeric(12, 2) not null check (amount_owed > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.loan_debtors is 'Persona (public.debt_people, reusada solo por identidad) que debe reembolsarle al usuario su parte de un loan puntual. loan_id ON DELETE CASCADE: borrar el préstamo completo se lleva sus deudores y el historial de cobros (ver loan_debtor_payments). debt_person_id ON DELETE RESTRICT: ver justificación extendida al inicio de este archivo -- no se puede borrar una persona de deuda mientras tenga algún loan_debtor asociado.';
comment on column public.loan_debtors.amount_owed is 'Cuánto le corresponde pagar a esta persona de este préstamo puntual (no necesariamente loans.total_amount / cantidad de deudores -- puede ser un reparto desigual, a criterio del usuario al cargarlo). El saldo pendiente real = amount_owed - sum(loan_debtor_payments.amount), ver vista loan_debtor_progress.';

create trigger loan_debtors_set_updated_at
before update on public.loan_debtors
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que loan_id y debt_person_id pertenezcan al
-- mismo usuario dueño de la fila (mismo patrón de "2 FK validadas en una
-- sola función" que card_expenses_validate_owner/debts_validate_owner).
create function public.loan_debtors_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.loans l
    where l.id = new.loan_id and l.user_id = new.user_id
  ) then
    raise exception 'loan_id % no pertenece al usuario %', new.loan_id, new.user_id;
  end if;

  if not exists (
    select 1 from public.debt_people p
    where p.id = new.debt_person_id and p.user_id = new.user_id
  ) then
    raise exception 'debt_person_id % no pertenece al usuario %', new.debt_person_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger loan_debtors_validate_owner_trigger
before insert or update of loan_id, debt_person_id, user_id on public.loan_debtors
for each row
execute function public.loan_debtors_validate_owner();

create index loan_debtors_user_id_idx on public.loan_debtors (user_id);
create index loan_debtors_loan_id_idx on public.loan_debtors (loan_id);
create index loan_debtors_debt_person_id_idx on public.loan_debtors (debt_person_id);
