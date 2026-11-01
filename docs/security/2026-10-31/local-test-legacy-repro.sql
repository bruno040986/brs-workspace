create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- Espelho interno é SÓ para funcionários (e-mail corporativo). Usuários
  -- externos (portal do parceiro, CRM AlvoConsig) ficam de fora — a marca
  -- app_metadata.external nem sempre está presente no INSERT (GoTrue aplica
  -- depois), por isso a regra principal é o domínio do e-mail.
  if new.email is null
     or new.email not ilike '%@brspromotora.com.br'
     or new.email ilike '%@parceiro.brspromotora.com.br'
     or coalesce(new.raw_app_meta_data->>'external', '') <> '' then
    return new;
  end if;

  insert into public.users (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'admin'
  );
  return new;
end;
$function$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE POLICY acesso_total ON public.disciplinary_records FOR ALL TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "acesso medidas" ON public.disciplinary_records FOR ALL TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
GRANT ALL ON public.regras_portabilidade_ifs, public.regras_portabilidade_globais TO anon, authenticated, service_role;
INSERT INTO public.disciplinary_records(description) VALUES ('FIXTURE SINTETICA');
INSERT INTO public.regras_portabilidade_globais(default_port_coeff) VALUES (0.02);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT 'before_unprofiled_rh' AS scenario,count(*) AS visible FROM public.disciplinary_records;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT 'before_anon_rules' AS scenario,count(*) AS visible FROM public.regras_portabilidade_globais;
ROLLBACK;
