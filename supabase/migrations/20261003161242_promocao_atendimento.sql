-- Promoção NuAzul Valparaíso — "Solicitar atendimento" (idempotente).
-- Contrato: docs/promocao/CONTRATO-ATENDIMENTO.md.
-- (a) config da campanha: parceiro + instância de atendimento + reserva, liberação, pausa, limites;
-- (b) prova de posse do servidor (token do cadastro concluído) em promocao_inscricoes;
-- (c) tabela de pedidos (1 por CPF por tipo, 1 por telefone), consentimento imutável, sem DELETE;
-- (d) promocao_envios.tipo aceita os 2 tipos novos.
-- Padrões: RLS ligada SEM policy; revoke anon/authenticated; funções com search_path fixo.

-- ---------------------------------------------------------------------------
-- 1) promocao_campanhas — configuração do atendimento
-- ---------------------------------------------------------------------------
alter table public.promocao_campanhas
  add column if not exists parceiro_atendimento_id uuid null references public.agentes_parceiros (id),
  add column if not exists instancia_atendimento_id uuid null references public.chat_instancias (id),
  add column if not exists instancia_atendimento_reserva_id uuid null references public.chat_instancias (id),
  add column if not exists atendimento_liberado_em timestamptz null,
  add column if not exists atendimento_pausado boolean not null default false,
  add column if not exists limite_atendimento_indicador_hora integer not null default 30,
  add column if not exists limite_atendimento_instancia_hora integer not null default 40,
  add column if not exists limite_atendimento_instancia_dia integer not null default 200;

comment on column public.promocao_campanhas.atendimento_liberado_em is
  'Gate manual: o botão "a NuAzul me chama" só funciona a partir desta data/hora (null = nunca liberado).';
comment on column public.promocao_campanhas.instancia_atendimento_reserva_id is
  'Instância usada só quando a principal não está conectada ou estourou o teto; nunca a instância de OTP (instancia_id).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promocao_campanhas_atend_limites_positivos') then
    alter table public.promocao_campanhas add constraint promocao_campanhas_atend_limites_positivos
      check (limite_atendimento_indicador_hora > 0 and limite_atendimento_instancia_hora > 0 and limite_atendimento_instancia_dia > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promocao_campanhas_atend_reserva_distinta') then
    alter table public.promocao_campanhas add constraint promocao_campanhas_atend_reserva_distinta
      check (instancia_atendimento_reserva_id is null or instancia_atendimento_reserva_id is distinct from instancia_atendimento_id);
  end if;
  -- a instância de OTP/comprovantes (conta BRS) nunca é usada para chamar o lead
  if not exists (select 1 from pg_constraint where conname = 'promocao_campanhas_atend_nao_otp') then
    alter table public.promocao_campanhas add constraint promocao_campanhas_atend_nao_otp
      check (
        (instancia_atendimento_id is null or instancia_atendimento_id is distinct from instancia_id)
        and (instancia_atendimento_reserva_id is null or instancia_atendimento_reserva_id is distinct from instancia_id)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) promocao_inscricoes — token de posse do cadastro concluído (servidor)
--    (o indicador prova posse com o comprovante_token_hash já existente em promocao_indicacoes)
-- ---------------------------------------------------------------------------
alter table public.promocao_inscricoes
  add column if not exists atendimento_token_hash text null,
  add column if not exists atendimento_token_expira_em timestamptz null;
create unique index if not exists promocao_inscricoes_atend_token_uq
  on public.promocao_inscricoes (atendimento_token_hash) where atendimento_token_hash is not null;

-- ---------------------------------------------------------------------------
-- 3) promocao_pedidos_atendimento
-- ---------------------------------------------------------------------------
create table if not exists public.promocao_pedidos_atendimento (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.promocao_campanhas (id),
  tipo text not null check (tipo in ('servidor', 'indicado')),
  -- servidor: a própria inscrição; indicado: a inscrição do indicado
  inscricao_id uuid not null references public.promocao_inscricoes (id),
  indicacao_id uuid null references public.promocao_indicacoes (id),
  indicador_id uuid null references public.promocao_indicadores (id),
  cpf_alvo char(11) not null,
  telefone_alvo text not null,
  -- prova de consentimento (só tipo indicado): texto exibido + versão + carimbos
  consentimento_texto text null,
  consentimento_versao text null,
  ip text null,
  user_agent text null,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'incerto', 'rejeitado')),
  envio_id uuid null references public.promocao_envios (id),
  -- fixada no 1º POST ao engine; retentativas NUNCA trocam de instância (operation_id é o mesmo)
  instancia_usada_id uuid null references public.chat_instancias (id),
  erro text null,
  enviado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promocao_pedidos_atend_indicado_completo check (
    tipo = 'servidor' or (indicacao_id is not null and indicador_id is not null and consentimento_texto is not null and consentimento_versao is not null)
  ),
  constraint promocao_pedidos_atend_servidor_sem_indicacao check (
    tipo = 'indicado' or (indicacao_id is null and indicador_id is null)
  )
);
-- 1 envio da empresa por CPF (independente do tipo: indicado que depois se cadastra como servidor NÃO recebe 2ª mensagem)
-- e o telefone nunca recebe 2 mensagens de "chamar"
drop index if exists public.promocao_pedidos_atend_cpf_uq;
create unique index if not exists promocao_pedidos_atend_cpf_uq on public.promocao_pedidos_atendimento (campanha_id, cpf_alvo);
create unique index if not exists promocao_pedidos_atend_tel_uq on public.promocao_pedidos_atendimento (campanha_id, telefone_alvo);
-- contagens das janelas deslizantes (indicador/hora; instância/hora e /24 h)
create index if not exists promocao_pedidos_atend_indicador_idx on public.promocao_pedidos_atendimento (campanha_id, indicador_id, created_at desc) where indicador_id is not null;
create index if not exists promocao_pedidos_atend_instancia_idx on public.promocao_pedidos_atendimento (instancia_usada_id, created_at desc) where instancia_usada_id is not null;
create index if not exists promocao_pedidos_atend_status_idx on public.promocao_pedidos_atendimento (status, created_at);

alter table public.promocao_pedidos_atendimento enable row level security;
revoke all on public.promocao_pedidos_atendimento from anon, authenticated;

drop trigger if exists set_timestamp_promocao_pedidos_atendimento on public.promocao_pedidos_atendimento;
create trigger set_timestamp_promocao_pedidos_atendimento
  before update on public.promocao_pedidos_atendimento
  for each row execute function trigger_set_timestamp();

-- identidade + prova de consentimento imutáveis; status/envio_id/instancia_usada_id/erro/enviado_em liberados
create or replace function public.promocao_pedidos_atend_proteger()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.campanha_id is distinct from old.campanha_id
     or new.tipo is distinct from old.tipo
     or new.inscricao_id is distinct from old.inscricao_id
     or new.indicacao_id is distinct from old.indicacao_id
     or new.indicador_id is distinct from old.indicador_id
     or new.cpf_alvo is distinct from old.cpf_alvo
     or new.telefone_alvo is distinct from old.telefone_alvo
     or new.consentimento_texto is distinct from old.consentimento_texto
     or new.consentimento_versao is distinct from old.consentimento_versao
     or new.ip is distinct from old.ip
     or new.user_agent is distinct from old.user_agent
     or new.created_at is distinct from old.created_at then
    raise exception '% é imutável (identidade/consentimento do pedido não podem mudar)', tg_table_name using errcode = 'P0003';
  end if;
  -- a instância fica fixa depois do 1º POST ao engine
  if old.instancia_usada_id is not null and new.instancia_usada_id is distinct from old.instancia_usada_id then
    raise exception '% é imutável (instancia_usada_id não pode trocar após o 1º envio)', tg_table_name using errcode = 'P0003';
  end if;
  return new;
end;
$$;
revoke execute on function public.promocao_pedidos_atend_proteger() from public, anon, authenticated;

drop trigger if exists promocao_pedidos_atend_imutavel on public.promocao_pedidos_atendimento;
create trigger promocao_pedidos_atend_imutavel
  before update on public.promocao_pedidos_atendimento
  for each row execute function public.promocao_pedidos_atend_proteger();

-- sem DELETE (reaproveita promocao_bloquear_mutacao da migration 20261002204514)
drop trigger if exists promocao_pedidos_atend_sem_delete on public.promocao_pedidos_atendimento;
create trigger promocao_pedidos_atend_sem_delete
  before delete on public.promocao_pedidos_atendimento
  for each row execute function public.promocao_bloquear_mutacao();

-- ---------------------------------------------------------------------------
-- 4) promocao_envios.tipo — 2 tipos novos (CHECK inline nasceu como promocao_envios_tipo_check)
-- ---------------------------------------------------------------------------
-- derruba QUALQUER check existente sobre a coluna tipo (nome padrão ou não), para não sobrar um check antigo rejeitando os tipos novos
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.promocao_envios'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~* '\(tipo\s*=\s*any'
  loop
    execute format('alter table public.promocao_envios drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.promocao_envios add constraint promocao_envios_tipo_check
  check (tipo in ('otp', 'comprovante_indicacao', 'link_numeros_servidor', 'link_numeros_indicador', 'comprovante_numeros', 'aviso_pagamento',
                  'atendimento_servidor', 'atendimento_indicado'));

notify pgrst, 'reload schema';
