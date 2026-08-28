-- =============================================================================
-- CRM AlvoConsig — crm_ofertas: estado por OFERTA (1 linha por oferta, várias
-- por lead), espelho local do pipeline "AC - Oferta" do WeSales.
-- Desenho: docs/SPEC-FUNIS-ALVOCONSIG.md, "Decisões de arquitetura" (Fable,
-- 29/08/2026), item 1. O jsonb crm_contatos.ofertas passa a ser só cache do
-- cálculo; o que vale (etapa, oportunidade no WeSales, reprovação) é aqui.
-- =============================================================================

create table if not exists public.crm_ofertas (
  id uuid primary key default gen_random_uuid(),
  contato_id uuid not null references public.crm_contatos (id) on delete cascade,
  -- denormalizado de propósito: TODA leitura do CRM filtra por parceiro
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  campanha_id uuid null references public.crm_campanhas (id) on delete set null,

  -- identidade da oferta
  produto text not null
    check (produto in ('novo', 'cartao_rmc', 'cartao_rcc', 'refin')),
  produto_nome text not null default '',
  instituicao_id uuid null references public.financial_institutions (id),
  instituicao_nome text not null default '',
  tabela_comissao_id uuid null references public.tabelas_comissao (id),
  tabela_nome text not null default '',
  codigo_tabela_banco text null,
  com_seguro boolean null,
  prazo integer null check (prazo is null or prazo > 0),

  -- números
  coeficiente numeric(12, 6) null,
  taxa text null,
  margem numeric(12, 2) null,
  parcela numeric(12, 2) null,
  valor_liberado numeric(12, 2) not null default 0,

  -- funil AC - Oferta (keys de brs-alvoconsig/src/lib/wesales/ac-stages.ts)
  estagio text not null default 'ofertas_disponiveis'
    check (estagio in (
      'ofertas_disponiveis', 'em_negociacao', 'digitacao_analise_bancaria',
      'formalizacao', 'liberada_pagamento', 'proposta_paga',
      'reprovadas_operacional', 'reavaliar_ofertas_disponiveis'
    )),
  -- "Reprovadas Operacional" preserva ONDE caiu (relatório: reprova mais na
  -- digitação ou na formalização?)
  reprovada_no_estagio text null
    check (reprovada_no_estagio is null or reprovada_no_estagio in (
      'em_negociacao', 'digitacao_analise_bancaria', 'formalizacao', 'liberada_pagamento'
    )),
  estagio_atualizado_em timestamptz null,

  wesales_opportunity_id text null unique,
  dados jsonb not null default '{}'::jsonb,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_ofertas_reprovada_coerente check (
    (estagio = 'reprovadas_operacional') = (reprovada_no_estagio is not null)
  )
);

create index if not exists crm_ofertas_contato_idx
  on public.crm_ofertas (contato_id) where deleted_at is null;
create index if not exists crm_ofertas_parceiro_estagio_idx
  on public.crm_ofertas (agente_parceiro_id, estagio) where deleted_at is null;
create index if not exists crm_ofertas_campanha_idx
  on public.crm_ofertas (campanha_id) where deleted_at is null;

-- Identidade natural: recalcular ofertas da campanha não pode duplicar linha.
-- REFIN pode vir sem tabela_comissao resolvida — cai no código do banco.
create unique index if not exists crm_ofertas_identidade_uidx
  on public.crm_ofertas (
    contato_id,
    produto,
    coalesce(tabela_comissao_id::text, codigo_tabela_banco, ''),
    coalesce(prazo, 0)
  ) where deleted_at is null;

drop trigger if exists set_timestamp on public.crm_ofertas;
create trigger set_timestamp before update on public.crm_ofertas
  for each row execute function trigger_set_timestamp();

-- RLS: mesmo padrão das demais crm_* (Workspace lê/escreve por permissão
-- alvoconsig-gestao; o CRM do parceiro usa service role com filtro de
-- parceiro na camada de aplicação).
do $$
declare t text;
begin
  t := app_private.enable_rls_if_exists('crm_ofertas');
  perform app_private.apply_policy(t, 'crm_ofertas_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_ofertas_insert_permitted', 'INSERT', null, 'app_private.has_permission(''alvoconsig-gestao'', ''can_include'')');
  perform app_private.apply_policy(t, 'crm_ofertas_update_permitted', 'UPDATE', 'app_private.has_permission(''alvoconsig-gestao'', ''can_edit'')');
  -- Sem policy de DELETE (igual crm_contatos): exclusão é soft, via deleted_at.
end $$;
