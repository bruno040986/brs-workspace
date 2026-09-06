# Roteiro — BRS Messenger, Fase A: departamentos e fila (para o Sonnet)

> Spec: `SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md` (§0 princípio, §1, §2, §6, §10).
> Migration `20260906103500_brs_messenger_departamentos.sql` (Fable) cria
> `chat_departamentos`, `chat_departamento_membros`, `chat_instancias.departamento_id`,
> semeia os 7 departamentos na conta BRS e a permissão `conversas-agora`.
> Nó em `SYSTEM_MODULES` e rotas de `/conversas/agora` já foram feitos pelo Fable;
> o item de menu do "Agora" entra junto com a página (Fase D).

## Regras de ouro
- **Regras do Messenger ≠ CRM** (spec §0): nunca filtrar/derivar nada de
  `chat_instancias.papel` ou `permite_grupos`. Toda conexão da conta BRS envia,
  recebe e opera grupos.
- **Sem API externa nova além do Chatwoot** (engine é a Fase C, por recado).
- Estilo: tema `--msn-*` do Messenger para tudo que fica dentro de `/conversas`
  e do dock; telas de cadastro (Departamentos) seguem `convenios/page.tsx`.
- REGRA FIXA: menu novo → `divisoes.ts` + `permissions.ts` (2 mapas). Sem chave
  de permissão nova nesta fase (Departamentos usa `central-conversas`).
- `npm run build` verde + `npx tsc --noEmit` limpo antes de commitar.
- Migration nova / policy / `security definer` → para e devolve ao Fable.

## 1. Client Chatwoot (`src/lib/central-conversas/chatwoot.ts`, ADITIVO)
```
listarTeams()                                   GET  /teams
criarTeam({name, description?})                 POST /teams
atualizarTeam(id, {name?, description?})        PATCH /teams/:id
membrosTeam(id)                                 GET  /teams/:id/team_members
setMembrosTeam(id, userIds[])                   POST (add) + DELETE (remove) /teams/:id/team_members  {user_ids}
atribuirConversa(id, {assigneeId?, teamId?})    POST /conversations/:id/assignments {assignee_id, team_id}
metaConversas({inboxId?, teamId?})              GET  /conversations/meta → mine_count, unassigned_count, all_count
listarConversas(+ teamId?, sortBy?)             GET  /conversations?team_id=&sort_by=last_activity_at|created_at|waiting_since
setDisponibilidade('online'|'busy'|'offline')   PUT  /profile/availability  (Ausente = busy)
setAutoAssignmentInbox(inboxId, boolean)        PATCH /inboxes/:id {enable_auto_assignment}
```
Contagens por departamento: `GET /conversations?status=open&assignee_type=unassigned&team_id=` (usar `meta.all_count`).

## 2. Actions (`src/lib/central-conversas/departamentos-actions.ts`, novo)
Permissão `central-conversas` (configurar) — `requirePermission('central-conversas', ...)`:
- `listarDepartamentos()` → espelho + contagem de membros + `chatwoot_team_id` + flag de sync pendente.
- `salvarDepartamento({id?, nome, ordem, ativo, distribuicao_automatica, eh_grupos})` → upsert espelho **e** cria/atualiza o Team no Chatwoot (grava `chatwoot_team_id`). `eh_grupos` só um por conta (índice único — tratar erro com mensagem).
- `setMembrosDepartamento(departamentoId, userIds[])` → grava `chat_departamento_membros` **e** sincroniza `team_members` (resolver Chatwoot user id por e-mail via `cli.agentes()`; usuário sem agente → provisionar como `provisionar-agentes.ts` faz).
- `setDepartamentoInstancia(instanciaId, departamentoId|null)` → `chat_instancias.departamento_id`.
- `aplicarDistribuicaoAutomatica(departamentoId)` → para cada instância do departamento com `chatwoot_inbox_id`, `setAutoAssignmentInbox(inbox, flag)`. **Default OFF**; só liga se `distribuicao_automatica=true`.

Permissão `conversas` (atender) — em `actions.ts` (ADITIVO):
- `meusDepartamentos()` → departamentos do usuário logado (via `chat_departamento_membros`) + `ehSupervisor` (tem `central-conversas`).
- `getConversas` ganha `teamId?` e `sortBy?`; **filtro por departamento**: atendente comum só vê conversas cujo `team_id` ∈ seus departamentos (ou sem team); supervisor vê tudo. Aplicar no servidor, não só na UI.
- `getContadores()` → `metaConversas` (Chats = mine, Fila = unassigned, Geral = all).
- `transferirConversa(conversationId, { departamentoId, agenteId?, comentario? })` → `atribuirConversa` com `team_id` (obrigatório) + `assignee_id` (opcional); se `comentario`, `notaInterna("🔁 Transferido para <depto>[ · <atendente>]: <comentário>")` ANTES da atribuição.
- `atribuirDepartamentoSeVazio(conversationId)` (idempotente): ao abrir/listar uma conversa **sem team**: se `ehGrupo` → team do departamento `eh_grupos`; senão → team do `departamento_id` da instância da inbox. Chamar em `getConversas` (lote, só as sem team) e ao abrir.
- `setMinhaDisponibilidade(status)` + leitura no perfil do Messenger.
- `listarContatos({q, page})` → `GET /contacts/search?q=` / `GET /contacts` para a aba **Contatos**; `criarContato({nome, telefone})`.

## 3. UI
**Configurações › Comunicação › Departamentos** (`/central-conversas/departamentos`, perm `central-conversas`): tabela Nome · Usuários vinculados · Distribuição automática (toggle, default off) · Recebe grupos (radio, um só) · Status; modal com nome/ordem/ativo/flags + seletor múltiplo de usuários (só quem tem `conversas`). Item em `divisoes.ts` dentro de "Comunicação" (rota já coberta pelo prefixo `/central-conversas`).

**Instâncias** (`InstanciasClient.tsx`): select "Departamento padrão" por conexão.

**Messenger / `/conversas`**:
- Abas **Chats / Fila / Contatos** com contadores (badge) — Chats = minhas, Fila = sem atendente (numerada como hoje), Contatos = lista + busca + "Criar novo". Manter "Geral" como visão de supervisão (só supervisor).
- **Ordenar por**: última atividade · criação · tempo de espera.
- Filtro: departamento (chips), conexão (já existe), atendente, tag.
- **Chip de departamento** no cabeçalho da conversa (ao lado do chip da conexão).
- **Transferir** vira modal: Departamento (obrigatório) · Atendente (opcional, filtrado pelos membros do departamento) · Comentário.
- **Presença**: seletor Online / Ausente / Offline no cabeçalho do dock e da página; refletir `availability_status` na lista de atendentes.
- Permissão por departamento: a UI só oferece transferir/atribuir dentro dos departamentos do usuário; supervisor vê todos.

## 4. Aceite
- Criar/editar departamento reflete no Chatwoot (Team existe, membros batem por e-mail).
- Conversa nova de grupo cai em "Grupos"; conversa nova de conexão com departamento padrão cai nele; sem departamento fica sem team (fila geral).
- Atendente de "Suporte" não vê conversas de "Recursos Humanos"; supervisor vê tudo.
- Transferir exige departamento; comentário vira nota interna antes da atribuição.
- Contadores das abas batem com `/conversations/meta`.
- Distribuição automática só liga com o toggle; padrão OFF em todos.
