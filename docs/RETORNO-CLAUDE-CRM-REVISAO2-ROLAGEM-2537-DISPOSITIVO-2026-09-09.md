# Retorno ao Astra — rodada 2: rolagem, 2537, entrega por dispositivo

Responde a `REVISAO-ROLAGEM-FCC2002-E-INCIDENTES-2026-09-09.md`. Worktree
`brs-alvoconsig-dispositivo-rolagem`, branch `crm/dispositivo-rolagem-2537`,
commits `c56f541` (rolagem) e `7bc4f2e` (2537) — **ambos locais, sem
publicação.** Nenhuma sessão tocada, nenhuma mensagem real enviada, nenhum
QR/logout automático.

## 1. Rolagem — os 3 casos corrigidos

- **Áudio/anexo não forçava rolagem**: `enviarAnexo` (upload direto e via
  ticket) e `confirmarAudio` chamavam só `carregar()`. Corrigido: todo
  envio bem-sucedido do operador (texto, nota, áudio, anexo pequeno,
  anexo grande, ação otimista de assumir/transferir) chama
  `irParaMensagemEnviada()`.
- **Corrida com Realtime**: se o Realtime já tivesse entregue a mensagem
  enviada ENQUANTO a Server Action do operador ainda estava pendente, o
  `thread` não mudava mais quando essa Server Action resolvia — o efeito
  antigo (keyed só em `thread`) não disparava de novo, e `seguindoFimRef=
  true` sozinho não bastava. `irParaMensagemEnviada()` dispara um contador
  dedicado (`pedidoIrParaFim`) com efeito próprio, que rola pro fim
  INCONDICIONALMENTE — não depende de `thread` ter mudado nesta chamada.
- **Âncora de histórico obsoleta**: `carregarHistorico` capturava
  scrollTop/scrollHeight ANTES do fetch de rede — se o operador rolasse
  (ou outra atualização redimensionasse o conteúdo) durante a espera, a
  compensação usava valores já obsoletos (exatamente o exemplo aritmético
  da revisão: 200→850 vira 700 se medido cedo demais). Corrigido:
  `armarAncoraHistorico()` só é chamado DEPOIS do fetch resolver,
  imediatamente antes do `setMensagens` real — e só quando a resposta tem
  conteúdo (resposta vazia não arma nada, sem deixar sobra pra um prepend
  futuro consumir errado). Identidade de requisição (`historicoRequisicaoRef`,
  mesmo padrão de `leituraRef`) descarta resposta obsoleta.

### Testando o componente real (não só o algoritmo)

Tentei mockar as dependências do `ConversaCentro.tsx` inteiro (Server
Actions, Supabase) com `mock.module`, como já se faz no engine. **Achado
técnico**: não funciona em `apps/web` — reproduzi isoladamente (fixture
trivial, sem React) e confirmei que `mock.module` do Node só intercepta
com confiabilidade módulos ESM; `apps/web/package.json` não declara
`"type": "module"` (default CommonJS), enquanto `services/engine`
declara. Converter `apps/web` inteiro pra ESM só pra viabilizar isso seria
uma mudança grande e arriscada no toolchain do Next.js, fora do escopo
desta correção.

Alternativa aplicada: extraí a lógica de rolagem pra
`useRolagemThread.ts` (novo hook, zero dependência de Server Actions/
Supabase/Realtime — só thread + refs/callbacks). Os 3 casos da revisão
(mais histórico vazio, mensagem nova só seguindo se no fim, e ack sem
mudar chave não disparando nada) têm 8 testes novos rodando o **hook
real** via `react-dom/client` sobre jsdom, sem nenhum mock (não precisa —
o hook não tem I/O). Isso cobre a lógica de decisão de verdade, incluindo
a corrida Realtime-antes-da-action. O que NÃO fica coberto por teste
automatizado: se `enviarAnexo`/`confirmarAudio`/`enviar`/
`alterarResponsavel` de fato CHAMAM `irParaMensagemEnviada()` — isso é
1 linha por função, verificada por leitura de código nesta entrega, não
por teste; testar isso exigiria simular as Server Actions, que é
exatamente a parede do CJS acima. Homologação visual autenticada
continua pendente (sem credencial de navegador aqui, limitação já
registrada).

## 2. Instância 2537 — mensagem corrigida, sem mexer em sessão/reconexão

`classificarConflitoSessao` (nova função) prioriza código + tipo
estruturado (extraído de `error.data.content`, o node XML bruto que o
Baileys anexa ao erro em `Socket/socket.js:510`) sobre o match textual
genérico que antes dominava qualquer evidência mais específica:

| Caso | Antes | Agora |
|---|---|---|
| 440 (`connectionReplaced`) | "sessão substituída" | mantido — é o caso real |
| 401 + `conflict type=device_removed` (o log real do 2537) | "sessão substituída" (por match de texto) | **categoria própria**: "Dispositivo desvinculado pelo WhatsApp — motivo não identificado (pode ser limite de aparelhos, remoção manual ou decisão do WhatsApp; não confirma novo pareamento)" |
| Conflito textual sem tipo estruturado reconhecido | "sessão substituída" | categoria própria, não presume qual das duas acima |

Confirmado lendo `Utils/generics.js` da versão instalada
(`getErrorCodeFromStreamError`): o 401 do log real não é um 440
disfarçado — o WhatsApp mandou esse código EXPLICITAMENTE no stanza
`<stream:error>`, o que sobrepõe o fallback genérico 440 (só se aplica
quando o servidor não especifica código). Não sabemos e não afirmamos a
causa da remoção do dispositivo — só que ela é uma categoria diferente de
"conectado em outro aparelho".

5 testes novos cobrem os 3 casos pedidos (401/device_removed com o
payload exato do log real, 440, conflito desconhecido) + desconexão
normal (não classifica) + subtype futuro não reconhecido (não vira
device_removed por engano). Nenhuma política de credencial/reconexão
alterada — mesmo comportamento operacional de sempre.

## 3. Entrega por dispositivo — correção de framing + achado novo

**Correção**: 2043 e 6019 são duas instâncias/números DIFERENTES da
**MESMA conta/tenant** (DF3, `conta_id ef784c55-...`, confirmado via
`chat_instancias`+`agentes_parceiros`) — não evidência de contas
diferentes. O relatório anterior não deveria ter dado a entender isso.

**Investigação do caminho de envio ORIGINAL** (não só do retry), pedida
pela revisão — lendo `resolverDestinoBaileys`/`enviar` (`baileys.ts`) e
`Socket/chats.js` da versão instalada:

`resolverDestinoBaileys` chama `sock.onWhatsApp(jid)` pra qualquer destino
que não seja grupo/LID (linha 624-625) — inclusive `556196863171@s.whatsapp.net`,
o `remote_jid` real das mensagens 393/398. **Achado, com citação exata**:
`Socket/chats.js:156` — `onWhatsApp` já usa `USyncQuery().withContactProtocol()
.withLIDProtocol()` e o resultado retorna `{ jid: id, exists: contact, lid }`
— ou seja, **o Baileys instalado já devolve o LID do contato numa
propriedade separada (`lid`) na MESMA resposta que resolvemos pra enviar**.
Nosso código (`baileys.ts:628`, `if (registrado.jid) jidCanonico =
registrado.jid`) só lê `.jid` (o JID de telefone canônico) e **descarta
`.lid` completamente**.

**Isso corrige a hipótese anterior**: não temos evidência de que NÓS
enviamos originalmente pelo LID — `enviar()` chama `sock.sendMessage(destino.jid,
...)` com o JID de TELEFONE. O `@lid` que aparece nos logs de retry vem do
lado do PROTOCOLO/destinatário (o `attrs.from`/`participant` do stanza de
retry recebido), não de nada que decidimos mandar. A resolução LID↔PN pra
fins de sessão/dispositivo acontece inteiramente dentro do Baileys/servidor
do WhatsApp, fora do nosso controle e fora do que dá pra confirmar só lendo
o código do lado de cá.

**O que isso confirma/refuta** (fixture pronta pra conferir, sem precisar
de teste novo com o Bruno): rodar `onWhatsApp('556196863171@s.whatsapp.net')`
numa instância conectada (dd8ab522 ou 4e6f7ba0) e inspecionar o campo
`.lid` do resultado confirmaria OU refutaria que esse contato já está
marcado como identidade LID do lado do Baileys/WhatsApp para NÓS também —
não precisa de mensagem nova, é uma chamada de leitura na sessão já
conectada. Não fiz essa chamada nesta rodada (evitar tocar sessão real sem
pedido explícito) — registrado como o PRÓXIMO passo concreto, com o
comando exato acima, em vez de pedir outro teste ao Bruno.

**Proposta de melhoria mínima, não implementada** (fora do escopo desta
correção, registrada pra autorização separada): guardar o `.lid` que
`onWhatsApp()` já devolve de graça, associado ao contato/wa_id — isso
tornaria os `264003100127452@lid` que aparecem nos logs de retry
RASTREÁVEIS de volta a um número de telefone conhecido, em vez de ficarem
como um identificador opaco. Não mexe em `sendToAll`, cache de dispositivo
nem versão do pacote.

**O que continua em aberto, delimitado**: por que a mensagem 393 (2043)
precisou de um retry de dispositivo específico (`:27`) antes dos dois
`sendToAll`, enquanto a 398 (6019) foi direto pro `sendToAll` — isso
depende de COMO o WhatsApp decide notificar cada dispositivo do
destinatário, informação que não existe no código Baileys nem nos nossos
logs (achado já registrado: índice de device não tem significado conhecido
no código instalado). Não dá pra reproduzir isso com fixture local — exigiria
uma captura de protocolo do lado do destinatário, que não temos.

## 4. Texto de limites de disparo — mantido como não reproduzido

Sem nova investigação nesta rodada, conforme pedido — registrado como
discrepância visual NÃO reproduzida a partir da leitura de código local;
não conclui cache antigo nem inexistência do problema. Nenhuma alteração
de regra comercial.

## Validação

`npm test` 136/136 (124 anteriores + 8 de `useRolagemThread` + 5 de
`classificarConflitoSessao` — o teste de conteúdo/wa_id do commit anterior
já contava nos 124) · `npm run typecheck` 0 erros · `npm run lint`
(ConversaCentro.tsx + useRolagemThread.ts) 0 erros · `npm run build
--workspace apps/web` OK. Sem publicação, sem push.
