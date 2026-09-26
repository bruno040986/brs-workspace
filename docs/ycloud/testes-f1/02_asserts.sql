\set ON_ERROR_STOP on
begin;

-- helpers de teste: cada bloco espera sucesso ou falha específica
do $$
declare
  v_agente uuid; v_conexao uuid; v_conexao2 uuid; v_inst uuid;
begin
  insert into agentes_parceiros default values returning id into v_agente;

  -- 1. conexão parceiro sem agente → deve falhar
  begin
    insert into ycloud_conexoes (owner_tipo, nome, api_key_cifrada) values ('parceiro', 'x', 'enc');
    raise exception 'FALHOU: parceiro sem agente foi aceito';
  exception when check_violation then null;
  end;

  -- 2. conexão brs com agente → deve falhar
  begin
    insert into ycloud_conexoes (owner_tipo, agente_parceiro_id, nome, api_key_cifrada)
      values ('brs', v_agente, 'x', 'enc');
    raise exception 'FALHOU: brs com agente foi aceito';
  exception when check_violation then null;
  end;

  -- 3. conexão parceiro válida
  insert into ycloud_conexoes (owner_tipo, agente_parceiro_id, nome, api_key_cifrada)
    values ('parceiro', v_agente, 'p1', 'enc') returning id into v_conexao;

  -- 4. segunda conexão ATIVA do mesmo parceiro → deve falhar (unique parcial)
  begin
    insert into ycloud_conexoes (owner_tipo, agente_parceiro_id, nome, api_key_cifrada)
      values ('parceiro', v_agente, 'p2', 'enc');
    raise exception 'FALHOU: 2a conexao ativa do mesmo parceiro aceita';
  exception when unique_violation then null;
  end;

  -- 5. após remover, nova conexão do mesmo parceiro é aceita
  update ycloud_conexoes set status = 'removida' where id = v_conexao;
  insert into ycloud_conexoes (owner_tipo, agente_parceiro_id, nome, api_key_cifrada)
    values ('parceiro', v_agente, 'p3', 'enc') returning id into v_conexao2;

  -- 6. duas conexões BRS ativas → deve falhar
  insert into ycloud_conexoes (owner_tipo, nome, api_key_cifrada) values ('brs', 'brs1', 'enc');
  begin
    insert into ycloud_conexoes (owner_tipo, nome, api_key_cifrada) values ('brs', 'brs2', 'enc');
    raise exception 'FALHOU: 2a conexao BRS ativa aceita';
  exception when unique_violation then null;
  end;

  -- 7. instância ycloud SEM conexão → deve falhar
  begin
    insert into chat_instancias (provedor, numero) values ('ycloud', '5511999990000');
    raise exception 'FALHOU: instancia ycloud sem conexao aceita';
  exception when check_violation then null;
  end;

  -- 8. instância ycloud com conexão → ok
  insert into chat_instancias (provedor, numero, ycloud_conexao_id)
    values ('ycloud', '5511999990000', v_conexao2) returning id into v_inst;

  -- 9. mesmo número ycloud ativo em outra instância → deve falhar
  begin
    insert into chat_instancias (provedor, numero, ycloud_conexao_id)
      values ('ycloud', '5511999990000', v_conexao2);
    raise exception 'FALHOU: numero ycloud duplicado aceito';
  exception when unique_violation then null;
  end;

  -- 10. soft-delete libera o número
  update chat_instancias set deleted_at = now() where id = v_inst;
  insert into chat_instancias (provedor, numero, ycloud_conexao_id)
    values ('ycloud', '5511999990000', v_conexao2);

  -- 11. baileys continua aceito sem conexão (regressão)
  insert into chat_instancias (provedor) values ('baileys');

  -- 12. provedor inválido continua recusado
  begin
    insert into chat_instancias (provedor) values ('telegram');
    raise exception 'FALHOU: provedor invalido aceito';
  exception when check_violation then null;
  end;

  -- 13. chat_engine_jobs aceita source ycloud e mantém dedupe
  insert into chat_engine_jobs (source, scope, event_key) values ('ycloud', 'c1', 'evt1');
  begin
    insert into chat_engine_jobs (source, scope, event_key) values ('ycloud', 'c1', 'evt1');
    raise exception 'FALHOU: evento duplicado aceito na inbox';
  exception when unique_violation then null;
  end;

  -- 14. ycloud_mensagens: ycloud_id único; direcao validada
  insert into ycloud_mensagens (instancia_id, ycloud_id, direcao)
    select id, 'ym_1', 'out' from chat_instancias where provedor = 'ycloud' and deleted_at is null limit 1;
  begin
    insert into ycloud_mensagens (instancia_id, ycloud_id, direcao)
      select id, 'ym_1', 'out' from chat_instancias where provedor = 'ycloud' and deleted_at is null limit 1;
    raise exception 'FALHOU: ycloud_id duplicado aceito';
  exception when unique_violation then null;
  end;

  raise notice 'TODOS OS TESTES DE CONSTRAINT PASSARAM';
end $$;

-- 15. RLS ligada em todas as tabelas novas
do $$
declare r record; faltando text := '';
begin
  for r in select c.relname, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in
      ('ycloud_conexoes','ycloud_numeros_saude','ycloud_numeros_saude_eventos',
       'ycloud_templates','ycloud_saldos','ycloud_mensagens')
  loop
    if not r.relrowsecurity then faltando := faltando || ' ' || r.relname; end if;
  end loop;
  if faltando <> '' then raise exception 'FALHOU: RLS desligada em:%', faltando; end if;
  raise notice 'RLS OK nas 6 tabelas novas';
end $$;

-- 16. nenhuma policy criada (service-role-only)
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'ycloud_%') then
    raise exception 'FALHOU: policy inesperada em tabela ycloud_*';
  end if;
  raise notice 'Sem policies (service-role-only) OK';
end $$;

-- 17. seed de permissões copiou do root
do $$
declare n int;
begin
  select count(*) into n from profile_permissions
    where resource_name in ('sistema-config-whatsapp-oficial','conversas-whatsapp-oficial-saude');
  if n <> 2 then raise exception 'FALHOU: seed profile_permissions = %', n; end if;
  select count(*) into n from user_permissions
    where resource_name in ('sistema-config-whatsapp-oficial','conversas-whatsapp-oficial-saude');
  if n <> 2 then raise exception 'FALHOU: seed user_permissions = %', n; end if;
  raise notice 'Seed de permissoes OK';
end $$;

rollback;
