# SPEC — Funis dedicados do AlvoConsig (Parceiros)

> Desenhado em conversa com o Bruno em 26-27/08/2026. **Especulação de
> solução, não implementado.** Requer: (1) criação manual dos pipelines no
> WeSales (a API não cria pipeline — mesma limitação já documentada em
> `src/lib/alvoconsig/ofertas-wesales.ts`), (2) revisão do Fable antes de
> qualquer implementação (novo fluxo + integração WeSales cross-repo).

## Por que dois funis novos, separados dos que já existem

Hoje o CRM AlvoConsig usa o pipeline `FUNIL DE VENDAS` (`src/lib/wesales/stages.ts`,
17 estágios) e o Workspace tem, à parte, o pipeline `Ofertas de Crédito`
(`src/lib/alvoconsig/ofertas-wesales.ts`) usado pela venda própria (NuAzul/CLT).
Dois problemas motivam pipelines **exclusivos do AlvoConsig**:

1. **Contaminação de métrica/comissão**: produção de parceiro (BRS Promotora)
   e venda própria (NuAzul) nunca podem se misturar num relatório de
   comissionamento — compartilhar pipeline exigiria filtro constante e cria
   risco de erro.
2. **"Disponível" nunca é estimativa**: o motor de ofertas gera uma
   oportunidade por banco/tabela pra uma MESMA margem (mutuamente
   excludentes entre si — fechar uma esvazia as outras). Somar tudo em
   "Disponível" superestima a produção. É preciso um gatilho claro de
   "interesse real confirmado" antes de qualquer coisa contar como pipeline
   de verdade.

## Modelo de negócio por trás (por que não tem remarketing aqui)

O AlvoConsig é deliberadamente uma ferramenta de **primeira venda descartável**:
o parceiro prospecta e fecha, mas não faz gestão de carteira — leads/clientes
saem do radar ativo do AC assim que saem do funil (concretizado, perda, ou
refin futuro). Motivo: parceiros são, no perfil observado, imediatistas,
desorganizados e com alta rotatividade — não vão executar bem um
relacionamento de longo prazo mesmo se a ferramenta permitisse. O cliente
tende a lembrar do banco, não do correspondente (que raramente tem presença
digital forte) — então quem retoma contato (aniversário, datas, novas
oportunidades) com marca forte e presença digital consolidada tende a
conquistar a fidelidade sem soar invasivo. Esse retrabalho de carteira é
justamente o ganho de escala reservado pra NuAzul: todo o histórico de
contato construído pelo parceiro fica no WeSales, disponível pra NuAzul
trabalhar depois. O parceiro pode exportar clientes concretizados, mas é um
recurso que na prática não deve ser muito usado — não é o modelo de negócio
dele.

## Funil AC (AlvoConsig) — Prospecção

1-lead-por-card. Controle de relacionamento/contato, sem detalhe de oferta.

**Criado de fato no WeSales em 28-29/08/2026** (pipeline "AC - Prospecção (1
card por lead)"). O Bruno refinou o desenho original em 3 pontos ao criar:
marcou **(AC)** ou **(NA)** em cada etapa a partir de "Em atendimento"
indicando de quem é a posse do lead naquele ponto (AC = ainda com o
parceiro; NA = já reaproveitável pela NuAzul); generalizou a saída pra
NuAzul também pra "Geladeira", não só "Oferta Futura de Refin"; e separou
"Perda" em duas (AC/NA) pra distinguir lead morto ainda com o parceiro de
lead morto depois do bastão já ter passado. Nomes finais, na ordem real
criada no WeSales:

| Etapa (nome real no WeSales) | Descrição |
|---|---|
| Carteira de Leads | Todos os leads de uma campanha criada no Workspace entram aqui direto. Tem alguma oferta, mas não mostra qual. |
| Em prospecção | Sendo trabalhado por uma campanha (ligação, IA de voz, disparo de mensagem). |
| Em contato | Respondeu a algum contato da prospecção. |
| Em atendimento (AC) | Conversa ativa, ainda sem definição de interesse. |
| Lead Interessado (AC) | Confirmou interesse em alguma das ofertas apresentadas. |
| Em negociação (AC) | Oferta(s) decidida(s), ajuste final — espelha o "Em negociação" do funil de Oferta (mesmo gatilho, os dois avançam juntos). |
| Em fechamento (AC) | Agregado — cobre Digitação/Análise, Formalização, Liberada do funil de Oferta (rollup, não sincroniza 1:1 por oferta). |
| Concretizado (AC) | Equivalente a "Proposta Paga" — pelo menos uma oferta pagou. Credita a produção do parceiro; a saída pra NuAzul acontece nas etapas seguintes, não aqui. |
| Ofertas Complementares (AC) | Gatilho: sucesso (virou cliente). Oferece produtos que somam (energia solar, seguros, coberturas, capitalização, investimento) — não compete com a venda já fechada. Se o complementar não for crédito, bifurca pra outro funil/processo (não bancário). |
| **Geladeira (NA)** | Aguardo de contato em prazo definido (motivo genérico). **Saída p/ NuAzul**: já reaproveitável pra retomada de relacionamento. |
| **Oferta Futura de Refin (NA)** | Aguardo específico por regra de carência do convênio/IF (3/6/12 meses, variável). **Saída p/ NuAzul**: quando a data chegar, o retrabalho é da fila da NuAzul, não do parceiro. |
| Perda (AC) | Sem interesse/sem nova tentativa, ainda na fase ativa do parceiro. |
| Perda (NA) | Sem interesse/sem nova tentativa, já depois do bastão ter passado pra NuAzul (veio de Geladeira/Oferta Futura de Refin). |

**Regra de retorno em aberto (a decidir)**: quando uma oferta cai em
"Reprovadas Operacional" (funil de Oferta) mas o lead ainda tem interesse,
o card de Prospecção não vai pra "Perda" — o funil de Oferta trata isso via
"Reavaliar Ofertas Disponíveis" (ver abaixo); o card de Prospecção
provavelmente permanece em "Em negociação"/"Lead Interessado" enquanto isso
roda, sem precisar de etapa própria do lado de Prospecção.

## Funil AC (AlvoConsig) — Oferta

1-oferta-por-card (pode ter vários cards simultâneos por lead — ex.: Novo +
Refin). Controle do processo comercial/bancário de cada oferta específica.

| Etapa | Descrição |
|---|---|
| Ofertas Disponíveis | Todas as ofertas calculadas — explicitamente NÃO é estimativa de produção (mesma margem gera N ofertas mutuamente excludentes). |
| Em negociação | Oferta(s) decidida(s) — a partir daqui, as não escolhidas não continuam. |
| Digitação/Análise Bancária | Processo operacional. |
| Formalização | Processo operacional. |
| Liberada p/Pagamento | Processo operacional. |
| Proposta Paga | Fim de funil — resultado real. |
| Reprovadas Operacional | Status aplicado na etapa onde a oferta caiu (preserva ONDE se perde — mesmo padrão já usado em `ofertas-wesales.ts` pra "Perdida"; **não** uma etapa terminal única, pra manter granularidade de relatório: reprova mais na digitação ou na formalização?). |
| Reavaliar Ofertas Disponíveis | Gatilho: reprovação operacional. Busca outra oferta do mesmo produto/IF (juro/prazo diferente); se não achar, substitui por outro produto de CRÉDITO (Crédito Pessoal, CGI, CGV, Pix Parcelado, Empréstimo na Conta de Energia, FGTS, Portabilidade). Não interrompe negociação em andamento — só entra depois de reprovação real. |

## Pendências antes de implementar

1. Criar os dois pipelines manualmente no WeSales (nomes e etapas exatos
   ainda a definir — seguir esta tabela).
2. Fable revisar o desenho geral (é fluxo novo + toca `ofertas-wesales.ts`
   compartilhado + exige o AlvoConsig virar dois boards em vez de um).
3. Decidir o mecanismo técnico do rollup Prospecção↔Oferta (webhook,
   trigger no banco, ou cron de sincronização) — quem escreve o quê e
   quando, pra "Em Fechamento"/"Concretizado" refletirem o estado agregado
   das ofertas sem sincronizar campo a campo.
4. Produtos não-bancários (energia solar, seguros etc., citados em
   "Verificar Ofertas Complementares") ainda não têm funil/processo
   desenhado — o funil de Oferta atual é bancário-específico e não serve
   pra eles sem adaptação.

## Decisões de arquitetura — revisão Fable 5 (29/08/2026)

Desenho dos dois funis **aprovado** como criado no WeSales (ids/cores em
`brs-alvoconsig/apps/web/src/lib/wesales/ac-stages.ts`). As decisões
abaixo fecham as pendências 2 e 3 acima e são o roteiro de implementação.
Migrations continuam saindo só do brs-workspace.

1. **Estado por oferta vira tabela** — `crm_ofertas` (1 linha por
   oferta): `contato_id`, `agente_parceiro_id`, `tipo` (novo/refin/cartão),
   `instituicao_id`, `tabela_id`, `valor_liberado`, `parcela`, `prazo`,
   `taxa`, `estagio` (key de `ESTAGIOS_AC_OFERTA`),
   `reprovada_no_estagio` (preserva ONDE caiu — "Reprovadas Operacional" é
   status, não coluna terminal), `wesales_opportunity_id`, timestamps,
   `deleted_at`. O jsonb `crm_contatos.ofertas` passa a ser só cache do
   cálculo; o que vale é `crm_ofertas`. É o que a tela de Ofertas lê.
2. **Vocabulário de etapas do lead** — `crm_contatos.funil_estagio` passa
   a usar as keys de `ESTAGIOS_AC_PROSPECCAO`; `stages.ts` (17 etapas)
   sai do CRM e fica só como de-para de migração:
   `entrou_em_contato→carteira_de_leads`, `respondeu_primeiro_contato→em_contato`,
   `nao_respondeu→em_prospeccao`, `conversa_em_andamento|em_follow_up|
   ativar_follow_up_automatizado→em_atendimento`, `oferta_realizada→
   lead_interessado`, `documentos_enviados→em_negociacao`, `em_digitacao|
   em_formalizacao|aguardando_pagamento→em_fechamento`, `pagamento_feito→
   concretizado`, `nao_fechou_pos_oferta|nao_tem_interesse→perda_ac`,
   `geladeira_*→geladeira`.
3. **Rollup Oferta→Prospecção: camada de aplicação do brs-alvoconsig,
   função pura + 3 gatilhos.** Descartados: trigger de banco (não fala com
   o WeSales), workflow nativo do WeSales (não cruza pipelines de forma
   confiável) e cron sozinho (latência). `derivarEstagioProspeccao(ofertas)`:
   alguma `proposta_paga` → `concretizado`; senão alguma em
   `digitacao_analise_bancaria|formalizacao|liberada_pagamento` →
   `em_fechamento`; senão alguma `em_negociacao` → `em_negociacao`; senão
   → **sem alteração**. Só avança — nunca regride sozinho e nunca move pra
   Perda/Geladeira/NA (decisão humana; "todas reprovadas" fica onde está,
   como o spec já dizia). Gatilhos: (a) server action `moverOferta` do CRM
   recalcula e, se mudou, chama o `moverEstagio` do contato (fila
   `mover_estagio`, como hoje); (b) webhook inbound pra eventos do pipeline
   AC-Oferta; (c) reconciliação 1x/dia no cron `alvoconsig-conferencia`
   como rede de segurança.
4. **Webhook passa a ser pipeline-aware.** Hoje ele casa o `stageId` contra
   o funil de 17 etapas e escreve em `crm_contatos` por `wesales_contact_id`
   sem olhar de que pipeline veio. Passa a despachar por `pipelineId`:
   AC-Prospecção → `crm_contatos.funil_estagio`; AC-Oferta → `crm_ofertas`
   por `wesales_opportunity_id` (+ rollup). Eventos de qualquer outro
   pipeline (Ofertas de Crédito da NuAzul, FUNIL DE VENDAS) são ignorados —
   o mesmo contato pode ter oportunidades da NuAzul, e elas não são do
   parceiro.
5. **Campanhas do Workspace param de contaminar a NuAzul.**
   `api/alvoconsig/campanhas/route.ts` cria hoje as oportunidades de oferta
   em "Ofertas de Crédito" — pipeline compartilhado com a venda própria,
   exatamente o problema 1 deste spec. Passa a criar em AC-Oferta ("Ofertas
   Disponíveis") + a oportunidade do lead em AC-Prospecção ("Carteira de
   Leads"), gravando os ids em `crm_ofertas`/`crm_contatos`.
   `ofertas-wesales.ts` recebe o pipeline por parâmetro; NuAzul segue em
   "Ofertas de Crédito".
6. **Posse NA é regra de servidor, não só de tela.** Além de o Kanban não
   mostrar as etapas `posse: 'na'`, `moverEstagio` rejeita destino NA vindo
   do parceiro (master ou atendente). Mover pra Geladeira/Refin/Perda (NA)
   é ação do Workspace (BRS/NuAzul) ou automação futura (ex.: geladeira por
   inatividade). Perda (AC) continua disponível pro parceiro.
7. **Migração do que já existe — DISPENSADA (29/08/2026).** Medido no
   banco antes de escrever o script: `crm_contatos` tinha 22 linhas, todas
   soft-deletadas, 0 donos ativos, 0 ofertas em jsonb — não havia lead vivo
   pra migrar. Todo lead alocado daqui em diante já nasce nos funis AC pela
   fase C. Se algum dia aparecer lead com key legada, a leitura tolera
   (`normalizarEstagioProspeccao`) e o worker leva a oportunidade antiga
   pro pipeline AC na 1ª movimentação (PUT com `pipelineId`).
8. **Dashboard** — `ESTAGIOS_POR_BLOCO` em `lib/crm/actions.ts` remapeia
   pras keys AC junto com o item 2 (senão os KPIs zeram).
9. **Fica pra depois** — funil de produtos não-bancários (pendência 4):
   decidir quando existir produto; "Ofertas Complementares (AC)" é só
   coluna de estacionamento por enquanto.

**Ordem de execução** (2→8 são execução sobre padrão definido, Sonnet;
migration do item 1 e o script do item 7 passam pelo Fable):
1 migration `crm_ofertas` → 2 vocabulário + de-para → 5 campanhas → 4
webhook → 3 rollup → 6 regra NA → UI Leads (Kanban AC-Prospecção, cores
reais, sem colunas NA) e UI Ofertas (board AC-Oferta) → 7 migração de dados
→ 8 dashboard.
