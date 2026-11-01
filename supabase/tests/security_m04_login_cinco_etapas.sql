-- Teste SQL da M04 (rodar DEPOIS da migration 20261101030000, em banco descartavel; ver run-m04.sh).
-- Usuarios (00000004-...): 01 interno (perfil com sistema-comunicados) | 02 interno 2 | 03 parceiro sem linha em users
-- | 04 parceiro COM linha e marca external | 05 interno desativado.
begin;
create function pg_temp.claims(uid uuid, sid uuid, aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',uid,'session_id',sid,'aal',aal,
    'app_metadata', case when uid = '00000004-0000-4000-8000-000000000004' then '{"external":true}'::jsonb else '{}'::jsonb end)::text, true) $$;
create function pg_temp.hp(uid uuid, sid uuid, aal text) returns boolean language plpgsql as $$
begin
  perform pg_temp.claims(uid, sid, aal);
  return app_private.has_permission('sistema-comunicados','can_view');
end $$;

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('00000004-0000-4000-8000-000000000001','authenticated','authenticated','m04.a@brspromotora.com.br','{}',now(),now()),
  ('00000004-0000-4000-8000-000000000002','authenticated','authenticated','m04.b@brspromotora.com.br','{}',now(),now()),
  ('00000004-0000-4000-8000-000000000003','authenticated','authenticated','m04.p@gmail.com','{"external":true}',now(),now()),
  ('00000004-0000-4000-8000-000000000004','authenticated','authenticated','m04.x@parceiro.brspromotora.com.br','{"external":true}',now(),now()),
  ('00000004-0000-4000-8000-000000000005','authenticated','authenticated','m04.off@brspromotora.com.br','{}',now(),now());
insert into public.access_profiles (id, name) values ('00000004-0000-4000-8000-0000000000a1','M04 PERFIL');
insert into public.profile_permissions (profile_id, resource_name, can_view) values ('00000004-0000-4000-8000-0000000000a1','sistema-comunicados',true);
insert into public.users (id, name, email, role, profile_id, active) values
  ('00000004-0000-4000-8000-000000000001','A','m04.a@brspromotora.com.br','consulta','00000004-0000-4000-8000-0000000000a1',true),
  ('00000004-0000-4000-8000-000000000002','B','m04.b@brspromotora.com.br','consulta','00000004-0000-4000-8000-0000000000a1',true),
  ('00000004-0000-4000-8000-000000000004','X','m04.x@parceiro.brspromotora.com.br','consulta','00000004-0000-4000-8000-0000000000a1',true),
  ('00000004-0000-4000-8000-000000000005','OFF','m04.off@brspromotora.com.br','consulta','00000004-0000-4000-8000-0000000000a1',false);

-- Sessoes: s1 so senha (aal1); s2 senha+TOTP (aal2, fator f1); s3 outra sessao do mesmo usuario com TOTP; s4 do usuario B.
insert into auth.mfa_factors (id, user_id, factor_type, status) values
  ('00000004-0000-4000-8000-0000000000f1','00000004-0000-4000-8000-000000000001','totp','verified'),
  ('00000004-0000-4000-8000-0000000000f2','00000004-0000-4000-8000-000000000002','totp','verified');
insert into auth.sessions (id, user_id, factor_id, aal) values
  ('00000004-0000-4000-8000-0000000000e1','00000004-0000-4000-8000-000000000001',null,'aal1'),
  ('00000004-0000-4000-8000-0000000000e2','00000004-0000-4000-8000-000000000001','00000004-0000-4000-8000-0000000000f1','aal2'),
  ('00000004-0000-4000-8000-0000000000e3','00000004-0000-4000-8000-000000000001','00000004-0000-4000-8000-0000000000f1','aal2'),
  ('00000004-0000-4000-8000-0000000000e4','00000004-0000-4000-8000-000000000002','00000004-0000-4000-8000-0000000000f2','aal2'),
  ('00000004-0000-4000-8000-0000000000e5','00000004-0000-4000-8000-000000000003',null,'aal1'),
  ('00000004-0000-4000-8000-0000000000e6','00000004-0000-4000-8000-000000000004',null,'aal1');
insert into auth.mfa_amr_claims (session_id, authentication_method)
  select s, m from unnest(array['00000004-0000-4000-8000-0000000000e1','00000004-0000-4000-8000-0000000000e2','00000004-0000-4000-8000-0000000000e3',
    '00000004-0000-4000-8000-0000000000e4','00000004-0000-4000-8000-0000000000e5','00000004-0000-4000-8000-0000000000e6']::uuid[]) s, unnest(array['password']) m;
insert into auth.mfa_amr_claims (session_id, authentication_method)
  select s, 'totp' from unnest(array['00000004-0000-4000-8000-0000000000e2','00000004-0000-4000-8000-0000000000e3','00000004-0000-4000-8000-0000000000e4']::uuid[]) s;
-- fator f1 do usuario A aprovado; f2 de B NAO aprovado (fator verificado fora do registro nao libera)
insert into public.auth_mfa_fatores (factor_id, user_id) values ('00000004-0000-4000-8000-0000000000f1','00000004-0000-4000-8000-000000000001');

do $$
declare a uuid := '00000004-0000-4000-8000-000000000001'; b uuid := '00000004-0000-4000-8000-000000000002';
  p uuid := '00000004-0000-4000-8000-000000000003'; x uuid := '00000004-0000-4000-8000-000000000004'; off uuid := '00000004-0000-4000-8000-000000000005';
  e1 uuid := '00000004-0000-4000-8000-0000000000e1'; e2 uuid := '00000004-0000-4000-8000-0000000000e2'; e3 uuid := '00000004-0000-4000-8000-0000000000e3';
  e4 uuid := '00000004-0000-4000-8000-0000000000e4'; e5 uuid := '00000004-0000-4000-8000-0000000000e5'; e6 uuid := '00000004-0000-4000-8000-0000000000e6';
  r jsonb; h text := repeat('a', 64); n int; d uuid;
begin
  -- 1. sem liberacao nenhuma: interno nao tem permissao em nenhum estado
  if pg_temp.hp(a, e1, 'aal1') then raise exception 'FALHA: so senha tem permissao'; end if;
  if pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: senha+TOTP sem e-mail tem permissao'; end if;
  raise notice 'OK so senha e senha+TOTP (sem e-mail) => has_permission false';

  -- 2. criar desafio: sessao so com senha nao pede acesso (etapa_anterior); ativacao negada a quem ja tem fator
  r := public.auth_criar_desafio(a, e1, 'acesso_workspace', h);
  if r->>'status' <> 'etapa_anterior' then raise exception 'FALHA: desafio de acesso sem TOTP: %', r; end if;
  r := public.auth_criar_desafio(a, e1, 'ativacao_fator', h);
  if r->>'status' <> 'negado' then raise exception 'FALHA: ativacao com fator ja aprovado: %', r; end if;
  r := public.auth_criar_desafio(p, e5, 'ativacao_fator', h);
  if r->>'status' <> 'negado' then raise exception 'FALHA: parceiro sem linha em users recebeu desafio: %', r; end if;
  r := public.auth_criar_desafio(x, e6, 'ativacao_fator', h);
  if r->>'status' <> 'negado' then raise exception 'FALHA: parceiro (dominio parceiro) recebeu desafio: %', r; end if;
  r := public.auth_criar_desafio(off, e1, 'acesso_workspace', h);
  if r->>'status' <> 'negado' then raise exception 'FALHA: desativado recebeu desafio: %', r; end if;
  raise notice 'OK desafio negado: sem TOTP, com fator ja aprovado, parceiro, desativado';

  -- 3. desafio normal na sessao e2; destino vem do banco
  r := public.auth_criar_desafio(a, e2, 'acesso_workspace', h);
  if r->>'status' <> 'ok' or r->>'destino' <> 'm04.a@brspromotora.com.br' then raise exception 'FALHA: desafio ok: %', r; end if;
  d := (r->>'desafio_id')::uuid;
  r := public.auth_criar_desafio(a, e2, 'acesso_workspace', h);
  if r->>'status' <> 'reenvio_cedo' then raise exception 'FALHA: reenvio imediato: %', r; end if;
  raise notice 'OK desafio criado com destino do banco; reenvio < 60 s negado';

  -- 4. codigo de OUTRA sessao (e3) nao serve; sem desafio => inexistente
  r := public.auth_verificar_desafio(a, e3, 'acesso_workspace', h);
  if r->>'status' <> 'inexistente' then raise exception 'FALHA: codigo de outra sessao: %', r; end if;
  if pg_temp.hp(a, e3, 'aal2') then raise exception 'FALHA: sessao e3 liberada sem desafio'; end if;
  -- 5. codigo errado conta; certo libera; reutilizar => inexistente
  r := public.auth_verificar_desafio(a, e2, 'acesso_workspace', repeat('b', 64));
  if r->>'status' <> 'incorreto' then raise exception 'FALHA: codigo errado: %', r; end if;
  r := public.auth_verificar_desafio(a, e2, 'acesso_workspace', h);
  if r->>'status' <> 'liberado' then raise exception 'FALHA: codigo certo: %', r; end if;
  r := public.auth_verificar_desafio(a, e2, 'acesso_workspace', h);
  if r->>'status' <> 'inexistente' then raise exception 'FALHA: reutilizacao: %', r; end if;
  if not pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: sessao liberada nao tem permissao'; end if;
  raise notice 'OK liberacao so apos codigo certo; reutilizacao negada';

  -- 6. liberacao de uma sessao NAO vale em outra
  if pg_temp.hp(a, e3, 'aal2') then raise exception 'FALHA: liberacao de e2 valeu em e3'; end if;
  if pg_temp.hp(a, e1, 'aal1') then raise exception 'FALHA: liberacao de e2 valeu em e1'; end if;
  if pg_temp.hp(b, e2, 'aal2') then raise exception 'FALHA: liberacao do usuario A valeu para B'; end if;
  -- JWT aal1 com sessao liberada (claim adulterado/antigo) nao vale
  if pg_temp.hp(a, e2, 'aal1') then raise exception 'FALHA: aal1 com sessao liberada'; end if;
  -- sessao inexistente no Auth (logout) com a mesma liberacao
  delete from auth.sessions where id = e3;
  raise notice 'OK liberacao presa a user+session+aal2';

  -- 7. fator verificado fora do registro nao libera (usuario B, fator f2 nao aprovado)
  r := public.auth_criar_desafio(b, e4, 'acesso_workspace', h);
  if r->>'status' <> 'etapa_anterior' then raise exception 'FALHA: fator nao aprovado: %', r; end if;
  -- forcando a linha de liberacao sem fator aprovado, o gate ainda nega
  insert into public.auth_desafios_email (id, user_id, session_id, finalidade, destino_email, codigo_hash, expira_em, max_tentativas)
    values ('00000004-0000-4000-8000-0000000000d9', b, e4, 'acesso_workspace', 'x', h, now()+interval '5 min', 5);
  insert into public.auth_sessao_liberacoes (user_id, session_id, finalidade, desafio_id, expira_em)
    values (b, e4, 'acesso_workspace', '00000004-0000-4000-8000-0000000000d9', now()+interval '1 hour');
  if pg_temp.hp(b, e4, 'aal2') then raise exception 'FALHA: fator nao aprovado liberou'; end if;
  raise notice 'OK fator fora do registro aprovado nao libera';

  -- 8. expirada nao vale; revogada nao vale; bloqueio admin nao vale; desativado nao vale
  update public.auth_sessao_liberacoes set expira_em = now() - interval '1 second' where session_id = e2;
  if pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: liberacao expirada valeu'; end if;
  update public.auth_sessao_liberacoes set expira_em = now() + interval '1 hour' where session_id = e2;
  if not pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: liberacao renovada nao vale'; end if;
  perform public.auth_bloquear_usuario(a, null, 'teste', b);
  if pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: bloqueio administrativo ignorado'; end if;
  perform public.auth_desbloquear_usuario(a, b, 'teste');
  select count(*) into n from public.auth_bloqueios_admin where user_id = a and removido_por = b and bloqueado_por = b;
  if n < 1 then raise exception 'FALHA: bloqueio nao registra quem bloqueou/desbloqueou'; end if;
  -- bloquear revogou liberacoes: precisa de novo codigo
  if pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: liberacao sobreviveu ao bloqueio'; end if;
  raise notice 'OK expirada, revogada e bloqueio administrativo negam; registra quem bloqueou/desbloqueou';

  -- 9. mudanca de cadastro revoga (desativar usuario / trocar e-mail)
  delete from public.auth_sessao_liberacoes where session_id = e2;
  delete from public.auth_desafios_email where session_id = e2;  -- limpa rate limit do teste
  r := public.auth_criar_desafio(a, e2, 'acesso_workspace', h);
  r := public.auth_verificar_desafio(a, e2, 'acesso_workspace', h);
  if not pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: reliberacao'; end if;
  update public.users set email = 'm04.novo@brspromotora.com.br' where id = a;
  if pg_temp.hp(a, e2, 'aal2') then raise exception 'FALHA: troca de e-mail nao revogou'; end if;
  update public.users set email = 'm04.a@brspromotora.com.br' where id = a;
  raise notice 'OK troca de e-mail revoga liberacao';

  -- 10. nao internos NAO sao afetados: parceiro com linha e marca external segue regra antiga (sem gate)
  if not pg_temp.hp(x, e6, 'aal1') then raise exception 'FALHA: gate afetou parceiro com linha em users'; end if;
  if app_private.sessao_interna_ok() is not true then raise exception 'FALHA: sessao_interna_ok deveria passar para parceiro'; end if;
  perform pg_temp.claims(p, e5, 'aal1');
  if app_private.sessao_interna_liberada() then raise exception 'FALHA: sessao_interna_liberada true para parceiro'; end if;
  raise notice 'OK nao internos nao afetados (parceiro com linha passa pela regra antiga; sem linha nunca recebe permissao)';
end $$;

-- 11. contadores e pausas (cada etapa separada, atomico, sem 24 h)
do $$
declare r jsonb; i int;
begin
  for i in 1..2 loop r := public.auth_registrar_falha('k1', 'senha'); end loop;
  if (r->>'pausa_seg')::int <> 0 or (r->>'restantes')::int <> 1 then raise exception 'FALHA: 2 erros ainda sem pausa: %', r; end if;
  r := public.auth_registrar_falha('k1', 'senha');
  if (r->>'pausa_seg')::int not between 295 and 300 then raise exception 'FALHA: 3o erro => pausa 5 min: %', r; end if;
  if public.auth_pausa_atual('k1', 'senha') < 295 then raise exception 'FALHA: pausa_atual'; end if;
  if public.auth_pausa_atual('k1', 'totp') <> 0 then raise exception 'FALHA: contadores nao sao separados por etapa'; end if;
  -- em pausa nada soma
  r := public.auth_registrar_falha('k1', 'senha');
  if (select pausas from public.auth_tentativas where chave='k1' and etapa='senha') <> 1 then raise exception 'FALHA: falha em pausa somou'; end if;
  -- reincidencia: vence a pausa, mais 3 erros => 15 min
  update public.auth_tentativas set pausa_ate = now() - interval '1 second', ultima_falha = now() where chave='k1';
  for i in 1..3 loop r := public.auth_registrar_falha('k1', 'senha'); end loop;
  if (r->>'pausa_seg')::int not between 890 and 900 or (r->>'alerta')::boolean is not true then raise exception 'FALHA: reincidencia => 15 min + alerta: %', r; end if;
  -- escada nunca passa de 240 min (sem 24 h)
  if app_private.auth_pausa_minutos(50) <> 240 or app_private.auth_pausa_minutos(1) <> 5 then raise exception 'FALHA: escada'; end if;
  -- sucesso zera
  perform public.auth_registrar_sucesso('k1', 'senha');
  if public.auth_pausa_atual('k1', 'senha') <> 0 then raise exception 'FALHA: sucesso nao zerou'; end if;
  -- 2 erros antigos (>15 min) nao somam com o novo
  perform public.auth_registrar_falha('k2', 'totp'); perform public.auth_registrar_falha('k2', 'totp');
  update public.auth_tentativas set ultima_falha = now() - interval '20 minutes' where chave='k2';
  r := public.auth_registrar_falha('k2', 'totp');
  if (r->>'pausa_seg')::int <> 0 then raise exception 'FALHA: janela de 15 min'; end if;
  raise notice 'OK 3 erros => 5 min; reincidencia 15 min + alerta; etapas separadas; teto 240 min; sucesso zera; janela 15 min';
end $$;

-- 12. 3 codigos errados de e-mail => pausa por usuario (verificar fica em 'pausa'); esgotar tentativas invalida
do $$
declare a uuid := '00000004-0000-4000-8000-000000000002'; r jsonb; s uuid := '00000004-0000-4000-8000-0000000000e4'; i int;
begin
  insert into public.auth_mfa_fatores (factor_id, user_id) values ('00000004-0000-4000-8000-0000000000f2', a) on conflict do nothing;
  delete from public.auth_sessao_liberacoes where user_id = a; delete from public.auth_desafios_email where user_id = a;
  r := public.auth_criar_desafio(a, s, 'acesso_workspace', repeat('c', 64));
  if r->>'status' <> 'ok' then raise exception 'FALHA: desafio B: %', r; end if;
  for i in 1..3 loop r := public.auth_verificar_desafio(a, s, 'acesso_workspace', repeat('d', 64)); end loop;
  if (r->>'pausa_seg')::int < 295 then raise exception 'FALHA: 3 codigos errados sem pausa: %', r; end if;
  r := public.auth_verificar_desafio(a, s, 'acesso_workspace', repeat('c', 64));
  if r->>'status' <> 'pausa' then raise exception 'FALHA: codigo certo durante pausa deveria ficar em pausa: %', r; end if;
  r := public.auth_criar_desafio(a, s, 'acesso_workspace', repeat('c', 64));
  if r->>'status' <> 'pausa' then raise exception 'FALHA: novo desafio durante pausa: %', r; end if;
  raise notice 'OK pausa por 3 codigos de e-mail errados bloqueia verificar e novo envio';
end $$;

-- 13. ativacao inicial: so com prova de e-mail; aprovar fator exige prova; nao da para pular
do $$
declare c uuid := '00000004-0000-4000-8000-000000000006'; s uuid := '00000004-0000-4000-8000-0000000000e7'; f uuid := '00000004-0000-4000-8000-0000000000f7';
  r jsonb; h text := repeat('e', 64);
begin
  insert into auth.users (id, aud, role, email, created_at, updated_at) values (c,'authenticated','authenticated','m04.c@brspromotora.com.br',now(),now());
  insert into public.users (id, name, email, role, active) values (c,'C','m04.c@brspromotora.com.br','consulta',true);
  insert into auth.sessions (id, user_id, aal) values (s, c, 'aal1');
  insert into auth.mfa_amr_claims (session_id, authentication_method) values (s, 'password');
  insert into auth.mfa_factors (id, user_id, factor_type, status) values (f, c, 'totp', 'verified');
  if public.auth_aprovar_fator(c, s, f) <> 'sem_prova' then raise exception 'FALHA: aprovou fator sem prova de e-mail'; end if;
  if public.auth_pode_ativar_fator(c, s) then raise exception 'FALHA: pode ativar sem prova'; end if;
  r := public.auth_criar_desafio(c, s, 'ativacao_fator', h);
  if r->>'status' <> 'ok' then raise exception 'FALHA: desafio ativacao: %', r; end if;
  if public.auth_aprovar_fator(c, s, f) <> 'sem_prova' then raise exception 'FALHA: aprovou com desafio nao consumido'; end if;
  r := public.auth_verificar_desafio(c, s, 'ativacao_fator', h);
  if r->>'status' <> 'liberado' then raise exception 'FALHA: prova de ativacao: %', r; end if;
  -- a prova de ativacao NAO e acesso
  if app_private.sessao_liberada_para(c, s, 'aal2') then raise exception 'FALHA: prova de ativacao virou acesso'; end if;
  if public.auth_aprovar_fator(c, '00000004-0000-4000-8000-0000000000e1', f) <> 'sem_prova' then raise exception 'FALHA: prova de outra sessao valeu'; end if;
  if public.auth_aprovar_fator(c, s, f) <> 'ok' then raise exception 'FALHA: nao aprovou com prova valida'; end if;
  if public.auth_aprovar_fator(c, s, f) <> 'sem_prova' then raise exception 'FALHA: prova reutilizada'; end if;
  -- remover fator revoga tudo e permite nova ativacao
  perform public.auth_remover_fator(c, 'teste');
  if (select count(*) from public.auth_mfa_fatores where user_id = c and removido_em is null) <> 0 then raise exception 'FALHA: fator nao removido'; end if;
  raise notice 'OK ativacao: sem prova nao aprova; prova de outra sessao/reutilizada nao vale; remocao revoga';
end $$;

-- 14. tabelas e RPCs fechadas para anon/authenticated
do $$
declare t text; fn record; n int;
begin
  foreach t in array array['auth_mfa_fatores','auth_desafios_email','auth_sessao_liberacoes','auth_tentativas','auth_bloqueios_admin','acessos_log'] loop
    if has_table_privilege('anon', 'public.'||t, 'SELECT') or has_table_privilege('authenticated', 'public.'||t, 'SELECT')
       or has_table_privilege('authenticated', 'public.'||t, 'INSERT') then raise exception 'FALHA: % acessivel a anon/authenticated', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.'||t)::regclass) then raise exception 'FALHA: % sem RLS', t; end if;
    select count(*) into n from pg_policies where schemaname='public' and tablename=t;
    if n <> 0 then raise exception 'FALHA: % tem politica', t; end if;
    if not has_table_privilege('service_role', 'public.'||t, 'SELECT') then raise exception 'FALHA: service_role sem acesso a %', t; end if;
  end loop;
  for fn in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.proname like 'auth\_%' loop
    if has_function_privilege('anon', fn.oid, 'EXECUTE') or has_function_privilege('authenticated', fn.oid, 'EXECUTE') then
      raise exception 'FALHA: % executavel por anon/authenticated', fn.proname; end if;
  end loop;
  if has_function_privilege('anon', 'app_private.sessao_interna_liberada()', 'EXECUTE') then raise exception 'FALHA: anon executa gate'; end if;
  if not has_function_privilege('authenticated', 'app_private.sessao_interna_liberada()', 'EXECUTE') then raise exception 'FALHA: RLS precisa do gate'; end if;
  raise notice 'OK tabelas deny-all e RPCs so service_role';
end $$;
rollback;
