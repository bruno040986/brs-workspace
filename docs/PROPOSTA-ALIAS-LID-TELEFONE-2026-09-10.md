# Proposta (Fable) — alias LID↔telefone por instância

**Status: decisão de arquitetura fechada; migration NÃO aplicada.** Sai só
da `brs-workspace` principal, com timestamp real (`date +%Y%m%d%H%M%S`),
depois que o código do engine que a lê/escreve estiver publicado com
comportamento tolerante à ausência da tabela (ver sequência).

## Evidência que motiva

Confirmado em 10/09/2026, pela sessão viva das instâncias 2043 e 6019:
`onWhatsApp('556196863171')` devolve `lid: 264003100127452@lid` — o mesmo
LID dos pedidos de retry do protocolo. Hoje o engine descarta esse campo
(`resolverDestinoBaileys` só lê `.jid`); os logs de retry ficam com um
identificador opaco. O alias fecha rastreabilidade. **Não** é correção do
atraso de entrega e **não** muda o destino de envio (segue PN).

## Schema

```sql
create table public.chat_contato_alias (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references public.chat_contas(id) on delete cascade,
  instancia_id   uuid not null references public.chat_instancias(id) on delete cascade,
  jid_telefone   text not null,            -- 5561...@s.whatsapp.net (PN canônico devolvido por onWhatsApp)
  lid            text not null,            -- 2640...@lid
  origem         text not null check (origem in ('onwhatsapp','retry','inbound')),
  observado_em   timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  conflito_com   text,                     -- lid anterior diferente para o mesmo (instancia, jid_telefone), se houver
  unique (instancia_id, jid_telefone),
  unique (instancia_id, lid)
);
create index chat_contato_alias_lid_idx on public.chat_contato_alias (lid);
alter table public.chat_contato_alias enable row level security; -- engine usa service role; sem policy pública
```

Decisões, cada uma com o porquê:

- **Escopo por instância** (não por conta nem global): o LID é atribuído
  pelo WhatsApp por relação; a evidência veio idêntica nas duas instâncias
  da mesma conta, mas isso não é garantia de contrato. Duas unicidades
  (`instancia_id+jid_telefone`, `instancia_id+lid`) impedem que um LID
  aponte para dois telefones ou vice-versa dentro da mesma instância.
- **`origem` explícita**: `onwhatsapp` (resolução no envio), `retry`
  (participant/remoteJid do stanza de retry), `inbound` (mensagem recebida
  com `@lid`). Sem isso, um alias inferido de retry vira "fato" sem
  distinção de qualidade.
- **Conflito explícito, nunca sobrescrita silenciosa**: ao gravar um LID
  diferente para o mesmo `(instancia_id, jid_telefone)`, NÃO atualizar
  `lid`; gravar o novo em `conflito_com`, logar `warn` sanitizado
  (instId, jid, lid antigo/novo) e seguir. Resolver conflito é ação humana.
- **Nada de mesclar/apagar conversas**: `chat_conversas.jid` continua como
  está. O alias é tabela de consulta; nenhuma FK dele para conversas.
- **Falha de persistência nunca vira reenvio**: gravação best-effort,
  `catch` que só loga; jamais no caminho crítico de `enviar()`.
- **Destino de envio segue PN**: trocar para `@lid` como tentativa de
  acelerar entrega exige hipótese + teste específicos, fora desta proposta.

## Sequência de publicação (obrigatória)

1. Engine: gravar alias em `resolverDestinoBaileys` (origem `onwhatsapp`)
   e no wrapper de retry (origem `retry`, a partir do `participant` sem
   sufixo de device). Toda gravação tolera tabela ausente (`42P01`) e
   qualquer erro: log `warn`, sem throw. Testes com cliente simulado.
2. Publicar engine e confirmar SHA no Railway.
3. Só então `db push` da migration pela `brs-workspace` principal.
4. Leitura (correlação LID→telefone nos logs/telas) só depois do passo 3.

Rollback: dropar a tabela não quebra o engine (passo 1 garante).

## O que fica para o Opus (execução + investigação)

- Implementar o passo 1 com testes (padrão `mock.module` do engine).
- Investigar a causa do atraso com o LID já mapeado: comparar, para a
  mesma mensagem, `sendToAll` vs retry por device, tempo até o ack
  `entregue`, e se o 1º envio já saiu com sessões Signal para TODOS os
  devices do LID (ler `getUSyncDevices`/`assertSessions` no instalado).
  Entregar hipótese reproduzível ou delimitar o metadado que falta.
