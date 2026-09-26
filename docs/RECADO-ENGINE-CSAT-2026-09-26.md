# Recado ao engine — enviar a pesquisa de satisfação (CSAT) pelo WhatsApp

Origem: item D4 do lote 2 (`docs/PLANO-PARIDADE-DIGISAC-LOTE-2-2026-09-26.md`). O Workspace já tem a tela
Central de Conversas › Pesquisa de satisfação (texto por caixa + relatório). **Falta o engine.**

## O que acontece hoje
Ao resolver a conversa com `csat_survey_enabled`, o Chatwoot cria uma mensagem de saída com
`content_type: "input_csat"` e dispara o webhook `message_created`. O `outboundDoChatwoot`
(`services/engine/src/bridge.ts`) não olha `content_type`: manda `payload.content` como texto comum.
O cliente recebe só a pergunta, **sem o link** — não tem como responder.

## O que o engine precisa fazer (a confirmar contra o payload real)
1. No `outboundDoChatwoot`, se `payload.content_type === 'input_csat'`: enviar
   `"<content>\n<link>"`, onde o link é `<CHATWOOT_PUBLIC_URL>/survey/responses/<conversation.uuid>`
   (formato do Chatwoot para canais sem widget). Conferir se `payload.conversation.uuid` vem no webhook;
   senão buscar `GET /conversations/:id` (campo `uuid`).
2. `CHATWOOT_PUBLIC_URL` = domínio público do Chatwoot que o cliente abre. **Hoje `chat.brspromotora.com.br`
   ainda não tem DNS/certificado** (Railway "Waiting for DNS update") — só habilitar depois disso, ou o link não abre.
3. Espelhar/registrar como mensagem normal (nota na thread), sem duplicar quando o eco voltar.
4. Teste: resolver conversa de teste com a pesquisa ativa → cliente recebe pergunta + link → responde →
   aparece em Pesquisa de satisfação › Resultados.

Executor sugerido: Fable (toca fluxo de saída do engine). Não publicar sem avisar (reinicia as instâncias).
