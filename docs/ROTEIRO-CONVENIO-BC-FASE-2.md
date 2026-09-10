# ROTEIRO — Convênio Base de Conhecimento, Fase 2 (Documentos & FAQ) — execução Sonnet

> Spec-mãe: `docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md` (§2.9–2.11, §7.1 itens 5–7, §7.2).
> Schema: migration `20260910081636_convenio_bc_fase2.sql` (APLICADA). Bucket privado
> `convenio-documentos` criado. Nenhuma permissão nova. Fase 1 já em produção
> (`/convenios/[id]` com sub-abas Público · Formas & Margens · Instituições · Órgãos).
> Worktree: `../brs-workspace-convenio-bc` (branch `convenio-bc/fase-2`).
> Padrões: iguais à Fase 1 (`bc-actions.ts`, `_components/bc/*`). Upload: admin client
> `storage.from('convenio-documentos').upload(path, bytes, { contentType, upsert: false })`;
> leitura por `createSignedUrl(path, 3600)` — NUNCA URL pública.
> **Fora desta fase:** botão "Ler com o Jarvis" (Fase 4). Mostrar `resumo_ia` se existir e um
> botão desabilitado "Ler com o Jarvis — em breve".

## Entregáveis (nesta ordem)

### (a) Documentos — `convenios/documentos-actions.ts` + componente `DocumentosLista`

1. Actions (RESOURCE `workspace-convenios`; `can_edit` para escrever):
   - `getDocumentos(convenioId, tipo?: 'decreto'|'roteiro'|'outro', convenioInstituicaoId?)` →
     lista ordenada por `ordem, created_at` com `{ id, tipo, titulo, texto, url, arquivo_nome,
     arquivo_mime, arquivo_tamanho, temArquivo, resumo_ia, ia_status, is_active, ordem }`
     (NÃO devolver `texto_extraido`).
   - `salvarDocumento(formData: FormData)` — campos: `id?`, `convenio_id`, `tipo`,
     `convenio_instituicao_id?` (obrigatório se tipo=roteiro), `titulo`, `texto?`, `url?`
     (normalizar com `normalizarUrl`; erro amigável se inválida), `arquivo?: File`,
     `remover_arquivo?: '1'`, `ordem?`. Regras: título obrigatório; pelo menos um de
     texto/url/arquivo (contando o arquivo já existente); arquivo ≤ 20 MB; mimes aceitos
     `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
     `text/plain`, `text/markdown`, `image/png`, `image/jpeg`. Path:
     `convenios/<convenio_id>/<doc_id>/<nome-sanitizado>` (gerar `doc_id` com
     `crypto.randomUUID()` ANTES do upload e usar como `id` no insert). Ao trocar/remover
     arquivo, apagar o anterior do bucket. Se o arquivo mudou, zerar `texto_extraido`,
     `resumo_ia`, `ia_status='nao_lido'`. Gravar `created_by/updated_by` com o usuário atual
     (ver como `requirePermission`/`getCurrentUser` expõem o id em outras actions).
   - `getDocumentoUrl(id)` → signed URL 1h (só se `arquivo_path`).
   - `excluirDocumento(id)` → apaga do bucket e da tabela (hard delete — FAQ gerada aponta
     via `on delete set null`). `setDocumentoStatus(id, ativo)`.
2. Componente `_components/bc/DocumentosLista.tsx` — props `{ convenioId, tipo,
   convenioInstituicaoId?, titulo }`. Lista (título, indicadores 📄 arquivo / 🔗 link / ¶ texto,
   `ia_status` como badge, ativo) + modal de edição com: título, texto (textarea grande),
   URL, upload (input file com nome/tamanho do atual + "remover"), ordem. Botão "Abrir" chama
   `getDocumentoUrl` e faz `window.open`. Bloco "Resumo (IA)" só leitura quando `resumo_ia`.
3. Sub-abas novas em `ConvenioEditor`: **Decretos** (`<DocumentosLista tipo="decreto">`) e
   **Documentos** (`tipo="outro"`). Ordem final das sub-abas: Público · Formas & Margens ·
   Instituições · Órgãos/Restrições · Decretos · FAQ · Documentos.
4. **Roteiro operacional no vínculo** (`InstituicoesTab`): dentro do card de cada IF, seção
   "Roteiro Operacional" com `<DocumentosLista tipo="roteiro" convenioInstituicaoId={linha.id}>`.
   Só renderiza quando `linha.id` existe (vínculo salvo); senão texto "Salve as instituições
   para anexar o roteiro". Como a RPC de instituições mantém o `id` no upsert, documentos não
   se perdem ao re-salvar a aba.

### (b) FAQ — `convenios/faq-actions.ts` + componente `FaqEditor`

5. Actions:
   - `getFaqConvenio(convenioId)` → `{ proprias: FaqItem[], vinculadas: FaqItem[] }` onde
     `proprias` = `faq_itens` escopo `convenio` do convênio (todas as situações, ordenadas
     `status, ordem`) e `vinculadas` = itens gerais em `convenio_faq_vinculos`. Cada `FaqItem`
     traz `contexto_nome` resolvido (nome da IF / forma / averbadora) quando tem entidade.
   - `getFaqGeral(entidadeTipo, entidadeId)` → itens gerais da entidade + `usos` (quantos
     convênios importaram, via count em `convenio_faq_vinculos`).
   - `getFaqGeraisDisponiveis(convenioId)` → FAQs gerais ATIVAS das entidades ligadas ao
     convênio: averbadora (`convenios.averbadora_id`), IFs (`convenio_instituicoes`), formas
     (`convenio_formas_contrato`) — agrupadas por entidade `{ entidade_tipo, entidade_id,
     nome, itens: [{ ...item, vinculada: boolean }] }`.
   - `salvarFaq(input)` — `{ id?, escopo, convenio_id?, entidade_tipo?, entidade_id?, categoria?,
     pergunta, resposta, ordem?, status? }`; escopo não muda em edição; `origem` sempre
     `manual` aqui; `created_by/updated_by`. Erros de trigger (`check_violation`) → mostrar
     `error.message`.
   - `setFaqStatus(id, status)` (`ativo` | `arquivado`; `rascunho` só a IA cria — Fase 4).
   - `excluirFaq(id)` (hard delete; cascateia vínculos).
   - `vincularFaq(convenioId, faqItemIds: string[])` e `desvincularFaq(convenioId, faqItemId)`.
   - `getFaqCategoriasSugestoes()` → categorias distintas já usadas (datalist).
   - Permissão por escopo: `convenio` → `workspace-convenios`; `geral` → pela entidade:
     `instituicao_financeira` → `sistema-config-instituicoes`, `forma_contrato` →
     `sistema-config-credito`, `averbadora` → `workspace-averbadoras`. Centralizar num
     helper `permissaoFaq(escopo, entidadeTipo)`.
6. Componente compartilhado `src/components/faq/FaqEditor.tsx` — props
   `{ escopo: 'geral'|'convenio', entidadeTipo?, entidadeId?, convenioId?, contextos? }`.
   Lista (categoria, pergunta, resposta resumida, status, `usos` quando geral, contexto quando
   convênio) + modal (categoria com datalist, pergunta, resposta textarea, ordem, e — só no
   escopo convênio — select "Contexto (opcional)" com as entidades ligadas ao convênio:
   averbadora, IFs vinculadas, formas permitidas). Ações: editar, arquivar/reativar, excluir.
7. Sub-aba **FAQ** em `ConvenioEditor` (`_components/bc/FaqTab.tsx`):
   (a) `<FaqEditor escopo="convenio">` com contextos;
   (b) painel **"Importar FAQ geral"**: grupos por entidade (de `getFaqGeraisDisponiveis`)
   com checkbox por item, botão "Importar todas de <entidade>" e "Salvar seleção"
   (`vincularFaq` com os marcados, `desvincularFaq` nos desmarcados);
   (c) placeholder "Rascunhos da IA — em breve (Fase 4)".
8. **FAQ nas entidades** (§7.2), sempre `<FaqEditor escopo="geral">`:
   - Instituições Financeiras: nova aba "FAQ" em `InstituicaoEditor.tsx` (lista de abas,
     ícone `MessageCircleQuestion`), só quando `item.id` existe.
   - Formas de Contrato: em `/comissionamento/formas-contrato`, ação "FAQ" por linha abrindo
     um drawer/modal com o editor.
   - Averbadoras: em `/averbadoras`, ação "FAQ" por linha, idem.

### (c) Completude e listagem

9. `getConvenios` (`actions.ts`): renormalizar `bc_score` para 6 pilares — geral (teto/prazos),
   público, formas, instituições, decretos (≥1 documento tipo decreto ativo), FAQ (≥1 própria
   ativa OU ≥1 vinculada) → `Math.round(100 * preenchidos / 6)`. Mais 2 queries `in(ids)`
   como as existentes.

### (d) Fechamento

10. `npx tsc --noEmit` e `npm run build` limpos.
11. Teste manual: subir um PDF de decreto → "Abrir" funciona (URL assinada) → trocar o
    arquivo → o anterior some do bucket. Criar FAQ geral numa IF → no convênio que tem essa IF,
    "Importar FAQ geral" lista o item → importar → aparece em "vinculadas" e o `usos` da IF
    sobe. Criar FAQ do convênio com contexto = a IF. Roteiro em vínculo salvo. Tentar
    vincular FAQ de escopo convênio via action direto deve falhar (trigger).
12. Commit na branch `convenio-bc/fase-2`; avisar o Fable para revisão antes do merge.

## Não fazer

- Não servir arquivo por URL pública nem expor `arquivo_path` ao browser além do necessário.
- Não implementar extração/IA (Fase 4): só o botão desabilitado.
- Não importar FAQ geral automaticamente ao vincular IF — sempre por seleção (decisão §10.5).
- Não criar permissão nova; não tocar em `usuarios/page.tsx`/`permissions.ts`.
