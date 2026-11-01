-- PRE-ROLLOUT M04: SOMENTE SELECTs (nenhuma escrita). Rodar no SQL editor/psql do projeto ANTES de aplicar as
-- migrations 20261101030000/035000/036000. Cada consulta deve voltar VAZIA (ou ser tratada antes do rollout).

-- 1. Internos ativos com e-mail fora do dominio exato @brspromotora.com.br (viram "negada" e nao entram)
select u.id, u.name, u.email from public.users u
 where u.active is not false and lower(u.email) !~ '^[^@\s]+@brspromotora\.com\.br$'
   and lower(u.email) not like '%@parceiro.brspromotora.com.br';

-- 2. E-mail divergente entre auth.users e public.users (o gate compara os dois)
select u.id, u.email as email_public, a.email as email_auth from public.users u join auth.users a on a.id = u.id
 where u.active is not false and lower(u.email) is distinct from lower(a.email);

-- 3. Internos ativos sem e-mail valido (o codigo de acesso nao teria destino)
select u.id, u.name, u.email from public.users u
 where u.active is not false and (u.email is null or u.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- 4. Usuario ativo em public.users sem linha em auth.users (sem login possivel)
select u.id, u.name, u.email from public.users u left join auth.users a on a.id = u.id where u.active is not false and a.id is null;

-- 5. Administradores com a permissao sistema-usuarios-root DIRETA (a remocao de autenticador conta so a direta).
--    Precisa voltar >= 2 linhas ativas; se so houver 1, atribua a segunda ANTES do rollout.
select up.user_id, u.name, u.email, u.active from public.user_permissions up join public.users u on u.id = up.user_id
 where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false);

-- 6. Quem tem root so via perfil (nao conta como direta): conferir se o Bruno esta aqui
select u.id, u.name, u.email from public.users u
 where u.active is not false and exists (select 1 from public.profile_permissions p where p.profile_id = u.profile_id and p.resource_name = 'sistema-usuarios-root')
   and not exists (select 1 from public.user_permissions up where up.user_id = u.id and up.resource_name = 'sistema-usuarios-root');

-- 7. Pre-requisitos (somente leitura): Resend ativo com remetente; MFA TOTP habilitado nao e consultavel por SQL (painel Auth)
select is_active, from_email is not null as tem_remetente, api_key is not null as tem_chave from public.resend_config;
