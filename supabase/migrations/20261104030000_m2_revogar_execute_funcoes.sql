-- Leva 2, bloco "isolamento por tipo de conta", M2: tira EXECUTE de PUBLIC/anon/authenticated
-- das 17 funções SECURITY INVOKER de `public` que hoje qualquer JWT (e anon) chama por RPC.
--
-- Lista conferida em 04/11 no espelho local e em produção (mesmas assinaturas, mesmo md5 do corpo,
-- mesmo ACL; são TODAS as funções de `public` fora de extensão executáveis por anon/authenticated):
--   * 11 de trigger (trigger_set_timestamp em 95 triggers, link_employee_by_cpf, chat_gerar_protocolo,
--     7 convenio_bc_valida_*, convenio_conteudo_site_set_timestamp). O Postgres só confere EXECUTE da
--     função ao CRIAR o trigger; no disparo não confere (provado no Docker: INSERT/UPDATE como
--     authenticated e service_role continuam disparando depois do REVOKE).
--   * 6 chamadas pelos apps só com service role: comissionamento_versionar_prazo/_tabela,
--     next_crm_campanha_numero, nvti_spend_by_user, nvti_user_spend, wa_campaign_counter_column.
--     wa_campaign_counter_column é chamada só por wa_campaign_recipients_counter_trg() (SECURITY DEFINER,
--     dono postgres), que continua podendo.
-- Nenhuma política RLS, default de coluna, view, CHECK ou outra função chama alguma delas com
-- anon/authenticated (conferido em produção por pg_policies/pg_attrdef/pg_views/pg_constraint/prosrc).
--
-- PUBLIC precisa sair junto: 15 das 17 têm `=X/postgres` (EXECUTE para PUBLIC), e só tirar
-- anon/authenticated não fecharia nada. service_role mantém (GRANT explícito abaixo é no-op hoje,
-- só garante que não dependa de PUBLIC).
-- Atenção: CREATE OR REPLACE mantém o ACL; DROP + CREATE de uma delas volta a dar EXECUTE para
-- anon/authenticated pelos default privileges do Supabase. Repetir o REVOKE nesses casos.

REVOKE EXECUTE ON FUNCTION
  public.chat_gerar_protocolo(),
  public.comissionamento_versionar_prazo(uuid, jsonb),
  public.comissionamento_versionar_tabela(uuid, jsonb),
  public.convenio_bc_valida_documento(),
  public.convenio_bc_valida_faq(),
  public.convenio_bc_valida_faq_vinculo(),
  public.convenio_bc_valida_forma_if(),
  public.convenio_bc_valida_margens(),
  public.convenio_bc_valida_orgao_if(),
  public.convenio_bc_valida_publico_if(),
  public.convenio_conteudo_site_set_timestamp(),
  public.link_employee_by_cpf(),
  public.next_crm_campanha_numero(),
  public.nvti_spend_by_user(timestamp with time zone, timestamp with time zone),
  public.nvti_user_spend(uuid, timestamp with time zone, timestamp with time zone),
  public.trigger_set_timestamp(),
  public.wa_campaign_counter_column(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.chat_gerar_protocolo(),
  public.comissionamento_versionar_prazo(uuid, jsonb),
  public.comissionamento_versionar_tabela(uuid, jsonb),
  public.convenio_bc_valida_documento(),
  public.convenio_bc_valida_faq(),
  public.convenio_bc_valida_faq_vinculo(),
  public.convenio_bc_valida_forma_if(),
  public.convenio_bc_valida_margens(),
  public.convenio_bc_valida_orgao_if(),
  public.convenio_bc_valida_publico_if(),
  public.convenio_conteudo_site_set_timestamp(),
  public.link_employee_by_cpf(),
  public.next_crm_campanha_numero(),
  public.nvti_spend_by_user(timestamp with time zone, timestamp with time zone),
  public.nvti_user_spend(uuid, timestamp with time zone, timestamp with time zone),
  public.trigger_set_timestamp(),
  public.wa_campaign_counter_column(text)
TO service_role;

-- ROLLBACK (volta exatamente ao ACL de 04/11; idempotente):
--   GRANT EXECUTE ON FUNCTION
--     public.chat_gerar_protocolo(),
--     public.convenio_bc_valida_documento(),
--     public.convenio_bc_valida_faq(),
--     public.convenio_bc_valida_faq_vinculo(),
--     public.convenio_bc_valida_forma_if(),
--     public.convenio_bc_valida_margens(),
--     public.convenio_bc_valida_orgao_if(),
--     public.convenio_bc_valida_publico_if(),
--     public.convenio_conteudo_site_set_timestamp(),
--     public.link_employee_by_cpf(),
--     public.next_crm_campanha_numero(),
--     public.nvti_spend_by_user(timestamp with time zone, timestamp with time zone),
--     public.nvti_user_spend(uuid, timestamp with time zone, timestamp with time zone),
--     public.trigger_set_timestamp(),
--     public.wa_campaign_counter_column(text)
--   TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION
--     public.comissionamento_versionar_prazo(uuid, jsonb),
--     public.comissionamento_versionar_tabela(uuid, jsonb)
--   TO anon, authenticated;   -- estas duas nunca tiveram PUBLIC
