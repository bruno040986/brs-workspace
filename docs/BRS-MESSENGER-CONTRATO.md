# BRS Messenger — Fase 1 (contrato entre camadas, 31/08/2026)

Design aprovado: https://claude.ai/code/artifact/dd81a4bc-797b-45ac-8616-419f87f27ca4
Migration JÁ APLICADA: `supabase/migrations/20260831120000_brs_messenger_atendimento.sql`
(`users.nome_exibicao`, `chat_conversa_meta` com vínculo genérico/observações/protocolo por
trigger, Interno com kinds 'equipe' e 'self' seedados + trigger pra usuário novo).

Regras fixas:
- Identidade visual: os tokens `--msn-*` do próprio BRS Messenger (globals.css ~linha 1509,
  tema azul MSN + variante dark) — NUNCA o visual do CRM AlvoConsig. A aba Atendimento e a
  página /conversas devem parecer parte do Messenger.
- Toda mensagem de WhatsApp enviada pela equipe sai assinada `*<nome_exibicao||name>:*\n<texto>`
  (mesma convenção do CRM). `users.nome_exibicao` é livre (ex.: "Michael - Suporte").
- Tags e nota interna usam o Chatwoot nativo (labels API e `private: true` já suportado no
  client), sem tabela nova. Vínculo/observações/protocolo ficam em `chat_conversa_meta`
  (service role; ownership = conta BRS, chave `(conta_id, chatwoot_conversation_id)`).
- Permissões: recursos existentes `conversas` (atender) e `central-conversas` (configurar).
  Escopo por departamento é FASE 2 — não inventar agora.

## Server (`src/lib/central-conversas/`)
`chatwoot.ts` (ADITIVO, não quebrar):
- `enviarMensagemComAnexo(conversationId, file: {nome, mime, bytes: Buffer}, legenda?)` —
  multipart `POST /conversations/:id/messages` com `attachments[]` (+ `content` opcional).
- `notaInterna(conversationId, texto)` → `enviarMensagem(..., privada=true)` (já existe o param).
- Labels: `listarLabelsConta()`, `labelsDaConversa(id)`, `setLabelsDaConversa(id, labels: string[])`
  (`POST /conversations/:id/labels` substitui o conjunto).
- `atividadesDaConversa` não existe como endpoint — os eventos (atribuição, resolve) chegam como
  mensagens `message_type: 2` (activity) no próprio `/messages`; a UI renderiza como pill central.
`actions.ts` (ADITIVO):
- `getConversas` ganha: filtro `inboxId?`, e cada item retorna também `meta` (protocolo,
  entidade vinculada resolvida com nome, observações) via join em `chat_conversa_meta` —
  criar a linha meta on-demand (upsert) na primeira leitura da conversa aberta, não em lote.
- `getMeta(conversationId)` / `setVinculo(conversationId, tipo|null, id|null)` /
  `setObservacoes(conversationId, texto)` — busca de entidades: `buscarEntidades(q)` →
  agentes_parceiros (arw_code/fantasy_name/name), financial_institutions (name),
  promotoras (nome_fantasia/razao_social), máx. 8 por tipo, só ativos.
- `responderConversa` passa a assinar `*<nome_exibicao||users.name>:*\n` (buscar do usuário da
  sessão; NUNCA assinar nota interna).
- `enviarAnexoConversa(conversationId, formData)` (mime allowlist: pdf, png, jpg, webp, mp3,
  ogg, opus, mp4, xlsx, csv; ≤ 15 MB) e `enviarAudioConversa(conversationId, formData)` (ogg/opus
  do MediaRecorder) — ambos via `enviarMensagemComAnexo`.
- `addNotaInterna(conversationId, texto)`; `transferirConversa(conversationId, agenteId)` (o
  Chatwoot registra activity); `encerrarConversa(conversationId, motivo?)` — se houver motivo,
  manda nota interna "Encerrado: <motivo>" antes do resolve.
- `getTagsConta()` / `setTags(conversationId, tags)`.
- `setMinhaAssinatura(nomeExibicao)` + leitura no perfil.
- Interno: `getCanaisInterno()` (Equipe BRS primeiro? não — "Você" primeiro, depois Equipe,
  depois diretos por atividade), aproveitando as tabelas workspace_chat_* e o RLS existente;
  o componente atual (GoogleChatComponent) já fala com essas tabelas — ESTENDER o data layer
  dele pra listar kinds 'equipe' e 'self' com nomes fixos ("Equipe BRS", "Você") e permitir
  mensagem neles; canal 'self' aceita lembretes (mensagens de sistema).
- Lembretes no "Você": localizar o mecanismo de lembretes da Agenda (fila `process_jobs`/cron
  já existente do módulo /agenda) e ADICIONAR a entrega como mensagem no canal self do dono do
  compromisso (sender = o próprio dono; prefixo "⏰ Lembrete: "). Se o mecanismo for inviável
  de estender com segurança, criar cron 5 min próprio lendo os compromissos com lembrete
  pendente — documentar a escolha.

## Engine (`brs-alvoconsig/services/engine`) — clone em scratchpad, repo bruno040986/brs-alvoconsig
- Verificar o caminho Chatwoot→WhatsApp (webhook `message_created` outgoing): hoje repassa
  texto; ESTENDER pra anexos — baixar `attachments[].data_url` do Chatwoot (com o token da
  conta) e enviar via Baileys (image/document/audio conforme `file_type`) e Z-API equivalente.
  Sem isso, anexo enviado pela UI chega no Chatwoot mas não no WhatsApp.

## UI
- `CentralConversasPanel` vira composição de blocos reutilizáveis (lista/thread/composer/painel)
  montados em DUAS larguras: dock compacto (uma coluna, painel do contato como gaveta
  deslizante) e `/conversas` tela cheia (3 colunas exatamente como o design).
- Fila numerada (badge 1..n na aba Fila, ordem de chegada), filtro por canal (chips das
  instâncias + inboxes), botões "Nova conversa" (telefone→cria via engine, exige instância de
  disparo/receptiva? BRS: usar instância escolhida num select) e "Criar grupo" (Baileys
  groupCreate via engine — se o engine não expuser, deixar o botão com tooltip "em breve" e
  registrar TODO; não travar a fase).
- Composer: anexo, emoji (picker simples), áudio (MediaRecorder→ogg), toggle nota interna
  (visual âmbar), chips de resposta rápida (Chatwoot canned responses? se o client não tiver,
  buscar `GET /accounts/:id/canned_responses` — é endpoint padrão).
- Thread: bolhas azuis MSN, activities como pill central, nota interna âmbar, anexos com
  preview/download.
- Painel direito: avatar, nome, telefone, Silenciar (mute do Chatwoot `/toggle_status`? não —
  usar `POST /conversations/:id/mute`)/Não lida (`/unread`), Mídias e documentos (agregado das
  mensagens com attachment), abas Geral (Vincular a, Tags, Protocolo com copiar, Departamento
  = inbox/instância exibida, Atendente com select, Observações) e Membros (grupo: participantes
  do payload do Chatwoot/engine quando houver; sem dado, esconder aba).
- Dock: manter chrome atual (MessengerDockShell intocado); MessengerDockTabs continua
  Interno/Atendimento; sem duplicar toast/som quando /conversas estiver aberta (usar
  BroadcastChannel 'brs-messenger-fullpage-aberta' simples).
- Interno: lista com "Você" (avatar âmbar) e "Equipe BRS" (avatar de grupo) fixos no topo,
  lembrete renderizado como card âmbar com botão "Abrir agenda".
