# Modelo de Documento: template na Assinafy vs. PDF próprio

**Decisão pendente.** Escrito em 24/07/2026 para o Bruno bater o martelo.
Contexto: o jurídico entrega o contrato como `.docx`/`.pdf` já diagramado, e o
fluxo precisa preencher os dados do cadastro nesse arquivo e coletar assinaturas
de várias partes.

---

## Resumo

**Recomendo a opção A — template na Assinafy.** É de longe a mais barata, e a
razão principal é técnica, não de preferência: **nenhuma biblioteca hoje no
projeto consegue preencher um PDF existente.** A opção B exige adicionar uma
dependência nova e construir um editor visual de coordenadas do zero.

---

## Opção A — Template cadastrado na Assinafy

O contrato do jurídico é cadastrado uma vez como *template* na Assinafy. Lá se
define os **papéis** (Contratada, Contratante, Testemunha 1, Testemunha 2) e se
posiciona os **campos** sobre as páginas.

No disparo, o BRS faz **uma única chamada**:

```
POST /v1/accounts/{accountId}/templates/{templateId}/documents
{
  "signers":       [{ "role_id": "...", "verification_method": "Email",
                      "notification_methods": ["Email"], "step": 1 }],
  "editor_fields": [{ "field_id": "...", "value": "ACME CORRESPONDENTE LTDA" }],
  "name":          "Contrato PS PJ — ACME",
  "expires_at":    "2026-08-24T21:00:00Z"
}
```

A resposta já traz o documento criado, o assignment **e** os `signing_urls` por
signatário. Documento gerado, preenchido e pronto para assinar em uma chamada.

**A favor**
- Preenchimento (`editor_fields`) e assinatura na mesma requisição
- Zero manipulação de PDF do nosso lado
- O posicionamento visual dos campos já existe, pronto, no app da Assinafy
- A tela "Modelo de Documento" do BRS vira algo simples: escolher o template e
  mapear `field_id` → campo do dicionário canônico

**Contra**
- ⚠️ **Os modelos passam a viver fora do BRS Workspace.** Trocar a redação do
  contrato é uma tarefa no app da Assinafy, não no seu sistema.
- ⚠️ **Templates parecem só ser criados pelo app web.** O catálogo de endpoints
  expõe `GET /v1/accounts/{accountId}/templates` (listar) e
  `POST .../templates/{templateId}/documents` (gerar documento), mas **nenhum
  endpoint de criação de template**. Ou seja: cada modelo novo exige um passo
  manual fora do BRS. *Não consegui confirmar isso na documentação — vale
  perguntar ao suporte da Assinafy antes de decidir.*
- Se um dia trocar de provedor de assinatura, os modelos ficam para trás

---

## Opção B — PDF próprio com posicionamento no BRS

Upload do PDF no BRS, posicionamento dos campos numa tela nova, e no disparo o
sistema "carimba" os valores no PDF antes de enviar para a Assinafy.

**A favor**
- Os modelos ficam no BRS, versionados junto do resto do sistema
- Independência de provedor de assinatura
- Controle total sobre a aparência do documento gerado

**Contra — e aqui está o custo real**
- ⚠️ **Nenhuma lib atual preenche PDF existente.** `@react-pdf/renderer` e
  `jspdf` *criam* PDFs do zero; não editam um arquivo pronto. Seria preciso
  adicionar `pdf-lib` ou equivalente.
- Precisa de um **editor visual de coordenadas**: renderizar o PDF na tela,
  arrastar campos sobre as páginas, salvar posição/página/fonte/tamanho. É a
  parte cara — uma tela inteira, não trivial.
- Reimplementa exatamente o que a Assinafy já faz pronto.

### Um esclarecimento importante sobre `method: "collect"`

A Assinafy tem um modo `collect` que recebe coordenadas de campos por página.
**Ele não serve para pré-preencher dados do cadastro.** `collect` define campos
que o *signatário* preenche na hora de assinar. Para estampar a razão social no
contrato antes de enviar, o caminho é `editor_fields` (opção A) ou carimbar no
PDF por conta própria (opção B). Vale registrar porque a confusão entre os dois
é fácil e mudaria bastante a estimativa.

---

## Comparação

| | A — Template na Assinafy | B — PDF próprio |
|---|---|---|
| Preencher dados do cadastro | `editor_fields` na mesma chamada | carimbar com `pdf-lib` |
| Posicionar campos | pronto, no app da Assinafy | tela nova a construir |
| Dependência nova | nenhuma | `pdf-lib` |
| Onde vive o modelo | na Assinafy | no BRS |
| Trocar de provedor | refazer os modelos | modelos preservados |
| Esforço relativo | baixo | alto |

---

## Recomendação

Começar pela **A** para o fluxo do Contrato PS PJ. Ela entrega o fluxo inteiro
funcionando muito antes, e o acoplamento é contornável: o mapeamento
`field_id` → campo do dicionário fica guardado no BRS, então migrar para B
depois significa construir o editor visual — não redesenhar a integração.

Antes de fechar, duas perguntas para o suporte da Assinafy:

1. Dá para **criar/atualizar template via API**, ou só pelo app web?
2. `editor_fields` aceita **texto livre** em qualquer campo, ou os campos têm
   tipo/validação fixados no template?

A resposta da primeira muda a operação: se for só pelo app, todo contrato novo
tem um passo manual fora do sistema — aceitável para 3 modelos, incômodo para 30.

---

## Independente da escolha

Estas peças da Fase 1 valem para as duas opções:

- `assinafy_config` precisa de `account_id` e ambiente — migration já escrita em
  `supabase/migrations/20260724000000_assinafy_config_account_and_env.sql`
  (**não aplicada**)
- Signatários precisam ser criados antes (`POST /v1/accounts/{id}/signers`) nas
  duas opções — vale um cache local de `signer_id` por CPF para não recriar
- Webhook `document_ready` + **reconciliação por polling**: a Assinafy tenta
  entregar cada evento só 2 vezes e entra em circuit breaker após 10 falhas
  consecutivas. Webhook sozinho deixaria cards presos para sempre.
- Desenvolver contra o **sandbox** (`sandbox.assinafy.com.br`), nunca contra a
  conta de produção
