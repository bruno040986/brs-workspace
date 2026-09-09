# Roteiro — Cadastro de Averbadoras + Tipos de Autenticação + vínculo no Convênio (para o Sonnet)

> Migration `20260909162211_averbadoras.sql` (Fable) — APLICADA. Tabelas
> `averbadoras`, `averbadora_tipos_autenticacao`; `convenios` ganhou
> `averbadora_id`, `site_averbador`, `tipo_autenticacao_id`. Permissão nova
> `workspace-averbadoras` já semeada pra root.
> **Copiar o padrão de `src/app/(dashboard)/convenios/`** (page.tsx +
> cadastros-actions.ts + esferas/page.tsx) — é o mesmo tipo de cadastro.

## Regras de negócio (decididas com o Bruno, 09/09/2026)
- Averbadora 1 → N convênios; um convênio tem no máximo UMA averbadora.
- `site_averbador` é por convênio e pode REPETIR entre convênios (às vezes é
  subdomínio próprio, ex. `formosa.neoconsig.com.br`; às vezes a mesma URL
  serve vários convênios). Nunca validar unicidade.
- Tipo de Autenticação é escolhido no vínculo do CONVÊNIO (não na averbadora).
- Vínculo é opcional no convênio (as 3 colunas são nullable) — convênio
  existente continua válido sem averbadora.

## Regras de ouro
- REGRA FIXA de permissões (GRUPO.md): esta entrega toca menu → atualizar os
  3 pontos de código (o seed já está na migration): `SYSTEM_MODULES` em
  `usuarios/page.tsx`, `src/lib/nav/divisoes.ts`, `src/lib/auth/permissions.ts`
  (mapa exato + lista de prefixo). Chave: `workspace-averbadoras`.
- Actions em `'use server'` com o mesmo `admin` (service role) e
  `requirePermission(RESOURCE, ação)` de `convenios/cadastros-actions.ts`:
  `can_include` p/ criar, `can_edit` p/ editar, `can_activate_inactivate` p/
  ativar/inativar. Sem delete físico (soft delete em averbadoras = inativar).
- `npm run build` verde + `npx tsc --noEmit` limpo; commit só dos arquivos da
  entrega, na SUA worktree (`git worktree add ../brs-workspace-averbadoras -b
  averbadoras/cadastro main`), merge na main pela pasta principal no fim.
- Decidir sozinho e relatar; só consultar o Bruno se for irreversível.

## Frentes

### (a) Permissão / menu (REGRA FIXA, 3 pontos de código)
- `usuarios/page.tsx` → `SYSTEM_MODULES`, divisão Cadastros, ao lado de
  `workspace-convenios`: `{ id: 'workspace-averbadoras', name: 'Averbadoras',
  parentId: 'cat-div-cadastros', level: 1 }`.
- `divisoes.ts` → substituir o placeholder
  `{ label: 'Averbadoras', href: '#averbadoras', soon: true, perms: [view('sistema-config-instituicoes')] }`
  por item real com children, igual a Convênios:
  ```ts
  {
    label: 'Averbadoras',
    href: '/averbadoras',
    perms: [view('workspace-averbadoras')],
    children: [
      { label: 'Tipos de Autenticação', href: '/averbadoras/tipos-autenticacao', perms: [view('workspace-averbadoras')] },
    ],
  },
  ```
- `permissions.ts` → `'/averbadoras': any([view('workspace-averbadoras')])`
  no mapa exato E `['/averbadoras', any([view('workspace-averbadoras')])]` na
  lista de prefixo (o prefixo cobre o submenu).

### (b) Actions — `src/app/(dashboard)/averbadoras/actions.ts`
Tipos:
```ts
export type Averbadora = { id: string; cnpj: string; razao_social: string; nome: string; site_institucional: string | null; is_active: boolean }
export type TipoAutenticacao = { id: string; tipo: string; vigencia_horas: number; is_active: boolean }
```
- `getAverbadoras()` (ativas primeiro, depois nome; `deleted_at is null`),
  `salvarAverbadora({ id?, cnpj, razao_social, nome, site_institucional })`,
  `setAverbadoraStatus(id, isActive)`.
- `getTiposAutenticacao()`, `salvarTipoAutenticacao({ id?, tipo, vigencia_horas })`,
  `setTipoAutenticacaoStatus(id, isActive)`.
- Validações no servidor: cnpj = 14 dígitos (`onlyDigits`), nome obrigatório,
  `vigencia_horas` inteiro > 0, site normalizado por `normalizarUrl()` (ver (c)).
  Erro `23505` → "Já existe averbadora com esse CNPJ/nome" / "Já existe esse tipo".
- `revalidatePath('/averbadoras')` / `('/averbadoras/tipos-autenticacao')`.

### (c) Helper de URL — `src/lib/url-site.ts` (novo, puro, sem 'use server')
```ts
/** Aceita "formosa.neoconsig.com.br", "http://x", "https://x/y"; devolve https://… ou lança. */
export function normalizarUrl(bruta: string): string
```
- trim; se não tiver esquema, prefixar `https://`; `new URL()` pra validar;
  rejeitar se hostname não tiver ponto; devolver `href` sem barra final
  supérflua. Usado por Site Institucional (averbadora) e Site Averbador
  (convênio). No input, `onBlur` já mostra o valor normalizado.

### (d) Tela `/averbadoras` — `page.tsx` (+ `layout.tsx` igual ao de convenios)
- Lista (tabela): Nome Averbadora, CNPJ (mascarado, `maskCnpj`), Razão
  Social, Site (link `target=_blank`), Status; ações Editar / Ativar-Inativar.
- Modal Novo/Editar — campos na ordem do Bruno:
  1. **CNPJ** com máscara + botão "Buscar" → mesmo `fillByCnpj` de
     `convenios/page.tsx` (`GET /api/cnpjws/cnpj/:cnpj` +
     `normalizeCnpjWsCompleto`), preenche Razão Social.
  2. **Razão Social** (preenchida pela busca; editável).
  3. **Nome Averbadora** (manual, obrigatório).
  4. **Site Institucional** (manual; `normalizarUrl` no blur; opcional).
- Mesmos componentes/classes de `convenios/page.tsx` (`.card`, `.data-table`,
  modal fixo, `form-control`, badges).

### (e) Tela `/averbadoras/tipos-autenticacao` — copiar `convenios/esferas/page.tsx`
- Colunas: Tipo, Vigência (h), Status. Modal: Tipo (texto) + Tempo de
  Vigência (número inteiro, horas, `min=1`).

### (f) Convênio — nova seção "Averbadora" no modal de `convenios/page.tsx`
- Carregar `getAverbadoras()` e `getTiposAutenticacao()` (só ativos, mas manter
  o selecionado mesmo se inativo, pra não perder vínculo antigo).
- Campos: **Averbadora** (select mostrando `nome`; opção vazia "Sem
  averbadora"); **Site Averbador** (texto; ao escolher a averbadora e o campo
  estar vazio, sugerir `site_institucional` dela — editável; `normalizarUrl`
  no blur); **Tipo de Autenticação** (select por `tipo`; opção vazia).
- `actions.ts` de convênios: incluir `averbadora_id`, `site_averbador`,
  `tipo_autenticacao_id` no select/save (null quando vazio). Se
  `site_averbador` ou `tipo_autenticacao_id` vier sem `averbadora_id`, limpar
  os dois (vínculo só faz sentido com averbadora).
- Na listagem de convênios, coluna "Averbadora" (nome) — opcional, se couber.

## Aceite
- Cadastrar averbadora pelo CNPJ (busca preenche razão social), inativar,
  reativar; CNPJ duplicado dá mensagem clara.
- Cadastrar tipo de autenticação com vigência em horas; 0/negativo rejeitado.
- Em Convênios: escolher averbadora sugere o site institucional; dois
  convênios podem ter o MESMO site averbador; salvar e reabrir mantém os 3
  campos; convênio sem averbadora continua salvando normalmente.
- Menu Cadastros › Averbadoras aparece só pra quem tem `workspace-averbadoras`;
  root já tem (seed).
