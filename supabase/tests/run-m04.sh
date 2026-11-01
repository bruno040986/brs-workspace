#!/usr/bin/env bash
# Runner local do M04 (banco DESCARTAVEL). Reaproveita run-m03a.sh (monta base + M03-A e testa M03-A),
# depois aplica stubs do Auth, a migration M04 (duas vezes: idempotencia) e roda o teste SQL da M04.
#   supabase/tests/run-m04.sh [container] [banco]
set -uo pipefail
CT="${1:-brs-security-20261031}"; DB="${2:-brs_m03a_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../migrations"
PSQL=(docker exec -i "$CT" psql -U postgres -v ON_ERROR_STOP=1 -q)
fail() { echo "FALHOU: $*" >&2; exit 1; }
"$HERE/run-m03a.sh" "$CT" "$DB" || fail "base M03-A"
"${PSQL[@]}" -d "$DB" < "$HERE/fixtures/30_m04_auth_stubs.sql" >/dev/null || fail "stubs auth"
for i in 1 2; do
  echo "== migrations M04 (passada $i)"
  for f in "$MIG"/20261101*.sql; do
    case "$f" in *20261101030000*) ;; *) continue;; esac
    "${PSQL[@]}" -d "$DB" < "$f" 2>&1 | grep -E 'NOTICE:.*M04|ERROR' ; [ "${PIPESTATUS[0]}" -eq 0 ] || fail "$(basename "$f")"
  done
done
echo "== teste SQL M04"
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
"${PSQL[@]}" -d "$DB" < "$HERE/security_m04_login_cinco_etapas.sql" > "$LOG" 2>&1; rc=$?
grep -E 'NOTICE:  OK|ERROR|FALHA' "$LOG" || true
[ "$rc" -eq 0 ] || fail "security_m04_login_cinco_etapas.sql"
echo "M04 TUDO OK"
