# 📋 Recado para a sessão do CRM/engine — grupos e sinais do WhatsApp para o BRS Messenger

Contexto: o Bruno aprovou (06/09/2026) levar a Central de Atendimento do Workspace à
paridade com o Digisac. Spec completa em
`brs-workspace/docs/SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md`. A parte que depende do
engine (`brs-alvoconsig/services/engine`) é esta. Tudo **aditivo** — nada do CRM muda.

## Regra que NÃO pode vazar do CRM

No **BRS Messenger** (conta `owner_tipo='brs'`) **não existe receptiva × disparo**:
toda conexão envia, recebe e opera grupos. `chat_instancias.papel` e
`permite_grupos` são regra do CRM. Portanto, nas rotas abaixo, o gate é **posse da
instância pela conta + `ENGINE_API_TOKEN`** — **não** filtrar por `papel` quando a
instância for da conta BRS. (Para instâncias de parceiro, a regra do CRM continua
valendo — decidam no engine por `owner_tipo` da conta.)

## Endpoints novos (Bearer `ENGINE_API_TOKEN`, por `instancia_id`)

```
GET  /instancias/:id/contatos?q=&page=&limit=
     → { itens: [{ jid, numero, nome, foto? }], total, page }
       contatos conhecidos da conexão (Baileys store / Z-API contacts). Usado pelo
       picker de "Adicionar membros" e "Criar grupo" (Digisac mostra ~850).

GET  /instancias/:id/grupos/:jid
     → { jid, nome, descricao?, foto?, criado_em?, dono?, membros: [{ jid, numero, nome?, admin: boolean, eu: boolean }] }
       Baileys groupMetadata / Z-API group-metadata.

POST /instancias/:id/grupos
     body { nome, participantes: [jid|numeroE164] }
     → { jid, nome }                      Baileys groupCreate / Z-API create-group

POST /instancias/:id/grupos/:jid/participantes
     body { acao: 'add'|'remove'|'promote'|'demote', jids: [] }
     → { ok, resultado: [{ jid, status }] }  Baileys groupParticipantsUpdate

GET  /instancias/:id/grupos/:jid/convite
     → { link }                           Baileys groupInviteCode → https://chat.whatsapp.com/<code>

POST /instancias/:id/grupos/:jid/sair
     → { ok }                             Baileys groupLeave

POST /instancias/:id/enviar   (ADITIVO ao contrato atual)
     body += { mentions?: [jid], quoted?: { messageId } }
     → menção real (@) e resposta citando.
```

Erros esperados como HTTP + `{ erro, codigo }` (ex.: `NAO_ADMIN` para promote/remove
sem ser admin; `NAO_MEMBRO`; `INSTANCIA_DESCONECTADA`).

## Espelho no Chatwoot (aditivo, via `content_attributes`)

| Sinal do WhatsApp | O que o engine grava | Quem consome |
|---|---|---|
| remetente em **grupo** | hoje vai como prefixo no texto → passar a ir também em `content_attributes.sender = { jid, numero, nome }` (pode manter o prefixo por compatibilidade com o CRM) | UI renderiza label na bolha como o Digisac |
| **fromMe** enviado pelo celular (sem `operation_id` nosso) | espelhar como outgoing com `content_attributes.origem = 'aparelho'` | UI rotula "Dispositivo externo" |
| **citação** recebida | `content_attributes.in_reply_to = <chatwoot_message_id da citada>` (o CW já entende esse campo) | UI mostra preview |
| **menções** recebidas | `content_attributes.mentions = [jid]` | UI destaca |
| **ack** (sent/delivered/read/failed) | `messages.update` → gravar em `public.chat_mensagem_status` (chatwoot_message_id, status, at) — tabela vem na migration da Fase B do Workspace; até lá, só expor no webhook interno | UI ticks ✓/✓✓ |
| **reação** | `messages.reaction` → `public.chat_mensagem_reacoes` (chatwoot_message_id, jid, emoji, at) — idem Fase B | UI "reagiu com ❤️" |

## O que o Workspace vai fazer com isso

- Roteia grupo novo automaticamente pro departamento "Grupos" (Chatwoot Team) e
  vincula grupo↔parceiro pelo mesmo "Vincular a" das conversas.
- Painel Membros (Geral | Membros), Adicionar membros, Copiar link, Admin/Remover,
  Sair, Criar grupo (nome + conexão + contatos), @ no composer, responder citando.

## Ordem sugerida no engine

1. `GET grupos/:jid` + `content_attributes.sender` (destrava a aba Membros e o label).
2. `participantes` + `convite` + `sair` + `POST grupos` (gestão completa).
3. `enviar` com `mentions`/`quoted` + `in_reply_to`/`mentions` no espelho.
4. `origem='aparelho'`, ack, reação (Fase B do Workspace — aviso quando a migration estiver aplicada).

Migration do Workspace da Fase A (departamentos) é independente do engine.
Quando publicarem, mandem o commit/hash e a URL base em produção — eu ligo o
Workspace por trás de flag por conta.
