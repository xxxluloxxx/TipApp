-- =============================================================================
-- debt_people_init
-- -----------------------------------------------------------------------------
-- Contrapartes de deudas/préstamos (a quién le presto plata o quién me presta
-- a mí). Mismo patrón exacto que public.card_people (20260716142013): tabla
-- de "personas" propia del usuario, sin login/invitación/multi-usuario real.
--
-- Por qué esta tabla existe (revierte parcialmente una decisión anterior):
-- en la Fase 2 de Deudas se había decidido reusar public.card_people también
-- como contraparte de debts.person_id (ver 20260716142023_debts_init.sql,
-- comentario original de debts.person_id). El Product Owner pidió separar
-- esto explícitamente: "personas que usan mi tarjeta de crédito" (ej.
-- familiares con tarjeta adicional) y "personas a las que les presto o me
-- prestan plata" son conceptos de dominio distintos que casualmente tienen la
-- misma forma de datos (id/user_id/name/color) pero no son la misma lista de
-- contrapartes reales — no toda persona con tarjeta adicional es alguien a
-- quien el usuario le presta plata, ni viceversa.
--
-- Nombre elegido: debt_people (no debtors/lenders, que fijarían una sola
-- dirección — una misma persona puede ser tanto "a quien le presto" como "a
-- quien le debo" en hilos distintos, direction vive en debts, no acá). Sigue
-- el mismo patrón de nomenclatura "<dominio>_people" que ya usa card_people,
-- consistente con el resto del esquema.
--
-- Ver 20260717150200_debts_person_id_migrate_to_debt_people.sql para el
-- backfill de datos reales y el cambio de FK de debts.person_id.
-- =============================================================================

create table public.debt_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.debt_people is 'Personas (etiquetas libres, sin login) que el usuario define como contraparte de una deuda/préstamo (debts.person_id). Deliberadamente separada de card_people: son dominios distintos aunque compartan la misma forma de datos.';
comment on column public.debt_people.color is 'Hex de color a elección del usuario. Igual que card_people.color/categories.color: sin check constraint en BD, el frontend restringe la elección a una paleta fija de swatches.';

create trigger debt_people_set_updated_at
before update on public.debt_people
for each row
execute function public.set_updated_at();

create index debt_people_user_id_idx on public.debt_people (user_id);
