# Decisões do dono de 01/11/2026 (4, 12, 17)

Migration única: `supabase/migrations/20261101060000_security_decisoes_01_11.sql` (idempotente; nada aplicado fora do banco descartável).

## Decisão 4: medidas disciplinares
- `disciplinary_records_select_rh` agora também permite: `rh-colaboradores` (can_view) e o próprio colaborador. Escrita inalterada.
- Vínculo colaborador -> usuário: `public.users.employee_id` (preenchido por `trigger_link_employee_by_cpf`) via `app_private.is_own_employee` (já com o portão do M04). `employees` não tem `user_id`.
- Fallback por e-mail (`app_private.is_own_employee_by_email`) só quando `users.employee_id` é nulo: exige `is_active_internal_user()` (interno ativo + sessão liberada), linha ativa em `public.users`, `auth.users.email_confirmed_at` não nulo e e-mail igual (lower/btrim) em `users`, `auth.users` e `employees.email`. Ideal futuro: coluna de vínculo explícita e única. Vínculo por e-mail depende de `employees.email` existir no remoto (a função tolera a coluna ausente: nega).

## Decisão 12: dispositivo confiável 30 dias
- `DISPOSITIVO_TTL_SEG` = 30 dias (`src/lib/auth/dispositivo-confiavel.ts`); sem validade no banco.
- Removidos `DISPOSITIVO_TETO_DURO_SEG` e `dispositivoIdadeSeg`: com TTL de 30 dias, "cookie < 30 dias" era sempre verdadeiro. Efeito: cookie válido dispensa leve e duro; Turnstile sozinho continua não dispensando o duro. RELATORIO-M04 atualizado.

## Decisão 17: retenção 180 dias
- `app_private.seg_expurgar(dias int default 180)` (SECURITY DEFINER, `search_path` fixo, mínimo 30 dias) + wrapper `public.seg_expurgar` só para `service_role`.
- Apaga: incidentes encerrados antigos (cascata: intenções, tentativas, recibos, diagnósticos), eventos antigos sem incidente associado (classificações em cascata), desvios resolvidos, orçamento, liberações e códigos de e-mail vencidos, `auth_tentativas` sem pausa vigente, `acessos_log`.
- Preserva: incidentes não encerrados (e o que depende deles), desvios abertos, pausas vigentes, `auth_bloqueios_admin`, `seg_config*`/destinos e `security_audit_demoted_admins_20261031`.
- Rota `GET /api/cron/seguranca-expurgo` (mesmo padrão de `seguranca-monitor`, `CRON_SECRET` fail-closed), `vercel.json` diário às 05:23 UTC (02:23 em Brasília). Sem teste unitário de rota (as outras rotas de cron também não têm).

## Testes
- `supabase/tests/run-decisoes.sh` (base run-m04 + M05/M06 + migration 2x + `security_decisoes_01_11.sql`): casos de A (inclui sessão liberada real, e-mail não confirmado, sem vínculo) e C (preserva/apaga, privilégios).
- `node --test`: 561 pass, 0 fail, 3 skip; `npx tsc --noEmit` limpo.

## Tabelas e RPCs do Portal e do CRM
Migration `supabase/migrations/20261101070000_security_tabelas_portal_crm.sql` (idempotente; nada aplicado fora do banco descartável).
- `cadastro_rate_limit_eventos` (Portal, `src/lib/security/rate-limit.ts`): RLS ligado, sem policies, `anon`/`authenticated` sem privilégio; `service_role` com select/insert/delete (o Portal usa `createAdminClient()` com a service role).
- `auth_throttle` + `auth_throttle_status` / `auth_throttle_registrar` (CRM, `trocar-senha/actions.ts` com `createAdminClient()`): funções SECURITY DEFINER com `search_path = public, pg_temp`, `revoke ... from public, anon, authenticated`, execute só para `service_role`. Ajuste ao SQL proposto: expoente de `2 ^ reincidencias` limitado (evita overflow do `int`).
- Índice `chat_envios_operacoes_presas_idx`: a tabela real do ledger é `chat_envios_operacoes` (não existe `chat_envios`). Bloco `DO` cria só se a tabela e `updated_at` existirem; senão avisa e pula.
- A limpeza diária de `cadastro_rate_limit_eventos` (> 2 dias) continua sugerida, não criada.
- Teste: `supabase/tests/run-tabelas.sh` (migration 2x, RLS, privilégios, search_path, comportamento do throttle, índice pulado sem a coluna).
