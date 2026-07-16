-- =============================================================================
-- profiles_theme_preference
-- -----------------------------------------------------------------------------
-- Selector de tema claro/oscuro/sistema, persistido en Supabase (no solo
-- localStorage) para que la preferencia sobreviva entre sesiones/dispositivos.
--
-- Se usa `text` + `check` en vez de un `enum` de Postgres a propósito: agregar
-- un valor a un enum (`alter type ... add value`) tiene reglas de transacción
-- más restrictivas (no se puede usar el nuevo valor en la misma transacción en
-- versiones viejas de Postgres, y no se puede quitar un valor de un enum sin
-- recrearlo) y aquí no hay ninguna ventaja de rendimiento/espacio relevante
-- (son 3 valores, columna no indexada). Un `check` se reemplaza con un simple
-- `alter table ... drop constraint / add constraint` si el set de valores
-- cambia a futuro, sin tocar el tipo de la columna.
-- =============================================================================

alter table public.profiles
  add column theme_preference text not null default 'system'
    constraint profiles_theme_preference_check
    check (theme_preference in ('light', 'dark', 'system'));

comment on column public.profiles.theme_preference is
  'Preferencia de tema de UI del usuario (claro/oscuro/según sistema), persistida para sincronizar entre sesiones y dispositivos. Default ''system''.';

-- -----------------------------------------------------------------------------
-- RLS: no hace falta ninguna policy nueva ni modificar las existentes.
-- La policy "profiles_update_own" (20260716142010_rls_policies.sql) ya es
--   for update to authenticated
--   using (id = auth.uid())
--   with check (id = auth.uid())
-- Postgres RLS no filtra por columna salvo que se use column-level privileges
-- (grant/revoke por columna) o se referencien columnas específicas dentro de
-- la propia policy — no es el caso acá: la policy solo mira `id`, así que
-- aplica igual sin importar qué columnas se toquen en el UPDATE, incluida
-- theme_preference. select/update de esta columna quedan cubiertos por
-- "profiles_select_own"/"profiles_update_own" sin cambios.
-- -----------------------------------------------------------------------------
