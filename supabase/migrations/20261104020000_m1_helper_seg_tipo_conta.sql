-- Leva 2, bloco "isolamento por tipo de conta", M1: helper app_private.seg_tipo_conta().
--
-- Devolve o tipo da conta do JWT atual: 'interno' | 'parceiro' | 'atendente' | NULL.
-- Esta migration só cria a função; nenhuma política usa o helper ainda (isso é M4).
--
-- Regras, na ordem:
--   1. Marca explícita `app_metadata.tipo` (só service role grava app_metadata; nunca user_metadata):
--      valor conhecido -> devolve; marca presente com valor desconhecido/vazio -> NULL (nega).
--   2. Sem `sub` no token -> NULL.
--   3. TRANSIÇÃO (token sem marca; remover em M6, depois da marcação M5 + 24 h):
--      deduz pelo banco, com o tipo MENOS privilegiado vencendo em caso de ambiguidade:
--        `app_metadata.external` preenchido (CRM: 'alvoconsig')  -> 'atendente' (sem ler tabela)
--        linha em agentes_parceiros (auth_user_id)                -> 'parceiro' (inclui os masters do CRM)
--        linha em crm_usuarios (auth_user_id)                     -> 'atendente'
--        app_private.is_active_internal_user_base()               -> 'interno' (users ativo, sem e-mail @parceiro, sem external)
--        nada disso                                               -> NULL
--      Produção em 04/11: 0 contas em users ∩ agentes_parceiros e 0 em users ∩ crm_usuarios, então
--      a precedência não tira nenhum interno do 'interno'.
--
-- SECURITY DEFINER: o parceiro não lê a própria linha de agentes_parceiros pela RLS atual, então o
-- ramo de transição precisa ler como o dono. Risco baixo: sem argumentos, só olha auth.uid() e devolve
-- um rótulo sobre o próprio chamador. search_path vazio, tudo qualificado.
-- Custo: os dois EXISTS usam índices únicos (agentes_parceiros_auth_user_idx, crm_usuarios_auth_user_id_key)
-- e users.id é PK. Nas políticas usar SEMPRE `(SELECT app_private.seg_tipo_conta())` para virar initPlan
-- (uma avaliação por comando, não por linha).
--
-- EXECUTE só para `authenticated` (as políticas rodam com o papel do usuário). `service_role` tem
-- BYPASSRLS e não precisa; `anon`/PUBLIC ficam sem.

CREATE OR REPLACE FUNCTION app_private.seg_tipo_conta()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN (auth.jwt() -> 'app_metadata') ? 'tipo' THEN
      CASE WHEN auth.jwt() -> 'app_metadata' ->> 'tipo' IN ('interno', 'parceiro', 'atendente')
           THEN auth.jwt() -> 'app_metadata' ->> 'tipo'
      END
    WHEN auth.uid() IS NULL THEN NULL
    -- TRANSIÇÃO: remover daqui para baixo em M6 (sem marca = NULL).
    WHEN COALESCE(auth.jwt() -> 'app_metadata' ->> 'external', '') <> '' THEN 'atendente'
    WHEN EXISTS (SELECT 1 FROM public.agentes_parceiros a WHERE a.auth_user_id = auth.uid()) THEN 'parceiro'
    WHEN EXISTS (SELECT 1 FROM public.crm_usuarios c WHERE c.auth_user_id = auth.uid()) THEN 'atendente'
    WHEN app_private.is_active_internal_user_base() THEN 'interno'
  END
$$;

COMMENT ON FUNCTION app_private.seg_tipo_conta() IS
  'Tipo da conta do JWT (interno|parceiro|atendente|NULL). Lê app_metadata.tipo; sem marca deduz pelo banco (transição, remover em M6). Usar como (SELECT app_private.seg_tipo_conta()) nas políticas.';

REVOKE ALL ON FUNCTION app_private.seg_tipo_conta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.seg_tipo_conta() TO authenticated;

-- ROLLBACK (idempotente; nada depende da função até M4 existir):
--   DROP FUNCTION IF EXISTS app_private.seg_tipo_conta();
