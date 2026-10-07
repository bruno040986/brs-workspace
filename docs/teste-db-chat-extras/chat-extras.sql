-- Testes de *_crm_atendimento_chat_extras.sql (Workspace). Roda DEPOIS da migration
-- (aplicada DUAS vezes), com os dados do chat-extras-fixture.sql. Usa pg_temp.assert_true.
-- Usuário A = ...0008-0000000000a1, B = ...0008-0000000000b1.

-- ---------------------------------------------------------------------------
-- Estrutura e acesso
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
  = 'id:uuid,crm_usuario_id:uuid,chatwoot_conversation_id:integer,message_id:bigint,created_at:timestamp with time zone'
  from information_schema.columns where table_schema = 'public' and table_name = 'chat_mensagens_fixadas'), 'fixadas: colunas do contrato');
select pg_temp.assert_true((select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
  = 'id:uuid,crm_usuario_id:uuid,chatwoot_conversation_id:integer,message_id:bigint,created_at:timestamp with time zone'
  from information_schema.columns where table_schema = 'public' and table_name = 'chat_mensagens_favoritas'), 'favoritas: colunas do contrato');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid = 'public.chat_mensagens_fixadas'::regclass), 'RLS ligada em fixadas');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid = 'public.chat_mensagens_favoritas'::regclass), 'RLS ligada em favoritas');
select pg_temp.assert_true((select count(*) = 0 from pg_policies where tablename in ('chat_mensagens_fixadas', 'chat_mensagens_favoritas')), 'sem policy (só service role)');
select pg_temp.assert_true((select count(*) = 0 from pg_policies where tablename in ('chat_mensagem_status', 'chat_mensagem_reacoes', 'chat_mensagem_edicoes') and policyname like '%parceiro%'), 'nenhuma policy realtime de parceiro criada');
select pg_temp.assert_true((select count(*) = 0 from pg_publication_tables where tablename in ('chat_mensagens_fixadas', 'chat_mensagens_favoritas')), 'fora da publicação Realtime');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.chat_mensagens_fixadas', 'select')
  and not has_table_privilege('authenticated', 'public.chat_mensagens_favoritas', 'select'), 'authenticated sem select');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.chat_mensagens_fixadas', 'select')
  and not has_table_privilege('anon', 'public.chat_mensagens_favoritas', 'insert'), 'anon sem acesso');
select pg_temp.assert_true(has_table_privilege('service_role', 'public.chat_mensagens_fixadas', 'insert')
  and has_table_privilege('service_role', 'public.chat_mensagens_favoritas', 'delete'), 'service_role grava e apaga');
select pg_temp.assert_true((select s.coluna = (select format_type(atttypid, atttypmod) || ':' || attnotnull from pg_attribute
    where attrelid = 'public.crm_contatos'::regclass and attname = 'nascimento')
  and s.constraints = (select count(*) from pg_constraint where conrelid = 'public.crm_contatos'::regclass)
  and s.defaults = (select count(*) from pg_attrdef where adrelid = 'public.crm_contatos'::regclass)
  from snap_nascimento s), 'migration não cria nem altera crm_contatos.nascimento');

set role authenticated;
do $$ begin
  perform 1 from public.chat_mensagens_fixadas;
  raise exception 'FAIL: authenticated leu chat_mensagens_fixadas';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.chat_mensagens_favoritas (crm_usuario_id, chatwoot_conversation_id, message_id)
  values ('00000000-0000-0000-0008-0000000000a1', 1, 1);
  raise exception 'FAIL: authenticated gravou chat_mensagens_favoritas';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Toggle do web: insert com as colunas exatas das actions, unique por usuário+mensagem
-- ---------------------------------------------------------------------------
insert into chat_mensagens_fixadas (crm_usuario_id, chatwoot_conversation_id, message_id) values
  ('00000000-0000-0000-0008-0000000000a1', 501, 9001),
  ('00000000-0000-0000-0008-0000000000b1', 501, 9001);  -- mesma mensagem, outro usuário: ok
insert into chat_mensagens_favoritas (crm_usuario_id, chatwoot_conversation_id, message_id) values
  ('00000000-0000-0000-0008-0000000000a1', 501, 3000000000);  -- acima de int4
do $$ begin
  insert into chat_mensagens_fixadas (crm_usuario_id, chatwoot_conversation_id, message_id)
  values ('00000000-0000-0000-0008-0000000000a1', 501, 9001);
  raise exception 'FAIL: fixou a mesma mensagem 2x';
exception when unique_violation then null; end $$;
do $$ begin
  insert into chat_mensagens_favoritas (crm_usuario_id, chatwoot_conversation_id, message_id)
  values ('00000000-0000-0000-0008-0000000000a1', 501, 3000000000);
  raise exception 'FAIL: favoritou a mesma mensagem 2x';
exception when unique_violation then null; end $$;
do $$ begin
  insert into chat_mensagens_fixadas (crm_usuario_id, chatwoot_conversation_id, message_id)
  values ('00000000-0000-0000-0008-0000000000ff', 501, 1);
  raise exception 'FAIL: fixou com usuário inexistente';
exception when foreign_key_violation then null; end $$;
do $$ begin
  insert into chat_mensagens_fixadas (crm_usuario_id, chatwoot_conversation_id) values ('00000000-0000-0000-0008-0000000000a1', 501);
  raise exception 'FAIL: fixou sem message_id';
exception when not_null_violation then null; end $$;
select pg_temp.assert_true((select count(*) = 1 from chat_mensagens_fixadas
  where crm_usuario_id = '00000000-0000-0000-0008-0000000000a1' and message_id = 9001), 'select do toggle acha 1 linha (maybeSingle)');

-- Apagar o usuário apaga as dele
delete from crm_usuarios where id = '00000000-0000-0000-0008-0000000000a1';
select pg_temp.assert_true((select count(*) = 0 from chat_mensagens_fixadas where crm_usuario_id = '00000000-0000-0000-0008-0000000000a1')
  and (select count(*) = 0 from chat_mensagens_favoritas where crm_usuario_id = '00000000-0000-0000-0008-0000000000a1'), 'cascade ao apagar usuário');
select pg_temp.assert_true((select count(*) = 1 from chat_mensagens_fixadas where crm_usuario_id = '00000000-0000-0000-0008-0000000000b1'), 'linha do outro usuário fica');

-- ---------------------------------------------------------------------------
-- chat_conversas.trafego_manual
-- ---------------------------------------------------------------------------
select pg_temp.assert_true((select data_type = 'jsonb' and is_nullable = 'YES' from information_schema.columns
  where table_name = 'chat_conversas' and column_name = 'trafego_manual'), 'trafego_manual jsonb nulável');
select pg_temp.assert_true((select convalidated from pg_constraint where conname = 'chat_conversas_trafego_manual_check'), 'check validado');
select pg_temp.assert_true((select count(*) = 1 from pg_constraint where conname = 'chat_conversas_trafego_manual_check'), 'check único mesmo com a migration 2x');
update chat_conversas set trafego_manual = '{"campanha":"Teste","plataforma":"meta","obs":"sintético"}' where id = '00000000-0000-0000-0008-0000000000d1';
update chat_conversas set trafego_manual = null where id = '00000000-0000-0000-0008-0000000000d1';
do $$ begin
  update chat_conversas set trafego_manual = '["a"]' where id = '00000000-0000-0000-0008-0000000000d1';
  raise exception 'FAIL: aceitou array';
exception when check_violation then null; end $$;
do $$ begin
  update chat_conversas set trafego_manual = '"texto"' where id = '00000000-0000-0000-0008-0000000000d1';
  raise exception 'FAIL: aceitou escalar';
exception when check_violation then null; end $$;
do $$ begin
  update chat_conversas set trafego_manual = jsonb_build_object('obs', repeat('x', 4100)) where id = '00000000-0000-0000-0008-0000000000d1';
  raise exception 'FAIL: aceitou > 4 KB';
exception when check_violation then null; end $$;
