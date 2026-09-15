-- Amigoz — Fatia 3 (ajuste, 15/09/2026): a consulta unitária pode buscar
-- ofertas sem que o CPF tenha telefone/nascimento disponíveis (nem na
-- entrada, nem no cadastro do WeSales) — a API do Amigoz exige os dois pra
-- criar o cliente. Nesse caso o operador digita um valor na tela só pra
-- testar se há oferta (é comum querer ver a oferta sem ainda ter os dados
-- reais do cliente em mãos). Esta flag registra que o telefone/nascimento
-- usados NA CHAMADA foram informados como fictícios — pra nunca confundir
-- com dado real do cliente se um dia isso for espelhado de volta pro WeSales
-- (hoje `enviarOfertasParaWesales` não toca telefone/nascimento; a flag é só
-- rastreabilidade). Quando o operador marca como dado REAL, o valor é
-- gravado nas colunas normais (`telefone`/`nascimento_if`) e a flag fica
-- false; quando não se aplica (dado veio automático da IF/WeSales), fica null.

alter table public.if_higienizacao_itens
  add column if not exists ofertas_dados_ficticios boolean;

notify pgrst, 'reload schema';
