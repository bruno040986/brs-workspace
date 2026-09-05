-- =============================================================================
-- CRM AlvoConsig — Campanhas de VOZ (discadora) — 05/09/2026
-- Decisões Bruno × Opus 5.
--
-- São CINCO tipos, em dois grupos, e nenhum deles se mistura com campanha de
-- disparo de WhatsApp:
--
--   Terminam em ATENDENTE HUMANO (mesma tela sobreposta pros três):
--     • Discadora Automática        — atendeu, transfere
--     • IA de Voz para Atendente    — IA conversa, qualifica, transfere
--     • URA Reversa para Atendente  — gravação, cliente disca 1, transfere
--
--   Terminam em WHATSAPP:
--     • IA de Voz com WhatsApp
--     • URA Reversa com WhatsApp
--     Qualificou → mandamos UMA mensagem isolada. NÃO é disparo: sai pela
--     instância RECEPTIVA (lead quente que acabou de pedir contato), não passa
--     pela rotação de números nem pela regra 3+3, e a conversa nasce ORGÂNICA
--     — ou seja, aparece na fila do Atendimento na hora (ao contrário do
--     disparo frio, que fica escondido até o cliente responder; ver migration
--     20260903144646).
--
-- REGRA QUE VALE PROS CINCO: o dono do lead nasce no EVENTO, nunca na criação
-- da campanha. Nos três de atendente, no momento em que a ligação é conectada;
-- nos dois de WhatsApp, no momento em que o cliente qualificou. Atribuir na
-- criação encheria a carteira de todo mundo com lead que nunca vai se mexer —
-- a esmagadora maioria não atende nem qualifica.
--
-- O trabalho pesado (como discar, ritmo, retentativa) fica na discadora. Nós
-- só recebemos o evento e (a) abrimos a tela do atendente ou (b) definimos o
-- dono e mandamos a mensagem.
-- =============================================================================

-- 1. De-para atendente ↔ ramal/login na discadora ---------------------------
-- Sem isto não dá pra saber em qual tela abrir quando a ligação conecta.
alter table public.crm_usuarios
  add column if not exists ramal_discadora text null;

create unique index if not exists crm_usuarios_ramal_discadora_idx
  on public.crm_usuarios (agente_parceiro_id, ramal_discadora)
  where ramal_discadora is not null and ativo = true;

-- 2. Template isolado da campanha de voz→WhatsApp ---------------------------
-- Canal próprio de propósito: assim ele NUNCA entra no pool do disparo nem é
-- contado na regra 3+3, e mesmo assim reaproveita o editor de template que já
-- existe (variáveis, mídia, prévia).
alter table public.crm_templates_mensagem
  drop constraint if exists crm_templates_mensagem_canal_check;
alter table public.crm_templates_mensagem
  add constraint crm_templates_mensagem_canal_check
  check (canal in ('whatsapp_nao_oficial', 'whatsapp_oficial', 'sms_rcs', 'email', 'voz_whatsapp'));

-- 3. Eventos vindos da discadora --------------------------------------------
create table if not exists public.crm_chamadas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  campanha_id uuid null references public.crm_campanhas_parceiro (id) on delete set null,
  -- Atendente que RECEBEU a ligação (quem a discadora escolheu). É por este
  -- campo que o navegador dele assina o Realtime e a tela sobreposta abre.
  crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  telefone_e164 text not null,
  provedor text not null default 'callface',
  /** id da ligação na discadora — idempotência do webhook. */
  id_externo text null,
  /** 'atendente' = ligação conectada num humano; 'whatsapp' = qualificou e pediu contato. */
  desfecho text not null check (desfecho in ('atendente', 'whatsapp')),
  status text not null default 'conectada'
    check (status in ('conectada', 'tabulada', 'encerrada', 'perdida')),
  /** payload cru da discadora — auditoria e mapeamento de campos novos. */
  payload jsonb not null default '{}'::jsonb,
  atendida_em timestamptz null,
  encerrada_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_chamadas_atendente_idx
  on public.crm_chamadas (crm_usuario_id, created_at desc);
create index if not exists crm_chamadas_campanha_idx
  on public.crm_chamadas (campanha_id, created_at desc);
-- Webhook repetido não vira ligação duplicada (a discadora reenvia em falha).
create unique index if not exists crm_chamadas_externo_idx
  on public.crm_chamadas (provedor, id_externo) where id_externo is not null;

drop trigger if exists set_timestamp on public.crm_chamadas;
create trigger set_timestamp before update on public.crm_chamadas
  for each row execute function trigger_set_timestamp();

-- 4. RLS + Realtime ---------------------------------------------------------
-- Segunda tabela do CRM a abrir leitura direta pro papel `authenticated` (a
-- primeira foi crm_chat_mensagens, migration 20260903010000): o Realtime só
-- entrega a linha pro navegador se a policy de SELECT permitir. Escopo mínimo:
-- o atendente enxerga APENAS as ligações endereçadas a ele.
alter table public.crm_chamadas enable row level security;

create or replace function app_private.crm_usuario_do_auth()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from crm_usuarios where auth_user_id = auth.uid() and ativo = true limit 1;
$$;

revoke all on function app_private.crm_usuario_do_auth() from public;
grant execute on function app_private.crm_usuario_do_auth() to authenticated;

do $$ begin
  create policy crm_chamadas_select_propria on public.crm_chamadas
    for select to authenticated
    using (crm_usuario_id = app_private.crm_usuario_do_auth());
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_chamadas'
  ) then
    alter publication supabase_realtime add table public.crm_chamadas;
  end if;
end $$;
