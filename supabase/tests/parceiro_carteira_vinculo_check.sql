-- Roda DEPOIS da migration 20261027105956 num banco descartável:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/parceiro_carteira_vinculo_check.sql
-- Executado com sucesso em 27/10/2026 (docker postgres 17 + esqueleto de auth.users/agentes_parceiros).
-- Checagens do vínculo carteira ↔ Agente Corban. Roda em transação e dá
-- ROLLBACK no fim: não deixa dado. Falha = assert/RAISE EXCEPTION.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'teste-a@parceiro.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'teste-b@parceiro.invalid'),
  ('00000000-0000-0000-0000-0000000000ff', 'teste-f@parceiro.invalid');

do $$
declare n int; s bigint;
begin
  -- cadastro já com login (INSERT) → carteira nasce vinculada, saldo 0
  insert into public.agentes_parceiros (id, name, auth_user_id)
  values ('10000000-0000-0000-0000-00000000000a', 'Teste A', '00000000-0000-0000-0000-00000000000a');
  select saldo_centavos into s from public.parceiro_carteiras where agente_parceiro_id = '10000000-0000-0000-0000-00000000000a';
  assert s = 0, 'INSERT com login deveria criar a carteira';

  -- cadastro sem login → sem carteira; login provisionado depois (UPDATE) → nasce
  insert into public.agentes_parceiros (id, name) values ('10000000-0000-0000-0000-00000000000b', 'Teste B');
  select count(*) into n from public.parceiro_carteiras where agente_parceiro_id = '10000000-0000-0000-0000-00000000000b';
  assert n = 0, 'sem login não cria carteira';
  update public.agentes_parceiros set auth_user_id = '00000000-0000-0000-0000-00000000000b' where id = '10000000-0000-0000-0000-00000000000b';
  update public.agentes_parceiros set auth_user_id = '00000000-0000-0000-0000-00000000000b' where id = '10000000-0000-0000-0000-00000000000b';
  select count(*) into n from public.parceiro_carteiras where agente_parceiro_id = '10000000-0000-0000-0000-00000000000b';
  assert n = 1, 'UPDATE do login cria 1 carteira (idempotente)';

  -- crédito/débito/saldo insuficiente seguem iguais
  perform public.parceiro_aplicar_lancamento('00000000-0000-0000-0000-00000000000a', 'credito', 2000, 'teste');
  perform public.parceiro_aplicar_lancamento('00000000-0000-0000-0000-00000000000a', 'debito', 300, 'teste');
  select saldo_centavos into s from public.parceiro_carteiras where agente_parceiro_id = '10000000-0000-0000-0000-00000000000a';
  assert s = 1700, 'crédito/débito';
  begin
    perform public.parceiro_aplicar_lancamento('00000000-0000-0000-0000-00000000000a', 'debito', 999999, 'teste');
    raise exception 'FALHA: aceitou débito acima do saldo';
  exception when raise_exception then
    assert sqlerrm like 'saldo insuficiente%', sqlerrm;
  end;

  -- vínculo apagado à mão → a RPC completa no próximo lançamento
  update public.parceiro_carteiras set agente_parceiro_id = null where user_id = '00000000-0000-0000-0000-00000000000b';
  perform public.parceiro_aplicar_lancamento('00000000-0000-0000-0000-00000000000b', 'credito', 500, 'teste');
  select saldo_centavos into s from public.parceiro_carteiras where agente_parceiro_id = '10000000-0000-0000-0000-00000000000b';
  assert s = 500, 'RPC deveria completar o vínculo';

  -- login sem cadastro de agente → carteira sem vínculo, sem erro
  perform public.parceiro_aplicar_lancamento('00000000-0000-0000-0000-0000000000ff', 'credito', 100, 'teste');
  select count(*) into n from public.parceiro_carteiras where user_id = '00000000-0000-0000-0000-0000000000ff' and agente_parceiro_id is null;
  assert n = 1, 'login sem agente';

  -- troca de login: a nova vincula, a antiga fica desvinculada com saldo
  update public.agentes_parceiros set auth_user_id = '00000000-0000-0000-0000-0000000000ff' where id = '10000000-0000-0000-0000-00000000000a';
  select count(*) into n from public.parceiro_carteiras where agente_parceiro_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000ff';
  assert n = 1, 'troca: nova vinculada';
  select saldo_centavos into s from public.parceiro_carteiras where user_id = '00000000-0000-0000-0000-00000000000a' and agente_parceiro_id is null;
  assert s = 1700, 'troca: antiga preservada';

  -- lançamento no login antigo não duplica o vínculo
  perform public.parceiro_aplicar_lancamento('00000000-0000-0000-0000-00000000000a', 'credito', 1, 'teste');
  select count(*) into n from public.parceiro_carteiras where agente_parceiro_id = '10000000-0000-0000-0000-00000000000a';
  assert n = 1, 'sem duplicidade de vínculo';

  raise notice 'OK vínculo carteira ↔ agente';
end $$;

rollback;
