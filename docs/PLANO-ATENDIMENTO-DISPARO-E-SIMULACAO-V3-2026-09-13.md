# Plano v3 — Atendimento, disparo e simulação (Fable, 13/09/2026, noite)

Origem: homologação do Bruno em 13/09 (campanha "Teste 13/09/2026", 6
leads internos, 2 atendentes) + retorno sobre o chat interno v2. Cada item
abaixo foi conferido no banco (`gazwohjfigvcycnukdwj`), nos logs do engine
(Railway `brs-chat`, deploy `a3594788`) e no código — nada aqui é suposição.
Executores sugeridos no fim. **Nenhuma alteração foi feita ainda.**

## 0. Diagnóstico — o que aconteceu de verdade hoje

| Lead (atendente) | Instância | Enviado (UTC) | O que houve |
|---|---|---|---|
| Michael 98297-0623 (Isabelly) | 2537 | 20:46:30 | respondeu 20:46:53 → apareceu em "Meus" da Isabelly ✔ |
| Maria Alícia 92873740 (Bruno) | 7033 | 20:50:30 | respondeu 20:50:58 → apareceu em "Meus" do Bruno ✔ |
| Tonys 86310435 (Bruno) | 4934 | 20:55:30 | **não respondeu** → escondido por regra (ver §4) |
| Isabelly-lead 98639-7086 (Isabelly) | 4435 | 21:00:31 | **4435 desvinculada pelo WhatsApp às 21:00:32** (`401 conflict device_removed`, 1 s depois do envio). Sem ack, resposta do cliente nunca chegou ao engine |
| Winston 83859901 (Bruno) | 5009 | 21:02:30 | **5009 desvinculada às 21:02:32** (mesmo erro, 2 s depois). Cliente não respondeu |
| Bruno 96863171 (Isabelly) | 2043 (conversa orgânica já aberta) | — | apareceu para a Isabelly ✔; o "Aguardando" na 2ª mensagem é o caso já isolado em 10-11/09 (sessão Signal do número comercial) — decisão de 11/09 foi esperar uma semana; ainda não passou |

Fatos que mudam a prioridade:

1. **O WhatsApp está desvinculando os números de disparo 1–3 s depois do
   envio.** Hoje 2 de 6 envios (4435 e 5009). Em 11/09 a MESMA 5009 caiu
   do mesmo jeito 3 s depois do envio (já estava no
   `INCIDENTE-HOMOLOGACAO-DISPARO-2026-09-11.md`, item 3). Os dois números
   de hoje tinham sido pareados HOJE (4435 às 16:39, 5009 às 20:32 — 28 min
   antes de disparar). Os que sobreviveram (2043, 2537, 4934, 7033) tinham
   pareamento mais antigo. `device_removed` é o WhatsApp removendo o
   aparelho vinculado — não é queda de rede nem bug nosso. É o padrão
   clássico de detecção de automação em número recém-vinculado mandando
   texto comercial para quem não o tem na agenda. **Cada ocorrência queima
   a instância até alguém ler QR de novo, e toda resposta do lead naquele
   número se perde.** É isto que "não chegou para nenhum dos dois
   atendentes" no 98639-7086.
2. **A duplicação de conversa por troca de instância continua** e é por
   desenho: `garantirConversa` busca por `(instancia_id, jid)`
   (`bridge.ts:126`, `db.ts:147`) — instância diferente = conversa nova.
   O "checkpoint" que o Bruno lembra existe só como valor de enum
   (`instancia_trocada` em `chat_historico_checkpoints`, migration
   20260905013751) de um histórico paralelo desligado (0 linhas). Nunca
   foi ligado à conversa do Atendimento.
3. **"Só posso responder conversas atribuídas a mim"** mesmo sendo o
   atendente do lead: `podeResponderConversa` (`lib/chat/actions.ts:46-51`)
   exige que o **atribuído no Chatwoot** seja eu. A leitura
   (`podeLerConversa`, `lib/chat/autorizacao.ts:31`) aceita OU o atendente
   do lead. A campanha grava `crm_contatos.atendente_id` mas nunca atribui
   a conversa no Chatwoot — então ler passa, responder não. Bug de
   inconsistência entre as duas checagens.
4. **"3+3 mas só aparecem alguns"** não é bug: `getConversasAtendimento`
   esconde disparo sem resposta de TODAS as listas
   (`atendimento-actions.ts:449`, regra deliberada de 03/09 pra fila não
   virar lista de quem não respondeu). Tonys e Winston não responderam.
   Abrir o lead mostra a conversa. Se a expectativa do atendente é ver o
   que foi disparado pra ele, é decisão de produto (§3, item C).
5. **Templates na tela de atendimento** aparecem pra todo papel:
   `ConversaCentro.tsx:665-669` + `getTemplates` sem checagem de
   permissão. Bruno decidiu: não faz sentido no Atendimento.
6. **Sem data no balão**: `ConversaCentro` usa `horaBr`; `dataHoraBr`
   ("13/09/2026 17:55") já existe em `ui.tsx:89`.

## 1. P0 — Proteger os números de disparo (antes de disparar de novo)

Isto é operacional e de código, e vem antes de qualquer tela, porque cada
campanha de teste hoje custa um número.

**Código (engine + CRM):**
- **Elegibilidade por idade de pareamento.** `instanciasDisparoAtivas`
  (`disparo-shared.ts:30`) e a validação do worker (`disparo-worker.ts:101`)
  passam a exigir `conectada_em <= now() - :aquecimento` (proposta: 48 h;
  configurável por parceiro, `crm_parceiro_config.disparo_aquecimento_horas`,
  migration pequena, minha). Número recém-pareado aparece na tela de
  campanha como "em aquecimento (falta Xh)", não entra no rodízio.
- **Fail-closed quando um número cai no meio** (era o Passo 1 do
  `PLANO-DISPAROS-OPERACAO-2026-09-11.md`, nunca executado): status
  `conectando` → item volta a `pendente` sem gastar tentativa, +2 min;
  `desconectada` → campanha **pausa sozinha** com `pausa_motivo`
  ("(61) 99266-4435 desvinculada pelo WhatsApp"), tela avisa, e os itens
  daquele número são **re-roteados** para os outros números elegíveis ao
  retomar (hoje a composição é travada: `crm_campanha_disparo_instancias`
  fixa na criação — o re-roteamento exige recalcular `instancia_id` dos
  itens pendentes daquela instância, mantendo template e ordem).
- **Evento visível.** `device_removed` em instância de disparo grava
  `chat_eventos` (já existe) e a tela de Campanhas mostra o aviso no card
  da campanha ativa + no card de instâncias.

**Operação (decisão do Bruno, sem código):**
- Não pareie e dispare no mesmo dia. Aquecer 2–3 dias com uso humano
  (conversas normais, grupos) antes de entrar no rodízio.
- Nos testes, parar de mandar o MESMO texto para os MESMOS 6 números
  repetidamente — pra detecção do WhatsApp isso é exatamente spam. Testar
  com 1 número por vez e textos diferentes.
- Janela de horário e opt-out (Passo 2 do plano de 11/09) continuam
  pendentes e continuam relevantes para risco de bloqueio.

## 2. P1 — Uma conversa por lead, com checkpoint de troca de número

Desenho (arquitetura minha; migration minha):

- **Chave da conversa passa a ser (conta Chatwoot, jid)** para conversa
  1:1; grupo continua por instância. `chat_conversas.instancia_id` passa
  a significar **"instância atual"** — a última que falou com o lead.
- `garantirConversa(inst, rem, origem)`: busca a conversa mais recente da
  **conta** para o jid (nova `conversaPorJidNaConta(contaId, jid)`).
  Se existir e `instancia_id !== inst.id`: atualiza `instancia_id`,
  grava checkpoint e espelha no Chatwoot um **comentário interno** na
  própria conversa: "Conversa continuou pelo número (61) 99266-4435 —
  antes: (61) 99678-5009". Não cria conversa nova no Chatwoot: a thread é
  a mesma (mesma `chatwoot_conversation_id`, inbox antiga — o inbox do
  Chatwoot deixa de ser fonte de verdade pra "qual número").
- Nova tabela `chat_conversa_checkpoints (id, conversa_id, de_instancia_id,
  para_instancia_id, motivo text, created_at)` — é o que a tela do
  Atendimento renderiza inline como marcador ("— continuou pelo número
  X —"), e é o dado do enum `instancia_trocada` que nunca foi usado. Não
  reaproveitar `chat_historico_checkpoints` (pertence ao histórico
  paralelo desligado, chave é `timeline_id`).
- **Envio pela conversa usa `chat_conversas.instancia_id`**, nunca o
  `inbox_id` do Chatwoot: `responderConversaParceiro` (CRM) e o webhook
  de saída do engine (`server.ts`, resolve por `conversaPorChatwoot`) já
  chegam à linha; falta garantir que o `POST /instancias/:id/enviar` use
  a instância da linha. `getConversasAtendimento` deriva
  `instanciaNome/instanciaNumero/instanciaPapel` da linha, não de
  `instPorInbox` (hoje `atendimento-actions.ts:415,458`).
- **Dados existentes:** não há como fundir conversas já criadas no
  Chatwoot. Regra de transição: a busca por (conta, jid) devolve a mais
  recente; as antigas ficam como estão (o cliente que responder nelas
  ainda aparece — o engine trata inbound pela `(instancia, jid)` da
  mensagem, e essa linha antiga existe). Opcional: script único que
  resolve no Chatwoot as duplicadas mais antigas dos 6 leads de teste.
- **Índice**: hoje `onConflict: 'instancia_id,jid'` (`db.ts:176`) — segue
  válido (1:1 nunca terá duas linhas na mesma instância); acrescenta índice
  `(jid, updated_at desc)` para a busca por conta.
- Alias LID (`chat_contato_alias`, por instância) não muda: a sessão
  Signal é por instância mesmo.
- Riscos a testar: Chatwoot exige `contact_inbox` do inbox da conversa
  para aceitar mensagem — como espelhamos via API de mensagens da
  conversa (não via canal), funciona; confirmar no primeiro envio real
  cruzado. Webhook `conversation_updated` do Chatwoot continua sendo
  ignorado.

## 3. P2 — Atendente responde o que é dele

- **A.** `podeResponderConversa` (`lib/chat/actions.ts`) passa a usar a
  MESMA regra de `podeLerConversa`: atribuído no Chatwoot **ou** atendente
  do lead. Uma função, dois usos — hoje são duas.
- **B.** Atribuição automática no Chatwoot: quando a conversa nasce por
  **disparo** (engine, `garantirConversa` com `origem='disparo'`), o item
  da fila tem `contato_id` → `crm_contatos.atendente_id` → atribui no
  Chatwoot pelo e-mail determinístico (`lib/chat/agentes.ts`). E no CRM,
  `resolverLeadsDasConversas` (roda a cada carga da lista) atribui quando
  vincula um lead com atendente a uma conversa ainda sem atribuído. Assim
  "Responsável" na tela e a permissão passam a bater com a distribuição
  da campanha.
- **C.** Decisão de produto (Bruno): mostrar ao atendente os disparos
  DELE ainda sem resposta? Proposta: manter fora de "Meus"/"Fila" (regra
  de 03/09 continua certa) e acrescentar um contador/aba **"Disparados
  (aguardando resposta)"** só com os leads do próprio atendente, sem
  entrar no fluxo de atendimento até responderem.

## 4. P3 — Tela de Atendimento

- Data + hora em todo balão e evento: `dataHoraBr` no lugar de `horaBr`
  em `ConversaCentro.tsx` (formato "13/09/2026 17:55" já é o da função).
  Sugestão de leitura: separador de dia ("Hoje", "Ontem", "11/09/2026")
  entre grupos + hora no balão — decide o Bruno; o pedido literal é
  data+hora no balão e é o que se faz por padrão.
- Remover a faixa de templates (`ConversaCentro.tsx:665-669` e o
  `getTemplates` que a alimenta) do Atendimento para todos os papéis. A
  gestão de templates continua em Configurações › WhatsApp não oficial,
  usada só pelo disparo.

## 5. P4 — Solicitar simulação v3 (retorno do Bruno)

Sobre `SolicitarSimulacaoModal.tsx` (v2, `462a51c`):

1. **Lead da carteira**: ao clicar no campo já abre a lista rolável dos
   leads do atendente (sem exigir 2 caracteres); digitar filtra.
   `getLeads` já é escopado (`leads.ver_meus` → `atendente_id = eu`) e já
   devolve `margem_novo/rmc/rcc` e `cpf`; falta incluir `nascimento` no
   select. Selecionou → preenche **CPF** e **Data de nascimento**
   (somente leitura) e carrega as **3 margens** (Novo / Cartão RMC /
   Cartão RCC) em cards como no painel do lead. Mesmos campos de
   identidade nos dois modos.
2. **Forma de simulação**: seletor "Parcela desejada" | "Valor liberado".
   - Parcela desejada: ao escolher (ou ao trocar o produto), pré-preenche
     com a margem do produto (novo → margem novo, cartão RMC → RMC,
     cartão RCC → RCC; refin não tem margem → vazio). Valor maior que a
     margem **não bloqueia**, mostra aviso "acima da margem do produto
     (R$ X)".
   - Valor liberado: campo "Valor liberado desejado (R$)".
   - Payload/registro ganham `formaSimulacao: 'parcela'|'valor_liberado'`
     e `valorLiberadoDesejado` (jsonb, sem migration).
3. **Máscara monetária** ("R$ 1.234,56") em parcela e valor liberado —
   mesma máscara nos modais de responder.
4. **"Banco preferido" → "Instituição Financeira"**: select com as
   instituições **ativas** do Workspace (`financial_institutions`,
   `is_active and deleted_at is null`, 52 hoje; `name` é o nome
   comercial — "Banco BMG", "Banco C6 Bank"). Nova action
   `listarInstituicoesFinanceirasAtivas()` (leitura, cache de 5 min no
   servidor). Grava `instituicaoPreferidaId` + nome no payload
   (`bancoPreferido` continua sendo preenchido com o nome, pra painel e
   cartão do chat não mudarem).
5. Validação de CPF/nascimento do modo "Cliente sem cadastro" já existe
   (`validarCpf`/`validarNascimento`); no modo "Lead" os dois campos vêm do
   lead e não são editáveis.

## 6. P5 — Biblioteca de figurinhas (e GIF)

Hoje "figurinha" = escolher um arquivo. O pedido é uma biblioteca como a
do WhatsApp.

- **Migration (minha)**: `crm_chat_figurinhas (id, agente_parceiro_id,
  path, mime, largura, altura, criado_por, usos int default 0,
  ultimo_uso_em, created_at, deleted_at)`. Bucket `parceiro-midias`,
  path `figurinhas/<agente_parceiro_id>/<uuid>.webp|png`. Biblioteca é
  **do parceiro** (todos os usuários veem e usam); só quem enviou ou o
  master remove.
- **UI**: o botão de figurinha abre um popover em grade (recentes → mais
  usadas → todas), busca não; "＋ Adicionar" sobe webp/png (≤ 1 MB,
  magic bytes — `classificarAnexoChat` já valida) e já envia. Clicar numa
  figurinha envia **sem novo upload**: a mensagem referencia o mesmo
  `path` da biblioteca (`assinarAnexoInterno` passa a aceitar o prefixo
  `figurinhas/<tenant>/` além de `chat-interno/<tenant>/`), incrementa
  `usos`.
- **GIF**: busca de GIF como no WhatsApp exige provedor externo (Tenor/
  GIPHY, chave de API, chamadas do navegador liberadas na CSP). Fase 2,
  só com a chave em mãos. Sem a chave: GIF animado entra pela mesma
  biblioteca (upload de `.gif` — hoje recusado pelo classificador, que
  aceita só PNG/JPG/WebP por magic bytes; acrescentar GIF89a/GIF87a).

## 7. Fora deste plano (já decidido)

- "Aguardando" no número comercial do Bruno: caso isolado da sessão
  Signal (10-11/09). Decisão de 11/09: esperar uma semana com a trava de
  persistência antes de resetar. Reavaliar em 18/09.
- Tráfego técnico, janela de horário e opt-out: continuam no
  `PLANO-DISPAROS-OPERACAO-2026-09-11.md`, Passos 2-3.

## 8. Ordem e quem executa

| # | Bloco | Executor | Depende de |
|---|---|---|---|
| 1 | P0 código (aquecimento, fail-closed, re-rota, aviso) | **Opus** (engine `disparo-worker.ts` + CRM `disparo-shared.ts`/tela) | migration `disparo_aquecimento_horas` (Fable) |
| 2 | P2-A (regra única de responder) + P3 (data/hora, tirar templates) | **Sonnet** | nada |
| 3 | P2-B (atribuição automática no Chatwoot) | **Opus** (engine) + Sonnet (CRM) | nada |
| 4 | P4 (simulação v3) | **Sonnet** | nada |
| 5 | P5 (figurinhas) | **Sonnet** | migration `crm_chat_figurinhas` (Fable) |
| 6 | P1 (conversa única + checkpoint) | **Opus** (engine + CRM), revisão Fable | migration `chat_conversa_checkpoints` (Fable); testar em conta de teste antes |

P1 é o maior e o mais delicado (mexe em como toda conversa nasce e por
onde se responde) — por isso vai por último e com teste real controlado;
P0 vem primeiro porque sem ele cada teste queima um número. Decisões que
só o Bruno fecha antes de começar: aquecimento (48 h?), aba "Disparados",
separador de dia, GIF com Tenor (sim/não).
