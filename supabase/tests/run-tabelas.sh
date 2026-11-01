#!/usr/bin/env bash
# Runner da migration 20261101070000 (banco DESCARTAVEL, independente dos outros runners).
#   supabase/tests/run-tabelas.sh [container] [banco]
set -uo pipefail
CT="${1:-brs-security-20261031}"; DB="${2:-brs_tab_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"; F="$HERE/../migrations/20261101070000_security_tabelas_portal_crm.sql"
PSQL=(docker exec -i "$CT" psql -U postgres -v ON_ERROR_STOP=1 -q)
fail() { echo "FALHOU: $*" >&2; exit 1; }
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" || fail "criar banco"
"${PSQL[@]}" -d "$DB" <<'SQL' || fail "esqueleto"
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop;
end $$;
create table public.chat_envios_operacoes (status text, updated_at timestamptz);
SQL
for i in 1 2; do echo "== migration (passada $i)"; "${PSQL[@]}" -d "$DB" < "$F" 2>&1 | grep -E 'ERROR'; [ "${PIPESTATUS[0]}" -eq 0 ] || fail "migration"; done
echo "== asserts"
"${PSQL[@]}" -d "$DB" <<'SQL' || fail "asserts"
do $$
declare t text; f text; n int;
begin
  foreach t in array array['cadastro_rate_limit_eventos','auth_throttle'] loop
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.'||t)) then raise exception 'sem RLS: %', t; end if;
    if has_table_privilege('anon', 'public.'||t, 'select,insert,update,delete') or has_table_privilege('authenticated', 'public.'||t, 'select,insert,update,delete') then raise exception 'anon/authenticated com privilegio: %', t; end if;
    if not has_table_privilege('service_role', 'public.'||t, 'select,insert') then raise exception 'service_role sem acesso: %', t; end if;
    if exists (select 1 from pg_policies where tablename = t) then raise exception 'policy inesperada: %', t; end if;
  end loop;
  foreach f in array array['auth_throttle_status(text)','auth_throttle_registrar(text,boolean,int,int,int)'] loop
    if not (select prosecdef and proconfig::text like '%search_path=%' from pg_proc where oid = ('public.'||f)::regprocedure) then raise exception 'funcao sem definer/search_path: %', f; end if;
    if has_function_privilege('anon', 'public.'||f, 'execute') or has_function_privilege('authenticated', 'public.'||f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = ('public.'||f)::regprocedure and a.grantee = 0) then raise exception 'execute indevido: %', f; end if;
    if not has_function_privilege('service_role', 'public.'||f, 'execute') then raise exception 'service_role sem execute: %', f; end if;
  end loop;
  if to_regclass('public.chat_envios_operacoes_presas_idx') is null then raise exception 'indice presas ausente'; end if;
  -- comportamento: 3 erros -> 300 s; reincidencia -> 600 s; sucesso zera
  perform public.auth_throttle_registrar('k', false, 3, 300, 7200); perform public.auth_throttle_registrar('k', false, 3, 300, 7200);
  if public.auth_throttle_registrar('k', false, 3, 300, 7200) <> 300 then raise exception 'pausa 1'; end if;
  if public.auth_throttle_status('k') not between 299 and 300 then raise exception 'status'; end if;
  update public.auth_throttle set bloqueado_ate = now() - interval '1 s' where chave = 'k';
  perform public.auth_throttle_registrar('k', false, 3, 300, 7200); perform public.auth_throttle_registrar('k', false, 3, 300, 7200);
  if public.auth_throttle_registrar('k', false, 3, 300, 7200) <> 600 then raise exception 'pausa 2'; end if;
  perform public.auth_throttle_registrar('k', true, 3, 300, 7200);
  if public.auth_throttle_status('k') <> 0 or exists (select 1 from public.auth_throttle) then raise exception 'sucesso nao zerou'; end if;
  raise notice 'OK tabelas';
end $$;
-- indice pulado quando falta a coluna
drop index public.chat_envios_operacoes_presas_idx; alter table public.chat_envios_operacoes drop column updated_at;
SQL
"${PSQL[@]}" -d "$DB" < "$F" 2>&1 | grep -E 'ERROR|NOTICE' ; [ "${PIPESTATUS[0]}" -eq 0 ] || fail "migration sem updated_at"
echo "TABELAS TUDO OK"
