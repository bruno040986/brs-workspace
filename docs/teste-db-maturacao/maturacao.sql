-- Testes de *_crm_maturacao.sql (Workspace). Roda DEPOIS da migration (aplicada
-- 2x), com os dados do maturacao-fixture.sql. Usa pg_temp.assert_true do
-- bootstrap.sql do CRM. Dados 100% sintéticos.

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
-- ids sintéticos do parceiro 7
create function pg_temp.i(s text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0007-0000000000' || s)::uuid $$;
create function pg_temp.s(s text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0007-00000000' || s)::uuid $$;
create function pg_temp.claim(inst text[]) returns setof public.crm_maturacao_passos language sql as $$
  select * from public.crm_maturacao_claim((select array_agg(pg_temp.i(x)) from unnest(inst) x), 10, 120) $$;
create function pg_temp.hoje(dias integer default 0) returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + dias $$;

-- ---------------------------------------------------------------------------
-- 1. Tráfego técnico antigo apagado
-- ---------------------------------------------------------------------------
select pg_temp.assert_true(to_regclass('public.crm_disparo_trafego_tecnico') is null, 'tabela crm_disparo_trafego_tecnico apagada');
select pg_temp.assert_true(not exists (select 1 from information_schema.columns where table_name = 'crm_parceiro_config' and column_name like 'trafego_tecnico%'), 'colunas trafego_tecnico_* apagadas');
select pg_temp.assert_true(not exists (select 1 from pg_indexes where indexname = 'chat_conversas_tecnico_idx'), 'índice tecnico apagado');
select pg_temp.assert_true((select convalidated from pg_constraint where conname = 'chat_conversas_origem_check'), 'CHECK de origem validado');
select pg_temp.assert_sqlstate($c$insert into chat_conversas (id, instancia_id, origem) values (gen_random_uuid(), pg_temp.i('b1'), 'tecnico')$c$, '23514', 'origem tecnico recusada');
select pg_temp.assert_sqlstate($c$insert into chat_conversas (id, instancia_id, origem) values (gen_random_uuid(), pg_temp.i('b1'), 'disparo')$c$, null, 'origem disparo aceita');

-- ---------------------------------------------------------------------------
-- 2. Flag, permissão, parâmetros
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select maturacao_status = 'desligado' and maturacao_ate is null from crm_parceiro_config where agente_parceiro_id = '00000000-0000-0000-0007-000000000001'), 'flag nasce desligada');
select pg_temp.assert_sqlstate($c$update crm_parceiro_config set maturacao_status = 'ligado' where agente_parceiro_id = '00000000-0000-0000-0007-000000000001'$c$, '23514', 'status de flag inválido recusado');
select pg_temp.assert_true((select count(*) = 1 from crm_perfis_permissoes pp join crm_perfis p on p.id = pp.perfil_id
  where pp.permissao = 'config.maturacao' and p.chave = 'master' and p.agente_parceiro_id is null), 'master global recebe config.maturacao (uma vez)');
select pg_temp.assert_true((select count(*) = 1 from crm_perfis_permissoes where permissao = 'config.maturacao'), 'só o master global recebe config.maturacao');
select pg_temp.assert_true((select count(*) = 1 from crm_maturacao_parametros where agente_parceiro_id is null), 'uma linha global de parâmetros (idempotente)');
select pg_temp.assert_true(exists (select 1 from information_schema.columns where table_name = 'chat_instancias' and column_name = 'wa_lid'), 'chat_instancias.wa_lid');

-- ---------------------------------------------------------------------------
-- 3. Acesso: RLS sem policy, só service_role
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select count(*) = 9 and bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'crm_maturacao_%'), 'RLS ligado nas 9 tabelas');
select pg_temp.assert_true(not exists (select 1 from pg_policies where tablename like 'crm_maturacao_%'), 'nenhuma policy');
select pg_temp.assert_true((select not bool_or(has_table_privilege(r, c.oid, 'select') or has_table_privilege(r, c.oid, 'insert') or has_table_privilege(r, c.oid, 'update') or has_table_privilege(r, c.oid, 'delete'))
  from pg_class c cross join unnest(array['anon', 'authenticated']) r where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'crm_maturacao_%'), 'anon/authenticated sem acesso às tabelas');
select pg_temp.assert_true((select bool_and(has_table_privilege('service_role', c.oid, 'select, insert, update, delete'))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'crm_maturacao_%'), 'service_role com acesso');
select pg_temp.assert_true((select count(*) = 6 and not bool_or(has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
  and bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'crm_maturacao_%'), 'RPCs só service_role');
select pg_temp.assert_true((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where proname like 'crm_maturacao_%'), 'funções security definer com search_path vazio');

-- ---------------------------------------------------------------------------
-- 4. Membros: só Baileys do mesmo parceiro, com proxy, não banido/restrito/excluído
-- ---------------------------------------------------------------------------
insert into crm_maturacao_planos (id, agente_parceiro_id, nome, teto_diario_por_numero)
values (pg_temp.i('f1'), '00000000-0000-0000-0007-000000000001', 'Plano teste', 5);
insert into crm_maturacao_planos (id, agente_parceiro_id, nome) values (pg_temp.i('f2'), '00000000-0000-0000-0007-000000000001', 'Outro plano');
insert into crm_maturacao_membros (plano_id, instancia_id, proximos) values
  (pg_temp.i('f1'), pg_temp.i('b1'), array[pg_temp.i('b2')]),
  (pg_temp.i('f1'), pg_temp.i('b2'), '{}'),
  (pg_temp.i('f1'), pg_temp.i('b3'), '{}'),
  (pg_temp.i('f1'), pg_temp.i('b4'), '{}');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_membros (plano_id, instancia_id) values (%L, %L)$c$, pg_temp.i('f2'), pg_temp.i(x)), '23514', 'inelegível recusado: ' || x)
from unnest(array['b5', 'b6', 'b7', 'b8', 'ba']) x;
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_membros (plano_id, instancia_id) values (%L, '00000000-0000-0000-0008-0000000000b9')$c$, pg_temp.i('f2')), '23514', 'número de outro parceiro recusado');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_membros (plano_id, instancia_id) values (%L, %L)$c$, pg_temp.i('f2'), pg_temp.i('b1')), '23505', 'número em dois planos recusado');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_membros (plano_id, instancia_id, status) values (%L, %L, 'removido')$c$, pg_temp.i('f2'), pg_temp.i('b5')), null, 'membro removido não passa pela elegibilidade');
select pg_temp.assert_sqlstate(format($c$update crm_maturacao_membros set status = 'ativo' where plano_id = %L and instancia_id = %L$c$, pg_temp.i('f2'), pg_temp.i('b5')), '23514', 'reativar sem proxy recusado');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_membros (plano_id, instancia_id, proximos, status) values (%L, %L, array[%L::uuid], 'removido')$c$, pg_temp.i('f2'), pg_temp.i('b6'), pg_temp.i('b6')), '23514', 'próximo de si mesmo recusado (CHECK, sem passar pelo gatilho)');
select pg_temp.assert_sqlstate($c$insert into crm_maturacao_planos (agente_parceiro_id, nome, preset) values ('00000000-0000-0000-0007-000000000001', 'x', 'alvo')$c$, '23514', 'preset alvo exige número central');

-- ---------------------------------------------------------------------------
-- 5. Criar execução (idempotente por plano+dia) e FKs dos passos
-- ---------------------------------------------------------------------------
-- S1 b1→b2→b1 · S2 b3→b1→b3 · S3 b4→b3 · S4 b1→b3→b1
create temp table t_passos as select jsonb_build_array(
  jsonb_build_object('sessao_id', pg_temp.s('c001'), 'ordem', 1, 'remetente_instancia_id', pg_temp.i('b1'), 'destinatario_instancia_id', pg_temp.i('b2'), 'papel', 'abertura', 'texto', 'bom dia', 'digitar_ms', 1200, 'agendado_para', now() - interval '1 minute'),
  jsonb_build_object('sessao_id', pg_temp.s('c001'), 'ordem', 2, 'remetente_instancia_id', pg_temp.i('b2'), 'destinatario_instancia_id', pg_temp.i('b1'), 'papel', 'resposta', 'texto', 'bom dia!', 'atraso_ms', 0),
  jsonb_build_object('sessao_id', pg_temp.s('c002'), 'ordem', 1, 'remetente_instancia_id', pg_temp.i('b3'), 'destinatario_instancia_id', pg_temp.i('b1'), 'papel', 'abertura', 'texto', 'oi', 'agendado_para', now() - interval '1 minute'),
  jsonb_build_object('sessao_id', pg_temp.s('c002'), 'ordem', 2, 'remetente_instancia_id', pg_temp.i('b1'), 'destinatario_instancia_id', pg_temp.i('b3'), 'papel', 'resposta', 'texto', 'oi, tudo bem?'),
  jsonb_build_object('sessao_id', pg_temp.s('c003'), 'ordem', 1, 'remetente_instancia_id', pg_temp.i('b4'), 'destinatario_instancia_id', pg_temp.i('b3'), 'papel', 'abertura', 'texto', 'e aí', 'agendado_para', now() - interval '1 minute'),
  jsonb_build_object('sessao_id', pg_temp.s('c004'), 'ordem', 1, 'remetente_instancia_id', pg_temp.i('b1'), 'destinatario_instancia_id', pg_temp.i('b3'), 'papel', 'abertura', 'texto', 'viu isso?', 'agendado_para', now() + interval '1 hour'),
  jsonb_build_object('sessao_id', pg_temp.s('c004'), 'ordem', 2, 'remetente_instancia_id', pg_temp.i('b3'), 'destinatario_instancia_id', pg_temp.i('b1'), 'papel', 'resposta', 'texto', 'vi sim')
) as j;
select pg_temp.assert_true(public.crm_maturacao_criar_execucao(pg_temp.i('f1'), pg_temp.hoje(), now() - interval '1 hour', now() + interval '6 hours', 42, '{}', (select j from t_passos)) is null, 'plano em rascunho não cria execução');
update crm_maturacao_planos set status = 'ativo' where id = pg_temp.i('f1');
select pg_temp.assert_true(public.crm_maturacao_criar_execucao(pg_temp.i('f1'), pg_temp.hoje(), now() - interval '1 hour', now() + interval '6 hours', 42, '{}', (select j from t_passos)) is null, 'flag desligada não cria execução');
update crm_parceiro_config set maturacao_status = 'teste', maturacao_ate = now() + interval '1 day' where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';
create temp table t_ex as select public.crm_maturacao_criar_execucao(pg_temp.i('f1'), pg_temp.hoje(), now() - interval '1 hour', now() + interval '6 hours', 42, '{"v":1}', (select j from t_passos)) as id;
select pg_temp.assert_true((select id is not null from t_ex), 'execução criada');
select pg_temp.assert_true(public.crm_maturacao_criar_execucao(pg_temp.i('f1'), pg_temp.hoje(), now(), now() + interval '1 hour', 1, '{}', (select j from t_passos)) is null, 'segunda execução do dia devolve null');
select pg_temp.assert_true((select count(*) filter (where status = 'pendente') = 4 and count(*) filter (where status = 'aguardando') = 3 and count(*) = 7 from crm_maturacao_passos), 'passos: 4 pendentes + 3 aguardando');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_execucoes (plano_id, dia, inicio_em, fim_em, seed) values (%L, %L, now(), now() + interval '13 hours', 1)$c$, pg_temp.i('f1'), pg_temp.hoje(9)), '23514', 'execução de mais de 12 h recusada');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto) values (%L, %L, gen_random_uuid(), 1, %L, %L, 'x')$c$, (select id from t_ex), pg_temp.i('f1'), pg_temp.i('b1'), pg_temp.i('b5')), '23503', 'destino fora do plano recusado (FK)');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto) values (%L, %L, gen_random_uuid(), 1, %L, '00000000-0000-0000-0008-0000000000b9', 'x')$c$, (select id from t_ex), pg_temp.i('f1'), pg_temp.i('b1')), '23503', 'destino de outro parceiro recusado (FK)');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto) values (%L, %L, gen_random_uuid(), 1, %L, %L, 'x')$c$, (select id from t_ex), pg_temp.i('f1'), pg_temp.i('b1'), pg_temp.i('b1')), '23514', 'remetente = destinatário recusado');

-- ---------------------------------------------------------------------------
-- 6. Claim: flag, sessão local, teto
-- ---------------------------------------------------------------------------
update crm_parceiro_config set habilitado = false where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b1', 'b2', 'b3', 'b4'])), 'parceiro desabilitado (habilitado=false): claim vazio');
update crm_parceiro_config set habilitado = true where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';
update crm_parceiro_config set maturacao_status = 'teste', maturacao_ate = now() - interval '1 minute' where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b1', 'b2', 'b3', 'b4'])), 'flag vencida: claim vazio');
update crm_parceiro_config set maturacao_ate = now() + interval '1 day' where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';
create temp table t_c1 as select * from pg_temp.claim(array['b1']);
select pg_temp.assert_true((select count(*) = 1 and bool_and(sessao_id = pg_temp.s('c001') and ordem = 1 and status = 'enviando' and tentativas = 1 and lease_token is not null) from t_c1), 'claim só do remetente local (S1 passo 1)');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b4'])), 'teto: b4 já tem 5 disparos hoje (teto 5)');
update crm_maturacao_planos set teto_diario_por_numero = 60 where id = pg_temp.i('f1');
update crm_maturacao_parametros set teto_diario_max = 5 where agente_parceiro_id is null;
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b4'])), 'teto global (parâmetros) também limita');
update crm_maturacao_parametros set teto_diario_max = 6 where agente_parceiro_id is null;
create temp table t_c3 as select * from pg_temp.claim(array['b4']);
select pg_temp.assert_true((select count(*) = 1 and bool_and(sessao_id = pg_temp.s('c003')) from t_c3), 'abaixo do teto: claim do b4 (disparos de ontem não contam)');

-- adiar devolve sem gastar tentativa
select pg_temp.assert_true(public.crm_maturacao_adiar((select id from t_c3), (select lease_token from t_c3), now() + interval '1 hour', 'cedeu_vez'), 'adiar com lease certo');
select pg_temp.assert_true((select status = 'pendente' and tentativas = 0 and adiamentos = 1 and motivo = 'cedeu_vez' and lease_token is null from crm_maturacao_passos where id = (select id from t_c3)), 'adiado: pendente, tentativa devolvida');
select pg_temp.assert_true(not public.crm_maturacao_adiar((select id from t_c3), (select lease_token from t_c3), now(), null), 'adiar com lease velho falha');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b4'])), 'adiado para o futuro não é reivindicado');

-- ---------------------------------------------------------------------------
-- 7. Concluir: próximo passo + leitura; falha cancela o resto da sessão
-- ---------------------------------------------------------------------------
select pg_temp.assert_true(not public.crm_maturacao_concluir((select id from t_c1), gen_random_uuid(), 'enviado', 'WA1', null, now(), now()), 'concluir com token errado falha');
select pg_temp.assert_sqlstate(format($c$select public.crm_maturacao_concluir(%L, %L, 'enviando')$c$, (select id from t_c1), (select lease_token from t_c1)), '23514', 'status de conclusão inválido');
select pg_temp.assert_true(public.crm_maturacao_concluir((select id from t_c1), (select lease_token from t_c1), 'enviado', 'WA1', null, now() - interval '1 second', now() - interval '1 second'), 'concluir enviado');
select pg_temp.assert_true((select status = 'enviado' and wa_id = 'WA1' and enviado_em is not null and lease_token is null from crm_maturacao_passos where id = (select id from t_c1)), 'passo 1 enviado');
select pg_temp.assert_true((select status = 'pendente' and agendado_para < now() from crm_maturacao_passos where sessao_id = pg_temp.s('c001') and ordem = 2 and acao = 'mensagem'), 'passo 2 liberado');
select pg_temp.assert_true((select count(*) = 1 from crm_maturacao_passos where acao = 'leitura' and ref_passo_id = (select id from t_c1)
  and remetente_instancia_id = pg_temp.i('b2') and destinatario_instancia_id = pg_temp.i('b1') and status = 'pendente'), 'leitura agendada para quem recebeu');
create temp table t_c2 as select * from pg_temp.claim(array['b2']);
select pg_temp.assert_true((select count(*) = 2 and count(*) filter (where acao = 'leitura') = 1 from t_c2), 'b2 reivindica resposta + leitura');
select pg_temp.assert_true(public.crm_maturacao_concluir(id, lease_token, 'enviado', case when acao = 'mensagem' then 'WA2' end), 'concluir passos do b2') from t_c2;

create temp table t_c4 as select * from pg_temp.claim(array['b3']);
select pg_temp.assert_true((select count(*) = 1 and bool_and(sessao_id = pg_temp.s('c002')) from t_c4), 'b3 reivindica S2');
select pg_temp.assert_true(public.crm_maturacao_concluir((select id from t_c4), (select lease_token from t_c4), 'falhou', null, 'erro_envio'), 'concluir falhou');
select pg_temp.assert_true((select status = 'cancelado' and motivo = 'sessao_interrompida' from crm_maturacao_passos where sessao_id = pg_temp.s('c002') and ordem = 2), 'falha cancela o resto da sessão');

-- lease vencido vira incerto (sem reenvio) e cancela o resto da sessão
update crm_maturacao_passos set agendado_para = now() - interval '1 second' where sessao_id = pg_temp.s('c004') and ordem = 1;
create temp table t_c5 as select * from pg_temp.claim(array['b1']);
select pg_temp.assert_true((select count(*) = 1 and bool_and(sessao_id = pg_temp.s('c004')) from t_c5), 'b1 reivindica S4');
update crm_maturacao_passos set lease_until = now() - interval '1 second' where id = (select id from t_c5);
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array[]::text[])), 'varredura sem instância local');
select pg_temp.assert_true((select status = 'incerto' and motivo = 'lease_vencido' from crm_maturacao_passos where id = (select id from t_c5)), 'lease vencido → incerto');
select pg_temp.assert_true((select status = 'cancelado' and motivo = 'sessao_incerta' from crm_maturacao_passos where sessao_id = pg_temp.s('c004') and ordem = 2), 'incerto cancela o resto da sessão');
select pg_temp.assert_true(not public.crm_maturacao_concluir((select id from t_c5), (select lease_token from t_c5), 'enviado', 'WA5'), 'concluir depois do lease vencido falha');

-- ---------------------------------------------------------------------------
-- 8. Gatilho: evento de saúde para o número e pausa o plano
-- ---------------------------------------------------------------------------
insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto, agendado_para, status) values
  ((select id from t_ex), pg_temp.i('f1'), pg_temp.s('c005'), 1, pg_temp.i('b3'), pg_temp.i('b2'), 'opa', now() - interval '1 second', 'pendente'),
  ((select id from t_ex), pg_temp.i('f1'), pg_temp.s('c006'), 1, pg_temp.i('b1'), pg_temp.i('b2'), 'olá', now() - interval '1 second', 'pendente');
insert into chat_instancia_eventos (instancia_id, tipo, observacao, origem) values
  (pg_temp.i('b3'), 'desconexao_externa', 'Sessão substituída — o mesmo número foi conectado em outro aparelho/instância. Leia o QR novamente. (código 440, sessao_substituida)', 'engine'),
  (pg_temp.i('b3'), 'conexao', null, 'engine');
select pg_temp.assert_true((select status = 'ativo' from crm_maturacao_membros where instancia_id = pg_temp.i('b3')), 'sessão substituída (440) e conexão não param o número');
insert into chat_instancia_eventos (instancia_id, tipo, observacao, origem) values (pg_temp.i('b3'), 'desconexao_externa', 'Sessão encerrada no aparelho (código 401).', 'engine');
select pg_temp.assert_true((select status = 'parado_auto' and parado_motivo = 'evento_desconexao_externa' and parado_em is not null from crm_maturacao_membros where instancia_id = pg_temp.i('b3')), '401 → membro parado_auto');
select pg_temp.assert_true((select status = 'ativo' and pausado_ate between now() + interval '59 minutes' and now() + interval '61 minutes' and pausa_motivo = 'evento_desconexao_externa' from crm_maturacao_planos where id = pg_temp.i('f1')), 'plano pausado 60 min (continua ativo)');
select pg_temp.assert_true((select status = 'cancelado' and motivo = 'instancia_parada' from crm_maturacao_passos where sessao_id = pg_temp.s('c005')), 'passo do número parado cancelado');
select pg_temp.assert_true((select status = 'pendente' from crm_maturacao_passos where sessao_id = pg_temp.s('c006')), 'passo de outros números segue pendente');
select pg_temp.assert_true((select count(*) = 1 from crm_maturacao_eventos where tipo = 'membro_parado' and instancia_id = pg_temp.i('b3') and origem = 'gatilho' and observacao = 'código 401'), 'evento membro_parado sem PII');
select pg_temp.assert_true((select count(*) = 1 from crm_maturacao_eventos where tipo = 'pausa_automatica' and plano_id = pg_temp.i('f1')), 'evento pausa_automatica');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b1'])), 'plano pausado: claim vazio');
insert into chat_instancia_eventos (instancia_id, tipo, motivo, origem) values (pg_temp.i('b3'), 'reconexao', 'restricao_meta', 'usuario');
select pg_temp.assert_true((select count(*) = 1 from crm_maturacao_eventos where tipo = 'membro_parado' and instancia_id = pg_temp.i('b3')), 'número já parado: segundo evento não duplica');

-- ---------------------------------------------------------------------------
-- 9. Gatilho: proxy removido no cadastro
-- ---------------------------------------------------------------------------
update chat_instancias set proxy_url_cifrada = null where id = pg_temp.i('b2');
select pg_temp.assert_true((select status = 'parado_auto' and parado_motivo = 'proxy_removido' from crm_maturacao_membros where instancia_id = pg_temp.i('b2')), 'proxy removido → parado_auto');
select pg_temp.assert_true((select status = 'cancelado' from crm_maturacao_passos where sessao_id = pg_temp.s('c006')), 'passos para o número sem proxy cancelados');
select pg_temp.assert_sqlstate(format($c$update crm_maturacao_membros set status = 'ativo' where instancia_id = %L$c$, pg_temp.i('b2')), '23514', 'reincluir sem proxy recusado');
update crm_maturacao_membros set status = 'ativo', parado_em = null, parado_motivo = null where instancia_id = pg_temp.i('b3');
select pg_temp.assert_true((select status = 'ativo' from crm_maturacao_membros where instancia_id = pg_temp.i('b3')), 'reincluir com proxy (aceite fica na aplicação)');
update chat_instancias set banida_em = now() where id = pg_temp.i('b4');
select pg_temp.assert_true((select status = 'parado_auto' and parado_motivo = 'banida' from crm_maturacao_membros where instancia_id = pg_temp.i('b4')), 'banida_em → parado_auto');
update chat_instancias set status = 'desconectada' where id = pg_temp.i('b1');
select pg_temp.assert_true((select status = 'ativo' from crm_maturacao_membros where instancia_id = pg_temp.i('b1')), 'mudança de status (queda/deploy) não para');

-- ---------------------------------------------------------------------------
-- 10. Kill switch global e por parceiro
-- ---------------------------------------------------------------------------
update crm_maturacao_planos set pausado_ate = null, pausa_motivo = null where id = pg_temp.i('f1');
insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto, agendado_para, status)
values ((select id from t_ex), pg_temp.i('f1'), pg_temp.s('c007'), 1, pg_temp.i('b1'), pg_temp.i('b3'), 'tudo certo?', now() - interval '1 second', 'pendente');
update crm_maturacao_parametros set desligado_em = now(), desligado_motivo = 'teste' where agente_parceiro_id is null;
select pg_temp.assert_true((select status = 'cancelada' and motivo_fim = 'kill_switch' from crm_maturacao_execucoes where id = (select id from t_ex)), 'kill switch cancela a execução ativa');
select pg_temp.assert_true((select status = 'cancelado' and motivo = 'kill_switch' from crm_maturacao_passos where sessao_id = pg_temp.s('c007')), 'kill switch cancela passos pendentes');
select pg_temp.assert_true((select count(*) = 1 from crm_maturacao_eventos where tipo = 'kill_switch_ligado' and agente_parceiro_id is null), 'evento kill_switch_ligado');
-- execução nova (outro dia) com passo vencido: bloqueada enquanto o switch estiver ligado
insert into crm_maturacao_execucoes (id, plano_id, dia, inicio_em, fim_em, seed) values (pg_temp.i('e1'), pg_temp.i('f1'), pg_temp.hoje(1), now() - interval '1 hour', now() + interval '1 hour', 1);
insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto, agendado_para, status)
values (pg_temp.i('e1'), pg_temp.i('f1'), pg_temp.s('c008'), 1, pg_temp.i('b1'), pg_temp.i('b3'), 'e aí', now() - interval '1 second', 'pendente');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b1'])), 'kill switch global: claim vazio');
select pg_temp.assert_true(public.crm_maturacao_criar_execucao(pg_temp.i('f1'), pg_temp.hoje(5), now(), now() + interval '1 hour', 1, '{}', '[]') is null, 'kill switch ligado não cria execução');
update crm_maturacao_parametros set desligado_em = null where agente_parceiro_id is null;
select pg_temp.assert_true((select count(*) = 1 from crm_maturacao_eventos where tipo = 'kill_switch_desligado'), 'evento kill_switch_desligado');
insert into crm_maturacao_parametros (agente_parceiro_id, desligado_em) values ('00000000-0000-0000-0007-000000000001', now());
select pg_temp.assert_true((select status = 'cancelada' and motivo_fim = 'kill_switch' from crm_maturacao_execucoes where id = pg_temp.i('e1')), 'kill switch do parceiro cancela a execução dele');
update crm_maturacao_passos set status = 'pendente', motivo = null where sessao_id = pg_temp.s('c008');
update crm_maturacao_execucoes set status = 'ativa', motivo_fim = null where id = pg_temp.i('e1');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b1'])), 'kill switch do parceiro: claim vazio');
update crm_maturacao_parametros set desligado_em = null where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';
select pg_temp.assert_true((select count(*) = 1 from pg_temp.claim(array['b1'])), 'switch desligado: claim volta');

-- ---------------------------------------------------------------------------
-- 11. Flag desligada, plano parado e execução vencida cancelam
-- ---------------------------------------------------------------------------
insert into crm_maturacao_execucoes (id, plano_id, dia, inicio_em, fim_em, seed) values (pg_temp.i('e2'), pg_temp.i('f1'), pg_temp.hoje(2), now() - interval '1 hour', now() + interval '1 hour', 1);
insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto, agendado_para, status)
values (pg_temp.i('e2'), pg_temp.i('f1'), pg_temp.s('c009'), 1, pg_temp.i('b1'), pg_temp.i('b3'), 'oi', now() + interval '1 minute', 'pendente');
update crm_parceiro_config set maturacao_status = 'desligado', maturacao_ate = null where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';
select pg_temp.assert_true((select status = 'cancelada' and motivo_fim = 'flag_desligada' from crm_maturacao_execucoes where id = pg_temp.i('e2')), 'flag desligada cancela execução');
select pg_temp.assert_true((select status = 'cancelado' from crm_maturacao_passos where sessao_id = pg_temp.s('c009')), 'flag desligada cancela passos');
update crm_parceiro_config set maturacao_status = 'pago' where agente_parceiro_id = '00000000-0000-0000-0007-000000000001';

insert into crm_maturacao_execucoes (id, plano_id, dia, inicio_em, fim_em, seed) values (pg_temp.i('e3'), pg_temp.i('f1'), pg_temp.hoje(3), now() - interval '1 hour', now() + interval '1 hour', 1);
update crm_maturacao_planos set status = 'parado' where id = pg_temp.i('f1');
select pg_temp.assert_true((select status = 'cancelada' and motivo_fim = 'plano_parado' from crm_maturacao_execucoes where id = pg_temp.i('e3')), 'plano parado cancela execução');
update crm_maturacao_planos set status = 'ativo' where id = pg_temp.i('f1');

insert into crm_maturacao_execucoes (id, plano_id, dia, inicio_em, fim_em, seed) values (pg_temp.i('e4'), pg_temp.i('f1'), pg_temp.hoje(4), now() - interval '11 hours', now() - interval '1 minute', 1);
insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto, agendado_para, status)
values (pg_temp.i('e4'), pg_temp.i('f1'), pg_temp.s('c00a'), 1, pg_temp.i('b1'), pg_temp.i('b3'), 'oi', now() - interval '2 minutes', 'pendente');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim(array['b1'])), 'execução vencida não entrega');
select pg_temp.assert_true((select status = 'encerrada' and motivo_fim = 'fim_da_janela' from crm_maturacao_execucoes where id = pg_temp.i('e4')), 'execução vencida encerrada');
select pg_temp.assert_true((select status = 'cancelado' and motivo = 'execucao_encerrada' from crm_maturacao_passos where sessao_id = pg_temp.s('c00a')), 'passos da execução vencida cancelados');

-- ---------------------------------------------------------------------------
-- 12. Conteúdo e log sem PII
-- ---------------------------------------------------------------------------
select pg_temp.assert_sqlstate($c$insert into crm_maturacao_fontes (slug, titulo, licenca, justificativa) values ('biblia-livre', 'Bíblia Livre', 'cc_by_4_0', 'atribuição obrigatória')$c$, '23514', 'licença CC BY recusada');
insert into crm_maturacao_fontes (id, slug, titulo, autor, licenca, justificativa) values (pg_temp.i('d5'), 'machado-dom-casmurro', 'Dom Casmurro', 'Machado de Assis', 'dominio_publico', 'autor falecido em 1908 (Lei 9.610, art. 41)');
insert into crm_maturacao_trechos (fonte_id, texto, tipo, hash) values (pg_temp.i('d5'), 'Uma noite destas, vindo da cidade...', 'trecho', 'h1');
select pg_temp.assert_true((select chars = 36 from crm_maturacao_trechos where hash = 'h1'), 'chars gerado');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_trechos (fonte_id, texto, hash) values (%L, 'outro texto', 'h1')$c$, pg_temp.i('d5')), '23505', 'hash duplicado recusado');
select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_trechos (fonte_id, texto, hash) values (%L, 'me liga 619999', 'h2')$c$, pg_temp.i('d5')), '23514', 'trecho com 6+ dígitos recusado');
select pg_temp.assert_sqlstate($c$insert into crm_maturacao_eventos (tipo, origem, observacao) values ('alerta', 'engine', 'número 5561999998888')$c$, '23514', 'observação com telefone recusada');
select pg_temp.assert_sqlstate($c$insert into crm_maturacao_eventos (tipo, origem, motivo) values ('alerta', 'engine', 'Texto Livre')$c$, '23514', 'motivo livre recusado');
select pg_temp.assert_sqlstate($c$insert into crm_maturacao_eventos (tipo, origem) values ('inventado', 'engine')$c$, '23514', 'tipo de evento inválido recusado');

select pg_temp.assert_sqlstate(format($c$insert into crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id, texto) values (%L, %L, gen_random_uuid(), 1, %L, %L, 'me liga 61999999')$c$, (select id from t_ex), pg_temp.i('f1'), pg_temp.i('b1'), pg_temp.i('b3')), '23514', 'passo com 6+ dígitos recusado');
select pg_temp.assert_sqlstate($c$update crm_maturacao_parametros set desligado_motivo = 'ligar 61999999' where agente_parceiro_id is null$c$, '23514', 'desligado_motivo com 6+ dígitos recusado');

-- ---------------------------------------------------------------------------
-- 13. Plano: número central membro do plano; parceiro fixo com membros; auditoria
-- ---------------------------------------------------------------------------
select pg_temp.assert_sqlstate($c$insert into crm_maturacao_planos (id, agente_parceiro_id, nome, preset, alvo_instancia_id) values ('00000000-0000-0000-0007-0000000000f4', '00000000-0000-0000-0007-000000000001', 'alvo', 'alvo', '00000000-0000-0000-0007-0000000000b1')$c$, null, 'rascunho com alvo fora do plano aceito (membros vêm depois)');
select pg_temp.assert_sqlstate($c$update crm_maturacao_planos set status = 'ativo' where id = '00000000-0000-0000-0007-0000000000f4'$c$, '23514', 'ativar com alvo que não é membro recusado');
select pg_temp.assert_sqlstate(format($c$update crm_maturacao_planos set preset = 'alvo', alvo_instancia_id = %L where id = %L$c$, pg_temp.i('b1'), pg_temp.i('f1')), null, 'alvo membro do plano aceito');
update crm_maturacao_planos set preset = 'circulos', alvo_instancia_id = null where id = pg_temp.i('f1');
select pg_temp.assert_sqlstate(format($c$update crm_maturacao_planos set agente_parceiro_id = '00000000-0000-0000-0008-000000000001' where id = %L$c$, pg_temp.i('f1')), '23514', 'trocar parceiro de plano com membros recusado');
select pg_temp.assert_sqlstate(format($c$update crm_maturacao_planos set agente_parceiro_id = '00000000-0000-0000-0008-000000000001' where id = %L$c$, pg_temp.i('f4')), null, 'trocar parceiro de plano sem membros aceito');
select pg_temp.assert_sqlstate(format($c$delete from crm_maturacao_membros where plano_id = %L and instancia_id = %L$c$, pg_temp.i('f1'), pg_temp.i('b1')), '23503', 'apagar membro com passos recusado (auditoria)');

-- ---------------------------------------------------------------------------
-- 14. Claim: proxy aplicado, destinatário conectado, teto com enviando/incerto
-- ---------------------------------------------------------------------------
update crm_maturacao_parametros set teto_diario_max = 500 where agente_parceiro_id is null;
create temp table t_ex6 as select public.crm_maturacao_criar_execucao(pg_temp.i('f1'), pg_temp.hoje(6), now() - interval '1 hour', now() + interval '6 hours', 6, '{}',
  (select jsonb_agg(jsonb_build_object('sessao_id', gen_random_uuid(), 'ordem', 1, 'remetente_instancia_id', pg_temp.i('b1'), 'destinatario_instancia_id', pg_temp.i('b3'),
     'texto', 'oi ' || g, 'agendado_para', now() - interval '1 minute')) from generate_series(1, 5) g)) as id;
select pg_temp.assert_true((select id is not null from t_ex6), 'execução do teto criada');
create function pg_temp.claim_b1() returns setof public.crm_maturacao_passos language sql as $$
  select * from public.crm_maturacao_claim(array[pg_temp.i('b1')], 5, 120) $$;

update chat_instancias set proxy_ip_em = null where id = pg_temp.i('b3');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim_b1()), 'destinatário com proxy cadastrado mas não aplicado (proxy_ip_em nulo): não entrega');
update chat_instancias set proxy_ip_em = now() where id = pg_temp.i('b3');
update chat_instancias set proxy_ip_em = null where id = pg_temp.i('b1');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim_b1()), 'remetente com proxy não aplicado: não entrega');
update chat_instancias set proxy_ip_em = now() where id = pg_temp.i('b1');
update chat_instancias set status = 'desconectada' where id = pg_temp.i('b3');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim_b1()), 'destinatário desconectado: não entrega');
update chat_instancias set status = 'conectada', reconexao_falhou_em = now() where id = pg_temp.i('b3');
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim_b1()), 'destinatário com reconexão falhou: não entrega');
update chat_instancias set reconexao_falhou_em = null where id = pg_temp.i('b3');
select pg_temp.assert_true((select count(*) = 5 and bool_and(status = 'pendente' and tentativas = 0) from crm_maturacao_passos where execucao_id = (select id from t_ex6)), 'barreiras não gastam tentativa (passos seguem pendentes)');

-- teto = o que b1 já tem hoje (enviado|enviando|incerto) + 2; p_limit 5
update crm_maturacao_planos set teto_diario_por_numero = 2 + (select count(*) from crm_maturacao_passos
  where remetente_instancia_id = pg_temp.i('b1') and acao = 'mensagem' and status in ('enviado', 'enviando', 'incerto')) where id = pg_temp.i('f1');
select pg_temp.assert_true((select count(*) >= 2 from crm_maturacao_passos where remetente_instancia_id = pg_temp.i('b1') and acao = 'mensagem' and status in ('enviando', 'incerto')), 'b1 já tem enviando/incerto contando no teto');
create temp table t_teto1 as select * from pg_temp.claim_b1();
select pg_temp.assert_true((select count(*) = 1 from t_teto1), 'teto: uma chamada com p_limit 5 entrega só 1 mensagem por remetente');
create temp table t_teto2 as select * from pg_temp.claim_b1();
create temp table t_teto3 as select * from pg_temp.claim_b1();
select pg_temp.assert_true((select count(*) from t_teto2) = 1 and (select count(*) from t_teto3) = 0, 'teto: chamadas seguidas param no teto (enviando conta)');
select pg_temp.assert_true(public.crm_maturacao_concluir(id, lease_token, 'incerto', null, 'sem_ack'), 'concluir incerto') from t_teto2;
select pg_temp.assert_true((select count(*) = 0 from pg_temp.claim_b1()), 'teto: incerto continua contando');
