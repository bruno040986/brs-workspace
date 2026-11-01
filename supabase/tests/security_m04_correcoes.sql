-- Teste SQL das correcoes pos-revisao do M04 (I2 pausa de senha por origem, I3 trigger de senha).
-- Rodar DEPOIS das migrations 030000 e 035000 (ver run-m04.sh). Banco descartavel; tudo em transacao com rollback.
begin;
do $$
declare r jsonb; i int; ua uuid := '00000004-0000-4000-8000-0000000000f1'; ub uuid := '00000004-0000-4000-8000-0000000000f2';
  s1 uuid := '00000004-0000-4000-8000-0000000000f3'; d uuid := '00000004-0000-4000-8000-0000000000f4'; n int;
begin
  -- I2.1 so-identificador (limiar 10, pausa FIXA 5 min): nao escala, nao cresce, decai
  for i in 1..9 loop r := public.auth_registrar_falha_limiar('si:A', 'senha', 10, 5, 'idA'); end loop;
  if (r->>'pausa_seg')::int <> 0 then raise exception 'FALHA: so-identificador pausou antes do limiar: %', r; end if;
  r := public.auth_registrar_falha_limiar('si:A', 'senha', 10, 5, 'idA');
  if (r->>'pausa_seg')::int not between 295 and 300 or (r->>'alerta')::boolean is not true then raise exception 'FALHA: pausa fixa 5 min + alerta: %', r; end if;
  -- em pausa nada soma
  r := public.auth_registrar_falha_limiar('si:A', 'senha', 10, 5, 'idA');
  if (select pausas from public.auth_tentativas where chave='si:A') <> 1 then raise exception 'FALHA: falha em pausa somou'; end if;
  -- 5 rodadas de ataque: a pausa continua 5 min (sem escalada indefinida)
  for i in 1..5 loop
    update public.auth_tentativas set pausa_ate = now() - interval '1 second', ultima_falha = now() where chave='si:A';
    for n in 1..10 loop r := public.auth_registrar_falha_limiar('si:A', 'senha', 10, 5, 'idA'); end loop;
    if (r->>'pausa_seg')::int > 300 then raise exception 'FALHA: pausa so-identificador cresceu: %', r; end if;
  end loop;
  if (select pausas from public.auth_tentativas where chave='si:A') <> 1 then raise exception 'FALHA: pausas escalou no so-identificador'; end if;
  -- decai: 25 h sem falha zera
  update public.auth_tentativas set pausa_ate = now() - interval '1 second', ultima_falha = now() - interval '25 hours' where chave='si:A';
  r := public.auth_registrar_falha_limiar('si:A', 'senha', 10, 5, 'idA');
  if (r->>'pausa_seg')::int <> 0 or (select falhas from public.auth_tentativas where chave='si:A') <> 1 then raise exception 'FALHA: sem decaimento: %', r; end if;
  raise notice 'OK I2 so-identificador: pausa fixa 5 min, alerta, sem escalada indefinida, decai';

  -- I2.2 chaves independentes: pausa do so-identificador nao e a chave (identificador, origem) nem a do IP
  update public.auth_tentativas set pausa_ate = now() + interval '5 minutes' where chave='si:A';
  if public.auth_pausa_atual('s:A|1.1.1.1', 'senha') <> 0 or public.auth_pausa_atual('ip:1.1.1.1', 'senha') <> 0 then
    raise exception 'FALHA: chaves de senha nao sao independentes'; end if;
  -- par (identificador, origem): escalonada 3 => 5 min, apenas para quem errou
  for i in 1..3 loop r := public.auth_registrar_falha_limiar('s:A|9.9.9.9', 'senha', 3, null, 'idA'); end loop;
  if (r->>'pausa_seg')::int not between 295 and 300 then raise exception 'FALHA: par identificador+origem 3 erros: %', r; end if;
  if public.auth_pausa_atual('s:A|2.2.2.2', 'senha') <> 0 then raise exception 'FALHA: pausa do par vazou para outra origem'; end if;
  raise notice 'OK I2 par (identificador, origem) pausa so a origem que errou';

  -- I2.3 limitador por IP: 20 falhas => pausa fixa
  for i in 1..19 loop r := public.auth_registrar_falha_limiar('ip:3.3.3.3', 'senha', 20, 5, null); end loop;
  if (r->>'pausa_seg')::int <> 0 then raise exception 'FALHA: IP pausou antes de 20'; end if;
  r := public.auth_registrar_falha_limiar('ip:3.3.3.3', 'senha', 20, 5, null);
  if (r->>'pausa_seg')::int not between 295 and 300 then raise exception 'FALHA: limitador por IP: %', r; end if;
  raise notice 'OK I2 limitador por IP (20 falhas => pausa)';

  -- I2.4 desbloqueio zera TODAS as chaves de senha do usuario (pelo identificador), e so as dele
  perform public.auth_registrar_falha_limiar('si:B', 'senha', 10, 5, 'idB');
  update public.auth_tentativas set pausa_ate = now() + interval '5 minutes' where chave in ('si:B');
  insert into auth.users (id, aud, role, email, created_at, updated_at) values
    (ua,'authenticated','authenticated','m04.f1@brspromotora.com.br',now(),now()), (ub,'authenticated','authenticated','m04.f2@brspromotora.com.br',now(),now());
  perform public.auth_desbloquear_usuario(ua, ub, 'teste', 'idA');
  if public.auth_pausa_atual('si:A', 'senha') <> 0 or public.auth_pausa_atual('s:A|9.9.9.9', 'senha') <> 0 then raise exception 'FALHA: desbloqueio nao zerou chaves de senha do usuario'; end if;
  if public.auth_pausa_atual('si:B', 'senha') = 0 then raise exception 'FALHA: desbloqueio zerou chave de OUTRO usuario'; end if;
  if public.auth_pausa_atual('ip:3.3.3.3', 'senha') = 0 then raise exception 'FALHA: desbloqueio zerou limitador de IP'; end if;
  raise notice 'OK I2 desbloqueio zera as chaves de senha do usuario';

  -- I3 trocar encrypted_password revoga liberacoes (qualquer caminho: UPDATE direto no auth.users)
  insert into public.auth_desafios_email (id, user_id, session_id, finalidade, destino_email, codigo_hash, expira_em, max_tentativas)
    values (d, ua, s1, 'acesso_workspace', 'x', repeat('f',64), now()+interval '5 min', 5);
  insert into public.auth_sessao_liberacoes (user_id, session_id, finalidade, desafio_id, expira_em) values (ua, s1, 'acesso_workspace', d, now()+interval '1 hour');
  update auth.users set updated_at = now() where id = ua;
  if (select revogada_em from public.auth_sessao_liberacoes where session_id = s1) is not null then raise exception 'FALHA: update sem senha revogou'; end if;
  update auth.users set encrypted_password = 'novo-hash' where id = ua;
  if (select revogada_em from public.auth_sessao_liberacoes where session_id = s1) is null then raise exception 'FALHA: troca de senha nao revogou liberacao'; end if;
  raise notice 'OK I3 troca de senha no Auth revoga liberacoes';

  -- ACL: so service_role
  if has_function_privilege('authenticated', 'public.auth_registrar_falha_limiar(text,text,int,int,text)', 'execute')
     or has_function_privilege('anon', 'public.auth_desbloquear_usuario(uuid,uuid,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.auth_registrar_falha_limiar(text,text,int,int,text)', 'execute') then
    raise exception 'FALHA: ACL das novas RPCs'; end if;
  raise notice 'OK ACL das novas RPCs (so service_role)';
end $$;
rollback;
