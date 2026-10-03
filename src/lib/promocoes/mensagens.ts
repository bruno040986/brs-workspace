/**
 * Catálogo de mensagens WhatsApp da promoção (CONTRATO §6.3). Texto FINAL — não
 * parafrasear. Funções puras; quem envia é src/lib/promocoes/whatsapp.ts (frente E).
 */
import { formatarDataBr, formatarTelefone } from './mascara.ts'
import { formatarNumeroSorte } from './codigos.ts'

const NOME_PROMOCAO = 'NuAzul – Você Sempre no Azul | Valparaíso de Goiás'

/** M1 — OTP */
export function textoOtp(codigo: string): string {
  return `NuAzul: seu código de confirmação é ${codigo}. Ele vale por 10 minutos. Se você não pediu este código, ignore esta mensagem.`
}

/** M2 — legenda do comprovante (imagem) da indicação */
export function textoComprovanteIndicacao(v: { indicador: string; indicado: string; numeroIndicacao: string; codigoInscricao: string; contato: string; regulamentoUrl: string }): string {
  const contato = formatarTelefone(v.contato)
  return [
    'Indicação registrada! ✅',
    `Promoção ${NOME_PROMOCAO}`,
    '',
    `Indicador: ${v.indicador}`,
    `Indicado: ${v.indicado}`,
    `Número de indicação: ${v.numeroIndicacao}`,
    '',
    `Repasse ao servidor indicado: ele deve falar com a NuAzul pelo WhatsApp ${contato} e informar o número de indicação ${v.numeroIndicacao} logo no início do atendimento. Vale a primeira indicação registrada para cada servidor.`,
    '',
    `Quando o indicado concluir R$ 5.000 em crédito pago no período, você recebe R$ 50 por Pix e, cumprida a regra de cartão, um número da sorte. Regulamento: ${v.regulamentoUrl}`,
  ].join('\n')
}

/** M3 — link de números ao servidor. `prazo` = YYYY-MM-DD */
export function textoLinkServidor(v: { nome: string; qtd: number; url: string; prazo: string; contato: string }): string {
  return [
    `Olá, ${v.nome}! Suas operações na promoção ${NOME_PROMOCAO} foram confirmadas e você tem ${v.qtd} número(s) da sorte para gerar.`,
    '',
    'Acesse o seu link individual, confira seus dados e as operações consideradas, aceite o regulamento e gere seus números:',
    v.url,
    '',
    `O link é pessoal e pode ser usado uma única vez, até ${formatarDataBr(v.prazo)}. Sorteio pela Loteria Federal de 11/11/2026. Dúvidas: ${formatarTelefone(v.contato)}`,
  ].join('\n')
}

/** M4 — link de número ao indicador. `indicado` já curto (ex.: "Maria S.") */
export function textoLinkIndicador(v: { nome: string; indicado: string; url: string; prazo: string; contato: string }): string {
  return [
    `Olá, ${v.nome}! O servidor que você indicou (${v.indicado}) cumpriu as regras da promoção ${NOME_PROMOCAO} e você ganhou 1 número da sorte.`,
    '',
    `Gere o seu número pelo link individual (uso único, até ${formatarDataBr(v.prazo)}):`,
    v.url,
    '',
    `Sorteio pela Loteria Federal de 11/11/2026. Dúvidas: ${formatarTelefone(v.contato)}`,
  ].join('\n')
}

/** M5 — comprovante de números gerados */
export function textoComprovanteNumeros(v: { nome: string; numeros: number[]; total: number; regulamentoUrl: string }): string {
  return [
    `${v.nome}, seus números da sorte na promoção ${NOME_PROMOCAO}:`,
    ...v.numeros.map(formatarNumeroSorte),
    '',
    `Total de números até agora: ${v.total}. Guarde esta mensagem.`,
    `Sorteio: 1º prêmio da Loteria Federal de 11/11/2026. Se o número sorteado não tiver sido distribuído, vale a aproximação prevista no regulamento. A NuAzul entrará em contato com o ganhador pelos dados informados. Regulamento: ${v.regulamentoUrl}`,
  ].join('\n')
}

export type ItemAvisoPagamento = { nome: string; cpfMascarado: string }

/**
 * M6 — aviso de pagamento (texto EXATO do regras.md). Assinatura do CONTRATO §6.3:
 * `valor` já formatado ('1.234,56' — use formatarValor), `pixChave` em claro (ou
 * 'Dados bancários — {banco} ag. {agencia} c/c {conta}'), `pagadorCnpjFmt` com máscara.
 */
export function textoAvisoPagamento(v: { valor: string; itens: ItemAvisoPagamento[]; pixChave: string; pagadorCnpjFmt: string; pagadorNome: string }): string {
  return [
    `Pela sua indicação na promoção NuAzul - Você sempre no azul | Valparaíso de Goiás, hoje estamos realizando o pagamento de R$ ${v.valor} referente as indicações abaixo. Obrigado!`,
    ...v.itens.map((i) => `${i.nome} - CPF ${i.cpfMascarado}`),
    '',
    `Para sua conferência o valor será pago pelo CNPJ ${v.pagadorCnpjFmt} em nome de ${v.pagadorNome} até as 20:00h de hoje no pix cadastrado:`,
    `Chave Pix: ${v.pixChave}`,
  ].join('\n')
}

/** M7 — texto pré-preenchido do botão "Falar no WhatsApp" (wa.me) */
export function textoAberturaAtendimento(v: { codigo: string; numeroIndicacao?: string | null }): string {
  const base = `Olá! Quero participar da promoção ${NOME_PROMOCAO}. Meu código de inscrição é ${v.codigo}.`
  return v.numeroIndicacao ? `${base} Número de indicação: ${v.numeroIndicacao}.` : base
}

/** URL wa.me pronta (telefone com 55). */
export function urlWhatsapp(telefoneContato: string, texto: string): string {
  const d = String(telefoneContato).replace(/\D/g, '')
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`
}
