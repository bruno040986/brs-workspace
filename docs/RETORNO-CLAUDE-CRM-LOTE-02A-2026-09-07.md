# Retorno ao Astra — Lote 02A (ativação seletiva do durável), 07/09/2026

Responde a `LOTE-02-CRM-ATIVACAO-SELETIVA-2026-09-07.md`. Implementado e
testado localmente; **sem push, deploy, flag ligada, migration, escrita
remota ou envio real**.

| Item | Valor |
|---|---|
| Repo / worktree | `brs-alvoconsig` / `brs-alvoconsig-duravel` |
| Branch | `crm/lote-02a-ativacao-seletiva` |
| Base | `main` = `f1d6bb9` |
| Commit | `1f9d086` (local, sem push) — 24 arquivos, +958/−64 |
| Instruções de configuração/drenagem | `brs-alvoconsig/docs/ATIVACAO-SELETIVA-DURAVEL.md` (no commit) |
| Coordenação com a sessão de grupos | mesma sessão; branch de grupos já mergeada; nenhum arquivo do engine em edição paralela |

## Contrato → implementação (resumo)

1. `ENGINE_DURABLE_ACCOUNT_IDS` (UUIDs de `chat_contas.id`); efetivo = flag **e**
   conta listada; vazia = zero; inválida = engine não sobe (`durable-policy.ts`).
2. Conta só pelo banco: instância → `conta_id`; webhook Chatwoot →
   `account.id` → `chat_contas` (`contaPorChatwootAccount`, UNIQUE). Falha no
   lookup → **503**, nunca legado. Campo do chamador não escolhe nem burla.
3. Uma decisão (`contaDuravel`) aplicada nos 4 ingressos (`/enviar`, Chatwoot,
   Z-API, `messages.upsert`). Conta BRS não entra por `owner_tipo`/`papel`/grupos.
4. Conta selecionada: `operationId` UUID obrigatório (400
   `OPERATION_ID_REQUIRED`); engine não gera; conflito → 409
   `OPERATION_CONTENT_CONFLICT`; em voo/incerto → 409 `DELIVERY_UNCERTAIN`.
5. CRM: helper não inventa chave; disparo = `crm_disparo_fila.id`; voz =
   `crm_chamadas.id`; ofertas/simulações/1º contato = chave gerada na UI no
   clique (`ChavesDeIntencao`: mesma intenção conserva a chave até o sucesso;
   conteúdo diferente = chave nova; sem persistência entre recargas —
   documentado, não anunciado como seguro).
6. Webhook não exige `operationId`; `ORIGENS_PROPRIAS_ENGINE`/`private`
   preservados; origem nova conta como envio externo.
7. Inline consulta `eventoJaAceito()` com o recurso ligado; dispatch sem gate;
   `sends_external` persistido no aceite; worker sobe com a flag; drenagem no doc.

## Validação local

| Comando | Resultado |
|---|---|
| `npm test` | 54/54 (36 → 54: +5 política, +16 ingressos, +4 dispatch, +5 client CRM, +3 chave — 18 novos líquidos contando substituições) |
| `npm run test:db` | PASS (inalterado, 13 migrations) |
| `npm run typecheck` | 0 erros |

Aceite executável coberto em `durable-ingressos.test.ts` (rotas reais do
Fastify, `mock.module` para db/baileys/bridge/zapi; ledger `send-operation`
real sobre Supabase falso) e `event-dispatch.test.ts` (BufferJSON, retomada
após reinício simulado).

**Cobertura faltante (precisa):** o handler `messages.upsert` do Baileys em si
(exige socket real; usa a mesma `duravelParaInstancia`); `enqueueEvent`
contra Postgres (dedupe já em `tests/db/assertions.sql`); UI no navegador;
Z-API com conta selecionada só no envio direto (webhook Z-API testado para
fila/inline/já-aceito, sem provedor real).

## Pontos para a revisão do conjunto com 02B

- O Workspace precisa mandar `operationId` só quando a conta BRS entrar na
  lista; até lá continua legado. O engine aceita o campo hoje.
- Evento Chatwoot sem `account.id`/`id` válidos não pode ser selecionado e
  segue o legado (decisão explícita; antes, com a flag global, era 400).
- `eventoJaAceito()` custa um SELECT indexado por evento inline enquanto a
  flag estiver ligada (inclusive conta BRS). Aceitável no piloto; se pesar,
  cache curto por chave.
