# BRS Messenger (Workspace) — resumo para revisão externa (Astra) · 07/09/2026

Escopo deste resumo: o que a sessão do **brs-workspace** fez no BRS Messenger
(paridade com o Digisac) de 06/09 a 07/09. O lado do engine (repo
`brs-alvoconsig/services/engine`) é resumido pela sessão do CRM.

## 1. Contexto e decisões que governam tudo

- Objetivo: Central de Atendimento do Workspace funcionalmente igual ao Digisac,
  estética MSN mantida. Spec feature-a-feature:
  `docs/SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md`.
- Motor: Chatwoot self-hosted (Application API) + engine próprio (Baileys/Z-API)
  que espelha WhatsApp ↔ Chatwoot. Workspace fala com o Chatwoot; engine só por
  "recados" (docs/RECADO-ENGINE-*.md).
- **Regras fixas:** (a) regras do Messenger ≠ CRM — nada derivado de
  `chat_instancias.papel`/`permite_grupos`; (b) `content_attributes.origem` é
  enum ABERTO — nunca `!== 'engine'` como critério (guarda de eco do engine é
  lista `['engine','aparelho']`); (c) migrations só do brs-workspace, timestamp
  real; (d) permissões: nenhuma chave nova além de `conversas-agora` (Fase A);
  tudo sob `conversas` (atendente) e `central-conversas` (configuração), rota
  por prefixo `/central-conversas`.
- Fases: A departamentos/fila · B conversa individual · C grupos · D "Agora" ·
  E bot · F kanban. A e B implementadas; C: engine pronto (4 entregas), UI não
  começou; D–F não começaram.

## 2. Commits (main, todos pushados) e migrations (todas aplicadas)

| Commit | O quê |
|---|---|
| `e6955a7` | Spec + migration Fase A `20260906103500` (chat_departamentos espelho dos Teams, membros, `chat_instancias.departamento_id`, seed dos 7 departamentos, permissão `conversas-agora`) + roteiro + recado grupos |
| `7c0e62f` | Fase A (Sonnet): Teams/assignments/meta/disponibilidade no client Chatwoot, `departamentos-actions.ts`, filtro por departamento no servidor, roteamento automático, transferir em modal, abas Chats/Fila/Contatos/Geral, presença |
| `3f6dc7e` | Migration Fase B `20260907022722` (chat_contato_meta, chat_resposta_categorias/chat_respostas_rapidas/chat_resposta_departamentos, chat_acoes_agendadas + RPCs claim/finish, chat_mensagem_status, chat_mensagem_reacoes) + roteiro Fase B + recado ack/reação/aparelho |
| `3ab2414` | Migration `20260907030221` chat_mensagens_mapa (wa_id ↔ chatwoot_message_id) — criada pela sessão do engine, aplicada |
| `ed3dd01` | Fase B (Sonnet), frentes a–g |
| `5fc4d95` | Fase B: revalidação no worker de agendamento, reações agrupadas |
| `2464cf3` | Revisão Fable da Fase B (correções abaixo) + migration `20260907113143` (participant_jid no mapa) |

## 3. O que foi implementado (Fase B, frentes a–g)

Arquivos principais: `src/lib/central-conversas/{chatwoot,actions,respostas-rapidas-actions,agendamento-actions,agendamento-worker}.ts`,
`src/components/conversas/atendimento/{useAtendimento,PainelContato,ThreadConversa,types}.tsx`,
`src/app/(dashboard)/central-conversas/{tags,respostas-rapidas}/`,
`src/app/api/cron/messenger-agendamentos/route.ts`, `vercel.json`, `src/lib/nav/divisoes.ts`.

- **(a) Meta por CONTATO** (`chat_contato_meta`, chave `conversa.meta.sender.id`):
  vínculo (parceiro/instituição/promotora), departamento padrão, atendente
  padrão. `garantirMetaRow(conversationId, contactId)` copia o vínculo do
  contato ao CRIAR a linha da conversa (override pontual continua possível).
  `atribuirDepartamentosAutomaticos`: grupo → team "recebe grupos"; senão
  departamento/atendente padrão do contato; senão padrão da conexão (uma
  consulta em lote, sem N+1). Chatwoot ignora `team_id` quando `assignee_id`
  vem na mesma requisição → `atribuir` faz 2 chamadas.
- **(b) Histórico de chamados** (`GET /contacts/:id/conversations` + protocolo
  de `chat_conversa_meta`, modal, export CSV) e **galeria completa**
  (pagina `messages?before=` até 20 páginas). Busca server-side de mensagens
  NÃO foi construída: não existe endpoint de full-text no Chatwoot (só busca de
  contato por e-mail e filtros) — mantida a filtragem client-side.
- **(c) Tags de contato** (`GET/POST /contacts/:id/labels`, POST substitui o
  conjunto) + cadastro `/central-conversas/tags` (CRUD de labels da conta, cor).
- **(d) Respostas rápidas próprias** (categoria, escopo por departamento, anexo
  no bucket PRIVADO `parceiro-midias` — guarda path, assina na leitura);
  `listarRespostasVisiveis` = ativas ∧ (sem departamento ∨ departamento ∈
  meus); composer com `/` (picker) e chips; fallback pro canned response nativo
  do Chatwoot se nada cadastrado. Cadastro em
  `/central-conversas/respostas-rapidas`.
- **(e) Agendamento** (mensagem | lembrete interno): actions + worker em cron
  (`* * * * *`, `CRON_SECRET` Bearer) com `chat_acoes_agendadas_claim`
  (FOR UPDATE SKIP LOCKED, lease 120s) e `_finish(token)`; antes de enviar
  revalida conversa não-resolved e instância `conectada`; lembrete = nota
  interna + `workspace_notifications`.
- **(f) Render de ticks/reações/"Dispositivo externo"**: `getMensagens` junta
  `chat_mensagem_status`/`chat_mensagem_reacoes` por `chatwoot_message_id`
  (best-effort). Escrita é do engine.
- **(g) Responder citando**: `enviarMensagem(..., contentAttributes)` →
  `content_attributes.in_reply_to = <chatwoot_message_id>`; preview acima do
  composer; miniatura da citada na bolha.

## 4. Erros encontrados e soluções

### Durante a implementação (Sonnet, autocorrigidos)
1. `'use server'` só exporta async → helper síncrono `assinar` não pôde ser
   exportado; duplicado localmente onde precisa.
2. `getPublicUrl` num bucket PRIVADO → trocado por path + `createSignedUrl`.
3. Suposições do roteiro checadas contra developers.chatwoot.com: sem endpoint
   de search; `in_reply_to` não é campo documentado (é contrato privado nosso,
   Chatwoot só armazena o objeto).
4. Worker não revalidava conversa/instância (critério de aceite) → adicionado.
5. Reações não agrupavam por emoji → agrupadas com contagem.

### Na revisão Fable (commit `2464cf3`)
1. **P0 — crash em grupo.** `content_attributes.sender` é OBJETO
   `{jid, numero, nome}` (contrato do engine); a bolha renderizava direto →
   "Objects are not valid as a React child". Agora label = `nome || numero`,
   fallback pro prefixo `*Nome:*` do texto, e o prefixo é retirado do conteúdo
   (o engine o mantém por compatibilidade com o CRM).
2. **P1 — resposta rápida com anexo não enviava o anexo.** Nova action
   `enviarRespostaRapida` (baixa do bucket, texto assinado como legenda, escopo
   por departamento). Upload restrito à allowlist do composer.
3. **P2 — escopo por `conta_id`** faltando em cancelar/reagendar agendamento e
   no CRUD de categorias/respostas.
4. **P2 — permissões de tag:** criar → `can_include`, excluir → `can_delete`.
5. Migration `20260907113143`: `chat_mensagens_mapa.participant_jid` (citar
   mensagem de terceiro em grupo precisa de `key.participant` no Baileys).

### Suposição errada nossa, corrigida pelo engine
O recado de ack/reação supunha que o engine tinha o mapeamento
wa_id ↔ chatwoot_message_id — não tinha. Eles criaram `chat_mensagens_mapa`
(`20260907030221`). Sem isso `in_reply_to`, `quoted`, ack e reação eram
impossíveis.

## 5. Pendência ABERTA que bloqueia a citação de ponta a ponta (lado do engine)

O engine só lê `quoted`/`mentions` no `POST /instancias/:id/enviar` (API
própria). O Workspace responde pelo Chatwoot; o caminho que chega no engine é o
webhook `message_created` → `outboundDoChatwoot` → `enviarBaileys(...)` **sem
extras** — `content_attributes.in_reply_to` é ignorado. Resultado: citação
feita no Workspace chega no WhatsApp como mensagem comum. Pedido (com trecho
de código) na seção "Revisão Fable 07/09" de
`docs/RECADO-ENGINE-ACK-REACAO-APARELHO.md`. Decisão: manter UM caminho de
envio (não chamar o `/enviar` deles pra citar).

## 6. Pontos que merecem olhar de revisor

- `conversa.meta.team` não está no OpenAPI oficial do Chatwoot (o dashboard
  deles usa); leitura defensiva com fallback (mostra a conversa sem team).
- `getGaleriaConversa` assume página de 20 e ordem ascendente do
  `messages?before=`.
- Worker: lembrete interno não revalida conversa (só a ação `mensagem`).
- Ticks: mensagem de saída sem linha em `chat_mensagem_status` mostra ✓ simples
  (inclui mensagens anteriores ao engine gravar).
- `listarRespostasVisiveis` usa os departamentos de `meusDepartamentos()`; para
  supervisor isso pode ser a lista completa (respostas de todos os departamentos
  visíveis) — aceitável, mas é decisão implícita.
- Eslint do repo já acusa `react-hooks/set-state-in-effect` e `no-explicit-any`
  em código pré-existente (mesmo padrão nas telas novas); o gate do projeto é
  `next build` + `tsc`, ambos verdes.
- **Nada foi testado no navegador ainda** — só build/tsc e revisão de código.

## 7. Deferido de propósito (não é bug)

- Badge/tag automática "Parceiro Inativo": `agentes_parceiros` não tem campo
  de ativo/inativo (só `status` do onboarding). Exige decisão + migration.
- Busca server-side de mensagens: sem endpoint no Chatwoot.
- Bot/URA (E) e kanban (F): depois, por decisão do Bruno.

## 8. Etapa atual e próximos passos

- **Atual:** Fase B fechada no código (build/tsc verdes), aguardando (1) teste
  manual, (2) ajuste do engine no caminho webhook (item 5).
- **Próximo:** Fase C (grupos) no Workspace — aba Membros, adicionar/remover,
  admin, convite/link, sair, criar grupo, @menção; engine pronto
  (`GET /instancias/:id/grupos/:jid`, participantes, convite, sair, criar,
  contatos; erros `{erro, codigo}`: `NAO_MEMBRO`, `NAO_ADMIN`,
  `FALHA_WHATSAPP`, `GRUPO_NAO_PERMITIDO`, `INSTANCIA_DESCONECTADA`,
  `PROVEDOR_NAO_SUPORTADO`; v1 só Baileys). Depois D "Agora" (Chatwoot reports,
  permissão `conversas-agora` já semeada), E, F.
