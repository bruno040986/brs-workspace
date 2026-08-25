# SPEC — CRM AlvoConsig sobre o WeSales (campanhas com cópia de trabalho)

**Aprovado pelo Bruno em 23/08/2026.** Escrito no Sonnet 5 a partir da decisão; a
**Fase 1 é executada pelo Fable 5** (migrations + regras de sincronização). Fases 2–4 no
Sonnet 5 / Codex.

> **Instrução ao Fable 5:** execute SOMENTE a Fase 1 (seção 6). Ao terminar (migration
> aplicada com `echo Y | supabase db push`, commit + push, memória atualizada), **avise
> explicitamente o Bruno: "Fase 1 concluída — pode voltar para o Sonnet (`/model sonnet`)"**.
> Não avance para as Fases 2–4. Cota do Fable é escassa: seja direto, sem re-explicar o
> plano.

## 1. Princípios (fechados — não rediscutir)

1. **WeSales é o repositório permanente de TODOS os leads**, de qualquer convênio/produto.
   Nunca se descarta lead lá. Não há mais importação de mailing para o Supabase.
2. **Dono = TAG** no WeSales: `parceiro:<codigo_arw>`. **Base = TAG** `base:<slug>`.
   **Cliente conquistado = TAG** `cliente:<codigo_arw>`. O campo "Proprietário"
   (`assignedTo`) **não é usado** — atendentes existem só no Supabase (`crm_usuarios`).
3. **Dados do lead = campos personalizados** do WeSales (cpf, margem_novo, margem_cartao_rmc,
   margem_cartao_rcc, refin_troco, refin_parcela, refin_prazo, refin_taxa, matricula,
   codigo_empregador, convenio). O worker já cria campos via `ensureCustomField`.
4. **Importação**: CSV nativo do WeSales para volume grande (inclusive CLT); API pelo
   Workspace para lotes pequenos (regra: até ~2.000 linhas), gravando direto no WeSales
   **sem persistir** em tabela local.
5. **Supabase guarda apenas**: (a) cópia de trabalho TEMPORÁRIA por campanha, com o mínimo
   de campos de tela + ofertas pré-calculadas; (b) controle de dono PERMANENTE sem PII;
   (c) carteira de clientes do parceiro PERMANENTE sem PII; (d) presença de atendente.
6. **Latência**: durante ligação/atendimento, toda leitura é local (ms). API do WeSales só
   em criação de campanha, sincronização em background, exportação e conferência.

## 2. Ciclo de vida da campanha

```
criar campanha (parceiro, base, filtros, qtd, vigência)
   → busca WeSales: tag base:<slug> AND NOT parceiro:* AND NOT cliente:*
   → aplica tag parceiro:<arw> no WeSales (fila)
   → copia campos de tela p/ crm_contatos (campanha_id, expira_em) c/ ofertas calculadas
atender → leitura/escrita local; cada movimento → crm_wesales_queue → WeSales (cron 1 min)
webhook WeSales → atualiza cópia (só campos "do WeSales")
fim da vigência → fila zerada e confirmada → expurgo das linhas locais, EXCETO:
   • negociação aberta (estágio ativo): estende automaticamente até estágio final
   • concretizado pendente de certificação: mantém até certificar
conferência diária → compara cópia × WeSales e corrige divergências
```

### Dono de cada campo (regra anti-conflito)
| Campo | Dono | Fluxo |
|---|---|---|
| nome, telefone, cpf, convênio, margens, refin_* | **WeSales** | webhook → cópia local (sobrescreve) |
| funil_estagio, tabulações/atendimentos, observações | **CRM** (durante a campanha) | fila → WeSales |
| tags parceiro:/cliente: | **Workspace** (alocação/certificação) | fila → WeSales |

## 3. Cliente conquistado

- Atendente move para `concretizado` → status local `certificacao_pendente`.
- Operacional BRS **certifica no Workspace** (permissão `alvoconsig-certificacao`) → sistema:
  aplica tag `cliente:<arw>` no WeSales (fila), grava `crm_clientes_parceiro` (sem PII),
  libera a cópia local para expurgo. Lead com `cliente:*` **nunca é realocado**.
- **Exportar "meus clientes"** (CRM do parceiro): busca no WeSales por tag `cliente:<arw>`
  na hora e gera CSV. Não é tempo real — latência da API é aceitável. Dados do cliente
  continuam morando só no WeSales.

## 4. Discadora + tela (Fase 4 — desenho entra agora)

- **Presença do atendente** (`crm_atendente_presenca`): `livre | em_ligacao |
  pos_atendimento | offline`, heartbeat; motor escolhe o **primeiro livre**.
- **Ligação atendida** → motor acha lead pelo telefone na cópia local (índice) → evento
  **Supabase Realtime** no canal do atendente → CRM abre **overlay em tela cheia** por cima
  de tudo: nome, convênio, ofertas **Refin e Novo em destaque**, botões de tabulação.
  Ofertas já pré-calculadas → o pop só exibe. Alvo: 100–300 ms.
- **WhatsApp recebido**: NÃO é overlay. Na conversa, uma **seta/ícone** que abre uma
  **barra lateral** com todas as informações do lead, margens e ofertas. Rápido, mas não
  imediato como a ligação.

## 5. O que muda no que existe

| Hoje | Passa a ser |
|---|---|
| `/alvoconsig/importacoes` → `crm_contatos` | Importação pequena → **API do WeSales direto** (sem persistir); volume grande → CSV nativo no WeSales |
| `crm_lotes_alocacao` (lote) | **`crm_campanhas`** com vigência/status; lote vira campanha |
| `crm_contatos` permanente | **cópia de trabalho** por campanha: `campanha_id`, `expira_em`, `ofertas` jsonb pré-calculadas, expurgo |
| dono implícito em `crm_contatos.agente_parceiro_id` | **`crm_dono_leads`** permanente sem PII (wesales_contact_id, parceiro, campanha, datas) |
| — | **`crm_clientes_parceiro`** sem PII; certificação pelo operacional |
| — | **`crm_atendente_presenca`** |
| fila `crm_wesales_queue` | mantida; ganha operações `aplicar_tag`, `remover_tag`, `sincronizar_estagio`, `sincronizar_atendimento` |
| webhook inbound | mantido; respeita regra de dono de campo |
| `crm_imports` | mantida só como log das importações via API |

## 6. FASE 1 — Fable 5 (migrations + regras)

Uma migration `supabase/migrations/2026082513xxxx_crm_campanhas_wesales.sql` no
brs-workspace (padrões: `app_private.enable_rls_if_exists` + `apply_policy`; INSERT usa o
5º parâmetro `with check`; RPCs sensíveis `security definer` service_role only):

1. **`crm_campanhas`** — id, agente_parceiro_id, descricao, base_tag text, filtros jsonb,
   qtd_solicitada, qtd_alocada, vigencia_inicio date, vigencia_fim date, status
   (`montando|ativa|encerrando|encerrada|cancelada`), criado_por/em, encerrada_em.
   Migrar `crm_lotes_alocacao` → `crm_campanhas` (ou renomear + adicionar colunas; decidir
   pelo menor risco — os lotes existentes são de teste).
2. **`crm_contatos`** vira cópia de trabalho: add `campanha_id` FK, `expira_em`,
   `ofertas jsonb` (pré-calculadas: novo/rmc/rcc/refin com coeficiente usado e vigência),
   `estado_local` (`ativo|negociacao_aberta|certificacao_pendente|expurgavel`),
   `sincronizado_em`. Índice por `telefone` (dígitos) e por `(campanha_id, funil_estagio)`.
   Manter `wesales_contact_id` NOT NULL a partir de agora (toda cópia nasce do WeSales).
3. **`crm_dono_leads`** (permanente, sem PII): wesales_contact_id, agente_parceiro_id,
   campanha_id, alocado_em, revogado_em, motivo. UNIQUE parcial (contact ativo = 1 dono).
4. **`crm_clientes_parceiro`** (permanente, sem PII): wesales_contact_id, agente_parceiro_id,
   campanha_id, produto, valor, certificado_por, certificado_em, observacao.
5. **`crm_atendente_presenca`**: crm_usuario_id PK, estado, atualizado_em, contato_atual_id.
6. **Permissão** nova `alvoconsig-certificacao` (rota `/alvoconsig/certificacao`, matriz).
7. **RPCs** (service_role): `crm_encerrar_campanha(p_campanha_id)` (valida fila zerada,
   marca expurgáveis respeitando exceções, apaga), `crm_certificar_cliente(p_contato_id,
   p_user_id, p_produto, p_valor)`.
8. **Regras de dono de campo** documentadas como comentários na migration + constante
   `CAMPOS_DO_WESALES` / `CAMPOS_DO_CRM` em `src/lib/alvoconsig/campos-sync.ts` (arquivo
   pequeno; o worker/webhook das Fases 2–3 consomem).
9. Atualizar `docs/` e memória; commit; **avisar o Bruno para voltar ao Sonnet**.

## 7. FASE 2 — Workspace (Sonnet/Codex) — CONCLUÍDA (23/08/2026)
Importação pequena via API direto no WeSales (reaproveita mapeamento configurável;
aplica tag `base:`); criação de campanha a partir do WeSales (search por tag → aplica
`parceiro:` → copia → calcula ofertas); tela de certificação; job de expurgo (cron); job
de conferência diária.

Implementado: `src/lib/wesales/client.ts` (client próprio do Workspace), `src/lib/alvoconsig/ofertas.ts`,
`src/lib/alvoconsig/campanha-encerramento.ts`, `POST /api/alvoconsig/campanhas`, `/api/alvoconsig/upload`
reescrito (grava direto no WeSales, ≤2.000 linhas), crons `alvoconsig-expurgo` (diário) e
`alvoconsig-conferencia` (30 min), telas `alocacao` (campanhas), `certificacao` (nova), `contatos` e
resumo ajustados. `brs-alvoconsig`: worker ganhou `aplicar_tag`/`remover_tag`.

**Pendências:**
- `WESALES_API_TOKEN`/`WESALES_LOCATION_ID` na Vercel do Workspace (copiar do brs-alvoconsig) — sem
  isso as rotas de importação/campanha falham.
- Tela de Central de Integrações NÃO ganhou card de saúde do CRM — em vez disso, a saúde (fila
  pendente/erro) apareceu como cards na própria home do AlvoConsig (`/alvoconsig`), mais simples e
  sem mexer no framework de orquestradores (que é para satélites externos, não para isso). Revisar se
  quiser padronizar com o resto depois.
- Tela de Certificação depende da Fase 3 (CRM, brs-alvoconsig) marcar
  `estado_local='certificacao_pendente'` ao mover lead pro estágio final — por ora usa
  `funil_estagio='pagamento_feito'` como fallback manual e fica vazia até a Fase 3 existir.
- Conferência não reconcilia convênio via nome, só via `codigo_convenio` (custom field) — se a
  planilha original não tinha coluna de código, o convênio da cópia local não é corrigido pelo cron.

**Refinamento REFIN multi-oferta (24/08/2026, versão inicial):** slots numerados no contato —
SUPERSEDIDO pelo redesenho de Oportunidades abaixo, no mesmo dia.

**Redesenho — ofertas viram Oportunidade no WeSales (24/08/2026):** dois bugs reais (instituição
gravada como UUID cru, taxa sem formatar) expuseram o limite do modelo de campos numerados —
substituído por um mais correto: cada oferta (REFIN de uma tabela/banco, ou Novo/Cartão calculado
por coeficiente) vira uma **Oportunidade própria** no WeSales, não mais campos "slot 1..5" no
contato. Ver `src/lib/alvoconsig/ofertas-wesales.ts` (registro de campos/pipeline/etapas) e
`src/lib/wesales/client.ts` (CRUD de Oportunidade + campos por modelo contact/opportunity +
resolução de pipeline por nome — a API não cria pipeline, criado uma vez na interface).

- **Pipeline "Ofertas de Crédito"** (criar manualmente no WeSales — nomes exatos das etapas, nessa
  ordem): Disponível → Em Negociação → Digitação / Análise Bancária → Formalização → Liberada p/
  Pagamento → Proposta Paga. "Perdida" não é etapa, é o **status** da oportunidade (lost/abandoned)
  aplicado na etapa em que estava — mostra onde cada oferta se perde.
- **12 campos de Oportunidade**, um conjunto só reaproveitado por todo tipo de oferta (REFIN usa
  todos; Novo/Cartão deixa os específicos de REFIN vazios): tipo_oferta, parcela, prazo, taxa,
  tabela (código banco), instituição (id), parcelas_pagas, saldo_devedor, contrato, contrato
  elegível, valor do seguro, tem seguro.
- **9 campos de Contato** para margem — `MARGEM_FIELD_KEYS`: Valor/Data/Convênio × Novo/RMC/RCC —
  é só a "foto atual" (sem histórico); o histórico real mora nas Oportunidades, criadas na
  campanha quando a margem é cruzada com o coeficiente.
- Reimportar a MESMA oferta (mesma instituição+tabela) atualiza a Oportunidade (nunca mexe na
  etapa — preserva o progresso do atendimento); oferta nova cria outra.
- Ao encerrar campanha: ofertas abertas dos leads não certificados são marcadas **lost** (mantém a
  etapa onde pararam) — `marcarOfertasPerdidas` em `campanha-encerramento.ts`.
- **Pendência**: certificação ainda não coleta "qual oferta foi a escolhida" — quando um cliente é
  certificado, as ofertas dele não são tocadas no encerramento (nem marcadas ganha, nem perdida).
  Fica pra quando a tela de certificação (ou o CRM, Fase 3) capturar isso.
- **Faxina**: os 30 campos numerados antigos (contato) ficam obsoletos mas não foram apagados
  automaticamente — `limparCamposRefinAntigos()` em `actions.ts` remove as definições (a API
  permite excluir de verdade); disparo manual, sem tela própria (pedir por conversa quando quiser).
- `src/lib/alvoconsig/refin-slots.ts` foi deletado (retirado, sem mais uso).

## 8. FASE 3 — CRM (Sonnet/Codex)
Leitura da cópia local (já é); exportar "meus clientes" via tag; presença básica do
atendente; painel do lead lendo `ofertas` pré-calculadas.

## 9. FASE 4 — Railway (Fable desenha núcleo; Sonnet/Codex executam)
Discadora, roteamento para atendente livre, overlay Realtime da ligação, WhatsApp com
barra lateral.

## 10. Pendências conhecidas
- `WESALES_API_TOKEN` na Vercel do brs-alvoconsig (Bruno).
- Ritmo do worker: subir de 40 ops/min para ~300 ops/min (limite real ~100 req/10 s).
- Coeficientes do empréstimo Novo ainda não cadastrados (Bruno recebe hoje).
- 3 registros de teste criados manualmente em "Consignantes/Empregadores" (Pref
  Salto/SP, Pref de Mesquita/RJ, CLT Consignado do Trabalhador) não foram
  linkados a nenhum convênio — órfãos, Bruno remove quando quiser.
- Duplicatas de Oportunidade REFIN já criadas pelo bug de dedup (antes do fix
  de 25/08) seguem no WeSales — não foram limpas automaticamente.

## 11. Consignante/Empregador (objeto Empresa do WeSales) — decisão 24-25/08/2026
Convênio (tipo de convênio, nome do empregador/órgão, CNPJ) é tão essencial
quanto CPF/nome/telefone para o negócio — precisa estar sempre visível no
contato, não escondido em campo personalizado solto. Objeto nativo do WeSales
para isso: **Business**, renomeado para **"Consignantes/Empregadores"**
(singular "Consignante/Empregador").

**Descoberta de API (validada ao vivo em 24/08/2026, não documentada nos
manuais públicos do GHL):**
- `/businesses/*` (create/update/get) só aceita os campos padrão (nome,
  endereço, telefone...) — **não aceita `customFields`**.
- Campo personalizado em Empresa é outra família de endpoint:
  `/custom-fields/object-key/business` (schema) e
  `/custom-fields/` (criar campo, precisa de `parentId` = pasta "Company
  Info").
- **O valor** de cada campo (padrão OU personalizado) só é lido/escrito via
  `/objects/business/records/{id}` (GET/PUT/POST), como um objeto plano
  `properties` chaveado pelo sufixo da fieldKey (`name`, `city`,
  `alvoconsig_tipo`...) — bem mais simples que o modelo id-de-campo+valor de
  contato/oportunidade. É esse endpoint que o client usa
  (`createBusinessRecord`/`updateBusinessRecord`/`getBusinessRecord` em
  `src/lib/wesales/client.ts`).
- Vínculo contato↔empresa: `POST /contacts/bulk/business` (`ids[]` até 50,
  `businessId` — `null` desvincula). Confirmado que `businessId` aparece
  direto no GET do contato, sem chamada extra.

**Modelo adotado:**
- Um Consignante por **convênio** (não por empregador individual — CLT é de
  outro fluxo, fora deste subsistema). `convenios.wesales_business_id` guarda
  o id, criado 1x e sempre reaproveitado (nunca casa por nome).
- Campos do Consignante: `name` = `convenios.nome_reduzido`, `description` =
  `convenios.nome`, `city`/`state`/`postalcode` = cidade/uf/cep, e 3 campos
  personalizados (`alvoconsig_tipo` — fixo "Convênio Público" neste fluxo,
  `alvoconsig_cnpj`, `alvoconsig_razao_social`).
- Resolução/criação e vínculo dos contatos ficam em
  `src/lib/alvoconsig/consignantes-wesales.ts`, chamado 1x por importação em
  `upload/route.ts` (vínculo em lote de até 50 contatos no fim, não por
  contato dentro do loop).

**`convenios.codigo` virou "Código ARW"** (opcional — só usado pelo
importador de comissionamento, que casa com planilhas vindas do ARW). A
identidade do convênio usada na integração com o WeSales (campo
`alvoconsig_convenio_codigo` no contato, filtro de campanha "todos do
convênio") passou a ser **`codigo_sistema`** (sequencial, 5 dígitos, gerado
pelo banco — sempre presente, nunca ambíguo). Ver migration
`20260825140000_convenios_dados_fiscais_codigo_sistema.sql`.
