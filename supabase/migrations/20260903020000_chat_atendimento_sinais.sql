-- ---------------------------------------------------------------------------
-- Atendimento (WhatsApp) — Supabase Realtime pra sinalizar mensagem nova
-- (03/09/2026, fase 2 do projeto de velocidade pedido pelo Bruno: troca o
-- poll de 5-10s da tela de Atendimento por entrega quase instantânea, sem
-- depender do WebSocket experimental do Chatwoot).
--
-- O conteúdo das mensagens continua vivendo só no Chatwoot (getMensagensParceiro
-- busca via REST) — esta tabela NÃO duplica conteúdo, é só um sinal "algo
-- mudou na conversa X" pro navegador saber a hora certa de refazer aquele
-- fetch já existente, em vez de esperar o próximo poll. O engine (services/
-- engine) já recebe TODO evento message_created do Chatwoot via webhook
-- (/webhooks/chatwoot/:segredo, bridge.ts outboundDoChatwoot) — inclusive
-- pra mensagens que o próprio engine originou (WhatsApp inbound/outbound
-- mirrado pra lá), então um único ponto de emissão cobre as duas direções
-- sem precisar do engine falar diretamente com o Realtime em outro lugar.
-- ---------------------------------------------------------------------------

create table if not exists public.chat_atendimento_sinais (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id) on delete cascade,
  chatwoot_conversation_id integer not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_atendimento_sinais_parceiro_idx on public.chat_atendimento_sinais (agente_parceiro_id, created_at);
create index if not exists chat_atendimento_sinais_conversa_idx on public.chat_atendimento_sinais (chatwoot_conversation_id, created_at);

alter table public.chat_atendimento_sinais enable row level security;

-- Mesma técnica da migration 20260903010000 (Fase 1, Chat Interno): função
-- security definer pra não depender de RLS aberta em crm_usuarios (que
-- continua fechada — "tudo do CRM é servido via service role").
create or replace function app_private.crm_agente_parceiro_do_usuario()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select agente_parceiro_id from crm_usuarios where auth_user_id = auth.uid() and ativo = true limit 1;
$$;

revoke all on function app_private.crm_agente_parceiro_do_usuario() from public;
grant execute on function app_private.crm_agente_parceiro_do_usuario() to authenticated;

do $$ begin
  create policy chat_atendimento_sinais_select_parceiro on public.chat_atendimento_sinais
    for select to authenticated
    using (agente_parceiro_id = app_private.crm_agente_parceiro_do_usuario());
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_atendimento_sinais'
  ) then
    alter publication supabase_realtime add table public.chat_atendimento_sinais;
  end if;
end $$;

-- Sinal é só um "toque de campainha" (perde valor assim que o navegador
-- refaz o fetch) — cron horário evita crescimento sem limite.
create or replace function app_private.limpar_chat_atendimento_sinais()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.chat_atendimento_sinais where created_at < now() - interval '2 hours';
$$;
