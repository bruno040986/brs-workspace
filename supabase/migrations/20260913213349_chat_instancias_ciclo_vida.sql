-- Ciclo de vida da instância de WhatsApp — plano v3 §3 (Fable, 13/09/2026).
-- Motivação: em 11/09 e 13/09 o WhatsApp desvinculou (401 device_removed)
-- números de disparo 1-3 s depois do envio; a 5009 foi restrita por 5 h pela
-- Meta. Não havia registro de nada disso além do log do engine. Aqui entram:
--   * dados do chip (número informado × detectado, tipo, operadora, plano);
--   * eventos de conexão/desconexão com MOTIVO (engine grava os técnicos,
--     o usuário informa o motivo ao reconectar);
--   * recargas de pré-pago (verso do card);
--   * aquecimento antes de disparar (48 h por padrão) com liberação
--     antecipada registrada, e restrição da Meta com prazo.
alter table public.chat_instancias
  add column if not exists numero_informado text null,
  add column if not exists tipo_numero text null check (tipo_numero in ('celular', 'fixo', 'virtual')),
  add column if not exists operadora_id uuid null references public.operadoras_telefonia (id),
  add column if not exists tipo_plano text null check (tipo_plano in ('pre_pago', 'pos_pago', 'virtual')),
  add column if not exists disparo_liberado_em timestamptz null,
  add column if not exists disparo_liberado_por uuid null references public.crm_usuarios (id),
  add column if not exists restrito_ate timestamptz null;
comment on column public.chat_instancias.numero_informado is 'E.164 digitado no cadastro (o engine grava o detectado em `numero` ao conectar; divergência gera evento numero_divergente, não bloqueia).';
comment on column public.chat_instancias.disparo_liberado_em is 'Liberação antecipada do aquecimento; só vale se >= conectada_em (pareamento atual).';
comment on column public.chat_instancias.restrito_ate is 'Restrição da Meta informada na reconexão (prazo em horas). Fora do rodízio até vencer.';

alter table public.crm_parceiro_config
  add column if not exists disparo_aquecimento_horas integer not null default 48
    check (disparo_aquecimento_horas >= 0 and disparo_aquecimento_horas <= 720);

create table if not exists public.chat_instancia_eventos (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  agente_parceiro_id uuid null references public.agentes_parceiros (id),
  tipo text not null check (tipo in ('conexao', 'desconexao_sistema', 'desconexao_externa', 'reconexao', 'liberacao_antecipada', 'numero_divergente', 'restricao', 'banimento')),
  motivo text null check (motivo in ('banimento', 'restricao_meta', 'desconexao_manual', 'desconexao_aparelho', 'mudanca_aparelho', 'mudanca_aplicativo', 'outro')),
  prazo_horas integer null check (prazo_horas is null or prazo_horas > 0),
  observacao text null,
  numero_detectado text null,
  origem text not null check (origem in ('engine', 'usuario')),
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chat_instancia_eventos_inst_idx on public.chat_instancia_eventos (instancia_id, created_at desc);
alter table public.chat_instancia_eventos enable row level security;
revoke all on public.chat_instancia_eventos from public, anon, authenticated;
grant select, insert on public.chat_instancia_eventos to service_role;

create table if not exists public.chat_instancia_recargas (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  data_recarga date not null,
  valor numeric(10, 2) not null check (valor > 0),
  -- sugerido = data + 60 dias; o usuário pode antecipar, nunca adiar
  proxima_recarga date not null,
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now(),
  check (proxima_recarga > data_recarga and proxima_recarga <= data_recarga + 60)
);
create index if not exists chat_instancia_recargas_inst_idx on public.chat_instancia_recargas (instancia_id, data_recarga desc);
alter table public.chat_instancia_recargas enable row level security;
revoke all on public.chat_instancia_recargas from public, anon, authenticated;
grant select, insert, update, delete on public.chat_instancia_recargas to service_role;

notify pgrst, 'reload schema';
