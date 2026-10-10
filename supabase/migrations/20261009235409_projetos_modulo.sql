-- Módulo Projetos (Divisão Tecnologia): projetos com IAs participantes via MCP,
-- tarefas, linha do tempo de mensagens e commits do GitHub (webhook).
-- Tudo acessado por service role (server actions, rota MCP e webhook):
-- RLS ligada SEM policy + revoke de anon/authenticated.

create table if not exists public.projeto_agentes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  token_hash text null,            -- sha256 hex do token MCP do agente
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists projeto_agentes_token_hash_uidx on public.projeto_agentes (token_hash) where token_hash is not null;

insert into public.projeto_agentes (slug, nome) values
  ('claude-code', 'Claude Code'),
  ('claude', 'Claude'),
  ('jarvis', 'Jarvis (ChatGPT)'),
  ('codex', 'Codex'),
  ('gemini-antigravity', 'Gemini (Antigravity)'),
  ('gemini-notebooklm', 'Gemini (NotebookLM)')
on conflict (slug) do nothing;

create table if not exists public.projetos (
  id uuid primary key default gen_random_uuid(),
  numero serial unique,            -- código exibido = PRJ-<numero>
  titulo text not null,
  objetivo text not null,
  ideia_principal text not null,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'escrita_tecnica', 'brainstorm', 'planejamento', 'execucao', 'concluido', 'arquivado')),
  redator_agente_id uuid null references public.projeto_agentes (id),
  escrita_tecnica text null,
  criado_por uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.projeto_participantes (
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  agente_id uuid not null references public.projeto_agentes (id),
  primary key (projeto_id, agente_id)
);

create table if not exists public.projeto_tarefas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  numero integer not null,         -- sequencial por projeto (T-<numero>)
  titulo text not null,
  descricao text not null default '',
  status text not null default 'pendente'
    check (status in ('pendente', 'em_andamento', 'bloqueado', 'em_revisao', 'concluido')),
  prioridade text not null default 'media' check (prioridade in ('baixa', 'media', 'alta')),
  prazo date null,
  responsavel_agente_id uuid null references public.projeto_agentes (id),
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  concluida_em timestamptz null,
  unique (projeto_id, numero)
);

create table if not exists public.projeto_mensagens (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  tarefa_id uuid null references public.projeto_tarefas (id) on delete cascade,
  autor_usuario_id uuid null references public.users (id),
  autor_agente_id uuid null references public.projeto_agentes (id),
  tipo text not null
    check (tipo in ('mensagem', 'contribuicao', 'decisao', 'registro_direto', 'status', 'escrita_tecnica')),
  conteudo text not null,
  meta jsonb null,
  created_at timestamptz not null default now(),
  constraint projeto_mensagens_um_autor check ((autor_usuario_id is null) <> (autor_agente_id is null))
);
create index if not exists projeto_mensagens_projeto_created_idx on public.projeto_mensagens (projeto_id, created_at);

create table if not exists public.projeto_commits (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid null references public.projetos (id) on delete set null,
  tarefa_id uuid null references public.projeto_tarefas (id) on delete set null,
  repo text not null,              -- ex.: owner/repo
  sha text not null,
  mensagem text null,
  autor text null,
  url text null,
  branch text null,
  commit_em timestamptz null,
  created_at timestamptz not null default now(),
  unique (repo, sha)
);
create index if not exists projeto_commits_projeto_idx on public.projeto_commits (projeto_id, commit_em desc);

-- updated_at automático
drop trigger if exists set_timestamp_projetos on public.projetos;
create trigger set_timestamp_projetos before update on public.projetos
  for each row execute function trigger_set_timestamp();
drop trigger if exists set_timestamp_projeto_tarefas on public.projeto_tarefas;
create trigger set_timestamp_projeto_tarefas before update on public.projeto_tarefas
  for each row execute function trigger_set_timestamp();

-- Só service role
alter table public.projeto_agentes enable row level security;
alter table public.projetos enable row level security;
alter table public.projeto_participantes enable row level security;
alter table public.projeto_tarefas enable row level security;
alter table public.projeto_mensagens enable row level security;
alter table public.projeto_commits enable row level security;
revoke all on public.projeto_agentes from anon, authenticated;
revoke all on public.projetos from anon, authenticated;
revoke all on public.projeto_participantes from anon, authenticated;
revoke all on public.projeto_tarefas from anon, authenticated;
revoke all on public.projeto_mensagens from anon, authenticated;
revoke all on public.projeto_commits from anon, authenticated;
revoke all on sequence public.projetos_numero_seq from anon, authenticated;

-- Permissão nova (seed p/ root) — REGRA FIXA ponto 4.
--   projetos → menu Tecnologia › Projetos
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'projetos', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'projetos', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
