# Lote 02B — retorno da sessão Workspace (contrato de envio com operationId) · 07/09/2026

Referência: `LOTE-02-WORKSPACE-CONTRATO-ENVIO-2026-09-07.md` (Astra).
Worktree/branch: `brs-workspace-lote02b` · `lote02b/operation-id-envio`
(criada de `main` em `77c51ce`). **Sem push, sem deploy, sem migration, sem
flag** — commit local só.

## Onde o Workspace envia direto ao engine (HEAD conferido)

Um único chamador de `engine.enviar`: `iniciarConversaPorTelefone`
(`src/lib/central-conversas/actions.ts`), acionado pela modal "Nova conversa"
(`ListaConversas.tsx` → `useAtendimento.novaConversa`). Todo o resto do
Messenger responde pelo Chatwoot (webhook → engine), que não precisa de
operationId — não foi tocado.

## O que mudou

| Arquivo | Mudança |
|---|---|
| `src/lib/central-conversas/envio-intencao.ts` (novo, puro, isomórfico) | `novoOperationId()` (uuid v4), `ehOperationId()`, `normalizarTelefoneDestino()`, `resolverIntencao(atual, campos)` — mesma intenção (mesmos campos) conserva a chave; campo alterado ou nova intenção → chave nova; nunca derivada do conteúdo. |
| `src/lib/central-conversas/engine.ts` | `enviar(instId, destino, texto, { operationId, mentions?, quoted? })` — `operationId` obrigatório e validado (uuid) ANTES de chamar; corpo `{ destino, texto, operationId }`. Novas classes `EngineErro` (`{erro|error, codigo|code}` → `codigo`, `status`) e `EngineEnvioIncertoError` (timeout/abort ou 409 `DELIVERY_UNCERTAIN` → `motivo`, `operationId`). O helper NÃO gera chave e NÃO faz retry. Bearer/URL/timeout como antes. |
| `src/lib/central-conversas/actions.ts` | `iniciarConversaPorTelefone({ instanciaId, telefone, texto, operationId })`: exige chave válida (não gera), mantém `requirePermission('conversas')`, posse da instância pela conta BRS (`chat_instancias.conta_id = contaBrs().id`, `deleted_at is null`) e assinatura `*Nome:*`. Devolve `ResultadoNovaConversa` = `{ resultado:'confirmado', conversationId }` ou `{ resultado:'incerto', conversationId:null, mensagem }` — incerto vira VALOR (não exceção) porque Server Action mascara `Error.message` em produção. |
| `src/components/conversas/atendimento/useAtendimento.ts` | `novaConversa` repassa `operationId`; só seleciona a conversa quando `confirmado`; não reenvia. |
| `src/components/conversas/atendimento/ListaConversas.tsx` | Modal "Nova conversa": estado `intencao` (chave nasce no 1º envio via `resolverIntencao`); erro ou resultado incerto → intenção mantida ("Tentar de novo (mesma operação)"); sucesso → intenção zerada; campo alterado → chave nova. Aviso âmbar no incerto: "Envio não confirmado… confira a lista/WhatsApp antes de tentar de novo… só evita duplicidade quando o modo durável desta conta estiver ligado". Recarregar a página perde a intenção — a UI não promete o contrário (sem persistência disponível). |
| `src/lib/central-conversas/__tests__/envio-operation-id.test.ts` (novo) | Testes com engine simulado (`fetch` stub). |
| `package.json` · `tsconfig.json` | script `test` (`node --test --experimental-strip-types`), `allowImportingTsExtensions` (noEmit já era true). |

Não alterado: engine, grupos, origem/aparelho, permissões, departamentos,
outras fases do Messenger, respostas normais via Chatwoot.

## Testes (`npm test`) — 11/11 verdes, sem mensagem real

engine.enviar (fetch simulado):
1. corpo transmitido `{ destino, texto, operationId }` + `Authorization: Bearer` + URL `/instancias/:id/enviar`;
2. retry da mesma intenção conserva a chave (2 chamadas, mesma chave);
3. dois envios deliberados iguais → chaves distintas;
4. chave ausente/inválida → recusa ANTES de chamar (0 chamadas);
5. 409 `DELIVERY_UNCERTAIN` → `EngineEnvioIncertoError('uncertain')`, 1 chamada, sem retry;
6. timeout/abort → `EngineEnvioIncertoError('timeout')`, 1 chamada, sem retry;
7. `{ erro, codigo }` (ex. `INSTANCIA_DESCONECTADA` 409) → `EngineErro` com código, NÃO incerto;
8. `mentions`/`quoted` só entram quando informados.

envio-intencao: mesma intenção = mesma chave / mudou campo = nova / sem
intenção = nova; uuid válido e único; normalização E.164 (10/11 dígitos → 55).

Autorização da instância e assinatura: preservadas na action (código
inalterado nesse trecho; conferido por leitura + tsc). Não há teste unitário
da action porque ela depende de Supabase/auth reais — não simulados neste lote.

Gates: `npx tsc --noEmit` limpo · `npm run build` verde.

## Rodada 2 — correções da revisão Astra (`REVISAO-LOTE-02B-2026-09-07.md`)

### P1-1 · falha de transporte/5xx/resposta inválida agora é incerto
`engine.enviar` (`engine.ts`, `enviarPorInstancia`) faz exatamente UM POST e
classifica pelo momento da falha:
- **antes de qualquer rede** (chave inválida, token ausente) → `Error` comum;
- **POST tentado** e: queda de conexão (`fetch failed`/ECONNRESET) →
  `incerto(transporte)`; abort → `incerto(timeout)`; falha ao ler o corpo →
  `incerto(resposta)`; HTTP 5xx sem código de domínio (500 no meio do envio,
  502/503/504 do gateway) → `incerto(gateway)`; 409 `DELIVERY_UNCERTAIN` →
  `incerto(uncertain)`; 2xx sem `ok:true` + `id|messageId` (objeto vazio, JSON
  quebrado, `ok:false`) → `incerto(resposta)`;
- **rejeição comprovada** (nada saiu): `{ erro|error, codigo|code }` de
  domínio (ex.: `INSTANCIA_DESCONECTADA`), 4xx do contrato (`HTTP_400` mensagem
  vazia, `HTTP_404` instância), e os erros que o engine lança ANTES do envio em
  `send-operation.ts` (`OPERATION_CONTENT_CONFLICT`, `SEND_PERSISTENCE_FAILED`,
  que o Fastify serializa como 500 com `message`) → `EngineErro`.
  `SEND_RESULT_PERSISTENCE_FAILED` (depois do envio) fica incerto.
- A action devolve `ResultadoEnvio` = `confirmado | rejeitado | incerto` como
  VALOR (Server Action mascara `Error.message`); só a permissão lança.
- Na modal, qualquer exceção vinda do `onEnviar` (perda de resposta navegador ↔
  Server Action, erro mascarado) é tratada como **incerto**, conservando a
  intenção.

### P1-2 · repetir a operação × novo envio, com campos congelados
Máquina de estados em `envio-intencao.ts` (`reduzirEnvio`, `estadoInicialEnvio`)
— é a mesma que a modal usa via `useReducer`:
- `editando → enviar → enviando`: normaliza campos, chave gerada UMA vez (a UI
  gera o uuid e passa dentro da ação, para o reducer puro calcular o payload e
  o estado sem divergir);
- `enviando` e `incerto`: campos **congelados** (`editar` é ignorado; inputs
  `disabled`); "Cancelar" desabilitado enquanto envia;
- `incerto → repetir`: MESMA chave e MESMO payload (vindo da intenção
  congelada, não dos inputs); rótulo "Repetir esta operação (mesma chave)";
- `incerto → novoEnvio`: intenção zerada, campos liberados, a anterior fica em
  `incertoAnterior` e a UI mostra "O envio anterior … PODE ter sido entregue.
  Este será um novo envio, com outra operação"; rótulo "Novo envio (outra
  chave)". Nunca o rótulo de retry para uma chamada com outra chave;
- `rejeitado`: volta a editar; repetir igual conserva a chave, mudar campo troca;
- `confirmado → concluido` (o pai fecha a modal).

### Testes (`npm test`) — 21/21
Novos, engine simulado, sempre 1 chamada e chave preservada: queda de conexão
(TypeError), 502/503/504, 500 genérico pós-envio, corpo interrompido
(`res.text()` rejeita), 2xx sem confirmação válida (5 corpos), rejeições que
NÃO viram incerto (400, 404, `INSTANCIA_DESCONECTADA`, `OPERATION_CONTENT_CONFLICT`).
Máquina de estados da modal: editar ignorado em `enviando`/`incerto`; repetir
com mesma chave e payload (inclusive `enviar` cru a partir de `incerto` não
gera chave); novo envio explícito com chave nova e anterior registrado;
rejeitado conserva/troca chave conforme campos; confirmado → concluido.
Gates: `tsc` limpo, `build` verde. Nenhuma mensagem real.

## Rodada 3 — classificador de erros (revisão Astra, seção "Rodada 2")

Problema: `if (codigo)` convertia QUALQUER `code`/`codigo` em rejeição, mesmo
em 500 pós-envio. Correção em `engine.ts` (`classificarFalha`):

- **Lista explícita** `REJEICOES_PRE_ENVIO`, validada contra o contrato do
  `/enviar` no engine (server.ts, send-operation.ts, baileys.ts, grupos.ts):
  `numero_sem_whatsapp` (422, checado antes de enviar),
  `OPERATION_CONTENT_CONFLICT` e `SEND_PERSISTENCE_FAILED` (claimSend, antes do
  envio — o engine entrega como 500 `{ error: 'enviar pelo WhatsApp: <código>' }`,
  por isso o casamento é por palavra inteira dentro de
  `codigo|code|erro|error|message`), `INSTANCIA_DESCONECTADA`,
  `PROVEDOR_NAO_SUPORTADO`, `GRUPO_NAO_PERMITIDO` (gates de instância).
- **Ordem:** `DELIVERY_UNCERTAIN` → incerto; código da lista → rejeição;
  **qualquer 5xx** (código pós-envio como `SEND_RESULT_PERSISTENCE_FAILED`,
  `FALHA_WHATSAPP`, `INTERNAL_ERROR`, desconhecidos) → incerto; 409 sem código
  → incerto; demais 4xx → rejeição (`codigo` ou `HTTP_<status>`). Um código
  existir não prova rejeição; a ramificação não contorna a classificação.
- Uma única tentativa de POST preservada; `chamar()` (conectar/status/
  desconectar/grupos) não mudou.

Regressões novas (`npm test` — **23/23**): 500 estruturado pós-envio
(`code`/`codigo` `SEND_RESULT_PERSISTENCE_FAILED`, `INTERNAL_ERROR`, `error:
'enviar pelo WhatsApp: SEND_RESULT_PERSISTENCE_FAILED'`, `FALHA_WHATSAPP` em
500/502) → incerto, 1 chamada, chave preservada; rejeições conhecidas nos
formatos reais do engine (422 `numero_sem_whatsapp`, 500 `'enviar pelo
WhatsApp: OPERATION_CONTENT_CONFLICT'`/`SEND_PERSISTENCE_FAILED`, 500 Fastify
`message`, 409 `INSTANCIA_DESCONECTADA`, 501 `PROVEDOR_NAO_SUPORTADO`, 400 com
código desconhecido) → rejeição com o código. tsc limpo, build verde. Modal
inalterada.

## Observações pro Astra

- Enquanto `ENGINE_DURABLE_EVENTS` estiver desligado pra conta BRS, o engine
  aceita e ignora `operationId`: "tentar de novo" PODE duplicar — a UI diz isso
  em texto e não chama de seguro.
- O engine devolve `code` (não `codigo`) no 409 `DELIVERY_UNCERTAIN` e
  `codigo` nos erros de grupo; o helper lê os dois.
- Fora do escopo, só registro: a modal "Nova conversa" rotula instâncias com
  `papel` ("receptiva/disparo"), que é regra do CRM e não deveria aparecer no
  Messenger (spec §0). Fica pra fase própria do Messenger.
