-- Folha de Pagamento — Etapa 1 (03/09/2026): configuração que o Quark não
-- fornece e que a folha precisa. Faixas INSS/IR versionadas por vigência
-- (mudam por lei) e parâmetros por competência mensal (espelham a aba DADOS
-- da planilha de fechamento). Sincronização de colaboradores usa a `employees`
-- que já existe (upsert por CPF). O motor de cálculo e o ciclo de folha são
-- Etapa 2.

-- Tabela progressiva do INSS (por vigência)
create table if not exists public.folha_inss_faixas (
  id uuid primary key default gen_random_uuid(),
  vigencia_inicio date not null,
  ordem integer not null,
  limite_ate numeric not null,       -- teto da faixa (o último é o teto do INSS)
  aliquota numeric not null,          -- % (ex.: 7.5, 9, 12, 14)
  created_at timestamptz not null default now(),
  unique (vigencia_inicio, ordem)
);

-- Tabela do IRRF (por vigência) + deduções
create table if not exists public.folha_irrf_faixas (
  id uuid primary key default gen_random_uuid(),
  vigencia_inicio date not null,
  ordem integer not null,
  base_ate numeric not null,          -- teto da faixa (última faixa = infinito, usar valor alto)
  aliquota numeric not null,          -- %
  parcela_deduzir numeric not null,   -- R$
  created_at timestamptz not null default now(),
  unique (vigencia_inicio, ordem)
);

create table if not exists public.folha_irrf_parametros (
  id uuid primary key default gen_random_uuid(),
  vigencia_inicio date not null unique,
  deducao_por_dependente numeric not null default 0,
  desconto_simplificado numeric not null default 0,  -- desconto simplificado mensal
  created_at timestamptz not null default now()
);

-- Parâmetros por competência mensal (aba DADOS)
create table if not exists public.folha_parametros_competencia (
  id uuid primary key default gen_random_uuid(),
  competencia text not null unique,   -- 'YYYY-MM'
  dias_calculo_salario integer not null default 30,
  dias_uteis_mes integer not null default 22,
  dias_beneficios integer not null default 22,
  taxa_va_vr numeric not null default 0,
  taxa_vt numeric not null default 0,
  taxa_vc numeric not null default 0,
  taxa_pds numeric not null default 0,
  taxa_adm numeric not null default 0,
  data_venc_salario date null,
  data_comp_salario date null,
  data_venc_fgts date null,
  observacao text not null default '',
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Log das sincronizações com o Quark
create table if not exists public.folha_sync_logs (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'quark_colaboradores',
  total_recebidos integer not null default 0,
  criados integer not null default 0,
  atualizados integer not null default 0,
  ignorados integer not null default 0,
  erros integer not null default 0,
  detalhe jsonb not null default '{}'::jsonb,
  actor_id uuid null references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_folha_inss_vig on public.folha_inss_faixas (vigencia_inicio desc, ordem);
create index if not exists idx_folha_irrf_vig on public.folha_irrf_faixas (vigencia_inicio desc, ordem);
create index if not exists idx_folha_param_comp on public.folha_parametros_competencia (competencia desc);
create index if not exists idx_folha_sync_data on public.folha_sync_logs (created_at desc);

-- Sem policy: tudo passa pelo servidor (admin client) via actions com
-- permissão rh-folha / rh-quark-sync.
alter table public.folha_inss_faixas enable row level security;
alter table public.folha_irrf_faixas enable row level security;
alter table public.folha_irrf_parametros enable row level security;
alter table public.folha_parametros_competencia enable row level security;
alter table public.folha_sync_logs enable row level security;

-- Permissões: rh-quark-sync (sincronização) e rh-folha (folha + configs) —
-- seed p/ quem já tem rh-painel (gestor de RH).
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('rh-quark-sync'), ('rh-folha')) as r(resource_name)
where pp.resource_name = 'rh-painel' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, false, false
from public.user_permissions up
cross join (values ('rh-quark-sync'), ('rh-folha')) as r(resource_name)
where up.resource_name = 'rh-painel' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

-- Seed também p/ root (garante acesso do Bruno mesmo sem rh-painel)
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('rh-quark-sync'), ('rh-folha')) as r(resource_name)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, false, false
from public.user_permissions up
cross join (values ('rh-quark-sync'), ('rh-folha')) as r(resource_name)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
