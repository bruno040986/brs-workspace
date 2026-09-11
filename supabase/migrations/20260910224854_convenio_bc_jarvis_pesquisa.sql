-- ============================================================================
-- Convênio — Base de Conhecimento, Fase 3: Jarvis pesquisador
-- Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §6 (reescrita 10/09/2026)
--
-- Princípio: a IA BUSCA, mas não é a FONTE. O Jarvis encontra normas na web;
-- o servidor baixa o texto oficial, confere se é do ente certo (o Gemini
-- atribuiu a Cubatão um decreto de Itajubá-MG — é esse erro que esta checagem
-- barra) e só então extrai sugestões, cada uma com citação literal conferida
-- no texto. Nada entra na Base de Conhecimento sem aceite humano.
--
-- Nenhuma permissão nova: pesquisar = workspace-convenios (can_edit);
-- configurar modelos = sistema-config-ia (card IA do Workspace).
-- ============================================================================

-- 1) Modelos do Jarvis para pesquisa/leitura (pagos, só para esta função; o
--    chat continua na lista `modelos` gratuita). NULL = recurso desligado.
alter table public.ia_config
  add column if not exists modelo_pesquisa text null,
  add column if not exists modelo_leitura text null;

-- 2) Uma pesquisa = um "job" em etapas, avançado sob lease -------------------
create table if not exists public.convenio_pesquisas (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  -- 'web' = busca na internet; 'documento' = ler um documento já anexado
  origem text not null default 'web' check (origem in ('web', 'documento')),
  documento_id uuid null references public.convenio_documentos (id) on delete set null,
  status text not null default 'pendente'
    check (status in ('pendente', 'buscando', 'baixando', 'extraindo', 'concluida', 'erro', 'cancelada')),
  etapa_msg text null,
  progresso integer not null default 0 check (progresso between 0 and 100),
  consulta text null,            -- instrução de busca enviada (auditoria)
  resumo text null,              -- resumo final do Jarvis: o que achou e o que NÃO achou
  nao_encontrado jsonb not null default '[]'::jsonb, -- itens que o usuário precisa completar
  erro text null,
  modelo_pesquisa text null,
  modelo_leitura text null,
  tentativas integer not null default 0,
  lease_token uuid null,
  lease_until timestamptz null,
  iniciado_por uuid null references public.users (id),
  concluido_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_timestamp_convenio_pesquisas on public.convenio_pesquisas;
create trigger set_timestamp_convenio_pesquisas before update on public.convenio_pesquisas
  for each row execute function trigger_set_timestamp();
create index if not exists convenio_pesquisas_convenio_idx on public.convenio_pesquisas (convenio_id, created_at desc);
-- no máximo UMA pesquisa em andamento por convênio (controle de custo e de conflito)
create unique index if not exists convenio_pesquisas_uma_ativa_idx
  on public.convenio_pesquisas (convenio_id)
  where status in ('pendente', 'buscando', 'baixando', 'extraindo');

-- 3) Fontes encontradas (normas candidatas) --------------------------------
create table if not exists public.convenio_pesquisa_fontes (
  id uuid primary key default gen_random_uuid(),
  pesquisa_id uuid not null references public.convenio_pesquisas (id) on delete cascade,
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  url text null,
  titulo text null,
  tipo_norma text not null default 'outro'
    check (tipo_norma in ('decreto', 'lei', 'lei_complementar', 'portaria', 'instrucao_normativa', 'resolucao', 'outro')),
  numero text null,
  ano integer null,
  ente_citado text null,          -- o que o modelo DISSE ser o ente (não confiável)
  ente_detectado text null,       -- o que o TEXTO baixado diz (checagem determinística)
  uf_detectada char(2) null,
  status text not null default 'candidata'
    check (status in ('candidata', 'falha_download', 'sem_texto', 'verificada', 'ente_divergente',
                      'nao_verificada', 'descartada', 'importada')),
  motivo text null,
  conteudo_mime text null,
  arquivo_path text null,         -- cópia do original no bucket convenio-documentos (evidência)
  tamanho bigint null,
  texto_extraido text null,
  texto_hash text null,
  extraida_em timestamptz null,   -- extração de sugestões já rodou nesta fonte
  confirmada_por uuid null references public.users (id), -- humano confirmou fonte 'nao_verificada'
  confirmada_em timestamptz null,
  documento_id uuid null references public.convenio_documentos (id) on delete set null,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_timestamp_convenio_pesquisa_fontes on public.convenio_pesquisa_fontes;
create trigger set_timestamp_convenio_pesquisa_fontes before update on public.convenio_pesquisa_fontes
  for each row execute function trigger_set_timestamp();
create index if not exists convenio_pesquisa_fontes_pesquisa_idx on public.convenio_pesquisa_fontes (pesquisa_id, ordem);
create unique index if not exists convenio_pesquisa_fontes_url_idx
  on public.convenio_pesquisa_fontes (pesquisa_id, url) where url is not null;

-- 4) Sugestões extraídas — fila única de revisão humana ----------------------
create table if not exists public.convenio_bc_sugestoes (
  id uuid primary key default gen_random_uuid(),
  pesquisa_id uuid not null references public.convenio_pesquisas (id) on delete cascade,
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  -- sugestão sem fonte não existe: toda sugestão aponta para o texto de onde saiu
  fonte_id uuid not null references public.convenio_pesquisa_fontes (id) on delete cascade,
  secao text not null check (secao in ('geral', 'publicos', 'formas', 'faq', 'observacao')),
  -- geral: nome da coluna | formas: 'forma:<uuid>' ou 'forma:?' (não mapeada)
  -- publicos: 'publico:<uuid>' ou 'publico:?' | faq: 'faq' | observacao: 'observacao'
  campo text not null,
  valor jsonb not null,           -- valor sugerido
  valor_atual jsonb null,         -- o que estava na BC quando a sugestão foi gerada
  rotulo text null,               -- texto legível para a tela
  citacao text not null,          -- trecho LITERAL, conferido como substring do texto da fonte
  artigo text null,
  status text not null default 'pendente'
    check (status in ('pendente', 'aceita', 'editada', 'rejeitada', 'substituida')),
  valor_aplicado jsonb null,      -- o que de fato foi gravado (difere de `valor` quando editada)
  decidido_por uuid null references public.users (id),
  decidido_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (secao <> 'geral' or campo in ('max_comprometimento_salarial', 'prazo_minimo_geral', 'prazo_maximo_geral', 'numero_servidores')),
  check (secao <> 'formas' or campo like 'forma:%'),
  check (secao <> 'publicos' or campo like 'publico:%'),
  check (secao <> 'faq' or campo = 'faq'),
  check (secao <> 'observacao' or campo = 'observacao'),
  check (length(trim(citacao)) >= 10)
);
drop trigger if exists set_timestamp_convenio_bc_sugestoes on public.convenio_bc_sugestoes;
create trigger set_timestamp_convenio_bc_sugestoes before update on public.convenio_bc_sugestoes
  for each row execute function trigger_set_timestamp();
create index if not exists convenio_bc_sugestoes_convenio_idx on public.convenio_bc_sugestoes (convenio_id, status);
create index if not exists convenio_bc_sugestoes_pesquisa_idx on public.convenio_bc_sugestoes (pesquisa_id);
create index if not exists convenio_bc_sugestoes_fonte_idx on public.convenio_bc_sugestoes (fonte_id);

-- 5) Claim atômico (mesmo padrão de chat_acoes_agendadas_claim) -------------
-- p_id informado: tenta pegar SÓ aquela pesquisa (passo disparado pela tela);
-- p_id nulo: o cron pega até p_limite pesquisas em andamento com lease vencido.
create or replace function public.convenio_pesquisas_claim(
  p_id uuid default null,
  p_limite integer default 3,
  p_lease_segundos integer default 90
)
returns setof public.convenio_pesquisas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with cand as (
    select id
    from public.convenio_pesquisas
    where status in ('pendente', 'buscando', 'baixando', 'extraindo')
      and (lease_until is null or lease_until < now())
      and (p_id is null or id = p_id)
    order by created_at
    limit greatest(1, least(coalesce(p_limite, 3), 20))
    for update skip locked
  )
  update public.convenio_pesquisas p
  set lease_token = v_token,
      lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_segundos, 90), 300))),
      updated_at = now()
  from cand
  where p.id = cand.id
  returning p.*;
end;
$$;
revoke all on function public.convenio_pesquisas_claim(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.convenio_pesquisas_claim(uuid, integer, integer) to service_role;

-- 6) RLS: ligada, sem policy (server-only) ----------------------------------
alter table public.convenio_pesquisas enable row level security;
alter table public.convenio_pesquisa_fontes enable row level security;
alter table public.convenio_bc_sugestoes enable row level security;
