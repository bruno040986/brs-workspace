-- Cadastros > Comerciais (15/10/2026)
-- 1) Foto própria do comercial (cartão público usa photo_url; sem ela, cai na
--    foto do usuário vinculado e depois nas iniciais). Arquivo vai para o
--    bucket `avatars`, pasta `comerciais/`, enviado pela server action com
--    service role (não precisa de política nova de storage).
-- 2) Novo cargo "Comercial Independente" (role = 'independente'), abaixo do
--    Gerente; superior direto pode ser gerente, supervisor ou superintendente
--    (regra validada na server action). Registros existentes não mudam.
-- Idempotente.

ALTER TABLE public.commercial_entities ADD COLUMN IF NOT EXISTS photo_url text;

-- O CHECK do role nasceu inline (nome automático); remove qualquer CHECK que
-- enumere os cargos, seja qual for o nome, e recria com o novo valor.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.commercial_entities'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%superintendente%'
  LOOP
    EXECUTE format('ALTER TABLE public.commercial_entities DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.commercial_entities
  ADD CONSTRAINT commercial_entities_role_check
  CHECK (role IN ('superintendente', 'supervisor', 'gerente', 'independente'));
