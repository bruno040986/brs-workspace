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

## Segundo destino: o problema NÃO é universal (21:30 UTC)

Repetido para `5561981617033` (o aparelho da instância 7033), pela mesma
instância remetente:

| | A — por telefone | B — por LID |
|---|---|---|
| destino | `556181617033@s.whatsapp.net` | `65576298897572@lid` |
| waId | `3EB0B68964E07F1241E546` | `3EB063F67E8830AD18AA2C` |
| pedidos de retry | **nenhum** | **nenhum** |
| no aparelho | imediata, e marcada como LIDA | imediata, e marcada como LIDA |

Ou seja: endereçar por telefone funcionou perfeitamente aqui. A
conclusão da seção anterior estava certa no mecanismo, mas incompleta na
abrangência — o defeito não atinge todo destino.

**A diferença observada entre os dois destinos**: o celular do Bruno tem
WhatsApp Web vinculado; o do 7033 não (informado por ele no momento do
teste). Isso é coerente com o mecanismo: com dispositivos companheiros,
`relayMessage` precisa cifrar para VÁRIOS devices do destinatário, e é aí
que a divergência entre espaço PN e espaço LID passa a produzir sessão
errada para algum deles. Com um único dispositivo, não há divergência a
produzir.

**Atenção — isto é correlação de duas medições, não causa provada.**
Outras diferenças entre os aparelhos não foram controladas (versão do
app, histórico de re-pareamento, quantidade de devices já vinculados).

### Teste que fecharia esta parte

Vincular o WhatsApp Web no 7033 e repetir SÓ o braço A. Se passar a dar
"aguardando" com retry, a variável está isolada. É barato, reversível
(desvincula depois) e usa o script que já existe.

## Atualização (fim do dia 10/09): hipótese do WhatsApp Web DESCARTADA

Testes adicionais, todos pela 6019, braços A (telefone) e B (LID):

| destino | WhatsApp Web | resultado |
|---|---|---|
| 7033 | ligado | A e B imediatas |
| pessoal do Bruno `5561996853171` (MESMO iPhone 16E do comercial) | desligado | A e B imediatas |
| pessoal do Bruno | ligado | A e B imediatas |

Placar: 5 destinos-condição testados, 1 falha — sempre o comercial
`556196863171`, de duas instâncias diferentes (2043 e 6019). Aparelho,
iOS, rede e WhatsApp Web ficam descartados, porque o pessoal está no
mesmo aparelho e passou limpo.

**Conclusão de trabalho:** o defeito é específico da sessão Signal que o
engine mantém para esse contato (identidade PN desatualizada em relação
ao aparelho — típico de conta reinstalada/migrada/restaurada; o comercial
convive com outro app WhatsApp no mesmo iPhone). NÃO é defeito geral do
envio por telefone.

**Decisões:**
- Não mudar o endereçamento de todos os envios por causa de um caso.
- Alias LID↔telefone (`eb510a8`) segue na fila do Fable, sem urgência
  (resolve as conversas duplicadas PN×LID se aparecerem em clientes).
- Opção pontual para o comercial: descartar a sessão PN armazenada para
  `556196863171` e deixar o protocolo renegociar. Mexe em estado de
  criptografia em produção → só com ok do Bruno e olhar do Fable.
- Remover a rota `/teste-endereco` no próximo deploy. O script
  `teste-lid.sh` fica como ferramenta de diagnóstico de 1 minuto se um
  cliente relatar "aguardando" (requer a rota; se removida, reintroduzir
  sob demanda).

## O que já está firme

- Endereçar por LID funcionou nos DOIS destinos, sem retry nenhum.
- Endereçar por telefone falha em pelo menos um destino real, de forma
  reprodutível, e o modo de falha é exatamente o descrito no achado.
- O ack `entregue` não significa entrega ao aparelho — significa aceite
  pelo servidor. Isso vale para todos os envios, sempre.

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
