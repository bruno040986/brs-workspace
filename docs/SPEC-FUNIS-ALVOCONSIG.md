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
