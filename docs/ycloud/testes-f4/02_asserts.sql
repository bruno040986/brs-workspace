\set ON_ERROR_STOP on
begin;
do $$
declare v_ag uuid; v_inst uuid; v_inst2 uuid; v_ass uuid;
begin
  insert into agentes_parceiros default values returning id into v_ag;
  insert into chat_instancias default values returning id into v_inst;
  insert into chat_instancias default values returning id into v_inst2;

  -- 1. backfill: linhas BRS carimbadas com pix_parceiro; ids intactos
  if (select finalidades from gateway_pagamentos where id='mercadopago') <> '{pix_parceiro}'::text[] then
    raise exception 'FALHOU: backfill finalidades mercadopago'; end if;
  -- 2. conta nova da Bem Digital convive sem tocar as antigas
  insert into gateway_pagamentos (id, nome, ativo, cnpj, razao_social, finalidades, meios)
    values ('mercadopago-bemdigital','Mercado Pago — Bem Digital',true,'00000000000000','Bem Digital','{assinatura_wa_oficial}','{pix,cartao}');

  -- 3. trial único GLOBAL por número
  insert into crm_wa_oficial_trials (numero_e164, agente_parceiro_id_original, fim_em)
    values ('5561999990000', v_ag, now() + interval '30 days');
  begin
    insert into crm_wa_oficial_trials (numero_e164, fim_em) values ('5561999990000', now());
    raise exception 'FALHOU: trial duplicado aceito';
  exception when unique_violation then null; end;
  -- 4. número mal normalizado recusado
  begin
    insert into crm_wa_oficial_trials (numero_e164, fim_em) values ('+55 61 9', now());
    raise exception 'FALHOU: numero nao normalizado aceito';
  exception when check_violation then null; end;

  -- 5. assinatura: 1 por instância; status válido; aceite obrigatório
  insert into crm_wa_oficial_assinaturas (agente_parceiro_id, instancia_id, numero_e164, status, trial_fim_em, aceite_termos)
    values (v_ag, v_inst, '5561999990000', 'trial', now() + interval '30 days', '{"versao":"2026-09-26.1"}')
    returning id into v_ass;
  begin
    insert into crm_wa_oficial_assinaturas (agente_parceiro_id, instancia_id, numero_e164, status, aceite_termos)
      values (v_ag, v_inst, '5561999990000', 'trial', '{}');
    raise exception 'FALHOU: 2a assinatura na mesma instancia aceita';
  exception when unique_violation then null; end;
  begin
    insert into crm_wa_oficial_assinaturas (agente_parceiro_id, instancia_id, numero_e164, status, aceite_termos)
      values (v_ag, v_inst2, '5561999990000', 'suspensa', '{}');
    raise exception 'FALHOU: status invalido aceito';
  exception when check_violation then null; end;

  -- 6. cobranças: 1 por competência; payment id único
  insert into crm_wa_oficial_cobrancas (assinatura_id, competencia, valor_centavos, status, gateway_payment_id)
    values (v_ass, '2026-10-01', 4900, 'aprovada', 'pay_1');
  begin
    insert into crm_wa_oficial_cobrancas (assinatura_id, competencia, valor_centavos, status)
      values (v_ass, '2026-10-01', 4900, 'pendente');
    raise exception 'FALHOU: 2a cobranca na mesma competencia aceita';
  exception when unique_violation then null; end;

  -- 7. eventos do gateway: dedupe por (gateway, evento_id)
  insert into crm_wa_oficial_gateway_eventos (gateway, evento_id, topico) values ('mercadopago','evt_1','payment');
  begin
    insert into crm_wa_oficial_gateway_eventos (gateway, evento_id) values ('mercadopago','evt_1');
    raise exception 'FALHOU: evento duplicado aceito';
  exception when unique_violation then null; end;

  -- 8. vínculos append-only aceitam N linhas do mesmo número
  insert into crm_wa_oficial_numero_vinculos (numero_e164, agente_parceiro_id, instancia_id, trial_concedido) values ('5561999990000', v_ag, v_inst, true);
  insert into crm_wa_oficial_numero_vinculos (numero_e164, agente_parceiro_id, instancia_id, trial_concedido) values ('5561999990000', v_ag, v_inst2, false);

  raise notice 'TODOS OS TESTES DE CONSTRAINT PASSARAM';
end $$;
do $$
declare r record; faltando text := '';
begin
  for r in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'crm_wa_oficial%'
  loop
    if not r.relrowsecurity then faltando := faltando || ' ' || r.relname; end if;
  end loop;
  if faltando <> '' then raise exception 'FALHOU: RLS desligada em:%', faltando; end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename like 'crm_wa_oficial%') then
    raise exception 'FALHOU: policy inesperada'; end if;
  raise notice 'RLS OK (service-role-only) nas 5 tabelas novas';
end $$;
rollback;
