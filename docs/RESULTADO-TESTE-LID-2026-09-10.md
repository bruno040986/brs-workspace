# Resultado do teste controlado — causa do atraso COMPROVADA (10/09/2026)

Fecha a investigação aberta em `ACHADO-CAUSA-ATRASO-LID-2026-09-10.md`,
que até aqui tinha cadeia causal no código e evidência circunstancial,
mas não medição direta. Agora tem.

## O experimento

Duas mensagens, mesma instância (6019), mesmo destino físico (celular do
Bruno), mesmo minuto, diferindo em UMA coisa: o endereço usado.
Enviadas pela rota temporária `POST /instancias/:id/teste-endereco`
(commit `ec93a36`), que manda ao JID literal sem passar por
`resolverDestinoBaileys`.

| | A — por telefone | B — por LID |
|---|---|---|
| destino | `556196863171@s.whatsapp.net` | `264003100127452@lid` |
| waId | `3EB06F730934A686C545FA` | `3EB09C7A2FA0E34B502A14` |
| enviada (UTC) | 21:22:55 | 21:23:27 |
| ack `entregue` | 21:22:57 (1,3 s) | 21:23:28 (1,2 s) |
| pedidos de retry | **2**, ambos `participant: 264003100127452@lid` | **nenhum** |
| no aparelho | "aguardando" | legível de imediato |
| no WhatsApp Web | imediata | imediata |

## Conclusão

Confirmada a cadeia descrita no achado: `jidToSignalProtocolAddress`
descarta o *server* do JID, então o mesmo aparelho tem DUAS identidades
Signal — `556196863171.<device>` e `264003100127452.<device>`. Ciframos
para a primeira; o aparelho vive na segunda; ele não decifra, pede
retry, e só o reenvio (já endereçado por LID pelo próprio protocolo)
fica legível. O ack rápido nunca significou entrega ao aparelho — só
aceite pelo servidor.

O WhatsApp Web mostrar na hora nas DUAS é coerente: é outro dispositivo,
com sessão própria, e não é ele que está no espaço LID.

## Limite do que foi provado

Um aparelho, um número, uma instância. O mecanismo está demonstrado; a
generalização para todo cliente é inferência razoável (o LID é como o
WhatsApp identifica contatos hoje), não medição. Repetir com um segundo
número — de preferência de alguém que não seja o Bruno — antes de mudar
o endereçamento de todos os envios é barato e vale a pena.

## Encaminhamento

Não é "trocar tudo para LID". O pré-requisito é o alias LID↔telefone
(worktree `brs-alvoconsig-alias-lid`, commit `eb510a8`, ainda sem
publicar + migration pendente): com os dois correlacionados por
instância dá para endereçar o envio no espaço em que o contato já está
ativo, e de quebra parar de criar conversa duplicada no Chatwoot (hoje o
mesmo contato tem um par de conversas por instância — 2043: 22/24;
6019: 10/7; 4934: 21/23; 1641: 23/1).

Decisão de arquitetura + migration = Fable, com a cota de 11/09.

## Pendência de limpeza

A rota `/instancias/:id/teste-endereco` é TEMPORÁRIA e já cumpriu o
papel. Manter só enquanto for útil repetir a medição com outro número;
remover no mesmo deploy que levar a correção. Ela é estreita (Bearer,
só Baileys, só JID de contato, só texto, sem espelho e sem gravar
conversa), mas continua sendo uma superfície de envio a mais em
produção — não deve virar permanente por esquecimento.
