import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { getTemplatesMensagens } from './actions'
import TemplatesMensagensClient from './_components/TemplatesMensagensClient'

export const dynamic = 'force-dynamic'

export default async function TemplatesMensagensPage() {
  const [r, permissoes] = await Promise.all([getTemplatesMensagens(), getCurrentUserEffectivePermissions()])
  if (!r.success) {
    return (
      <div className="page-content">
        <div className="card" style={{ padding: '1.25rem', color: '#991B1B' }}>{r.error}</div>
      </div>
    )
  }
  return <TemplatesMensagensClient templates={r.templates} podeEditar={hasPermission(permissoes, 'workspace-templates-mensagens', 'can_edit')} />
}
