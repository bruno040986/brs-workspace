# Revisão da implementação de performance — 24/09/2026

Resultado: **implementação parcial, com regressões; não aprovada como conclusão do plano** `plano-performance-chats-2026-09-23.md`.

Escopo: diff local do Workspace sobre HEAD `d0d5bd2`, incluindo arquivos novos não versionados. As alterações de performance estão sem commit. CRM local `../brs-alvoconsig` permanece limpo no commit `4eb69c3`, igual ao diagnóstico. Não houve alteração funcional nesta revisão nem medição autenticada em produção.

## Achados em ordem de prioridade

### P1 — Nova API bloqueada pelo proxy

`src/components/conversas/atendimento/useAtendimento.ts:274` chama `/api/conversas/bootstrap`, mas a rota não foi cadastrada em `src/lib/auth/permissions.ts`. A função `getRouteAccessDecision` retorna `deny`; o proxy converte isso em 403 antes do handler. Confirmação executada importando a função real: bootstrap → deny; `/api/chat/messages` → open.

O catch do hook, linha 284, volta às cinco actions e depois respostas rápidas. Assim, a principal melhoria de inicialização não entra em operação, e ainda acrescenta uma requisição fracassada. Corrigir a regra de acesso vinculada a `conversas`, mantendo autorização no handler. Testar atravessando o proxy, com e sem permissão; testar só o handler não detecta a falha.

### P1 — Histórico anterior ficou inacessível na interface

`src/lib/interno-chat/data.ts:269` e `src/app/api/chat/messages/route.ts` agora limitam às últimas 50 mensagens. Entretanto, `GoogleChatComponent.tsx:394` e `:714` apenas substituem o estado pelo retorno; não há carregamento de anteriores/cursor. `src/lib/interno-chat/actions.ts:30` sequer aceita os novos parâmetros de paginação.

Resultado: em conversas maiores, mensagens anteriores às últimas 50 deixam de estar acessíveis por esses fluxos da interface. Não foram apagadas do banco. Implementar paginação completa no contrato e UI, mesclagem e preservação da rolagem. O filtro `created_at < before` também deve usar desempate por ID: mensagens com timestamp igual na fronteira podem ser omitidas.

### P1 — Fila de leituras por Server Actions permanece na abertura

`useAtendimento.ts:328` trocou a action agregadora por chamadas separadas para mensagens, metadados e contato, mas essas continuam Server Actions. Lista e contadores também continuam assim. A primeira mensagem pode chegar antes dos acessórios, o que é positivo; porém, acessórios de uma conversa podem enfileirar e atrasar a próxima seleção.

A documentação instalada do Next, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md:206`, confirma despacho uma por vez no cliente. Migrar as leituras críticas para HTTP autorizado, com funções internas sem efeitos colaterais e controle de concorrência. Não basta corrigir somente o bootstrap.

### P2 — Confirmação de leitura virou tarefa sem garantia de término

`src/lib/interno-chat/data.ts:302` e GET de `/api/chat/messages` usam `void (async () => ...)()` para gravar `last_read_at`. A resposta pode terminar antes da escrita, sem mecanismo que mantenha a execução viva. Erros retornados pelo Supabase também não são verificados. O plano proibia explicitamente essa substituição por Promise solta.

Separar leitura de mensagens da confirmação explícita de visualização, com operação autenticada e erro tratado; não marcar leitura por GET/prefetch nem registrar como lidas mensagens que chegaram depois do recorte efetivamente exibido.

### P2 — Deduplicação por React.cache não resolve os novos handlers

`src/lib/auth/server.ts:31` afirma deduplicação por requisição HTTP, mas o contexto de cache do React não é universal em Route Handlers. O novo bootstrap continua chamando seis exports que repetem autorização e carregamento de conta. O runtime React instalado devolve a execução direta na ausência de dispatcher; uma reprodução isolada com `--conditions=react-server` executou duas vezes uma função cacheada chamada duas vezes fora da renderização.

Usar contexto explícito autorizado por requisição nos leitores internos. Não presumir que esse teste isolado é um benchmark do endpoint: ele demonstra por que a garantia declarada no comentário não é válida de forma geral.

### P2 — Validação e partes do plano continuam pendentes

- Não há novos testes no diff para autorização da rota, histórico/cursor, concorrência ou falha de mídia.
- Não foi encontrado relatório de medição antes/depois ou p50/p95 nos documentos de performance locais. `Server-Timing` foi adicionado em dois handlers, mas não comprova os tempos nem mede o proxy.
- O CRM local não recebeu alterações; não há evidência local de validação de seus tempos nesta entrega. Isso não prova ausência de trabalho em outro checkout ou em produção.
- Resumo interno continua varrendo até 2.000 mensagens; a agregação não foi implementada.
- Corrigiu-se retorno das Promises no polling, mas não a deduplicação entre polling, Realtime e abertura. Guarda por ID melhorou o atendimento; não cobre geração A→B→A, e o chat interno continua aplicando respostas sem verificar seleção atual.

## Melhorias válidas

- Assinatura em lote de caminhos únicos de anexos, preservando bucket privado.
- Callbacks de polling retornam Promises, permitindo que a trava local aguarde a operação.
- Mensagens do atendimento deixam de depender do resultado agregado de todos os acessórios.
- Verificação do ID selecionado antes de atualizar vários estados do atendimento.
- Instrumentação inicial por Server-Timing, útil após corrigir o acesso à nova API.

## Verificação executada

- `npm test`: 116 testes, 113 aprovados, 3 ignorados, zero falhas. A suíte existente não cobre as regressões descritas acima.
- `npx tsc --noEmit --incremental false`: concluído com sucesso, sem erros de tipos.
- Execução da função real de decisão de acesso: nova API retorna `deny`.
- Inspeção dos contratos, consumidores, proxy, diff e runtime React instalado.

## Ordem recomendada de conclusão

1. Corrigir acesso ao bootstrap e adicionar teste de integração com proxy.
2. Restaurar acesso ao histórico com cursor composto e interface de paginação.
3. Migrar leituras críticas, compartilhar contexto autorizado e descartar respostas obsoletas por geração.
4. Corrigir persistência/semântica de leitura e coordenação de requisições de fundo.
5. Testar regressões e medir os mesmos cenários autenticados antes/depois; só então aprovar performance e verificar o CRM.
