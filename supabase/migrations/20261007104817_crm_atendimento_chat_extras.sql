-- Atendimento sem lead / chat WhatsApp do CRM Alvo Consig (handoff 07/10/2026, frente 6).
--
-- CONTRATO com o web (brs-alvoconsig apps/web/src/lib/crm/atendimento-actions.ts,
-- fixarMensagemAtendimento / favoritarMensagemAtendimento; acesso só via service role):
--   chat_mensagens_fixadas   (id uuid, crm_usuario_id uuid, chatwoot_conversation_id integer,
--                             message_id bigint, created_at timestamptz)
--   chat_mensagens_favoritas (mesmas colunas)
--   - message_id = id da mensagem no Chatwoot (= chat_mensagens_mapa.chatwoot_message_id).
--   - Escopo por USUÁRIO do CRM (cada atendente tem as suas); o parceiro vem de
--     crm_usuarios.agente_parceiro_id. Uma linha por (crm_usuario_id, message_id): é a
--     chave do toggle (select ... maybeSingle) e barra duplicata em clique duplo.
--   chat_conversas.trafego_manual jsonb: formulário manual de tráfego pago (formato livre,
--     objeto JSON de até 4 KB). O web valida os campos; o banco só limita tipo e tamanho.
--
-- NÃO cria:
--   - crm_contatos.nascimento: já existe em produção (date) e é usada pelo web.
--   - policies realtime *_select_parceiro em chat_mensagem_status/reacoes/edicoes: essas
--     tabelas não têm conversa (só conta_id + chatwoot_message_id), então a policy por
--     parceiro deixaria qualquer atendente ler edições (texto) e reações (jid) de conversas
--     que não são dele. Decisão registrada: o web segue por polling via service role.
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES de qualquer deploy do web que use fixar,
-- favoritar ou trafego_manual. Engine não depende dela.
-- Idempotente: pode rodar duas vezes sem efeito na segunda.
--
-- ROLLBACK (manual, apaga fixadas/favoritas e o formulário de tráfego):
--   drop table if exists public.chat_mensagens_fixadas;
--   drop table if exists public.chat_mensagens_favoritas;
--   alter table public.chat_conversas drop constraint if exists chat_conversas_trafego_manual_check;
--   alter table public.chat_conversas drop column if exists trafego_manual;
--   delete from supabase_migrations.schema_migrations where version = '20261007104817';

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Mensagens fixadas e favoritas (por usuário do CRM)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_mensagens_fixadas (
  id uuid primary key default gen_random_uuid(),
  crm_usuario_id uuid not null references public.crm_usuarios (id) on delete cascade,
  chatwoot_conversation_id integer not null,
  message_id bigint not null,
  created_at timestamptz not null default now(),
  constraint chat_mensagens_fixadas_usuario_mensagem_key unique (crm_usuario_id, message_id)
);

create table if not exists public.chat_mensagens_favoritas (
  id uuid primary key default gen_random_uuid(),
  crm_usuario_id uuid not null references public.crm_usuarios (id) on delete cascade,
  chatwoot_conversation_id integer not null,
  message_id bigint not null,
  created_at timestamptz not null default now(),
  constraint chat_mensagens_favoritas_usuario_mensagem_key unique (crm_usuario_id, message_id)
);

-- Listagem "fixadas desta conversa" do usuário
create index if not exists chat_mensagens_fixadas_usuario_conversa_idx
  on public.chat_mensagens_fixadas (crm_usuario_id, chatwoot_conversation_id);
create index if not exists chat_mensagens_favoritas_usuario_conversa_idx
  on public.chat_mensagens_favoritas (crm_usuario_id, chatwoot_conversation_id);

comment on table public.chat_mensagens_fixadas is
  'Mensagens do WhatsApp (Chatwoot) fixadas por usuário do CRM. Só service role; o web confere a conversa (exigirConversaAutorizada) antes de gravar.';
comment on table public.chat_mensagens_favoritas is
  'Mensagens do WhatsApp (Chatwoot) favoritadas por usuário do CRM. Só service role; o web confere a conversa (exigirConversaAutorizada) antes de gravar.';

-- Acesso: RLS ligada sem policy, só service role (padrão 20261007031034)
alter table public.chat_mensagens_fixadas enable row level security;
alter table public.chat_mensagens_favoritas enable row level security;
revoke all on public.chat_mensagens_fixadas, public.chat_mensagens_favoritas from public, anon, authenticated;
grant select, insert, update, delete on public.chat_mensagens_fixadas, public.chat_mensagens_favoritas to service_role;

-- ---------------------------------------------------------------------------
-- 2. Formulário manual de tráfego pago na conversa
-- ---------------------------------------------------------------------------
alter table public.chat_conversas add column if not exists trafego_manual jsonb null;

-- NOT VALID + VALIDATE separados só para o DO block ser idempotente. Como o db push roda
-- o arquivo numa transação, o ACCESS EXCLUSIVE do ADD COLUMN/ADD CONSTRAINT fica até o
-- commit; com ~860 conversas e lock_timeout 5s o efeito é desprezível.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.chat_conversas'::regclass
                   and conname = 'chat_conversas_trafego_manual_check') then
    alter table public.chat_conversas add constraint chat_conversas_trafego_manual_check
      check (trafego_manual is null
             or (jsonb_typeof(trafego_manual) = 'object' and octet_length(trafego_manual::text) < 4096))
      not valid;
  end if;
end $$;
alter table public.chat_conversas validate constraint chat_conversas_trafego_manual_check;

comment on column public.chat_conversas.trafego_manual is
  'Tráfego pago informado à mão pelo atendente (objeto JSON livre, < 4 KB). A origem automática continua em origem_anuncio.';

reset lock_timeout;
notify pgrst, 'reload schema';
