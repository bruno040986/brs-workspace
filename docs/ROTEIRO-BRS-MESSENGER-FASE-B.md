# Roteiro — BRS Messenger, Fase B: paridade da conversa individual (para o Sonnet)

> Spec: `SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md` (§0, §2, §3, §4, §7, §8).
> Migration `20260907022722_brs_messenger_fase_b.sql` (Fable) — tabelas
> `chat_contato_meta`, `chat_resposta_categorias`, `chat_respostas_rapidas`,
> `chat_resposta_departamentos`, `chat_acoes_agendadas` (+ RPCs
> `chat_acoes_agendadas_claim/finish`), `chat_mensagem_status`,
> `chat_mensagem_reacoes`. Detalhe de cada uma na proposta revisada
> `PROPOSTA-SCHEMA-BRS-MESSENGER-FASE-B.md`.

## Regras de ouro (iguais à Fase A)
- **Regras do Messenger ≠ CRM** (spec §0). Nunca derivar nada de
  `chat_instancias.papel`/`permite_grupos`.
- Sem chamada externa nova além do Chatwoot (engine = recados).
- **Nunca usar `!== 'engine'` como critério** pra nada em `content_attributes.
  origem` — a guarda de eco do engine é uma LISTA de origens (`engine`,
  depois `aparelho`); do lado do Workspace, tratar `origem` como enum aberto.
- Tema `--msn-*` dentro de `/conversas` e do dock; cadastros em Configurações
  seguem `convenios/page.tsx`. REGRA FIXA só se criar menu novo (Respostas
  rápidas e Tags entram em Configurações › Comunicação com `central-conversas`).
- `npm run build` verde + `npx tsc --noEmit` limpo; commitar só os arquivos da
  fase. Autorização do Bruno (06/09): decidir sozinho, relatar; só consultar
  se irreversível. Migration nova → Fable.

## Frentes (ordem sugerida; cada uma pode ser um commit)

### (a) Vínculo, departamento e atendente padrão por CONTATO + sinal de parceiro inativo + tags automáticas
- Actions (`actions.ts`, perm `conversas`): `getContatoMeta(chatwootContactId)`,
  `setVinculoContato(contactId, tipo|null, id|null)`,
  `setDepartamentoPadraoContato(contactId, departamentoId|null)`,
  `setAtendentePadraoContato(contactId, chatwootAgentId|null)`. Chave =
  `conversa.meta.sender.id`. Reusar `resolverNomesEntidades` e a validação de
  entidade de `setVinculo`.
- **Regra decidida:** `garantirMetaRow(conversationId)` — ao criar a linha da
  conversa sem vínculo, copiar `entidade_*` do contato se existir. Vínculo da
  conversa continua editável (override pontual). `atribuirDepartamentosAutomaticos`
  passa a considerar `chat_contato_meta.departamento_padrao_id` ANTES do
  departamento da conexão (grupo → `eh_grupos` continua primeiro); se
  `atendente_padrao_chatwoot_id`, atribui também.
- UI `PainelContato`: seção "Pessoa (contato)" com o vínculo do contato + o
  vínculo da conversa (mostrar "herdado do contato" quando iguais); selects
  "Departamento padrão" e "Atendente padrão" do contato.
- **Parceiro inativo** (spec §8): quando o vínculo (contato OU conversa) for
  `parceiro` e `agentes_parceiros.status`/inativo → badge "Parceiro inativo"
  no cabeçalho da thread e no item da lista + faixa âmbar no topo da thread.
  Descobrir o campo de ativo em `agentes_parceiros` (não tem `is_active`
  padrão — ver `buscarEntidades`, que comenta isso) e usar o que o cadastro do
  Agente Corban usa.
- **Tags automáticas**: labels do Chatwoot no CONTATO (`GET/POST
  /contacts/:id/labels` — adicionar ao client) "Parceiro Ativo"/"Parceiro
  Inativo", aplicadas ao salvar/alterar vínculo de parceiro. Criar as labels na
  conta se não existirem (`POST /labels`).

### (b) Histórico de chamados · busca · galeria
- Client: `conversasDoContato(contactId)` → `GET /contacts/:id/conversations`;
  `buscarMensagens(q)` → `GET /search?q=` (filtrar por `conversation_id` no
  resultado). Actions correspondentes.
- UI: ícone ⟲ no cabeçalho abre modal "Histórico de chamados" (Conexão,
  Departamento = `meta.team`, Atendente, Último atendimento, Protocolo de
  `chat_conversa_meta`; exportar CSV no cliente). 🔍 passa a buscar no servidor
  (hoje só filtra o que já está carregado). "Mídias e documentos" ganha "ver
  todos" paginando `mensagens(before)` até acabar.

### (c) Tags de contato + cadastro com cor
- Tela Configurações › Comunicação › Tags (`/central-conversas/tags`, perm
  `central-conversas`): lista `GET /labels` (título, cor, descrição), criar/
  editar (`POST/PATCH /labels`), contagem de contatos por tag (`/contacts/
  search` não filtra por label — mostrar contagem só se `GET /labels` trouxer;
  senão omitir a coluna). Item em `divisoes.ts` + os 2 mapas de `permissions.ts`.
- `PainelContato`: seção Tags do CONTATO além das da conversa.

### (d) Respostas rápidas
- Actions (`respostas-rapidas-actions.ts`, perm `central-conversas` p/ CRUD e
  `conversas` p/ listar as visíveis): categorias, respostas (nome, atalho,
  texto, categoria, departamentos[], arquivo via upload no bucket
  `parceiro-midias` — reaproveitar `uploadImagemBase`-like ou o ticket de
  upload do chat), `listarRespostasVisiveis()` = ativas ∧ (sem departamento ∨
  departamento ∈ meus).
- Tela Configurações › Comunicação › Respostas rápidas (abas Respostas |
  Categorias). Composer: digitar `/` abre picker filtrando por atalho/nome; ao
  escolher, insere o texto e, se tiver arquivo, envia como anexo com legenda.
  Substitui os chips de canned response do Chatwoot (manter fallback se a
  tabela estiver vazia).

### (e) Agendamento
- Actions: `agendarAcao({conversationId, acao, texto, agendadoPara})`,
  `listarAgendamentos(conversationId)`, `cancelarAgendamento(id)`,
  `reagendar(id, novaData)`.
- Worker: rota `GET /api/cron/messenger-agendamentos` (Bearer do cron já usado
  pelos outros crons), a cada 1 min: `rpc('chat_acoes_agendadas_claim')` →
  para cada item: revalidar que a conversa segue aberta e a instância
  conectada; `mensagem` → `responderConversa`-equivalente assinado com o
  `criado_por`; `lembrete_interno` → `notaInterna("⏰ Lembrete: …")` +
  notificação Workspace pro `criado_por`; `rpc('chat_acoes_agendadas_finish',
  {status:'executado'|'falhou', erro})`. Erro de rede após possível envio →
  `falhou` com erro explicando (nunca reenviar sozinho).
- UI: ícone 📅 no cabeçalho → modal (Ação, Data/hora, Texto); lista dos
  pendentes da conversa no `PainelContato` com cancelar/reagendar.

### (f) Ticks, reações e "Dispositivo externo" — só RENDER
- `getMensagens` passa a juntar `chat_mensagem_status` e `chat_mensagem_reacoes`
  por `chatwoot_message_id` (uma query `in` por página).
- `ThreadConversa`: ✓ enviado · ✓✓ entregue · ✓✓ azul lido · ⚠ falhou;
  reações abaixo da bolha (emoji × contagem); mensagem com
  `content_attributes.origem === 'aparelho'` rotulada "Dispositivo externo" em
  itálico; em grupo, label do remetente vindo de `content_attributes.sender`
  (cair no prefixo `*Nome:*` do texto se não vier).
- A ESCRITA dessas tabelas é do engine (recado aditivo enviado). Nada de
  polling extra: entram no mesmo `carregarThread`.

### (g) Responder citando
- `enviarMensagem` do client ganha `contentAttributes?` (in_reply_to);
  `responderConversa(conversationId, texto, { inReplyTo? })`. UI: ação
  "Responder" na bolha → preview acima do composer → envia com `in_reply_to`.
  Render: bolha com a citada em miniatura. (Engine repassa `quoted` na
  Entrega 2/3 dele.)

## Aceite
- Vínculo feito no contato aparece na próxima conversa do mesmo contato sem
  ação do atendente; override na conversa não altera o contato.
- Parceiro inativado no cadastro → badge/faixa na conversa e no grupo + tag
  "Parceiro Inativo" no contato.
- Resposta rápida com departamento X não aparece pra quem não é de X; `/`
  no composer filtra; anexo sai junto.
- Agendamento executa com a aba fechada; dois workers não duplicam; cancelar
  antes da hora impede o envio.
- Histórico do contato lista chamados resolvidos com protocolo; export CSV.
