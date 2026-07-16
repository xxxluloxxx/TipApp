-- =============================================================================
-- card_people_init
-- -----------------------------------------------------------------------------
-- "Personas" que usan las tarjetas de crédito del usuario. Es solo una
-- etiqueta/nombre libre que el dueño de la cuenta define para llevar registro
-- de quién usó su tarjeta (ej. familiares) — NO es otra cuenta de TipApp: no
-- tiene login propio, no hay invitaciones ni multi-usuario real. Todo vive
-- bajo el mismo user_id dueño de la cuenta. Sin avatar/foto (decisión de
-- producto: evita meter Supabase Storage en el alcance de esta iteración).
-- =============================================================================

create table public.card_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.card_people is 'Personas (etiquetas libres, sin login) que el usuario define para llevar registro de quién usó su tarjeta. No son cuentas de TipApp.';
comment on column public.card_people.color is 'Hex de color a elección del usuario. Igual que categories.color: sin check constraint en BD, el frontend restringe la elección a una paleta fija de swatches.';

create trigger card_people_set_updated_at
before update on public.card_people
for each row
execute function public.set_updated_at();

create index card_people_user_id_idx on public.card_people (user_id);
