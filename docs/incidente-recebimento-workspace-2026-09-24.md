# Incidente: recebimento de mensagens no Workspace — 24/09/2026

Relatório da investigação feita pelo Fable em 24/09/2026 (19h–21h BRT), a
partir do banco (Supabase do Workspace), dos logs do engine (Railway), da
Vercel e da tela autenticada de produção. Substitui o relatório anterior do
Gemini (mesmo arquivo), que fica resumido na §7 como "o que foi afirmado ×
o que foi verificado". Horários em UTC com o BRT (UTC−3) entre parênteses.

## 0. Resumo

- **Produção rodava (e roda até o deploy desta entrega) o commit `5d6525be`**
  (deploy `dpl_GBE1jyQZfnPgvbKQ26FTWxrM21tw`). Nada do que o Gemini alterou
  chegou a ser publicado: estava tudo sem commit na pasta principal.
- **Suporte ficou surda das 17:27:40 às 19:34:43 UTC (14:27→16:34 BRT)**: o
  socket reconectou após um "Stream Errored (ack)" e, a partir daí, o engine
  não decifrou mais NADA dessa instância (nem entradas, nem o eco do que o
  aparelho enviava). O teste das 16h28 BRT caiu dentro dessa janela. O
  repareamento por QR que o Bruno fez às 16h32–16h37 BRT resolveu: a partir
  das 19:39 UTC as entradas voltaram.
- **Atendimento e Financeiro receberam depois do repareamento** (Atendimento
  19:36:07 UTC, conversa 184; Financeiro 22:21:10 UTC, conversa 100). O que
  o Bruno não viu depois disso foi problema da **tela**, não do engine:
  (a) a aba "Chats" listava as conversas do dono do TOKEN da conta, não do
  usuário logado; (b) o roteamento automático atribui as conversas novas de
  Atendimento/Financeiro ao atendente padrão do departamento, tirando-as da
  Fila na hora; (c) cada aba mostrava só a página 1 do Chatwoot (25 de 60 na
  Fila). Corrigido nesta entrega (§5).
- **Ainda em aberto**: falhas de decriptação do libsignal continuam no engine
  agora ("Bad MAC" em rajadas a cada ~3 min) sem como saber de qual instância
  — o engine não registrava instância nem remetente; branch pronta (§5.3),
  não publicada. Confirmar recebimento do Suporte e do Atendimento exige um
  teste identificável do Bruno (§8).

## 1. Instâncias (fonte: `chat_instancias`, 24/09 22:50 UTC)

| Departamento | id | Número real | Inbox | Nome cadastrado |
|---|---|---|---|---|
| Atendimento | `5576d3fc-…c7de` | **(61) 3199-1641** — 556131991641 | 3 | "(61) 3199-1641 - Atendimento" |
| Suporte | `56a4fc72-…7824` | (61) 99955-1641 — 556199551641 | 4 | "(61) 99955-1641 - Suporte" |
| Financeiro | `0a0a25d7-…5b34` | (61) 99603-6968 — 556196036968 | 9 | "(61) 99603-6968 - Financeiro" |

O relatório do Gemini dizia que a Atendimento era "(61) 99955-6019"; esse
número não existe em nenhuma instância. Conta BRS `29684381-…1581a`,
`chatwoot_account_id = 1`. Todas `conectada`, `ultimo_erro` nulo.

## 2. Linha do tempo por instância

Fontes: `chat_mensagens_mapa` (IN = `from_me=false`, OUT = eco do aparelho),
`chat_eventos`, `chat_instancia_eventos`, logs do engine (deploy
`b54d848c`, commit `4eb69c3` de 23/09 16:42 UTC — sem deploy novo desde então).

### 2.1 Suporte (inbox 4) — causa confirmada: sessão Signal parou de decifrar

| UTC (BRT) | Fato | Fonte |
|---|---|---|
| 11:00–17:27 | Entradas normais o dia todo: 40, 73, 45, 73, 38, 57, 37 por hora (11h–17h UTC). Última entrada **17:27:05** (conv 176). | mapa |
| 17:27:34 (14:27) | `conexão fechada` — `Stream Errored (ack)` (código 500, ack de mensagem de mídia `3EB0ABD8…`); reconecta às **17:27:40**. | engine |
| 17:27:40 → 19:32 | **Zero mensagens** (nem IN nem OUT) na instância — numa linha que nas horas anteriores registrava 40–70 entradas/hora e dezenas de ecos do aparelho. Outras reconexões: 18:10:11 (`Connection Terminated` 428), 19:00:23. | mapa + engine |
| 19:27:23–19:31:13 | Janela dos logs: **só** libsignal — 61× `Failed to decrypt message with any known session…` + `SessionError: Over 2000 messages into the future!`. Nenhuma outra linha. | engine |
| 19:28 (16:28) | Teste do Bruno no Suporte: **não gerou nada** em Chatwoot, mapa nem eventos. Compatível com o item acima (o engine recebia o ciphertext e não decifrava). | mapa |
| 19:32:38 (16:32) | `Intentional Logout` (401) — Bruno desconectou pelo sistema (`desconexao_sistema` em `chat_instancia_eventos`). | engine + eventos |
| 19:34:43 (16:34) | Reconectada com QR novo. | eventos |
| 19:36:40 | Primeiro eco do aparelho depois do repareamento (conv 113). | mapa |
| **19:39:34 (16:39)** | Primeira **entrada** depois do repareamento: conv 83, grupo "BIB - Filial Goiânia" (`120363…@g.us`), texto "sanar pendências". **Não é o teste das 16h28** — é tráfego do grupo. Depois: 19:41:48 (conv 110), 19:47 (82), 19:48 (113)… 34 entradas na hora seguinte. | mapa + evento 4208 |
| 21:22:11 | Última entrada registrada no Suporte até o fechamento deste relatório (fim do expediente; não prova nem nega o estado atual — ver §8). | mapa |

Reconciliação com o Gemini: a entrada das 16h39 na conversa 83 existe e é
real, mas é mensagem de grupo pós-repareamento; a afirmação de que o teste
das 16h28 "não gerou evento por falha de socket/LID/JID" estava sem
evidência — a evidência real são as 61 falhas de decriptação do libsignal
naquela janela, e a ausência TOTAL de tráfego (inclusive eco do aparelho)
entre 17:27 e 19:36, que descarta filtro de JID/LID (isso só afetaria
contatos específicos, não o eco do próprio aparelho).

### 2.2 Atendimento (inbox 3) — recebeu; o problema era a tela

| UTC (BRT) | Fato |
|---|---|
| 17:35:20 | `Stream Errored (ack)` → reconecta 17:35:27. |
| 19:32:47 (16:32) | `Intentional Logout` (repareamento pelo Bruno); reconectada **19:33:44**. |
| **19:36:07 (16:36)** | Teste do Bruno: 2 entradas na conv **184** (contato "Alícia"): texto "Testa" (msg 6544) e áudio `audio.ogg` (msg 6545). Eventos `mensagem_recebida` 4203/4204. **Chegou ao engine, ao Chatwoot e ao Supabase.** |

Na tela de produção (código antigo, sessão do Bruno, 23:12 UTC): a conv 184
**não está** na Fila (página 1 cobre 14:23→19:21 BRT, faixa que inclui as
16:36 dela — logo ela não está `open + sem atendente`) e não está na página 1
da Geral (25 mais recentes vão até 16:43 BRT). Explicação pelo código:
`atribuirDepartamentosAutomaticos` (chamado a cada listagem) dá Team +
**atendente padrão do departamento** a toda conversa nova sem Team; o
departamento Atendimento tem `atendente_padrao_chatwoot_id = 6`. A conversa
sai da Fila no primeiro refresh e só aparece em "Chats" do agente 6 — que
ninguém via, porque "Chats" listava o dono do token (§3) — ou na Geral
(supervisores), página 2. Não foi possível ler o `assignee` no Chatwoot
diretamente (token cifrado; ver §6), então "atribuída ao agente 6" é a
dedução consistente com lista + código, não leitura direta.

### 2.3 Financeiro (inbox 9) — recebeu depois do repareamento

| UTC (BRT) | Fato |
|---|---|
| 17:39:09 | `Stream Errored (ack)` → reconecta 17:39:15. |
| 18:55, 19:21, 19:22, 19:28 | Ecos do aparelho (avisos de "solicitação aprovada") — a sessão desta instância decifrava o próprio aparelho, diferente do Suporte. |
| 19:35:14 (16:35) | `Intentional Logout` (repareamento); reconectada 19:36:49. |
| 21:01–21:05 | Mais ecos (disparo de avisos). |
| **22:21:10 e 22:21:19 (19:21)** | **Entradas reais** na conv 100 ("Adriano Coelho"): "Por favor o cartão baru" e "Meu irmão tá para me deixar doido" — mapa + eventos 4324/4325. |

Na tela de produção às 23:12 UTC a conv 100 aparece na **Fila (#25) e na
Geral (#1, "Aberta", "sem atendente")** — recebimento e exibição comprovados
para esta instância, com o código antigo. (A conv 100 já tinha Team, por isso
o roteamento automático não a atribuiu ao atendente padrão 5.)

O Gemini concluiu "entradas estavam na Fila porque as saídas funcionavam";
saída não prova entrada. A prova de entrada é a conv 100 às 22:21 UTC.

## 3. Por que a tela não mostrava (código, verificado)

1. **"Chats" = dono do token.** `getConversas({aba:'meus'})` chamava
   `GET /conversations?assignee_type=me`. O Workspace usa UM token de conta
   (`chat_contas.token_cifrado`, `clienteChatwootBrs()`) para todos os
   usuários; "me" na API do Chatwoot é o usuário dono desse token. A
   resolução usuário→agente por e-mail já existia (`getMeuAgente`,
   presença), mas não era usada na lista nem no contador `mine_count`. Na
   sessão do Bruno em produção o badge era "Chats 1".
2. **Roteamento automático esvazia a Fila.** Departamentos Atendimento (team
   1) e Administrativo e Financeiro (team 4) têm atendente padrão (6 e 5).
   Conversa nova nessas inboxes recebe Team+atendente na primeira listagem e
   deixa de ser "sem atendente". Suporte (team 2) não tem atendente padrão —
   por isso a Fila de produção tinha 60 conversas, quase todas do Suporte.
3. **Só a página 1.** O hook nunca passava `page`; o Chatwoot devolve 25 por
   página. Fila com 60 → 35 invisíveis; Geral idem. A conv 184 está além da
   página 1 da Geral.
4. **Badge da Fila só no poll de 30 s.** O Realtime de `chat_eventos`
   refazia a lista da aba ativa, não os contadores (o Gemini corrigiu isso;
   mantido).
5. **Alteração do Gemini que estava errada:** `status = aba==='meus' ?
   'open' : 'all'` fazia a Fila incluir conversas **resolvidas** sem
   atendente. O engine cria conversa como `open` e reabre resolvida ao
   receber mensagem; `pending` só existe com bot (não há). Voltou a `open`
   para Meus e Fila; `all` só na Geral.

## 4. Engine — falhas de decriptação (libsignal)

- `Over 2000 messages into the future`: presente **desde pelo menos 05:59
  UTC de 24/09** (a busca por janelas encontrou ocorrências em 05:59, 11:59,
  14:59, 16:59, 17:27, 18:14, 18:55, 19:26), em taxas de ~10/min a mais de
  100/min (14:00–14:05 UTC bateu o teto de 500 linhas). Durante esse período
  o Suporte **recebia normalmente** — ou seja, esse erro crônico é de alguma
  sessão/par específico (ou de outra instância) e **não** é o que emudeceu o
  Suporte às 17:27. Parou às 19:35 UTC, após o repareamento das três.
- `Bad MAC`: começa após o repareamento (≤ 20:26 UTC) e **continua neste
  momento** (22:26–22:57: rajadas de 18 e de 8 mensagens a cada ~3 min).
  Duas instâncias fecharam com `Stream Errored (ack)` logo depois de rajadas:
  Suporte (22:27:38) e a de disparo Bem Digital `99ed05f3` (22:30:49). Padrão
  compatível com pares que ainda usam a sessão/chaves de antes do
  repareamento e com o servidor reofertando as mesmas mensagens — hipótese,
  não confirmada.
- **Limite concreto:** esses erros são `console.error` do libsignal, sem
  `instId`, `remoteJid` nem `waId`; o Baileys entrega a mensagem como stub
  `CIPHERTEXT` e `inboundBaileys` descartava em silêncio. Por isso não dá pra
  dizer, pelos logs de hoje, QUAL instância está perdendo mensagens agora.
- Verificado e descartado: nenhuma escrita de `sessao_cifrada` fora do
  engine (Workspace e CRM só zeram ao excluir instância); `salvarChipInstancia`
  não toca na sessão. Sem deploy do engine desde 23/09 16:42 UTC. Sem
  reconexão do Suporte entre 18:10 e 19:00 UTC — o emudecimento começou na
  reconexão de 17:27:40 sem nenhum outro evento associado.
- Recursos: acesso Railway (MCP) funcionou nesta sessão — logs lidos
  diretamente; o `Not Authorized` da sessão anterior não se repetiu.

## 5. Correções

### 5.1 Workspace — branch `chat/recebimento-e-performance` (worktree `brs-workspace-chat-recebimento`)

Mantido do Gemini (conferido): rotas HTTP `/api/conversas/{bootstrap,lista,
contadores,contatos,[id]/mensagens,[id]/meta,contatos/[id]/meta}` e
`/api/chat/read`; regras de acesso em `permissions.ts`/`middleware.ts`;
`getMetaReadOnly`/`getContatoMetaReadOnly` (GET sem INSERT); merge de
mensagens no poll silencioso (`mergeChatwootMessages`); guarda de seleção em
`carregarThread`/`carregarMeta`/`carregarDadosContato`; `pollingVisivel`
aguardando a Promise; paginação por cursor + "Carregar mensagens anteriores"
+ leitura explícita (`POST /api/chat/read`) no chat interno.

Alterado nesta entrega:

| Arquivo | O quê |
|---|---|
| `src/lib/central-conversas/chatwoot.ts` | `payloadFiltroConversas()` (puro) + `filtrarConversas()` — `POST /conversations/filter` por `assignee_id`. |
| `src/lib/central-conversas/actions.ts` | `meuAgenteId()` (e-mail → agente, cache 5 min); `getConversas`: Meus = filtro por agente (com `q`, lista `all` e filtra o agente), Fila = `open`+`unassigned`, Geral = `all`; `getContadores`: `mine` = contagem do filtro por agente (`meta.all_count`), não mais `mine_count` do token. |
| `src/components/conversas/atendimento/useAtendimento.ts` | Realtime chama `carregarContadores` pela ref (evitava versão obsoleta); paginação: `paginasRef` + `carregarMaisConversas` + `temMaisConversas` (refaz páginas 1..N no poll/Realtime; volta a 1 ao trocar aba/busca/filtro). |
| `src/app/api/conversas/lista/route.ts` | aceita `page`. |
| `ListaConversas.tsx`, `AtendimentoCompleto.tsx`, `AtendimentoCompacto.tsx` | botão "Carregar mais conversas" (só na lista, não no painel). |
| `src/lib/supabase/server.ts`, `src/lib/interno-chat/data.ts` | imports voltaram ao alias `@/` (a troca por `.ts` relativo não era necessária — nenhum teste importa `data.ts`). |
| `src/lib/central-conversas/__tests__/filtro-conversas.test.ts` | novo: corpo do filtro (AND entre itens, último sem operador; `all` não vira filtro). |

### 5.2 O que NÃO foi feito e por quê

- Não mexi no roteamento automático por atendente padrão (regra de produto
  da Fase B); com "Chats" corrigido, a conversa atribuída ao agente 6 aparece
  para o usuário desse agente.
- Não removi controles de acesso; os handlers continuam com
  `requirePermission('conversas')`.
- Não reprocessei mensagens nem reiniciei instâncias.

### 5.3 Engine — branch `engine/log-mensagem-nao-decifrada` (worktree `brs-alvoconsig-engine-decrypt-log`, commit `bc1ccb9`), **não mergeada, não publicada**

`bridge.ts`/`inboundBaileys`: stub `CIPHERTEXT` (mensagem que o libsignal não
decifrou) passa a gerar `warn` com `instId`, `waId`, `remoteJid`, `participant`
e o motivo (`messageStubParameters[0]`). Sem mudança de comportamento.
`tsc` do engine passa. Publicar = deploy no Railway = reinício das 11
instâncias (reconectam sozinhas; ~10 s cada) — decisão do Bruno, porque hoje
ele pediu para não reiniciar instâncias como tentativa genérica.

## 6. Identidade do token do Chatwoot

Não foi possível decifrar o token nesta sessão (a leitura da chave do cofre
foi bloqueada pela política de credenciais do ambiente) nem chamar `/profile`
com ele. O que está estabelecido: é UM token de conta para todos os usuários
(`chat_contas`, owner `brs`); a memória do projeto registra super admin
`tecnologia@brspromotora.com.br` e `bruno.rodrigues@…` como admin da conta 1.
Qual dos dois é o dono do token deixa de importar para "Chats"/`mine` depois
desta entrega: os dois passam a usar o agente resolvido pelo e-mail do
usuário logado (mesma regra de presença e de "Assumir para mim"). Onde o
token ainda define identidade: envio de mensagens (`sender` no Chatwoot é o
dono do token) — comportamento anterior, fora do escopo.

## 7. O que o Gemini afirmou × o que foi verificado

| Afirmação | Verificação |
|---|---|
| Atendimento é "(61) 99955-6019" | Não existe; é (61) 3199-1641 (inbox 3). |
| 184 não aparecia porque abre em "Meus" e estava sem atendente | Parcial: "Meus" era o dono do token (para todo mundo); e 184 não está na Fila — foi atribuída pelo roteamento automático; além disso só 25 por aba. |
| Suporte 16h28: falha de socket/LID/JID na reconexão | Sem evidência de LID/JID. Evidência real: sessão Signal sem decifrar nada desde a reconexão de 17:27:40 (61 falhas do libsignal na janela do teste; zero tráfego inclusive eco do aparelho). |
| Suporte: "não existe entrada entre 19:00 e 20:00 UTC" | Falso: entradas às 19:39:34, 19:41:48, 19:47:24, 19:48:45… (pós-repareamento). |
| Financeiro: "entradas na Fila porque as saídas funcionavam" | Saída não prova entrada; a prova é a entrada real às 22:21 UTC (conv 100), visível na Fila/Geral. |
| `status='all'` na Fila garante `pending` | Traria resolvidas para a Fila; `pending` não ocorre. Revertido. |
| "130 testes, 0 falhas" | Verdadeiro, mas nenhum teste exercita o fluxo real; a suíte não pegaria nenhum dos itens acima. |
| Build/tsc OK | Confirmado localmente (baseline). |

## 8. Validação e pendências

Ver §9 (preenchida após o deploy). Pendências reais:

1. **Teste identificável nas três instâncias** (mensagem com marcador único,
   ex. `TESTE-<instância>-<hhmm>`), enviado pelo Bruno: só isso comprova o
   estado ATUAL do Suporte e do Atendimento (o Financeiro já tem prova real
   às 19:21 BRT). O Fable não envia mensagens por conta própria.
2. **"Bad MAC" em curso no engine** sem atribuição: publicar a branch de log
   (§5.3) é o passo que torna o próximo incidente diagnosticável; até lá,
   sintoma visível seria uma instância "conectada" sem nenhuma entrada por
   horas em horário comercial (como o Suporte hoje).
3. Causa raiz do emudecimento do Suporte às 17:27:40 (por que a reconexão
   após `Stream Errored (ack)` voltou com sessão que não decifrava) — sem
   evidência suficiente; nenhum escritor concorrente de `sessao_cifrada` foi
   encontrado.
4. Metas de performance (p95 2 s navegação / 1,5 s abertura) **não medidas**;
   a Vercel registrou 15 × 504 nas últimas 4 h, todos em
   `/api/cron/agenda-sync` — nenhum no chat.
5. Envio continua com a identidade do dono do token (fora do escopo).
