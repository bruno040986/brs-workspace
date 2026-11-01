#!/usr/bin/env bash
# Runner local do pacote M03-A (banco DESCARTÁVEL; nunca aponte para produção).
#   supabase/tests/run-m03a.sh [container] [banco]
# Requer um container Postgres 17 puro (ex.: docker run postgres:17-alpine) acessível com
# `docker exec -i <container> psql -U postgres`. Cria o banco, aplica stubs do Supabase,
# esqueleto das tabelas "órfãs", TODAS as migrations anteriores às de segurança, depois as
# de segurança (20261101*) com ON_ERROR_STOP e roda os testes SQL. Falha = exit != 0.
set -uo pipefail
CT="${1:-brs-security-20261031}"
DB="${2:-brs_m03a_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../migrations"
PSQL=(docker exec -i "$CT" psql -U postgres -v ON_ERROR_STOP=1 -q)
LAX=(docker exec -i "$CT" psql -U postgres -q)
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
fail() { echo "FALHOU: $*" >&2; exit 1; }

"${LAX[@]}" -d postgres -c "drop database if exists $DB" -c "drop database if exists ${DB}_abort" -c "create database $DB" >/dev/null || fail "criar banco"
"${LAX[@]}" -d postgres -c "alter database $DB set search_path = public, extensions" >/dev/null
"${PSQL[@]}" -d "$DB" < "$HERE/fixtures/00_supabase_stubs.sql" >/dev/null || fail "stubs"
"${PSQL[@]}" -d "$DB" < "$HERE/fixtures/10_workspace_base_skeleton.sql" >/dev/null || fail "esqueleto"

echo "== migrations anteriores (erros toleraveis listados; dependem de tabelas fora do repo)"
erros=0
for f in "$MIG"/*.sql; do
  case "$f" in *20261101*) continue;; esac
  out=$("${LAX[@]}" -d "$DB" < "$f" 2>&1 | grep -E '^ERROR' | head -2)
  if [ -n "$out" ]; then erros=$((erros+1)); echo "  $(basename "$f"): $out"; fi
done
echo "  migrations com erro: $erros"

"${PSQL[@]}" -d "$DB" < "$HERE/fixtures/20_legacy_admin_accounts.sql" >/dev/null || fail "fixtures de contas legadas"

echo "== copia pre-seguranca para o teste de aborto"
"${LAX[@]}" -d postgres -c "create database ${DB}_abort template $DB" >/dev/null || fail "template"

echo "== migrations de seguranca (ON_ERROR_STOP)"
# M03A_SKIP_SECURITY=1 pula as migrations de seguranca: os testes DEVEM falhar (prova de que nao passam vazios).
for f in "$MIG"/20261101*.sql; do
  [[ "$(basename "$f")" > "20261101029999" ]] && continue # M04 tem runner proprio (run-m04.sh)
  [ "${M03A_SKIP_SECURITY:-0}" = 1 ] && break
  echo "  $(basename "$f")"
  "${PSQL[@]}" -d "$DB" < "$f" > "$LOG" 2>&1; rc=$?
  grep -E 'NOTICE:.*M03-A|ERROR' "$LOG" || true
  [ "$rc" -eq 0 ] || fail "$(basename "$f")"
done
echo "== reaplicar (idempotencia)"
[ "${M03A_SKIP_SECURITY:-0}" = 1 ] || for f in "$MIG"/20261101*.sql; do [[ "$(basename "$f")" > "20261101029999" ]] && continue; "${PSQL[@]}" -d "$DB" < "$f" >/dev/null 2>&1 || fail "reaplicar $(basename "$f")"; done

echo "== testes SQL"
for t in "$HERE"/security_initial_rls_hardening.sql "$HERE"/security_m03a_workspace_containment.sql "$HERE"/security_m03a_complemento.sql; do
  echo "  $(basename "$t")"
  "${PSQL[@]}" -d "$DB" < "$t" > "$LOG" 2>&1; rc=$?
  grep -E 'NOTICE:  OK|ERROR|FALHA' "$LOG" || true
  [ "$rc" -eq 0 ] || fail "$(basename "$t")"
done

echo "== aborto diante de politica desconhecida em disciplinary_records"
"${PSQL[@]}" -d "${DB}_abort" -c "create policy meu_acesso_estranho on public.disciplinary_records for select to authenticated using (auth.uid() is not null)" >/dev/null
if "${PSQL[@]}" -d "${DB}_abort" < "$MIG/20261101010000_security_initial_rls_hardening.sql" >/dev/null 2>&1; then
  fail "migration deveria abortar com politica desconhecida"
fi
echo "  OK abortou (nada removido em silencio)"
n=$("${LAX[@]}" -d "${DB}_abort" -At -c "select count(*) from pg_policies where tablename='disciplinary_records' and policyname='meu_acesso_estranho'")
[ "$n" = "1" ] || fail "politica desconhecida foi removida mesmo com o aborto"
{ echo "set brs.m03a_drop_policies = 'meu_acesso_estranho';"; cat "$MIG/20261101010000_security_initial_rls_hardening.sql"; } \
  | "${PSQL[@]}" -d "${DB}_abort" >/dev/null 2>&1 || fail "migration deveria passar com a politica autorizada"
n=$("${LAX[@]}" -d "${DB}_abort" -At -c "select count(*) from pg_policies where tablename='disciplinary_records' and policyname='meu_acesso_estranho'")
[ "$n" = "0" ] || fail "politica autorizada nao foi removida"
echo "  OK removeu so apos autorizacao explicita"

"${LAX[@]}" -d postgres -c "drop database if exists ${DB}_abort" >/dev/null
echo "TUDO OK"
