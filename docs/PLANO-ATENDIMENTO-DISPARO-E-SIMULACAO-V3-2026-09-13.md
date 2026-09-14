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

**Confirmação do Bruno nos aparelhos (13/09, 19h30 local):** a 5009 foi
**restrita por 5 horas pela Meta** e teve o QR desconectado (ainda não
banida, mas bloqueada para nova conexão); a 4435 só perdeu a conexão, sem
restrição, e foi reconectada em seguida. Restrição temporária é o degrau
que antecede o banimento — a 5009 já caiu duas vezes (11/09 e 13/09) pelo
mesmo motivo. A 4435 reconectada hoje conta como pareamento novo: **não
deve entrar em disparo nas próximas 48 h.**

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

## Decisões do Bruno (13/09, 20h) que fecham este plano

- **Meus**: lead que respondeu ao disparo aparece em "Meus" **já
  atribuído** ao atendente da campanha (não em Fila, não em Campanha).
- **Fila**: só **receptivos** (conversa que NÃO nasceu de disparo, de
  qualquer instância) ainda sem atendente — não assumidos, não
  transferidos, não atribuídos.
- **Campanha**: reaproveita a aba existente para listar os **disparados
  do atendente aguardando resposta** (não cria aba nova; não há espaço).
- **Aquecimento de 48 h** aprovado, como **sinalizador**, não bloqueio
  duro: "Instância em aquecimento" + botão "Liberar para disparo" com
  confirmação de risco. Tudo registrado para medir a qualidade de cada
  número.
- **Ciclo de vida da instância**: motivo obrigatório ao reconectar depois
  de desconexão externa; número informado × número detectado; tipo de
  número; operadora (cadastro no Workspace com logotipo 500×500); tipo de
  plano com controle de recargas (pré-pago); histórico de conexões por
  instância com campanhas/disparos/respostas.
- **Datas**: separador de dia entre as mensagens (como o WhatsApp) **e**
  data+hora em cada balão ("13/09/2026 17:55").
- **GIF**: Tenor foi descontinuado pelo Google (30/06/2026). Usar
  **GIPHY** — conta já criada (`@brspromotora`); chave em
  developers.giphy.com → Create an App → tipo **API** (chave beta sai na
  hora; a de produção pede aprovação do app). **A chave NÃO fica na Vercel**:
  vai no Workspace, Configurações › Provedores e APIs › card
  **"Figurinhas/GIFs (GIPHY)"**, no mesmo molde dos outros provedores
  (tabela `giphy_config` id=1, `api_key_enc` no cofre AES com
  `CRM_CREDENTIALS_KEY`), uma chave para todo o grupo. O CRM lê
  `giphy_config` pelo service role e decifra com o cofre dele (mesma
  chave e mesmo formato `base64(iv||ct||tag)`).

## 2. P1 — Atendimento: abas, atribuição e permissão de resposta

### 2.1 Regra única de "é minha" (CRM, Sonnet)
`podeResponderConversa` (`lib/chat/actions.ts:46-51`) passa a usar a MESMA
função de `podeLerConversa` (`autorizacao.ts:22-35`): atribuído no Chatwoot
**ou** atendente do lead. Extrair para `podeAgirNaConversa(...)` em
`autorizacao.ts` (pura, testada) e chamar nos dois lugares. Some o "só
posso responder conversas atribuídas a mim" para quem é dono do lead.

### 2.2 Atribuição automática (engine Opus + CRM Sonnet)
- Engine: `garantirConversa` com `origem='disparo'` recebe `contatoId` do
  item da fila → lê `crm_contatos.atendente_id` → atribui a conversa no
  Chatwoot ao agente do atendente (e-mail determinístico,
  `lib/chat/agentes.ts`; o engine já tem `ChatwootConta`). Se o agente
  não existir no Chatwoot ainda, cria sob demanda (mesma rotina que o
  CRM usa em `atribuirConversa`).
- CRM: `resolverLeadsDasConversas` atribui no Chatwoot quando vincula um
  lead com atendente a uma conversa sem atribuído (cobre orgânicas e o
  legado).
- Resultado: "Responsável: Isabelly" na tela e a permissão passam a
  bater com a distribuição da campanha sem passo manual.

### 2.3 Abas com o significado decidido (CRM, Sonnet)
Em `getConversasAtendimento` (`atendimento-actions.ts:442-483`):
- **Meus** = `ehMeu` (como hoje) — disparo respondido entra aqui, já
  atribuído por 2.2.
- **Fila** = `row.origem !== 'disparo'` **e** sem atribuído **e** lead sem
  atendente (hoje não olha origem: `:455`).
- **Campanha** = a aba já existe para campanha manual de ligação
  (`FilaConversas.tsx:14-18,148-157`). Ganha uma segunda seção
  **"Disparos aguardando resposta"**: itens de `crm_campanha_disparo_fila`
  com `status='enviado'`, do atendente da sessão (via `crm_contatos.
  atendente_id`), cuja conversa ainda tem `respondida=false`; cada item
  abre o lead (que mostra a conversa do disparo, como hoje). A regra
  "disparo sem resposta fora de Meus/Fila" (`:449`) continua.
- Contadores das abas refletem o mesmo critério.

### 2.4 Datas (CRM, Sonnet)
`ConversaCentro.tsx`: separador de dia entre grupos ("Hoje", "Ontem",
"11/09/2026") **e** `dataHoraBr` em cada balão/evento no lugar de
`horaBr`. Remover a faixa de templates (`:665-669` + `getTemplates`).

## 3. P2 — Ciclo de vida da instância de WhatsApp

Tudo em cima de `chat_instancias` (colunas hoje: nome, papel, provedor,
status, numero [detectado pelo engine no `open`], nome_perfil,
conectada_em, ultimo_envio_em, ordem…). Migrations minhas.

### 3.1 Schema (Fable)
```
alter table chat_instancias add column
  numero_informado text,            -- E.164 digitado no cadastro (+55 (61) 90000-0000 ou fixo)
  tipo_numero text check (tipo_numero in ('celular','fixo','virtual')),
  operadora_id uuid references operadoras_telefonia(id),
  tipo_plano text check (tipo_plano in ('pre_pago','pos_pago','virtual')),
  disparo_liberado_em timestamptz,  -- liberação antecipada do aquecimento (vale pro pareamento atual)
  disparo_liberado_por uuid references crm_usuarios(id),
  restrito_ate timestamptz;         -- restrição da Meta informada na reconexão

create table chat_instancia_eventos (
  id uuid pk, instancia_id uuid not null, agente_parceiro_id uuid not null,
  tipo text not null check (tipo in ('conexao','desconexao_sistema','desconexao_externa',
    'reconexao','liberacao_antecipada','numero_divergente','restricao','banimento')),
  motivo text check (motivo in ('banimento','restricao_meta','desconexao_manual',
    'desconexao_aparelho','mudanca_aparelho','mudanca_aplicativo','outro')),
  prazo_horas int, observacao text, numero_detectado text,
  origem text not null check (origem in ('engine','usuario')),
  autor_crm_usuario_id uuid, created_at timestamptz default now()
);
create table chat_instancia_recargas (
  id uuid pk, instancia_id uuid not null, agente_parceiro_id uuid not null,
  data_recarga date not null, valor numeric(10,2) not null,
  proxima_recarga date not null,
  check (proxima_recarga > data_recarga and proxima_recarga <= data_recarga + 60),
  autor_crm_usuario_id uuid, created_at timestamptz default now()
);
```
`operadoras_telefonia (id, nome, logo_url, is_active, deleted_at, …)` é
**cadastro do Workspace** (Cadastros › Operadoras de Telefonia) — **FEITO
pelo Fable em 13/09** nesta mesma rodada (tela, actions, 4 pontos de
permissão `workspace-operadoras-telefonia`, logotipo 500×500 em data URL
como as averbadoras). O CRM só lê (`select id, nome, logo_url … where
is_active and deleted_at is null`).

### 3.2 Engine grava os eventos (Opus)
- `open` → evento `conexao` com `numero_detectado`; se `numero_informado`
  existe e diverge (comparação por `normalizarTelefone`) → evento
  `numero_divergente` + `ultimo_erro` informativo ("número conectado
  difere do cadastrado") — **não bloqueia**, sinaliza no card.
- `close` com 401 `device_removed`/`loggedOut` → `desconexao_externa`
  (`codigo`, `conflito` no `observacao`). Botão "Desconectar" do sistema →
  `desconexao_sistema`. Mesmo ponto onde hoje só se loga
  `conflito de sessão` (`baileys.ts`).
- O engine nunca pede motivo — isso é do usuário (3.3).

### 3.3 Reconexão com motivo (CRM, Sonnet)
Se o último evento da instância é `desconexao_externa` sem `reconexao`
depois, o botão **Conectar** abre antes o modal **"Por que este número
desconectou?"** (obrigatório): Banimento · Restrição da Meta (habilita
"prazo em horas" → grava `restrito_ate = now() + horas` e evento
`restricao`) · Desconexão manual · Desconexão do aparelho · Mudança de
aparelho · Mudança de aplicativo · Outro (observação). Grava `reconexao`
e só então mostra o QR. Instância `restrito_ate > now()` aparece
"Restrita até 13/09 23:02" e não é elegível para disparo.

### 3.4 Cadastro e card (CRM, Sonnet)
- Formulário da instância ganha: Número (máscara celular/fixo, salvo
  E.164 em `numero_informado`), Tipo de número, Operadora (select com
  logotipo, vindo de `operadoras_telefonia` ativas), Tipo de plano.
- **Frente do card**: logotipo da operadora, número informado (e o
  detectado, se divergir, em âmbar), selo do plano, **mostradores**:
  disparos (fila `enviado`), enviadas/recebidas (`chat_mensagens_mapa`
  por `instancia_id`, `from_me`), desconexões externas, reconexões,
  restrições, banimentos (de `chat_instancia_eventos`), e o **contador
  de dias para a próxima recarga** (pré-pago) — vermelho piscando nos 5
  últimos dias.
- **Verso do card** (botão "virar"): tabela de recargas — Data da
  recarga · Valor · Próxima recarga (sugerida = data + 60 dias; o usuário
  pode antecipar, nunca adiar — a check do banco garante). Só aparece
  com `tipo_plano='pre_pago'`.
- Botão **"Histórico de conexões"** junto dos mostradores → janela
  sobreposta com os eventos tabulados (data, tipo, motivo, prazo, autor,
  número detectado) e, abaixo, as campanhas em que o número entrou
  (`crm_campanha_disparo_instancias`) com disparos, respondidos e sem
  resposta (fila × `chat_conversas.respondida`).

### 3.5 Aquecimento e liberação (CRM Sonnet + engine Opus)
Elegível para disparo = `conectada` **e** `restrito_ate` vazio ou vencido
**e** (`conectada_em <= now() - 48 h` **ou** `disparo_liberado_em >=
conectada_em`). O aquecimento é por parceiro em `crm_parceiro_config.
disparo_aquecimento_horas` (padrão 48). Card mostra "Em aquecimento
(faltam 31 h)" + botão **"Liberar para disparo"** → modal "Este número foi
pareado há Xh. Liberar antes do aquecimento aumenta o risco de restrição
ou banimento pela Meta. Você assume esse risco?" → grava
`disparo_liberado_em/por` + evento `liberacao_antecipada`. Composição de
campanha e worker (`disparo-shared.ts:30`, `disparo-worker.ts:101`) usam
a mesma função de elegibilidade (pura, testada).

## 4. P3 — Solicitar simulação v3 (Sonnet)

Sobre `SolicitarSimulacaoModal.tsx` (v2):
1. **Lead da carteira**: clicar no campo abre a lista rolável dos leads
   do atendente (sem exigir 2 caracteres; digitar filtra). `getLeads` já
   é escopado por `atendente_id`; acrescentar `nascimento` ao select.
   Selecionar preenche **CPF** e **Data de nascimento** (só leitura) e
   carrega os **3 cards de margem** (Novo / RMC / RCC). Mesmos campos de
   identidade nos dois modos.
2. **Forma de simulação**: "Parcela desejada" | "Valor liberado".
   Parcela → pré-preenche com a margem do produto (novo/RMC/RCC; refin não
   tem margem → vazio); acima da margem **avisa, não bloqueia**. Valor
   liberado → campo "Valor liberado desejado (R$)". Payload ganha
   `formaSimulacao` e `valorLiberadoDesejado` (jsonb, sem migration).
3. **Máscara monetária** ("R$ 1.234,56") em parcela e valor liberado, aqui
   e nos modais de responder.
4. **"Instituição Financeira"** no lugar de "Banco preferido": select das
   ativas do Workspace (`financial_institutions`, `is_active and
   deleted_at is null`, 52 hoje; `name` é o nome comercial) via nova
   action `listarInstituicoesFinanceirasAtivas()` (cache 5 min). Grava
   `instituicaoPreferidaId` + nome (`bancoPreferido` segue preenchido com
   o nome pra painel/cartão não mudarem).

## 5. P4 — Biblioteca de figurinhas e GIFs (Sonnet; migration Fable)

- `crm_chat_figurinhas (id, agente_parceiro_id, path, mime, largura,
  altura, criado_por, usos int default 0, ultimo_uso_em, created_at,
  deleted_at)`; bucket `parceiro-midias`, path
  `figurinhas/<agente_parceiro_id>/<uuid>.<ext>`. Biblioteca do
  **parceiro** (todos usam; remove quem enviou ou o master).
- Botão de figurinha abre popover com **duas abas**: **Figurinhas**
  (grade: recentes → mais usadas → todas; "＋ Adicionar" sobe webp/png/gif
  ≤ 1 MB e já envia; clicar reenvia **sem novo upload** — a mensagem
  referencia o `path` da biblioteca, `assinarAnexoInterno` aceita o
  prefixo `figurinhas/<tenant>/`, `usos++`) e **GIF** (busca GIPHY).
- **GIPHY**: proxy no servidor (`buscarGifs(q)`, `GIPHY_API_KEY` na
  Vercel, cache 10 min, "Powered by GIPHY" no popover — exigência dos
  termos). Ao escolher, o servidor baixa o GIF (≤ 2 MB, magic bytes
  GIF89a/GIF87a) e grava na biblioteca do parceiro — a mensagem fica
  igual a qualquer figurinha, sem depender do GIPHY depois. O
  classificador (`classificarAnexoChat`) passa a aceitar GIF como
  imagem/figurinha; render `<img>` animado.

## 6. P5 — Uma conversa por lead, com checkpoint de troca de número (Opus; migration e revisão Fable)

- Chave da conversa 1:1 passa a ser **(conta Chatwoot, jid)**; grupo
  continua por instância. `chat_conversas.instancia_id` = **instância
  atual** (a última que falou com o lead).
- `garantirConversa`: nova `conversaPorJidNaConta(contaId, jid)` (mais
  recente); se existe e `instancia_id !== inst.id` → atualiza
  `instancia_id`, grava checkpoint, espelha no Chatwoot um **comentário
  interno** na mesma conversa ("Conversa continuou pelo número (61)
  99266-4435 — antes (61) 99678-5009"). Não cria conversa nova no
  Chatwoot; o inbox deixa de ser fonte de verdade de "qual número".
- Nova `chat_conversa_checkpoints (id, conversa_id, de_instancia_id,
  para_instancia_id, motivo, created_at)` — a tela renderiza inline como
  marcador. (Não reaproveitar `chat_historico_checkpoints`: pertence ao
  histórico paralelo desligado.)
- **Envio pela conversa usa `chat_conversas.instancia_id`**, nunca
  `inbox_id`: `responderConversaParceiro` (CRM), webhook de saída do
  engine (`server.ts`, `conversaPorChatwoot`) e `getConversasAtendimento`
  (`instanciaNome/Numero/Papel` da linha, não de `instPorInbox`,
  `:415,458`).
- Dados existentes: não há como fundir conversas já criadas no Chatwoot;
  a busca devolve a mais recente e as antigas ficam (inbound nelas
  continua funcionando pela `(instancia, jid)` da mensagem). Opcional:
  resolver no Chatwoot as duplicadas antigas dos 6 leads de teste.
- Índice `(jid, updated_at desc)`; `onConflict: 'instancia_id,jid'`
  continua válido. Alias LID por instância não muda.
- Testar em conta de teste antes: envio cruzado (mensagem espelhada numa
  conversa cujo inbox é de outra instância) e resposta pela instância
  atual.

## 7. Fora deste plano (já decidido)
- "Aguardando" no número comercial do Bruno: reavaliar em 18/09.
- Tráfego técnico, janela de horário e opt-out: `PLANO-DISPAROS-OPERACAO-
  2026-09-11.md`, Passos 2-3. Janela e opt-out continuam importando para
  o risco de bloqueio.

## 8. Ordem e quem executa

| # | Bloco | Executor | Pré-requisito |
|---|---|---|---|
| 1 | §1 P0 código: elegibilidade (48 h + liberação + restrição), fail-closed, re-rota, aviso | **Opus** (engine `disparo-worker.ts`, CRM `disparo-shared.ts`) | migrations §3.1 (Fable) |
| 2 | §2.1 regra única de responder + §2.4 datas/templates | **Sonnet** | nada |
| 3 | §2.2 atribuição automática + §2.3 abas (Meus/Fila/Campanha) | **Opus** (engine) + **Sonnet** (CRM) | nada |
| 4 | §3.2 eventos no engine | **Opus** | migrations §3.1 |
| 5 | §3.3-3.5 reconexão com motivo, cadastro, card (frente/verso), histórico | **Sonnet** | §3.1 + tela de Operadoras (sessão Workspace) — o card pode nascer com operadora opcional |
| 6 | §4 simulação v3 | **Sonnet** | nada |
| 7 | §5 figurinhas + GIPHY | **Sonnet** | migration figurinhas (Fable) + `GIPHY_API_KEY` na Vercel (Bruno) |
| 8 | §6 conversa única + checkpoint | **Opus**, revisão Fable | migration checkpoints (Fable); teste em conta de teste |

Recomendação de sessão: Opus abre uma worktree só para engine (1, 3-engine,
4, 8); Sonnet outra para CRM (2, 3-CRM, 5, 6, 7). As migrations saem todas
de uma vez, antes, pela pasta principal do `brs-workspace` — eu as escrevo
e o Bruno aplica (`echo Y | npx supabase db push`), como hoje.

Até tudo isto estar no ar: **não disparar com número pareado há menos de
48 h, não repetir o mesmo texto para os mesmos números, e não reconectar
a 5009 antes do fim da restrição.**

## 9. Estado em 13/09 (noite) — parte do Fable feita

Commit no `brs-workspace` (esta rodada):
- Migrations, na ordem: `20260913213348_operadoras_telefonia`,
  `20260913213349_chat_instancias_ciclo_vida`, `20260913213350_crm_chat_figurinhas`,
  `20260913213351_chat_conversa_checkpoints`, `20260913213844_giphy_config`.
- Workspace: cadastro **Operadoras de Telefonia** (`/operadoras-telefonia`)
  e card **Figurinhas/GIFs (GIPHY)** em Provedores e APIs
  (`/rh/parceiros/config/provedores/figurinhas-gifs`), com Testar conexão.
  `tsc --noEmit` limpo; lint limpo nos arquivos novos.

### Handoff — próximo modelo: **Opus** (engine primeiro)

Worktree própria no `brs-alvoconsig` (`crm/v3-engine-protecao`). Nesta ordem:
1. §1 P0 no engine + `disparo-shared.ts`: função pura
   `instanciaElegivelParaDisparo({status, conectada_em, disparo_liberado_em,
   restrito_ate, aquecimentoHoras, agora})` (testada) usada pela composição
   e pelo worker; fail-closed (`conectando` → pendente sem gastar tentativa
   +2 min; `desconectada` → pausa a campanha com `pausa_motivo` e re-roteia
   os itens pendentes daquela instância ao retomar); evento na tela.
2. §3.2 eventos em `chat_instancia_eventos` (open → `conexao` +
   `numero_divergente`; close 401 → `desconexao_externa`; Desconectar do
   sistema → `desconexao_sistema`).
3. §2.2 atribuição automática no Chatwoot na criação da conversa de
   disparo (contato → `crm_contatos.atendente_id` → agente por e-mail).
4. §6 conversa única + checkpoint — só depois dos 3 acima, em conta de
   teste.
Depois, **Sonnet** no CRM (`crm/v3-crm-telas`): §2.1, §2.3, §2.4, §3.3-3.5,
§4, §5. Para o GIPHY no CRM: ler `giphy_config` (id=1) com o client admin
e decifrar `api_key_enc` — o cofre do CRM (`lib/crm/cofre.ts`) só tem a
variante JSON; acrescentar `decifrarTexto` com o MESMO primitivo
(aes-256-gcm, `base64(iv(12)||ct||tag(16))`, chave `CRM_CREDENTIALS_KEY`),
que é exatamente o `cifrarTexto` do Workspace.

## 10. Etapa do Opus — feita em 13/09 (noite)

Commit `brs-alvoconsig` (main): "Disparo: número recém-pareado não entra no
rodízio, campanha pausa sozinha quando o número cai, e conversa de disparo
nasce atribuída". Typecheck limpo, 245/245 testes, lint no baseline.

**Feito (§1 P0, §2.2, §3.2):**
- `avaliarElegibilidadeDisparo` (função pura, 8 testes) usada pela composição
  da campanha, pelo cron do Next.js (caminho ativo) e pelo worker do engine.
  Aquecimento de 48 h por parceiro (`crm_parceiro_config.disparo_aquecimento_horas`),
  liberação antecipada registrada (`disparo_liberado_em/por` + evento), e
  restrição da Meta como bloqueio não-liberável.
- Fail-closed nos dois caminhos de execução: transitória devolve o item sem
  gastar tentativa (+2 min); o resto pausa a campanha com `pausa_motivo` e
  devolve (+15 min). `rerotearPendentesDaCampanha` redistribui os pendentes
  ao retomar, com o template do número de destino; retomar limpa o motivo.
- Eventos em `chat_instancia_eventos`: `conexao`, `numero_divergente`
  (sinaliza, não bloqueia), `desconexao_externa` (401/device_removed e
  logout) e `desconexao_sistema` (botão). O motivo da desconexão externa
  continua sendo do humano, na tela (§3.3).
- Atribuição automática da conversa de disparo ao atendente do lead
  (`atribuirConversaAoAtendente`, agente criado sob demanda pelo e-mail
  determinístico). `contatoId` viaja fila → engine → rota de envio.
- `getProgressoDisparo` passa a devolver `status`, `pausaMotivo` e as
  instâncias da campanha com situação; `getComposicaoDisponivel` devolve
  TODAS as de disparo com `elegibilidade` + `rotulo` (a tela decide o que
  mostrar/oferecer). Nova action `liberarInstanciaParaDisparo`.

**Não entra nesta etapa:** §6 (conversa única por lead + checkpoint de troca
de número) — o plano já previa que viesse depois dos três blocos acima e com
teste em conta de teste. Continua sendo do **Opus**.

**Próximo — Sonnet, worktree `crm/v3-crm-telas`:** §2.1 (regra única de
responder), §2.3 (abas Meus/Fila/Campanha), §2.4 (separador de dia +
data/hora no balão, remover templates), §3.3-3.5 (reconexão com motivo,
cadastro número/operadora/plano, card frente/verso com recargas e histórico,
botão "Liberar para disparo" consumindo a action nova), §4 (simulação v3) e
§5 (figurinhas + GIPHY lendo `giphy_config`).
