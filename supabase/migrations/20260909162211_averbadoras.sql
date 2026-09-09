-- Averbadoras + Tipos de Autenticação + vínculo no Convênio (09/09/2026).
--
-- Regras (Bruno, 09/09): um convênio tem vínculo com UMA averbadora; uma
-- averbadora atende N convênios (FK direta em `convenios`). O "site
-- averbador" é por convênio e NÃO é único: às vezes é subdomínio próprio
-- (formosa.neoconsig.com.br), às vezes a mesma URL é compartilhada por
-- vários convênios sem direcionamento por subdomínio — por isso texto livre,
-- sem unique. "Tipo de Autenticação" é cadastro de apoio (tipo + vigência em
-- horas), escolhido no vínculo do convênio, não na averbadora.
--
-- Permissão NOVA `workspace-averbadoras` (REGRA FIXA ponto 4 — seed p/ quem
-- tem sistema-usuarios-root), cobrindo /averbadoras e o submenu
-- /averbadoras/tipos-autenticacao, no mesmo desenho de Convênios ›
-- Esferas/Tipos (uma chave só pro subsistema). Substitui o placeholder
-- "Averbadoras (em breve)" da divisão Cadastros.

-- ===========================================================================
-- 1) Averbadoras
-- ===========================================================================
create table if not exists public.averbadoras (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null,                        -- 14 dígitos, sem máscara
  razao_social text not null default '',     -- vem do CNPJ.ws
  nome text not null,                        -- "Nome Averbadora" (manual)
  site_institucional text null,              -- URL normalizada (https://…)
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint averbadoras_cnpj_digitos check (cnpj ~ '^[0-9]{14}$')
);

create unique index if not exists averbadoras_cnpj_unique_idx
  on public.averbadoras (cnpj) where deleted_at is null;
create unique index if not exists averbadoras_nome_unique_idx
  on public.averbadoras ((lower(trim(nome)))) where deleted_at is null;

create trigger set_timestamp_averbadoras
  before update on public.averbadoras
  for each row execute function trigger_set_timestamp();

-- ===========================================================================
-- 2) Tipos de Autenticação (cadastro de apoio)
-- ===========================================================================
create table if not exists public.averbadora_tipos_autenticacao (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                        -- ex.: "Certificado digital", "Token SMS"
  vigencia_horas integer not null,           -- tempo de vigência da autenticação
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint averbadora_tipos_autenticacao_vigencia check (vigencia_horas > 0)
);

create unique index if not exists averbadora_tipos_autenticacao_tipo_unique_idx
  on public.averbadora_tipos_autenticacao ((lower(trim(tipo))));

create trigger set_timestamp_averbadora_tipos_autenticacao
  before update on public.averbadora_tipos_autenticacao
  for each row execute function trigger_set_timestamp();

-- ===========================================================================
-- 3) Vínculo no Convênio (1 averbadora por convênio; opcional)
-- ===========================================================================
alter table public.convenios
  add column if not exists averbadora_id uuid null references public.averbadoras (id),
  add column if not exists site_averbador text null,          -- URL específica OU compartilhada; sem unique
  add column if not exists tipo_autenticacao_id uuid null references public.averbadora_tipos_autenticacao (id);

create index if not exists idx_convenios_averbadora on public.convenios (averbadora_id);
create index if not exists idx_convenios_tipo_autenticacao on public.convenios (tipo_autenticacao_id);

-- ===========================================================================
-- 4) RLS — tudo passa pelo service role nas actions (padrão de convenio_*).
-- ===========================================================================
alter table public.averbadoras enable row level security;
alter table public.averbadora_tipos_autenticacao enable row level security;

-- ===========================================================================
-- 5) Permissão nova (seed p/ root) — REGRA FIXA ponto 4.
--   workspace-averbadoras → Cadastros › Averbadoras (+ Tipos de Autenticação)
-- ===========================================================================
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'workspace-averbadoras', true, true, true, false, true
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'workspace-averbadoras', true, true, true, false, true
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit, can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
