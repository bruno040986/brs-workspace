-- Leva 2, bloco "isolamento por tipo de conta", M5: marca `app_metadata.tipo` nas contas existentes
-- e deixa uma rede de segurança para as contas novas.
--
-- Depende de M1 (app_private.seg_tipo_conta(), ramo de TRANSIÇÃO). Prepara M6 (helper estrito: sem marca
-- = NULL = negado), que só pode sair >= 24 h depois desta migration e com o código que grava `tipo` no ar.
--
-- O que faz:
--   1. app_private.seg_tipo_deduzido(uuid): a MESMA dedução do ramo de transição do helper M1, só que por
--      id em vez de auth.uid(), lendo `external` de raw_app_meta_data (é de onde o JWT tira app_metadata):
--        external preenchido -> 'atendente'; linha em agentes_parceiros -> 'parceiro';
--        linha em crm_usuarios -> 'atendente'; users ativo, e-mail não @parceiro -> 'interno'; senão NULL.
--      Usada no backfill, na verificação e no diagnóstico. Manter igual ao M1 enquanto o M1 existir.
--   2. Backfill idempotente: grava `tipo` = dedução nas contas SEM a chave `tipo` (marca existente nunca é
--      sobrescrita). Dedução NULL = conta fica SEM marca. Só raw_app_meta_data muda: e-mail, banned_until,
--      senha, sessões e updated_at ficam como estão. O trigger m04_authusers_revogar_liberacoes é
--      `UPDATE OF email, banned_until, encrypted_password`: não dispara (marcar não revoga liberações).
--      Cada id marcado vai para app_private.seg_m5_marcadas (base do rollback).
--      Produção em 04/11 (agregado): 6 interno, 7 parceiro, 15 atendente = 28 marcadas; 9 ficam sem
--      marca, todas banidas: 6 internas inativas (users.active = false) e as 3 do incidente de 31/10
--      (sem linha em nenhuma tabela). Banidas: decidido marcar só o que o helper deduz hoje. As 9 já são
--      NULL no helper (negadas pelo gate M4) e seguem NULL depois de M6; o ban do GoTrue também impede
--      login/refresh. Se uma interna for reativada, o Workspace (setUserActive) grava tipo='interno'.
--   3. Rede de segurança: trigger BEFORE INSERT OR UPDATE OF raw_app_meta_data em auth.users
--      (seg_m5_marcar_tipo), só com dados da própria linha, quando a chave `tipo` falta em NEW:
--        UPDATE e OLD tinha `tipo` -> mantém o tipo de OLD (protege contra código que SUBSTITUI o
--                                     app_metadata inteiro; para trocar a marca, grave outro valor);
--        `external` preenchido     -> 'atendente' (mesma regra 1 do helper; app_metadata só a service role grava).
--      NÃO deduz por e-mail: 'interno' por e-mail @brspromotora daria o tipo mais privilegiado a partir de
--      um dado que um cadastro pode escolher, e 'parceiro' por @parceiro.brspromotora.com.br subiria de NULL
--      para 'parceiro' uma conta sem agentes_parceiros. Interno e parceiro só pelo código do Workspace.
--      Não consulta tabela (no INSERT do GoTrue as linhas de users/agentes_parceiros ainda não existem).
--      Erro interno do trigger é engolido (devolve NEW sem marca): nunca quebra criação/login do GoTrue.
--   4. app_private.seg_contas_sem_tipo(): diagnóstico para o monitor (service_role). Lista contas ATIVAS
--      (não banidas, não apagadas) sem `tipo` válido, com a dedução atual. Vazio = pronto para M6.
--
-- JWTs já emitidos não mudam: a marca aparece no próximo refresh/login (jwt_expiry, padrão 1 h). Até M6
-- o helper deduz para esses tokens; por isso M6 só >= 24 h depois.

-- 1. Dedução por id (espelho do ramo de transição de app_private.seg_tipo_conta()).
CREATE OR REPLACE FUNCTION app_private.seg_tipo_deduzido(p_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(u.raw_app_meta_data ->> 'external', '') <> '' THEN 'atendente'
    WHEN EXISTS (SELECT 1 FROM public.agentes_parceiros a WHERE a.auth_user_id = u.id) THEN 'parceiro'
    WHEN EXISTS (SELECT 1 FROM public.crm_usuarios c WHERE c.auth_user_id = u.id) THEN 'atendente'
    WHEN EXISTS (SELECT 1 FROM public.users p
                  WHERE p.id = u.id
                    AND COALESCE(p.active, true) = true
                    AND COALESCE(p.email, '') NOT ILIKE '%@parceiro.brspromotora.com.br') THEN 'interno'
  END
  FROM auth.users u
  WHERE u.id = p_uid
$$;

COMMENT ON FUNCTION app_private.seg_tipo_deduzido(uuid) IS
  'Tipo deduzido pelo banco para a conta (mesma ordem do ramo de transição de seg_tipo_conta). Base do backfill M5 e de seg_contas_sem_tipo().';

REVOKE ALL ON FUNCTION app_private.seg_tipo_deduzido(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.seg_tipo_deduzido(uuid) TO service_role;

-- 2. Registro do backfill (rollback) + backfill.
CREATE TABLE IF NOT EXISTS app_private.seg_m5_marcadas (
  user_id    uuid PRIMARY KEY,
  tipo       text NOT NULL,
  marcado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.seg_m5_marcadas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.seg_m5_marcadas FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE app_private.seg_m5_marcadas IS
  'Contas que receberam app_metadata.tipo no backfill M5 (rollback remove só estas, se a marca não mudou).';

WITH alvo AS (
  SELECT u.id, app_private.seg_tipo_deduzido(u.id) AS tipo
    FROM auth.users u
   WHERE jsonb_typeof(COALESCE(u.raw_app_meta_data, '{}'::jsonb)) = 'object'
     AND NOT (COALESCE(u.raw_app_meta_data, '{}'::jsonb) ? 'tipo')
), marcadas AS (
  UPDATE auth.users u
     SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('tipo', a.tipo)
    FROM alvo a
   WHERE u.id = a.id
     AND a.tipo IS NOT NULL
  RETURNING u.id, a.tipo
)
INSERT INTO app_private.seg_m5_marcadas (user_id, tipo)
SELECT id, tipo FROM marcadas
ON CONFLICT (user_id) DO NOTHING;

-- 3. Rede de segurança (criada DEPOIS do backfill).
CREATE OR REPLACE FUNCTION app_private.seg_m5_marcar_tipo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(meta) <> 'object' OR meta ? 'tipo' THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.raw_app_meta_data) = 'object' AND OLD.raw_app_meta_data ? 'tipo' THEN
      NEW.raw_app_meta_data := meta || jsonb_build_object('tipo', OLD.raw_app_meta_data -> 'tipo');
    ELSIF COALESCE(meta ->> 'external', '') <> '' THEN
      NEW.raw_app_meta_data := meta || jsonb_build_object('tipo', 'atendente');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- nunca bloquear o GoTrue; a conta sai sem marca e aparece em seg_contas_sem_tipo().
  END;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION app_private.seg_m5_marcar_tipo() IS
  'Trigger M5 em auth.users: sem `tipo`, mantém o de OLD (UPDATE) ou marca atendente se houver external. Nunca deduz interno/parceiro.';

REVOKE ALL ON FUNCTION app_private.seg_m5_marcar_tipo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS seg_m5_marcar_tipo ON auth.users;
CREATE TRIGGER seg_m5_marcar_tipo
  BEFORE INSERT OR UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_private.seg_m5_marcar_tipo();

-- 4. Diagnóstico para o monitor.
CREATE OR REPLACE FUNCTION app_private.seg_contas_sem_tipo()
RETURNS TABLE (user_id uuid, marca text, tipo_deduzido text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.raw_app_meta_data ->> 'tipo', app_private.seg_tipo_deduzido(u.id)
    FROM auth.users u
   WHERE (u.banned_until IS NULL OR u.banned_until <= now())
     AND u.deleted_at IS NULL
     AND COALESCE(u.raw_app_meta_data ->> 'tipo', '') NOT IN ('interno', 'parceiro', 'atendente')
$$;

COMMENT ON FUNCTION app_private.seg_contas_sem_tipo() IS
  'Contas ativas (não banidas, não apagadas) sem app_metadata.tipo válido. Vazio = pronto para o helper estrito (M6).';

REVOKE ALL ON FUNCTION app_private.seg_contas_sem_tipo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.seg_contas_sem_tipo() TO service_role;

-- VERIFICAÇÃO (só leitura; esperado em produção 04/11: atendente 15, interno 6, parceiro 7, (sem) 9;
-- ativas_sem_marca 0; divergentes 0):
--   SELECT COALESCE(raw_app_meta_data ->> 'tipo', '(sem)') AS tipo,
--          (banned_until IS NOT NULL AND banned_until > now()) AS banida, count(*)
--     FROM auth.users GROUP BY 1, 2 ORDER BY 1, 2;
--   SELECT count(*) AS ativas_sem_marca FROM app_private.seg_contas_sem_tipo();
--   SELECT count(*) AS divergentes FROM auth.users u
--    WHERE u.raw_app_meta_data ? 'tipo'
--      AND u.raw_app_meta_data ->> 'tipo' IS DISTINCT FROM app_private.seg_tipo_deduzido(u.id);
--   SELECT count(*) AS registradas FROM app_private.seg_m5_marcadas;   -- 28
--
-- ROLLBACK (só antes de M6; com o helper estrito, tirar a marca nega todo mundo: desfazer M6 primeiro).
-- Remove `tipo` só das contas marcadas aqui e cuja marca não mudou; marcas gravadas depois pelo código
-- (fora de seg_m5_marcadas) ficam. O trigger sai primeiro (senão ele devolveria o tipo de OLD).
--   BEGIN;
--   DROP TRIGGER IF EXISTS seg_m5_marcar_tipo ON auth.users;
--   UPDATE auth.users u SET raw_app_meta_data = u.raw_app_meta_data - 'tipo'
--     FROM app_private.seg_m5_marcadas m
--    WHERE u.id = m.user_id AND u.raw_app_meta_data ->> 'tipo' = m.tipo;
--   DROP FUNCTION IF EXISTS app_private.seg_m5_marcar_tipo();
--   DROP FUNCTION IF EXISTS app_private.seg_contas_sem_tipo();
--   DROP FUNCTION IF EXISTS app_private.seg_tipo_deduzido(uuid);
--   DROP TABLE IF EXISTS app_private.seg_m5_marcadas;
--   COMMIT;
