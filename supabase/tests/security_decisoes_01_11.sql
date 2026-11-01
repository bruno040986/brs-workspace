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
insert into auth.users (id, email) values
  ('00000009-0000-4000-8000-000000000001','d9.colab1@brspromotora.com.br'),('00000009-0000-4000-8000-000000000002','d9.colab2@brspromotora.com.br'),
  ('00000009-0000-4000-8000-000000000003','d9.rh@brspromotora.com.br'),('00000009-0000-4000-8000-000000000004','d9.nada@brspromotora.com.br'),
  ('00000009-0000-4000-8000-000000000005','D9.Email@brspromotora.com.br');
alter table public.employees add column if not exists email text;
insert into public.employees (id, name, cpf, status, email) values ('00000009-0000-4000-8000-0000000000e3','D9 Colab 3','00000000903','active','d9.email@brspromotora.com.br');
insert into public.disciplinary_records (id, employee_id, type, reason_id, occurrence_date, application_date, status) values
  ('00000009-0000-4000-8000-0000000000c3', '00000009-0000-4000-8000-0000000000e3', 'verbal_warning', '00000009-0000-4000-8000-0000000000d1', current_date, current_date, 'active');
insert into public.users (id, name, email, role, profile_id, active, employee_id) values
  ('00000009-0000-4000-8000-000000000005', 'D9 Email', 'D9.Email@brspromotora.com.br', 'consulta', null, true, null),
  ('00000009-0000-4000-8000-000000000001', 'D9 Colab1', 'd9.colab1@brspromotora.com.br', 'consulta', null, true, '00000009-0000-4000-8000-0000000000e1'),
  ('00000009-0000-4000-8000-000000000002', 'D9 Colab2', 'd9.colab2@brspromotora.com.br', 'consulta', null, true, '00000009-0000-4000-8000-0000000000e2'),
  ('00000009-0000-4000-8000-000000000003', 'D9 RHcolab', 'd9.rh@brspromotora.com.br', 'consulta', '00000009-0000-4000-8000-0000000000a1', true, null),
  ('00000009-0000-4000-8000-000000000004', 'D9 Nada', 'd9.nada@brspromotora.com.br', 'consulta', null, true, null);

-- trigger_link_employee_by_cpf zera employee_id no INSERT (vincula por CPF); o vinculo explicito entra por UPDATE.
update public.users set employee_id = '00000009-0000-4000-8000-0000000000e1' where id = '00000009-0000-4000-8000-000000000001';
update public.users set employee_id = '00000009-0000-4000-8000-0000000000e2' where id = '00000009-0000-4000-8000-000000000002';

create temporary table d9_casos (sub uuid, esperado int, rotulo text);
insert into d9_casos values
  ('00000009-0000-4000-8000-000000000001', 1, 'colaborador ve so a propria'),
  ('00000009-0000-4000-8000-000000000002', 1, 'outro colaborador ve so a dele'),
  ('00000009-0000-4000-8000-000000000003', 3, 'rh-colaboradores ve o historico'),
  ('00000009-0000-4000-8000-000000000005', 1, 'vinculo por e-mail (sem users.employee_id)'),
  ('00000009-0000-4000-8000-000000000004', 0, 'sem vinculo nem permissao nao ve');
grant select on d9_casos to authenticated;

do $$
declare r record; n int;
begin
  for r in select * from d9_casos loop
    -- ponytail: claim app_metadata.external contorna o portao de sessao do M04 (nao e o objeto do teste); o RLS e o mesmo.
    perform set_config('request.jwt.claims', json_build_object('sub', r.sub, 'role', 'authenticated', 'app_metadata', json_build_object('external', 'x'))::text, true);
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
