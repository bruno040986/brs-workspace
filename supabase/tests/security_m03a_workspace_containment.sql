-- Roda DEPOIS das migrations 20261101010000 e 20261101020000 (ver run-m03a.sh), em banco descartável.
-- Cobre a migration 20261101020000: comunicados, workspace_chat_user_profiles, REVOKE de anon,
-- SECURITY DEFINER. Transação com ROLLBACK; falha = RAISE EXCEPTION.
-- Usuários (UUID 00000002-...): 01 interno sem perfil | 02 interno com perfil Comunicação (alvo do c2)
-- | 03 gestor de comunicados (sistema-comunicados can_view) | 04 desativado | 05 parceiro com linha em
-- users e marca external | 06 parceiro sem linha (SSO) .
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000002-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'm03a.interno@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000002-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'm03a.com@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000002-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'm03a.gestor@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000002-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'm03a.deslig@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000002-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'm03a.parceiro1@parceiro.brspromotora.com.br', '{"external":true}', '{}', now(), now()),
  ('00000002-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'm03a.crm@gmail.com', '{"external":true}', '{}', now(), now());

insert into public.access_profiles (id, name) values
  ('00000002-0000-4000-8000-0000000000a1', 'M03A COMUNICACAO'),
  ('00000002-0000-4000-8000-0000000000a2', 'M03A GESTOR COMUNICADOS');
insert into public.profile_permissions (profile_id, resource_name, can_view) values
  ('00000002-0000-4000-8000-0000000000a2', 'sistema-comunicados', true);

insert into public.users (id, name, email, role, profile_id, active) values
  ('00000002-0000-4000-8000-000000000001', 'M03A Interno', 'm03a.interno@brspromotora.com.br', 'consulta', null, true),
  ('00000002-0000-4000-8000-000000000002', 'M03A Com', 'm03a.com@brspromotora.com.br', 'consulta', '00000002-0000-4000-8000-0000000000a1', true),
  ('00000002-0000-4000-8000-000000000003', 'M03A Gestor', 'm03a.gestor@brspromotora.com.br', 'consulta', '00000002-0000-4000-8000-0000000000a2', true),
  ('00000002-0000-4000-8000-000000000004', 'M03A Deslig', 'm03a.deslig@brspromotora.com.br', 'consulta', '00000002-0000-4000-8000-0000000000a2', false),
  ('00000002-0000-4000-8000-000000000005', 'M03A Parceiro', 'm03a.parceiro1@parceiro.brspromotora.com.br', 'consulta', '00000002-0000-4000-8000-0000000000a2', true);

insert into public.comunicados (id, titulo, texto_html, status, data_inicio_veiculacao, data_fim_veiculacao) values
  ('00000002-0000-4000-8000-0000000000c1', 'c1 todos',     '<p>x</p>', 'ativo',   now() - interval '1 day',  now() + interval '1 day'),
  ('00000002-0000-4000-8000-0000000000c2', 'c2 so perfil', '<p>x</p>', 'ativo',   now() - interval '1 day',  now() + interval '1 day'),
  ('00000002-0000-4000-8000-0000000000c3', 'c3 inativo',   '<p>x</p>', 'inativo', now() - interval '1 day',  now() + interval '1 day'),
  ('00000002-0000-4000-8000-0000000000c4', 'c4 vencido',   '<p>x</p>', 'ativo',   now() - interval '3 days', now() - interval '2 days');
insert into public.comunicado_target_profiles (comunicado_id, profile_id) values
  ('00000002-0000-4000-8000-0000000000c2', '00000002-0000-4000-8000-0000000000a1');
insert into public.comunicado_reads (comunicado_id, user_id) values
  ('00000002-0000-4000-8000-0000000000c1', '00000002-0000-4000-8000-000000000001'),
  ('00000002-0000-4000-8000-0000000000c1', '00000002-0000-4000-8000-000000000002');
insert into public.workspace_chat_user_profiles (user_id, nickname, status) values
  ('00000002-0000-4000-8000-000000000001', 'a', 'online'),
  ('00000002-0000-4000-8000-000000000002', 'b', 'online'),
  ('00000002-0000-4000-8000-000000000003', 'c', 'away');

-- Linha de base: o superusuário vê tudo (nada passa por tabela vazia).
do $$ declare n int; begin
  select count(*) into n from public.comunicados where id::text like '00000002-%'; if n <> 4 then raise exception 'base comunicados: % <> 4', n; end if;
  select count(*) into n from public.comunicado_target_profiles where comunicado_id::text like '00000002-%'; if n <> 1 then raise exception 'base alvos: % <> 1', n; end if;
  select count(*) into n from public.comunicado_reads where user_id::text like '00000002-%'; if n <> 2 then raise exception 'base reads: % <> 2', n; end if;
  select count(*) into n from public.workspace_chat_user_profiles where user_id::text like '00000002-%'; if n <> 3 then raise exception 'base chat: % <> 3', n; end if;
  raise notice 'OK base: superusuario ve 4 comunicados, 1 alvo, 2 leituras, 3 perfis de chat';
end $$;

-- ---- estrutura -------------------------------------------------------------------------
do $$ declare n int; begin
  -- Nenhuma tabela de public com RLS e sem política para anon mantém privilégio de anon.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
      or has_table_privilege('anon', c.oid, 'TRUNCATE'));
  if n <> 0 then raise exception 'FALHA: % tabela(s) com RLS ainda concedem privilegio a anon', n; end if;

  -- Políticas novas: todas TO authenticated explícito, nenhuma true cru.
  select count(*) into n from pg_policies where schemaname = 'public'
    and tablename in ('comunicados','comunicado_target_profiles','comunicado_reads','workspace_chat_user_profiles')
    and (roles <> array['authenticated']::name[] or coalesce(qual,'') in ('true','(true)'));
  if n <> 0 then raise exception 'FALHA: % politica(s) aberta(s) ou sem TO authenticated nas tabelas M03-A', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'comunicado_target_profiles';
  if n <> 0 then raise exception 'FALHA: comunicado_target_profiles deveria ficar sem politica (deny-all)'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'workspace_chat_user_profiles';
  if n <> 1 then raise exception 'FALHA: workspace_chat_user_profiles deveria ter 1 politica, tem %', n; end if;

  -- authenticated sem escrita nem TRUNCATE nessas tabelas.
  if has_table_privilege('authenticated', 'public.comunicados', 'INSERT') or has_table_privilege('authenticated', 'public.comunicados', 'UPDATE')
     or has_table_privilege('authenticated', 'public.workspace_chat_user_profiles', 'INSERT')
     or has_table_privilege('authenticated', 'public.workspace_chat_user_profiles', 'UPDATE')
     or has_table_privilege('authenticated', 'public.comunicado_target_profiles', 'SELECT')
     or has_table_privilege('authenticated', 'public.comunicado_reads', 'INSERT') then
    raise exception 'FALHA: authenticated ainda escreve (ou le alvos) em tabela M03-A';
  end if;
  if not has_table_privilege('service_role', 'public.comunicados', 'INSERT') then
    raise exception 'FALHA: service_role perdeu acesso a comunicados';
  end if;

  -- SECURITY DEFINER: ninguém fora service_role/authenticated(apoio de RLS) executa; anon nunca.
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname in ('public','app_private') and p.prosecdef
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'FALHA: % SECURITY DEFINER executavel por anon', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname in ('public','app_private') and p.prosecdef
    and p.proname in ('handle_new_user','wa_bump_slot','wa_campaign_recount','wa_claim_next_recipient','workspace_chat_ao_criar_usuario',
                      'helpdesk_notificar','helpdesk_registrar_historico','helpdesk_historico_etapa','helpdesk_comentario_notificar',
                      'limpar_chat_atendimento_sinais','wa_campaign_recipients_counter_trg')
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'FALHA: % SECURITY DEFINER de servico/gatilho executavel por authenticated', n; end if;
  if not has_function_privilege('service_role', 'public.wa_claim_next_recipient(uuid)', 'EXECUTE') then
    raise exception 'FALHA: service_role perdeu wa_claim_next_recipient';
  end if;
  if not has_function_privilege('authenticated', 'app_private.has_permission(text,text)', 'EXECUTE') then
    raise exception 'FALHA: authenticated perdeu has_permission (RLS quebraria)';
  end if;
  -- search_path fixo nas SECURITY DEFINER de Workspace tocadas.
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname in ('public','app_private') and p.proname in ('handle_new_user','wa_bump_slot','wa_campaign_recount','wa_claim_next_recipient',
        'workspace_chat_ao_criar_usuario','is_active_internal_user','comunicado_alcanca_usuario')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if n <> 0 then raise exception 'FALHA: % funcao(oes) sem search_path fixo', n; end if;
  raise notice 'OK estrutura M03-A: anon sem privilegio, politicas TO authenticated, sem escrita, SECURITY DEFINER minimas';
end $$;

-- ---- anon ------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare n int; begin select count(*) into n from public.comunicados;
  raise exception 'FALHA: anon leu comunicados (%)', n; exception when insufficient_privilege then raise notice 'OK anon nao le comunicados'; end $$;
do $$ declare n int; begin select count(*) into n from public.workspace_chat_user_profiles;
  raise exception 'FALHA: anon leu perfis de chat (%)', n; exception when insufficient_privilege then raise notice 'OK anon nao le perfis de chat'; end $$;
do $$ declare n int; begin select count(*) into n from public.comunicado_target_profiles;
  raise exception 'FALHA: anon leu alvos'; exception when insufficient_privilege then raise notice 'OK anon nao le alvos de comunicado'; end $$;
do $$ begin perform public.wa_bump_slot('00000002-0000-4000-8000-0000000000ff');
  raise exception 'FALHA: anon executou wa_bump_slot'; exception when insufficient_privilege then raise notice 'OK anon nao executa SECURITY DEFINER'; end $$;
reset role;

-- ---- negados: desativado, parceiro com linha + marca external, parceiro/CRM sem linha ----
create temporary table m03a_negados (sub uuid, claims jsonb, rotulo text) on commit drop;
insert into m03a_negados values
  ('00000002-0000-4000-8000-000000000004', '{"role":"authenticated","sub":"00000002-0000-4000-8000-000000000004"}', 'desativado com perfil'),
  ('00000002-0000-4000-8000-000000000005', '{"role":"authenticated","sub":"00000002-0000-4000-8000-000000000005","app_metadata":{"external":true}}', 'parceiro com linha e marca external'),
  ('00000002-0000-4000-8000-000000000006', '{"role":"authenticated","sub":"00000002-0000-4000-8000-000000000006","app_metadata":{"external":true}}', 'CRM via SSO sem linha');
grant select on m03a_negados to authenticated;
do $$ declare r record; n int; begin
  for r in select * from m03a_negados loop
    perform set_config('request.jwt.claims', r.claims::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.comunicados where id::text like '00000002-%';
    if n <> 0 then raise exception 'FALHA (%): viu % comunicado(s)', r.rotulo, n; end if;
    select count(*) into n from public.workspace_chat_user_profiles where user_id::text like '00000002-%';
    if n <> 0 then raise exception 'FALHA (%): viu % perfil(is) de chat', r.rotulo, n; end if;
    select count(*) into n from public.comunicado_reads where user_id::text like '00000002-%';
    if n <> 0 then raise exception 'FALHA (%): viu leituras', r.rotulo; end if;
    if app_private.is_active_internal_user() then raise exception 'FALHA (%): is_active_internal_user = true', r.rotulo; end if;
    execute 'reset role';
    raise notice 'OK negado: %', r.rotulo;
  end loop;
end $$;
reset role;

-- ---- interno ativo sem perfil: só o aviso geral vigente ----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000002-0000-4000-8000-000000000001"}', true);
do $$ declare n int; begin
  select count(*) into n from public.comunicados where id::text like '00000002-%';
  if n <> 1 then raise exception 'FALHA interno sem perfil: esperado 1 comunicado (c1), viu %', n; end if;
  select count(*) into n from public.comunicados where id = '00000002-0000-4000-8000-0000000000c1';
  if n <> 1 then raise exception 'FALHA interno sem perfil: nao viu c1'; end if;
  select count(*) into n from public.workspace_chat_user_profiles where user_id::text like '00000002-%';
  if n <> 3 then raise exception 'FALHA interno: esperado ver 3 perfis de chat, viu %', n; end if;
  select count(*) into n from public.comunicado_reads where user_id::text like '00000002-%';
  if n <> 1 then raise exception 'FALHA interno: so a propria leitura (1), viu %', n; end if;
  raise notice 'OK interno sem perfil: 1 comunicado (geral vigente), 3 perfis de chat, so a propria leitura';
end $$;
-- escrita nunca pelo cliente
do $$ begin insert into public.comunicados (titulo, texto_html, data_inicio_veiculacao, data_fim_veiculacao) values ('x','x',now(),now());
  raise exception 'FALHA: authenticated inseriu comunicado'; exception when insufficient_privilege then raise notice 'OK authenticated nao insere comunicado'; end $$;
do $$ begin update public.workspace_chat_user_profiles set status = 'x';
  raise exception 'FALHA: authenticated alterou perfil de chat'; exception when insufficient_privilege then raise notice 'OK authenticated nao altera perfil de chat'; end $$;
do $$ declare n int; begin select count(*) into n from public.comunicado_target_profiles;
  raise exception 'FALHA: authenticated leu alvos'; exception when insufficient_privilege then raise notice 'OK authenticated nao le alvos de comunicado'; end $$;
reset role;

-- ---- interno do perfil alvo: c1 + c2 ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000002-0000-4000-8000-000000000002"}', true);
do $$ declare n int; begin
  select count(*) into n from public.comunicados where id::text like '00000002-%';
  if n <> 2 then raise exception 'FALHA perfil alvo: esperado 2 (c1,c2), viu %', n; end if;
  select count(*) into n from public.comunicados where id = '00000002-0000-4000-8000-0000000000c2';
  if n <> 1 then raise exception 'FALHA perfil alvo: nao viu c2'; end if;
  raise notice 'OK interno do perfil alvo: c1 e c2';
end $$;
reset role;

-- ---- gestor (sistema-comunicados can_view): vê inclusive inativo e vencido ----------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000002-0000-4000-8000-000000000003"}', true);
do $$ declare n int; begin
  select count(*) into n from public.comunicados where id::text like '00000002-%';
  if n <> 4 then raise exception 'FALHA gestor: esperado 4, viu %', n; end if;
  raise notice 'OK gestor de comunicados ve os 4';
end $$;
reset role;

-- ---- service_role (caminho das rotas /api/comunicados e /api/chat) ----------------------
set local role service_role;
do $$ declare n int; begin
  select count(*) into n from public.comunicados where id::text like '00000002-%';
  if n <> 4 then raise exception 'FALHA service_role: esperado 4, viu %', n; end if;
  select count(*) into n from public.comunicado_target_profiles where comunicado_id::text like '00000002-%';
  if n <> 1 then raise exception 'FALHA service_role: alvos %', n; end if;
  update public.workspace_chat_user_profiles set status = 'busy' where user_id = '00000002-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA service_role: nao atualizou presenca'; end if;
  raise notice 'OK service_role mantem leitura/escrita dos consumidores de API';
end $$;
reset role;

rollback;
