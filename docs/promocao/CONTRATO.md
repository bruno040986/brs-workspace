# CONTRATO — Promoção "NuAzul – Você Sempre no Azul | Valparaíso de Goiás"

> Lei para as frentes paralelas (A–E, H + Site). Fonte das regras de negócio:
> `.claude/tmp/promocao-regras.md` (02/10/2026). Em conflito, vale ESTE arquivo
> para implementação; o que aqui está marcado **PERGUNTAR AO BRUNO** é a única
> coisa pendente. Tudo o mais está decidido — não reabrir.
>
> Convenções: dinheiro em **centavos (bigint)**; datas/horas em `timestamptz`
> (UTC no banco), regras de calendário em **America/Sao_Paulo**; CPF/telefone só
> dígitos (`cpf char(11)`, telefone E.164 sem `+`: `5561999990000`); enums como
> `text` + `check`; ids `uuid default gen_random_uuid()`; RLS ligada SEM policy
> (acesso só por service role, padrão `20260930140136_propostas_esteira_modelo.sql`).
> Next 16: rotas em `src/app/api/**/route.ts` com `export async function POST(request: NextRequest)`;
> gate de sessão em `src/proxy.ts` → `src/lib/supabase/middleware.ts` (`publicRoutes`).

---

## 1. REVISÃO CRÍTICA DAS REGRAS → DECISÕES

| # | Furo / risco | Decisão adotada |
|---|---|---|
| 1.1 | **Concorrência na geração de números** (2 cliques, 2 abas, retry de rede). | Geração dentro de UMA função SQL (`promocao_gerar_numeros`) com `pg_advisory_xact_lock(hashtext(campanha_id))` + `UNIQUE (campanha_id, numero)` + `geracao.usado_em is null` checado dentro da mesma transação. CSPRNG = `gen_random_bytes` (pgcrypto). Sem tabela de 100.000 pré-gerados (ver §2.12). |
| 1.2 | **Regra de data da indicação** (texto do regulamento em ajuste). | Parametrizada em `promocao_campanhas.regra_data_indicacao` ∈ `digitacao_apos_inscricao` (padrão) \| `pagamento_apos_inscricao` \| `sem_restricao`. Só afeta os direitos do INDICADOR (Pix e número); os números do próprio servidor contam todas as operações confirmadas. Servidor com inscrição DIRETA anterior nunca ganha indicador (bloqueio no cadastro da indicação, §1.7). |
| 1.3 | **Proporção de cartão com geração incremental**: faixa muda com o total e pode "desfazer" a proporção. | `numeros_devidos = max(numeros_emitidos, calculo_atual)`. Nunca revoga. Calculo_atual = 0 se proporção não bate. Saldo informado sempre (`total − floor(total/5000)*5000`), mais `cartao_faltante` (quanto falta sacar em cartão para destravar). |
| 1.4 | **Operação invalidada depois dos números emitidos.** | Operação → `invalidada` dispara recálculo; números cujo `geracao` ficou sem lastro (devido recalculado < emitido) são marcados `status='desconsiderado'` SOMENTE por ação manual do operador (botão "Desconsiderar números sem lastro", exige `can_edit`), nunca automático. Sorteio só considera `status='valido'`. |
| 1.5 | **Fuso.** | Toda comparação de período usa `America/Sao_Paulo`. Campanha: `inicio_em = 2026-10-01T00:00:00-03:00`, `fim_em = 2026-10-31T23:59:59.999-03:00`, `prazo_geracao_ate = 2026-11-10T23:59:59.999-03:00`. Operação válida: `data_digitacao` e `data_pagamento` (ambas `date`, já em data civil BR) dentro de `[2026-10-01, 2026-10-31]`. |
| 1.6 | **Dias úteis** (3 para link, 5 para Pix). São prazos da NuAzul, não gates do sistema. | O sistema calcula e EXIBE `prazo_limite` (feriados nacionais fixos + móveis de 2026/2027 em `src/lib/promocoes/dias-uteis.ts`); o disparo do link é imediato (job). Prazo vencido vira alerta vermelho na tela, não bloqueio. |
| 1.7 | **CPF duplicado.** | `UNIQUE (campanha_id, cpf)` em `promocao_inscricoes`. Cadastro direto de CPF já inscrito: se o telefone verificado por OTP == telefone da inscrição → responde 200 com o código existente (reenvio); senão → `409 CPF_JA_INSCRITO` (mensagem genérica, sem dados). Indicação de CPF já inscrito (por indicação OU direto) → `409 CPF_JA_INDICADO` com o texto do regras.md, sem revelar quem. Autoindicação (`cpf_indicador == cpf_indicado`) → `422 AUTOINDICACAO`. |
| 1.8 | **OTP** (sem captcha). | 6 dígitos `crypto.randomInt(0, 1_000_000)`; hash sha256 no banco; validade 10 min; 5 tentativas; limites: 3 envios/telefone/h, 10 envios/IP/h, cooldown 60 s por telefone; confirmação devolve `otpToken` (32 bytes base64url, hash no banco, 30 min, uso único) que o cadastro exige. `otp_obrigatorio=false` OU instância não `conectada` → cadastro aceito com `telefone_verificado=false` (nunca trava a venda). OTP é enviado INLINE na request (o cron de jobs roda a cada 5 min — inútil para OTP). |
| 1.9 | **Abuso do link de geração** (token vazado / força bruta). | Token 32 bytes aleatórios, só o `sha256` no banco, 1 token por geração, uso único (`usado_em`), expira em `prazo_geracao_ate`. Confirmação exige reconfirmar os 4 últimos dígitos do telefone cadastrado (`telefone_confirmacao`) — barata e corta link encaminhado. Rate limit 30 req/IP/10 min nas rotas `geracao/*`. 404 genérico para token inválido/expirado/usado (`LINK_INVALIDO`). |
| 1.10 | **Honeypot + bots.** | Campo `site` (texto) em todo POST público: preenchido → responde `200 {ok:true}` fake sem gravar. Rate limits em `promocao_limites` (§2.17). |
| 1.11 | **Idempotência do cadastro** (double submit). | `submissionId` (uuid gerado no browser) obrigatório em todo POST que cria; `UNIQUE` em `promocao_inscricoes.submission_id`, `promocao_indicacoes.submission_id`, `promocao_geracoes.submission_id`. Repetição → mesma resposta 200. |
| 1.12 | **Indicador se cadastra de novo com Pix diferente** (fraude de troca de Pix). | `promocao_indicadores` é 1 por (campanha, cpf). Nova indicação do mesmo CPF atualiza Pix/telefone e grava `promocao_eventos` (`indicador.pix_alterado`). Remessa mostra badge "Pix alterado em …" se mudou nos últimos 7 dias. OTP garante posse do telefone. |
| 1.13 | **Lead no WeSales ANTES do WhatsApp.** | Cadastro grava no banco, enfileira `promocoes.wesales_sync` E tenta a sincronização inline com timeout 8 s. Resposta traz `wesales: 'ok' \| 'pendente'`. Botão "Falar no WhatsApp" libera nos dois casos (falha tolerada: o atendente acha pelo código). |
| 1.14 | **Impedidos (§19).** | `promocao_cpfs_bloqueados` consultada em TODO cadastro (servidor, indicador, indicado) e na apuração do sorteio. Erro genérico `422 CPF_NAO_ELEGIVEL` ("Não foi possível concluir o cadastro com este CPF. Fale com a NuAzul."). |
| 1.15 | **Ganhador bloqueado / número desconsiderado no sorteio.** | Apuração pula números `desconsiderado`, inscrições `canceladas`, CPFs bloqueados. Resultado é `apurado` → humano valida → `validado`. |
| 1.16 | **Pix "Dados bancários"** exige banco/agência/conta; outras chaves exigem só a chave. | `check` no banco (§2.6). Tipo de chave: `cpf \| telefone \| email \| aleatoria \| dados_bancarios`. |
| 1.17 | **Mensagem de pagamento com CPF mascarado** no formato `X00.XXX.000-00`. | Lido como: 1º dígito oculto, dígitos 2–3 visíveis, bloco do meio oculto, bloco 7–9 visível, DV oculto. Implementação §3.7: `12345678901` → `*23.***.789-**`. |
| 1.18 | **Marca.** | Nenhum texto/URL público cita BRS. URLs nas mensagens: `https://nuazul.com.br/...` (config `site_base_url`). |
| 1.19 | **Multi-cidade.** | `promocao_campanhas` com `convenio_id`, `slug`, `cidade`, `uf`. Toda tabela filha carrega `campanha_id`. API pública recebe `campanha` (slug) no body/query. |

**PERGUNTAR AO BRUNO (bloqueia só a frente B/WeSales e textos):**
1. Nome do **funil e da etapa** no WeSales para as oportunidades da promoção (config `wesales_funil_nome`/`wesales_etapa_nome`). Até lá: cria/atualiza contato + tags + campos, SEM oportunidade.
2. **Número de WhatsApp da NuAzul** que aparece nas mensagens/comprovante (`telefone_contato`) — será o próprio número pareado na instância? (padrão adotado: sim, lido de `chat_instancias.numero` após parear).
3. **Versão/URL final do regulamento** (`regulamento_versao` default `2026-10-02`, `regulamento_url` default `https://nuazul.com.br/valparaiso-go/promocao#regulamento`).

Nada mais bloqueia.

---

## 2. MODELO DE DADOS (migration única, frente A)

Arquivo: `supabase/migrations/<date +%Y%m%d%H%M%S>_promocao_valparaiso.sql` (timestamp REAL na hora de criar). Extensão: `create extension if not exists pgcrypto;` (já existe no Supabase, idempotente).

### 2.1 `promocao_campanhas` (campanha + config)
```
id uuid pk
slug text not null unique                      -- 'valparaiso-go'
nome text not null                              -- 'NuAzul – Você Sempre no Azul | Valparaíso de Goiás'
convenio_id uuid null references convenios(id)
cidade text not null, uf char(2) not null
status text not null default 'rascunho' check (status in ('rascunho','ativa','encerrada_cadastro','encerrada'))
inicio_em timestamptz not null, fim_em timestamptz not null
prazo_geracao_ate timestamptz not null
data_sorteio date not null                      -- 2026-11-11
prefixo_codigo text not null default 'VPG'      -- código de inscrição VPG-100001
prefixo_indicacao text not null default 'IND'   -- número de indicação IND-100001
minimo_centavos bigint not null default 500000
passo_numeros_centavos bigint not null default 500000
numeros_por_passo int not null default 2
pix_indicador_centavos bigint not null default 5000
faixas_cartao jsonb not null default '[{"ate":1000000,"pct":50},{"ate":1500000,"pct":40},{"ate":2000000,"pct":30},{"ate":3000000,"pct":25},{"ate":null,"pct":20}]'
regra_data_indicacao text not null default 'digitacao_apos_inscricao' check (in ('digitacao_apos_inscricao','pagamento_apos_inscricao','sem_restricao'))
-- integrações
instancia_id uuid null references chat_instancias(id)
otp_obrigatorio boolean not null default true
telefone_contato text null                      -- dígitos; fallback chat_instancias.numero
site_base_url text not null default 'https://nuazul.com.br'
regulamento_url text not null, regulamento_versao text not null
wesales_funil_nome text null, wesales_etapa_nome text null
wesales_tags text[] not null default '{promo-valparaiso}'
pagador_cnpj text not null default '41356863000183'
pagador_nome text not null default 'Blue Pay Solutions Ltda'
pixel_meta_id text null, ga4_id text null, gads_id text null  -- expostos na config pública
created_at/updated_at timestamptz default now()
```
Seed na migration: 1 linha `valparaiso-go` com `status='rascunho'` (Bruno ativa pela tela), `convenio_id = (select id from convenios where lower(nome) like '%valpara%' limit 1)` (pode ficar null).

### 2.2 `promocao_indicadores`
```
id uuid pk, campanha_id uuid not null fk campanhas
cpf char(11) not null, nome text not null, telefone text not null, telefone_verificado boolean not null default false
data_nascimento date null
pix_tipo text not null check (in ('cpf','telefone','email','aleatoria','dados_bancarios'))
pix_chave text null, banco_codigo text null, banco_nome text null, agencia text null, conta text null
check ((pix_tipo='dados_bancarios' and banco_codigo is not null and agencia is not null and conta is not null) or (pix_tipo<>'dados_bancarios' and pix_chave is not null))
pix_atualizado_em timestamptz not null default now()
wesales_contact_id text null
created_at/updated_at
unique (campanha_id, cpf)
```

### 2.3 `promocao_inscricoes` (1 por CPF servidor por campanha; nasce por cadastro direto OU por indicação)
```
id uuid pk, campanha_id fk
codigo text not null unique                      -- 'VPG-100001' (sequence promocao_codigo_seq start 100001)
cpf char(11) not null, nome text not null, telefone text not null, telefone_verificado boolean default false
data_nascimento date null, email text null
origem text not null check (in ('direta','indicacao'))
indicacao_id uuid null                           -- fk adicionada depois (ciclo) → promocao_indicacoes(id)
status text not null default 'ativa' check (in ('ativa','cancelada'))
consent_promocao boolean not null, consent_contato_comercial boolean not null default false
wesales_contact_id text null, wesales_opportunity_id text null
wesales_status text not null default 'pendente' check (in ('pendente','ok','erro'))
wesales_erro text null, wesales_sync_em timestamptz null
submission_id uuid not null unique
created_at/updated_at
unique (campanha_id, cpf)
index (campanha_id, status), index (telefone)
```

### 2.4 `promocao_indicacoes`
```
id uuid pk, campanha_id fk
numero text not null unique                      -- 'IND-100001' (mesma sequence, prefixo diferente)
indicador_id uuid not null fk indicadores
inscricao_id uuid not null fk inscricoes         -- a inscrição do indicado (criada junto)
cpf_indicado char(11) not null
status text not null default 'valida' check (in ('valida','cancelada'))
inscrita_em timestamptz not null default now()   -- base da regra de data
comprovante_token_hash text null, comprovante_expira_em timestamptz null
submission_id uuid not null unique
created_at/updated_at
unique index promocao_indicacoes_cpf_valida_uq on (campanha_id, cpf_indicado) where status='valida'
-- autoindicação (cpf_indicador = cpf_indicado) é checada na app (§1.7); check SQL não subconsulta
```
+ `alter table promocao_inscricoes add constraint ... foreign key (indicacao_id) references promocao_indicacoes(id)`.

### 2.5 `promocao_operacoes` (digitação manual)
```
id uuid pk, campanha_id fk, inscricao_id uuid not null fk inscricoes
tipo text not null check (in ('novo','refinanciamento','portabilidade','saque_cartao_consignado','saque_cartao_beneficio','outro'))
conta_como_cartao boolean generated always as (tipo in ('saque_cartao_consignado','saque_cartao_beneficio')) stored
valor_liquido_centavos bigint not null check (> 0)
data_digitacao date not null, data_pagamento date null
instituicao_financeira_id uuid null references financial_institutions(id), instituicao_texto text null
numero_proposta text null
status text not null default 'informada' check (in ('informada','confirmada','invalidada'))
motivo_invalidacao text null
confirmada_em timestamptz null, confirmada_por uuid null references users(id)
invalidada_em timestamptz null, invalidada_por uuid null
observacao text null, created_by uuid null, created_at/updated_at
unique index on (campanha_id, instituicao_financeira_id, numero_proposta) where numero_proposta is not null and status<>'invalidada'
index (inscricao_id, status)
```

### 2.6 `promocao_direitos` (estado calculado, 1 por (inscricao, tipo))
```
id uuid pk, campanha_id fk, inscricao_id uuid not null fk   -- servidor cuja produção gera o direito
indicador_id uuid null fk indicadores                       -- preenchido nos tipos *_indicador
tipo text not null check (in ('numeros_servidor','numero_indicador','pix_indicador'))
qtd_devida int not null default 0, qtd_emitida int not null default 0
valor_centavos bigint not null default 0                    -- pix: 5000 quando devido
total_elegivel_centavos bigint not null default 0, total_cartao_centavos bigint not null default 0
saldo_centavos bigint not null default 0, cartao_faltante_centavos bigint not null default 0
proporcao_ok boolean not null default false
status text not null default 'sem_direito' check (in ('sem_direito','devido','em_remessa','pago','emitido_parcial','emitido'))
calculado_em timestamptz not null default now(), created_at/updated_at
unique (inscricao_id, tipo)
```
`status`: pix → `sem_direito|devido|em_remessa|pago`; números → `sem_direito|devido|emitido_parcial|emitido`.

### 2.7 `promocao_geracoes` (um link individual por lote incremental)
```
id uuid pk, campanha_id fk, direito_id uuid not null fk direitos
titular_tipo text not null check (in ('inscricao','indicador')), titular_id uuid not null
telefone text not null                                       -- destino do link
qtd int not null check (> 0)
token_hash text not null unique, expira_em timestamptz not null
status text not null default 'pendente' check (in ('pendente','enviado','usado','expirado','cancelado'))
enviado_em timestamptz null, usado_em timestamptz null, cancelado_em timestamptz null
snapshot jsonb not null default '{}'                         -- {operacoes:[{id,tipo,valor,data_pagamento}], total, usado_anterior, usado_nesta, saldo}
dados_confirmados jsonb null                                 -- o que o participante confirmou (nome, telefone, email)
ip text null, user_agent text null, submission_id uuid null unique
created_at/updated_at
unique index on (direito_id) where status in ('pendente','enviado')   -- só 1 link vivo por direito
```

### 2.8 `promocao_geracao_operacoes` (vínculo operação→geração)
```
geracao_id uuid fk geracoes, operacao_id uuid fk operacoes, valor_utilizado_centavos bigint not null
primary key (geracao_id, operacao_id)
```

### 2.9 `promocao_numeros`
```
id uuid pk, campanha_id fk, numero int not null check (numero between 0 and 99999)
geracao_id uuid not null fk geracoes, direito_id uuid not null fk, inscricao_id uuid not null fk
titular_tipo text not null check (in ('inscricao','indicador')), titular_id uuid not null
status text not null default 'valido' check (in ('valido','desconsiderado'))
desconsiderado_em timestamptz null, desconsiderado_por uuid null, motivo text null
created_at timestamptz default now()
unique (campanha_id, numero)
index (campanha_id, status), index (titular_tipo, titular_id)
```
Exibição: `lpad(numero::text, 5, '0')`.

### 2.10 `promocao_otps`
```
id uuid pk, campanha_id fk, telefone text not null, finalidade text not null check (in ('servidor','indicador','geracao'))
codigo_hash text not null, tentativas int not null default 0, max_tentativas int not null default 5
expira_em timestamptz not null, confirmado_em timestamptz null
otp_token_hash text null unique, otp_token_expira_em timestamptz null, otp_token_usado_em timestamptz null
envio_chave text null                                        -- fk lógica promocao_envios.chave
ip text null, created_at
index (telefone, created_at desc)
```

### 2.11 `promocao_cpfs_bloqueados`
```
id uuid pk, campanha_id uuid null fk (null = todas), cpf char(11) not null, nome text null, motivo text not null
criado_por uuid null references users(id), created_at
unique index on (coalesce(campanha_id,'00000000-0000-0000-0000-000000000000'::uuid), cpf)
```

### 2.12 Função `promocao_gerar_numeros(p_geracao_id uuid, p_token_hash text, p_dados jsonb, p_ip text, p_ua text) returns setof int`
plpgsql, `security invoker` (service role):
1. `select ... from promocao_geracoes g join promocao_campanhas c for update` — valida `g.token_hash = p_token_hash`, `g.status in ('pendente','enviado')`, `now() <= g.expira_em`; senão `raise exception 'LINK_INVALIDO'`.
2. `perform pg_advisory_xact_lock(hashtext(g.campanha_id::text));`
3. Loop até `inseridos = g.qtd` (máx 10.000 iterações → `raise 'SERIE_ESGOTADA'`): `n := (get_byte(b,0)<<24 | get_byte(b,1)<<16 | get_byte(b,2)<<8 | get_byte(b,3))::bigint % 100000` com `b := gen_random_bytes(4)`; `insert into promocao_numeros ... on conflict (campanha_id, numero) do nothing`; conta `found`.
4. `update promocao_geracoes set status='usado', usado_em=now(), dados_confirmados=p_dados, ip=p_ip, user_agent=p_ua`; `update promocao_direitos set qtd_emitida = qtd_emitida + g.qtd, status = case when qtd_emitida+g.qtd >= qtd_devida then 'emitido' else 'emitido_parcial' end`.
5. `return query select numero ... where geracao_id = p_geracao_id order by numero`.

**Por que atômico e não pré-gerado (3 linhas):** o UNIQUE já garante não-repetição e o advisory lock serializa por campanha; pgcrypto é CSPRNG (`random()` não é); com < 10 mil números distribuídos em 100 mil a rejeição por colisão é desprezível — 100 mil linhas pré-geradas só adicionariam uma tabela e um `SKIP LOCKED` para resolver um problema que o UNIQUE já resolve.

### 2.13 `promocao_envios` (idempotência WhatsApp)
```
id uuid pk, campanha_id fk, chave text not null unique            -- ex.: 'otp:<otp_id>', 'link:<geracao_id>', 'comprovante-ind:<indicacao_id>:<n>', 'comprovante-num:<geracao_id>:<n>', 'pagamento:<remessa_id>:<indicador_id>'
operation_id uuid not null default gen_random_uuid()              -- a chave de idempotência do engine
tipo text not null check (in ('otp','comprovante_indicacao','link_numeros_servidor','link_numeros_indicador','comprovante_numeros','aviso_pagamento'))
telefone text not null, texto text not null, tem_imagem boolean default false
status text not null default 'pendente' check (in ('pendente','enviado','incerto','rejeitado','falhou'))
tentativas int default 0, engine_message_id text null, erro text null
enviado_em timestamptz null, created_at/updated_at
index (status, created_at)
```

### 2.14 `promocao_remessas` + `promocao_remessa_itens`
```
promocao_remessas: id pk, campanha_id fk, data_referencia date not null, status text check (in ('gerada','exportada','enviada_pagamento')),
  total_centavos bigint, qtd_itens int, pagador_cnpj text, pagador_nome text,
  gerada_por uuid, gerada_em, exportada_por, exportada_em, enviada_por, enviada_em, created_at
  unique (campanha_id, data_referencia)
promocao_remessa_itens: id pk, remessa_id fk, direito_id uuid not null unique fk direitos, indicador_id fk, inscricao_id fk (indicado),
  valor_centavos bigint, indicado_nome text, indicado_cpf char(11),
  pix_tipo, pix_chave, banco_codigo, banco_nome, agencia, conta (snapshot no momento), created_at
```

### 2.15 `promocao_sorteios`
```
id pk, campanha_id fk unique, data_extracao date not null, numero_extraido char(5) not null, fonte text not null default 'Loteria Federal — 1º prêmio'
numero_contemplado int null, distancia int null, direcao text null check (in ('exato','superior','inferior'))
numero_id uuid null fk numeros, status text default 'apurado' check (in ('apurado','validado','anulado'))
apurado_por uuid, apurado_em, validado_por, validado_em, observacao text, created_at
```

### 2.16 `promocao_aceites` (LGPD) e `promocao_eventos` (auditoria)
```
promocao_aceites: id pk, campanha_id, sujeito_tipo text check (in ('inscricao','indicador','geracao')), sujeito_id uuid,
  finalidade text check (in ('promocao','contato_comercial','regulamento_geracao','relacao_legitima_indicado')), aceito boolean,
  versao_texto text, ip text, user_agent text, created_at
promocao_eventos: id pk, campanha_id, entidade text, entidade_id uuid, tipo text, dados jsonb default '{}', ator_user_id uuid null, created_at
  index (entidade, entidade_id)
```

### 2.17 `promocao_tracking` e `promocao_limites`
```
promocao_tracking: id pk, campanha_id, inscricao_id uuid null, indicacao_id uuid null, event_id text null, evento text not null ('lead_inicio'|'lead_conclusao'),
  utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, fbp, fbc, referrer, landing_url text, ip_hash text, user_agent text, created_at
promocao_limites: chave text primary key, janela_inicio timestamptz not null, contagem int not null
função promocao_limite_tentar(p_chave text, p_limite int, p_janela_seg int) returns boolean:
  upsert; se janela_inicio + janela < now() → zera; contagem++ ; return contagem <= p_limite
```

### 2.17b Blindagem (revisão Fable, entregue na migration)
- Funções `promocao_proximo_codigo()`, `promocao_limite_tentar`, `promocao_gerar_numeros`, `promocao_expurgar()` só para `service_role` (`revoke execute … from public, anon, authenticated`); sequence idem; `set search_path = public, extensions`; pgcrypto qualificado `extensions.gen_random_bytes`.
- Imutabilidade por trigger: `promocao_eventos` e `promocao_aceites` sem UPDATE/DELETE; `promocao_numeros` sem DELETE (desconsiderar = UPDATE de `status/motivo/desconsiderado_*`, liberado).
- `promocao_expurgar()` apaga `promocao_otps` > 7 dias e `promocao_limites` > 1 dia; cron será agendado depois (não criar agora).

### 2.18 RLS + seed de permissões
```
alter table <todas promocao_*> enable row level security;   -- sem policy
-- seed (padrão 20260924161555): para cada chave nova, INSERT a partir de quem tem sistema-usuarios-root em profile_permissions E user_permissions, on conflict do update
chaves: comercial-promocoes, comercial-promocoes-remessa, comercial-promocoes-bloqueados, comercial-promocoes-config
notify pgrst, 'reload schema';
```

---

## 3. LÓGICA PURA — `src/lib/promocoes/*.ts` (frente A; sem I/O, testável com vitest)

### 3.1 `tipos.ts`
```ts
export type TipoOperacao = 'novo'|'refinanciamento'|'portabilidade'|'saque_cartao_consignado'|'saque_cartao_beneficio'|'outro'
export type OperacaoConfirmada = { id: string; tipo: TipoOperacao; valorCentavos: number; dataDigitacao: string /*YYYY-MM-DD*/; dataPagamento: string | null }
export type FaixaCartao = { ate: number | null; pct: number }       // ate em centavos, inclusive
export type RegraDataIndicacao = 'digitacao_apos_inscricao'|'pagamento_apos_inscricao'|'sem_restricao'
export type ParametrosCampanha = { minimoCentavos: number; passoCentavos: number; numerosPorPasso: number; faixasCartao: FaixaCartao[]; pixIndicadorCentavos: number }
export const PARAMETROS_PADRAO: ParametrosCampanha  // 500000, 500000, 2, faixas do §2.1, 5000
export type Elegibilidade = {
  totalCentavos: number; cartaoCentavos: number; pct: number; proporcaoOk: boolean
  numerosCalculados: number; numerosDevidos: number; numerosAEmitir: number
  saldoCentavos: number; cartaoFaltanteCentavos: number; atingiuMinimo: boolean
}
```

### 3.2 `validacao.ts`
```ts
export function cpfValido(cpf: string): boolean            // 11 dígitos, rejeita repetidos, DV mod 11
export function somenteDigitos(v: string): string
export function telefoneBrValido(d: string): boolean       // 10 ou 11 dígitos com DDD 11–99; celular (11) exige 9 na 3ª posição
export function telefoneParaE164Digitos(d: string): string | null   // → '55' + DDD + número (sem '+'); aceita já com 55
export function maiorDe18(dataNascimento: string, hoje: string): boolean
export function nomeCompletoValido(nome: string): boolean  // ≥ 2 palavras, ≥ 5 chars, só letras/espaços/'-
export function pixValido(tipo: PixTipo, chave: string | null): boolean  // cpf→cpfValido; telefone→telefoneBrValido; email→regex simples; aleatoria→uuid v4 (36 chars); dados_bancarios→true (campos checados fora)
```

### 3.3 `elegibilidade.ts`
```ts
export function pctCartaoDaFaixa(totalCentavos: number, faixas: FaixaCartao[]): number
  // 1ª faixa com (ate === null || total <= ate); abaixo do mínimo retorna faixas[0].pct
export function calcularElegibilidade(ops: OperacaoConfirmada[], numerosEmitidos: number, p = PARAMETROS_PADRAO): Elegibilidade
  // total = Σ valor (ops confirmadas); cartao = Σ valor onde tipo ∈ saque_cartao_*
  // atingiuMinimo = total >= minimo
  // pct = pctCartaoDaFaixa(total); proporcaoOk = cartao*100 >= total*pct   (inteiros, sem float)
  // numerosCalculados = atingiuMinimo && proporcaoOk ? floor(total/passo)*numerosPorPasso : 0
  // numerosDevidos = max(numerosEmitidos, numerosCalculados)      // nunca revoga
  // numerosAEmitir = numerosDevidos - numerosEmitidos
  // saldo = total - floor(total/passo)*passo
  // cartaoFaltante = proporcaoOk ? 0 : ceil(total*pct/100) - cartao
export function operacoesConsideradasParaIndicador(ops: OperacaoConfirmada[], inscritaEmIso: string, regra: RegraDataIndicacao, fuso = 'America/Sao_Paulo'): OperacaoConfirmada[]
  // sem_restricao → todas; digitacao_apos_inscricao → dataDigitacao >= dataCivil(inscritaEm) ; pagamento_apos_inscricao → dataPagamento >= dataCivil(inscritaEm)
  // (comparação por DATA civil em SP; "posterior" lido como >= no mesmo dia — o cadastro na financeira não tem hora)
export function direitosDoIndicador(opsConsideradas: OperacaoConfirmada[], p = PARAMETROS_PADRAO): { pixDevido: boolean; numeroDevido: boolean; elegibilidade: Elegibilidade }
  // pixDevido = total >= minimo (ignora proporção); numeroDevido = total >= minimo && proporcaoOk ; qtd máx 1 cada
export function montarSnapshotGeracao(ops: OperacaoConfirmada[], usadoAnteriorCentavos: number, qtd: number, p = PARAMETROS_PADRAO): { operacoes: OperacaoConfirmada[]; totalCentavos: number; usadoAnteriorCentavos: number; usadoNestaCentavos: number; saldoCentavos: number; vinculos: Array<{ operacaoId: string; valorUtilizadoCentavos: number }> }
  // usadoNesta = (qtd / numerosPorPasso) * passo ; vinculos: consome ops em ordem de dataPagamento asc até cobrir usadoAnterior+usadoNesta (parcial na última)
```

### 3.4 `sorteio.ts`
```ts
export function apurarContemplado(numeroExtraido: number, validos: ReadonlySet<number>, serie = 100000): { numero: number; distancia: number; direcao: 'exato'|'superior'|'inferior' } | null
  // d=0: exato; para d=1..serie/2: testa (n+d)%serie (superior) ANTES de (n-d+serie)%serie (inferior); null se validos vazio
export function parseNumeroLoteria(texto: string): number | null   // aceita '12345', '12.345', '012345'→ últimos 5 dígitos
```

### 3.5 `dias-uteis.ts`
```ts
export const FERIADOS_NACIONAIS: Record<string, string[]> = {
  '2026': ['2026-01-01','2026-02-16','2026-02-17','2026-04-03','2026-04-21','2026-05-01','2026-06-04','2026-09-07','2026-10-12','2026-11-02','2026-11-15','2026-11-20','2026-12-25'],
  '2027': ['2027-01-01','2027-02-08','2027-02-09','2027-03-26','2027-04-21','2027-05-01','2027-05-27','2027-09-07','2027-10-12','2027-11-02','2027-11-15','2027-11-20','2027-12-25'],
}
export function ehDiaUtil(dataIso: string): boolean                       // seg–sex e não feriado
export function somarDiasUteis(dataIso: string, n: number): string         // YYYY-MM-DD
export function dataCivilSp(iso: string): string                           // Intl 'en-CA' timeZone America/Sao_Paulo
export function prazoLink(confirmadaEmIso: string): string                 // somarDiasUteis(dataCivilSp(x), 3)
export function prazoPix(confirmadaEmIso: string): string                  // somarDiasUteis(dataCivilSp(x), 5)
```

### 3.6 `codigos.ts`
```ts
export function formatarCodigo(prefixo: string, seq: number): string       // `${prefixo}-${seq}` → 'VPG-100001'
export function formatarNumeroSorte(n: number): string                     // lpad 5
export function gerarToken(): { token: string; hash: string }              // 32 bytes base64url + sha256 hex  (Node crypto — único arquivo com I/O de crypto, sem rede)
export function hashToken(token: string): string
export function gerarCodigoOtp(): string                                   // crypto.randomInt(0,1e6).padStart(6,'0')
export function hashOtp(codigo: string, otpId: string): string             // sha256(`${otpId}:${codigo}`)
```

### 3.7 `mascara.ts`
```ts
export function mascararCpf(cpf: string): string      // '12345678901' → '*23.***.789-**'  (visível: dígitos 2–3 e 7–9; segue o padrão X00.XXX.000-00 do regras.md)
// Também em mascara.ts (frente A entregou): formatarTelefone, formatarValor ('1.234,56'), formatarCnpj, nomeCurto ('Maria S.'), formatarDataBr; em dias-uteis.ts: ehFeriado; em mensagens.ts: urlWhatsapp(telefone, texto).
export function mascararTelefone(d: string): string   // '5561999990000' → '(61) *****-0000'
export function mascararPix(tipo: PixTipo, chave: string | null): string  // cpf→mascararCpf; telefone→mascararTelefone; email→'a***@dominio'; aleatoria→'****-...-' últimos 4; dados_bancarios→'conta ***' + últimos 2
export function formatarCpf(cpf: string): string       // 000.000.000-00
export function formatarReais(centavos: number): string // 'R$ 1.234,56'
```

### 3.8 `mensagens.ts` — catálogo (§6.3), funções puras `texto*(…)`.

Testes (`src/lib/promocoes/__tests__/*.test.ts`, **`node:test` + `node:assert/strict`** — é o runner do repo, `npm test` = `node --test --experimental-strip-types`; NÃO há vitest instalado; imports relativos com extensão `.ts`): elegibilidade (exemplo 7.500→2/saldo 2.500; +2.500→4), proporção limítrofe (10.000,00 → 50%; 10.000,01 → 40%), nunca revoga, regra de data (3 modos), sorteio circular (99999→00000, equidistante → superior), dias úteis atravessando 12/10 e 02/11, máscara, CPF.

---

## 4. API PÚBLICA (sem sessão) — `src/app/api/promocoes/publico/**` (frente B; `geracao/*` é da frente H)

- Adicionar `'/api/promocoes/publico'` em `publicRoutes` (`src/lib/supabase/middleware.ts`) — 1 linha, frente B.
- Site NuAzul expõe como `/api/promo/:path*` → rewrite para `https://<workspace>/api/promocoes/publico/:path*`. Sem CORS (mesma origem via rewrite). IP = `x-forwarded-for` (1º), `ip_hash = sha256(ip + PROMO_IP_SALT)` para tracking; IP cru só em `promocao_otps`/`promocao_geracoes` (retenção interna).
- Todas as respostas de erro: `{ error: { code: string; message: string } }` com HTTP indicado. Mensagens em pt-BR prontas para exibir.
- Todo POST: `{ campanha: 'valparaiso-go', submissionId?: uuid, site: '' /*honeypot*/, ...}`. `campanha` inexistente/`status<>'ativa'` → `404 CAMPANHA_INDISPONIVEL` (exceção: `geracao/*` funciona com `encerrada_cadastro` até `prazo_geracao_ate`).
- Rate limit (`promocao_limite_tentar`): chave `rl:<rota>:ip:<ip>` e `rl:<rota>:tel:<telefone>`; estourou → `429 LIMITE_EXCEDIDO`.

| # | Método/Path | Request | Response 200 | Erros |
|---|---|---|---|---|
| 4.1 | `GET /config?campanha=` | — | `{ nome, status, inicio, fim, prazoGeracaoAte, dataSorteio, otpObrigatorio, otpDisponivel /*instância conectada*/, telefoneContato, regulamentoUrl, regulamentoVersao, pixels:{meta,ga4,gads}, faixasCartao, minimoCentavos }` | 404 |
| 4.2 | `POST /otp/iniciar` | `{ campanha, telefone, finalidade:'servidor'\|'indicador', site }` | `{ otpId, expiraEm, reenvioEm }` — se OTP indisponível: `{ otpId:null, dispensado:true }` | 422 `TELEFONE_INVALIDO`; 429 (3/tel/h, 10/ip/h, cooldown 60 s → `AGUARDE_REENVIO` com `reenvioEm`) |
| 4.3 | `POST /otp/confirmar` | `{ campanha, otpId, codigo }` | `{ otpToken, telefone, expiraEm }` | 422 `CODIGO_INVALIDO` (`tentativasRestantes`), 410 `CODIGO_EXPIRADO`, 423 `CODIGO_BLOQUEADO` |
| 4.4 | `POST /inscricoes` (servidor direto) | `{ campanha, submissionId, otpToken?, nome, cpf, telefone, dataNascimento?, email?, consentPromocao:true, consentContatoComercial:boolean, regulamentoVersao, tracking?:{eventId,utm_source,…,referrer,landingUrl}, site }` | `{ inscricaoId, codigo:'VPG-100001', telefoneVerificado, wesales:'ok'\|'pendente', whatsappUrl:'https://wa.me/55…?text=…' }` (texto §6.3-M7) | 422 `DADOS_INVALIDOS` (`campos:[{campo,msg}]`), 422 `CPF_NAO_ELEGIVEL`, 409 `CPF_JA_INSCRITO`, 401 `OTP_OBRIGATORIO` (otpToken ausente/inválido/telefone ≠ e `otp_obrigatorio && otpDisponivel`), 409 `CONSENTIMENTO_OBRIGATORIO` |
| 4.5 | `POST /indicacoes` | `{ campanha, submissionId, otpToken?, indicador:{ nome, cpf, telefone, dataNascimento, pix:{ tipo, chave?, bancoCodigo?, bancoNome?, agencia?, conta? } }, indicado:{ nome, cpf, telefone, dataNascimento }, consentPromocao:true, declaraRelacaoLegitima:true, regulamentoVersao, tracking?, site }` | `{ indicacaoId, numeroIndicacao:'IND-100001', codigoInscricaoIndicado:'VPG-100002', comprovanteToken, comprovanteUrl:'/api/promo/comprovante?t=…', telefoneVerificado, wesales }` | 422 `DADOS_INVALIDOS`, 422 `AUTOINDICACAO`, 422 `MENOR_DE_IDADE`, 422 `CPF_NAO_ELEGIVEL`, **409 `CPF_JA_INDICADO`** (message = "Este servidor já foi indicado. Não é possível nova indicação e não será gerado número de indicação."), 401 `OTP_OBRIGATORIO`, 422 `PIX_INVALIDO` |
| 4.6 | `GET /comprovante?t=` | token da indicação (24 h) | `image/png` (1080×1350, next/og) | 404 `LINK_INVALIDO` |
| 4.7 | `POST /comprovante/enviar` | `{ campanha, t }` | `{ envio:'enviado'\|'incerto'\|'pendente' }` — inline; a 2ª chamada no mesmo token reaproveita a chave `comprovante-ind:<id>:<n>` só se `n` (contador em `promocao_eventos`) < 3 | 404, 429 (3/token) |
| 4.8 | `GET /geracao?t=` (H) | token do link | `{ titularTipo, nome, telefoneMascarado, email?, qtd, expiraEm, snapshot:{operacoes:[{tipo,valorCentavos,dataPagamento,instituicao}], totalCentavos, usadoAnteriorCentavos, usadoNestaCentavos, saldoCentavos}, numerosAnteriores:['01234',…], regulamentoUrl, regulamentoVersao, primeiraGeracao:boolean }` | 404 `LINK_INVALIDO` (inclui usado/expirado/cancelado), 410 `PRAZO_ENCERRADO` |
| 4.9 | `POST /geracao/confirmar` (H) | `{ campanha, t, submissionId, telefoneConfirmacao:'0000' /*4 últimos*/, dados:{ nome, telefone, email? }, aceiteRegulamento:true, regulamentoVersao, site }` | `{ numeros:['01234','98765'], totalNumeros, comprovanteToken }` — chama `promocao_gerar_numeros`; se `submissionId` repetido → mesma resposta | 404 `LINK_INVALIDO`, 422 `TELEFONE_NAO_CONFERE` (5 tentativas/token → 423), 409 `ACEITE_OBRIGATORIO`, 410 `PRAZO_ENCERRADO`, 500 `SERIE_ESGOTADA` |
| 4.10 | `POST /geracao/enviar-comprovante` (H) | `{ campanha, t }` | `{ envio }` (texto §6.3-M5) | 404, 429 (3/token) |
| 4.11 | `POST /inscricoes/reenviar-comprovante` | `{ campanha, otpToken, cpf }` — exige OTP do telefone da inscrição | `{ envio }` (texto M7 por WhatsApp) | 401, 404 `INSCRICAO_NAO_ENCONTRADA` |

Fluxo interno 4.4/4.5 (ordem fixa): honeypot → rate limit → validar → bloqueados → OTP (se exigido) → transação: `promocao_inscricoes` (+ `indicadores`/`indicacoes`) + `aceites` + `tracking` + `eventos` → `enqueueJob('promocoes.wesales_sync', dedupeKey:'promo-wesales:<inscricaoId>')` → tentativa inline do sync (8 s) → resposta. Nunca envia WhatsApp ao indicado (receptivo).

---

## 5. ÁREA INTERNA DO WORKSPACE (frente C; remessa = D; instância = E)

Rotas (`src/app/(dashboard)/promocoes/...`):
```
/promocoes                                   lista de campanhas (cards) — redireciona p/ única ativa
/promocoes/[slug]                            painel: KPIs (inscritos, indicações, operações confirmadas, números emitidos, pix devidos) + fila "links a enviar" com prazo
/promocoes/[slug]/inscritos                  tabela: código, nome, CPF fmt, telefone, origem, indicador, verificado, wesales_status (+ botão "Resync"), total elegível, números, saldo
/promocoes/[slug]/indicacoes                 numero, indicador, indicado, inscrita_em, status pix/número do indicador, botão "Vincular manualmente" (muda inscricao.indicacao_id → só se inscrição sem indicação e regra de data permitir; grava evento)
/promocoes/[slug]/operacoes                  CRUD manual + Confirmar/Invalidar; ao confirmar: recalcula direitos (inscrição + indicador) e cria geração/link + job; drawer "Elegibilidade do CPF" (Elegibilidade §3.3 completa)
/promocoes/[slug]/numeros                    número, titular, tipo, geração, data, status; ação "Desconsiderar" (motivo); export CSV
/promocoes/[slug]/remessa                    (D) dia: direitos pix 'devido' → Gerar remessa → Exportar Excel → Marcar enviada p/ pagamento
/promocoes/[slug]/bloqueados                 CRUD CPFs bloqueados
/promocoes/[slug]/config                     campos do §2.1 + (E) card da instância: criar/QR/status/desconectar + botão "Enviar teste para meu número"
/promocoes/[slug]/sorteio                    informar número extraído → Apurar (preview: contemplado, distância, direção, titular) → Validar / Anular
```
Server actions: `src/lib/promocoes/actions.ts` (C), `remessa-actions.ts` (D), `instancia-actions.ts` (E), `sorteio-actions.ts` (C). Todas `requirePermission(<chave>, <ação>)`. Recalcular direitos = `src/lib/promocoes/direitos-service.ts` (C, com I/O, chama §3.3) — `recalcularDireitos(inscricaoId)`: lê ops confirmadas → atualiza 3 direitos → se `numerosAEmitir > 0` e não há geração viva → cancela pendentes antigas, cria `promocao_geracoes` (token §3.6, `expira_em = prazo_geracao_ate`, snapshot §3.3) + `enqueueJob('promocoes.enviar_link_numeros', dedupeKey:'promo-link:<geracaoId>')`; idem para `numero_indicador`; `pix_indicador` → `status='devido'`.

**Os 4 pontos de permissão (mesma entrega, frente C):**
1. `src/app/(dashboard)/usuarios/page.tsx` → `SYSTEM_MODULES`, após `alvoconsig-*`:
```ts
{ id: 'comercial-promocoes', name: 'Promoções', parentId: 'cat-div-comercial', level: 1 },
{ id: 'comercial-promocoes-remessa', name: 'Promoções › Remessa de Pagamento (Pix)', parentId: 'comercial-promocoes', level: 2 },
{ id: 'comercial-promocoes-bloqueados', name: 'Promoções › CPFs Bloqueados', parentId: 'comercial-promocoes', level: 2 },
{ id: 'comercial-promocoes-config', name: 'Promoções › Configuração e WhatsApp', parentId: 'comercial-promocoes', level: 2 },
```
2. `src/lib/nav/divisoes.ts` (divisão `comercial`, após "CRM Vende.Ai CLT"):
```ts
{ label: 'Promoções', href: '/promocoes', perms: [view('comercial-promocoes'), view('comercial-promocoes-remessa'), view('comercial-promocoes-bloqueados'), view('comercial-promocoes-config')],
  children: [
    { label: 'Painel', href: '/promocoes/valparaiso-go', exact: true, perms: [view('comercial-promocoes')], desc: 'Inscrições, indicações, operações e números da promoção.', icon: Gift },
    { label: 'Inscritos', href: '/promocoes/valparaiso-go/inscritos', perms: [view('comercial-promocoes')] },
    { label: 'Indicações', href: '/promocoes/valparaiso-go/indicacoes', perms: [view('comercial-promocoes')] },
    { label: 'Operações', href: '/promocoes/valparaiso-go/operacoes', perms: [view('comercial-promocoes')] },
    { label: 'Números da Sorte', href: '/promocoes/valparaiso-go/numeros', perms: [view('comercial-promocoes')] },
    { label: 'Sorteio', href: '/promocoes/valparaiso-go/sorteio', perms: [view('comercial-promocoes')] },
    { label: 'Remessa de Pagamento', href: '/promocoes/valparaiso-go/remessa', perms: [view('comercial-promocoes-remessa')] },
    { label: 'CPFs Bloqueados', href: '/promocoes/valparaiso-go/bloqueados', perms: [view('comercial-promocoes-bloqueados')] },
    { label: 'Configuração', href: '/promocoes/valparaiso-go/config', perms: [view('comercial-promocoes-config')] },
  ] }
```
3. `src/lib/auth/permissions.ts`: `exactRouteRules['/promocoes'] = any([view das 4])`; `prefixRouteRules.push(['/promocoes', any([view das 4])])`, `['/api/promocoes/interno', any([view('comercial-promocoes')])]`. Como o slug é dinâmico, a página de cada subtela chama `requirePermission` da sua chave (remessa/bloqueados/config); as demais `comercial-promocoes`. Ações: criar/confirmar operação = `can_include`/`can_edit` de `comercial-promocoes`; desconsiderar número e validar sorteio = `can_edit`; marcar remessa enviada = `can_edit` de `-remessa`.
4. Seed na migration (§2.18).

Rotas de API internas (sessão): `GET /api/promocoes/interno/[slug]/remessas/[id]/excel` (D, xlsx já no repo), `GET /api/promocoes/interno/[slug]/numeros.csv` (C), `GET /api/promocoes/interno/[slug]/instancia/qr` (E, devolve `ultimo_qr`).

---

## 6. JOBS E MENSAGENS

### 6.1 Jobs em `process_jobs` (handlers em `src/lib/promocoes/jobs.ts`, frente B; registro = 1 linha por kind em `registerBuiltinHandlers`, `src/lib/scp-engine/handlers.ts`)
| kind | payload | dedupe_key | maxAttempts | o que faz |
|---|---|---|---|---|
| `promocoes.wesales_sync` | `{ inscricaoId }` | `promo-wesales:<inscricaoId>` (resync manual: `…:<inscricaoId>:<epoch>`) | 8 | §7 |
| `promocoes.enviar_link_numeros` | `{ geracaoId }` | `promo-link:<geracaoId>` | 8 | monta token (já criado) → URL `${site_base_url}/valparaiso-go/promocao/numeros?t=<token>`; texto M3/M4; `enviarWhatsappPromocao` chave `link:<geracaoId>`; status geração → `enviado` |
| `promocoes.enviar_comprovante` | `{ tipo:'indicacao'\|'numeros', id, n }` | `promo-comp:<tipo>:<id>:<n>` | 5 | fallback quando o envio inline deu `incerto`/timeout; MESMA chave de envio do inline |
| `promocoes.aviso_pagamento` | `{ remessaId, indicadorId }` | `promo-pag:<remessaId>:<indicadorId>` | 8 | agrupa itens do indicador na remessa, texto M6, chave `pagamento:<remessaId>:<indicadorId>` |
| `promocoes.recalcular_direitos` | `{ inscricaoId }` | `promo-recalc:<inscricaoId>:<epoch_min>` | 3 | safety net; mesma função do §5 |

Token do link em claro: NÃO fica no banco. `enviar_link_numeros` precisa dele → gerar token no momento do envio: a geração nasce com `token_hash=null`?? NÃO — decisão: `recalcularDireitos` gera token+hash, grava o hash e enfileira o job com `payload.token` (o `process_jobs.payload` é interno, service role, aceitável; o job apaga `payload.token` ao concluir: `update process_jobs set payload = payload - 'token'`).

Backoff: já é do motor (`planFailureOutcome`); não mexer. Envio `incerto` NÃO é falha do job: handler marca `promocao_envios.status='incerto'`, grava `erro`, e lança para o motor reagendar — na próxima tentativa reutiliza `operation_id` (engine dedupe). `rejeitado` com código `numero_sem_whatsapp` → `status='rejeitado'`, job concluído (não retenta), evento registrado para a tela.

### 6.2 Função fina nova (frente E) — `src/lib/promocoes/whatsapp.ts`
```ts
export type EnvioPromocao = { campanhaId: string; chave: string; tipo: TipoEnvioPromocao; telefone: string; texto: string; imagemBase64?: string }
export async function enviarWhatsappPromocao(e: EnvioPromocao): Promise<ResultadoEnvio>   // ResultadoEnvio de src/lib/central-conversas/envio-intencao.ts
// 1. upsert promocao_envios por `chave` (insert on conflict do nothing; select) → operation_id, status
// 2. se status='enviado' → return {resultado:'confirmado'} (idempotente)
// 3. instanciaId = campanha.instancia_id; status da instância ≠ 'conectada' → return {resultado:'rejeitado', mensagem:'INSTANCIA_OFFLINE'} (sem gastar tentativa de engine)
// 4. engine.enviar(instanciaId, telefone, texto, { operationId: operation_id, imagemBase64 })   // src/lib/central-conversas/engine.ts
// 5. ok → update status='enviado', engine_message_id, enviado_em; EngineErro → 'rejeitado'+erro; EngineEnvioIncertoError → 'incerto'+erro (NUNCA novo operation_id)
export async function instanciaPromocaoDisponivel(campanhaId: string): Promise<boolean>   // chat_instancias.status === 'conectada'
```
Instância: reutiliza `criarInstanciaBrs({ nome:'NuAzul Promoção', provedor:'baileys' })` + `conectarInstancia`/`statusInstancia`/`desconectarInstancia` de `src/lib/central-conversas/actions.ts`; grava o id em `promocao_campanhas.instancia_id`. Sem coluna nova em `chat_instancias`. Se bater `LIMITE_INSTANCIAS_BRS`, aumentar a constante em +1 (única alteração permitida fora da pasta).

### 6.3 Catálogo de mensagens (`src/lib/promocoes/mensagens.ts`) — texto FINAL
Variáveis entre `{}`. `{contato}` = telefone_contato formatado `(61) 9xxxx-xxxx`.

**M1 — OTP** (`textoOtp(codigo)`)
```
NuAzul: seu código de confirmação é {codigo}. Ele vale por 10 minutos. Se você não pediu este código, ignore esta mensagem.
```

**M2 — Comprovante da indicação (legenda da imagem)** (`textoComprovanteIndicacao({indicador, indicado, numeroIndicacao, codigoInscricao, contato})`)
```
Indicação registrada! ✅
Promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás

Indicador: {indicador}
Indicado: {indicado}
Número de indicação: {numeroIndicacao}

Repasse ao servidor indicado: ele deve falar com a NuAzul pelo WhatsApp {contato} e informar o número de indicação {numeroIndicacao} logo no início do atendimento. Vale a primeira indicação registrada para cada servidor.

Quando o indicado concluir R$ 5.000 em crédito pago no período, você recebe R$ 50 por Pix e, cumprida a regra de cartão, um número da sorte. Regulamento: {regulamentoUrl}
```

**M3 — Link de números ao servidor** (`textoLinkServidor({nome, qtd, url, prazo})`)
```
Olá, {nome}! Suas operações na promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás foram confirmadas e você tem {qtd} número(s) da sorte para gerar.

Acesse o seu link individual, confira seus dados e as operações consideradas, aceite o regulamento e gere seus números:
{url}

O link é pessoal e pode ser usado uma única vez, até {prazo}. Sorteio pela Loteria Federal de 11/11/2026. Dúvidas: {contato}
```

**M4 — Link de número ao indicador** (`textoLinkIndicador({nome, indicado, url, prazo})`)
```
Olá, {nome}! O servidor que você indicou ({indicado}) cumpriu as regras da promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás e você ganhou 1 número da sorte.

Gere o seu número pelo link individual (uso único, até {prazo}):
{url}

Sorteio pela Loteria Federal de 11/11/2026. Dúvidas: {contato}
```
(`{indicado}` = primeiro nome + inicial do sobrenome, ex.: "Maria S.")

**M5 — Comprovante de números** (`textoComprovanteNumeros({nome, numeros, total})`)
```
{nome}, seus números da sorte na promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás:
{numeros}            ← um por linha, formato 01234

Total de números até agora: {total}. Guarde esta mensagem.
Sorteio: 1º prêmio da Loteria Federal de 11/11/2026. Se o número sorteado não tiver sido distribuído, vale a aproximação prevista no regulamento. A NuAzul entrará em contato com o ganhador pelos dados informados. Regulamento: {regulamentoUrl}
```

**M6 — Aviso de pagamento (texto EXATO do regras.md)** (`textoAvisoPagamento({valor, itens:[{nome, cpfMascarado}], pixChave, pagadorCnpjFmt, pagadorNome})`)
```
Pela sua indicação na promoção NuAzul - Você sempre no azul | Valparaíso de Goiás, hoje estamos realizando o pagamento de R$ {valor} referente as indicações abaixo. Obrigado!
{nome} - CPF {cpfMascarado}          ← uma linha por indicado

Para sua conferência o valor será pago pelo CNPJ 41.356.863/0001-83 em nome de Blue Pay Solutions Ltda até as 20:00h de hoje no pix cadastrado:
Chave Pix: {pixChave}
```
`{valor}` = `1.234,56` (sem "R$" duplicado); `{pixChave}` = chave em claro (é a mensagem do próprio dono); `dados_bancarios` → `Chave Pix: Dados bancários — {bancoNome} ag. {agencia} c/c {conta}`.

**M7 — Texto pré-preenchido do botão "Falar no WhatsApp" (wa.me)** (`textoAberturaAtendimento({codigo, numeroIndicacao?})`)
```
Olá! Quero participar da promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás. Meu código de inscrição é {codigo}.            (+ " Número de indicação: {numeroIndicacao}." quando houver)
```

Imagem do comprovante da indicação (frente B, `src/lib/promocoes/comprovante-imagem.tsx`, `ImageResponse` de `next/og`, modelo: `brs-alvoconsig-ycloud/apps/web/src/lib/crm/oferta-imagem.tsx`): 1080×1350, azul NuAzul, blocos: título da promoção, "Indicação registrada", número de indicação em destaque, indicado (nome + CPF mascarado), indicador (nome), instruções (3 linhas), WhatsApp NuAzul, rodapé "iPhone 17e 256 GB · Loteria Federal 11/11/2026 · Regulamento em nuazul.com.br". Sem logo BRS. Mesma função serve o comprovante de números (variante `numeros`).

---

## 7. WESALES (frente B, `src/lib/promocoes/wesales-sync.ts`, reutiliza `src/lib/wesales/client.ts`)

| Dado | Chave WeSales (contact custom field) | Valor |
|---|---|---|
| código de inscrição | `promocao__codigo_de_inscricao` | `VPG-100001` |
| número de indicação | `promocao__n_de_indicacao` | `IND-100001` (vazio no direto) |
| nome do indicador | `promocao__nome_do_indicador` | nome completo (vazio no direto) |
| CPF | `WESALES_FIELD_KEYS.cpf` (`cpf`) | 11 dígitos |
| convênio | `WESALES_FIELD_KEYS.convenioCodigo` / `nomeConvenio` | de `convenios` se `campanha.convenio_id` |
Tags: `promo-valparaiso` + `promo-direto` \| `promo-indicado`. **O código NUNCA cria campo**: usar `resolveCustomField(key)`; ausente → `wesales_status='erro'`, `wesales_erro='campo X não existe no WeSales'` (não `ensureCustomField`).

Fluxo `sincronizarInscricaoWesales(inscricaoId)`:
1. `findContactByCpf(cpf)` → existe: `updateContact(id, { customFields, dateOfBirth? })` + `addContactTags(id, tags)` (não altera nome/telefone); não existe: `createContact({ firstName, lastName, phone:'+55…', email, dateOfBirth, tags, source:'Promoção NuAzul Valparaíso', customFields })`; `duplicateOfId` (telefone de outro) → usa esse id, tags+campos, grava evento `wesales.duplicado_por_telefone`.
2. Se `wesales_funil_nome`/`wesales_etapa_nome` configurados: `resolvePipelineStage` → `findOpportunitiesByContact(contactId, pipelineId)` vazio → `createOpportunity({ contactId, pipelineId, pipelineStageId, name:'Promoção Valparaíso — {codigo}' })`.
3. Grava `wesales_contact_id`, `wesales_opportunity_id`, `wesales_status='ok'`, `wesales_sync_em`. Falha → `'erro'` + mensagem (job retenta).
Idempotente (buscar sempre antes de criar). Indicador NÃO vai para o WeSales agora.

---

## 8. DIVISÃO DO TRABALHO (sem sobreposição de arquivos)

| Frente | Dono de | Depende de | Mock enquanto a migration não existe |
|---|---|---|---|
| **A** (migration + regras puras) | `supabase/migrations/<ts>_promocao_valparaiso.sql`; `src/lib/promocoes/{tipos,validacao,elegibilidade,sorteio,dias-uteis,codigos,mascara,mensagens}.ts`; `src/lib/promocoes/__tests__/*` | nada | — (entrega `tipos.ts` + SQL na 1ª hora; é o desbloqueio de todos) |
| **B** (API pública + jobs + WeSales + imagem) | `src/app/api/promocoes/publico/{config,otp,inscricoes,indicacoes,comprovante}/**`; `src/lib/promocoes/{otp,wesales-sync,comprovante-imagem,jobs,rate-limit,http}.ts`; 1 linha em `middleware.ts` (`publicRoutes`); linhas de `registerHandler` em `scp-engine/handlers.ts` | A (tipos, SQL), E (`whatsapp.ts`) | `whatsapp.ts` stub local `enviarWhatsappPromocao = async () => ({resultado:'confirmado', conversationId:null})` até E entregar; tabelas: escrever contra os nomes do §2 (Supabase tipado como `any` igual ao resto do repo) |
| **C** (telas internas) | `src/app/(dashboard)/promocoes/**` exceto `remessa/` e o card da instância em `config/`; `src/lib/promocoes/{actions,direitos-service,sorteio-actions}.ts`; `src/app/api/promocoes/interno/[slug]/numeros.csv/route.ts`; os 3 pontos de permissão em código (`usuarios/page.tsx`, `divisoes.ts`, `permissions.ts`) | A | dados fake em memória só no dev; telas lêem tabelas do §2 |
| **D** (remessa Pix) | `src/app/(dashboard)/promocoes/[slug]/remessa/**`; `src/lib/promocoes/remessa-actions.ts`; `src/app/api/promocoes/interno/[slug]/remessas/**` (Excel via `xlsx`); handler `promocoes.aviso_pagamento` dentro de `src/lib/promocoes/jobs-remessa.ts` (B registra 1 linha) | A, E | idem C |
| **E** (instância dedicada) | `src/lib/promocoes/{whatsapp,instancia-actions}.ts`; componente `src/app/(dashboard)/promocoes/[slug]/config/InstanciaCard.tsx` (C importa); `src/app/api/promocoes/interno/[slug]/instancia/**` | A (`promocao_envios`, `campanhas.instancia_id`) | pode testar `engine.enviar` contra instância criada pela tela existente de Canais |
| **H** (link de geração) | `src/app/api/promocoes/publico/geracao/**`; página Astro `/valparaiso-go/promocao/numeros` no repo do site | A (`promocao_gerar_numeros`), E (envio do comprovante), B (`http.ts` helpers de erro/rate-limit — H copia a assinatura se B atrasar) | stub do RPC devolvendo `qtd` números fixos |
| **Site NuAzul** (Astro) | `vercel.json` rewrite `/api/promo/:path*`; `/valparaiso-go`, `/valparaiso-go/promocao`, `/valparaiso-go/promocao/numeros`; categoria "Consignado Municipal"; pixels atrás do aceite de cookies, `event_id` por `crypto.randomUUID()` | contratos §4 | mock JSON dos responses do §4 |

Excel da remessa (D): colunas exatas `CPF | Nome Completo | Valor | Banco | Agência | Conta corrente | Pix | Tipo de chave`; `Tipo de chave` ∈ `CPF, Telefone, E-mail, Aleatória, Dados Bancários`; Banco/Agência/Conta só em `dados_bancarios`, `Pix` só nos demais. Estados: `gerada → exportada → enviada_pagamento`; ao marcar `enviada_pagamento`: direitos → `pago`, 1 job `promocoes.aviso_pagamento` por indicador da remessa.

**Ordem de dependência:** A(tipos+SQL, 1 h) → E(`whatsapp.ts`, 2 h) ∥ B ∥ C ∥ D ∥ H ∥ Site → merge na `promocao/valparaiso` → Fable revisa migration → Bruno `db push` → smoke test ponta a ponta (cadastro direto, indicação, operação confirmada → link → números → remessa → aviso) → merge main → deploy Workspace ANTES do site.

Variáveis de ambiente novas: `PROMO_IP_SALT` (Workspace). Site: `PUBLIC_PROMO_API_BASE` só no `vercel.json` (destination).

Fora de escopo agora (anotado, não fazer): CAPI Meta server-side, página pública de ganhadores, GO337 no CRM AlvoConsig, Portal do Titular específico da promoção (usa o existente do site), WhatsApp ativo ao indicado.
