-- =============================================================================
-- Redesenho dos Cadastros de Crédito no modelo ARW (decisão Bruno 22-23/08/2026)
--
-- Subsistemas: Convênios (isolado, permissão própria — semente da base de
-- conhecimento), Comissionamento (Formas de Contrato, Tipos de Formalização,
-- Tabelas de Comissão, Prazos Comissão, Spreads — espelho da lógica do ARW,
-- terreno pronto p/ integração/substituição futura) e Coeficientes Financeiros
-- (tabela de comissão × prazo específico, com vigência).
--
-- Fórmula do ARW (validada nos prints): líquido = comissão × (1 − imposto IF);
-- repasse por tipo de agente = (líquido − spread) × %repasse. Repasses NÃO são
-- armazenados — calculados na tela a partir dos insumos.
--
-- Sem dados reais nas tabelas antigas (criadas ontem): drop e recriação.
-- =============================================================================

drop table if exists public.coeficientes;
drop table if exists public.tabelas_credito;

-- -----------------------------------------------------------------------------
-- Tipo de Agente (reuso do cadastro do Agente Corban) + Imposto por IF
-- -----------------------------------------------------------------------------
alter table public.agente_corban_tipos_agente
  add column if not exists percentual_repasse numeric(6, 2) null,
  add column if not exists codigo_arw integer null;

update public.agente_corban_tipos_agente set percentual_repasse = v.pct, codigo_arw = v.cod
from (values
  ('Prata', 90.00, 5),
  ('Ouro', 94.00, 21),
  ('Bronze', 50.00, 22),
  ('Diamante', 100.00, 24),
  ('Rubi', 97.00, 25),
  ('Adamantium', 100.00, 26),
  ('Latão', 30.00, 27),
  ('Lojista / Empresa', 90.00, 29)
) as v(nome, pct, cod)
where trim(public.agente_corban_tipos_agente.name) = v.nome
  and (public.agente_corban_tipos_agente.percentual_repasse is null
       or public.agente_corban_tipos_agente.codigo_arw is null);

-- % de imposto sobre comissão, por instituição (ex.: 7.000 = 7%).
alter table public.financial_institutions
  add column if not exists imposto_comissao_percent numeric(6, 3) null;

-- -----------------------------------------------------------------------------
-- Catálogos: Forma de Contrato e Tipo de Formalização
-- -----------------------------------------------------------------------------
create table if not exists public.formas_contrato (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo_arw text null,
  -- Liga a forma à margem do lead no cálculo de ofertas do CRM.
  origem_margem text not null default 'nenhuma'
    check (origem_margem in ('novo', 'cartao_rmc', 'cartao_rcc', 'nenhuma')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists formas_contrato_nome_unique_idx
  on public.formas_contrato ((lower(trim(nome))));
create trigger set_timestamp_formas_contrato
  before update on public.formas_contrato
  for each row execute function trigger_set_timestamp();

insert into public.formas_contrato (nome, origem_margem) values
  ('Novo', 'novo'),
  ('Refin', 'nenhuma'),
  ('Cartão Consignado', 'cartao_rmc'),
  ('Cartão Benefício', 'cartao_rcc'),
  ('Portabilidade', 'nenhuma'),
  ('Refin da Portabilidade', 'nenhuma'),
  ('FGTS', 'nenhuma')
on conflict do nothing;

create table if not exists public.tipos_formalizacao (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo_arw text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tipos_formalizacao_nome_unique_idx
  on public.tipos_formalizacao ((lower(trim(nome))));
create trigger set_timestamp_tipos_formalizacao
  before update on public.tipos_formalizacao
  for each row execute function trigger_set_timestamp();

insert into public.tipos_formalizacao (nome) values
  ('Digital'), ('Semi-Digital'), ('Física'), ('Física e Digital')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Tabela de Comissão (entidade sem prazos — espelho do ARW)
-- -----------------------------------------------------------------------------
create table if not exists public.tabelas_comissao (
  id uuid primary key default gen_random_uuid(),
  codigo_tabela_banco text null,
  nome text not null,
  institution_id uuid not null references public.financial_institutions (id),
  forma_contrato_id uuid not null references public.formas_contrato (id),
  convenio_id uuid null references public.convenios (id),
  tipo_formalizacao_id uuid null references public.tipos_formalizacao (id),
  -- Extra ao ARW (lá fica implícito no nome): usado na exibição de ofertas.
  com_seguro boolean null,
  observacao text not null default '',
  id_arw text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tabelas_comissao_institution_idx
  on public.tabelas_comissao (institution_id) where deleted_at is null;
create index if not exists tabelas_comissao_convenio_idx
  on public.tabelas_comissao (convenio_id) where deleted_at is null;
create index if not exists tabelas_comissao_forma_idx
  on public.tabelas_comissao (forma_contrato_id) where deleted_at is null;
create trigger set_timestamp_tabelas_comissao
  before update on public.tabelas_comissao
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- Prazo Comissão (N:1 com Tabela de Comissão — espelho do ARW)
-- -----------------------------------------------------------------------------
create table if not exists public.prazos_comissao (
  id uuid primary key default gen_random_uuid(),
  tabela_comissao_id uuid not null references public.tabelas_comissao (id) on delete cascade,
  forma_pagamento text not null default 'percentual'
    check (forma_pagamento in ('percentual', 'faixa_percentual', 'faixa_fixo', 'fixo')),
  valor_inicial numeric(14, 2) null,
  valor_final numeric(14, 2) null,
  prazo_inicial integer not null check (prazo_inicial > 0),
  prazo_final integer not null check (prazo_final > 0),
  data_base date null,
  manter_enquadramento boolean not null default true,
  -- Comissão da empresa (percentual ou R$, conforme forma_pagamento).
  comissao numeric(12, 4) null,
  emissao numeric(12, 4) null,
  seguro numeric(12, 4) null,
  forma_pagamento_seguro text null
    check (forma_pagamento_seguro is null or forma_pagamento_seguro in ('percentual', 'fixo')),
  id_arw text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prazos_comissao_intervalo_valido check (prazo_final >= prazo_inicial)
);
create index if not exists prazos_comissao_tabela_idx
  on public.prazos_comissao (tabela_comissao_id);
create trigger set_timestamp_prazos_comissao
  before update on public.prazos_comissao
  for each row execute function trigger_set_timestamp();

-- -----------------------------------------------------------------------------
-- Spread (margem mínima da BRS, em pontos percentuais)
-- -----------------------------------------------------------------------------
create table if not exists public.spreads (
  id uuid primary key default gen_random_uuid(),
  forma_contrato_id uuid not null references public.formas_contrato (id),
  tipo_agente_id uuid not null references public.agente_corban_tipos_agente (id),
  institution_id uuid not null references public.financial_institutions (id),
  convenio_id uuid null references public.convenios (id),
  tipo_formalizacao_id uuid null references public.tipos_formalizacao (id),
  pontos numeric(9, 4) not null check (pontos >= 0),
  vigencia_inicio date not null default current_date,
  vigencia_fim date null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint spreads_vigencia_valida
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create index if not exists spreads_chave_idx
  on public.spreads (institution_id, forma_contrato_id, tipo_agente_id);

-- -----------------------------------------------------------------------------
-- Coeficientes Financeiros (tabela de comissão × prazo específico, c/ vigência)
-- -----------------------------------------------------------------------------
create table if not exists public.coeficientes (
  id uuid primary key default gen_random_uuid(),
  tabela_comissao_id uuid not null references public.tabelas_comissao (id) on delete cascade,
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
  on public.coeficientes (tabela_comissao_id, prazo, vigencia_inicio);

-- -----------------------------------------------------------------------------
-- RLS
--   workspace-convenios     -> Convênios (equipe da base de conhecimento)
--   sistema-config-credito  -> Comissionamento + Coeficientes
-- -----------------------------------------------------------------------------
do $$
declare
  t regclass;
  tabela text;
begin
  -- Convênios muda para a permissão própria.
  t := app_private.enable_rls_if_exists('convenios');
  perform app_private.apply_policy(t, 'convenios_select_permitted', 'SELECT', 'app_private.has_permission(''workspace-convenios'', ''can_view'')');
  perform app_private.apply_policy(t, 'convenios_insert_permitted', 'INSERT', null, 'app_private.has_permission(''workspace-convenios'', ''can_include'')');
  perform app_private.apply_policy(t, 'convenios_update_permitted', 'UPDATE',
    'app_private.has_permission(''workspace-convenios'', ''can_edit'')',
    'app_private.has_permission(''workspace-convenios'', ''can_edit'')');
  perform app_private.apply_policy(t, 'convenios_delete_permitted', 'DELETE', 'app_private.has_permission(''workspace-convenios'', ''can_delete'')');

  foreach tabela in array array['formas_contrato', 'tipos_formalizacao', 'tabelas_comissao', 'prazos_comissao', 'spreads', 'coeficientes'] loop
    t := app_private.enable_rls_if_exists(tabela);
    perform app_private.apply_policy(t, tabela || '_select_permitted', 'SELECT', 'app_private.has_permission(''sistema-config-credito'', ''can_view'')');
    perform app_private.apply_policy(t, tabela || '_insert_permitted', 'INSERT', null, 'app_private.has_permission(''sistema-config-credito'', ''can_include'')');
    perform app_private.apply_policy(t, tabela || '_update_permitted', 'UPDATE',
      'app_private.has_permission(''sistema-config-credito'', ''can_edit'')',
      'app_private.has_permission(''sistema-config-credito'', ''can_edit'')');
    perform app_private.apply_policy(t, tabela || '_delete_permitted', 'DELETE', 'app_private.has_permission(''sistema-config-credito'', ''can_delete'')');
  end loop;
end $$;

-- Seeds de permissão: workspace-convenios p/ quem já tem sistema-config-credito.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'workspace-convenios', true, true, true, true, true
from public.profile_permissions pp
where pp.resource_name = 'sistema-config-credito' and coalesce(pp.can_edit, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'workspace-convenios', true, true, true, true, true
from public.user_permissions up
where up.resource_name = 'sistema-config-credito' and coalesce(up.can_edit, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
