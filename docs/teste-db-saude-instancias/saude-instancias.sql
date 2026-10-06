-- Testes de *_chat_instancias_saude.sql (Workspace). COPIAR para
-- brs-alvoconsig/tests/db/saude-instancias.sql. Roda DEPOIS da migration, com os
-- dados do saude-instancias-fixture.sql. Usa pg_temp.assert_true do bootstrap.

-- Backfill de pareada_em + quarentena_origem
select pg_temp.assert_true((select pareada_em = now() - interval '30 hours' and quarentena_origem = 'novo' from chat_instancias where id = '00000000-0000-0000-0005-0000000000a1'), 'a1: 1º conexao vira pareada_em, origem novo');
select pg_temp.assert_true((select pareada_em = now() - interval '19 hours' from chat_instancias where id = '00000000-0000-0000-0005-0000000000a2'), 'a2: conexao depois de 401 abre ciclo; depois de 403 não');
select pg_temp.assert_true((select pareada_em = created_at from chat_instancias where id = '00000000-0000-0000-0005-0000000000a3'), 'a3: sem evidência usa created_at');
select pg_temp.assert_true((select pareada_em = now() - interval '100 hours' from chat_instancias where id = '00000000-0000-0000-0005-0000000000a4'), 'a4: pareada antiga');
select pg_temp.assert_true((select pareada_em is null and quarentena_origem is null from chat_instancias where id = '00000000-0000-0000-0005-0000000000a5'), 'a5: sem sessão fica nula');
select pg_temp.assert_true((select pareada_em is null and quarentena_origem is null from chat_instancias where id = '00000000-0000-0000-0005-0000000000a6'), 'a6: excluída intocada');
select pg_temp.assert_true((select pareada_em = now() - interval '5 hours' and quarentena_origem is null from chat_instancias where id = '00000000-0000-0000-0005-0000000000a7'), 'a7: pareada_em existente não muda');
select pg_temp.assert_true((select pareada_em = now() - interval '6 hours' from chat_instancias where id = '00000000-0000-0000-0005-0000000000a8'), 'a8: conexao depois de reconexao (QR) abre ciclo');

-- Liberação de quem já disparava no pareamento atual (só a1, a3, a8)
select pg_temp.assert_true((select array_agg(right(id::text, 2) order by id) = array['a1','a3','a8'] from chat_instancias
  where agente_parceiro_id = '00000000-0000-0000-0005-000000000001' and disparo_liberado_em >= pareada_em), 'liberadas = a1, a3, a8');
select pg_temp.assert_true((select count(*) = 3 from chat_instancia_eventos where tipo = 'liberacao_antecipada' and motivo = 'outro' and origem = 'engine'
  and observacao like '[migração]%' and agente_parceiro_id = '00000000-0000-0000-0005-000000000001'), 'um evento liberacao_antecipada por liberada (idempotente)');

-- CHECKs de eventos: valores antigos e novos passam; desconhecido não
insert into chat_instancia_eventos (instancia_id, tipo, motivo, origem) values
  ('00000000-0000-0000-0005-0000000000a1', 'exclusao', 'analise_negada_banimento_definitivo', 'usuario'),
  ('00000000-0000-0000-0005-0000000000a1', 'exclusao', 'numero_perdido_operadora', 'usuario'),
  ('00000000-0000-0000-0005-0000000000a1', 'exclusao', 'mudanca_finalidade', 'usuario'),
  ('00000000-0000-0000-0005-0000000000a1', 'liberacao_antecipada', 'numero_pre_aquecido', 'usuario'),
  ('00000000-0000-0000-0005-0000000000a1', 'analise_pedida', null, 'usuario'),
  ('00000000-0000-0000-0005-0000000000a1', 'reconexao_falhou', null, 'engine'),
  ('00000000-0000-0000-0005-0000000000a1', 'proxy_testado', null, 'engine'),
  ('00000000-0000-0000-0005-0000000000a1', 'reconexao', 'mudanca_aplicativo', 'usuario');
do $$ begin
  insert into chat_instancia_eventos (instancia_id, tipo, origem) values ('00000000-0000-0000-0005-0000000000a1', 'inventado', 'engine');
  raise exception 'FAIL: tipo inválido passou';
exception when check_violation then null; end $$;
do $$ begin
  insert into chat_instancia_eventos (instancia_id, tipo, motivo, origem) values ('00000000-0000-0000-0005-0000000000a1', 'exclusao', 'inventado', 'usuario');
  raise exception 'FAIL: motivo inválido passou';
exception when check_violation then null; end $$;

-- quarentena_origem só aceita os 3 tipos
update chat_instancias set quarentena_origem = 'pos_banimento' where id = '00000000-0000-0000-0005-0000000000a5';
do $$ begin
  update chat_instancias set quarentena_origem = 'outra' where id = '00000000-0000-0000-0005-0000000000a5';
  raise exception 'FAIL: quarentena_origem inválida passou';
exception when check_violation then null; end $$;

-- proxy_configurado acompanha proxy_url_cifrada e não aceita escrita
update chat_instancias set proxy_url_cifrada = 'cifrado' where id = '00000000-0000-0000-0005-0000000000a1';
select pg_temp.assert_true((select proxy_configurado from chat_instancias where id = '00000000-0000-0000-0005-0000000000a1'), 'proxy_configurado = true com proxy');
select pg_temp.assert_true((select not proxy_configurado from chat_instancias where id = '00000000-0000-0000-0005-0000000000a2'), 'proxy_configurado = false sem proxy');
do $$ begin
  update chat_instancias set proxy_configurado = false where id = '00000000-0000-0000-0005-0000000000a1';
  raise exception 'FAIL: coluna gerada aceitou escrita';
exception when sqlstate '428C9' then null; end $$;

-- Permissão nova: só o master global
select pg_temp.assert_true((select count(*) >= 1 from crm_perfis_permissoes pp join crm_perfis p on p.id = pp.perfil_id
  where pp.permissao = 'config.liberar_disparo' and p.chave = 'master' and p.agente_parceiro_id is null), 'master recebe config.liberar_disparo');
select pg_temp.assert_true((select count(*) = 0 from crm_perfis_permissoes pp join crm_perfis p on p.id = pp.perfil_id
  where pp.permissao = 'config.liberar_disparo' and p.chave <> 'master'), 'só master recebe config.liberar_disparo');
