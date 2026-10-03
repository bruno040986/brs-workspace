/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from '@/lib/supabase/server'
import { gerarComprovanteImagem } from './comprovante-imagem'
import { formatarTelefoneContato, telefoneContatoDigitos, type Campanha } from './http'
import { mascararCpf } from './mascara'
import { textoComprovanteIndicacao } from './mensagens'
import { enviarWhatsappPromocao, type ResultadoEnvio } from './whatsapp'

export const MAX_ENVIOS_COMPROVANTE = 3

/**
 * Escolhe o `n` da chave de envio: reaproveita a tentativa ainda não confirmada
 * (mesma operation_id, sem duplicar) ou abre a próxima; null = limite atingido.
 */
export async function proximoNEnvio(admin: any, prefixo: string): Promise<number | null> {
  const chaves = Array.from({ length: MAX_ENVIOS_COMPROVANTE }, (_, i) => `${prefixo}:${i + 1}`)
  const { data } = await admin.from('promocao_envios').select('chave, status').in('chave', chaves)
  const porChave = new Map<string, string>((data || []).map((r: any) => [String(r.chave), String(r.status)]))
  for (let n = 1; n <= MAX_ENVIOS_COMPROVANTE; n++) {
    const st = porChave.get(`${prefixo}:${n}`)
    if (st !== 'enviado') return n
  }
  return null
}

/** Gera a imagem + legenda e envia pela instância dedicada. Chave idempotente por (indicação, n). */
export async function enviarComprovanteIndicacao(indicacaoId: string, n: number): Promise<ResultadoEnvio> {
  const admin: any = await createAdminClient()
  const { data: ind } = await admin
    .from('promocao_indicacoes')
    .select('id, numero, campanha_id, cpf_indicado, indicador_id, inscricao_id')
    .eq('id', indicacaoId)
    .maybeSingle()
  if (!ind) return { resultado: 'rejeitado', mensagem: 'indicação não encontrada' }
  const [{ data: indicador }, { data: indicado }] = await Promise.all([
    admin.from('promocao_indicadores').select('nome, telefone').eq('id', ind.indicador_id).maybeSingle(),
    admin.from('promocao_inscricoes').select('nome, codigo').eq('id', ind.inscricao_id).maybeSingle(),
  ])
  if (!indicador || !indicado) return { resultado: 'rejeitado', mensagem: 'dados da indicação não encontrados' }
  const { data: camp } = await admin.from('promocao_campanhas').select('*').eq('id', ind.campanha_id).maybeSingle()
  if (!camp) return { resultado: 'rejeitado', mensagem: 'campanha não encontrada' }

  const contato = formatarTelefoneContato(await telefoneContatoDigitos(admin, camp as Campanha))
  const imagem = await gerarComprovanteImagem({
    numeroIndicacao: ind.numero,
    indicadorNome: indicador.nome,
    indicadoNome: indicado.nome,
    indicadoCpfMascarado: mascararCpf(ind.cpf_indicado),
    contato,
  })
  return enviarWhatsappPromocao({
    campanhaId: ind.campanha_id,
    chave: `comprovante-ind:${ind.id}:${n}`,
    tipo: 'comprovante_indicacao',
    telefone: indicador.telefone,
    texto: textoComprovanteIndicacao({
      indicador: indicador.nome,
      indicado: indicado.nome,
      numeroIndicacao: ind.numero,
      codigoInscricao: indicado.codigo,
      contato,
      regulamentoUrl: camp.regulamento_url,
    }),
    imagemBase64: imagem.toString('base64'),
  })
}
