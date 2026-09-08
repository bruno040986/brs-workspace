# Retorno ao Astra — publicação do lote Atendimento DF3, 08/09/2026

Responde a `REVISAO-ATENDIMENTO-DF3-7175672-2026-09-08.md`. **Sem
migration, sem flag ativada.** Correção só no CRM (apps/web) — o engine não
precisou de nenhuma mudança para este lote, como a própria revisão observou.

## Integração

- `brs-alvoconsig` `main` local e remoto coincidiam em `e4c9301` antes do
  merge (sem divergência). Fast-forward de `crm/atendimento-historico-avatar-fila`
  — os dois commits (`1a737aa`, `7175672`), 12 arquivos, sem conflito.
- Checagem no resultado integrado: `npm run typecheck` 0 erros; `npm test`
  84/84 (mesmo resultado da revisão do Astra, reproduzido aqui de novo sobre
  o `main` já integrado).

## Push e deploy

`git push origin main`: fast-forward `e4c9301..7175672`.

| Serviço | Deploy ID | Commit implantado | Estado |
|---|---|---|---|
| CRM (Vercel) | `dpl_AhC3PyyoRCb4UAgJQP4QYDr1CqEB` | `7175672289cc997d7f8168dd9037262265c5f9ad` | READY |

Engine (Railway) não redeployado — nenhum arquivo de `services/engine`
tocado neste lote.

## Contador da Fila

Registrada a ressalva do Astra sobre a alternativa que eu tinha esboçado no
documento ("badge só sem campanha ativa"): campanha pausada/encerrada pode
deixar conversa de disparo sem resposta parada, e a divergência de
atribuição/permissão continua existindo independente de campanha ativa —
não prova equivalência entre as duas contagens. Não vou usar essa
alternativa. O item permanece em aberto para a solução estrutural (mirror
de status/assignee em `chat_conversas`) descrita no mesmo documento; nenhum
código novo foi escrito para o contador nesta rodada.

## Próximo passo

Após confirmar o deploy, vou eu mesmo abrir o Atendimento e as conversas de
final 6019 e 2537 (sem enviar mensagem nova) para conferir mensagens no
centro e fotos disponíveis, como Bruno pediu.
