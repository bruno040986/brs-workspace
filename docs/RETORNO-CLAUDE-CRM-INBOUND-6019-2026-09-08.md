# Retorno ao Astra — inbound perdido na instância final 6019, 08/09/2026

Responde a `RECADO-CLAUDE-CRM-INBOUND-6019-2026-09-08.md`. **Causa
comprovada por log real, não por inferência.** Corrigido em worktree/branch
própria. Sem escrita remota, sem reenvio de mensagem, sem migration/flag.

| Item | Valor |
|---|---|
| Repo / worktree | `brs-alvoconsig` / `brs-alvoconsig-inbound6019` |
| Branch | `crm/investigacao-inbound-6019` |
| Base | `main` = `99e82b0` |
| Commit da correção | `e4c9301` |

## 1. Vínculo DF3 (confirmado, não é tenant errado)

`agentes_parceiros.arw_code = 'DF3'` no mesmo `id` (`54f36528-...`) da
instância/conta/inbox investigados. Existe login
`df3@parceiro.brspromotora.com.br` em `crm_usuarios` com essa mesma
`agente_parceiro_id`. "PRIME SUDOESTE CONSULTORIA E INFORMACOES CADASTRAIS
LTDA" é a razão social; "PRIME MAIS CRED" é o nome fantasia; "DF3" é o
apelido/código ARW. Os três nomes apontam pro mesmo cadastro — confirmado
por dado, não presumido pela diferença de nomes.

## 2. Cadeia de evidências

- Instância `4e6f7ba0-...` ("final 6019"): receptiva, conectada,
  `ultimo_erro=null`, `chatwoot_inbox_id=11`, conta `ef784c55-...`
  (Chatwoot account 6), tenant DF3. Confirmado no banco.
- **Achado que mudou o foco da investigação**: essa instância foi **criada e
  conectada hoje às 03:59:54 UTC** (`chat_instancias.created_at`/
  `conectada_em`) — minutos depois do deploy `99e82b0` (03:11–03:12 UTC) e no
  meio de uma sequência de pareamentos de números novos deste mesmo tenant
  (03:58–04:04 UTC). Zero linhas em `chat_conversas` e zero em
  `chat_eventos` para essa instância em **toda a história**, não só no
  teste de agora — as outras 3 instâncias do mesmo tenant têm conversas e
  eventos normais.
- Logs Railway do próprio deploy (`47fd8504`), janela 03:55–04:20 UTC,
  mostraram exatamente o que faltava:
  ```
  04:01:09 falha ao processar mensagem  instId=4e6f7ba0-...
    ChatwootError: Chatwoot HTTP 422 em /contacts:
    {"message":"Phone number has already been taken","attributes":["phone_number"]}
      at ChatwootConta.criarContato -> garantirConversa (bridge.ts:139)
      -> entregarNoChatwoot -> inboundBaileys
  04:08:20  (mesmo erro, segunda tentativa)
  ```
  O Baileys recebeu a mensagem (`type='notify'`, passou pelo filtro de eco)
  e processou até `garantirConversa`; a falha é exatamente ali.

## 3. Causa

`garantirConversa` busca contato existente só por `identifier`
(`instancia:jid`, único por INSTÂNCIA nosso). Mas `phone_number` no Chatwoot
é único por CONTA inteira, não por inbox/instância. O número de Bruno já
tinha contato criado via outra instância desta mesma conta (é isso que os
dados de `chat_conversas` das outras 3 instâncias mostram); ao mensagear a
instância nova (6019), a busca por identifier não encontra nada (identifier
é outro), `criarContato` tenta criar um contato NOVO com o mesmo telefone, e
o Chatwoot recusa. O erro sobe até o catch genérico do `messages.upsert` —
nada é gravado, nem `chat_conversas` nem `chat_eventos`. Não houve criação
parcial em nenhum dos dois lados: a chamada que falhou é a própria criação
do contato (uma única requisição HTTP), então não sobrou nenhum resto para
limpar — a leitura à API do Chatwoot prevista no passo 3 do recado não foi
necessária diante dessa evidência.

## 4. Correção

- `chatwoot.ts`: novo `ChatwootConta.buscarContatoPorTelefone`, refatorado
  para compartilhar a busca com `buscarContatoPorIdentificador`.
- `bridge.ts` (`garantirConversa`): se a busca por identifier não encontrar
  nada e houver telefone, busca por telefone **na mesma conta** antes de
  tentar criar. Contato encontrado é reaproveitado — `garantirContatoNaInbox`
  (já existente no código, nunca alcançado antes por causa do erro) vincula
  esse contato à inbox nova. Cada instância continua ganhando sua própria
  conversa; só o contato passa a ser compartilhado dentro da conta, que é
  exatamente o que o Chatwoot já exige.

## 5. Testes

`bridge-contato-duplicado.test.ts`, 4 casos, batendo direto em
`garantirConversa` real (config/db/chatwoot/history/baileys/zapi
simulados):

1. Mesmo telefone numa 2ª instância reaproveita o contato — **reproduz o
   422 real antes da correção** (o mock de `criarContato` lança o mesmo erro
   quando o telefone já existe).
2. Identifier já resolvido não aciona a busca por telefone.
3. Grupo (sem telefone) nunca aciona a busca — comportamento anterior
   preservado.
4. Telefones diferentes nunca colidem.

| Comando | Resultado |
|---|---|
| `npm test` | 77/77 (73 já existentes + 4 novos) |
| `npm run test:db` | PASS (nenhuma migration tocada) |
| `npm run typecheck` | 0 erros |

## 6. Critérios de aceite

- Mensagem de contato desconhecido cria conversa sem lead: preservado (não
  mudei essa parte do fluxo).
- Contato já conhecido por OUTRA instância da mesma conta: agora reaproveita
  em vez de tentar duplicar — é a correção em si.
- Isolamento entre contas: preservado — a busca por telefone é sempre
  escopada pela própria URL da conta (`ChatwootConta.accountId`); nunca
  cruza contas/tenants diferentes.
- Sem duplicidade: não reenviei nem reprocessei as duas mensagens perdidas
  (instrução explícita do recado) — a correção vale só para tráfego novo.

## 7. Limitação NÃO comprovada — risco a confirmar

Nos dados de `chat_conversas` das OUTRAS instâncias deste mesmo tenant,
encontrei o mesmo número aparentemente gravado em dois formatos diferentes
(`556196863171`, sem o nono dígito, e `5561996863171`, com ele) — a
ambiguidade histórica de numeração brasileira, já reconhecida em outro
ponto do próprio código (`baileys.ts:365-367`, e tratada com busca por
sufixo de 8 dígitos em `leadPeloTelefone`, discadora). Minha correção busca
por **igualdade exata** de telefone. Se o contato que colidiu com "final
6019" estiver registrado num formato de dígitos diferente do que o WhatsApp
atribuiu à mensagem de teste, o mesmo 422 pode voltar a acontecer mesmo com
a correção. **Não tenho evidência de que isso aconteceu neste caso
específico** — é um padrão observado em dados não relacionados, não uma
causa confirmada para este incidente. Registro para não normalizar sem
prova, mas para não silenciar o risco.

## 8. Instrução de homologação

Corrigido o código; a validação real depende de reenvio de mensagem de
teste, que não fiz nesta etapa por instrução explícita. Sugestão pro
próximo teste combinado com Bruno: mandar "Oi" de novo pro mesmo número
(final 6019) do MESMO telefone que gerou o 422. Se aparecer no Atendimento
sem erro nos logs, a causa e a correção estão fechadas. Se o mesmo 422
voltar a acontecer, é evidência direta do risco da seção 7 — nesse caso o
próximo passo é normalizar a busca por telefone pelo sufixo de 8 dígitos
(mesmo padrão já usado em `leadPeloTelefone`), não uma migration nem mudança
de schema.
