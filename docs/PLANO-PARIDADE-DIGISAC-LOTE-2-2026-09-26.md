# Plano — BRS Messenger, lote 2 de paridade com o Digisac (demandas dos usuários + capacidades do WhatsApp)

Data: 26/09/2026. Autor: Fable. Executor: nova sessão.
**Modelos:** Sonnet 5 para as telas e rotas do Workspace e para as rotas
simples do engine (itens A1, A4, A5, B1–B5); **Fable 5.1** para o que toca
protocolo/criptografia do Baileys ou risco de bloqueio (A2 áudio ptt, A3
edição, B6 status, revisão final do engine). Sugestão prática: Sonnet
executa tudo e para nos pontos marcados "REVISÃO FABLE".

Repos: Workspace (`brs-workspace`, tela `src/components/conversas/atendimento/*`,
actions `src/lib/central-conversas/*`) e engine (`brs-alvoconsig/services/engine`).
Uma worktree por repo e por sessão (regra do GRUPO.md). Migrations só pelo
Workspace, timestamp real. Engine: só Baileys (Z-API devolve 501 em grupo).
Contrato engine↔Workspace: rotas Fastify em `server.ts` com `ENGINE_API_TOKEN`;
espelho no Chatwoot; eventos em `chat_eventos` (Realtime na tela).
Ler antes: `docs/SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md`,
`docs/RECADO-ENGINE-GRUPOS-BRS-MESSENGER.md`, `AGENTS.md` dos dois repos e
`node_modules/next/dist/docs/` no Workspace.

## Recado para colar na nova sessão

> Execute o plano `docs/PLANO-PARIDADE-DIGISAC-LOTE-2-2026-09-26.md` do
> `brs-workspace`, na ordem A1→A5 e depois B, um item por commit pequeno,
> com as checagens de cada item feitas de verdade (não só teste unitário:
> abrir a tela, mandar para um número de teste, conferir no aparelho).
> Worktrees próprias nos dois repos. Não publique engine sem avisar: o deploy
> reinicia as 11 instâncias. Pare e chame o Fable nos pontos marcados
> "REVISÃO FABLE". Entregue relatório por item: o que mudou, como foi
> validado, o que ficou de fora.

## A. Demandas dos usuários

### A1. Grupo novo não abre (Pequeno — Sonnet)
Hipótese a confirmar primeiro: `criarGrupo` (engine `grupos.ts`) cria o
grupo no WhatsApp e devolve `{ jid, nome }`, mas a conversa no Chatwoot só
nasce no primeiro inbound (`garantirConversa` no bridge). A tela cria e não
tem conversa para selecionar.
- Engine: após `groupCreate`, chamar `garantirConversa(inst, rem)` com o
  remetente de grupo (mesmo objeto que o inbound monta: `jid`, `ehGrupo`,
  `nomeChat`) e devolver também `chatwootConversationId`; registrar evento.
- Workspace: `novoGrupo` recebe o id, chama `carregarLista()` e
  `selecionarConversa` na conversa devolvida (padrão do `novaConversa`).
- Checagem: criar grupo com 1 participante de teste → aparece na lista e
  abre; mensagem enviada chega no aparelho; `chat_conversas` tem a linha.

### A2. Áudio com chiado / às vezes não envia (Médio — Sonnet, REVISÃO FABLE no engine)
Hoje: `ThreadConversa.tsx` grava com `MediaRecorder` em `audio/ogg;codecs=opus`
ou `audio/webm;codecs=opus`, sem constraints; o hook manda como `audio.ogg`;
o engine envia `{ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true }`
mesmo quando o blob é webm → o WhatsApp recusa ou toca com ruído.
- Gravar com `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 } })`
  e `audioBitsPerSecond: 64000`.
- Servidor (rota de envio de áudio do Workspace ou o engine): transcodificar
  SEMPRE para OGG/Opus mono 48 kHz com `ffmpeg` (`-c:a libopus -b:a 64k -ac 1 -ar 48000 -application voip`),
  informar `seconds` e enviar como `ptt: true`. Verificar se o Railway/Vercel
  tem ffmpeg (no Vercel, usar `@ffmpeg-installer/ffmpeg` ou fazer no engine).
  REVISÃO FABLE: onde transcodificar e limite de tamanho.
- Falha de envio: propagar o erro real do engine até o toast (hoje some no
  `catch`), gravar `chat_mensagem_status = falhou`.
- Checagem: gravar 10 s em Chrome e Firefox → ouvir no aparelho sem chiado,
  aparece como nota de voz (onda), não como arquivo; enviar 30 áudios
  seguidos sem falha.

### A3. Editar mensagem (Médio — Fable no engine, Sonnet na tela)
WhatsApp permite editar texto/legenda por até 15 min; Baileys:
`sock.sendMessage(jid, { text: novo, edit: keyDaOriginal })`. O Chatwoot
não tem endpoint de edição de mensagem.
- Engine: rota `POST /instancias/:id/mensagens/:waId/editar` → busca o
  `key` no `chat_mensagens_mapa` (`wa_id`, `remote_jid`, `from_me`), envia
  a edição, grava em tabela nova `chat_mensagem_edicoes` (conta, wa_id,
  chatwoot_message_id, texto_novo, editado_em) e evento `mensagem_editada`.
  Só mensagens `from_me` do engine, ≤ 15 min, só texto/legenda.
- Inbound: `protocolMessage.type === MESSAGE_EDIT` com `editedMessage` →
  gravar a edição do contato na mesma tabela (hoje é descartado como
  protocolMessage) e evento.
- Workspace: menu da mensagem "Editar" (≤15 min, só minhas), action, e na
  thread exibir o texto editado com selo "editada" (junção pela tabela, como
  já é feito com status/reações em `getMensagens`). O conteúdo original fica
  no Chatwoot; a tela mostra o atual.
- Checagem: editar e ver no aparelho; contato edita e a tela atualiza sem
  F5; tentar após 15 min → erro claro.

### A4. Reação vira mensagem nova (Pequeno — Sonnet)
`bridge.ts` ~594 transforma `reactionMessage` em texto "Reagiu 👍" e espelha
como mensagem no Chatwoot, além de gravar em `chat_mensagem_reacoes`
(que a thread já renderiza no balão).
- Não espelhar reação como mensagem; manter só o upsert em
  `chat_mensagem_reacoes` (inclusive remoção = emoji vazio) e o evento para
  o Realtime. Última mensagem da lista não pode virar "Reagiu".
- Checagem: reagir do aparelho → aparece no balão, não na thread nem no
  preview da lista; retirar reação some; reação nossa (já existe) idem.

### A5. @ no grupo sem nome e sem foto (Pequeno/Médio — Sonnet)
- Engine `GET /instancias/:id/grupos/:jid` já devolve membros; garantir
  `nome` (contato salvo → pushName → telefone) e `fotoUrl`
  (`profilePictureUrl`, best-effort, cache 1 h) por participante.
- Workspace: o seletor de menção do composer usa essa lista (nome + avatar
  + telefone), filtro por digitação, insere `@telefone` e manda `mentions`.
- Checagem: em grupo com 5+ membros, digitar @ mostra nomes e fotos; a
  menção chega destacada no aparelho.

## B. Capacidades do WhatsApp ainda não expostas (via engine/Baileys)

### B1. Presença: digitando / gravando / online (Médio — Sonnet)
- Envio: `sock.sendPresenceUpdate('composing'|'recording'|'paused', jid)`
  ao digitar/gravar (debounce 3 s) — rota `POST /instancias/:id/presenca`.
- Recebimento: evento `presence.update` → `chat_eventos` tipo `presenca`
  (não persistir) → cabeçalho da conversa mostra "digitando…"/"online".
  `markOnlineOnConnect` continua false (evita marcar online sem atendente).
- Checagem nos dois sentidos com número de teste.

### B2. Localização, vCard, enquete, figurinha de imagem, visualização única (Médio — Sonnet)
`sendMessage` com `{ location }`, `{ contacts: { contacts: [{ vcard }] } }`,
`{ poll: { name, values, selectableCount } }`, `{ sticker }` (converter
imagem para WebP 512×512 com `sharp`), `{ image, viewOnce: true }`.
Inbound correspondente já cai no `conteudoReal`; mapear para o Chatwoot
(localização → link do mapa; vCard → anexo .vcf; enquete → texto com
opções e votos via `messages.update`). Uma rota por tipo, botão no
composer (menu "+").

### B3. Gestão de grupo — Fase C entrega 2 (Médio — Sonnet)
Já existem `alterarParticipantes`, `linkConvite`, `sairDoGrupo` no engine
(`grupos.ts`). Falta: promover/rebaixar admin (`groupParticipantsUpdate`
`promote|demote`), descrição (`groupUpdateDescription`), foto
(`updateProfilePicture(jid, buffer)`), nome (`groupUpdateSubject`), e a
tela: painel do grupo com membros, ações por membro (só se somos admin),
link de convite com "revogar" (`groupRevokeInvite`).

### B4. Apagar para todos, encaminhar em lote, não lida no aparelho, arquivar, silenciar, bloquear (Pequeno cada — Sonnet)
- Apagar para todos: já existe `apagarMensagem`; garantir o prazo (WhatsApp
  ~2 dias para o remetente) e mensagem clara fora dele.
- Encaminhar em lote: seleção múltipla na thread → `encaminharMensagem`
  em sequência com intervalo (1–2 s) — evitar rajada.
- Não lida / arquivar / silenciar no aparelho: `sock.chatModify({ markRead:false | archive:true | mute: ms }, jid)`.
  Requer app-state sync funcionando — **depende do plano do Baileys 7**
  (hoje as peer messages de estado estão quebradas no Suporte/Financeiro).
- Bloquear: `sock.updateBlockStatus(jid, 'block'|'unblock')`.

### B5. Foto e nome do contato automáticos (Pequeno — Sonnet)
`sincronizarAvatar` já existe no bridge (na criação do contato). Estender:
ao receber `contacts.update`/`contacts.upsert` e a cada N dias, atualizar
`avatar` e `name` no Chatwoot; respeitar privacidade (foto pode vir null).

### B6. Status (Fable — decisão antes de codar)
Baileys: `sendMessage('status@broadcast', { image|video|text }, { statusJidList })`.
Funciona, mas a Meta trata postagem programática de status como sinal de
automação; os números receptivos (Suporte/Atendimento/Financeiro) são os
mais caros de perder. Recomendação: só em número de disparo já aquecido,
volume baixo (≤ 3/dia), manual (botão, sem agenda), e registrar em
`chat_instancia_eventos`. Sem tela de "ver status dos contatos" (inbound
de status já é descartado, `status@broadcast`).

## C. Ordem sugerida e checagens gerais

Ordem: A4 → A1 → A5 → A2 → A3 → B1 → B5 → B3 → B2 → B4 → B6.
Por item: commit pequeno; `npm test` + typecheck nos repos tocados; teste
real com número de teste e print; entrada no relatório. Engine: nunca
`console.log` de chave/sessão; toda rota nova exige `ENGINE_API_TOKEN` e
valida que a instância pertence à conta do chamador. Workspace: toda rota
nova em `permissions.ts` (chave `conversas`) e handler com
`requirePermission`; item de menu novo segue a REGRA FIXA dos 4 pontos.

## D. Recursos nativos do Chatwoot a expor no Workspace (Sonnet, telas; Chatwoot já faz o resto)

Princípio: o Chatwoot já implementa tudo abaixo e expõe pela API da conta
(`ChatwootConta` em `src/lib/central-conversas/chatwoot.ts`). O trabalho é
tela + action + permissão no Workspace; nada no engine. Cada item entra no
menu Central de Atendimento (divisão Operacional) seguindo a REGRA FIXA dos
4 pontos (`SYSTEM_MODULES`, `divisoes.ts`, `permissions.ts`, seed).
Conferir cada endpoint em `https://chat.brspromotora.com.br/swagger` (a
instância é self-hosted; a versão manda) antes de codar.

### D1. Macros (Pequeno)
API: `GET/POST/PATCH/DELETE /api/v1/accounts/{id}/macros`, executar com
`POST /macros/{macro_id}/execute` `{ conversation_ids: [...] }`. Ações
possíveis: atribuir agente/time, adicionar/remover etiqueta, enviar
resposta, nota privada, mudar status/prioridade, soneca.
- Tela: Central de Atendimento › Macros (lista, criar, editar; visibilidade
  global ou pessoal). No cabeçalho da conversa: botão "Macro" com a lista e
  execução em 1 clique; suporte a seleção múltipla na lista de conversas.
- Checagem: criar macro "Encerrar com etiqueta X" e rodar em 3 conversas.

### D2. SLA com alerta (Médio)
API: `GET/POST/PATCH/DELETE /api/v1/accounts/{id}/sla_policies`
(`first_response_time_threshold`, `next_response_time_threshold`,
`resolution_time_threshold`, `only_during_business_hours`), aplicar por
conversa (`sla_policy_id` no update da conversa) ou por regra de
automação (D6). Estado: `applied_slas`/`sla_events` na conversa.
- Tela: Central › SLA (políticas) + na conversa: seletor de política e
  relógio com "resposta em X min" verde/amarelo/vermelho; badge na lista;
  notificação em `workspace_notifications` quando estourar (poll ou webhook
  `conversation_updated`).
- Relatório: `GET /api/v2/accounts/{id}/reports?metric=...` com SLA
  (verificar disponibilidade na versão instalada; senão calcular das
  `applied_slas`).
- Checagem: política de 5 min, conversa sem resposta → alerta no sino e
  vermelho na lista.

### D3. Atributos personalizados de contato e conversa (Médio)
API: `GET/POST/PATCH/DELETE /api/v1/accounts/{id}/custom_attribute_definitions`
(`attribute_model`: `contact_attribute` | `conversation_attribute`; tipos
texto, número, data, lista, checkbox, link); valores em
`contact.custom_attributes` / `conversation.custom_attributes` (PATCH).
- Tela: Central › Atributos (definições) + painel do contato e da conversa
  com os campos; filtro na lista por atributo (usar
  `POST /conversations/filter`, já existe `filtrarConversas`).
- Decisão de produto: quais campos do Workspace viram atributo (CPF,
  convênio, parceiro/código, banco, motivo do contato) e sincronização
  única de ida (Workspace → Chatwoot) para os já existentes em
  `chat_contato_meta`/`chat_conversa_meta`. Não duplicar fonte da verdade:
  o Workspace continua dono; o atributo é espelho para filtro/automação.
- Checagem: criar "Convênio" lista, preencher em 2 contatos, filtrar.

### D4. Pesquisa de satisfação ao encerrar (Pequeno)
Nativo: inbox › CSAT (`csat_survey_enabled` no PATCH da inbox) — ao
resolver, o Chatwoot manda a pergunta pelo mesmo canal; a resposta vai em
`csat_survey_responses`. Como nossa inbox é do tipo API, verificar que o
canal API envia o CSAT como mensagem (o engine só espelha `message_created`
outgoing — a mensagem de CSAT tem `content_type: input_csat`; o engine deve
enviar o texto e o link `survey_url`).
- Tela: relatório CSAT (`GET /api/v1/accounts/{id}/csat_survey_responses`)
  por atendente/período; toggle por inbox em Central › Canais.
- Texto da pesquisa: definir com o Bruno (nota 1–5 + comentário).
- Checagem: resolver conversa de teste → cliente recebe a pergunta →
  responde → aparece no relatório.

### D5. Central de ajuda (Médio)
Nativo: Portais (`/api/v1/accounts/{id}/portals`, categorias e artigos
`/portals/{slug}/articles`), site público em `chat.brspromotora.com.br/hc/<slug>`
(ou domínio próprio, ex.: `ajuda.brspromotora.com.br`).
- Decisão de produto: qual conteúdo publica (FAQ do parceiro, regras dos
  convênios da Base de Conhecimento já existente), público ou por link.
- Tela: Central › Central de Ajuda (portal, categorias, artigos com o
  editor já usado nos Templates); no composer, botão "Enviar artigo" que
  busca por título e insere o link.
- Checagem: publicar 1 artigo, abrir a URL pública, enviar o link por uma
  conversa.

### D6. Regras de automação (bônus, Pequeno)
`/api/v1/accounts/{id}/automation_rules`: evento (conversa criada,
mensagem criada, atualizada) + condições (inbox, atributo, etiqueta,
conteúdo) + ações (atribuir time/agente, etiquetar, SLA, mensagem, webhook).
É o que liga D2 e D3 sem código: "inbox Suporte → time Suporte + SLA
padrão". Tela simples de lista/criar/editar; começar pelas regras de
roteamento que hoje o Workspace faz em `atribuirDepartamentosAutomaticos`.

Ordem sugerida para D: D1 → D3 → D6 → D2 → D4 → D5.
