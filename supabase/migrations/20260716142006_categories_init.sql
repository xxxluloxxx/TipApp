-- =============================================================================
-- categories_init
-- -----------------------------------------------------------------------------
-- Categorías de gasto. Modelo unificado en una sola tabla:
--   - user_id IS NULL  -> categoría "default" del sistema, visible para todos,
--                         no editable ni borrable por usuarios comunes.
--   - user_id NOT NULL -> categoría "custom" creada por ese usuario, la cual
--                         solo él puede ver/editar/borrar.
-- =============================================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  icon text,
  color text,
  created_at timestamptz not null default now()
);

comment on table public.categories is 'Categorías de gasto. user_id NULL = categoría default del sistema; user_id NOT NULL = categoría custom del usuario.';
comment on column public.categories.user_id is 'NULL para categorías default (sistema). NOT NULL para categorías propias de un usuario.';

-- Evitar nombres duplicados entre las categorías default del sistema
-- (comparación case-insensitive).
create unique index categories_default_name_unique
  on public.categories (lower(name))
  where user_id is null;

-- Evitar nombres duplicados dentro de las categorías custom de un mismo
-- usuario (case-insensitive). Distintos usuarios sí pueden repetir nombres.
create unique index categories_user_name_unique
  on public.categories (user_id, lower(name))
  where user_id is not null;

create index categories_user_id_idx on public.categories (user_id);

-- Seed de categorías default del sistema (user_id = NULL).
insert into public.categories (name, icon, color) values
  ('Alimentación', '🍽️', '#f97316'),
  ('Transporte', '🚗', '#3b82f6'),
  ('Vivienda', '🏠', '#8b5cf6'),
  ('Servicios', '💡', '#eab308'),
  ('Salud', '💊', '#ef4444'),
  ('Educación', '📚', '#06b6d4'),
  ('Entretenimiento', '🎬', '#ec4899'),
  ('Ropa', '👕', '#14b8a6'),
  ('Ahorro e inversión', '💰', '#22c55e'),
  ('Otros', '📦', '#6b7280');

-- Helper reutilizado por expenses/budgets: una categoría es utilizable por
-- p_user_id si es default del sistema (user_id IS NULL) o si es una custom
-- de ese mismo usuario. Evita que un usuario referencie la categoría custom
-- de otro usuario a través de la FK (RLS no restringe esto por sí sola).
create function public.category_is_accessible(p_category_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.categories c
    where c.id = p_category_id
      and (c.user_id is null or c.user_id = p_user_id)
  );
$$;
