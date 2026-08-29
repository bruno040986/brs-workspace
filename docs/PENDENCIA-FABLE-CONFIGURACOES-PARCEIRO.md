# Pendência para o Fable — Configurações do Parceiro no AlvoConsig (26/08/2026)

> **RESOLVIDO em 29/08/2026 (Fable 5).**
> 1. **Credenciais**: cifra na aplicação, AES-256-GCM, chave `CRM_CREDENTIALS_KEY`
>    (32 bytes base64) só na env do CRM na Vercel (produção + preview, já
>    configurada). Tabela `crm_parceiro_credenciais` (migration
>    `20260829150000_crm_campanhas_parceiro.sql`), SEM policy de leitura —
>    só service role. Código: `brs-alvoconsig/apps/web/src/lib/crm/cofre.ts`
>    (cifra/decifra), `credenciais.ts` (leitura, só servidor — de propósito
>    fora de arquivo 'use server'), `credenciais-actions.ts` (UI só recebe
>    rótulo/campos públicos/máscara). Entrada 100% pela tela, como o Bruno
>    exigiu. Sessão Baileys/Z-API do WhatsApp usará o mesmo cofre quando o
>    serviço existir.
> 2. **Railway/isolamento**: mantido o hub-and-spoke do GRUPO.md — sem
>    réplica em Railway. A fronteira continua sendo a camada de aplicação do
>    CRM (service role + filtro obrigatório por parceiro) e RLS nas tabelas
>    crm_*; um segundo banco só duplicaria dado e criaria dessincronia sem
>    tirar o service role do CRM.
> O texto abaixo é o levantamento original, mantido como histórico.

> Levantado durante a construção da tela de "Configurações" do master no
> AlvoConsig (Atendentes, Discadora Automática, IA de Voz/URA Reversa,
> WhatsApp não oficial). Envolve armazenamento de credencial de terceiro e
> possível separação de infraestrutura — por isso não foi decidido/implementado
> sem revisão, conforme a política de delegação do Bruno (arquitetura/
> segurança/credenciais ficam com o Fable).

## 1. Armazenamento de credenciais de terceiro

Precisa guardar, com origem sempre pelo formulário do parceiro (nunca env
manual): token/URL da discadora (PortCall, Dasstech — ver
`src/lib/discadora/` no brs-alvoconsig), credencial da IA de Voz/URA
Reversa (formato ainda não definido, provavelmente webhook/API key), e a
sessão de autenticação do WhatsApp não oficial (Baileys/Z-API) gerada após
o parceiro escanear o QR Code — essa sessão é tão sensível quanto uma senha:
quem a possui consegue enviar mensagem como aquele número.

**Proposta de default (não implementada, aguardando revisão):** coluna
cifrada no banco (ex.: `pgcrypto`/`pgsodium` no Supabase, ou cifra na
aplicação com chave em env do servidor — nunca no client), nunca texto
puro. O fluxo pro parceiro continua 100% pela tela; a cifra é transparente
para ele.

## 2. Isolamento de infraestrutura — proposta do Bruno vs. padrão já decidido no grupo

Bruno propôs (26/08/2026): ao gerar uma campanha de leads no Workspace,
replicar tudo que o parceiro precisa consultar (tabelas, coeficientes, base
de conhecimento) para um banco hospedado no Railway; o parceiro nunca
acessaria o Supabase principal diretamente, só o Railway; tabulações do
parceiro seriam salvas no Railway e o Supabase buscaria as atualizações de
lá. Objetivo: parceiro externo nunca ter caminho pro Supabase que também
guarda RH/financeiro/comissionamento.

**Avaliação preliminar (não é decisão, é insumo pro Fable):**
- A preocupação de fundo é legítima, e é mais concreta do que eu pensava:
  conferi `apps/web/src/lib/supabase/server.ts` no brs-alvoconsig e o
  `createAdminClient()` usa a mesma `NEXT_PUBLIC_SUPABASE_URL`/service role
  do Workspace, com o comentário explícito no código: *"o RLS dessas
  tabelas atende o workspace, não o parceiro"* — ou seja, hoje **não existe
  RLS protegendo o parceiro no banco**, todo o isolamento entre parceiros é
  feito na aplicação (`.eq('agente_parceiro_id', ...)` manual em cada
  query, ex. `getAtendentes`/`criarAtendente` em `lib/crm/actions.ts`), com
  uma service role key que enxerga literalmente todas as tabelas do projeto
  — incluindo RH, financeiro, comissionamento. Não é "podia dar um bug de
  RLS"; é "não há RLS nenhuma nesse caminho, só disciplina de código". Isso
  reforça bastante o argumento do Bruno por isolamento.
- O desenho de "replicar campanha inteira + sincronizar de volta" é bastante
  engenharia contínua (pipeline de replicação, resolução de conflito,
  latência entre gerar a campanha e ela aparecer pro parceiro, dois schemas
  pra manter alinhados).
- O grupo já tem um padrão decidido pra esse problema (GRUPO.md, decisão de
  19/08/2026 — hub-and-spoke): cada serviço satélite tem **seu próprio
  Supabase pequeno e descartável**, separado do Supabase do Workspace,
  consumido via API com token de serviço, sem replicar dado — busca sob
  demanda. Aplicar isso ao AlvoConsig seria dar a ele seu próprio Supabase
  (contatos, tabulações, credenciais de discadora/WhatsApp) e ele buscar
  coeficientes/tabelas/base de conhecimento do Workspace via API ao vivo.
  Isolamento parecido, bem menos superfície de manutenção que sincronização
  bidirecional com um cache no Railway.
- Railway, nesse caso, seria só onde rodaria o processo do Baileys (que
  precisa de um processo persistente — não roda em serverless/Vercel), não
  necessariamente onde o dado do CRM mora.

**Perguntas em aberto pro Fable decidir:**
1. AlvoConsig ganha Supabase próprio (padrão hub-and-spoke) ou mantém o
   compartilhado com RLS mais rígida?
2. Se ganhar Supabase próprio, qual a estratégia de leitura das
   tabelas/coeficientes/base de conhecimento do Workspace (API direta,
   cache com TTL, algo do meio)?
3. Onde roda o processo do Baileys (Railway, mesmo repo de algum
   orquestrador existente, ou serviço novo) e como ele conversa com o
   banco de credenciais sem expor a sessão em trânsito?
