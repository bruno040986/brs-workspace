-- =============================================================================
-- AlvoConsig — limites de instâncias e regra de disparo por PARCEIRO
-- (03/09/2026, decisão Bruno × Opus 5)
--
-- Tudo isto hoje é constante no código do CRM:
--   • LIMITE_DISPARO = 10                          (lib/chat/actions.ts)
--   • receptiva: "uma por provedor" (1 Baileys + 1 Z-API)
--   • DISPARO_MIN_INSTANCIAS = 3                   (lib/crm/disparo.ts)
--   • DISPARO_MIN_TEMPLATES_POR_INSTANCIA = 3
--
-- Passa a ser definido pela BRS por parceiro, na aba AlvoConsig do Agente
-- Corban — mesma tela e mesma tabela onde já moram `habilitado` e
-- `max_atendentes`, que são exatamente o mesmo tipo de regra (teto numérico
-- que a BRS define e o CRM obedece).
--
-- Os DEFAULTS reproduzem o comportamento atual, então esta migration sozinha
-- não muda nada em produção: o CRM passa a ler do banco e encontra os mesmos
-- números que estavam no código.
--
-- Nota sobre receptivas: hoje o limite não é um número, é "uma por provedor".
-- Virar contagem total é o que permite ao Bruno liberar, por exemplo, duas
-- Baileys receptivas pro mesmo parceiro (números diferentes — o que nunca
-- pode é o MESMO número em duas instâncias, que foi a causa do incidente
-- "sessão substituída" de 01/09).
-- =============================================================================

alter table public.crm_parceiro_config
  add column if not exists max_instancias_receptivas integer not null default 2
    check (max_instancias_receptivas >= 0 and max_instancias_receptivas <= 20),
  add column if not exists max_instancias_disparo integer not null default 10
    check (max_instancias_disparo >= 0 and max_instancias_disparo <= 50),
  -- Regra 3+3 do Disparo de WhatsApp Não Oficial (migration 20260903144646):
  -- mínimo de números conectados e de templates POR número pra liberar o tipo
  -- de campanha. Serve pra apertar um parceiro específico que esteja
  -- queimando número, sem mexer no sistema inteiro.
  add column if not exists disparo_min_instancias integer not null default 3
    check (disparo_min_instancias >= 1 and disparo_min_instancias <= 50),
  add column if not exists disparo_min_templates_por_instancia integer not null default 3
    check (disparo_min_templates_por_instancia >= 1 and disparo_min_templates_por_instancia <= 20);

comment on column public.crm_parceiro_config.max_instancias_receptivas is
  'Teto de instâncias receptivas do parceiro (antes era a regra fixa "uma por provedor").';
comment on column public.crm_parceiro_config.max_instancias_disparo is
  'Teto de instâncias de disparo do parceiro (antes era a constante LIMITE_DISPARO = 10).';
comment on column public.crm_parceiro_config.disparo_min_instancias is
  'Mínimo de números de disparo CONECTADOS pra habilitar campanha de WhatsApp não oficial.';
comment on column public.crm_parceiro_config.disparo_min_templates_por_instancia is
  'Mínimo de templates por número — o total exigido é este valor x nº de números.';
