# Retorno ao Astra — rodada 2 do complemento pré-publicação, 09/09/2026

Responde a `REVISAO-COMPLEMENTO-071b3c3-2026-09-09.md`. **Sem migration
aplicada, sem flag, sem sessão de instância tocada, sem publicação ainda.**
Commit `dca438f`, branch `crm/identidade-lid-entrega`, sobre `071b3c3`.

## 1. Corrigido: gravarMapaMensagem não ignora mais qualquer 23505

Confirmado o achado: `error.code !== '23505'` tratava como sucesso
QUALQUER conflito de índice único, inclusive o de
`chatwoot_message_id` sozinho — o teste anterior simulava o erro por
`throw` direto no mock, divergindo do comportamento real (swallow), então
não provava nada sobre o código de verdade.

Corrigido: ao ver 23505, a função consulta a linha existente pra MESMO
`(instancia_id, wa_id)` e só trata como sucesso se ela for EQUIVALENTE —
mesma conta, destino, mensagem e conversa. Testado contra a função REAL
(não o mock de bridge), num arquivo novo (`db-mapa-mensagem.test.ts`) com
cliente Supabase simulado na fronteira insert/select, reproduzindo os dois
índices únicos reais: insert sem conflito; retry equivalente não lança;
mesmo wa_id com conteúdo divergente lança; conflito por
`chatwoot_message_id` sozinho (wa_id novo) lança; falha na consulta de
verificação lança (nunca "não achei então tá tudo bem").

## 2. Corrigido: sucesso parcial não perde mais os vínculos já confirmados

Reproduzi o cenário exato que a revisão descreveu (1º enviado, 2º falha) e
confirmei o mesmo resultado antes de corrigir. A causa era registrar em
lote só depois do loop inteiro terminar sem lançar.

Corrigido: cada envio registra o PRÓPRIO vínculo imediatamente, dentro do
mesmo loop — `registrarVinculoEnvio` nunca lança (mesma garantia de
`gravarMapaComRetentativa`), então não risca ser confundido com falha de
envio. Também troquei `conversa.jid` por `resultado.jid` (o destino
efetivamente retornado por `enviarBaileys`, já resolvido) — o vínculo
agora registra pra onde a mensagem realmente foi, não o JID armazenado
antes da resolução. A nota privada de falha ganhou o diagnóstico de
resultado parcial pedido ("N de M itens confirmados antes da falha") sem
induzir nenhum reenvio automático dos itens já entregues.

Testado: sucesso parcial com falha no 2º ENVIO preserva o vínculo do 1º;
sucesso parcial com falha no DOWNLOAD do 2º idem; falha ao gravar o
vínculo do 1º não impede o envio do 2º.

## 3. Proposta de migration revisada

Documento atualizado no Workspace
(`PROPOSTA-MIGRATION-CHAT-MENSAGENS-MAPA-MULTI-ANEXO-2026-09-09.md`,
revisão 2): índice NÃO único no lugar do único (preserva a busca por
`chatwoot_message_id`); inventário de leitores confirmando que o engine é
o único leitor/escritor direto da tabela (nem `apps/web` nem
`brs-workspace` leem `chat_mensagens_mapa` diretamente) e a sequência
correta (código com `.limit(1)` compatível deployado antes ou junto da
migration, nunca depois), com o risco de rollback registrado
explicitamente; a semântica da "âncora" de `mapaPorChatwootId` marcada
como aberta — `order(id)` só evita PGRST116, não prova ordem de envio, e
não decide agregação de ack/reação multi-anexo. Nenhuma migration remota
nesta rodada.

## getMessage — narrativa corrigida, sem mudança de código

Aceito o ponto: o commit anterior dava a entender que a ausência do
vínculo prejudicava o `getMessage`. Não prejudica — o cache é preenchido
dentro de `enviar()` (baileys.ts), por `msg.key.id`, independente da
tabela de mapa. São duas correções INDEPENDENTES: o vínculo serve pra
citação/ack/reação e pra correlação de investigações (o motivo real dos
itens 1 e 2 acima); o `getMessage` já funcionava sem ele. Registrado o
engano no commit de correção.

## Validação

`npm test` 116/116 (105 anteriores + 11 novos) · `npm run typecheck` 0
erros. Sem teste de provedor real, sem push, sem deploy.

Aguardando aprovação pra publicar. Depois: confirmar o SHA ativo no
Railway antes de testar de novo na 2043 com mensagem nova.
