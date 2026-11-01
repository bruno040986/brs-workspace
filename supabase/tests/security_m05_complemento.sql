-- Testes SQL do complemento M05 (I-1..I-4, M-1). Roda DEPOIS de security_m05_incidentes.sql. Banco DESCARTAVEL.
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHA: %', m; end if; raise notice 'OK %', m; end $$;

-- I-1: funcao SECURITY DEFINER publica + tabela sem RLS lida por authenticated
select public.seg_monitor_baseline_definir(true) \gset
create function public.zz_leak() returns int language sql security definer as $$ select 1 $$;
create table public.zz_aberta(id int);
grant select on public.zz_aberta to authenticated;
select pg_temp.ok(exists(select 1 from seg_monitor_itens() where item_tipo='funcao' and item_chave like 'public.zz_leak%' and gravidade='alta'), 'I-1 monitor ve funcao definer executavel por PUBLIC');
select pg_temp.ok(exists(select 1 from seg_monitor_itens() where item_tipo='grant' and item_chave='public.zz_aberta|authenticated' and violacao like 'authenticated_%' and gravidade in ('alta','critica')), 'I-1 monitor ve tabela sem RLS lida por authenticated');
-- I-2: desvio novo vs baseline -> minimo alta, com incidente e intencao
create table public.zz_nova(id int);
alter table public.zz_nova enable row level security;
create policy zz_p on public.zz_nova for select to authenticated using (id > 0);
select public.seg_monitor_snapshot() \gset
select pg_temp.ok(exists(select 1 from seg_monitor_desvios where item_chave='public.zz_nova.zz_p' and tipo_desvio='novo' and gravidade='alta' and incidente_id is not null), 'I-2 policy nova (nao-true) vira alta com incidente');
select pg_temp.ok(exists(select 1 from seg_notificacao_intencoes n join seg_monitor_desvios d on d.incidente_id=n.incidente_id where d.item_chave='public.zz_nova.zz_p'), 'I-2 gera intencao');
select pg_temp.ok(exists(select 1 from seg_monitor_desvios where item_tipo='funcao' and item_chave like 'public.zz_leak%' and gravidade='alta' and incidente_id is not null), 'I-2 funcao nova vira incidente');

-- I-3: identidade informada
select public.seg_registrar_evento('{"fonte":"t","id_origem":"i3a","tipo":"login.falha","identidade_informada":"MinhaSenha@123!"}') \gset
select pg_temp.ok((select identidade_informada from seg_eventos where id_origem='i3a') like 'formato_invalido:%' and (select identidade_informada from seg_eventos where id_origem='i3a') not like '%Senha%', 'I-3 texto que nao parece e-mail/CPF vira hash');
select public.seg_registrar_evento('{"fonte":"t","id_origem":"i3b","tipo":"login.falha","identidade_informada":"fulano@brs.com.br"}') \gset
select pg_temp.ok((select identidade_informada from seg_eventos where id_origem='i3b')='fulano@brs.com.br', 'I-3 e-mail preservado');
select public.seg_registrar_evento('{"fonte":"t","id_origem":"i3c","tipo":"login.falha","identidade_informada":"12345678901"}') \gset
select pg_temp.ok((select identidade_informada from seg_eventos where id_origem='i3c')='12345678901', 'I-3 CPF preservado');

-- I-4: payload grande corta antes de sanitizar
do $$ declare big jsonb; t timestamptz := clock_timestamp(); r jsonb; begin
  select jsonb_object_agg('k'||a, (select jsonb_object_agg('j'||b, (select jsonb_object_agg('i'||c, 'valor'||c) from generate_series(1,40) c)) from generate_series(1,40) b)) into big from generate_series(1,40) a;
  r := public.seg_registrar_evento(jsonb_build_object('fonte','t','id_origem','i4','tipo','login.falha','payload',big));
  if clock_timestamp() - t > interval '3 seconds' then raise exception 'FALHA: payload grande demorou %', clock_timestamp()-t; end if;
  if (select payload->>'truncado' from seg_eventos where id_origem='i4') <> 'true' then raise exception 'FALHA: payload grande nao truncado'; end if;
  raise notice 'OK I-4 payload grande truncado em %', clock_timestamp()-t;
end $$;

-- M-1: contexto reservado nao colide com o agregado
select public.seg_registrar_evento('{"fonte":"t","id_origem":"m1","tipo":"login.falha"}','[{"regra":"m1_regra","contexto":"__agregado__","gravidade":"alta","janela_min":60}]') \gset
select pg_temp.ok(not exists(select 1 from seg_incidentes where regra='m1_regra' and chave_correlacao like '%|__agregado__|%'), 'M-1 contexto __agregado__ nao vira chave do agregado');
