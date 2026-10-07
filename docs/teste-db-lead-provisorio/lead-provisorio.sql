-- Testes de *_crm_contatos_lead_provisorio.sql (Workspace). COPIAR para
-- brs-alvoconsig/tests/db/lead-provisorio.sql. Roda DEPOIS da migration, com os
-- dados do lead-provisorio-fixture.sql. Usa pg_temp.assert_true do bootstrap.
-- Dados 100% sintéticos.

-- Executa um comando e confere o SQLSTATE do erro (null = tem de passar).
create function pg_temp.assert_sqlstate(cmd text, esperado text, label text) returns void language plpgsql as $$
declare obtido text;
begin
  begin
    execute cmd;
    obtido := null;
  exception when others then
    obtido := sqlstate;
  end;
  if obtido is distinct from esperado then
    raise exception 'FAIL: % (esperado %, obtido %)', label, coalesce(esperado, 'sucesso'), coalesce(obtido, 'sucesso');
  end if;
end; $$;

-- Estrutura
select pg_temp.assert_true((select convalidated from pg_constraint where conname = 'crm_contatos_wesales_contact_id_obrigatorio'), 'CHECK de id obrigatório VALIDADO');
select pg_temp.assert_true((select count(*) = 1 from pg_constraint where conname = 'crm_contatos_wesales_contact_id_obrigatorio'), 'um único CHECK de id obrigatório (idempotente)');
select pg_temp.assert_true((select count(*) = 1 from pg_constraint where conname = 'crm_contatos_wesales_sync_status_check'), 'CHECK de status existe uma vez');
select pg_temp.assert_true((select column_default = '''sincronizado''::text' and is_nullable = 'NO' from information_schema.columns where table_name = 'crm_contatos' and column_name = 'wesales_sync_status'), 'status not null default sincronizado');
select pg_temp.assert_true((select is_nullable = 'YES' from information_schema.columns where table_name = 'crm_contatos' and column_name = 'wesales_sync_erro'), 'wesales_sync_erro nulo');
select pg_temp.assert_true(exists (select 1 from pg_indexes where indexname = 'crm_wesales_queue_upsert_contato_ativo_uniq' and indexdef like 'CREATE UNIQUE INDEX%'), 'índice único parcial da fila');
select pg_temp.assert_true(exists (select 1 from pg_indexes where indexname = 'crm_wesales_queue_ativos_idx') and not exists (select 1 from pg_indexes where indexname = 'crm_wesales_queue_pendentes_idx'), 'índice de coleta substituído');
select pg_temp.assert_true(exists (select 1 from pg_indexes where indexname = 'crm_contatos_wesales_contact_id_key' and indexdef like 'CREATE UNIQUE INDEX%'), 'id WeSales continua único');
select pg_temp.assert_true(exists (select 1 from pg_indexes where indexname = 'crm_contatos_cpf_unique_idx' and indexdef like 'CREATE UNIQUE INDEX%'), 'CPF continua único');

-- Backfill: legado com id fica 'sincronizado'; legado sem id vira 'erro'
select pg_temp.assert_true((select wesales_sync_status = 'sincronizado' and wesales_sync_erro is null from crm_contatos where id = '00000000-0000-0000-0007-0000000000a1'), 'legado com id: sincronizado');
select pg_temp.assert_true((select wesales_sync_status = 'erro' and wesales_sync_erro = 'sem_wesales_contact_id' from crm_contatos where id = '00000000-0000-0000-0007-0000000000a2'), 'legado sem id: erro com código');

-- Provisório 'pendente' sem id: aceito
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, agente_parceiro_id, cpf, nome, telefone, origem, wesales_sync_status)
  values ('00000000-0000-0000-0007-0000000000b1', '00000000-0000-0000-0007-000000000001', '00000000011', 'Provisório 1', '5511000007011', 'manual', 'pendente')$c$, null, 'insert provisório pendente sem id aceito');
-- 'conflito' e 'erro' sem id: aceitos (com código)
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, agente_parceiro_id, cpf, nome, origem, wesales_sync_status, wesales_sync_erro)
  values ('00000000-0000-0000-0007-0000000000b2', '00000000-0000-0000-0007-000000000001', '00000000012', 'Provisório 2', 'ia', 'conflito', 'dono_outro_parceiro')$c$, null, 'insert conflito sem id aceito (2º NULL de id)');
-- Sem id e sem status (padrão 'sincronizado'): recusado 23514 (código antigo continua falhando)
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, agente_parceiro_id, cpf, nome, origem)
  values ('00000000-0000-0000-0007-0000000000b3', '00000000-0000-0000-0007-000000000001', '00000000013', 'Sem id', 'manual')$c$, '23514', 'insert sem id e sem status recusado');
-- Status fora da lista: recusado
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, cpf, wesales_contact_id, wesales_sync_status)
  values ('00000000-0000-0000-0007-0000000000b4', '00000000014', 'ws-x', 'outro')$c$, '23514', 'status inválido recusado');
-- UPDATE de linha antiga: tirar o id sem mudar o status → recusado
select pg_temp.assert_sqlstate($c$update crm_contatos set wesales_contact_id = null where id = '00000000-0000-0000-0007-0000000000a1'$c$, '23514', 'update de linha antiga sem id recusado');
-- UPDATE da antiga sem id para 'sincronizado' sem ganhar id → recusado
select pg_temp.assert_sqlstate($c$update crm_contatos set wesales_sync_status = 'sincronizado' where id = '00000000-0000-0000-0007-0000000000a2'$c$, '23514', 'sincronizado sem id recusado');
-- Provisório marcado 'sincronizado' sem id → recusado (o worker tem de gravar o id junto)
select pg_temp.assert_sqlstate($c$update crm_contatos set wesales_sync_status = 'sincronizado' where id = '00000000-0000-0000-0007-0000000000b1'$c$, '23514', 'provisório sincronizado sem id recusado');
-- Insert/update com id: aceitos
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, agente_parceiro_id, cpf, wesales_contact_id, nome)
  values ('00000000-0000-0000-0007-0000000000b5', '00000000-0000-0000-0007-000000000001', '00000000015', 'ws-novo-5', 'Com id')$c$, null, 'insert com id aceito');
select pg_temp.assert_sqlstate($c$update crm_contatos set wesales_contact_id = 'ws-prov-1', wesales_sync_status = 'sincronizado', wesales_sync_erro = null where id = '00000000-0000-0000-0007-0000000000b1'$c$, null, 'provisório ganha id e vira sincronizado');
select pg_temp.assert_sqlstate($c$update crm_contatos set nome = 'Pessoa sintética 1b' where id = '00000000-0000-0000-0007-0000000000a1'$c$, null, 'update de linha com id aceito');
-- Vários NULL de id permitidos (a2 erro, b2 conflito, mais um pendente)
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, cpf, wesales_sync_status) values ('00000000-0000-0000-0007-0000000000b6', '00000000016', 'pendente')$c$, null, 'mais um NULL de id aceito');
select pg_temp.assert_true((select count(*) >= 3 from crm_contatos where wesales_contact_id is null), 'três ou mais NULL de id convivem');
-- Unicidade preservada
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, cpf, wesales_contact_id) values ('00000000-0000-0000-0007-0000000000b7', '00000000017', 'ws-legado-1')$c$, '23505', 'id WeSales duplicado recusado');
select pg_temp.assert_sqlstate($c$insert into crm_contatos (id, agente_parceiro_id, cpf, wesales_sync_status) values ('00000000-0000-0000-0007-0000000000b8', '00000000-0000-0000-0007-000000000002', '00000000011', 'pendente')$c$, '23505', 'CPF duplicado (outro parceiro) recusado mesmo provisório');

-- Fila: no máximo uma upsert_contato ativa por contato
select pg_temp.assert_sqlstate($c$insert into crm_wesales_queue (operacao, contato_id) values ('upsert_contato', '00000000-0000-0000-0007-0000000000b6')$c$, null, '1ª upsert_contato pendente aceita');
select pg_temp.assert_sqlstate($c$insert into crm_wesales_queue (operacao, contato_id) values ('upsert_contato', '00000000-0000-0000-0007-0000000000b6')$c$, '23505', '2ª upsert_contato pendente recusada');
select pg_temp.assert_sqlstate($c$insert into crm_wesales_queue (operacao, contato_id, status) values ('upsert_contato', '00000000-0000-0000-0007-0000000000b6', 'erro')$c$, '23505', 'upsert_contato em erro conta como ativa');
select pg_temp.assert_sqlstate($c$insert into crm_wesales_queue (operacao, contato_id) values ('upsert_contato', '00000000-0000-0000-0007-0000000000b6')
  on conflict (contato_id) where operacao = 'upsert_contato' and status in ('pendente', 'erro', 'processando') do nothing$c$, null, 'ON CONFLICT DO NOTHING usa o índice parcial');
select pg_temp.assert_sqlstate($c$insert into crm_wesales_queue (operacao, contato_id) values ('mover_estagio', '00000000-0000-0000-0007-0000000000b6'), ('mover_estagio', '00000000-0000-0000-0007-0000000000b6')$c$, null, 'outras operações não são limitadas');
select pg_temp.assert_sqlstate($c$update crm_wesales_queue set status = 'processando', proximo_retry_em = now() + interval '10 minutes' where operacao = 'upsert_contato' and contato_id = '00000000-0000-0000-0007-0000000000b6'$c$, null, 'trava com prazo em proximo_retry_em');
select pg_temp.assert_sqlstate($c$insert into crm_wesales_queue (operacao, contato_id) values ('upsert_contato', '00000000-0000-0000-0007-0000000000b6')$c$, '23505', 'processando conta como ativa');
select pg_temp.assert_sqlstate($c$update crm_wesales_queue set status = 'concluido' where operacao = 'upsert_contato' and contato_id = '00000000-0000-0000-0007-0000000000b6'$c$, null, 'concluir libera');
select pg_temp.assert_sqlstate($c$insert into crm_wesales_queue (operacao, contato_id) values ('upsert_contato', '00000000-0000-0000-0007-0000000000b6')$c$, null, 'nova upsert_contato depois de concluída aceita');
select pg_temp.assert_true((select count(*) = 3 from crm_wesales_queue where operacao = 'upsert_contato' and contato_id = '00000000-0000-0000-0007-0000000000a1' and status in ('concluido', 'descartado')), 'histórico concluído duplicado intocado');
