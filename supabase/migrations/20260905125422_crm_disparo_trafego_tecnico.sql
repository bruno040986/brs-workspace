-- ---------------------------------------------------------------------------
-- Tráfego técnico entre números controlados (plano AlvoConsig, seção 6).
-- DESLIGADO por padrão (trafego_tecnico_habilitado=false por parceiro) — fica
-- assim até teste real autorizado pelo Bruno com números pareados.
--
-- Regra: depois de um envio 'enviado' pra LEAD (crm_disparo_fila), o worker
-- agenda até N destinatários distintos entre os números de disparo do MESMO
-- parceiro (ida: origem→destino) e, pra cada um, uma resposta (volta:
-- destino→origem) em horário sorteado. Exige >= trafego_tecnico_min_numeros
-- números conectados; com menos, o fluxo fica suspenso e o painel mostra o
-- motivo — a campanha segue normal. Invariantes (worker + engine, Sonnet):
--  * ciclo só nasce de envio a lead; NUNCA de linha técnica (sem laço);
--  * origem ≠ destino, ambos papel='disparo', mesmo tenant, conectados;
--  * teto diário por número; pausa da campanha pausa o técnico; número que
--    sai do conjunto controlado cancela suas linhas pendentes;
--  * as conversas geradas são chat_conversas.origem='tecnico' — o Atendimento
--    filtra origem<>'tecnico' SEMPRE (não é "disparo sem resposta": nunca
--    entra na fila, mesmo com resposta), e o engine, ao receber inbound de um
--    jid que é número de disparo do próprio tenant, não marca respondida;
--  * métricas separadas: nada daqui soma no indicador comercial.
-- Reusa o padrão lease/claim/finish do disparo (mesmo desenho, tabela própria).
-- ---------------------------------------------------------------------------
alter table public.crm_parceiro_config
  add column if not exists trafego_tecnico_habilitado boolean not null default false,
  add column if not exists trafego_tecnico_min_numeros integer not null default 5
    check (trafego_tecnico_min_numeros >= 2 and trafego_tecnico_min_numeros <= 50),
  add column if not exists trafego_tecnico_destinatarios_por_ciclo integer not null default 4
    check (trafego_tecnico_destinatarios_por_ciclo >= 1 and trafego_tecnico_destinatarios_por_ciclo <= 10),
  add column if not exists trafego_tecnico_max_ciclos_dia_por_numero integer not null default 20
    check (trafego_tecnico_max_ciclos_dia_por_numero >= 1 and trafego_tecnico_max_ciclos_dia_por_numero <= 500);

alter table public.chat_conversas drop constraint if exists chat_conversas_origem_check;
alter table public.chat_conversas add constraint chat_conversas_origem_check
  check (origem in ('organica', 'disparo', 'tecnico'));
create index if not exists chat_conversas_tecnico_idx on public.chat_conversas (instancia_id) where origem = 'tecnico';

create table public.crm_disparo_trafego_tecnico (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  campanha_id uuid null references public.crm_campanhas_parceiro (id) on delete set null,
  -- envio ao lead que originou o ciclo (auditoria); some junto com a fila
  disparo_fila_id uuid null references public.crm_disparo_fila (id) on delete set null,
  ciclo_id uuid not null,
  etapa text not null check (etapa in ('ida', 'volta')),
  instancia_origem_id uuid not null references public.chat_instancias (id) on delete cascade,
  instancia_destino_id uuid not null references public.chat_instancias (id) on delete cascade,
  template_id uuid null references public.crm_templates_mensagem (id) on delete set null,
  agendado_para timestamptz not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado', 'incerto')),
  lease_token uuid null,
  lease_until timestamptz null,
  tentativas integer not null default 0,
  ultimo_erro text null,
  enviado_em timestamptz null,
  created_at timestamptz not null default now(),
  check (instancia_origem_id <> instancia_destino_id)
);
create index crm_disparo_tecnico_pendentes_idx
  on public.crm_disparo_trafego_tecnico (agente_parceiro_id, agendado_para) where status = 'pendente';
create index crm_disparo_tecnico_ciclo_idx on public.crm_disparo_trafego_tecnico (ciclo_id);
create index crm_disparo_tecnico_dia_idx
  on public.crm_disparo_trafego_tecnico (instancia_origem_id, enviado_em) where status = 'enviado';
alter table public.crm_disparo_trafego_tecnico enable row level security;
revoke all on public.crm_disparo_trafego_tecnico from public, anon, authenticated;
grant select, insert, update on public.crm_disparo_trafego_tecnico to service_role;
