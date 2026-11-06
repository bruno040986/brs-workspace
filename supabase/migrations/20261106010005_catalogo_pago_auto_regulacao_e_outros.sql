-- APLICADA em produção em 06/11/2026 pelo dono (editor SQL do Supabase; não consta em supabase_migrations). Arquivo preservado para o repositório refletir o banco.
-- Etapa 1 — ajustes de catálogo. Decisões do dono 06/11/2026.
--
-- 1) Status "PAGO COM AUTO REGULAÇÃO": grupo 'cancelado' -> 'pago' e libera_contratos -> true
--    (igual a PAGO e PROPOSTA INTEGRADA). O nome serve SÓ para achar a linha; a mudança é por id.
--    A app nunca testa nome de status (só grupo/flags).
--    propostas_credito.grupo é denormalizado: propaga para as propostas nesse status (em
--    06/11/2026 eram 0 propostas e 0 eventos com ele). Rollback no arquivo ROLLBACK.
-- 2) Vínculo: lista oficial = publicos_atendidos + "Outros". Insere só "Outros" se não existir
--    (CLT e Celetista já existem; nada mais é criado).

do $$
declare
  v_id uuid;
  v_n int;
begin
  select count(*) into v_n from public.propostas_status where nome = 'PAGO COM AUTO REGULAÇÃO';
  if v_n > 1 then
    raise exception 'propostas_status: % linhas com o nome PAGO COM AUTO REGULAÇÃO; ajuste manual', v_n;
  elsif v_n = 0 then
    raise notice 'propostas_status: PAGO COM AUTO REGULAÇÃO não encontrado; nada a fazer';
  else
    select id into v_id from public.propostas_status where nome = 'PAGO COM AUTO REGULAÇÃO';
    update public.propostas_status
       set grupo = 'pago', libera_contratos = true
     where id = v_id and (grupo <> 'pago' or libera_contratos is distinct from true);
    update public.propostas_credito
       set grupo = 'pago', updated_at = now()
     where status_proposta_id = v_id and grupo is distinct from 'pago';
    get diagnostics v_n = row_count;
    raise notice 'propostas_status % -> pago; propostas repropagadas: %', v_id, v_n;
  end if;
end $$;

insert into public.publicos_atendidos (nome, descricao)
select 'Outros', 'Vínculo fora da lista; a app guarda o texto livre em vinculo / vinculo_texto.'
 where not exists (select 1 from public.publicos_atendidos where lower(btrim(nome)) = 'outros');
