-- =============================================================================
-- categories_income_kind
-- -----------------------------------------------------------------------------
-- Hasta ahora public.categories solo servía a expenses/budgets/fixed_expenses
-- (gastos). Se agrega `kind` para poder reusar la misma tabla también para
-- incomes (ingresos), en vez de crear una tabla `income_categories` paralela
-- (mismo modelo unificado default/custom que ya tiene categories, sin
-- duplicar esa lógica).
--
-- `kind` no tiene default implícito "mágico" más allá de 'expense': las 13
-- categorías default ya sembradas (10 de categories_init + "Comisiones
-- bancarias" + "Ajuste de saldo" + "Tabaco") son y siempre fueron de gasto,
-- así que el `default 'expense'` de la columna las deja backfillenadas
-- correctamente sin necesidad de un `update` explícito. No se toca name/
-- icon/color/user_id de ninguna fila existente.
-- =============================================================================

alter table public.categories
  add column kind text not null default 'expense' check (kind in ('expense', 'income'));

comment on column public.categories.kind is 'Tipo de movimiento al que aplica la categoría: ''expense'' (gasto, default histórico) o ''income'' (ingreso). Permite que "Otros" (u otro nombre) exista una vez por kind sin chocar con el unique index (ver categories_default_name_unique/categories_user_name_unique).';

-- -----------------------------------------------------------------------------
-- Los unique index existentes (categories_init.sql) no consideraban `kind`.
-- Hay que recrearlos ANTES del seed de más abajo: el seed inserta "Otros"
-- (income, user_id null) y ya existe "Otros" (expense, user_id null) --
-- con el índice viejo (solo lower(name), sin kind) esa fila nueva violaría
-- categories_default_name_unique. Se recrean agregando `kind` a la clave
-- indexada, mismo `where` exacto que antes (misma partición default/custom).
-- -----------------------------------------------------------------------------

drop index public.categories_default_name_unique;

create unique index categories_default_name_unique
  on public.categories (lower(name), kind)
  where user_id is null;

drop index public.categories_user_name_unique;

create unique index categories_user_name_unique
  on public.categories (user_id, lower(name), kind)
  where user_id is not null;

-- -----------------------------------------------------------------------------
-- Seed de 3 categorías default de ingreso (user_id NULL, mismo patrón exacto
-- que las categorías default de gasto).
--
-- Paleta: se corrió una comprobación de distancia perceptual (ΔE en CIE Lab,
-- mismo criterio que validate_palette.js citado en categories_tobacco.sql /
-- categories_bank_commissions_color_fix.sql / categories_balance_adjustment.sql)
-- de cada candidato contra los 13 hex ya sembrados (10 default originales +
-- Comisiones bancarias #6366f1 + Ajuste de saldo #a3520a + Tabaco #6f8226).
-- Se buscó explícitamente NO repetir el hueco violeta/azul (#8b5cf6/#3b82f6,
-- el hallazgo CVD conocido de Vivienda/Transporte) ni sumar un tercer "gris
-- apagado" (ya hay dos casi-grises: Otros #6b7280 y, en menor medida, el
-- piso de croma que bordea):
--
--   - 'Sueldo'                      #0e7490 (cyan-700, teal oscuro).
--     ΔE mínimo 22.1 (vs Otros #6b7280); 25.9 vs Educación #06b6d4; 40.2 vs
--     Ropa #14b8a6. Hue 193°, en el hueco entre Ropa (173°) y Transporte
--     (217°) pero desplazado en luminosidad/croma para no colisionar con
--     Educación (189°, el vecino más próximo en hue). Ingreso principal/más
--     frecuente: color sobrio y "confiable" a propósito, no un verde más
--     (evita otra asociación verde=dinero que ya usa Ahorro e inversión).
--   - 'Capitalización de intereses' #c026d3 (fucsia/magenta-600).
--     ΔE mínimo 28.5 (vs Vivienda #8b5cf6); 41.2 vs Comisiones bancarias
--     #6366f1; 48.5 vs Entretenimiento #ec4899. Hue 293°, el hueco más
--     grande disponible en todo el círculo de hue (72° entre Vivienda 258°
--     y Entretenimiento 330°, sin ningún color sembrado en el medio).
--   - 'Otros' (ingreso)            #5a6e5b (verde salvia apagado).
--     ΔE mínimo 20.9 (vs Otros #6b7280, el más parecido por ser ambos de
--     baja saturación); 38.7 vs Tabaco #6f8226; 65.0 vs Ahorro e inversión
--     #22c55e. Deliberadamente distinto del gris neutro de "Otros" (gasto)
--     -- mismo nombre, kind distinto, no deben leerse como la misma
--     categoría en una lista/leyenda que mezcle ambos kinds.
--
--   Verificado que ninguno de los 3 reintroduce el par CVD rojo↔verde ni el
--   par violeta/azul ya documentado, y que los 3 son mutuamente distantes
--   entre sí (ΔE > 30 en todos los pares cruzados).
--
-- Íconos: mismo contrato que el resto de categories.icon -- emoji de texto
-- plano, sin mapeo a componente (ver categories_tobacco.sql /
-- categories_balance_adjustment.sql). Se comprobó que ninguno de los 3
-- repite un emoji ya usado, ni en las 13 categorías default
-- (🍽️🚗🏠💡💊📚🎬👕💰📦🏦⚖️🚬) ni en el set curado de categorías custom
-- (CATEGORY_ICON_OPTIONS, src/lib/categoryIcons.ts):
--   - 'Sueldo'                      💵 (billete) -- distinto de 💰 (bolsa,
--     ya usado por Ahorro e inversión) y de 💼 (ya usado por "Trabajo" en
--     CATEGORY_ICON_OPTIONS).
--   - 'Capitalización de intereses' 📈 (gráfico ascendente) -- comunica
--     "crecimiento/interés" sin ambigüedad.
--   - 'Otros' (ingreso)            🪙 (moneda) -- catch-all genérico,
--     visualmente distinto tanto de 💰 (Ahorro) como de 📦 (Otros de gasto).
-- =============================================================================

insert into public.categories (name, icon, color, kind) values
  ('Sueldo', '💵', '#0e7490', 'income'),
  ('Capitalización de intereses', '📈', '#c026d3', 'income'),
  ('Otros', '🪙', '#5a6e5b', 'income');

-- -----------------------------------------------------------------------------
-- category_is_accessible ganaba un tercer parámetro opcional p_kind (default
-- null = no filtra por kind, comportamiento idéntico al de antes). Así los
-- call-sites existentes (expenses_validate_category, budgets, fixed_expenses,
-- todos con 2 argumentos) siguen funcionando sin cambios -- ya sólo
-- referencian categorías kind='expense' de por sí, no hacía falta tocarlos.
-- El nuevo call-site (incomes_validate_category, más abajo en
-- incomes_add_category.sql) sí pasa p_kind => 'income'.
-- -----------------------------------------------------------------------------

create or replace function public.category_is_accessible(
  p_category_id uuid,
  p_user_id uuid,
  p_kind text default null
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.categories c
    where c.id = p_category_id
      and (c.user_id is null or c.user_id = p_user_id)
      and (p_kind is null or c.kind = p_kind)
  );
$$;

comment on function public.category_is_accessible(uuid, uuid, text) is 'Una categoría es utilizable por p_user_id si es default del sistema o custom de ese mismo usuario. p_kind opcional (default null = no filtra): pasar ''expense''/''income'' para exigir además que la categoría sea de ese tipo (usado por incomes_validate_category).';
