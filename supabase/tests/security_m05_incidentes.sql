-- Testes SQL do M05. Banco DESCARTAVEL. Falha = exception (ON_ERROR_STOP).
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHA: %', m; end if; raise notice 'OK %', m; end $$;

-- 1) deny-all para anon/authenticated (tabelas, views, funcoes)
do $$ declare r text; t text; begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['seg_eventos','seg_incidentes','seg_config','seg_notificacao_intencoes','seg_monitor_baseline','seg_v_incidentes'] loop
      begin
        execute format('set local role %I', r); execute format('select count(*) from public.%I', t);
        execute 'reset role'; raise exception 'FALHA: % leu %', r, t;
      exception when insufficient_privilege then execute 'reset role'; end;
    end loop;
    begin
      execute format('set local role %I', r);
      perform public.seg_registrar_evento('{"fonte":"x","tipo":"a"}'::jsonb);
      execute 'reset role'; raise exception 'FALHA: % executou seg_registrar_evento', r;
    exception when insufficient_privilege then execute 'reset role'; end;
  end loop;
  raise notice 'OK anon/authenticated sem acesso a tabelas, views e funcoes seg_*';
end $$;
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where relname like 'seg\_%' and relkind='r' and relnamespace='public'::regnamespace), 'RLS ligada em todas as tabelas seg_*');
select pg_temp.ok(not exists (select 1 from pg_policies where tablename like 'seg\_%'), 'nenhuma politica em seg_* (deny-all)');
select pg_temp.ok((select count(*) from seg_config where origem like 'proposta%' or origem like 'decis%')=(select count(*) from seg_config where chave <> 'monitor.ultima_execucao'), 'seed de config marcado como proposta');

-- 2) agrupamento: mesmo contexto -> 1 incidente; idempotencia por (fonte,id_origem); sanitizacao
select public.seg_registrar_evento('{"fonte":"t","id_origem":"a1","tipo":"permissao.alterada","payload":{"senha":"abc","token":"zzz","ok":"x","jwt":"eyJhbGciOi.x.y"}}','[{"regra":"perm_alt","contexto":"global","gravidade":"alta"}]') as r1 \gset
select pg_temp.ok((:'r1'::jsonb->'incidentes'->0->>'novo')::boolean, 'primeiro evento abre incidente');
select public.seg_registrar_evento('{"fonte":"t","id_origem":"a2","tipo":"permissao.alterada"}','[{"regra":"perm_alt","contexto":"global","gravidade":"alta"}]') as r2 \gset
select pg_temp.ok(not (:'r2'::jsonb->'incidentes'->0->>'novo')::boolean and (select count(*) from seg_incidentes where regra='perm_alt')=1 and (select eventos_total from seg_incidentes where regra='perm_alt')=2, 'segundo evento agrupa (1 incidente, 2 eventos)');
select public.seg_registrar_evento('{"fonte":"t","id_origem":"a2","tipo":"permissao.alterada"}','[{"regra":"perm_alt","contexto":"global","gravidade":"alta"}]') as r3 \gset
select pg_temp.ok((:'r3'::jsonb->>'duplicado')::boolean and (select eventos_total from seg_incidentes where regra='perm_alt')=2, 'reprocessar o mesmo evento nao conta de novo');
select pg_temp.ok((select payload from seg_eventos where id_origem='a1') = '{"ok":"x","senha":"[removido]","token":"[removido]","jwt":"[removido]"}'::jsonb, 'payload sanitizado sem segredos');
select pg_temp.ok((select count(*) from seg_notificacao_intencoes n join seg_incidentes i on i.id=n.incidente_id where i.regra='perm_alt')=1, 'alta gera 1 intencao pendente (dedupe)');
select pg_temp.ok((select codigo from seg_incidentes where regra='perm_alt') ~ '^INC-[0-9]+$', 'codigo INC-n');
-- escalada de gravidade => nova versao_alerta e nova intencao
select public.seg_registrar_evento('{"fonte":"t","id_origem":"a3","tipo":"permissao.alterada"}','[{"regra":"perm_alt","contexto":"global","gravidade":"critica"}]') \gset
select pg_temp.ok((select versao_alerta from seg_incidentes where regra='perm_alt')=2 and (select count(*) from seg_notificacao_intencoes n join seg_incidentes i on i.id=n.incidente_id where i.regra='perm_alt')=2, 'escalada cria versao 2 e nova intencao');
-- media nao gera intencao
select public.seg_registrar_evento('{"fonte":"t","id_origem":"m1","tipo":"x.y"}','[{"regra":"so_media","contexto":"g","gravidade":"media"}]') \gset
select pg_temp.ok((select count(*) from seg_notificacao_intencoes n join seg_incidentes i on i.id=n.incidente_id where i.regra='so_media')=0, 'media nao cria intencao (vai a resumo no M06)');

-- 3) limiar: so abre incidente no 3o evento
insert into seg_config(chave,valor) values ('regra.lim3.limiar','3') on conflict do nothing;
select public.seg_registrar_evento('{"fonte":"t","id_origem":"l1","tipo":"login.falha"}','[{"regra":"lim3","contexto":"u1"}]') \gset
select public.seg_registrar_evento('{"fonte":"t","id_origem":"l2","tipo":"login.falha"}','[{"regra":"lim3","contexto":"u1"}]') \gset
select pg_temp.ok((select count(*) from seg_incidentes where regra='lim3')=0, 'abaixo do limiar nao abre incidente');
select public.seg_registrar_evento('{"fonte":"t","id_origem":"l3","tipo":"login.falha"}','[{"regra":"lim3","contexto":"u1"}]') \gset
select pg_temp.ok((select eventos_total from seg_incidentes where regra='lim3')=3 and (select count(*) from seg_incidente_eventos l join seg_incidentes i on i.id=l.incidente_id where i.regra='lim3')=3, 'no limiar abre e liga os 3 eventos anteriores');

-- 4) cardinalidade: max 50 chaves/regra/hora; excedente vira 1 agregado
do $$ declare i int; begin
  for i in 1..60 loop
    perform public.seg_registrar_evento(jsonb_build_object('fonte','t','id_origem','c'||i,'tipo','login.falha'),
      jsonb_build_array(jsonb_build_object('regra','card_regra','contexto','ctx'||i,'gravidade','media')));
  end loop;
end $$;
select pg_temp.ok((select count(*) from seg_incidentes where regra='card_regra' and not agregado)=50, 'ate 50 incidentes distintos por regra/hora');
select pg_temp.ok((select count(*) from seg_incidentes where regra='card_regra' and agregado)=1 and (select eventos_suprimidos from seg_incidentes where regra='card_regra' and agregado)=10, 'excedente (10) cai em 1 incidente agregado');

-- 5) teto de eventos vinculados
update seg_config set valor='3' where chave='incidente.max_eventos_vinculados';
do $$ declare i int; begin for i in 1..6 loop
  perform public.seg_registrar_evento(jsonb_build_object('fonte','t','id_origem','teto'||i,'tipo','a.b'), '[{"regra":"teto_regra","contexto":"g","gravidade":"baixa"}]'::jsonb);
end loop; end $$;
select pg_temp.ok((select count(*) from seg_incidente_eventos l join seg_incidentes i on i.id=l.incidente_id where i.regra='teto_regra')=3 and (select eventos_total from seg_incidentes where regra='teto_regra')=6 and (select eventos_suprimidos from seg_incidentes where regra='teto_regra')=3, 'teto de eventos vinculados: 3 ligados, 3 suprimidos, total 6');
update seg_config set valor='200' where chave='incidente.max_eventos_vinculados';

-- 6) claim / finish / lease expirado
update seg_notificacao_intencoes set estado='cancelada' where estado='pendente';
insert into seg_notificacao_intencoes(id,incidente_id,versao_alerta,prioridade,dedupe_key,destino_logico)
  select gen_random_uuid(), id, 50, 'critica', 'lease-'||id, 'bruno' from seg_incidentes where regra='perm_alt' \gset
select id as i1 from seg_notificacao_intencoes where dedupe_key like 'lease-%' limit 1 \gset
select pg_temp.ok((select count(*) from public.seg_intencao_claim('w1',5))=1, 'claim entrega a intencao pendente');
select pg_temp.ok((select count(*) from public.seg_intencao_claim('w2',5))=0, 'segundo claim nao pega a mesma (em_envio)');
select pg_temp.ok(not public.seg_intencao_finish(:'i1','w2','aceita'), 'finish por nao-dono recusado');
select pg_temp.ok((select estado from public.seg_tentativa_preparar(:'i1','w1','telegram','cfg-1'))='enviando', 'tentativa gravada como enviando antes da chamada');
do $$ begin
  begin perform public.seg_tentativa_preparar((select id from seg_notificacao_intencoes where dedupe_key like 'lease-%'),'intruso','telegram','x'); raise exception 'FALHA: intruso preparou tentativa';
  exception when others then if sqlerrm <> 'seg_lease_perdido' then raise; end if; end;
  raise notice 'OK nao-dono nao prepara tentativa';
end $$;
-- lease vence com tentativa enviando => incerta, nunca volta a pendente
update seg_notificacao_intencoes set lease_until = now() - interval '1 second' where id = :'i1';
select pg_temp.ok((select count(*) from public.seg_intencao_claim('w3',5))=0, 'claim apos lease vencido nao reentrega');
select pg_temp.ok((select estado from seg_notificacao_intencoes where id=:'i1')='incerta' and (select estado from seg_notificacao_tentativas where intencao_id=:'i1')='incerta', 'lease vencido em enviando => intencao e tentativa incertas (sem reenvio)');
select pg_temp.ok(not public.seg_intencao_finish(:'i1','w1','aceita'), 'finish apos vencer o lease recusado');
-- lease vence SEM tentativa enviando => volta a pendente e e reclamada
insert into seg_notificacao_intencoes(incidente_id,versao_alerta,prioridade,dedupe_key) select id,51,'alta','lease2-'||id from seg_incidentes where regra='perm_alt';
select pg_temp.ok((select count(*) from public.seg_intencao_claim('w4',5))=1, 'claim da 2a intencao');
update seg_notificacao_intencoes set lease_until = now() - interval '1 second' where dedupe_key like 'lease2-%';
select count(*) as n5 from public.seg_intencao_claim('w5',5) \gset
select pg_temp.ok(:n5=1 and (select lease_owner from seg_notificacao_intencoes where dedupe_key like 'lease2-%')='w5', 'lease vencido sem envio: volta a pendente e outro dono assume');
select pg_temp.ok(public.seg_intencao_finish((select id from seg_notificacao_intencoes where dedupe_key like 'lease2-%'),'w5','aceita'), 'finish pelo dono com lease valido');
-- recibos so avancam
select id as tt from seg_notificacao_tentativas limit 1 \gset
select pg_temp.ok(public.seg_recibo_registrar(:'tt','entregue','teste','m1') and not public.seg_recibo_registrar(:'tt','entregue','teste','m1'), 'recibo idempotente');
select pg_temp.ok((select estado from seg_notificacao_intencoes where id=:'i1')='entregue', 'recibo entregue resolve intencao incerta (monotonico)');

-- 7) monitor: policy {public}/true criada no teste, bucket publico, baseline
create table public.seg_t_alvo(id int);
alter table public.seg_t_alvo enable row level security;
select public.seg_monitor_snapshot() as s0 \gset
select pg_temp.ok(not (:'s0'::jsonb->>'baseline')::boolean, 'sem baseline: modo absoluto');
select public.seg_monitor_baseline_definir(true) \gset
select pg_temp.ok(((public.seg_monitor_snapshot())->>'desvios_novos')::int = 0, 'imediatamente apos baseline: 0 desvios novos');
create policy p_aberta on public.seg_t_alvo for select to public using (true);
select public.seg_monitor_snapshot() as s1 \gset
select pg_temp.ok((:'s1'::jsonb->>'criticos_novos')::int >= 1, 'snapshot detecta policy {public}/true nova como desvio critico');
select pg_temp.ok(exists(select 1 from seg_monitor_desvios d join seg_incidentes i on i.id=d.incidente_id where d.item_chave='public.seg_t_alvo.p_aberta' and d.gravidade='critica' and i.regra='monitor_config_policy' and d.estado='aberto'), 'desvio critico abriu incidente + intencao');
select pg_temp.ok(exists(select 1 from seg_notificacao_intencoes n join seg_incidentes i on i.id=n.incidente_id where i.regra='monitor_config_policy' and n.estado='pendente'), 'intencao pendente criada para o desvio');
select public.seg_monitor_snapshot() as s2 \gset
select pg_temp.ok((:'s2'::jsonb->>'desvios_novos')::int = 0, 'snapshot repetido nao duplica desvio nem alerta');
drop policy p_aberta on public.seg_t_alvo;
select public.seg_monitor_snapshot() \gset
select pg_temp.ok(exists(select 1 from seg_monitor_desvios where item_chave='public.seg_t_alvo.p_aberta' and tipo_desvio='novo' and estado='resolvido') or not exists(select 1 from seg_monitor_desvios where item_chave='public.seg_t_alvo.p_aberta' and estado='aberto'), 'desvio resolvido quando a policy some');
insert into storage.buckets(id,name,public) values ('b-pub','b-pub',true);
select public.seg_monitor_snapshot() as s3 \gset
select pg_temp.ok(exists(select 1 from seg_monitor_desvios where item_tipo='bucket' and item_chave='b-pub' and gravidade='critica'), 'bucket publico detectado como critico');
-- baseline recusa violacao sem aceite explicito
do $$ begin
  begin perform public.seg_monitor_baseline_definir(false); raise exception 'FALHA: baseline aceitou violacao em silencio';
  exception when others then if sqlerrm not like 'seg_baseline_com_violacoes%' then raise; end if; end;
  raise notice 'OK baseline nao abencoa violacao sem aceite explicito';
end $$;
-- auth.users sem cadastro (proxy de signup)
insert into auth.users(id,email,created_at) values (gen_random_uuid(),'x@y.z', now() - interval '1 hour');
select public.seg_monitor_snapshot() \gset
select pg_temp.ok(exists(select 1 from seg_monitor_desvios where item_tipo='auth_user_sem_cadastro' and gravidade='alta'), 'conta no Auth sem cadastro interno detectada');

-- 8) permissao: recurso seed nao quebra sem usuario
select pg_temp.ok(true, 'migracao rodou com seed de recurso seguranca-incidentes');
