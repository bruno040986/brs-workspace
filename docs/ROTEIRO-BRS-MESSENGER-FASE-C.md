# Roteiro — BRS Messenger, Fase C: grupos de WhatsApp (para o Sonnet)

> Spec: `SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md` (§0, §5 grupos, §11 contrato do
> engine). Contrato do engine: `RECADO-ENGINE-GRUPOS-BRS-MESSENGER.md` — as 4
> entregas estão PUBLICADAS (commit engine `f1d6bb9`, URL base `ENGINE_URL`).
> Sem migration nesta fase. Sem permissão nova (tudo sob `conversas`).

## Regras de ouro (iguais às fases A/B)
- **Messenger ≠ CRM**: nunca ler `chat_instancias.papel`/`permite_grupos`. A
  única capacidade que gateia grupo é `provedor === 'baileys'` (Z-API devolve
  501 `PROVEDOR_NAO_SUPORTADO` — a UI esconde a aba Membros e as ações).
- `content_attributes.origem` é enum aberto — nunca `!== 'engine'`.
- Tema `--msn-*` dentro de `/conversas` e do dock.
- `npm run build` verde + `npx tsc --noEmit` limpo; commit só dos arquivos da
  fase. Decidir sozinho e relatar; só consultar o Bruno em ação irreversível.

## Fatos que governam a implementação (já verificados no código do engine)

1. **Identidade da conversa de grupo.** O engine cria o contato do Chatwoot com
   `identifier = "<instanciaId>:<jid>"`. Grupo = jid terminado em `@g.us`.
   Helper pronto: `parseIdentifier()` em `atendimento/types.ts`; `ehGrupo()` e
   `conversaEhGrupo()` já corrigidos pra essa regra (o `-group` antigo nunca
   batia com jid real — corrigido na revisão Fable de 07/09).
2. **Endpoints do engine** (Bearer `ENGINE_API_TOKEN`, client em
   `src/lib/central-conversas/engine.ts`):
   ```
   GET  /instancias/:id/grupos/:jid            → { jid, nome, descricao, foto, criado_em, dono, membros:[{ jid, numero, nome, admin, eu }] }
   GET  /instancias/:id/contatos?q=&page=&limit=  → { itens:[{ jid, numero, nome, foto }], total, page }   (limit ≤ 200)
   POST /instancias/:id/grupos  { nome, participantes:[jid|E164] }  → { jid, nome }
   POST /instancias/:id/grupos/:jid/participantes { acao:'add'|'remove'|'promote'|'demote', jids:[] } → { ok, resultado:[{ jid, status }] }
   GET  /instancias/:id/grupos/:jid/convite     → { link }
   POST /instancias/:id/grupos/:jid/sair        → { ok }
   ```
   Erros de domínio: HTTP + `{ erro, codigo }` com `codigo` ∈
   `NAO_MEMBRO` (403/404) · `NAO_ADMIN` (403) · `INSTANCIA_DESCONECTADA` (409) ·
   `PROVEDOR_NAO_SUPORTADO` (501) · `GRUPO_NAO_PERMITIDO` · `FALHA_WHATSAPP` (502).
   `membros[].nome` vem `null` no metadata — resolver pelo cache de contatos
   (`GET contatos`) quando quiser exibir nome; senão mostrar o número.
3. **`POST /instancias/:id/enviar` NÃO espelha envio pra grupo** no Chatwoot
   (`deveEspelhar = ... && !jid.endsWith('@g.us')`). Consequência: depois de
   "Criar grupo", a conversa só aparece na lista quando chegar a primeira
   mensagem de alguém do grupo. Tratar na UI (aviso) — pedido de melhoria ao
   engine já registrado no recado.
4. **`/enviar` exige `operationId` (uuid) quando `ENGINE_DURABLE_EVENTS` está
   ligado** no engine. O client `engine.enviar` do Workspace não manda — passar
   a mandar SEMPRE `operationId: crypto.randomUUID()` (aditivo, inofensivo com a
   flag desligada).
5. **Menção e citação no caminho normal de resposta** (Chatwoot → webhook →
   engine) ainda dependem do ajuste do engine (recado "Revisão Fable 07/09").
   Implementar do nosso lado do mesmo jeito (gravar em `content_attributes`);
   quando eles ajustarem, passa a sair no WhatsApp sem mudança aqui.

## Frentes (cada uma pode ser um commit)

### (a) Client do engine + erros tipados
- `engine.ts`: `chamar()` passa a interpretar `{ erro, codigo }` no corpo de
  erro e lançar `EngineErro` (`class EngineErro extends Error { codigo, status }`).
  Manter o texto genérico pra corpos sem `codigo`.
- Métodos novos: `grupo(instId, jid)`, `contatos(instId, { q, page, limit })`,
  `criarGrupo(instId, { nome, participantes })`,
  `participantesGrupo(instId, jid, { acao, jids })`, `convite(instId, jid)`,
  `sairGrupo(instId, jid)`. `enviar` ganha `operationId` (fato 4) e aceita
  opcional `{ mentions?, quoted? }`.
- Mapa `codigo → mensagem` em PT (um lugar só, reutilizado pelas actions):
  NAO_MEMBRO "Esta conexão não está mais neste grupo." · NAO_ADMIN "Só
  administradores do grupo podem fazer isso." · INSTANCIA_DESCONECTADA "Conexão
  desconectada — reconecte em Canais." · PROVEDOR_NAO_SUPORTADO "Gestão de grupo
  só em conexões Baileys." · GRUPO_NAO_PERMITIDO "Grupo não permitido nesta
  conexão." · FALHA_WHATSAPP "O WhatsApp não respondeu; tente de novo."

### (b) Actions (`grupos-actions.ts`, `'use server'`, perm `conversas`)
- Resolução comum `grupoDaConversa(conversationId)`: busca a conversa
  (`cli.conversa(id)`), `parseIdentifier(meta.sender.identifier)`, valida que a
  instância pertence à conta BRS (`chat_instancias.id = instanciaId AND
  conta_id = contaBrs().id AND deleted_at is null`) e que o jid é `@g.us`.
  NUNCA aceitar instanciaId/jid vindos do cliente pra ações em conversa
  existente — sempre derivar da conversa.
- `getGrupo(conversationId)` → `{ ...DetalheGrupo, souAdmin: boolean,
  provedor }`. `souAdmin` = membro com `eu && admin`. Enriquecer `nome` dos
  membros com uma chamada `contatos` sem `q`, `limit=200`, casando por jid
  (best-effort; se falhar, fica número).
- `alterarParticipantes(conversationId, acao, jids)` — normalizar E.164 do
  input (mesma regra de `iniciarConversaPorTelefone`: 10/11 dígitos → `55`).
- `linkConvite(conversationId)`, `sairDoGrupo(conversationId)` (depois de sair:
  `cli.mudarStatus(conversationId, 'resolved')` + nota interna "Saímos do
  grupo por <usuário>"), `buscarContatosConexao(instanciaId, q, page)` (aqui o
  instanciaId vem do cliente porque não há conversa ainda — validar posse pela
  conta BRS igual).
- `criarGrupo({ instanciaId, nome, participantes, mensagemInicial? })`:
  valida posse, `engine.criarGrupo`, e se `mensagemInicial` → `engine.enviar(
  instId, jid, assinada, { operationId })`. Devolve `{ jid, nome }`. UI avisa
  "O grupo aparece na lista quando alguém mandar a primeira mensagem".
- `responderConversa` já aceita `inReplyTo`; adicionar `mentions?: string[]`
  → `content_attributes.mentions` (fato 5).

### (c) Painel do grupo (`PainelContato`, aba Membros)
- A aba Membros já existe e fica oculta quando `membros` vem vazio — passar a
  aparecer quando `ehGrupo(conversa)`; a lista vem de `getGrupo` (sob demanda
  ao abrir a aba, com "Atualizar"). Cabeçalho: foto/nome/descrição, "criado em",
  N membros, chip "Você é admin" quando `souAdmin`.
- Linha do membro: avatar (iniciais), nome ou número, badge "Admin", "você".
  Menu por linha (só se `souAdmin` e não for `eu`): Promover/Rebaixar, Remover
  (confirmar). Botões do topo: "Adicionar membros" (modal com busca em
  `buscarContatosConexao`, paginação, multi-seleção, e campo "número avulso"
  E.164), "Copiar link de convite" (`linkConvite`, copia e mostra), "Sair do
  grupo" (confirmação dura: "Esta conexão sai do grupo e a conversa é
  encerrada. Continuar?").
- Z-API / `PROVEDOR_NAO_SUPORTADO`: aba mostra só o aviso, sem ações.
- Vínculo de grupo↔parceiro: o "Vincular a" da conversa já funciona pra grupo;
  nada novo.

### (d) Criar grupo (`ListaConversas`)
- Botão "Novo grupo" ao lado de "Nova conversa": modal com Conexão (só
  instâncias `provedor='baileys'` e `status='conectada'` de
  `getCanaisAtendimento` — **não** filtrar por `papel`), Nome, Participantes
  (mesmo picker de (c) + números avulsos), Mensagem inicial (opcional).
- Depois de criar: toast "Grupo criado" + aviso do fato 3.

### (e) @menção no composer (`ThreadConversa`)
- Só em grupo. Digitar `@` abre picker com os membros (de `getGrupo`, já
  carregado pela aba ou carregado aqui); escolher insere `@Nome` (ou `@numero`)
  no texto e guarda o jid numa lista de menções do composer (estado do hook,
  zera ao enviar/trocar de conversa). `enviarTexto` manda `mentions: [jid]`.
- Render de mensagem recebida com `content_attributes.mentions`: destacar
  `@…` no texto (negrito/cor) — só visual, sem lookup.

### (f) Lista e cabeçalho
- Item da lista de grupo: avatar quadrado (já é), prévia com o nome do
  remetente (usar `content_attributes.sender.nome` da
  `last_non_activity_message` quando existir; senão o prefixo do texto).
- Cabeçalho da thread em grupo: "N membros" (de `getGrupo`, se já carregado) e
  o chip do departamento "Grupos".

## Aceite
- Abrir grupo → aba Membros lista membros com admin/você; ações respeitam
  `souAdmin`; erro `NAO_ADMIN` aparece como mensagem em PT, não como 502.
- Adicionar por contato e por número avulso; remover; promover/rebaixar;
  copiar link abre `https://chat.whatsapp.com/...`.
- Sair do grupo encerra a conversa e registra nota interna.
- Criar grupo pela lista: grupo nasce no WhatsApp com os participantes;
  mensagem inicial (se houver) chega; aviso sobre a conversa aparecer depois.
- Conexão Z-API: aba Membros só com o aviso, nada quebra.
- `@` em grupo insere menção e a mensagem sai com `content_attributes.mentions`.
- Instância desconectada: mensagem clara, sem stack.
