/**
 * Textos finais do "Solicitar atendimento" (CONTRATO-ATENDIMENTO §5). Funções puras — não parafrasear.
 * O site exibe EXATAMENTE as constantes de consentimento.
 */
import { textoAberturaAtendimento, urlWhatsapp } from './mensagens.ts'

const NOME_PROMOCAO = 'NuAzul – Você Sempre no Azul | Valparaíso de Goiás'

/** Primeira palavra do nome, como veio. */
export function primeiroNome(nome: string): string {
  return String(nome ?? '').trim().split(/\s+/)[0] || ''
}

/** 5.1 — enviada pela empresa ao servidor. */
export function textoAtendimentoServidor(v: { nome: string; codigo: string }): string {
  return `Olá, ${primeiroNome(v.nome)}! Aqui é a NuAzul. Você pediu atendimento na promoção ${NOME_PROMOCAO} (código ${v.codigo}). Responda esta mensagem que um atendente continua com você. Se não foi você, é só ignorar.`
}

/** 5.2 — enviada pela empresa ao indicado. */
export function textoAtendimentoIndicado(v: { nome: string; nomeIndicador: string; numeroIndicacao: string }): string {
  return `Olá, ${primeiroNome(v.nome)}! ${v.nomeIndicador} indicou você na promoção ${NOME_PROMOCAO} (número de indicação ${v.numeroIndicacao}) para falar sobre consignado e concorrer a um iPhone 17. Responda esta mensagem que um atendente continua com você. Se não quiser receber mais mensagens, responda SAIR.`
}

/** 5.3 — consentimento do botão A do indicador. */
export const CONSENTIMENTO_INDICADO_VERSAO = '2026-10-03'
export const CONSENTIMENTO_INDICADO_TEXTO = 'Você tem autorização do indicado para receber mensagem do nosso número? Se NÃO tiver, use o botão "Enviar pelo meu WhatsApp".'
export const CONSENTIMENTO_INDICADO_BOTAO_SIM = 'Tenho autorização — enviar'
export const CONSENTIMENTO_INDICADO_BOTAO_NAO = 'Não tenho — enviar pelo meu WhatsApp'
/** Cópia gravada no pedido (imutável por trigger). */
export const CONSENTIMENTO_INDICADO_GRAVADO = `${CONSENTIMENTO_INDICADO_TEXTO} [${CONSENTIMENTO_INDICADO_BOTAO_SIM}]`

/** 5.4 — texto do botão B (sai do celular do indicador). */
export function textoIndicadorParaIndicado(v: { nomeIndicado: string; nomeIndicador: string; numeroIndicacao: string; codigoInscricao: string; contatoDigitos: string }): string {
  const link = urlWhatsapp(v.contatoDigitos, textoAberturaAtendimento({ codigo: v.codigoInscricao, numeroIndicacao: v.numeroIndicacao }))
  return `Oi, ${primeiroNome(v.nomeIndicado)}! Aqui é ${v.nomeIndicador}. Indiquei você na promoção ${NOME_PROMOCAO}: crédito consignado para servidores da Prefeitura de Valparaíso de Goiás e concorre a um iPhone 17.\n\nSeu número de indicação é ${v.numeroIndicacao}. Para falar com a NuAzul, toque no link abaixo — a mensagem já vai pronta com o seu número:\n${link}`
}

export function urlWhatsappIndicado(telefoneIndicadoDigitos: string, texto: string): string {
  return urlWhatsapp(telefoneIndicadoDigitos, texto)
}

/** 5.5 — mensagens de tela. */
export const M_OK = {
  servidor: 'Já enviamos uma mensagem para o seu WhatsApp. Responda por lá que um atendente continua com você.',
  indicado: 'Já enviamos mensagem ao seu indicado. Avise que ele pode responder por lá.',
} as const
export const M_JA_ENVIADO = {
  servidor: 'Já enviamos uma mensagem para o seu WhatsApp.',
  indicado: 'Já enviamos mensagem ao seu indicado.',
} as const
export const M_FALHOU = {
  servidor: 'Não conseguimos entregar a mensagem neste número. Use o botão "Falar no WhatsApp".',
  indicado: 'Não conseguimos entregar a mensagem ao seu indicado. Use o botão "Enviar pelo meu WhatsApp".',
} as const
export const M_HORARIO = 'A NuAzul chama das 7h às 21h. Use o botão do WhatsApp ou volte mais tarde.'
export const M_ENFASE_B = 'Sem a autorização do indicado, envie pelo seu WhatsApp.'

/** Mensagens de erro da API (CONTRATO §3.2). */
export const MSG_ERRO = {
  LINK_INVALIDO: 'Este cadastro não está mais disponível. Recarregue a página.',
  ATENDIMENTO_INDISPONIVEL: 'No momento não conseguimos chamar você por aqui. Use o botão "Falar no WhatsApp".',
  SEM_CONSENTIMENTO: 'Confirme que você tem autorização do indicado para receber nossa mensagem.',
  TELEFONE_NAO_VERIFICADO: 'Para a NuAzul chamar, o WhatsApp precisa ter sido confirmado com o código. Use o botão "Falar no WhatsApp".',
  LIMITE_INDICADOR: 'Você atingiu o limite de envios por hora. Aguarde alguns minutos e tente novamente.',
  LIMITE_INSTANCIA: 'Muitos pedidos neste momento. Aguarde alguns minutos e tente novamente.',
  ERRO_INTERNO: 'Não foi possível concluir agora. Tente novamente.',
} as const
