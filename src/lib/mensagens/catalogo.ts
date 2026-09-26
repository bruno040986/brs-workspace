/**
 * Catálogo dos Templates de Mensagens (fatia 5, 26/09/2026): quais existem,
 * canais, variáveis e o texto PADRÃO. O que o Bruno personaliza na tela vai
 * para `mensagem_templates`; sem linha lá, vale o padrão daqui.
 *
 * Padrões = os textos que estavam fixos no código até 26/09 (mesmas palavras).
 */

export type CanalMensagem = 'email' | 'whatsapp'

export type VariavelTemplate = { chave: string; descricao: string; exemplo: string | string[]; lista?: boolean }

export type TemplateDef = {
  chave: string
  nome: string
  descricao: string
  grupo: 'Cadastros Recebidos' | 'Portal do cadastro'
  canais: CanalMensagem[]
  /** Um envio por envolvido (sócio/administrador), não por parceiro. */
  por_envolvido: boolean
  variaveis: VariavelTemplate[]
  email_assunto: string
  email_html: string
  whatsapp_texto: string
}

const NOME = { chave: 'nome', descricao: 'Nome de quem recebe (quem preencheu o cadastro ou o sócio)', exemplo: 'Andre Silva Haas' }

export const TEMPLATES_PADRAO: TemplateDef[] = [
  {
    chave: 'onboarding_nuvidio_convite',
    nome: 'Convite para validação por vídeo (Nuvidio)',
    descricao: 'Etapa 3 — enviado ao parceiro com o link da sala da Nuvidio.',
    grupo: 'Cadastros Recebidos',
    canais: ['email', 'whatsapp'],
    por_envolvido: false,
    variaveis: [NOME, { chave: 'link', descricao: 'Link da sala Nuvidio', exemplo: 'https://atendimento.nuvidio.com/abc123' }],
    email_assunto: 'BRS Promotora — Validação por vídeo (Nuvidio)',
    email_html:
      '<p>Olá, <strong>{{nome}}</strong>!</p><p>Para seguirmos com o seu credenciamento na BRS Promotora, precisamos de uma rápida validação por vídeo.</p><p><a href="{{link}}">Clique aqui para fazer a validação</a> — leva poucos minutos.</p><p>Qualquer dúvida, responda este e-mail.</p><p>Equipe BRS Promotora</p>',
    whatsapp_texto:
      'Olá, {{nome}}! Aqui é da BRS Promotora. Para seguirmos com o seu credenciamento, precisamos de uma rápida validação por vídeo. Acesse: {{link}} — leva poucos minutos. Qualquer dúvida, é só responder por aqui.',
  },
  {
    chave: 'onboarding_contrato_assinatura',
    nome: 'Contrato de credenciamento para assinatura',
    descricao: 'Etapa 5 — links de assinatura do contrato (um por signatário).',
    grupo: 'Cadastros Recebidos',
    canais: ['email', 'whatsapp'],
    por_envolvido: false,
    variaveis: [NOME, { chave: 'links', descricao: 'Links de assinatura (lista)', exemplo: ['https://assinafy.com.br/s/abc', 'https://assinafy.com.br/s/def'], lista: true }],
    email_assunto: 'BRS Promotora — Contrato de credenciamento para assinatura',
    email_html:
      '<p>Olá, <strong>{{nome}}</strong>!</p><p>Seu contrato de credenciamento com a BRS Promotora está pronto para assinatura digital:</p>{{links}}<p>Após todas as assinaturas, seguimos para a etapa final do seu cadastro.</p><p>Equipe BRS Promotora</p>',
    whatsapp_texto:
      'Olá, {{nome}}! Seu contrato de credenciamento com a BRS Promotora está pronto para assinatura digital:\n{{links}}\nApós todas as assinaturas, seguimos para a etapa final do seu cadastro.',
  },
  {
    chave: 'onboarding_termo_assinatura',
    nome: 'Termo de usuário para assinatura (por envolvido)',
    descricao: 'Etapa 6 — um envio por sócio/administrador certificado, com o link do termo dele.',
    grupo: 'Cadastros Recebidos',
    canais: ['email', 'whatsapp'],
    por_envolvido: true,
    variaveis: [
      NOME,
      { chave: 'nome_envolvido', descricao: 'Nome do sócio/administrador que assina o termo', exemplo: 'Maria Souza' },
      { chave: 'link', descricao: 'Link de assinatura do termo', exemplo: 'https://assinafy.com.br/s/xyz' },
    ],
    email_assunto: 'BRS Promotora — Termo de usuário para assinatura',
    email_html:
      '<p>Olá, <strong>{{nome_envolvido}}</strong>!</p><p>Seu termo de usuário do crédito consignado na BRS Promotora está pronto para assinatura digital:</p><p><a href="{{link}}">Clique aqui para assinar</a></p><p>Equipe BRS Promotora</p>',
    whatsapp_texto: 'Olá, {{nome_envolvido}}! Seu termo de usuário do crédito consignado na BRS Promotora está pronto para assinatura: {{link}}',
  },
  {
    chave: 'onboarding_correcao_solicitada',
    nome: 'Ajustes necessários no cadastro (correção)',
    descricao: 'Enviado quando o operador clica em "Enviar correções": lista dos itens e o link seguro.',
    grupo: 'Cadastros Recebidos',
    canais: ['email', 'whatsapp'],
    por_envolvido: false,
    variaveis: [
      NOME,
      { chave: 'itens', descricao: 'Itens a corrigir com a instrução (lista)', exemplo: ['CNPJ: confira os dígitos', 'Contrato social: reenvie a última alteração'], lista: true },
      { chave: 'link', descricao: 'Link seguro de correção (válido por 7 dias)', exemplo: 'https://parceiro.brspromotora.com.br/correcao/abc123' },
    ],
    email_assunto: 'BRS Promotora — Ajustes necessários no seu cadastro',
    email_html:
      '<p>Olá, <strong>{{nome}}</strong>!</p><p>Analisamos o seu cadastro na BRS Promotora e precisamos de alguns ajustes:</p>{{itens}}<p><a href="{{link}}">Clique aqui para corrigir</a> (link seguro, válido por 7 dias).</p><p>Equipe BRS Promotora</p>',
    whatsapp_texto:
      'Olá, {{nome}}! Analisamos o seu cadastro na BRS Promotora e precisamos de alguns ajustes:\n{{itens}}\n\nCorrija pelo link seguro (válido por 7 dias): {{link}}',
  },
  {
    chave: 'onboarding_boas_vindas',
    nome: 'Boas-vindas (credenciamento concluído)',
    descricao: 'Etapa 7 — disparado ao aprovar as boas-vindas; inclui o código ARW quando existir.',
    grupo: 'Cadastros Recebidos',
    canais: ['email', 'whatsapp'],
    por_envolvido: false,
    variaveis: [NOME, { chave: 'codigo_arw', descricao: 'Código do parceiro no ARW (pode estar vazio — use o bloco {{#codigo_arw}}...{{/codigo_arw}})', exemplo: 'DF3-4' }],
    email_assunto: 'Bem-vindo à BRS Promotora! 🎉',
    email_html:
      '<p>Parabéns, <strong>{{nome}}</strong>! 🎉</p><p>Seu credenciamento na BRS Promotora foi concluído.{{#codigo_arw}} Seu código de parceiro é {{codigo_arw}}.{{/codigo_arw}}</p><p>Em breve nosso time comercial entra em contato com os próximos passos.</p><p>Seja muito bem-vindo!<br/>Equipe BRS Promotora</p>',
    whatsapp_texto:
      'Parabéns, {{nome}}! Seu credenciamento na BRS Promotora foi concluído.{{#codigo_arw}} Seu código de parceiro é {{codigo_arw}}.{{/codigo_arw}} Em breve nosso time comercial entra em contato com os próximos passos. Seja muito bem-vindo!',
  },
  {
    chave: 'portal_codigo_verificacao',
    nome: 'Código de verificação do e-mail (portal)',
    descricao: 'Portal — etapa de identificação: código de 6 dígitos, válido por 10 minutos.',
    grupo: 'Portal do cadastro',
    canais: ['email'],
    por_envolvido: false,
    variaveis: [
      { chave: 'primeiro_nome', descricao: 'Primeiro nome de quem preenche', exemplo: 'Andre' },
      { chave: 'codigo', descricao: 'Código de 6 dígitos', exemplo: '482913' },
    ],
    email_assunto: '{{codigo}} é o seu código de verificação — BRS Promotora',
    email_html:
      '<p>Olá, <strong>{{primeiro_nome}}</strong>!</p><p>Use o código abaixo para confirmar seu e-mail e continuar o cadastro de parceiro na BRS Promotora:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:1rem 0;">{{codigo}}</p><p>Ele vale por 10 minutos. Se você não pediu esse código, pode ignorar este e-mail.</p><p>Equipe BRS Promotora</p>',
    whatsapp_texto: '',
  },
  {
    chave: 'portal_link_retomada',
    nome: 'Link para continuar o cadastro (portal)',
    descricao: 'Portal — link mágico para retomar o rascunho, válido por 30 dias.',
    grupo: 'Portal do cadastro',
    canais: ['email'],
    por_envolvido: false,
    variaveis: [
      { chave: 'primeiro_nome', descricao: 'Primeiro nome de quem preenche', exemplo: 'Andre' },
      { chave: 'url', descricao: 'Link de retomada', exemplo: 'https://parceiro.brspromotora.com.br/cadastro/continuar/abc123' },
    ],
    email_assunto: 'Continue o seu cadastro na BRS Promotora',
    email_html:
      '<p>Olá, <strong>{{primeiro_nome}}</strong>!</p><p>Guarde este link para continuar o seu cadastro de parceiro de onde parou, quando quiser:</p><p><a href="{{url}}">{{url}}</a></p><p>O link fica valendo por 30 dias.</p><p>Equipe BRS Promotora</p>',
    whatsapp_texto: '',
  },
]

export function templatePadrao(chave: string): TemplateDef | undefined {
  return TEMPLATES_PADRAO.find((t) => t.chave === chave)
}

/** Variáveis de exemplo de um template, para a pré-visualização. */
export function exemploVars(def: TemplateDef): Record<string, string | string[]> {
  return Object.fromEntries(def.variaveis.map((v) => [v.chave, v.exemplo]))
}
