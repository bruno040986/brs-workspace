import { notFound, redirect } from 'next/navigation'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { getSolicitacaoById } from '../actions'
import { SolicitacaoDetalheClient } from './SolicitacaoDetalheClient'

export const dynamic = 'force-dynamic'

export default async function SolicitacaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'agente-corban-solicitacoes', 'can_view')) {
    redirect('/acesso-negado')
  }

  const result = await getSolicitacaoById(id)
  if (!result.success || !result.item) notFound()

  const podeEditar = hasPermission(permissions, 'agente-corban-solicitacoes', 'can_edit')

  return <SolicitacaoDetalheClient item={result.item} documentoSignedUrl={result.documentoSignedUrl ?? null} podeEditar={podeEditar} />
}
