# Orientação — Cadastros Recebidos (Agente Corban)

**Para: Claude do Orca (Sonnet 5), trabalhando em worktree dedicada do brs-workspace.**
Escrito pelo Claude do VS Code (Fable 5). Plano aprovado pelo Bruno em 23/08/2026.

## Regras da worktree (obrigatórias)

- Branch: `feature/cadastros-recebidos` (worktree própria; NUNCA commitar na main — o merge é feito pelo Claude do VS Code após revisão).
- **PROIBIDO tocar**: `supabase/migrations/` (qualquer migration é pedida por recado ao Claude do VS Code), `src/lib/auth/`, `src/lib/supabase/`, `proxy.ts`/middleware. Credenciais/envs nunca vão para o código.
- Este é **Next.js 16** com breaking changes: leia `node_modules/next/dist/docs/` antes de codar (params são Promise; proxy.ts no lugar de middleware).
- Build de verificação: `NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy SUPABASE_SERVICE_ROLE_KEY=dummy npm run build`.
- Padrões do repo: tabelas com classe `.data-table` (densidade compacta, ver `globals.css`), botões de ação `.btn-acao` lado a lado, server actions em `actions.ts` com `createClient`/`createAdminClient` de `@/lib/supabase/server`, checagem de permissão via `has_permission` já garantida por RLS + rota (slug `agente-corban-cadastros-recebidos`, rota `/agente-corban/cadastros-recebidos` — já registrados).
- Campos com botão copiar: reutilizar `CopyableFieldShell` (`src/components/forms/CopyableFieldShell.tsx`) / padrão `TextField` do `AgenteCorbanEditorClient`.

## Modelo de dados (JÁ APLICADO no banco — não criar tabelas)

Ver `supabase/migrations/20260825120000_cadastros_recebidos.sql` (fonte de verdade):

- `corban_onboarding_processos` — 1 por cadastro; `etapa_atual` ∈ validacao|analise|nuvidio|arw|contrato|termo|boas_vindas|concluido; `status` ∈ em_andamento|aguardando_correcao|correcao_recebida|concluido|cancelado; `etapas` jsonb para histórico `{ "<etapa>": {started_at, completed_at, completed_by} }`; colunas para nuvidio (link, vídeo), Assinafy (ids/status do contrato e do termo, PDFs assinados). UNIQUE em `agente_parceiro_id`.
- `corban_onboarding_itens` — checklist das etapas validacao/analise. `chave` = dot-path do `corban_data` (ex.: `documents.social_contract_url`, `master.email`) ou sintética `analise:serasa:cpf:<cpf>`; `tipo` ∈ informacao|documento|analise; `status` ∈ pendente|aprovado|reprovado|corrigido; snapshot em `valor`; `motivo_reprovacao`/`instrucoes_correcao` preenchidos ao reprovar. UNIQUE (processo, etapa, chave).
- `corban_onboarding_correcoes` — rodadas de correção (magic link). Só existe o HASH do token.
- `corban_onboarding_docs_analise` — uploads de análise: `alvo_tipo` cpf|cnpj|processo, `tipo_documento` serasa|cartao_cnpj|video_nuvidio|outro.
- `corban_onboarding_eventos` — auditoria; gravar TODO envio/transição/aprovação aqui.
- Bucket privado `partner-analise` (uploads via service role; exibição via signed URLs).

## Magic link — contrato (implementação de segurança pronta; apenas consumir)

3 RPCs `security definer`, **exclusivas do service role** (chamar com `createAdminClient`):

1. `corban_onboarding_criar_correcao(p_processo_id, p_item_ids uuid[], p_ttl_horas=168, p_created_by)` → `{correcao_id, token}`. O token em claro só existe nesse retorno: montar imediatamente a URL `https://parceiro.brspromotora.com.br/correcao/<token>` e enviar por e-mail (Resend) + WhatsApp (Z-API). Nunca gravar/logar o token.
2. `corban_onboarding_validar_correcao(p_token)` → `{valido, motivo?}` ou `{valido:true, itens[], corban_data, ...}`. Usar na página do PORTAL (server-side) para pré-preencher só os itens reprovados.
3. `corban_onboarding_submeter_correcao(p_token, p_respostas)` — `p_respostas` = `{ "<chave>": <valor jsonb> }`. Só aplica chaves da própria rodada; grava no dot-path do corban_data; marca itens `corrigido` e processo `correcao_recebida`. Uploads de novos arquivos: usar o mesmo upload do wizard do portal e mandar a URL/lista como valor.

## Criação do processo (lado portal — repositório brs-portal-parceiro)

No server action de submissão do cadastro (o mesmo que insere `agentes_parceiros`), inserir também `corban_onboarding_processos` (`agente_parceiro_id`, `etapa_atual='validacao'`) via service role. Upsert-safe pela UNIQUE. No Workspace, oferecer botão "Criar processo" para cadastros antigos sem processo.

## Chaves de documentos do portal (commit e7728f8 do brs-portal-parceiro)

`corban_data.documents.arquivos_por_documento` = `{ <chave>: [{fileName, url}] }` (até 5 por chave). Chaves: `social_contract`, `address_proof_empresa`, `bank_proof`, `front_photo`, `external_number_photo`, `internal_photo`, `witness_doc`, `coobrigado2_doc`, e dinâmicas `socio_pf_doc:<cpf>`, `socio_pf_endereco:<cpf>`, `socio_pj_contrato:<cnpj>`. Os `*_url` canônicos continuam = primeiro arquivo. Cadastros antigos não têm o campo (tratar opcional).

**Bug conhecido a corrigir na Fase B:** no editor Agente Corban, a caixa "Contrato Social..." está ligada a `contract_pdf_url` (PDF Assinafy) — o correto para o documento enviado pelo parceiro é `documents.social_contract_url`. Exibir ambos com rótulos corretos. Também faltam na UI: `external_number_photo_url`, `witness_document_url`, `primary/secondary_socio_address_proof_url`.

## Fases de entrega (uma por vez; Bruno valida cada uma)

### Fase B — Lista + tela do processo + etapas 1 e 2
- Rota `/agente-corban/cadastros-recebidos`: tabela `.data-table` (parceiro, CNPJ/CPF, etapa atual, status, datas, responsável, dias em aberto), filtros por etapa/status, clique abre o processo.
- Tela do processo: stepper das 8 etapas; geração do checklist de `validacao` na primeira abertura (server action): 1 item por campo relevante do `corban_data` (dados do master, contatos, endereço, banco, sócios) + 1 item por chave de `arquivos_por_documento` (fallback `*_url`). Visualizador embutido: PDF em `<iframe>`, imagem em `<img>`, com botão baixar; navegação entre os até 5 arquivos.
- Aprovar/reprovar por item (reprovar exige motivo + instruções). Todos aprovados → botão "Concluir etapa" → `etapa_atual='analise'`.
- Etapa `analise`: gerar itens automáticos (1 serasa por CPF de sócio/garantidor + 1 pelo CNPJ + cartão CNPJ + conferência de telefones/e-mails), upload para `partner-analise` registrando em `docs_analise`, aprovar/reprovar cada um.
- Corrigir o bug do contrato social no editor (acima).

### Fase C — Etapas 3 (Nuvidio manual) e 4 (ARW)
- Nuvidio: campo do link, botões "Enviar por e-mail" (Resend, config `resend_config` — padrão de uso em `src/lib/scp-engine/handlers.ts`) e "Enviar por WhatsApp" (Z-API, `src/lib/zapi/send.ts`), upload do vídeo (bucket `partner-analise`, tipo `video_nuvidio`) que conclui a etapa.
- ARW: tela espelho com campos de cópia (CopyableFieldShell) na ordem de cadastro do ARW; depois campos de retorno (código ARW, senha, gerente comercial, tipo de agente — lista final com o Bruno) gravando nos campos JÁ EXISTENTES do agente (via actions do editor). Preenchidos → concluir etapa.

### Fase D — Etapas 5–7 (Assinafy + boas-vindas)
- Contrato: usar `generateContractForPartner` (`src/lib/assinafy/generate-contract.ts`); enviar links por e-mail+WhatsApp aos signatários; estado `contrato_status`. O webhook `/api/assinafy/webhook` já existe — pedir por recado ao Claude do VS Code a extensão do processor para marcar assinaturas do processo (não editar o webhook sem ele revisar).
- Termo: preparar após o contrato (template Assinafy do termo — Bruno fornece); fica `pendente_contrato`; disparo automático quando o contrato assinar (job/verificação ao receber webhook).
- Boas-vindas: tela de validação final (assinaturas, selfie), salvar PDFs assinados no bucket + colunas do processo, botão Aprovar dispara e-mail de boas-vindas (texto do Bruno) + WhatsApp, e conclui.

### Fase E — Fluxo de correção completo
- Workspace: em qualquer item reprovado, botão "Solicitar correção" agrupa reprovados → chama `criar_correcao` → envia e-mail com instruções + magic link e WhatsApp → processo `aguardando_correcao`. Lista destaca `correcao_recebida` para reavaliação (itens `corrigido` voltam ao operador; podem ser reprovados de novo, nova rodada).
- Portal: rota pública `/correcao/[token]` (server-side valida com RPC 2), mostra SÓ os itens reprovados pré-preenchidos com instruções, permite reupload/edição, submete com RPC 3, tela de confirmação.

### Fase F — Descontinuação do SCP + E2E
- Remover menu/rotas do SCP (código de tela; dados e engine ficam), redirects se necessário.
- Jornada E2E com o Bruno: cadastro real de teste no portal → todas as etapas → e-mail de boas-vindas.

## Critérios gerais de aceite

- Nenhum download obrigatório para analisar documento (viewer embutido) mas sempre com botão baixar.
- Toda ação relevante gera linha em `corban_onboarding_eventos`.
- Nada de hardcode de URLs/segredos; e-mails/whats com templates em código claro para o Bruno ajustar textos.
- UI densa no padrão ARW-like do resto do sistema.
