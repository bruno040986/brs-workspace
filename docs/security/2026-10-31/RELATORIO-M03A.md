# Relatório M03-A — contenção do Workspace (banco + código)

Branch `security/incidente-2026-10-31` (base `origin/main` 4e0f7c5f). Executor: Claude (Fable 5.1). Tudo LOCAL: nada foi enviado, publicado ou aplicado fora do Postgres descartável. Parte da N01 (`RELATORIO-N01.md`), que este pacote substitui: a migration `20261101010000` foi revisada e completada, e há uma segunda, `20261101020000`. Não existem duas migrations em conflito.

## 1. Revisão crítica da N01 e do que mudou na base
- Migrations entre 83f96c7d e 4e0f7c5f (41 arquivos): nenhuma toca `disciplinary_records`, `regras_portabilidade_*`, `comunicados*`, `workspace_chat_user_profiles` nem `handle_new_user`. As premissas da N01 seguem valendo.
- Falhas da N01 corrigidas:
  1. Removia QUALQUER política fora da lista de RH, em silêncio (só um NOTICE). Agora remove apenas política comprovadamente permissiva (USING/CHECK `true`) ou de nome legado conhecido; qualquer outra política desconhecida ABORTA a migration, e o operador confirma com `set brs.m03a_drop_policies = 'nome1,nome2'` (teste do aborto abaixo).
  2. Sem preflight: agora aborta se faltar tabela/função (`users`, `user_permissions`, as 3 tabelas N01, `has_permission`, `apply_policy`, `enable_rls_if_exists`, `handle_new_user`).
  3. Não rebaixava as contas admin já criadas pelo trigger (decisão 8): feito, com tabela de auditoria.
  4. O teste da N01 nunca exercitava o trigger (ele não é versionado e não existia no banco de teste); a fixture 20 recria `on_auth_user_created` como em produção. O teste agora passa pelo `handle_new_user` real.
  5. `REVOKE ... FROM anon` não bastava em `public` no Supabase: os privilégios padrão concedem EXECUTE/ALL a `anon` e `authenticated` por GRANT explícito, então `REVOKE ... FROM PUBLIC` deixa as funções `wa_*` executáveis por anon (confirmado no banco de teste). Corrigido em 5.

## 2. Migrations (ordem de aplicação)
Aplicar só com conexão administrativa, Data API ainda desligada e OK do Bruno. Ambas são idempotentes (reaplicadas no runner).
1. `supabase/migrations/20261101010000_security_initial_rls_hardening.sql`
   - L25-46 preflight; L50-78 limpeza de políticas (aborta ou NOTICE); L155 rebaixamento.
   - `disciplinary_records` (4 políticas de RH, `TO authenticated`, REVOKE anon/PUBLIC, sem TRUNCATE).
   - `regras_portabilidade_ifs` (view/include/edit/delete) e `_globais` (SELECT can_view, INSERT can_edit, sem UPDATE/DELETE) sobre `operacional-simulador-portabilidade`; REVOKE anon/PUBLIC, sem TRUNCATE.
   - `handle_new_user` vira `RETURN NEW` com `search_path=''` e EXECUTE revogado.
   - Rebaixa contas `admin` de domínio corporativo sem `profile_id`, `employee_id`, `cpf` nem `user_permissions` (assinatura exata do trigger antigo): `role='consulta'`, `active=false`, `auth.users.banned_until = now()+876000h` e grava em `public.security_audit_demoted_admins_20261031` (RLS ligada, só service_role). Lista para o Bruno: `select * from public.security_audit_demoted_admins_20261031;`
2. `supabase/migrations/20261101020000_security_m03a_workspace_containment.sql`
   - `app_private.is_active_internal_user()` (usuário ativo em `public.users`, e-mail fora de `@parceiro.`, sem `app_metadata.external`) e `app_private.comunicado_alcanca_usuario(uuid)`.
   - `comunicados`: SELECT só interno ativo e (gestor com `sistema-comunicados` can_view OU aviso ativo, na janela e dirigido ao perfil do usuário). `comunicado_target_profiles`: sem política (deny-all), sem grant a authenticated. `comunicado_reads`: só o próprio, interno. Escrita revogada de authenticated (as rotas usam service_role).
   - `workspace_chat_user_profiles`: SELECT só interno ativo; políticas de INSERT/UPDATE e grants de escrita removidos (as rotas `/api/chat/presence` e `/profile` usam service_role).
   - REVOKE de anon/PUBLIC em toda tabela de `public` com RLS e sem política para anon (335 no banco de teste); tabelas SEM RLS apenas listadas por NOTICE.
   - SECURITY DEFINER: `helpdesk_*` (4 gatilhos), `limpar_chat_atendimento_sinais`, `wa_campaign_recipients_counter_trg`, `workspace_chat_ao_criar_usuario`, `wa_bump_slot`, `wa_campaign_recount`, `wa_claim_next_recipient`: EXECUTE só service_role + `search_path=public`. Nas demais SECURITY DEFINER de `public`/`app_private`, anon/PUBLIC é revogado (authenticated preserva o que tinha); as que sobrarem com authenticated e fora da lista de apoio de RLS saem em NOTICE, sem alteração.

## 3. Código (arquivo:linha)
- `src/app/(dashboard)/usuarios/actions.ts`: senha fixa de fallback removida; `password: senhaTemporaria!` (L~395) e `validarSenhaTemporaria` obrigatória na criação (L297-298; ausência falha); `role`, `profile_id` e permissões só com `sistema-usuarios-perfis`/`-root` can_edit (L271-294; sem privilégio, edição mantém o role/perfil atuais e criação grava `consulta` sem perfil, perfil novo falha); `deleteUser` (L153) bane no Auth antes de inativar e falha de forma visível; `setUserActive` (L195) idem (antes só `console.warn`); erro ao trocar senha de usuário existente agora é lançado.
- `src/lib/usuarios/seguranca.ts` (novo): regras puras (roles válidos, perfil, senha). `usuarios/page.tsx`: `generateTempPassword` agora usa `crypto.getRandomValues`, 12 caracteres.
- `src/lib/promocoes/remessa-exportacao.ts` (novo, sem `'use server'`): `registrarExportacao` saiu de `remessa-actions.ts`; a rota do Excel importa daqui.
- `src/lib/central-conversas/conta-brs.ts` (novo, sem `'use server'`): `contaBrs()` (sem `token_cifrado`) e `clienteChatwootBrs()`; `actions.ts` deixou de exportá-los; 15 consumidores e `api/central-conversas/agentes-sync/route.ts` (que tinha cópia local) passaram a importar do módulo novo.
- `src/app/(dashboard)/simulador-portabilidade/actions.ts`: as 5 funções com `requirePermission`/`requireAnyPermission` em `operacional-simulador-portabilidade` (L45, 223, 296, 316, 337).
- `src/lib/supabase/middleware.ts`: `/api/comunicados`, `/api/cnpjws`, `/api/central-conversas`, `/api/conversas` deixam de passar só pela presença do cookie. Seguem o fluxo completo (getClaims, 401 sem sessão, bloqueio de externo por domínio/marca, senha provisória) e exigem usuário interno ATIVO via `src/lib/auth/internal-user.ts` (consulta `public.users`, fail-closed 403). Só a checagem de permissão de ROTA continua dispensada (L209, 318-333, 366).
- `src/lib/security/safe-compare.ts` (novo): `safeEqual` (SHA-256 + `timingSafeEqual`, segredo vazio nunca confere) e `isCronAuthorized`. Aplicados nos 13 crons de `src/app/api/cron/*/route.ts`, no webhook FyDigital (`?key=`) e no webhook Assinafy (`?secret=`).

## 4. Consumidores verificados
- `comunicados`/`comunicado_target_profiles`/`comunicado_reads`: leituras e escritas em `src/app/api/comunicados/**` e `src/lib/comunicados-service.ts` usam `createAdminClient` (service_role) e não mudam. Único consumo com sessão: Realtime em `HubHeader.tsx:244`, que só refaz o badge; passa a receber eventos só de linhas visíveis (aviso inativado deixa de gerar evento para quem já não o vê; o badge corrige no próximo refresh).
- `workspace_chat_user_profiles`: `api/chat/{contacts,conversations,presence,profile}` e `lib/interno-chat/data.ts` via service_role; Realtime em `MessengerNotificationBridge.tsx:264`.
- `.rpc()` do Workspace (lista completa conferida): as funções revogadas (`wa_*`) só são chamadas com service_role (`disparo-whatsapp/actions.ts:320,390,548`, `worker.ts:287,414`). RPCs de CRM/Portal (`crm_*`, `corban_onboarding_*`, `parceiro_aplicar_lancamento`) já eram service_role-only e não foram tocadas.
- Consumidores de `contaBrs`/`clienteChatwootBrs`: nenhum usava `token_cifrado` de `contaBrs()` fora de `getBootstrapData` (ajustado).
- Simulador: `getPortabilidadeData` agora devolve o fallback/erro padrão do `catch` para quem não tem `can_view` (a tela só chega lá com a permissão de rota).

## 5. Testes executados de fato
Banco: container `brs-security-20261031` (Postgres 17.11 puro), banco `brs_m03a_test` criado/removido pelo runner. Comando: `supabase/tests/run-m03a.sh` (usa `fixtures/00_supabase_stubs.sql`, `10_workspace_base_skeleton.sql`, `20_legacy_admin_accounts.sql`).
- As 256 migrations (menos as de segurança) carregaram com 0 erros sobre o esqueleto das tabelas criadas fora do repo (`users`, `access_profiles`, `profile_permissions`, `user_permissions`, `employees`, `disciplinary_*`, `sector_links`, `commercial_entities`, `feriados`). O esqueleto é aproximado; não é o DDL de produção.
- Migrations de segurança com `ON_ERROR_STOP` e reaplicação idempotente: OK. NOTICEs reais: `1 conta(s) admin sem cadastro interno rebaixada(s)`; `anon/PUBLIC revogado em 335 tabela(s)`; `ATENCAO: feriados esta SEM RLS` (tabela do esqueleto).
- `security_initial_rls_hardening.sql` (RH/portabilidade/handle_new_user/rebaixamento): 19 asserções OK. Antes de cada negação o superusuário vê 2/2/1 linhas. Negados: sem perfil, parceiro sem espelho, signup corporativo, desativado com perfil RH, provisionado sem permissão, anon (SELECT/INSERT/UPDATE com `insufficient_privilege`). Permitidos: RH (select/insert/update/delete) e portabilidade (upsert por INSERT e por UPDATE, delete, coeficiente global; leitura-apenas só lê). Signup corporativo exercita o trigger real e não cria linha em `users`.
- `security_m03a_workspace_containment.sql`: base (4 comunicados, 1 alvo, 2 leituras, 3 perfis de chat) e depois anon, desativado, parceiro com linha + marca external, CRM via SSO sem linha: 0 linhas e sem escrita. Interno sem perfil vê só o aviso geral vigente (1 de 4); interno do perfil alvo vê 2; gestor vê 4; service_role vê e escreve. Estrutura: nenhuma tabela com RLS mantém privilégio de anon, nenhuma SECURITY DEFINER executável por anon, `has_permission` preservada para authenticated.
- Aborto: com uma política desconhecida em `disciplinary_records` a migration falha e a política continua lá; só é removida após `set brs.m03a_drop_policies`.
- Controle negativo: `M03A_SKIP_SECURITY=1 supabase/tests/run-m03a.sh` (sem as migrations) falha em `FALHA: 4 politica(s) sem restricao nas tabelas N01`, provando que os testes não passam vazios.
- Node: `npm test` 493 testes, 490 pass, 0 fail, 3 skipped (inclui 18 novos: `usuarios/__tests__/seguranca.test.ts`, `security/__tests__/safe-compare.test.ts`, `auth/__tests__/internal-user.test.ts`). `npx tsc --noEmit`: 0 erros. `npm run lint`: o repositório já tem 2092 problemas (1860 erros, quase todos `no-explicit-any`); nos arquivos que alterei/criei não há erro novo fora de `no-explicit-any` (os 2 `set-state-in-effect` de `usuarios/page.tsx:178,230` são anteriores). `next build` NÃO foi rodado (RAM).
- NÃO testado: PostgREST/Realtime reais, GoTrue real, Server Actions e proxy em execução (só tsc + unitários), migration contra o banco remoto (sem inventário `pg_policies` real).

## 6. Riscos
1. Remote pode ter política desconhecida em `disciplinary_records` (a N01 já dizia): a migration aborta de propósito. Rodar o inventário `pg_policies`/`role_table_grants` antes (M03-0) e decidir.
2. A migration 2 revoga anon em tudo que tem RLS e nenhuma política para anon: código que consulta como anon e tolerava "vazio" passa a receber erro de permissão. Os consumidores de API usam service_role; páginas públicas conhecidas (`/api/promocoes/publico`, `/api/convenios/publico`, `/cartao`) usam service_role segundo o mapa M02-R1, mas isso não foi reexecutado contra o remoto.
3. Proxy: as 4 famílias de `/api` agora fazem uma ida ao Auth (getClaims, com o Legacy JWT Secret é rede) e uma consulta a `public.users` por requisição, com a mesma tolerância de timeout/disjuntor das demais rotas. O badge de comunicados e o chat chamam essas rotas com frequência: observar latência na reabertura.
4. Usuário com só `sistema-usuarios-cadastro` não consegue mais criar usuário COM perfil de acesso nem definir role (falha explícita). Criar o usuário sem perfil e atribuir depois por quem administra perfis. Decisão de negócio abaixo.
5. Rebaixamento de admins: se um administrador legítimo também não tiver `profile_id`, `employee_id`, `cpf` nem permissão individual, ele cai na lista. O Bruno reativa pelo painel (`setUserActive`) e define role/perfil.
6. Contas rebaixadas continuam em `workspace_chat_participants`/"Equipe BRS" (o trigger do chat as incluiu); o acesso real depende de `active`/ban, mas o nome aparece na lista do chat até o grupo ser limpo.
7. Não resolvido neste pacote (continua na tabela M03-B do projeto técnico): `cleanupAuthUsersByEmail` ainda apaga contas Auth homônimas ao criar usuário ou trocar e-mail; quem tem `sistema-usuarios-cadastro` can_edit ainda redefine a senha de qualquer usuário (inclusive root); `clearPasswordResetFlag` ainda não verifica a troca; `session_timeout` não é imposto (gravado e nunca consumido); `comunicado_reads` POST aceita qualquer `comunicado_id`; políticas de `storage.objects` de `partner-documents` não existem no repo (M03-C).

## 7. Rollback que NÃO reabre a exposição
- Não existe "voltar a policy antiga". Para desfazer um efeito colateral de permissão: conceder o recurso ao perfil certo (`operacional-simulador-portabilidade`, `rh-medidas-disciplinares`, `sistema-comunicados`), nunca recriar `USING (true)`.
- Funcionalidade quebrada por causa de anon: restaurar apenas na tabela e na operação comprovadamente necessárias (`GRANT SELECT ON public.<tabela> TO anon` mais uma política específica com `TO anon`), nunca em lote.
- Contas rebaixadas: reativar uma a uma (`setUserActive(id, true)` e role/perfil), nunca revertendo a tabela inteira. A tabela de auditoria guarda `role_anterior` e `active_anterior`.
- `handle_new_user`: não restaurar a versão que inseria `admin`. Se um fluxo precisar do espelho automático, criar função nova que insere `role='consulta'`, `active=false` e sem perfil.
- Para desligar tudo de uma vez: manter Data API e signup desligados (estado atual).

## 8. Pendências e dúvidas para o Bruno
1. O colaborador pode ver as próprias medidas disciplinares e `rh-colaboradores` dá acesso ao histórico? As telas `rh/colaboradores/[id]`, `rh/page.tsx` e a contagem de reincidência em `medidas-disciplinares/nova` dependiam da política aberta e hoje exigem `rh-medidas-disciplinares`/`rh-painel` (decisão de negócio herdada da N01).
2. Quem deve poder criar usuário com perfil: só quem administra perfis (como implementado) ou também o operador de cadastro?
3. Reativar da lista `security_audit_demoted_admins_20261031` quem for legítimo, depois de aplicar.
4. `session_timeout` (campo gravado e nunca imposto): fica como pendência, não aplicado agora. Precisa de decisão sobre o desenho (M04).
5. M03-0: inventário remoto de `pg_policies`/grants/`proacl`/`prosecdef` antes de aplicar as migrations; o aborto por política desconhecida depende disso.
6. `scripts/test-db.mjs` do CRM só aplica uma lista fixa de migrations: não inclui estas (coordenar com o dono do CRM se quiser regressão cruzada).
7. Teste estático "export `'use server'` com `createAdminClient` precisa chamar helper de autorização" (critério do M03-B) não foi criado.

## 9. Correções pós-revisão (2026-11-01)

Migration nova `20261101025000_security_m03a_complemento.sql` (as duas anteriores não foram editadas), idempotente:
- `profile_schedules`, `user_schedules`, `sector_links`: drop pelo nome exato das políticas `{public}/true` ("Permitir leitura de horários de perfil", "... de usuário", "Permitir leitura para todos"); `REVOKE ALL` de PUBLIC/anon; as políticas por `has_permission` ficam. Consumidores verificados por grep: `usuarios/actions.ts` e `lib/nav/links-menu.ts` usam service_role, `links/actions.ts` usa sessão com permissão de rota; nenhum anônimo.
- `storage.objects`: drop de "Sistema gerencia avatares" (ALL/public) e também de "Avatares Públicos" (SELECT/public, senão anon ainda lê o bucket pela Storage API); criada `avatars_select_authenticated` (SELECT só authenticated). Uploads de avatar usam service_role (`usuarios/actions.ts:315-325`, `rh/parceiros/actions.ts:1232`); não há upload pelo cliente. DECISÃO DO BRUNO: se o bucket deve voltar a ser público, recriar SELECT para public (ou `public=true` no bucket) e voltar aos `getPublicUrl`.
- Rebaixamento: a `20261101010000` já grava e-mail e id em `security_audit_demoted_admins_20261031`; o complemento emite `RAISE NOTICE` por conta com e-mail mascarado (`m0***@dominio`). Contexto datado (inventário remoto 01/11 ~00:40, para o Bruno confirmar): exatamente 2 candidatas, ambas `active=false`, sem perfil, sem permissões, nunca logaram (ids `c35e197b-...` criada 19/10 e `8efc3795-...` criada 31/10). Limite: como a 010000 não pode ser editada, o NOTICE sai depois do rebaixamento; para confirmar ANTES, rodar no remoto (leitura) o SELECT `candidatas` da 010000. Sendo ambas já inativas e sem acesso, o efeito prático é nulo.
- `api/nvti/interno/route.ts`: token agora por `isCronAuthorized` (SHA-256 + `timingSafeEqual`, fail-closed); caso adicionado em `safe-compare.test.ts`.
- Testes: `supabase/tests/security_m03a_complemento.sql` (anon não lê as 3 tabelas nem insere/lê `storage.objects` avatars; authenticated sem permissão vê 0 linhas de schedules e não faz upload; com `sistema-usuarios-perfis` ainda lê `profile_schedules`; políticas abertas ausentes e as 3 por permissão presentes). Fixture `20_legacy_admin_accounts.sql` recria as políticas abertas do remoto e os grants de `storage.objects`. Incluído em `run-m03a.sh`; a migration entra pelo glob.
- Resultados: `run-m03a.sh` TUDO OK (0 migrações anteriores com erro, reaplicação idempotente); `npm test` 494 testes, 491 pass, 0 fail, 3 skipped; `npx tsc --noEmit` exit 0.
- Pendente: confirmar as 2 contas acima; decisão sobre avatar público; `feriados` sem RLS e demais tabelas sem RLS (M03-0/M03-C); laço de SECURITY DEFINER revogou 0 no teste (conferir NOTICE no remoto); gerar senha no servidor se faltar (M03-B, opcional). Nada aplicado no remoto.

## B-1 leitor de documentos do parceiro

- Rota: `src/app/api/agente-corban/documento/route.ts` (GET `?agente=<uuid>&ref=<path ou URL antiga>`). `requireAnyPermission` (herda `requireCurrentUser`/M04) com `can_view` em `agente-corban-cadastros-recebidos` ou `agente-corban`; lê `corban_data` do agente com service_role, baixa de `partner-documents` e faz stream com `Cache-Control: private, no-store`, `nosniff`, `CSP: sandbox`, `Content-Disposition: inline; filename="<nome seguro>"`. Nunca devolve URL do Storage.
- Regras puras: `src/lib/agente-corban-documento.ts` (`extrairPathDocumento` aceita path puro ou `/storage/v1/object/(public|sign|authenticated)/partner-documents/<path>`; `resolverDocumentoDoAgente`, `nomeArquivoSeguro`, `urlDocumentoParceiro`).
- Desvio do pedido: em vez de `campo`/`socio`, o parametro e `ref` (o valor gravado). Os leitores da UI nao conhecem o campo (listas `arquivos_por_documento`, sócios e certificacoes). `ref` nunca e confiado: so e servido se constar em qualquer ponto do `corban_data` do agente (inclui `socios[]`) ou for `correcao/<agente>/...`. Path de outro agente, outro bucket, `..`, scheme ou https externo: 404.
- Leitores: `DocumentViewer.tsx:26,103` (nova prop `agenteId`; `safeHttpUrl` converte path/URL de partner-documents para a rota, https externo segue igual), `CertificacoesCard.tsx:36,199`, `ProcessoOnboardingClient.tsx:839`. `signedUrl` de evidencias/docs de analise (outros buckets) nao muda.
- Testes: `src/lib/__tests__/agente-corban-documento.test.ts` (3: URL antiga -> path e recusas, autorizacao por agente/socio/correcao, nome seguro). `npm test` 512 testes, 509 pass, 0 fail, 3 skipped; `npx tsc --noEmit` exit 0.
- Pendencias: sem teste de ponta a ponta com objeto real; arquivos com URL antiga so abrem depois que o bucket virar privado se a rota estiver publicada antes (publicar o Workspace antes de privar o bucket); sem rate limit na rota.

ENTREGUE PARA REVISAO
