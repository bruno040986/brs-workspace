# Retorno ao Astra — publicação controlada do complemento, 09/09/2026

Responde a `REVISAO-COMPLEMENTO-DCA438F-2026-09-09.md`. Publicado conforme
autorizado — **sem migration, sem flag, sem env, sem credencial alterada.**

## Integração e publicação

`brs-alvoconsig` `main` local e remoto coincidiam em `d182a57` antes do
merge. `git merge crm/identidade-lid-entrega` (dca438f) — merge de
verdade (histórias divergiam desde a sidebar cherry-pickada), **sem
conflito**; diff resultante contra `d182a57` só toca arquivos de
`services/engine` (7 arquivos, +1131/-18) — nada em `apps/web`, confirmando
que a sidebar já publicada foi reconciliada automaticamente pelo merge
(o conteúdo já existia via `d182a57`, o merge não duplicou nada).

Checks rodados no resultado integrado, em worktree isolada
(`brs-alvoconsig-integracao-lote`, atualizada com `origin/main` + a branch):
`npm run typecheck` (engine e apps/web) 0 erros; `npm test` 116/116;
`npm run build --workspace apps/web` OK.

`git push origin main`: `d182a57..442d83d`.

## Railway

| Deploy | Commit | Status |
|---|---|---|
| `739bd041-5912-43a9-91bf-315234192e1b` | `442d83dc099bab162683737aa98cffcb3a27704b` | SUCCESS |

Confirmado deployment ATIVO (não só push/build) — `list-deployments`
devolveu esse deployment como o mais recente com status `SUCCESS`,
`branch: main`.

## Saúde e reconexão das instâncias (logs do boot, 13:36:01–13:36:12 UTC)

- `processamento durável: false, contasSelecionadas: 0` — conta BRS
  confirmada FORA de qualquer ativação de fundação, como pedido.
- `reconectando instâncias com sessão salva, total: 5` — as 5 instâncias
  tentaram reconectar.
- Todas as 5 confirmaram `instância conectada`: `f7983f4d` (4934),
  `dd8ab522` (2043), `4e6f7ba0` (6019), `906d9c33` (2537), `5576d3fc`
  (1641). Nenhum erro de sessão/badSession/logout no boot.
- **`getMessage` novo já disparou pra 2043 durante a reconexão**: log
  `getMessage: pedido de reencaminhamento do protocolo`
  `{instId: dd8ab522-..., waId: 3EB0C0B44863C2D9EDF943, encontrado: false}`
  — formato exatamente como instrumentado; `encontrado: false` é o
  esperado (processo novo, cache vazio, sem histórico anterior ao deploy,
  como já avisado).
- No mesmo instante, um `Closing session` do libsignal reapareceu para o
  MESMO `remoteIdentityKey` cronicamente instável desde 08/09 — durante a
  própria reconexão da 2043. Registrado, não investigado a fundo agora;
  fica como contexto pro teste que vem a seguir.

## Próximo passo

Pedindo ao Bruno uma mensagem NOVA pela caixa de Atendimento da 2043
agora. Vou correlacionar mensagem Chatwoot, `wa_id`, instância e horário
como pedido, e — se ocorrer "Aguardando mensagem" de novo — consultar os
logs de `getMessage` (encontrado/ausente) antes de qualquer conclusão. Sem
presumir entrega final só pelo retorno do envio.
