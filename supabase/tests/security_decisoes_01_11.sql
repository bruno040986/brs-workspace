-- Testes SQL das decisoes de 01/11 (A: medidas disciplinares; C: seg_expurgar). Banco DESCARTAVEL, apos a migration 060000.
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHA: %', m; end if; raise notice 'OK %', m; end $$;

-- ===== A: medidas disciplinares =====
insert into public.employees (id, name, cpf, status) values
  ('00000009-0000-4000-8000-0000000000e1', 'D9 Colab 1', '00000000901', 'active'),
  ('00000009-0000-4000-8000-0000000000e2', 'D9 Colab 2', '00000000902', 'active');
insert into public.disciplinary_reasons (id, name, default_gravity, active) values ('00000009-0000-4000-8000-0000000000d1', 'D9 Motivo', 'leve', true);
insert into public.disciplinary_records (id, employee_id, type, reason_id, occurrence_date, application_date, status) values
  ('00000009-0000-4000-8000-0000000000c1', '00000009-0000-4000-8000-0000000000e1', 'verbal_warning', '00000009-0000-4000-8000-0000000000d1', current_date, current_date, 'active'),
  ('00000009-0000-4000-8000-0000000000c2', '00000009-0000-4000-8000-0000000000e2', 'verbal_warning', '00000009-0000-4000-8000-0000000000d1', current_date, current_date, 'active');
insert into public.access_profiles (id, name) values ('00000009-0000-4000-8000-0000000000a1', 'D9 RH colaboradores');
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate, created_at) values
  ('00000009-0000-4000-8000-0000000000a1', 'rh-colaboradores', true, false, false, false, false, now());
insert into auth.users (id, email, email_confirmed_at) values
  ('00000009-0000-4000-8000-000000000001','d9.colab1@brspromotora.com.br',now()),('00000009-0000-4000-8000-000000000002','d9.colab2@brspromotora.com.br',now()),
  ('00000009-0000-4000-8000-000000000003','d9.rh@brspromotora.com.br',now()),('00000009-0000-4000-8000-000000000004','d9.nada@brspromotora.com.br',now()),
  ('00000009-0000-4000-8000-000000000005','D9.Email@brspromotora.com.br',now()),('00000009-0000-4000-8000-000000000006','d9.email@brspromotora.com.br',null);
alter table public.employees add column if not exists email text;
insert into public.employees (id, name, cpf, status, email) values ('00000009-0000-4000-8000-0000000000e3','D9 Colab 3','00000000903','active','d9.email@brspromotora.com.br');
insert into public.disciplinary_records (id, employee_id, type, reason_id, occurrence_date, application_date, status) values
  ('00000009-0000-4000-8000-0000000000c3', '00000009-0000-4000-8000-0000000000e3', 'verbal_warning', '00000009-0000-4000-8000-0000000000d1', current_date, current_date, 'active');
insert into public.users (id, name, email, role, profile_id, active, employee_id) values
  ('00000009-0000-4000-8000-000000000006', 'D9 EmailNaoConf', 'd9.email@brspromotora.com.br', 'consulta', null, true, null),
  ('00000009-0000-4000-8000-000000000005', 'D9 Email', 'D9.Email@brspromotora.com.br', 'consulta', null, true, null),
  ('00000009-0000-4000-8000-000000000001', 'D9 Colab1', 'd9.colab1@brspromotora.com.br', 'consulta', null, true, '00000009-0000-4000-8000-0000000000e1'),
  ('00000009-0000-4000-8000-000000000002', 'D9 Colab2', 'd9.colab2@brspromotora.com.br', 'consulta', null, true, '00000009-0000-4000-8000-0000000000e2'),
  ('00000009-0000-4000-8000-000000000003', 'D9 RHcolab', 'd9.rh@brspromotora.com.br', 'consulta', '00000009-0000-4000-8000-0000000000a1', true, null),
  ('00000009-0000-4000-8000-000000000004', 'D9 Nada', 'd9.nada@brspromotora.com.br', 'consulta', null, true, null);

-- trigger_link_employee_by_cpf zera employee_id no INSERT (vincula por CPF); o vinculo explicito entra por UPDATE.
update public.users set employee_id = '00000009-0000-4000-8000-0000000000e1' where id = '00000009-0000-4000-8000-000000000001';
update public.users set employee_id = '00000009-0000-4000-8000-0000000000e2' where id = '00000009-0000-4000-8000-000000000002';

-- Sessao liberada (senha+TOTP aal2 + liberacao por e-mail) para cada usuario D9: o portao do M04 fica ligado de verdade.
do $$ declare u uuid; i int := 0; begin
  for u in select id from public.users where id::text like '00000009-%' order by id loop
    i := i + 1;
    insert into auth.mfa_factors (id, user_id, factor_type, status) values (('00000009-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, u, 'totp', 'verified');
    insert into auth.sessions (id, user_id, factor_id, aal) values (('00000009-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, u, ('00000009-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'aal2');
    insert into auth.mfa_amr_claims (session_id, authentication_method) values (('00000009-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, 'password'), (('00000009-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, 'totp');
    insert into public.auth_mfa_fatores (factor_id, user_id) values (('00000009-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, u);
    insert into public.auth_desafios_email (id, user_id, session_id, finalidade, destino_email, codigo_hash, expira_em, max_tentativas)
      values (('00000009-0000-4000-8000-0000000003' || lpad(i::text, 2, '0'))::uuid, u, ('00000009-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, 'acesso_workspace', 'x', 'h', now() + interval '5 min', 5);
    insert into public.auth_sessao_liberacoes (user_id, session_id, finalidade, desafio_id, expira_em)
      values (u, ('00000009-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, 'acesso_workspace', ('00000009-0000-4000-8000-0000000003' || lpad(i::text, 2, '0'))::uuid, now() + interval '1 hour');
  end loop;
end $$;

create temporary table d9_casos (sub uuid, esperado int, rotulo text);
insert into d9_casos values
  ('00000009-0000-4000-8000-000000000001', 1, 'colaborador ve so a propria'),
  ('00000009-0000-4000-8000-000000000002', 1, 'outro colaborador ve so a dele'),
  ('00000009-0000-4000-8000-000000000003', 3, 'rh-colaboradores ve o historico'),
  ('00000009-0000-4000-8000-000000000005', 1, 'vinculo por e-mail (sem users.employee_id)'),
  ('00000009-0000-4000-8000-000000000006', 0, 'e-mail nao confirmado no Auth nao vincula'),
  ('00000009-0000-4000-8000-000000000004', 0, 'sem vinculo nem permissao nao ve');
grant select on d9_casos to authenticated;

do $$
declare r record; n int;
begin
  for r in select * from d9_casos loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.sub, 'role', 'authenticated', 'aal', 'aal2',
      'session_id', (select session_id from public.auth_sessao_liberacoes where user_id = r.sub))::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.disciplinary_records where id::text like '00000009-%';
    if n <> r.esperado then execute 'reset role'; raise exception 'FALHA (%): viu %, esperado %', r.rotulo, n, r.esperado; end if;
    update public.disciplinary_records set witness_name = 'X' where id::text like '00000009-%';
    get diagnostics n = row_count;
    if n <> 0 then execute 'reset role'; raise exception 'FALHA (%): alterou %', r.rotulo, n; end if;
    delete from public.disciplinary_records where id::text like '00000009-%';
    get diagnostics n = row_count;
    if n <> 0 then execute 'reset role'; raise exception 'FALHA (%): excluiu %', r.rotulo, n; end if;
    execute 'reset role';
    raise notice 'OK A %', r.rotulo;
  end loop;
end $$;

-- ===== C: seg_expurgar =====
-- eventos: velho solto (apaga), velho preso a incidente aberto (fica), novo (fica)
insert into public.seg_eventos (id, criado_em, fonte, id_origem, tipo, payload_hash) values
  ('00000009-0000-4000-8000-0000000000f1', now() - interval '200 days', 'd9', 'velho', 'login.falha', 'h'),
  ('00000009-0000-4000-8000-0000000000f2', now() - interval '200 days', 'd9', 'velho-aberto', 'login.falha', 'h'),
  ('00000009-0000-4000-8000-0000000000f3', now() - interval '10 days',  'd9', 'novo', 'login.falha', 'h');
insert into public.seg_incidentes (id, regra, contexto, chave_correlacao, janela_inicio, janela_fim, gravidade, estado, atualizado_em) values
  ('00000009-0000-4000-8000-0000000000b1', 'd9', 'aberto',   'd9|aberto',   now() - interval '200 days', now() - interval '200 days', 'alta', 'aberto',    now() - interval '200 days'),
  ('00000009-0000-4000-8000-0000000000b2', 'd9', 'fechado',  'd9|fechado',  now() - interval '200 days', now() - interval '200 days', 'alta', 'encerrado', now() - interval '200 days'),
  ('00000009-0000-4000-8000-0000000000b3', 'd9', 'fechrec',  'd9|fechrec',  now() - interval '20 days',  now() - interval '20 days',  'alta', 'encerrado', now() - interval '20 days');
insert into public.seg_incidente_eventos (incidente_id, evento_id) values ('00000009-0000-4000-8000-0000000000b1', '00000009-0000-4000-8000-0000000000f2');
insert into public.seg_notificacao_intencoes (id, incidente_id, versao_alerta, prioridade, dedupe_key) values
  ('00000009-0000-4000-8000-0000000000a9', '00000009-0000-4000-8000-0000000000b2', 1, 'alta', 'd9-fechado'),
  ('00000009-0000-4000-8000-0000000000aa', '00000009-0000-4000-8000-0000000000b1', 1, 'alta', 'd9-aberto');
insert into public.seg_orcamento (escopo, chave, janela_inicio, usado) values ('global_hora', 'd9v', now() - interval '200 days', 1), ('global_hora', 'd9n', now(), 1);
insert into public.auth_tentativas (chave, etapa, falhas, pausas, pausa_ate, ultima_falha) values
  ('d9-velha', 'senha', 3, 1, now() - interval '199 days', now() - interval '200 days'),
  ('d9-vigente', 'senha', 3, 1, now() + interval '5 minutes', now() - interval '200 days'),
  ('d9-nova', 'senha', 1, 0, null, now());
insert into public.acessos_log (criado_em, etapa, resultado, motivo) values (now() - interval '200 days', 'senha', 'falha', 'd9_velho'), (now(), 'senha', 'falha', 'd9_novo');
insert into public.security_audit_demoted_admins_20261031 (user_id, email, role_anterior, rebaixado_em)
  values ('00000009-0000-4000-8000-0000000000aa', 'd9.auditoria@x.com', 'admin', now() - interval '400 days') on conflict do nothing;

select pg_temp.ok(not exists(select 1 from pg_proc where proname='seg_expurgar' and pronamespace='app_private'::regnamespace and (prosecdef is not true or proconfig is null)), 'C funcao SECURITY DEFINER com search_path fixo');
select pg_temp.ok(not has_function_privilege('authenticated','public.seg_expurgar(int)','EXECUTE') and not has_function_privilege('anon','public.seg_expurgar(int)','EXECUTE') and has_function_privilege('service_role','public.seg_expurgar(int)','EXECUTE'), 'C so service_role executa');
do $$ begin perform public.seg_expurgar(5); raise exception 'FALHA: aceitou dias=5'; exception when raise_exception then if sqlerrm like 'FALHA%' then raise; end if; end $$;
select public.seg_expurgar() \gset
select pg_temp.ok(not exists(select 1 from seg_eventos where id_origem='velho') and exists(select 1 from seg_eventos where id_origem='velho-aberto') and exists(select 1 from seg_eventos where id_origem='novo'), 'C eventos: velho solto sai; preso a incidente aberto e novo ficam');
select pg_temp.ok(exists(select 1 from seg_incidentes where id='00000009-0000-4000-8000-0000000000b1') and exists(select 1 from seg_incidentes where id='00000009-0000-4000-8000-0000000000b3') and not exists(select 1 from seg_incidentes where id='00000009-0000-4000-8000-0000000000b2'), 'C incidente aberto e encerrado recente ficam; encerrado velho sai');
select pg_temp.ok(not exists(select 1 from seg_notificacao_intencoes where id='00000009-0000-4000-8000-0000000000a9') and exists(select 1 from seg_notificacao_intencoes where id='00000009-0000-4000-8000-0000000000aa'), 'C intencoes seguem o incidente');
select pg_temp.ok(not exists(select 1 from seg_orcamento where chave='d9v') and exists(select 1 from seg_orcamento where chave='d9n'), 'C orcamento');
select pg_temp.ok(not exists(select 1 from auth_tentativas where chave='d9-velha') and exists(select 1 from auth_tentativas where chave='d9-vigente') and exists(select 1 from auth_tentativas where chave='d9-nova'), 'C pausas: vigente e nova ficam');
select pg_temp.ok(not exists(select 1 from acessos_log where motivo='d9_velho') and exists(select 1 from acessos_log where motivo='d9_novo'), 'C acessos_log');
select pg_temp.ok(exists(select 1 from public.security_audit_demoted_admins_20261031 where email='d9.auditoria@x.com'), 'C tabela de auditoria intocada');
