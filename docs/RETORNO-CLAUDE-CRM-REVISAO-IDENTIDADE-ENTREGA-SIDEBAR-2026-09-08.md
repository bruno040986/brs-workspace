# Retorno ao Astra — rodada 2 (identidade/entrega) + sidebar isolada, 08/09/2026

Responde a `REVISAO-IDENTIDADE-ENTREGA-SIDEBAR-2026-09-08.md`. **Sem
migration, sem flag, sem deploy, sem replay real.** Nenhuma das duas
frentes foi publicada — aguardando aprovação.

## Sidebar — isolada como pedido

Novo worktree/branch **`brs-alvoconsig-sidebar-recolhivel` /
`crm/sidebar-recolhivel`**, criado a partir da `main` atual (`7175672`,
mesmo commit que `origin/main`). `git cherry-pick 75c9995` sem conflito —
diff idêntico ao commit original (`apps/web/src/components/crm/{CrmShell,
PersonalizacaoMenu,Sidebar}.tsx`, 3 arquivos, +122/-37), confirmado por
`diff` entre os dois `git show`. `npm install`, `npx tsc --noEmit -p
apps/web` (0 erros) e `npm run build --workspace apps/web` (OK) repetidos
nesse worktree isolado, não só herdados do lote anterior. Continua
dependendo de validação visual autenticada (expandir/recolher, foco/
tooltip, Personalização, largura pequena, sem rolagem horizontal, com
conversa selecionada/rascunho/gravação) — não tenho login de CRM disponível
aqui, mesma limitação já registrada nas rodadas anteriores.

A branch `crm/identidade-lid-entrega` (worktree
`brs-alvoconsig-identidade-df3`) **continua com os 4 commits** (o da sidebar
incluso, sem remover) — a isolada é uma cópia via cherry-pick pra publicação
independente, não uma extração/remoção da branch original.

## P1 — duplicidade sob concorrência: corrigido o cenário reproduzido

Implementada a trava em memória por `${instId}:${waId}` em
`espelharMensagemNaConversa` (bridge.ts) — chamadas concorrentes com a
mesma chave compartilham a mesma promessa em vez de cada uma ver
`mapaPorWaId` vazio. Funciona porque o registro na trava acontece ANTES do
primeiro `await` da função, então `Promise.all([f(), f()])` (o padrão
exato reproduzido pela revisão) já encontra a entrada da primeira chamada
ao avaliar a segunda. Reproduzi o teste da revisão (`Promise.all` com mesma
instância/conversa/idMsg) e agora dá `enviarMensagem=1`.

**Limite mantido explícito no código e aqui**: é proteção só DENTRO DO
PROCESSO — não entre processos, não sobrevive a reinício. Fechar o resíduo
que sobra (envio bem-sucedido + falha ao GRAVAR o mapa + reentrega
SEQUENCIAL, fora da janela de concorrência) exigiria reivindicar a linha do
mapa por INSERT antes do envio, com conflito atômico do Postgres — hoje
impossível sem `chatwoot_message_id` aceitar NULL em
`chat_mensagens_mapa`. **Não apliquei migration nenhuma.** Fica registrado
aqui como proposta a avaliar (schema: permitir uma linha "reivindicada,
ainda sem chatwoot_message_id" antes do envio, promovida a "completa"
depois) — decisão de vocês se/quando seguir, migration só sai do
brs-workspace.

Enquanto isso, `gravarMapaComRetentativa` (3 tentativas, backoff curto)
reduz a janela de falha transitória sem fechá-la. Rastreabilidade: quando a
consulta de dedupe falha e seguimos sem confirmar, ou quando a gravação do
mapa falha em todas as tentativas, isso vira um campo explícito no evento
(`dedupe_consulta_indisponivel` / `dedupe_registro_incerto`) — nunca fica
escondido atrás de um evento "normal". Nunca descarto a entrada por causa
da checagem (consulta ou gravação falhando não impede a entrega).

Testes novos (`bridge-mensagem-duplicada.test.ts`): concorrência real via
`Promise.all` (1 envio); isolamento entre instâncias diferentes com o
MESMO wa_id (nunca compartilham a trava — testado explicitamente);
gravação do mapa falhando 2x e recuperando na 3ª tentativa; gravação
falhando em TODAS as tentativas (mensagem entregue mesmo assim, mas
marcada como vulnerável a duplicar numa reentrega futura — o teste
documenta a limitação, não finge que ela não existe).

## P1 — getMessage: corrigido o cenário de reconexão reproduzido

Cache de conteúdo enviado movido de "por socket" (dentro de
`conectarInterno`) pra "por instância" (`cachesMensagensPorInstancia`,
módulo `baileys.ts`) — sobrevive a QUALQUER reconexão dentro do MESMO
processo: rede caindo e voltando, `conectar(instId,{reiniciar:true})`
explícito, ou o handler de `close` reconectando com backoff. Reproduzi o
cenário da revisão (conectar → enviar → reconectar → getMessage do ID
enviado) e agora devolve o conteúdo original, não mais `undefined`.

Limpo explicitamente nos dois pontos onde a credencial é descartada
(`salvarSessao(instId, null)`: logout explícito e badSession/deslogado) —
reparelhamento é outra identidade WhatsApp, cache antigo não serve pra
retry dela nem deveria acumular indefinidamente.

**Limite mantido explícito**: não sobrevive a reinício do PROCESSO (deploy,
crash) — precisaria persistir o conteúdo da mensagem em algo durável e
recuperável por wa_id, que não existe hoje (`chat_mensagens_mapa` só guarda
IDs, nunca o proto/conteúdo). Fica como proposta pendente também — mesma
regra de schema/migration. Homologação com provedor real (WhatsApp de
verdade) continua pendente; os testes provam que o cache sobrevive à troca
de socket no protocolo simulado, não o comportamento real do WhatsApp ao
receber o reencaminhamento.

Testes novos (`baileys-lid-envio.test.ts`, `@whiskeysockets/baileys`
mockado): sobrevive à reconexão (o cenário exato reproduzido); logout
explícito limpa o cache; isolamento entre instâncias (cache de uma nunca
aparece pra outra); limite de retenção de 256 (a mais antiga sai quando a
257ª entra).

## Identidade LID/telefone — não afirmo que está resolvida

Reescrevi o comentário em `bridge.ts` (`inboundBaileys`) pra enumerar os 4
campos de alias que existem no Baileys 6.7.24 instalado (`senderPn`/
`senderLid`/`participantPn`/`participantLid` — `WAMessageKey`,
Types/Message.d.ts) e afirmar explicitamente que a correção de LID no envio
(pular `onWhatsApp` pra destino `@lid`) **não resolve** a separação de
conversas relatada — só evita o erro de "número inexistente" ao enviar. Sem
mapa confiável de protocolo pra LID↔telefone (procurado e não encontrado no
pacote), a identidade continua opaca, sem mesclagem nem invenção. Nenhuma
mudança de comportamento aqui — só o comentário, que antes dava a entender
mais do que o código realmente cobre.

## Incidente 7033

Corrigido o comentário que citava "405/badSession": conferido em
`node_modules/@whiskeysockets/baileys/lib/Types/index.js` — o enum
`DisconnectReason` não tem 405 em lugar nenhum; a constante usada no código
e nos testes é `badSession=500`. Comentário agora também deixa explícito
que o log novo NÃO recupera a sessão perdida nem prova a causa do incidente
passado — só evita repetir o mesmo vazio de diagnóstico numa próxima
ocorrência. Nenhuma mudança de comportamento além do texto do comentário
(o log do erro bruto já estava certo desde a rodada 1; só a explicação
estava com um número errado).

## Validação

| Comando | Resultado |
|---|---|
| `npm test` (branch identidade-lid-entrega) | 99/99 (95 da rodada 1 + 9 novos: 5 de duplicidade, 4 de getMessage) |
| `npm run typecheck` (services/engine) | 0 erros |
| `npm run typecheck` / `npm run build` (sidebar isolada, worktree próprio) | 0 erros / OK |

Não repeti build do engine nem homologação com provedor real WhatsApp
nesta rodada — as duas limitações de schema (dedupe durável e cache
persistente) ficam registradas como propostas, não aplicadas, aguardando
decisão de vocês sobre seguir ou não com a migration no brs-workspace.
