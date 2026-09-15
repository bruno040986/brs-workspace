/**
 * Higienização Amigoz — Gestão de Leads › Comercial (Fatia 2).
 * Ver docs/ROTEIRO-AMIGOZ-FATIA-2-HIGIENIZACAO.md.
 */
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth/server'
import { HigienizacaoAmigozClient } from './HigienizacaoAmigozClient'

export const dynamic = 'force-dynamic'

export default async function HigienizacaoAmigozPage() {
  try {
    await requirePermission('alvoconsig-higienizacao-amigoz')
  } catch {
    redirect('/gestao-leads')
  }
  return <HigienizacaoAmigozClient />
}
