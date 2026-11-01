import { redirect } from 'next/navigation'
import { obterEtapaSessao } from '@/lib/auth/sessao-interna'
import AcessoEtapas from './AcessoEtapas'

export const dynamic = 'force-dynamic'

export default async function AcessoPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams
  const { etapa, proximo, estado } = await obterEtapaSessao()
  if (etapa === 'liberada') redirect('/')
  if (etapa === 'anonima' || etapa === 'negada') redirect('/login')
  return (
    <AcessoEtapas
      proximo={proximo as 'ativar_email' | 'ativar_totp' | 'totp' | 'email'}
      pausaInicialSeg={proximo === 'totp' ? estado?.pausa_totp_seg ?? 0 : estado?.pausa_email_seg ?? 0}
      instabilidade={motivo === 'instabilidade'}
    />
  )
}
