-- =============================================================================
-- profiles_init
-- -----------------------------------------------------------------------------
-- Perfil de usuario 1:1 con auth.users. TipApp v1 es de un solo usuario por
-- cuenta (control de gastos personal), por lo que no hay conceptos de
-- "miembros" ni relaciones entre usuarios: profiles solo guarda datos propios
-- del dueño de la cuenta.
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil 1:1 de cada usuario autenticado. El id coincide con auth.users.id.';

-- Mantener updated_at al día en cada UPDATE.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- Patrón estándar: crear automáticamente el profile cuando se crea el usuario
-- en auth.users. SECURITY DEFINER porque auth.users no es accesible por el
-- usuario autenticado y el trigger corre en el contexto del servicio de auth.
create function public.handle_new_user()
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
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();
