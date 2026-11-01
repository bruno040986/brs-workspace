-- Revisão independente em schema mínimo local, sem dados reais.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-4000-8000-000000000002','rh@brspromotora.com.br'),
 ('10000000-0000-4000-8000-000000000003','portabilidade@brspromotora.com.br'),
 ('10000000-0000-4000-8000-000000000004','inativo@brspromotora.com.br'),
 ('10000000-0000-4000-8000-000000000005','viewer@brspromotora.com.br');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.users WHERE role='admin'), 'corporate signup does not create admin');
INSERT INTO public.users(id,email,name,role,active)
SELECT id,email,'SINTETICO','user', id <> '10000000-0000-4000-8000-000000000004'::uuid FROM auth.users
ON CONFLICT(id) DO UPDATE SET role='user',active=excluded.active;
INSERT INTO public.user_permissions(user_id,resource_name,can_view,can_include,can_edit,can_delete)
VALUES
 ('10000000-0000-4000-8000-000000000002','rh-medidas-disciplinares',true,true,true,true),
 ('10000000-0000-4000-8000-000000000003','operacional-simulador-portabilidade',true,true,true,true),
 ('10000000-0000-4000-8000-000000000004','rh-medidas-disciplinares',true,true,true,true),
 ('10000000-0000-4000-8000-000000000004','operacional-simulador-portabilidade',true,true,true,true),
 ('10000000-0000-4000-8000-000000000005','rh-medidas-disciplinares',true,false,false,false);
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
-- Anon may be blocked by GRANT or RLS; both deny confidential reads.
DO $$ BEGIN
 BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.disciplinary_records),'anon sees no RH');
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon RH denied by grant'; END;
 BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.regras_portabilidade_globais),'anon sees no rules');
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon rules denied by grant'; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.disciplinary_records),'unprofiled cannot see RH');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.regras_portabilidade_globais),'unprofiled cannot see rules');
DO $$ BEGIN
 BEGIN
 INSERT INTO public.disciplinary_records(description) VALUES('FORBIDDEN');
 RAISE EXCEPTION 'FAIL: unprofiled could insert RH';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: unprofiled RH insert denied'; END;
 BEGIN
 INSERT INTO public.regras_portabilidade_globais(default_port_coeff) VALUES(0.03);
 RAISE EXCEPTION 'FAIL: unprofiled could insert rules';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: unprofiled rules insert denied'; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.disciplinary_records),'RH authorized sees seeded row');
INSERT INTO public.disciplinary_records(description) VALUES('AUTHORIZED');
WITH edited AS (UPDATE public.disciplinary_records SET description='EDITED' WHERE description='AUTHORIZED' RETURNING id) SELECT pg_temp.assert_true((SELECT count(*)=1 FROM edited),'RH edit works');
WITH deleted AS (DELETE FROM public.disciplinary_records WHERE description='EDITED' RETURNING id) SELECT pg_temp.assert_true((SELECT count(*)=1 FROM deleted),'RH delete works');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.regras_portabilidade_globais),'RH lacks credit permission');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.regras_portabilidade_globais),'credit authorized sees seeded row');
INSERT INTO public.regras_portabilidade_globais(default_port_coeff) VALUES(0.03);
DO $$ BEGIN
 BEGIN
 UPDATE public.regras_portabilidade_globais SET default_port_coeff=0.04;
 RAISE EXCEPTION 'FAIL: historical coefficients mutable';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: history update denied'; END;
 BEGIN
 DELETE FROM public.regras_portabilidade_globais;
 RAISE EXCEPTION 'FAIL: historical coefficients deletable';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: history delete denied'; END;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.disciplinary_records),'credit lacks RH permission');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.disciplinary_records),'inactive RH denied');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.regras_portabilidade_globais),'inactive credit denied');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.disciplinary_records),'RH viewer can view');
WITH edited AS (UPDATE public.disciplinary_records SET description='FORBIDDEN' RETURNING id) SELECT pg_temp.assert_true((SELECT count(*)=0 FROM edited),'RH viewer cannot edit');
WITH deleted AS (DELETE FROM public.disciplinary_records RETURNING id) SELECT pg_temp.assert_true((SELECT count(*)=0 FROM deleted),'RH viewer cannot delete');
ROLLBACK;
