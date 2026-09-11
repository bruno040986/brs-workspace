# Retorno ao Astra — instrumentação do retry do protocolo Baileys, 09/09/2026

Ajuste **local**, na worktree `brs-alvoconsig-identidade-df3`, branch
`crm/identidade-lid-entrega`, commit `79a06e0` sobre `dca438f`. **Sem
publicação, sem push, sem sessão de instância tocada.**

## O que foi lido antes de instrumentar

Confirmado no código da versão instalada (6.7.24,
`node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js`):
`handleReceipt`/`sendMessagesAgain` são fechamentos internos de
`makeMessagesRecvSocket(config)`, sem evento emitido nem método exposto em
`sock` — o único sinal externo de início, conclusão ou erro do
reencaminhamento é a chamada ao `logger` que passamos em `config.logger`
(mesma instância que já existia como `logBaileys`, hoje silenciosa).
Mapeadas as 6 linhas específicas do retry, com o objeto e a mensagem
literal exata de cada uma.

Também confirmado, lendo `node_modules/libsignal/src/session_record.js`:
"Closing session" vem de `console.info`, direto, fora de QUALQUER logger
configurável do Baileys. Não há como correlacioná-lo por instância/wa_id
nem interceptá-lo por este ou qualquer outro logger — fica
estruturalmente fora do alcance desta instrumentação.

## Correção da narrativa anterior

Nos retornos anteriores eu havia registrado "Closing session" como algo a
investigar, próximo de achados de instabilidade. Aceito a correção: a
linha que precede "Closing session" no código (`forced new session for
retry recp`) mostra que `assertSessions([participant], true)` é chamado
INCONDICIONALMENTE dentro de `sendMessagesAgain`, toda vez que o protocolo
processa um retry — é a própria renovação de sessão que o protocolo faz
antes de reenviar, não uma falha. A instrumentação nova registra essa
linha como contexto, com o texto explícito "comportamento esperado do
protocolo, não é evidência de falha", nunca como causa comprovada. A queda
da 6019 (16:02:10 UTC, Connection Terminated / 428, autorrecuperada)
continua tratada como assunto separado, fora desta instrumentação.

## O que foi instrumentado

`criarLoggerRetryBaileys(instId, logBaileys)` (`baileys.ts`) — substitui
SÓ o `logger` passado a `makeWASocket` (não o do key store nem o do
`downloadMediaMessage`, que continuam com `logBaileys` puro). Delega tudo
ao logger original chamando sempre `alvo.<método>(...)` (nunca extrai a
referência solta, evitando qualquer problema de `this` que um `Proxy`
ingênuo teria com o objeto interno do pino) — não eleva nível, não muda
comportamento, `logBaileys` continua `silent`. Só espelha, sanitizado, no
NOSSO logger estruturado (nunca `attrs`/`key` inteiros, nunca conteúdo,
nunca stack completo — só `instId` + campos de correlação/roteamento:
`waId`/`remoteJid`/`participant`/contagens/1ª linha da mensagem de erro):

- início do reenvio (`recv retry request`) — `waId`, `remoteJid`,
  `participant`, tipo e contagem da tentativa;
- conteúdo não encontrado no cache pra um id específico (`recv retry
  request, but message not available`);
- renovação de sessão feita pelo protocolo antes do reenvio (`forced new
  session for retry recp`) — contexto, não falha, como explicado acima;
- erro ao reenviar (`error in sending message again`) — `waIds`,
  `remoteJid`, `participant`, só a 1ª linha da mensagem do erro;
- limite de tentativas atingido (`will not send message again...`);
- retry para mensagem que não é nossa (`recv retry for not fromMe
  message`).

Acrescentado também ao handler de `messages.update` já existente: log do
acknowledgement (`instId`/`waId`/status) — não é exclusivo de retry (o
Baileys não distingue um ack "normal" de um ack pós-reenvio), é o que está
disponível pra correlacionar com o log de início acima.

## Validação

8 testes novos (`baileys-retry-instrumentacao.test.ts`, `mock.module` em
`pino` e `@whiskeysockets/baileys`, mesmo padrão dos outros arquivos):
simulam as chamadas EXATAS que `handleReceipt`/`sendMessagesAgain` fazem
no código instalado e verificam (a) o espelho sanitizado em cada uma das 6
linhas; (b) que nada fora do escopo do retry passa a gerar log novo no
logger real (não eleva log bruto); (c) que `level`/`child` continuam
delegando ao `logBaileys` original, sem quebrar o resto do Baileys que
também os usa (`socket.js`, `noise-handler.js`). `npm test` 124/124 (116
anteriores + 8 novos) · `npm run typecheck` 0 erros.

## Próximo passo

Aguardando revisão antes de publicar. Depois de aprovado: mesma sequência
já usada nas rodadas anteriores (integrar na main atual, checks no
resultado integrado, publicar, confirmar SHA ativo no Railway) — e então
uma mensagem nova pela 2043 pra ver se a instrumentação nova dá
visibilidade sobre o resultado do reenvio quando/se "Aguardando mensagem"
ocorrer de novo.
