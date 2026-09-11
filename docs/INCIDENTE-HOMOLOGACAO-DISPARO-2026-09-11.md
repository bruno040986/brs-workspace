# Homologação real do disparo — o que aconteceu e o que corrige (Fable, 11/09/2026)

Campanha "Teste de Disparo 1" (`ad7bdada…`), criada 19:45 UTC, 6 leads,
6 números (posições 0–5, volta 0), delays 80–196 s. **Os 6 itens foram
enviados** no horário, com ack `entregue` — o pipeline de criação,
materialização, rotação, delay e envio funcionou. Os problemas estão
DEPOIS do envio: na resposta do lead e no vínculo com o atendente.

## Linha do tempo (UTC)

| Hora | Fato | Evidência |
|---|---|---|
| 19:46:34 | 2537 → 556192873740, conversa 31 (`origem=disparo`) | fila + `chat_conversas` |
| 19:47:21 | resposta do lead: conversa 31 marcada `respondida` **e** conversa 32 criada como `54108199342270@lid`, órfã ("criar lead") | `chat_conversas`, log "avatar sincronizado" nos dois jids |
| 19:48:33 | 4934 → 556196863171 (Bruno): ack entregue + 2 pedidos de retry por `264003100127452@lid` ("Aguardando" no celular, caso já conhecido) | log retry |
| 19:49:04–07 | **Bad MAC** ×2 na sessão `264003100127452.30`: a resposta do Bruno veio cifrada numa sessão que o engine não tinha; o protocolo renegociou ("Closing open session in favor of incoming prekey bundle") e a resposta entrou na conversa 21, certa | log libsignal |
| 19:53:33 | 5009 → 556186397086 (entregue) | fila |
| **19:53:36** | **5009 desvinculada: 401 `device_removed`** — reconexão automática desativada (correto). Qualquer resposta desse lead a partir daí NÃO chega até a 5009 ser pareada de novo | log "conflito de sessão" |
| 19:58:26 / 19:58:43 | lead 556182970623: 1ª resposta cai certa (conversa 35 `respondida`); 2ª mensagem vira `64193050976280@lid`, conversa 36 órfã | `chat_conversas` |
| 20:15:56 / 20:16:38 | lead 556186310435: mesmo padrão — 1ª certa (33), 2ª órfã `249370414948431@lid` (38) | `chat_conversas` |
| 18:55–20:24 | **143×** `23502 null value in column instancia_id` em `/api/crm/atendimento` | Vercel |
| 20:14–20:24 | **29×** 403 "Conversa fora da sua carteira" + 1 falha ao **enviar** pelo `/atendente/atendimento` | Vercel |

## Três causas, três correções

### 1. Vínculo lead↔conversa nunca era gravado — CORRIGIDO e publicado
`resolverLeadsDasConversas` gravava o vínculo por `upsert({id,
crm_contato_id, telefone_e164}, {onConflict:'id'})`. No Postgres, o
INSERT do upsert valida NOT NULL na linha candidata antes de resolver
o conflito — falhava sempre. Consequência em cadeia: `crm_contato_id`
null em TODAS as conversas → `autorizacao.ts` trata como "sem lead" →
atendente sem `ver_sem_lead` não abre nem responde a conversa do
próprio lead. Trocado por UPDATE por conversa. Isso resolve o 23502 e
o "fora da carteira" para conversas com telefone (as normais).

**Complemento (Sonnet)**: o cron do disparo conhece `contato_id` e
`telefone_e164` do item; o engine `/enviar` deve aceitar esses campos e
gravá-los ao criar a conversa. Aí o vínculo nasce certo, sem depender
de casamento por telefone (que falha em telefone compartilhado).

### 2. Segunda mensagem do lead vira conversa órfã por LID — ESTRUTURAL
Padrão em 3 de 5 leads externos: a 1ª resposta chega com `sender_pn`
(o engine já resolve para o telefone), a seguinte chega só com `@lid`.
Sem um mapa LID↔telefone persistido, `garantirConversa` cria outra
conversa, sem telefone, sem lead, com botão "criar lead". Não é caso
isolado: 27 conversas `@lid` no banco desde 29/08, 3 hoje em leads
reais.

Correção (é o alias de 10/09, agora necessário):
- migration `chat_contato_alias` (proposta `PROPOSTA-ALIAS-LID-TELEFONE-2026-09-10.md`) — Fable;
- engine grava alias em TODA fonte que já vem de graça: `onWhatsApp` no envio (o disparo passa por aqui, então o alias existe ANTES da resposta), `sender_pn` no inbound, `chats.phoneNumberShare`, retry — `eb510a8` já cobre duas;
- inbound `@lid` sem `sender_pn` consulta o alias (cache em memória + tabela) e cai na conversa do telefone;
- conversas órfãs já criadas: ficam; mesclar é trabalho à parte.

### 3. 5009 desvinculada no meio da campanha — operacional + regra
`device_removed` 3 s depois do envio. Coincide com a tentativa de
desvincular pelo celular mais cedo ("não foi possível desconectar") —
o aparelho terminou o serviço depois. Precisa de QR. E é exatamente a
lacuna 2 do plano: item do número caído queima tentativas até `falhou`,
e a resposta do lead não chega enquanto o número está fora. Regra
fail-closed (Sonnet): `conectando` espera sem gastar tentativa;
`desconectada` pausa a campanha com motivo.

## Fora de escopo, registrado
- "Aguardando" no celular do Bruno: mesmo caso isolado de ontem; os Bad
  MAC de hoje são o espelho dele no sentido inbound e se resolveram
  sozinhos pela renegociação do protocolo.
- Campanha ficou `ativa` com todos os itens `enviado` — sem encerramento
  automático ao esgotar a fila. Cosmético; vale encerrar ao terminar.
