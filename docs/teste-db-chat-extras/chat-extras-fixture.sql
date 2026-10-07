-- Fixture para *_crm_atendimento_chat_extras.sql (Workspace). Roda sobre o
-- bootstrap.sql do CRM (brs-alvoconsig/tests/db/bootstrap.sql) e ANTES da
-- migration; chat-extras.sql roda depois. Só dados sintéticos (ids 0008).

-- Supabase concede tudo a anon/authenticated em tabela nova (default privileges);
-- sem isto as asserções "sem acesso" passariam mesmo sem o revoke da migration.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- crm_contatos.nascimento como em produção (date) + retrato para provar que a migration não mexe nela
alter table public.crm_contatos add column if not exists nascimento date;
create temp table snap_nascimento as
select (select format_type(atttypid, atttypmod) || ':' || attnotnull from pg_attribute
        where attrelid = 'public.crm_contatos'::regclass and attname = 'nascimento') as coluna,
       (select count(*) from pg_constraint where conrelid = 'public.crm_contatos'::regclass) as constraints,
       (select count(*) from pg_attrdef where adrelid = 'public.crm_contatos'::regclass) as defaults;

-- Parceiros A e B, um usuário em cada, uma conversa
insert into public.agentes_parceiros values
  ('00000000-0000-0000-0008-000000000001'), ('00000000-0000-0000-0008-000000000002')
on conflict do nothing;
insert into public.crm_usuarios (id, agente_parceiro_id, papel, ativo) values
  ('00000000-0000-0000-0008-0000000000a1', '00000000-0000-0000-0008-000000000001', 'atendente', true),
  ('00000000-0000-0000-0008-0000000000b1', '00000000-0000-0000-0008-000000000002', 'atendente', true);
insert into public.chat_instancias (id, agente_parceiro_id) values
  ('00000000-0000-0000-0008-0000000000c1', '00000000-0000-0000-0008-000000000001');
insert into public.chat_conversas (id, instancia_id) values
  ('00000000-0000-0000-0008-0000000000d1', '00000000-0000-0000-0008-0000000000c1');
