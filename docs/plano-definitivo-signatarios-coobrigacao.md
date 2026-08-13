# Plano Definitivo — Estrutura Empresarial, Signatários e Coobrigação Solidária

> Status: **AGUARDANDO AUTORIZAÇÃO DO BRUNO — NADA IMPLEMENTADO**
> Escopo: brs-rh (workspace) + brs-portal-parceiro (portal)
> Decisões-base: especificação Jarvis + decisões do Bruno de 09/08/2026
> (coobrigação solidária aprovada pelo jurídico; duas testemunhas sempre;
> gerente da geração congelado no contrato; Opção A em `corban_data`).
>
> **Revisão 2 (09/08/2026):** cônjuge/regime de bens FORA DO ESCOPO;
> Contratante = Isabelly via `company_profiles` (fonte única); fluxo
> excepcional de sócios PJ definido (1 nível extra + revisão obrigatória
> do backoffice). Ver seções marcadas [REV2].

## [REV2] Decisões incorporadas nesta revisão

1. **Interveniente Anuente / cônjuge / regime de bens: FORA DO ESCOPO.**
   A coobrigação solidária pessoal não exige outorga conjugal. Estado civil
   permanece apenas como qualificação cadastral (campo já existente). Nenhuma
   lógica `casado → regime → cônjuge → anuência` será implementada. Se um dia
   houver fiança/aval/garantia real, vira evolução específica.
2. **Contratante / Representante BRS = Isabelly, resolvida do cadastro da
   Empresa** (`company_profiles`, confirmado por inspeção somente-leitura):
   - Tabela `company_profiles` (migration `20260526020000`): `company_data`,
     `partner_primary_data`, `partner_secondary_data`, `witness_data` (JSONB).
   - `partner_primary_data` do perfil ativo já contém a Isabelly completa:
     nome, CPF, nascimento, WhatsApp, endereço, `email_signature` e
     `email_professional`. **Nome, CPF e e-mail de assinatura existem.**
   - `process_models.company_profile_id` já vincula o processo ao perfil da
     empresa contratante (BRS 1 × BRS 2) — a geração de contrato resolve por aí.
   - **Não existe flag "representante contratual"**. Alteração mínima
     proposta: convenção `partner_primary_data` = representante contratual do
     perfil. Se um dia o representante não for o sócio primário, adiciona-se
     um campo `contract_representative` em `company_data` (não agora).
   - Nada de hardcode de nome/CPF/e-mail no código.
3. **LTDA com sócios PJ — fluxo excepcional e supervisionado:**
   - Cada sócio `person_kind: 'PJ'` exige documento próprio: **Contrato
     Social / alteração consolidada da PJ sócia** (um por PJ, nunca global).
   - Um nível adicional apenas: `socios[].socios_pf_relacionados[]` — sócios
     PF da PJ sócia (cpf, name, capital_share opcional). Sem árvore ilimitada.
   - **Elegibilidade dos coobrigados:** (1º) sócio PF direto; (2º) na ausência,
     sócio PF de PJ sócia; (3º) sem duas pessoas elegíveis → pendência para
     decisão manual do backoffice. `externo` NÃO abre automaticamente nesse
     cenário.
   - Representação segue independente: administrador/sócio-admin/procurador;
     acúmulo REPRESENTANTE + COOBRIGADO permitido quando os vínculos existem.
   - **Qualquer `person_kind: 'PJ'` no quadro → pendência obrigatória
     "REVISÃO SOCIETÁRIA NECESSÁRIA"** com status
     `PENDENTE | APROVADO | REPROVADO`. Bloqueia SOMENTE a geração do
     contrato (parceiro conclui o cadastro normalmente). Alerta visual no
     workspace listando o que validar (contratos sociais das PJs, sócios PF
     informados, poderes do representante, coobrigados 1 e 2).

---

## Resultados das investigações prévias (somente leitura)

### Registros legados (agentes_parceiros)
- Apenas **2 registros** na base. Naturezas jurídicas gravadas pela consulta de
  CNPJ: `Sociedade Empresária Limitada` (1x) e vazio (1x).
- **Nenhum caso EIRELI real encontrado** → não criar condicional de EIRELI
  agora. A natureza jurídica chega como **texto descritivo**, não código
  REDESIM — a detecção de tipo deve mapear por texto normalizado e cair em
  `OUTRO` (revisão manual) quando não reconhecer.

### Templates atuais na Assinafy (sandbox)
4 templates. O contrato real ("CONTRATO DE PRESTAÇÃO DE SERVIÇOS E PARCERIA
COMERCIAL PJ") tem os papéis: `TemplateEditor`, `Contratante`, `Contratado`,
`Testemunha 1`, `Testemunha 2` — e as variáveis mapeadas hoje cobrem só
empresa + sócio principal (18 campos, ver `contract-mapping.ts`).

**O que precisa mudar no template (não alterar ainda):**
- Papéis a criar: `Coobrigado Solidário 1`, `Coobrigado Solidário 2`.
- Papéis a renomear: `Contratado` → `Representante CNPJ`; `Testemunha 1` →
  `Testemunha Parceiro`; `Testemunha 2` → `Testemunha BRS`.
- Variáveis novas: blocos de qualificação de Coobrigado 1 e 2 (nome, CPF,
  estado civil, profissão, endereço), Testemunha Parceiro (nome, CPF),
  Testemunha BRS (nome, CPF) e cláusula de coobrigação.
- Um dos templates de teste (`TESTE_CONTRATO_PJ`) tem papéis mistos
  ("Testemunha 1, Avalista e Devedor Solidário") — modelo **revogado**
  (testemunha nunca acumula coobrigação); descartar.

### Mesma pessoa em dois papéis (Assinafy)
A API monta `signers[] = [{ role_id, id(signer), ... }]` — o mesmo `signer.id`
pode aparecer em dois `role_id`. As `signing_urls` retornam **por signer_id**,
o que indica **um único convite e uma única sessão de assinatura** que executa
os campos dos dois papéis. Comportamento provável, mas deve ser **confirmado
com um teste no sandbox** na etapa 14 antes de fechar o fluxo.

### Nomenclatura interna
Não há razão técnica para manter `GARANTIDOR_*`: as chaves nascem novas, sem
legado. Usar `COOBRIGADO_SOLIDARIO_1/2` internamente, no contrato e na
Assinafy. Na UI do portal, rótulo amigável: "Coobrigado Solidário (Garantidor)".

---

## Desenho-alvo do `corban_data` (Opção A)

```jsonc
{
  "master": {
    // já existe: natureza_juridica (texto cru da consulta CNPJ)
    "empresa_tipo": "MEI | EI | LTDA | SA | OUTRO"   // derivado; editável pelo backoffice
  },

  // N sócios (LTDA/SA). MEI/EI: o TITULAR ocupa socios[0] (invariante do motor
  // preservada: índice 0 = principal). PJ sócia entra com person_kind PJ.
  "socios": [
    { "person_kind": "PF", "cpf": "...", "name": "...", "capital_share": 60, /* demais dados atuais */ },
    { "person_kind": "PJ", "cnpj": "...", "name": "Empresa A LTDA", "capital_share": 40,
      // [REV2] PJ sócia: documento societário próprio + 1 nível de PFs relacionadas
      "contrato_social_document_url": "...",
      "socios_pf_relacionados": [
        { "cpf": "...", "name": "João", "capital_share": 100 }
      ] }
  ],

  // Só quando necessário (LTDA com admin não-sócio, procurador, diretoria S.A.)
  "administracao": [
    { "cpf": "...", "name": "...", "tipo": "administrador | diretor | procurador",
      "socio_cpf": "... (ref opcional)", "cargo": "...",
      "representacao": "isolada | conjunta",
      "procuracao": { "doc_url": "...", "validade": "AAAA-MM-DD" } }
  ],

  // Pessoas externas à estrutura (ex.: Coobrigado 2 externo). Testemunha do
  // parceiro continua no grupo `witness.*` existente (reuso total).
  "pessoas": [
    { "cpf": "...", "name": "...", /* qualificação completa */ }
  ],

  // Papéis contratuais — referências por CPF, resolvidas contra
  // socios/administracao/pessoas/witness. Pessoa nunca é duplicada.
  "signatarios": {
    "representante_cnpj": [ { "fonte": "socio", "cpf": "..." } ],   // array p/ conjunta
    "coobrigado_solidario_1": { "fonte": "socio", "cpf": "...", "origem": "socio" },
    "coobrigado_solidario_2": { "fonte": "externo", "cpf": "...", "origem": "externo" },
    "testemunha_parceiro": { "fonte": "witness", "cpf": "..." },
    "testemunha_brs": {
      "fonte": "gerente_comercial", "user_id": "...",
      "snapshot": { "name": "...", "cpf": "...", "email": "..." },
      "resolvido_em": "ISO"   // congelado na geração do contrato
    }
  }
}
```

`origem` do coobrigado [REV2 — regra fechada]:
`socio | socio_pj_relacionado | administrador | diretor | procurador | externo`.
Elegibilidade em ordem: sócio PF direto → sócio PF de PJ sócia → pendência
manual do backoffice. `externo` não é oferecido automaticamente no cenário
só-PJ. O `PersonRef` resolve `socio_pj_relacionado` procurando o CPF dentro de
`socios[].socios_pf_relacionados[]`.

Pendência de revisão societária [REV2] — vive junto do cadastro:
`corban_data.revisao_societaria = { status: 'pendente'|'aprovado'|'reprovado',
por: user_id, em: ISO, observacao }`. Criada automaticamente quando existe
sócio PJ; `aprovado` é condição de geração do contrato (não trava o cadastro).

---

## As 19 etapas

### 1. Estrutura do `corban_data`
- **O quê:** o desenho acima. Zero migration (JSON). `partner_2_exists` fica
  derivado (`socios.length > 1`) e deprecado como campo de escrita.
- **Arquivos:** nenhum isolado — a estrutura nasce nas etapas 2–5.
- **Risco: baixo.** Reaproveita array `socios` e grupo `witness` existentes.
- **Regressão:** registros legados continuam legíveis (chaves antigas intactas).

### 2. Dicionário canônico (`agente-corban-fields.ts`, espelho no portal)
- Novo `master.empresa_tipo` (select).
- `socios`: definição por **item de sócio** (schema do repeater) no lugar da
  enumeração fixa `partner_1_*`/`partner_2_*`; as chaves `partner_1_*` e
  `partner_2_*` permanecem como **aliases legados** (o mapa do contrato atual
  as consome) apontando para `socios.0/.1`.
- Novos grupos: `administracao` (item), `pessoas` (item), `signatarios`.
- **Campos computados de signatário** (`coobrigado_1_name`, `coobrigado_2_cpf`,
  `testemunha_brs_name`, `representante_email`, …): um resolvedor que
  dereferencia o `PersonRef` (CPF → socios/administracao/pessoas/witness) e
  devolve o dado. São esses tokens que o contrato novo usará.
- Matriz de compatibilidade de papéis como **função pura**
  (`validateSignatarios(corbanData)`): C1≠C2; testemunha ∉ {representante,
  coobrigados}; coobrigado sempre PF; capital = 100% (LTDA); representante só
  quem tem poder (administracao/procurador ou sócio-admin); origem `externo`
  exige aprovação.
- **Risco: baixo/médio** (funções puras, testáveis). **Dependências:** nenhuma.
- **Regressão:** aliases preservam consumidores atuais (contract-mapping,
  tokens de e-mail/WhatsApp).

### 3. Regras do motor SCP
- `isWitnessRequired()` → **obsoleta** no fluxo novo (testemunha sempre
  obrigatória). Manter para registros sem bloco `signatarios` (legado) e usar
  `validateSignatarios` quando o bloco existir — a presença do bloco é o
  feature-flag natural.
- Condição de saída da etapa de contrato: signatários completos + válidos +
  testemunha BRS resolvível.
- **Arquivos:** `src/lib/scp-engine/decisions.ts` (ou onde as condições vivem),
  `agente-corban-fields.ts` (findMissingFields já cobre).
- **Risco: baixo.** Regressão: gate por presença do bloco.

### 4. Agente Corban (workspace)
- `AgenteCorbanEditorClient.tsx`: aba Sócios vira **repeater** ("+ Adicionar
  sócio", person_kind PF/PJ, capital com somatório visível "Distribuído: 85% /
  Falta: 15%"); nova seção **Signatários** (seleção por pessoa existente +
  validação da matriz em tempo real); seção Administração aparece só para
  LTDA/S.A. (progressive disclosure espelhada).
- **Risco: médio** (arquivo grande). Incremental por aba; dados antigos de 2
  sócios renderizam no repeater sem conversão.

### 5. Portal Parceiro — construção do formulário real
- O wizard (4 fases) ganha a fase Dados com os passos por tipo. Nada a
  refatorar — nasce já no modelo novo, consumindo o dicionário espelhado.
- **Arquivos:** `brs-portal-parceiro/src/app/cadastro/[tipo]/formulario/*` +
  `src/lib/agente-corban/*` (espelho).
- **Risco: médio** (código novo, sem regressão possível no workspace).

### 6. Tipo empresarial + progressive disclosure
- CNPJ digitado → lookup → `natureza_juridica` (texto) → normalização →
  `empresa_tipo`. Mapa por texto: "Empresário (Individual)" → EI; "Sociedade
  Empresária Limitada"/"Sociedade Limitada Unipessoal" → LTDA; "Sociedade
  Anônima" → SA; MEI vem sinalizado pelo campo próprio da consulta (opção MEI
  do CNPJ.ws) — confirmar na etapa o payload salvo em `cnpj_payload`.
- Não reconheceu → `OUTRO` → segue fluxo LTDA genérico + pendência de revisão
  do backoffice (nunca inventar enquadramento).
- Sem confirmação manual do parceiro quando inequívoco (decisão §10); o
  backoffice pode corrigir `empresa_tipo` no workspace.
- **Risco: baixo.**

### 7. Quadro societário N sócios (portal)
- Repeater idêntico ao do workspace; PF (CPF, qualificação completa) ou PJ
  (CNPJ, razão social, participação); barra de capital 100% bloqueando avanço.
- [REV2] Sócio PJ expande em linha: upload obrigatório do **Contrato Social
  da PJ sócia** (um por PJ) + subformulário "Sócios PF desta empresa"
  (mínimo os que serão usados como coobrigados). Presença de sócio PJ grava
  `revisao_societaria.status = 'pendente'` automaticamente.
- **Risco: baixo/médio** (UI nova + validação da etapa 2).

### 8. Administração / diretoria / procuradores
- LTDA: pergunta "quem administra?" — sócio(s) (marca no repeater) ou terceiro
  (abre item em `administracao`). Procurador: pergunta objetiva "existe
  procurador autorizado a assinar?" → item `tipo: 'procurador'` + upload da
  procuração + validade. S.A.: seção Diretoria (N diretores, representação
  isolada/conjunta).
- Frequência esperada baixa para conjunta → UI simples: select
  isolada/conjunta por pessoa; conjunta exige ≥2 representantes marcados.
- **Risco: médio** (é a parte mais nova). MEI/EI nunca veem essa seção.

### 9. Signatários (tela no portal + espelho no workspace)
- Tela única "Quem assina o contrato": representante (auto p/ MEI/EI e
  sócio-admin único; select entre habilitados nos demais), Coobrigado 1
  (sugerido = sócio PF de maior participação, editável), Coobrigado 2,
  Testemunha do Parceiro (cadastro → grupo `witness`), Testemunha BRS
  (card informativo, não editável: "Gerente Comercial responsável pelo seu
  atendimento — preenchido automaticamente pela BRS").
- Validação da matriz em tempo real com mensagens claras.
- **Risco: médio.**

### 10. Coobrigados Solidários
- MEI/EI: titular = Coobrigado 1 automático (junto de Representante).
- LTDA: Coobrigado 1 = sócio PF (sugestão por maior participação, sem
  hardcode de desempate — empate → parceiro escolhe).
- [REV2] Cenário só-PJ: seleção entre os **sócios PF das PJs sócias**
  (`socios_pf_relacionados`); sem duas pessoas elegíveis → pendência manual
  do backoffice; `externo` não é oferecido automaticamente.
- Coobrigado 2: CPF ≠ C1; sócio/sócio-de-PJ/admin/representante/externo
  (externo → qualificação completa em `pessoas`).
- **Risco: baixo** (regras da etapa 2 aplicadas na UI).

### 11. Testemunha do Parceiro
- Reuso integral do grupo `witness.*` (dados + tokens já existem).
- Bloqueios: CPF ∉ {representante, C1, C2} (matriz).
- **Risco: baixo.**

### 12–13. Testemunha BRS + integração Gerente Comercial
- Resolução **no momento da geração do contrato**: `access.gerente_id` →
  `usuarios` (name, cpf, email — já disponíveis) → snapshot em
  `signatarios.testemunha_brs` + persistido no registro do documento
  (`recordAssinafyDocument`). Nunca recalculado durante a assinatura;
  regeneração completa → re-resolve.
- Sem gerente válido → **geração bloqueada** + pendência interna visível no
  workspace (nunca escolher outro colaborador).
- **Arquivos:** `src/lib/assinafy/generate-contract.ts`, `usuarios/actions.ts`
  (leitura), registro de documentos.
- **Risco: baixo.** Dado já existe; é plumbing.

### 14. Assinafy
- Substituir o interim `resolveRoleEmail` por mapeamento
  **papel do template → PersonRef de `signatarios` → findOrCreateSigner (nome
  e e-mail reais)**; mesma pessoa em 2 papéis = mesmo signer em 2 role_ids.
- [REV2] Papel **Contratante**: resolvido de
  `process_models.company_profile_id → company_profiles.partner_primary_data`
  (nome, CPF, `email_signature` — dados da Isabelly já presentes no cadastro
  da Empresa). Convenção: sócio primário do perfil = representante contratual;
  sem perfil vinculado ao processo → geração bloqueada com pendência. Nenhum
  dado pessoal hardcoded.
- [REV2] Condição extra de geração: `revisao_societaria.status === 'aprovado'`
  quando houver sócio PJ.
- **Teste obrigatório no sandbox antes de fechar:** documento com o mesmo
  signer em `Representante CNPJ` + `Coobrigado Solidário 1` — confirmar
  convite único / sessão única / carimbo nos dois papéis.
- **Risco: médio** (dependência externa). Regressão: manter o fluxo antigo
  funcionando para o template atual até o novo template entrar.

### 15. Contrato / template
- Novo template com os 6 papéis + variáveis de qualificação (etapa de
  investigação acima). `CONTRATO_PS_PJ_FIELD_MAP` ganha as entradas novas
  usando os campos computados de signatário (etapa 2).
- Texto contratual: cláusula de coobrigação solidária — redação do jurídico.
- **Risco: médio** (depende do jurídico e de edição manual do template).

### 16. Validações (consolidado)
- Matriz de papéis; capital 100%; CPFs distintos onde exigido; CPF/CNPJ
  válidos (já existem normalizadores); procuração com validade ≥ hoje na
  geração; coobrigados sempre PF; e-mails pessoais (regra do formulário atual)
  para signatários.

### 17. Compatibilidade com dados existentes
- 2 registros legados: continuam legíveis por chaves antigas + fallbacks.
- `partner_1_*`/`partner_2_*` viram aliases (não remoção).
- `isWitnessRequired` preservada para registros sem `signatarios`.
- Sem backfill necessário (volume 2; se desejar, conversão manual na tela).

### 18. Testes
- Unitários: normalização de tipo empresarial (textos reais da consulta),
  matriz de papéis (todos os bloqueios/permissões), capital 100%,
  resolvedor de PersonRef, findMissingFields com signatários.
- Integração: geração de contrato com snapshot do gerente; bloqueio sem
  gerente; sandbox Assinafy multi-papel (etapa 14).
- E2E manual: um cadastro completo por tipo (MEI, EI, LTDA 1 sócio admin,
  LTDA 2+ sócios, LTDA só-PJ, S.A.) no portal → card no workspace → validação
  → geração.
- Regressão: abrir os 2 registros legados no editor após cada etapa.

### 19. Ordem recomendada
1. **Etapa 2** (dicionário + validações puras) — fundação, testável isolada.
2. **Etapas 5–7** (portal: tipo automático + MEI/EI primeiro — fluxo mais
   curto e mais comum — depois LTDA, depois S.A.).
3. **Etapas 8–11** (administração + signatários no portal).
4. **Etapa 4** (editor do workspace: repeater + aba signatários).
5. **Etapa 3** (motor SCP).
6. **Etapas 12–13** (testemunha BRS).
7. **Etapa 14** (Assinafy real + teste sandbox multi-papel).
8. **Etapa 15** (template novo + jurídico) — última, pois depende de fora.

Cada bloco fecha com `tsc` limpo + build verde + teste manual antes do
seguinte. Nada de mexer no template Assinafy de produção até o item 8.

---

## DECISÕES AINDA PENDENTES (após Revisão 2)

~~Regime de bens/cônjuge~~ — **fechada**: fora do escopo (coobrigação não exige).
~~Contratante BRS~~ — **fechada**: Isabelly via `company_profiles` (fonte única).
~~Exceção LTDA só-PJ~~ — **fechada**: sócios PF das PJs sócias + revisão backoffice.

Permanecem:

1. **EIRELI** — sem casos reais na base; mapear o texto → fluxo LTDA
   unipessoal quando (se) aparecer, com log para revisão. Sem condicional além.
2. **Confirmação sandbox** do comportamento convite-único multi-papel
   (validação técnica, etapa 14 — não bloqueia o início).
3. **[REV2, nova — menor]** `company_profiles.witness_data` contém o Bruno
   como "testemunha da empresa" — conceito anterior à regra
   "Testemunha BRS = gerente comercial". A regra do gerente prevalece; o bloco
   `witness_data` fica sem uso neste fluxo. Confirmar que não há outro
   consumidor antes de qualquer limpeza (não é bloqueante).
4. **[REV2, nova — menor]** Qual perfil (`BRS 1` × `BRS 2`) contrata os
   parceiros do portal: hoje é o `company_profile_id` do modelo de processo.
   Confirmar que o processo de parceiros aponta para o perfil certo na
   configuração (operacional, não de código).
