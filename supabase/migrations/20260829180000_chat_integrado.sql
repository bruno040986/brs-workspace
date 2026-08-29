-- =============================================================================
-- Chat Integrado (Workspace "Central de Conversas" + CRM AlvoConsig).
-- Motor = Chatwoot self-hosted (Railway); WhatsApp não oficial (Baileys) e
-- Z-API entram pelo serviço `engine` (brs-alvoconsig/services/engine).
-- Decisões (Bruno × Fable, 29/08/2026):
--   - instância `receptiva` aceita grupos; `disparo` NUNCA (conversas
--     individuais entram no chat normalmente, só grupo fica de fora);
--   - BRS tem até 3 instâncias por QR + número oficial 360dialog (nativo do
--     Chatwoot); parceiro tem receptiva (Baileys e/ou Z-API) + 10 de disparo;
--   - uma instalação de Chatwoot, UMA conta por dono (BRS / cada parceiro).
-- Segredos (sessão Baileys, credencial Z-API, token da conta Chatwoot) são
-- cifrados na aplicação (mesma chave do cofre do CRM). Sem policy de leitura:
-- só service role (Workspace/CRM por server action; engine direto).
-- =============================================================================

create table if not exists public.chat_contas (
  id uuid primary key default gen_random_uuid(),
  owner_tipo text not null check (owner_tipo in ('brs', 'parceiro')),
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  nome text not null,
  chatwoot_account_id integer not null unique,
  -- token de acesso à API da conta (agente-bot/admin), cifrado
  token_cifrado text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_contas_owner_coerente check (
    (owner_tipo = 'brs' and agente_parceiro_id is null) or (owner_tipo = 'parceiro' and agente_parceiro_id is not null)
  )
);
create unique index if not exists chat_contas_brs_uidx on public.chat_contas ((owner_tipo)) where owner_tipo = 'brs';
create unique index if not exists chat_contas_parceiro_uidx on public.chat_contas (agente_parceiro_id) where agente_parceiro_id is not null;
drop trigger if exists set_timestamp on public.chat_contas;
create trigger set_timestamp before update on public.chat_contas for each row execute function trigger_set_timestamp();

create table if not exists public.chat_instancias (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  owner_tipo text not null check (owner_tipo in ('brs', 'parceiro')),
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  nome text not null,
  papel text not null check (papel in ('receptiva', 'disparo')),
  provedor text not null check (provedor in ('baileys', 'zapi')),
  -- regra fixa: disparo nunca tem grupo
  permite_grupos boolean not null default false,
  status text not null default 'desconectada'
    check (status in ('desconectada', 'aguardando_qr', 'conectando', 'conectada', 'erro')),
  numero text null,
  nome_perfil text null,
  -- Z-API: {instanceId, token, clientToken}; cifrado
  credencial_cifrada text null,
  -- Baileys: creds + keys (BufferJSON); cifrado
  sessao_cifrada text null,
  ultimo_qr text null,
  qr_atualizado_em timestamptz null,
  ultimo_erro text null,
  conectada_em timestamptz null,
  chatwoot_inbox_id integer null,
  chatwoot_inbox_identifier text null,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint chat_instancias_disparo_sem_grupo check (papel <> 'disparo' or permite_grupos = false)
);
create index if not exists chat_instancias_conta_idx on public.chat_instancias (conta_id, papel, ordem) where deleted_at is null;
create index if not exists chat_instancias_inbox_idx on public.chat_instancias (chatwoot_inbox_id) where deleted_at is null;
drop trigger if exists set_timestamp on public.chat_instancias;
create trigger set_timestamp before update on public.chat_instancias for each row execute function trigger_set_timestamp();

-- Mapa jid (WhatsApp) ↔ conversa/contato do Chatwoot, por instância.
create table if not exists public.chat_conversas (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  jid text not null,
  eh_grupo boolean not null default false,
  nome text null,
  chatwoot_contact_id integer not null,
  chatwoot_source_id text null,
  chatwoot_conversation_id integer not null,
  ultima_mensagem_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instancia_id, jid)
);
create index if not exists chat_conversas_chatwoot_idx on public.chat_conversas (chatwoot_conversation_id);
drop trigger if exists set_timestamp on public.chat_conversas;
create trigger set_timestamp before update on public.chat_conversas for each row execute function trigger_set_timestamp();

-- Eventos pra tempo real na UI (sino/dock) — Supabase Realtime.
create table if not exists public.chat_eventos (
  id bigserial primary key,
  chatwoot_account_id integer not null,
  tipo text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_eventos_conta_idx on public.chat_eventos (chatwoot_account_id, id desc);
do $$
begin
  alter publication supabase_realtime add table public.chat_eventos;
exception when duplicate_object then null;
end $$;

-- RLS: segredos só via service role; eventos legíveis por quem tem 'conversas'.
do $$
declare t text;
begin
  t := app_private.enable_rls_if_exists('chat_contas');
  t := app_private.enable_rls_if_exists('chat_instancias');
  t := app_private.enable_rls_if_exists('chat_conversas');
  t := app_private.enable_rls_if_exists('chat_eventos');
  perform app_private.apply_policy(t, 'chat_eventos_select_permitted', 'SELECT', 'app_private.has_permission(''conversas'', ''can_view'')');
end $$;

-- Permissões: 'central-conversas' (configurar instâncias/canais) e
-- 'conversas' (atender) — seedadas pra quem é root, como as demais do Portal Tecnologia.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('central-conversas'), ('conversas')) as r(resource_name)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, false, false
from public.user_permissions up
cross join (values ('central-conversas'), ('conversas')) as r(resource_name)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;
