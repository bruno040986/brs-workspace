-- Testes SQL do M06 complemento 2 (regra_dia por incidente, critica isenta, adiamento com resumo). Banco DESCARTAVEL.
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHA: %', m; end if; raise notice 'OK %', m; end $$;
update seg_config set valor='1000' where chave in ('orcamento.global_hora','orcamento.global_dia');
delete from seg_orcamento; delete from seg_incidentes where regra='rg2';
do $$ declare k int; v uuid; r jsonb; n_ok int := 0; ult jsonb; crit uuid; ids uuid[] := '{}';
begin
  -- 11 incidentes alta da mesma regra: 10 notificam, o 11o e ADIADO
  for k in 1..11 loop
    insert into seg_incidentes(regra,contexto,chave_correlacao,janela_inicio,janela_fim,gravidade) values ('rg2','c'||k,'rg2|c'||k,now(),now(),'alta') returning id into v;
    ids := ids || v;
    r := public.seg_orcamento_consumir('telegram', v, '', 'alta');
    if (r->>'permitido')::boolean then n_ok := n_ok + 1; else ult := r; end if;
  end loop;
  if n_ok <> 10 then raise exception 'FALHA: % de 11 incidentes notificaram (esperado 10)', n_ok; end if;
  if ult->>'motivo' <> 'regra_dia' or (ult->>'adiado')::boolean is not true then raise exception 'FALHA: 11o deveria ser adiado por regra_dia: %', ult; end if;
  raise notice 'OK 11 incidentes alta da mesma regra: 10 notificam, 1 adiado (motivo regra_dia, adiado=true)';
  -- critico da mesma regra ainda passa e nao consome a cota
  insert into seg_incidentes(regra,contexto,chave_correlacao,janela_inicio,janela_fim,gravidade) values ('rg2','crit','rg2|crit',now(),now(),'critica') returning id into crit;
  if not (public.seg_orcamento_consumir('telegram', crit, '', 'critica')->>'permitido')::boolean then raise exception 'FALHA: critico da mesma regra foi barrado'; end if;
  if (select usado from seg_orcamento where escopo='regra_dia' and chave='rg2') <> 10 then raise exception 'FALHA: critico consumiu regra_dia'; end if;
  raise notice 'OK critico da mesma regra passa e nao consome regra_dia';
  -- incidente ja admitido continua passando em novas tentativas (fallback), sem consumir
  if not (public.seg_orcamento_consumir('whatsapp', ids[1], 'i1', 'alta')->>'permitido')::boolean then raise exception 'FALHA: fallback de incidente ja admitido barrado'; end if;
  if (select usado from seg_orcamento where escopo='regra_dia' and chave='rg2') <> 10 then raise exception 'FALHA: fallback consumiu regra_dia'; end if;
  -- o adiado continua negado ate o dia seguinte
  if (public.seg_orcamento_consumir('telegram', ids[11], '', 'alta')->>'permitido')::boolean then raise exception 'FALHA: adiado passou no mesmo dia'; end if;
  raise notice 'OK fallback de incidente admitido nao consome; adiado segue negado no dia';
end $$;
-- 3 tentativas (telegram -> whatsapp -> email) do mesmo incidente consomem 1 de regra_dia
delete from seg_orcamento; delete from seg_incidentes where regra='rg2';
insert into seg_incidentes(regra,contexto,chave_correlacao,janela_inicio,janela_fim,gravidade) values ('rg2','t3','rg2|t3',now(),now(),'alta');
select id as inc3 from seg_incidentes where chave_correlacao='rg2|t3' \gset
select public.seg_orcamento_consumir('telegram', :'inc3', '', 'alta') \gset
select public.seg_orcamento_consumir('whatsapp', :'inc3', 'inst1', 'alta') \gset
select public.seg_orcamento_consumir('email', :'inc3', '', 'alta') \gset
select pg_temp.ok((select usado from seg_orcamento where escopo='regra_dia' and chave='rg2')=1, '3 tentativas (telegram->whatsapp->email) do mesmo incidente consomem 1 de regra_dia');
-- resumo: intencao adiada entra no resumo unico
update seg_config set valor=to_jsonb(now() - interval '2 hours') where chave='resumo.ultimo_em';
delete from seg_notificacao_tentativas; delete from seg_notificacao_intencoes;
insert into seg_notificacao_intencoes(incidente_id,versao_alerta,prioridade,dedupe_key,estado) select id,1,'alta','rg2-adiada','pendente' from seg_incidentes where chave_correlacao='rg2|t3';
insert into seg_notificacao_tentativas(intencao_id,n,canal,estado,categoria_erro) select id,1,'telegram','rejeitada_comprovada','orcamento_regra_dia' from seg_notificacao_intencoes where dedupe_key='rg2-adiada';
select public.seg_resumo_pendente() as p \gset
select pg_temp.ok((:'p'::jsonb->>'pendente')::boolean and (:'p'::jsonb->>'adiadas_regra')::int=1, 'resumo unico conta a intencao adiada por regra_dia e fica pendente');
select public.seg_resumo_criar() as rc1 \gset
select public.seg_resumo_criar() as rc2 \gset
select pg_temp.ok((:'rc1'::jsonb->>'criado')::boolean and not (:'rc2'::jsonb->>'criado')::boolean and (select count(*) from seg_notificacao_intencoes where tipo='resumo')=1, 'resumo criado uma unica vez');
update seg_config set valor='20' where chave='orcamento.global_hora';
update seg_config set valor='60' where chave='orcamento.global_dia';
delete from seg_orcamento;
