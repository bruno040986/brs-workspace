-- =============================================================================
-- Conta virtual do parceiro nasce com o cadastro do Agente Corban.
--
-- Problema: a carteira (parceiro_carteiras) só nascia no 1º lançamento, via
-- parceiro_aplicar_lancamento, com agente_parceiro_id NULL. O portal lê por
-- user_id e funcionava; o CRM e o painel do Agente Corban leem por
-- agente_parceiro_id e mostravam "sem saldo" (caso GO337, R$ 20, 27/10/2026).
--
-- Regra: carteira.user_id = agentes_parceiros.auth_user_id (login do parceiro)
-- e carteira.agente_parceiro_id = agentes_parceiros.id. O banco garante:
--   1. trigger em agentes_parceiros cria/vincula a carteira quando o login é
--      gravado (provisionamento na aba Acesso ou habilitação do AlvoConsig);
--   2. a RPC de lançamento preenche o vínculo ao criar/achar a carteira;
--   3. backfill idempotente + unique em agente_parceiro_id (1 carteira por
--      parceiro — conferido em produção: 2 carteiras, sem duplicidade).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger: login gravado no cadastro → carteira existe e está vinculada
-- -----------------------------------------------------------------------------
create or replace function public.agentes_parceiros_garantir_carteira()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Login trocado: a carteira acompanha o login (identidade do ledger e do
  -- portal). A do login antigo fica desvinculada (saldo e extrato preservados).
  update public.parceiro_carteiras
  set agente_parceiro_id = null
  where agente_parceiro_id = new.id
    and user_id <> new.auth_user_id;

  insert into public.parceiro_carteiras (user_id, agente_parceiro_id)
  values (new.auth_user_id, new.id)
  on conflict (user_id) do update
    set agente_parceiro_id = excluded.agente_parceiro_id
    where parceiro_carteiras.agente_parceiro_id is distinct from excluded.agente_parceiro_id;

  return new;
end;
$$;

revoke execute on function public.agentes_parceiros_garantir_carteira() from public, anon, authenticated;

drop trigger if exists agentes_parceiros_garantir_carteira on public.agentes_parceiros;
create trigger agentes_parceiros_garantir_carteira
  after insert or update of auth_user_id on public.agentes_parceiros
  for each row
  when (new.auth_user_id is not null)
  execute function public.agentes_parceiros_garantir_carteira();

-- -----------------------------------------------------------------------------
-- 2. Backfill idempotente (antes do unique): desvincula carteira de login que
--    não é mais o do parceiro e cria/vincula a de todo parceiro com login.
-- -----------------------------------------------------------------------------
update public.parceiro_carteiras c
set agente_parceiro_id = null
from public.agentes_parceiros ap
where c.agente_parceiro_id = ap.id
  and ap.auth_user_id is not null
  and c.user_id <> ap.auth_user_id;

insert into public.parceiro_carteiras (user_id, agente_parceiro_id)
select ap.auth_user_id, ap.id
from public.agentes_parceiros ap
where ap.auth_user_id is not null
on conflict (user_id) do update
  set agente_parceiro_id = excluded.agente_parceiro_id
  where parceiro_carteiras.agente_parceiro_id is distinct from excluded.agente_parceiro_id;

-- -----------------------------------------------------------------------------
-- 3. Uma carteira por parceiro (CRM/painel buscam com maybeSingle)
-- -----------------------------------------------------------------------------
create unique index if not exists parceiro_carteiras_agente_parceiro_idx
  on public.parceiro_carteiras (agente_parceiro_id) where agente_parceiro_id is not null;

-- -----------------------------------------------------------------------------
-- 4. RPC de lançamento: mesma assinatura/regras; ao criar/achar a carteira,
--    preenche agente_parceiro_id pelo login (se ainda NULL e se o parceiro
--    não tiver outra carteira vinculada — nunca falha um crédito por isso).
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
  v_agente uuid;
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

  select ap.id into v_agente
  from public.agentes_parceiros ap
  where ap.auth_user_id = p_user_id
    and not exists (
      select 1 from public.parceiro_carteiras c
      where c.agente_parceiro_id = ap.id and c.user_id <> p_user_id
    );

  insert into public.parceiro_carteiras (user_id, agente_parceiro_id)
  values (p_user_id, v_agente)
  on conflict (user_id) do update
    set agente_parceiro_id = excluded.agente_parceiro_id
    where parceiro_carteiras.agente_parceiro_id is null
      and excluded.agente_parceiro_id is not null;

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

notify pgrst, 'reload schema';
