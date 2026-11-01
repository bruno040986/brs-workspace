-- Testes SQL do M06. Banco DESCARTAVEL. Falha = exception (ON_ERROR_STOP).
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHA: %', m; end if; raise notice 'OK %', m; end $$;

-- 1) deny-all e seed seguro
do $$ declare r text; t text; begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['seg_canais_config','seg_destinos_protegidos','seg_orcamento'] loop
      begin execute format('set local role %I', r); execute format('select count(*) from public.%I', t);
        execute 'reset role'; raise exception 'FALHA: % leu %', r, t;
      exception when insufficient_privilege then execute 'reset role'; end;
    end loop;
    begin execute format('set local role %I', r); perform public.seg_orcamento_consumir('telegram', null);
      execute 'reset role'; raise exception 'FALHA: % executou seg_orcamento_consumir', r;
    exception when insufficient_privilege then execute 'reset role'; end;
    begin execute format('set local role %I', r); perform public.seg_resumo_criar();
      execute 'reset role'; raise exception 'FALHA: % executou seg_resumo_criar', r;
    exception when insufficient_privilege then execute 'reset role'; end;
  end loop;
  raise notice 'OK anon/authenticated sem acesso as tabelas e funcoes M06';
end $$;
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where relname in ('seg_canais_config','seg_destinos_protegidos','seg_orcamento')), 'RLS ligada nas tabelas M06');
select pg_temp.ok((select count(*) from seg_canais_config where habilitado)=0 and (select count(*) from seg_canais_config)=3, 'todos os 3 canais nascem DESABILITADOS');
select pg_temp.ok((select count(*) from seg_destinos_protegidos)=0, 'nenhum segredo/chat_id em migration (tabela protegida vazia)');
select pg_temp.ok((select config->'instancias'->0->>'instancia_id' from seg_canais_config where canal='whatsapp')='5576d3fc-b482-4084-9de0-c7d37c68c7de'
  and (select config->'instancias'->1->>'instancia_id' from seg_canais_config where canal='whatsapp') is null, 'WhatsApp: ordem 1 mapeada, 2 e 3 sem id (pendente do Bruno)');
select pg_temp.ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('seg_orcamento_consumir','seg_resumo_pendente','seg_resumo_criar','seg_resumo_dados','seg_dispatcher_falha') and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))=0, 'funcoes M06 com search_path fixo');

-- 2) orcamento: limites, slot critico, por incidente, por instancia; negado nao consome
update seg_config set valor='4' where chave='orcamento.global_hora';
update seg_config set valor='1' where chave='orcamento.slot_critico_hora';
update seg_config set valor='3' where chave='orcamento.incidente_hora';
update seg_config set valor='2' where chave='orcamento.whatsapp_instancia_dia';
delete from seg_orcamento;
select gen_random_uuid() as inc1 \gset
select gen_random_uuid() as inc2 \gset
select pg_temp.ok((public.seg_orcamento_consumir('telegram', :'inc1', '', 'alta')->>'permitido')::boolean, 'consome 1 (alta, inc1)');
select pg_temp.ok((public.seg_orcamento_consumir('telegram', :'inc2', '', 'alta')->>'permitido')::boolean, 'consome 2 (alta, inc2)');
select pg_temp.ok((public.seg_orcamento_consumir('telegram', :'inc2', '', 'alta')->>'permitido')::boolean, 'consome 3 (alta, inc2)');
select public.seg_orcamento_consumir('telegram', :'inc1', '', 'alta') as neg \gset
select pg_temp.ok(not (:'neg'::jsonb->>'permitido')::boolean and :'neg'::jsonb->>'motivo'='global_hora', 'nao-critico para em (limite-slot)=3');
select pg_temp.ok((public.seg_orcamento_consumir('telegram', :'inc1', '', 'critica')->>'permitido')::boolean, 'critico usa o slot reservado (4o)');
select pg_temp.ok((select usado from seg_orcamento where escopo='global_hora')=4, 'contador global exato = 4');
select public.seg_orcamento_consumir('telegram', :'inc1', '', 'critica') as neg2 \gset
select pg_temp.ok(not (:'neg2'::jsonb->>'permitido')::boolean and (select usado from seg_orcamento where escopo='global_hora')=4, 'critico alem do teto: negado e NAO incrementa');
-- por incidente
update seg_config set valor='100' where chave='orcamento.global_hora'; delete from seg_orcamento;
select public.seg_orcamento_consumir('email', :'inc1') \gset
select public.seg_orcamento_consumir('email', :'inc1') \gset
select public.seg_orcamento_consumir('email', :'inc1') \gset
select public.seg_orcamento_consumir('email', :'inc1') as negi \gset
select pg_temp.ok(not (:'negi'::jsonb->>'permitido')::boolean and :'negi'::jsonb->>'motivo'='incidente_hora', 'teto por incidente (3/h) bloqueia o 4o');
select pg_temp.ok((public.seg_orcamento_consumir('email', :'inc2')->>'permitido')::boolean, 'outro incidente nao e afetado');
-- por instancia (diario) e canal whatsapp (dia)
delete from seg_orcamento;
select public.seg_orcamento_consumir('whatsapp', :'inc1', 'instA', 'alta') \gset
select public.seg_orcamento_consumir('whatsapp', :'inc2', 'instA', 'alta') \gset
select public.seg_orcamento_consumir('whatsapp', gen_random_uuid(), 'instA', 'critica') as negin \gset
select pg_temp.ok(:'negin'::jsonb->>'motivo'='instancia_dia', 'teto diario por instancia (2) bloqueia ate critico');
select pg_temp.ok((public.seg_orcamento_consumir('whatsapp', gen_random_uuid(), 'instB', 'alta')->>'permitido')::boolean, 'outra instancia segue');
update seg_config set valor='2' where chave='orcamento.whatsapp_dia'; delete from seg_orcamento;
select public.seg_orcamento_consumir('whatsapp', gen_random_uuid(), 'instA', 'alta') \gset
select public.seg_orcamento_consumir('whatsapp', gen_random_uuid(), 'instB', 'alta') \gset
select public.seg_orcamento_consumir('whatsapp', gen_random_uuid(), 'instC', 'critica') as negw \gset
select pg_temp.ok(:'negw'::jsonb->>'motivo'='canal_dia', 'teto diario do WhatsApp (todas as instancias) vale ate para critico');
select pg_temp.ok((public.seg_orcamento_consumir('telegram', gen_random_uuid(), '', 'alta')->>'permitido')::boolean, 'teto do WhatsApp nao afeta o Telegram');
-- restaura limites propostos
update seg_config set valor='20' where chave='orcamento.global_hora';
update seg_config set valor='8' where chave='orcamento.incidente_hora';
update seg_config set valor='10' where chave='orcamento.whatsapp_instancia_dia';
update seg_config set valor='20' where chave='orcamento.whatsapp_dia';
delete from seg_orcamento;

-- 3) tentativa com operation_id derivado, gravada antes do efeito
select public.seg_registrar_evento('{"fonte":"m06","id_origem":"e1","tipo":"login.bloqueio"}','[{"regra":"login_reincidencia","contexto":"a","gravidade":"critica","limiar":1}]') as r1 \gset
select i.id as intencao from seg_notificacao_intencoes i join seg_incidentes n on n.id=i.incidente_id where n.regra='login_reincidencia' \gset
select pg_temp.ok((select count(*) from public.seg_intencao_claim('w1', 5))=1, 'claim entrega a intencao');
select (public.seg_tentativa_preparar(:'intencao', 'w1', 'whatsapp', 'inst1', '11111111-1111-5111-8111-111111111111')).operation_id::text as op \gset
select pg_temp.ok(:'op'='11111111-1111-5111-8111-111111111111' and (select estado from seg_notificacao_tentativas where intencao_id=:'intencao')='enviando', 'operation_id derivado persistido e tentativa em "enviando"');
do $$ begin
  begin perform public.seg_tentativa_preparar((select id from seg_notificacao_intencoes limit 1), 'outro', 'telegram', '', gen_random_uuid());
    raise exception 'FALHA: preparou sem ser dono do lease';
  exception when others then if sqlerrm not like '%seg_lease_perdido%' then raise; end if; end;
  raise notice 'OK nao-dono do lease nao prepara tentativa';
end $$;

-- 4) falha do dispatcher: 1 por categoria por hora, sem intencao (sem recursao)
select public.seg_dispatcher_falha('persistencia_pos_envio', 'x') \gset
select public.seg_dispatcher_falha('persistencia_pos_envio', 'y') \gset
select public.seg_dispatcher_falha('persistencia_pos_envio', 'z') \gset
select pg_temp.ok((select count(*) from seg_eventos where fonte='dispatcher')=1, 'falha repetida na mesma hora = 1 evento (chave fixa)');
select public.seg_dispatcher_falha('claim') \gset
select pg_temp.ok((select count(*) from seg_eventos where fonte='dispatcher')=2, 'categoria diferente = evento proprio');
select pg_temp.ok((select count(*) from seg_notificacao_intencoes i join seg_incidentes n on n.id=i.incidente_id where n.regra='dispatcher_falha')=0, 'falha do dispatcher NAO gera intencao de notificacao');

-- 5) resumo unico apos recuperacao
update seg_config set valor=to_jsonb(now() - interval '2 hours') where chave='resumo.ultimo_em';
delete from seg_notificacao_tentativas; delete from seg_notificacao_intencoes; delete from seg_incidentes where regra='login_reincidencia';
do $$ declare k int; v_inc uuid; begin
  for k in 1..6 loop
    insert into seg_incidentes(regra,contexto,chave_correlacao,janela_inicio,janela_fim,gravidade) values ('rx','c'||k,'rx|c'||k,now(),now(),'alta') returning id into v_inc;
    insert into seg_notificacao_intencoes(incidente_id,versao_alerta,prioridade,dedupe_key,estado,finalizado_em)
    values (v_inc,1,'alta','rx'||k,(array['suprimida_orcamento','suprimida_orcamento','incerta','falhou','aceita','aceita'])[k], now() - interval '30 minutes');
  end loop;
  -- k=5 aceita pelo Telegram (nao conta); k=6 aceita por WhatsApp (conta como contingencia)
  insert into seg_notificacao_tentativas(intencao_id,n,canal,estado) select id,1,'telegram','aceita' from seg_notificacao_intencoes where dedupe_key='rx5';
  insert into seg_notificacao_tentativas(intencao_id,n,canal,estado,config_ref) select id,1,'whatsapp','aceita','i1' from seg_notificacao_intencoes where dedupe_key='rx6';
end $$;
select public.seg_resumo_pendente() as p \gset
select pg_temp.ok((:'p'::jsonb->>'pendente')::boolean and (:'p'::jsonb->>'suprimidas_orcamento')::int=2 and (:'p'::jsonb->>'incertas')::int=1 and (:'p'::jsonb->>'falhas')::int=1 and (:'p'::jsonb->>'por_contingencia')::int=1, 'resumo_pendente conta suprimidas/incertas/falhas/contingencia e ignora o que o Telegram aceitou');
select public.seg_resumo_criar() as c1 \gset
select pg_temp.ok((:'c1'::jsonb->>'criado')::boolean and (select count(*) from seg_notificacao_intencoes where tipo='resumo')=1, 'resumo_criar cria UMA intencao de resumo');
select public.seg_resumo_criar() as c2 \gset
select pg_temp.ok(not (:'c2'::jsonb->>'criado')::boolean and (select count(*) from seg_notificacao_intencoes where tipo='resumo')=1, 'segunda chamada nao cria outro resumo (sem avalanche)');
select pg_temp.ok(not (public.seg_resumo_pendente()->>'pendente')::boolean, 'marca avancou: nada pendente depois do resumo');
select pg_temp.ok((public.seg_resumo_dados((select incidente_id from seg_notificacao_intencoes where tipo='resumo'))->>'suprimidas_orcamento')::int=2, 'seg_resumo_dados devolve as contagens do periodo do resumo');
select pg_temp.ok((select prioridade from seg_notificacao_intencoes where tipo='resumo')='media', 'resumo tem prioridade media (nunca aciona contingencia WhatsApp)');
