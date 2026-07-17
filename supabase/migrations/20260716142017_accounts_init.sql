-- =============================================================================
-- accounts_init
-- -----------------------------------------------------------------------------
-- Cuentas propias del usuario (billetera, banco, efectivo, etc.) donde
-- imputar ingresos y gastos. Mismo patrón exacto que credit_cards: no hay
-- concepto de fila "default del sistema" (a diferencia de categories) — toda
-- cuenta pertenece a un único user_id, dueño de la cuenta TipApp.
--
-- Excepción: para que ningún usuario quede sin ninguna cuenta (bloqueando
-- alta de gastos/ingresos), se crea una cuenta "General" automáticamente:
--   - para usuarios NUEVOS, vía el trigger on_auth_user_created (ver más
--     abajo, se extiende handle_new_user() para crear también la cuenta).
--   - para usuarios YA EXISTENTES con gastos, vía backfill en la migración
--     20260716142019_expenses_add_account.sql (no acá, porque ese backfill
--     depende de la tabla expenses).
-- Esa cuenta "General" no tiene ninguna marca especial a nivel de esquema
-- (no hay columna is_default): es una fila común de accounts, el usuario
-- puede renombrarla/recolorearla/borrarla como cualquier otra una vez que
-- tenga más cuentas (sujeto al mismo on delete restrict que protege a
-- cualquier cuenta con movimientos asociados).
-- =============================================================================

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  color text,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.accounts is 'Cuentas propias del usuario (billetera, banco, efectivo, etc.) donde se imputan ingresos y gastos. Sin concepto de fila "default del sistema": toda cuenta pertenece a un único user_id.';
comment on column public.accounts.color is 'Hex de color a elección del usuario. Igual que categories.color/credit_cards.color: sin check constraint en BD, el frontend restringe la elección a una paleta fija de swatches.';
comment on column public.accounts.icon is 'Nombre de ícono lucide-vue a elección del usuario. Sin check constraint en BD (igual criterio que color): el frontend restringe la elección a su propio set de íconos soportados, la BD guarda un string libre.';

create trigger accounts_set_updated_at
before update on public.accounts
for each row
execute function public.set_updated_at();

create index accounts_user_id_idx on public.accounts (user_id);

-- -----------------------------------------------------------------------------
-- Extiende el trigger de alta de usuario (20260716142005_profiles_init.sql)
-- para que, además del profile, se cree automáticamente una cuenta "General"
-- por cada usuario nuevo. Se elige extender handle_new_user() en vez de un
-- trigger adicional encadenado para no depender del orden de ejecución entre
-- dos triggers distintos sobre el mismo evento (after insert on auth.users):
-- un único trigger, una única función, ambos inserts en la misma transacción
-- implícita del insert en auth.users (si algo falla, no queda un profile
-- huérfano sin cuenta ni viceversa).
--
-- Alternativa considerada y descartada: forzar en el frontend un flujo de
-- "creá tu primera cuenta" antes de poder cargar cualquier gasto/ingreso.
-- Se descarta por consistencia con el patrón ya existente (profiles) y
-- porque agrega fricción/estado especial en el frontend sin necesidad.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );

  insert into public.accounts (user_id, name, color, icon)
  values (new.id, 'General', '#6b7280', 'Wallet');

  return new;
end;
$$;
