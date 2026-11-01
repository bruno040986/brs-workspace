-- Teste SQL do credencial_epoch (cookie de dispositivo confiavel). Rodar depois de 030000, 035000, 036000 e 037000.
begin;
do $$
declare u uuid := '00000004-0000-4000-8000-0000000000e1'; s uuid := '00000004-0000-4000-8000-0000000000e2'; e0 int; e1 int;
begin
  insert into auth.users (id, email, encrypted_password) values (u, 'epoch@brs.test', 'h0');
  if public.auth_credencial_epoch('00000004-0000-4000-8000-0000000000ee') is not null then raise exception 'FALHA: usuario inexistente deveria dar NULL'; end if;
  e0 := public.auth_credencial_epoch(u);
  if e0 <> 0 then raise exception 'FALHA: epoch inicial %', e0; end if;
  perform public.auth_revogar_sessao(u, s, 'logout');
  if public.auth_credencial_epoch(u) <> e0 then raise exception 'FALHA: logout comum subiu o epoch'; end if;
  update auth.users set encrypted_password = 'h1' where id = u;
  e1 := public.auth_credencial_epoch(u);
  if e1 <= e0 then raise exception 'FALHA: troca de senha nao subiu o epoch'; end if;
  perform public.auth_bloquear_usuario(u, null, 'teste', u);
  if public.auth_credencial_epoch(u) <= e1 then raise exception 'FALHA: bloqueio administrativo nao subiu o epoch'; end if;
  e1 := public.auth_credencial_epoch(u);
  perform public.auth_revogar_liberacoes(u, 'logout_todas', null);
  if public.auth_credencial_epoch(u) <= e1 then raise exception 'FALHA: logout todas nao subiu o epoch'; end if;
  e1 := public.auth_credencial_epoch(u);
  perform public.auth_revogar_sessao(u, s, 'negada');
  if public.auth_credencial_epoch(u) <= e1 then raise exception 'FALHA: sessao negada nao subiu o epoch'; end if;
  if has_function_privilege('anon', 'public.auth_credencial_epoch(uuid)', 'execute') or has_table_privilege('authenticated', 'public.auth_credencial_epoch', 'select') then
    raise exception 'FALHA: ACL aberta'; end if;
  raise notice 'OK credencial_epoch: sobe em senha/bloqueio/logout-todas/negada; nao sobe no logout comum; inexistente=NULL; ACL fechada';
end $$;
rollback;
