# Contrato público de convênios — v1

Status: **implementado (PRJ-1/T-2)**, itens 1 a 7 da seção 12 decididos pelo Bruno; aguardando aceite do Codex e o teste de revogação.
Data: 2026-10-10. Branch: `projetos/modulo`.

## 1. Propósito e escopo

Rota **pública** (sem autenticação, só leitura) que entrega o conteúdo **aprovado** de um convênio. Consumidores:

- landings do site Astro da NuAzul (SSR em runtime);
- app público do site-builder (`apps/sites`).

Não confundir com a rota interna de conhecimento (`/api/conhecimento/...`, token de serviço, ainda não implementada). Elas não compartilham payload nem regras.

O `v1` na rota é a versão do **contrato** (formato do payload). Ela não tem relação com `versao`, a versão editorial do conteúdo do convênio.

## 2. Rota

```
GET /api/convenios/publico/v1/{slug}
```

- Slug: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` (mesma regra de `site_landing_page.slug` na migration `20260928014010_site_builder_fundacao.sql`).
- Coluna nova: `convenios.slug_publico text unique null`, com check da mesma regex.
- Valores iniciais: `governo-go`, `aguas-lindas-go`, `trindade-go`, `taboao-da-serra-sp`, `governo-pi`, `clt`.
- Registrar `'/api/convenios/publico'` em `publicRoutes` de `src/lib/supabase/middleware.ts`, no mesmo padrão de `'/api/promocoes/publico'`. O match é por prefixo (`pathname.startsWith(route + '/')`).
- Métodos além de `GET` (e do `HEAD` implícito) → `405` com `Allow: GET`.
- Handler em `src/app/api/convenios/publico/v1/[slug]/route.ts`. Lê com `createAdminClient()`, como `src/app/api/promocoes/publico/config/route.ts`. Diferença: **sem** `export const dynamic = 'force-dynamic'`, porque a resposta precisa ser cacheável (seção 7).

## 3. Fonte e snapshot

- Coluna nova: `convenio_conteudo_site.snapshot_publico jsonb null`.
- A rota serve **só** `snapshot_publico` da linha com `is_publicado = true` **e** `pendente_revisao_humana = false`. O índice único parcial `convenio_conteudo_site_publicado_unique_idx` já garante no máximo uma por convênio. Se `snapshot_publico` for null, a resposta é 404.
- O snapshot é gerado **na publicação**, pela action que chama `convenio_conteudo_site_publicar`. Ele junta:
  - conteúdo central (`convenio_conteudo_site`);
  - públicos (`convenio_publicos` → `publicos_atendidos`);
  - formas (`convenio_formas_contrato` → `formas_contrato`);
  - instituições × formas × públicos (`convenio_instituicoes` → `financial_institutions`, `convenio_instituicao_formas`, `convenio_instituicao_publicos`).
- Depois de publicado, a rota não lê nada de cadastro mutável. Para refletir uma mudança de cadastro é preciso publicar e revisar uma nova versão.
- Atomicidade: o snapshot tem que ser gravado na **mesma transação** da troca de publicação. Proposta: um parâmetro novo `p_snapshot jsonb` na RPC, gravado no `update` que liga `is_publicado`. Fora da transação existe uma janela com `is_publicado = true` e snapshot nulo ou antigo.
- Metadados congelados no snapshot:
  - `versao`: versão editorial;
  - `publicado_em`: `published_at`;
  - `aprovado_por`: **nome** do responsável. Na tabela, `published_by` é `uuid`; o nome é resolvido em `public.users` no momento da publicação e gravado no snapshot. O uuid nunca sai.

## 4. Esquema do payload

```ts
type ConvenioPublicoV1 = {
  contrato: 'v1'
  slug: string
  convenio: { nome: string; esfera: 'municipal'|'estadual'|'federal'|'inss'|'outro'; uf: string|null }
  versao: number                  // >= 1
  publicado_em: string            // ISO 8601
  aprovado_por: string            // nome
  titulo_destaque: string|null
  subtitulo: string|null
  resumo_publico: string|null
  hero: { headline: string|null; subheadline: string|null; imagem_url: string|null; imagem_alt: string|null }
  vantagens: ItemEvidenciado[]    // máx. 12
  faqs: (ItemEvidenciado & { pergunta: string; resposta: string })[]  // máx. 20
  publicos: { codigo: string; nome: string }[]
  formas_contratacao: { codigo: string; nome: string }[]
  instituicoes: { nome: string; produtos: string[]; publicos: string[]; formas: string[]; evidencia: Evidencia }[]
  cta: { texto: string; tipo_destino: 'whatsapp'|'simulador'|'formulario'|'url_customizada'|'link_externo'; link: string|null }
  seo: { meta_title: string|null; meta_description: string|null; keywords: string[] }
}
type Evidencia = { fonte: string|null; consultado_em: string|null; situacao: 'confirmado'|'pendente'; natureza: 'norma_oficial'|'regra_bancaria'|null }
type ItemEvidenciado = { titulo: string; texto: string } & Evidencia
```

Todas as chaves estão sempre presentes. "Opcional" quer dizer que o valor pode ser `null` ou `[]`, nunca que a chave some.

| Campo | Obrigatório | Origem (migration) | Limite |
|---|---|---|---|
| `convenio.nome` | sim | `convenios.nome` | 200 |
| `convenio.esfera` | sim | `convenios.esfera` (check já existente) | enum |
| `convenio.uf` | não | `convenios.uf` | 2, `^[A-Z]{2}$` |
| `titulo_destaque`, `subtitulo` | não | colunas homônimas (`not null default ''`, `''` vira null) | 200 / 300 |
| `resumo_publico` | não | idem | 2000 |
| `hero.headline` / `subheadline` | não | `hero_headline` / `hero_subheadline` | 200 / 300 |
| `hero.imagem_url` / `imagem_alt` | não | `imagem_destaque_url` / `imagem_destaque_alt` | 2048 / 200 |
| `vantagens[]` | não | `vantagens` jsonb | 12 itens; título 120, texto 600 |
| `faqs[]` | não | `faqs` jsonb | 20 itens; pergunta 300, resposta 2000 |
| `publicos[]` | não | `publicos_atendidos.nome` | 50 itens |
| `formas_contratacao[]` | não | `formas_contrato.nome` | 30 itens |
| `instituicoes[]` | não | `financial_institutions.name` + filhos | 30 itens |
| `cta.texto` / `tipo_destino` / `link` | sim / sim / não | `cta_texto_botao` / `cta_tipo_destino` / `cta_link_destino` | 60 / enum / 2048 |
| `seo.meta_title` / `meta_description` | não | colunas homônimas | 70 / 170 |
| `seo.keywords` | não | `keywords` (**text**; quebrado por vírgula, sem espaços nas pontas, vazios descartados) | 20 itens × 60 |

Em `titulo` e `texto` de `ItemEvidenciado`: dentro de `faqs`, `titulo = pergunta` e `texto = resposta`. Os campos existem só para manter o mesmo tipo.

`codigo` em `publicos` e `formas_contratacao`: nenhuma das duas tabelas tem esse campo. Ele é derivado do `nome` no momento da publicação (minúsculas, sem acento, `-` como separador, por exemplo `Temporário` → `temporario`). `formas_contrato.codigo_arw` é código interno e **não** é usado.

### Regras de projeção (aplicadas ao gerar o snapshot)

1. Item com `situacao = 'pendente'`, ou sem `situacao`, **não entra**. Campo ausente conta como pendente.
2. `publicos: []` quer dizer **nenhum público confirmado**, nunca "todos". Em `instituicoes[].publicos` vale o mesmo: `[]` não herda os públicos do convênio.
3. Texto puro. Nenhum HTML é aceito na entrada. Tags são removidas na geração e o consumidor **nunca** renderiza HTML (só texto escapado).
4. URLs (`cta.link`, `hero.imagem_url`, `fonte` quando for URL) precisam ser `https://`. Qualquer outro esquema, ou valor que não faz parse, vira `null`. Um item evidenciado cuja `fonte` foi anulada sai do snapshot. Se `cta.tipo_destino` exigir link e ele for anulado, o publicar falha.
5. Seção oculta em `secoes_visibilidade` (`hero`, `resumo`, `vantagens`, `faq`, `cta`, `seo`) vai vazia ou null no snapshot.
6. O snapshot inteiro tem no máximo 256 KB serializado. Se passar, o publicar falha. Nada é truncado em silêncio.

### JSON Schema (resumo)

```json
{
  "$id": "convenio-publico-v1", "type": "object", "additionalProperties": false,
  "required": ["contrato","slug","convenio","versao","publicado_em","aprovado_por","titulo_destaque","subtitulo",
               "resumo_publico","hero","vantagens","faqs","publicos","formas_contratacao","instituicoes","cta","seo"],
  "properties": {
    "contrato": { "const": "v1" },
    "slug": { "type": "string", "pattern": "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$" },
    "versao": { "type": "integer", "minimum": 1 },
    "publicado_em": { "type": "string", "format": "date-time" },
    "vantagens": { "type": "array", "maxItems": 12, "items": { "$ref": "#/$defs/item" } },
    "faqs": { "type": "array", "maxItems": 20, "items": { "$ref": "#/$defs/item" } },
    "cta": { "type": "object", "required": ["texto","tipo_destino","link"],
             "properties": { "link": { "type": ["string","null"], "pattern": "^https://" } } }
  },
  "$defs": {
    "evidencia": { "required": ["fonte","consultado_em","situacao","natureza"],
      "properties": { "situacao": { "const": "confirmado" },
                      "natureza": { "enum": ["norma_oficial","regra_bancaria",null] } } },
    "item": { "allOf": [{ "$ref": "#/$defs/evidencia" }], "required": ["titulo","texto"] }
  }
}
```

No payload servido, `situacao` é sempre `confirmado`, porque o pendente foi filtrado antes. O tipo mantém `'pendente'` só por ser o mesmo tipo usado na entrada.

## 5. O que NUNCA entra

Regra geral: o snapshot é montado por **lista de permissão** (campos da seção 4). Nada é copiado com spread. Ficam de fora, explicitamente:

- **Bancos pagadores:** `convenio_bancos_pagadores` (todas as colunas).
- **Calendário de folha/pagamento:** `convenios.pagamento_modo`, `pagamento_dia`, `pagamento_dia_util`, `pagamento_texto`, `fechamento_folha_modo`, `fechamento_folha_dia`, `fechamento_folha_dia_util`, `fechamento_folha_texto`.
- **Documentos internos e roteiros:** `convenio_documentos` (inclui `tipo = 'roteiro'`, `texto_extraido`, `resumo_ia`, `arquivo_path`), `faq_itens` e `convenio_faq_vinculos` (FAQ interno; o FAQ público vem só de `convenio_conteudo_site.faqs`).
- **Pesquisa/IA:** `convenio_pesquisas`, `convenio_pesquisa_fontes`, `convenio_bc_sugestoes`.
- **Dados fiscais e endereço do órgão:** `convenios.cnpj`, `razao_social`, `nome_reduzido`, `cidade`, `cep`, `logradouro`, `numero`, `complemento`, `bairro`; `orgaos_empregadores` (incl. `cnpj`) e `convenio_instituicao_orgaos`.
- **Códigos e integrações internas:** `convenios.codigo`, `codigo_sistema`, `codigo_motor_credito`, `wesales_business_id`, `averbadora_id`, `site_averbador`, `tipo_convenio_id`; `formas_contrato.codigo_arw`, `origem_margem`.
- **Regras operacionais e margens:** `convenios.numero_servidores`, `max_comprometimento_salarial`, `prazo_minimo_geral`, `prazo_maximo_geral`, `abrangencia`; `convenio_formas_contrato.percentual_margem`; `convenio_instituicao_formas.margem_considerada`, `prazo_minimo`, `prazo_maximo`, `publicos_restritos`; `convenio_instituicoes.canais_quitacao`, `modo_orgaos`.
- **Observações internas:** `convenios.bc_observacoes`; `observacao` de `convenio_publicos`, `convenio_formas_contrato`, `convenio_instituicoes`, `convenio_instituicao_formas`; `publicos_atendidos.descricao`, `situacao_funcional`, `regime_juridico`, `tipo_provimento`.
- **Ids e operadores:** todos os `id`/`*_id` (uuid), `created_by`, `updated_by`, `published_by` (uuid), `iniciado_por`, `confirmada_por`, `created_at`, `updated_at`.
- **Campos de montagem do conteúdo central:** `is_draft`, `is_publicado`, `pendente_revisao_humana`, `secoes_ordem`, `secoes_visibilidade`, `variaveis_permitidas`.
- **Site do parceiro:** tudo de `site_parceiro` e `site_landing_page` (overrides de WhatsApp e foto são do parceiro, não do convênio).
- Credenciais, tokens, dados pessoais de qualquer pessoa, `financial_institutions.logo_url`.

## 6. Respostas

| Status | Corpo | Quando |
|---|---|---|
| 200 | `ConvenioPublicoV1` | existe versão publicada, revisada e com snapshot |
| 400 | `{ "erro": "slug_invalido" }` | slug fora da regex |
| 404 | `{ "erro": "sem_publicacao" }` | slug desconhecido **ou** convênio sem versão publicada + revisada (mesma resposta, de propósito) |
| 405 | `{ "erro": "metodo_nao_permitido" }` | método diferente de GET |
| 503 | `{ "erro": "indisponivel" }` | falha de banco ou serviço |

Todas as respostas usam `Content-Type: application/json; charset=utf-8`. O corpo de erro nunca traz detalhe interno; o detalhe vai só para o log do servidor.

O que o consumidor deve fazer:

- **200:** renderizar só o que veio. Lista vazia = seção omitida. Não completar com texto padrão.
- **404:** página genérica do convênio, sem regra, oferta, taxa, prazo ou elegibilidade.
- **503:** mensagem "tente novamente". **Nunca** preencher com conteúdo de exemplo nem com versão antiga guardada pelo próprio consumidor.
- **400:** tratar como 404 (bug do consumidor, deve gerar log).

## 7. Cache e revogação

Cabeçalhos do 200:

```
Cache-Control: public, s-maxage=300, stale-while-revalidate=60
Vary: Accept-Encoding
ETag: "<convenio_conteudo_site.id>-<versao>"   (opcional; o id interno não aparece no corpo)
```

Para 404, usar o mesmo `Cache-Control`. Assim a revogação também tem prazo limitado e um slug inexistente não sobrecarrega o banco. Para 400/405/503: `Cache-Control: no-store`.

- `revalidatePath('/api/convenios/publico/v1/{slug}')` na action que publica e na que desativa (`convenio_conteudo_site_desativar`), depois do commit.
- Consumidores (Astro SSR e `apps/sites`) não têm cache próprio. Se tiverem, o TTL máximo é 60 s.
- **Prazo de revogação:** 5 min, verificável, em todas as camadas: rota → CDN Vercel → rewrite do site Astro → página renderizada.
- **Nota de consistência:** sem `revalidatePath` funcionando, o pior caso é `s-maxage` 300 + SWR 60 + cache do consumidor 60 = 420 s, acima de 5 min. Então ou o `revalidatePath` precisa comprovadamente purgar o CDN (é o teste abaixo que mede), ou os valores caem para `s-maxage=180, stale-while-revalidate=60` com consumidor ≤ 60 s. Decisão na seção 12.

### Teste obrigatório de revogação (manual, em preview e depois em produção)

Para cada passo, medir três pontos: (a) rota direta, (b) a mesma URL via rewrite do site Astro, (c) a página renderizada. Registrar a hora do passo e a hora em que cada ponto refletiu a mudança.

1. Publicar a versão A de `governo-go`. Marcar T0.
2. Medir (a), (b) e (c) a cada 15 s até todos mostrarem `versao = A`. Anotar o tempo de cada um.
3. Publicar a versão B. Marcar T1. Medir até todos mostrarem `versao = B`. Anotar.
4. Desativar (`convenio_conteudo_site_desativar`). Marcar T2. Medir até (a) e (b) darem 404 e (c) mostrar a página genérica. Anotar.
5. Aprovado se cada tempo for ≤ 300 s. Registrar a tabela de tempos no projeto (PRJ) junto com a data e o deploy usado.

## 8. Exemplos

### 200 — `governo-go` (**EXEMPLO, dados fictícios, não usar como conteúdo real**)

```json
{
  "contrato": "v1",
  "slug": "governo-go",
  "convenio": { "nome": "Governo do Estado de Goiás", "esfera": "estadual", "uf": "GO" },
  "versao": 3,
  "publicado_em": "2026-10-10T14:00:00.000Z",
  "aprovado_por": "EXEMPLO Fulano de Tal",
  "titulo_destaque": "EXEMPLO Crédito consignado para servidores de Goiás",
  "subtitulo": "EXEMPLO Atendimento para efetivos, aposentados, pensionistas e forças de segurança",
  "resumo_publico": "EXEMPLO Texto curto, sem taxas nem promessas de aprovação.",
  "hero": { "headline": "EXEMPLO Seu consignado do Governo de Goiás", "subheadline": null,
            "imagem_url": "https://exemplo.invalid/hero-go.webp", "imagem_alt": "EXEMPLO Servidor público" },
  "vantagens": [
    { "titulo": "EXEMPLO Desconto em folha", "texto": "EXEMPLO Parcelas descontadas direto no contracheque.",
      "fonte": "https://exemplo.invalid/decreto-go", "consultado_em": "2026-10-01", "situacao": "confirmado", "natureza": "norma_oficial" }
  ],
  "faqs": [
    { "pergunta": "EXEMPLO Comissionado pode contratar?", "resposta": "EXEMPLO Somente cartão benefício e cartão consignado.",
      "titulo": "EXEMPLO Comissionado pode contratar?", "texto": "EXEMPLO Somente cartão benefício e cartão consignado.",
      "fonte": "EXEMPLO regra do banco StarBank", "consultado_em": "2026-10-01", "situacao": "confirmado", "natureza": "regra_bancaria" }
  ],
  "publicos": [
    { "codigo": "efetivo", "nome": "Efetivo" }, { "codigo": "aposentado", "nome": "Aposentado" },
    { "codigo": "pensionista", "nome": "Pensionista" }, { "codigo": "comissionado", "nome": "Comissionado" },
    { "codigo": "temporario", "nome": "Temporário" }, { "codigo": "forcas-de-seguranca", "nome": "Forças de segurança" }
  ],
  "formas_contratacao": [
    { "codigo": "emprestimo-consignado", "nome": "Empréstimo consignado" },
    { "codigo": "cartao-consignado", "nome": "Cartão consignado" },
    { "codigo": "cartao-beneficio", "nome": "Cartão benefício" }
  ],
  "instituicoes": [
    { "nome": "Santander", "produtos": ["Empréstimo consignado"], "publicos": ["Efetivo", "Aposentado", "Pensionista"],
      "formas": ["Empréstimo consignado"],
      "evidencia": { "fonte": "EXEMPLO regra do banco", "consultado_em": "2026-10-01", "situacao": "confirmado", "natureza": "regra_bancaria" } },
    { "nome": "StarBank", "produtos": ["Cartão benefício", "Cartão consignado"], "publicos": ["Comissionado", "Temporário"],
      "formas": ["Cartão benefício", "Cartão consignado"],
      "evidencia": { "fonte": "EXEMPLO regra do banco", "consultado_em": "2026-10-01", "situacao": "confirmado", "natureza": "regra_bancaria" } }
  ],
  "cta": { "texto": "Simular Agora", "tipo_destino": "whatsapp", "link": null },
  "seo": { "meta_title": "EXEMPLO Consignado Governo de Goiás", "meta_description": "EXEMPLO Descrição curta.",
           "keywords": ["consignado goias", "servidor estadual go"] }
}
```

### Erros

```json
{ "erro": "slug_invalido" }
```
```json
{ "erro": "sem_publicacao" }
```
```json
{ "erro": "indisponivel" }
```

## 9. Segurança

- Rota pública e **somente leitura**. Lê com o admin client, porque `convenio_conteudo_site` tem `REVOKE ALL` para `anon`/`authenticated`. A consulta seleciona **apenas** `snapshot_publico` e filtra por `slug_publico`, `is_publicado = true` e `pendente_revisao_humana = false`.
- Nenhum query param além do slug no path. Query strings são ignoradas e não entram na chave de cache.
- Tamanho máximo do snapshot: 256 KB (validado no publicar, seção 4).
- Não revela a existência de convênio não publicado: 404 com corpo e cabeçalhos idênticos, e tempo de resposta sem caminho diferente (uma única query).
- Rate limit: fora do escopo da v1. Fica anotado o padrão existente `aplicarLimites` de `src/lib/promocoes/http.ts`, para ativar se houver abuso. O cache de CDN já absorve a maior parte da carga.
- Sem CORS na v1. Os consumidores chamam servidor a servidor (SSR) ou pelo rewrite do mesmo domínio.

## 10. Critérios de aceite e testes

Testes unitários em `src/lib/__tests__/convenios-publico.test.ts`, contra uma função pura de projeção (`montarSnapshotPublico`) e o handler com cliente mockado:

1. A projeção exclui campos internos: um registro de entrada cheio de campos da seção 5 gera saída com exatamente as chaves da seção 4, sem nenhum uuid.
2. Item pendente ou sem `situacao` não sai, em vantagens, faqs e instituições.
3. Público vazio não vira "todos", nem no convênio nem na instituição.
4. URL não-https (`http:`, `javascript:`, `data:`, relativa) vira null, e o item cuja `fonte` foi anulada sai.
5. 404 com corpo e cabeçalhos iguais para slug inexistente e para convênio não publicado ou pendente de revisão.
6. Snapshot imutável: alterar o cadastro depois de publicar não muda a resposta da rota.
7. Cabeçalhos de cache: 200 e 404 com `public, s-maxage=…, stale-while-revalidate=60`; 400/405/503 com `no-store`.
8. Slug fora da regex → 400; POST/PUT/DELETE → 405.
9. Snapshot acima de 256 KB → o publicar falha.

Aceite: os testes passam, `tsc` limpo, o teste de revogação (seção 7) foi registrado com todos os tempos ≤ 300 s e o Codex revisou.

## 11. Versionamento do contrato

- v1 fica congelado depois do aceite do Codex.
- Mudança incompatível (remover ou renomear campo, mudar tipo ou semântica, tornar obrigatório) → **v2** em rota nova (`/api/convenios/publico/v2/{slug}`). A v1 continua no ar até os consumidores migrarem.
- Mudança aditiva (campo opcional novo, nullable ou lista que pode vir vazia) é permitida na v1, com registro no changelog abaixo. Consumidores devem ignorar chaves desconhecidas.

## 12. Pendências de decisão (Bruno)

Itens 1 a 7 decididos pelo Bruno em 2026-10-10 e implementados na branch `convenios/publico-v1` (PRJ-1/T-2). O item 8 continua aberto.

1. **OK.** `convenios.slug_publico text null`, com check da regex e índice único parcial (`where slug_publico is not null and deleted_at is null`). Editável na aba Site do convênio (`can_edit`). Enquanto houver versão publicada com snapshot, a troca é recusada: o snapshot congela o slug, então é preciso retirar do ar, trocar e publicar de novo.
2. **OK.** `convenio_conteudo_site.snapshot_publico jsonb null`, gravado por `convenio_conteudo_site_publicar(..., p_snapshot jsonb default null)` no mesmo `update` que liga `is_publicado`. `versao` e `publicado_em` do snapshot são sobrescritos pela RPC com os valores do banco (`versao` da linha e `now()` da transação).
3. **OK.** Rota pública sem autenticação, registrada em `publicRoutes`.
4. **Revisão humana:** qualquer usuário com `workspace-convenios` `can_edit` marca o rascunho salvo como revisado (botão "Marcar como revisado" na aba Site). Grava `pendente_revisao_humana = false`, `revisado_por` (uuid → `users`) e `revisado_em`. Qualquer gravação do rascunho volta `pendente_revisao_humana = true` e limpa `revisado_*`. A RPC de publicar recusa com `conteudo_nao_revisado` se o rascunho não estiver revisado. A tela mostra quem revisou e quem publicou (nome de `users.name`), com data e versão. Publicar continua exigindo `can_activate_inactivate` e publica o rascunho já salvo e revisado (não regrava o rascunho).
5. **Evidência:** públicos, formas e instituições do cadastro contam como confirmados pelo ato de publicar, sem campos de evidência no cadastro. Em `instituicoes[].evidencia` vai sempre `{ fonte: null, consultado_em: null, situacao: 'confirmado', natureza: null }`. Só os itens de `vantagens` e `faqs` (jsonb de `convenio_conteudo_site`) carregam `fonte`, `consultado_em` (`AAAA-MM-DD`), `situacao` (`confirmado`|`pendente`) e `natureza` (`norma_oficial`|`regra_bancaria`), editáveis na UI. No jsonb, a vantagem guarda o texto em `descricao`, que vira `texto` no snapshot. Item com `situacao` ausente ou `pendente` fica fora.
6. **`instituicoes[].produtos`:** derivado de `formas_contrato.origem_margem` das formas da instituição (`novo` → Empréstimo consignado, `cartao_rmc` → Cartão consignado, `cartao_rcc` → Cartão benefício; `nenhuma` não gera produto).
7. **Variáveis:** a publicação é recusada se qualquer texto do snapshot tiver `{{variavel}}`. O rascunho continua aceitando as variáveis da whitelist (uso futuro do site-builder por parceiro), mas não publica com elas.
8. **Aberto.** Valores de cache para garantir 5 min (seção 7, nota de consistência). Implementado com `s-maxage=300, stale-while-revalidate=60` e `revalidatePath` na publicação, na desativação e na troca de slug. Decidir depois do teste de revogação.

Notas de implementação:

- Seção `cta` oculta em `secoes_visibilidade` → `cta: null` (regra 5). Fora isso, `cta` é sempre objeto.
- Limites de tamanho da seção 4 são validados na publicação: acima do limite, o publicar falha com a mensagem do campo (nada é truncado).
- Instituição entra só com `convenio_instituicoes.is_active = true` e instituição ativa e não excluída. Públicos e formas inativos ou excluídos ficam fora.

## Changelog

- 2026-10-10: proposta inicial da v1.
- 2026-10-10: decisões do Bruno sobre os itens 1 a 7 da seção 12 registradas; implementação na branch `convenios/publico-v1` (PRJ-1/T-2). Item 8 (cache) segue aberto.
