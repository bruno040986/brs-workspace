# Roteiro — BRS Messenger M0: fundação tempo real + validação ao vivo (para o Sonnet)

> Plano: `PLANO-MESSENGER-V2-E-CUSTO-VERCEL.md` §3.3 (M0). Aprovado pelo Bruno em
> 13/09 ("fazemos o 1 de imediato, depois começamos o 3"). Parte 1 (custo Vercel)
> já está em produção (`337c372`) e criou o helper `src/lib/polling-visivel.ts`
> usado aqui. Migration desta fase: `20260914091154_realtime_chat_status_reacoes`
> (Fable, aplicada). Sem permissão nova. Tudo em `src/components/conversas/atendimento/`
> + `src/lib/central-conversas/actions.ts`.

## Regras de ouro (iguais às fases A/B/C)
- **Messenger ≠ CRM**: portar só fundação (Realtime, visibilidade, rolagem,
  feedback otimista). Nunca lead/oferta/tabulação/receptiva×disparo.
- `content_attributes.origem` é enum aberto — nunca `!== 'engine'`.
- Tema `--msn-*`. `npm run build` verde + `npx tsc --noEmit` limpo + `npm test`.
- Decidir sozinho e relatar; só consultar o Bruno em ação irreversível.

## Fatos verificados (14/09) que governam a implementação

1. **`chat_atendimento_sinais` NÃO serve para a conta BRS.** O engine só emite o
   sinal quando `inst.agente_parceiro_id` existe (`bridge.ts:646`) e a policy
   só libera leitura ao parceiro dono. Não copiar o desenho do CRM.
2. **O que já chega para a BRS é `chat_eventos`**: o engine grava
   `mensagem_recebida` / `mensagem_enviada_aparelho` por mensagem de WhatsApp
   (`bridge.ts:314`), payload com `conversation_id`, `inbox_id`, `grupo`,
   `preview`. Policy: `app_private.has_permission('conversas','can_view')` —
   **sem filtro de conta**: hoje o atendente da BRS recebe também os eventos
   de todos os parceiros do CRM e refaz a lista à toa. Filtrar por
   `chatwoot_account_id` (o id da conta BRS vem em
   `getCanaisAtendimento().conta.chatwootAccountId`, já carregado no bootstrap
   do hook).
3. Mensagem enviada por OUTRO atendente pelo Chatwoot **não gera evento** —
   fica para o poll de segurança (30 s). A própria UI já atualiza o que ela
   mesma envia.
4. Ticks e reações: `chat_mensagem_status` (chatwoot_message_id, conta_id,
   status, atualizado_em) e `chat_mensagem_reacoes` (chatwoot_message_id,
   conta_id, jid, emoji) agora estão na publication com policy da conta BRS.
   O payload **não tem conversation_id** — comparar `chatwoot_message_id` com
   os ids das mensagens carregadas na thread aberta.
5. Fotos de contato **já são renderizadas** (`meta.sender.thumbnail` em
   ListaConversas 285/348, ThreadConversa 256, PainelContato 324/643). O que
   falta é só o fallback quando a URL quebra (CRM `7175672`).
6. A thread do Workspace **não pagina** ainda (`getMensagens(id, before?)` aceita
   `before`, mas `carregarThread` não usa). A âncora de histórico do hook de
   rolagem fica preparada, sem uso.
7. Padrão de canal Realtime: nome com sufixo aleatório (dock e `/conversas`
   montam o hook ao mesmo tempo); `supabase.removeChannel` no cleanup; client
   `@/lib/supabase/client`.

## Frentes (cada uma pode ser um commit)

### (a) `useAtendimento.ts` — Realtime como caminho principal, poll como segurança
- Linhas 223–236 (lista + contadores a cada 6 s) e 242–253 (thread a cada 6 s):
  trocar `setInterval` por `pollingVisivel(fn, 30_000, { imediato: false })`
  (o carregamento inicial já é feito no corpo do efeito). Manter as deps.
- Efeito Realtime (255–273): passa a depender também do id da conta
  (`canaisAtendimento?.conta?.chatwootAccountId`); sem id, não assina. Adicionar
  `filter: \`chatwoot_account_id=eq.${accountId}\`` no `.on` de `chat_eventos`.
- No mesmo canal, mais dois `.on('postgres_changes', { event: '*', schema:
  'public', table: 'chat_mensagem_status' | 'chat_mensagem_reacoes' })`: se
  `payload.new.chatwoot_message_id` estiver entre os ids de `mensagens`
  (manter um `ref` com o Set de ids, atualizado quando `mensagens` muda) →
  `carregarThread(selecionadaIdRef.current, { silencioso: true })`. Debounce de
  400 ms (vários ticks chegam juntos).
- Não remover o poll: é a rede de segurança do fato 3.

### (b) `ListaConversas.tsx` — item memoizado
- A linha da conversa é renderizada inline no `map` (≈ linhas 270–400). Extrair
  para `const ItemConversa = memo(function ItemConversa({...}) {...})` FORA do
  componente, com props primitivas/estáveis (`conversa`, `selecionada: boolean`,
  `onSelecionar`, `presenca`, etc.). `selecionarConversa` já é `useCallback` no
  hook. Motivo: a lista inteira remontava a cada poll e a cada tecla da busca
  (CRM `d2fd373`).

### (c) Avatar com fallback
- Novo `AvatarContato.tsx` na pasta: recebe `thumbnail`, `nome`, `tamanho`,
  `quadrado?` (grupo); `useState(falhou)` + `onError` → cai para as iniciais
  (mesma aparência `--msn-avatar-*` de hoje). `useEffect(() => setFalhou(false),
  [thumbnail])`. Usar nos 5 pontos do fato 5.

### (d) Rolagem da thread — portar `useRolagemThread`
- Copiar de `brs-alvoconsig/apps/web/src/components/crm/atendimento/useRolagemThread.ts`
  (+ `.test.ts`) para `src/components/conversas/atendimento/useRolagemThread.ts`
  e `src/components/conversas/atendimento/__tests__/useRolagemThread.test.ts`.
  O runner do Workspace é `node --test` (`npm test`) — adaptar `vitest`/`expect`
  para `node:test` + `node:assert/strict` se o teste original usar vitest; só as
  funções puras (contagem de novas, foto do thread) precisam de teste.
- `ThreadConversa.tsx`: remover os dois efeitos `scrollIntoView` (linhas
  125–131) e o `fimRef`; `containerRef` do hook vai no
  `div.brs-messenger-chat-scroll` (linha 344); cada mensagem renderizada ganha
  `{...{ [ATRIBUTO_CHAVE_ROLAGEM]: chaveItem(m) }}` (chave = id da mensagem);
  `onScroll={aoRolarMensagens}`; `onLoad` de imagem/áudio → `aoMidiaCarregar`.
  Pílula "N nova(s) ↓" (tema `--msn-*`) quando `novasNaoLidas > 0`, clique =
  `irParaOFim()`. Depois de enviar (texto/anexo/áudio/resposta rápida) chamar
  `irParaMensagemEnviada()`. Com `buscaAberta`, manter o comportamento atual
  (não rolar). `armarAncoraHistorico` fica exportado, sem uso (fato 6).

### (e) Assumir/transferir com feedback imediato (CRM `d70b30b`)
- `useAtendimento.transferir` e `atribuirAgente` (386–422): aplicar o
  `setSelecionada(...)` **antes** do `await`; em erro, restaurar o valor anterior
  (guardar `prev` fora do setState) e propagar o erro.
- `ThreadConversa.tsx` (modal de transferir, ≈ 560–610): fechar o modal
  imediatamente, estado `alterando: 'assumindo' | 'transferindo' | null` com
  spinner e texto "Transferindo…" no botão do cabeçalho enquanto pendente,
  toast de sucesso ("Transferido para X" / "Atendimento assumido") e de erro
  (o hook já expõe `erro`).
- "Assumir para mim": botão no cabeçalho quando a conversa não está com o
  atendente atual. O id do agente Chatwoot do usuário logado: procurar onde a
  presença é gravada (`getMinhaDisponibilidade`/`mudarPresenca` em
  `actions.ts`) — a resolução user→agente já existe ali; expor um
  `getMeuAgente()` (ou incluir `meuAgenteId` na resposta de
  `meusDepartamentos`) e usar `atribuirAgente(meuAgenteId)`. Se a resolução
  não existir no servidor, **reportar e pular o botão** (não inventar mapeamento).

### (f) Notas de sistema (opcional, só se for barato)
- Transferir/assumir/encerrar gravam nota privada (Fase A). Se hoje elas
  renderizam como nota comum, exibir as que começam com 🔁/✅/🏁 como aviso
  central âmbar (CRM `51936fc`). Não criar formato novo de nota.

## Aceite
- Aba oculta: nenhuma requisição de lista/thread; ao voltar, atualiza uma vez.
- Mensagem recebida no WhatsApp aparece na lista e na thread aberta em < 2 s sem
  poll (conferir no Network: só `getMensagens`/`getConversas` disparados pelo
  evento). Evento de parceiro do CRM **não** dispara nada na BRS.
- ✓✓ e reação aparecem na thread aberta sem esperar 30 s.
- Digitar na busca não remonta a lista (React DevTools / sem flicker).
- Foto quebrada vira iniciais, sem ícone de imagem quebrada.
- Thread: abrir conversa vai ao fim; mensagem nova com o operador lá em cima
  mostra "1 nova ↓" e não puxa a rolagem; enviar rola ao fim.
- Transferir: modal fecha na hora, cabeçalho mostra "Transferindo…", toast;
  erro do servidor restaura o atendente anterior.

## Validação ao vivo das fases A/B (Bruno, depois de (a)–(e) no ar)
Checklist a marcar em produção, com UMA conexão Baileys da conta BRS:
1. Departamentos: conversa nova cai no departamento padrão da conexão; abas
   Chats/Fila/Contatos com contadores certos; filtro por departamento.
2. Transferir para departamento + atendente + comentário → nota interna
   aparece; presença Online/Ausente/Offline muda no seletor.
3. Vínculo no contato (Vincular a → parceiro) → próxima conversa do mesmo
   número já vem vinculada; override na conversa não altera o contato.
4. Resposta rápida com departamento X só aparece para quem é de X; `/` no
   composer filtra; anexo sai junto.
5. Agendamento: mensagem agendada sai com a aba fechada (worker de 1 min);
   cancelar antes da hora impede.
6. Ticks ✓/✓✓/lida; reação recebida; "Dispositivo externo" quando a mensagem
   sai do celular; responder citando (a citação chega no WhatsApp? — pendência
   conhecida do engine, registrar o resultado).
7. Histórico do contato com protocolo + export CSV; galeria de mídias.
Registrar cada item como OK / falhou (com print) em `docs/VALIDACAO-M0.md`.
