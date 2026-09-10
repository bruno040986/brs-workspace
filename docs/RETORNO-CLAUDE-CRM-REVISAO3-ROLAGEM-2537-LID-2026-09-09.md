# Retorno ao Astra — rodada 3: rolagem, 2537, mecanismo de leitura do LID

Responde a `REVISAO-C56F541-7BC4F2E-2026-09-09.md`. Worktree
`brs-alvoconsig-dispositivo-rolagem`, branch `crm/dispositivo-rolagem-2537`,
commits `84e103d` (rolagem), `4b889d8` (2537) e `50d809f` (mecanismo de
leitura do LID) — **todos locais, sem publicação.** Nenhuma sessão tocada,
nenhuma mensagem real, nenhum QR/logout automático.

## Rolagem — prepend+append no mesmo commit

Reproduzi com o hook real exatamente o cenário da revisão (m1,m2; operador
acima; armar âncora; render h1,m1,m2,m3 de uma vez): `novasNaoLidas`
ficava 0, deveria ser 1.

**Causa 1**: a branch de âncora do layout effect fazia `return` assim que
detectava o prepend — nunca chegava a checar se o ÚLTIMO item também tinha
mudado (o append no mesmo commit).

**Causa 2** (a mesma revisão apontou): a compensação usava
`scrollHeight` TOTAL antes/depois — isso inclui, por engano, a altura de
qualquer item novo acrescentado no FIM, que não deveria afetar a
compensação do prepend (só o que é inserido ACIMA do ponto ancorado
afeta a posição dele).

**Corrigido**: a âncora agora fica no ELEMENTO do 1º item anterior
(`data-chave-rolagem` + `offsetTop`), não na altura total do container —
o delta usado é só do PRÓPRIO elemento, imune a qualquer coisa que mude
abaixo dele. A branch de prepend não retorna mais cedo: mensagem(ns)
nova(s) no fim são contadas por POSIÇÃO relativa ao índice do último item
anterior dentro do thread ATUAL (localizado por `findIndex`, não pelo
tamanho total — que cresce tanto com prepend quanto com append e contaria
histórico paginado como se fosse mensagem nova).

`carregarHistorico` (ConversaCentro.tsx) só arma a âncora quando a
resposta tem item GENUINAMENTE novo (`some(m => !mensagens.some(atual =>
atual.id === m.id))`) — uma resposta não-vazia mas inteiramente sobreposta
não arma mais nada.

Precisão adicional pedida: novo teste força overflow real disponível já
no exato momento do 1º layout effect (sobrescrita temporária no protótipo
de `HTMLElement`, restaurada em seguida) — o teste antigo só provava
`scrollTop=0` por acidente de altura zero, não a invariante real.

9 testes no hook (todos passam), rodando o hook de verdade via
`react-dom/client` sobre jsdom.

## 2537 — evidência estruturada examinada incondicionalmente

Reproduzido: 401 real + `conflict type=device_removed`, mas `detalhe` sem
a palavra "conflict" (cenário plausível: `.message` de um Boom 401
qualquer, tipo "unauthorized") → `classificarConflitoSessao` retornava
`null`.

**Causa**: `pareceConflito` (código 440 ou texto) era calculado ANTES de
examinar `error.data.content` — a função nunca chegava a olhar a evidência
estruturada se esse gate textual não passasse primeiro.

**Corrigido**: `error.data.content` é examinado PRIMEIRO e
incondicionalmente — nunca depende de código/texto pra existir; só cai no
fallback código/texto quando não há tipo estruturado reconhecido.
Mensagem de `dispositivo_desvinculado` encurtada pra "Dispositivo
desvinculado pelo WhatsApp. O motivo não foi informado." (sem lista de
causas especulativas — isso fica só no log, não na UI). Mesmo
comportamento operacional preservado: nenhuma política de
credencial/reconexão alterada.

7 testes (5 anteriores + 2 novos reproduzindo o cenário exato), todos
passam.

## LID — mecanismo de leitura implementado, ainda não executado

Implementei o que a revisão autorizou: `consultarOnWhatsApp` (baileys.ts)
chama `sock.onWhatsApp(jid)` na sessão JÁ conectada e expõe `{jid, exists,
lid}` — o campo `lid` que a versão instalada já devolve, mas
`resolverDestinoBaileys` descarta (achado da rodada anterior). Rota nova
`GET /instancias/:id/onwhatsapp/:telefone`, protegida pelo MESMO Bearer
que já protege toda a família `/instancias/*` — não é endpoint público
novo, é mais uma rota na família já autenticada; resposta limitada a
`jid`/`exists`/`lid`, nunca credencial. 4 testes cobrem: expõe `lid`
quando presente; `lid: null` quando ausente (sem inventar valor); número
sem WhatsApp não lança erro (é consulta, não envio); instância não
conectada lança erro explícito.

**Não executei a consulta real ainda**: chamar essa rota contra a sessão
viva da 2043/6019 exige publicar este código no Railway primeiro — é um
passo de deploy, maior que qualquer coisa feita nesta investigação até
agora, e não decidi isso sozinho. Sem esse deploy+chamada, ainda não
temos o LID real pra comparar com o `264003100127452@lid` observado nos
retries. Fica como próximo passo explícito, pendente de autorização pra
publicar.

Registrado, como já indicado: mesmo com o LID confirmado, isso ajuda
rastreabilidade — não comprova a causa da recuperação tardia.

## Validação

`npm test` 143/143 (136 anteriores + 9 do hook de rolagem, ajuste de 2
pra 7 nos testes de 2537, +4 do mecanismo LID — números não somam
linearmente porque um teste antigo foi substituído, não só adicionado)
· `npm run typecheck` 0 erros · `npm run lint` (arquivos tocados) 0 erros
· `npm run build --workspace apps/web` OK. Sem publicação, sem push.

## Adendo 10/09/2026 — publicado e LID confirmado (revisão Fable)

- Revisão Fable encontrou e corrigiu um bug real antes de publicar: o
  contador de "novas mensagens" contava o thread inteiro quando o último
  item anterior SUMIA (aviso otimista de transferência substituído pela
  mensagem real). Corrigido por conjunto de chaves do render anterior
  (`3122172`), teste dedicado; 144/144.
- Publicado: `main` `806ac09` → `3122172` (fast-forward). Railway deployment
  `854713d7` SUCCESS. Boot: 2043, 6019, 1641, 4934, 4435, 5009 conectadas;
  2537 recebeu 401 sem nó de conflito → política pré-existente de
  "deslogada" (sessão limpa) — precisa de QR novo, esperado desde o
  `device_removed` de 09/09. 7033 não constava mais entre as sessões salvas.
- Consulta `GET /instancias/:id/onwhatsapp/556196863171` executada pelo
  Bruno (token do Railway), pelas duas instâncias: ambas devolveram
  `{"jid":"556196863171@s.whatsapp.net","exists":true,"lid":"264003100127452@lid"}`.
  **É o mesmo LID observado nos retries** — confirmado que o destinatário
  dos pedidos de recuperação é o celular pessoal do Bruno, endereçado por
  LID pelo WhatsApp, para a 2043 e para a 6019 igualmente. Isso fecha
  rastreabilidade; **não** explica a causa do atraso de entrega.
