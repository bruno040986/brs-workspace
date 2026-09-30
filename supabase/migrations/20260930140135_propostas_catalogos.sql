-- Esteira de digitação — Fatia 2: catálogos de Status e Situação de Proposta.
-- Espelho 1:1 do ARW (missão: desligar o ARW até 31/10). Dono = Workspace
-- (menu Cadastros › "Status e Situações de Proposta"); o CRM só lê as linhas
-- ativas via service_role. Spec §4.2 e §6.5. Nada aqui é apagado depois:
-- inativar tira da escolha e mantém as propostas antigas legíveis.

-- ---------------------------------------------------------------------------
-- 1) Status de Proposta (8 no ARW). Grupo = enum fixo de 4 valores que manda
--    em cor base, balão, ranking e "é final". Comportamento vem das flags,
--    nunca do nome (proibido `if status == 'PAGO'` no código).
-- ---------------------------------------------------------------------------
create table if not exists public.propostas_status (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo_arw text null,                          -- o ARW não expõe id de status; chave de migração = nome
  grupo text not null check (grupo in ('em_andamento', 'pendente', 'pago', 'cancelado')),
  cor text null check (cor is null or cor ~ '^#[0-9A-Fa-f]{6}$'),  -- "Cor do Botão"; o chip usa esta, a linha usa a do grupo
  atualiza_data_atualizacao boolean not null default true,  -- "Atualizar Data de Última Atualização"
  libera_contratos boolean not null default false,          -- INTERNO "Liberar Contratos" (ranking/carteira)
  acao_na_alteracao text null,                   -- INTERNO "Ação na Alteração do Status" — guardado, sem efeito na v1
  alerta_observacao boolean not null default false,         -- PARCEIRO "Visualizar Alerta de Observação"
  pendente boolean not null default false,       -- PARCEIRO "Pendente" → devolve ao atendente + balão vermelho
  padrao_cadastro boolean not null default false,-- config ARW "status de cadastro" (único)
  mesa_digitacao boolean not null default false, -- config ARW "status da mesa de digitação" (só p/ migração)
  descricao text not null default '',
  ordem integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists propostas_status_nome_unique_idx
  on public.propostas_status ((lower(trim(nome))));
-- só um status pode ser o de cadastro
create unique index if not exists propostas_status_padrao_cadastro_uq
  on public.propostas_status (padrao_cadastro) where padrao_cadastro;

do $$ begin
  create trigger set_timestamp_propostas_status
    before update on public.propostas_status
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2) Situação de Proposta (30 no ARW), independente do status
-- ---------------------------------------------------------------------------
create table if not exists public.propostas_situacoes (
  id uuid primary key default gen_random_uuid(),
  codigo_arw text not null unique,               -- ID do ARW (1..30)
  nome text not null,
  descricao text not null default '',            -- "Descrição/Explicação"
  status_sugerido_id uuid null references public.propostas_status (id),  -- pré-seleciona; nunca obriga
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists propostas_situacoes_nome_unique_idx
  on public.propostas_situacoes ((lower(trim(nome))));

do $$ begin
  create trigger set_timestamp_propostas_situacoes
    before update on public.propostas_situacoes
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3) Configuração global da esteira (linha única). Sem efeito na v1 — só
--    guarda o que o ARW tem hoje, para a migração.
-- ---------------------------------------------------------------------------
create table if not exists public.propostas_esteira_config (
  id boolean primary key default true check (id),
  cancelamento_automatico_dias integer not null default 90 check (cancelamento_automatico_dias > 0),
  exigir_contato_ao_pendenciar boolean not null default false,
  updated_at timestamptz not null default now()
);

do $$ begin
  create trigger set_timestamp_propostas_esteira_config
    before update on public.propostas_esteira_config
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;

insert into public.propostas_esteira_config (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4) Seed — 8 status do ARW (grupo + flags conforme cadastro do ARW).
--    Cor fica nula (o ARW não foi exportado com a cor); o Bruno preenche na tela.
-- ---------------------------------------------------------------------------
insert into public.propostas_status
  (nome, grupo, ordem, padrao_cadastro, alerta_observacao, libera_contratos, pendente)
values
  ('EM ANDAMENTO',            'em_andamento', 1, true,  false, false, false),
  ('PENDENTE',                'pendente',     2, false, true,  false, true),
  ('PAGO',                    'pago',         3, false, false, true,  false),
  ('CANCELADO',               'cancelado',    4, false, false, false, false),
  ('REPROVADA',               'cancelado',    5, false, false, false, false),
  ('AGUARDANDO SALDO PORT',   'em_andamento', 6, false, false, false, false),
  ('PAGO COM AUTO REGULAÇÃO', 'cancelado',    7, false, true,  false, false),
  ('PROPOSTA INTEGRADA',      'pago',         8, false, false, true,  false)
on conflict ((lower(trim(nome)))) do nothing;

-- 30 situações do ARW (codigo_arw = ID do ARW). status_sugerido_id começa nulo.
insert into public.propostas_situacoes (codigo_arw, nome) values
  ('1',  'PAGAMENTO EFETUADO'),
  ('2',  'CADASTRO PROPOSTA'),
  ('3',  'PENDENCIAR CANAIS'),
  ('4',  'REPROVADO'),
  ('5',  'CANCELADA'),
  ('6',  'PROPOSTA INTEGRADA'),
  ('7',  'PENDENTE'),
  ('8',  'AGUARDANDO FORMALIZACAO'),
  ('9',  'ESTEIRA ASSINCRONA'),
  ('10', 'EM ANDAMENTO'),
  ('11', 'PROPOSTA ESTORNADA'),
  ('12', 'TROCA DE TITULARIDADE - APTA A INICIAR'),
  ('13', 'AGUARDANDO ASSINATURA DO CONTRATO'),
  ('14', 'PAGO'),
  ('15', 'ENCERRADO'),
  ('16', 'GARANTIA MANUAL'),
  ('17', 'COLETA DE ASSINATURAS'),
  ('18', 'REVISAO'),
  ('19', 'LIQUIDACAO'),
  ('20', 'AGUARDANDO LIBERACAO PARA LIQUIDACAO'),
  ('21', 'REVISAO DE PAGAMENTO'),
  ('22', 'LIQUIDACAO MANUAL'),
  ('23', 'LIBERADO'),
  ('24', 'PAGAMENTO INTEGRADO - DIGI'),
  ('25', 'EFETIVADO'),
  ('26', 'BANCO - FINALIZADO / PAGO'),
  ('27', 'ERRO'),
  ('28', 'REPROVADA ANALISE MESA'),
  ('29', 'PROCESSO FINALIZADO'),
  ('30', 'INT')
on conflict (codigo_arw) do nothing;

-- ---------------------------------------------------------------------------
-- 5) RLS: tudo via service_role nas actions (Workspace edita, CRM lê). Sem policy.
-- ---------------------------------------------------------------------------
alter table public.propostas_status enable row level security;
alter table public.propostas_situacoes enable row level security;
alter table public.propostas_esteira_config enable row level security;
revoke all on public.propostas_status, public.propostas_situacoes, public.propostas_esteira_config
  from public, anon, authenticated;
grant select, insert, update on public.propostas_status, public.propostas_situacoes, public.propostas_esteira_config
  to service_role;

-- ---------------------------------------------------------------------------
-- 6) Permissão nova do Workspace (REGRA FIXA ponto 4): seed p/ quem tem root.
--    operacional-propostas-catalogos → Cadastros › Status e Situações de Proposta
-- ---------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'operacional-propostas-catalogos', true, true, true, false, true
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
      can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'operacional-propostas-catalogos', true, true, true, false, true
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
      can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
