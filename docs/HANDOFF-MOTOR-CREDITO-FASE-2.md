# HANDOFF — Motor de Crédito (MySQL), Fase 2

> Escrito em 10/09/2026 para abrir uma sessão nova só deste assunto.
> A sessão anterior segue com a Base de Conhecimento de Convênios.

## 1. O que é

O fornecedor de higienização de **margem de convênios públicos** grava o
resultado das consultas numa tabela MySQL dele (`bancobrs`.`consultas`). Hoje a
margem entra no Workspace por **planilha Excel** (Gestão de Leads › Importação,
tipo "margem"). A Fase 2 cria **mais uma forma de importar** — lendo direto do
banco do fornecedor. **Não substitui a importação por Excel** (decisão do Bruno).

## 2. O que já existe (Fase 1 — em produção desde 08/09)

- Credencial + conexão testadas e funcionando: card **Provedores › Motor de
  Crédito (MySQL)** (`/rh/parceiros/config/provedores/motor-credito`),
  permissão `sistema-config-motor-credito`.
- Tabela `motor_credito_mysql_config` (linha única `id=1`): host, porta, banco,
  tabela, usuario, `senha_enc` (cofre AES), **`cursor_coluna`, `cursor_valor`**
  (já previstos para a leitura incremental), `ativo`. Migration
  `20260908224209_motor_credito_mysql_config.sql`.
- `src/lib/motor-credito/mysql-client.ts` — `abrirConexao()` (mysql2, conexão
  por chamada, `connectTimeout` 8s), `testarConexaoMotorCredito`,
  `descreverTabelaMotorCredito` (DESCRIBE), `amostrarLinhasMotorCredito`,
  `identificadorSeguro()` (regex antes de interpolar nome de tabela/coluna).
- `src/lib/motor-credito/config-actions.ts` — actions do card.
- Rede: o fornecedor libera **qualquer IP** (a Vercel não tem IP fixo). Usuário
  `integracaobrs` deve ser **só SELECT** em `consultas` (lado deles).

## 3. O fato novo (10/09) — a tabela tem dado real

`consultas` passou de 0 para **10 linhas**. Schema:

| coluna | tipo | obs |
|---|---|---|
| `id` | bigint unsigned PK | começa alto (ex.: 1486881) — sequência de um sistema maior; serve de **cursor** |
| `tarefa_id` | bigint, index | ex.: 2158 — **semântica ainda desconhecida** |
| `cpf_consultado` | varchar(11) | só dígitos |
| `matricula` | varchar(255) | |
| `nome` | varchar(255) | **veio NULL** na amostra — o nome está em `dados_extras.nome` |
| `valor_margem` | decimal(10,2) | ex.: 8157.88 |
| `valor_disponivel` | decimal(10,2) | ex.: 7862.71 |
| `observacao` | text | ex.: "Consulta realizada com sucesso." |
| `consultado_em` | timestamp | |
| `dados_extras` | json | tem `cpf` formatado, `nome`, e mais chaves (o print cortou) |
| `sucesso` | tinyint(1) | |
| `created_at` / `updated_at` | timestamp | |

### 3.1 Estrutura de `dados_extras` (5 linhas reais analisadas em 10/09)

```
dados_extras
├─ cpf            "000.000.000-00" (formatado)
├─ nome           nome completo  ← usar este (a coluna `nome` vem NULL)
├─ identificacao  = matrícula
├─ cargo          código (ex. "05770")
├─ orgao          ex. "SEFAZ"            (igual em todas as linhas do lote)
├─ lotacao        ex. "20 - SECRETARIA DA FAZENDA E PLANEJAMENTO" (varia por pessoa)
├─ vinculo        ex. "7 - Efetivo"
├─ admissao       "dd/mm/aaaa"
├─ mes_referencia "mm/aaaa"   (ex. "12/2025")
├─ prox_folha     "dd/mm/aaaa"
├─ fim_contrato   "" ou null
├─ margem_bruta       { "<PRODUTO>": { valor_str: "1165,41", valor_float: 1165.41 }, ... }
├─ margem_disponivel  { mesmo formato }
└─ exportador     cópia "achatada" dos mesmos dados (cpf_cliente, nome_cliente,
                  margem_bruta_cartao_de_credito, margem_disponivel_consignacoes_facultativas…)
                  ⚠ NÃO traz o Cartão de Benefício — usar os mapas acima, não o exportador.
```

Produtos que aparecem nos mapas de margem, e a correspondência com os campos
de margem que a importação Excel já grava no WeSales:

| chave no JSON | produto | campo WeSales (`MARGEM_FIELD_KEYS`) |
|---|---|---|
| `CONSIGNACOES FACULTATIVAS` | Empréstimo Novo | `novoValor` / `novoData` |
| `CARTAO DE CREDITO` | Cartão Consignado (RMC) | `rmcValor` / `rmcData` |
| `CARTÃO DE BENEFÍCIO` | Cartão Benefício (RCC) | `rccValor` / `rccData` |

- As colunas de topo `valor_margem` / `valor_disponivel` são só a
  **Consignações Facultativas** (bruta / disponível) repetida — não servem para cartão.
- Valor a gravar = **`margem_disponivel[...].valor_float`** (número; nunca o
  `valor_str`, que tem vírgula). Guardar a bruta também na staging, para a revisão.
- Chaves têm acento e espaço (`"CARTÃO DE BENEFÍCIO"`): comparar normalizando
  (sem acento, maiúsculas), porque o fornecedor pode variar a grafia.
- `created_at` e `updated_at` vieram **NULL** → leitura incremental só pelo `id`.
- Datas vêm em `dd/mm/aaaa` → converter para `AAAA-MM-DD` antes do WeSales.

## 4. Desenho da Fase 2 (já combinado com o Bruno)

```
cron (Vercel) ──lê por cursor id──▶ tabela de STAGING no Workspace
                                       │
                         tela de REVISÃO em Gestão de Leads
                         (humano confere e aprova/rejeita, com botão)
                                       │ aprovado
                                       ▼
                     WeSales — mesma lógica de margem da importação Excel
```

Nunca direto ao WeSales: sempre passa pela revisão humana.

**Reuso obrigatório:** a gravação no WeSales da importação Excel está em
`src/app/api/alvoconsig/upload/route.ts` (bloco `tipo === 'margem'`, ~linhas
200–430): uma "foto" de margem por CPF; campos de contato `MARGEM_FIELD_KEYS`
(`novoValor/novoData`, `rmcValor/rmcData`, `rccValor/rccData`) — valor
MONETORY vai como **número**, data como **AAAA-MM-DD**; `gravarContato()`
(CPF, matrícula **nunca sobrescreve** a existente, Convênio Código/Nome);
tags `base:` + `disponivel`; Consignante via `resolverOuCriarConsignante`;
rastreio em `crm_imports`. Campos/parsers em `src/lib/alvoconsig/import.ts`
(`CAMPOS_IMPORT`, `parseMoney`, `normalizeCpfCell`). **Extrair esse núcleo para
uma função compartilhada** e usar nos dois caminhos — não duplicar.

## 5. Perguntas — situação após a amostra completa (10/09)

**Resolvidas pela amostra:**
- ~~Chaves de `dados_extras`~~ → §3.1.
- ~~`valor_margem` × `valor_disponivel`; tem cartão?~~ → os três produtos vêm
  nos mapas `margem_bruta`/`margem_disponivel` (§3.1); grava-se a disponível.
- ~~Linha atualizada depois~~ → `created_at`/`updated_at` vêm NULL; cursor só por `id`.

**Ainda abertas:**
1. **De qual convênio é cada linha?** Continua sem coluna de convênio. O que
   existe: `orgao` (ex. "SEFAZ", igual no lote inteiro) e `lotacao` (secretaria
   da pessoa, varia). **Proposta:** o convênio é escolhido **por lote
   (`tarefa_id`)** na tela de revisão — o humano diz "o lote 2158 é o convênio X"
   uma vez, e isso vale para todas as linhas dele (e fica salvo para os
   próximos lotes com o mesmo `orgao`, como sugestão). Confirmar com o Bruno se
   um lote do fornecedor é sempre de um convênio só.
2. **`tarefa_id`** — tudo indica ser a lista/lote criada no sistema do
   fornecedor (as 5 linhas são do mesmo 2158, consultadas no mesmo segundo).
   Confirmar se o Bruno enxerga esse número no sistema deles.
3. **Linhas com `sucesso = 0`** (a amostra só tem `1`): descartar, ou mostrar
   na revisão como falha de consulta?
4. **Data da margem no WeSales:** usar `consultado_em` (quando consultou) ou
   `mes_referencia` (competência da folha)? A importação Excel usa a data do dia.
5. **Frequência do cron.**

**Ganchos com a Base de Conhecimento de Convênios** (não bloqueiam a Fase 2,
mas vale deixar a staging guardando esses campos):
- `vinculo` ("7 - Efetivo") conversa com o cadastro **Públicos Atendidos**.
- `lotacao` (secretaria) conversa com **Órgãos / Empregadores** — se uma IF
  tiver restrição de órgão naquele convênio, dá pra avisar na revisão.

## 6. Regras do Workspace que valem aqui

- **Uma worktree por sessão**: `git worktree add ../brs-workspace-motor-credito -b motor-credito/fase-2 main`
  (depois `npm install` real — Turbopack recusa `node_modules` em symlink — e
  `cp ../brs-workspace/.env.local .`). Pasta principal fica em `main`, só pra
  merge/push/`db push`. `git checkout` e `rm -rf` são bloqueados pelas permissões.
- **Migrations**: timestamp real (`date +%Y%m%d%H%M%S`), só da pasta principal,
  `npx supabase migration list` antes do `echo Y | npx supabase db push`.
  RLS ligada sem policy; tudo via server action + admin client.
- **Menu/permissão nova → REGRA FIXA nos 4 pontos**: `SYSTEM_MODULES` em
  `usuarios/page.tsx`, `src/lib/nav/divisoes.ts`, `src/lib/auth/permissions.ts`
  (exato + prefixo) e seed na migration a partir de `sistema-usuarios-root`.
- **Cofre só funciona em produção**: `CRM_CREDENTIALS_KEY` é "Sensitive" na
  Vercel, o `vercel env pull` grava `"[SENSITIVE]"` no `.env.local`. Tudo que
  decifra a senha do MySQL tem que ser testado em produção, não em localhost.
- **Dado pessoal**: a tabela tem CPF e nome reais — não colar amostras em
  commits, docs ou logs.
- Modelos: arquitetura/migration/segurança = Fable (ou Opus enquanto a cota do
  Fable estiver esgotada); telas sobre padrão definido = Sonnet.

## 7. Próximo passo sugerido

1. Bruno responde as perguntas abertas da §5 (a principal: convênio por lote).
2. Desenho da staging + revisão (migration, permissão nova, cron) → roteiro.
3. Sonnet executa as telas; revisão; publicar.
