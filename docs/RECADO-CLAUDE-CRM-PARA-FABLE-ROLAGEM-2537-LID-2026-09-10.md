# Recado ao Fable — revisão pendente: rolagem, incidente 2537, leitura do LID

**Contexto da troca de revisor:** Astra (coordenador GPT-5 via Codex) ficou
sem créditos em 09-10/09/2026 (reset previsto 14/09). Bruno pediu que o
Fable assuma a revisão deste lote enquanto isso — as três revisões
anteriores foram do Astra; esta é a primeira para o Fable, então este
recado é propositalmente completo, sem presumir leitura de conversas
anteriores.

## Onde está o código

Repo `brs-alvoconsig`, worktree
`brs-alvoconsig-dispositivo-rolagem`, branch `crm/dispositivo-rolagem-2537`,
partindo de `main` em `806ac09` (já publicado em produção — engine no
Railway, deployment `b4d42a41`). **Nenhum destes 6 commits foi publicado
ainda.** `npm test` 143/143 · `npm run typecheck` 0 erros · `npm run lint`
(arquivos tocados) 0 erros · `npm run build --workspace apps/web` OK —
todos re-verificados agora, antes deste recado.

```
git log --oneline main..HEAD
50d809f LID: rota de leitura autorizada (onWhatsApp) pra correlacionar com os retries
4b889d8 2537 rodada 2: evidência estruturada examinada ANTES do código/texto, mensagem curta
84e103d Rodada 3: âncora de histórico por elemento, prepend+append no mesmo commit
7bc4f2e 2537: classifica conflito de sessão por código+tipo estruturado, não só texto genérico
c56f541 Rodada 2: rolagem cobre áudio/anexo, corrida com Realtime e âncora de histórico obsoleta
fcc2002 Atendimento: rolagem acompanha mensagem nova, preserva histórico e âncora paginação
```

Diff total contra `main`: 10 arquivos, +1528/-89 (`git diff --stat
main..HEAD`) — `apps/web/src/components/crm/atendimento/ConversaCentro.tsx`,
`useRolagemThread.ts` (novo), `useRolagemThread.test.ts` (novo),
`services/engine/src/baileys.ts`, `server.ts`,
`baileys-conflito-sessao.test.ts` (novo),
`baileys-onwhatsapp-lid.test.ts` (novo), `durable-ingressos.test.ts`
(1 linha), `package.json`/`package-lock.json` (adiciona `jsdom`/`@types/jsdom`
como devDependency de `apps/web`).

## Origem: por que este lote existe

Investigação de uma ocorrência real de "Aguardando mensagem…" no WhatsApp
de um contato (2043 e 6019, duas instâncias/números da mesma conta/tenant
DF3) — mensagem chega instantânea no WhatsApp Web do destinatário, mas
fica "Aguardando"/"Carregando" no celular por minutos. Um lote anterior
(fora deste, já publicado em `806ac09`) instrumentou o processamento de
retry do próprio protocolo Baileys (início/erro/abandono do reenvio,
correlacionado por instância+wa_id) sem habilitar log bruto nem registrar
conteúdo/chave — isso já está em produção e funcionando.

Bruno pediu três frentes de continuação (recado original do Astra,
`RECADO-CRM-ENTREGA-POR-DISPOSITIVO-ROLAGEM-2537-2026-09-09.md`, neste
mesmo repo de docs): (1) por que a entrega difere por dispositivo do
destinatário; (2) a tela de Atendimento não rola sozinha quando chega
mensagem nova; (3) uma instância (2537/número final, `906d9c33` internamente)
caiu com uma mensagem que dava a entender pareamento por outro aparelho,
sem prova disso. As frentes (2) e (3) tiveram código corrigido nesta
worktree, com 3 rodadas de revisão do Astra (cada rodada reproduziu um
bug real com o código de verdade, não hipotético) até chegar no estado
atual. A frente (1) segue investigação, sem causa raiz provada — resumo
mais abaixo.

## 1. Rolagem do Atendimento (apps/web)

**Sintoma original**: `ConversaCentro.tsx` (a tela de conversa individual
do Atendimento) não rolava pro fim quando chegava mensagem nova — nem
por poll nem por Realtime.

**Arquitetura da correção**: toda a lógica de rolagem foi extraída pra um
hook próprio, `useRolagemThread.ts` (`apps/web/src/components/crm/atendimento/`),
sem NENHUMA dependência de Server Actions, Supabase ou Realtime — só
recebe a lista já renderizada (`thread`) e uma função de chave estável por
item. Isso foi decisão de arquitetura pra viabilizar teste automatizado
real (ver seção de testes abaixo), não só separação de responsabilidade.

Comportamento final (depois das 3 rodadas):

- **1ª abertura da conversa**: rola pro fim assim que o thread ganha
  conteúdo pela primeira vez.
- **Mensagem nova no fim** (poll ou Realtime): só acompanha se o operador
  estava a ≤96px do fim do scroll; senão, mostra um contador "Novas
  mensagens" (botão flutuante) sem puxar a tela. O contador soma só os
  itens genuinamente novos no fim — nunca conta histórico paginado.
- **Envio próprio do operador** (texto, nota, áudio, anexo pequeno, anexo
  grande via ticket, ação otimista de assumir/transferir atendimento):
  SEMPRE rola pro fim, incondicionalmente — mesmo se o Realtime já tiver
  entregue a mesma mensagem enquanto a Server Action ainda estava
  pendente (uma corrida real: nesse caso o `thread` já não muda mais
  quando a Server Action do próprio operador resolve, então um efeito
  keyed só em `thread` não dispararia de novo — resolvido com um contador
  dedicado, `pedidoIrParaFim`, que dispara um efeito próprio incondicional).
- **Histórico antigo** (botão "Carregar histórico", pagina pra trás):
  preserva a posição visual do operador — ele continua vendo o MESMO
  conteúdo que estava lendo, só que agora com mais itens acima. Implementado
  ancorando num ELEMENTO específico do thread (o que era o 1º item antes
  do prepend, identificado por uma chave estável + `offsetTop`), não por
  delta de altura total do container — importante porque um prepend de
  histórico e uma mensagem nova no FIM podem acontecer no mesmo commit
  React, e só a altura ACIMA do elemento ancorado deveria contar pra
  compensação (a 2ª rodada de revisão usava delta de altura total, o que
  incluía por engano a altura de qualquer item novo acrescentado embaixo).
- **Resposta de histórico não-vazia mas inteiramente sobreposta** ao que
  já existe (paginação retornando itens já carregados): não arma âncora
  nenhuma — evita uma âncora "pendurada" que um prepend FUTURO real
  consumiria por engano.
- **Mídia (imagem/áudio) que termina de carregar depois do texto**: só
  reforça o acompanhamento (rola mais um pouco) se o operador já estava
  no fim.
- **Ack de status numa mensagem existente** (ex.: enviado→entregue) não
  dispara rolagem nem conta como mensagem nova — só muda o CONTEÚDO do
  item, não sua chave.

**Validação**: `apps/web` (Next.js) não é um pacote ESM
(`package.json` sem `"type": "module"`) — descobri isso tentando mockar
os módulos do componente inteiro (Server Actions, Supabase) com
`mock.module` do Node, igual já se faz no engine; funciona lá porque
`services/engine` declara `"type": "module"`, mas falha silenciosamente
em `apps/web` (reproduzido isolado, sem relação com React). Converter
`apps/web` inteiro pra ESM só pra viabilizar isso seria mudança grande e
arriscada no toolchain do Next.js — fora de escopo. A saída foi extrair o
hook (zero dependência externa) e testá-lo de verdade: 9 testes em
`useRolagemThread.test.ts` rodam `react-dom/client` sobre `jsdom` (nova
devDependency), SEM nenhum mock — não precisa, o hook não faz I/O. jsdom
não calcula layout de verdade (`scrollHeight`/`clientHeight`/`offsetTop`
ficam 0 por padrão); cada teste sobrescreve essas dimensões manualmente
pra simular o que um browser já teria calculado no momento exato em que
o layout effect roda — inclusive um teste que sobrescreve temporariamente
o protótipo de `HTMLElement` pra provar a invariante da 1ª renderização
com overflow real disponível desde o início (não só por acidente de
altura zero).

**O que NÃO está coberto por teste automatizado**: se `enviar`/
`enviarAnexo`/`confirmarAudio`/`alterarResponsavel` (as funções reais do
componente, em `ConversaCentro.tsx`) de fato CHAMAM o hook
corretamente — isso é 1 linha por função, verificado por leitura de
código nesta entrega, não por teste (testar isso precisaria simular
Server Actions, a mesma parede do CJS acima). Homologação visual
autenticada no navegador real segue pendente — sem credencial de
navegador disponível aqui, limitação já registrada em rodadas anteriores
deste projeto.

## 2. Instância 2537 (baileys.ts, engine)

**Sintoma**: a instância `906d9c33-...` (número terminado em 2537) caiu
com `ultimo_erro = "Sessão substituída — o mesmo número foi conectado em
outro aparelho/instância."` Log real do Railway mostrou o motivo bruto:
`statusCode 401`, `<conflict type="device_removed">` no stanza
`<stream:error>` que o WhatsApp mandou — uma categoria diferente de
"outro aparelho pareado" (que seria `DisconnectReason.connectionReplaced
= 440`).

**Causa do bug original**: `baileys.ts` classificava qualquer coisa com
"conflict" no TEXTO do erro (`detalhe.includes('conflict')`) OU código 440
como "sessão substituída" — sem examinar o node XML estruturado que o
próprio Baileys já anexa ao erro (`error.data.content`, confirmado lendo
`Utils/generics.js` e `Socket/socket.js` da versão instalada: o servidor
manda `code="401"` deliberadamente nesse caso, não é um 440 "disfarçado").

**Correção final** (depois de uma 2ª rodada de revisão que reproduziu
ainda outro bug): a função `classificarConflitoSessao` (nova, exportada
de `baileys.ts`) agora examina `error.data.content` PRIMEIRO e
INCONDICIONALMENTE — nunca depende de código ou texto pra sequer olhar
essa evidência (o bug da 1ª versão: calculava um "parece conflito?" via
código/texto ANTES de checar o node estruturado; um 401+device_removed
real com `.message` genérico tipo "unauthorized" — sem a palavra
"conflict" no texto — caía direto em `return null`, nunca examinando a
evidência estruturada disponível). Só cai no fallback texto/código quando
não há tipo estruturado reconhecido.

3 categorias resultantes:
- `sessao_substituida` (440, ou tipo estruturado `"replaced"`) — mensagem
  original mantida: "Sessão substituída — o mesmo número foi conectado em
  outro aparelho/instância. Leia o QR novamente."
- `dispositivo_desvinculado` (tipo estruturado `"device_removed"`) —
  mensagem curta e SEM causas especulativas (pedido explícito da revisão):
  "Dispositivo desvinculado pelo WhatsApp. O motivo não foi informado."
- `conflito_desconhecido` (código/texto bateram, sem tipo estruturado
  reconhecido) — "Sessão encerrada por conflito não identificado pelo
  WhatsApp. Leia o QR novamente."

**Nenhuma mudança de política de credencial/reconexão** — mesmo
comportamento de sempre (`status: desconectada`, reconexão automática
desativada, sessão preservada, sem QR/logout automático). 7 testes em
`baileys-conflito-sessao.test.ts` cobrem as 3 categorias, desconexão
normal (não classifica nada) e os dois cenários exatos que as revisões
reproduziram.

## 3. Mecanismo de leitura do LID (implementado, não executado)

Achado de uma investigação anterior (frente 1, ainda aberta): nosso
código (`resolverDestinoBaileys`) já recebe, na MESMA chamada
`sock.onWhatsApp(jid)` que usa pra resolver o destino de um envio, um
campo `lid` (o identificador LID do contato no WhatsApp) — mas descarta
esse campo, só lê `.jid`. Isso importa porque os logs de retry do
protocolo (já publicados em `806ac09`) mostram o destinatário sendo
endereçado por LID (`264003100127452@lid`), não pelo JID de telefone
normal — sem guardar essa correlação, não dá pra saber com confiança que
esse LID é o MESMO contato que aparece como
`556196863171@s.whatsapp.net` no nosso banco.

Bruno autorizou avançar com uma consulta de LEITURA (sem enviar
mensagem, sem reparelhar, sem expor token) usando "um mecanismo seguro já
disponível". Implementei:

- `consultarOnWhatsApp(instId, telefone)` (baileys.ts) — chama
  `sock.onWhatsApp(jid)` na sessão JÁ conectada, devolve `{jid, exists,
  lid}`.
- `GET /instancias/:id/onwhatsapp/:telefone` (server.ts) — protegida
  pelo MESMO Bearer (`config.apiToken`) que já protege toda a família
  `/instancias/*` existente; não é endpoint público novo, é mais uma
  rota na família já autenticada. Resposta limitada a `jid`/`exists`/`lid`.
- 4 testes (`baileys-onwhatsapp-lid.test.ts`): expõe `lid` quando
  presente; `lid: null` quando ausente (sem inventar valor); número sem
  WhatsApp não lança erro (é consulta, não envio); instância não
  conectada lança erro explícito.

**Não executei a consulta real ainda** — chamar essa rota contra a
sessão viva da 2043/6019 exige publicar este código no Railway primeiro,
um passo maior que qualquer coisa feita nesta investigação até agora
(que foi só leitura de logs/banco). Não decidi isso sozinho. Mesmo depois
de confirmado, isso ajuda RASTREABILIDADE (saber que aquele LID nos logs
é este contato) — não prova a causa da demora de entrega no celular.

## O que continua em aberto (fora do escopo deste lote)

- **Causa raiz da demora "Aguardando mensagem"**: sem explicação
  definitiva. O que se sabe: o destinatário é endereçado por LID pro
  protocolo de retry; instâncias diferentes da mesma conta pedem retry
  pro mesmo LID; a sequência de retry (dispositivo específico vs "todos
  os dispositivos") difere entre uma ocorrência e outra sem causa
  identificada no código (o índice de dispositivo não tem significado
  conhecido no Baileys instalado).
- **Texto de limites de disparo** (tela de configuração mostrando "2
  números/6 templates" junto com "5 números/15 templates"): não
  reproduzido a partir da leitura de código local — os dois textos vêm
  da mesma fonte dinâmica no código atual. Registrado como discrepância
  visual não reproduzida, não como bug confirmado nem como inexistente.

## Pedido ao Fable

1. Revisar os 6 commits (código + testes) antes de autorizar publicação.
2. Se aprovado: mesma sequência de sempre — integrar na `main` atual
   (que já avançou desde `806ac09`? verificar antes), checks no resultado
   integrado em worktree isolada, publicar, confirmar SHA ativo no
   Railway e saúde das instâncias antes de qualquer teste com mensagem
   real.
3. Decisão em aberto: autorizar (ou não) o deploy necessário pra executar
   a consulta `onWhatsApp`/LID contra a sessão real da 2043/6019 — sem
   esse deploy, a correlação LID↔telefone continua só teórica.

Sem publicação, sem push, sem sessão tocada até aqui.
