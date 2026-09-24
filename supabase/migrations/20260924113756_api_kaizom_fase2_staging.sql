-- API Kaizom (ex-"Motor de Crédito (MySQL)"), Fase 2 — staging + revisão
-- humana + envio ao WeSales. Decisões D1–D10 em
-- docs/HANDOFF-MOTOR-CREDITO-FASE-2.md §7 (revisão Fable 11/09/2026).
--
-- Fluxo: cron lê `bancobrs.consultas` pelo cursor `id` → grava aqui (estado
-- por LINHA) → operador aprova/rejeita na tela → só o aprovado vai pro
-- WeSales, pela mesma função de "foto de margem" do import Excel. Nunca
-- direto ao WeSales.

-- D5/D10: lease contra execução dupla do cron + carimbos da última leitura.
alter table public.motor_credito_mysql_config
  add column if not exists lease_ate timestamptz,
  add column if not exists lease_por text,
  add column if not exists ultima_leitura_em timestamptz,
  add column if not exists ultima_leitura_qtd integer;

-- D2: de-para Kaizom → Workspace. A Kaizom grava em `consultas.convenio` o
-- nome do convênio como aparece no higienizador dela (ex.: "GOVERNO SP");
-- aqui fica esse texto NORMALIZADO (trim, maiúsculas, sem acento) — o
-- leitor casa `convenio_externo` com esta coluna. Editável no formulário do
-- Convênio ao lado do Código ARW.
alter table public.convenios
  add column if not exists codigo_motor_credito text null;
create unique index if not exists convenios_codigo_motor_credito_unique_idx
  on public.convenios (codigo_motor_credito)
  where deleted_at is null and codigo_motor_credito is not null;

-- D6: staging, uma linha por consulta do MySQL (mysql_id = `consultas.id`).
create table if not exists public.motor_credito_consultas (
  id uuid primary key default gen_random_uuid(),
  mysql_id bigint not null unique,
  tarefa_id bigint null,
  cpf text null,
  nome text null,
  matricula text null,
  convenio_externo text null,
  convenio_id uuid null references public.convenios (id),
  orgao text null,
  lotacao text null,
  vinculo text null,
  cargo text null,
  admissao date null,
  mes_referencia text null,
  prox_folha date null,
  margem_novo_bruta numeric(12,2) null,
  margem_novo_disp numeric(12,2) null,
  margem_rmc_bruta numeric(12,2) null,
  margem_rmc_disp numeric(12,2) null,
  margem_rcc_bruta numeric(12,2) null,
  margem_rcc_disp numeric(12,2) null,
  valor_margem numeric(12,2) null,
  valor_disponivel numeric(12,2) null,
  sucesso boolean not null default true,
  observacao text null,
  consultado_em timestamptz null,
  dados_extras jsonb null,
  -- pendente → aprovada/rejeitada (revisão) → enviando → enviada/erro_envio.
  -- falha = sucesso=0 no MySQL (D4): visível com o motivo, nunca aprovável.
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovada', 'rejeitada', 'falha', 'enviando', 'enviada', 'erro_envio')),
  revisado_por uuid null references public.users (id),
  revisado_em timestamptz null,
  crm_import_id uuid null references public.crm_imports (id),
  erro_envio text null,
  wesales_contact_id text null,
  created_at timestamptz not null default now()
);
create index if not exists motor_credito_consultas_status_idx on public.motor_credito_consultas (status);
create index if not exists motor_credito_consultas_tarefa_idx on public.motor_credito_consultas (tarefa_id);
create index if not exists motor_credito_consultas_cpf_idx on public.motor_credito_consultas (cpf);

-- Só servidor (admin client) lê/escreve — RLS ligada sem policy.
alter table public.motor_credito_consultas enable row level security;

-- D9: permissão nova `alvoconsig-motor-credito` (submenu em Gestão de Leads;
-- view = ver staging, can_include = aprovar/rejeitar/enviar). Seed pra quem
-- tem `sistema-usuarios-root` — REGRA FIXA ponto 4.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'alvoconsig-motor-credito', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'alvoconsig-motor-credito', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
