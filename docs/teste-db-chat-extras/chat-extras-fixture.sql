-- Fixture para *_crm_atendimento_chat_extras.sql (Workspace). Roda sobre o
-- bootstrap.sql do CRM (brs-alvoconsig/tests/db/bootstrap.sql) e ANTES da
-- migration; chat-extras.sql roda depois. Só dados sintéticos (ids 0008).

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
