-- =============================================================================
-- Conta virtual do parceiro + Higienização NVTI paga (Portal Parceiro).
-- Spec: brs-portal-parceiro/docs/SPEC-CONTA-VIRTUAL-E-NVTI-PAGA.md
-- (pedido do Claude do Orca, autorizado pelo Bruno em 22/08/2026).
--
-- Decisões: valores em CENTAVOS (bigint); identidade do parceiro =
-- auth.users.id do login sintético <codigo>@parceiro.brspromotora.com.br;
-- ledger append-only; escrita SÓ via service role (portal server-side);
-- parceiro autenticado só LÊ o que é dele.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Carteira (saldo em cache, 1 por parceiro)
-- -----------------------------------------------------------------------------
create table if not exists public.parceiro_carteiras (
  user_id uuid primary key references auth.users (id),
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  saldo_centavos bigint not null default 0 check (saldo_centavos >= 0),
  atualizado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. Ledger append-only (extrato)
-- -----------------------------------------------------------------------------
create table if not exists public.parceiro_lancamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  tipo text not null check (tipo in ('credito', 'debito')),
  valor_centavos bigint not null check (valor_centavos > 0),
  motivo text not null,
  origem text not null default 'sistema' check (origem in ('sistema', 'manual')),
  referencia_tipo text null,
  referencia_id uuid null,
  criado_por uuid null references auth.users (id),
  saldo_apos_centavos bigint not null,
  criado_em timestamptz not null default now()
);
create index if not exists parceiro_lancamentos_user_idx
  on public.parceiro_lancamentos (user_id, criado_em desc);

-- Append-only: nem authenticated nem anon podem alterar/apagar lançamentos.
revoke update, delete on public.parceiro_lancamentos from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Função atômica ledger + saldo (SECURITY DEFINER, só service_role)
-- -----------------------------------------------------------------------------
create or replace function public.parceiro_aplicar_lancamento(
  p_user_id uuid,
  p_tipo text,
  p_valor_centavos bigint,
  p_motivo text,
  p_origem text default 'sistema',
  p_referencia_tipo text default null,
  p_referencia_id uuid default null,
  p_criado_por uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo bigint;
begin
  if p_user_id is null then
    raise exception 'user_id obrigatório';
  end if;
  if p_tipo not in ('credito', 'debito') then
    raise exception 'tipo inválido: %', p_tipo;
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 then
    raise exception 'valor_centavos deve ser > 0';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'motivo obrigatório';
  end if;

  insert into public.parceiro_carteiras (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select saldo_centavos into v_saldo
  from public.parceiro_carteiras
  where user_id = p_user_id
  for update;

  if p_tipo = 'debito' then
    if v_saldo < p_valor_centavos then
      raise exception 'saldo insuficiente (saldo %, débito %)', v_saldo, p_valor_centavos;
    end if;
    v_saldo := v_saldo - p_valor_centavos;
  else
    v_saldo := v_saldo + p_valor_centavos;
  end if;

  insert into public.parceiro_lancamentos
    (user_id, tipo, valor_centavos, motivo, origem, referencia_tipo, referencia_id, criado_por, saldo_apos_centavos)
  values
    (p_user_id, p_tipo, p_valor_centavos, trim(p_motivo), coalesce(p_origem, 'sistema'), p_referencia_tipo, p_referencia_id, p_criado_por, v_saldo);

  update public.parceiro_carteiras
  set saldo_centavos = v_saldo, atualizado_em = now()
  where user_id = p_user_id;

  return v_saldo;
end;
$$;

revoke execute on function public.parceiro_aplicar_lancamento(uuid, text, bigint, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.parceiro_aplicar_lancamento(uuid, text, bigint, text, text, text, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Solicitações de saque
-- -----------------------------------------------------------------------------
create table if not exists public.parceiro_saques (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  valor_centavos bigint not null check (valor_centavos > 0),
  chave_pix text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'pago', 'recusado', 'cancelado')),
  observacao text null,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz null,
  resolvido_por uuid null references auth.users (id)
);
create index if not exists parceiro_saques_status_idx
  on public.parceiro_saques (status, criado_em);
create index if not exists parceiro_saques_user_idx
  on public.parceiro_saques (user_id, criado_em desc);

-- -----------------------------------------------------------------------------
-- 5. Lotes de higienização do portal
-- -----------------------------------------------------------------------------
create table if not exists public.nvti_lotes_parceiro (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  nome_arquivo text not null,
  total_cpfs integer not null check (total_cpfs > 0),
  preco_unit_centavos integer not null check (preco_unit_centavos > 0),
  valor_total_centavos bigint not null check (valor_total_centavos > 0),
  status text not null default 'aguardando_pagamento'
    check (status in ('aguardando_pagamento', 'pago', 'processando', 'concluido', 'erro', 'expirado', 'cancelado')),
  cpfs_ok integer null,
  cpfs_sem_retorno integer null,
  credito_gerado_centavos bigint null,
  storage_entrada text not null,
  storage_resultado text null,
  criado_em timestamptz not null default now(),
  pago_em timestamptz null,
  concluido_em timestamptz null
);
create index if not exists nvti_lotes_parceiro_user_idx
  on public.nvti_lotes_parceiro (user_id, criado_em desc);
create index if not exists nvti_lotes_parceiro_status_idx
  on public.nvti_lotes_parceiro (status);

-- -----------------------------------------------------------------------------
-- 6. Cobranças Pix
-- -----------------------------------------------------------------------------
create table if not exists public.parceiro_cobrancas_pix (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  lote_id uuid not null references public.nvti_lotes_parceiro (id),
  gateway text not null check (gateway in ('mercadopago', 'abacatepay')),
  valor_centavos bigint not null check (valor_centavos > 0),
  taxa_estimada_centavos bigint not null default 0,
  gateway_charge_id text not null,
  copia_cola text null,
  qr_code_base64 text null,
  status text not null default 'pendente'
    check (status in ('pendente', 'pago', 'expirado', 'cancelado', 'erro')),
  payload_webhook jsonb null,
  criado_em timestamptz not null default now(),
  pago_em timestamptz null,
  constraint parceiro_cobrancas_pix_gateway_charge_unique unique (gateway, gateway_charge_id)
);
create index if not exists parceiro_cobrancas_pix_lote_idx
  on public.parceiro_cobrancas_pix (lote_id);
create index if not exists parceiro_cobrancas_pix_status_idx
  on public.parceiro_cobrancas_pix (status);

revoke delete on public.parceiro_cobrancas_pix from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Bucket privado partner-nvti (leitura só do dono; escrita só service role)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('partner-nvti', 'partner-nvti', false)
on conflict (id) do nothing;

drop policy if exists "partner_nvti_select_own" on storage.objects;
create policy "partner_nvti_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'partner-nvti' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- 8. RLS: parceiro autenticado só LÊ o que é dele; nenhuma escrita p/
--    authenticated (toda escrita via service role no servidor do portal).
-- -----------------------------------------------------------------------------
do $$
declare
  tabela text;
begin
  foreach tabela in array array['parceiro_carteiras', 'parceiro_lancamentos', 'parceiro_saques', 'nvti_lotes_parceiro', 'parceiro_cobrancas_pix'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('drop policy if exists %I on public.%I', tabela || '_select_own', tabela);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid())',
      tabela || '_select_own', tabela
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
