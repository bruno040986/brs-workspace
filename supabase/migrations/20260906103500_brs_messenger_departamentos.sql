-- BRS Messenger — Fase A (06/09/2026): departamentos e fila (paridade Digisac).
-- Spec: docs/SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md (§6, §10).
--
-- Fonte da verdade da FILIAÇÃO atendente↔departamento é o Chatwoot (Teams).
-- Esta tabela é o espelho que guarda o que o Chatwoot não guarda: ordem, a flag
-- de distribuição automática (opt-in — decisão do Bruno: padrão manual), qual
-- departamento recebe grupos automaticamente, e o vínculo users↔departamento
-- que dá a permissão por departamento no Workspace (filiação = permissão; sem
-- chave nova em SYSTEM_MODULES). Regras do BRS Messenger ≠ CRM (spec §0): nada
-- aqui toca papel/permite_grupos de chat_instancias.

-- ===========================================================================
-- 1) Departamentos (por conta do chat; a BRS é owner_tipo='brs')
-- ===========================================================================
create table if not exists public.chat_departamentos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  ativo boolean not null default true,
  chatwoot_team_id integer null,                        -- criado/sincronizado pela app (Teams)
  distribuicao_automatica boolean not null default false, -- opt-in; default manual
  eh_grupos boolean not null default false,             -- recebe conversas de grupo automaticamente
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conta_id, nome)
);
create unique index if not exists chat_departamentos_team_uidx
  on public.chat_departamentos (conta_id, chatwoot_team_id) where chatwoot_team_id is not null;
-- só um departamento "de grupos" por conta
create unique index if not exists chat_departamentos_grupos_uidx
  on public.chat_departamentos (conta_id) where eh_grupos;
create index if not exists chat_departamentos_conta_idx
  on public.chat_departamentos (conta_id, ativo, ordem);

-- ===========================================================================
-- 2) Membros (usuários do Workspace por departamento). O Chatwoot user id é
--    resolvido por e-mail na sincronização (users.email ↔ agente), como o
--    provisionamento de agentes já faz.
-- ===========================================================================
create table if not exists public.chat_departamento_membros (
  departamento_id uuid not null references public.chat_departamentos (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (departamento_id, user_id)
);
create index if not exists chat_departamento_membros_user_idx
  on public.chat_departamento_membros (user_id);

-- ===========================================================================
-- 3) Departamento padrão por conexão (Digisac: "Conexões" → departamento)
-- ===========================================================================
alter table public.chat_instancias
  add column if not exists departamento_id uuid null references public.chat_departamentos (id) on delete set null;
create index if not exists chat_instancias_departamento_idx
  on public.chat_instancias (departamento_id) where deleted_at is null;

-- ===========================================================================
-- 4) Seed dos 7 departamentos do Digisac na conta BRS (idempotente)
-- ===========================================================================
insert into public.chat_departamentos (conta_id, nome, ordem, eh_grupos)
select c.id, v.nome, v.ordem, v.eh_grupos
from public.chat_contas c
cross join (values
  ('Atendimento', 1, false),
  ('Suporte', 2, false),
  ('Comercial', 3, false),
  ('Administrativo e Financeiro', 4, false),
  ('Recursos Humanos', 5, false),
  ('Grupos', 6, true),
  ('Informes', 7, false)
) as v(nome, ordem, eh_grupos)
where c.owner_tipo = 'brs'
on conflict (conta_id, nome) do nothing;

-- ===========================================================================
-- 5) RLS server-only (actions com service role; permissões `conversas` /
--    `central-conversas` / `conversas-agora` na app). Sem policy + revoke.
-- ===========================================================================
alter table public.chat_departamentos enable row level security;
alter table public.chat_departamento_membros enable row level security;
revoke all on public.chat_departamentos, public.chat_departamento_membros from public, anon, authenticated;
grant select, insert, update, delete on public.chat_departamentos, public.chat_departamento_membros to service_role;

-- ===========================================================================
-- 6) Permissão nova: conversas-agora (painel "Agora" — supervisão em tempo
--    real; decisão 06/09: obedece perfis/usuários). Seed p/ quem tem
--    central-conversas (supervisores) e p/ root. REGRA FIXA ponto 4.
-- ===========================================================================
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'conversas-agora', true, false, false, false, false
from public.profile_permissions pp
where pp.resource_name in ('central-conversas', 'sistema-usuarios-root') and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update set can_view = excluded.can_view;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'conversas-agora', true, false, false, false, false
from public.user_permissions up
where up.resource_name in ('central-conversas', 'sistema-usuarios-root') and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update set can_view = excluded.can_view;

notify pgrst, 'reload schema';
