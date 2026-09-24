# Relatório Final de Correções de Performance — 24/09/2026

Este documento sintetiza as correções e validações realizadas no **brs-workspace** em atendimento às revisões e diretrizes dos documentos `docs/revisao-performance-gemini-2026-09-24.md` e `docs/plano-performance-chats-2026-09-23.md`.

---

## 1. Mapeamento de Correções Realizadas

### 1.1 Bootstrap: Métodos da API Chatwoot, Mapeamento de Dados e Verificação do Método HTTP
- **Problema**: `getBootstrapData()` em `src/lib/central-conversas/actions.ts` tentava invocar `cli.listarLabels()` e `cli.listarCannedResponses()`, métodos inexistentes no cliente `ChatwootConta`, que causavam exceções em runtime quando havia conta configurada. Além disso, os retornos não eram transformados para os formatos esperados pela interface UI (`TagConta` e `RespostaRapida`).
- **Correção**:
  - Atualizadas as chamadas para `cli.listarLabelsConta()` e `cli.respostasRapidas()`.
  - Mapeadas as tags para a estrutura `{ titulo: string; cor: string | null }` (`TagConta`).
  - Mapeadas as respostas rápidas para a estrutura `{ id: number; atalho: string; conteudo: string }` (`RespostaRapida`).
  - Confirmado que o endpoint `/api/conversas/bootstrap/route.ts` expõe o handler **`GET`** (idempotente e sem mutação), corrigindo relatórios anteriores.
- **Arquivos Alterados**:
  - `src/lib/central-conversas/actions.ts`
  - `src/app/api/conversas/bootstrap/route.ts`

---

### 1.2 Isolamento de Dependências do Servidor em Componentes Cliente (`'use client'`)
- **Problema**: O componente cliente `GoogleChatComponent.tsx` (`'use client'`) importava a função `mergeMessages` de `src/lib/interno-chat/data.ts`. O módulo `data.ts` importa o cliente administrativo Supabase e `next/headers.js`, o que violava os limites do bundler client-side no Next.js.
- **Correção**:
  - Criado o módulo leve `src/lib/interno-chat/cursor.ts` contendo apenas funções puras e sem qualquer dependência de servidor ou banco de dados (`construirFiltroCursorComposto` e `mergeMessages`).
  - Atualizado `GoogleChatComponent.tsx` para importar `mergeMessages` diretamente de `@/lib/interno-chat/cursor`.
  - Atualizado `src/lib/interno-chat/data.ts` para re-exportar as funções a partir de `./cursor.ts`.
  - Atualizado o teste `cursor-pagination.test.ts` para importar de `../cursor.ts`.
- **Arquivos Criados/Alterados**:
  - `src/lib/interno-chat/cursor.ts` *(novo)*
  - `src/lib/interno-chat/data.ts`
  - `src/app/(dashboard)/theme/GoogleChatComponent.tsx`
  - `src/lib/interno-chat/__tests__/cursor-pagination.test.ts`

---

### 1.3 Deduplicação de Autenticação e Contexto Compartilhado por Requisição
- **Problema**: O agregador `getBootstrapData()` realizava `requirePermission('conversas', 'can_view')`, e em seguida efetuava chamadas redundantes a `requireCurrentUser()` e `getCurrentUserEffectivePermissions()`.
- **Correção**:
  - `getBootstrapData()` agora reconfigura o fluxo de autorização reutilizando a tupla `{ user, permissions }` retornada por `requirePermission('conversas', 'can_view')`.
  - O perfil do supervisor é determinado diretamente por `permissions.some((p) => p.resource_name === 'central-conversas' && Boolean(p.can_view))`, eliminando chamadas repetidas.
- **Arquivos Alterados**:
  - `src/lib/central-conversas/actions.ts`

---

### 1.4 Resolução de Erros de Compilação TypeScript em `useAtendimento.ts`
- **Problema**:
  1. No hook `useAtendimento.ts`, a função `carregarContatos` chamava `setContatos(lista)` sem ter declarado/decodificado `const lista = await res.json()`.
  2. Em `carregarThread`, ao chamar `setMensagens((prev) => mergeChatwootMessages(prev, fresh))`, a assinatura de `mergeChatwootMessages` esperava estritamente `ChatwootMensagem[]` e falhava para o tipo estendido `MensagemComExtras[]`.
- **Correção**:
  - Adicionado `const lista = await res.json()` em `carregarContatos`.
  - Tornada a função `mergeChatwootMessages<T extends ChatwootMensagem>(existing: T[], fresh: ChatwootMensagem[]): T[]` genérica em `src/lib/central-conversas/chatwoot.ts`, preservando propriedades estendidas de mensagem.
- **Arquivos Alterados**:
  - `src/components/conversas/atendimento/useAtendimento.ts`
  - `src/lib/central-conversas/chatwoot.ts`

---

## 2. Nível de Testes e Validações Executadas

Conforme solicitado na revisão, detalhamos com clareza o escopo de cada suíte de teste e validação:

### 2.1 Testes Unitários de Funções Puras (`npm test`)
- **Escopo**: Validação de lógica determinística isolada.
- **Suítes Executadas**:
  - `src/lib/interno-chat/__tests__/cursor-pagination.test.ts`: Testa `construirFiltroCursorComposto`, `mergeMessages` e `mergeChatwootMessages`.
  - `src/lib/central-conversas/__tests__/envio-operation-id.test.ts`: Testa a máquina de estados e identificadores de envio.
  - `src/lib/comissionamento/__tests__/importar-fatores.test.ts`: Testa parsers de tabelas e fatores.
  - `src/lib/if-credito/amigoz/__tests__/ofertas.test.ts`: Testa normalização de ofertas.
- **Resultado**: **130 aprovados, 0 falhas, 3 ignorados** (fixtures de PDF opcionais ausentes).

### 2.2 Testes de Fluxo Simulado e Regras de Decisão de Acesso
- **Escopo**: Teste unitário das tabelas de decisão de rotas (`getRouteAccessDecision` e `canAccessRoute`) em `src/lib/auth/__tests__/proxy-permissions.test.ts`.
- **Esclarecimento de Limitação**: O helper `mockUpdateSessionFlow` simula as decisões de permissão do proxy de forma unitária; **não executa o runtime do middleware real do Next.js nem o servidor Next.js em integração ponta a ponta**.

### 2.3 Verificação Estática de Tipos (`npx tsc --noEmit`)
- **Escopo**: Verificação completa de compilação TypeScript em todo o projeto.
- **Resultado**: **Aprovado com 0 erros** (Exit code 0).

### 2.4 Build de Produção (`npm run build`)
- **Escopo**: Compilação e minificação completa dos assets, validação de rotas dinâmicas/estáticas e verificações do bundler client/server do Next.js App Router.
- **Resultado**: **Compilado com sucesso em 48s** (TypeScript concluído em 59s, 29 páginas estáticas e todas as rotas dinâmicas validadas).

---

## 3. Registro de Pendências de Medição em Produção

> [!IMPORTANT]
> **Ressalva de Medições Latência/Concorrência:**
> Os testes automatizados e o build comprovam a corretude sintática, integridade dos tipos e modularidade da aplicação. No entanto, **não foram realizadas medições de latência em milissegundos (p50/p95 em produção)** nem testes de carga com múltiplos atendentes simultâneos, pois tais testes exigem deploy em ambiente de produção/staging com tráfego real e Supabase sob carga. Essas medições permanecem **pendentes de benchmark em produção**.

---

## 4. Lista Completa de Arquivos Modificados e Criados

- `src/lib/interno-chat/cursor.ts` *(Novo — módulo puro de mesclagem e cursores)*
- `src/lib/interno-chat/data.ts`
- `src/lib/central-conversas/actions.ts`
- `src/lib/central-conversas/chatwoot.ts`
- `src/app/api/conversas/bootstrap/route.ts`
- `src/components/conversas/atendimento/useAtendimento.ts`
- `src/app/(dashboard)/theme/GoogleChatComponent.tsx`
- `src/lib/auth/__tests__/proxy-permissions.test.ts`
- `src/lib/interno-chat/__tests__/cursor-pagination.test.ts`
- `docs/resultado-performance-gemini.md`
