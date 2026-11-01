#!/usr/bin/env bash
# Runner local das decisoes de 01/11 (banco DESCARTAVEL). Reaproveita run-m04.sh e aplica M05/M06 por cima, aplica a migration
# 20261101060000 duas vezes (idempotencia) e roda security_decisoes_01_11.sql.
#   supabase/tests/run-decisoes.sh [container] [banco]
set -uo pipefail
CT="${1:-brs-security-20261031}"; DB="${2:-brs_dec_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../migrations"
PSQL=(docker exec -i "$CT" psql -U postgres -v ON_ERROR_STOP=1 -q)
fail() { echo "FALHOU: $*" >&2; exit 1; }
# Base: M03-A + M04 (run-m04.sh, com o portao de sessao) e, por cima, M05 e M06 (tabelas seg_*), no mesmo banco.
"$HERE/run-m04.sh" "$CT" "$DB" >/dev/null || fail "base M03-A/M04"
for f in "$MIG"/20261101040000*.sql "$MIG"/2026110104[56]000*.sql "$MIG"/2026110105[056]000*.sql; do "${PSQL[@]}" -d "$DB" < "$f" >/dev/null 2>&1 || fail "aplicar $(basename "$f")"; done
f="$MIG/20261101060000_security_decisoes_01_11.sql"
for i in 1 2; do echo "== migration $(basename "$f") (passada $i)"; "${PSQL[@]}" -d "$DB" < "$f" 2>&1 | grep -E 'ERROR'; [ "${PIPESTATUS[0]}" -eq 0 ] || fail "migration $f"; done
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
echo "== teste SQL decisoes 01/11"
"${PSQL[@]}" -d "$DB" < "$HERE/security_decisoes_01_11.sql" > "$LOG" 2>&1; rc=$?
grep -E 'NOTICE:  OK|ERROR|FALHA' "$LOG" || true
[ "$rc" -eq 0 ] || fail "security_decisoes_01_11.sql"
echo "DECISOES TUDO OK"
