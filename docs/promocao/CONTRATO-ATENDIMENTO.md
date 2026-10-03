# CONTRATO — "Solicitar atendimento" (Promoção NuAzul Valparaíso)

> Lei para as frentes B (API + envio), C (config UI), G (site) e T (testes).
> Fonte de negócio: `.claude/tmp/promocao-atendimento-spec.md` (Bruno, 03/10/2026, com a
> regra final dos botões do indicador) e `docs/promocao/CONTRATO.md` (convenções, §4 formato
> de erro, `promocao_envios`, `promocao_limite_tentar`). Em conflito, vale ESTE arquivo.
> Migration: `supabase/migrations/20261003161242_promocao_atendimento.sql` (já escrita; NÃO
> aplicada — db push é do coordenador depois da revisão).
>
> Convenções herdadas: telefone E.164 sem `+` (`5561999990000`), CPF 11 dígitos, erros
> `{ error: { code, message, ...extra } }` via `erro()` de `src/lib/promocoes/http.ts`,
> sucesso via `ok()`, honeypot `site`, `campanha` = slug no body/query. Rotas em
> `src/app/api/promocoes/publico/**` já são públicas (`publicRoutes` cobre o prefixo).

---

## 1. DECISÕES E FUROS FECHADOS

| # | Furo | Decisão |
|---|---|---|
| 1.1 | **Quem pede é o titular do cadastro recém-concluído?** O `otpToken` é consumido (uso único) no `POST /inscricoes`; a resposta do servidor não traz segredo nenhum. | **Servidor:** `POST /inscricoes` passa a devolver `atendimentoToken` (32 bytes base64url via `gerarToken()`; só o `sha256` fica em `promocao_inscricoes.atendimento_token_hash`, validade **24 h** em `atendimento_token_expira_em`). Emitido em TODAS as saídas 200 da rota (nova, `repetida`, `assumida`, "mesmo telefone"), sempre renovando o hash (último vence). **Indicador:** `POST /indicacoes` devolve um `atendimentoToken` PRÓPRIO (mesmo formato, hash em `promocao_indicacoes.atendimento_token_hash`, 24 h), também renovado em `respostaExistente`. **NUNCA o `comprovanteToken`**: ele circula em URL (`/api/promo/comprovante?t=`) e cai em logs/histórico (M1). Os tokens de atendimento só viajam no corpo JSON de POSTs — nunca em query string (M6). Token inválido/expirado → `404 LINK_INVALIDO` (genérico). |
| 1.2 | **Disparar para telefone/CPF alheio.** | O site NUNCA manda telefone, CPF nem instância: o alvo é derivado no servidor a partir do token (servidor → `promocao_inscricoes.telefone`; indicado → `telefone` da inscrição do indicado). Servidor só recebe se `promocao_inscricoes.telefone_verificado = true` (OTP provou posse). Indicado: exige `promocao_indicadores.telefone_verificado = true` do indicador (quem consente provou quem é) + `autorizacao: true` no body (prova gravada no pedido). OTP desligado/instância OTP fora → cadastro segue, mas o botão da empresa fica indisponível (`401 TELEFONE_NAO_VERIFICADO`). |
| 1.3 | **Unicidade — "é um envio só por CPF" (Bruno).** | `UNIQUE (campanha_id, cpf_alvo)` — INDEPENDENTE do `tipo` — e `UNIQUE (campanha_id, telefone_alvo)` em `promocao_pedidos_atendimento`. Indicado que já recebeu a mensagem pela indicação e depois se cadastra como servidor (mesmo com outro telefone) NÃO recebe 2ª mensagem: o `GET /estado` do servidor devolve `ja_enviado` e o `POST` devolve `409 JA_ENVIADO`, qualquer que seja o tipo do pedido existente. Linha nasce só depois de TODOS os gates; 23505 (em qualquer dos 2 índices) → `409 JA_ENVIADO` com o `status` do pedido existente. Pedido `rejeitado` (número sem WhatsApp) também bloqueia nova tentativa. A coluna `tipo` fica só como registro de qual botão originou o envio. |
| 1.4 | **Limite por indicador 30/h (RH da prefeitura) — ATÔMICO (B1).** | Duas barreiras. **1ª (decisão, pré-escolha):** contagem `count(*) from promocao_pedidos_atendimento where campanha_id=? and indicador_id=? and created_at > now()-1h` ≥ `limite_atendimento_indicador_hora` → `429 LIMITE_INDICADOR` (janela deslizante, barata, sem reservar slot). **2ª (reserva atômica, imediatamente antes do insert do pedido):** `promocao_limite_tentar('rl:atend:indicador:<indicadorId>', limite_atendimento_indicador_hora, 3600)` via `limiteTentar()` (fail-closed: erro = estourou) → `false` → `429 LIMITE_INDICADOR`. A janela do RPC é fixa (reinicia ao expirar) e conta tentativas que depois falham — aceito como teto duro. |
| 1.5 | **Teto por instância e por campanha — ATÔMICO (B1).** | **1ª barreira (escolha principal→reserva):** contagem por `instancia_usada_id` (`created_at > now()-1h` ≥ `limite_atendimento_instancia_hora` ou `> now()-24h` ≥ `limite_atendimento_instancia_dia`) marca a instância "cheia" e pula para a reserva. **2ª barreira (reserva de slots, após escolher e antes do insert), nesta ordem:** `rl:atend:camp:d` (constante `TETO_CAMPANHA_DIA = 300`, 86400 s) → `rl:atend:inst:<instanciaId>:h` (`limite_atendimento_instancia_hora`, 3600) → `rl:atend:inst:<instanciaId>:d` (`limite_atendimento_instancia_dia`, 86400). Qualquer `false` → `429 LIMITE_INSTANCIA` (slots já consumidos nas chaves anteriores NÃO são devolvidos — custo aceito). Defaults 40/h, 200/dia (configuráveis). |
| 1.5b | **Janela de horário (A2).** | Envios da empresa só das **07:00 às 21:00 America/Sao_Paulo** (constantes `HORA_INICIO_ATENDIMENTO = 7`, `HORA_FIM_ATENDIMENTO = 21`, hora civil via `Intl.DateTimeFormat('en-US', { timeZone:'America/Sao_Paulo', hour:'numeric', hour12:false })`; válido se `7 <= h < 21`). Fora: `gatesGlobais` devolve `fora_horario`; `estado` → `botao:'fora_horario'` (botão DESABILITADO, não escondido, com a mensagem M-H §5.5); `solicitar` → `409 FORA_HORARIO`. Vale também na reavaliação da hora do envio (1.9b). |
| 1.6 | **Allowlist e fallback.** | Candidatas, nesta ordem: `instancia_atendimento_id`, `instancia_atendimento_reserva_id`. Cada uma só vale se: existe, `deleted_at is null`, `status='conectada'`, `conta_id → chat_contas.agente_parceiro_id = parceiro_atendimento_id`, `id <> campanha.instancia_id` (nunca a 7033/OTP) e não "cheia" (1.5). Primeira que passa é a usada. Nenhuma → `409 ATENDIMENTO_INDISPONIVEL` (sem detalhe público) ou `429 LIMITE_INSTANCIA` se a única causa foi teto. |
| 1.7 | **Gates globais** (ordem fixa, antes de tocar no token). | campanha `status='ativa'` → `cadastroFechado()` (fora do período: 410/409 já existentes) → `atendimento_pausado=false` → `atendimento_liberado_em is not null and <= now()` → `parceiro_atendimento_id` e `instancia_atendimento_id` preenchidos. Qualquer um falhando → `409 ATENDIMENTO_INDISPONIVEL`. O `GET /estado` devolve `botao:'indisponivel'` nos mesmos casos. Cadastro nunca trava: tudo isso é só do botão da empresa. |
| 1.8 | **CPF/telefone bloqueado (§19).** | `cpfBloqueado(admin, campanhaId, [cpf_alvo, cpf_indicador?])` → `409 ATENDIMENTO_INDISPONIVEL` (genérico, sem oráculo). Telefone bloqueado: não há tabela de telefones; o `UNIQUE` por telefone + operação manual (lista de CPFs) cobre o "SAIR" por enquanto. |
| 1.9 | **Idempotência, LEASE e `EngineEnvioIncertoError` (B2).** | Pedido → `promocao_envios` com `chave = 'atendimento:<pedidoId>'` (operation_id nasce uma vez). Fluxo: insert pedido `pendente` → `enqueueJob('promocoes.atendimento_enviar', {pedidoId}, dedupe 'promo-atend:<pedidoId>', maxAttempts 5, **runAfter = now()+90 s**)` → tentativa inline → job só como FALLBACK. **Lease antes de QUALQUER POST ao engine (inline e job):** `update promocao_pedidos_atendimento set status='incerto', erro='enviando' where id=? and status='pendente'` e só prossegue se afetou exatamente 1 linha (`.select('id')` → `length === 1`); 0 linhas = outro executor já tem o pedido (ou já terminou) → sai sem tocar no engine. (`incerto` já está no CHECK de `status`; `erro='enviando'` é o marcador do lease.) Resultado: `confirmado` → `enviado` (+`enviado_em`, `erro=null`); `EngineEnvioIncertoError` → fica `incerto` com `erro='ENVIO_INCERTO: <mensagem>'` e é TERMINAL (a conta do parceiro não é durável no engine, que NÃO deduplica `operationId`: pode ter saído 1 mensagem, nunca reenviar; o job conclui sem retentar; o botão fica `ja_enviado`); `rejeitado` com `numero_sem_whatsapp` → `rejeitado`; outra rejeição PRÉ-envio (`EngineErro`, nada saiu: `INSTANCIA_DESCONECTADA` etc.) → volta para `pendente` com `erro`, o job retenta. **Instância fixa:** `instancia_usada_id` gravada no insert e nunca troca (trigger) — retentar pela reserva mudaria o alvo do mesmo operation_id. |
| 1.9b | **Reavaliar na hora do envio (A1).** | Inline e job, ANTES do lease: reler `promocao_campanhas` e abortar sem tocar no engine se `atendimento_pausado`, se `gatesGlobais(camp, agora) !== 'ok'` (inclui `fora_horario`), se `pedido.instancia_usada_id ∉ {instancia_atendimento_id, instancia_atendimento_reserva_id}` atuais, se a instância não é mais do `parceiro_atendimento_id` (conta → `chat_contas.agente_parceiro_id`) ou não está `conectada`. Abortar = lançar `Error('ATENDIMENTO_REAVALIACAO: <motivo>')` (pedido segue `pendente`; o job reagenda). |
| 1.9c | **Esgotamento (M2).** | No handler do job, se `job.attempts + 1 >= job.max_attempts` e o envio não confirmou, marcar `update ... set status='rejeitado', erro='ESGOTADO' where id=? and status='pendente'` (`incerto` é terminal e não vira `rejeitado`; o `attempts` já vem incrementado pelo `claimDueJobs`, então a condição é `attempts >= max_attempts`) antes de lançar. `estado` passa a devolver `falhou`; o lead usa o botão receptivo. (Com `incerto` real pode ter saído 1 mensagem — aceito: nunca há 2ª.) |
| 1.10 | **Sem `origem` no `engine.enviar`.** | `engine.enviar(instanciaId, destino, texto, { operationId })` — nenhum campo extra. `origem='disparo'` esconderia a conversa na fila do GO337. |
| 1.11 | **Botão B do indicador (wa.me próprio).** | Sempre permitido, nunca invalidado, só auditoria: `POST /atendimento/evento`. Texto e URL vêm do servidor (`whatsappIndicadoUrl` na resposta do `POST /indicacoes`) para a redação ser única. |
| 1.12 | **Consentimento (texto/versão).** | Constantes em código (`src/lib/promocoes/atendimento-textos.ts`): `CONSENTIMENTO_INDICADO_VERSAO = '2026-10-03'` e `CONSENTIMENTO_INDICADO_TEXTO` (§5.3). Cópia gravada no pedido (imutável por trigger). Sem coluna de config: mudar texto = mudar versão no código. Não grava em `promocao_aceites` (CHECK de `finalidade` teria de mudar; o pedido já é a prova). **Risco de deriva anotado:** o site copia os textos literalmente (repo separado); a prova gravada é a do SERVIDOR — toda mudança de redação exige PR nos dois repos + bump da versão, e o teste de T fixa a string. |
| 1.13 | **Resposta pública mínima.** | `GET /estado` e `POST /solicitar` nunca devolvem telefone, CPF, nome, id de instância ou motivo técnico. Só `botao`/`status`/`mensagem`. |
| 1.14 | **Marca.** | Mensagens citam só NuAzul; a conversa nasce na conta Chatwoot do GO337 (fila do Atendimento do CRM), sem atendente. Como a tela do CRM mostra contato sem lead: confirmar no 1º teste (fora deste escopo). |

Não bloqueante (o Bruno revisa quando quiser): redação final das 3 mensagens (§5); "iPhone 17" vs "17e" no texto ao indicado (regras.md permite "17" no destaque).

**Pendências pós-lançamento (revisão de segurança, não bloqueiam):** M3 — anonimização/expurgo LGPD de `promocao_pedidos_atendimento` (ip, user_agent, telefone_alvo) após o fim da campanha (entrar no `promocao_expurgar()` ou rotina própria); M4 — processo do "SAIR" (hoje manual: equipe adiciona o CPF em CPFs Bloqueados; sem tabela de telefones bloqueados).

---

## 2. MODELO DE DADOS (migration `20261003161242_promocao_atendimento.sql`)

### 2.1 `promocao_campanhas` — colunas novas
```
parceiro_atendimento_id uuid null references agentes_parceiros(id)
instancia_atendimento_id uuid null references chat_instancias(id)
instancia_atendimento_reserva_id uuid null references chat_instancias(id)
atendimento_liberado_em timestamptz null            -- gate manual (null = nunca liberado)
atendimento_pausado boolean not null default false
limite_atendimento_indicador_hora integer not null default 30
limite_atendimento_instancia_hora integer not null default 40
limite_atendimento_instancia_dia integer not null default 200
check: limites > 0; reserva <> principal; nenhuma das duas = instancia_id (OTP)
```

### 2.2 `promocao_inscricoes` E `promocao_indicacoes` — colunas novas (iguais nas duas)
```
atendimento_token_hash text null  (unique parcial: promocao_inscricoes_atend_token_uq / promocao_indicacoes_atend_token_uq)
atendimento_token_expira_em timestamptz null
```

### 2.3 `promocao_pedidos_atendimento`
```
id uuid pk
campanha_id uuid not null fk
tipo text not null check in ('servidor','indicado')
inscricao_id uuid not null fk promocao_inscricoes     -- servidor: a própria; indicado: a do indicado
indicacao_id uuid null fk promocao_indicacoes         -- só indicado (check)
indicador_id uuid null fk promocao_indicadores        -- só indicado (check)
cpf_alvo char(11) not null
telefone_alvo text not null
consentimento_texto text null, consentimento_versao text null   -- obrigatórios se tipo='indicado' (check)
ip text null, user_agent text null
status text not null default 'pendente' check in ('pendente','enviado','incerto','rejeitado')
envio_id uuid null fk promocao_envios
instancia_usada_id uuid null fk chat_instancias       -- fixada antes do 1º POST; trigger impede troca
erro text null, enviado_em timestamptz null
created_at, updated_at (trigger_set_timestamp)
unique (campanha_id, cpf_alvo)  -- independente do tipo; unique (campanha_id, telefone_alvo)
index (campanha_id, indicador_id, created_at desc) where indicador_id not null
index (instancia_usada_id, created_at desc) where instancia_usada_id not null
index (status, created_at)
RLS on, sem policy; revoke all from anon, authenticated
trigger before update: identidade + consentimento + ip/ua/created_at imutáveis; instancia_usada_id imutável depois de preenchida
trigger before delete: bloqueado (promocao_bloquear_mutacao)
```

### 2.4 `promocao_envios.tipo`
CHECK recriado com `+ 'atendimento_servidor', 'atendimento_indicado'`. Em `src/lib/promocoes/whatsapp.ts`, `TipoEnvioPromocao` ganha os dois literais (frente B).

### 2.5 `promocao_eventos` (sem schema novo) — tipos usados
`atendimento.pedido_criado` (entidade `pedido_atendimento`, dados `{tipo, inscricaoId, indicacaoId?, instanciaUsadaId}`), `atendimento.enviado`, `atendimento.rejeitado` (`{erro}`), `atendimento.indicador_sem_autorizacao` e `atendimento.indicador_abriu_whatsapp_proprio` (entidade `indicacao`, dados `{}` — sem PII), `campanha.atendimento_config_alterada` (entidade `campanha`, `{campos, mudancas}`, `ator_user_id`).

---

## 3. API PÚBLICA — `src/app/api/promocoes/publico/atendimento/**` (frente B)

Comum: `export const dynamic = 'force-dynamic'`; `maxDuration = 30` (solicitar: 60). Rate limit por IP com `aplicarLimites` (soft) + por token (hash). Campanha: `buscarCampanha(slug)` (só `ativa`) → `404 CAMPANHA_INDISPONIVEL`.

### 3.1 `POST /atendimento/estado` (POST, não GET: token nunca em URL — M6)
Request: `{ "campanha": "valparaiso-go", "tipo": "servidor" | "indicado", "t": "<atendimentoToken>", "site": "" }`.
Rate limit: `rl:atend-est:ip:<ip>` 300/h; `rl:atend-est:tok:<sha256(t)>` 60/h.

Resposta 200 (sempre 200 quando campanha e token válidos):
```json
{ "botao": "disponivel" | "ja_enviado" | "indisponivel" | "fora_horario" | "falhou", "status": null | "pendente" | "enviado" | "incerto" | "rejeitado", "mensagem": "..." }
```
Regras (primeira que casar):
1. token inválido/expirado → `404 LINK_INVALIDO` ("Este cadastro não está mais disponível. Recarregue a página.")
2. pedido existente por CPF alvo OU telefone alvo (qualquer `tipo`, §1.3): `rejeitado` → `botao:'falhou'`, mensagem M-F (§5.5); senão → `botao:'ja_enviado'`, mensagem M-J (§5.5) + `status`.
3. gates 1.7 falhando (exceto horário), OU telefone não verificado (1.2), OU CPF bloqueado, OU nenhuma candidata conectada (ignora teto aqui) → `botao:'indisponivel'`, `mensagem: ''` (site simplesmente não mostra o botão).
4. `gatesGlobais === 'fora_horario'` (1.5b) → `botao:'fora_horario'`, mensagem M-H (§5.5) — botão visível e desabilitado.
5. senão `botao:'disponivel'`, `mensagem: ''`.

### 3.2 `POST /atendimento/solicitar`
Request:
```json
{ "campanha": "valparaiso-go", "tipo": "servidor" | "indicado", "t": "<atendimentoToken do servidor | atendimentoToken do indicador>", "autorizacao": true, "site": "" }
```
`autorizacao` só é lido quando `tipo='indicado'` (obrigatório `=== true`).

Ordem FIXA:
1. `lerJson` → `400 DADOS_INVALIDOS`; honeypot `site` → `200 {ok:true}` fake.
2. campanha ativa → 404; `cadastroFechado(camp)` → 410 `CAMPANHA_ENCERRADA` / 409 `CAMPANHA_NAO_INICIADA`.
3. `aplicarLimites([['rl:atend:ip:<ip>', 100, 3600]])` → 429 `LIMITE_EXCEDIDO`.
4. `tipo` ∉ {servidor, indicado} ou `t` fora de 20–100 chars → `400 DADOS_INVALIDOS`.
5. Gates globais 1.7 → `409 ATENDIMENTO_INDISPONIVEL`; `fora_horario` (1.5b) → `409 FORA_HORARIO`.
6. `aplicarLimites([['rl:atend:tok:<sha256(t)>', 10, 3600]])` → 429.
7. Resolver alvo pelo token (`resolverAlvo`, §4.2) → `404 LINK_INVALIDO`. Inscrição `status<>'ativa'` ou indicação `status<>'valida'` → 404 também.
8. `tipo='indicado'` e `autorizacao !== true` → `409 SEM_CONSENTIMENTO`.
9. telefone verificado (1.2) → `401 TELEFONE_NAO_VERIFICADO`.
10. `cpfBloqueado(admin, camp.id, [cpf_alvo, cpfIndicador?])` → `409 ATENDIMENTO_INDISPONIVEL`.
11. pedido existente por (campanha, cpf_alvo) OU (campanha, telefone_alvo) — SEM filtrar por tipo → `409 JA_ENVIADO { status }` (se `status='rejeitado'`, mensagem M-F; a mensagem M-J/M-F é a do `tipo` da REQUISIÇÃO, não a do pedido gravado).
12. `tipo='indicado'`: contagem 1.4 (1ª barreira) ≥ limite → `429 LIMITE_INDICADOR`.
13. `escolherInstancia` (§4.3, usa a contagem 1.5 como 1ª barreira) → `'nenhuma_conectada'`: `409 ATENDIMENTO_INDISPONIVEL`; `'todas_cheias'`: `429 LIMITE_INSTANCIA`.
14. **Reserva atômica de slots (2ª barreira, B1)**, em ordem e parando no 1º `false`: `tipo='indicado'` → `limiteTentar('rl:atend:indicador:<indicadorId>', camp.limite_atendimento_indicador_hora, 3600)` (`false` → `429 LIMITE_INDICADOR`); `limiteTentar('rl:atend:camp:d', TETO_CAMPANHA_DIA=300, 86400)`; `limiteTentar('rl:atend:inst:<instanciaId>:h', camp.limite_atendimento_instancia_hora, 3600)`; `limiteTentar('rl:atend:inst:<instanciaId>:d', camp.limite_atendimento_instancia_dia, 86400)` (qualquer `false` destes 3 → `429 LIMITE_INSTANCIA`). `limiteTentar` é fail-closed (erro na RPC = `false`).
15. `insert promocao_pedidos_atendimento` (`pendente`, `instancia_usada_id` já preenchida, consentimento + ip + ua) — 23505 → repete passo 11.
16. `registrarEvento(... 'atendimento.pedido_criado')`; `enqueueJob({ kind:'promocoes.atendimento_enviar', payload:{ pedidoId }, dedupeKey:'promo-atend:<pedidoId>', maxAttempts: 5, runAfter: new Date(Date.now() + 90_000) })` — fallback, nunca concorrente com o inline (B2). Se `enqueueJob` não aceitar `runAfter`, B adiciona o parâmetro opcional em `src/lib/scp-engine/queue.ts` (coluna `run_after` já existe em `process_jobs`).
17. `enviarPedidoAtendimento(pedidoId)` inline (§4.2: reavaliação 1.9b → lease 1.9 → engine) com `Promise.race` de 20 s → resposta. Timeout do race NÃO altera o pedido (o lease já está com o executor inline; quando ele terminar grava o resultado; se morrer, o job encontra `incerto`/`enviando` e retenta com o mesmo operation_id).

Resposta 200: `{ "status": "enviado" | "pendente" | "incerto", "mensagem": "<M-OK (§5.5)>" }` (`incerto` e `pendente` usam a mesma mensagem M-OK: para o lead, "já enviamos").

Erros (todos `{ error: { code, message } }`):

| HTTP | code | message (pt-BR, pronta p/ exibir) |
|---|---|---|
| 400 | `DADOS_INVALIDOS` | Requisição inválida. |
| 404 | `CAMPANHA_INDISPONIVEL` | Campanha indisponível. |
| 404 | `LINK_INVALIDO` | Este cadastro não está mais disponível. Recarregue a página. |
| 410/409 | `CAMPANHA_ENCERRADA` / `CAMPANHA_NAO_INICIADA` | (as de `cadastroFechado`) |
| 409 | `ATENDIMENTO_INDISPONIVEL` | No momento não conseguimos chamar você por aqui. Use o botão "Falar no WhatsApp". |
| 409 | `FORA_HORARIO` | M-H (§5.5) |
| 409 | `SEM_CONSENTIMENTO` | Confirme que você tem autorização do indicado para receber nossa mensagem. |
| 401 | `TELEFONE_NAO_VERIFICADO` | Para a NuAzul chamar, o WhatsApp precisa ter sido confirmado com o código. Use o botão "Falar no WhatsApp". |
| 409 | `JA_ENVIADO` (+`status`) | M-J ou M-F (§5.5) |
| 429 | `LIMITE_INDICADOR` | Você atingiu o limite de envios por hora. Aguarde alguns minutos e tente novamente. |
| 429 | `LIMITE_INSTANCIA` | Muitos pedidos neste momento. Aguarde alguns minutos e tente novamente. |
| 429 | `LIMITE_EXCEDIDO` | (padrão `LIMITE_EXCEDIDO()`) |
| 500 | `ERRO_INTERNO` | Não foi possível concluir agora. Tente novamente. |

### 3.3 `POST /atendimento/evento` (só auditoria do indicador)
Request: `{ "campanha", "t": "<atendimentoToken do indicador>", "tipo": "indicador_sem_autorizacao" | "indicador_abriu_whatsapp_proprio", "site": "" }`.
Rate limit `rl:atend-ev:tok:<sha256(t)>` 30/h, `rl:atend-ev:ip:<ip>` 300/h. Token → `promocao_indicacoes.atendimento_token_hash` (NÃO o comprovante); inválido → `404 LINK_INVALIDO`. Grava `promocao_eventos` (`entidade='indicacao'`, `tipo='atendimento.'+tipo`, `dados={}`). Resposta sempre `200 {ok:true}` (até para tipo desconhecido — não dá oráculo; só grava os 2 tipos da allowlist). Site chama com `fetch(..., { keepalive: true })` e ignora o resultado.

### 3.4 Alterações nas rotas existentes (frente B, mínimas)
- `POST /inscricoes` (`resposta()` e o `ok` final): `+ atendimentoToken` — `const { token, hash } = gerarToken()`; `update promocao_inscricoes set atendimento_token_hash=hash, atendimento_token_expira_em=now()+24h where id`. Helper `novoTokenAtendimento(admin, inscricaoId)` em `src/lib/promocoes/atendimento.ts`.
- `POST /indicacoes` (`respostaExistente()` e o `ok` final): `+ atendimentoToken` (helper `novoTokenAtendimentoIndicacao(admin, indicacaoId)`, hash em `promocao_indicacoes.atendimento_token_hash`, 24 h) e `+ whatsappIndicadoUrl` (§5.4), montado com `telefoneContatoDigitos(admin, camp)` (null → campo `null`, site esconde o botão B). O `comprovanteToken` continua existindo só para o comprovante.

---

## 4. FILA / ENVIO (frente B)

### 4.1 `src/lib/promocoes/whatsapp.ts` — função irmã
```ts
export type TipoEnvioPromocao = ... | 'atendimento_servidor' | 'atendimento_indicado'
/** Igual a enviarWhatsappPromocao, mas pela instância PASSADA (já validada pela allowlist). Nunca lê campanha.instancia_id. */
export async function enviarWhatsappPorInstancia(e: EnvioPromocao, instanciaId: string): Promise<ResultadoEnvio>
```
Implementação: extrair o miolo de `enviarWhatsappPromocao` (upsert `promocao_envios` por `chave` → `status='enviado'` curto-circuita → checa `chat_instancias.status==='conectada' && deleted_at is null` da instância passada → `engine.enviar(instanciaId, normalizarTelefoneDestino(tel), texto, { operationId })` → marca enviado/incerto/rejeitado). `enviarWhatsappPromocao` vira `instanciaDaCampanha` + chamada da irmã. Sem `origem`.

### 4.2 `src/lib/promocoes/atendimento.ts` (I/O)
```ts
export type Alvo = { tipo:'servidor'|'indicado'; inscricaoId: string; indicacaoId: string|null; indicadorId: string|null; cpfAlvo: string; telefoneAlvo: string; nomeAlvo: string; codigo: string; numeroIndicacao: string|null; nomeIndicador: string|null; telefoneVerificado: boolean; cpfIndicador: string|null }
export async function resolverAlvo(admin, campanhaId, tipo, t): Promise<Alvo | null>
  // servidor: promocao_inscricoes where atendimento_token_hash=hashToken(t) and campanha_id and status='ativa' and atendimento_token_expira_em > now()
  // indicado: promocao_indicacoes where atendimento_token_hash=hashToken(t) and campanha_id and status='valida' and atendimento_token_expira_em > now() → join inscrição (telefone/nome/cpf/codigo) + indicador (nome, cpf, telefone_verificado)
export async function novoTokenAtendimento(admin, inscricaoId): Promise<string>
export async function novoTokenAtendimentoIndicacao(admin, indicacaoId): Promise<string>
export async function pedidoExistente(admin, campanhaId, cpfAlvo, telefoneAlvo): Promise<{ id, status, tipo } | null>   // sem filtro por tipo (1.3): .or(`cpf_alvo.eq.${cpf},telefone_alvo.eq.${tel}`)
export async function contarPedidos(admin, filtro: { campanhaId; indicadorId?: string; instanciaId?: string; desdeMs: number }): Promise<number>
export async function escolherInstancia(admin, camp): Promise<{ id: string } | 'nenhuma_conectada' | 'todas_cheias'>   // §1.6 + §1.5, ordem principal→reserva
export async function criarPedido(admin, camp, alvo, extra: { consentimentoTexto?: string; consentimentoVersao?: string; ip; userAgent; instanciaId }): Promise<{ id } | 'duplicado'>
export async function enviarPedidoAtendimento(pedidoId: string, opts?: { ultimaTentativa?: boolean }): Promise<ResultadoEnvio>
  // 1. lê pedido; 'enviado' → confirmado (no-op); 'rejeitado' → rejeitado (no-op)
  // 2. REAVALIAÇÃO (1.9b): relê promocao_campanhas; pausado / gatesGlobais!=='ok' / instância fora de {principal,reserva} / não é do parceiro / não conectada → throw Error('ATENDIMENTO_REAVALIACAO: <motivo>') sem tocar no engine
  // 3. LEASE (1.9): update set status='incerto', erro='enviando' where id and status='pendente' .select('id') → 0 linhas: 'incerto' já em curso → 'incerto' com erro<>'enviando' é TERMINAL → `{ resultado:'incerto', mensagem:'ENVIO_INCERTO' }` (job conclui); 'enviando' só é retomado se vencido (> 5 min); senão há executor ativo → return { resultado:'incerto', mensagem:'em andamento' }
  // 4. texto = tipo==='servidor' ? textoAtendimentoServidor(...) : textoAtendimentoIndicado(...)
  // 5. r = enviarWhatsappPorInstancia({ campanhaId, chave:`atendimento:${pedidoId}`, tipo:`atendimento_${pedido.tipo}`, telefone, texto }, pedido.instancia_usada_id)
  // 6. envio_id = promocao_envios.id (select por chave); confirmado → 'enviado', enviado_em, erro=null; EngineEnvioIncertoError → 'incerto'+erro(mensagem); rejeitado numero_sem_whatsapp → 'rejeitado'+erro; outra rejeição pré-envio → volta a 'pendente'+erro
  // 7. opts.ultimaTentativa && resultado!=='confirmado' → update set status='rejeitado', erro='ESGOTADO' where id and status in ('pendente','incerto') (1.9c)
  // eventos atendimento.enviado / atendimento.rejeitado
```
Regras puras em `src/lib/promocoes/atendimento-regras.ts` (sem I/O, testadas por T):
```ts
export type GateCampanha = { status: string; inicio_em: string; fim_em: string; atendimento_pausado: boolean; atendimento_liberado_em: string|null; parceiro_atendimento_id: string|null; instancia_atendimento_id: string|null }
export const HORA_INICIO_ATENDIMENTO = 7, HORA_FIM_ATENDIMENTO = 21, TETO_CAMPANHA_DIA = 300
export function dentroDoHorario(agora: Date, fuso = 'America/Sao_Paulo'): boolean   // 7 <= hora civil < 21
export function gatesGlobais(c: GateCampanha, agora: Date): 'ok' | 'inativa' | 'fora_do_periodo' | 'pausado' | 'nao_liberado' | 'sem_instancia' | 'fora_horario'   // usa estadoCadastro(); fora_horario é o ÚLTIMO teste (só quando o resto está ok)
export function instanciaAindaPermitida(c: { instancia_atendimento_id: string|null; instancia_atendimento_reserva_id: string|null }, instanciaUsadaId: string): boolean
export type Candidata = { id: string; status: string; deletedAt: string|null; agenteParceiroId: string|null; enviosHora: number; enviosDia: number }
export function escolherCandidata(cands: Candidata[], ctx: { parceiroId: string; instanciaOtpId: string|null; limiteHora: number; limiteDia: number }): { id: string } | 'nenhuma_conectada' | 'todas_cheias'
export function mapearResultadoParaStatus(r: ResultadoEnvio): 'enviado' | 'incerto' | 'rejeitado' | 'pendente'   // rejeitado só se /sem_whatsapp|not.?on.?whatsapp/i
export function botaoDoEstado(p: { pedidoStatus: string|null; gate: ReturnType<typeof gatesGlobais>; telefoneVerificado: boolean; bloqueado: boolean; algumaConectada: boolean }): 'disponivel'|'ja_enviado'|'indisponivel'|'fora_horario'|'falhou'
```

### 4.3 Job — `src/lib/promocoes/jobs-atendimento.ts` + 1 linha em `jobs.ts`
`kind: 'promocoes.atendimento_enviar'`, payload `{ pedidoId }`, dedupe `promo-atend:<pedidoId>`, maxAttempts 5, `runAfter` = +90 s (fallback do inline, B2). Handler: `const ultima = (job.attempts ?? 0) + 1 >= (job.max_attempts ?? 5)`; `concluirOuLancar(await enviarPedidoAtendimento(pedidoId, { ultimaTentativa: ultima }))` (confirmado conclui; `numero_sem_whatsapp` descarta; resto lança → motor reagenda com o MESMO operation_id; na última, o pedido já ficou `rejeitado`/`ESGOTADO` dentro de `enviarPedidoAtendimento`, 1.9c). Erro de reavaliação (1.9b) também lança (reagenda) — na última tentativa vira `ESGOTADO` igual. Registro: `deps.registerHandler('promocoes.atendimento_enviar', handleAtendimentoEnviar)` em `registrarHandlersPromocao`.

### 4.4 Chaves
`promocao_envios.chave = 'atendimento:<pedidoId>'` (única por pedido; nunca `:n`). `promocao_envios.texto` guarda a cópia via `mascararTextoEnvio` (sem mudança: não há token/pix nesses textos).

---

## 5. TEXTOS FINAIS — `src/lib/promocoes/atendimento-textos.ts` (frente B; T testa)

`{nome}` = primeiro nome (`primeiroNome(nome)` = 1ª palavra, capitalizada como veio). `{nome_indicador}` = nome completo do indicador. Nome da promoção: `NuAzul – Você Sempre no Azul | Valparaíso de Goiás`.

### 5.1 Servidor — `textoAtendimentoServidor({ nome, codigo })`
```
Olá, {nome}! Aqui é a NuAzul. Você pediu atendimento na promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás (código {codigo}). Responda esta mensagem que um atendente continua com você. Se não foi você, é só ignorar.
```

### 5.2 Indicado (enviada pela empresa) — `textoAtendimentoIndicado({ nome, nomeIndicador, numeroIndicacao })`
```
Olá, {nome}! {nome_indicador} indicou você na promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás (número de indicação {numero}) para falar sobre consignado e concorrer a um iPhone 17. Responda esta mensagem que um atendente continua com você. Se não quiser receber mais mensagens, responda SAIR.
```

### 5.3 Consentimento (janela do botão A) — constantes
```ts
export const CONSENTIMENTO_INDICADO_VERSAO = '2026-10-03'
export const CONSENTIMENTO_INDICADO_TEXTO = 'Você tem autorização do indicado para receber mensagem do nosso número? Se NÃO tiver, use o botão "Enviar pelo meu WhatsApp".'
export const CONSENTIMENTO_INDICADO_BOTAO_SIM = 'Tenho autorização — enviar'
export const CONSENTIMENTO_INDICADO_BOTAO_NAO = 'Não tenho — enviar pelo meu WhatsApp'
```
Gravado no pedido: `consentimento_texto = CONSENTIMENTO_INDICADO_TEXTO + ' [' + CONSENTIMENTO_INDICADO_BOTAO_SIM + ']'`, `consentimento_versao = CONSENTIMENTO_INDICADO_VERSAO`. O site exibe EXATAMENTE estes textos (copiados literalmente em G; T confere igualdade por teste de string).

### 5.4 Botão B do indicador — `textoIndicadorParaIndicado({ nomeIndicado, nomeIndicador, numeroIndicacao, codigoInscricao, contatoDigitos })` e `urlWhatsappIndicado(telefoneIndicadoDigitos, texto)`
Link interno = `urlWhatsapp(contatoDigitos, textoAberturaAtendimento({ codigo: codigoInscricao, numeroIndicacao }))` (M7 já existente → `https://wa.me/556131991754?text=...`).
```
Oi, {nome_indicado}! Aqui é {nome_indicador}. Indiquei você na promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás: crédito consignado para servidores da Prefeitura de Valparaíso de Goiás e concorre a um iPhone 17.

Seu número de indicação é {numero}. Para falar com a NuAzul, toque no link abaixo — a mensagem já vai pronta com o seu número:
{link}
```
`whatsappIndicadoUrl = https://wa.me/<telefone do indicado com 55>?text=<encodeURIComponent(texto)>` (o `{link}` interno fica duplamente codificado — correto: ao abrir, o WhatsApp mostra o link clicável). Só texto, sem imagem.

### 5.5 Mensagens de tela (site e API)
- **M-OK** (200 de solicitar): servidor → `Já enviamos uma mensagem para o seu WhatsApp. Responda por lá que um atendente continua com você.`; indicado → `Já enviamos mensagem ao seu indicado. Avise que ele pode responder por lá.`
- **M-J** (`ja_enviado`): servidor → `Já enviamos uma mensagem para o seu WhatsApp.`; indicado → `Já enviamos mensagem ao seu indicado.`
- **M-F** (`falhou`/`rejeitado`): servidor → `Não conseguimos entregar a mensagem neste número. Use o botão "Falar no WhatsApp".`; indicado → `Não conseguimos entregar a mensagem ao seu indicado. Use o botão "Enviar pelo meu WhatsApp".`
- **M-H** (`fora_horario` / `409 FORA_HORARIO`): `A NuAzul chama das 7h às 21h. Use o botão do WhatsApp ou volte mais tarde.`
- **Ênfase do B** (após "Não tenho"): `Sem a autorização do indicado, envie pelo seu WhatsApp.`
- Rótulos: servidor botão 2 `Prefiro que a NuAzul me chame`; indicador A `Pedir que a NuAzul chame meu indicado`; indicador B `Enviar pelo meu WhatsApp`.

---

## 6. CONFIG UI (frente C)

Arquivos: `src/app/(dashboard)/promocoes/[slug]/config/AtendimentoCard.tsx` (novo, client) + 2 linhas em `config/page.tsx` (import + `<AtendimentoCard slug={slug} podeEditar={data.podeEditar} />` abaixo do `InstanciaCard`) + `src/lib/promocoes/atendimento-config-actions.ts` (novo, `'use server'`, permissão `comercial-promocoes-config`: `can_view` para ler, `can_edit` para salvar). **Não mexer** em `actions.ts`/`CAMPOS_CONFIG` nem em `InstanciaCard.tsx`.

Actions:
```ts
export async function getConfigAtendimento(slug): Promise<R<{ config: {...8 colunas}; parceiros: Array<{ id, arw_code, nome }>; instancias: InstanciaOpcao[]; principal: InstanciaOpcao|null; reserva: InstanciaOpcao|null }>>
  // parceiros = agentes_parceiros que têm chat_contas (select a.id, a.arw_code, coalesce(a.fantasy_name, a.name) from agentes_parceiros a join chat_contas c on c.agente_parceiro_id=a.id order by a.arw_code)
  // instancias = do parceiro_atendimento_id atual (vazio se null)
export async function listarInstanciasDoParceiro(slug, parceiroId): Promise<R<{ instancias: InstanciaOpcao[] }>>
  // select i.id, i.nome, i.papel, i.status, i.numero, i.chatwoot_inbox_id from agentes_parceiros a join chat_contas c on c.agente_parceiro_id=a.id join chat_instancias i on i.conta_id=c.id and i.deleted_at is null where a.id=? order by i.papel, i.ordem
  // TODAS (não só conectadas): a tela mostra badge de status; o runtime exige 'conectada'
export async function salvarConfigAtendimento(slug, patch: { parceiro_atendimento_id, instancia_atendimento_id, instancia_atendimento_reserva_id, atendimento_liberado_em, atendimento_pausado, limite_atendimento_indicador_hora, limite_atendimento_instancia_hora, limite_atendimento_instancia_dia }): Promise<R>
export async function statusInstanciasAtendimento(slug): Promise<R<{ principal: InstanciaOpcao|null; reserva: InstanciaOpcao|null }>>   // polling leve da tela (10 s)
type InstanciaOpcao = { id: string; nome: string; papel: 'receptiva'|'disparo'; status: string; numero: string|null; chatwoot_inbox_id: number|null }
```
Validações de `salvarConfigAtendimento` (servidor, antes do update): parceiro existe e tem `chat_contas`; cada instância informada pertence ao parceiro (query acima) e `deleted_at is null`; `instancia_atendimento_id !== instancia_atendimento_reserva_id`; nenhuma igual a `camp.instancia_id` (mensagem: "A instância da promoção (OTP/comprovantes) não pode ser usada para atendimento."); limites inteiros: indicador 1–500, instância/hora 1–500, instância/dia 1–5000; `atendimento_liberado_em` ISO ou null (sem `fimDoMinuto`). Trocar o parceiro zera as duas instâncias se não pertencerem ao novo. Evento `campanha.atendimento_config_alterada` com `{campos, mudancas}` (sem máscara: não há PII). `revalidatePath('/promocoes/<slug>/config')`.

Tela (card "Atendimento — a NuAzul chama o lead"): select Parceiro (`GO337 — nome`) → select Instância de atendimento e select Reserva (opções `nome · papel · status · número`; status ≠ conectada em cinza, selecionável) → `datetime-local` "Liberada para uso a partir de" (vazio = não liberada; aviso amarelo "Botão da empresa desligado até liberar") → checkbox "Pausar envios da empresa" → 3 inputs numéricos. Abaixo, 2 linhas de status só leitura (principal/reserva: status + número, polling 10 s). **Sem botões Conectar/Desconectar/QR** — instância de parceiro é operada no CRM do parceiro; texto fixo: "Conexão e pareamento desta instância são feitos no CRM do parceiro." Botão "Salvar atendimento" independente do form principal.

---

## 7. SITE (frente G — repo `NuAzul-Site-Ajuste`, branch `promocao/atendimento` a partir de `main`)

Arquivos: `src/pages/valparaiso-go/promocao/index.astro` (telas finais + script), `src/lib/promo.ts` (tipos das respostas), `src/styles/promo.css` (modal + ênfase). Chamadas sempre por `api()` (`/api/promo/atendimento/...`).

### 7.1 Servidor (`#ok-servidor`)
Após `inscricoes` OK: guardar `r.atendimentoToken` em variável JS (nunca em URL, `localStorage` ou `href`). Ordem dos botões: (1) `Falar no WhatsApp` (existente, wa.me) · (2) `Prefiro que a NuAzul me chame` (`data-chamar`, oculto até o estado chegar) · `<p data-chamar-msg>`.
`POST atendimento/estado {campanha, tipo:'servidor', t, site:''}` → `disponivel`: mostra (2); `ja_enviado`: mostra (2) desabilitado + `mensagem`; `fora_horario`: mostra (2) DESABILITADO + `mensagem` (M-H); `falhou`: mostra só a `mensagem`; `indisponivel`/erro de rede/404: não mostra nada (cadastro nunca trava). Clique em (2): desabilita, "Enviando...", `POST atendimento/solicitar {campanha, tipo:'servidor', t, site:''}` → 200: fica desabilitado com `mensagem` (M-OK); `409 JA_ENVIADO`: desabilitado + `message`; `409 FORA_HORARIO`: desabilitado + `message`; `429 LIMITE_*`: mostra `message`, reabilita; `ATENDIMENTO_INDISPONIVEL`/`TELEFONE_NAO_VERIFICADO`: `message`, fica desabilitado; demais erros: `message`, reabilita. Botão (2) nunca dispara duas vezes com sucesso (servidor garante).

### 7.2 Indicador (`#ok-indicador`) — ordem na tela
Após `indicacoes` OK: guardar `r.atendimentoToken` (`atendToken`, variável JS, nunca em URL) separado do `compToken` (que só serve ao comprovante).
1. **A** `Pedir que a NuAzul chame meu indicado` (`data-chamar-ind`) — abre `<dialog data-consent>` com o texto 5.3 e os 2 botões 5.3 (textos literais, copiados do servidor — ver 1.12). `[Tenho autorização — enviar]` → `POST atendimento/solicitar {campanha, tipo:'indicado', t: atendToken, autorizacao: true, site:''}` com os mesmos estados de 7.1 (M-OK/M-J/M-F/M-H do indicado). `[Não tenho — enviar pelo meu WhatsApp]` → fecha; `A.disabled = true` e `A.title = 'Sem a autorização do indicado, use o botão abaixo'` (só nesta sessão da página, variável JS); B ganha classe `btn--enfase` + `<p data-chamar-ind-msg>` = "Sem a autorização do indicado, envie pelo seu WhatsApp."; `POST atendimento/evento {campanha, t: atendToken, tipo:'indicador_sem_autorizacao', site:''}` com `keepalive: true`, sem await, erro ignorado.
2. **B** `Enviar pelo meu WhatsApp` — `<a data-wa-ind target="_blank" rel="noopener">` com `href = r.whatsappIndicadoUrl` (se `null`, esconder B). Click: `POST atendimento/evento {... tipo:'indicador_abriu_whatsapp_proprio'}` (keepalive, sem await) e deixa o navegador seguir o link. Sempre habilitado; usar A não desabilita B e vice-versa.
3. `Enviar comprovante para o meu WhatsApp` (existente) e `Ver comprovante`.
Estado inicial: `POST atendimento/estado {campanha, tipo:'indicado', t: atendToken, site:''}` → mesmas regras de 7.1 para A (`indisponivel` → A não aparece; `fora_horario` → A desabilitado + M-H; B e comprovante continuam).

### 7.3 Tipos (`promo.ts`)
```ts
export type EstadoAtendimento = { botao: 'disponivel'|'ja_enviado'|'indisponivel'|'fora_horario'|'falhou'; status: string|null; mensagem: string }
export type RespostaSolicitar = { status: 'enviado'|'pendente'|'incerto'; mensagem: string }
// inscricoes: + atendimentoToken: string ; indicacoes: + atendimentoToken: string, + whatsappIndicadoUrl: string|null
```
Mock enquanto B não publica: responder `estado` com `{botao:'disponivel', status:null, mensagem:''}` e `solicitar` com `{status:'enviado', mensagem:'Já enviamos uma mensagem para o seu WhatsApp. Responda por lá que um atendente continua com você.'}` atrás de `import.meta.env.DEV`.

---

## 8. DIVISÃO POR FRENTE (sem sobreposição)

| Frente | Dono de (criar/editar) | Depende de |
|---|---|---|
| **B** API + envio | `src/lib/promocoes/{atendimento,atendimento-regras,atendimento-textos,jobs-atendimento}.ts` (novos); `src/lib/promocoes/whatsapp.ts` (função irmã + tipos); `src/lib/promocoes/jobs.ts` (1 linha de registro); `src/lib/promocoes/http.ts` (tipo `Campanha` + 8 campos); `src/app/api/promocoes/publico/atendimento/{estado,solicitar,evento}/route.ts` (novos); `src/app/api/promocoes/publico/inscricoes/route.ts` (+`atendimentoToken`); `src/app/api/promocoes/publico/indicacoes/route.ts` (+`whatsappIndicadoUrl`) | migration (colunas); mock: nenhum — escrever contra os nomes do §2 |
| **C** Config UI | `src/app/(dashboard)/promocoes/[slug]/config/AtendimentoCard.tsx` (novo); `config/page.tsx` (2 linhas); `src/lib/promocoes/atendimento-config-actions.ts` (novo) | migration; nada de B |
| **G** Site | repo `NuAzul-Site-Ajuste`: `src/pages/valparaiso-go/promocao/index.astro`, `src/lib/promo.ts`, `src/styles/promo.css` | §3/§5/§7; mock §7.3 até B subir |
| **T** Testes | `src/lib/promocoes/__tests__/atendimento.test.ts` (novo; `node:test`, imports relativos com `.ts`) — testa `atendimento-regras.ts` e `atendimento-textos.ts` pelas assinaturas do §4.2/§5 | B (pode escrever antes; roda quando B entregar os 2 arquivos puros — B entrega esses 2 PRIMEIRO) |

Ordem: migration (pronta) → B entrega `atendimento-regras.ts` + `atendimento-textos.ts` na 1ª hora ∥ C ∥ G ∥ T → B resto → merge na `promocao/atendimento` → revisão Fable → Bruno `db push` → deploy Workspace ANTES do site → config pelo Bruno (parceiro GO337, instância, liberação) → teste real: 1 servidor (número do Bruno) + 1 indicação.

Testes mínimos de T: `gatesGlobais` (7 saídas, incl. `fora_horario` com datas 06:59/07:00/20:59/21:00 em SP); `dentroDoHorario`; `instanciaAindaPermitida`; `escolherCandidata` (principal cheia → reserva; reserva = OTP → ignorada; nenhuma conectada vs todas cheias; agenteParceiroId diferente → ignorada); `mapearResultadoParaStatus`; `botaoDoEstado`; textos 5.1/5.2 com variáveis; `urlWhatsappIndicado` começa com `https://wa.me/55` e o `{link}` interno decodifica para `https://wa.me/<contato>?text=`; constantes 5.3 iguais aos literais do site (string fixa no teste).

Fora de escopo (anotado): automação do "SAIR" (opt-out), tela interna de pedidos de atendimento (lista/KPI), telefone bloqueado por tabela própria, conversa sem lead no CRM.
