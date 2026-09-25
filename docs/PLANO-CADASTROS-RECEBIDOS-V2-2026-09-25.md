# Plano — Cadastros Recebidos v2 (aprovado pelo Bruno em 25/09/2026)

Complementa `ORIENTACAO-CADASTROS-RECEBIDOS.md` (pipeline de 8 etapas, em produção
desde 02-03/09/2026). Este documento fixa as decisões da rodada de revisão de
24-25/09 e as fatias de entrega. Cada fatia fecha sozinha e vai para produção
antes da próxima. Migrations saem SÓ da pasta principal, depois do merge, com
carimbo real (`date +%Y%m%d%H%M%S`).

## Decisões fixadas

- **Evidência obrigatória** em toda verificação que depende de consulta externa
  (Presença Digital, Pix, Serasa, Cartão CNPJ, Certificações CRCP): print ou PDF
  anexado ao item, com hash SHA-256 e carimbo de captura. Cada item desses tipos
  mostra um bloco fixo "O que fazer / O que anexar".
- **Serasa**: upload do PDF agora; API (Consult Center) depois, preenchendo o
  mesmo espaço de evidência.
- **Nuvidio**: os dois modos continuam (colar link manual ou gerar pela API);
  vídeo chega pelo webhook ou por upload.
- **CNPJ já cadastrado no portal**: bloqueia com "este CNPJ já possui cadastro
  como parceiro da BRS, entre em contato com o suporte" quando existe cadastro
  VIVO (processo em andamento ou parceiro concluído). Só reprovado ou cancelado
  pode tentar de novo, e aí o processo novo nasce com o alerta de reprovação
  anterior. Rascunho aberto do mesmo CNPJ oferece retomar o link. NUNCA mesclar
  por cima do cadastro antigo em silêncio (comportamento atual, a corrigir).
- **Reprovação final**: ação "Reprovar cadastro" em qualquer etapa, com
  categoria (Serasa, judicial, documentação, improcedência, outro), motivo e
  autor. O processo congela cópia do cadastro e dos arquivos. Índice por CNPJ da
  empresa e CPF de cada sócio/administrador. Um agente por CNPJ com N processos.
- **Certificações** (catálogos + lançamentos por pessoa):
  - Certificadoras: nome, site, logotipo (upload pelo Bruno, feito no Canva).
    Semente: ACREFI (certicrefi.org.br), ANEPS (aneps.org.br), FEBRABAN
    (certificacaofebraban.org.br), ASSBAN (assban.com.br), ANEC (anecbrasil.com.br).
  - Tipos de certificação com marcação "obrigatório": Crédito Consignado (obrig.),
    Crédito Direto ao Consumidor CDC, Crédito Veículo, LGPD (obrig.), PLDFT (obrig.).
  - Certificações: uma certificadora, nome livre, ligada a 1..N tipos. Semente
    (só ANEC; as demais o Bruno cadastra):
    - Certificação ANEC em Crédito Consignado + LGPD + PLDFT → Consignado/LGPD/PLDFT
    - Certificação ANEC em CDC (Crédito Direto ao Consumidor) + LGPD + PLDFT → CDC/LGPD/PLDFT
    - Certificação ANEC em Crédito Veículo + LGPD + PLDFT → Veículo/LGPD/PLDFT
    - Certificação ANEC Completa + LGPD + PLDFT → Consignado/CDC/Veículo/LGPD/PLDFT
  - Lançamento por pessoa, chaveado pelo CPF: certificação, número, data do
    exame, validade, print do CRCP, quem verificou, em qual processo. A validade
    vale para todos os tipos cobertos. Vigência por tipo = MAIOR validade.
  - Desmarcar "obrigatório" não apaga lançamentos; o processo guarda quais tipos
    eram obrigatórios no momento da análise.
  - Regra: TODOS os tipos obrigatórios vigentes na MESMA pessoa; o item da
    Análise aprova quando pelo menos um sócio/administrador cumpre. Faltando ou
    vencida é impeditivo: operador solicita correção; o parceiro preenche os
    dados, anexa imagem/PDF ou justifica que não possui; volta como "Corrigido"
    para o operador conferir no CRCP (crcp.org.br, sem API, com captcha).
  - Vencimento: aviso no sino 60 e 30 dias antes; não bloqueia parceiro ativo.
- **Limite operacional**: etapa nova entre ARW e Contrato. Padrão R$ 1.000.000,
  aprovação com autor, data e justificativa quando diferente. Grava no processo e
  no agente (aditivo futuro parte do vigente).
- **Contrato gerado no sistema** (não template da Assinafy): Templates de
  Documentos com editor rico e variáveis; HTML → PDF via Chromium serverless
  (fallback Railway se a partida a frio passar de ~10 s). Requisitos do PDF:
  logotipo BRS, tabelas, marca d'água de fundo (imagem, quase transparente),
  rodapé com data/hora e "página X de Y", segunda marca d'água diagonal em todas
  as páginas com "Contrato de Prestação de Serviços - BRS Promotora de Vendas
  Ltda x [RAZÃO SOCIAL DO PARCEIRO]" (rastreio de vazamento), hash do arquivo
  no rodapé. **Na tela, a geração mostra progresso (barra até 100% ou
  indicador de fases) — nunca deixar o operador achar que travou.**
- **Contrato e Termos com duas abas**: "Preenchimento Manual" (campos
  copiáveis, 1 link de assinatura por envolvido colado à mão, disparo por
  template, upload do PDF assinado) e "API Assinafy" (gera PDF, sobe com
  signatários — o client já faz upload multipart —, webhook marca assinado,
  sino avisa). Os dois convergem na tabela de assinaturas por envolvido.
- **Disparo dos termos**: contrato assinado → botão "Assinaturas conferidas,
  gerar termos" conclui a etapa e gera 1 termo por envolvido que cumpre os
  tipos obrigatórios (mesma pessoa).
- **Templates de Mensagens**: submenu Agente Corban › Templates de Mensagens,
  1 registro por template com aba E-mail (formatação rica) e aba WhatsApp (só
  negrito, itálico, tachado, emoji), variáveis listadas, pré-visualização,
  versão e autor. Semente com os textos atuais do código; código deixa de ter
  texto. Templates por envolvido previstos.
- **Hierarquia comercial no ARW e no editor**: cada campo lista comerciais
  ATIVOS com cargo igual ou superior ao do campo (superintendente → supervisor
  → gerente). Superintendente pode ser supervisor e gerente do parceiro;
  supervisor pode ser gerente; gerente só gerente. Regra de físico ignorada.
- **SCP sai do código** (telas, menus, rotas, formulário público antigo).
  Motor de jobs fica (Agenda usa). Tabelas ficam no banco.
- **Fotos no portal**: botão "Tirar foto" (câmera frontal nos campos de selfie,
  traseira na fachada) + detecção de rosto no navegador, sem custo, bloqueando
  sem rosto. Visão no servidor (modelo multimodal como pré-análise, nunca juiz)
  fica como evolução futura.
- **Teste ponta a ponta**: cadastro da Bem Digital Online Ltda.

## Fatias

| # | Fatia | Migration | Repos | Executor |
|---|-------|-----------|-------|----------|
| 0 | Correções e limpeza: espelho ARW na ordem do ARW + retorno completo; status volta a "Em andamento" ao concluir Validação; SCP fora do código | não | workspace | Fable |
| 1 | Evidências por item + instruções; Serasa exige PDF | 1 | workspace | Fable (schema) + Sonnet (tela) |
| 2 | Reprovação final + histórico por CPF/CNPJ; 1 agente N processos; bloqueio de CNPJ vivo no portal | 1 | workspace + portal | Fable |
| 3 | Certificações: catálogos, lançamentos, menu, item na Análise, correção no portal, vencimentos | 2 | workspace + portal | Fable (schema) + Sonnet (telas) |
| 4 | Limite operacional (etapa nova) | 1 | workspace | Fable |
| 5 | Templates de Mensagens | 1 | workspace | Fable (schema) + Sonnet (tela) |
| 6 | Contrato e Termos: assinaturas por envolvido, Templates de Documentos, gerador PDF com progresso, abas Manual/API | 1 | workspace | Fable (depende do texto do contrato) |
| 7 | Fotos no portal: câmera + detecção de rosto | não | portal | Sonnet |
| 8 | Teste ponta a ponta (Bem Digital) | não | — | Bruno + Fable |

Ordem: 0 → 1 → 2 → 3 → 5 → 4 → 6 → 7 → 8. A 7 pode andar em paralelo a
qualquer momento (só portal). A 6 espera o texto final do contrato.

## Regras de execução

- Worktree própria por fatia (`brs-workspace-onboarding`, branch
  `onboarding/fatia-N-...`), merge pequeno na main, push = deploy.
- Permissão nova = regra dos 4 pontos (árvore `SYSTEM_MODULES`, `divisoes.ts`,
  `permissions.ts`, seed em migration).
- Toda ação relevante gera linha em `corban_onboarding_eventos`.
- Nenhum custo automático (NVTI, IA) dentro do fluxo sem botão próprio e aviso.
