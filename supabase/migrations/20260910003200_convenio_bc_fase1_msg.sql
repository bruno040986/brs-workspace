-- Convênio BC Fase 1: ajuste cosmético das mensagens das triggers R1/R4 (formatação do %)

create or replace function public.convenio_bc_valida_margens()
returns trigger language plpgsql as $$
declare v_teto numeric(5,2); v_soma numeric;
begin
  select max_comprometimento_salarial into v_teto from public.convenios where id = new.convenio_id;
  if v_teto is null then return new; end if;
  select coalesce(sum(percentual_margem), 0) into v_soma
  from public.convenio_formas_contrato where convenio_id = new.convenio_id;
  if v_soma > v_teto then
    raise exception 'A soma das margens destinadas (%) excede o teto de comprometimento do convênio (%).', v_soma || '%', v_teto || '%'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.convenio_bc_valida_forma_if()
returns trigger language plpgsql as $$
declare
  v_convenio uuid; v_teto_forma numeric(5,2); v_tem_forma boolean;
  v_min integer; v_max integer; v_publico uuid; v_qtd_publico_if integer;
begin
  select convenio_id into v_convenio from public.convenio_instituicoes where id = new.convenio_instituicao_id;

  -- R3 forma permitida no convênio (+ teto da forma para R4)
  select true, percentual_margem into v_tem_forma, v_teto_forma
  from public.convenio_formas_contrato
  where convenio_id = v_convenio and forma_contrato_id = new.forma_contrato_id;
  if v_tem_forma is not true then
    raise exception 'Forma de contrato não está entre as formas permitidas do convênio.' using errcode = 'check_violation';
  end if;

  -- R4 margem considerada ≤ margem destinada pelo convênio
  if new.margem_considerada is not null and v_teto_forma is not null and new.margem_considerada > v_teto_forma then
    raise exception 'Margem considerada (%) excede a margem destinada pelo convênio a esta forma (%).', new.margem_considerada || '%', v_teto_forma || '%'
      using errcode = 'check_violation';
  end if;

  -- R5 prazos dentro do intervalo geral
  select prazo_minimo_geral, prazo_maximo_geral into v_min, v_max from public.convenios where id = v_convenio;
  if (new.prazo_minimo is not null and v_min is not null and new.prazo_minimo < v_min)
     or (new.prazo_maximo is not null and v_max is not null and new.prazo_maximo > v_max) then
    raise exception 'Prazo fora do intervalo geral do convênio (% a % meses).', v_min, v_max using errcode = 'check_violation';
  end if;

  -- R6 públicos restritos ⊆ público do vínculo (ou do convênio, se o vínculo não restringe)
  if new.publicos_restritos is not null then
    select count(*) into v_qtd_publico_if from public.convenio_instituicao_publicos where convenio_instituicao_id = new.convenio_instituicao_id;
    foreach v_publico in array new.publicos_restritos loop
      if v_qtd_publico_if > 0 then
        if not exists (select 1 from public.convenio_instituicao_publicos
                       where convenio_instituicao_id = new.convenio_instituicao_id and publico_id = v_publico) then
          raise exception 'Público restrito da forma não está entre os públicos atendidos pela instituição neste convênio.' using errcode = 'check_violation';
        end if;
      elsif not exists (select 1 from public.convenio_publicos where convenio_id = v_convenio and publico_id = v_publico) then
        raise exception 'Público restrito da forma não está entre os públicos elegíveis do convênio.' using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end $$;
