# ROTEIRO — Reorganização dos menus: Gestão de Leads · CRM AlvoConsig · CRM Vende.Ai CLT

> Aprovado pelo Bruno em 24/09/2026. Spec do Fable; execução do **Sonnet**
> nesta worktree (`brs-workspace-menus`, branch `menus/gestao-leads-crm`).
> Migration da chave nova já está na branch (`*_perm_consulta_fydigital.sql`).
> Fable revisa, mergeia, `db push`.

## 0. Princípios

- **Ids de permissão NUNCA mudam** — só rótulo e posição. Chave nova: só
  `alvoconsig-consulta-fydigital` (migration pronta).
- **Uma fonte só**: barra lateral e telas de cards leem o MESMO registro
  (`src/lib/nav/divisoes.ts`). Nada de lista de cards escrita à mão.
- REGRA FIXA nos 4 pontos (GRUPO.md): `SYSTEM_MODULES`, `divisoes.ts`,
  `permissions.ts`, seed (feito).
- Nenhuma rota existente muda (`/alvoconsig/*`, `/gestao-leads/*`,
  `/central-integracoes/*` continuam). Só entram 3 páginas novas.

## 1. Registro (`src/lib/nav/divisoes.ts`), divisão Comercial

```
Biblioteca de Artes                      (inalterado)

Gestão de Leads            /gestao-leads
  perms: any(view alvoconsig-gestao, view alvoconsig-higienizacao-amigoz,
             view alvoconsig-motor-credito, view alvoconsig-consulta-fydigital)
  ├ Visão Geral            /alvoconsig                       view alvoconsig-gestao   exact: true
  ├ Cadastro de Leads      /alvoconsig/cadastro-leads        view alvoconsig-gestao
  ├ Importações            /alvoconsig/importacoes           view alvoconsig-gestao
  ├ Consulta Amigoz        /gestao-leads/higienizacao-amigoz view alvoconsig-higienizacao-amigoz
  ├ Consulta Kaizom        /alvoconsig/motor-credito         view alvoconsig-motor-credito
  └ Consulta Fy.Digital    /gestao-leads/consulta-fydigital  view alvoconsig-consulta-fydigital   soon: true

CRM AlvoConsig             /crm-alvoconsig
  perms: any(view alvoconsig-gestao, view alvoconsig-certificacao)
  ├ Alocação de Leads      /alvoconsig/alocacao              view alvoconsig-gestao
  ├ Leads Alocados         /alvoconsig/contatos              view alvoconsig-gestao
  ├ Carteira de Parceiros  /alvoconsig/certificacao          view alvoconsig-certificacao
  └ Perfis de Usuário      /alvoconsig/perfis                view alvoconsig-gestao

CRM Vende.Ai CLT           /crm-vende-ai-clt
  perms: view central-integracoes
  ├ Ações Manuais          /central-integracoes/acoes        view central-integracoes
  └ Importação de Bases (CLT) /central-integracoes/bases     view central-integracoes
```

Tipos: `NavSubItem` ganha `desc?: string`, `icon?: LucideIcon`, `exact?: boolean`,
`soon?: boolean`. Preencher `desc`/`icon` em TODOS os filhos acima (os
textos atuais de `gestao-leads/page.tsx` servem; ícones idem).

**`exact`** (obrigatório em "Visão Geral"): `/alvoconsig` é prefixo de
`/alvoconsig/alocacao` — sem `exact`, estar em Alocação marcaria "Visão
Geral" ativo e abriria os DOIS grupos (o "aparece duas vezes" que o Bruno
viu). Em `WorkspaceSidebar.tsx`, as duas checagens de rota de filho
(`filhoAtivo` e a classe `is-active`) passam a respeitar `c.exact`
(`pathname === c.href` quando exact; prefixo caso contrário).
`divisaoDaRota` não precisa mudar (mesma divisão dos dois lados).

Item com `soon: true`: barra mostra o rótulo com badge "Em breve" (já
existe `soon` em `NavItemDef`; replicar o visual no filho).

## 2. Componente de cards (novo, 1 arquivo)

`src/components/nav/CardsDoItem.tsx` (server component): recebe o `href` do
item pai, acha o `NavItemDef` no registro, filtra `children` por
`itemVisivel(perms, child, item.perms)` e renderiza a grade de cards
(mesmo visual de `gestao-leads/page.tsx`: ícone em quadrado navy, título,
descrição). Filho `soon` aparece com badge "Em breve" e sem link ou com
link pra própria página "Em breve" — usar o link.

Páginas que usam o componente (todas `force-dynamic`, `requireAnyPermission`
com as mesmas perms do item pai, `redirect('/')` se negar):
- `src/app/(dashboard)/gestao-leads/page.tsx` — REESCREVER: título
  "Gestão de Leads", subtítulo curto, `<CardsDoItem href="/gestao-leads" />`.
  Apagar a lista manual.
- `src/app/(dashboard)/crm-alvoconsig/page.tsx` — novo: "CRM AlvoConsig".
- `src/app/(dashboard)/crm-vende-ai-clt/page.tsx` — novo: "CRM Vende.Ai CLT".

## 3. Página "Em breve" da Fy.Digital

`src/app/(dashboard)/gestao-leads/consulta-fydigital/page.tsx`: mesmo
visual do card central de `rh/parceiros/config/provedores/breve/page.tsx`
(sem o `?api=`), texto: "Consulta Fy.Digital — em breve. A integração com a
API da FyDigital está em homologação (aguardando definição do webhook)."
Server component com `requirePermission('alvoconsig-consulta-fydigital')`.

## 4. REGRA FIXA — os 4 pontos

1. `SYSTEM_MODULES` (`usuarios/page.tsx`), só nome/posição, ids iguais:
   - `alvoconsig-gestao` → "Gestão de Leads e CRM AlvoConsig"
   - `alvoconsig-certificacao` → "Carteira de Parceiros"
   - `alvoconsig-higienizacao-amigoz` → "Consulta Amigoz"
   - `alvoconsig-motor-credito` → "Consulta Kaizom"
   - NOVO `{ id: 'alvoconsig-consulta-fydigital', name: 'Consulta Fy.Digital', parentId: 'alvoconsig-gestao', level: 2 }`
   - `central-integracoes` fica onde está (Tecnologia › Integrações continua usando).
2. `divisoes.ts` — §1.
3. `permissions.ts` — exatas E prefixo:
   - `/gestao-leads` → any(view dos 4 filhos de Gestão de Leads) (troca o
     `central-integracoes` atual pelas 3 chaves de consulta)
   - `/gestao-leads/consulta-fydigital` → view alvoconsig-consulta-fydigital
   - `/crm-alvoconsig` → any(view alvoconsig-gestao, view alvoconsig-certificacao)
   - `/crm-vende-ai-clt` → view central-integracoes
   - Rotas `/alvoconsig*`, `/central-integracoes*` não mudam.
4. Seed — migration já na branch.

## 5. Checklist de entrega (Sonnet) — EXECUTADO 24/09/2026

- [x] `tsc --noEmit` limpo; `npm test` verde (116/116); `next build` OK
      (3 rotas novas confirmadas no app-paths-manifest.json)
- [x] Nenhuma lista de cards manual restante — `gestao-leads/page.tsx`
      reescrita sobre `CardsDoItem`; grep de `gridTemplateColumns:
      'repeat(auto-fill, minmax(270px` não bate em nenhuma página
- [x] `exact: true` em "Visão Geral" (`/alvoconsig`) — sem ele, estar em
      `/alvoconsig/alocacao` (item "CRM AlvoConsig") também marcava
      "Visão Geral" (item "Gestão de Leads") como ativo, abrindo os dois
      grupos ao mesmo tempo (o bug relatado pelo Bruno). `rotaAtivaFilho()`
      em `WorkspaceSidebar.tsx` centraliza a checagem (usada nas duas
      classes `is-active` e no `filhoAtivo`)
- [x] Lint: nenhum problema NOVO — os 31 do arquivo `usuarios/page.tsx` +
      `WorkspaceSidebar.tsx` (setState em effect, `any`) já existem
      idênticos na main, em linhas que esta entrega não tocou
- [ ] GRUPO.md: nomes antigos citados lá — Fable atualiza no merge
