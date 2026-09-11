# Retorno ao Astra — integração local dos lotes 02A + 02B, 07/09/2026

Responde a `REVISAO-LOTE-02A-2026-09-07.md`, seção "Próximo passo para as
sessões executoras". **Sem push, deploy, migration ou ativação de flag.**
Nenhuma mensagem real enviada.

## CRM/engine — integrado

| Item | Valor |
|---|---|
| Pasta principal | `brs-alvoconsig` |
| Antes | `main` em `f1d6bb9` |
| Depois | `main` em `99e82b0` |
| Tipo de merge | **fast-forward puro** (`git merge --ff-only`) |
| Conflitos | Nenhum — `main` não tinha avançado desde `f1d6bb9` |

Worktree/branch de origem (`brs-alvoconsig-duravel`,
`crm/lote-02a-ativacao-seletiva`) preservada, não apagada.

## Workspace — já estava integrado

`brs-workspace` `main` **já estava** em `b511b66` quando conferi — a sessão
do Workspace tinha feito o fast-forward antes deste retorno. Confirmei que é
mesmo um fast-forward puro (cadeia linear de pai único, sem merge commit):

```
b511b66 Lote 02B (rodada 3): código existir não prova rejeição — lista explícita pré-envio
db9d623 Lote 02B (rodada 2): incerteza em transporte/5xx/resposta inválida + máquina de estados da modal
9854e6f Lote 02B: operationId por intenção no envio direto ao engine (sem push/flag)
77c51ce BRS Messenger Fase C: roteiro (grupos) + correção da detecção de grupo   ← trabalho não relacionado, já em main antes do 02B
7d73daa Handoff p/ revisão Astra ...  ← base anterior
```

Nenhum conflito, nenhuma ação minha necessária nessa pasta além de rodar os
checks abaixo. Branch `lote02b/operation-id-envio` preservada.

## Checks no resultado integrado

| Projeto | Comando | Resultado |
|---|---|---|
| CRM/engine | `npm run typecheck` | 0 erros |
| CRM/engine | `npm test` | 73/73 |
| CRM/engine | `npm run test:db` (contra as migrations do `brs-workspace` já integrado) | PASS |
| Workspace | `npx tsc --noEmit` | 0 erros de código — ver ressalva abaixo |
| Workspace | `npm test` | 23/23 |
| Workspace | `npm run build` (`next build`) | **não executado** — ver ressalva abaixo |

**Ressalva 1 — artefato `.next` obsoleto, não é defeito de código.** A
primeira rodada de `tsc --noEmit` acusou 1 erro em
`.next/dev/types/validator.ts`, referenciando uma rota `dev-conversas` que
**não existe** em `src/app` — sobra de um `.next` gerado antes dessa rota
ser removida por outro trabalho. Não apaguei a pasta `.next` porque a
permissão de `rm -rf` foi negada nesta sessão; o erro desaparece com um
`next build`/`next dev` limpo.

**Ressalva 2 — `next build` não executado por contenção externa.** Ao
tentar, o Next recusou com "Another next build process is already running."
Conferi com `lsof`: várias outras sessões (`claude`, `codex`, processos
`node`/`npm`) têm o cwd apontando para esta MESMA pasta principal agora — é
uso concorrente real, não travamento órfão. Não matei processo nenhum nem
insisti. O `npm test` (leve, não migra nada) rodou limpo (23/23) nesse mesmo
estado, então não há sinal de que o código integrado quebre o build — só não
consegui provar isso com um `next build` de verdade nesta janela. Recomendo
repetir `next build` num momento sem concorrência antes de publicar, ou
deixar que o pipeline de deploy (que já roda isolado) seja essa prova.

## Verificação de contrato entre os dois projetos

Como são repositórios diferentes, não há conflito de Git possível entre
eles — o que importa é se o cliente do engine em
`brs-workspace/src/lib/central-conversas/engine.ts` (02B) continua
compatível com as respostas do engine corrigido (02A). Li o arquivo já
integrado: o classificador `classificarFalha`/`REJEICOES_PRE_ENVIO` trata
`DELIVERY_UNCERTAIN` e `OPERATION_CONTENT_CONFLICT` (os dois códigos que meu
achado P1 usa) exatamente como incerto/rejeição, e qualquer 4xx não listado
— inclusive `OPERATION_ID_REQUIRED`, hoje adormecido porque a conta BRS não
está na lista — cai com segurança no ramo final ("rejeição", nunca
confirmação falsa). Os dois códigos novos desta rodada
(`MESSAGE_ID_REQUIRED`, `ACCOUNT_ID_REQUIRED`) vivem só no webhook do
Chatwoot (Chatwoot→engine), fora do alcance deste cliente, que só chama
`/instancias/:id/enviar`, `/conectar`, `/status`, `/desconectar`. Nenhuma
incompatibilidade encontrada.

## Estado final

- `brs-alvoconsig` `main` = `99e82b0`.
- `brs-workspace` `main` = `b511b66`.
- Nenhum push, deploy, migration ou flag. Ambas as worktrees/branches de
  origem preservadas.
- Pendente, como já registrado: publicação controlada, homologação com
  navegador/socket/provedor reais, e repetir `next build` sem concorrência
  antes de publicar o Workspace.
