-- Somente banco descartável LOCAL. Schema mínimo representativo, não dump de produção.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role' $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}');
CREATE TABLE public.access_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.users(id uuid PRIMARY KEY REFERENCES auth.users(id), name text, email text, role text DEFAULT 'user', profile_id uuid REFERENCES access_profiles(id), active boolean DEFAULT true, employee_id uuid);
CREATE TABLE public.user_permissions(id uuid DEFAULT gen_random_uuid(), user_id uuid, resource_name text, can_view boolean DEFAULT false, can_include boolean DEFAULT false, can_edit boolean DEFAULT false, can_delete boolean DEFAULT false, can_activate_inactivate boolean DEFAULT false);
CREATE TABLE public.profile_permissions(id uuid DEFAULT gen_random_uuid(), profile_id uuid, resource_name text, can_view boolean DEFAULT false, can_include boolean DEFAULT false, can_edit boolean DEFAULT false, can_delete boolean DEFAULT false, can_activate_inactivate boolean DEFAULT false);
CREATE TABLE public.disciplinary_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid, type text, description text, date date, created_at timestamptz DEFAULT now());
CREATE TABLE public.financial_institutions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.convenios(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
