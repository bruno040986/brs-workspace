-- Links da topbar unificados no banco (decisão 02/09/2026): o catálogo que
-- era fixo no código dos cards da home vira linhas de `sector_links`,
-- gerenciáveis pela tela /links (permissão sistema-links). Idempotente por
-- (sector_id, url) — não duplica o que o Bruno já tiver cadastrado.

insert into public.sector_links (sector_id, label, url, is_external)
select v.sector_id, v.label, v.url, true
from (values
  -- Administrativo
  ('adm', 'Documentos da Empresa', 'https://drive.google.com/drive/folders/1VLre1sfTrywcZUwt1Q1_zdeXVyMFjhKu?usp=sharing'),
  ('adm', 'Documentos do Sócio', 'https://drive.google.com/drive/folders/1PSvm8lQABhusuOuMSgB0SHM3U-iUcl5Y?usp=sharing'),
  ('adm', 'Correios', 'https://empresas.correios.com.br/#/login'),
  -- Financeiro
  ('fin', 'Conta Azul', 'https://login.contaazul.com/#/'),
  ('fin', 'BluePay', 'https://app.bluepaysolutions.com.br/auth/users/sign_in'),
  ('fin', 'Portal Nacional da NFSe', 'https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional'),
  ('fin', 'Planilhas de Conversão de Dados', 'https://drive.google.com/drive/folders/1fbp8SneQfQ4wjE0gsBFPpF2n1Gf4BcEU?usp=sharing'),
  ('fin', 'Portho Contabilidade', 'https://vip.acessorias.com/porthocontabil'),
  -- RH
  ('rh', 'QuarkRH Gestão', 'https://rh-colaborador.quark.tec.br/'),
  ('rh', 'Canal de Denúncias Anônimas', 'https://rh-colaborador.quark.tec.br/app/colaborador/denuncia/cadastrar'),
  ('rh', 'Regimento Interno', 'https://drive.google.com/drive/folders/1cbLHQJdTUMOQkPS91YTXP4Ul_KL_Ib4H?usp=sharing'),
  ('rh', 'Quadro de Cargos e Salários', 'https://docs.google.com/spreadsheets/d/1NzUXmVycP4jZ6-IVlNe839nzODsy5vJ7/edit?usp=sharing&ouid=102020987086611987742&rtpof=true&sd=true'),
  -- Operacional
  ('ops', 'Sistema ARW', 'https://brspromotora.arwconsig.com.br/'),
  ('ops', 'Assinafy', 'https://www.assinafy.com.br/'),
  ('ops', 'Nuvidio Gestão', 'https://empresa.nuvidio.com/login'),
  ('ops', 'Nuvidio Atendimento', 'https://atendimento.nuvidio.com/login'),
  ('ops', 'Digisac', 'https://brspromotora.digisac.chat/login'),
  ('ops', 'Lemit', 'https://lemitti.com/'),
  -- Comercial
  ('com', 'Promosys', 'https://www.promosysweb.com/apex/f?p=101:LOGIN_DESKTOP:2083723502586:::::'),
  ('com', 'Mailing Higienizado (Drive)', 'https://drive.google.com/drive/folders/1iIT-CtmzHwtYfeFzPFNNCTjI6YrCaYEz?usp=drive_link'),
  -- Marketing
  ('mkt', 'Drive BRS Promotora', 'https://drive.google.com/drive/folders/15gePuWUSUQpDPG-0MVLjbw3TsBu0hD3Z?usp=sharing'),
  ('mkt', 'Drive BRS Gestão', 'https://drive.google.com/drive/folders/17Zo6_d-1Q9z-If3boE_ln2fAB07j54OP?usp=sharing'),
  ('mkt', 'Logotipos de Instituições', 'https://drive.google.com/drive/folders/1Q74oHJKsj6kWGGsesHqMHV5uuZbO_rNZ?usp=sharing'),
  ('mkt', 'Instagram', 'https://www.instagram.com/brspromotora'),
  ('mkt', 'Facebook', 'https://www.facebook.com/brspromotora'),
  -- Tecnologia
  ('tec', 'WeSales', 'https://app.wesales.com.br/'),
  ('tec', 'CallFace', 'https://app.callface.ai/'),
  ('tec', 'Vende.AI', 'https://ia.vendeaitecnologia.com.br/'),
  ('tec', 'Vercel', 'https://vercel.com/'),
  ('tec', 'Supabase', 'https://supabase.com/dashboard')
) as v(sector_id, label, url)
where not exists (
  select 1 from public.sector_links sl
  where sl.sector_id = v.sector_id and sl.url = v.url
);

notify pgrst, 'reload schema';
