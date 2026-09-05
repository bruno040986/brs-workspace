-- Solicitações de Atualização Cadastral (05/09/2026): parceiro já ativo pede
-- alteração de dados cadastrais ou bancários pela tela "Meus Dados" do Portal
-- Parceiro; time operacional aprova/reprova no Workspace antes de qualquer
-- alteração valer. Deliberadamente SEPARADA de corban_onboarding_* (Cadastros
-- Recebidos é outro processo — onboarding de parceiro novo, não mexer lá).

create table if not exists public.solicitacoes_atualizacao_cadastral (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  tipo text not null check (tipo in ('cadastral', 'bancario')),
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'reprovada')),
  -- Snapshot no momento do envio e valores propostos — mesmo shape pros dois:
  -- bancario = campos físicos de banco; cadastral = dot-path de corban_data
  -- (mesma convenção do wizard de cadastro).
  dados_atuais jsonb not null default '{}'::jsonb,
  dados_solicitados jsonb not null default '{}'::jsonb,
  justificativa text not null default '',
  documento_url text null, -- extrato bancário (só tipo='bancario'), bucket partner-analise
  motivo_reprovacao text null,
  revisado_por uuid null references public.users (id),
  revisado_em timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_solicitacoes_atualizacao_parceiro
  on public.solicitacoes_atualizacao_cadastral (agente_parceiro_id, created_at desc);
create index if not exists idx_solicitacoes_atualizacao_status
  on public.solicitacoes_atualizacao_cadastral (status, created_at desc);

alter table public.solicitacoes_atualizacao_cadastral enable row level security;

-- Portal Parceiro: o parceiro logado só enxerga (leitura) as próprias
-- solicitações — mesmo padrão de nuvidio_convites_select_parceiro. Toda
-- escrita (criação pelo portal, aprovação/reprovação pelo Workspace) passa
-- por service role, sem policy de INSERT/UPDATE.
drop policy if exists solicitacoes_atualizacao_select_parceiro on public.solicitacoes_atualizacao_cadastral;
create policy solicitacoes_atualizacao_select_parceiro on public.solicitacoes_atualizacao_cadastral
  for select to authenticated
  using (
    exists (
      select 1 from public.agentes_parceiros ap
      where ap.id = solicitacoes_atualizacao_cadastral.agente_parceiro_id
        and ap.auth_user_id = auth.uid()
    )
  );

-- Permissão nova pro time operacional revisar (âncora: quem já vê o Agente
-- Corban, mesmo molde do seed de agente-corban-cadastros-recebidos).
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'agente-corban-solicitacoes', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'agente-corban' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'agente-corban-solicitacoes', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'agente-corban' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
