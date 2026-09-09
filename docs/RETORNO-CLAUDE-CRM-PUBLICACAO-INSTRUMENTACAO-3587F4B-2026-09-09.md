# Retorno ao Astra — publicação da instrumentação de retry, 09/09/2026

Responde a `REVISAO-INSTRUMENTACAO-3587F4B-2026-09-09.md`. Publicado
conforme autorizado — **sem migration, sem flag, sem env, sem
credencial alterada.**

## Integração e publicação

`brs-alvoconsig` `main` local e remoto coincidiam em `442d83d`. `git merge
crm/identidade-lid-entrega` (traz `79a06e0` + `3587f4b`, ambos sobre
`dca438f`) — **sem conflito**; diff resultante contra `442d83d` só toca
`services/engine/src/baileys.ts` e o arquivo de teste novo (+353/-1) —
nada em `apps/web`, sidebar preservada.

Checks no resultado integrado, em worktree isolada
(`brs-alvoconsig-integracao-lote`, atualizada com a `main` pós-merge):
`npm run typecheck` (engine e apps/web) 0 erros; `npm test` 124/124;
`npm run build --workspace apps/web` OK.

`git push origin main`: `442d83d..806ac09`.

## Railway

| Deploy | Commit | Status |
|---|---|---|
| `b4d42a41-0429-4237-ab20-827e59163639` | `806ac09cf0cd388fff776abc7f99cd0f05106165` | SUCCESS |

Confirmado deployment ATIVO (não só push/build) — o deployment anterior
(`739bd041`, `442d83d`) aparece como `REMOVED` na listagem, substituído por
este.

## Saúde e reconexão das instâncias (logs do boot, 17:42:14–17:42:28 UTC)

- `processamento durável: false, contasSelecionadas: 0` — conta BRS
  confirmada FORA de qualquer ativação de fundação, como pedido.
- `reconectando instâncias com sessão salva, total: 8`.
- **7 das 8 confirmaram `instância conectada`** dentro do boot: `c0f4c7bb`
  (final 5009, nova neste levantamento), `5576d3fc` (1641), `4e6f7ba0`
  (6019), `f7983f4d` (4934), **`dd8ab522` (2043 — a instância do próximo
  teste)**, `99ed05f3` (7033), `b20c4df9` (final 4435).

  **A 8ª instância, `906d9c33` (final 2537), NÃO apareceu com `instância
  conectada`** em nenhum log do deploy — segue com `status: conectando`
  no banco, sem erro registrado (`ultimo_erro: null`), e sem NENHUMA linha
  de log nova pra ela desde o boot (~35 min sem atividade até esta
  checagem). Essa mesma instância tinha confirmado `instância conectada`
  no boot ANTERIOR (deploy `442d83d`, retorno de 09/09 mais cedo) — não é
  uma condição já crônica antes deste deploy.

  **Nenhuma ação tomada sobre ela** (sem reconectar, sem relogar, sem
  mexer na sessão) — registrado como observação separada pra
  acompanhamento, não é a instância do teste pendente (2043) e não foi
  pedido nada sobre ela nesta rodada. Fica como possível item de
  investigação futura, não bloqueia o teste da 2043.
- `dd8ab522` (2043): `instância conectada` às 17:42:26.69 UTC, sem
  erro/badSession/logout no boot.

## Próximo passo

Aguardando o Bruno enviar a mensagem nova pela caixa de Atendimento da
2043 — nenhum envio feito por mim, nenhuma reconexão/reparelhamento
forçado, conforme pedido. Assim que a mensagem chegar, vou correlacionar
Chatwoot/wa_id/horário e, com a instrumentação nova já ativa, os logs de
início/erro/abandono de cada tentativa de retry e o ack, até o Bruno
confirmar legibilidade — sem presumir entrega final só pelo envio.
