# Retorno ao Astra — entrega por dispositivo, rolagem e incidente 2537, 09/09/2026

Responde a `RECADO-CRM-ENTREGA-POR-DISPOSITIVO-ROLAGEM-2537-2026-09-09.md`.
Investigação em `brs-alvoconsig-dispositivo-rolagem` (branch
`crm/dispositivo-rolagem-2537`, sobre `main` em `806ac09`). Frentes 1 e 3
são só leitura (Railway + Supabase + código instalado); frente 2 (rolagem)
tem código, commit `fcc2002`, ainda **local, sem publicação**. Nenhuma
mensagem real enviada, nenhuma sessão tocada, nenhum QR novo.

## 1. Entrega por dispositivo — Web legível, celular aguardando

### IDs localizados

| Remetente | wa_id | chatwoot_message_id | conversa | Horário (UTC) |
|---|---|---|---|---|
| 2043 (dd8ab522) → Bruno | `3EB060CAC42446A877F140` | 393 | 22 | criado 23:41:38.49 |
| 6019 (4e6f7ba0) → Bruno | `3EB093677716E7AB11774F` | 398 | 10 | criado 23:47:33.42 |

Confirmados por conteúdo/ID, não só por minuto — batem com as janelas que
vocês reportaram (20:41/20:43 e 20:46/20:47 Brasília).

### Sequência real (instrumentação publicada, `806ac09`)

**2043 → Bruno (msg 393):** 3 pedidos de recuperação do protocolo,
todos com `getMessage` encontrando o conteúdo em cache:

1. **23:41:47.067 UTC** (timestamp Railway; `t=0` de referência) —
   `participant: "264003100127452:27@lid"` (JID **com sufixo de
   dispositivo**, `:27`), `sendToAll: false` — retry de UM dispositivo
   específico.
2. **t+520ms** — `participant: "264003100127452@lid"` (**sem sufixo**),
   `sendToAll: true` — retry pra todos os dispositivos.
3. **t+2686ms** — mesmo padrão do (2), `sendToAll: true` de novo.

Ack "entregue" registrado em **t+1895ms**, entre o 2º e o 3º pedido. Mais
tarde, em **t+132794ms (~2min13s depois)**, chegou OUTRO ack pro MESMO
wa_id com status **"enviado"** — rank mais baixo que "entregue", nossa
função de status ignorou a escrita (não regride), mas o evento bruto do
protocolo mostra uma inversão de ordem entre acks. Um ack "enviado" pra um
wa_id DIFERENTE (`3EB06C381D083F4BAFFDDE`, outra mensagem, não
correlacionada a esta) chegou 105ms antes desse — registrado só pra não
confundir os dois na leitura do log bruto. Às 23:43:48.949 UTC (severity
`error`, sem campos sanitizados — não passou pelo nosso logger, igual
"Closing session") apareceu um `Decrypted message with closed session.`,
~200ms antes da resposta do Bruno (mensagem 394) chegar no CRM às
23:43:49.136 — provavelmente ligado à decifragem de UMA mensagem recebida
do celular dele, não necessariamente ao reenvio da 393; registrado como
observação, não como causa.

**6019 → Bruno (msg 398):** só 1 pedido de recuperação, direto com
`sendToAll: true` (sem etapa de dispositivo específico antes) — ack
"entregue" às 23:47:34.6, retry às 23:47:35.4 (~700ms depois), `getMessage`
encontrado. Ack "enviado" (mesma inversão de ordem) chegou de novo ~2 min
depois, às 23:49:25.7 UTC.

**Achado central:** as duas remetentes (2043 e 6019, contas/instâncias
diferentes) pediram recuperação para o **MESMO identificador LID**
(`264003100127452`), não pelo JID de telefone normal — confirma que esse
destinatário está endereçado por LID hoje, independente de qual instância
nossa fala com ele. A sequência da 2043 teve uma etapa a mais (retry de
1 dispositivo específico, `:27`, antes dos dois `sendToAll`); a da 6019 foi
direto pro `sendToAll`.

### Mecanismo confirmado no código instalado (Baileys 6.7.24)

- **Sem ramificação LID vs PN** na descoberta de dispositivos — mesma
  consulta USync (`getUSyncDevices`, `messages-send.js`) pros dois casos;
  não existe mapeamento LID↔PN em nenhum lugar do pacote instalado
  (`Signal/`, `Utils/`, `WABinary/`) — a sessão Signal é endereçada só por
  `(user, device)`, o `server` do JID (`lid` ou `s.whatsapp.net`) é
  descartado nesse ponto.
- `sendToAll: true` força `useUserDevicesCache: false` — descarta o cache
  de 5 min e busca a lista de dispositivos atual do destinatário de novo,
  depois recifra e reenvia UMA mensagem Signal por dispositivo (sessão
  própria por device).
- Retry de `participant` específico (`sendToAll: false`) recifra e reenvia
  SÓ pra aquele device — explica por que a 1ª tentativa da 2043
  (`:27`) foi mais restrita que as duas seguintes.
- **O índice do dispositivo (`:27`) não tem significado conhecido no
  código** — não há heurística nem tabela que diga "device 0/sem sufixo =
  celular principal". Não dá pra provar, só pelo índice, qual dispositivo
  é fisicamente o celular do Bruno versus um companion/Web.

### Hipótese sustentada (não provada) e limite explícito

O mecanismo é COMPATÍVEL com "cada dispositivo do destinatário tem sua
própria sessão Signal, e um deles (possivelmente o celular) precisa de
mais rodadas de retry pra decifrar, enquanto outro decifra rápido" — mas
isso é uma hipótese sustentada pelo código, não uma prova: não temos como
identificar, do lado do Baileys, qual JID de device é fisicamente qual
aparelho. `sendMessagesAgain` (Baileys) não loga nada depois de
`relayMessage` completar — não é possível provar que o 2º ou 3º reenvio
chegaram/foram decifrados só pelos nossos logs; a única confirmação real
de legibilidade é a observação humana do Bruno (registrada separadamente:
mensagem 385/22 legível às 17:06 UTC, ~3 min de atraso). "Closing session"
e a ausência de "lido" continuam fora de qualquer alegação de causa
comprovada, como já corrigido.

## 2. Rolagem — corrigida, local, aguardando revisão

Commit `fcc2002` (mesma branch), arquivo
`apps/web/src/components/crm/atendimento/ConversaCentro.tsx`. Layout
effect central classificando cada mudança do thread pela CHAVE do 1º/
último item (não só pelo tamanho, que cresce tanto em append quanto em
prepend): 1ª carga vai pro fim; histórico prepend preserva a âncora visual
(scrollHeight/scrollTop capturados ANTES do fetch); mensagem nova no fim
só acompanha se o operador estava a ≤96px do fim, senão mostra botão
flutuante "Novas mensagens" com contador; envio próprio e ação otimista
(assumir/transferir) sempre acompanham; mídia tardia só reforça o
acompanhamento se já estava no fim; ack sem mudar a chave do último item
não dispara nada.

**Validação:** typecheck e build limpos. Sem harness de componente React
neste repo e sem credencial de navegador pro app real (limitação já
registrada em rodadas anteriores) — validei o MECANISMO (mesmo algoritmo e
limiar de 96px) num harness HTML isolado, dirigido por Playwright num
navegador real de verdade: os 8 cenários do recado (1ª abertura, mensagem
no fim seguindo, histórico lido preservando posição+contador, clique no
botão indo pro fim, paginação com âncora exata — conferi que o delta de
`scrollTop` bate exatamente com o delta de altura adicionada —, mídia
tardia seguindo só quando no fim, envio próprio sempre seguindo, troca de
conversa resetando tudo, e ack sem chave nova não disparando rolagem)
passaram. **Isto não substitui a validação visual do app real** — seria
preciso login de navegador pra isso, mesma lacuna de sempre.

## 3. Instância 2537 — "sessão substituída" não comprova novo pareamento

`ultimo_erro` gravado às 21:12:21 UTC (bem antes dos testes de dispositivo
acima — evento SEPARADO, não relacionado). Log real do fechamento
(mesmo deployment `b4d42a41`, mesmo PID 24, mesmo hostname — não há
sobreposição de deploy/worker/réplica nesse horário):

```
message: "Stream Errored (conflict)"
codigo (statusCode): 401   <-- NÃO é 440 (DisconnectReason.connectionReplaced)
data.content: [{ tag: "conflict", attrs: { type: "device_removed" } }]
```

**Achado confirmado, não hipótese:** `sessaoSubstituida` em `baileys.ts`
aceita `codigo === connectionReplaced (440)` OU um match de texto genérico
(`detalhe.includes('conflict')`). Neste caso real, o código foi **401**, e
só bateu pelo branch de TEXTO genérico — não pelo código explícito de
"sessão substituída por novo pareamento". O tipo real do conflito
(`device_removed`) é uma categoria DIFERENTE de "outro aparelho pareado
com o mesmo QR/sessão" — é o WhatsApp removendo esse dispositivo
vinculado (limite de dispositivos vinculados, remoção manual nos
"Aparelhos conectados" do WhatsApp do Bruno, ou decisão do servidor),
sem relação necessária com Bruno ter escaneado um QR novo. A mensagem que
mostramos pro Bruno ("Sessão substituída — o mesmo número foi conectado
em outro aparelho/instância") **não está provada por este evento** — é
uma classificação textual genérica demais pro que realmente aconteceu.

Nenhuma ação tomada (sessão preservada, sem QR novo, sem logout forçado).
Não implementei correção do código de classificação nesta rodada — o
recado desta frente pediu investigação/correlação, não uma correção; fica
registrado como candidato a ajuste separado (distinguir `device_removed`
de um conflito de sessão substituída de verdade), pra autorizarem depois
se fizer sentido.

## Observação adicional — texto da tela de configuração

Conferido: **não achei nenhum texto fixo/hardcoded** dizendo "mínimo de 2
números"/"6 templates" em JSX nesta worktree — a única ocorrência dessas
palavras é um COMENTÁRIO de código (não renderizado),
`apps/web/src/lib/crm/disparo.ts:38-39`, explicando um caso de borda. Os
dois textos que aparecem hoje na tela
(`apps/web/src/app/crm/configuracoes/whatsapp-nao-oficial/page.tsx:213` e
`:274`) vêm da MESMA fonte dinâmica
(`avisoRequisitosDisparo`/`avaliarRequisitosDisparo`,
`apps/web/src/lib/crm/disparo.ts:21-54`) — não são inconsistentes entre
si no código atual. "5 números/15 templates" não é constante fixa: vem de
`limitesDoParceiro()` (`disparo-shared.ts:56-59`), que lê
`crm_parceiro_config` por parceiro (o padrão do código é 3 números/3
templates cada, `DISPARO_MIN_INSTANCIAS`/`DISPARO_MIN_TEMPLATES_POR_INSTANCIA`,
`disparo.ts:11-12`) — 5×3=15 é a config ESPECÍFICA desse parceiro, não um
valor hardcoded. Se o "2/6" ainda aparece pra alguém, é candidato a cache
de build antigo no navegador, não um bug no código desta worktree — vale
conferir num reload forçado antes de investigar mais.

## Pendências

Aguardando revisão do `fcc2002` (rolagem) antes de publicar. Frentes 1 e 3
são só relatório nesta rodada — sem código pendente de aprovação além da
rolagem. A observação da tela de configuração não indicou bug — nada
pendente aí.
