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

**Refinamento REFIN multi-oferta (24/08/2026):** um CPF pode ter várias ofertas de REFIN
(linhas diferentes na planilha, cada uma vinculada a uma tabela via `oferta_regra`) — decisão do
Bruno foi guardar TODAS (até 5, `MAX_OFERTAS_REFIN`), não só a melhor. Ver
`src/lib/alvoconsig/refin-slots.ts` (6 campos por slot no WeSales: troco/parcela/prazo/taxa/tabela/
instituição) e `resolverOfertasRefin` em `ofertas.ts` (casa cada slot com `tabelas_comissao` já
cadastrada, por institution_id + codigo_tabela_banco). Importação de REFIN agora exige a
Instituição Financeira (planilha é sempre de um banco só). `crm_contatos.refin_troco` virou resumo
(maior troco); o detalhe completo mora em `ofertas.refin` (array, jsonb) — a coluna antiga
`crm_contatos.refin` (singular) ficou sem uso, não precisou de migration.

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
