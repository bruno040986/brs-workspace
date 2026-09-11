-- Convênio BC: Banco(s) Pagador(es) da Folha (11/09/2026).
--
-- Pedido do Bruno, junto com o calendário de pagamento: mesma lista de bancos
-- já usada em Instituições Financeiras › "Banco Vinculado" (proxy server-side
-- `/api/lookups/banks` → BrasilAPI), mas aqui é N bancos por convênio (um
-- órgão pode pagar por mais de um banco), com um marcado como principal.
--
-- Tabela dedicada (não JSON) pra seguir o padrão já usado em
-- convenio_publicos/convenio_formas_contrato. Escrita é delete+insert na
-- action (não upsert) — evita o bug já conhecido de ON CONFLICT contra índice
-- parcial (ver migration 20260910224854).

create table if not exists public.convenio_bancos_pagadores (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  bank_code text not null,
  bank_name text not null,
  bank_ispb text null,
  bank_full_name text null,
  is_principal boolean not null default false,
  created_at timestamptz not null default now(),
  unique (convenio_id, bank_code)
);

create index if not exists convenio_bancos_pagadores_convenio_idx
  on public.convenio_bancos_pagadores (convenio_id);

-- Rede de segurança: no máximo 1 principal por convênio (a action já garante
-- isso antes de gravar; o índice barra qualquer escrita que escape da action).
create unique index if not exists convenio_bancos_pagadores_principal_idx
  on public.convenio_bancos_pagadores (convenio_id) where is_principal;

alter table public.convenio_bancos_pagadores enable row level security;

notify pgrst, 'reload schema';
