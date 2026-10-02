import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, ipDoRequest, ok, telefoneContatoDigitos } from '@/lib/promocoes/http'
import { instanciaPromocaoDisponivel } from '@/lib/promocoes/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const limite = await aplicarLimites([[`rl:config:ip:${ipDoRequest(request)}`, 120, 600]])
  if (limite) return limite
  const camp = await buscarCampanha(request.nextUrl.searchParams.get('campanha'), ['ativa', 'encerrada_cadastro', 'encerrada'])
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const admin: any = await createAdminClient()
  const otpDisponivel = camp.otp_obrigatorio ? await instanciaPromocaoDisponivel(camp.id).catch(() => false) : false
  return ok({
    nome: camp.nome,
    status: camp.status,
    inicio: camp.inicio_em,
    fim: camp.fim_em,
    prazoGeracaoAte: camp.prazo_geracao_ate,
    dataSorteio: camp.data_sorteio,
    otpObrigatorio: camp.otp_obrigatorio,
    otpDisponivel,
    telefoneContato: await telefoneContatoDigitos(admin, camp),
    regulamentoUrl: camp.regulamento_url,
    regulamentoVersao: camp.regulamento_versao,
    pixels: { meta: camp.pixel_meta_id, ga4: camp.ga4_id, gads: camp.gads_id },
    faixasCartao: camp.faixas_cartao,
    minimoCentavos: camp.minimo_centavos,
  })
}
