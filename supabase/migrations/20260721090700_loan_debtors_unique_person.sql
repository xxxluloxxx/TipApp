-- =============================================================================
-- loan_debtors_unique_person
-- -----------------------------------------------------------------------------
-- Fast-follow: agrega `unique (loan_id, debt_person_id)` a loan_debtors --
-- una misma persona no puede ser agregada dos veces al mismo préstamo. No
-- estaba en el encargo original de esquema, pero docs/features/loans-ux.md
-- (escrito en paralelo por ui-ux-designer, sección 1.1/8.2) ya diseñó el
-- Select de "Agregar persona" excluyendo en cliente a quienes ya son
-- loan_debtors del préstamo, documentando esta constraint como el backstop
-- de servidor esperado (mismo patrón defense-in-depth que el resto del
-- esquema: el cliente evita el caso común, la BD lo hace imposible de
-- verdad). Se agrega acá, después de crear la tabla, en vez de en el
-- CREATE TABLE original, porque este encargo llegó como una migración
-- puntual de fast-follow tras revisar el doc de UX -- mismo criterio ya
-- usado en account_transfers (categories_bank_commissions_color_fix) para
-- correcciones post-init sin reescribir una migración ya aplicada al
-- remoto.
-- =============================================================================

alter table public.loan_debtors
  add constraint loan_debtors_unique_person unique (loan_id, debt_person_id);

comment on constraint loan_debtors_unique_person on public.loan_debtors is 'Una misma persona (debt_person_id) no puede ser agregada dos veces como deudora del mismo préstamo. El frontend ya evita este caso excluyendo del Select a quienes ya son loan_debtors (docs/features/loans-ux.md sección 8.2) -- esta constraint es el backstop de servidor.';
