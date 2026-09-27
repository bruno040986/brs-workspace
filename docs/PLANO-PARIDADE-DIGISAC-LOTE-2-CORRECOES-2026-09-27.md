# Lote 2 — correções do teste real de 26/09 (Fable, 27/09/2026)

Origem: teste do Bruno no aparelho + Workspace (26/09, 23h). Diagnóstico com código e logs do
Railway (HTTP + deploy). Executor: **Fable = engine** (protocolo/LID) · **Sonnet = Workspace**.
Ordem: engine primeiro (E1–E7, um deploy só, avisar antes: reinicia as 11 instâncias), depois W1–W9.

## Causas encontradas (o que os logs e o código provam)
- **Presença:** NENHUMA chamada `POST /instancias/:id/presenca` chegou ao engine na janela do teste.
  O gate `conversaDaConta` (presenca-actions.ts, filtro por embed `chat_instancias!inner`) devolve
  false e a action sai em silêncio. Bug de Workspace. O engine nunca foi exercitado.
- **Edição do celular → "[sem conteúdo]":** o Baileys 7 entrega a edição como `message.editedMessage`
  (envelope) no `messages.upsert`; o bridge só descarta `protocolMessage`, então espelha o envelope
  vazio como mensagem nova. O `messages.update` (que grava a edição) roda em paralelo.
- **Apagar do celular não risca:** REVOKE chega em `messages.update` com `messageStubType: REVOKE`
  (process-message.js:196) e o handler ignora. Além disso `chat_mensagem_status` tem CHECK
  `in ('enviado','entregue','lido','falhou')` — o Workspace já tenta gravar `'revogada'` e o banco
  recusa em silêncio (por isso o "riscado" hoje é só estado local da tela).
- **Grupo: participantes não entram / mensagem inicial não sai:** `POST .../participantes` respondeu
  200 com `resultado[].status` de erro por item que o Workspace ignora. Baileys 7 endereça grupos
  novos por LID; mandamos PN puro. Mensagem inicial: `/enviar` para `@g.us` passa por
  `resolverDestinoBaileys`/espelho de conversa 1:1 e falha antes do envio (catch engolido).
- **Busca de contatos vazia:** `contatosDaSessao` só enche com `contacts.upsert` (history sync) —
  no Baileys 7 sem store isso quase não vem; a cache nasce vazia a cada boot.
- **"!" vermelho em grupo:** ticks vêm de `messages.update.status`; em grupo LID o Baileys emite
  status 0 (ERROR) para o participante que pede retry (logs: retry a cada envio p/ `…:33@lid`) e
  `atualizarStatusMensagem('falhou')` não respeita a ordem — grava por cima do "entregue".
- **Reação/citação em grupo (Workspace→aparelho):** a key precisa de `participant` = autor da
  mensagem; `mapaPorChatwootId` não devolve `participant_jid`, e o `participant` gravado é PN
  enquanto o grupo é LID.
- **Reação do aparelho em grupo não aparece:** `messages.reaction` usa `r.key.id` → mapa OK, mas
  o `jid` do reator vem `@lid` e a UI agrupa por jid — aparece se o mapa existir; conferir no
  fix E5 com log.
- **Eventos de grupo (entrou por link, promovido/rebaixado) não aparecem:** `group-participants.update`
  e `groups.update` não são tratados.
- **Editar grupo não reflete nome/foto/descrição no Workspace:** o cabeçalho lê o CONTATO do
  Chatwoot (nome/avatar) e o painel lê `groupMetadata` com cache de 6 h (`gruposCache`).
- **Status (B6):** o botão fica em Central de Conversas › (página raiz, cards das conexões) e só
  aparece em conexão **de disparo** conectada. As três conexões do teste são receptivas — comportamento
  esperado, não bug.

## Engine (Fable) — branch `engine/paridade-digisac-lote2`
- **E1** bridge: descartar `msg.message.editedMessage` no `inboundBaileys` (edição vive no `messages.update`).
- **E2** `messages.update` com `messageStubType === REVOKE` → `atualizarStatusMensagem(id, 'revogada')`;
  `'revogada'` entra no tipo e na ORDEM (terminal, vence tudo). Migration no Workspace (W1).
- **E3** ticks em grupo: status 0 (ERROR) de `messages.update` NÃO rebaixa `entregue/lido`; só marca
  `falhou` se nenhum ack positivo chegou em 60 s (ou ignorar ERROR em grupo — decisão no código).
- **E4** grupos LID: antes de `groupCreate`/`groupParticipantsUpdate`, mapear PN→LID via
  `sock.signalRepository.lidMapping.getLIDForPN` (fallback `onWhatsApp`); devolver `resultado[]`
  com `status` legível (`200|403|409|500`) e logar os itens que falharam.
- **E5** `mapaPorChatwootId` devolve `participant_jid`; reação/citação/apagar em grupo passam
  `participant` (mapeado p/ LID quando o grupo é LID). Logar a key enviada.
- **E6** `group-participants.update` (add/remove/promote/demote/join via link) e `groups.update`
  (subject/desc/picture) → nota interna na conversa do grupo ("Fulano entrou pelo link", "X agora é
  admin") + `atualizarContato` (nome) e avatar do grupo no Chatwoot + invalidar `gruposCache`.
- **E7** `/enviar` para `@g.us`: pular `resolverDestinoBaileys`/onWhatsApp e espelhar na conversa do
  grupo (garantirConversa com ehGrupo). Mensagem inicial do "Novo grupo" volta a sair.
- **E8** contatos: manter a cache também com quem já conversou (`chat_conversas` da instância) e
  com `pushName` (já existe) — busca deixa de vir vazia.
- **E9** presença: logar `presenceSubscribe`/`sendPresenceUpdate` (info) para o próximo teste ter rastro;
  enviar `available` antes de `composing` (WhatsApp só mostra "digitando" de quem está online) e
  `unavailable` 10 s depois de `paused` (preserva notificações do celular).

## Workspace (Sonnet) — branch `messenger/paridade-digisac-lote2`
- **W1** migration: CHECK de `chat_mensagem_status.status` ganha `'revogada'`; a thread trata
  `m.status === 'revogada'` como apagada (riscado + "🚫 apagada pelo remetente").
- **W2** presença: trocar o gate por duas consultas simples (instância pertence à conta BRS +
  conversa existe) e devolver `{ok:false, error}` com motivo (nunca falhar em silêncio); logar no
  servidor quando o gate barrar.
- **W3** Novo grupo / Adicionar membros: campo de números aceita vários (vírgula, `;`, espaço/Enter →
  badge); mostrar por item o `status` devolvido pelo engine ("não está no WhatsApp", "já é membro",
  "recusou"...); não dizer "aberto na lista" se `conversationId` vier nulo.
- **W4** painel do grupo: após Editar grupo, recarregar cabeçalho (nome/avatar do contato Chatwoot)
  e descrição — depende de E6; até lá, atualizar localmente com o que foi salvo.
- **W5** editor inline de edição (print): layout quebrado — textarea sobrepõe os botões; usar o
  mesmo padrão do modal de nota (largura mínima 260, botões abaixo).
- **W6** telas D1/D3/D4/D6/D5: adotar o padrão visual das páginas do Workspace (`.page-shell`,
  cabeçalho de página, tabela/cards como em Tags e Respostas rápidas; modais como o de Tags), em
  vez de `.card/.input` soltos. Sem mudar comportamento.
- **W7** Status (B6): texto de ajuda na página de conexões dizendo que o botão aparece só em
  conexão de disparo conectada.
- **W8** thread: "!" só quando `status === 'falhou'` E não houver tick positivo (E3 já evita, mas a
  UI mostra o que vier).
- **W9** relatório de teste: repetir os itens abaixo depois do deploy.

## Re-teste (Bruno)
edição celular→Workspace · apagar celular→Workspace · digitando nos dois lados · novo grupo com 2
números + mensagem inicial · adicionar membro · entrar por link (aviso na conversa) · promover/rebaixar
(aviso) · reação e citação Workspace→aparelho em grupo · reação do aparelho em grupo · ticks em grupo ·
editar grupo (nome/foto/descrição no Workspace) · busca de contatos.
