# Retorno ao Astra — complemento pré-publicação (vínculo wa_id + getMessage instrumentado), 09/09/2026

Responde ao pedido do Bruno após a investigação da ocorrência "Aguardando
mensagem" na instância 2043. **Sem migration aplicada, sem flag nova, sem
sessão de instância tocada, sem publicação ainda.** Entrega pronta pra
revisão — commit `071b3c3`, branch `crm/identidade-lid-entrega`, worktree
`brs-alvoconsig-identidade-df3` (em cima de `c9329f4`, a rodada 2 já
revisada).

## 1. Vínculo wa_id ↔ chatwoot_message_id no envio via webhook

Confirmado o achado da investigação anterior: `outboundDoChatwoot`
(webhook Chatwoot → engine, mensagem enviada pela caixa de resposta do
Atendimento) nunca gravava `chat_mensagens_mapa`. Corrigido: cada
`enviarBaileys` tem o resultado coletado; depois que TODO o envio termina
sem lançar, cada `wa_id` retornado é vinculado ao `chatwoot_message_id` do
payload — inclusive mensagem com múltiplos anexos (um wa_id por anexo,
todos linkados à mesma mensagem).

**Schema conferido antes de codar, como pedido**: não comportava a relação
1:N ainda — existe um índice único em `chatwoot_message_id` sozinho
(`chat_mensagens_mapa_cw_idx`, só visível via `pg_indexes`, não é uma
constraint nomeada). Proposta de migration em documento separado
(`PROPOSTA-MIGRATION-CHAT-MENSAGENS-MAPA-MULTI-ANEXO-2026-09-09.md`, não
aplicada — migrations continuam saindo só do Workspace). O código já
funciona nos dois estados (antes/depois da migration) sem exigir
coordenação de deploy: antes dela, o 2º+ anexo cai no caminho de
"resultado incerto" (sem afetar o envio); depois, todos ficam vinculados.

Corrigido de passagem, achado ao investigar o mesmo schema:
`mapaPorChatwootId` fazia `.maybeSingle()` sem `.limit(1)` — depois da
migration, uma mensagem multi-anexo teria 2+ linhas e isso viraria
PGRST116 (mesma classe do bug já corrigido em `autorizacao.ts`, lado do
CRM). Adicionado `.order('id').limit(1)` antes do `.maybeSingle()`.

Falha ao registrar o vínculo é estruturalmente incapaz de virar reenvio
automático ou nota de "falha ao enviar": os registros ficam FORA do
try/catch que trata falha de envio de verdade (não é só convenção — é a
estrutura do código), e reusam `gravarMapaComRetentativa` (mesma função já
usada em `espelharMensagemNaConversa`), que nunca lança.

## 2. getMessage instrumentado

Log controlado no NOSSO `logger` (nunca `logBaileys`, que despeja estado
criptográfico bruto sem filtro) — `instId`, `waId` solicitado e
`encontrado` (booleano) a cada chamada. Sem conteúdo de mensagem, sem
chave, sem credencial — testado explicitamente (o texto da mensagem de
teste nunca aparece serializado no log capturado).

## 3. Testes

`bridge-vinculo-webhook.test.ts` (5 casos novos) + 1 caso novo em
`baileys-lid-envio.test.ts`. `npm test` 105/105 (99 da rodada anterior +
6 novos) · `npm run typecheck` 0 erros.

## Aviso importante, repetido do retorno anterior

Mensagens antigas (enviadas antes da publicação deste commit) não entram
retroativamente no cache do `getMessage` nem ganham o vínculo
wa_id↔chatwoot recém-criado — só mensagens enviadas DEPOIS da publicação
passam pelos dois caminhos novos.

## Próximo passo, quando aprovado

1. Publicar o conjunto revisado (merge + push do engine).
2. Confirmar o commit ativo no Railway (`list-deployments`/`get-logs`,
   mesmo procedimento já usado nas investigações anteriores).
3. Repetir o teste na instância 2043 com uma mensagem NOVA (a antiga
   investigada não serve de teste, pelo aviso acima) e conferir: vínculo
   gravado em `chat_mensagens_mapa`, log de `getMessage` aparecendo se
   houver retry, e se a mensagem chega de verdade no aparelho do
   destinatário.

Nada disso foi executado ainda — aguardando aprovação pra publicar.
