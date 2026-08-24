-- =============================================================================
-- CRM AlvoConsig sobre o WeSales — Fase 1 (docs/SPEC-CRM-WESALES-CAMPANHAS.md)
--
-- WeSales = repositório permanente de TODOS os leads. Dono = TAG parceiro:<arw>.
-- Supabase guarda: cópia de trabalho TEMPORÁRIA por campanha (crm_contatos),
-- dono permanente SEM PII (crm_dono_leads), carteira de clientes SEM PII
-- (crm_clientes_parceiro) e presença de atendente. crm_lotes_alocacao fica
-- como legado (dados de teste) até a Fase 2 trocar as telas por campanhas.
--
-- REGRA DE DONO DE CAMPO (anti-conflito; código em src/lib/alvoconsig/campos-sync.ts):
--   • WeSales é dono de: nome, telefone, cpf, convênio, matrícula, código do
--     empregador, margens, refin_* → webhook sobrescreve a cópia local.
--   • CRM é dono (durante a campanha) de: funil_estagio, tabulações,
--     observações → fila leva ao WeSales.
--   • Workspace é dono das tags parceiro:/cliente: (alocação/certificação).
-- =============================================================================

-- 1. Campanhas (substituem os lotes; vigência + status)
create table if not exists public.crm_campanhas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  descricao text not null default '',
  base_tag text not null default '',
  filtros jsonb not null default '{}'::jsonb,
  qtd_solicitada integer not null default 0 check (qtd_solicitada >= 0),
  qtd_alocada integer not null default 0 check (qtd_alocada >= 0),
  vigencia_inicio date not null default current_date,
  vigencia_fim date not null,
  status text not null default 'montando'
    check (status in ('montando','ativa','encerrando','encerrada','cancelada')),
  criado_por uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  encerrada_em timestamptz null,
  observacao text null,
  constraint crm_campanhas_vigencia_check check (vigencia_fim >= vigencia_inicio)
);
create index if not exists crm_campanhas_parceiro_idx
  on public.crm_campanhas (agente_parceiro_id, status);
create index if not exists crm_campanhas_vigencia_idx
  on public.crm_campanhas (status, vigencia_fim);
drop trigger if exists set_timestamp on public.crm_campanhas;
create trigger set_timestamp before update on public.crm_campanhas
  for each row execute function trigger_set_timestamp();

-- 2. crm_contatos vira CÓPIA DE TRABALHO por campanha
alter table public.crm_contatos
  add column if not exists campanha_id uuid null references public.crm_campanhas(id) on delete set null,
  add column if not exists expira_em timestamptz null,
  -- Ofertas pré-calculadas na montagem da campanha (o pop da ligação só exibe):
  -- { novo: {valor, coeficiente, tabela, vigencia}, rmc: {...}, rcc: {...}, refin: {troco, parcela, prazo, taxa} }
  add column if not exists ofertas jsonb not null default '{}'::jsonb,
  add column if not exists estado_local text not null default 'ativo'
    check (estado_local in ('ativo','negociacao_aberta','certificacao_pendente','expurgavel')),
  add column if not exists sincronizado_em timestamptz null;
create index if not exists crm_contatos_campanha_estagio_idx
  on public.crm_contatos (campanha_id, funil_estagio) where deleted_at is null;
create index if not exists crm_contatos_telefone_idx
  on public.crm_contatos (telefone) where deleted_at is null;
create index if not exists crm_contatos_expira_idx
  on public.crm_contatos (expira_em) where deleted_at is null and expira_em is not null;
-- Toda cópia nasce do WeSales: contact_id obrigatório para linhas novas/alteradas.
-- NOT VALID: não valida as linhas legadas do importador antigo (dados de teste).
alter table public.crm_contatos
  drop constraint if exists crm_contatos_wesales_contact_id_obrigatorio;
alter table public.crm_contatos
  add constraint crm_contatos_wesales_contact_id_obrigatorio
  check (wesales_contact_id is not null) not valid;

-- 3. Dono permanente SEM PII (1 dono ativo por contato)
create table if not exists public.crm_dono_leads (
  id uuid primary key default gen_random_uuid(),
  wesales_contact_id text not null,
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  campanha_id uuid null references public.crm_campanhas(id) on delete set null,
  alocado_em timestamptz not null default now(),
  alocado_por uuid null,
  revogado_em timestamptz null,
  revogado_por uuid null,
  motivo text null
);
create unique index if not exists crm_dono_leads_ativo_unique
  on public.crm_dono_leads (wesales_contact_id) where revogado_em is null;
create index if not exists crm_dono_leads_parceiro_idx
  on public.crm_dono_leads (agente_parceiro_id) where revogado_em is null;

-- 4. Carteira de clientes do parceiro SEM PII (certificação pelo operacional)
create table if not exists public.crm_clientes_parceiro (
  id uuid primary key default gen_random_uuid(),
  wesales_contact_id text not null,
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  campanha_id uuid null references public.crm_campanhas(id) on delete set null,
  produto text null,
  valor numeric(12, 2) null,
  certificado_por uuid null,
  certificado_em timestamptz not null default now(),
  observacao text null,
  constraint crm_clientes_parceiro_unique unique (wesales_contact_id, agente_parceiro_id)
);
create index if not exists crm_clientes_parceiro_parceiro_idx
  on public.crm_clientes_parceiro (agente_parceiro_id, certificado_em desc);

-- 5. Presença do atendente (roteamento da discadora — Fase 4)
create table if not exists public.crm_atendente_presenca (
  crm_usuario_id uuid primary key references public.crm_usuarios(id) on delete cascade,
  estado text not null default 'offline'
    check (estado in ('livre','em_ligacao','pos_atendimento','offline')),
  contato_atual_id uuid null references public.crm_contatos(id) on delete set null,
  atualizado_em timestamptz not null default now()
);

-- 6. Fila: novas operações (a check antiga, se existir, é substituída)
alter table public.crm_wesales_queue drop constraint if exists crm_wesales_queue_operacao_check;
alter table public.crm_wesales_queue add constraint crm_wesales_queue_operacao_check
  check (operacao in (
    'upsert_contato','atualizar_dono','mover_estagio','adicionar_nota',
    'aplicar_tag','remover_tag','sincronizar_estagio','sincronizar_atendimento'
  ));

-- =============================================================================
-- RLS (padrão da casa). Parceiros/atendentes do CRM escrevem via service role
-- do app brs-alvoconsig; aqui só o acesso interno do Workspace.
-- =============================================================================
do $$
declare t regclass;
begin
  t := app_private.enable_rls_if_exists('crm_campanhas');
  perform app_private.apply_policy(t, 'crm_campanhas_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_campanhas_insert_permitted', 'INSERT', null, 'app_private.has_permission(''alvoconsig-gestao'', ''can_include'')');
  perform app_private.apply_policy(t, 'crm_campanhas_update_permitted', 'UPDATE', 'app_private.has_permission(''alvoconsig-gestao'', ''can_edit'')');

  t := app_private.enable_rls_if_exists('crm_dono_leads');
  perform app_private.apply_policy(t, 'crm_dono_leads_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');

  t := app_private.enable_rls_if_exists('crm_clientes_parceiro');
  perform app_private.apply_policy(t, 'crm_clientes_parceiro_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_clientes_parceiro_insert_permitted', 'INSERT', null, 'app_private.has_permission(''alvoconsig-certificacao'', ''can_include'')');

  t := app_private.enable_rls_if_exists('crm_atendente_presenca');
  perform app_private.apply_policy(t, 'crm_atendente_presenca_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
end $$;

-- Permissão nova: certificação de concretização (operacional BRS). Seed = quem já gere leads.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'alvoconsig-certificacao', true, true, false, false, false
from public.profile_permissions pp
where pp.resource_name = 'alvoconsig-gestao' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do nothing;
insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'alvoconsig-certificacao', true, true, false, false, false
from public.user_permissions up
where up.resource_name = 'alvoconsig-gestao' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do nothing;

-- =============================================================================
-- RPCs (service_role only)
-- =============================================================================

-- Certifica a concretização: carteira sem PII + tag cliente:<arw> via fila +
-- libera a cópia local para expurgo. Idempotente por (contato, parceiro).
create or replace function public.crm_certificar_cliente(
  p_contato_id uuid,
  p_user_id uuid,
  p_produto text default null,
  p_valor numeric default null,
  p_observacao text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c record;
  v_arw text;
begin
  select c.id, c.wesales_contact_id, c.agente_parceiro_id, c.campanha_id
  into v_c from public.crm_contatos c
  where c.id = p_contato_id and c.deleted_at is null;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_encontrado');
  end if;
  if v_c.wesales_contact_id is null or v_c.agente_parceiro_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'contato_sem_wesales_ou_sem_dono');
  end if;

  insert into public.crm_clientes_parceiro (wesales_contact_id, agente_parceiro_id, campanha_id, produto, valor, certificado_por, observacao)
  values (v_c.wesales_contact_id, v_c.agente_parceiro_id, v_c.campanha_id, p_produto, p_valor, p_user_id, p_observacao)
  on conflict (wesales_contact_id, agente_parceiro_id) do update
    set produto = coalesce(excluded.produto, crm_clientes_parceiro.produto),
        valor = coalesce(excluded.valor, crm_clientes_parceiro.valor);

  select ap.arw_code into v_arw from public.agentes_parceiros ap where ap.id = v_c.agente_parceiro_id;

  insert into public.crm_wesales_queue (operacao, contato_id, payload)
  values ('aplicar_tag', v_c.id, jsonb_build_object('contact_id', v_c.wesales_contact_id, 'tag', 'cliente:' || coalesce(v_arw, '')));

  update public.crm_contatos
  set estado_local = 'expurgavel', updated_at = now()
  where id = v_c.id;

  return jsonb_build_object('ok', true, 'wesales_contact_id', v_c.wesales_contact_id);
end;
$$;

-- Encerra a campanha: exige fila zerada dos contatos dela; expurga as cópias
-- locais EXCETO negociação aberta e certificação pendente (estende a vigência
-- só desses). Dono/carteira (sem PII) permanecem.
create or replace function public.crm_encerrar_campanha(p_campanha_id uuid, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pendentes integer;
  v_expurgados integer;
  v_mantidos integer;
begin
  select count(*) into v_pendentes
  from public.crm_wesales_queue q
  join public.crm_contatos c on c.id = q.contato_id
  where c.campanha_id = p_campanha_id and q.status in ('pendente','processando','erro');
  if v_pendentes > 0 then
    update public.crm_campanhas set status = 'encerrando' where id = p_campanha_id and status = 'ativa';
    return jsonb_build_object('ok', false, 'motivo', 'fila_pendente', 'pendentes', v_pendentes);
  end if;

  -- Exceções ao expurgo: negociação aberta / certificação pendente ficam (7 dias a mais).
  update public.crm_contatos
  set expira_em = now() + interval '7 days'
  where campanha_id = p_campanha_id and deleted_at is null
    and estado_local in ('negociacao_aberta','certificacao_pendente');
  get diagnostics v_mantidos = row_count;

  -- Expurgo físico das cópias (o dono sem PII já está em crm_dono_leads).
  delete from public.crm_tabulacoes t
  using public.crm_contatos c
  where t.contato_id = c.id and c.campanha_id = p_campanha_id
    and c.estado_local in ('ativo','expurgavel');
  delete from public.crm_contatos
  where campanha_id = p_campanha_id
    and estado_local in ('ativo','expurgavel');
  get diagnostics v_expurgados = row_count;

  update public.crm_campanhas
  set status = case when v_mantidos > 0 then 'encerrando' else 'encerrada' end,
      encerrada_em = case when v_mantidos > 0 then null else now() end
  where id = p_campanha_id;

  return jsonb_build_object('ok', true, 'expurgados', v_expurgados, 'mantidos', v_mantidos);
end;
$$;

revoke all on function public.crm_certificar_cliente(uuid, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.crm_encerrar_campanha(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_certificar_cliente(uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.crm_encerrar_campanha(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
