-- Esteira de digitação de propostas — Fatia 1a (base da Fase 1 de Solicitações).
-- Spec: docs/SPEC-ESTEIRA-DIGITACAO-PROPOSTAS-2026-09-29.md §4.6, §4.7, §8.
-- Idempotente; sem SQL destrutivo. O CRM (fatia 1b) só usa o que está aqui.

-- ---------------------------------------------------------------------------
-- 1) Trava do "Responder" com expiração (hoje o CRM usa updated_at como trava)
-- ---------------------------------------------------------------------------
alter table public.crm_solicitacoes_operacionais
  add column if not exists trava_expira_em timestamptz null;

-- ---------------------------------------------------------------------------
-- 2) SLA e trava por tenant (editados pelo master do tenant; §4.7)
-- ---------------------------------------------------------------------------
alter table public.crm_parceiro_config
  add column if not exists sla_simulacao_min integer not null default 15 check (sla_simulacao_min > 0),
  add column if not exists sla_digitacao_min integer not null default 60 check (sla_digitacao_min > 0),
  add column if not exists trava_min integer not null default 10 check (trava_min between 2 and 120),
  add column if not exists dias_sem_atualizacao integer not null default 3 check (dias_sem_atualizacao between 1 and 90);

-- ---------------------------------------------------------------------------
-- 3) Notificações do CRM (§4.6). workspace_notifications aponta pra public.users
--    (só funcionários), por isso o usuário do CRM (crm_usuarios) ganha a sua.
--    Escrita só pelo servidor (service_role); o navegador do próprio usuário
--    lê via Realtime + policy por usuário.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_notificacoes (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  crm_usuario_id uuid not null references public.crm_usuarios (id) on delete cascade,
  modulo text not null check (modulo in ('digitacoes', 'solicitacoes')),
  tipo text not null,                 -- 'pendencia','status','comentario','simulacao_respondida','sla_estourado','sem_atualizacao',...
  entidade_tipo text not null check (entidade_tipo in ('proposta', 'solicitacao')),
  entidade_id uuid not null,
  titulo text not null,
  corpo text not null default '',
  href text not null default '',
  urgente boolean not null default false,   -- pendência → balão vermelho
  created_at timestamptz not null default now(),
  visto_em timestamptz null
);

create index if not exists crm_notificacoes_nao_vistas_idx
  on public.crm_notificacoes (crm_usuario_id, modulo) where visto_em is null;
-- marcarVisto(entidade_tipo, entidade_id) e limpeza de vistas há +30 dias (cron)
create index if not exists crm_notificacoes_entidade_idx
  on public.crm_notificacoes (crm_usuario_id, entidade_id) where visto_em is null;
create index if not exists crm_notificacoes_vistas_idx
  on public.crm_notificacoes (visto_em) where visto_em is not null;

alter table public.crm_notificacoes enable row level security;
revoke all on public.crm_notificacoes from public, anon, authenticated;
grant select, insert, update, delete on public.crm_notificacoes to service_role;
-- o navegador só lê (a policy abaixo restringe às linhas do próprio usuário);
-- marcar como vista continua passando pela server action.
grant select on public.crm_notificacoes to authenticated;

-- Mesmo molde de app_private.crm_agente_parceiro_do_usuario() (20260903020000):
-- security definer pra não abrir RLS em crm_usuarios.
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
  create policy crm_notificacoes_select_proprio on public.crm_notificacoes
    for select to authenticated
    using (crm_usuario_id = app_private.crm_usuario_do_auth());
exception when duplicate_object then null; end $$;

-- Realtime: a publicação só entrega o que a policy de select deixa ver.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_notificacoes'
  ) then
    alter publication supabase_realtime add table public.crm_notificacoes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Permissão nova do CRM: config.esteira (só Master) — §8
-- ---------------------------------------------------------------------------
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, 'config.esteira'
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave = 'master'
on conflict do nothing;

notify pgrst, 'reload schema';
