#!/usr/bin/env bash
# Runner local do M06 (banco DESCARTAVEL). Reaproveita run-m05.sh (base M03-A + M05), aplica a migration M06 duas vezes
# (idempotencia), roda security_m06_notificacoes.sql e o teste de concorrencia do orcamento (12 sessoes).
#   supabase/tests/run-m06.sh [container] [banco]
set -uo pipefail
CT="${1:-brs-security-20261031}"; DB="${2:-brs_m06_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../migrations"
PSQL=(docker exec -i "$CT" psql -U postgres -v ON_ERROR_STOP=1 -q)
fail() { echo "FALHOU: $*" >&2; exit 1; }
"$HERE/run-m05.sh" "$CT" "$DB" >/dev/null || fail "base M03-A/M05"
f="$MIG/20261101050000_security_m06_notificacoes.sql"
for i in 1 2; do echo "== migration M06 (passada $i)"; "${PSQL[@]}" -d "$DB" < "$f" 2>&1 | grep -E 'NOTICE:.*M06|ERROR'; [ "${PIPESTATUS[0]}" -eq 0 ] || fail "migration M06"; done
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
echo "== teste SQL M06"
"${PSQL[@]}" -d "$DB" < "$HERE/security_m06_notificacoes.sql" > "$LOG" 2>&1; rc=$?
grep -E 'NOTICE:  OK|ERROR|FALHA' "$LOG" || true
[ "$rc" -eq 0 ] || fail "security_m06_notificacoes.sql"

echo "== concorrencia: 12 sessoes disputam global_hora=5 (todas criticas) => exatamente 5 permitidas"
"${PSQL[@]}" -d "$DB" -q -c "update seg_config set valor='5' where chave='orcamento.global_hora'; delete from seg_orcamento;"
out=$(mktemp)
for n in $(seq 1 12); do echo "select (public.seg_orcamento_consumir('telegram', null, '', 'critica')->>'permitido');" | "${PSQL[@]}" -d "$DB" -At >> "$out" & done; wait
perm=$(grep -c '^true$' "$out"); neg=$(grep -c '^false$' "$out"); rm -f "$out"
usado=$("${PSQL[@]}" -d "$DB" -At -c "select usado from seg_orcamento where escopo='global_hora'")
[ "$perm" = "5" ] && [ "$neg" = "7" ] && [ "$usado" = "5" ] || fail "concorrencia: permitidas=$perm negadas=$neg usado=$usado (esperado 5/7/5)"
echo "  OK permitidas=5 negadas=7 contador=5"

echo "== concorrencia: 8 sessoes criam resumo ao mesmo tempo => 1 resumo"
"${PSQL[@]}" -d "$DB" -q -c "update seg_config set valor=to_jsonb(now() - interval '3 hours') where chave='resumo.ultimo_em'; delete from seg_notificacao_intencoes where tipo='resumo'; insert into seg_incidentes(regra,contexto,chave_correlacao,janela_inicio,janela_fim,gravidade) values ('rz','c','rz|c|'||now(),now(),now(),'alta'); insert into seg_notificacao_intencoes(incidente_id,versao_alerta,prioridade,dedupe_key,estado,finalizado_em) select id,1,'alta','rz'||id,'falhou',now() from seg_incidentes where regra='rz';"
for n in $(seq 1 8); do echo "select public.seg_resumo_criar();" | "${PSQL[@]}" -d "$DB" -At >/dev/null & done; wait
r=$("${PSQL[@]}" -d "$DB" -At -c "select count(*) from seg_notificacao_intencoes where tipo='resumo'")
[ "$r" = "1" ] || fail "resumo concorrente criou $r (esperado 1)"
echo "  OK 1 resumo"
echo "M06 TUDO OK"
