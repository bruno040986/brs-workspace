-- Seed da biblioteca padrão do sistema (templates de WhatsApp não oficial).
-- Linhas globais: sistema = true, agente_parceiro_id NULL. Idempotente: reexecutar não duplica
-- (conflito na chave das linhas ativas do sistema). Linhas arquivadas (arquivado_em) seguem ocupando a chave, então não são recriadas; o seed nunca atualiza linhas existentes.
-- Compliance: todo texto de primeiro contato tem saída SAIR; sem promessa de aprovação nem valor fixo.

insert into public.crm_templates_mensagem
  (agente_parceiro_id, canal, chave, categoria, nome, corpo, variaveis, ativo, sistema)
select null, 'whatsapp_nao_oficial', v.chave, v.categoria, v.nome, v.corpo, v.variaveis, true, true
from (values
  ('primeira-abordagem-01', 'Primeira abordagem', 'Apresentação simples com simulação sem compromisso', $tpl$Olá, {{primeiro_nome}}, tudo bem? Aqui é {{atendente}}, da {{parceiro}}. Trabalho com crédito consignado e você pode ter margem disponível para uma nova contratação. Quer que eu faça uma simulação, sem compromisso?

Se não quiser receber mensagens, é só responder SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('primeira-abordagem-02', 'Primeira abordagem', 'Correspondente da cidade, análise do banco', $tpl$Oi, {{nome}}. Meu nome é {{atendente}} e falo em nome da {{parceiro}}, correspondente de crédito consignado em {{cidade}}.

Posso te mandar uma simulação com base na sua margem? Tudo passa por análise do banco, e você decide com calma se faz sentido.

Caso prefira não receber contato, responda SAIR.$tpl$, array['nome','atendente','parceiro','cidade']::text[]),
  ('primeira-abordagem-03', 'Primeira abordagem', 'Margem estimada para empréstimo novo', $tpl${{primeiro_nome}}, tudo certo por aí? Sou {{atendente}}, da {{parceiro}}.

Pelas informações que temos, sua margem estimada para empréstimo consignado é de *{{margem_novo}}*. Esse valor ainda precisa ser confirmado pelo banco.

Quer que eu te explique as condições? Se não tiver interesse, responda SAIR que eu não envio mais.$tpl$, array['primeiro_nome','atendente','parceiro','margem_novo']::text[]),
  ('primeira-abordagem-04', 'Primeira abordagem', 'Pergunta curta de abertura', $tpl$Oi, {{primeiro_nome}}! Aqui é {{atendente}} ({{parceiro}}). Posso te fazer uma pergunta rápida sobre o seu consignado?

Se preferir não conversar, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('primeira-abordagem-05', 'Primeira abordagem', 'Cartão consignado (RMC)', $tpl$Olá, {{nome}}. {{atendente}} falando, da {{parceiro}}.

Você sabia que existe uma margem separada para o cartão consignado? Pela estimativa que temos, a sua está em _{{margem_rmc}}_, sujeita a confirmação.

Se quiser entender como funciona, me chama aqui. Para não receber mais, responda SAIR.$tpl$, array['nome','atendente','parceiro','margem_rmc']::text[]),
  ('primeira-abordagem-06', 'Primeira abordagem', 'Cartão benefício consignado (RCC)', $tpl${{primeiro_nome}}, bom falar com você. Sou {{atendente}} e atendo pela {{parceiro}}.

Além do empréstimo, existe o cartão benefício consignado, que tem margem própria. A sua aparece estimada em {{margem_rcc}}. Posso te mostrar como funciona? A simulação não tem custo.

Se não quiser contato, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro','margem_rcc']::text[]),
  ('primeira-abordagem-07', 'Primeira abordagem', 'Troco no refinanciamento', $tpl$Oi, {{primeiro_nome}}. Aqui é {{atendente}}, da {{parceiro}}.

Pelas informações que temos do seu contrato de consignado, pode existir um troco no refinanciamento, estimado em {{troco_refin}}. Isso depende da análise do banco e das condições do contrato atual.

Quer que eu simule? Responda SAIR se preferir não receber mensagens.$tpl$, array['primeiro_nome','atendente','parceiro','troco_refin']::text[]),
  ('primeira-abordagem-08', 'Primeira abordagem', 'Atendimento local, sem oferta direta', $tpl$Olá, {{nome}}, tudo bem? Sou {{atendente}}, da {{parceiro}}, aqui de {{cidade}}. A gente atende servidores e aposentados com crédito consignado, pessoalmente ou por aqui mesmo.

Se um dia precisar de uma simulação, é só me chamar. Não quer receber? Responda SAIR. 🙂$tpl$, array['nome','atendente','parceiro','cidade']::text[]),
  ('follow-up-01', 'Follow-up', 'Conseguiu ver a mensagem?', $tpl$Oi, {{primeiro_nome}}, é {{atendente}} de novo. Conseguiu ver a mensagem que te mandei sobre o consignado? Fico à disposição se tiver alguma dúvida.$tpl$, array['primeiro_nome','atendente']::text[]),
  ('follow-up-02', 'Follow-up', 'Oferece explicar por áudio ou ligação', $tpl${{primeiro_nome}}, passando só para saber se ficou alguma dúvida sobre a simulação. Se quiser, te explico por áudio ou ligação, como for melhor para você.

{{atendente}}, {{parceiro}}$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('follow-up-03', 'Follow-up', 'Simulação pronta com margem estimada', $tpl$Olá, {{nome}}. Separei as informações da sua margem consignável: {{margem_novo}} (valor estimado, ainda sujeito à análise).

Quando tiver um tempinho, me diga se prefere que eu mande a simulação por escrito aqui mesmo.$tpl$, array['nome','margem_novo']::text[]),
  ('follow-up-04', 'Follow-up', 'Pergunta melhor dia e horário', $tpl$Oi, {{primeiro_nome}}! Sem pressa nenhuma: quando seria um bom momento para conversarmos sobre o seu crédito? Pode me responder com o melhor dia e horário.

Abraço, {{atendente}}$tpl$, array['primeiro_nome','atendente']::text[]),
  ('follow-up-05', 'Follow-up', 'Confirmação de dados e aviso antifraude', $tpl${{primeiro_nome}}, para eu seguir com a sua simulação, preciso confirmar alguns dados com você. Qual o melhor horário para conversarmos?

Lembrando que a {{parceiro}} *não pede nenhum pagamento antecipado* para simular ou contratar.$tpl$, array['primeiro_nome','parceiro']::text[]),
  ('follow-up-06', 'Follow-up', 'Último contato, porta aberta', $tpl$Oi, {{primeiro_nome}}. Vou parar de te chamar por aqui para não incomodar. Se mais pra frente quiser retomar a conversa sobre o consignado, é só mandar uma mensagem.

Obrigado pela atenção! {{atendente}}, da {{parceiro}}$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('reativacao-01', 'Reativação', 'Quanto tempo, condições novas', $tpl$Oi, {{primeiro_nome}}, quanto tempo! Aqui é {{atendente}}, da {{parceiro}}. Conversamos um tempo atrás sobre crédito consignado.

Quer que eu veja se surgiu alguma condição nova para você? Se não quiser mais receber mensagens, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('reativacao-02', 'Reativação', 'Refazer simulação com margem atual', $tpl$Olá, {{nome}}. Os bancos atualizam as condições de tempos em tempos, e pelas informações atuais sua margem estimada está em {{margem_novo}}.

Posso refazer a sua simulação? Atendimento com {{atendente}}, da {{parceiro}}.

Responda SAIR para não receber novos contatos.$tpl$, array['nome','margem_novo','atendente','parceiro']::text[]),
  ('reativacao-03', 'Reativação', 'Parcelas pagas podem gerar troco', $tpl${{primeiro_nome}}, tudo bem? {{atendente}} aqui, da {{parceiro}}.

Como você já pagou parte das parcelas do seu contrato, pode ser que exista troco no refinanciamento, hoje estimado em {{troco_refin}}. Só consigo confirmar depois da análise do banco.

Tem interesse em ver os números? Para sair da lista, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro','troco_refin']::text[]),
  ('reativacao-04', 'Reativação', 'Reativação curta, resposta sim', $tpl$Oi, {{primeiro_nome}}! Ainda posso te ajudar com o consignado? Sou {{atendente}}, da {{parceiro}}. Um *sim* aqui já basta para eu retomar.

Se não for mais do seu interesse, responda SAIR. 👍$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('reativacao-05', 'Reativação', 'Confirma se quer manter contato', $tpl$Olá, {{nome}}. Aqui é da {{parceiro}}, em {{cidade}}. Você conversou com a gente em outra ocasião e quero saber se ainda faz sentido manter contato sobre crédito consignado.

Se sim, {{atendente}} te atende por aqui. Se não, responda SAIR e retiramos seu número da nossa lista.$tpl$, array['nome','parceiro','cidade','atendente']::text[]),
  ('convenios-inss-01', 'Convênios', 'INSS: aposentados e pensionistas', $tpl$Olá, {{nome}}. Sou {{atendente}}, da {{parceiro}}, e atendo aposentados e pensionistas do INSS.

Pela estimativa que temos, há margem de {{margem_novo}} para empréstimo consignado no seu benefício. As parcelas são descontadas direto no benefício, e a taxa e o CET são informados antes de qualquer assinatura.

Quer simular? Se não quiser receber, responda SAIR.$tpl$, array['nome','atendente','parceiro','margem_novo']::text[]),
  ('convenios-siape-01', 'Convênios', 'SIAPE: servidores federais', $tpl${{primeiro_nome}}, tudo bem? Aqui é {{atendente}}, da {{parceiro}}. Trabalhamos com consignado para servidores federais (SIAPE).

Posso te mostrar uma simulação com a sua margem estimada de {{margem_novo}}? _Valor sujeito à confirmação no contracheque e à análise do banco._

Caso não queira contato, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro','margem_novo']::text[]),
  ('convenios-estadual-01', 'Convênios', 'Estadual: bancos operando no órgão', $tpl$Oi, {{primeiro_nome}}. {{atendente}} falando, da {{parceiro}}. Atendemos servidores estaduais com empréstimo e cartão consignado.

Se quiser, verifico quais bancos estão operando com o seu órgão neste momento e te passo as opções, com o CET de cada uma.

Para não receber mais mensagens, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('convenios-municipal-01', 'Convênios', 'Municipal: servidores da prefeitura', $tpl$Olá, {{nome}}! Sou {{atendente}}, da {{parceiro}}, aqui de {{cidade}}.

Para servidores da prefeitura, o consignado tem as parcelas descontadas em folha. Quer que eu confira sua margem e te explique as opções?

Se preferir não receber contato, é só responder SAIR.$tpl$, array['nome','atendente','parceiro','cidade']::text[]),
  ('convenios-fgts-01', 'Convênios', 'FGTS: antecipação do saque-aniversário', $tpl$Oi, {{primeiro_nome}}. Aqui é {{atendente}}, da {{parceiro}}.

Se você tem saldo no FGTS e optou pelo saque-aniversário, é possível antecipar parcelas desse saque. O valor depende do saldo e da análise do banco.

Quer que eu te explique como funciona? Para não receber mensagens, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('pos-venda-01', 'Pós-venda e check-in', 'Agradecimento após contratação', $tpl${{primeiro_nome}}, aqui é {{atendente}}, da {{parceiro}}. Passando para agradecer pela confiança.

Se surgir qualquer dúvida sobre o seu contrato, como datas ou parcelas, pode me chamar por aqui.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('pos-venda-02', 'Pós-venda e check-in', 'Check-in: valor caiu na conta?', $tpl$Oi, {{primeiro_nome}}! O valor do seu contrato já caiu na conta? Me avisa por aqui. Se tiver qualquer pendência, eu acompanho com o banco para você.

{{atendente}}$tpl$, array['primeiro_nome','atendente']::text[]),
  ('pos-venda-03', 'Pós-venda e check-in', 'Check-in das primeiras parcelas', $tpl$Olá, {{nome}}. Tudo certo com as primeiras parcelas do seu consignado? Se notar algum desconto diferente do combinado, me mande uma foto do contracheque ou do extrato que eu verifico.

Atenciosamente, {{atendente}}, {{parceiro}}$tpl$, array['nome','atendente','parceiro']::text[]),
  ('pos-venda-04', 'Pós-venda e check-in', 'Alerta antigolpe: nunca pedimos Pix', $tpl${{primeiro_nome}}, um lembrete importante da {{parceiro}}: *nunca pedimos Pix, depósito ou pagamento antecipado* para liberar crédito.

Se alguém entrar em contato pedindo isso em nosso nome, não pague e fale comigo antes. {{atendente}}$tpl$, array['primeiro_nome','parceiro','atendente']::text[]),
  ('portabilidade-01', 'Portabilidade e refinanciamento', 'Portabilidade: comparar com CET', $tpl$Oi, {{primeiro_nome}}. Sou {{atendente}}, da {{parceiro}}.

Você sabia que dá para transferir seu consignado para outro banco (portabilidade) e, dependendo do caso, reduzir a taxa? Posso comparar seu contrato atual com as opções disponíveis, mostrando o CET de cada uma.

Se não quiser receber, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('portabilidade-02', 'Portabilidade e refinanciamento', 'Portabilidade com refinanciamento e troco', $tpl${{nome}}, tudo bem? Aqui é {{atendente}}, da {{parceiro}}.

Na portabilidade com refinanciamento, às vezes sobra um troco além da troca de banco. No seu caso, a estimativa inicial é de {{troco_refin}}, confirmada só depois da análise.

Quer que eu detalhe? Responda SAIR se preferir não receber contatos.$tpl$, array['nome','atendente','parceiro','troco_refin']::text[]),
  ('refinanciamento-01', 'Portabilidade e refinanciamento', 'Refinanciar vale a pena? Conta junto', $tpl$Olá, {{primeiro_nome}}. Uma dúvida comum: _refinanciar vale a pena?_ Depende da taxa, do prazo e de quanto você ainda deve.

Eu, {{atendente}}, da {{parceiro}}, posso fazer essa conta com você e mostrar o antes e o depois, sem compromisso. É só responder aqui.

Para não receber mais mensagens, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[]),
  ('refinanciamento-02', 'Portabilidade e refinanciamento', 'Parcela, prazo e CET lado a lado', $tpl$Oi, {{primeiro_nome}}. {{atendente}}, da {{parceiro}}, aqui.

Antes de qualquer refinanciamento, gosto de mostrar três coisas: *parcela*, *prazo* e *CET*. Assim você compara com o que paga hoje e decide com calma.

Quer que eu monte essa comparação para o seu contrato? Se não quiser contato, responda SAIR.$tpl$, array['primeiro_nome','atendente','parceiro']::text[])
) as v(chave, categoria, nome, corpo, variaveis)
on conflict (chave) where sistema and deleted_at is null do nothing;

notify pgrst, 'reload schema';
