# Roteiro — Cadastro no Portal: identificação, código por e-mail e rascunho com link mágico

**Para: sessão de execução (Sonnet 5), uma worktree por repo.**
Escrito pelo Fable 5 em 23/09/2026. Plano aprovado pelo Bruno em 23/09/2026.

## O problema

O wizard do cadastro PJ (`brs-portal-parceiro`, `/cadastro/[tipo]/formulario`) vive só na
memória do navegador: fechou a aba, começa do zero. Também não sabemos quem está
preenchendo (pode não ser sócio nem testemunha), e o link de correção hoje vai para o
e-mail de comissão do master, não para quem de fato preenche.

## O que JÁ está feito (Fable, migration `20260923011931`)

- `public.corban_cadastro_funcoes` — catálogo das funções de quem preenche. Seed:
  `socio_administrador`, `funcionario`, `contador`, `outro` (este com `exige_descricao`).
  Tela de manutenção no Workspace: **Agente Corban › Cadastros Recebidos › Funções de Quem
  Preenche** (`/agente-corban/cadastros-recebidos/funcoes`, permissão
  `agente-corban-cadastros-recebidos`). O portal só lê, filtrando `is_active`, ordenando por
  `ordem, nome`.
- `public.corban_cadastro_rascunhos` — o rascunho (colunas comentadas na migration). RLS
  ligada e SEM policy: só service role. Código e token só em hash sha256.
- Dicionário do Agente Corban nos DOIS repos: grupo `preenchedor` com os campos
  `preenchedor.{nome,email,email_verificado_em,whatsapp,funcao_chave,funcao_nome,funcao_descricao}`.

## Regras fixas

- Worktree própria por repo; nunca commitar na main. Migrations só pelo `brs-workspace`
  (se precisar de coluna nova, pedir por recado — não criar migration no portal).
- Next.js 16: ler `node_modules/next/dist/docs/` antes de codar (params são Promise;
  `proxy.ts` no lugar de middleware).
- Segredos nunca no código. Token e código NUNCA em claro no banco, em log ou em evento.
- Toda comparação de hash com `timingSafeEqual`.

## Parte 1 — Portal (`brs-portal-parceiro`)

### 1.1 Helper de e-mail (Resend)

Criar `src/lib/cadastro/email.ts` copiando o `enviarEmailOnboarding` do Workspace
(`brs-workspace/src/lib/onboarding-comunicacao.ts`): lê `resend_config` (mesmo Supabase,
service role), `POST https://api.resend.com/emails`, remetente
`resend.from_email || 'onboarding@brspromotora.com.br'`. Templates em código claro (assunto +
HTML) para o Bruno ajustar: `codigoVerificacao(nome, codigo)` e `linkRetomada(nome, url)`.

### 1.2 Etapa 0 — "Identificação" (antes de Compliance)

Novo `StepId: 'identificacao'`, primeiro em `STEPS` do `CadastroWizard.tsx`. Campos no
`WizardState`: `preenchedor: { nome, email, whatsapp, funcao_chave, funcao_nome,
funcao_descricao }`, `email_verificado: boolean`, `rascunho_id: string | null`.

Tela (`_steps/StepIdentificacao.tsx`): nome, e-mail, WhatsApp (mask phone), função (select
alimentado por server action `listarFuncoesCadastro()` → `corban_cadastro_funcoes` ativas;
quando `exige_descricao`, mostra campo de texto obrigatório). Botão **Enviar código**:

1. `iniciarRascunho(portalType, preenchedor)` → cria o rascunho (`status='aguardando_email'`,
   `email = lower(trim)`), gera código de 6 dígitos (`crypto.randomInt(0, 1_000_000)` com
   zero à esquerda), grava `codigo_hash = sha256(codigo)`, `codigo_expira_em = now+10min`,
   `codigo_enviado_em = now`, `codigo_tentativas = 0`, envia o e-mail e devolve `rascunho_id`.
   Reenvio: só se `codigo_enviado_em` tiver mais de 60 s; o reenvio gera código novo.
2. Input do código + **Confirmar**: `confirmarCodigo(rascunho_id, codigo)` → confere hash
   (timingSafeEqual), expiração e `codigo_tentativas < 5` (incrementa a cada erro; na 5ª
   falha zera o código e exige reenvio). Sucesso: `email_verificado_em = now`,
   `status = 'em_preenchimento'`, gera o token do link mágico (ver 1.4) e envia o e-mail
   "guarde este link para continuar depois". Define o cookie de sessão (1.3). Devolve ok.

`stepIssues('identificacao')`: nome, e-mail válido, WhatsApp com 10+ dígitos, função
escolhida (e descrição quando exigida), `email_verificado === true`. O botão Avançar fica
desabilitado enquanto o e-mail não estiver verificado (mesmo padrão do bloqueio de CNAE em
`cnaeObrigatorioAusente`). Depois de verificado, e-mail e função ficam somente leitura
(trocar e-mail = novo rascunho).

### 1.3 Sessão do rascunho (cookie)

Cookie httpOnly `brs-cadastro-rascunho` = `<rascunho_id>.<expira>.<hmac>` assinado com
HMAC-SHA256 usando `SUPABASE_SERVICE_ROLE_KEY`, no padrão de
`brs-workspace/src/lib/onboarding-token.ts`. Validade 30 dias. Todo server action de
rascunho (`salvarRascunho`, `carregarRascunhoAtual`, `reenviarLink`, `submitCadastroPJ`)
valida o cookie e só opera no rascunho dele. Sem cookie válido → erro claro
("sessão expirada, use o link do e-mail").

### 1.4 Link mágico `/cadastro/continuar/[token]`

- Geração: `token = randomBytes(32).hex`; grava `token_hash = sha256(token)`,
  `token_expira_em = now+30d`. Rotaciona (novo token invalida o anterior) a cada envio.
- Botão **Continuar depois** no rodapé do wizard (a partir da etapa 1) e ação
  `reenviarLink()` → reenvia o e-mail com o link (cooldown 60 s).
- Rota pública (server component): busca por `token_hash`, checa `token_expira_em`,
  `expira_em` e `status in ('em_preenchimento')`; define o cookie de sessão; renova
  `ultimo_acesso_em` e `expira_em = now+30d`; renderiza o `CadastroWizard` com
  `initialState = estado` e `initialStep = etapa_atual`. Token inválido/expirado → página
  com aviso e link para começar de novo. Depois de usado o link continua válido até
  expirar (é retomada, não login único).

### 1.5 Autosave

`salvarRascunho(estado, etapa_atual)` chamado no `avancar()` do wizard (antes de trocar a
etapa) e no **Continuar depois**. Grava `estado` (WizardState inteiro; os uploads já
retornam URL pública, então persistem), `etapa_atual`, `cnpj` (dígitos, quando já
consultado), `ultimo_acesso_em = now`, `expira_em = now+30d`. Tamanho: o estado cabe em
jsonb sem problema; não salvar em cada tecla, só por etapa.

### 1.6 Envio final

Em `submitCadastroPJ`: (a) gravar `corbanData.preenchedor` a partir do estado (chaves do
dicionário); (b) ao final, `update corban_cadastro_rascunhos set status='enviado',
agente_parceiro_id=<id>, estado=null` (o dado passa a viver em `agentes_parceiros`);
(c) limpar o cookie. Reenvio de rascunho já enviado → recusar com mensagem.

## Parte 2 — Workspace (`brs-workspace`)

### 2.1 Aba "Em preenchimento" em Cadastros Recebidos

Na lista (`CadastrosRecebidosListClient.tsx`), nova aba ao lado da lista atual, só leitura:
nome, e-mail, WhatsApp (botão abre `wa.me`), função (`funcao_nome`), CNPJ (se houver),
etapa em que parou, último acesso, dias parado. Fonte: `corban_cadastro_rascunhos` com
`status = 'em_preenchimento'` e `expira_em > now()`, ordenado por `ultimo_acesso_em desc`.
Ação **Reenviar link**: gera token novo (mesma regra 1.4, hash) e envia pelo
`enviarEmailOnboarding`; registra `envio` no jsonb se quiser trilha (coluna não existe —
pedir por recado se for o caso; por ora, só reenviar).

Não criar `agentes_parceiros` nem `corban_onboarding_processos` a partir do rascunho.

### 2.2 Contato preferido para correção

Em `resolverContatoParceiro` (`src/lib/onboarding-comunicacao.ts`): se
`corban_data.preenchedor.email` existir, preferir nome/e-mail/WhatsApp do preenchedor;
senão, o comportamento atual.

### 2.3 Expiração

Rascunhos com `expira_em < now()` e `status = 'em_preenchimento'` viram `expirado`. Pode
ser feito na própria consulta da aba (update lazy) — sem cron novo (regra dos crons da
Vercel: não empilhar).

## Critérios de aceite

- Fechar a aba no meio do cadastro, abrir o link do e-mail e continuar da etapa em que
  parou, com uploads preservados.
- Código errado 5 vezes bloqueia até reenvio; reenvio antes de 60 s é recusado.
- Nada de token/código em claro no banco, log ou evento.
- Cadastro enviado aparece em Cadastros Recebidos como hoje, com o bloco "Quem preencheu"
  visível na tela do processo (dicionário já expõe o grupo).
- Aba "Em preenchimento" lista o rascunho, some após o envio e após 30 dias sem acesso.

## Ordem sugerida

1. Portal: helper Resend + etapa Identificação + código (sem rascunho ainda: dá pra validar o e-mail).
2. Portal: rascunho + cookie + autosave + rota do link.
3. Portal: envio final ligando o rascunho.
4. Workspace: aba "Em preenchimento" + reenviar link + contato preferido.
5. Teste ponta a ponta com o Bruno (usar os CNPJs de teste liberados em 23/09).
