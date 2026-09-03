-- Integração Nuvidio (aprovada 03/09/2026): confirmação de propostas por
-- vídeo + etapa Nuvidio dos Cadastros Recebidos numa engine só.
-- "Uma engine, duas lentes": nuvidio_convites.origem = 'proposta' (cotidiano
-- da equipe, subsistema Operacional › Nuvidio) ou 'onboarding' (vinculado a
-- corban_onboarding_processos). O Portal Parceiro lê os convites do próprio
-- parceiro via RLS (auth_user_id) — inclusive por Realtime.

-- ---------------------------------------------------------------------------
-- Config (credenciais no cofre AES — mesmo padrão dos demais provedores)
-- ---------------------------------------------------------------------------
create table if not exists public.nuvidio_config (
  id integer primary key default 1 check (id = 1),
  api_key_enc text,
  api_secret_enc text,
  department_padrao_id text not null default '',
  department_padrao_nome text not null default '',
  -- segredo que a Nuvidio manda de volta na URL do webhook (?key=...)
  webhook_key text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);

-- ---------------------------------------------------------------------------
-- Convites (a engine)
-- ---------------------------------------------------------------------------
create table if not exists public.nuvidio_convites (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'proposta' check (origem in ('proposta', 'onboarding')),
  processo_id uuid null references public.corban_onboarding_processos (id) on delete set null,

  -- lado Nuvidio
  invite_id text not null default '',
  link text not null default '',
  department_id text not null default '',
  department_nome text not null default '',
  expiration_at timestamptz null,
  schedule_at timestamptz null,

  -- lado negócio (seletores dos cadastros reais — nunca texto livre)
  instituicao_financeira_id uuid null references public.financial_institutions (id),
  forma_contrato_id uuid null references public.formas_contrato (id),
  convenio_id uuid null references public.convenios (id),
  cpf text not null default '',
  nome_cliente text not null default '',
  telefone_cliente text not null default '',
  email_cliente text not null default '',
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  proposta_numero text not null default '',
  proposta_valor numeric null,

  status text not null default 'aguardando_chamada'
    check (status in ('aguardando_chamada', 'chamada_em_curso', 'chamada_realizada', 'aprovado', 'reprovado', 'aguardando_refazer', 'cancelado', 'expirado')),
  gravacao_url text not null default '',
  resultado_obs text not null default '',
  refeito_de uuid null references public.nuvidio_convites (id),

  chamada_iniciada_em timestamptz null,
  chamada_finalizada_em timestamptz null,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_nuvidio_convites_status on public.nuvidio_convites (status, created_at desc);
create index if not exists idx_nuvidio_convites_parceiro on public.nuvidio_convites (agente_parceiro_id, created_at desc);
create index if not exists idx_nuvidio_convites_processo on public.nuvidio_convites (processo_id);
create index if not exists idx_nuvidio_convites_invite on public.nuvidio_convites (invite_id);

-- ---------------------------------------------------------------------------
-- Templates de envio (WhatsApp/e-mail × parceiro/cliente)
-- ---------------------------------------------------------------------------
create table if not exists public.nuvidio_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  canal text not null check (canal in ('whatsapp', 'email')),
  destino text not null check (destino in ('parceiro', 'cliente')),
  assunto text not null default '',
  corpo text not null default '',
  instancia_zapi_id uuid null references public.zapi_instances (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nuvidio_eventos (
  id uuid primary key default gen_random_uuid(),
  convite_id uuid not null references public.nuvidio_convites (id) on delete cascade,
  tipo text not null,
  detalhe jsonb not null default '{}'::jsonb,
  actor_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_nuvidio_eventos_convite on public.nuvidio_eventos (convite_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.nuvidio_config enable row level security;
alter table public.nuvidio_convites enable row level security;
alter table public.nuvidio_templates enable row level security;
alter table public.nuvidio_eventos enable row level security;

-- Portal Parceiro: o parceiro logado enxerga (só leitura) os próprios
-- convites — alimenta o menu "Confirmação de Propostas" e o Realtime.
drop policy if exists nuvidio_convites_select_parceiro on public.nuvidio_convites;
create policy nuvidio_convites_select_parceiro on public.nuvidio_convites
  for select to authenticated
  using (
    agente_parceiro_id is not null
    and exists (
      select 1 from public.agentes_parceiros ap
      where ap.id = nuvidio_convites.agente_parceiro_id
        and ap.auth_user_id = auth.uid()
    )
  );

-- Realtime para o portal (status ao vivo)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nuvidio_convites'
    ) then
      alter publication supabase_realtime add table public.nuvidio_convites;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões (REGRA FIXA): operacional-nuvidio-links (criar/acompanhar),
-- operacional-nuvidio-atendimento (tela de atendimento) e
-- sistema-config-nuvidio (card de credenciais) — seed p/ root.
-- ---------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('operacional-nuvidio-links'), ('operacional-nuvidio-atendimento'), ('sistema-config-nuvidio')) as r(resource_name)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, false, false
from public.user_permissions up
cross join (values ('operacional-nuvidio-links'), ('operacional-nuvidio-atendimento'), ('sistema-config-nuvidio')) as r(resource_name)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
