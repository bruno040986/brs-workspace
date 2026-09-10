-- ============================================================================
-- Convênio — endereçamento completo (ajuste pós-uso da Fase 1, 10/09/2026)
-- Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §2.1
--
-- O campo único `endereco` acumulava logradouro + bairro concatenados pelo
-- ViaCEP. Vira endereçamento completo (logradouro/numero/complemento/bairro),
-- no mesmo formato que o CNPJ.ws já devolve (normalizeCnpjWsCompleto) e que o
-- cadastro de Instituições Financeiras já usa — CNPJ.ws é a fonte primária,
-- ViaCEP fica de fallback quando o CEP é editado à mão.
--
-- Conferido antes do drop: os 7 convênios existentes tinham `endereco` NULL,
-- então nenhum dado é perdido.
--
-- `abrangencia` e `numero_servidores` continuam nesta mesma tabela, mas passam
-- a ser editados pela aba Base de Conhecimento (seção "geral") em vez do
-- cadastro básico — mudança só de UI/action, sem alteração de schema.
-- ============================================================================

alter table public.convenios
  add column if not exists logradouro text null,
  add column if not exists numero text null,
  add column if not exists complemento text null,
  add column if not exists bairro text null;

alter table public.convenios drop column if exists endereco;
