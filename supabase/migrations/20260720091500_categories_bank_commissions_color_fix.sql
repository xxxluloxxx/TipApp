-- =============================================================================
-- categories_bank_commissions_color_fix
-- -----------------------------------------------------------------------------
-- Corrige el color de la categoría default "Comisiones bancarias" (sembrada
-- en 20260720090900_categories_bank_commissions.sql con '#6b7280', el mismo
-- gris ya usado por "Otros"). ui-ux-designer propuso después '#475569'
-- (slate-600) para darle identidad propia en vez de duplicar "Otros" -- se
-- corrió `node scripts/validate_palette.js` (skill de dataviz) con los 10
-- hex default existentes + ese candidato, en light y dark, y FALLÓ
-- específicamente por ese color nuevo:
--   [FAIL] Chroma floor: #475569 por debajo del piso (además de #6b7280,
--     que ya fallaba antes -- no es el mismo caso, se suman DOS grises).
--   [FAIL] Normal-vision floor: peor par #475569↔#6b7280 ΔE 10.6, por
--     debajo del piso de 15 -- un lector con visión de color completa no
--     puede distinguir ambos grises entre sí. Este SÍ es un conflicto
--     NUEVO (no preexistía con los 10 colores originales), a diferencia de
--     otros hallazgos de esta migración que son heredados.
--
-- Se probaron ~20 candidatos adicionales contra los mismos 10 hex default,
-- en light y dark (superficie dark '#1a1a19', igual que
-- dashboard-redesign-ux.md). La mayoría de los tonos "banco/institucional"
-- oscuros (azules/índigos/violetas/verdes muy saturados u oscuros: navy,
-- amber-700, brown, etc.) o bien introducían su propio conflicto nuevo, o
-- bien pasaban en modo claro pero fallaban el rango de luminosidad en modo
-- oscuro (categories.color se usa tal cual en ambos temas, sin variante
-- dark propia a diferencia de accounts.color/ACCOUNT_COLOR_SWATCHES -- ver
-- accounts-income-ux.md sección 4.4).
--
-- Color final elegido: '#6366f1' (indigo-500). Verificado contra los 10 hex
-- default + este, en AMBOS modos (light, surface '#fcfcfb'; dark, surface
-- '#1a1a19'): en los dos casos, TODOS los FAIL/WARN que reporta el
-- validador son exactamente los mismos que ya existían con los 10 colores
-- originales (Vivienda/Transporte CVD, "Otros" bajo el piso de chroma,
-- eab308 fuera de banda de luminosidad, etc. -- hallazgo ya documentado en
-- dashboard-redesign-ux.md) -- '#6366f1' no aparece en ninguna lista de
-- violación en ninguno de los dos modos, y en modo oscuro el check de
-- contraste pasa 11/11 (antes tenía un WARN). No introduce ningún conflicto
-- nuevo, en ningún check, en ningún modo -- a diferencia de '#475569'.
-- Semánticamente, un índigo/azul-violeta profundo es una asociación visual
-- común con "banco/institución financiera" sin duplicar exactamente el
-- azul de Transporte ('#3b82f6') ni el violeta de Vivienda ('#8b5cf6').
--
-- No se hace `update` de main.css/tokens ni de ningún otro color existente:
-- esta migración solo toca la fila de "Comisiones bancarias".
-- =============================================================================

update public.categories
set color = '#6366f1'
where user_id is null
  and lower(name) = lower('Comisiones bancarias');
