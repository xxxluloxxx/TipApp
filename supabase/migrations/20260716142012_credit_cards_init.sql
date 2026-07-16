-- =============================================================================
-- credit_cards_init
-- -----------------------------------------------------------------------------
-- Tarjetas de crédito propias del usuario. A diferencia de categories, acá no
-- hay concepto de fila "default del sistema": toda tarjeta pertenece a un
-- único user_id (dueño de la cuenta), igual que expenses/budgets.
-- =============================================================================

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  last_four_digits text check (last_four_digits ~ '^[0-9]{4}$'),
  color text,
  suggested_monthly_limit numeric(12, 2) check (suggested_monthly_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.credit_cards is 'Tarjetas de crédito propias del usuario. suggested_monthly_limit es solo informativo (no un límite de crédito real: no se aplica ninguna lógica de bloqueo sobre él).';
comment on column public.credit_cards.last_four_digits is 'Últimos 4 dígitos de la tarjeta, solo para identificarla visualmente (no es sensible por sí solo). Formato validado: exactamente 4 dígitos numéricos.';
comment on column public.credit_cards.color is 'Hex de color a elección del usuario. Igual que categories.color: sin check constraint en BD, el frontend restringe la elección a una paleta fija de swatches.';
comment on column public.credit_cards.suggested_monthly_limit is 'Límite mensual sugerido, puramente informativo/orientativo para la UI. NO es un límite de crédito real: no bloquea ni valida ningún gasto contra este valor.';

create trigger credit_cards_set_updated_at
before update on public.credit_cards
for each row
execute function public.set_updated_at();

create index credit_cards_user_id_idx on public.credit_cards (user_id);
