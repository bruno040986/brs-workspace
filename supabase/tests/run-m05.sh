#!/usr/bin/env bash
# Runner local do M05 (banco DESCARTAVEL). Reaproveita run-m03a.sh, aplica a migration M05 duas vezes
# (idempotencia), roda security_m05_incidentes.sql e o teste de concorrencia (2+ sessoes, mesma chave).
#   supabase/tests/run-m05.sh [container] [banco]
set -uo pipefail
CT="${1:-brs-security-20261031}"; DB="${2:-brs_m05_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../migrations"
PSQL=(docker exec -i "$CT" psql -U postgres -v ON_ERROR_STOP=1 -q)
fail() { echo "FALHOU: $*" >&2; exit 1; }
"$HERE/run-m03a.sh" "$CT" "$DB" >/dev/null || fail "base M03-A"
for f in "$MIG/20261101040000_security_m05_incidentes.sql" "$MIG/20261101045000_security_m05_complemento.sql" "$MIG/20261101046000_security_m05_complemento2.sql"; do
  for i in 1 2; do echo "== migration $(basename "$f") (passada $i)"; "${PSQL[@]}" -d "$DB" < "$f" 2>&1 | grep -E 'NOTICE:.*M05|ERROR'; [ "${PIPESTATUS[0]}" -eq 0 ] || fail "migration $f"; done
done
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
echo "== teste SQL M05"
"${PSQL[@]}" -d "$DB" < "$HERE/security_m05_incidentes.sql" > "$LOG" 2>&1; rc=$?
grep -E 'NOTICE:  OK|ERROR|FALHA' "$LOG" || true
[ "$rc" -eq 0 ] || fail "security_m05_incidentes.sql"
echo "== teste SQL do complemento M05"
"${PSQL[@]}" -d "$DB" < "$HERE/security_m05_complemento.sql" > "$LOG" 2>&1; rc=$?
grep -E 'NOTICE:  OK|ERROR|FALHA' "$LOG" || true
[ "$rc" -eq 0 ] || fail "security_m05_complemento.sql"

echo "== concorrencia: 6 sessoes, mesma chave, 1 incidente"
EV() { echo "select public.seg_registrar_evento('{\"fonte\":\"teste\",\"id_origem\":\"conc-$1\",\"tipo\":\"login.falha\"}','[{\"regra\":\"conc_regra\",\"contexto\":\"mesma\",\"gravidade\":\"alta\"}]');"; }
pids=()
for n in 1 2 3 4 5 6; do
  { echo "begin;"; EV $n; echo "select pg_sleep(0.5); commit;"; } | "${PSQL[@]}" -d "$DB" >/dev/null 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || fail "sessao concorrente"; done
r=$("${PSQL[@]}" -d "$DB" -At -c "select (select count(*) from seg_incidentes where regra='conc_regra')||'/'||(select eventos_total from seg_incidentes where regra='conc_regra')||'/'||(select count(*) from seg_notificacao_intencoes n join seg_incidentes i on i.id=n.incidente_id where i.regra='conc_regra')")
[ "$r" = "1/6/1" ] || fail "concorrencia: esperado 1 incidente/6 eventos/1 intencao, veio $r"
echo "  OK 1 incidente, 6 eventos, 1 intencao"

echo "== concorrencia: claim simultaneo nao entrega a mesma intencao a dois donos"
"${PSQL[@]}" -d "$DB" -q -c "update seg_notificacao_intencoes set estado='cancelada' where estado='pendente'"
"${PSQL[@]}" -d "$DB" -q -c "insert into seg_notificacao_intencoes(incidente_id,versao_alerta,prioridade,dedupe_key,destino_logico) select id,9,'alta','claim-'||id,'bruno' from seg_incidentes where regra='conc_regra'" 
out=$(mktemp)
for o in A B C; do echo "select '$o:'||count(*) from public.seg_intencao_claim('$o',5);" | "${PSQL[@]}" -d "$DB" -At >> "$out" & done; wait
tot=$(awk -F: '{s+=$2} END{print s}' "$out"); rm -f "$out"
[ "$tot" = "1" ] || fail "claim concorrente entregou $tot vezes (esperado 1 intencao nova)"
echo "  OK"
echo "M05 TUDO OK"
