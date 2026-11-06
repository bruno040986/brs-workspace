-- referência de rollback, NÃO é migration
-- ROLLBACK MANUAL da Etapa 1 (NÃO é migration; não copiar para supabase/migrations). Ver README-etapa1.md
-- ROLLBACK da Etapa 1 (rodar na ORDEM INVERSA: 5, 4, 3, 2, 1). Cada bloco é independente.
-- Apagar colunas/tabelas PERDE o que a app gravou nelas: fazer só antes da app usar; depois
-- disso, a saída é rollback da app.

-- 5) catálogo
update public.propostas_status set grupo = 'cancelado', libera_contratos = false
 where id = 'e3904e7e-448f-45ea-b421-1bd7825be9b5';            -- id conferido em 06/11/2026
-- (se alguma proposta foi repropagada para 'pago' pela 5 — em 06/11 eram 0 — voltar o grupo dela)
delete from public.publicos_atendidos p
 where lower(btrim(p.nome)) = 'outros'
   and p.created_at >= '2026-11-06'
   and not exists (select 1 from public.crm_contatos c where c.publico_id = p.id)
   and not exists (select 1 from public.propostas_credito pc where pc.publico_id = p.id)
   and not exists (select 1 from public.convenio_publicos cp where cp.publico_id = p.id);

-- 4) trigram
drop index if exists public.propostas_nome_trgm_idx, public.propostas_cpf_trgm_idx,
  public.propostas_id_externo_trgm_idx, public.propostas_contrato_trgm_idx, public.propostas_telefone_trgm_idx,
  public.crm_contatos_nome_trgm_idx, public.crm_contatos_cpf_trgm_idx, public.crm_contatos_telefone_trgm_idx,
  public.crm_contatos_email_trgm_idx, public.crm_solic_payload_nome_trgm_idx, public.crm_solic_pessoa_cpf_trgm_idx;
-- drop extension if exists pg_trgm;   -- só se nada mais usar (conferir pg_depend antes)

-- 3) índices
drop index if exists public.propostas_credito_solicitacao_idx, public.propostas_pagas_mes_idx,
  public.propostas_canceladas_mes_idx, public.crm_solicitacoes_op_canceladas_mes_idx;

-- 2) notas e linha do tempo (APAGA notas e leituras)
drop view if exists public.crm_casos_linha_tempo;
drop table if exists public.crm_casos_notas_destinatarios, public.crm_casos_notas;
drop function if exists app_private.crm_casos_notas_leitura_guarda();
drop index if exists public.propostas_credito_id_solicitacao_uq, public.crm_solicitacoes_eventos_id_solicitacao_uq,
  public.propostas_eventos_id_proposta_uq;

-- 1) colunas (APAGA com_seguro, pago_em, oferta_id, publico_id, vinculo_texto)
-- >>> ANTES de qualquer `drop column` abaixo: reaplicar a RPC antiga (corpo anterior, md5 d949bb1f84431543e033508658849019):
-- >>> brs-alvoconsig/docs/migrations-pendentes/20261028010000_propostas_editar_campos.sql
-- >>> (sem isso a RPC atual referencia colunas que não existem e falha em toda edição).
alter table public.propostas_credito drop constraint if exists propostas_credito_pago_em_chk,
  drop constraint if exists propostas_credito_vinculo_texto_chk, drop constraint if exists propostas_credito_oferta_tenant_fk,
  drop column if exists com_seguro, drop column if exists pago_em, drop column if exists oferta_id,
  drop column if exists publico_id, drop column if exists vinculo_texto;
alter table public.crm_solicitacoes_operacionais drop constraint if exists crm_solic_resposta_tipada_chk,
  drop constraint if exists crm_solic_payload_publico_chk;
alter table public.crm_contatos drop column if exists publico_id;
drop index if exists public.crm_ofertas_id_parceiro_uq;
notify pgrst, 'reload schema';
