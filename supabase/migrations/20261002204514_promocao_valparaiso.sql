-- Promoção "NuAzul – Você Sempre no Azul | Valparaíso de Goiás" — modelo completo.
-- Fonte: docs/promocao/CONTRATO.md §2 (02/10/2026). Dinheiro em centavos (bigint);
-- timestamptz no banco; CPF char(11); telefone só dígitos (55DDDN...). RLS ligada
-- SEM policy em todas as tabelas (acesso só por service role). Idempotente.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0) Sequence dos códigos (inscrição VPG-100001 / indicação IND-100001)
-- ---------------------------------------------------------------------------
create sequence if not exists public.promocao_codigo_seq start with 100001;

-- ---------------------------------------------------------------------------
-- 1) promocao_campanhas — campanha + config (§2.1)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_campanhas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  convenio_id uuid null references public.convenios (id),
  cidade text not null,
  uf char(2) not null,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'ativa', 'encerrada_cadastro', 'encerrada')),
  inicio_em timestamptz not null,
  fim_em timestamptz not null,
  prazo_geracao_ate timestamptz not null,
  data_sorteio date not null,
  prefixo_codigo text not null default 'VPG',
  prefixo_indicacao text not null default 'IND',
  minimo_centavos bigint not null default 500000,
  passo_numeros_centavos bigint not null default 500000,
  numeros_por_passo integer not null default 2,
  pix_indicador_centavos bigint not null default 5000,
  faixas_cartao jsonb not null default '[{"ate":1000000,"pct":50},{"ate":1500000,"pct":40},{"ate":2000000,"pct":30},{"ate":3000000,"pct":25},{"ate":null,"pct":20}]'::jsonb,
  regra_data_indicacao text not null default 'digitacao_apos_inscricao'
    check (regra_data_indicacao in ('digitacao_apos_inscricao', 'pagamento_apos_inscricao', 'sem_restricao')),
  -- integrações
  instancia_id uuid null references public.chat_instancias (id),
  otp_obrigatorio boolean not null default true,
  telefone_contato text null,
  site_base_url text not null default 'https://nuazul.com.br',
  regulamento_url text not null default 'https://nuazul.com.br/valparaiso-go/promocao#regulamento',
  regulamento_versao text not null default '2026-10-02',
  wesales_funil_nome text null,
  wesales_etapa_nome text null,
  wesales_tags text[] not null default '{promo-valparaiso}',
  pagador_cnpj text not null default '41356863000183',
  pagador_nome text not null default 'Blue Pay Solutions Ltda',
  pixel_meta_id text null,
  ga4_id text null,
  gads_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) promocao_indicadores (§2.2)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_indicadores (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  cpf char(11) not null,
  nome text not null,
  telefone text not null,
  telefone_verificado boolean not null default false,
  data_nascimento date null,
  pix_tipo text not null check (pix_tipo in ('cpf', 'telefone', 'email', 'aleatoria', 'dados_bancarios')),
  pix_chave text null,
  banco_codigo text null,
  banco_nome text null,
  agencia text null,
  conta text null,
  pix_atualizado_em timestamptz not null default now(),
  wesales_contact_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promocao_indicadores_pix_check check (
    (pix_tipo = 'dados_bancarios' and banco_codigo is not null and agencia is not null and conta is not null)
    or (pix_tipo <> 'dados_bancarios' and pix_chave is not null)
  ),
  constraint promocao_indicadores_campanha_cpf_uq unique (campanha_id, cpf)
);

-- ---------------------------------------------------------------------------
-- 3) promocao_inscricoes (§2.3) — 1 por CPF servidor por campanha
--    (indicacao_id vira FK depois de promocao_indicacoes existir)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_inscricoes (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  codigo text not null unique,
  cpf char(11) not null,
  nome text not null,
  telefone text not null,
  telefone_verificado boolean not null default false,
  data_nascimento date null,
  email text null,
  origem text not null check (origem in ('direta', 'indicacao')),
  indicacao_id uuid null,
  status text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  consent_promocao boolean not null,
  consent_contato_comercial boolean not null default false,
  wesales_contact_id text null,
  wesales_opportunity_id text null,
  wesales_status text not null default 'pendente' check (wesales_status in ('pendente', 'ok', 'erro')),
  wesales_erro text null,
  wesales_sync_em timestamptz null,
  submission_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promocao_inscricoes_campanha_cpf_uq unique (campanha_id, cpf)
);
create index if not exists promocao_inscricoes_campanha_status_idx on public.promocao_inscricoes (campanha_id, status);
create index if not exists promocao_inscricoes_telefone_idx on public.promocao_inscricoes (telefone);

-- ---------------------------------------------------------------------------
-- 4) promocao_indicacoes (§2.4)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_indicacoes (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  numero text not null unique,
  indicador_id uuid not null references public.promocao_indicadores (id),
  inscricao_id uuid not null references public.promocao_inscricoes (id),
  cpf_indicado char(11) not null,
  status text not null default 'valida' check (status in ('valida', 'cancelada')),
  inscrita_em timestamptz not null default now(),
  comprovante_token_hash text null,
  comprovante_expira_em timestamptz null,
  submission_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 1 indicação válida por CPF indicado em toda a campanha
create unique index if not exists promocao_indicacoes_cpf_valida_uq
  on public.promocao_indicacoes (campanha_id, cpf_indicado) where status = 'valida';
create index if not exists promocao_indicacoes_indicador_idx on public.promocao_indicacoes (indicador_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'promocao_inscricoes_indicacao_fk') then
    alter table public.promocao_inscricoes
      add constraint promocao_inscricoes_indicacao_fk foreign key (indicacao_id) references public.promocao_indicacoes (id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) promocao_operacoes (§2.5) — digitação manual
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_operacoes (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  inscricao_id uuid not null references public.promocao_inscricoes (id),
  tipo text not null check (tipo in ('novo', 'refinanciamento', 'portabilidade', 'saque_cartao_consignado', 'saque_cartao_beneficio', 'outro')),
  conta_como_cartao boolean generated always as (tipo in ('saque_cartao_consignado', 'saque_cartao_beneficio')) stored,
  valor_liquido_centavos bigint not null check (valor_liquido_centavos > 0),
  data_digitacao date not null,
  data_pagamento date null,
  instituicao_financeira_id uuid null references public.financial_institutions (id),
  instituicao_texto text null,
  numero_proposta text null,
  status text not null default 'informada' check (status in ('informada', 'confirmada', 'invalidada')),
  motivo_invalidacao text null,
  confirmada_em timestamptz null,
  confirmada_por uuid null references public.users (id),
  invalidada_em timestamptz null,
  invalidada_por uuid null references public.users (id),
  observacao text null,
  created_by uuid null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists promocao_operacoes_proposta_uq
  on public.promocao_operacoes (campanha_id, instituicao_financeira_id, numero_proposta)
  where numero_proposta is not null and status <> 'invalidada';
create index if not exists promocao_operacoes_inscricao_status_idx on public.promocao_operacoes (inscricao_id, status);

-- ---------------------------------------------------------------------------
-- 6) promocao_direitos (§2.6) — estado calculado, 1 por (inscricao, tipo)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_direitos (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  inscricao_id uuid not null references public.promocao_inscricoes (id),
  indicador_id uuid null references public.promocao_indicadores (id),
  tipo text not null check (tipo in ('numeros_servidor', 'numero_indicador', 'pix_indicador')),
  qtd_devida integer not null default 0,
  qtd_emitida integer not null default 0,
  valor_centavos bigint not null default 0,
  total_elegivel_centavos bigint not null default 0,
  total_cartao_centavos bigint not null default 0,
  saldo_centavos bigint not null default 0,
  cartao_faltante_centavos bigint not null default 0,
  proporcao_ok boolean not null default false,
  status text not null default 'sem_direito'
    check (status in ('sem_direito', 'devido', 'em_remessa', 'pago', 'emitido_parcial', 'emitido')),
  calculado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promocao_direitos_inscricao_tipo_uq unique (inscricao_id, tipo)
);
create index if not exists promocao_direitos_campanha_tipo_status_idx on public.promocao_direitos (campanha_id, tipo, status);

-- ---------------------------------------------------------------------------
-- 7) promocao_geracoes (§2.7) — um link individual por lote incremental
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_geracoes (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  direito_id uuid not null references public.promocao_direitos (id),
  titular_tipo text not null check (titular_tipo in ('inscricao', 'indicador')),
  titular_id uuid not null,
  telefone text not null,
  qtd integer not null check (qtd > 0),
  token_hash text not null unique,
  expira_em timestamptz not null,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'usado', 'expirado', 'cancelado')),
  enviado_em timestamptz null,
  usado_em timestamptz null,
  cancelado_em timestamptz null,
  snapshot jsonb not null default '{}'::jsonb,
  dados_confirmados jsonb null,
  ip text null,
  user_agent text null,
  submission_id uuid null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- só 1 link vivo por direito
create unique index if not exists promocao_geracoes_direito_vivo_uq
  on public.promocao_geracoes (direito_id) where status in ('pendente', 'enviado');
create index if not exists promocao_geracoes_titular_idx on public.promocao_geracoes (titular_tipo, titular_id);

-- ---------------------------------------------------------------------------
-- 8) promocao_geracao_operacoes (§2.8) — vínculo operação→geração
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_geracao_operacoes (
  geracao_id uuid not null references public.promocao_geracoes (id) on delete cascade,
  operacao_id uuid not null references public.promocao_operacoes (id),
  valor_utilizado_centavos bigint not null,
  primary key (geracao_id, operacao_id)
);

-- ---------------------------------------------------------------------------
-- 9) promocao_numeros (§2.9)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_numeros (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  numero integer not null check (numero between 0 and 99999),
  geracao_id uuid not null references public.promocao_geracoes (id),
  direito_id uuid not null references public.promocao_direitos (id),
  inscricao_id uuid not null references public.promocao_inscricoes (id),
  titular_tipo text not null check (titular_tipo in ('inscricao', 'indicador')),
  titular_id uuid not null,
  status text not null default 'valido' check (status in ('valido', 'desconsiderado')),
  desconsiderado_em timestamptz null,
  desconsiderado_por uuid null references public.users (id),
  motivo text null,
  created_at timestamptz not null default now(),
  constraint promocao_numeros_campanha_numero_uq unique (campanha_id, numero)
);
create index if not exists promocao_numeros_campanha_status_idx on public.promocao_numeros (campanha_id, status);
create index if not exists promocao_numeros_titular_idx on public.promocao_numeros (titular_tipo, titular_id);
create index if not exists promocao_numeros_geracao_idx on public.promocao_numeros (geracao_id);

-- ---------------------------------------------------------------------------
-- 10) promocao_otps (§2.10)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_otps (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  telefone text not null,
  finalidade text not null check (finalidade in ('servidor', 'indicador', 'geracao')),
  codigo_hash text not null,
  tentativas integer not null default 0,
  max_tentativas integer not null default 5,
  expira_em timestamptz not null,
  confirmado_em timestamptz null,
  otp_token_hash text null unique,
  otp_token_expira_em timestamptz null,
  otp_token_usado_em timestamptz null,
  envio_chave text null,
  ip text null,
  created_at timestamptz not null default now()
);
create index if not exists promocao_otps_telefone_idx on public.promocao_otps (telefone, created_at desc);

-- ---------------------------------------------------------------------------
-- 11) promocao_cpfs_bloqueados (§2.11) — campanha_id null = todas
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_cpfs_bloqueados (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid null references public.promocao_campanhas (id),
  cpf char(11) not null,
  nome text null,
  motivo text not null,
  criado_por uuid null references public.users (id),
  created_at timestamptz not null default now()
);
create unique index if not exists promocao_cpfs_bloqueados_uq
  on public.promocao_cpfs_bloqueados ((coalesce(campanha_id, '00000000-0000-0000-0000-000000000000'::uuid)), cpf);
create index if not exists promocao_cpfs_bloqueados_cpf_idx on public.promocao_cpfs_bloqueados (cpf);

-- ---------------------------------------------------------------------------
-- 13) promocao_envios (§2.13) — idempotência WhatsApp (operation_id do engine)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_envios (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  chave text not null unique,
  operation_id uuid not null default gen_random_uuid(),
  tipo text not null check (tipo in ('otp', 'comprovante_indicacao', 'link_numeros_servidor', 'link_numeros_indicador', 'comprovante_numeros', 'aviso_pagamento')),
  telefone text not null,
  texto text not null,
  tem_imagem boolean not null default false,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'incerto', 'rejeitado', 'falhou')),
  tentativas integer not null default 0,
  engine_message_id text null,
  erro text null,
  enviado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists promocao_envios_status_idx on public.promocao_envios (status, created_at);

-- ---------------------------------------------------------------------------
-- 14) promocao_remessas + promocao_remessa_itens (§2.14)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_remessas (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  data_referencia date not null,
  status text not null default 'gerada' check (status in ('gerada', 'exportada', 'enviada_pagamento')),
  total_centavos bigint not null default 0,
  qtd_itens integer not null default 0,
  pagador_cnpj text not null,
  pagador_nome text not null,
  gerada_por uuid null references public.users (id),
  gerada_em timestamptz not null default now(),
  exportada_por uuid null references public.users (id),
  exportada_em timestamptz null,
  enviada_por uuid null references public.users (id),
  enviada_em timestamptz null,
  created_at timestamptz not null default now(),
  constraint promocao_remessas_campanha_data_uq unique (campanha_id, data_referencia)
);

create table if not exists public.promocao_remessa_itens (
  id uuid primary key default gen_random_uuid(),
  remessa_id uuid not null references public.promocao_remessas (id) on delete cascade,
  direito_id uuid not null unique references public.promocao_direitos (id),
  indicador_id uuid not null references public.promocao_indicadores (id),
  inscricao_id uuid not null references public.promocao_inscricoes (id),
  valor_centavos bigint not null,
  indicado_nome text not null,
  indicado_cpf char(11) not null,
  pix_tipo text not null,
  pix_chave text null,
  banco_codigo text null,
  banco_nome text null,
  agencia text null,
  conta text null,
  created_at timestamptz not null default now()
);
create index if not exists promocao_remessa_itens_remessa_idx on public.promocao_remessa_itens (remessa_id);
create index if not exists promocao_remessa_itens_indicador_idx on public.promocao_remessa_itens (indicador_id);

-- ---------------------------------------------------------------------------
-- 15) promocao_sorteios (§2.15)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_sorteios (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null unique references public.promocao_campanhas (id),
  data_extracao date not null,
  numero_extraido char(5) not null,
  fonte text not null default 'Loteria Federal — 1º prêmio',
  numero_contemplado integer null,
  distancia integer null,
  direcao text null check (direcao in ('exato', 'superior', 'inferior')),
  numero_id uuid null references public.promocao_numeros (id),
  status text not null default 'apurado' check (status in ('apurado', 'validado', 'anulado')),
  apurado_por uuid null references public.users (id),
  apurado_em timestamptz not null default now(),
  validado_por uuid null references public.users (id),
  validado_em timestamptz null,
  observacao text null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 16) promocao_aceites (LGPD) + promocao_eventos (auditoria) (§2.16)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_aceites (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  sujeito_tipo text not null check (sujeito_tipo in ('inscricao', 'indicador', 'geracao')),
  sujeito_id uuid not null,
  finalidade text not null check (finalidade in ('promocao', 'contato_comercial', 'regulamento_geracao', 'relacao_legitima_indicado')),
  aceito boolean not null,
  versao_texto text not null,
  ip text null,
  user_agent text null,
  created_at timestamptz not null default now()
);
create index if not exists promocao_aceites_sujeito_idx on public.promocao_aceites (sujeito_tipo, sujeito_id);

create table if not exists public.promocao_eventos (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  entidade text not null,
  entidade_id uuid not null,
  tipo text not null,
  dados jsonb not null default '{}'::jsonb,
  ator_user_id uuid null references public.users (id),
  created_at timestamptz not null default now()
);
create index if not exists promocao_eventos_entidade_idx on public.promocao_eventos (entidade, entidade_id);

-- ---------------------------------------------------------------------------
-- 17) promocao_tracking + promocao_limites (§2.17)
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_tracking (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  inscricao_id uuid null references public.promocao_inscricoes (id),
  indicacao_id uuid null references public.promocao_indicacoes (id),
  event_id text null,
  evento text not null check (evento in ('lead_inicio', 'lead_conclusao')),
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_term text null,
  utm_content text null,
  gclid text null,
  fbclid text null,
  fbp text null,
  fbc text null,
  referrer text null,
  landing_url text null,
  ip_hash text null,
  user_agent text null,
  created_at timestamptz not null default now()
);
create index if not exists promocao_tracking_inscricao_idx on public.promocao_tracking (inscricao_id);

create table if not exists public.promocao_limites (
  chave text primary key,
  janela_inicio timestamptz not null,
  contagem integer not null
);

-- Rate limit atômico: true = dentro do limite (a tentativa foi contada).
create or replace function public.promocao_limite_tentar(p_chave text, p_limite integer, p_janela_seg integer)
returns boolean
language plpgsql
as $$
declare
  v_contagem integer;
begin
  insert into public.promocao_limites (chave, janela_inicio, contagem)
  values (p_chave, now(), 1)
  on conflict (chave) do update
    set janela_inicio = case
          when public.promocao_limites.janela_inicio + make_interval(secs => p_janela_seg) < now() then now()
          else public.promocao_limites.janela_inicio end,
        contagem = case
          when public.promocao_limites.janela_inicio + make_interval(secs => p_janela_seg) < now() then 1
          else public.promocao_limites.contagem + 1 end
  returning contagem into v_contagem;
  return v_contagem <= p_limite;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12) promocao_gerar_numeros (§2.12) — geração atômica, CSPRNG, sem repetição
-- ---------------------------------------------------------------------------
create or replace function public.promocao_gerar_numeros(
  p_geracao_id uuid,
  p_token_hash text,
  p_dados jsonb,
  p_ip text,
  p_ua text
)
returns setof integer
language plpgsql
as $$
declare
  g record;
  v_inseridos integer := 0;
  v_iteracoes integer := 0;
  v_bytes bytea;
  v_numero integer;
  v_emitida integer;
begin
  select ge.id, ge.campanha_id, ge.direito_id, ge.titular_tipo, ge.titular_id, ge.qtd, ge.status, ge.expira_em, ge.token_hash,
         d.inscricao_id, d.qtd_devida, d.qtd_emitida
    into g
    from public.promocao_geracoes ge
    join public.promocao_direitos d on d.id = ge.direito_id
   where ge.id = p_geracao_id
   for update of ge, d;

  if not found or g.token_hash is distinct from p_token_hash or g.status not in ('pendente', 'enviado') or now() > g.expira_em then
    raise exception 'LINK_INVALIDO' using errcode = 'P0001';
  end if;

  -- serializa a geração por campanha (o UNIQUE já impede repetição; o lock evita tempestade de conflitos)
  perform pg_advisory_xact_lock(hashtext(g.campanha_id::text));

  while v_inseridos < g.qtd loop
    v_iteracoes := v_iteracoes + 1;
    if v_iteracoes > 10000 then
      raise exception 'SERIE_ESGOTADA' using errcode = 'P0002';
    end if;
    -- CSPRNG (pgcrypto): 4 bytes → inteiro sem sinal → mod 100000 (viés desprezível, ~1,5e-5)
    v_bytes := gen_random_bytes(4);
    v_numero := (
      ((get_byte(v_bytes, 0)::bigint << 24) | (get_byte(v_bytes, 1)::bigint << 16) | (get_byte(v_bytes, 2)::bigint << 8) | get_byte(v_bytes, 3)::bigint)
      % 100000
    )::integer;

    insert into public.promocao_numeros (campanha_id, numero, geracao_id, direito_id, inscricao_id, titular_tipo, titular_id)
    values (g.campanha_id, v_numero, g.id, g.direito_id, g.inscricao_id, g.titular_tipo, g.titular_id)
    on conflict (campanha_id, numero) do nothing;

    if found then
      v_inseridos := v_inseridos + 1;
    end if;
  end loop;

  update public.promocao_geracoes
     set status = 'usado', usado_em = now(), dados_confirmados = p_dados, ip = p_ip, user_agent = p_ua, updated_at = now()
   where id = g.id;

  v_emitida := g.qtd_emitida + g.qtd;
  update public.promocao_direitos
     set qtd_emitida = v_emitida,
         status = case when v_emitida >= qtd_devida then 'emitido' else 'emitido_parcial' end,
         updated_at = now()
   where id = g.direito_id;

  return query
    select n.numero from public.promocao_numeros n where n.geracao_id = g.id order by n.numero;
end;
$$;

-- ---------------------------------------------------------------------------
-- 18) RLS ligada SEM policy (service role) + updated_at
-- ---------------------------------------------------------------------------
alter table public.promocao_campanhas enable row level security;
alter table public.promocao_indicadores enable row level security;
alter table public.promocao_inscricoes enable row level security;
alter table public.promocao_indicacoes enable row level security;
alter table public.promocao_operacoes enable row level security;
alter table public.promocao_direitos enable row level security;
alter table public.promocao_geracoes enable row level security;
alter table public.promocao_geracao_operacoes enable row level security;
alter table public.promocao_numeros enable row level security;
alter table public.promocao_otps enable row level security;
alter table public.promocao_cpfs_bloqueados enable row level security;
alter table public.promocao_envios enable row level security;
alter table public.promocao_remessas enable row level security;
alter table public.promocao_remessa_itens enable row level security;
alter table public.promocao_sorteios enable row level security;
alter table public.promocao_aceites enable row level security;
alter table public.promocao_eventos enable row level security;
alter table public.promocao_tracking enable row level security;
alter table public.promocao_limites enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['promocao_campanhas', 'promocao_indicadores', 'promocao_inscricoes', 'promocao_indicacoes', 'promocao_operacoes',
                            'promocao_direitos', 'promocao_geracoes', 'promocao_envios'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_timestamp_' || t) then
      execute format('create trigger %I before update on public.%I for each row execute function trigger_set_timestamp()', 'set_timestamp_' || t, t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 19) Seed da campanha Valparaíso (status rascunho; Bruno ativa pela tela)
-- ---------------------------------------------------------------------------
insert into public.promocao_campanhas (slug, nome, convenio_id, cidade, uf, status, inicio_em, fim_em, prazo_geracao_ate, data_sorteio)
select
  'valparaiso-go',
  'NuAzul – Você Sempre no Azul | Valparaíso de Goiás',
  (select c.id from public.convenios c where c.deleted_at is null and lower(c.nome) like '%valpara%' order by c.created_at limit 1),
  'Valparaíso de Goiás',
  'GO',
  'rascunho',
  '2026-10-01T00:00:00-03:00'::timestamptz,
  '2026-10-31T23:59:59.999-03:00'::timestamptz,
  '2026-11-10T23:59:59.999-03:00'::timestamptz,
  '2026-11-11'::date
where not exists (select 1 from public.promocao_campanhas where slug = 'valparaiso-go');

-- ---------------------------------------------------------------------------
-- 20) Seed de permissões (4 chaves novas; padrão 20260924161555)
-- ---------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, k.chave, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('comercial-promocoes'), ('comercial-promocoes-remessa'), ('comercial-promocoes-bloqueados'), ('comercial-promocoes-config')) as k (chave)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, k.chave, true, true, true, false, false
from public.user_permissions up
cross join (values ('comercial-promocoes'), ('comercial-promocoes-remessa'), ('comercial-promocoes-bloqueados'), ('comercial-promocoes-config')) as k (chave)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
