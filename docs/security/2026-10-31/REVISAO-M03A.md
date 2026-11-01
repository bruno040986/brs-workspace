# Revisão independente M03-A (papel do Codex) — 2026-11-01

Revisor: Claude (sessão separada, somente leitura + testes locais). Base `4e0f7c5f`, commits `94682dd2..aff124c6`. Confrontado com `RELATORIO-M03A.md`, `RELATORIO-N01.md`, `SEGURANCA-BRS-DECISOES-2026-11-01.md`, projeto técnico 02 (§3A, §7.2, §9) e o inventário remoto M03-0 (`m03-0-inventario-remoto.md`, 01/11 ~00:40).

## Veredito: APROVADO COM CORREÇÕES

Nenhum bloqueante no que foi entregue. Três correções IMPORTANTES antes de aplicar no remoto (duas vêm de itens que o inventário M03-0 revelou e o pacote não cobre nem lista como pendência; uma é de operação do rebaixamento).

## Execução real (por mim, nesta revisão)

- `bash supabase/tests/run-m03a.sh brs-security-20261031 brs_m03a_review` (container Postgres 17-alpine já em pé): **TUDO OK, exit 0**, poucos minutos, sem pressão de RAM. 256 migrations anteriores com 0 erros; NOTICEs: `1 conta(s) admin ... rebaixada(s)`, `anon/PUBLIC revogado em 335 tabela(s)`, `feriados esta SEM RLS` (tabela do esqueleto), `EXECUTE de anon/PUBLIC revogado em 0 funcao(oes)`. Os dois arquivos de teste passam (19 + 15 blocos OK), inclusive linha de base "superusuário vê 2/2/1" e "4/1/2/3" antes de cada negação, e negação por papel com `set local role anon|authenticated` + `request.jwt.claims` (teste `:208-209, :251-253, :321`). Aborto por política desconhecida: abortou, política permaneceu, removida só com `set brs.m03a_drop_policies`. Banco de revisão descartado depois.
- `npm test`: 493 testes, 490 pass, 0 fail, 3 skipped. `npx tsc --noEmit -p tsconfig.json`: exit 0.
- Confirmado por grep: nenhuma ocorrência do valor fixo antigo da senha em `src/` (padrão `brs`+dígitos); os 13 arquivos de `src/app/api/cron/*/route.ts` usam `isCronAuthorized`; `safeEqual` compara SHA-256 (tamanho fixo), não lança com tamanhos diferentes (`src/lib/security/safe-compare.ts:8-15`).

## Item 1 — Migrations contra o inventário remoto

(a) **Políticas desconhecidas de `disciplinary_records`**: `"acesso medidas"` e `"acesso_total"` estão na lista `conhecidas` de `20261101010000:54-55` (match exato por nome). Como o `qual` delas é `auth.role()='authenticated'` (não `true`), só o nome as salva do aborto; os nomes do inventário batem. Não vai abortar por elas. OK.

(b) **`regras_portabilidade_*`**: as 4 políticas `{public}/true` do inventário não estão na lista permitida e têm `using=true` ⇒ removidas pela regra permissiva (`:67`); recriadas por operação com `TO authenticated` via `apply_policy` (`:115-118, :129-130`); `REVOKE ALL ... FROM PUBLIC, anon` (`:119, :131`). Actions com `requirePermission` nas 5 funções (`simulador-portabilidade/actions.ts:45, 223, 296, 316, 337`). OK.

(c) **`profile_schedules`, `user_schedules`, `sector_links` `{public}/true`** — **IMPORTANTE, fora do escopo e sem pendência explícita**. Nenhuma das duas migrations toca essas tabelas. O passo 4 da parte 2 (`20261101020000:147-156`) só revoga anon onde NÃO há política para `public`/`anon`; como essas três têm política `{public}`, o anon **continua com GRANT e com política aberta** depois do pacote. O relatório (§6, §8) não as cita. Consumidores: `usuarios/actions.ts:139,458,552,583` (service_role), `links/actions.ts` (sessão, com permissão de rota), `nav/links-menu.ts:35` (service_role) — nenhum anônimo. Correção: na parte 2, `DROP POLICY IF EXISTS "Permitir leitura de horários de perfil" ON public.profile_schedules; ... "Permitir leitura de horários de usuário" ON public.user_schedules; ... "Permitir leitura para todos" ON public.sector_links;` (as políticas por `has_permission` de `20260601132916:193-232` ficam) e repetir o REVOKE de anon nelas (ou mover o passo 4 para depois desses drops). Adicionar asserção no teste.

(d) **REVOKE anon em lote** (`:147-161`): só em tabelas com RLS e sem política para anon/public — nelas anon já não lia nada; o que muda é "vazio" → `insufficient_privilege`. Código Workspace com chave anon sem sessão: só `lib/supabase/{client,server,middleware}.ts`; rotas públicas (`/api/promocoes/publico`, `/api/convenios/publico`, `/cartao`) usam service_role segundo o relatório/M02-R1 (não reexecutado por mim contra o remoto). Tabelas SEM RLS ficam intactas e só saem em NOTICE — correto como contenção, pendência M03-0 registrada. OK.

(e) **`handle_new_user`**: trigger `on_auth_user_created` NÃO é tocado pelo nome; a função vira `RETURN NEW` com `SET search_path = ''` e `REVOKE ... FROM PUBLIC, anon, authenticated` (`:141-152`). Trigger disparando função neutra é o efeito desejado, independente do nome; a fixture `20_legacy_admin_accounts.sql:9-11` recria o trigger com o nome real e o teste prova que signup corporativo não cria linha. `wa_bump_slot`, `wa_campaign_recount`, `wa_claim_next_recipient`: `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` + `search_path=public` (`20261101020000:183-203`); únicos chamadores são service_role (`disparo-whatsapp/worker.ts:37,287,414`). OK. Observação: o laço genérico (`:210-239`) revogou 0 funções no banco de teste, ou seja, o ramo "SECURITY DEFINER desconhecida com EXECUTE anon" não foi exercitado — no remoto pode haver funções fora do repo (M03-0 listou só `handle_new_user` e `wa_*`, então o risco é baixo).

(f) **Rebaixamento de admins** (`:175-200`): critério `role='admin'` + e-mail corporativo + `profile_id`, `employee_id`, `cpf` NULL + sem `user_permissions`. Grava auditoria (RLS, só service_role) antes do UPDATE; bane via `banned_until` sem apagar; reversível por `setUserActive(true)` (`ban_duration:'none'`) + role/perfil pelo painel. Inventário remoto: 2 candidatas por `role='admin' and profile_id is null` (critério mais frouxo que o da migration). **IMPORTANTE (operação)**: a migration não imprime QUEM rebaixou (só a contagem, `:206`), e nada impede que um administrador legítimo sem perfil/cpf/permissão individual caia na lista e seja banido na mesma transação. Correção mínima: `RAISE NOTICE` por e-mail rebaixado e, antes de aplicar, rodar no remoto (leitura) exatamente o `SELECT` de `candidatas` (`:175-184`) e o Bruno confirmar as contas. Se alguma for legítima, dar-lhe `profile_id` antes da migration em vez de editar o critério.

(g) **Idempotência e ordem**: reaplicação testada pelo runner (`run-m03a.sh:46-47`); `ON CONFLICT DO NOTHING` na auditoria evita rebaixar de novo; `DROP POLICY IF EXISTS` + `CREATE`. Parte 1 antes da parte 2 por timestamp. Rollback: documentado em §7 do relatório, nunca recria `USING (true)`; o rebaixamento se reverte conta a conta. OK.

## Item 2 — Testes SQL

Rodaram de verdade (saída acima). Provam linha de base do superusuário e negação por papel. Limites honestos: esqueleto (`10_workspace_base_skeleton.sql`) não é o DDL real — a migration depende de `users.{role,email,profile_id,employee_id,cpf,active,created_at,name}`, `comunicados.{status,data_inicio_veiculacao,data_fim_veiculacao}` (confirmados no app/migrations, exceto `users.created_at`, que o app trata como possivelmente sem default em `usuarios/actions.ts:108-109`). Se uma coluna faltar no remoto, a migration ABORTA (seguro, não silencioso). MENOR: `feriados SEM RLS` é artefato do esqueleto, não evidência remota.

## Item 3 — Código

- Senha fixa: removida; criação exige `validarSenhaTemporaria` (`usuarios/actions.ts:297-298`, `seguranca.ts:43-51`), edição valida se enviada; erro de troca de senha agora lança (`:340-345`). OK.
- `role`/`profile_id`/permissões: só com `sistema-usuarios-perfis|root can_edit` (`:271-294, :377-378, :413-414`). Outros caminhos que escrevam em `users`: só `theme/actions.ts:21` (`theme_preference`) e `central-conversas/actions.ts:1728` (`nome_exibicao`) — nenhum toca role/perfil. Não há importação/API de usuários. OK.
- `deleteUser`/`setUserActive` banem no Auth antes de inativar, falha visível (`:173-178, :202-208`). OK. Pendência já declarada: `cleanupAuthUsersByEmail` ainda roda em `:170, :360, :390`.
- `contaBrs`/`clienteChatwootBrs` em `conta-brs.ts` (sem `'use server'`); 15 consumidores + `agentes-sync/route.ts` reapontados; `tsc` 0 erros confirma. `registrarExportacao` em `remessa-exportacao.ts`, rota do Excel reapontada. OK.
- Proxy (`lib/supabase/middleware.ts`): as 4 famílias passam por cookie obrigatório (`:196-199` → 401), `getClaims` (`:259`), cookie inválido → 401 (`:291-294`), externo → 403 (`:309-312`), interno ativo via service_role, fail-closed se faltar chave ou der erro (`:318-334`); só a permissão de ROTA é dispensada (`:366`). Sem brecha por método (fluxo não distingue método) nem por prefixo (`startsWith` só amplia o conjunto exigente). `matcher` em `src/proxy.ts` cobre `/api`. OK.
- `timingSafeEqual`: 13 crons + FyDigital + Assinafy via `safeEqual`/`isCronAuthorized`. MENOR: `src/app/api/nvti/interno/route.ts:21-25` ainda compara `auth === \`Bearer ${secret}\`` (fora do escopo declarado; mesma classe de defeito; trocar por `isCronAuthorized(auth, process.env.NVTI_SERVICE_TOKEN)`).

## Item 5 — Regressões prováveis

- RH: `rh/page.tsx:32-59`, `rh/colaboradores/[id]/page.tsx:94`, `medidas-disciplinares/nova/page-client.tsx:50-52` passam a exigir `rh-painel`/`rh-medidas-disciplinares can_view` (decisão de negócio pendente, declarada em §8.1). Esperado.
- Chat (diretório/presença): `api/chat/*` e `lib/interno-chat/data.ts` usam service_role; navegador só Realtime. Sem regressão.
- Comunicados: API via service_role; badge Realtime (`HubHeader.tsx:244`) deixa de receber evento de aviso que o usuário já não vê — comportamento aceitável, documentado.
- Agenda (schedules) e links de setor: não tocados — sem regressão, mas ver (c).
- Cadastro de usuário sem permissão de perfis: falha explícita ao definir perfil/role; criação sem perfil funciona (`consulta`). Decisão §8.2 pendente. MENOR de UX: na criação, se o operador não clicar "gerar senha" (`usuarios/page.tsx:1061`), o servidor devolve erro em vez de gerar — aceitável (nunca senha padrão), mas pode confundir.

## Achados fora do pacote revelados pelo inventário (registrar como pendência explícita)

- **IMPORTANTE — storage `"Sistema gerencia avatares"` (ALL, `{public}`, bucket `avatars`)**: qualquer papel, inclusive anon com a chave pública, pode inserir/alterar/apagar objetos em `avatars` pela Storage API (que NÃO é desligada pela Data API). Uploads legítimos usam service_role (`usuarios/actions.ts:313-317`, `rh/parceiros/actions.ts:1232`) — não há consumidor anon/authenticated. Correção: `DROP POLICY "Sistema gerencia avatares" ON storage.objects` (manter `"Avatares Públicos"` SELECT se o bucket voltar a ser público por desenho). Pode entrar na parte 2 ou em M03-C; hoje não consta em lugar nenhum.
- Reaplicar a checagem do laço genérico de SECURITY DEFINER no remoto (NOTICE lista o que sobrar com authenticated).

## Classificação

| Sev | Onde | Correção |
|---|---|---|
| IMPORTANTE | `20261101020000` (falta) — `profile_schedules`, `user_schedules`, `sector_links` `{public}/true` | Dropar as 3 políticas abertas pelo nome + REVOKE anon; asserção no teste |
| IMPORTANTE | `storage.objects` `"Sistema gerencia avatares"` ALL/public | Drop da política (sem consumidor); registrar em M03-A ou M03-C |
| IMPORTANTE | `20261101010000:175-206` rebaixamento sem lista nominal | `RAISE NOTICE` por e-mail; rodar `SELECT candidatas` no remoto e Bruno confirmar antes de aplicar |
| MENOR | `api/nvti/interno/route.ts:21-25` | usar `isCronAuthorized`/`safeEqual` |
| MENOR | esqueleto de teste ≠ DDL real; laço genérico de SECURITY DEFINER revogou 0 no teste | aceitar; conferir NOTICEs no remoto |
| MENOR | criação sem clicar "gerar senha" → erro | gerar no servidor se ausente (opcional, M03-B) |

Pendências do relatório (§8.1–8.7) conferidas e mantidas. Nada foi enviado, aplicado ou alterado fora deste arquivo.
