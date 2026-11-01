-- Roda DEPOIS das migrations 20261101010000 e 20261101020000 num banco descartável (NUNCA em produção):
--   supabase/tests/run-m03a.sh   (cria o banco, aplica tudo e roda este arquivo)
-- ou, manualmente: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_initial_rls_hardening.sql
-- Roda em transação e dá ROLLBACK no fim. Falha = RAISE EXCEPTION.
--
-- Cobre: disciplinary_records, regras_portabilidade_ifs/globais, handle_new_user e o
-- rebaixamento de admins legados (fixtures/20_legacy_admin_accounts.sql, carregada ANTES
-- das migrations de segurança pelo runner).
-- As colunas das fixtures seguem fixtures/10_workspace_base_skeleton.sql (tabelas criadas
-- fora das migrations). Todas as contagens comparam com o que o superusuário vê, para não
-- passar só porque a tabela está vazia.
begin;

-- ---------------------------------------------------------------------------
-- Estado estrutural pós-migration
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_policies
  where schemaname = 'public'
    and tablename in ('disciplinary_records', 'regras_portabilidade_ifs', 'regras_portabilidade_globais')
    and (coalesce(qual, 'true') = 'true' and coalesce(with_check, 'true') = 'true');
  if n <> 0 then raise exception 'FALHA: % politica(s) sem restricao nas tabelas N01', n; end if;

  select count(*) into n from pg_policies
  where schemaname = 'public'
    and tablename in ('disciplinary_records', 'regras_portabilidade_ifs', 'regras_portabilidade_globais')
    and not ('authenticated' = any (roles));
  if n <> 0 then raise exception 'FALHA: % politica(s) para roles alem de authenticated', n; end if;

  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'disciplinary_records';
  if n <> 4 then raise exception 'FALHA: disciplinary_records deveria ter 4 politicas de RH, tem %', n; end if;

  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'regras_portabilidade_ifs';
  if n <> 4 then raise exception 'FALHA: regras_portabilidade_ifs deveria ter 4 politicas, tem %', n; end if;

  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'regras_portabilidade_globais';
  if n <> 2 then raise exception 'FALHA: regras_portabilidade_globais deveria ter 2 politicas, tem %', n; end if;

  if not (select relrowsecurity from pg_class where oid = 'public.disciplinary_records'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.regras_portabilidade_ifs'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.regras_portabilidade_globais'::regclass) then
    raise exception 'FALHA: RLS desligado em tabela N01';
  end if;

  if has_table_privilege('anon', 'public.disciplinary_records', 'SELECT')
     or has_table_privilege('anon', 'public.regras_portabilidade_ifs', 'SELECT')
     or has_table_privilege('anon', 'public.regras_portabilidade_globais', 'SELECT')
     or has_table_privilege('anon', 'public.regras_portabilidade_ifs', 'INSERT') then
    raise exception 'FALHA: anon ainda tem privilegio de tabela';
  end if;

  if has_table_privilege('authenticated', 'public.disciplinary_records', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.regras_portabilidade_ifs', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.regras_portabilidade_globais', 'TRUNCATE') then
    raise exception 'FALHA: authenticated pode TRUNCATE (ignora RLS)';
  end if;

  if has_table_privilege('authenticated', 'public.regras_portabilidade_globais', 'UPDATE')
     or has_table_privilege('authenticated', 'public.regras_portabilidade_globais', 'DELETE') then
    raise exception 'FALHA: authenticated nao devia ter UPDATE/DELETE em regras_portabilidade_globais';
  end if;

  if pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%insert%' then
    raise exception 'FALHA: handle_new_user ainda insere em public.users';
  end if;

  raise notice 'OK estrutura: politicas, RLS, grants e handle_new_user';
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (como superusuário)
-- ---------------------------------------------------------------------------
-- auth.users: o INSERT dispara handle_new_user; nenhuma linha em public.users
-- deve aparecer sozinha (verificado logo abaixo).
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000001-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'n01.rh@brspromotora.com.br',          '{}', '{"name":"N01 RH"}',          now(), now()),
  ('00000001-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'n01.port@brspromotora.com.br',        '{}', '{"name":"N01 Port"}',        now(), now()),
  ('00000001-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'n01.portleitura@brspromotora.com.br', '{}', '{"name":"N01 PortLeitura"}', now(), now()),
  ('00000001-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'n01.semperfil@brspromotora.com.br',   '{}', '{"name":"N01 SemPerfil"}',   now(), now()),
  ('00000001-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'n01.desativado@brspromotora.com.br',  '{}', '{"name":"N01 Desativado"}',  now(), now()),
  ('00000001-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'n01-parceiro@parceiro.brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000001-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'n01.signup@brspromotora.com.br',      '{}', '{"name":"N01 Signup"}',      now(), now()),
  ('00000001-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'n01.provisionado@brspromotora.com.br','{}', '{"name":"N01 Prov"}',        now(), now());

-- Signup corporativo nunca cria admin (nem qualquer espelho automático).
do $$
declare n int;
begin
  select count(*) into n from public.users
  where id::text like '00000001-0000-4000-8000-%';
  if n <> 0 then raise exception 'FALHA: handle_new_user criou % linha(s) em public.users', n; end if;

  select count(*) into n from public.users
  where id = '00000001-0000-4000-8000-000000000007' and role = 'admin';
  if n <> 0 then raise exception 'FALHA: signup corporativo virou admin'; end if;

  raise notice 'OK signup corporativo nao cria espelho nem admin';
end $$;

-- Rebaixamento de admins legados (fixtures carregadas antes da migration).
do $$
declare r record; n int;
begin
  select role, active into r from public.users where id = '00000003-0000-4000-8000-00000000000a';
  if r.role <> 'consulta' or r.active is not false then
    raise exception 'FALHA: admin legado nao foi rebaixado/desativado (role=%, active=%)', r.role, r.active;
  end if;
  select count(*) into n from public.security_audit_demoted_admins_20261031
  where user_id = '00000003-0000-4000-8000-00000000000a' and role_anterior = 'admin' and email = 'm03a.legado@brspromotora.com.br';
  if n <> 1 then raise exception 'FALHA: admin legado nao foi listado na tabela de auditoria'; end if;
  select count(*) into n from auth.users
  where id = '00000003-0000-4000-8000-00000000000a' and banned_until > now() + interval '1 year';
  if n <> 1 then raise exception 'FALHA: admin legado nao foi banido no Auth'; end if;
  -- Os demais nao podem ser tocados.
  select count(*) into n from public.users
  where id in ('00000003-0000-4000-8000-00000000000b', '00000003-0000-4000-8000-00000000000c', '00000003-0000-4000-8000-00000000000d')
    and role = 'admin' and active is true;
  if n <> 3 then raise exception 'FALHA: admin com cadastro interno foi rebaixado indevidamente (% de 3 intactos)', n; end if;
  select count(*) into n from public.users where id = '00000003-0000-4000-8000-00000000000e' and role = 'consulta' and active is true;
  if n <> 1 then raise exception 'FALHA: usuario consulta foi alterado'; end if;
  select count(*) into n from public.security_audit_demoted_admins_20261031 where user_id::text like '00000003-%';
  if n <> 1 then raise exception 'FALHA: auditoria deveria ter exatamente 1 conta das fixtures, tem %', n; end if;
  -- A tabela de auditoria nao e legivel por anon/authenticated.
  if has_table_privilege('authenticated', 'public.security_audit_demoted_admins_20261031', 'SELECT')
     or has_table_privilege('anon', 'public.security_audit_demoted_admins_20261031', 'SELECT') then
    raise exception 'FALHA: tabela de auditoria legivel por anon/authenticated';
  end if;
  raise notice 'OK rebaixamento: 1 admin legado rebaixado/desativado/banido/listado; 3 cadastrados e 1 consulta intactos';
end $$;

insert into public.access_profiles (id, name) values
  ('00000001-0000-4000-8000-0000000000a1', 'N01 TESTE RH'),
  ('00000001-0000-4000-8000-0000000000a2', 'N01 TESTE PORTABILIDADE'),
  ('00000001-0000-4000-8000-0000000000a3', 'N01 TESTE PORTABILIDADE LEITURA');

insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate, created_at) values
  ('00000001-0000-4000-8000-0000000000a1', 'rh-medidas-disciplinares',           true, true,  true,  true,  false, now()),
  ('00000001-0000-4000-8000-0000000000a2', 'operacional-simulador-portabilidade', true, true,  true,  true,  false, now()),
  ('00000001-0000-4000-8000-0000000000a3', 'operacional-simulador-portabilidade', true, false, false, false, false, now());

-- Provisionamento administrativo simulado como saveUserDirectly (service role):
-- upsert completo com role/perfil/active escolhidos pelo servidor.
insert into public.users (id, name, email, role, profile_id, active) values
  ('00000001-0000-4000-8000-000000000001', 'N01 RH',          'n01.rh@brspromotora.com.br',          'consulta', '00000001-0000-4000-8000-0000000000a1', true),
  ('00000001-0000-4000-8000-000000000002', 'N01 Port',        'n01.port@brspromotora.com.br',        'consulta', '00000001-0000-4000-8000-0000000000a2', true),
  ('00000001-0000-4000-8000-000000000003', 'N01 PortLeitura', 'n01.portleitura@brspromotora.com.br', 'consulta', '00000001-0000-4000-8000-0000000000a3', true),
  ('00000001-0000-4000-8000-000000000004', 'N01 SemPerfil',   'n01.semperfil@brspromotora.com.br',   'consulta', null,                                   true),
  ('00000001-0000-4000-8000-000000000005', 'N01 Desativado',  'n01.desativado@brspromotora.com.br',  'consulta', '00000001-0000-4000-8000-0000000000a1', false);

insert into public.users (id, name, email, role, profile_id, active)
values ('00000001-0000-4000-8000-000000000008', 'N01 Prov', 'n01.provisionado@brspromotora.com.br', 'consulta', null, true)
on conflict (id) do update set name = excluded.name, email = excluded.email, role = excluded.role,
  profile_id = excluded.profile_id, active = excluded.active;

do $$
declare r record;
begin
  select role, active into r from public.users where id = '00000001-0000-4000-8000-000000000008';
  if r is null then raise exception 'FALHA: provisionamento administrativo nao criou public.users'; end if;
  if r.role <> 'consulta' or r.active is not true then
    raise exception 'FALHA: provisionamento gravou role=% active=%', r.role, r.active;
  end if;
  raise notice 'OK provisionamento administrativo cria o espelho com o role do servidor';
end $$;

insert into public.employees (id, name, cpf, status, vt_status) values
  ('00000001-0000-4000-8000-0000000000e1', 'N01 Colaborador', '00000000191', 'active', 'sem_informacao');

insert into public.disciplinary_reasons (id, name, default_gravity, active) values
  ('00000001-0000-4000-8000-0000000000d1', 'N01 Motivo', 'leve', true);

insert into public.disciplinary_records (id, employee_id, type, reason_id, occurrence_date, application_date,
  recurrence_number_by_reason, total_warnings_at_date, total_suspensions_at_date, status) values
  ('00000001-0000-4000-8000-0000000000c1', '00000001-0000-4000-8000-0000000000e1', 'verbal_warning',  '00000001-0000-4000-8000-0000000000d1', current_date, current_date, 1, 0, 0, 'active'),
  ('00000001-0000-4000-8000-0000000000c2', '00000001-0000-4000-8000-0000000000e1', 'written_warning', '00000001-0000-4000-8000-0000000000d1', current_date, current_date, 2, 1, 0, 'active');

insert into public.financial_institutions (id, name) values
  ('00000001-0000-4000-8000-0000000000f1', 'N01 IF TESTE');

insert into public.regras_portabilidade_ifs (id, institution_id, convenio_codigo, notes) values
  ('00000001-0000-4000-8000-0000000000b1', '00000001-0000-4000-8000-0000000000f1', 'N01A', 'original'),
  ('00000001-0000-4000-8000-0000000000b2', '00000001-0000-4000-8000-0000000000f1', 'N01B', 'original');

insert into public.regras_portabilidade_globais (id, default_port_coeff) values
  ('00000001-0000-4000-8000-0000000000b9', 0.011111);

-- Linha de base: o superusuário enxerga as fixtures.
do $$
declare n int;
begin
  select count(*) into n from public.disciplinary_records where id::text like '00000001-0000-4000-8000-0000000000c%';
  if n <> 2 then raise exception 'fixture disciplinary_records: esperado 2, veio %', n; end if;
  select count(*) into n from public.regras_portabilidade_ifs where id::text like '00000001-0000-4000-8000-0000000000b%';
  if n <> 2 then raise exception 'fixture regras_portabilidade_ifs: esperado 2, veio %', n; end if;
  select count(*) into n from public.regras_portabilidade_globais where id = '00000001-0000-4000-8000-0000000000b9';
  if n <> 1 then raise exception 'fixture regras_portabilidade_globais: esperado 1, veio %', n; end if;
  raise notice 'OK fixtures visiveis ao superusuario (2/2/1)';
end $$;

-- ---------------------------------------------------------------------------
-- anon: sem privilégio de tabela
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare n int; begin
  select count(*) into n from public.disciplinary_records;
  raise exception 'FALHA: anon leu disciplinary_records (%)', n;
exception when insufficient_privilege then raise notice 'OK anon nao le disciplinary_records'; end $$;
do $$ declare n int; begin
  select count(*) into n from public.regras_portabilidade_ifs;
  raise exception 'FALHA: anon leu regras_portabilidade_ifs (%)', n;
exception when insufficient_privilege then raise notice 'OK anon nao le regras_portabilidade_ifs'; end $$;
do $$ declare n int; begin
  select count(*) into n from public.regras_portabilidade_globais;
  raise exception 'FALHA: anon leu regras_portabilidade_globais (%)', n;
exception when insufficient_privilege then raise notice 'OK anon nao le regras_portabilidade_globais'; end $$;
do $$ begin
  insert into public.regras_portabilidade_ifs (institution_id, convenio_codigo) values ('00000001-0000-4000-8000-0000000000f1', 'N01ANON');
  raise exception 'FALHA: anon inseriu regra';
exception when insufficient_privilege then raise notice 'OK anon nao insere regra'; end $$;
do $$ begin
  update public.regras_portabilidade_globais set default_port_coeff = 9;
  raise exception 'FALHA: anon alterou coeficiente global';
exception when insufficient_privilege then raise notice 'OK anon nao altera coeficiente global'; end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Negados: sem perfil, sem linha em public.users (parceiro/CRM e signup) e
-- desativado com perfil RH. Mesmo bloco para os quatro.
-- ---------------------------------------------------------------------------
create temporary table n01_negados (sub uuid, rotulo text) on commit drop;
insert into n01_negados values
  ('00000001-0000-4000-8000-000000000004', 'sem perfil'),
  ('00000001-0000-4000-8000-000000000006', 'parceiro sem espelho'),
  ('00000001-0000-4000-8000-000000000007', 'signup corporativo'),
  ('00000001-0000-4000-8000-000000000005', 'desativado com perfil RH'),
  ('00000001-0000-4000-8000-000000000008', 'provisionado sem permissao');
grant select on n01_negados to authenticated;

do $$
declare
  r record;
  n int;
begin
  for r in select * from n01_negados loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.sub, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    select count(*) into n from public.disciplinary_records where id::text like '00000001-0000-4000-8000-0000000000c%';
    if n <> 0 then raise exception 'FALHA (%): viu % medida(s) disciplinar(es)', r.rotulo, n; end if;
    select count(*) into n from public.regras_portabilidade_ifs where id::text like '00000001-0000-4000-8000-0000000000b%';
    if n <> 0 then raise exception 'FALHA (%): viu % regra(s) por IF', r.rotulo, n; end if;
    select count(*) into n from public.regras_portabilidade_globais where id = '00000001-0000-4000-8000-0000000000b9';
    if n <> 0 then raise exception 'FALHA (%): viu coeficiente global', r.rotulo; end if;

    update public.disciplinary_records set witness_name = 'N01 ALTERADO' where id = '00000001-0000-4000-8000-0000000000c1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALHA (%): alterou medida disciplinar', r.rotulo; end if;
    delete from public.disciplinary_records where id = '00000001-0000-4000-8000-0000000000c1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALHA (%): excluiu medida disciplinar', r.rotulo; end if;
    update public.regras_portabilidade_ifs set notes = 'N01 ALTERADO' where id = '00000001-0000-4000-8000-0000000000b1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALHA (%): alterou regra por IF', r.rotulo; end if;
    delete from public.regras_portabilidade_ifs where id = '00000001-0000-4000-8000-0000000000b1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALHA (%): excluiu regra por IF', r.rotulo; end if;

    begin
      insert into public.disciplinary_records (employee_id, type, reason_id, occurrence_date, application_date,
        recurrence_number_by_reason, total_warnings_at_date, total_suspensions_at_date, status)
      values ('00000001-0000-4000-8000-0000000000e1', 'verbal_warning', '00000001-0000-4000-8000-0000000000d1',
        current_date, current_date, 1, 0, 0, 'active');
      raise exception 'FALHA (%): inseriu medida disciplinar', r.rotulo;
    exception when insufficient_privilege then null; end;
    begin
      insert into public.regras_portabilidade_ifs (institution_id, convenio_codigo)
      values ('00000001-0000-4000-8000-0000000000f1', 'N01NEG');
      raise exception 'FALHA (%): inseriu regra por IF', r.rotulo;
    exception when insufficient_privilege then null; end;
    begin
      insert into public.regras_portabilidade_globais (default_port_coeff) values (9);
      raise exception 'FALHA (%): inseriu coeficiente global', r.rotulo;
    exception when insufficient_privilege then null; end;

    if app_private.has_permission('rh-medidas-disciplinares', 'can_view')
       or app_private.has_permission('operacional-simulador-portabilidade', 'can_view') then
      raise exception 'FALHA (%): has_permission retornou true', r.rotulo;
    end if;

    execute 'reset role';
    raise notice 'OK negado: %', r.rotulo;
  end loop;
end $$;
reset role;

-- Nada mudou pelos negados.
do $$
declare n int;
begin
  select count(*) into n from public.disciplinary_records
  where id::text like '00000001-0000-4000-8000-0000000000c%' and witness_name is distinct from 'N01 ALTERADO';
  if n <> 2 then raise exception 'FALHA: medidas disciplinares alteradas/excluidas por negado'; end if;
  select count(*) into n from public.regras_portabilidade_ifs
  where id::text like '00000001-0000-4000-8000-0000000000b%' and notes = 'original';
  if n <> 2 then raise exception 'FALHA: regras por IF alteradas/excluidas por negado'; end if;
  select count(*) into n from public.regras_portabilidade_globais where default_port_coeff = 9;
  if n <> 0 then raise exception 'FALHA: coeficiente global inserido por negado'; end if;
  raise notice 'OK nenhum efeito dos negados';
end $$;

-- ---------------------------------------------------------------------------
-- RH (rh-medidas-disciplinares: view/include/edit/delete)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.disciplinary_records where id::text like '00000001-0000-4000-8000-0000000000c%';
  if n <> 2 then raise exception 'FALHA RH: esperado ver 2, viu %', n; end if;

  insert into public.disciplinary_records (id, employee_id, type, reason_id, occurrence_date, application_date,
    recurrence_number_by_reason, total_warnings_at_date, total_suspensions_at_date, status)
  values ('00000001-0000-4000-8000-0000000000c3', '00000001-0000-4000-8000-0000000000e1', 'suspension',
    '00000001-0000-4000-8000-0000000000d1', current_date, current_date, 3, 2, 0, 'active');

  update public.disciplinary_records set witness_name = 'N01 RH' where id = '00000001-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA RH: update afetou % linha(s)', n; end if;

  delete from public.disciplinary_records where id = '00000001-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA RH: delete afetou % linha(s)', n; end if;

  -- RH não ganha portabilidade.
  select count(*) into n from public.regras_portabilidade_ifs where id::text like '00000001-0000-4000-8000-0000000000b%';
  if n <> 0 then raise exception 'FALHA RH: viu regras de portabilidade'; end if;

  raise notice 'OK RH: select/insert/update/delete em disciplinary_records; sem portabilidade';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Portabilidade completa (view/include/edit/delete)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare n int; v numeric;
begin
  select count(*) into n from public.regras_portabilidade_ifs where id::text like '00000001-0000-4000-8000-0000000000b%';
  if n <> 2 then raise exception 'FALHA Port: esperado ver 2 regras, viu %', n; end if;
  select count(*) into n from public.regras_portabilidade_globais where id = '00000001-0000-4000-8000-0000000000b9';
  if n <> 1 then raise exception 'FALHA Port: nao viu coeficiente global'; end if;

  -- Mesmo formato do upsert de saveRegraIfPortabilidade: caminho de INSERT...
  insert into public.regras_portabilidade_ifs (institution_id, convenio_codigo, notes)
  values ('00000001-0000-4000-8000-0000000000f1', 'N01C', 'nova')
  on conflict (institution_id, convenio_codigo) do update set notes = excluded.notes;
  -- ...e caminho de UPDATE.
  insert into public.regras_portabilidade_ifs (institution_id, convenio_codigo, notes)
  values ('00000001-0000-4000-8000-0000000000f1', 'N01A', 'editada')
  on conflict (institution_id, convenio_codigo) do update set notes = excluded.notes;
  select count(*) into n from public.regras_portabilidade_ifs
  where id = '00000001-0000-4000-8000-0000000000b1' and notes = 'editada';
  if n <> 1 then raise exception 'FALHA Port: upsert nao editou a regra existente'; end if;

  delete from public.regras_portabilidade_ifs where id = '00000001-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA Port: delete afetou % linha(s)', n; end if;

  insert into public.regras_portabilidade_globais (default_port_coeff) values (0.022222);
  select default_port_coeff into v from public.regras_portabilidade_globais
  where default_port_coeff = 0.022222;
  if v is null then raise exception 'FALHA Port: nao gravou coeficiente global'; end if;

  -- Portabilidade não ganha RH.
  select count(*) into n from public.disciplinary_records where id::text like '00000001-0000-4000-8000-0000000000c%';
  if n <> 0 then raise exception 'FALHA Port: viu medidas disciplinares'; end if;

  raise notice 'OK Portabilidade: leitura, upsert (insert e update), delete, coeficiente global; sem RH';
end $$;
do $$ begin
  update public.regras_portabilidade_globais set default_port_coeff = 9;
  raise exception 'FALHA Port: UPDATE em coeficiente global deveria estar revogado';
exception when insufficient_privilege then raise notice 'OK coeficiente global e append-only para authenticated'; end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Portabilidade somente leitura (can_view): lê, não escreve
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000001-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.regras_portabilidade_ifs where id = '00000001-0000-4000-8000-0000000000b1';
  if n <> 1 then raise exception 'FALHA PortLeitura: deveria ver a regra'; end if;

  update public.regras_portabilidade_ifs set notes = 'N01 LEITURA' where id = '00000001-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA PortLeitura: alterou regra'; end if;

  delete from public.regras_portabilidade_ifs where id = '00000001-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA PortLeitura: excluiu regra'; end if;

  begin
    insert into public.regras_portabilidade_ifs (institution_id, convenio_codigo)
    values ('00000001-0000-4000-8000-0000000000f1', 'N01LEIT');
    raise exception 'FALHA PortLeitura: inseriu regra';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.regras_portabilidade_globais (default_port_coeff) values (9);
    raise exception 'FALHA PortLeitura: inseriu coeficiente global';
  exception when insufficient_privilege then null; end;

  raise notice 'OK Portabilidade leitura: so SELECT';
end $$;
reset role;

rollback;
