-- Amigoz — Fatia 3: ofertas disponíveis (simulação em tempo real) → Oportunidade
-- no WeSales, mesmo mecanismo do REFIN. Ver docs/ROTEIRO-AMIGOZ-FATIA-3-OFERTAS.md.
--
-- Sem tabela nova: a oferta mora no ITEM do lote de higienização enquanto é
-- lote; a versão "oficial" (o inventário lido pela campanha) é a Oportunidade
-- no WeSales — igual ao REFIN. Nenhuma permissão nova (reusa
-- alvoconsig-higienizacao-amigoz da Fatia 2).

alter table public.if_higienizacao_lotes
  add column if not exists buscar_ofertas boolean not null default false,
  add column if not exists itens_com_oferta integer not null default 0;

alter table public.if_higienizacao_itens
  add column if not exists cliente_externo_id text,          -- id do cliente na IF (Amigoz: cliente.id de POST /api/cliente)
  add column if not exists ofertas jsonb,                    -- OfertaNormalizada[] (com `bruto` dentro, ver src/lib/if-credito/ofertas.ts)
  add column if not exists ofertas_status text check (ofertas_status in ('pendente','ok','sem_oferta','erro')),
  add column if not exists ofertas_erro text,
  add column if not exists ofertas_consultadas_em timestamptz,
  add column if not exists wesales_ofertas_em timestamptz;   -- carimbo de "virou Oportunidade"

-- crm_ofertas (migration 20260829100000) só aceitava novo/cartao_rmc/cartao_rcc/
-- refin — precisa aceitar 'saque_complementar' pro inventário da API (seção 6).
-- Constraint sem nome explícito na criação: Postgres nomeia <tabela>_<coluna>_check.
alter table public.crm_ofertas drop constraint if exists crm_ofertas_produto_check;
alter table public.crm_ofertas add constraint crm_ofertas_produto_check
  check (produto in ('novo', 'cartao_rmc', 'cartao_rcc', 'saque_complementar', 'refin'));

notify pgrst, 'reload schema';
