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

ENTREGUE PARA REVISAO
