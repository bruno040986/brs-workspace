-- Leva 2, bloco "isolamento por tipo de conta", M4: gate RESTRITIVO por tipo de conta em TODAS as
-- tabelas de `public`.
--
-- Depende de M1 (app_private.seg_tipo_conta(): 'interno' | 'parceiro' | 'atendente' | NULL).
--
-- O que faz:
--   1. app_private.seg_gate_excecoes(): fonte ÚNICA das tabelas que o Portal/CRM acessam com o JWT do
--      usuário (não service role) e dos tipos que cada uma aceita. Usada aqui e pelo monitor.
--   2. Em toda tabela de `public` (relkind 'r' e 'p', inclusive partições): garante RLS ligada (nunca
--      desliga) e (re)cria a política RESTRITIVA `seg_gate_tipo_interno` FOR ALL TO authenticated:
--        tabela comum : USING/WITH CHECK ((SELECT app_private.seg_tipo_conta()) = 'interno')
--        exceção      : USING/WITH CHECK ((SELECT app_private.seg_tipo_conta()) IN (<tipos da exceção>))
--      Mesmo nome em todas (exceção também tem gate, só que com os tipos certos): rollback e monitor por nome.
--   3. marketing_arte_assoc_sel: `true` -> has_permission('marketing-biblioteca-artes','can_view')
--      (decisão do dono 04/11; o Workspace lê essa tabela só com service role, artes-actions.ts).
--   4. app_private.seg_tabelas_sem_gate(): diagnóstico; lista tabela de `public` sem o gate, com gate
--      divergente da lista, com RLS desligada, ou exceção que não existe. Vazio = ok.
--
-- Efeito (provado no espelho local e, para o helper, em produção só com SELECT):
--   * interno: nada muda (o gate é constante TRUE para quem o helper classifica 'interno'; em produção
--     os 6 internos ativos dão 'interno'). Única mudança intencional: interno SEM permissão
--     'marketing-biblioteca-artes' deixa de ler marketing_arte_associacoes (item 3).
--   * parceiro/atendente: negados em todas as tabelas internas (inclui hub_banners, os 6 catálogos com
--     ramo is_active = true, marketing_arte_associacoes, INSERT em audit_logs); nas exceções seguem as
--     políticas atuais (o gate só filtra o tipo).
--   * conta sem tipo (NULL: banida/inativa, sub sem conta, marca inválida) e anon: nada.
--   * service_role tem BYPASSRLS: Portal admin, CRM admin, engine e crons não mudam.
--   * Realtime postgres_changes aplica a RLS com o JWT do assinante: as 7 tabelas assinadas por
--     Portal/CRM estão nas exceções com o tipo certo.
--   * Views: as 4 de `public` não têm GRANT para anon/authenticated; crm_contato_anuncios é
--     security_invoker (herdaria o gate das tabelas de base).
--   * Custo: `(SELECT ...)` vira initPlan (uma avaliação por comando, não por linha).
--
-- REGRA DO PROJETO: toda tabela nova em `public` nasce SEM este gate (CREATE TABLE não herda política).
-- Quem cria tabela nova inclui na mesma migration:
--   CREATE POLICY seg_gate_tipo_interno ON public.<t> AS RESTRICTIVE FOR ALL TO authenticated
--     USING ((SELECT app_private.seg_tipo_conta()) = 'interno')
--     WITH CHECK ((SELECT app_private.seg_tipo_conta()) = 'interno');
-- ou, se Portal/CRM vão ler com JWT do usuário, acrescenta a tabela em seg_gate_excecoes() e reaplica
-- o bloco 2. `SELECT * FROM app_private.seg_tabelas_sem_gate()` tem de voltar vazio.

-- 1. Fonte única das exceções ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.seg_gate_excecoes()
RETURNS TABLE (tabela text, tipos text[])
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  VALUES
    -- PORTAL (JWT do parceiro). Evidência: repo brs-portal-parceiro (4af4c64).
    ('parceiro_carteiras',                 ARRAY['interno','parceiro']),             -- area/page.tsx:28, area/conta/actions.ts:57, lib/conta/queries.ts:30
    ('parceiro_lancamentos',               ARRAY['interno','parceiro']),             -- lib/conta/queries.ts:32 (via area/conta/page.tsx:24)
    ('parceiro_saques',                    ARRAY['interno','parceiro']),             -- area/conta/actions.ts:59, lib/conta/queries.ts:38
    ('parceiro_cobrancas_pix',             ARRAY['interno','parceiro']),             -- area/conta/actions.ts:147; Realtime lib/pix/useCobrancaPaga.ts:50-72
    ('nvti_lotes_parceiro',                ARRAY['interno','parceiro']),             -- area/page.tsx:32, higienizacao/page.tsx:20, higienizacao/actions.ts:269, higienizacao/download/[id]/route.ts:18
    ('nuvidio_convites',                   ARRAY['interno','parceiro']),             -- lib/nuvidio/convites.ts:55; Realtime confirmacao-propostas/ConfirmacaoPropostasClient.tsx:82-88
    ('solicitacoes_atualizacao_cadastral', ARRAY['interno','parceiro']),             -- lib/agente-corban/solicitacoes.ts:15
    ('marketing_artes_geradas',            ARRAY['interno','parceiro']),             -- lib/marketing/historico.ts:29 (embed marketing_artes)
    ('marketing_artes',                    ARRAY['interno','parceiro']),             -- lib/marketing/artes.ts:65,109; embed em historico.ts:30
    -- CRM (Realtime com JWT do atendente ou do master, que é parceiro). Evidência: repo brs-alvoconsig (4195dd5), apps/web.
    ('crm_notificacoes',                   ARRAY['interno','parceiro','atendente']), -- components/crm/BalaoSolicitacoes.tsx:51-52
    ('crm_presenca',                       ARRAY['interno','parceiro','atendente']), -- components/crm/agente-ia/PresencaEquipe.tsx:35-36
    ('crm_chat_mensagens',                 ARRAY['interno','parceiro','atendente']), -- components/crm/chat-interno/ChatInterno.tsx:277-280,333-335
    ('chat_atendimento_sinais',            ARRAY['interno','parceiro','atendente']), -- components/crm/atendimento/ConversaCentro.tsx:324, FilaConversas.tsx:220 (fora da publicação hoje)
    ('crm_chamadas',                       ARRAY['interno','parceiro','atendente'])  -- components/crm/discadora/ChamadaAoVivo.tsx:48-51 (fora da publicação hoje)
    -- INCERTAS (decisão do dono), hoje com gate só 'interno' porque nenhum app as lê com JWT:
    --   parceiro_consultas_cpf   (Portal lê por service role: lib/nvti/pricing.ts:94-96)
    --   marketing_parceiro_logos (Portal lê/grava por service role: lib/marketing/logos-parceiro.ts:20-22, area/marketing/actions.ts:68)
    -- Para liberar ao parceiro: acrescentar aqui com ARRAY['interno','parceiro'] e reaplicar o bloco 2.
$$;

COMMENT ON FUNCTION app_private.seg_gate_excecoes() IS
  'Tabelas de public que Portal/CRM acessam com JWT do usuário e os tipos de conta aceitos no gate seg_gate_tipo_interno. Todas as outras: só interno.';

REVOKE ALL ON FUNCTION app_private.seg_gate_excecoes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.seg_gate_excecoes() TO service_role;

-- 2. Gate em lote (idempotente) ----------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_expr text;
  v_falta text;
BEGIN
  SELECT string_agg(e.tabela, ', ') INTO v_falta
    FROM app_private.seg_gate_excecoes() e
   WHERE to_regclass(format('public.%I', e.tabela)) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'M4: exceções sem tabela em public: %', v_falta;
  END IF;

  FOR r IN
    SELECT c.relname, c.relrowsecurity, e.tipos
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN app_private.seg_gate_excecoes() e ON e.tabela = c.relname
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d            -- tabelas de extensão ficam de fora
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
     ORDER BY c.relname
  LOOP
    IF NOT r.relrowsecurity THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    END IF;

    v_expr := CASE
      WHEN r.tipos IS NULL THEN '(SELECT app_private.seg_tipo_conta()) = ''interno'''
      ELSE format('(SELECT app_private.seg_tipo_conta()) IN (%s)',
                  (SELECT string_agg(quote_literal(t), ', ') FROM unnest(r.tipos) t))
    END;

    EXECUTE format('DROP POLICY IF EXISTS seg_gate_tipo_interno ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY seg_gate_tipo_interno ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      r.relname, v_expr, v_expr);
  END LOOP;
END $$;

-- 3. marketing_arte_associacoes: fim do SELECT `true` ------------------------------------------------
DROP POLICY IF EXISTS marketing_arte_assoc_sel ON public.marketing_arte_associacoes;
CREATE POLICY marketing_arte_assoc_sel ON public.marketing_arte_associacoes
  FOR SELECT TO authenticated
  USING ((SELECT app_private.has_permission('marketing-biblioteca-artes', 'can_view')));

-- 4. Diagnóstico para o monitor ---------------------------------------------------------------------
-- Vazio = ok. problema: 'sem_gate' | 'gate_divergente' | 'rls_desligada' | 'excecao_inexistente'.
-- Para ligar ao monitor: item novo em public.seg_monitor_itens() (ex.: tabela_sem_gate_tipo, gravidade
-- alta) com `SELECT ... FROM app_private.seg_tabelas_sem_gate()`; não feito aqui para não mexer na baseline.
CREATE OR REPLACE FUNCTION app_private.seg_tabelas_sem_gate()
RETURNS TABLE (tabela text, problema text, esperado text[], encontrado text[])
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH t AS (
    SELECT c.relname::text AS tabela, c.relrowsecurity,
           COALESCE(e.tipos, ARRAY['interno']) AS esperado,
           p.permissive, p.cmd, p.roles,
           (SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
              FROM regexp_matches(COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, ''),
                                  '''([a-z_]+)''::text', 'g') m) AS literais,
           p.qual, p.with_check
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN app_private.seg_gate_excecoes() e ON e.tabela = c.relname
      LEFT JOIN pg_catalog.pg_policies p
             ON p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'seg_gate_tipo_interno'
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                        WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  )
  SELECT tabela, 'rls_desligada', esperado, NULL::text[] FROM t WHERE NOT relrowsecurity
  UNION ALL
  SELECT tabela, 'sem_gate', esperado, NULL::text[] FROM t WHERE permissive IS NULL
  UNION ALL
  SELECT tabela, 'gate_divergente', esperado, literais
    FROM t
   WHERE permissive IS NOT NULL
     AND (permissive <> 'RESTRICTIVE' OR cmd <> 'ALL' OR roles <> ARRAY['authenticated']::name[]
          OR qual IS NULL OR with_check IS NULL
          OR qual NOT LIKE '%app_private.seg_tipo_conta()%' OR with_check NOT LIKE '%app_private.seg_tipo_conta()%'
          OR literais IS DISTINCT FROM (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(esperado) x))
  UNION ALL
  SELECT e.tabela, 'excecao_inexistente', e.tipos, NULL::text[]
    FROM app_private.seg_gate_excecoes() e
   WHERE to_regclass(format('public.%I', e.tabela)) IS NULL
$$;

COMMENT ON FUNCTION app_private.seg_tabelas_sem_gate() IS
  'Diagnóstico do gate seg_gate_tipo_interno: tabelas de public sem gate, com gate divergente de seg_gate_excecoes(), com RLS desligada, ou exceção inexistente. Vazio = ok.';

REVOKE ALL ON FUNCTION app_private.seg_tabelas_sem_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.seg_tabelas_sem_gate() TO service_role;

-- ROLLBACK (idempotente; não toca em nenhuma outra política; RLS fica ligada):
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'seg_gate_tipo_interno'
--     LOOP EXECUTE format('DROP POLICY IF EXISTS seg_gate_tipo_interno ON public.%I', r.tablename); END LOOP;
--   END $$;
--   DROP POLICY IF EXISTS marketing_arte_assoc_sel ON public.marketing_arte_associacoes;
--   CREATE POLICY marketing_arte_assoc_sel ON public.marketing_arte_associacoes FOR SELECT TO authenticated USING (true);
--   DROP FUNCTION IF EXISTS app_private.seg_tabelas_sem_gate();
--   DROP FUNCTION IF EXISTS app_private.seg_gate_excecoes();
