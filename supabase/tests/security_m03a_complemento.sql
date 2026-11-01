-- Roda DEPOIS da 20261101025000 (ver run-m03a.sh), banco descartavel. Transacao com ROLLBACK.
-- Usuarios 00000004-...: 01 interno sem permissao | 02 com perfil que tem sistema-usuarios-perfis can_view.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000004-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'm03a.c1@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000004-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'm03a.c2@brspromotora.com.br', '{}', '{}', now(), now());
insert into public.access_profiles (id, name) values ('00000004-0000-4000-8000-0000000000a1', 'M03A COMPL PERFIS');
insert into public.profile_permissions (profile_id, resource_name, can_view) values ('00000004-0000-4000-8000-0000000000a1', 'sistema-usuarios-perfis', true);
insert into public.users (id, name, email, role, profile_id, active) values
  ('00000004-0000-4000-8000-000000000001', 'C1', 'm03a.c1@brspromotora.com.br', 'consulta', null, true),
  ('00000004-0000-4000-8000-000000000002', 'C2', 'm03a.c2@brspromotora.com.br', 'consulta', '00000004-0000-4000-8000-0000000000a1', true);
insert into public.profile_schedules (profile_id, day_of_week, start_time, end_time) values ('00000004-0000-4000-8000-0000000000a1', 1, '08:00', '18:00');
insert into public.user_schedules (user_id, day_of_week, start_time, end_time) values ('00000004-0000-4000-8000-000000000001', 1, '08:00', '18:00');
insert into public.sector_links (sector_id, name, label, url) values ('zz', 'l', 'l', 'https://x.test');

-- politicas abertas sumiram; as por permissao ficaram
do $$ declare n int; begin
  select count(*) into n from pg_policies where schemaname='public' and tablename in ('profile_schedules','user_schedules','sector_links') and 'public' = any(roles);
  if n <> 0 then raise exception 'FALHA: sobrou politica {public} (%)', n; end if;
  select count(*) into n from pg_policies where schemaname='public' and policyname in ('profile_schedules_select_user_admin','user_schedules_select_user_admin','sector_links_select_by_workspace_or_admin');
  if n <> 3 then raise exception 'FALHA: politicas por permissao ausentes (%)', n; end if;
  select count(*) into n from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('Sistema gerencia avatares','Avatares Públicos');
  if n <> 0 then raise exception 'FALHA: politica publica de avatares permaneceu'; end if;
  raise notice 'OK complemento: politicas abertas removidas, por permissao mantidas';
end $$;

-- linha de base
do $$ declare n int; begin
  select count(*) into n from public.profile_schedules; if n < 1 then raise exception 'base profile_schedules vazia'; end if;
  select count(*) into n from public.user_schedules; if n < 1 then raise exception 'base user_schedules vazia'; end if;
  select count(*) into n from public.sector_links; if n < 1 then raise exception 'base sector_links vazia'; end if;
end $$;

-- anon: sem privilegio nas 3 tabelas
set local role anon;
do $$ declare t text; begin
  foreach t in array array['profile_schedules','user_schedules','sector_links'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'FALHA: anon leu %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  -- storage: anon nao insere em avatars
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'anon-x.png');
    raise exception 'FALHA: anon inseriu em storage.objects avatars';
  exception when insufficient_privilege then null; end;
  if (select count(*) from storage.objects where bucket_id = 'avatars') <> 0 then raise exception 'FALHA: anon le avatars'; end if;
  raise notice 'OK anon: sem leitura das 3 tabelas, sem insert/select em avatars';
end $$;
reset role;

-- authenticated sem permissao: 0 linhas; com permissao de perfis: ve as de perfil
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000004-0000-4000-8000-000000000001"}', true);
do $$ declare n int; begin
  select count(*) into n from public.profile_schedules; if n <> 0 then raise exception 'FALHA: sem permissao viu profile_schedules (%)', n; end if;
  select count(*) into n from public.user_schedules; if n <> 0 then raise exception 'FALHA: sem permissao viu user_schedules (%)', n; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'auth-x.png');
    raise exception 'FALHA: authenticated inseriu em avatars';
  exception when insufficient_privilege then null; end;
  raise notice 'OK authenticated sem permissao: 0 linhas de schedules, sem upload em avatars';
end $$;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000004-0000-4000-8000-000000000002"}', true);
do $$ declare n int; begin
  select count(*) into n from public.profile_schedules; if n <> 1 then raise exception 'FALHA: com permissao nao viu profile_schedules (%)', n; end if;
  raise notice 'OK authenticated com sistema-usuarios-perfis ainda le profile_schedules';
end $$;
reset role;

rollback;
