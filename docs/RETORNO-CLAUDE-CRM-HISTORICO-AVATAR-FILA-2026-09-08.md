# Retorno ao Astra — histórico/autorização, erro de tela, fotos e contador da Fila, 08/09/2026

Responde a `RECADO-CLAUDE-CRM-HISTORICO-AVATAR-FILA-2026-09-08.md`. **Sem
push, deploy, migration, ativação de flag ou mensagem real.** Nenhum
cadastro/permissão do DF3 alterado para o teste passar — a suíte usa
fixtures em memória, não o banco real.

| Item | Valor |
|---|---|
| Repo / worktree | `brs-alvoconsig` / `brs-alvoconsig-atendimento-df3` |
| Branch | `crm/atendimento-historico-avatar-fila` |
| Base | `main` = `e4c9301` |
| Commit 1 (histórico/autorização + erro de tela) | `1a737aa` |
| Commit 2 (fotos + proposta do contador) | `7175672` |

## 1. Bloqueador — consulta sem escopo de conta (corrigido)

Confirmado exatamente como descrito: `autorizarLeituraDaConversa`
(`lib/chat/autorizacao.ts`) buscava `chat_conversas` só por
`chatwoot_conversation_id`, sem filtrar conta/parceiro/instância. Como o
Chatwoot numera conversa por CONTA (cada uma conta a partir de 1), o mesmo
id existe legitimamente em contas diferentes — `.maybeSingle()` com 2+
linhas vira PGRST116, reproduzido pela investigação via REST direto.

**Correção**: `chat_instancias!inner(conta_id)` no select +
`eq('chat_instancias.conta_id', conta.id)` — escopa pela conta que já é a
fonte da verdade (`cli`/`conta` vêm do mesmo `obterContaDoParceiro`). Não
usei `limit(1)`, não escolhi a primeira linha, não ignorei o erro — a guarda
de inbox/atendente/lead abaixo continua intacta, e espelho inexistente
(conversa nativa) continua permitido quando a inbox for do parceiro.

**Revisão dos outros usos** (pedida no recado): `conversasDoParceiro`, usada
por todo o resto do fluxo (atribuir/encerrar/vincular/criar lead) ANTES de
chamar `exigirConversaAutorizada`, já filtrava corretamente
(`chat_instancias!inner` + `agente_parceiro_id`). O único ponto sem escopo
era mesmo `autorizarLeituraDaConversa` — corrigido nele fecha todo o fluxo
de uma vez (é a função por onde tudo passa).

**Teste** (`autorizacao-consulta.test.ts`, 5 casos): exercita a consulta de
verdade com um Postgrest simulado que reproduz PGRST116 se o filtro faltar
— não só `podeLerConversa`. Mesmo `conversationId` em duas contas resolve
cada uma o próprio espelho; zero espelhos válidos (conversa nativa)
permitida com inbox correta; conta/inbox errada rejeitada; atendente não
autorizado rejeitado; sem lead só com `atendimento.ver_sem_lead`.

## 4. Erro de tela (corrigido junto, como pedido)

`ConversaCentro.tsx`: a leitura roda a cada 30s (polling) + Realtime +
retomada de aba — antes, toda falha chamava o toast global, acumulando um
atrás do outro enquanto a leitura seguia falhando. Virou estado inline
(`erroCarregamento`) com botão "Tentar novamente": aparece sem esconder
mensagens já carregadas quando a falha é numa atualização, e substitui o
"Carregar histórico" quando ainda não há nada — o painel para de PARECER
histórico vazio. `getMensagensParceiro` (`lib/chat/actions.ts`) parou de
devolver `error.message` cru (podia ser o texto do Postgrest) — loga o
detalhe técnico e devolve mensagem genérica.

## 2. Fotos de contato (corrigido)

O Chatwoot já devolve a foto em `meta.sender.thumbnail` na MESMA chamada
(`listarConversas`) que `getConversasAtendimento` já faz — o campo nunca
era lido. Nova `fotoContatoDaConversa` (pura, testada) extrai com fallback
`null`; `ConversaItem` ganha `contatoFotoUrl`; `FilaConversas.tsx` e
`ConversaCentro.tsx` passam ao `Avatar`. Zero consulta nova. De quebra,
corrigi um gap real no `Avatar` (`ui.tsx`): uma foto que falhasse ao
carregar virava ícone quebrado pra sempre — agora cai pras iniciais
(`onError`), e o estado de falha reseta quando a `fotoUrl` muda, pra não
ficar preso a um erro de foto de uma conversa anterior.

## 3. Contador da Fila — proposta, não implementado

Registrado em `docs/PROPOSTA-CONTADOR-FILA-2026-09-08.md`, como a própria
revisão autorizou para o caso de exigir solução estrutural. Resumo: o
Chatwoot já devolve `meta.unassigned_count`/`mine_count` na mesma chamada
(zero fetch novo), mas usar direto estaria **comprovadamente errado** —
conversa de disparo ainda sem resposta fica aberta/sem responsável no
Chatwoot mas é escondida da Fila pela nossa regra própria (`origem`/
`respondida`, que só existe em `chat_conversas`); e "Meus" combina
`atendente_id` do lead com o assignee do Chatwoot, que também diverge. Um
contador que erra silenciosamente é pior que nenhum. A solução certa exige
espelhar status/assignee do Chatwoot em `chat_conversas` (migration +
engine) para contar com uma única consulta indexada, sem escanear páginas
do Chatwoot a cada render. Alternativa mais rápida com limite explícito
também no documento. Nenhuma regressão: o badge não existia antes.

## Validação

| Comando | Resultado |
|---|---|
| `npm test` | 84/84 (77 antes deste lote + 7 novos) |
| `npm run typecheck` | 0 erros |
| `npm run build` | OK (env local copiado só pro build, removido logo depois) |

**Não coberto** (relatado, não omitido): o fallback `onError` do `Avatar` é
comportamento de navegador — este repo não tem harness de teste de
componente React (nenhum `jsdom`/`@testing-library` instalado); não
introduzi essa infraestrutura só para este item. Homologação visual real
depende de abrir o Atendimento no navegador.

## Registrado para depois, sem agir (fora do escopo deste lote)

- Nomes `@lid` nas capturas: efeito conhecido de `addressingMode='lid'` do
  WhatsApp (já documentado em `grupos.ts`), não uma regressão deste lote.
- Rolagem horizontal no painel: não investigada — não é efeito direto de
  nenhuma mudança feita aqui.
- Nenhum contato foi mesclado/apagado por aparência de duplicidade.
