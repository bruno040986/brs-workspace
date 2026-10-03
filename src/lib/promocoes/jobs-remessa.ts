/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EngineJob } from '@/lib/scp-engine/decisions'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarWhatsappPromocao } from './whatsapp'
import { mascararCpf } from './mascara'
import { textoAvisoPagamento } from './mensagens'
import { formatarValorBR } from './remessa-logic'

function formatarCnpj(d: string) {
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

/** promocoes.aviso_pagamento — 1 mensagem por indicador, agrupando os indicados da remessa. */
export async function handleAvisoPagamento(job: EngineJob): Promise<void> {
  const remessaId = String(job.payload?.remessaId || '')
  const indicadorId = String(job.payload?.indicadorId || '')
  if (!remessaId || !indicadorId) throw new Error('Payload do aviso de pagamento incompleto.')

  const sb: any = await createAdminClient()
  const [{ data: remessa }, { data: itens }, { data: indicador }] = await Promise.all([
    sb.from('promocao_remessas').select('campanha_id, status, pagador_cnpj, pagador_nome').eq('id', remessaId).maybeSingle(),
    sb.from('promocao_remessa_itens').select('*').eq('remessa_id', remessaId).eq('indicador_id', indicadorId).order('indicado_nome'),
    sb.from('promocao_indicadores').select('telefone').eq('id', indicadorId).maybeSingle(),
  ])
  if (!remessa || !itens?.length || !indicador) throw new Error('Remessa, itens ou indicador não encontrados.')
  if (remessa.status !== 'enviada_pagamento') throw new Error('Remessa não está enviada para pagamento.')

  const total = itens.reduce((s: number, i: any) => s + Number(i.valor_centavos), 0)
  const ref = itens[0]
  const pixChave = ref.pix_tipo === 'dados_bancarios'
    ? `Dados bancários — ${ref.banco_nome ?? ref.banco_codigo} ag. ${ref.agencia} c/c ${ref.conta}`
    : ref.pix_chave

  const texto = textoAvisoPagamento({
    valor: formatarValorBR(total),
    itens: itens.map((i: any) => ({ nome: i.indicado_nome, cpfMascarado: mascararCpf(i.indicado_cpf) })),
    pixChave,
    pagadorCnpjFmt: formatarCnpj(remessa.pagador_cnpj ?? '41356863000183'),
    pagadorNome: remessa.pagador_nome ?? 'Blue Pay Solutions Ltda',
  })

  const r = await enviarWhatsappPromocao({
    campanhaId: remessa.campanha_id,
    chave: `pagamento:${remessaId}:${indicadorId}`,
    tipo: 'aviso_pagamento',
    telefone: indicador.telefone,
    texto,
  })
  if (r.resultado === 'confirmado') return
  if (r.resultado === 'rejeitado' && /sem_whatsapp/i.test(r.mensagem)) return
  throw new Error(r.mensagem)
}
