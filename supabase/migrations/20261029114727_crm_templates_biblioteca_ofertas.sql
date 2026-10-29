-- Biblioteca do sistema refeita para lead frio (ofertas). Troca as 32 linhas antigas
-- (primeira-abordagem-*, follow-up-*, reativacao-*, convenios-*, pos-venda-*,
-- portabilidade-*, refinanciamento-*) por 90 novas com chave oferta-*.
-- As antigas nao estavam em uso (campanha/fila): sao so arquivadas (arquivado_em), sem
-- tocar em ativo nem deleted_at. Idempotente: reexecutar nao duplica nem rearquiva.
--
-- ROLLBACK:
--   update public.crm_templates_mensagem set arquivado_em = null
--    where sistema and deleted_at is null and chave !~ '^oferta-';
--   update public.crm_templates_mensagem set arquivado_em = now()
--    where sistema and deleted_at is null and chave like 'oferta-%';
--   notify pgrst, 'reload schema';

-- 1) arquiva a biblioteca antiga
update public.crm_templates_mensagem
   set arquivado_em = now()
 where sistema and arquivado_em is null and deleted_at is null and chave !~ '^oferta-';

-- 2) insere a nova
insert into public.crm_templates_mensagem
  (agente_parceiro_id, canal, chave, categoria, nome, corpo, variaveis, ativo, sistema)
select null, 'whatsapp_nao_oficial', v.chave, v.categoria, v.nome, v.corpo, v.variaveis, true, true
from (values
  ('oferta-geral-01', 'Oferta geral de consignado', 'Oferta geral — pergunta direta', $tpl$Olá {{primeiro_nome}}
Aqui é da equipe *{{parceiro}}*. Trabalhamos com crédito consignado e podemos ver, sem compromisso, quanto você consegue contratar com desconto em folha.

Podemos falar por aqui?

Se preferir não receber mais, responda SAIR.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-geral-02', 'Oferta geral de consignado', 'Oferta geral — apresentação do parceiro', $tpl$Oi {{primeiro_nome}} tudo bem?
{{parceiro}} trabalha com crédito consignado em vários bancos. A gente consulta sua margem, compara as opções e explica parcela, prazo e custo total (CET) antes de qualquer decisão.

Quer que eu faça essa consulta para você?

Não quer mais mensagens nossas? Escreva PARAR.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-geral-03', 'Oferta geral de consignado', 'Oferta geral — vantagem do desconto em folha', $tpl${{primeiro_nome}}
Você sabia que no consignado a parcela sai direto da folha ou do benefício? Não tem boleto para lembrar e a parcela fica fixa até o fim do contrato.

Aqui na equipe {{parceiro}} fazemos uma simulação gratuita para você ver se faz sentido. Posso simular?

Para sair da nossa lista, basta mandar SAIR.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-geral-04', 'Oferta geral de consignado', 'Oferta geral — trocar dívida cara', $tpl$Pagando juros de cartão de crédito ou cheque especial?
O consignado costuma ter custo menor que essas linhas, porque a parcela é descontada em folha. {{parceiro}} simula e mostra o CET para você comparar com o que paga hoje.

Vamos ver os números juntos?

Caso não queira receber, é só responder PARAR.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-05', 'Oferta geral de consignado', 'Oferta geral — pergunta de qualificação do perfil', $tpl$Oi, aqui é da equipe {{parceiro}}.
Trabalhamos com crédito consignado e, para te passar a informação certa, preciso saber uma coisa: você é *aposentado ou pensionista do INSS*, *servidor público* ou *trabalhador CLT*?

Me conta que eu verifico o que existe para o seu caso.

Se não for do seu interesse, mande SAIR e não enviamos mais.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-06', 'Oferta geral de consignado', 'Oferta geral — lista do que a consulta mostra', $tpl$Olá {{primeiro_nome}} tudo certo?
Com {{parceiro}}, a consulta de consignado mostra três coisas:
• quanto de margem você tem disponível
• valor da parcela e prazo
• custo efetivo total (CET)

Sem compromisso de contratar. Quer que eu consulte?

Prefere não receber? Responda SAIR que tiramos seu número.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-geral-07', 'Oferta geral de consignado', 'Oferta geral — convite a simular', $tpl$Que tal fazer uma simulação de crédito consignado sem compromisso?

A equipe {{parceiro}} calcula com base na sua margem e te mostra valor, parcela e CET. Você decide com calma se quer seguir.

É só responder SIMULAR.
Se não quiser mais contato, responda REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-08', 'Oferta geral de consignado', 'Oferta geral — parcela fixa em destaque', $tpl$*Parcela fixa do início ao fim.*
Essa é uma das características do crédito consignado: o valor não muda e é descontado direto na folha ou no benefício.

Quer saber quanto daria no seu caso? {{parceiro}} faz a conta para você.

Para não receber mais mensagens, digite SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-09', 'Oferta geral de consignado', 'Oferta geral — mensagem de uma linha', $tpl$Oi {{primeiro_nome}} posso consultar sua margem de crédito consignado sem compromisso? Quem fala é a equipe {{parceiro}}.

Se não quiser, responda SAIR e encerramos por aqui.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-geral-10', 'Oferta geral de consignado', 'Oferta geral — plano parado por falta de dinheiro', $tpl$Tem algum plano parado por falta de dinheiro? Uma reforma, quitar umas contas, ajudar alguém da família?

O crédito consignado pode ajudar, com parcela descontada em folha. {{parceiro}} faz a simulação e explica tudo antes de você decidir.

Quer ver quanto daria?

Se não quiser mais estas mensagens, responda REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-11', 'Oferta geral de consignado', 'Oferta geral — transparência do CET', $tpl$Tudo bem por aí?
Antes de falar em valores, o time {{parceiro}} mostra o custo efetivo total (CET), o número de parcelas e o valor de cada uma. Assim você compara e decide sem pressão.

Posso fazer uma simulação de consignado para você?

Se preferir, responda SAIR e não falamos mais sobre isso.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-12', 'Oferta geral de consignado', 'Oferta geral — pergunta sim ou não', $tpl$Pergunta rápida: você já fez crédito consignado alguma vez?

Pergunto porque trabalhamos com essa linha aqui na equipe {{parceiro}} e podemos consultar o que existe para você hoje, sem compromisso.

Responda SIM ou NÃO.
E se não quiser mais mensagens, mande SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-13', 'Oferta geral de consignado', 'Oferta geral — vários bancos numa consulta só', $tpl$Consignado sem precisar ir de banco em banco.
A equipe {{parceiro}} olha as opções dos bancos com que trabalha e traz a que se encaixa no seu orçamento, com tudo explicado.

{{primeiro_nome}}
Posso começar a consulta?

Para não receber mais, é só escrever PARE.$tpl$, array['parceiro','primeiro_nome']::text[]),
  ('oferta-geral-14', 'Oferta geral de consignado', 'Oferta geral — equipe se apresenta', $tpl$Aqui é a equipe {{parceiro}}.
Entramos em contato porque trabalhamos com crédito consignado e podemos ver, sem custo, quanto você teria disponível na sua margem.

Tem um minutinho para a gente explicar como funciona?

Se não tiver interesse, responda SAIR e respeitamos sua escolha.$tpl$, array['parceiro']::text[]),
  ('oferta-geral-15', 'Oferta geral de consignado', 'Oferta geral — convite leve com emoji', $tpl$Passando para te apresentar uma opção de crédito 👋
{{parceiro}} atende quem quer conhecer o crédito consignado. A consulta é gratuita e você só segue se quiser.

Vamos ver o que existe para você?

Não quer receber? Basta responder SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-01', 'Convênio e vínculo', 'Convênio — pergunta direta sobre o vínculo', $tpl$Você tem vínculo com algum órgão público, prefeitura, governo do estado ou INSS?
Se tiver, pode existir a possibilidade de crédito consignado com desconto em folha, e a equipe {{parceiro}} consulta isso para você sem compromisso.

Me conta qual é o seu vínculo?

Para não receber mais, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-02', 'Convênio e vínculo', 'Convênio — servidor municipal', $tpl$Olá {{primeiro_nome}}
Você é servidor da prefeitura da sua cidade? Muitas prefeituras têm convênio de consignado, e {{parceiro}} atende servidores municipais com consulta de margem e simulação.

Quer saber se a sua prefeitura tem convênio ativo?

Caso não queira mais mensagens, responda SAIR.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-convenio-03', 'Convênio e vínculo', 'Convênio — servidor estadual', $tpl$Servidor do estado, esta mensagem é para você.
{{parceiro}} trabalha com o consignado dos governos estaduais: com a sua autorização, verificamos a margem no convênio e simulamos parcela, prazo e CET.

Você é servidor estadual? Posso consultar?

Se não for do seu interesse, é só mandar PARAR.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-04', 'Convênio e vínculo', 'Convênio — servidor federal (SIAPE)', $tpl$Oi {{primeiro_nome}}
Para servidores federais (SIAPE), o crédito consignado tem regras próprias de margem. A equipe {{parceiro}} consulta, com a sua autorização, quanto está disponível e apresenta as opções com o CET.

Você é servidor federal ativo ou aposentado?

Não quer receber? Responda PARE.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-convenio-05', 'Convênio e vínculo', 'Convênio — aposentado e pensionista do INSS', $tpl$Aposentado ou pensionista do INSS?
O benefício também permite crédito consignado, com a parcela descontada direto no pagamento mensal. {{parceiro}} simula e explica tudo antes de você decidir.

Posso ver o que existe para o seu benefício?

Se preferir não receber, responda REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-06', 'Convênio e vínculo', 'Convênio — militares e forças de segurança', $tpl$Militar das Forças Armadas, da PM ou do Corpo de Bombeiros?
Essas carreiras costumam ter convênio de consignado, e o time {{parceiro}} atende esse público com simulação sem compromisso.

Qual é a sua corporação? Assim eu já verifico o convênio certo.

Não deseja mais mensagens? Escreva SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-07', 'Convênio e vínculo', 'Convênio — trabalhador CLT', $tpl$Trabalha com carteira assinada?
Hoje trabalhadores CLT também podem ter acesso ao crédito consignado, com a parcela descontada no salário. {{parceiro}} verifica se o seu vínculo e a sua empresa permitem.

Quer que eu confira para você?

Para parar de receber estas mensagens, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-08', 'Convênio e vínculo', 'Convênio — prazos mais longos para quem tem vínculo', $tpl${{primeiro_nome}}
Quem tem vínculo com órgão público costuma ter acesso a prazos mais longos no consignado, o que deixa a parcela menor (o custo total muda, e mostramos isso também). Aqui na equipe {{parceiro}} simulamos prazos diferentes para você comparar.

Quer ver as simulações lado a lado?

Se não quiser mais contato, é só dizer SAIR.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-convenio-09', 'Convênio e vínculo', 'Convênio — lista do que é preciso para consultar', $tpl$Olá, aqui é {{parceiro}}.
Para consultar o consignado do seu convênio, normalmente bastam:
• documento com foto
• último contracheque ou extrato do benefício
• sua autorização para a consulta

Quer começar? É só responder SIM.

Não quer receber? Mande SAIR que retiramos seu número.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-10', 'Convênio e vínculo', 'Convênio — cada convênio tem sua regra de margem', $tpl$Cada convênio tem sua própria regra de margem consignável.
Prefeitura, estado, governo federal e INSS calculam de jeitos diferentes, por isso vale consultar o seu caso. {{parceiro}} faz isso sem custo.

Qual é o seu vínculo hoje?

Para sair da lista, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-11', 'Convênio e vínculo', 'Convênio — apresentação do parceiro', $tpl$Oi {{primeiro_nome}} tudo bem?
{{parceiro}} atende servidores públicos, aposentados e pensionistas em diversos convênios de crédito consignado. Fazemos a consulta e mostramos as opções disponíveis para o seu vínculo.

Podemos conversar por aqui?

Se não tiver interesse, é só responder SAIR que paramos.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-convenio-12', 'Convênio e vínculo', 'Convênio — mensagem de uma linha', $tpl$Servidor público ou aposentado? {{parceiro}} consulta seu consignado sem compromisso, é só responder esta mensagem.

Se não quiser receber, mande PARE e não insistimos.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-13', 'Convênio e vínculo', 'Convênio — não sabe quanto tem de margem', $tpl$Você sabe quanto tem de margem consignável hoje?
Muita gente com vínculo público não sabe e deixa de conhecer uma opção de crédito com desconto em folha. A equipe {{parceiro}} confere para você, com a sua autorização.

Quer que eu verifique?

Se não for o momento, responda SAIR e paramos por aqui.$tpl$, array['parceiro']::text[]),
  ('oferta-convenio-14', 'Convênio e vínculo', 'Convênio — cita o convênio do lead', $tpl$Olá {{primeiro_nome}} tudo bem?
Você tem vínculo com *{{convenio}}*? {{parceiro}} trabalha com o crédito consignado desse convênio e pode consultar sua margem e simular parcela e CET, sem compromisso.

Podemos tratar por aqui?

Não quer mais mensagens sobre isso? Responda SAIR.$tpl$, array['primeiro_nome','convenio','parceiro']::text[]),
  ('oferta-convenio-15', 'Convênio e vínculo', 'Convênio — escolha numerada com emoji', $tpl$Qual é o seu vínculo? 📋
1. Servidor municipal
2. Servidor estadual ou federal
3. Aposentado ou pensionista do INSS

Responda com o número e a equipe {{parceiro}} verifica as opções de crédito consignado para o seu caso.

Se não quiser receber, responda SAIR em vez do número.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-01', 'Empréstimo novo (margem livre)', 'Empréstimo novo — pergunta direta sobre margem livre', $tpl$Olá {{primeiro_nome}}
Você tem margem livre no consignado? Se tiver, ela pode ser usada para um empréstimo novo. {{parceiro}} consulta isso para você, sem compromisso.

Posso verificar a sua margem?

Se não quiser receber, responda SAIR.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-novo-02', 'Empréstimo novo (margem livre)', 'Empréstimo novo — o que é margem livre', $tpl$Margem livre é a parte do salário ou do benefício que ainda pode ser usada para um consignado novo.
Muita gente tem e não sabe. A equipe {{parceiro}} confere o seu caso e, se houver margem, simula o empréstimo com parcela e CET.

Quer que eu confira a sua?

Para não receber mais estas mensagens, responda PARAR.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-03', 'Empréstimo novo (margem livre)', 'Empréstimo novo — margem livre em destaque', $tpl$*Sua margem livre pode virar um empréstimo novo.*
A parcela é descontada em folha e o valor depende da margem disponível e da análise do banco. {{parceiro}} faz a simulação sem compromisso.

Vamos calcular?

Não quer receber? É só responder PARE.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-04', 'Empréstimo novo (margem livre)', 'Empréstimo novo — dinheiro extra para contas ou projeto', $tpl$Precisando de um dinheiro extra para colocar as contas em dia ou tirar um projeto do papel?
Se você tem margem livre no consignado, um empréstimo novo pode ser uma opção. {{parceiro}} verifica e mostra quanto daria.

Quer saber o valor?

Se não for do seu interesse, mande SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-05', 'Empréstimo novo (margem livre)', 'Empréstimo novo — pergunta de qualificação sobre a margem', $tpl$Uma pergunta: você já usa toda a sua margem consignável ou ainda sobra uma parte?
Se sobrar, essa parte pode virar um empréstimo novo. O time {{parceiro}} consulta isso sem compromisso.

Me responde que eu vejo para você.

Para sair da lista, escreva SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-06', 'Empréstimo novo (margem livre)', 'Empréstimo novo — passo a passo em 3 itens', $tpl$Como funciona um empréstimo novo no consignado com {{parceiro}}:
1. consultamos sua margem livre, com a sua autorização
2. simulamos valor, parcela, prazo e CET
3. você decide se quer contratar

Posso fazer o passo 1?

Quer sair da lista? Responda REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-07', 'Empréstimo novo (margem livre)', 'Empréstimo novo — mensagem de uma linha', $tpl$Oi {{primeiro_nome}}
Vale conferir: você ainda tem margem livre para um empréstimo novo no consignado? {{parceiro}} consulta para você sem custo.

Se preferir não receber, mande PARE.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-novo-08', 'Empréstimo novo (margem livre)', 'Empréstimo novo — parceiro se apresenta', $tpl${{parceiro}} aqui, falando sobre empréstimo consignado.
Estamos conversando com quem pode ter margem livre para contratar um valor novo. Consultamos a sua sem compromisso e explicamos parcela, prazo e CET.

Podemos falar por aqui?

Se não tiver interesse, responda SAIR e não enviamos mais.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-09', 'Empréstimo novo (margem livre)', 'Empréstimo novo — sem mexer nos contratos atuais', $tpl$Já tem consignado e acha que não dá para fazer outro?
Se ainda sobrar margem livre, é possível contratar um empréstimo novo sem mexer nos contratos que você já tem. A equipe {{parceiro}} verifica isso para você.

Quer que eu confira?

Caso não queira mais mensagens, digite SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-10', 'Empréstimo novo (margem livre)', 'Empréstimo novo — pergunta quanto o lead precisa', $tpl${{primeiro_nome}}
De quanto você precisa hoje? Me diga um valor e {{parceiro}} simula um empréstimo consignado novo usando a sua margem livre, com parcela e CET para você avaliar.

Pode me passar o valor?

Não quer receber? Responda SAIR que encerramos.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-novo-11', 'Empréstimo novo (margem livre)', 'Empréstimo novo — conferir a margem no contracheque', $tpl$Dá uma olhada no seu contracheque: tem uma linha de margem consignável disponível?
Se tiver valor ali, ele pode ser usado num empréstimo novo. {{parceiro}} ajuda a conferir e simula sem compromisso.

Quer ajuda para conferir?

Se não for útil para você, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-12', 'Empréstimo novo (margem livre)', 'Empréstimo novo — margem sobrando, usar com planejamento', $tpl$Tem margem consignável sobrando?
Ela pode ser usada, com planejamento, para um empréstimo novo com parcela fixa descontada em folha. A equipe {{parceiro}} simula para você avaliar se vale a pena no seu momento.

Vamos simular?

Para não receber mais nada, responda REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-13', 'Empréstimo novo (margem livre)', 'Empréstimo novo — cita a margem livre do lead', $tpl$Olá {{primeiro_nome}} tudo bem?
Pela nossa base, existe uma margem livre estimada em *{{margem_novo}}* por mês para empréstimo novo no consignado. Vale conferir: o valor possível depende da margem atualizada, do prazo e da análise do banco, e a equipe {{parceiro}} confirma tudo antes.

Quer que eu simule com essa margem?

Se preferir não receber, responda SAIR.$tpl$, array['primeiro_nome','margem_novo','parceiro']::text[]),
  ('oferta-novo-14', 'Empréstimo novo (margem livre)', 'Empréstimo novo — convite curto com emoji', $tpl$Tem margem livre? Ela pode virar um empréstimo novo ✅
{{parceiro}} consulta, simula e mostra valor, parcela e CET antes de qualquer contratação. Você decide se segue.

Quer começar pela consulta?

Para sair desta lista, mande SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-novo-15', 'Empréstimo novo (margem livre)', 'Empréstimo novo — prazo, parcela e CET lado a lado', $tpl$Tudo certo por aí?
No empréstimo consignado novo você escolhe o prazo, e isso muda a parcela e o custo total. O time {{parceiro}} mostra as opções lado a lado, com o CET de cada uma, para você decidir.

Posso montar essa comparação para você?

Caso não queira receber, é só escrever PARAR.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-01', 'Cartão benefício (RCC)', 'Cartão benefício — margem própria, pergunta direta', $tpl$Olá {{primeiro_nome}}
Aqui é da *{{parceiro}}*. Você sabia que o cartão benefício tem uma margem própria, separada da margem do empréstimo consignado?
Quer que eu verifique se você tem esse valor disponível?

Para não receber mais mensagens, responda SAIR.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('oferta-rcc-02', 'Cartão benefício (RCC)', 'Cartão benefício — margem em destaque no título', $tpl$Margem do cartão benefício: *{{margem_rcc}}*

Esse é o valor que aparece para você nos registros da equipe {{parceiro}}. Podemos simular quanto ele representa em limite e saque, sem compromisso. Quer ver?

Se não quiser receber este tipo de contato, é só responder PARAR.$tpl$, array['margem_rcc','parceiro']::text[]),
  ('oferta-rcc-03', 'Cartão benefício (RCC)', 'Cartão benefício — mensagem de uma linha', $tpl$Cartão benefício consignado: sua margem própria pode estar livre, e {{parceiro}} confere sem compromisso. Responda SIM para simular ou SAIR para não receber mais mensagens.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-04', 'Cartão benefício (RCC)', 'Cartão benefício — lista curta de vantagens', $tpl$*{{parceiro}}* | Cartão benefício consignado

• Margem própria, que não disputa espaço com o empréstimo
• Desconto direto na folha ou no benefício
• Possibilidade de saque, conforme análise

Quer saber se o cartão está disponível para você?

Não quer mais mensagens? Responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-05', 'Cartão benefício (RCC)', 'Cartão benefício — dor: margem do empréstimo comprometida', $tpl$Precisa de um dinheiro extra, mas a margem do empréstimo já está comprometida?
O cartão benefício usa uma margem separada e, em muitos casos, ainda permite saque.

{{parceiro}} pode verificar o seu caso. Vamos conversar?

Caso não tenha interesse, responda PARE e não enviaremos de novo.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-06', 'Cartão benefício (RCC)', 'Cartão benefício — apresentação do parceiro', $tpl$Mensagem de {{parceiro}}: trabalhamos com crédito consignado e estamos apresentando o cartão benefício para aposentados, pensionistas e servidores.
Se fizer sentido para você, faço uma simulação sem custo. Posso seguir?

Para sair da nossa lista, envie SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-07', 'Cartão benefício (RCC)', 'Cartão benefício — qualificação: recebe benefício do INSS?', $tpl$Você recebe benefício do INSS ou salário como servidor(a) público(a)?
Se sim, posso verificar se o cartão benefício consignado se aplica ao seu caso. Ele usa uma margem própria, separada da do empréstimo. Aqui é a equipe {{parceiro}}.

Se não quiser ser contatado(a) de novo, basta escrever SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-08', 'Cartão benefício (RCC)', 'Cartão benefício — identificação do parceiro + valor da margem', $tpl$Aqui é {{parceiro}}, com uma informação sobre o seu cartão benefício.
De acordo com os dados que temos, há *{{margem_rcc}}* de margem livre nele.
Com ela é possível ver limite de cartão e, em muitos casos, um valor de saque. Quer a simulação?

Prefere não receber? Responda PARAR que retiramos seu número.$tpl$, array['parceiro','margem_rcc']::text[]),
  ('oferta-rcc-09', 'Cartão benefício (RCC)', 'Cartão benefício — convite a simular', $tpl$Simulação de cartão benefício sem compromisso: {{parceiro}} calcula o limite e o possível saque com base na sua margem e mostra tudo antes de qualquer decisão.
Quer que eu faça a sua?

Responda SAIR a qualquer momento para não receber mais.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-10', 'Cartão benefício (RCC)', 'Cartão benefício — esclarecimento "muita gente não sabe"', $tpl$Muita gente não sabe, mas além da margem do empréstimo existe uma margem reservada só para o cartão benefício.
Se a sua estiver livre, ela pode virar limite e até saque.
Quer que a equipe {{parceiro}} verifique?

Se isso não for do seu interesse, mande SAIR e encerramos o contato.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-11', 'Cartão benefício (RCC)', 'Cartão benefício — saudação com nome + valor', $tpl$Oi {{primeiro_nome}}
Pelos registros da equipe {{parceiro}}, pode haver *{{margem_rcc}}* de margem livre no seu cartão benefício; vale confirmar.
Podemos te mostrar o que dá para fazer com esse valor. Vamos tratar por aqui?

Não quer receber ofertas? Digite SAIR.$tpl$, array['primeiro_nome','parceiro','margem_rcc']::text[]),
  ('oferta-rcc-12', 'Cartão benefício (RCC)', 'Cartão benefício — como funciona em 3 pontos', $tpl$Como funciona o cartão benefício consignado:
1. Usa uma margem própria do seu benefício ou salário
2. O valor mínimo da fatura é descontado direto na folha
3. Tudo é simulado antes, com o custo total informado

{{parceiro}} explica e simula para você. Tem interesse?

Para ser removido(a) desta lista, responda REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-13', 'Cartão benefício (RCC)', 'Cartão benefício — pergunta curta sobre uso da margem', $tpl$Você já usou a margem do seu cartão benefício?
Se ainda não, a equipe {{parceiro}} pode simular o que está disponível para você, sem compromisso. Me responde aqui?

Se não quiser mais contato, responda com a palavra SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-14', 'Cartão benefício (RCC)', 'Cartão benefício — objetivo do lead (organizar as contas)', $tpl$Quer organizar as contas ou tirar um plano do papel? 💳
O cartão benefício consignado pode ser uma alternativa, usando uma margem que fica separada do empréstimo.
{{parceiro}} faz a simulação e explica cada detalhe. Vamos ver o seu caso?

Caso prefira não receber mensagens, é só enviar PARAR.$tpl$, array['parceiro']::text[]),
  ('oferta-rcc-15', 'Cartão benefício (RCC)', 'Cartão benefício — valor da margem como ponto de partida', $tpl$Com uma margem de *{{margem_rcc}}* no cartão benefício, dá para pedir uma simulação de limite e de saque.
Com {{parceiro}}, você vê o custo total antes de decidir. Posso enviar a sua?

Sem interesse? Uma resposta com SAIR já basta.$tpl$, array['margem_rcc','parceiro']::text[]),
  ('oferta-rmc-01', 'Cartão consignado (RMC)', 'Cartão consignado — pergunta direta sobre a RMC livre', $tpl$Você tem a margem do cartão consignado (RMC) livre?
{{parceiro}} verifica para você e simula limite e saque, sem compromisso. Posso conferir?

Para parar de receber nossas mensagens, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-02', 'Cartão consignado (RMC)', 'Cartão consignado — valor da RMC no título', $tpl$Reserva de margem do cartão consignado (RMC): *{{margem_rmc}}*

É o valor que aparece para você nos registros da equipe {{parceiro}}. Quer ver em uma simulação o limite e o saque possível com ele?

Se não deseja mais este contato, responda PARE.$tpl$, array['margem_rmc','parceiro']::text[]),
  ('oferta-rmc-03', 'Cartão consignado (RMC)', 'Cartão consignado — mensagem de uma linha', $tpl${{parceiro}}: cartão consignado com margem RMC própria, separada da do empréstimo. Quer uma simulação sem compromisso? Responda SIM, ou SAIR para não receber mais nada.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-04', 'Cartão consignado (RMC)', 'Cartão consignado — lista curta de características', $tpl$Cartão consignado com {{parceiro}}:
- Margem própria (RMC), que não ocupa a do empréstimo
- Valor mínimo da fatura descontado na folha ou no benefício
- Saque conforme limite e análise

Quer saber se o seu está disponível?

Não deseja receber? Responda SAIR e paramos.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-05', 'Cartão consignado (RMC)', 'Cartão consignado — dor: margem do empréstimo toda usada', $tpl$Margem do empréstimo toda usada?
Ainda pode existir espaço na reserva do cartão consignado (RMC), que é calculada à parte.
A equipe {{parceiro}} confere isso para você. Quer que eu veja?

Se preferir não receber este tipo de mensagem, envie SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-06', 'Cartão consignado (RMC)', 'Cartão consignado — apresentação do parceiro', $tpl$Prazer, quem fala é {{parceiro}}. Trabalhamos com crédito consignado e estamos apresentando o cartão consignado com margem RMC para aposentados, pensionistas e servidores.
Posso te explicar como funciona?

Para ser retirado(a) da lista, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-07', 'Cartão consignado (RMC)', 'Cartão consignado — qualificação pela fonte de renda', $tpl$Você recebe aposentadoria, pensão ou salário de órgão público?
Nesses casos, pode existir uma margem reservada para cartão consignado (RMC). {{parceiro}} verifica se há valor disponível para você.

Se não quiser mais nossas mensagens, escreva SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-08', 'Cartão consignado (RMC)', 'Cartão consignado — identificação da equipe + valor livre', $tpl$Aqui fala a equipe {{parceiro}}.
De acordo com os dados que temos, a sua margem RMC livre é de *{{margem_rmc}}*.
Em muitos casos ela permite saque no cartão consignado. Quer que eu simule?

Responda PARAR se não quiser receber mais contatos.$tpl$, array['parceiro','margem_rmc']::text[]),
  ('oferta-rmc-09', 'Cartão consignado (RMC)', 'Cartão consignado — convite a simular com transparência', $tpl$Faça uma simulação de cartão consignado com {{parceiro}}: você vê limite, possível saque e custo total antes de decidir qualquer coisa.
Quer começar?

A qualquer momento, responda SAIR para deixar de receber.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-10', 'Cartão consignado (RMC)', 'Cartão consignado — esclarecimento "sabia que"', $tpl$Sabia que a margem do cartão consignado é separada da margem do empréstimo?
É a chamada RMC. Se a sua estiver livre, pode virar limite de cartão e, em alguns casos, saque.
{{parceiro}} confere isso para você, sem compromisso.

Se não for do seu interesse, responda SAIR que encerramos por aqui.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-11', 'Cartão consignado (RMC)', 'Cartão consignado — saudação com nome + margem estimada', $tpl$Olá {{primeiro_nome}}
Pelos registros da equipe {{parceiro}}, pode haver margem de cartão consignado em torno de *{{margem_rmc}}* para você. Vale confirmar antes de qualquer decisão.
Posso fazer essa conferência e te mostrar o que dá para fazer com o valor?

Não quer receber ofertas como esta? Digite PARAR.$tpl$, array['primeiro_nome','parceiro','margem_rmc']::text[]),
  ('oferta-rmc-12', 'Cartão consignado (RMC)', 'Cartão consignado — explicação em 3 pontos numerados', $tpl$Cartão consignado em 3 pontos:
1. Usa a reserva de margem (RMC), separada do empréstimo
2. O mínimo da fatura sai direto da folha ou do benefício
3. Você vê o custo total na simulação, antes de contratar

Quer que a equipe {{parceiro}} simule o seu?

Para sair desta lista de contatos, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-13', 'Cartão consignado (RMC)', 'Cartão consignado — pergunta: margem parada?', $tpl$A sua margem de cartão consignado está parada?
Se estiver, {{parceiro}} pode mostrar quanto ela representa em limite, sem compromisso. Me conta por aqui?

Se preferir não ser mais contatado(a), mande SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-14', 'Cartão consignado (RMC)', 'Cartão consignado — objetivo: reforçar o orçamento', $tpl$Quer reforçar o orçamento sem mexer na margem do empréstimo? 📌
O cartão consignado usa uma reserva própria (RMC), e {{parceiro}} pode simular o que está disponível para você.
Vamos ver?

Para não receber novas mensagens, é só responder SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-rmc-15', 'Cartão consignado (RMC)', 'Cartão consignado — valor da RMC como ponto de partida', $tpl$Com *{{margem_rmc}}* de margem RMC, você pode ter limite no cartão consignado e, conforme análise, um valor de saque.
{{parceiro}} faz a conta e mostra o custo total. Quer receber a simulação?

Sem interesse? Responda SAIR e não enviamos mais.$tpl$, array['margem_rmc','parceiro']::text[]),
  ('oferta-refin-01', 'Refinanciamento com troco', 'Refinanciamento — pergunta direta sobre contrato ativo', $tpl$Você tem empréstimo consignado ativo com parcelas já pagas?
Ao refinanciar, em muitos casos sobra um valor de troco. {{parceiro}} confere se é o seu caso, sem compromisso.

Para não receber mais mensagens nossas, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-02', 'Refinanciamento com troco', 'Refinanciamento — troco estimado no título', $tpl$Troco estimado de refinanciamento: *{{troco_refin}}*

Esse é o valor que aparece nos registros da equipe {{parceiro}} para o seu consignado. Ele depende de análise e pode mudar. Quer conferir em uma simulação?

Se não quiser este contato, responda PARAR.$tpl$, array['troco_refin','parceiro']::text[]),
  ('oferta-refin-03', 'Refinanciamento com troco', 'Refinanciamento — mensagem de uma linha', $tpl$Refinanciamento de consignado: em muitos casos sobra troco, e {{parceiro}} verifica o seu contrato sem compromisso. Responda SIM para conferir, ou SAIR para não receber mais.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-04', 'Refinanciamento com troco', 'Refinanciamento — lista do que é conferido', $tpl$O que a equipe {{parceiro}} confere no seu refinanciamento:
• Quantas parcelas já foram pagas
• Se a nova condição pode gerar troco
• Parcela e custo total da nova proposta

Quer que eu faça essa análise?

Não quer mais mensagens? Envie SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-05', 'Refinanciamento com troco', 'Refinanciamento — dor: precisa de dinheiro e já pagou parte', $tpl$Já pagou boa parte do seu consignado e está precisando de dinheiro?
No refinanciamento pode haver troco, dependendo do saldo e das condições do contrato.
A equipe {{parceiro}} faz a conta para você. Vamos ver?

Caso não queira receber mais contatos, envie REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-06', 'Refinanciamento com troco', 'Refinanciamento — apresentação do parceiro', $tpl$Aqui é {{parceiro}}: trabalhamos com refinanciamento de crédito consignado.
Analisamos o seu contrato atual e mostramos se existe valor de troco, antes de qualquer decisão. Posso analisar o seu?

Para sair da lista, responda SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-07', 'Refinanciamento com troco', 'Refinanciamento — qualificação por parcelas pagas', $tpl$Seu consignado já tem várias parcelas pagas?
Se sim, vale conferir um refinanciamento: em muitos casos ele gera troco. {{parceiro}} verifica para você.

Se não deseja ser contatado(a) de novo, escreva SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-08', 'Refinanciamento com troco', 'Refinanciamento — parceiro se apresenta + troco estimado com CET', $tpl${{parceiro}} aqui, com uma informação sobre o seu consignado.
Pelos nossos registros, o refinanciamento do seu contrato pode gerar um possível troco, estimado em *{{troco_refin}}*, sujeito a análise. O custo efetivo total (CET) aparece na simulação.
Quer ver a simulação completa?

Responda PARAR se não quiser receber mais.$tpl$, array['parceiro','troco_refin']::text[]),
  ('oferta-refin-09', 'Refinanciamento com troco', 'Refinanciamento — convite a simular', $tpl$Simule o refinanciamento do seu consignado com {{parceiro}}: você vê a nova parcela, o custo total e se existe troco, tudo antes de decidir.
Quer fazer a sua simulação?

Responda SAIR a qualquer hora para deixar de receber.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-10', 'Refinanciamento com troco', 'Refinanciamento — como o troco funciona (transparência)', $tpl$Como funciona o troco do refinanciamento?
O contrato atual é quitado por um novo e, quando o novo valor é maior que o saldo devedor, a diferença vem como troco.
O prazo e o custo total mudam, por isso {{parceiro}} simula tudo antes. Quer entender o seu caso?

Se isso não interessa, mande SAIR e encerramos o contato.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-11', 'Refinanciamento com troco', 'Refinanciamento — saudação com nome + troco', $tpl$Oi {{primeiro_nome}}
Pelos registros da equipe {{parceiro}}, o refinanciamento do seu consignado pode gerar troco estimado em *{{troco_refin}}*, sujeito a análise.
Podemos conversar sobre isso?

Não quer receber ofertas assim? Digite SAIR.$tpl$, array['primeiro_nome','parceiro','troco_refin']::text[]),
  ('oferta-refin-12', 'Refinanciamento com troco', 'Refinanciamento — passo a passo em 3 etapas', $tpl$Refinanciamento com troco em 3 passos:
1. Você autoriza a consulta do seu contrato
2. {{parceiro}} simula a nova parcela e o custo total
3. Se houver troco, você decide se vale a pena

Quer começar?

Para ser removido(a) desta lista, responda a palavra REMOVER.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-13', 'Refinanciamento com troco', 'Refinanciamento — pergunta: já verificou o troco?', $tpl$Já verificou se o seu consignado tem troco disponível?
Vale conferir: em muitos casos existe. {{parceiro}} confere sem compromisso. Me responde aqui?

Se não quiser mais contato, basta responder SAIR.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-14', 'Refinanciamento com troco', 'Refinanciamento — objetivo do lead (plano parado)', $tpl$Tem um plano parado esperando dinheiro? 🏠
O refinanciamento do consignado pode gerar troco, dependendo do seu contrato. {{parceiro}} simula e mostra o custo total antes de qualquer decisão.
Vamos conferir?

Caso prefira não receber mensagens, envie PARAR.$tpl$, array['parceiro']::text[]),
  ('oferta-refin-15', 'Refinanciamento com troco', 'Refinanciamento — valor do troco como ponto de partida', $tpl$Com o refinanciamento, o troco do seu contrato pode chegar a *{{troco_refin}}*, segundo os registros da equipe {{parceiro}}.
O valor final depende de análise e da nova parcela. Quer ver a simulação?

Sem interesse? Basta mandar SAIR.$tpl$, array['troco_refin','parceiro']::text[])
) as v(chave, categoria, nome, corpo, variaveis)
on conflict (chave) where sistema and deleted_at is null do nothing;

notify pgrst, 'reload schema';
