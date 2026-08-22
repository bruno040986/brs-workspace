-- =============================================================================
-- AlvoConsig — Fase 1
-- Cadastros de crédito (convênios, tabelas, coeficientes) + tabelas do CRM.
-- Cadastros servem TODO o ecossistema (CRM, futura Base de Conhecimento,
-- plataforma de APIs de bancos). Tabelas crm_* servem o app brs-alvoconsig
-- (acesso server-side via service role) e o módulo "AlvoConsig — Gestão de
-- Leads" do workspace (RLS por permissão).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Convênios (semente da futura Base de Conhecimento de Convênios)
-- -----------------------------------------------------------------------------
create table if not exists public.convenios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo text null,
  esfera text not null default 'outro'
    check (esfera in ('municipal', 'estadual', 'federal', 'inss', 'outro')),
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists convenios_nome_unique_idx
  on public.convenios ((lower(trim(nome)))) where deleted_at is null;
create unique index if not exists convenios_codigo_unique_idx
  on public.convenios (codigo) where codigo is not null and deleted_at is null;

create trigger set_timestamp_convenios
  before update on public.convenios
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- 2. Tabelas de crédito (por instituição financeira + produto)
-- -----------------------------------------------------------------------------
create table if not exists public.tabelas_credito (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.financial_institutions (id),
  produto text not null
    check (produto in ('novo', 'refin', 'cartao_rmc', 'cartao_rcc')),
  nome text not null,
  codigo text null,
  com_seguro boolean not null default false,
  prazos integer[] not null default '{}',
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tabelas_credito_institution_idx
  on public.tabelas_credito (institution_id) where deleted_at is null;
create index if not exists tabelas_credito_produto_idx
  on public.tabelas_credito (produto) where deleted_at is null;

create trigger set_timestamp_tabelas_credito
  before update on public.tabelas_credito
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- 3. Coeficientes (tabela × convênio × prazo, com vigência; histórico preservado)
--    oferta = margem × coeficiente (valor liberado por unidade de margem)
-- -----------------------------------------------------------------------------
create table if not exists public.coeficientes (
  id uuid primary key default gen_random_uuid(),
  tabela_id uuid not null references public.tabelas_credito (id) on delete cascade,
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  prazo integer not null check (prazo > 0),
  coeficiente numeric(14, 8) not null check (coeficiente > 0),
  vigencia_inicio date not null default current_date,
  vigencia_fim date null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint coeficientes_vigencia_valida
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

create unique index if not exists coeficientes_chave_vigencia_idx
  on public.coeficientes (tabela_id, convenio_id, prazo, vigencia_inicio);
create index if not exists coeficientes_convenio_idx
  on public.coeficientes (convenio_id);

-- -----------------------------------------------------------------------------
-- 4. Config AlvoConsig por parceiro (aba "AlvoConsig" no editor do Agente Corban)
--    habilitado => card do CRM aparece no Portal Parceiro; master pode criar
--    atendentes no CRM.
-- -----------------------------------------------------------------------------
create table if not exists public.crm_parceiro_config (
  agente_parceiro_id uuid primary key references public.agentes_parceiros (id) on delete cascade,
  habilitado boolean not null default false,
  max_atendentes integer not null default 10 check (max_atendentes >= 0),
  permissoes jsonb not null default '{}'::jsonb,
  habilitado_por uuid null,
  habilitado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_timestamp_crm_parceiro_config
  before update on public.crm_parceiro_config
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- 5. Usuários do CRM (masters espelhados + atendentes criados pelo master)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null unique,
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  papel text not null default 'atendente' check (papel in ('master', 'atendente')),
  nome text not null,
  email text not null,
  ativo boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_usuarios_parceiro_idx
  on public.crm_usuarios (agente_parceiro_id);
create unique index if not exists crm_usuarios_email_por_parceiro_idx
  on public.crm_usuarios (agente_parceiro_id, (lower(trim(email))));

create trigger set_timestamp_crm_usuarios
  before update on public.crm_usuarios
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- 6. Importações de mailing (REFIN pré-calculado e margens) c/ mapeamento
--    configurável de colunas
-- -----------------------------------------------------------------------------
create table if not exists public.crm_imports (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('refin', 'margem')),
  arquivo_nome text not null,
  mapeamento jsonb not null default '{}'::jsonb,
  convenio_id uuid null references public.convenios (id),
  total_linhas integer not null default 0,
  importadas integer not null default 0,
  descartadas integer not null default 0,
  status text not null default 'processando'
    check (status in ('processando', 'concluido', 'erro')),
  erro text null,
  criado_por uuid null,
  created_at timestamptz not null default now(),
  concluido_em timestamptz null
);

-- -----------------------------------------------------------------------------
-- 7. Lotes de alocação (liberação de contatos a um parceiro; dono mutável)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_lotes_alocacao (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  descricao text not null default '',
  filtros jsonb not null default '{}'::jsonb,
  qtd_contatos integer not null default 0,
  liberado_por uuid null,
  liberado_em timestamptz not null default now(),
  revogado_em timestamptz null,
  revogado_por uuid null,
  observacao text null
);

create index if not exists crm_lotes_parceiro_idx
  on public.crm_lotes_alocacao (agente_parceiro_id);

-- -----------------------------------------------------------------------------
-- 8. Contatos (espelho local do WeSales; identidade = CPF/telefone;
--    dono atual no nível do contato)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_contatos (
  id uuid primary key default gen_random_uuid(),
  wesales_contact_id text null unique,
  cpf text null,
  telefone text null,
  nome text not null default '',
  convenio_id uuid null references public.convenios (id),
  codigo_empregador text null,
  matricula text null,
  -- dono atual (mutável; histórico permanece no WeSales e em crm_tabulacoes)
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  atendente_id uuid null references public.crm_usuarios (id),
  lote_id uuid null references public.crm_lotes_alocacao (id),
  -- margens (empréstimo novo + cartões; atualizadas por importação)
  margem_novo numeric(12, 2) null,
  margem_cartao_rmc numeric(12, 2) null,
  margem_cartao_rcc numeric(12, 2) null,
  margens_atualizadas_em timestamptz null,
  -- REFIN pré-calculado no mailing (só entram linhas com troco > 0)
  refin_troco numeric(12, 2) null,
  refin jsonb null,
  -- funil (cache do estágio no WeSales)
  funil_estagio text null,
  funil_atualizado_em timestamptz null,
  import_id uuid null references public.crm_imports (id),
  dados jsonb not null default '{}'::jsonb,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_contatos_cpf_idx on public.crm_contatos (cpf);
create index if not exists crm_contatos_telefone_idx on public.crm_contatos (telefone);
create index if not exists crm_contatos_dono_idx
  on public.crm_contatos (agente_parceiro_id, atendente_id) where deleted_at is null;
create index if not exists crm_contatos_convenio_idx
  on public.crm_contatos (convenio_id) where deleted_at is null;
create index if not exists crm_contatos_estagio_idx
  on public.crm_contatos (funil_estagio) where deleted_at is null;

create trigger set_timestamp_crm_contatos
  before update on public.crm_contatos
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- 9. Tabulações e notas (autor obrigatório; leitura do parceiro sempre
--    filtrada pelo próprio autor/parceiro na camada de aplicação)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_tabulacoes (
  id uuid primary key default gen_random_uuid(),
  contato_id uuid not null references public.crm_contatos (id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('tabulacao', 'nota', 'estagio')),
  autor_tipo text not null
    check (autor_tipo in ('master', 'atendente', 'venda_propria', 'sistema')),
  autor_crm_usuario_id uuid null references public.crm_usuarios (id),
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  conteudo text not null default '',
  estagio_de text null,
  estagio_para text null,
  created_at timestamptz not null default now()
);

create index if not exists crm_tabulacoes_contato_idx
  on public.crm_tabulacoes (contato_id, created_at desc);
create index if not exists crm_tabulacoes_parceiro_idx
  on public.crm_tabulacoes (agente_parceiro_id);

-- -----------------------------------------------------------------------------
-- 10. Fila de escrita para o WeSales (rate limit + retry/backoff)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_wesales_queue (
  id uuid primary key default gen_random_uuid(),
  operacao text not null,
  contato_id uuid null references public.crm_contatos (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'concluido', 'erro', 'descartado')),
  tentativas integer not null default 0,
  proximo_retry_em timestamptz not null default now(),
  ultimo_erro text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_wesales_queue_pendentes_idx
  on public.crm_wesales_queue (status, proximo_retry_em)
  where status in ('pendente', 'erro');

create trigger set_timestamp_crm_wesales_queue
  before update on public.crm_wesales_queue
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- RLS (padrão do projeto). Workspace lê/escreve via permissões:
--   sistema-config-credito -> cadastros (convênios, tabelas, coeficientes)
--   alvoconsig-gestao      -> módulo "AlvoConsig — Gestão de Leads"
-- O app brs-alvoconsig acessa server-side via service role (bypassa RLS),
-- com filtro obrigatório por dono/autor na camada de aplicação.
-- -----------------------------------------------------------------------------
do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('convenios');
  perform app_private.apply_policy(t, 'convenios_select_permitted', 'SELECT', 'app_private.has_permission(''sistema-config-credito'', ''can_view'')');
  perform app_private.apply_policy(t, 'convenios_insert_permitted', 'INSERT', null, 'app_private.has_permission(''sistema-config-credito'', ''can_include'')');
  perform app_private.apply_policy(t, 'convenios_update_permitted', 'UPDATE',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')');
  perform app_private.apply_policy(t, 'convenios_delete_permitted', 'DELETE', 'app_private.has_permission(''sistema-config-credito'', ''can_delete'')');

  t := app_private.enable_rls_if_exists('tabelas_credito');
  perform app_private.apply_policy(t, 'tabelas_credito_select_permitted', 'SELECT', 'app_private.has_permission(''sistema-config-credito'', ''can_view'')');
  perform app_private.apply_policy(t, 'tabelas_credito_insert_permitted', 'INSERT', null, 'app_private.has_permission(''sistema-config-credito'', ''can_include'')');
  perform app_private.apply_policy(t, 'tabelas_credito_update_permitted', 'UPDATE',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')');
  perform app_private.apply_policy(t, 'tabelas_credito_delete_permitted', 'DELETE', 'app_private.has_permission(''sistema-config-credito'', ''can_delete'')');

  t := app_private.enable_rls_if_exists('coeficientes');
  perform app_private.apply_policy(t, 'coeficientes_select_permitted', 'SELECT', 'app_private.has_permission(''sistema-config-credito'', ''can_view'')');
  perform app_private.apply_policy(t, 'coeficientes_insert_permitted', 'INSERT', null, 'app_private.has_permission(''sistema-config-credito'', ''can_include'')');
  perform app_private.apply_policy(t, 'coeficientes_update_permitted', 'UPDATE',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')');
  perform app_private.apply_policy(t, 'coeficientes_delete_permitted', 'DELETE', 'app_private.has_permission(''sistema-config-credito'', ''can_delete'')');

  t := app_private.enable_rls_if_exists('crm_parceiro_config');
  perform app_private.apply_policy(t, 'crm_parceiro_config_select_permitted', 'SELECT', 'app_private.has_permission(''comercial-agentes'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_parceiro_config_insert_permitted', 'INSERT', null, 'app_private.has_permission(''comercial-agentes'', ''can_edit'')');
  perform app_private.apply_policy(t, 'crm_parceiro_config_update_permitted', 'UPDATE',
    'app_private.has_permission(''comercial-agentes'', ''can_edit'')',
    'app_private.has_permission(''comercial-agentes'', ''can_edit'')');

  t := app_private.enable_rls_if_exists('crm_usuarios');
  perform app_private.apply_policy(t, 'crm_usuarios_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');

  t := app_private.enable_rls_if_exists('crm_imports');
  perform app_private.apply_policy(t, 'crm_imports_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_imports_insert_permitted', 'INSERT', null, 'app_private.has_permission(''alvoconsig-gestao'', ''can_include'')');
  perform app_private.apply_policy(t, 'crm_imports_update_permitted', 'UPDATE',
    'app_private.has_permission(''alvoconsig-gestao'', ''can_include'')',
    'app_private.has_permission(''alvoconsig-gestao'', ''can_include'')');

  t := app_private.enable_rls_if_exists('crm_lotes_alocacao');
  perform app_private.apply_policy(t, 'crm_lotes_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_lotes_insert_permitted', 'INSERT', null, 'app_private.has_permission(''alvoconsig-gestao'', ''can_include'')');
  perform app_private.apply_policy(t, 'crm_lotes_update_permitted', 'UPDATE',
    'app_private.has_permission(''alvoconsig-gestao'', ''can_edit'')',
    'app_private.has_permission(''alvoconsig-gestao'', ''can_edit'')');

  t := app_private.enable_rls_if_exists('crm_contatos');
  perform app_private.apply_policy(t, 'crm_contatos_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_contatos_insert_permitted', 'INSERT', null, 'app_private.has_permission(''alvoconsig-gestao'', ''can_include'')');
  perform app_private.apply_policy(t, 'crm_contatos_update_permitted', 'UPDATE',
    'app_private.has_permission(''alvoconsig-gestao'', ''can_edit'')',
    'app_private.has_permission(''alvoconsig-gestao'', ''can_edit'')');

  t := app_private.enable_rls_if_exists('crm_tabulacoes');
  perform app_private.apply_policy(t, 'crm_tabulacoes_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');

  t := app_private.enable_rls_if_exists('crm_wesales_queue');
  perform app_private.apply_policy(t, 'crm_wesales_queue_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
end $$;

-- -----------------------------------------------------------------------------
-- Seeds de permissão:
--   sistema-config-credito -> quem já administra Instituições Financeiras
--   alvoconsig-gestao      -> quem já tem Central de Integrações (admins)
-- (Ajustável depois na matriz de permissões.)
-- -----------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'sistema-config-credito', true, true, true, true, true
from public.profile_permissions pp
where pp.resource_name = 'sistema-config-instituicoes' and coalesce(pp.can_edit, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'sistema-config-credito', true, true, true, true, true
from public.user_permissions up
where up.resource_name = 'sistema-config-instituicoes' and coalesce(up.can_edit, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'alvoconsig-gestao', true, true, true, true, true
from public.profile_permissions pp
where pp.resource_name = 'central-integracoes' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'alvoconsig-gestao', true, true, true, true, true
from public.user_permissions up
where up.resource_name = 'central-integracoes' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
