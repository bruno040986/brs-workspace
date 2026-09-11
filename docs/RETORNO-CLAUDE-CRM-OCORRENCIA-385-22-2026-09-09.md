# Retorno ao Astra — nova ocorrência (Chatwoot 385/conversa 22), 09/09/2026

Investigação só de leitura (Railway + Supabase). Nenhuma sessão tocada,
nenhum reenvio, nenhum reparelhamento.

## Commit ativo (confirmado antes de interpretar os logs)

Deployment `739bd041` (`SUCCESS`), commit `442d83d` — o merge de
publicação já reportado, com o `getMessage` do `dca438f`. **Não é** a
instrumentação nova do retry (`79a06e0`/`3587f4b`, ajustada após a revisão
de vocês) — essa continua só local, sem push. Portanto os logs abaixo só
têm o que a versão publicada já produzia: `getMessage` e os erros de ack
(nada de log de sucesso de ack, nada de "recv retry request"/"error in
sending message again" visível — isso é exatamente a lacuna que a
instrumentação pendente fecha, ainda não publicada).

## IDs localizados

`chat_mensagens_mapa`: `wa_id 3EB0B07A664ADE432CB679`, `instancia_id
dd8ab522-da61-46a2-a2db-2bf70860f6c0` (2043), `remote_jid
556196863171@s.whatsapp.net`, `from_me true`, **`chatwoot_message_id
385`**, **`chatwoot_conversation_id 22`**, `created_at 2026-09-09
17:03:15.789 UTC` — bate com o horário informado (14:03 Brasília).

## getMessage — 3 pedidos de recuperação, todos com conteúdo em cache

| Horário UTC | encontrado |
|---|---|
| 17:03:17.51 | true |
| 17:03:19.37 | true |
| 17:06:00.69 | true |

Nenhum outro pedido depois de 17:06 (conferido até 20:00 UTC). Cada
pedido veio seguido, no mesmo instante, do dump bruto do libsignal
"Closing session" — isso é a renovação de sessão que o próprio protocolo
faz antes de reenviar (`assertSessions`, achado ao ler o código instalado
na rodada anterior), não é tratado aqui como causa comprovada de nada.
Não temos, nesta versão publicada, visibilidade sobre se o reenvio
(`relayMessage`) depois de cada um desses 3 pedidos teve erro ou sucesso.

## Acknowledgement disponível

`chat_mensagem_status` pra `chatwoot_message_id 385`: status **`entregue`**
(DELIVERY_ACK), atualizado às **17:03:18.7 UTC** — entre o 1º e o 2º pedido
de recuperação. Consultado de novo agora: continua `entregue`, nunca
avançou pra `lido`. Como já registrado, `entregue`/SERVER_ACK/DELIVERY_ACK
não comprova texto legível no aparelho — e o fato de terem chegado um 2º e
um 3º pedido de recuperação DEPOIS desse ack (às 17:03:19 e 17:06:00) é,
na prática, evidência de que a mensagem continuava ilegível no celular
mesmo já "entregue" pro protocolo.

## Estabilidade da instância 2043 nesse intervalo

Sem nenhum evento de queda/reconexão pra `dd8ab522` (2043) entre 17:00 e
18:10 UTC — a instância ficou conectada o tempo todo. Duas OUTRAS
instâncias caíram e reconectaram nesse intervalo por "Connection
Terminated"/428 (`f7983f4d`/4934 às 17:05:30 UTC, e uma terceira,
`b20c4df9`, às 17:08:49 UTC) — registrado por transparência, mas sem
relação com esta conversa/wa_id: não é a mesma instância, não é a mesma
conta. Fica como observação separada, no mesmo espírito da queda da 6019
já tratada à parte.

## O que isso não prova

Não sabemos se a mensagem eventualmente ficou legível sem um 4º pedido de
recuperação, nem se o `relayMessage` de algum dos 3 reenvios teve erro —
essa é exatamente a lacuna que a instrumentação pendente (ainda local)
fecha. Esta é uma ocorrência NOVA e separada da anterior (wa_id
`3EB09AD2B9878C3BA2B127`, que Bruno confirmou ter ficado legível); não
estou generalizando estabilidade a partir de nenhuma das duas.

## Atualização — legibilidade confirmada (09/09/2026, após o Bruno acompanhar)

Bruno confirmou: a mensagem 385 ficou legível às **14:06 Brasília / 17:06
UTC**, cerca de 3 minutos depois do envio (17:03:15.789 UTC). Registrado
como **recuperação tardia** — não como recuperação normal nem como falha
sem solução: houve entrega eventual, mas fora do tempo adequado pra
atendimento.

O horário coincide com a 3ª e última consulta de `getMessage` (17:06:00.69
UTC) — mas essa coincidência **não comprova** que foi aquela tentativa
específica que resolveu. `getMessage` só prova que o conteúdo estava no
nosso cache no momento do pedido, não que o `relayMessage` daquele pedido
foi o que finalmente decifrou no aparelho; poderia ter sido essa tentativa,
uma renovação de sessão acumulada ao longo das 3, ou outro fator do lado
do aparelho não observável por este logger. A causa do atraso de ~3
minutos continua em investigação — nada aqui identifica uma causa raiz,
só o intervalo e a sequência de eventos observados.

Como já registrado: o cache nunca esteve vazio (`encontrado: true` nas 3
consultas) — falta de conteúdo no cache está descartada como explicação
desta ocorrência. O ack "entregue" às 17:03:18.7 UTC não comprovou
legibilidade (chegaram mais 2 pedidos de recuperação depois dele). A
ausência de "lido" na tabela de status, isoladamente, também não permite
concluir falha — o Chatwoot/nossa tabela de status não captura leitura
de retry tardio fora do fluxo normal de ack; a confirmação real veio do
Bruno observando o aparelho, não de um sinal do protocolo.

## Pendências

Causa do atraso de ~3 minutos nesta ocorrência: em investigação, sem
identificação de causa raiz até agora. A instrumentação corrigida (rodada
2, commit `3587f4b`) segue aguardando revisão do Bruno antes de publicar
— sem reenvio da mensagem 385 nem reconexão da instância 2043 enquanto
isso. Quando publicada, uma ocorrência como esta (3 pedidos de
recuperação pro mesmo wa_id, ~3 min de atraso) teria log explícito de
início/erro/abandono de cada reenvio, o que falta hoje — pode ajudar a
isolar em qual tentativa (ou se em nenhuma delas) a entrega de fato
completou.
