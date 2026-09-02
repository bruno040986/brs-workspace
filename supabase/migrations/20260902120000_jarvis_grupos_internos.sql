-- Novo layout do Workspace — backend (aprovado 02/09/2026):
-- 1) Grupos Internos do BRS Messenger: generaliza o kind 'equipe' para
--    'grupo' com nome próprio e membros gerenciados na Central de Atendimento.
-- 2) Jarvis (IA do Workspace): config central com credencial cifrada no
--    cofre (linha única), conversas e mensagens por usuário.
-- 3) Permissões novas: workspace-ia (usar o chat) e sistema-config-ia
--    (configurar credencial/personalidade).

-- ---------------------------------------------------------------------------
-- 1) Grupos Internos
-- ---------------------------------------------------------------------------
alter table public.workspace_chat_conversations
  add column if not exists name text,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_wcc_kind on public.workspace_chat_conversations (kind);

-- ---------------------------------------------------------------------------
-- 2) Jarvis — IA do Workspace
-- ---------------------------------------------------------------------------
create table if not exists public.ia_config (
  id integer primary key default 1 check (id = 1),
  provider text not null default 'openrouter',
  api_key_enc text,
  modelos jsonb not null default '[]'::jsonb,
  personalidade jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);

create table if not exists public.ia_conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  titulo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ia_conversas_user on public.ia_conversas (user_id, updated_at desc);

create table if not exists public.ia_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.ia_conversas (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  modelo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ia_mensagens_conversa on public.ia_mensagens (conversa_id, created_at);

-- Sem policy nenhuma de propósito: a credencial e as conversas só passam pelo
-- servidor (admin client). RLS ligada = anon/authenticated não leem nada.
alter table public.ia_config enable row level security;
alter table public.ia_conversas enable row level security;
alter table public.ia_mensagens enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Permissões
-- ---------------------------------------------------------------------------
-- workspace-ia: usar o Jarvis — seedada pra quem já tem 'conversas'
-- (o chat interno), porque o Jarvis é um colega de equipe no Messenger.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'workspace-ia', true, false, false, false, false
from public.profile_permissions pp
where pp.resource_name = 'conversas' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'workspace-ia', true, false, false, false, false
from public.user_permissions up
where up.resource_name = 'conversas' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view;

-- sistema-config-ia: configurar o card IA do Workspace — só root, como as
-- demais configurações de sistema.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'sistema-config-ia', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'sistema-config-ia', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
