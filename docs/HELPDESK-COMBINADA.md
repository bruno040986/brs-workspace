# HelpDesk: combinação da linha-do-tempo com a produção (opção C)

Data: 21/10/2026 · Branch `helpdesk/combinada` (a partir de `origin/main` b35a3246)
· Worktree `../brs-workspace-helpdesk-combinada`.

O que já estava em produção (fases 1-2, 3 e 3.1) é a base. Da branch
`helpdesk/linha-do-tempo` (commits 302382e0 e 5c38351f, migration
`20261001224457_helpdesk_linha_do_tempo.sql`) veio só o que não existia,
encaixado no modelo atual, sem tabela ou trigger duplicado.

## Migration

`supabase/migrations/20261021235112_helpdesk_controle_responsavel_etapas.sql`
(aditiva, idempotente). Ordem: depois de `20261021211754_helpdesk_fase3.sql`
(e da `20261021202951`, de outra sessão, que não está no repo). **Não foi
aplicada em nenhum banco.**

| Parte | Efeito |
|---|---|
| `controle_numero` + `helpdesk_controle_seq` | número de controle; tickets existentes numerados por `created_at, id` (os 3 de produção viram HD-0001..0003); default `nextval`, `not null`, índice único |
| `app_private.helpdesk_codigo(bigint)` | formata `HD-0001`; acima de 9999 vira `HD-10000` (a linha-do-tempo usava `lpad(...,4)`, que truncaria) |
| `responsavel_id` (FK users) / `responsavel_ia` (slug) / `responsavel_em` | responsável: pessoa OU IA, nunca os dois (check) |
| `helpdesk_etapas` | etapas do plano (ordem, título, status pendente/em_andamento/concluida, concluida_em); RLS sem policy, como as outras tabelas |
| `helpdesk_anexos.comentario_id` | imagem em comentário (mesma tabela, mesmo bucket) |
| `helpdesk_historico.evento/detalhe` | linha do tempo única: eventos de responsável e etapa no mesmo histórico (`evento` nulo = mudança de status, como antes) |
| `trg_helpdesk_historico` (refeito) | agora também em `update of responsavel_id, responsavel_ia` |
| `trg_helpdesk_historico_etapa` (novo) | etapa iniciada/concluída vai ao histórico, sem notificar |
| `trg_helpdesk_validar_transicao` (novo aqui) | recusa transição fora da máquina; reabrir só dentro de `helpdesk_reabrir`; `aprovado` exige `aprovado_por` |
| `helpdesk_notificar` (refeito, o MESMO trigger) | todos os avisos da fase 3 iguais; corpo do sino/e-mail vira `HD-0001 · <título>`; novo aviso `helpdesk_assumido` ao solicitante quando uma pessoa assume |
| `helpdesk_comentario_notificar` (refeito) | igual, com o código HD no corpo |

## O que veio da linha-do-tempo

- **Número de controle HD-0001**: cards, detalhe, busca ("HD-0003"), sino,
  e-mail e MCP (`codigo` em listar/ler).
- **Responsável**: botão "Assumir"/"Liberar" (só aprovador) no detalhe;
  responsável no card e no detalhe; a IA vira responsável ao iniciar a
  execução pelo MCP.
- **Etapas**: tabela, lista com progresso no detalhe ("2/5") e no card,
  escritas pela rotina com a ferramenta nova `helpdesk_definir_etapas`.
- **Validação de transição no banco**, reescrita para permitir o reabrir.
- **Evidência depois da abertura**: imagem em comentário (colar/anexar),
  reaproveitando o fluxo da main (`/api/chat/upload`, bucket privado
  `workspace-chat`, URL assinada, path validado na pasta do próprio usuário).

## O que foi descartado e por quê

| Item da linha-do-tempo | Decisão |
|---|---|
| `helpdesk_eventos` (append-only) | descartado. Mapeado: criado/status/plano/aprovado/concluído/rejeitado → `helpdesk_historico` (já existia); comentário → `helpdesk_comentarios`; assumido → `historico.evento='responsavel'`; fatia iniciada/concluída → `historico.evento='etapa'`; commit → `helpdesk_registrar_resultado` (branch + commit em `comentario_solucao` + comentário); análise → comentário; deploy/migration_aplicada → é o Bruno concluindo (fora do MCP) |
| `helpdesk_notificar` da branch | descartado: apagaria os avisos aprovado/em_execucao/reaberto/comentário e a fila de e-mail. O trigger da fase 3 foi estendido |
| `helpdesk_evento_notificar` | descartado (comentário já notifica por `trg_helpdesk_comentario_notificar`) |
| RLS restritiva / `visibilidade.ts` / `visivel_solicitante` | descartado: decisão do Bruno, todos veem todos os tickets |
| API própria do agente (`/api/helpdesk/agente/*`, `HELPDESK_AGENT_TOKEN`, `agent-api.ts`, `service-auth.ts`, RPCs `helpdesk_agent_*`, `request_id`) | descartada: a rotina usa só as ferramentas MCP. Idempotência: as transições do MCP já filtram `status = <de>` e conferem 1 linha |
| Bucket `helpdesk-evidencias`, PDF, `storage.ts`, policy em `storage.objects` | descartado: a main já guarda imagens em bucket privado com URL assinada e acesso só pelo servidor. PDF fica para quando alguém pedir |
| Página `/helpdesk/[id]` e `HelpdeskDetalheClient` | descartada: o detalhe é o modal da main. Link direto por ticket fica para depois (o sino continua em `/helpdesk`) |
| Realtime (publication) | descartado: a tela já atualiza a cada 60 s |
| `assumido_por text` misturando uuid e `'agente_claude'` | trocado por `responsavel_id` (FK) + `responsavel_ia` (slug), nomes diferentes para não colidir se aquela migration já tiver rodado em algum banco |
| `trg_helpdesk_validar_transicao` da branch | substituído (mesmo nome) pela versão que permite `concluido/rejeitado → aberto` via `helpdesk_reabrir` |
| `buildHelpdeskCommitUrl` (link do GitHub) | descartado por ora: o commit aparece no texto da solução |

## Decisões tomadas sem perguntar

1. **Pessoa responsável tira o ticket da IA.** Com `responsavel_id`, o
   ticket some do filtro padrão do MCP e `propor_plano`/`iniciar_execucao`
   recusam (checagem + `responsavel_id is null` no UPDATE, atômico).
   Comentar e registrar resultado continuam. Só aprovador assume/libera.
2. **IA como responsável** só ao iniciar execução (não ao propor plano).
   Reabrir não mexe no responsável.
3. **Etapas só pela IA** (sem edição na tela) e só com o ticket em
   plano_proposto, aprovado ou em_execucao. A lista é sempre completa
   (substitui); `concluida_em` de etapa já concluída é preservado.
4. **Aviso de responsável** só quando uma PESSOA assume (a IA assume junto
   com "em execução", que já avisa).
5. Imagem em comentário exige texto no comentário (mesma validação de antes).
6. A aba "Meus chamados" continua sendo só os que eu abri.

## Retrocompatibilidade

- Tickets existentes: só ganham número; nada é apagado nem reescrito.
- Código em produção (antes do deploy desta branch) continua funcionando
  com a migration aplicada: as transições que ele faz são todas permitidas
  pela validação; insert ganha `controle_numero` pelo default; colunas novas
  são nulas.
- MCP/rotina: ferramentas e campos antigos iguais; só acrescenta `codigo`,
  `responsavel`, `etapas`, `historico[].evento/detalhe` e a ferramenta nova.
- Risco: SQL manual que pule estados (ex.: `aprovado → concluido`) passa a
  falhar com "HelpDesk: transição inválida". Ajuste manual excepcional:
  passar por `em_execucao` primeiro.

## Impacto na outra sessão (worktree `brs-workspace-helpdesk`, branch `helpdesk/linha-do-tempo`)

- **Não aplicar** `20261001224457_helpdesk_linha_do_tempo.sql` em banco
  nenhum: o timestamp é anterior à fase 3 e, se rodar depois dela, apaga os
  avisos da fase 3, bloqueia o reabrir e restringe a visibilidade.
- Não rebasear a branch inteira: ela parte de base antiga (91026fc2) e
  reescreve `actions.ts`/`page.tsx`/`tipos.ts`, que mudaram muito na main.
  O que tinha valor já está aqui; o resto deve ser descartado. Trabalho novo
  em HelpDesk: partir de `helpdesk/combinada` (ou da main depois do merge).
- Quem chamava a API `/api/helpdesk/agente/*`: usar as ferramentas MCP
  `helpdesk_*` (contrato em `docs/HELPDESK-ROTINA-CLAUDE.md`).
- Nomes: `assumido_por/assumido_em` → `responsavel_id/responsavel_ia/responsavel_em`;
  `helpdesk_eventos` → `helpdesk_historico` + `helpdesk_comentarios`;
  `controle_numero` e `helpdesk_etapas` mantêm o nome.

## Para publicar (Bruno)

1. Aplicar `20261021235112_helpdesk_controle_responsavel_etapas.sql`.
2. Deploy da branch (a tela e o MCP leem as colunas novas: o deploy tem de
   vir **depois** da migration).
3. Conferir: HD-0001..0003 nos 3 tickets; reabrir um concluído; rotina
   listando com `codigo`.
