/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { gerarComprovanteImagem } from '@/lib/promocoes/comprovante-imagem'
import { hashToken } from '@/lib/promocoes/codigos'
import { aplicarLimites, erro, formatarTelefoneContato, ipDoRequest, logSeguro, telefoneContatoDigitos, type Campanha } from '@/lib/promocoes/http'
import { mascararCpf } from '@/lib/promocoes/mascara'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const INVALIDO = () => erro('LINK_INVALIDO', 'Este comprovante não está mais disponível.', 404)

export async function GET(request: NextRequest) {
  const limite = await aplicarLimites([[`rl:comp:ip:${ipDoRequest(request)}`, 600, 600]])
  if (limite) return limite
  const t = request.nextUrl.searchParams.get('t') || ''
  if (t.length < 20 || t.length > 100) return INVALIDO()

  const admin: any = await createAdminClient()
  const { data: ind } = await admin
    .from('promocao_indicacoes')
    .select('numero, campanha_id, cpf_indicado, indicador_id, inscricao_id, comprovante_expira_em, status')
    .eq('comprovante_token_hash', hashToken(t))
    .maybeSingle()
  if (!ind || ind.status !== 'valida' || !ind.comprovante_expira_em || new Date(ind.comprovante_expira_em).getTime() < Date.now()) return INVALIDO()

  try {
    const [{ data: indicador }, { data: indicado }, { data: camp }] = await Promise.all([
      admin.from('promocao_indicadores').select('nome').eq('id', ind.indicador_id).maybeSingle(),
      admin.from('promocao_inscricoes').select('nome').eq('id', ind.inscricao_id).maybeSingle(),
      admin.from('promocao_campanhas').select('*').eq('id', ind.campanha_id).maybeSingle(),
    ])
    if (!indicador || !indicado || !camp) return INVALIDO()
    const png = await gerarComprovanteImagem({
      numeroIndicacao: ind.numero,
      indicadorNome: indicador.nome,
      indicadoNome: indicado.nome,
      indicadoCpfMascarado: mascararCpf(ind.cpf_indicado),
      contato: formatarTelefoneContato(await telefoneContatoDigitos(admin, camp as Campanha)),
      sorteio: camp.data_sorteio,
    })
    return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    logSeguro('comprovante png', e)
    return erro('ERRO_INTERNO', 'Não foi possível gerar o comprovante agora.', 500)
  }
}
