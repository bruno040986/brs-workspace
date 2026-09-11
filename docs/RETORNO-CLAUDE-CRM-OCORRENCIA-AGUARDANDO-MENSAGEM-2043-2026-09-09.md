# Retorno ao Astra — nova ocorrência de "Aguardando mensagem", instância 2043, 09/09/2026

Investigação pedida pelo Bruno: correlacionar uma ocorrência nova de
"Aguardando mensagem" na instância final 2043
(`dd8ab522-da61-46a2-a2db-2bf70860f6c0`), envio feito por volta de
09/09/2026 03:20–03:28 UTC. **Nenhuma ação de correção tomada** — instância
mantida conectada, sem reparelhamento, sem atualização do Baileys, sem
reenvio manual. Isto é só o levantamento de evidência pedido; a proposta de
ajuste fica pra depois, como pedido.

## 1. Commit efetivamente publicado no engine (confirmado ANTES de tudo)

`mcp__Railway__list-deployments` (serviço engine, produção): o deployment
ativo é **`178b54b4`**, commit **`e4c930135`** ("Corrige perda de mensagem
inbound: contato duplicado no Chatwoot"), no ar desde 08/09 04:31 UTC.

**Nenhuma das correções da rodada de identidade/entrega está publicada** —
elas ficaram só na branch local `crm/identidade-lid-entrega`
(worktree `brs-alvoconsig-identidade-df3`), nunca mergeada nem com push
pro repositório remoto do engine. Confirmado também que o push da sidebar
(commit `d182a57`, feito hoje) gerou um deployment `SKIPPED` no engine —
Railway não builda o serviço porque nenhum arquivo de `services/engine`
mudou. **Validar a sidebar não publica nem prova nada sobre o engine**,
exatamente como o Bruno registrou.

Isso significa que, na versão rodando agora:
- `getMessage` **não existe** na configuração do socket (`makeWASocket`) —
  é o comportamento de ANTES da correção da rodada 2, não depois.
- `resolverDestinoBaileys` ainda consulta `onWhatsApp` pra qualquer destino
  não-grupo, inclusive `@lid`.
- A trava de concorrência em `espelharMensagemNaConversa` não existe.

## 2. Correlação da ocorrência

- **Instância**: `dd8ab522-da61-46a2-a2db-2bf70860f6c0`, final 2043,
  `chat_instancias.status='conectada'`, `numero=556181212043`,
  `ultimo_erro=null`, `updated_at=2026-09-09 03:26:55 UTC` — instância
  segue saudável nesse aspecto, sem erro registrado.
- **`chat_mensagens_mapa`** (busca por `instancia_id`): a linha mais
  recente é de 08/09 22:20:51 UTC — **nada gravado no horário da ocorrência
  nova**. Ver limitação no item 5 abaixo: isso não indica falha, é
  esperado pelo caminho que a mensagem seguiu.
- **`chat_eventos`** (busca por `instancia_id` desde 09/09 00:00 UTC):
  **zero linhas**. Também esperado pelo mesmo motivo do item 5.
- **Logs do Railway**, deployment `178b54b4`, janela 09/09 02:55–03:30 UTC
  (janela completa, sem omissão): só dois eventos relevantes, muito
  próximos no tempo —
  - `03:24:29.278Z` — `webhook Chatwoot ignorado: evento inesperado`
    (`event=message_updated`, `conversationId=5` — outra conversa/instância,
    não a 2043).
  - `03:24:59.257Z` — `webhook Chatwoot ignorado: evento inesperado`
    (`event=conversation_updated`, `messageId=22`) — **conversationId 22 é
    a conversa da instância 2043** (confirmado por
    `chat_mensagens_mapa.chatwoot_conversation_id=22` na linha de
    08/09 22:20). NO MESMO INSTANTE (mesmo timestamp ao milissegundo),
    aparece um bloco `Closing session: SessionEntry` do libsignal, com
    `remoteIdentityKey = <Buffer 05 0a 77 ce 35 ef 45 e3 9c 95 b6 cc d4 ba
    55 3e 4c 2a 70 1d d8 62 69 23 93 21 3e d8 d1 fd de b8 26>` — **a MESMA
    identidade remota** que apareceu cronicamente instável em vários
    incidentes de 08/09 (Bad MAC/fechamento de sessão repetido, já
    registrado nos commits anteriores).
  - Nenhuma outra linha na janela: sem "instância conectada", sem "conexão
    fechada", sem erro de badSession/logout, sem crash/reinício do
    processo. O processo seguiu rodando ininterrupto.

## 3. Respostas diretas aos quatro pontos pedidos

**Chegou uma solicitação de recuperação do destinatário?**
Não é possível confirmar diretamente pelos logs atuais. O evento de
"Closing session" no mesmo instante do `conversation_updated` da conversa
22 é consistente com uma renegociação de sessão Signal — que É o que
acontece quando o outro lado reporta falha de descriptografia — mas a
mensagem específica do libsignal que nomeia isso ("Bad MAC"/retry) não
aparece nesta janela particular (só o bloco de fechamento de sessão).
**Limitação de instrumentação, não ausência confirmada do evento**: ver
item 4.

**`getMessage` foi chamado e encontrou o conteúdo?**
**Não pode ter acontecido, por construção.** O código rodando (`178b54b4`)
não configura `getMessage` nenhum em `makeWASocket` — confirmado lendo o
commit implantado. Baileys usa o próprio default do pacote
(`async () => undefined`) pra qualquer pedido de retry, sempre, pra
qualquer mensagem, não só esta. Não é uma falha desta ocorrência
específica — é o estado de TODA mensagem enviada enquanto esta versão
estiver no ar.

**O protocolo tentou reenviar e qual foi o resultado?**
Não aparece no log — e por um motivo estrutural, não por ausência do
evento: a função do Baileys que processa isso (`sendMessagesAgain`, em
`messages-recv.js`) reporta o resultado por `logger.debug(...)` usando o
logger QUE A GENTE PASSA pro socket — e esse logger (`logBaileys`) está
configurado em nível `'silent'` (`baileys.ts`). Esse log especificamente
NUNCA apareceria no Railway, independente de ter acontecido ou não. Só o
`console.log`/`console.error` bruto do libsignal (que não passa pelo nosso
logger) escapa esse filtro — é isso que vemos como "Closing session"/"Bad
MAC" nos outros incidentes. Dado que `getMessage` nem existe no código
rodando, mesmo que uma tentativa de reenvio tenha ocorrido, ela só pode ter
resultado em "message not available" (o próprio comentário do código-fonte
do Baileys pra esse caminho) — não tem como ter tido sucesso.

**Houve reconexão, reinício do processo ou erro de sessão/chaves nesse
intervalo?**
Erro de sessão/chaves: **sim** — o fechamento de sessão Signal descrito
acima, mesma identidade remota cronicamente instável desde 08/09.
Reconexão de socket ou reinício do processo: **não** — nenhuma linha de
conexão/desconexão apareceu na janela 02:55–03:30 UTC; o processo seguiu
rodando o tempo todo.

## 4. Limitações de instrumentação encontradas (não corrigidas, só registradas)

1. `logBaileys` em nível `'silent'` esconde os próprios logs de diagnóstico
   do Baileys sobre o ciclo de retry/reencaminhamento — mesmo que a
   correção do `getMessage` fosse publicada, não teríamos visibilidade
   desse passo específico sem elevar o nível desse logger (ou logar
   explicitamente no nosso código ao redor do `getMessage`).
2. **Achado novo nesta investigação**: mensagens enviadas pelo operador
   pela caixa de resposta do Atendimento passam pelo webhook
   `outboundDoChatwoot` (Chatwoot → engine), que **nunca chama
   `espelharMensagemNaConversa`/`gravarMapaMensagem`** — só o envio direto
   via `/enviar` do CRM e o inbound do WhatsApp gravam
   `chat_mensagens_mapa`. Resultado: não existe, em lugar nenhum do nosso
   sistema, um vínculo entre a mensagem no Chatwoot e o `wa_id` real no
   WhatsApp pra esse caminho — tornando impossível uma correlação exata
   por ID pra esse tipo específico de mensagem, independente do nível de
   log. Não consegui recuperar o `wa_id` desta ocorrência por esse motivo,
   não por falha de busca.

## Não feito, por instrução explícita

Nenhuma proposta de ajuste nesta entrega — só a evidência. Instância 2043
mantida conectada, sem reparelhamento; nenhuma sessão apagada, nenhuma
atualização de biblioteca, nenhum reenvio manual como tentativa de
correção.
