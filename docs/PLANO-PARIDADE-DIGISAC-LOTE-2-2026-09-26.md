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
