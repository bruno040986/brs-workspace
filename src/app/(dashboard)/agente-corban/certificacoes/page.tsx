import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { getCatalogoCertificacoes, listarVencimentos } from './actions'
import CertificacoesClient from './_components/CertificacoesClient'

export const dynamic = 'force-dynamic'

/** Agente Corban › Certificações — catálogo, logotipos e vencimentos (fatia 3). */
export default async function CertificacoesPage() {
  const [catalogo, vencimentos, permissoes] = await Promise.all([getCatalogoCertificacoes(), listarVencimentos(60), getCurrentUserEffectivePermissions()])

  if (!catalogo.success) {
    return (
      <div className="page-content">
        <div className="card" style={{ padding: '1.25rem', color: '#991B1B' }}>
          {catalogo.error}
        </div>
      </div>
    )
  }

  return (
    <CertificacoesClient
      catalogoInicial={{ certificadoras: catalogo.certificadoras, tipos: catalogo.tipos, certificacoes: catalogo.certificacoes }}
      vencimentosIniciais={vencimentos.success ? vencimentos.rows : []}
      podeIncluir={hasPermission(permissoes, 'workspace-certificacoes', 'can_include')}
      podeEditar={hasPermission(permissoes, 'workspace-certificacoes', 'can_edit')}
    />
  )
}
