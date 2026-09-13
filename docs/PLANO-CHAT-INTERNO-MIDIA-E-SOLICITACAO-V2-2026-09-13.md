# Plano — Chat interno com mídia + Solicitação de simulação v2 (13/09/2026)

Autor: Fable, a partir da homologação do Bruno em 13/09 (chat interno "em
pleno funcionamento, muito rápido" após `f87efee` + revisão `780f09d`).
Executor: Sonnet, em worktree própria do `brs-alvoconsig`
(`crm/chat-midia-solicitacao-v2`). Banco: migration ESCRITA e no repo, mas
**AINDA NÃO APLICADA** (ver seção Banco) — o Sonnet não aplica migration;
D2 depende dela, C1/C2/C3/D1 não.

Leia antes: `PLANO-CHAT-INTERNO-E-SIMULACAO-2026-09-12.md` (incl. a nota de
revisão no fim: `useToasts` estável, `assinarComReconexao`, canal de aviso).

## O que o Bruno pediu (13/09)

1. Ferramentas essenciais no chat interno: envio de arquivos, imagens,
   **colar imagem** (Ctrl+V já carrega pra enviar, como no WhatsApp Web),
   áudio, emojis e figurinhas.
2. "+ Direto" não mostra as fotos de perfil; a conversa "Você" também não.
3. **Tirar o botão "Solicitar simulação" do chat interno.** A solicitação
   nasce (a) na tela de Atendimento, na conversa com o lead — já vinculada
   ao lead — ou (b) na tela de Solicitações, informando nome, CPF e data de
   nascimento (cliente sem cadastro), com documentos opcionais.

## O que já existe e DEVE ser reaproveitado (não inventar)

- Migration `20260905125420` (aplicada): `crm_chat_mensagens.tipo` aceita
  `imagem | audio | documento | figurinha`; payload
  `{ bucket: 'parceiro-midias', path: 'chat-interno/<tenant>/<canal>/<uuid>.<ext>', mime, nome, tamanho }`.
  Bucket **privado** já existe; leitura por URL assinada.
- `lib/crm/fotos.ts`: padrão de caminho por tenant + `createSignedUrl` (1 h)
  + assinatura em lote. Copiar o padrão, não o arquivo.
- `components/crm/atendimento/EmojiPicker.tsx` (já usado no ConversaCentro).
- `ConversaCentro.tsx:339-345`: gravação de áudio com `MediaRecorder`
  (escolha de MIME suportado). Extrair pra um hook `useGravadorAudio` em
  `components/crm/atendimento/` e usar nos dois lugares.
- `MinhaFotoMenu.tsx` / `atendimento-actions.ts`: upload por Server Action
  com `FormData` (validação de MIME/tamanho no servidor).
- `solicitarSimulacao` / `responderOfertaSimulada` / `solicitacoes-actions.ts`
  / `SolicitacoesPainel.tsx` / `solicitacoes-shared.ts` (máquina de estados,
  funções puras testadas).
- `PainelLead.tsx` + `Simulador.tsx` (atendimento): é ao lado do Simulador
  que entra o "Solicitar simulação" com o lead já fixo.
- `chat-interno-shared.ts`: `previewMensagem`, `mapMensagemRealtime` — os
  tipos novos entram AQUI (função pura + teste), não no componente.

## Banco — migration `20260913165513` (PENDENTE de aplicar)

**Não aplicada em 13/09:** o `apply_migration` via MCP foi bloqueado pelo
classificador do modo automático. Aplicar pela pasta principal do
`brs-workspace` (Bruno, ou Fable com autorização explícita):
`npx supabase migration list` e depois `echo Y | npx supabase db push`
(se a main tiver migration mais nova que a da branch, `--include-all`).
Até lá, D2 fica bloqueado; C1/C2/C3/D1 podem seguir.

O que ela faz em `crm_solicitacoes_operacionais`:

- `pessoa jsonb null` = `{ nome, cpf (11 dígitos, só números), nascimento 'AAAA-MM-DD' }`
  — só quando não há lead.
- `anexos jsonb not null default '[]'` = `[{ bucket, path, mime, nome, tamanho }]`,
  path `solicitacoes/<agente_parceiro_id>/<solicitacao_id>/<uuid>.<ext>`
  no bucket privado `parceiro-midias`.
- Check de identidade: `relacionamento_id OR contato_id OR pessoa ? 'cpf'`.
- `snapshot_condicoes` (já existia) guarda a oferta respondida — é como uma
  solicitação **sem lead** recebe resposta (não há `crm_ofertas` sem contato).

## C — Chat interno

**C1. Fotos (5 min).** `ChatInterno.tsx:329`: `<Avatar ... fotoUrl={u.fotoUrl} />`
no "+ Direto". Canal "Você" (`:306`): usar a foto do próprio usuário
(`fotoPorUsuario.get(meuId)`), ícone só como fallback.

**C2. Remover o botão "Solicitar simulação" e o `SolicitarSimulacaoModal`
do chat interno.** Os cartões `solicitacao_simulacao`/`oferta_simulada`
CONTINUAM sendo renderizados (o servidor segue avisando pelo chat); o botão
"Responder com oferta simulada" do cartão continua funcionando.
`solicitarSimulacao` deixa de ser importada aqui.

**C3. Anexos.** Server Action nova em `chat-interno-actions.ts`:
`enviarAnexoInterno(canalId, form: FormData)`:
- `canalDoUsuario` (membro) → valida MIME e tamanho por tipo: imagem
  (`image/jpeg|png|webp|gif`, ≤ 10 MB), documento (pdf, doc/docx, xls/xlsx,
  txt, csv, zip; ≤ 20 MB), áudio (`audio/webm|ogg|mp4|mpeg`, ≤ 10 MB),
  figurinha (`image/webp|png`, ≤ 1 MB) → `admin.storage.from('parceiro-midias').upload(path, ...)`
  → `inserirMensagem(tipo, conteudo = legenda opcional, payload)`.
- Tipo é decidido no SERVIDOR pelo MIME + intenção (`form.get('como')` =
  `'figurinha'` só quando o usuário escolheu figurinha), nunca confiado do
  cliente. Extrair `classificarAnexo(mime, tamanho, como)` como função pura
  em `chat-interno-shared.ts` + testes (aceita/recusa/limite).
- Leitura: `assinarAnexoInterno(mensagemId)` → confere que a mensagem é de
  um canal do usuário (mesma `canalDoUsuario`) e que `payload.path` começa
  com `chat-interno/<tenant>/` → URL assinada de 10 min. O componente
  assina sob demanda ao renderizar (cache em `useState<Map>`), porque o
  Realtime entrega só o path. A carga inicial/poll também NÃO pré-assina
  (uma regra só, menos código).
- UI (`ChatInterno.tsx`): botão de clipe (arquivo/imagem), botão de emoji
  (`EmojiPicker`), botão de microfone (segurar pra gravar, `useGravadorAudio`),
  botão de figurinha (abre seletor de arquivo webp/png e envia como
  figurinha). **Ctrl+V** com imagem no clipboard e **arrastar e soltar**
  → pré-visualização com legenda opcional e botão Enviar (não envia
  sozinho). Render: imagem (miniatura clicável → abre em nova aba pela URL
  assinada), documento (ícone + nome + tamanho + baixar), áudio (`<audio controls>`),
  figurinha (imagem 160 px sem balão).
- `previewMensagem`: `imagem → '📷 Imagem'`, `audio → '🎤 Áudio'`,
  `documento → '📎 <nome>'`, `figurinha → 'Figurinha'` (com legenda, a
  legenda). Teste.
- Figurinhas v1 = enviar um arquivo como figurinha. **Biblioteca de
  figurinhas do parceiro (pacotes reutilizáveis) fica pra depois** — exige
  tabela nova; não abrir sozinho.

## D — Solicitação de simulação v2

**D1. Atendimento.** Em `PainelLead.tsx`, ao lado do `Simulador`, botão
"Solicitar simulação" → modal (mover `SolicitarSimulacaoModal` do chat pra
`components/crm/solicitacoes/SolicitarSimulacaoModal.tsx`) com o lead JÁ
fixo (sem campo de busca), mesmos campos de hoje. Chama a mesma
`solicitarSimulacao({ contatoId })`. Depois de enviar: toast + link "ver em
Solicitações".

**D2. Tela de Solicitações: "Nova solicitação".** Mesmo modal, com duas
abas na identidade: **"Lead da carteira"** (busca `getLeads`, como era no
chat) ou **"Cliente sem cadastro"** (nome, CPF, data de nascimento —
obrigatórios os três). Anexos opcionais (documentos/imagens, até 5, mesmos
limites do C3). `solicitarSimulacao` passa a aceitar
`{ contatoId } | { pessoa: { nome, cpf, nascimento } }`:
- sem lead: `contato_id = null`, `relacionamento_id = null`, `pessoa`
  gravada com CPF só dígitos (validar 11 dígitos + DV; função pura
  `validarCpf` + `validarNascimento` em `solicitacoes-shared.ts`, com
  testes); `payload.nome/cpfMascarado` preenchidos a partir de `pessoa`
  pra o painel e o cartão do chat não mudarem.
- anexos: registro primeiro (pra ter o `solicitacao_id` do path), depois
  `anexarNaSolicitacao(solicitacaoId, FormData)` por arquivo (valida posse
  pelo tenant + status aberto), que faz `update anexos = anexos || novo`.
  Painel e modal de responder listam os anexos com URL assinada sob
  demanda (`assinarAnexoSolicitacao(solicitacaoId, indice)`, confere
  tenant + prefixo `solicitacoes/<tenant>/`).
- `responderOfertaSimulada` **sem lead**: não cria `crm_ofertas` nem
  enfileira `mover_oferta`; grava a oferta em `snapshot_condicoes`
  (mesmo formato do `OfertaSimuladaPayload`, sem `contatoId`), marca
  `respondido`, cartão no chat sem o botão "Enviar ao lead" e sem link
  "abrir lead". Com lead, tudo como hoje E também grava
  `snapshot_condicoes` (histórico sobrevive ao expurgo).
- `mapSolicitacao`/tipo `SolicitacaoOperacional`: `pessoa`, `anexos`,
  `resposta` (do snapshot). Cartão do painel mostra CPF mascarado + idade
  quando vier de `pessoa`, e "Cliente sem cadastro" como selo.
- `listarSolicitacoes` não muda.

**D3. Depois (não agora):** "Criar lead a partir da solicitação" (abre o
`CriarLeadModal` pré-preenchido e vincula `contato_id`).

## Ordem sugerida (Sonnet)

1. C1 + C2 (minutos) — já dá pra publicar.
2. D1 + D2 (modal compartilhado, `pessoa`, anexos, resposta sem lead).
3. C3 (mídia no chat: começar por imagem + colar; depois documento, áudio,
   emoji, figurinha).

Cada etapa: typecheck, `npm test` (funções puras novas com teste), lint nos
arquivos tocados, merge na main, push. Recado curto pra revisão (Fable).

## Fora de escopo / decisões que não são do Sonnet

- Biblioteca de figurinhas do parceiro (tabela nova).
- Realtime no painel de solicitações (tabela fora da publicação).
- Notificação push/sonora de solicitação nova (decisão de produto).

## E — Campanhas: seta verde = liberada (pedido do Bruno, 13/09 17h)

`components/crm/campanhas/CampanhasHub.tsx:102-106`: hoje a seta do card
disponível é `<ArrowRight className="h-4 w-4 text-primary" .../>` —
`--color-primary` é a cor de marca (vermelho/rosa, `globals.css:61-62`),
que lê como "bloqueado", não "liberado". A leitura confunde com o card
indisponível ao lado (badge cinza "em breve"/"em andamento" — esse já está
certo, não mexer). Troca só a cor da seta dos cards liberados: de
`text-primary` para `text-emerald-600 dark:text-emerald-400` (mesmo verde
já usado em `STATUS_COR.ativa` e em `Concretizados` na tabela — não inventar
tom novo). Uma linha, sem lógica nova.
