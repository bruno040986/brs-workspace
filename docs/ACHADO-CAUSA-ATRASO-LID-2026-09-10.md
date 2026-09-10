# Achado (Opus) — causa mecânica do atraso: duas identidades Signal para o mesmo aparelho

**Status: hipótese com cadeia causal completa no código instalado + dado
real de produção. Falta UM teste controlado para virar causa comprovada
(descrito no fim). Nenhuma mudança de envio feita.**

## A cadeia, com citação

1. `resolverDestinoBaileys` (baileys.ts) resolve o destino como **PN**
   (`556196863171@s.whatsapp.net`) — o `.lid` que vem na mesma resposta
   era descartado.
2. `relayMessage` (`Socket/messages-send.js:412`) monta o JID de CADA
   dispositivo com o server do DESTINO:
   `jidEncode(user, isLid ? 'lid' : 's.whatsapp.net', device)`.
   Como mandamos PN, `isLid=false` → todos os devices viram
   `556196863171:<device>@s.whatsapp.net`.
3. `assertSessions(allJids)` → `jidToSignalProtocolAddress`
   (`Signal/libsignal.js:78-81`):
   ```js
   const { user, device } = jidDecode(jid)
   return new libsignal.ProtocolAddress(user, device || 0)
   ```
   **O `server` é DESCARTADO.** O endereço Signal é só `(user, device)`.

**Consequência**: para o MESMO aparelho físico existem dois endereços de
sessão distintos — `556196863171.27` (quando falamos por PN) e
`264003100127452.27` (quando o protocolo fala por LID). São dois
registros de sessão, com chaves diferentes.

4. O aparelho que se identifica por LID recebe um texto cifrado sob a
   sessão PN, não decifra, e pede retry — e o pedido chega endereçado por
   LID (`participant: 264003100127452:27@lid`, exatamente o que a
   instrumentação publicada registrou em 09/09).
5. `sendMessagesAgain` faz `assertSessions([participant], true)` (força
   sessão nova, agora no espaço LID) e reenvia com
   `relayMessage(key.remoteJid, ...)` onde `key.remoteJid` é o LID →
   agora `isLid=true` e o reenvio sai no espaço de endereço certo. Só
   então o aparelho decifra.

Isso explica exatamente o sintoma: **entregue rápido** (o servidor aceitou
a mensagem: ack `entregue` às 17:03:18) e **legível minutos depois**
(17:06, após o 3º pedido de retry) — e explica por que o WhatsApp Web
mostra na hora: é outro dispositivo, com sessão própria, que decifrou de
primeira.

## Dado real que sustenta (não é só teoria)

A duplicação de identidade já está visível no nosso banco. Para o MESMO
contato, cada instância tem um PAR de conversas Chatwoot separadas:

| Instância | Conversa sob PN | Conversa sob LID |
|---|---|---|
| 2043 | 22 | 24 |
| 6019 | 10 | 7 |
| 4934 | 21 | 23 |
| 1641 | 23 | 1 |

(`chat_conversas`: 7 linhas sob `556196863171@s.whatsapp.net`, 8 sob
`264003100127452@lid`, mais 2 sob `5561996863171@…` — a ambiguidade do
nono dígito, problema conhecido e separado.)

Ou seja: o mesmo contato é tratado como dois contatos, em dois espaços de
endereço, tanto no Signal quanto na nossa camada de conversas. **Isso é
impacto de atendimento hoje**, independente do atraso: resposta do
operador e mensagem do cliente podem cair em conversas diferentes.

## O que isto NÃO prova

Não provei qual dispositivo físico é o `:27`, nem que o WhatsApp Web
esteja no espaço PN — o protocolo não expõe isso ao Baileys (índice de
device não tem semântica conhecida). A cadeia acima explica o mecanismo;
a atribuição "device X = celular" continua fora do alcance.

## Teste que fecharia (precisa de autorização — muda o envio)

Enviar UMA mensagem endereçando o destino pelo **LID** em vez do PN
(`sock.sendMessage('264003100127452@lid', …)`, caminho já suportado
nativamente pelo Baileys — inclusive já usado hoje quando a conversa
nasce por LID) e medir: se ficar legível no celular imediatamente, sem
pedido de retry nos logs, a causa está comprovada.

Custo/risco: uma mensagem real, numa conversa de teste do próprio Bruno,
sem mudar código de produção (dá para fazer pela rota autenticada
existente de envio, escolhendo o JID). Reversível: é só uma mensagem.

**Não fiz** — muda o comportamento de envio, e a orientação vigente é não
trocar PN por LID sem hipótese e teste específicos. Agora existe a
hipótese específica; falta o "pode".

## Encaminhamento se confirmar

Não é "trocar para LID em todo lugar". O alias (commit `eb510a8`, worktree
`brs-alvoconsig-alias-lid`) é o pré-requisito: com telefone e LID
correlacionados por instância, dá para (a) endereçar o envio pelo espaço
em que o contato já está ativo e (b) parar de criar conversa duplicada.
Ambos exigem decisão de arquitetura própria — Fable.
