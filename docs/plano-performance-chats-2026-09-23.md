# Diagnóstico e plano de correção — Workspace e Alvo Consig

Data: 23/09/2026. Workspace analisado: `69e3d35`. Alvo Consig local: `../brs-alvoconsig`, commit `4eb69c3` (aplicação em `apps/web`).

## Escopo e conclusão

Relato: navegação demora 9–15 segundos; abertura de conversa ultrapassa 10 segundos. A inspeção estática encontrou trabalho excessivo no caminho de leitura, fila potencial de Server Actions, histórico sem paginação explícita e consultas repetidas de autorização. São prioridades concretas de correção, mas não provam quantos segundos cada etapa consome em produção.

Não foram executados testes autenticados, HAR, consultas ao banco de produção ou inspeções da infraestrutura. Os commits locais podem diferir dos publicados. Não foram alterados código funcional, banco ou implantação. Este documento é o entregável da investigação enxuta.

## Evidências no Workspace

| Prioridade | Evidência verificável | Consequência |
| --- | --- | --- |
| P0 | `src/components/conversas/atendimento/useAtendimento.ts`, bootstrap perto da linha 263: cinco Server Actions dentro de `Promise.allSettled`, depois respostas rápidas; lista e contadores também usam actions. | Concorrência aparente no cliente pode virar fila. A documentação **instalada**, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md:206`, informa despacho de Server Functions uma por vez no cliente. Medir a fila no navegador; não atribuir automaticamente toda navegação a ela. |
| P0 | `src/lib/central-conversas/actions.ts:1145`, `getDadosConversaAberta`: espera seis operações em `Promise.all`; `useAtendimento.ts` só publica mensagens depois desse retorno. | Etiquetas, metadados e agendamentos atrasam a primeira mensagem visível. O paralelismo dentro do servidor existe, mas o resultado depende da operação mais lenta. |
| P0 | `src/lib/interno-chat/data.ts`, `listarMensagens`, e `src/app/api/chat/messages/route.ts`, GET: consulta ascendente sem `limit` nem cursor, seguida de assinatura individual de anexos e atualização de leitura aguardada. | Custo cresce com histórico/anexos. Pode haver truncamento pelo limite do backend: ausência de paginação não garante que todo histórico seja entregue, podendo inclusive omitir mensagens recentes. |
| P0 | `src/lib/polling-visivel.ts` aguarda `fn()` para impedir sobreposição; `useAtendimento.ts` e `src/app/(dashboard)/theme/GoogleChatComponent.tsx` passam callbacks com `void carregar...()`. | A Promise não chega ao controle `executando`; a proteção termina antes da requisição. Poll, retorno à aba e Realtime podem sobrepor trabalho. |
| P1 | `src/lib/auth/effectivePermissions.ts`: leitura de usuário, permissões individuais e, se houver perfil, permissões de perfil em sequência. `src/lib/auth/server.ts` não deduplica contexto. Actions agregadoras chamam outras actions que repetem autorização; `contaBrs()` também é repetida. | Vários percursos até Supabase para responder a uma interação. A proteção deve ser mantida, com reutilização de contexto dentro da requisição. |
| P1 | `src/lib/supabase/middleware.ts`, `src/proxy.ts`, layout do dashboard e página `/conversas`: verificações em camadas; layout usa `getUser()`, página usa `requirePermission()`. | Proxy antecede processamento; layout/página podem executar em paralelo e layouts podem ser reutilizados. Não somar tudo como cadeia fixa em toda navegação. O desvio de `/_next` não exclui requisições RSC à URL da página. |
| P1 | `listarCanais` em `src/lib/interno-chat/data.ts`: até 2.000 mensagens dos últimos 90 dias para calcular resumo/não lidas em memória. | Trabalho repetido e limite global que pode distorcer resumo/não lidas por conversa. |
| P1 | `useAtendimento.ts`, abertura e `carregarThread`: respostas atualizam mensagens sem validar se a seleção ainda é a mesma. | Ao alternar rapidamente, uma resposta antiga pode sobrescrever a conversa atual. Corrigir junto da concorrência. |
| P2 | `src/lib/central-conversas/chatwoot.ts:31`: timeout padrão de 20 s. `getConversas` dispara atribuição e higienização via `void`. | Dependência lenta pode segurar a abertura; tarefas não aguardadas não são prova de bloqueio direto, mas acrescentam carga e não têm garantia de execução durável. |

Já existem Realtime, polling condicionado à visibilidade, cache local de listas e agregação de abertura. Não recriar essas soluções sem corrigir suas limitações. Há índice declarado em `supabase/migrations/20260601170000_create_workspace_messenger.sql:25` para `(conversation_id, created_at DESC)`; não afirmar ausência de índice sem verificar o banco real. Não foram encontrados arquivos `loading.tsx` em `src/app` nesta inspeção.

## Alvo Consig: tratar separadamente

O checkout local já contém `apps/web/src/lib/crm/atendimento-read-client.ts`: leituras por `fetch` em `/api/crm/atendimento`, paginação e mesclagem de mensagens. O handler está em `apps/web/src/app/api/crm/atendimento/route.ts`.

`apps/web/src/lib/crm/chat-interno-actions.ts` já usa cursores compostos por data/ID, limite para páginas anteriores e leitura incremental. Também há testes dedicados de cursor, Realtime e cliente de leitura. Isso constitui referência útil, não comprovação de bom desempenho ou de implantação dessas mudanças. Verificar quais componentes realmente utilizam os caminhos e qual commit está publicado antes de modificar o CRM.

## Execução em etapas pequenas

### 1. Medir e reproduzir antes de corrigir

- Confirmar commits publicados e ambiente (produção versus `next dev`). Ler os AGENTS.md de cada repositório e os guias locais do Next antes de codificar.
- Em sessão autorizada, registrar Network/Performance: clique → feedback visual → lista utilizável → primeiras mensagens utilizáveis. Separar tempo em fila, TTFB, transferência, renderização e chamadas auxiliares. Sanitizar HAR: sem cookies, tokens, telefones ou conteúdo de conversas.
- Instrumentar durações por etapa com identificador de requisição: proxy/auth, permissões, conta, banco, Chatwoot, Storage e serialização. Usar `Server-Timing` em handlers e logs agregados nas demais camadas; não registrar credenciais ou mensagens.
- Fazer 30 interações por cenário principal, separando acesso frio/quente, conversas pequenas/grandes/com anexos, navegação e troca rápida A→B. Repetir no CRM. Registrar p50/p95 e erros; amostra inicial é diagnóstico, não garantia estatística de produção.
- Só investigar CPU, memória, região, conexão/pool e saturação se os tempos apontarem para dependência/infraestrutura. Verificar algoritmo JWT ativo sem expor token. Comentários sobre chave legada no código não comprovam a configuração atual; não revogar chaves como tentativa de otimização.

### 2. Remover fila e dependências auxiliares da abertura

- Priorizar leituras frequentes por Route Handlers autenticados e `fetch`, ou carregar dados iniciais no servidor. Server Actions permanecem adequadas para mutações. Um `Promise.all` no cliente não resolve a fila de actions.
- Separar mensagens essenciais de etiquetas, agendamentos, agentes e painéis auxiliares. Exibir mensagens assim que prontas; carregar acessórios sob demanda ou em paralelo por leitura HTTP independente. Preservar erros reais: hoje `getDadosConversaAberta` transforma falha de mensagens em lista vazia.
- Criar funções internas de leitura que recebam contexto já autorizado; cada entrada pública verifica sessão, conta, departamento e acesso à conversa. Não simplesmente chamar exports de actions dentro de um GET se continuarem produzindo gravações.
- Atenção: `getMeta`/`getContatoMeta` podem criar registros; a leitura interna marca mensagens como lidas. Separar essas mutações de GET/cache/prefetch para não mudar estado ao pré-carregar uma tela.
- Usar cancelamento quando disponível e contador de geração/ID da seleção para descartar respostas obsoletas, inclusive no `finally`. Cache em memória por usuário, conta, conversa e filtros; limpar na saída/troca de identidade.
- Acrescentar feedback imediato e boundaries adequados de carregamento. Skeleton é melhoria de percepção, não critério de conclusão da performance.

### 3. Limitar histórico e custo do chat interno

- Abrir pelas 50 mensagens mais recentes, ordenar para exibição e carregar anteriores por cursor `(created_at, id)`. Atualizar apenas incrementos; manter histórico já carregado, posição da rolagem e deduplicação.
- Aplicar tanto ao GET de mensagens diretas quanto ao caminho `getMensagensInterno`/data layer de grupos, equipe e canal pessoal. Reusar conceitos do CRM com adaptação dos contratos e autorização.
- Assinar anexos apenas da página necessária, preferindo lote de caminhos únicos ou carregamento sob demanda. Manter bucket privado e validade das URLs; falha de mídia não deve ocultar texto.
- Retirar atualização de leitura do caminho crítico de retorno; preservar semântica de leitura realmente exibida e tratamento de falhas. Não trocar simplesmente por uma Promise solta no servidor.
- Obter última mensagem/não lidas por agregação SQL autorizada ou resumo mantido transacionalmente, substituindo varredura global de 2.000 mensagens. Respeitar conversas sem atividade recente e canal pessoal.
- Consultar índices reais e planos de execução das leituras. Avaliar índice composto incluindo `id` apenas após plano/volume; testar migração e impacto de escrita antes de aplicar.

### 4. Deduplicar e reduzir requisições de fundo

- Fazer callbacks de polling retornarem a Promise. Tratar rejeições, cleanup, cancelamento e eventos de visibilidade. Unificar chamadas simultâneas da mesma chave entre poll/Realtime; manter recuperação após desconexão com backoff.
- Verificar montagens do dock, página completa e notification bridge antes de criar um store compartilhado. Evitar duplicação de consulta mantendo notificações quando o dock está fechado.
- Deduplicar identidade/permissões/conta na mesma requisição; paralelizar somente leituras independentes. `React.cache` tem escopo/condições próprias e não deve ser presumido como cache universal em handlers/actions; contexto explícito é alternativa previsível.
- Não usar cache global de autorização sem chave por identidade/tenant e estratégia de invalidação. Não remover verificação de usuário inativo, permissões, conta ou participação para ganhar tempo.
- Migrar atribuição/higienização disparadas na listagem para fluxo de evento/job durável quando confirmado seu impacto. Não aumentar timeout nem capacidade de infraestrutura sem evidência.

### 5. Validar CRM e entregar

- Medir os endpoints existentes e caminho de autorização do CRM. Confirmar uso efetivo das leituras HTTP e cursores e eventuais filas restantes do chat interno. Corrigir apenas gargalos demonstrados; não copiar indiscriminadamente a arquitetura do Workspace.
- Testar isolamento entre usuários/contas e departamentos, acesso negado, sessão expirada, usuário inativo, texto/anexo, não lidas, rolagem antiga, troca A→B, resposta atrasada, reconexão e timeout de acessório.
- Testes automatizados focados em cursor/ordenação, autorização dos novos handlers, descarte de resposta antiga e prevenção de sobreposição. Executar checks aplicáveis de cada pacote e comparar mesmos cenários antes/depois.
- Entregar commits pequenos, tabela de tempos, limitações e instruções de reversão. Mudança de esquema preferencialmente aditiva e compatível; publicar gradualmente pelo processo existente, sem alteração improvisada de credenciais/JWT.

## Metas propostas de aceite (a validar no ambiente real)

| Métrica | Meta |
| --- | --- |
| Feedback visual após clique | até 100 ms |
| Navegação autenticada quente, conteúdo principal utilizável | p95 até 2 s |
| Abertura de conversa quente, primeiras mensagens utilizáveis | p95 até 1,5 s |
| Acesso frio, conteúdo principal utilizável | p95 até 3 s |
| Reabertura com cache válido | até 300 ms para conteúdo já disponível, revalidação em fundo |
| Consistência | zero mistura entre conversas, zero perda/duplicação de mensagens na bateria de testes |

Metas são propostas, não resultados medidos. Não considerar concluído se apenas o skeleton aparece rápido enquanto dados continuam levando 10 segundos. Registrar rede, dispositivo, volume e concorrência em cada comparação; confirmar depois sob carga representativa, sem teste de estresse improvisado em produção.

## Prompt pronto para Gemini ou Claude

> Execute o plano em `docs/plano-performance-chats-2026-09-23.md`. O usuário relata 9–15 s na navegação do Workspace e mais de 10 s para abrir conversas. Primeiro confirme o estado atual e meça o caminho crítico; o documento contém evidências estáticas, não um benchmark. Leia AGENTS.md e a documentação do Next instalada. Priorize fila de Server Actions de leitura, mensagens bloqueadas por dados auxiliares, paginação/anexos do chat interno e callbacks de polling que descartam Promises. Preserve autorização, isolamento, leitura, envio e histórico. Trabalhe em etapas pequenas e teste os contratos modificados. Verifique também `../brs-alvoconsig/apps/web`, que já tem leituras HTTP e cursores: confirme deploy e gargalo antes de mudar. Não exponha segredos nem use cache compartilhado indevido. Entregue alterações revisáveis, tempos antes/depois, checks executados e pendências. Não declare os tempos resolvidos sem medição autenticada comparável. Este pedido autoriza implementar e validar correções; implantação deve seguir a autorização e o processo da sessão de execução.
