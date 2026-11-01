# RELATORIO M04 - Login interno em cinco etapas (Workspace)

Branch `security/incidente-2026-10-31`. Tudo local: sem push, deploy, migration remota ou e-mail real.

## 1. Desenho implementado x PROJETO-TECNICO-02 secao 4(B)

| Item da secao 4(B) | Implementado | Diferenca |
|---|---|---|
| Liberacao presa a user+session+finalidade+validade, tabela sem acesso do cliente | `auth_sessao_liberacoes` (unique session+finalidade), RLS deny-all, sem GRANT anon/authenticated | Tabelas em `public` (nao `app_private`) para o service_role alcancar pela Data API; fechadas por RLS sem politica + REVOKE |
| `sessao_interna_liberada()` dentro de `has_permission` | `app_private.sessao_interna_liberada()`, `sessao_interna_ok()` (nao interno passa), `sessao_liberada_para(user,session,aal)` (nucleo, service_role) | Alem do esboco: exige amr `password` E `totp` em `auth.mfa_amr_claims`, `auth.mfa_factors.status='verified'`, bloqueio administrativo e usuario ativo |
| Gate fora do `has_permission` | `is_own_employee` e `is_active_internal_user()` (usada pelas policies M03-A de comunicados, chat) tambem exigem a liberacao. `is_active_internal_user_base()` guarda o corpo original | Achado da revisao automatica, corrigido e testado (AAL1 e senha+TOTP leem 0 linhas) |
| Desafio de e-mail: hash, uso unico, TTL, tentativas/reenvios atomicos | `auth_desafios_email`; HMAC-SHA256(user:sessao:finalidade:codigo) com `AUTH_CODIGO_SEGREDO`; 6 digitos, TTL 10 min, 5 tentativas, reenvio >= 60 s, 3 por sessao/15 min, 10 por usuario/24 h; advisory lock + `FOR UPDATE` | Hash nao inclui o id do desafio (o servidor precisa calcular antes do insert) |
| Destino decidido pelo servidor | `auth_criar_desafio` le `public.users.email` dentro do banco e devolve | - |
| Ativacao do fator por ticket emitido por autorizado | **Substituido**: a ativacao exige desafio de e-mail `ativacao_fator` consumido na MESMA sessao (prova de 10 min, uso unico) antes do `mfa.enroll`; `auth_aprovar_fator` so aprova com a prova. Sem tickets | Decisao do escopo desta tarefa. Remocao do fator por administrador (nova ativacao refaz o e-mail) |
| `mfa_fatores_aprovados` | `auth_mfa_fatores` (um ativo por usuario); fator verificado fora do registro nao libera (testado) | - |
| Pausas | `auth_tentativas` por (chave, etapa senha/totp/email): 3 erros em 15 min => 5 min; reincidencia 15/30/60/120/teto 240 min; decai em 24 h sem falha; em pausa nada soma; sucesso zera. Sem bloqueio automatico de 24 h | Alerta = `alerta=true` no log a partir da 2a pausa (M05 consome) |
| Bloqueio administrativo | `auth_bloqueios_admin` (quem bloqueou, ate quando, quem removeu); revoga liberacoes; gate nega na hora | Sem botao na tela de usuarios (so server actions) |
| `acessos_log` | Tabela + gravacao em toda etapa; motivo em vocabulario `[a-z0-9_]`; sem codigo, senha, QR/segredo, cookie, token | IP/UA "observados" (cabecalho, sem atribuicao) |
| `requireSessaoInternaCompleta` | `src/lib/auth/sessao-interna.ts`; chamado por `requireCurrentUser` (herdado por `requirePermission`/`requireAnyPermission`); erro de infra nega | - |
| Proxy so UX | Redireciona sessao nao liberada para `/acesso` (401/503 em `/api`); Server Actions passam e dependem de `requireCurrentUser` | - |
| Ciclo de vida | Logout (esta/todas) revoga; refresh mantem `session_id` e `expira_em` (nao estende); troca de senha propria revoga as OUTRAS (`trocar-senha/actions.ts`); senha redefinida por admin revoga todas; trigger revoga ao desativar usuario, trocar e-mail (public.users e auth.users) e banir; remocao de fator revoga tudo; desafio expirado/reutilizado/de outra sessao => `inexistente`/`expirado` + log | Troca de senha propria e feita no navegador (`updateUser`); a revogacao ocorre quando a flag e limpa |
| Validade | min(12 h, 23:59 America/Sao_Paulo) | - |

## 2. Arquivos (linhas)
- Migration: `supabase/migrations/20261101030000_security_m04_login_cinco_etapas.sql` (tabelas 38-140; gate 150-320; RPCs 323-620; triggers 621+).
- Nucleo puro: `src/lib/auth/etapas.ts` (dominio, maquina de estados, pausas, classificacao de erro), `codigo-email.ts`, `turnstile.ts`, `mailer.ts` (`ResendMailer` sobre `resend_config` existente com timeout 10 s; `NoopMailer` falha fechado).
- Servidor: `src/lib/auth/sessao-interna.ts`, `src/lib/auth/server.ts:58` (gate em `requireCurrentUser`), `src/lib/supabase/middleware.ts:318` (gate de navegacao).
- Etapas: `src/app/acesso/actions.ts` (entrar, iniciarDesafioEmail, iniciarAtivacaoEmail, verificarCodigoEmail/Ativacao, iniciarAtivacaoTotp, confirmarAtivacaoTotp, verificarTotp, sair), `src/app/acesso/page.tsx`, `AcessoEtapas.tsx`, `src/app/login/page.tsx` (agora chama `entrar`).
- Admin: `src/app/(dashboard)/usuarios/acesso-actions.ts` (bloquear, desbloquear, remover autenticador com recusa do ultimo administrador direto), `usuarios/logs-acessos/page.tsx`, recurso `sistema-logs-acessos` em `permissions.ts`, `divisoes.ts`, catalogo em `usuarios/page.tsx`.
- Testes: `supabase/tests/run-m04.sh`, `security_m04_login_cinco_etapas.sql`, `fixtures/30_m04_auth_stubs.sql`; `src/lib/auth/__tests__/login-etapas.test.ts`, `gate-estatico.test.ts`, `gate-lacunas.txt`. `run-m03a.sh` passou a ignorar migrations >= 20261101030000 (cada pacote tem seu runner).

## 3. Migrations e ordem
20261101010000 (M03-A inicial) -> 20261101020000 (M03-A contencao, define `is_active_internal_user`) -> **20261101030000 (M04)**. Idempotente (reaplicada no runner). Falha com mensagem se faltar pre-requisito.

## 4. Envs novas (so nomes)
`AUTH_CODIGO_SEGREDO` (>= 32 chars; obrigatoria, ausente = login falha fechado), `TURNSTILE_ENFORCE`, `TURNSTILE_SECRET_KEY`. Reutiliza `SUPABASE_SERVICE_ROLE_KEY` e a tabela `resend_config` (Resend ativo + `from_email`).

## 5. Fluxo
**Login:** `/login` (e-mail dominio exato + senha, mensagem generica) -> identidade interna (users ativo, dominio, sem external, sem bloqueio) -> TOTP (aal2) -> codigo de e-mail -> liberada.
**Ativacao inicial (sem fator):** senha -> codigo de e-mail `ativacao_fator` (prova) -> `mfa.enroll` (QR) -> verificacao do TOTP -> `auth_aprovar_fator` -> codigo de e-mail de acesso. Dois codigos na primeira vez (aceito; reduz a janela de sequestro). Quem so tem a senha nao cadastra autenticador.
**Recuperacao/troca de telefone:** administrador com `sistema-usuarios-root` remove o autenticador (`removerAutenticadorUsuario`) e define senha temporaria fora da plataforma; o usuario refaz a ativacao. Sem autosservico.
**Ultimo administrador (PROPOSTA, nao implementado atalho):** a action recusa remover o autenticador do ultimo usuario com `sistema-usuarios-root` direto; so conta permissao direta (se a permissao vem so de perfil, recusa sempre, lado seguro). Quebra de vidro: titular do projeto Supabase, pelo painel, remove o fator em `auth.mfa_factors` e marca `auth_mfa_fatores.removido_em`, com registro posterior em incidente. Falta definir quem sao os titulares.

## 6. Depende do Bruno
- Chaves Turnstile (site + secret) e decisao de ligar `TURNSTILE_ENFORCE` (a tela de login ainda nao renderiza o widget; o hook de servidor esta pronto).
- Religar o e-mail do Auth (nao e usado por este fluxo; nada depende disso) e confirmar o provedor do codigo: hoje usa Resend/`resend_config`; precisa estar ativo com remetente verificado, senao NINGUEM entra.
- Gerar `AUTH_CODIGO_SEGREDO` na Vercel.
- Habilitar TOTP (MFA) no Auth do projeto.
- Confirmar no remoto: `auth.sessions.factor_id/aal/not_after`, `auth.mfa_amr_claims`, `auth.mfa_factors.status`, claim `session_id` no JWT e permissao do owner da migration para ler `auth.sessions`.

## 7. Riscos
- **Lockout no rollout:** apos aplicar, TODOS os internos exigem ativacao. Sem e-mail funcionando = ninguem entra e nao existe "desligar o gate". Aplicar migration e deploy juntos, com teste de e-mail antes e um administrador ativando primeiro.
- Legacy JWT secret (quem o tem forja `session_id/aal`); o vinculo com `auth.sessions` reduz, nao elimina.
- Cookie `httpOnly:false` (sequestro de sessao ja liberada).
- Pausa de senha por e-mail informado permite negar login de uma vitima por 5 min (custo aceito; sem bloqueio longo automatico). Nao ha contador por IP.
- Triggers em `auth.users`: confirmar que o owner pode cria-los no Supabase (existe `on_auth_user_created`).
- Policies fora do repositorio que nao usem `has_permission`/`is_active_internal_user` continuam sem o gate.

## 8. Rollback
Reverter a aplicacao (commits M04) e executar: recriar `has_permission`/`is_own_employee` com o corpo de `20260601132916` e `is_active_internal_user` com o corpo de `20261101020000`; `drop trigger m04_users_revogar_liberacoes on public.users; drop trigger m04_authusers_revogar_liberacoes on auth.users;` as tabelas/RPCs `auth_*` e `acessos_log` podem ficar (inertes). Rollback do gate e emergencia consciente (e o bypass que o desenho evita).

## 9. Pendencias
- 76 handlers `/api` sem `requireCurrentUser` (30 usam `getUser`; 46 sao webhook/segredo/publicos) listados em `gate-lacunas.txt`; hoje cobertos pelo gate do proxy (nao pelo handler). Server Action sem gate: `lib/google/calendar.ts` (userId do cliente, protegido por RLS). Teste estatico impede novos.
- Politicas por dono (RESTRICTIVE) e `realtime.messages` com o gate: nao feitas.
- Storage: URLs assinadas ja dependem de handlers (ver lacunas); politicas de `storage.objects` via `has_permission` herdam o gate.
- UI: widget Turnstile no login; botoes de bloqueio/desbloqueio/remover autenticador na tela de usuarios; logout "todas" sem botao; secure password change/email change do Auth.
- Troca de e-mail interno: hoje o trigger revoga, mas o fluxo administrativo ainda usa `email_confirm` existente.
- Teste real de ponta a ponta (Auth + MFA + Resend reais) so em homologacao autorizada.

## 10. Testes executados (reais)
- `supabase/tests/run-m04.sh` (Postgres 17 descartavel): base + M03-A inalterados verdes; M04 aplicada 2x; 13 grupos de testes SQL OK (so senha / senha+TOTP => false; outra sessao, expirada, revogada, bloqueio admin, fator nao aprovado, troca de e-mail; parceiro e nao interno intocados; pausas 5/15 min + alerta, janela, separacao por etapa; ativacao sem prova negada; tabelas/RPCs fechadas; RLS de comunicados e chat com AAL1/AAL2/liberada/service_role). Resultado: `M04 TUDO OK`.
- `npm test`: 503 testes, 500 pass, 0 fail, 3 skipped (inclui 8 novos de M04). `npx tsc --noEmit`: sem erros. ESLint: erros pre-existentes (`any` em praises, setState em effect no login) nao introduzidos por M04.
- NAO executado: `next build` (instruido), navegador, Supabase/Resend/Turnstile reais.

## 11. Correcoes pos-revisao (REVISAO-M04)
Commits locais: 1f78706e (B1), d6901ff1 (I2, I3), 09a7f5f1 (I1), 4970354a (I5, teto duro, IP), mais o commit desta secao/I4. Migrations novas: `20261101035000_security_m04_correcoes_revisao.sql` (I2/I3) e `20261101036000_security_m04_gate_policies_dono.sql` (I5), ambas entre M04 e M05, idempotentes, aplicadas 2x no runner.
- **B1**: `next-action` so isenta fora de `/api` (`lib/auth/gate-requisicao.ts`); `hasPermissionForUser` devolve false se o userId e o da sessao corrente e ela nao esta liberada; novo `requireApiUser()` (usuario da sessao liberada ou null -> 401). 33 handlers migrados (30 da lista + calendar/events, comunicados, users/list); `gate-lacunas.txt` encolheu 30 linhas; teste estatico agora ignora comentarios e exige chamada `nome(`, e falha se algum route.ts ainda usar `auth.getUser(`. Isencao `/api/auth` removida do gate (as rotas google ja eram publicRoutes). `/api/cpfhub` continua publico POR DESENHO (onboarding de parceiro com x-onboarding-token); o ramo autenticado usa requireApiUser.
- **I2**: pausa de senha em tres chaves: (identificador,origem) escalonada 3 falhas; IP 20 falhas -> 5 min fixos; so-identificador 10 falhas -> 5 min fixos, sem escalada, decai em 24 h, e Turnstile ligado e valido dispensa esta pausa leve. `auth_desbloquear_usuario(..., p_identificador)` zera as chaves de senha do usuario (hash do e-mail gravado em `auth_tentativas.identificador`).
- **Achado do coordenador (captcha)**: tier duro por identificador (30 falhas/15 min -> pausa escalonada 5 e 15 min, teto 15 min) que o captcha NAO dispensa (`pausa-senha.ts`, teste node). IP so de cabecalho da plataforma: `ip-confiavel.ts` (so com `VERCEL` definido, primeiro valor de x-forwarded-for/x-real-ip, validado como IP; fora disso null e o limitador por IP nao atua). DESVIOS e PENDENCIAS: (a) nao contamos falhas DURANTE a pausa para escalar (qualquer pausa se estenderia por terceiro, contra a decisao 3); o teto fixo de 15 min limita o dano. (b) Step-up por e-mail para o usuario legitimo quando so o identificador excedeu NAO foi implementado: exigiria desafio de e-mail antes de existir sessao (novo fluxo/migration); hoje o legitimo espera a pausa (max 15 min) ou o administrador desbloqueia.
- **I3**: trigger de `auth.users` cobre `encrypted_password`. Troca de senha agora e Server Action `trocarSenha` (exige `requireCurrentUser`, senha atual verificada com cliente sem persistencia, 5 tentativas -> pausa 5 min); `clearPasswordResetFlag` removida. Efeito: apos trocar a senha (inclusive a temporaria do primeiro acesso) todas as liberacoes caem e o usuario refaz o login completo. Ligar "Secure password change" no painel Auth continua pendencia do Bruno.
- **I1**: `POST /api/auth/hooks/mfa-verification` (`lib/auth/hook-mfa.ts`): assinatura Standard Webhooks com `AUTH_HOOK_MFA_SECRET`; sem env 503, assinatura invalida/antiga 401, erro de infra 503 (falha fechada); `valid=false` chama `auth_registrar_falha(user,'totp')` e rejeita em pausa; em pausa rejeita ate com codigo certo. `AUTH_HOOK_MFA_ATIVO=true` faz a Server Action nao contar de novo. **PENDENCIA DO BRUNO (painel Auth)**: Authentication > Hooks > MFA Verification Attempt -> HTTPS `https://<dominio>/api/auth/hooks/mfa-verification`, gerar o segredo, guardar em `AUTH_HOOK_MFA_SECRET` na Vercel, depois `AUTH_HOOK_MFA_ATIVO=true`; reduzir tambem o rate limit de MFA challenge/verify. Rota liberada em publicRoutes (`/api/auth/hooks`).
- **I4**: `PRE-ROLLOUT-M04.sql` (so SELECTs: fora do dominio, e-mail divergente, sem e-mail valido, sem auth.users, root direto, root so por perfil, resend_config). Ordem: lista -> Resend testado -> TOTP ligado -> `AUTH_CODIGO_SEGREDO` -> migrations+deploy juntos -> Bruno ativa -> segundo admin -> demais -> Turnstile e hook MFA depois (Turnstile DESLIGADO ate o widget existir). **Quebra de vidro (sem atalho no codigo)**, so por SQL editor/psql do titular do projeto (Data API desligada), com registro posterior em incidente: `delete from auth.mfa_factors where user_id = '<uuid>';` `update public.auth_mfa_fatores set removido_em = now() where user_id = '<uuid>' and removido_em is null;` `select public.auth_revogar_liberacoes('<uuid>','quebra_de_vidro',null);` `select public.auth_desbloquear_usuario('<uuid>','<uuid_do_titular>','quebra de vidro');` e definir senha temporaria fora da plataforma. Titulares nomeados: pendencia.
- **I5**: policy RESTRICTIVE `m04_gate_sessao_interna` em 11 tabelas por dono (comunicado_reads, praise_notifications, record_comments, user_google_auth, workspace_notifications, workspace_chat_*, hub_banners, marketing_arte_associacoes) e `avatars_select_authenticated` com gate; nao interno passa. Pendente: `realtime.messages` fora do repo (inventario), demais tabelas por dono criadas fora do repo.
- **Menores**: M1 e M2 feitos. M3-M7 nao tratados (aceitos pela revisao).
- **Testes reais**: `bash supabase/tests/run-m04.sh` -> `M04 TUDO OK` (rc=0; 15 grupos originais + 8 de correcoes); `npm test` -> 553 testes, 550 pass, 0 fail, 3 skipped; `npx tsc --noEmit` sem erros. Nao executado: next build, navegador, Auth/Resend/Turnstile reais.

ENTREGUE PARA REVISAO
