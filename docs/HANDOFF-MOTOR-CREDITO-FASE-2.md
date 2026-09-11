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

## 5. Perguntas em aberto (resolver antes de codar a staging)

1. **Chaves completas de `dados_extras`** — o print cortou. Primeiro passo:
   Bruno clica em *Explorar* no card e copia o JSON inteiro de uma linha.
2. **O que é `tarefa_id`?** Lote/job do fornecedor? Dá pra saber o convênio por ele?
3. **De qual convênio é cada linha?** A tabela não tem coluna de convênio — sem
   isso não dá pra gravar Convênio (Código/Nome) nem o Consignante no WeSales.
   Talvez esteja em `dados_extras`, ou venha do `tarefa_id`.
4. **`valor_margem` × `valor_disponivel`** → qual vai para Margem Novo? Existe
   margem de cartão (RMC/RCC) em algum lugar, ou só empréstimo?
5. **Linhas com `sucesso = 0`**: descartar, ou mostrar na revisão como falha?
6. **Frequência do cron** e o que fazer com linha que o fornecedor atualizar
   depois (`updated_at` muda mas o `id` não — o cursor por `id` não pega).

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

1. Bruno cola o JSON completo de uma linha (item 5.1) e responde 5.2–5.6.
2. Desenho da staging + revisão (migration, permissão nova, cron) → roteiro.
3. Sonnet executa as telas; revisão; publicar.
