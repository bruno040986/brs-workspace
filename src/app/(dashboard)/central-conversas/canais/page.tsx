import { getCentralConversasView } from '@/lib/central-conversas/actions'
import InstanciasClient from '../_components/InstanciasClient'

export const dynamic = 'force-dynamic'

export default async function CentralConversasCanaisPage() {
  const view = await getCentralConversasView()
  return <InstanciasClient view={view} />
}
