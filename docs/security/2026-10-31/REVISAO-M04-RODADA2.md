# REVISAO M04 - RODADA 2 (re-revisao focada apos correcoes)

Data: 2026-11-01. Escopo: commits 1f78706e (B1), d6901ff1 (I2/I3), 09a7f5f1 (I1), 4970354a (teto duro/IP/I5), e04da1d2 (docs); migrations 20261101035000 e 20261101036000. Somente leitura + testes locais. Nada publicado. Referencias: REVISAO-M04.md (rodada 1), RELATORIO-M04.md §11.

## Veredito

**APROVADO COM CORREÇÕES** (nenhuma bloqueante para o rollout; C1 e C2 devem entrar antes de abrir para toda a empresa; C3-C5 podem seguir junto ou na sequencia). B1 fechado de fato; I1, I2, I3 e I5 implementados como descrito e cobertos por teste.

## Testes executados (saidas reais)

- `bash supabase/tests/run-m04.sh`: base + M03-A `TUDO OK`; migrations aplicadas 2x; 63 `NOTICE: OK` (15 grupos originais + 8 de correcoes: I2 so-identificador, I2 par, I2 IP, I2 desbloqueio, I3 trigger, I2 tier duro, ACL RPCs, I5 policies + avatars); `M04 TUDO OK`, rc=0.
- `npx tsc --noEmit`: sem erros, rc=0.
- `npm test`: 553 testes, 547 pass, **3 fail**, 3 skipped, rc=1. Os 3 que falham sao `src/lib/seguranca/dispatcher/__tests__/adapters.test.ts` (M06), sobre arquivos **nao commitados** que outro agente esta editando agora (`git status`: dispatcher/*.ts modificados). Fora do escopo M04. Suite de auth isolada (`node --test src/lib/auth/__tests__/*.test.ts`): 33/33 pass.

## 1. B1 - fechado

- Proxy: `src/lib/auth/gate-requisicao.ts:3-4` (`temHeaderNextAction && !pathname.startsWith('/api/')`); `src/lib/supabase/middleware.ts:14-16` usa o helper; as tres isencoes (`:330` gate M04, `:397` troca de senha, `:413` permissao de rota) passam por ele. A isencao `startsWith('/api/auth')` do gate foi removida (`:330`). Teste `gate-requisicao.test.ts:7,14`.
- `hasPermissionForUser` (`src/lib/auth/server.ts:96-107`): se `userId` e o da sessao corrente e ela nao esta liberada => false. `requireApiUser` (`:86-94`) = `getCurrentUser` + `requireSessaoInternaCompleta`, nunca lanca, null => 401.
- Handlers: 33 migrados; amostras lidas: `chat/messages/route.ts:14-17,156-158`, `chat/conversations/route.ts:9-12,134-136`, `comunicados/board/route.ts:9-10`, `users/list/route.ts:8-11`, `calendar/create-event/route.ts:7-10`, `nvti/lotes/[id]/export/route.ts:23-25`, `auth/google/url/route.ts:8-10`, `auth/google/callback/route.ts:25`, `cpfhub/cpf/[cpf]/route.ts:73,83`. Em todos o 401 precede `request.json()`/`searchParams`/qualquer consulta; o unico codigo antes do gate e `createAdminClient()` (instancia o cliente, sem IO).
- Teste estatico `gate-estatico.test.ts:13-14` exige CHAMADA `nome(` fora de comentarios; `:47-50` falha se algum `app/api/**/route.ts` tiver `.auth.getUser(`.
- `gate-lacunas.txt` (49 entradas): todas autenticam por segredo/assinatura (`cron/*`, webhooks, `nvti/interno`, `nvti/parceiro-consulta*` via `NVTI_SERVICE_TOKEN`, `agente-corban/meus-dados` via `isPortalServiceAuthorized`, `projetos/mcp`, `projetos/github`), sao publicas por desenho (`promocoes/publico/*`, `convenios/publico/*`, `lookups/*`) ou delegam ao gate: `conversas/bootstrap/route.ts:9` chama `getBootstrapData`, que faz `requirePermission('conversas')` (`src/lib/central-conversas/actions.ts:1999`). `lib/google/calendar.ts` recebe `userId` mas so e chamado pelos handlers de calendar ja gated. **Nenhum handler restante entrega dado interno a AAL1.**
- Server Actions: nenhum arquivo `'use server'` novo nas correcoes (so `acesso/actions.ts`, `trocar-senha/actions.ts`, `usuarios/acesso-actions.ts` alterados; `trocarSenha` usa `requireCurrentUser` `trocar-senha/actions.ts:16`; `desbloquearAcessoUsuario` usa `requirePermission` `acesso-actions.ts:33`). `app/acesso/*` continua isento do teste por desenho (guardas por estado).

## 2. I2 / teto duro / IP

- Chaves (`src/lib/auth/codigo-email.ts:47-56`): `par` = HMAC(email|ip) escalonada 3 falhas (`actions.ts:78`); `ip` = 20 falhas => 5 min fixos (`:79`); `id` = 10 falhas => 5 min fixos sem escalada (`:80`), dispensada por Turnstile aplicado E valido (`pausa-senha.ts:7`); `duro` = 30 falhas => escalonada com teto 15 min (`:81`, `TETO_DURO_MIN=15`), captcha nao dispensa (`pausa-senha.ts:6`). Ordem de decisao `pausa-senha.ts:5-8`, testada em `pausa-senha.test.ts`. SQL: `20261101035000:42-53` (fixa => `pausas=1`, alerta; escalonada => `least(minutos, p_teto_min)`).
- Atacante com captcha: continua limitado por `par` (3), `ip` (20) e `duro` (30) - confirmado.
- Decisao 3 (terceiro nao tranca interno > 15 min): o teto duro e `least(..., 15)`; a fixa e 5. Em pausa nada soma (`:34-36`) e `falhas` zera ao pausar (`:52`), entao cada ciclo exige novas 30 falhas. **Mas ver C1**: o ciclo e repetivel indefinidamente (DoS em fatias de 5/15 min).
- IP: `ip-confiavel.ts:6` so com `VERCEL` definido; primeiro valor de `x-forwarded-for` ou `x-real-ip`, validado por `isIP`. Sem `VERCEL` => `null` => `k.ip = null` e o limitador por IP nao atua (`actions.ts:60,79`). **Efeito colateral nao documentado (C2)**: `k.par` vira HMAC(`email|sem-ip`) (`codigo-email.ts:51`), ou seja, fora da Vercel a chave "par" degenera em chave so-por-identificador com escalada 5..240 min - exatamente o I2 original. Em producao (Vercel) nao ocorre; em outro host seria regressao.
- Concorrencia: `auth_registrar_falha_limiar` faz `INSERT ... ON CONFLICT DO NOTHING` + `SELECT ... FOR UPDATE` (`20261101035000:31-32`) => incremento serializado por chave. `auth_pausa_atual` e leitura; N requisicoes concorrentes podem passar a checagem antes da primeira falha ser gravada (ultrapassagem limitada a N, aceitavel).
- Desbloqueio: `auth_desbloquear_usuario(..., p_identificador)` zera `chave = user` e linhas com `identificador = hash` (`:73-74`); o servidor calcula o hash a partir do e-mail cadastrado (`acesso-actions.ts:36-41`). A chave `ip` nao e zerada (correto: pertence a origem, nao ao usuario).

## 3. I3

- Trigger `AFTER UPDATE OF email, banned_until, encrypted_password ON auth.users` (`20261101035000:100-101`), ramo `encrypted_password` em `:91-92`. Teste "OK I3".
- `trocarSenha` (`trocar-senha/actions.ts:14-51`): `requireCurrentUser` (sessao liberada), senha atual verificada com cliente sem persistencia (`:29-32`), 5 erros => pausa 5 min (`tp:<user>`), `updateUserById` (`:41`) => trigger revoga todas as liberacoes; `page.tsx:35` chama a action; teste estatico `gate-requisicao.test.ts:26` garante que nao ha `updateUser({password})` no navegador.
- Primeiro acesso com senha temporaria: o gate M04 (`middleware.ts:330`) precede `/trocar-senha` (`:388-393`), logo o usuario completa as 5 etapas (inclusive ativacao do TOTP) com a temporaria, troca a senha, perde a liberacao e refaz login com a nova (TOTP ja ativo). Coerente. Observacao menor: `signInWithPassword` do verificador cria uma sessao AAL1 orfa no GoTrue (descartada, sem refresh persistido, expira sozinha) - aceitavel.

## 4. I1

- `hook-mfa.ts:40-41`: sem segredo (ou < 20 chars) => 503; assinatura invalida/antiga (tolerancia 300 s) => 401; payload invalido => 400; erro de infra => 503; em pausa rejeita mesmo com `valid=true` (`:49-52`); `valid=false` conta via `auth_registrar_falha(user,'totp')` (`route.ts:17-20`). GoTrue trata nao-2xx como erro => verificacao negada: fail-closed.
- Formato da assinatura: Standard Webhooks correto - headers `webhook-id`/`webhook-timestamp`/`webhook-signature` (`route.ts:12`), conteudo assinado `${id}.${timestamp}.${corpo}` com HMAC-SHA256 da chave base64 apos `v1,whsec_` (`hook-mfa.ts:24-27`), multiplas assinaturas `v1,<b64>` separadas por espaco, `timingSafeEqual`. Payload `{user_id, factor_id, factor_type, valid}` e resposta `{decision: continue|reject, message}` conferem com o hook "MFA Verification Attempt".
- Sem env: o hook so e chamado se configurado no painel do Auth. Enquanto nao configurado, `AUTH_HOOK_MFA_ATIVO` ausente => a Server Action continua contando localmente (`actions.ts:231-233`) e o login nao muda. **Armadilha operacional**: configurar o hook no painel ANTES de `AUTH_HOOK_MFA_SECRET` na Vercel => 503 em toda verificacao TOTP => ninguem passa a etapa 3. A ordem em RELATORIO §11 esta correta (segredo primeiro); reforcar no checklist.
- Rota em `publicRoutes` (`middleware.ts:161`) e aceita pelo teste estatico via `processarHookMfa(` (`gate-estatico.test.ts:13`).

## 5. I5

- `20261101036000:16-28`: `ENABLE ROW LEVEL SECURITY` + policy `m04_gate_sessao_interna AS RESTRICTIVE FOR ALL TO authenticated USING/WITH CHECK (sessao_interna_ok())` nas 11 tabelas; avatars `:30-34`.
- `sessao_interna_ok()` = `NOT is_active_internal_user_base() OR sessao_interna_liberada()` (`20261101030000:211-214`): nao interno (parceiro, `external`, dominio parceiro) => true, segue so as regras antigas. Teste "OK I5" exercita `set local role authenticated` com claims AAL1 interno (0 linhas, insert negado) e parceiro (le o proprio). Confirmado.
- Cobertura: todas as policies por dono de tabelas internas encontradas nas migrations (`comunicado_reads`, `workspace_chat_*`, `praise_notifications`, etc.) estao na lista; as de parceiro (`parceiro_consultas_cpf`, `partner_nvti_select_own`, `parceiro_conta_virtual`) ficaram fora, correto. Pendencia mantida: tabelas/policies criadas fora do repo e `realtime.messages` (inventario).

## Correcoes recomendadas

- **C1 (importante, nao bloqueante). DoS direcionado pelo teto duro / pausa leve** - achado da revisao automatica, confirmado. Terceiro com a lista de e-mails e 1-2 IPs (20 falhas, 5 min de pausa de IP, +10 falhas dentro da janela de 15 min) tranca o titular 5 min e, repetindo, 15 min por ciclo, indefinidamente. Com Turnstile DESLIGADO no rollout, bastam 10 falhas (pausa leve, `pausa-senha.ts:7`) para 5 min. Impacto so de disponibilidade, limitado a 15 min por ciclo, com `alerta=true` para o M05 e desbloqueio administrativo: por isso nao bloqueia o rollout, mas contraria o espirito da decisao 3 e deve entrar antes de abrir a todos. **Correcao mais simples e coerente com o plano: dispositivo confiavel.** Ao concluir a etapa 5 (`actions.ts:176`), gravar cookie HttpOnly/Secure/SameSite=Lax `brs_dc` = `<exp>.<HMAC(AUTH_CODIGO_SEGREDO, identificador|exp)>` (validade 90 dias, `identificador` = `identificadorSenha(email)`). Em `entrar`, se o cookie conferir para o e-mail digitado e nao estiver vencido, `decidirPausaSenha` dispensa `leveSeg` e `duroSeg` (mantem `origemSeg`: `par` e `ip` continuam valendo para esse navegador). O terceiro nao tem o cookie (so e emitido apos login completo no proprio navegador); cookie roubado so ganha o ritmo `par` (3/15 min escalonado). Sem migration; ~15 linhas em `codigo-email.ts` + `pausa-senha.ts` + `actions.ts` e um teste puro. Alternativas (contar o duro so por origens distintas; codigo de desbloqueio por e-mail) exigem SQL/fluxo novo e nao foram escolhidas.
- **C2 (menor)**. `codigo-email.ts:51`: quando `ip` e null, nao usar a chave `par` (ou usa-la com a regra da leve) para nao reintroduzir a escalada 5..240 min por identificador fora da Vercel. Uma linha: `par: ip ? chaveSenha(...) : null` e tratar null em `actions.ts:59,78,117`.
- **C3 (menor)**. Documentar no checklist de rollout a ordem obrigatoria do hook MFA (segredo na Vercel -> hook no painel -> `AUTH_HOOK_MFA_ATIVO=true`) com a consequencia do erro (503 = ninguem passa o TOTP).
- **C4 (menor)**. `trocarSenha`: a sessao AAL1 orfa criada pelo verificador pode ser encerrada com `verificador.auth.signOut({scope:'local'})` apos a checagem (higiene em `auth.sessions`).
- **C5 (nota)**. M3-M7 da rodada 1 continuam abertos (aceitos).

## Confirmacoes residuais

- Chaves de TOTP/e-mail continuam so por usuario (nao acionaveis por terceiro antes da senha) - ok.
- `auth_registrar_sucesso` zera `par` e `id` (`actions.ts:117-118`) mas nao `duro`: consistente (o duro so decai pela janela/24 h e pelo desbloqueio administrativo).
- A isencao do proxy para Server Actions fora de `/api` continua: cada action chama `requireCurrentUser` (barreira real). Teste `gate-estatico` cobre arquivos novos.
