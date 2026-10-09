-- Testes de *_chat_anuncio_ocorrencias.sql (Workspace). COPIAR para
-- brs-alvoconsig/tests/db/anuncio-lead.sql. Roda DEPOIS da migration (aplicada
-- DUAS vezes), com os dados do anuncio-lead-fixture.sql. Usa pg_temp.assert_true.
-- T = 2026-09-01 12:00 UTC. Parceiro A = ...0006-000000000001, B = ...0006-000000000002.

-- ---------------------------------------------------------------------------
-- Estrutura, acesso e permissão
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select relrowsecurity from pg_class where oid = 'public.chat_anuncio_ocorrencias'::regclass), 'RLS ligada em chat_anuncio_ocorrencias');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid = 'public.crm_meta_anuncios'::regclass), 'RLS ligada em crm_meta_anuncios');
select pg_temp.assert_true((select count(*) = 0 from pg_policies where tablename in ('chat_anuncio_ocorrencias', 'crm_meta_anuncios')), 'sem policy (só service role)');
select pg_temp.assert_true((select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.crm_contato_anuncios'::regclass), 'view com security_invoker');
select pg_temp.assert_true((select prosecdef and proconfig = array['search_path=""'] from pg_proc where proname = 'crm_relatorio_anuncios'), 'RPC security definer com search_path vazio');
select pg_temp.assert_true((select count(*) = 0 from pg_publication_tables where tablename in ('chat_anuncio_ocorrencias', 'crm_meta_anuncios')), 'fora da publicação Realtime');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.chat_anuncio_ocorrencias', 'select'), 'authenticated sem select na tabela');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.chat_anuncio_ocorrencias', 'select'), 'anon sem select na tabela');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.crm_meta_anuncios', 'select'), 'authenticated sem select no cache Meta');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.crm_contato_anuncios', 'select'), 'authenticated sem select na view');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.crm_relatorio_anuncios(uuid, timestamptz, timestamptz, uuid, int, boolean)', 'execute'), 'authenticated sem execute na RPC');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.crm_relatorio_anuncios(uuid, timestamptz, timestamptz, uuid, int, boolean)', 'execute'), 'anon sem execute na RPC');
select pg_temp.assert_true(has_table_privilege('service_role', 'public.chat_anuncio_ocorrencias', 'insert') and has_function_privilege('service_role', 'public.crm_relatorio_anuncios(uuid, timestamptz, timestamptz, uuid, int, boolean)', 'execute'), 'service_role grava e executa');
select pg_temp.assert_true((select count(*) = 2 from pg_indexes where indexname in ('propostas_credito_contato_idx', 'crm_solicitacoes_op_contato_idx')), 'índices de contato_id criados');

-- authenticated de fato barrado (não só pelo catálogo)
set role authenticated;
do $$ begin
  perform 1 from public.chat_anuncio_ocorrencias;
  raise exception 'FAIL: authenticated leu chat_anuncio_ocorrencias';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.crm_contato_anuncios;
  raise exception 'FAIL: authenticated leu a view';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.crm_relatorio_anuncios('00000000-0000-0000-0006-000000000001', now() - interval '1 year', now());
  raise exception 'FAIL: authenticated executou a RPC';
exception when insufficient_privilege then null; end $$;
reset role;

select pg_temp.assert_true((select count(*) = 2 from crm_perfis_permissoes pp join crm_perfis p on p.id = pp.perfil_id
  where pp.permissao = 'relatorios.anuncios' and p.agente_parceiro_id is null and p.chave in ('master', 'operacional')), 'master e operacional recebem relatorios.anuncios');
select pg_temp.assert_true((select count(*) = 0 from crm_perfis_permissoes pp join crm_perfis p on p.id = pp.perfil_id
  where pp.permissao = 'relatorios.anuncios' and p.chave not in ('master', 'operacional')), 'atendente não recebe relatorios.anuncios');

-- ---------------------------------------------------------------------------
-- Backfill (migration rodou 2x: continua 1 linha)
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select count(*) = 1 from chat_anuncio_ocorrencias where chat_conversa_id = '00000000-0000-0000-0006-0000000002a9'), 'backfill: 1 ocorrência mesmo com a migration 2x');
select pg_temp.assert_true((select wa_id = 'backfill:00000000-0000-0000-0006-0000000002a9' and provedor = 'backfill' and fonte = 'ctwa' and conversa_nova
  and recebido_em = timestamptz '2026-09-01 12:00+00' - interval '5 days' and source_id = 'AD_BACK' and ctwa_clid = 'clid-back'
  and agente_parceiro_id = '00000000-0000-0000-0006-000000000001'
  from chat_anuncio_ocorrencias where chat_conversa_id = '00000000-0000-0000-0006-0000000002a9'), 'backfill: campos corretos');

-- ---------------------------------------------------------------------------
-- Dados do cenário
-- ---------------------------------------------------------------------------
-- L1 lead antigo (T-100d); L2 novo (T+1h); L3 novo (T-5min, dentro dos 10 min); L4 do parceiro B
insert into crm_contatos (id, agente_parceiro_id, wesales_contact_id, nome, created_at) values
  ('00000000-0000-0000-0006-0000000001c1', '00000000-0000-0000-0006-000000000001', 'ws-6-1', 'Sintético 1', timestamptz '2026-09-01 12:00+00' - interval '100 days'),
  ('00000000-0000-0000-0006-0000000001c2', '00000000-0000-0000-0006-000000000001', 'ws-6-2', 'Sintético 2', timestamptz '2026-09-01 12:00+00' + interval '1 hour'),
  ('00000000-0000-0000-0006-0000000001c3', '00000000-0000-0000-0006-000000000001', 'ws-6-3', 'Sintético 3', timestamptz '2026-09-01 12:00+00' - interval '5 minutes'),
  ('00000000-0000-0000-0006-0000000001c4', '00000000-0000-0000-0006-000000000002', 'ws-6-4', 'Sintético 4', timestamptz '2026-09-01 12:00+00');
insert into crm_usuarios (id, agente_parceiro_id, ativo) values
  ('00000000-0000-0000-0006-0000000003a1', '00000000-0000-0000-0006-000000000001', true),
  ('00000000-0000-0000-0006-0000000003b1', '00000000-0000-0000-0006-000000000002', true);
-- c1 (inst a1) e c1b (inst a2) → L1; c2 → L2; c3 → L3; c4 sem lead; cB (parceiro B) → L4
insert into chat_conversas (id, instancia_id, crm_contato_id, created_at) values
  ('00000000-0000-0000-0006-0000000002a1', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000001c1', timestamptz '2026-09-01 12:00+00'),
  ('00000000-0000-0000-0006-0000000002a2', '00000000-0000-0000-0006-0000000000a2', '00000000-0000-0000-0006-0000000001c1', timestamptz '2026-09-03 12:00+00'),
  ('00000000-0000-0000-0006-0000000002a3', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000001c2', timestamptz '2026-09-01 12:00+00'),
  ('00000000-0000-0000-0006-0000000002a4', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000001c3', timestamptz '2026-09-01 12:00+00'),
  ('00000000-0000-0000-0006-0000000002a5', '00000000-0000-0000-0006-0000000000a1', null, timestamptz '2026-09-01 13:00+00'),
  ('00000000-0000-0000-0006-0000000002b1', '00000000-0000-0000-0006-0000000000b1', '00000000-0000-0000-0006-0000000001c4', timestamptz '2026-09-01 12:00+00');

-- Ocorrências como o engine grava (insert ... on conflict do nothing)
insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova, source_type, source_id, ctwa_clid) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a1', 'w1', 'baileys', timestamptz '2026-09-01 12:00+00', true, 'ad', 'AD1', 'clid-1'),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a2', '00000000-0000-0000-0006-0000000002a2', 'w2', 'baileys', timestamptz '2026-09-03 12:00+00', true, 'ad', 'AD2', 'clid-2'),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a3', 'w3', 'baileys', timestamptz '2026-09-01 12:00+00', true, 'ad', 'AD1', null),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a4', 'w4', 'baileys', timestamptz '2026-09-01 12:00+00', true, 'ad', 'AD3', null),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a4', 'w5', 'baileys', timestamptz '2026-09-02 12:00+00', false, 'ad', 'AD1', null),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a5', 'w6', 'baileys', timestamptz '2026-09-01 13:00+00', true, 'ad', 'AD1', null),
  ('00000000-0000-0000-0006-000000000002', '00000000-0000-0000-0006-0000000000b1', '00000000-0000-0000-0006-0000000002b1', 'w1', 'baileys', timestamptz '2026-09-01 12:00+00', true, 'ad', 'AD1', null)
on conflict (instancia_id, wa_id) do nothing;

-- Funil
insert into crm_solicitacoes_operacionais (agente_parceiro_id, tipo, contato_id, solicitado_por, criado_em) values
  ('00000000-0000-0000-0006-000000000001', 'simulacao', '00000000-0000-0000-0006-0000000001c1', '00000000-0000-0000-0006-0000000003a1', timestamptz '2026-09-02 12:00+00'), -- L1 → AD1
  ('00000000-0000-0000-0006-000000000001', 'simulacao', '00000000-0000-0000-0006-0000000001c1', '00000000-0000-0000-0006-0000000003a1', timestamptz '2026-09-04 12:00+00'), -- L1 → AD2 (corte)
  ('00000000-0000-0000-0006-000000000001', 'digitacao', '00000000-0000-0000-0006-0000000001c1', '00000000-0000-0000-0006-0000000003a1', timestamptz '2026-09-02 12:00+00'), -- não é simulação
  ('00000000-0000-0000-0006-000000000002', 'simulacao', '00000000-0000-0000-0006-0000000001c4', '00000000-0000-0000-0006-0000000003b1', timestamptz '2026-09-02 12:00+00'); -- parceiro B
insert into propostas_credito (agente_parceiro_id, contato_id, status, grupo, valor_liquido, finalizada_em, created_at) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000001c1', 'criada', 'pago', 1000, timestamptz '2026-09-03 00:00+00', timestamptz '2026-09-02 12:00+00'),       -- AD1 venda por grupo
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000001c2', 'cancelada', 'cancelado', 9999, null, timestamptz '2026-09-02 12:00+00'),                              -- AD1 proposta, não venda
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000001c1', 'paga', 'pendente', 500, null, timestamptz '2026-09-04 12:00+00'),                                     -- AD2 venda por status
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000001c1', 'aguardando_pagamento', 'em_andamento', 777, null, timestamptz '2026-09-04 12:00+00'),               -- AD2 proposta, não venda
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000001c1', 'paga', 'pago', 300, null, timestamptz '2026-10-04 13:00+00'),                                         -- fora da janela de 30 d do AD2
  ('00000000-0000-0000-0006-000000000002', '00000000-0000-0000-0006-0000000001c1', 'paga', 'pago', 8888, null, timestamptz '2026-09-02 12:00+00');                                       -- outro parceiro: ignorada

-- ---------------------------------------------------------------------------
-- Idempotência
-- ---------------------------------------------------------------------------
insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova, source_id)
values ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a1', 'w1', 'baileys', now(), false, 'OUTRO')
on conflict (instancia_id, wa_id) do nothing;
select pg_temp.assert_true((select count(*) = 1 and min(source_id) = 'AD1' from chat_anuncio_ocorrencias
  where instancia_id = '00000000-0000-0000-0006-0000000000a1' and wa_id = 'w1'), 'insert repetido não duplica nem sobrescreve');
do $$ begin
  insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova)
  values ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a1', 'w1', 'baileys', now(), false);
  raise exception 'FAIL: unique (instancia_id, wa_id) não barrou';
exception when unique_violation then null; end $$;
do $$ begin
  insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova)
  values ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a1', 'wx', 'inventado', now(), false);
  raise exception 'FAIL: provedor inválido passou';
exception when check_violation then null; end $$;
do $$ begin
  insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova, headline)
  values ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a1', 'wy', 'baileys', now(), false, repeat('x', 501));
  raise exception 'FAIL: headline > 500 passou';
exception when check_violation then null; end $$;

-- ---------------------------------------------------------------------------
-- View: liga ocorrência ao lead e não mistura parceiros
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select array_agg(distinct right(crm_contato_id::text, 3) order by right(crm_contato_id::text, 3)) = array['1c1', '1c2', '1c3']
  from crm_contato_anuncios where agente_parceiro_id = '00000000-0000-0000-0006-000000000001'), 'view do parceiro A: só leads de A, conversa sem lead fora');
select pg_temp.assert_true((select count(*) = 1 from crm_contato_anuncios where agente_parceiro_id = '00000000-0000-0000-0006-000000000002'), 'view do parceiro B: só a ocorrência de B');

-- ---------------------------------------------------------------------------
-- RPC: último clique, janela, lead novo x existente, vendas, isolamento
-- ---------------------------------------------------------------------------
create temp table rel_a as select * from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000001', timestamptz '2026-08-31 12:00+00', timestamptz '2026-09-11 12:00+00');

select pg_temp.assert_true((select array_agg(source_id order by source_id) = array['AD1', 'AD2', 'AD3'] from rel_a), 'A: AD1, AD2, AD3 (backfill fora do período)');

-- AD1: c1 (L1 antigo), c2 (L2 novo), c3 reentrada (L3, novo atribuído ao AD3), c4 sem lead
select pg_temp.assert_true((select conversas = 4 and conversas_novas = 3 and leads = 3 from rel_a where source_id = 'AD1'), 'AD1: 4 conversas (3 novas), 3 leads');
select pg_temp.assert_true((select leads_novos = 1 and leads_existentes = 1 and mediana_min_ate_lead = 60 from rel_a where source_id = 'AD1'), 'AD1: L2 novo (60 min), L1 existente, L3 novo do AD3 não conta');
select pg_temp.assert_true((select leads_novos = 1 and leads_existentes = 0 and leads = 1 and mediana_min_ate_lead = 0 from rel_a where source_id = 'AD3'), 'AD3: L3 criado 5 min antes do clique = novo (mediana 0)');
select pg_temp.assert_true((select leads = 1 and leads_existentes = 1 and leads_novos = 0 from rel_a where source_id = 'AD2'), 'AD2: L1 existente');

-- Corte do último clique: o AD2 (T+2d, outra instância) corta a janela do AD1 para L1
select pg_temp.assert_true((select simulacoes = 1 and mediana_min_ate_simulacao = 1440 from rel_a where source_id = 'AD1'), 'AD1: só a simulação antes do AD2 (digitação não conta)');
select pg_temp.assert_true((select simulacoes = 1 and mediana_min_ate_simulacao = 1440 from rel_a where source_id = 'AD2'), 'AD2: simulação depois do corte');

-- Vendas: grupo='pago' OU status='paga'; cancelada é proposta, não venda; fora da janela não conta
select pg_temp.assert_true((select propostas = 2 and vendas = 1 and valor_vendas = 1000 and mediana_min_ate_proposta = 1440 and mediana_min_ate_venda = 2160 from rel_a where source_id = 'AD1'), 'AD1: 2 propostas, 1 venda (grupo pago) de 1000');
select pg_temp.assert_true((select propostas = 2 and vendas = 1 and valor_vendas = 500 from rel_a where source_id = 'AD2'), 'AD2: 2 propostas, 1 venda (status paga) de 500; a de T+33d fica fora');
select pg_temp.assert_true((select coalesce(sum(valor_vendas), 0) = 1500 from rel_a), 'nenhum valor de outro parceiro ou cancelado');
select pg_temp.assert_true((select simulacoes = 0 and propostas = 0 and vendas = 0 from rel_a where source_id = 'AD3'), 'AD3: sem funil');

-- Isolamento: B só vê a própria conversa do AD1 e a própria simulação
select pg_temp.assert_true((select count(*) = 1 from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000002', timestamptz '2026-08-31 12:00+00', timestamptz '2026-09-11 12:00+00')), 'B: uma linha');
select pg_temp.assert_true((select conversas = 1 and leads = 1 and simulacoes = 1 and propostas = 0 and vendas = 0 and valor_vendas = 0
  from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000002', timestamptz '2026-08-31 12:00+00', timestamptz '2026-09-11 12:00+00')), 'B: não enxerga A (proposta de B com lead de A também fica fora)');
select pg_temp.assert_true((select count(*) = 0 from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000002', timestamptz '2026-08-31 12:00+00', timestamptz '2026-09-11 12:00+00', '00000000-0000-0000-0006-0000000000a1')), 'B pedindo instância de A: nada');

-- Filtro de instância: a2 só tem o AD2; a janela do AD1 continua cortada pelo AD2
select pg_temp.assert_true((select array_agg(source_id) = array['AD2'] from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000001', timestamptz '2026-08-31 12:00+00', timestamptz '2026-09-11 12:00+00', '00000000-0000-0000-0006-0000000000a2')), 'instância a2: só AD2');
select pg_temp.assert_true((select simulacoes = 1 from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000001', timestamptz '2026-08-31 12:00+00', timestamptz '2026-09-11 12:00+00', '00000000-0000-0000-0006-0000000000a1') where source_id = 'AD1'), 'instância a1: AD1 segue cortado pelo AD2 da a2');

-- Janela de 1 dia: a simulação de L1 em T+1d (fim exclusivo) sai do AD1; venda do AD1 também
select pg_temp.assert_true((select simulacoes = 0 and propostas = 0 and vendas = 0 from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000001', timestamptz '2026-08-31 12:00+00', timestamptz '2026-09-11 12:00+00', null, 1) where source_id = 'AD1'), 'janela 1 dia corta o funil do AD1');

-- Período que inclui o backfill
select pg_temp.assert_true((select conversas = 1 and conversas_novas = 1 and leads = 0 from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000001', timestamptz '2026-08-01 00:00+00', timestamptz '2026-09-11 12:00+00') where source_id = 'AD_BACK'), 'backfill aparece no relatório');

-- Vincular depois a conversa sem lead leva a atribuição junto (sem gatilho)
update chat_conversas set crm_contato_id = '00000000-0000-0000-0006-0000000001c2' where id = '00000000-0000-0000-0006-0000000002a5';
select pg_temp.assert_true((select count(*) = 2 from crm_contato_anuncios where crm_contato_id = '00000000-0000-0000-0006-0000000001c2'), 'vínculo novo aparece na view');

-- ---------------------------------------------------------------------------
-- Lead criado depois da janela, empate de recebido_em e backfill idempotente
-- ---------------------------------------------------------------------------
-- L5 criado 3 dias depois do clique (janela de 1 dia): tocado, mas nem novo nem existente.
-- L6 antigo, duas ocorrências com o MESMO recebido_em: o desempate é por id (a menor tem janela vazia).
insert into crm_contatos (id, agente_parceiro_id, wesales_contact_id, nome, created_at) values
  ('00000000-0000-0000-0006-0000000001c5', '00000000-0000-0000-0006-000000000001', 'ws-6-5', 'Sintético 5', timestamptz '2026-12-04 12:00+00'),
  ('00000000-0000-0000-0006-0000000001c6', '00000000-0000-0000-0006-000000000001', 'ws-6-6', 'Sintético 6', timestamptz '2026-01-01 12:00+00');
insert into chat_conversas (id, instancia_id, crm_contato_id, created_at) values
  ('00000000-0000-0000-0006-0000000002a6', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000001c5', timestamptz '2026-12-01 12:00+00'),
  ('00000000-0000-0000-0006-0000000002a7', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000001c6', timestamptz '2026-12-10 12:00+00');
insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova, source_type, source_id) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a6', 'late1', 'baileys', timestamptz '2026-12-01 12:00+00', true, 'ad', 'AD_LATE'),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a7', 'tie1', 'baileys', timestamptz '2026-12-10 12:00+00', false, 'ad', 'AD_TIE1'),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a7', 'tie2', 'baileys', timestamptz '2026-12-10 12:00+00', false, 'ad', 'AD_TIE2');
insert into propostas_credito (agente_parceiro_id, contato_id, status, grupo, valor_liquido, created_at) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000001c6', 'criada', 'em_andamento', 100, timestamptz '2026-12-10 13:00+00');
create temp table rel_x as select * from crm_relatorio_anuncios('00000000-0000-0000-0006-000000000001', timestamptz '2026-12-01 00:00+00', timestamptz '2026-12-20 00:00+00', null, 1);
select pg_temp.assert_true((select leads = 1 and leads_novos = 0 and leads_existentes = 0 from rel_x where source_id = 'AD_LATE'), 'lead criado depois da janela não conta como novo nem existente');
select pg_temp.assert_true((select propostas = 0 from rel_x where source_id = 'AD_TIE1'), 'empate de recebido_em: a ocorrência de menor id tem janela vazia');
select pg_temp.assert_true((select propostas = 1 from rel_x where source_id = 'AD_TIE2'), 'empate de recebido_em: a de maior id leva o funil (desempate por id)');

-- Backfill idempotente: conversa com origem_anuncio E ocorrência real (wa_id próprio) não ganha linha 'backfill'.
-- Repete o insert da seção 8 da migration (tem de ficar igual a ele).
insert into chat_conversas (id, instancia_id, origem_anuncio, created_at) values
  ('00000000-0000-0000-0006-0000000002a8', '00000000-0000-0000-0006-0000000000a1', '{"fonte":"ctwa","source_id":"AD_REAL"}', now());
insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova, source_id)
values ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002a8', 'real1', 'baileys', now(), true, 'AD_REAL');
do $$ begin
  for n in 1..2 loop
    insert into public.chat_anuncio_ocorrencias (
      agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, fonte, recebido_em, conversa_nova, source_type, source_id)
    select i.agente_parceiro_id, c.instancia_id, c.id, 'backfill:' || c.id, 'backfill', 'ctwa', c.created_at, true,
           c.origem_anuncio->>'source_type', c.origem_anuncio->>'source_id'
    from public.chat_conversas c
    join public.chat_instancias i on i.id = c.instancia_id
    where c.origem_anuncio is not null and jsonb_typeof(c.origem_anuncio) = 'object' and i.agente_parceiro_id is not null
      and not exists (select 1 from public.chat_anuncio_ocorrencias x where x.chat_conversa_id = c.id)
    on conflict (instancia_id, wa_id) do nothing;
  end loop;
end $$;
select pg_temp.assert_true((select count(*) = 1 and min(provedor) = 'baileys' from chat_anuncio_ocorrencias where chat_conversa_id = '00000000-0000-0000-0006-0000000002a8'), 'backfill rodado de novo não duplica conversa que já tem ocorrência');
select pg_temp.assert_true((select count(*) = 1 from chat_anuncio_ocorrencias where chat_conversa_id = '00000000-0000-0000-0006-0000000002a9'), 'backfill rodado de novo não duplica a conversa já migrada');

-- ---------------------------------------------------------------------------
-- Lead apagado (deleted_at) não conta; p_incluir_ia opcional (padrão inclui)
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select count(*) = 1 from pg_proc where proname = 'crm_relatorio_anuncios'), 'RPC sem sobrecarga (assinatura antiga removida)');
-- L7 apagado com proposta paga na janela; L8 criado pela IA (novo) com simulação na janela
insert into crm_contatos (id, agente_parceiro_id, wesales_contact_id, nome, created_at, deleted_at, origem) values
  ('00000000-0000-0000-0006-0000000001c7', '00000000-0000-0000-0006-000000000001', 'ws-6-7', 'Sintético 7', timestamptz '2026-01-01 12:00+00', now(), 'manual'),
  ('00000000-0000-0000-0006-0000000001c8', '00000000-0000-0000-0006-000000000001', 'ws-6-8', 'Sintético 8', timestamptz '2027-01-05 12:30+00', null, 'ia');
insert into chat_conversas (id, instancia_id, crm_contato_id, created_at) values
  ('00000000-0000-0000-0006-0000000002c7', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000001c7', timestamptz '2027-01-05 12:00+00'),
  ('00000000-0000-0000-0006-0000000002c8', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000001c8', timestamptz '2027-01-05 12:00+00');
insert into chat_anuncio_ocorrencias (agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, recebido_em, conversa_nova, source_type, source_id) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002c7', 'del1', 'baileys', timestamptz '2027-01-05 12:00+00', true, 'ad', 'AD_DEL'),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000000a1', '00000000-0000-0000-0006-0000000002c8', 'ia1', 'baileys', timestamptz '2027-01-05 12:00+00', true, 'ad', 'AD_IA');
insert into propostas_credito (agente_parceiro_id, contato_id, status, grupo, valor_liquido, created_at) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0006-0000000001c7', 'paga', 'pago', 4321, timestamptz '2027-01-05 13:00+00');
insert into crm_solicitacoes_operacionais (agente_parceiro_id, tipo, contato_id, solicitado_por, criado_em) values
  ('00000000-0000-0000-0006-000000000001', 'simulacao', '00000000-0000-0000-0006-0000000001c8', '00000000-0000-0000-0006-0000000003a1', timestamptz '2027-01-05 13:00+00');
-- Chamada com os nomes que o web envia (sem p_incluir_ia)
create temp table rel_d as select * from crm_relatorio_anuncios(p_parceiro => '00000000-0000-0000-0006-000000000001',
  p_de => timestamptz '2027-01-01 00:00+00', p_ate => timestamptz '2027-02-01 00:00+00', p_instancia => null, p_janela_dias => 30);
select pg_temp.assert_true((select conversas = 1 and leads = 0 and leads_novos = 0 and leads_existentes = 0 and simulacoes = 0
  and propostas = 0 and vendas = 0 and valor_vendas = 0 from rel_d where source_id = 'AD_DEL'), 'lead apagado: conversa conta, lead/proposta/venda não');
select pg_temp.assert_true((select leads = 1 and leads_novos = 1 and simulacoes = 1 from rel_d where source_id = 'AD_IA'), 'padrão (sem p_incluir_ia): lead da IA conta');
select pg_temp.assert_true((select conversas = 1 and leads = 0 and leads_novos = 0 and simulacoes = 0
  from crm_relatorio_anuncios(p_parceiro => '00000000-0000-0000-0006-000000000001', p_de => timestamptz '2027-01-01 00:00+00',
    p_ate => timestamptz '2027-02-01 00:00+00', p_incluir_ia => false) where source_id = 'AD_IA'), 'p_incluir_ia = false: lead da IA fora das contagens por lead');

-- Apagar a conversa apaga as ocorrências
delete from chat_conversas where id = '00000000-0000-0000-0006-0000000002a9';
select pg_temp.assert_true((select count(*) = 0 from chat_anuncio_ocorrencias where chat_conversa_id = '00000000-0000-0000-0006-0000000002a9'), 'apagar a conversa apaga as ocorrências');
