-- Amigoz — convênio BRS com VÁRIAS variantes na IF (15/09/2026).
--
-- Achado do Bruno: o Amigoz fatia o mesmo convênio real em mais de uma
-- entrada técnica (ex.: "INSS" e "INSS - Aposentadoria por Invalidez" são
-- o mesmo INSS pra nós, mas 2 ids diferentes lá). O vínculo 1-para-1 de
-- if_convenio_mapeamento (1 convênio BRS = 1 convênio na IF) não aguenta
-- isso. Inverte a unicidade: cada VARIANTE da IF aponta pra um único
-- convênio BRS, mas o convênio BRS pode ter N variantes.
--
-- Estratégia de consulta (decisão do Bruno): o operador não sabe de
-- antemão qual variante vale pra cada CPF — o worker tenta TODAS as
-- variantes do convênio em sequência (ordenadas por `ordem`) até achar
-- margem; guarda qual variante respondeu no item.
--
-- Deliberadamente NÃO reaproveita `orgaos_empregadores`: aquilo é a
-- divisão REAL do convênio (departamento/empregador), usada pra decidir
-- quais instituições atendem qual órgão. "INSS - Aposentadoria por
-- Invalidez" não é um órgão do INSS — é a IF fatiando a própria consulta
-- técnica. Misturar os dois conceitos corromperia o cadastro de órgãos.

alter table public.if_convenio_mapeamento
  drop constraint if exists if_convenio_mapeamento_instituicao_financeira_id_convenio_i_key;

alter table public.if_convenio_mapeamento
  add column if not exists rotulo text,       -- nome de exibição da variante (padrão: convenio_externo_nome)
  add column if not exists ordem integer not null default 0; -- ordem de tentativa (menor primeiro)

alter table public.if_convenio_mapeamento
  add constraint if_convenio_mapeamento_if_convenio_externo_uidx
  unique (instituicao_financeira_id, convenio_externo_id);

create index if not exists idx_if_convenio_mapeamento_convenio on public.if_convenio_mapeamento (convenio_id, ordem);

-- O lote guarda o convênio BRS; a resolução das variantes passa a ser
-- feita em tempo de execução pelo worker (se sabia o valor antes de a IF
-- ter mais de uma variante, a coluna passa a ser só informativa/legado).
alter table public.if_higienizacao_lotes
  alter column convenio_externo_id drop not null;

-- Qual variante de fato respondeu (a que achou margem, ou a última
-- tentada) — pra auditoria e pra planilha.
alter table public.if_higienizacao_itens
  add column if not exists convenio_externo_usado text,
  add column if not exists averbadora_usada integer;

notify pgrst, 'reload schema';
