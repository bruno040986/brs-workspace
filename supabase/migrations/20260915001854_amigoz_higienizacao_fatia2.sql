-- Amigoz — Fatia 2: "Higienização Amigoz" (Gestão de Leads), 15/09/2026.
--
-- Mapeamento de convênio BRS <-> convênio na IF (genérico por IF; começa
-- pelo Amigoz) + lotes/itens de higienização de margem (IF-agnóstico,
-- origem unitária/CSV/WeSales). Ver docs/ROTEIRO-AMIGOZ-FATIA-2-HIGIENIZACAO.md.
--
-- Mesmo padrão de segurança do `if_credito_config`/`if_credito_chamadas`
-- (migration 20260914202245): RLS habilitado, SEM policy — só o service
-- role (server actions/worker/cron) acessa; nenhum cliente do navegador lê
-- direto.

create table if not exists public.if_convenio_mapeamento (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null references public.financial_institutions(id),
  convenio_id uuid not null references public.convenios(id),
  convenio_externo_id text not null,        -- id do convênio na IF (ex.: "25" no Amigoz)
  convenio_externo_nome text,
  averbadora_externa integer,               -- código da averbadora na IF (Amigoz: 1 FACIL, 5 DATAPREV, ...)
  exige_matricula boolean not null default false,
  exige_senha_servidor boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instituicao_financeira_id, convenio_id)
);

create table if not exists public.if_higienizacao_lotes (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null references public.financial_institutions(id),
  convenio_id uuid references public.convenios(id),
  convenio_externo_id text not null,
  averbadora_externa integer,
  origem text not null check (origem in ('unitaria','csv','wesales')),
  status text not null default 'pendente' check (status in ('pendente','rodando','pausado','concluido','erro','cancelado')),
  total_itens integer not null default 0,
  itens_processados integer not null default 0,
  itens_com_margem integer not null default 0,
  itens_erro integer not null default 0,
  pausa_ms integer not null default 1500,
  filtro_wesales jsonb,                     -- origem='wesales': filtros usados na seleção
  arquivo_nome text,
  worker_lock_until timestamptz,
  worker_lock_by text,
  last_error text,
  criado_por uuid references public.users(id),
  created_at timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);

create table if not exists public.if_higienizacao_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.if_higienizacao_lotes(id) on delete cascade,
  ordem integer not null,
  cpf text not null,
  -- entrada (CSV/WeSales) — o que já vinha antes de consultar a IF
  nome text,
  telefone text,
  matricula text,
  senha_servidor_enc text,
  wesales_contact_id text,
  status text not null default 'pendente' check (status in ('pendente','processando','ok','sem_margem','erro')),
  tentativas integer not null default 0,
  erro text,
  -- resultado normalizado (pra planilha/WeSales sem reparsear o bruto)
  nome_if text,
  nascimento_if text,
  ocupacao_if text,
  matricula_if text,
  estavel boolean,
  margem_consignado numeric(12,2),      -- Cartão RMC (idProduto 15) — soma se vier dividido
  margem_beneficio_compra numeric(12,2),-- 30% (tipoMargem 1, idProduto 7)
  margem_beneficio_saque numeric(12,2), -- 70% (tipoMargem 2, idProduto 7)
  margem_beneficio numeric(12,2),       -- Cartão RCC = compra + saque (100%)
  margem_emprestimo numeric(12,2),      -- Novo Margem (emprestimos[], deduplicado)
  tem_oportunidade boolean,
  resposta_bruta jsonb,
  consultado_em timestamptz,
  nvti_enviado_em timestamptz,
  wesales_atualizado_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_if_hig_itens_lote_status on public.if_higienizacao_itens (lote_id, status, ordem);
create unique index if not exists uq_if_hig_itens_lote_cpf on public.if_higienizacao_itens (lote_id, cpf);
create index if not exists idx_if_hig_lotes_status on public.if_higienizacao_lotes (status, created_at);

alter table public.if_convenio_mapeamento enable row level security;
alter table public.if_higienizacao_lotes enable row level security;
alter table public.if_higienizacao_itens enable row level security;

-- ===========================================================================
-- Permissão nova (REGRA FIXA ponto 4) — alvoconsig-higienizacao-amigoz, seed
-- pra quem já tem sistema-usuarios-root (mesmo padrão da 20260905102132).
-- ===========================================================================
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('alvoconsig-higienizacao-amigoz')) as r(resource_name)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, false, false
from public.user_permissions up
cross join (values ('alvoconsig-higienizacao-amigoz')) as r(resource_name)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
