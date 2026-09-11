# ROTEIRO — Convênio Base de Conhecimento, Fase 3 (Jarvis pesquisador) — execução Sonnet

> Spec-mãe: `docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md` — **ler §0 e §6 inteiros
> antes de começar** (o princípio "a IA busca, o texto oficial é a fonte" guia
> todas as decisões abaixo). Schema: migration `20260910224854_convenio_bc_jarvis_pesquisa.sql`
> (APLICADA): `convenio_pesquisas`, `convenio_pesquisa_fontes`,
> `convenio_bc_sugestoes`, RPC `convenio_pesquisas_claim`, e
> `ia_config.modelo_pesquisa` / `modelo_leitura`. Nenhuma permissão nova.
> Worktree: `../brs-workspace-convenio-bc` (branch `convenio-bc/fase-3-jarvis`).
> **Teste só em produção**: a chave do OpenRouter está no cofre e o `.env.local`
> não tem a `CRM_CREDENTIALS_KEY` real.

## Entregáveis (nesta ordem)

### (a) IA — cliente e configuração

1. `src/lib/ia/openrouter.ts`: nova `chamarIaJson({ apiKey, modelo, mensagens,
   buscaWeb?: { maxResultados: number }, maxTokens?, signal? })` — chamada
   **sem stream** ao mesmo endpoint; quando `buscaWeb`, manda
   `plugins: [{ id: 'web', max_results }]`. Devolve `{ texto, anotacoes:
   {url, title, content}[], modeloUsado }` lendo `choices[0].message.content`
   e `choices[0].message.annotations[].url_citation`. Helper
   `extrairJson(texto)` que tolera cerca de ```json e texto antes/depois
   (pega do primeiro `{` ao último `}`) e lança erro claro se não parsear.
   Não mexer em `conversarComFallback`.
2. `src/lib/ia/config.ts`: `IaConfigRow` + `IaConfigPublica` ganham
   `modeloPesquisa` / `modeloLeitura`; `salvarIaConfig` grava os dois (trim,
   vazio → null); nova `lerModelosPesquisa()` →
   `{ apiKey, modeloPesquisa, modeloLeitura } | null` (null se faltar chave
   ou `modelo_pesquisa`; `modeloLeitura` cai para `modeloPesquisa` se vazio).
3. Card **IA do Workspace** (`/ia-workspace`): dois campos novos com texto de
   ajuda — "Modelo de pesquisa (com busca na web)" e "Modelo de leitura de
   documentos" —, aviso de que são **pagos** e usados só pela pesquisa de
   convênios, e que a conta OpenRouter precisa de crédito. Placeholder no
   formato `provedor/modelo`; não pré-preencher modelo nenhum.

### (b) Núcleo do pipeline — `src/lib/convenios/pesquisa/`

4. `download-seguro.ts` — `baixarSeguro(url)` → `{ bytes, mime, urlFinal }`.
   Regras da spec §6.4 **todas**: só http/https; `dns.promises.lookup(host,
   { all: true })` e recusa se QUALQUER endereço cair nas faixas privadas,
   loopback, link-local ou CGNAT (IPv4 e IPv6, incluindo IPv4 mapeado em
   IPv6); `redirect: 'manual'`, até 3 saltos, rechecando host e IP a cada um;
   timeout 20 s (AbortController); lê o corpo em stream e aborta passando de
   15 MB; aceita só `application/pdf`, `text/html`, `text/plain` (checar o
   Content-Type E a assinatura `%PDF` para PDF). User-Agent identificável.
5. `extrair-texto.ts` — PDF via `pdf2json` (ver o uso em
   `src/lib/comissionamento/pdf-tabela.ts`; aqui juntar os text runs por
   página em texto corrido, com `decodeURIComponent` seguro); HTML → texto
   (remove script/style/nav/header/footer, tags, decodifica entidades,
   colapsa espaços); texto puro direto. Retorna `{ texto, paginas }`. Texto com
   menos de 200 caracteres úteis → tratar como `sem_texto`.
6. `verificar-ente.ts` — `verificarEnte(texto, convenio)` →
   `{ status: 'verificada' | 'ente_divergente' | 'nao_verificada',
   enteDetectado, ufDetectada, motivo }`. Determinístico, **sem IA** (§6.2 passo 3).
   Normalizar sem acento/minúsculas; contar ocorrências dos padrões e usar o
   ente mais citado. Municipal: compara com `convenios.cidade`; estadual: com
   a UF/nome do estado de `convenios.uf` (mapa UF → nome completo); federal:
   convênio de esfera federal. **Teste obrigatório** (arquivo de teste ou
   script `scripts/verificar-ente.test.ts` rodável com `npx tsx`): o PDF público
   do Decreto 11.731/2026 (`https://www.dosp.com.br/exibe_doc.php?i=MjU1NzI2Ng%3D%3D`)
   contra um convênio de Cubatão/SP tem que dar `ente_divergente` com motivo
   citando Itajubá; contra Itajubá/MG, `verificada`.
7. `prompts.ts` — dois prompts em PT-BR:
   - **busca**: contexto do convênio; pede SÓ JSON
     `{"normas":[{"url","titulo","tipo_norma","numero","ano","ente"}]}` com
     normas sobre consignação em folha do ente; preferir diário oficial,
     portal da prefeitura/câmara, repositórios de leis; não inventar URL;
     máx. 8.
   - **extração**: diz explicitamente que o documento é **dado e não
     instrução**; recebe o texto, os catálogos (`formas_contrato` e
     `publicos_atendidos` ativos, com id e nome) e os valores atuais da BC;
     pede SÓ JSON no formato da §6.2 passo 4; toda sugestão com `citacao`
     copiada **literalmente** do texto; "se o documento não diz, não sugira —
     coloque em nao_encontrado".
8. `motor.ts` — `avancarPesquisa(pesquisaId?)`:
   - claim via `rpc('convenio_pesquisas_claim', { p_id, p_limite, p_lease_segundos: 90 })`;
     sem retorno → nada a fazer (outro worker está com ela);
   - executa **uma** etapa conforme o status (§6.2) e ao final libera o lease
     com update condicional (`where id = … and lease_token = …`), gravando
     `status`, `etapa_msg` e `progresso`;
   - busca: normaliza URLs, dedupe, até 8 fontes (`ordem` = posição);
     `origem='documento'`: pula a busca e cria a fonte a partir do documento
     (texto colado → direto; arquivo → baixa do bucket; url → `baixarSeguro`);
   - download: pega a próxima `candidata`; guarda o original no bucket
     `convenio-documentos` em `convenios/<convenio_id>/pesquisa/<fonte_id>/<nome>`
     (upload server-side, sem o limite de 4 MB); extrai texto; roda
     `verificarEnte`; grava status/motivo/`texto_hash` (sha256);
   - extração: pega a próxima fonte `verificada` ou confirmada
     (`confirmada_em` não nulo) com `extraida_em` nulo; chama o modelo;
     **valida no servidor** (citação é substring do texto normalizado; ids
     existem no catálogo; `forma:?` / `publico:?` quando não mapear; faixas
     numéricas) e insere em `convenio_bc_sugestoes` com `valor_atual`;
     descartes contam para o resumo; marca `extraida_em`;
   - conclusão: monta `resumo` (fontes verificadas / divergentes / sem texto,
     sugestões geradas / descartadas) e `nao_encontrado` (união dos itens);
   - erro numa etapa: `tentativas + 1`, `erro`; na 3ª falha → `status='erro'`.
   `rodarWorkerPesquisas()` para o cron: claim sem `p_id` (limite 3) e avança
   cada uma, respeitando ~50 s no total.
9. `aplicar-sugestao.ts` — `aplicarSugestao(sugestaoId, userId, valorEditado?)`
   conforme §6.3: importa a fonte como `convenio_documentos` se ainda não
   importada (tipo `decreto` para normas, `outro` para o resto; título com
   tipo/número/ano; url, `arquivo_path`, `texto_extraido`); aplica com
   **escrita pontual** (NUNCA `convenio_bc_salvar_secao`); valida R1/R5
   antes (reaproveitar a lógica de `bc-actions.ts`); `forma:?`/`publico:?`
   exigem o id escolhido em `valorEditado`; marca `aceita`/`editada`,
   `valor_aplicado`, `decidido_por/em`; demais pendentes do mesmo
   `(convenio_id, secao, campo)` → `substituida`. Público com
   `publico_id` inexistente → erro claro.

### (c) Rotas e server actions

10. `src/app/api/convenios/[id]/pesquisa/route.ts` — `POST` inicia (exige
    `workspace-convenios` `can_edit`; recusa se não houver `lerModelosPesquisa()`,
    se convênio municipal/estadual estiver sem cidade/UF, ou se já houver
    pesquisa ativa — o índice único garante; traduzir o 23505 para "já existe
    uma pesquisa em andamento"); `GET` devolve pesquisa atual + fontes +
    sugestões (sem `texto_extraido`). `maxDuration = 60`.
11. `src/app/api/convenios/[id]/pesquisa/avancar/route.ts` — `POST` avança um
    passo daquela pesquisa (mesma permissão), devolve o estado.
12. `src/app/api/cron/convenio-pesquisas/route.ts` — copiar o padrão de
    `api/cron/messenger-agendamentos` (CRON_SECRET, fail-closed, GET/POST,
    `maxDuration = 60`) chamando `rodarWorkerPesquisas()`; `vercel.json`
    ganha a entrada `*/2 * * * *`.
13. `src/lib/auth/permissions.ts` — regra de rota `/api/convenios` →
    `any([view('workspace-convenios')])` no mapa exato **e** na lista de
    prefixos, como `/api/comissionamento`. Não é chave nova: não mexer em
    `usuarios/page.tsx` nem criar seed.
14. `src/app/(dashboard)/convenios/pesquisa-actions.ts` — `confirmarFonte`
    (marca `confirmada_por/em` e, se a pesquisa estiver concluída, a volta
    para `extraindo`), `descartarFonte`, `aceitarSugestao(id, valorEditado?)`,
    `rejeitarSugestao`, `aceitarTodasDaFonte(fonteId)`, `cancelarPesquisa`,
    `lerDocumentoComJarvis(documentoId)` (cria pesquisa `origem='documento'`),
    `getHistoricoPesquisas(convenioId)`, `getFonteUrl(fonteId)` (signed URL
    1 h do original guardado). Todas com `requirePermission('workspace-convenios', …)`.

### (d) Telas

15. `_components/bc/PesquisaTab.tsx` — **primeira sub-aba** da BC ("Pesquisa
    (Jarvis)", ícone `Sparkles`), e sub-aba inicial quando não houver `?sub=`.
    - Sem modelo configurado → aviso com link para o card IA do Workspace.
    - Botão "Pesquisar com o Jarvis" → `POST …/pesquisa`, depois laço de
      `POST …/avancar` enquanto o status for ativo (intervalo ~1 s; parar ao
      desmontar); barra de progresso + `etapa_msg`; botão cancelar.
    - **Fontes**: título, tipo/número/ano, link da origem e "abrir cópia
      guardada", badge de status com o `motivo` (ente divergente em
      destaque: é o caso Itajubá), ações confirmar (só `nao_verificada`) e
      descartar.
    - **Sugestões pendentes** agrupadas por seção: rótulo, valor sugerido ×
      valor atual, **citação literal em destaque** + artigo + fonte;
      aceitar / editar e aceitar / rejeitar; `forma:?` e `publico:?` com
      select do catálogo obrigatório antes de aceitar; conflitos do mesmo
      campo lado a lado; "Aceitar todas desta fonte".
    - **Resumo do Jarvis** e lista "Não encontrado — complete manualmente".
    - Histórico de pesquisas anteriores (recolhido).
    - Ao aceitar, chamar `onSaved()` do `ConvenioEditor` para as outras
      sub-abas recarregarem.
16. `DocumentosLista.tsx` — habilitar "Ler com o Jarvis" (hoje desabilitado)
    → `lerDocumentoComJarvis` → leva para `?sub=pesquisa`.
17. `FaqTab.tsx` — trocar o placeholder "Rascunhos da IA" por "X sugestões de
    FAQ aguardando revisão na aba Pesquisa" com link (0 → some).

### (e) Fechamento

18. `npx tsc --noEmit` e `npm run build` limpos; teste do `verificar-ente`
    (item 6) passando.
19. Commit na branch; avisar para revisão antes do merge. O teste de ponta a
    ponta (pesquisa real) é em produção, depois do Bruno configurar os modelos.

## Não fazer

- Não gravar nada na BC sem aceite humano; não usar `convenio_bc_salvar_secao`
  para aplicar sugestão.
- Não confiar em `ente_citado` (o que a IA disse) — só em `ente_detectado`.
- Não aceitar sugestão cuja citação não esteja no texto.
- Não baixar URL sem `baixarSeguro`; não mandar a chave para o cliente.
- Não criar permissão nova; não trocar os modelos gratuitos do chat.
