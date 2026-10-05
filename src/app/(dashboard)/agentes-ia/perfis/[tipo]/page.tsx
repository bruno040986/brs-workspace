import { notFound } from 'next/navigation'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { carregarPerfilPadrao, listarVersoesPerfil } from '../../actions'
import PerfilPadraoClient from '../../_components/PerfilPadraoClient'

export const dynamic = 'force-dynamic'

export default async function PerfilTipoPage({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params
  const [dados, versoes, permissoes] = await Promise.all([carregarPerfilPadrao(tipo), listarVersoesPerfil(tipo), getCurrentUserEffectivePermissions()])
  if (!dados) notFound()
  return (
    <PerfilPadraoClient
      tipo={tipo}
      nome={dados.nome}
      perfilInicial={dados.perfil}
      versaoInicial={dados.versao}
      versoesIniciais={versoes.success ? versoes.versoes : []}
      bc={dados.bc}
      podeEditar={hasPermission(permissoes, 'comercial-agentes-ia', 'can_edit')}
    />
  )
}
