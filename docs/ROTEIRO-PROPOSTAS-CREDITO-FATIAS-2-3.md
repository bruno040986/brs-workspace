# Roteiro — Propostas de Crédito, Fatias 2 e 3 (para o Sonnet)

> Contexto no GRUPO.md ("APIs de Instituições Financeiras de Crédito") e na memória
> `apis-if-credito-fydigital`. A **Fatia 1 (migration `20260905102132_credito_propostas_fase1.sql`)
> JÁ está aplicada** no banco: tabelas `simulacoes_credito`, `propostas_credito`,
> `proposta_cartao_operacoes`, `proposta_contratos_origem`, `if_webhook_eventos`,
> `if_credito_config`, e as permissões `operacional-painel-operacoes` e
> `sistema-config-if-credito` semeadas do root.

## Regras de ouro (NÃO violar)
- **NADA de API externa nestas fatias.** Nenhuma chamada à FyDigital, OAuth, JWT RS256 ou
  decifra de webhook. Isso é a **Fatia 4 (Opus/Fable)**. Aqui só lê/grava NOSSAS tabelas.
- **Segredos:** cifrar SÓ na escrita com `cifrarTexto` de `src/lib/central-conversas/cofre.ts`;
  NUNCA retornar valor decifrado pra UI (campos write-only). Ao salvar em branco, manter o
  que já existe.
- **REGRA FIXA (4 pontos)** em toda tela/menu novo: (1) `SYSTEM_MODULES` em
  `usuarios/page.tsx`; (2) `src/lib/nav/divisoes.ts`; (3) `src/lib/auth/permissions.ts`
  (os DOIS mapas: `exactRouteRules` + `prefixRouteRules`); (4) seed — já feito na migration.
- Estilo: copiar o padrão de `src/app/(dashboard)/convenios/page.tsx` (cards, data-table,
  modal, badges, form-control) e, pro card de credencial, o da QuarkRH
  (`src/app/(dashboard)/rh/parceiros/config/provedores/quarkrh/page.tsx` +
  `src/lib/quark/config-actions.ts`).
- Fechar com `npm run build` verde e `npx tsc --noEmit` limpo antes de entregar.

---

## FATIA 2 — Config "APIs de Instituições Financeiras de Crédito"
Permissão `sistema-config-if-credito`. Card por IF, análogo aos Gateways de Pagamento.
Divisão **Configurações**.

**Actions** `src/lib/if-credito/config-actions.ts` (todas com `requirePermission('sistema-config-if-credito', ...)`):
- `listarInstituicoesConfig()` → `financial_institutions` (id, name, logo se houver) + flag
  se já tem `if_credito_config` e se está `ativo`.
- `lerConfigIF(instituicaoId)` → devolve campos NÃO-secretos (`ambiente`, `base_url`,
  `client_id`, `simulacao_ttl_horas`, `ativo`, `token_expira_em`) + flags `temClientSecret`,
  `temChavePrivada`, `temChavePublicaEmpresa`, `temChavePublicaApi` (booleans, nunca o valor).
- `salvarConfigIF(input)` → upsert em `if_credito_config` por `instituicao_financeira_id`.
  Cifrar com `cifrarTexto` SÓ quando o campo vier preenchido: `client_secret_enc`,
  `empresa_private_key_enc`, `empresa_public_key_enc`, `api_public_key_enc`. Campo em branco =
  manter o `_enc` atual. Validar `ambiente in ('producao','homologacao')` e
  `simulacao_ttl_horas` (1..168).

**Tela** (rota nova, ex. `/configuracoes/if-credito`): seletor de IF (dropdown das
`financial_institutions`) + formulário: Ambiente (prod/homolog), Base URL, Client ID,
Client Secret (write-only), 3 chaves RSA em `<textarea>` (Empresa Private/Public, API
Public — write-only, placeholder "•••• já configurado" quando `tem*`=true), TTL da simulação
(horas, default 24), Ativo. Texto de orientação explicando a integração em 2 linhas. **NÃO**
colocar botão "Testar conexão" ainda (depende do adaptador — Fatia 4); pode deixar um aviso
"Teste de conexão disponível após ativar a integração".

REGRA FIXA: menu em Configurações (`divisoes.ts`), rota nos 2 mapas de `permissions.ts`
(`view('sistema-config-if-credito')`), nó em `SYSTEM_MODULES` (parent = divisão
Configurações, id `sistema-config-if-credito`).

---

## FATIA 3 — Painel de Operações (esqueleto, só leitura)
Permissão `operacional-painel-operacoes`. Divisão **Operacional**. Visual = mockup aprovado
(4 telas: aba Novo, Cartão, Portabilidade, drawer de detalhe).

**Actions** `src/lib/if-credito/painel-actions.ts` (`requirePermission('operacional-painel-operacoes', ...)`):
- `listarPropostas({ forma_contrato_id?, status?, instituicao_id?, convenio_id?, busca? })` →
  `propostas_credito` com joins: `financial_institutions(name)`, `convenios(nome_reduzido)`,
  `formas_contrato(nome)`, e o convite Nuvidio (status). Retorna as linhas canônicas.
- `getProposta(id)` → detalhe: proposta + `proposta_cartao_operacoes` + `proposta_contratos_origem`
  + timeline de `if_webhook_eventos` (por `proposta_id` OU `request_id`, ordenado por
  `recebido_em`) + dados do `nuvidio_convites` vinculado.
- (Sem criar/simular/cancelar de verdade — isso chama a IF = Fatia 4. Botões podem existir
  desabilitados/"em breve".)

**Tela** (rota `/operacoes`): abas pelas `formas_contrato` ativas; tabela por aba conforme o
mockup; drawer de detalhe com a timeline. Realçar linhas `aguardando_liberacao_interna`.

**Mapa de status canônico → rótulo + cor** (bater com o mockup):
| status | rótulo | cor |
|---|---|---|
| simulando | Simulando | cinza |
| criada | Criada | azul |
| aguardando_assinatura | Aguardando assinatura | âmbar |
| aguardando_aprovacao | Aguardando aprovação | roxo |
| aguardando_liberacao_interna | Aguardando liberação interna | **laranja (destaque)** |
| pendente | Pendente | amarelo/alerta |
| aguardando_pagamento | Aguardando pagamento | azul-esverdeado |
| paga | Paga | verde |
| cancelada | Cancelada | cinza-escuro |
| erro | Erro | vermelho |

Nuvidio: `—` / Enviado / Aprovado (verde) / Reprovado (vermelho).

REGRA FIXA: menu em Operacional (`divisoes.ts`), rota nos 2 mapas de `permissions.ts`
(`view('operacional-painel-operacoes')`), nó em `SYSTEM_MODULES` (parent = divisão
Operacional, id `operacional-painel-operacoes`).

---

## O que NÃO fazer agora (Fatia 4 = Opus/Fable, depois das credenciais + respostas de terça)
Adaptador FyDigital: OAuth `client_credentials` (formdata) → Bearer 86400s (cache em
`if_credito_config.access_token_enc`/`token_expira_em`); assinatura JWT RS256 do payload com a
private da empresa; decifra da resposta/webhook com a `api_public_key`; endpoint webhook
`/api/if-credito/webhook` que grava no inbox `if_webhook_eventos` (fail-closed: só processa se
`assinatura_valida`), correlaciona por `request_id`↔`id_externo` (o 1º webhook é sempre
`identificador`), status FORWARD-ONLY; mapa de enums FyDigital→canônico; automação Nuvidio na
"paradinha" (`liberacao_automatica=false` → cria convite em departamento/fila Nuvidio SEPARADO).
