-- Correção de dados (bug 24/08): comissao_ajuste_adicional passou pelo
-- normalizador errado e "0100" (1,00%) virou "100.00" (relido como 10,00%).
-- Converte valores decimais corrompidos de volta para a sequência de
-- centésimos e recalcula o cache imposto_comissao_percent afetado.

update public.financial_institutions fi
set fiscal_data = jsonb_set(
      fi.fiscal_data,
      '{configurations}',
      (
        select jsonb_agg(
          case
            when c ->> 'comissao_ajuste_adicional' ~ '^\d+\.\d+$'
              then jsonb_set(
                c,
                '{comissao_ajuste_adicional}',
                to_jsonb(lpad(floor((c ->> 'comissao_ajuste_adicional')::numeric)::bigint::text, 4, '0'))
              )
            else c
          end
        )
        from jsonb_array_elements(fi.fiscal_data -> 'configurations') as c
      )
    ),
    updated_at = now()
where exists (
  select 1
  from jsonb_array_elements(fi.fiscal_data -> 'configurations') as c
  where c ->> 'comissao_ajuste_adicional' ~ '^\d+\.\d+$'
);

-- Recalcula o cache do Santander (4,50 de ISS+retenções + 1,00 de ajuste).
update public.financial_institutions
set imposto_comissao_percent = 5.500
where id = 'b93e0831-b1e8-44ea-ac41-38559a2aa940';
